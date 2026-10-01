"""Time tracking on tasks, following ClickUp's rules.

  * Tracking time needs edit access to the task (comment access cannot track).
  * Each person has at most one running timer; starting another stops the first.
  * Only owners and admins can log, change or delete time for other people.
  * Everyone who can see a task sees its total. Other people's individual entries
    ("View time tracked by other users") are shown to owners and admins for everyone,
    and to Team leads for the people in the Teams they lead.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Set, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import PermissionLevel, Task, TimeEntry, TimeEntryTag, TimeTag, User, WorkspaceMember
from app.schemas import work as s
from app.services.work.access import Access, Opened, chain_for_task, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace
from app.services.work.teams import people_led_by
from app.services.work.timelocks import ensure_unlocked


def time_visible_people(db: Session, access: Access) -> Optional[Set[str]]:
    """Whose time entries this person may see: None means everyone's."""
    if can_manage_workspace(access.role):
        return None
    return {access.user_id} | people_led_by(db, access.workspace_id, access.user_id)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_tracking(opened: Opened[Task]) -> None:
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to a task to track time on it")
    from app.db.models import TaskList
    from app.services.work import space_admin

    db = Session.object_session(opened.obj)
    lst = db.get(TaskList, opened.obj.list_id) if db is not None else None
    if lst is not None:
        space_admin.require(db, lst.space_id, "time_tracking")


def tags_for(db: Session, entry_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, list]:
    """Time tags on each entry, by entry id."""
    out: Dict[uuid.UUID, list] = {}
    if entry_ids:
        rows = db.execute(
            select(TimeEntryTag.time_entry_id, TimeTag)
            .join(TimeTag, TimeTag.id == TimeEntryTag.tag_id)
            .where(TimeEntryTag.time_entry_id.in_(list(entry_ids)))
            .order_by(TimeTag.name)
        )
        for entry_id, tag in rows:
            out.setdefault(entry_id, []).append(
                s.TimeTagRef(id=tag.id, name=tag.name, bg_color=tag.bg_color, fg_color=tag.fg_color)
            )
    return out


def set_tags(db: Session, entry: TimeEntry, workspace_id: uuid.UUID, tag_ids: Sequence[uuid.UUID]) -> None:
    wanted = set(tag_ids)
    if wanted:
        found = set(db.scalars(select(TimeTag.id).where(TimeTag.id.in_(wanted), TimeTag.workspace_id == workspace_id)))
        if found != wanted:
            raise Invalid("Unknown time tag")
    current = set(db.scalars(select(TimeEntryTag.tag_id).where(TimeEntryTag.time_entry_id == entry.id)))
    for tag_id in current - wanted:
        db.delete(db.get(TimeEntryTag, (entry.id, tag_id)))
    for tag_id in wanted - current:
        db.add(TimeEntryTag(time_entry_id=entry.id, tag_id=tag_id))
    db.flush()


def entry_out_db(db: Session, entry: TimeEntry) -> s.TimeEntryOut:
    user = db.get(User, entry.user_id)
    assert user is not None
    return entry_out(entry, user, tags_for(db, [entry.id]).get(entry.id, []))


def entry_out(entry: TimeEntry, user: User, tags: Optional[list] = None) -> s.TimeEntryOut:
    return s.TimeEntryOut(
        tags=tags or [],
        id=entry.id,
        task_id=entry.task_id,
        user=s.UserOut.model_validate(user),
        started_at=entry.started_at,
        ended_at=entry.ended_at,
        duration_seconds=entry.duration_seconds,
        running=entry.ended_at is None,
        description=entry.description,
        billable=entry.billable,
    )


def tracked_totals(db: Session, task_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, int]:
    """Finished time per task, by everyone."""
    if not task_ids:
        return {}
    rows = db.execute(
        select(TimeEntry.task_id, func.coalesce(func.sum(TimeEntry.duration_seconds), 0))
        .where(TimeEntry.task_id.in_(task_ids), TimeEntry.ended_at.is_not(None))
        .group_by(TimeEntry.task_id)
    )
    return {task_id: int(total) for task_id, total in rows}


def _with_descendants(db: Session, task: Task) -> List[uuid.UUID]:
    """A task and every subtask beneath it, however deep.

    Walks a level at a time rather than trusting top_level_parent_id, which points at the root of
    the whole tree: a subtask three levels down would otherwise drag in its cousins.
    """
    ids = [task.id]
    frontier = [task.id]
    while frontier:
        children = list(db.scalars(select(Task.id).where(Task.parent_id.in_(frontier))))
        if not children:
            break
        ids += children
        frontier = children
    return ids


def _finish(entry: TimeEntry, at: datetime) -> None:
    at = max(at, entry.started_at)
    entry.ended_at = at
    entry.duration_seconds = int((at - entry.started_at).total_seconds())


def running_entry(db: Session, user_id: str) -> Optional[TimeEntry]:
    return db.scalars(
        select(TimeEntry).where(TimeEntry.user_id == user_id, TimeEntry.ended_at.is_(None))
    ).first()


# --- timers ------------------------------------------------------------------


def start_timer(db: Session, opened: Opened[Task], description: Optional[str] = None) -> TimeEntry:
    _require_tracking(opened)
    now = _now()
    ensure_unlocked(db, opened.access.workspace_id, opened.access.user_id, now, opened.access.role)
    current = running_entry(db, opened.access.user_id)
    if current is not None:
        if current.task_id == opened.obj.id:
            return current  # already timing this task
        _finish(current, now)
        db.flush()
    entry = TimeEntry(
        task_id=opened.obj.id,
        user_id=opened.access.user_id,
        started_at=now,
        description=description,
        created_by=opened.access.user_id,
    )
    db.add(entry)
    db.flush()
    return entry


def stop_timer(db: Session, user_id: str) -> TimeEntry:
    entry = running_entry(db, user_id)
    if entry is None:
        raise NotFound("No timer is running")
    _finish(entry, _now())
    db.flush()
    return entry


# --- manual entries ----------------------------------------------------------


def add_entry(db: Session, opened: Opened[Task], data: s.TimeEntryCreate) -> TimeEntry:
    _require_tracking(opened)
    access = opened.access
    user_id = data.user_id or access.user_id
    if user_id != access.user_id:
        if not can_manage_workspace(access.role):
            raise Forbidden("Only owners and admins can log time for other people")
        member = db.get(WorkspaceMember, (access.workspace_id, user_id))
        if member is None:
            raise Invalid("Time can only be logged for workspace members")
        other = Access(db, user_id, access.workspace_id, member.role)
        if other.level(chain_for_task(db, opened.obj)) is None:
            raise Invalid("That person cannot see this task")

    if data.started_at and data.ended_at:
        started, ended = data.started_at, data.ended_at
    else:
        assert data.duration_seconds is not None
        if data.started_at:
            started = data.started_at
            ended = started + timedelta(seconds=data.duration_seconds)
        else:
            ended = _now()
            started = ended - timedelta(seconds=data.duration_seconds)

    ensure_unlocked(db, access.workspace_id, user_id, started, access.role)
    entry = TimeEntry(
        task_id=opened.obj.id,
        user_id=user_id,
        started_at=started,
        ended_at=ended,
        duration_seconds=int((ended - started).total_seconds()),
        description=data.description,
        billable=data.billable,
        created_by=access.user_id,
    )
    db.add(entry)
    db.flush()
    if data.tag_ids:
        set_tags(db, entry, access.workspace_id, data.tag_ids)
    return entry


def _open_entry(db: Session, user_id: str, entry_id: uuid.UUID) -> Tuple[TimeEntry, Opened[Task]]:
    entry = db.get(TimeEntry, entry_id)
    if entry is None:
        raise NotFound("Time entry not found")
    opened = open_task(db, user_id, entry.task_id, PermissionLevel.view)
    if entry.user_id != user_id and not can_manage_workspace(opened.access.role):
        raise NotFound("Time entry not found")  # other people's entries are not visible
    return entry, opened


def update_entry(db: Session, user_id: str, entry_id: uuid.UUID, data: s.TimeEntryUpdate) -> TimeEntry:
    entry, opened = _open_entry(db, user_id, entry_id)
    _require_tracking(opened)
    access = opened.access
    ensure_unlocked(db, access.workspace_id, entry.user_id, entry.started_at, access.role)
    fields = data.model_fields_set
    timing = {f for f in ("duration_seconds", "started_at", "ended_at") if f in fields and getattr(data, f) is not None}
    if timing and entry.ended_at is None:
        raise Invalid("Stop the timer before changing its time")
    if "started_at" in timing:
        assert data.started_at is not None
        length = entry.duration_seconds or 0
        entry.started_at = data.started_at
        entry.ended_at = data.started_at + timedelta(seconds=length)
    if "ended_at" in timing:
        assert data.ended_at is not None
        if data.ended_at < entry.started_at:
            raise Invalid("A time entry must end after it starts")
        entry.ended_at = data.ended_at
        entry.duration_seconds = int((entry.ended_at - entry.started_at).total_seconds())
        if entry.duration_seconds > s.MAX_ENTRY_SECONDS:
            raise Invalid("A single time entry can be at most 24 hours")
    if "duration_seconds" in timing:
        assert data.duration_seconds is not None
        entry.duration_seconds = data.duration_seconds
        entry.ended_at = entry.started_at + timedelta(seconds=data.duration_seconds)
    if timing:
        ensure_unlocked(db, access.workspace_id, entry.user_id, entry.started_at, access.role)
    if "task_id" in fields and data.task_id is not None and data.task_id != entry.task_id:
        target = open_task(db, user_id, data.task_id, PermissionLevel.edit)
        if target.access.workspace_id != access.workspace_id:
            raise Invalid("Time can only move within the workspace")
        if entry.user_id != user_id:
            member = db.get(WorkspaceMember, (access.workspace_id, entry.user_id))
            other = Access(db, entry.user_id, access.workspace_id, member.role) if member else None
            if other is None or other.level(chain_for_task(db, target.obj)) is None:
                raise Invalid("That person cannot see the task you are moving the time to")
        entry.task_id = target.obj.id
    if "tag_ids" in fields and data.tag_ids is not None:
        set_tags(db, entry, access.workspace_id, data.tag_ids)
    if "description" in fields:
        entry.description = data.description
    if "billable" in fields and data.billable is not None:
        entry.billable = data.billable
    db.flush()
    return entry


def delete_entry(db: Session, user_id: str, entry_id: uuid.UUID) -> None:
    entry, opened = _open_entry(db, user_id, entry_id)
    _require_tracking(opened)
    ensure_unlocked(db, opened.access.workspace_id, entry.user_id, entry.started_at, opened.access.role)
    db.delete(entry)
    db.flush()


# --- reading -----------------------------------------------------------------


def task_time(db: Session, opened: Opened[Task]) -> s.TaskTimeOut:
    access = opened.access
    everyone = can_manage_workspace(access.role)
    people = time_visible_people(db, access)
    query = select(TimeEntry, User).join(User, User.id == TimeEntry.user_id).where(
        TimeEntry.task_id == opened.obj.id
    )
    if people is not None:
        query = query.where(TimeEntry.user_id.in_(people))
    rows = db.execute(query.order_by(TimeEntry.started_at.desc())).all()
    tags = tags_for(db, [entry.id for entry, _ in rows])
    task = opened.obj
    totals = tracked_totals(db, _with_descendants(db, task))
    return s.TaskTimeOut(
        total_seconds=totals.get(task.id, 0),
        subtree_seconds=sum(totals.values()),
        entries=[entry_out(entry, user, tags.get(entry.id)) for entry, user in rows],
        shows_everyone=everyone,
    )


def current_timer(db: Session, user: User) -> Optional[s.RunningTimerOut]:
    entry = running_entry(db, user.id)
    if entry is None:
        return None
    task = db.get(Task, entry.task_id)
    assert task is not None
    return s.RunningTimerOut(entry=entry_out(entry, user), task_name=task.name, list_id=task.list_id)

