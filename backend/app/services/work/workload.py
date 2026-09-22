"""Workload: each person's scheduled effort per day against their capacity.

Available on a Space, Folder or List, like ClickUp's Workload view.

Follows ClickUp's Workload view:
  * a task's time estimate is divided evenly across the working days between its start
    and due dates (8h from Monday to Tuesday is 4h on each day);
  * a task with only one date puts all its effort on that day;
  * a task assigned to several people counts in full in each person's row;
  * capacity comes from the work schedule: 8h on Monday to Friday, none at weekends;
  * only open work (not started or active) is scheduled.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    Space,
    Status,
    Task,
    TaskAssignee,
    TeamMember,
    User,
    WorkspaceMember,
)
from app.schemas import work as s
from app.services.work.access import Access, Opened, chain_for_folder, chain_for_list, chain_for_space
from app.services.work.permissions import Node
from app.services.work.errors import Invalid
from app.services.work.statuses import OPEN_GROUPS
from app.services.work.tasks import TaskFilter, visible_lists, visible_tasks
from app.services.work.teams import team_or_404

WORKDAY_SECONDS = 8 * 3600
WORKING_WEEKDAYS = {0, 1, 2, 3, 4}  # Monday to Friday
MAX_DAYS = 62
_LIST_LIMIT = 50


def capacity_for(day: date) -> int:
    return WORKDAY_SECONDS if day.weekday() in WORKING_WEEKDAYS else 0


def spread(estimate: int, first: date, last: date) -> Dict[date, int]:
    """Divide an estimate evenly over the working days in [first, last].

    If the span has no working days at all, it is divided over every day in it, so the
    effort still shows up (on zero-capacity days) instead of vanishing.
    """
    if last < first:
        first, last = last, first
    span = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    days = [d for d in span if d.weekday() in WORKING_WEEKDAYS] or span
    share, remainder = divmod(estimate, len(days))
    # Hand leftover seconds to the earliest days so the total is exact.
    return {d: share + (1 if i < remainder else 0) for i, d in enumerate(days)}


def _local_date(value: datetime, tz: timezone) -> date:
    return value.astimezone(tz).date()


def _summary(task: Task, statuses: Dict[uuid.UUID, Status]) -> s.TaskSummary:
    return s.TaskSummary(
        id=task.id,
        name=task.name,
        list_id=task.list_id,
        due_date=task.due_date,
        status=s.StatusOut.model_validate(statuses[task.status_id]),
    )


def _chain_for(db: Session, location) -> List[Node]:
    if isinstance(location, Space):
        return chain_for_space(location)
    if isinstance(location, Folder):
        return chain_for_folder(db, location)
    return chain_for_list(db, location)


def _people_who_can_see(db: Session, location, workspace_id: uuid.UUID) -> List[User]:
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace_id)
        .order_by(User.email)
    ).all()
    chain = _chain_for(db, location)
    people = []
    for member, user in rows:
        viewer = Access(db, user.id, workspace_id, member.role)
        if viewer.level(chain) is not None:
            people.append(user)
    return people


def workload(
    db: Session,
    opened: Opened,
    start: date,
    days: int,
    tz_offset_minutes: int,
    team_id: Optional[uuid.UUID] = None,
) -> s.WorkloadOut:
    location = opened.obj
    if not 1 <= days <= MAX_DAYS:
        raise Invalid(f"days must be between 1 and {MAX_DAYS}")

    # The viewer's timezone, so "Monday" means the viewer's Monday.
    tz = timezone(timedelta(minutes=-tz_offset_minutes))
    window = [start + timedelta(days=i) for i in range(days)]
    window_start = datetime.combine(start, time.min, tz)
    window_end = datetime.combine(window[-1] + timedelta(days=1), time.min, tz)

    tasks, _, groups = visible_tasks(db, opened.access, visible_lists(db, opened), TaskFilter())
    open_tasks = [t for t in tasks if groups[t.id] in OPEN_GROUPS]
    statuses = {
        st.id: st for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in open_tasks})))
    } if open_tasks else {}

    assignees: Dict[uuid.UUID, List[str]] = {}
    if open_tasks:
        for task_id, user_id in db.execute(
            select(TaskAssignee.task_id, TaskAssignee.user_id).where(
                TaskAssignee.task_id.in_([t.id for t in open_tasks])
            )
        ):
            assignees.setdefault(task_id, []).append(user_id)

    # Who gets a row: everyone who can see this location, or one Team's members.
    people = _people_who_can_see(db, location, opened.access.workspace_id)
    team_members: Optional[Set[str]] = None
    if team_id is not None:
        team = team_or_404(db, opened.access, team_id)
        team_members = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team.id)))
        people = [p for p in people if p.id in team_members]
    rows: Dict[Optional[str], Tuple[Optional[User], List[int], List[s.WorkloadTask]]] = {
        p.id: (p, [0] * days, []) for p in people
    }

    unscheduled: List[Task] = []
    no_estimate: List[Task] = []
    for task in open_tasks:
        who = assignees.get(task.id) or [None]
        if team_members is not None:
            who = [uid for uid in who if uid in team_members]
            if not who:
                continue
        begins = task.start_date or task.due_date
        ends = task.due_date or task.start_date
        if begins is None or ends is None:
            unscheduled.append(task)
            continue
        if begins >= window_end or ends < window_start:
            continue  # entirely outside the window
        first, last = _local_date(begins, tz), _local_date(ends, tz)
        if task.time_estimate_seconds is None:
            no_estimate.append(task)
            continue
        per_day = spread(task.time_estimate_seconds, first, last)
        seconds = [per_day.get(d, 0) for d in window]
        if not any(seconds):
            continue
        entry = s.WorkloadTask(
            id=task.id,
            name=task.name,
            list_id=task.list_id,
            status=s.StatusOut.model_validate(statuses[task.status_id]),
            seconds_per_day=seconds,
        )
        for uid in who:
            if uid not in rows:
                if uid is None:
                    rows[None] = (None, [0] * days, [])
                else:
                    continue  # assignee who cannot see this location
            _, scheduled, row_tasks = rows[uid]
            for i, value in enumerate(seconds):
                scheduled[i] += value
            row_tasks.append(entry)

    capacity = [capacity_for(d) for d in window]
    out_rows = [
        s.WorkloadRow(
            user=s.UserOut.model_validate(user) if user else None,
            capacity_seconds=capacity if user else [0] * days,
            scheduled_seconds=scheduled,
            tasks=row_tasks,
        )
        for user, scheduled, row_tasks in rows.values()
    ]
    # People first, alphabetically; unassigned work last.
    out_rows.sort(key=lambda r: (r.user is None, (r.user.display_name or r.user.email).lower() if r.user else ""))

    def sort_key(t: Task):
        return (t.due_date or datetime.max.replace(tzinfo=timezone.utc), t.name.lower())

    return s.WorkloadOut(
        days=[d.isoformat() for d in window],
        rows=out_rows,
        unscheduled=[_summary(t, statuses) for t in sorted(unscheduled, key=sort_key)[:_LIST_LIMIT]],
        no_estimate=[_summary(t, statuses) for t in sorted(no_estimate, key=sort_key)[:_LIST_LIMIT]],
    )
