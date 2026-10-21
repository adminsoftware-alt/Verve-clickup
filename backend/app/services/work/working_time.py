"""How much time each person actually has: their working hours, less the days the company is shut.

This is what Workload, the timesheets and the capacity cards on every Dashboard divide by, so it
is load-bearing in eleven places. It used to live in the leave module because approved leave was
a third subtraction; with leave gone the sum is simpler, and holidays -- which were never leave --
kept the maths that depends on them.
"""

import uuid
from datetime import date
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Holiday, MemberCapacity, Team, TeamMember, User, WorkspaceMember
from app.schemas import work as s
from app.schemas import working_time as wt
from app.services.work import audit
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace


def _require_admin(access: Access, what: str) -> None:
    # The role, not the Access: passed the whole Access this was never true, so nobody --
    # admins included -- could change a holiday.
    if not can_manage_workspace(access.role):
        raise Forbidden(f"Only an admin can {what}")


# --- the holiday calendar ------------------------------------------------------------------------------


def holidays(db: Session, access: Access, year: Optional[int] = None) -> List[Holiday]:
    query = select(Holiday).where(Holiday.workspace_id == access.workspace_id)
    if year:
        query = query.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    return list(db.scalars(query.order_by(Holiday.day)))


def add_holiday(db: Session, access: Access, data: wt.HolidayIn) -> Holiday:
    _require_admin(access, "change holidays")
    if db.scalars(select(Holiday).where(Holiday.workspace_id == access.workspace_id, Holiday.day == data.day)).first():
        raise Invalid(f"{data.day.isoformat()} is already a holiday")
    row = Holiday(workspace_id=access.workspace_id, day=data.day, name=data.name)
    db.add(row)
    db.flush()
    return row


def remove_holiday(db: Session, access: Access, holiday_id: uuid.UUID) -> None:
    _require_admin(access, "change holidays")
    row = db.get(Holiday, holiday_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Holiday not found")
    db.delete(row)
    db.flush()


# --- capacity -------------------------------------------------------------------------------------------


Hours = Tuple[List[int], str, Optional[Team]]


def weekly_hours(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str]) -> Dict[str, Hours]:
    """Each person's working week (seconds per weekday, Monday first), and where it comes from.

    Three layers, the most specific winning: hours an admin set for the person, then the hours of a
    Team they are in, then the company's week. Someone in two Teams with different weeks takes the
    more specific Team -- a sub-team over its parent -- and between equals the first by name; an
    admin who wants otherwise gives that person their own hours.
    """
    from app.services.work.timesheets import settings_row

    ids = list(dict.fromkeys(user_ids))
    if not ids:
        return {}
    company = list(settings_row(db, workspace_id).capacity_seconds)
    own = {
        row.user_id: list(row.capacity_seconds)
        for row in db.scalars(select(MemberCapacity).where(
            MemberCapacity.workspace_id == workspace_id, MemberCapacity.user_id.in_(ids)))
    }
    out: Dict[str, Hours] = {uid: (own[uid], "person", None) for uid in ids if uid in own}
    rest = [uid for uid in ids if uid not in own]
    teams = {t.id: t for t in db.scalars(select(Team).where(Team.workspace_id == workspace_id))} if rest else {}
    if any(t.capacity_seconds for t in teams.values()):
        def lineage(team_id: uuid.UUID) -> List[Team]:
            """The Team and the Teams above it, nearest first."""
            chain: List[Team] = []
            while team_id in teams and all(t.id != team_id for t in chain):
                chain.append(teams[team_id])
                team_id = teams[team_id].parent_team_id
            return chain

        member_of: Dict[str, List[uuid.UUID]] = {}
        for team_id, uid in db.execute(select(TeamMember.team_id, TeamMember.user_id).where(
                TeamMember.user_id.in_(rest), TeamMember.team_id.in_(list(teams)))):
            member_of.setdefault(uid, []).append(team_id)
        for uid in rest:
            # A sub-team's people are the parent Team's people too, so a parent's week reaches them.
            # Ranked by how deep the Team sits (deeper is more specific), then by name.
            ranked = sorted(
                ((len(lineage(t.id)), t) for tid in member_of.get(uid, []) for t in lineage(tid) if t.capacity_seconds),
                key=lambda pair: (-pair[0], pair[1].name.lower()),
            )
            if ranked:
                pick = ranked[0][1]
                out[uid] = (list(pick.capacity_seconds or []), "team", pick)
    for uid in ids:
        out.setdefault(uid, (company, "company", None))
    return out


def working_weekdays(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str]) -> Dict[str, Set[int]]:
    """The weekdays (0 = Monday) each person works: the days their week gives any hours to."""
    return {uid: {i for i, sec in enumerate(hours[0]) if sec} for uid, hours in weekly_hours(db, workspace_id, user_ids).items()}


def _weekly(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str]) -> Dict[str, List[int]]:
    return {uid: hours[0] for uid, hours in weekly_hours(db, workspace_id, user_ids).items()}


def holiday_days(db: Session, workspace_id: uuid.UUID, first: date, last: date) -> Dict[date, str]:
    """Every shut day in the span, by date, so a caller can say why a day is empty."""
    return {
        h.day: h.name
        for h in db.scalars(select(Holiday).where(
            Holiday.workspace_id == workspace_id, Holiday.day >= first, Holiday.day <= last))
    }


def daily_capacity(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str],
                   days: Sequence[date]) -> Dict[str, List[int]]:
    """Seconds each person is available per day: their working hours, minus company holidays."""
    ids = list(dict.fromkeys(user_ids))
    if not ids or not days:
        return {uid: [0] * len(days) for uid in ids}
    weekly = _weekly(db, workspace_id, ids)
    off = holiday_days(db, workspace_id, min(days), max(days))
    return {
        uid: [0 if d in off else weekly[uid][d.weekday()] for d in days]
        for uid in ids
    }


# --- setting working hours (admins) ---------------------------------------------------------------------


def overview(db: Session, access: Access) -> wt.WorkingHoursOut:
    """Everyone's week, every Team's, and the company's: the admin's Working hours screen."""
    from app.services.work.timesheets import settings_row

    _require_admin(access, "see everyone's working hours")
    ws = access.workspace_id
    rows = db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == ws, WorkspaceMember.deactivated_at.is_(None))
    ).all()
    teams = list(db.scalars(select(Team).where(Team.workspace_id == ws).order_by(func.lower(Team.name))))
    names = {t.id: t.name for t in teams}
    team_names: Dict[str, List[str]] = {}
    counts: Dict[uuid.UUID, int] = {}
    for team_id, uid in db.execute(select(TeamMember.team_id, TeamMember.user_id).where(TeamMember.team_id.in_(list(names)))):
        team_names.setdefault(uid, []).append(names[team_id])
        counts[team_id] = counts.get(team_id, 0) + 1
    hours = weekly_hours(db, ws, [user.id for _, user in rows])
    people = []
    for member, user in sorted(rows, key=lambda r: (r[1].display_name or r[1].email).lower()):
        seconds, source, team = hours[user.id]
        people.append(wt.PersonHoursOut(
            user=s.UserOut.model_validate(user), designation=member.designation,
            teams=sorted(team_names.get(user.id, []), key=str.lower), capacity_seconds=seconds, source=source,
            team_id=team.id if team else None, team_name=team.name if team else None,
        ))
    return wt.WorkingHoursOut(
        company=list(settings_row(db, ws).capacity_seconds),
        teams=[
            wt.TeamHoursOut(id=t.id, name=t.name, color=t.color, member_count=counts.get(t.id, 0),
                            capacity_seconds=list(t.capacity_seconds) if t.capacity_seconds else None)
            for t in teams
        ],
        people=people,
    )


def _week_label(seconds: Optional[List[int]]) -> str:
    """"6 days, 48h a week", for the audit log."""
    if seconds is None:
        return "back to the default"
    days = sum(1 for x in seconds if x)
    return f"{days} days, {round(sum(seconds) / 3600, 1):g}h a week"


def set_company_hours(db: Session, access: Access, data: wt.CompanyHoursIn) -> wt.WorkingHoursOut:
    from app.services.work.timesheets import settings_row

    _require_admin(access, "set the company's working hours")
    row = settings_row(db, access.workspace_id)
    row.capacity_seconds = list(data.capacity_seconds)
    db.add(row)
    audit.record(db, access.workspace_id, access.user_id, "hours.company", "workspace", access.workspace_id,
                 f"Company: {_week_label(row.capacity_seconds)}")
    return overview(db, access)


def set_team_hours(db: Session, access: Access, team_id: uuid.UUID, data: wt.HoursIn) -> wt.WorkingHoursOut:
    _require_admin(access, "set a Team's working hours")
    team = db.get(Team, team_id)
    if team is None or team.workspace_id != access.workspace_id:
        raise NotFound("Team not found")
    team.capacity_seconds = list(data.capacity_seconds) if data.capacity_seconds is not None else None
    audit.record(db, access.workspace_id, access.user_id, "hours.team", "team", team.id,
                 f"{team.name}: {_week_label(team.capacity_seconds)}")
    return overview(db, access)


def set_people_hours(db: Session, access: Access, data: wt.PeopleHoursIn) -> wt.WorkingHoursOut:
    """Give one or many people their own week, or (None) put them back on their Team's or the company's."""
    _require_admin(access, "set people's working hours")
    ids = list(dict.fromkeys(data.user_ids))
    members = set(db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.user_id.in_(ids))))
    if any(uid not in members for uid in ids):
        raise NotFound("Some of those people are not in this workspace")
    week = list(data.capacity_seconds) if data.capacity_seconds is not None else None
    existing = {r.user_id: r for r in db.scalars(select(MemberCapacity).where(
        MemberCapacity.workspace_id == access.workspace_id, MemberCapacity.user_id.in_(ids)))}
    for uid in ids:
        row = existing.get(uid)
        if week is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(MemberCapacity(workspace_id=access.workspace_id, user_id=uid, capacity_seconds=week))
        else:
            row.capacity_seconds = week
    db.flush()
    who = audit.person_label(db, ids[0]) if len(ids) == 1 else f"{len(ids)} people"
    audit.record(db, access.workspace_id, access.user_id, "hours.people", "member",
                 ids[0] if len(ids) == 1 else None, f"{who}: {_week_label(week)}")
    return overview(db, access)
