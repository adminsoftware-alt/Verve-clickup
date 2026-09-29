"""Timesheets: a person's tracked time for one week, by task and day, as in ClickUp.

A timesheet is a view over time entries. Editing a cell changes entries:
  * a higher total adds one new entry for the difference (existing entries are kept);
  * a lower total trims the newest entries in that cell (ClickUp leaves this undefined).
Who can see whose timesheet follows the time-visibility rule: your own, your Teams' if
you lead them, everyone's for owners and admins. Only owners and admins change other
people's time. Weeks that are pending approval or approved are locked (timelocks.py).
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Set, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    MemberCapacity,
    PermissionLevel,
    Space,
    Status,
    Task,
    TaskList,
    Team,
    TeamMember,
    TimeEntry,
    TimesheetApprover,
    TimesheetRow,
    TimesheetSettings,
    TimesheetSubmission,
    TimeTag,
    User,
    WorkspaceMember,
    WorkspaceRole,
)
from app.schemas import timesheets as t
from app.schemas import work as s
from app.services.work.access import Access, chain_for_task, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace
from app.services.work.timelocks import LOCKED, ensure_unlocked
from app.services.work.timetracking import tags_for, time_visible_people

DEFAULT_CAPACITY = [8 * 3600] * 5 + [0, 0]  # Monday first
DAY = timedelta(days=1)


def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise Invalid(f"Unknown timezone {name}")


def _at(day: date, tz: ZoneInfo, hour: int = 0) -> datetime:
    return datetime.combine(day, time(hour), tz).astimezone(timezone.utc)


# --- settings and capacity ----------------------------------------------------------------


def settings_row(db: Session, workspace_id: uuid.UUID) -> TimesheetSettings:
    row = db.get(TimesheetSettings, workspace_id)
    if row is None:
        row = TimesheetSettings(workspace_id=workspace_id, week_start=6, approvals_enabled=False, capacity_seconds=list(DEFAULT_CAPACITY))
    return row


def get_settings(db: Session, access: Access) -> t.SettingsOut:
    row = settings_row(db, access.workspace_id)
    return t.SettingsOut(
        week_start=row.week_start, approvals_enabled=row.approvals_enabled,
        capacity_seconds=list(row.capacity_seconds), can_manage=can_manage_workspace(access.role),
        reminders_enabled=row.reminders_enabled if row.reminders_enabled is not None else True,
        reminder_weekday=row.reminder_weekday if row.reminder_weekday is not None else 4,
        reminder_hour=row.reminder_hour if row.reminder_hour is not None else 16,
        reminder_timezone=row.reminder_timezone or "Asia/Kolkata",
    )


def update_settings(db: Session, access: Access, data: t.SettingsIn) -> t.SettingsOut:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can change timesheet settings")
    row = db.get(TimesheetSettings, access.workspace_id)
    if row is None:
        row = settings_row(db, access.workspace_id)
        db.add(row)
    if data.week_start is not None:
        row.week_start = data.week_start
    if data.approvals_enabled is not None:
        row.approvals_enabled = data.approvals_enabled
    if data.capacity_seconds is not None:
        row.capacity_seconds = list(data.capacity_seconds)
    if data.reminder_timezone is not None:
        zone(data.reminder_timezone)
        row.reminder_timezone = data.reminder_timezone
    for name in ("reminders_enabled", "reminder_weekday", "reminder_hour"):
        if getattr(data, name) is not None:
            setattr(row, name, getattr(data, name))
    db.flush()
    return get_settings(db, access)


def capacity_of(db: Session, workspace_id: uuid.UUID, user_id: str) -> Tuple[List[int], bool]:
    """Seconds of capacity per weekday (Monday first), and whether it is the person's own."""
    own = db.get(MemberCapacity, (workspace_id, user_id))
    if own is not None:
        return list(own.capacity_seconds), True
    return list(settings_row(db, workspace_id).capacity_seconds), False


def set_capacity(db: Session, access: Access, user_id: str, data: t.CapacityIn) -> t.CapacityOut:
    # Working hours are what capacity, workload and every "are they over" figure are measured
    # against, so they are set for people rather than by them -- including for the person doing
    # the setting. A manager cannot give themselves a four-hour week any more than anyone else.
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins set working hours")
    _member(db, access, user_id)
    row = db.get(MemberCapacity, (access.workspace_id, user_id))
    if data.capacity_seconds is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(MemberCapacity(workspace_id=access.workspace_id, user_id=user_id, capacity_seconds=list(data.capacity_seconds)))
    else:
        row.capacity_seconds = list(data.capacity_seconds)
    db.flush()
    seconds, custom = capacity_of(db, access.workspace_id, user_id)
    return t.CapacityOut(capacity_seconds=seconds, is_custom=custom)


# --- periods and permissions ---------------------------------------------------------------------


def period_of(db: Session, workspace_id: uuid.UUID, any_day: date) -> Tuple[date, date]:
    week_start = settings_row(db, workspace_id).week_start
    first = any_day - timedelta(days=(any_day.weekday() - week_start) % 7)
    return first, first + timedelta(days=6)


def _member(db: Session, access: Access, user_id: str) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    if member is None:
        raise NotFound("That person is not in this workspace")
    return member


def can_view(db: Session, access: Access, user_id: str) -> bool:
    """Own sheet, Team leads their Teams', admins everyone's, approvers the people they approve."""
    people = time_visible_people(db, access)
    if people is None or user_id in people:
        return True
    return access.user_id in approvers_for(db, access.workspace_id, user_id)


def _require_view(db: Session, access: Access, user_id: str) -> None:
    _member(db, access, user_id)
    if not can_view(db, access, user_id):
        raise NotFound("Timesheet not found")


def _require_edit(db: Session, access: Access, user_id: str) -> None:
    _require_view(db, access, user_id)
    if user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can change someone else's time")


def current_submission(db: Session, workspace_id: uuid.UUID, user_id: str, period_start: date) -> Optional[TimesheetSubmission]:
    return db.scalars(
        select(TimesheetSubmission).where(
            TimesheetSubmission.workspace_id == workspace_id,
            TimesheetSubmission.user_id == user_id,
            TimesheetSubmission.period_start == period_start,
        )
    ).first()


# --- locations -------------------------------------------------------------------------------------


class _Locator:
    """Readable locations for tasks, with caching."""

    def __init__(self, db: Session):
        self.db = db
        self._lists: Dict[uuid.UUID, str] = {}

    def of(self, list_id: uuid.UUID) -> str:
        if list_id not in self._lists:
            lst = self.db.get(TaskList, list_id)
            if lst is None:
                return ""
            parts = [lst.name]
            if lst.folder_id:
                folder = self.db.get(Folder, lst.folder_id)
                if folder is not None:
                    parts.insert(0, folder.name)
            space = self.db.get(Space, lst.space_id)
            if space is not None and space.personal_owner_id is None:
                parts.insert(0, space.name)
            self._lists[list_id] = " / ".join(parts)
        return self._lists[list_id]


# --- the grid ----------------------------------------------------------------------------------------


def _entries(db: Session, workspace_id: uuid.UUID, user_id: str, start: datetime, end: datetime) -> List[Tuple[TimeEntry, Task]]:
    return list(
        db.execute(
            select(TimeEntry, Task)
            .join(Task, Task.id == TimeEntry.task_id)
            .join(TaskList, TaskList.id == Task.list_id)
            .join(Space, Space.id == TaskList.space_id)
            .where(
                Space.workspace_id == workspace_id,
                TimeEntry.user_id == user_id,
                TimeEntry.started_at >= start,
                TimeEntry.started_at < end,
            )
            .order_by(TimeEntry.started_at)
        ).all()
    )


def timesheet(
    db: Session,
    access: Access,
    user_id: str,
    any_day: date,
    tz: ZoneInfo,
    billable: str = "all",
    tag_ids: Sequence[uuid.UUID] = (),
    include_archived: bool = False,
    tracked_op: Optional[str] = None,
    tracked_seconds: Optional[int] = None,
    sort: str = "date_added",
    descending: bool = False,
) -> t.TimesheetOut:
    _require_view(db, access, user_id)
    user = db.get(User, user_id)
    assert user is not None
    first, last = period_of(db, access.workspace_id, any_day)
    days = [first + i * DAY for i in range(7)]
    start, end = _at(first, tz), _at(last + DAY, tz)

    pairs = _entries(db, access.workspace_id, user_id, start, end)
    tags = tags_for(db, [e.id for e, _ in pairs])
    wanted_tags = set(tag_ids)

    def keep(entry: TimeEntry, task: Task) -> bool:
        if billable == "billable" and not entry.billable:
            return False
        if billable == "non_billable" and entry.billable:
            return False
        if wanted_tags and not wanted_tags & {tag.id for tag in tags.get(entry.id, [])}:
            return False
        if task.archived_at is not None and not include_archived:
            return False
        return True

    pairs = [(e, task) for e, task in pairs if keep(e, task)]
    pinned = list(
        db.execute(
            select(TimesheetRow, Task).join(Task, Task.id == TimesheetRow.task_id).where(
                TimesheetRow.user_id == user_id, TimesheetRow.period_start == first
            )
        ).all()
    )

    tasks: Dict[uuid.UUID, Task] = {task.id: task for _, task in pairs}
    added: Dict[uuid.UUID, datetime] = {}
    for pin, task in pinned:
        if task.archived_at is not None and not include_archived:
            continue
        tasks[task.id] = task
        added[task.id] = pin.created_at
    for entry, task in pairs:
        added[task.id] = min(added.get(task.id, entry.created_at), entry.created_at)

    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({x.status_id for x in tasks.values()})))} if tasks else {}
    assignees: Dict[uuid.UUID, List[User]] = {}
    tag_names: Dict[uuid.UUID, List[str]] = {}
    if tasks:
        from app.db.models import Tag, TaskAssignee, TaskTag

        for task_id, user in db.execute(
            select(TaskAssignee.task_id, User).join(User, User.id == TaskAssignee.user_id)
            .where(TaskAssignee.task_id.in_(list(tasks)))
        ):
            assignees.setdefault(task_id, []).append(user)
        for task_id, name in db.execute(
            select(TaskTag.task_id, Tag.name).join(Tag, Tag.id == TaskTag.tag_id)
            .where(TaskTag.task_id.in_(list(tasks)))
        ):
            tag_names.setdefault(task_id, []).append(name)
    locate = _Locator(db)
    rows: Dict[uuid.UUID, t.SheetRow] = {}
    for task in tasks.values():
        can_open = access.level(chain_for_task(db, task)) is not None
        rows[task.id] = t.SheetRow(
            task=t.SheetTask(
                id=task.id,
                name=task.name if can_open else "Private task",
                status=s.StatusOut.model_validate(statuses[task.status_id]) if can_open else None,
                location=locate.of(task.list_id) if can_open else "",
                list_id=task.list_id if can_open else None,
                archived=task.archived_at is not None,
                can_open=can_open,
                priority=task.priority if can_open else None,
                assignees=[s.UserOut.model_validate(u) for u in assignees.get(task.id, [])] if can_open else [],
                tags=sorted(tag_names.get(task.id, [])) if can_open else [],
                start_date=task.start_date if can_open else None,
                due_date=task.due_date if can_open else None,
                date_done=(task.date_done or task.date_closed) if can_open else None,
                time_estimate_seconds=task.time_estimate_seconds if can_open else None,
            ),
            seconds_per_day=[0] * 7, total_seconds=0, added_at=added[task.id], running=False, entries=[],
        )

    tracked = [0] * 7
    billed = [0] * 7
    for entry, task in pairs:
        day_index = (entry.started_at.astimezone(tz).date() - first).days
        row = rows[task.id]
        row.entries.append(t.SheetEntry(
            id=entry.id, task_id=task.id, started_at=entry.started_at, ended_at=entry.ended_at,
            duration_seconds=entry.duration_seconds, running=entry.ended_at is None, description=entry.description,
            billable=entry.billable, tags=tags.get(entry.id, []), day=day_index, created_by=entry.created_by,
        ))
        if entry.ended_at is None:
            row.running = True
            continue
        seconds = entry.duration_seconds or 0
        row.seconds_per_day[day_index] += seconds
        row.total_seconds += seconds
        tracked[day_index] += seconds
        if entry.billable:
            billed[day_index] += seconds

    out_rows = list(rows.values())
    if tracked_op and tracked_seconds is not None:
        # "more than 2h" and "at least 2h" are different questions, and on a filter that people
        # use to find the rows they forgot to fill in, the difference is the whole point.
        compare = {
            "gt": lambda total: total > tracked_seconds,
            "gte": lambda total: total >= tracked_seconds,
            "lt": lambda total: total < tracked_seconds,
            "lte": lambda total: total <= tracked_seconds,
            "eq": lambda total: total == tracked_seconds,
        }.get(tracked_op)
        if compare is not None:
            out_rows = [r for r in out_rows if compare(r.total_seconds)]
    if sort == "name":
        out_rows.sort(key=lambda r: r.task.name.lower(), reverse=descending)
    else:
        out_rows.sort(key=lambda r: r.added_at, reverse=descending)

    from app.services.work.leave import daily_capacity

    capacity = daily_capacity(db, access.workspace_id, [user_id], days)[user_id]  # hours less holidays and leave
    sub = current_submission(db, access.workspace_id, user_id, first)
    settings = settings_row(db, access.workspace_id)
    locked = sub is not None and sub.status in LOCKED
    is_admin = can_manage_workspace(access.role)
    return t.TimesheetOut(
        user=s.UserOut.model_validate(user),
        period_start=first,
        period_end=last,
        days=days,
        capacity_per_day=capacity,
        tracked_per_day=tracked,
        billable_per_day=billed,
        rows=out_rows,
        total_seconds=sum(tracked),
        week_start=settings.week_start,
        approvals_enabled=settings.approvals_enabled,
        submission=submission_out(db, access, sub) if sub else None,
        locked=locked,
        can_edit=(user_id == access.user_id or is_admin) and (not locked or is_admin),
    )


def set_cell(db: Session, access: Access, data: t.CellIn) -> None:
    """Make one task's tracked time on one day equal `seconds`."""
    user_id = data.user_id or access.user_id
    _require_edit(db, access, user_id)
    tz = zone(data.tz)
    opened = open_task(db, access.user_id, data.task_id, PermissionLevel.view)
    if opened.access.workspace_id != access.workspace_id:
        raise NotFound("Task not found")
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to a task to track time on it")
    day_start, day_end = _at(data.day, tz), _at(data.day + DAY, tz)
    ensure_unlocked(db, access.workspace_id, user_id, day_start, access.role)
    cell = list(
        db.scalars(
            select(TimeEntry).where(
                TimeEntry.user_id == user_id,
                TimeEntry.task_id == data.task_id,
                TimeEntry.started_at >= day_start,
                TimeEntry.started_at < day_end,
                TimeEntry.ended_at.is_not(None),
            ).order_by(TimeEntry.started_at.desc(), TimeEntry.created_at.desc())
        )
    )
    current = sum(e.duration_seconds or 0 for e in cell)
    if data.seconds > current:
        extra = data.seconds - current
        begin = _new_entry_start(data.day, tz, extra, day_start, day_end)
        db.add(TimeEntry(
            task_id=data.task_id, user_id=user_id, started_at=begin, ended_at=begin + timedelta(seconds=extra),
            duration_seconds=extra, created_by=access.user_id,
        ))
    elif data.seconds < current:
        remove = current - data.seconds
        for entry in cell:  # newest first
            if remove <= 0:
                break
            length = entry.duration_seconds or 0
            if length <= remove:
                db.delete(entry)
                remove -= length
            else:
                entry.duration_seconds = length - remove
                entry.ended_at = entry.started_at + timedelta(seconds=entry.duration_seconds)
                remove = 0
    db.flush()



def _new_entry_start(day: date, tz: ZoneInfo, seconds: int, day_start: datetime, day_end: datetime) -> datetime:
    """When time typed into a cell should say it started: now, on the day you typed it against.

    Type an hour at 10:21 and the entry reads 10:21 to 11:21. On a day that is not today the
    clock is still the honest answer -- you are recording work at the moment you remember it --
    so the same time of day is used, on that day.

    Every entry used to be stamped 09:00 instead, which put three of them on top of each other
    at nine in the morning and made the hover card read as nonsense.

    The one thing it cannot do is run past midnight, so an entry long enough to overflow the day
    is pulled back until it fits.
    """
    here = datetime.now(timezone.utc).astimezone(tz)
    begin = datetime.combine(day, time(here.hour, here.minute), tz).astimezone(timezone.utc)
    if seconds >= (day_end - day_start).total_seconds():
        return day_start
    return min(max(begin, day_start), day_end - timedelta(seconds=seconds))

def add_row(db: Session, access: Access, data: t.RowIn) -> None:
    user_id = data.user_id or access.user_id
    _require_edit(db, access, user_id)
    opened = open_task(db, access.user_id, data.task_id, PermissionLevel.view)
    if opened.access.workspace_id != access.workspace_id:
        raise NotFound("Task not found")
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to a task to track time on it")
    first, _ = period_of(db, access.workspace_id, data.start)
    if db.get(TimesheetRow, (user_id, data.task_id, first)) is None:
        db.add(TimesheetRow(user_id=user_id, task_id=data.task_id, period_start=first))
    db.flush()


def delete_row(db: Session, access: Access, data: t.RowIn) -> int:
    """Remove a task from the week: deletes all of its time in the week, as ClickUp's Delete row."""
    user_id = data.user_id or access.user_id
    _require_edit(db, access, user_id)
    tz = zone(data.tz)
    first, last = period_of(db, access.workspace_id, data.start)
    ensure_unlocked(db, access.workspace_id, user_id, _at(first, tz), access.role)
    entries = list(
        db.scalars(
            select(TimeEntry).where(
                TimeEntry.user_id == user_id,
                TimeEntry.task_id == data.task_id,
                TimeEntry.started_at >= _at(first, tz),
                TimeEntry.started_at < _at(last + DAY, tz),
                TimeEntry.ended_at.is_not(None),
            )
        )
    )
    for entry in entries:
        db.delete(entry)
    pin = db.get(TimesheetRow, (user_id, data.task_id, first))
    if pin is not None:
        db.delete(pin)
    db.flush()
    return len(entries)


def pickable_tasks(db: Session, access: Access, query: str, limit: int = 20) -> List[t.PickTask]:
    """Tasks the caller can track time on, for "Add task"."""
    q = select(Task).join(TaskList, TaskList.id == Task.list_id).join(Space, Space.id == TaskList.space_id).where(
        Space.workspace_id == access.workspace_id,
        Task.archived_at.is_(None),
        TaskList.archived_at.is_(None),
        (Space.personal_owner_id.is_(None)) | (Space.personal_owner_id == access.user_id),
    )
    if query.strip():
        q = q.where(Task.name.ilike(f"%{query.strip()}%"))
    candidates = list(db.scalars(q.order_by(Task.updated_at.desc()).limit(200)))
    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({x.status_id for x in candidates})))} if candidates else {}
    locate = _Locator(db)
    out = []
    for task in candidates:
        level = access.level(chain_for_task(db, task))
        if level is None or not level.at_least(PermissionLevel.edit):
            continue
        out.append(t.PickTask(id=task.id, name=task.name, status=s.StatusOut.model_validate(statuses[task.status_id]), location=locate.of(task.list_id)))
        if len(out) >= limit:
            break
    return out


# --- all timesheets ----------------------------------------------------------------------------------


def all_timesheets(db: Session, access: Access, any_day: date, tz: ZoneInfo, team_id: Optional[uuid.UUID] = None) -> t.AllTimesheetsOut:
    visible = time_visible_people(db, access)
    if visible is not None and visible <= {access.user_id}:
        raise Forbidden("Only owners, admins and Team leads can see other people's timesheets")
    first, last = period_of(db, access.workspace_id, any_day)
    days = [first + i * DAY for i in range(7)]
    start, end = _at(first, tz), _at(last + DAY, tz)
    members = list(
        db.execute(
            select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id).where(
                WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.role != WorkspaceRole.guest
            )
        ).scalars()
    )
    people = [u for u in members if visible is None or u.id in visible]
    if team_id is not None:
        from app.services.work import team_tree

        in_team = team_tree.people(db, [team_id])
        people = [u for u in people if u.id in in_team]
    ids = [u.id for u in people]
    tracked: Dict[str, List[int]] = {uid: [0] * 7 for uid in ids}
    billed: Dict[str, List[int]] = {uid: [0] * 7 for uid in ids}
    if ids:
        rows = db.execute(
            select(TimeEntry)
            .join(Task, Task.id == TimeEntry.task_id)
            .join(TaskList, TaskList.id == Task.list_id)
            .join(Space, Space.id == TaskList.space_id)
            .where(
                Space.workspace_id == access.workspace_id,
                TimeEntry.user_id.in_(ids),
                TimeEntry.started_at >= start,
                TimeEntry.started_at < end,
                TimeEntry.ended_at.is_not(None),
            )
        ).scalars()
        for entry in rows:
            i = (entry.started_at.astimezone(tz).date() - first).days
            tracked[entry.user_id][i] += entry.duration_seconds or 0
            if entry.billable:
                billed[entry.user_id][i] += entry.duration_seconds or 0
    subs = {
        sub.user_id: sub.status
        for sub in db.scalars(
            select(TimesheetSubmission).where(
                TimesheetSubmission.workspace_id == access.workspace_id, TimesheetSubmission.period_start == first
            )
        )
    }
    from app.services.work.leave import daily_capacity

    capacities = daily_capacity(db, access.workspace_id, [u.id for u in people], days)
    out = []
    for user in sorted(people, key=lambda u: (u.display_name or u.email).lower()):
        capacity = capacities[user.id]
        out.append(t.PersonWeek(
            user=s.UserOut.model_validate(user), capacity_per_day=capacity, tracked_per_day=tracked[user.id],
            billable_per_day=billed[user.id], total_seconds=sum(tracked[user.id]), capacity_seconds=sum(capacity),
            submission_status=subs.get(user.id),
        ))
    return t.AllTimesheetsOut(
        period_start=first, period_end=last, days=days, people=out,
        approvals_enabled=settings_row(db, access.workspace_id).approvals_enabled,
    )


# --- time tags -----------------------------------------------------------------------------------------


def _tag_out(tag: TimeTag) -> t.TimeTagOut:
    return t.TimeTagOut(id=tag.id, name=tag.name, bg_color=tag.bg_color, fg_color=tag.fg_color)


def list_tags(db: Session, access: Access) -> List[t.TimeTagOut]:
    return [_tag_out(x) for x in db.scalars(select(TimeTag).where(TimeTag.workspace_id == access.workspace_id).order_by(func.lower(TimeTag.name)))]


def create_tag(db: Session, access: Access, data: t.TimeTagIn) -> t.TimeTagOut:
    if access.role == WorkspaceRole.guest:
        raise Forbidden("Guests cannot create time tags")
    exists = db.scalar(select(TimeTag.id).where(TimeTag.workspace_id == access.workspace_id, func.lower(TimeTag.name) == data.name.lower()))
    if exists is not None:
        raise Invalid(f"A time tag called {data.name} already exists")
    tag = TimeTag(workspace_id=access.workspace_id, name=data.name, created_by=access.user_id)
    if data.bg_color:
        tag.bg_color = data.bg_color
    if data.fg_color:
        tag.fg_color = data.fg_color
    db.add(tag)
    db.flush()
    return _tag_out(tag)


def _tag(db: Session, access: Access, tag_id: uuid.UUID) -> TimeTag:
    tag = db.get(TimeTag, tag_id)
    if tag is None or tag.workspace_id != access.workspace_id:
        raise NotFound("Time tag not found")
    if not can_manage_workspace(access.role) and tag.created_by != access.user_id:
        raise Forbidden("Only owners, admins and the tag's creator can change it")
    return tag


def update_tag(db: Session, access: Access, tag_id: uuid.UUID, data: t.TimeTagIn) -> t.TimeTagOut:
    tag = _tag(db, access, tag_id)
    clash = db.scalar(select(TimeTag.id).where(
        TimeTag.workspace_id == access.workspace_id, func.lower(TimeTag.name) == data.name.lower(), TimeTag.id != tag.id))
    if clash is not None:
        raise Invalid(f"A time tag called {data.name} already exists")
    tag.name = data.name
    if data.bg_color:
        tag.bg_color = data.bg_color
    if data.fg_color:
        tag.fg_color = data.fg_color
    db.flush()
    return _tag_out(tag)


def delete_tag(db: Session, access: Access, tag_id: uuid.UUID) -> None:
    db.delete(_tag(db, access, tag_id))
    db.flush()


# --- submissions (read side; approvals.py has the workflow) ----------------------------------------------


def approvers_for(db: Session, workspace_id: uuid.UUID, submitter_id: str) -> Set[str]:
    """Who approves this person: the explicit list, else the leads of their Teams."""
    explicit = set(db.scalars(select(TimesheetApprover.approver_id).where(
        TimesheetApprover.workspace_id == workspace_id, TimesheetApprover.submitter_id == submitter_id)))
    if explicit:
        return explicit
    teams = select(TeamMember.team_id).join(Team, Team.id == TeamMember.team_id).where(
        Team.workspace_id == workspace_id, TeamMember.user_id == submitter_id)
    leads = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id.in_(teams), TeamMember.is_lead.is_(True))))
    leads.discard(submitter_id)
    return leads


def can_review(db: Session, access: Access, sub: TimesheetSubmission) -> bool:
    if sub.user_id == access.user_id and not can_manage_workspace(access.role):
        return False
    return can_manage_workspace(access.role) or access.user_id in approvers_for(db, access.workspace_id, sub.user_id)


def submission_out(db: Session, access: Access, sub: TimesheetSubmission) -> t.SubmissionOut:
    approver_ids = approvers_for(db, sub.workspace_id, sub.user_id)
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(approver_ids | {sub.user_id, sub.decided_by or ""})))}
    return t.SubmissionOut(
        id=sub.id,
        user=s.UserOut.model_validate(people[sub.user_id]),
        period_start=sub.period_start,
        period_end=sub.period_end,
        status=sub.status,
        submitted_at=sub.submitted_at,
        decided_by=s.UserOut.model_validate(people[sub.decided_by]) if sub.decided_by in people else None,
        decided_at=sub.decided_at,
        tracked_seconds=sub.tracked_seconds,
        billable_seconds=sub.billable_seconds,
        capacity_seconds=sub.capacity_seconds,
        can_review=can_review(db, access, sub),
        approvers=[s.UserOut.model_validate(people[uid]) for uid in sorted(approver_ids) if uid in people],
    )



# --- filling in from the Planner, and reminders ----------------------------------------------------------------


def prefill_from_planner(db: Session, access: Access, user_id: Optional[str], any_day: date, tz_name: str) -> t.PrefillOut:
    """Turn the week's finished Planner blocks for tasks into time entries, where no time is logged for them yet."""
    from app.db.models import TimeBlock

    user_id = user_id or access.user_id
    _require_edit(db, access, user_id)
    tz = zone(tz_name)
    first, last = period_of(db, access.workspace_id, any_day)
    start, end = _at(first, tz), _at(last + DAY, tz)
    now = datetime.now(timezone.utc)
    made = seconds = 0
    for block in db.scalars(select(TimeBlock).where(
            TimeBlock.workspace_id == access.workspace_id, TimeBlock.user_id == user_id, TimeBlock.task_id.is_not(None),
            TimeBlock.start_at >= start, TimeBlock.start_at < end, TimeBlock.end_at <= now).order_by(TimeBlock.start_at)):
        opened = open_task(db, access.user_id, block.task_id, PermissionLevel.view)
        if not opened.level.at_least(PermissionLevel.edit):
            continue
        overlap = db.scalars(select(TimeEntry.id).where(
            TimeEntry.user_id == user_id, TimeEntry.task_id == block.task_id,
            TimeEntry.started_at < block.end_at, func.coalesce(TimeEntry.ended_at, now) > block.start_at)).first()
        if overlap is not None:
            continue
        ensure_unlocked(db, access.workspace_id, user_id, block.start_at, access.role)
        length = int((block.end_at - block.start_at).total_seconds())
        db.add(TimeEntry(task_id=block.task_id, user_id=user_id, started_at=block.start_at, ended_at=block.end_at,
                         duration_seconds=length, description="From the Planner", created_by=access.user_id))
        made += 1
        seconds += length
    db.flush()
    return t.PrefillOut(entries=made, seconds=seconds)


def run_timesheet_reminders(db: Session, now: Optional[datetime] = None) -> int:
    """On the reminder day and hour, nudge people whose timesheet so far is short of their working hours. Once a week each."""
    from app.db.models import Notification, Workspace, WorkspaceRole
    from app.services.work import events
    from app.services.work.leave import daily_capacity

    now = now or datetime.now(timezone.utc)
    sent = 0
    for ws in db.scalars(select(Workspace)):
        row = settings_row(db, ws.id)
        if row.reminders_enabled is False:
            continue
        tz = zone(row.reminder_timezone or "Asia/Kolkata")
        local = now.astimezone(tz)
        if local.weekday() != (row.reminder_weekday if row.reminder_weekday is not None else 4) or local.hour < (row.reminder_hour or 16):
            continue
        first, _last = period_of(db, ws.id, local.date())
        days = [first + timedelta(days=i) for i in range((local.date() - first).days + 1)]
        members = [m for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == ws.id))
                   if m.deactivated_at is None and m.role != WorkspaceRole.guest]
        if not members:
            continue
        capacity = daily_capacity(db, ws.id, [m.user_id for m in members], days)
        start, end = _at(first, tz), _at(local.date() + DAY, tz)
        for m in members:
            due = sum(capacity[m.user_id])
            if due <= 0:
                continue
            already = db.scalars(select(Notification.id).where(
                Notification.workspace_id == ws.id, Notification.user_id == m.user_id, Notification.kind == "timesheet_reminder",
                Notification.data["period"].astext == first.isoformat())).first()
            if already:
                continue
            tracked = db.scalar(select(func.coalesce(func.sum(TimeEntry.duration_seconds), 0)).where(
                TimeEntry.user_id == m.user_id, TimeEntry.started_at >= start, TimeEntry.started_at < end)) or 0
            if tracked >= due * 0.9:
                continue
            events.notify(db, ws.id, [m.user_id], None, "timesheet_reminder", "primary",
                          data={"period": first.isoformat(), "tracked": int(tracked), "expected": int(due)})
            sent += 1
    db.flush()
    return sent
