"""People management, like ClickUp's People page and Org Chart.

Admins add people directly, with their name, designation and reporting manager, without
waiting for them to sign in first; or invite them by email. Either way the person exists
straight away ("pending" until their first sign-in), so they can be put in teams, given
tasks and shared with from day one. The reporting manager builds the Org Chart.
"""

import html
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Team, TeamMember, User, Workspace, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

PROFILE_FIELDS = (
    "designation", "level", "department", "phone", "employee_code", "date_of_joining", "location",
    "date_of_birth", "marriage_anniversary", "takes_interviews",
)
# Who sees what on someone else's profile, as person_out applies it:
#   * a phone number is for everyone inside the firm, and hidden from guests -- see
#     test_limited_members_see_only_what_is_shared, which says so on purpose;
#   * a birthday and an anniversary are the person's and the admins', nobody else's.
# There used to be a PRIVATE_FIELDS tuple here naming all three as admin-only. Nothing read it,
# and it described a rule the code does not follow, which is worse than no note at all.
SELF_EDITABLE = {"name", "phone", "location"}


def _require_admin(access: Access, what: str = "manage people") -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden(f"Only owners and admins can {what}")


def _check_role(access: Access, role: WorkspaceRole) -> None:
    if role == WorkspaceRole.owner:
        raise Invalid("A workspace has exactly one owner")
    if role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
        raise Forbidden("Only the owner can make someone an admin")


# --- reading -----------------------------------------------------------------------------------


def _teams_by_user(db: Session, workspace_id: uuid.UUID) -> Dict[str, List[uuid.UUID]]:
    out: Dict[str, List[uuid.UUID]] = {}
    for team_id, user_id in db.execute(
        select(TeamMember.team_id, TeamMember.user_id).join(Team, Team.id == TeamMember.team_id).where(Team.workspace_id == workspace_id)
    ):
        out.setdefault(user_id, []).append(team_id)
    return out


def person_out(member: WorkspaceMember, user: User, team_ids: Sequence[uuid.UUID], reports: int, hide_contact: bool = False,
               joiner_tasks: int = 0, show_private: bool = True) -> s.PersonOut:
    return s.PersonOut(
        user=s.UserOut.model_validate(user),
        role=member.role,
        joined_at=member.joined_at,
        pending=user.auth_uid is None,
        designation=member.designation,
        level=member.level,
        department=member.department,
        manager_id=member.manager_id,
        phone=None if hide_contact else member.phone,
        employee_code=member.employee_code,
        date_of_joining=member.date_of_joining,
        location=member.location,
        date_of_birth=member.date_of_birth if show_private else None,
        marriage_anniversary=member.marriage_anniversary if show_private else None,
        takes_interviews=member.takes_interviews,
        team_ids=list(team_ids),
        direct_reports=reports,
        invite_sent_at=member.invite_sent_at,
        deactivated_at=member.deactivated_at,
        joiner_tasks=joiner_tasks,
    )


def _joiner_counts(db: Session, workspace_id: uuid.UUID) -> Dict[str, int]:
    from app.db.models import PersonTask

    return dict(db.execute(select(PersonTask.user_id, func.count()).where(PersonTask.workspace_id == workspace_id).group_by(PersonTask.user_id)).all())


def list_people(db: Session, access: Access) -> List[s.PersonOut]:
    rows = list(db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == access.workspace_id)
    ))
    teams = _teams_by_user(db, access.workspace_id)
    reports: Dict[str, int] = {}
    for m, _ in rows:
        if m.manager_id:
            reports[m.manager_id] = reports.get(m.manager_id, 0) + 1
    guest = access.role == WorkspaceRole.guest
    admin = can_manage_workspace(access.role)
    joiner = _joiner_counts(db, access.workspace_id) if admin else {}
    out = [person_out(m, u, teams.get(u.id, []), reports.get(u.id, 0), hide_contact=guest and u.id != access.user_id,
                      joiner_tasks=joiner.get(u.id, 0), show_private=admin or u.id == access.user_id) for m, u in rows]
    return sorted(out, key=lambda p: (p.user.display_name or p.user.email).lower())


def get_person(db: Session, access: Access, user_id: str) -> s.PersonOut:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    user = db.get(User, user_id)
    if member is None or user is None:
        raise NotFound("Person not found")
    reports = db.scalar(select(func.count()).select_from(WorkspaceMember).where(
        WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.manager_id == user_id)) or 0
    admin = can_manage_workspace(access.role)
    return person_out(member, user, _teams_by_user(db, access.workspace_id).get(user_id, []), reports,
                      hide_contact=access.role == WorkspaceRole.guest and user_id != access.user_id,
                      joiner_tasks=_joiner_counts(db, access.workspace_id).get(user_id, 0) if admin else 0,
                      show_private=admin or user_id == access.user_id)


# --- managers and teams ------------------------------------------------------------------------


def _check_manager(db: Session, access: Access, user_id: Optional[str], manager_id: Optional[str]) -> None:
    """The manager must be a member, and the chain must not loop back to this person."""
    if manager_id is None:
        return
    if manager_id == user_id:
        raise Invalid("Someone can't report to themselves")
    managers = {
        m.user_id: m.manager_id
        for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == access.workspace_id))
    }
    if manager_id not in managers:
        raise Invalid("The reporting manager must be a member of the workspace")
    seen: Set[str] = set()
    step: Optional[str] = manager_id
    while step is not None and step not in seen:
        if step == user_id:
            raise Invalid("That would make a reporting loop")
        seen.add(step)
        step = managers.get(step)


def _set_teams(db: Session, access: Access, user_id: str, team_ids: Sequence[uuid.UUID]) -> None:
    wanted = set(team_ids)
    valid = set(db.scalars(select(Team.id).where(Team.workspace_id == access.workspace_id, Team.id.in_(wanted)))) if wanted else set()
    if wanted - valid:
        raise Invalid("Unknown team")
    current = {
        row.team_id: row for row in db.scalars(
            select(TeamMember).join(Team, Team.id == TeamMember.team_id)
            .where(Team.workspace_id == access.workspace_id, TeamMember.user_id == user_id)
        )
    }
    for team_id, row in current.items():
        if team_id not in wanted:
            db.delete(row)
    for team_id in wanted - set(current):
        db.add(TeamMember(team_id=team_id, user_id=user_id))
    db.flush()


# --- adding and inviting -----------------------------------------------------------------------


def _find_or_create_user(db: Session, email: str, name: Optional[str]) -> User:
    email = email.strip().lower()
    user = db.scalars(select(User).where(func.lower(User.email) == email).order_by(User.created_at)).first()
    if user is None:
        user = User(
            id=f"pending-{uuid.uuid4().hex}", auth_uid=None, email=email,
            display_name=(name or email.split("@")[0]).strip(), name_from_profile=bool(name),
        )
        db.add(user)
        db.flush()
    elif name and user.auth_uid is None:
        # Still pending: the admin's details are the best we have.
        user.display_name, user.name_from_profile = name.strip(), True
    return user


def add_person(db: Session, access: Access, data: s.PersonCreate) -> Tuple[WorkspaceMember, User]:
    from app.services.work.people_admin import check_not_blocked

    _require_admin(access, "add people")
    _check_role(access, data.role)
    check_domain(db, access.workspace_id, data.email, data.role)
    check_not_blocked(db, access.workspace_id, data.email)
    user = _find_or_create_user(db, data.email, data.name)
    if db.get(WorkspaceMember, (access.workspace_id, user.id)) is not None:
        raise Invalid(f"{data.email} is already in this workspace")
    _check_manager(db, access, user.id, data.manager_id)
    member = WorkspaceMember(
        workspace_id=access.workspace_id, user_id=user.id, role=data.role, manager_id=data.manager_id, added_by=access.user_id,
        **{f: getattr(data, f) for f in PROFILE_FIELDS},
    )
    db.add(member)
    db.flush()
    if data.team_ids:
        _set_teams(db, access, user.id, data.team_ids)
    from app.services.work import audit

    audit.record(db, access.workspace_id, access.user_id, "person.added", "person", user.id, user.display_name or user.email,
                 {"role": data.role.value, "designation": data.designation})
    return member, user


def update_person(db: Session, access: Access, user_id: str, data: s.PersonUpdate) -> None:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    user = db.get(User, user_id)
    if member is None or user is None:
        raise NotFound("Person not found")
    fields = data.model_fields_set
    is_admin = can_manage_workspace(access.role)
    if not is_admin:
        if user_id != access.user_id or not fields <= SELF_EDITABLE:
            raise Forbidden("Only owners and admins can change this")
    if "name" in fields and data.name:
        user.display_name, user.name_from_profile = data.name.strip(), True
    if "email" in fields and data.email:
        if user.auth_uid is not None:
            raise Invalid("The email of someone who has signed in comes from their Google account")
        clash = db.scalars(select(User).where(func.lower(User.email) == data.email.lower(), User.id != user.id)).first()
        if clash is not None:
            raise Invalid("Someone else already uses that email")
        user.email = data.email.strip().lower()
    for f in PROFILE_FIELDS:
        if f in fields:
            setattr(member, f, getattr(data, f))
    if "manager_id" in fields:
        _check_manager(db, access, user_id, data.manager_id)
        member.manager_id = data.manager_id
    if "role" in fields and data.role is not None and data.role != member.role:
        if member.role == WorkspaceRole.owner:
            raise Invalid("The owner's role can't be changed")
        if member.role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
            raise Forbidden("Only the owner can change an admin")
        _check_role(access, data.role)
        check_domain(db, access.workspace_id, user.email, data.role)
        from app.services.work import audit

        audit.record(db, access.workspace_id, access.user_id, "person.role_changed", "person", user_id, user.display_name or user.email,
                     {"from": member.role.value, "to": data.role.value})
        member.role = data.role
    if "team_ids" in fields and data.team_ids is not None:
        _set_teams(db, access, user_id, data.team_ids)
    changed = sorted(f for f in fields if f not in ("role",))
    if changed and is_admin and user_id != access.user_id:
        from app.services.work import audit

        audit.record(db, access.workspace_id, access.user_id, "person.updated", "person", user_id, user.display_name or user.email,
                     {"fields": changed})
    db.flush()


def check_domain(db: Session, workspace_id: uuid.UUID, email: str, role: WorkspaceRole) -> None:
    """Refuse to add people from outside the workspace's allowed email domains."""
    from app.services.work.access import email_domain

    ws = db.get(Workspace, workspace_id)
    domains = [d.lower().lstrip("@") for d in (ws.allowed_email_domains or [])] if ws else []
    if domains and not (role == WorkspaceRole.guest and ws.allow_outside_guests) and email_domain(email) not in domains:
        raise Invalid(f"{email} is outside the allowed domains ({', '.join('@' + d for d in domains)})")


def clear_reports_to(db: Session, workspace_id: uuid.UUID, user_id: str) -> None:
    """People who reported to someone who leaves no longer have a manager."""
    db.execute(
        update(WorkspaceMember)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.manager_id == user_id)
        .values(manager_id=None)
    )


# --- email invitations -------------------------------------------------------------------------


def invite_link() -> str:
    return f"{settings.APP_URL.rstrip('/')}/login"


def _invite_html(workspace: Workspace, inviter: Optional[User], person: User, member: WorkspaceMember, note: Optional[str]) -> str:
    esc = html.escape
    who = esc(inviter.display_name or inviter.email) if inviter else "Your team"
    role = f" as <b>{esc(member.designation)}</b>" if member.designation else ""
    extra = f'<p style="margin:12px 0;padding:10px 12px;background:#f5f6f8;border-radius:8px">{esc(note)}</p>' if note else ""
    return (
        '<div style="font-family:Segoe UI,Arial,sans-serif;background:#f5f6f8;padding:24px 12px">'
        '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">'
        f'<h1 style="font-size:20px;color:#111827;margin:0 0 12px">You\'re invited to {esc(workspace.name)} on Verve Workflow</h1>'
        f'<p style="color:#374151;font-size:14px">Hi {esc(person.display_name or person.email)},</p>'
        f'<p style="color:#374151;font-size:14px">{who} has added you to <b>{esc(workspace.name)}</b>{role}.</p>'
        f"{extra}"
        f'<p style="color:#374151;font-size:14px">Sign in with Google using <b>{esc(person.email)}</b> and your tasks and teams will be waiting.</p>'
        f'<p style="margin:20px 0"><a href="{esc(invite_link())}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Open Verve Workflow</a></p>'
        '</div></div>'
    )


def send_invite(db: Session, access: Access, user_id: str, note: Optional[str] = None) -> Tuple[bool, Optional[str]]:
    """Email someone their invitation. Returns (sent, reason it wasn't)."""
    from app.services.work.dashboards.reports import EmailNotConfigured, send_email  # avoids an import cycle

    _require_admin(access, "invite people")
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    user = db.get(User, user_id)
    if member is None or user is None:
        raise NotFound("Person not found")
    workspace = db.get(Workspace, access.workspace_id)
    assert workspace is not None
    try:
        send_email([user.email], f"You're invited to {workspace.name} on Verve Workflow",
                   _invite_html(workspace, db.get(User, access.user_id), user, member, note))
    except EmailNotConfigured:
        return False, "Email isn't set up on the server yet, so no email was sent. Share the sign-in link instead."
    except Exception as exc:  # noqa: BLE001 - any SMTP failure is reported, not raised
        return False, f"The email could not be sent: {exc}"
    member.invite_sent_at = datetime.now(timezone.utc)
    db.flush()
    return True, None


def invite(db: Session, access: Access, data: s.InviteIn) -> s.InviteResult:
    """Invite several people by email: each is added (pending) and emailed."""
    _require_admin(access, "invite people")
    _check_role(access, data.role)
    people: List[s.PersonOut] = []
    problems: List[str] = []
    sent_any, reason = False, None
    for email in dict.fromkeys(e.strip().lower() for e in data.emails):
        try:
            with db.begin_nested():
                member, user = add_person(db, access, s.PersonCreate(email=email, role=data.role, team_ids=data.team_ids))
        except (Invalid, Forbidden) as exc:
            problems.append(f"{email}: {exc.message}")
            continue
        from app.services.work import audit

        audit.record(db, access.workspace_id, access.user_id, "person.invited", "person", user.id, user.email, {"role": data.role.value})
        sent, why = send_invite(db, access, user.id, data.message)
        sent_any = sent_any or sent
        reason = reason or why
        people.append(get_person(db, access, user.id))
    return s.InviteResult(people=people, emailed=sent_any, email_problem=reason, problems=problems, link=invite_link())
