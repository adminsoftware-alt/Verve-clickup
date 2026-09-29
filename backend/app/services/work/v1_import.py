"""Bring work over from the old Firestore app (v1): its tasks and the hours logged on them.

Tasks go to a Space called "Imported from old Timetriq" (List "Old tasks"), keeping their dates, estimate,
priority, assignees and whether they were done; hours become time entries on those tasks. Every record
is remembered by its old id, so running the import again only brings over what is new.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    ImportedRecord, PermissionLevel, Space, StatusGroup, Task, TaskAssignee, TaskList, TimeEntry, User, WorkspaceMember,
)
from app.schemas import work as s
from app.services.work.access import Access, Opened
from app.services.work.errors import Forbidden
from app.services.work.permissions import can_manage_workspace

SPACE = "Imported from old Timetriq"
LIST = "Old tasks"
PRIORITY = {"urgent": 1, "high": 2, "medium": 3, "normal": 3, "low": 4}


def _seen(db: Session, workspace_id: uuid.UUID, source: str, source_id: str) -> Optional[str]:
    row = db.scalars(select(ImportedRecord).where(ImportedRecord.workspace_id == workspace_id, ImportedRecord.source == source,
                                                  ImportedRecord.source_id == source_id)).first()
    return row.target_id if row else None


def _remember(db: Session, workspace_id: uuid.UUID, source: str, source_id: str, target_id: Any) -> None:
    db.add(ImportedRecord(workspace_id=workspace_id, source=source, source_id=source_id, target_id=str(target_id)))


def _person(db: Session, workspace_id: uuid.UUID, uid: Optional[str]) -> Optional[str]:
    if not uid:
        return None
    user = db.scalars(select(User).where(or_(User.auth_uid == uid, User.id == uid, func.lower(User.email) == str(uid).lower()))).first()
    if user is None or db.get(WorkspaceMember, (workspace_id, user.id)) is None:
        return None
    return user.id


def _date(value: Any) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _target_list(db: Session, access: Access) -> TaskList:
    from app.services.work import hierarchy

    space = db.scalars(select(Space).where(Space.workspace_id == access.workspace_id, Space.name == SPACE)).first()
    if space is None:
        space = hierarchy.create_space(db, access, s.SpaceCreate(name=SPACE, description="Tasks and hours brought over from the old Timetriq app."))
    lst = db.scalars(select(TaskList).where(TaskList.space_id == space.id, TaskList.name == LIST)).first()
    if lst is None:
        lst = hierarchy.create_list(db, access, space, s.ListCreate(name=LIST))
    return lst


def import_work(db: Session, access: Access, tasks: List[Dict[str, Any]], entries: List[Dict[str, Any]],
                tz_name: str = "Asia/Kolkata") -> Dict[str, int]:
    from app.services.work import tasks as task_service
    from app.services.work.statuses import apply_group_transition, effective_statuses

    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can import")
    tz = ZoneInfo(tz_name)
    at = lambda d, h=18: datetime.combine(d, time(hour=h), tzinfo=tz)  # noqa: E731
    counts = {"tasks": 0, "tasks_skipped": 0, "entries": 0, "entries_skipped": 0, "unknown_people": 0}
    lst = _target_list(db, access)
    statuses = effective_statuses(db, lst)
    done = next((st for st in statuses if st.group == StatusGroup.closed), None)
    active = next((st for st in statuses if st.group == StatusGroup.active), None)
    opened = Opened(lst, access, PermissionLevel.full)
    for rec in tasks:
        old_id = str(rec.get("id") or "")
        if not old_id or _seen(db, access.workspace_id, "v1.task", old_id):
            counts["tasks_skipped"] += 1
            continue
        people = [p for p in (_person(db, access.workspace_id, u) for u in (rec.get("assignees") or [rec.get("assignedUserId")])) if p]
        start, due = _date(rec.get("startDate")), _date(rec.get("dueDate"))
        hours = float(rec.get("estimatedHours") or 0)
        task = task_service.create_task(db, opened, s.TaskCreate(
            name=str(rec.get("title") or "Untitled")[:500], description=rec.get("description") or None,
            start_date=at(start, 9) if start else None, due_date=at(max(due, start) if due and start else due) if due else None,
            priority=PRIORITY.get(str(rec.get("priority") or "").lower()), assignees=list(dict.fromkeys(people)),
            time_estimate_seconds=int(hours * 3600) if hours > 0 else None,
        ))
        status = str(rec.get("status") or "").lower()
        target = done if status in ("completed", "done") else active if status in ("in progress", "inprogress", "review") else None
        if target is not None and target.id != task.status_id:
            old = next(st for st in statuses if st.id == task.status_id)
            task.status_id = target.id
            apply_group_transition(task, old.group, target.group)
            finished = _date(rec.get("completedDate"))
            if finished and target is done:
                task.date_done = task.date_closed = at(finished)
        _remember(db, access.workspace_id, "v1.task", old_id, task.id)
        counts["tasks"] += 1
    db.flush()
    for rec in entries:
        old_id = str(rec.get("id") or "")
        if not old_id or _seen(db, access.workspace_id, "v1.time_entry", old_id):
            counts["entries_skipped"] += 1
            continue
        task_id = _seen(db, access.workspace_id, "v1.task", str(rec.get("task_id") or ""))
        user_id = _person(db, access.workspace_id, rec.get("owner_id"))
        seconds = int(float(rec.get("hours_worked") or 0) * 3600)
        day = _date(rec.get("date"))
        if not task_id or seconds <= 0 or day is None:
            counts["entries_skipped"] += 1
            continue
        if user_id is None:
            counts["unknown_people"] += 1
            continue
        started = rec.get("start_time")
        begin = datetime.fromisoformat(str(started)) if started else at(day, 9)
        if begin.tzinfo is None:
            begin = begin.replace(tzinfo=tz)
        entry = TimeEntry(task_id=uuid.UUID(task_id), user_id=user_id, started_at=begin, ended_at=begin + timedelta(seconds=seconds),
                          duration_seconds=seconds, description=rec.get("notes") or None, created_by=access.user_id)
        db.add(entry)
        db.flush()
        _remember(db, access.workspace_id, "v1.time_entry", old_id, entry.id)
        counts["entries"] += 1
    db.flush()
    return counts
