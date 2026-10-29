"""Other people's own Dashboards, for those who look after them.

An admin sees everyone's "My work" board; a Team lead sees their Team's. That was already the rule
(dashboards/access.py gives them view on those boards), but a board only existed once its owner had
opened the app -- so the person an admin most wanted to look at, the one who never signs in, had
nothing to show. This makes the board on first look, exactly as its owner would get it, and lists
the people whose boards the viewer may open with the few figures that say whom to look at first.
"""

import uuid
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Dashboard, Space, Status, StatusGroup, Task, TaskAssignee, TaskList, Team, TeamMember, User, WorkspaceMember, WorkspaceRole,
)
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.dashboards import standard
from app.services.work.dashboards.access import OpenedDashboard, Standing, open_dashboard
from app.services.work.errors import Forbidden, NotFound

OPEN = (StatusGroup.not_started, StatusGroup.active)


def _whose(db: Session, access: Access) -> Optional[set]:
    """Whose boards the viewer may open: None for everyone (admins), else their Teams' people."""
    standing = Standing.load(db, access)
    if standing.is_admin:
        return None
    if not standing.led_people:
        raise Forbidden("Only admins and Team leads can open other people's Dashboards")
    return standing.led_people - {access.user_id}


def people(db: Session, access: Access, tz_name: str = "UTC") -> List[Dict[str, Any]]:
    """Everyone whose own Dashboard the viewer may open, with what is open, late and due today."""
    allowed = _whose(db, access)
    members = db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == access.workspace_id,
            WorkspaceMember.deactivated_at.is_(None),
            # Owners and admins have no board of their own -- the Company one is theirs -- and
            # guests have none at all.
            WorkspaceMember.role.in_([WorkspaceRole.member, WorkspaceRole.limited]),
        )
    ).all()
    members = [(m, u) for m, u in members if allowed is None or u.id in allowed]
    ids = [u.id for _, u in members]
    if not ids:
        return []

    from zoneinfo import ZoneInfo

    try:
        zone = ZoneInfo(tz_name)
    except Exception:  # an unknown zone reads as UTC rather than failing the page
        zone = ZoneInfo("UTC")
    today = datetime.now(zone).date()
    start = datetime.combine(today, time(), zone).astimezone(timezone.utc)
    end = start + timedelta(days=1)

    counts = {
        uid: (open_, overdue, due_today)
        for uid, open_, overdue, due_today in db.execute(
            select(
                TaskAssignee.user_id,
                func.count(Task.id),
                func.sum(case((Task.due_date < start, 1), else_=0)),
                func.sum(case((and_(Task.due_date >= start, Task.due_date < end), 1), else_=0)),
            )
            .join(Task, Task.id == TaskAssignee.task_id)
            .join(Status, Status.id == Task.status_id)
            .join(TaskList, TaskList.id == Task.list_id)
            .join(Space, Space.id == TaskList.space_id)
            .where(
                TaskAssignee.user_id.in_(ids),
                Space.workspace_id == access.workspace_id,
                Status.group.in_(OPEN),
                Task.archived_at.is_(None),
            )
            .group_by(TaskAssignee.user_id)
        )
    }
    teams: Dict[str, List[str]] = {}
    for uid, name in db.execute(
        select(TeamMember.user_id, Team.name).join(Team, Team.id == TeamMember.team_id)
        .where(Team.workspace_id == access.workspace_id, TeamMember.user_id.in_(ids))
    ):
        teams.setdefault(uid, []).append(name)
    boards = {
        owner: dash_id for owner, dash_id in db.execute(
            select(Dashboard.owner_id, Dashboard.id).where(
                Dashboard.workspace_id == access.workspace_id, Dashboard.standard == standard.MY_WORK,
                Dashboard.owner_id.in_(ids),
            )
        )
    }
    out = []
    for member, user in members:
        open_, overdue, due_today = counts.get(user.id, (0, 0, 0))
        out.append({
            "user": s.UserOut.model_validate(user).model_dump(mode="json"),
            "designation": member.designation,
            "department": member.department,
            "teams": sorted(teams.get(user.id, [])),
            "pending": user.auth_uid is None,
            "open": int(open_ or 0),
            "overdue": int(overdue or 0),
            "due_today": int(due_today or 0),
            "dashboard_id": str(boards[user.id]) if user.id in boards else None,
        })
    out.sort(key=lambda r: (r["user"]["display_name"] or r["user"]["email"]).lower())
    return out


def week(db: Session, access: Access, tz_name: str = "UTC") -> Dict[str, Dict[str, int]]:
    """This week's hours for everyone in people(), asked for on its own: it reads every open task
    in reach, which is the slow part, so the cards show first and the hours fill in after."""
    from zoneinfo import ZoneInfo

    allowed = _whose(db, access)
    ids = [uid for uid in db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == access.workspace_id,
        WorkspaceMember.deactivated_at.is_(None),
        WorkspaceMember.role.in_([WorkspaceRole.member, WorkspaceRole.limited]),
    )) if allowed is None or uid in allowed]
    if not ids:
        return {}
    try:
        zone = ZoneInfo(tz_name)
    except Exception:
        zone = ZoneInfo("UTC")
    return _this_week(db, access, zone, ids)


def _this_week(db: Session, access: Access, zone, ids: List[str]) -> Dict[str, Dict[str, int]]:
    """Each person's week in seconds: hours they can work, hours of open work planned into it
    (estimates spread over their working days, as Workload does) and hours logged so far. A
    Manager reads "who is free" off the gap between the first two."""
    from app.db.models import TimeEntry
    from app.services.work.dashboards.engine import FINISHED, Engine
    from app.services.work.workload import spread
    from app.schemas import dashboards as d

    engine = Engine(db, access, zone, scope=ids)
    config = d.CardConfig()
    open_facts = [f for f in engine.matching(config, engine.load(config)) if f.group not in FINISHED]
    week_start = engine.today - timedelta(days=engine.today.weekday())
    week_end = week_start + timedelta(days=6)
    capacity = engine.daily_capacity(ids, [week_start + timedelta(days=i) for i in range(7)])
    weekdays = engine.working_weekdays(ids)
    planned: Dict[str, int] = {uid: 0 for uid in ids}
    for f in open_facts:
        begins = f.task.start_date or f.task.due_date
        ends = f.task.due_date or f.task.start_date
        if not f.task.time_estimate_seconds or begins is None or ends is None:
            continue
        for uid in f.assignees:
            if uid in planned:
                per_day = spread(f.task.time_estimate_seconds, engine._local_day(begins), engine._local_day(ends), weekdays.get(uid))
                planned[uid] += sum(v for day, v in per_day.items() if week_start <= day <= week_end)
    logged = dict(db.execute(
        select(TimeEntry.user_id, func.coalesce(func.sum(TimeEntry.duration_seconds), 0))
        .where(TimeEntry.user_id.in_(ids), TimeEntry.started_at >= engine._at(week_start))
        .group_by(TimeEntry.user_id)
    ).all())
    return {uid: {"planned": int(planned[uid]), "capacity": int(sum((capacity.get(uid) or [0] * 7)[:7])),
                  "logged": int(logged.get(uid, 0))} for uid in ids}


def team_figures(db: Session, access: Access, tz_name: str = "UTC") -> Dict[str, Dict[str, int]]:
    """Each Team's work at a glance, for the All teams page: open and late tasks (each counted once,
    however many of the Team are on it) and this week's planned hours against what its people can
    work. A sub-team's people count towards its parent, as they do everywhere else. Admins only."""
    from zoneinfo import ZoneInfo

    if not Standing.load(db, access).is_admin:
        raise Forbidden("Only admins see every Team's figures")
    teams = list(db.scalars(select(Team).where(Team.workspace_id == access.workspace_id)))
    direct: Dict[uuid.UUID, set] = {t.id: set() for t in teams}
    for team_id, uid in db.execute(select(TeamMember.team_id, TeamMember.user_id).where(TeamMember.team_id.in_(list(direct)))):
        direct[team_id].add(uid)
    kids: Dict[uuid.UUID, List[uuid.UUID]] = {}
    for t in teams:
        if t.parent_team_id in direct:
            kids.setdefault(t.parent_team_id, []).append(t.id)

    def everyone(team_id: uuid.UUID, seen: Optional[set] = None) -> set:
        seen = seen or set()
        if team_id in seen:
            return set()
        seen.add(team_id)
        out = set(direct[team_id])
        for k in kids.get(team_id, []):
            out |= everyone(k, seen)
        return out

    crew = {t.id: everyone(t.id) for t in teams}
    ids = sorted(set().union(*crew.values())) if crew else []
    try:
        zone = ZoneInfo(tz_name)
    except Exception:
        zone = ZoneInfo("UTC")
    start = datetime.combine(datetime.now(zone).date(), time(), zone).astimezone(timezone.utc)
    work: Dict[str, List] = {}
    if ids:
        for uid, task_id, due in db.execute(
            select(TaskAssignee.user_id, Task.id, Task.due_date)
            .join(Task, Task.id == TaskAssignee.task_id)
            .join(Status, Status.id == Task.status_id)
            .join(TaskList, TaskList.id == Task.list_id)
            .join(Space, Space.id == TaskList.space_id)
            .where(TaskAssignee.user_id.in_(ids), Space.workspace_id == access.workspace_id,
                   Status.group.in_(OPEN), Task.archived_at.is_(None))
        ):
            work.setdefault(uid, []).append((task_id, due))
    week = _this_week(db, access, zone, ids) if ids else {}
    out: Dict[str, Dict[str, int]] = {}
    for t in teams:
        tasks: Dict[uuid.UUID, Any] = {}
        for uid in crew[t.id]:
            for task_id, due in work.get(uid, []):
                tasks[task_id] = due
        out[str(t.id)] = {
            "open": len(tasks),
            "overdue": sum(1 for due in tasks.values() if due is not None and due < start),
            "planned": sum(week.get(uid, {}).get("planned", 0) for uid in crew[t.id]),
            "capacity": sum(week.get(uid, {}).get("capacity", 0) for uid in crew[t.id]),
        }
    return out


def board_of(db: Session, access: Access, user_id: str) -> OpenedDashboard:
    """Someone's own Dashboard, opened for the viewer -- made now if they have never opened it."""
    allowed = _whose(db, access)
    if allowed is not None and user_id not in allowed:
        raise Forbidden("You can open the Dashboards of your own Team's people")
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    if member is None or member.deactivated_at is not None:
        raise NotFound("Person not found")
    if member.role not in (WorkspaceRole.member, WorkspaceRole.limited):
        raise NotFound("Owners, admins and guests do not have a personal Dashboard")
    found = db.scalars(select(Dashboard).where(
        Dashboard.workspace_id == access.workspace_id, Dashboard.standard == standard.MY_WORK, Dashboard.owner_id == user_id,
    )).first()
    if found is None:
        # Made as theirs, by the same rule that makes it when they first open the app, so what the
        # viewer sees is what the owner will see. Built from the member row rather than through
        # Access.for_workspace, which refuses people who cannot sign in yet -- and those are the
        # very people this is most often wanted for.
        theirs = Access(db, user_id, access.workspace_id, member.role)
        standard.ensure(db, theirs, Standing.load(db, theirs))
        db.flush()
        found = db.scalars(select(Dashboard).where(
            Dashboard.workspace_id == access.workspace_id, Dashboard.standard == standard.MY_WORK, Dashboard.owner_id == user_id,
        )).first()
        if found is None:  # they deleted it on purpose; standard boards are never made twice
            raise NotFound("This person removed their own Dashboard")
    return open_dashboard(db, access.user_id, found.id)
