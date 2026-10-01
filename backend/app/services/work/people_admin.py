"""People administration: bulk import, offboarding, ownership, sign-in rules, email set-up, profile photos."""

import logging
import os
import secrets
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import BlockedEmail, Task, TaskAssignee, Team, TeamMember, User, Workspace, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work import audit, events, onboarding
from app.services.work.access import Access, access_problem, chain_for_task, sign_in_problem
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.people import (
    PROFILE_FIELDS, _check_manager, _find_or_create_user, _require_admin, _set_teams, add_person, check_domain,
    send_invite,
)
from app.services.work.permissions import can_manage_workspace

log = logging.getLogger(__name__)

ROLE_WORDS = {
    "owner": None, "admin": WorkspaceRole.admin, "administrator": WorkspaceRole.admin, "member": WorkspaceRole.member,
    "limited": WorkspaceRole.limited, "limited member": WorkspaceRole.limited, "guest": WorkspaceRole.guest, "": WorkspaceRole.member,
}


def _member(db: Session, access: Access, user_id: str) -> Tuple[WorkspaceMember, User]:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    user = db.get(User, user_id)
    if member is None or user is None:
        raise NotFound("Person not found")
    return member, user


def _name(user: Optional[User]) -> str:
    return (user.display_name or user.email) if user else ""


# --- bulk import from a spreadsheet ---------------------------------------------------------------------


def import_people(db: Session, access: Access, data: s.PersonImportIn) -> s.PersonImportResult:
    """Add (or update) many people at once. Managers may appear later in the same file.

    Everything runs in one transaction; a dry run rolls it back and just reports what would happen.
    Rows with problems are skipped, the rest go ahead.
    """
    _require_admin(access, "import people")
    teams = {t.name.lower(): t.id for t in db.scalars(select(Team).where(Team.workspace_id == access.workspace_id))}
    results: List[s.PersonImportRowResult] = []
    touched: Dict[str, Tuple[int, s.ImportRow, str]] = {}  # email -> (result index, row, user id)
    seen = set()
    outer = db.begin_nested()
    for i, row in enumerate(data.rows, start=1):
        email = row.email.strip().lower()
        res = s.PersonImportRowResult(row=i, email=email, outcome="unchanged")
        results.append(res)
        if email in seen:
            res.outcome, res.problems = "error", ["appears more than once in the file"]
            continue
        seen.add(email)
        role = ROLE_WORDS.get((row.role or "").strip().lower(), "bad")
        if role == "bad" or role is None:
            res.outcome, res.problems = "error", [f"unknown role \"{row.role}\" (use Admin, Member, Limited or Guest)"]
            continue
        team_ids, missing = [], []
        for name in [t.strip() for t in (row.teams or "").replace(";", ",").split(",") if t.strip()]:
            (team_ids if name.lower() in teams else missing).append(teams.get(name.lower(), name))
        if missing:
            res.problems.append("unknown team: " + ", ".join(missing))
        existing = db.scalars(select(User).where(func.lower(User.email) == email)).first()
        member = db.get(WorkspaceMember, (access.workspace_id, existing.id)) if existing else None
        profile = {f: getattr(row, f) for f in PROFILE_FIELDS if f != "takes_interviews" and getattr(row, f, None) is not None}
        try:
            with db.begin_nested():
                if member is None:
                    member, user = add_person(db, access, s.PersonCreate(
                        email=email, name=row.name or None, role=role, team_ids=[t for t in team_ids if isinstance(t, uuid.UUID)],
                        **profile,
                    ))
                    res.outcome = "added"
                elif data.update_existing:
                    # A blocked address is blocked here too. Without this a spreadsheet could
                    # quietly edit -- and, with a role change, effectively restore -- someone an
                    # admin had barred, which is the hole the blocklist exists to close.
                    check_not_blocked(db, access.workspace_id, email)
                    user = existing
                    if member.role == WorkspaceRole.owner and role != WorkspaceRole.member:
                        pass  # the owner's role never changes by import
                    elif row.role and member.role != role and member.role != WorkspaceRole.owner:
                        check_domain(db, access.workspace_id, email, role)
                        member.role = role
                    for f, v in profile.items():
                        setattr(member, f, v)
                    if row.name and user.auth_uid is None:
                        user.display_name, user.name_from_profile = row.name.strip(), True
                    if team_ids:
                        current = set(db.scalars(select(TeamMember.team_id).join(Team, Team.id == TeamMember.team_id)
                                                 .where(Team.workspace_id == access.workspace_id, TeamMember.user_id == user.id)))
                        _set_teams(db, access, user.id, list(current | {t for t in team_ids if isinstance(t, uuid.UUID)}))
                    res.outcome = "updated"
                else:
                    res.problems.append("already in the workspace; left unchanged")
                    continue
                db.flush()
        except (Invalid, Forbidden) as exc:
            res.outcome, res.problems = "error", res.problems + [exc.message]
            continue
        touched[email] = (i - 1, row, user.id)
    # Second pass: managers by email, now that everyone in the file exists.
    by_email = {u.email.lower(): u.id for u in db.scalars(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id).where(WorkspaceMember.workspace_id == access.workspace_id))}
    for email, (idx, row, user_id) in touched.items():
        if not row.manager_email:
            continue
        manager_id = by_email.get(row.manager_email.strip().lower())
        res = results[idx]
        if manager_id is None:
            res.problems.append(f"manager {row.manager_email} is not in the workspace or the file")
            continue
        try:
            with db.begin_nested():
                _check_manager(db, access, user_id, manager_id)
                db.get(WorkspaceMember, (access.workspace_id, user_id)).manager_id = manager_id
                db.flush()
        except Invalid as exc:
            res.problems.append(exc.message)
    email_problem = None
    if data.dry_run:
        outer.rollback()
    else:
        outer.commit()
        for email, (idx, _row, user_id) in touched.items():
            if results[idx].outcome != "added":
                continue
            if data.start_joiner_checklist:
                steps = onboarding.run_joiner(db, access, user_id)
                bad = [f"{st.name}: {st.reason}" for st in steps if st.outcome == "problem"]
                results[idx].problems += bad[:3]
            if data.send_invites:
                sent, why = send_invite(db, access, user_id)
                email_problem = email_problem or why
    added = sum(r.outcome == "added" for r in results)
    updated = sum(r.outcome == "updated" for r in results)
    return s.PersonImportResult(dry_run=data.dry_run, added=added, updated=updated, errors=sum(r.outcome == "error" for r in results),
                          rows=results, email_problem=email_problem)


# --- offboarding --------------------------------------------------------------------------------------------


# --- barred addresses ------------------------------------------------------------------------------


def check_not_blocked(db: Session, workspace_id: uuid.UUID, email: str) -> None:
    """Refuse an address an admin has barred. Called wherever someone can be added."""
    row = db.scalars(select(BlockedEmail).where(
        BlockedEmail.workspace_id == workspace_id, BlockedEmail.email == email.strip().lower())).first()
    if row is None:
        return
    when = row.blocked_at.date().isoformat()
    who = db.get(User, row.blocked_by) if row.blocked_by else None
    by = f" by {who.display_name or who.email}" if who else ""
    because = f" ({row.reason})" if row.reason else ""
    raise Invalid(f"{email} was blocked from this workspace on {when}{by}{because}. Lift the block in Admin to add them.")


def blocked_emails(db: Session, access: Access) -> List[s.BlockedEmailOut]:
    _require_admin(access, "see blocked addresses")
    rows = list(db.scalars(
        select(BlockedEmail).where(BlockedEmail.workspace_id == access.workspace_id).order_by(BlockedEmail.blocked_at.desc())))
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_([r.blocked_by for r in rows if r.blocked_by])))} if rows else {}
    return [
        s.BlockedEmailOut(
            id=r.id, email=r.email, reason=r.reason, blocked_at=r.blocked_at,
            blocked_by=s.UserOut.model_validate(people[r.blocked_by]) if r.blocked_by in people else None,
        )
        for r in rows
    ]


def block_email(db: Session, access: Access, email: str, reason: Optional[str]) -> BlockedEmail:
    """Bar an address. Anyone in the workspace under it is turned off at the same time."""
    _require_admin(access, "block people")
    address = email.strip().lower()
    if address == (db.get(User, access.user_id).email or "").lower():
        raise Invalid("You can't block your own address")
    existing = db.scalars(select(BlockedEmail).where(
        BlockedEmail.workspace_id == access.workspace_id, BlockedEmail.email == address)).first()
    if existing is not None:
        return existing
    # If they are still a member, barring the address alone would leave them signed in.
    user = db.scalars(select(User).where(func.lower(User.email) == address)).first()
    if user is not None:
        member = db.get(WorkspaceMember, (access.workspace_id, user.id))
        if member is not None:
            if member.role == WorkspaceRole.owner:
                raise Invalid("Transfer ownership before blocking the owner's address")
            if member.role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
                raise Forbidden("Only the owner can block an admin")
            if member.deactivated_at is None:
                member.deactivated_at = datetime.now(timezone.utc)
                member.deactivated_by = access.user_id
            member.ical_token = None  # the calendar feed is a link that works without signing in
    row = BlockedEmail(workspace_id=access.workspace_id, email=address, reason=reason or None, blocked_by=access.user_id)
    db.add(row)
    db.flush()
    audit.record(db, access.workspace_id, access.user_id, "email.blocked", "person", user.id if user else address, address,
                 {"reason": reason})
    return row


def unblock_email(db: Session, access: Access, block_id: uuid.UUID) -> None:
    """Lift a block. It does not put anyone back in the workspace -- they are added again as normal."""
    _require_admin(access, "block people")
    row = db.get(BlockedEmail, block_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("That address is not blocked")
    audit.record(db, access.workspace_id, access.user_id, "email.unblocked", "person", row.email, row.email, {})
    db.delete(row)
    db.flush()


def revoke_sign_in(email: str) -> bool:
    """Disable the identity itself and drop their live sessions. False where none is configured.

    Blocking an address stops them being added back; this stops the session they already hold.
    Best effort on purpose: a local workspace with no Firebase project must still offboard.
    """
    try:
        from firebase_admin import auth

        from app.core.firebase import init_firebase

        init_firebase()
        record = auth.get_user_by_email(email)
        auth.update_user(record.uid, disabled=True)
        auth.revoke_refresh_tokens(record.uid)
        return True
    except Exception:  # no project, no such account, no network -- none of which should stop an offboard
        log.info("Could not revoke the sign-in for %s; the workspace block still applies", email, exc_info=True)
        return False


# --- what taking someone off must not break ---------------------------------------------------------


def _teams_they_lead(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[Team]:
    """Teams where this person is a lead, in name order."""
    return list(db.scalars(
        select(Team)
        .join(TeamMember, TeamMember.team_id == Team.id)
        .where(Team.workspace_id == workspace_id, TeamMember.user_id == user_id, TeamMember.is_lead.is_(True))
        .order_by(Team.name)
    ))


def _sole_lead_of(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[Team]:
    """The ones where they are the only lead, which would be left with nobody in charge."""
    out = []
    for team in _teams_they_lead(db, workspace_id, user_id):
        others = db.scalar(select(func.count()).select_from(TeamMember).where(
            TeamMember.team_id == team.id, TeamMember.is_lead.is_(True), TeamMember.user_id != user_id)) or 0
        if others == 0:
            out.append(team)
    return out


def _check_not_last_admin(db: Session, access: Access, user_id: str) -> None:
    """A workspace with nobody who can administer it cannot be rescued from inside it."""
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    if member is None or member.role not in (WorkspaceRole.owner, WorkspaceRole.admin):
        return
    others = db.scalar(select(func.count()).select_from(WorkspaceMember).where(
        WorkspaceMember.workspace_id == access.workspace_id,
        WorkspaceMember.user_id != user_id,
        WorkspaceMember.role.in_([WorkspaceRole.owner, WorkspaceRole.admin]),
        WorkspaceMember.deactivated_at.is_(None),
    )) or 0
    if others == 0:
        raise Invalid("This is the only active admin. Make someone else an admin first.")


def offboard_preview(db: Session, access: Access, user_id: str) -> s.OffboardPreview:
    _require_admin(access, "offboard people")
    member, user = _member(db, access, user_id)
    manager = db.get(User, member.manager_id) if member.manager_id else None
    items, _ = onboarding.leaver_plan(db, access.workspace_id, user_id)
    reports = db.scalar(select(func.count()).select_from(WorkspaceMember).where(
        WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.manager_id == user_id)) or 0
    teams = db.scalar(select(func.count()).select_from(TeamMember).join(Team, Team.id == TeamMember.team_id).where(
        Team.workspace_id == access.workspace_id, TeamMember.user_id == user_id)) or 0
    try:
        _check_removable(db, access, user_id)
        blocked = None
    except (Invalid, Forbidden) as exc:
        blocked = exc.message
    return s.OffboardPreview(
        person=s.UserOut.model_validate(user), hand_over_to=s.UserOut.model_validate(manager) if manager else None,
        open_tasks=len(onboarding.open_task_ids(db, access.workspace_id, user_id)), direct_reports=reports, teams=teams,
        joiner_tasks_kept=[t.name for _, t, a in items if a in ("retain_birthday", "keep")],
        joiner_tasks_deleted=[t.name for _, t, a in items if a == "delete"],
        sole_lead_of=[t.name for t in _sole_lead_of(db, access.workspace_id, user_id)],
        blocked=blocked,
    )


def _check_removable(db: Session, access: Access, user_id: str) -> WorkspaceMember:
    """The rules that hold however someone is taken off: offboard, turn off or remove."""
    member, _user = _member(db, access, user_id)
    if member.role == WorkspaceRole.owner:
        raise Invalid("Transfer ownership to someone else before taking the owner off")
    if user_id == access.user_id:
        raise Invalid("You can't take yourself off")
    if member.role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
        raise Forbidden("Only the owner can take an admin off")
    _check_not_last_admin(db, access, user_id)
    return member


def offboard(db: Session, access: Access, user_id: str, data: s.OffboardIn) -> s.OffboardResult:
    """Turn off someone's access and tidy up after them, as the leaver SOP says.

    Their open tasks go to the hand-over person (their manager unless chosen otherwise), their direct
    reports move up to their manager, they leave their Teams, and the joiner tasks follow the leaver rules.
    Their history (comments, time, activity) stays. They can be turned back on later.
    """
    from app.services.work.accounts import remove_from_workspace_teams

    _require_admin(access, "offboard people")
    member, user = _member(db, access, user_id)
    _check_removable(db, access, user_id)
    # "Who takes over" is one answer, used for their open tasks and for any team they were the
    # only lead of. Someone naming a successor while leaving the tasks where they are still gets
    # the lead role moved, which is why this is resolved whenever a name is given.
    target = None
    if not data.keep_tasks or data.hand_over_to:
        target_id = data.hand_over_to or member.manager_id
        if not target_id:
            raise Invalid("Choose who takes over their open tasks (they have no reporting manager)")
        if target_id == user_id:
            raise Invalid("Choose someone else to take over their tasks")
        target_member = db.get(WorkspaceMember, (access.workspace_id, target_id))
        if target_member is None or target_member.deactivated_at is not None:
            raise Invalid("The person taking over must be an active member of the workspace")
        target = db.get(User, target_id)
    handed = 0
    if target is not None:
        for task_id in onboarding.open_task_ids(db, access.workspace_id, user_id):
            task = db.get(Task, task_id)
            old = db.get(TaskAssignee, (task_id, user_id))
            if old is not None:
                db.delete(old)
            added = []
            if db.get(TaskAssignee, (task_id, target.id)) is None:
                db.add(TaskAssignee(task_id=task_id, user_id=target.id))
                added = [target.id]
            db.flush()
            events.record(db, task, access.user_id, "assignees", {"added": added, "removed": [user_id], "handover": True})
            if added:
                events.assigned(db, task, access.user_id, added)
            handed += 1
    kept = deleted = 0
    if data.apply_leaver_rules:
        kept, deleted = onboarding.apply_leaver_rules(db, access.workspace_id, user_id)
    moved = db.execute(
        update(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.manager_id == user_id)
        .values(manager_id=member.manager_id)
    ).rowcount or 0
    # A team whose only lead has left is a team nobody is answering for. Whoever takes their
    # work takes the lead role with it; without someone to hand to, say so rather than silently
    # leaving the team headless.
    orphaned = _sole_lead_of(db, access.workspace_id, user_id)
    led_moved = 0
    if orphaned:
        if target is None:
            raise Invalid(
                "They are the only lead of " + ", ".join(t.name for t in orphaned)
                + ". Choose who takes over, or give the team another lead first."
            )
        for team in orphaned:
            row = db.get(TeamMember, (team.id, target.id))
            if row is None:
                db.add(TeamMember(team_id=team.id, user_id=target.id, is_lead=True))
            else:
                row.is_lead = True
            led_moved += 1
        db.flush()
    remove_from_workspace_teams(db, access.workspace_id, user_id)
    member.deactivated_at = datetime.now(timezone.utc)
    member.deactivated_by = access.user_id
    db.flush()
    member.ical_token = None  # their subscribed calendar is a link that needs no sign-in
    blocked = revoked = False
    if data.block_email and user.email:
        block_email(db, access, user.email, data.block_reason)
        blocked = True
        revoked = revoke_sign_in(user.email)
    audit.record(db, access.workspace_id, access.user_id, "person.offboarded", "person", user_id, _name(user), {
        "handed_over_to": target.id if target else None, "tasks_handed_over": handed,
        "joiner_tasks_kept": kept, "joiner_tasks_deleted": deleted, "direct_reports_moved": moved,
        "teams_led_moved": led_moved, "email_blocked": blocked, "sign_in_revoked": revoked,
    })
    return s.OffboardResult(
        tasks_handed_over=handed, joiner_tasks_kept=kept, joiner_tasks_deleted=deleted, direct_reports_moved=moved,
        teams_led_moved=led_moved, email_blocked=blocked, sign_in_revoked=revoked,
    )


def set_active(db: Session, access: Access, user_id: str, active: bool) -> None:
    _require_admin(access, "turn access on or off")
    member, user = _member(db, access, user_id)
    if not active:
        _check_removable(db, access, user_id)
    if active == (member.deactivated_at is None):
        return
    member.deactivated_at = None if active else datetime.now(timezone.utc)
    member.deactivated_by = None if active else access.user_id
    audit.record(db, access.workspace_id, access.user_id, "person.reactivated" if active else "person.deactivated", "person", user_id, _name(user))
    db.flush()


# --- ownership -------------------------------------------------------------------------------------------------


def transfer_ownership(db: Session, access: Access, user_id: str) -> None:
    if access.role != WorkspaceRole.owner:
        raise Forbidden("Only the owner can transfer ownership")
    if user_id == access.user_id:
        raise Invalid("You already own this workspace")
    member, user = _member(db, access, user_id)
    if member.deactivated_at is not None:
        raise Invalid("Turn their access back on first")
    if member.role in (WorkspaceRole.guest, WorkspaceRole.limited):
        raise Invalid("Make them a member or admin first; guests and limited members can't own the workspace")
    if user.auth_uid is None:
        raise Invalid("They need to have signed in at least once before they can own the workspace")
    me = db.get(WorkspaceMember, (access.workspace_id, access.user_id))
    me.role = WorkspaceRole.admin
    member.role = WorkspaceRole.owner
    db.flush()
    audit.record(db, access.workspace_id, access.user_id, "workspace.ownership_transferred", "person", user_id, _name(user))


# --- sign-in rules --------------------------------------------------------------------------------------------------


def sign_in_rules(db: Session, access: Access) -> s.SignInRules:
    ws = db.get(Workspace, access.workspace_id)
    return s.SignInRules(allowed_email_domains=ws.allowed_email_domains or [], allow_outside_guests=ws.allow_outside_guests,
                         require_google_sign_in=ws.require_google_sign_in, require_two_step=ws.require_two_step)


def save_sign_in_rules(db: Session, access: Access, rules: s.SignInRules) -> Tuple[s.SignInRules, List[str]]:
    """Save the rules, refusing any that would lock out the admin making the change.

    Returns the rules and the names of people who can no longer get in under them.
    """
    _require_admin(access, "change the sign-in rules")
    ws = db.get(Workspace, access.workspace_id)
    old = sign_in_rules(db, access)
    ws.allowed_email_domains = sorted({d.lstrip("@").lower() for d in rules.allowed_email_domains})
    ws.allow_outside_guests = rules.allow_outside_guests
    ws.require_google_sign_in = rules.require_google_sign_in
    ws.require_two_step = rules.require_two_step
    me = db.get(User, access.user_id)
    mine = sign_in_problem(ws, access.role, me)
    if mine:
        raise Invalid(f"These rules would lock you out: {mine}")
    affected = []
    for member, user in db.execute(select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
                                   .where(WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.deactivated_at.is_(None))):
        if sign_in_problem(ws, member.role, user):
            affected.append(_name(user))
    db.flush()
    audit.record(db, access.workspace_id, access.user_id, "workspace.sign_in_rules", "workspace", access.workspace_id, None,
                 {"from": old.model_dump(), "to": sign_in_rules(db, access).model_dump(), "locked_out": affected[:50]})
    return sign_in_rules(db, access), sorted(affected)


# --- email set-up ------------------------------------------------------------------------------------------------------


def email_status() -> s.EmailStatus:
    return s.EmailStatus(configured=bool(settings.SMTP_HOST), host=settings.SMTP_HOST, sender=settings.SMTP_FROM or settings.SMTP_USER)


def send_test_email(db: Session, access: Access) -> None:
    from app.services.work.dashboards.reports import EmailNotConfigured, send_email

    _require_admin(access, "test email")
    me = db.get(User, access.user_id)
    try:
        send_email([me.email], "Verve Workflow test email",
                   "<p>This is a test from Verve Workflow. If you can read this, invitations, reports and reminders will reach people.</p>")
    except EmailNotConfigured:
        raise Invalid("Email isn't set up on the server. Add SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM to backend/.env and restart.")
    except Exception as exc:  # noqa: BLE001
        raise Invalid(f"The email server refused the message: {exc}")


# --- profile photos -----------------------------------------------------------------------------------------------------

AVATAR_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAX_AVATAR = 2 * 1024 * 1024


def avatar_dir() -> str:
    path = os.path.join(settings.UPLOAD_DIR, "avatars")
    os.makedirs(path, exist_ok=True)
    return path


def _looks_like(content: bytes, kind: str) -> bool:
    return (kind == "png" and content.startswith(b"\x89PNG")) or (kind == "jpg" and content.startswith(b"\xff\xd8")) or \
        (kind == "webp" and content[:4] == b"RIFF" and content[8:12] == b"WEBP")


def set_avatar(db: Session, access: Access, user_id: str, content: bytes, content_type: str) -> User:
    """People set their own photo; admins can set anyone's."""
    if user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("You can only change your own photo")
    _, user = _member(db, access, user_id)
    kind = AVATAR_TYPES.get(content_type)
    if kind is None or not _looks_like(content, kind):
        raise Invalid("Use a PNG, JPG or WebP image")
    if len(content) > MAX_AVATAR:
        raise Invalid("The photo must be 2 MB or smaller")
    old = user.avatar_key
    key = f"{secrets.token_urlsafe(24)}.{kind}"
    with open(os.path.join(avatar_dir(), key), "wb") as fh:
        fh.write(content)
    user.avatar_key = key
    db.flush()
    if old:
        try:
            os.remove(os.path.join(avatar_dir(), old))
        except OSError:
            pass
    return user


def remove_avatar(db: Session, access: Access, user_id: str) -> None:
    if user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("You can only change your own photo")
    _, user = _member(db, access, user_id)
    if user.avatar_key:
        try:
            os.remove(os.path.join(avatar_dir(), user.avatar_key))
        except OSError:
            pass
        user.avatar_key = None
        db.flush()
