"""Sprints, as in ClickUp: a Sprint Folder whose Lists are time-boxed sprints.

Tasks carry sprint points (the Sprint Points ClickApp). Completing a sprint rolls its unfinished
tasks into the next one; each sprint has a burndown, and the Folder a velocity from past sprints.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Folder, PermissionLevel, Status, StatusGroup, Task, TaskList
from app.schemas import spaces as sp
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Access, Opened, chain_for_list
from app.services.work.errors import Forbidden, Invalid

DONE_GROUPS = (StatusGroup.done, StatusGroup.closed)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of(day: date) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=timezone.utc)


def _end_of(day: date) -> datetime:
    return datetime.combine(day, time(23, 59), tzinfo=timezone.utc)


def _sprint_lists(db: Session, folder: Folder) -> List[TaskList]:
    rows = db.scalars(select(TaskList).where(TaskList.folder_id == folder.id, TaskList.archived_at.is_(None)))
    return sorted(rows, key=lambda lst: (lst.start_date or datetime.max.replace(tzinfo=timezone.utc), lst.orderindex))


def _name(n: int, start: date, end: date) -> str:
    return f"Sprint {n} ({start.day} {start:%b} – {end.day} {end:%b})"


def _first_start(settings: Dict) -> date:
    if settings.get("first_start"):
        return date.fromisoformat(settings["first_start"])
    today = _now().date()
    return today - timedelta(days=(today.weekday() - int(settings.get("start_weekday", 0))) % 7)


def _require_folder_full(opened: Opened[Folder]) -> None:
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the Folder to manage its sprints")


def enable(db: Session, opened: Opened[Folder], data: sp.SprintSettings) -> Folder:
    """Turn a Folder into a Sprint Folder; it gets its first sprint if it has none."""
    _require_folder_full(opened)
    folder = opened.obj
    settings = data.model_dump()
    settings["first_start"] = data.first_start.isoformat() if data.first_start else None
    folder.sprint_settings = settings
    db.flush()
    lists = _sprint_lists(db, folder)
    if not any(lst.start_date for lst in lists):
        # A new Folder's empty starter List becomes Sprint 1.
        starter = lists[0] if len(lists) == 1 and lists[0].name == "List" and not db.scalar(
            select(Task.id).where(Task.list_id == lists[0].id).limit(1)) else None
        start = _first_start(settings)
        end = start + timedelta(days=7 * data.weeks - 1)
        if starter is not None:
            starter.name, starter.start_date, starter.due_date = _name(1, start, end), _start_of(start), _end_of(end)
            db.flush()
        else:
            create_next(db, opened)
    return folder


def create_next(db: Session, opened: Opened[Folder]) -> TaskList:
    from app.services.work import hierarchy

    _require_folder_full(opened)
    folder = opened.obj
    if folder.sprint_settings is None:
        raise Invalid("This Folder isn't a Sprint Folder")
    settings = folder.sprint_settings
    dated = [lst for lst in _sprint_lists(db, folder) if lst.start_date and lst.due_date]
    start = (dated[-1].due_date.date() + timedelta(days=1)) if dated else _first_start(settings)
    end = start + timedelta(days=7 * int(settings.get("weeks", 2)) - 1)
    from app.db.models import Space

    space = db.get(Space, folder.space_id)
    lst = hierarchy.create_list(db, opened.access, space, s.ListCreate(name=_name(len(dated) + 1, start, end)), folder=folder)
    lst.start_date, lst.due_date = _start_of(start), _end_of(end)
    db.flush()
    return lst


def _task_rows(db: Session, lst: TaskList) -> List[Tuple[Task, StatusGroup]]:
    return list(db.execute(
        select(Task, Status.group).join(Status, Status.id == Task.status_id)
        .where(Task.list_id == lst.id, Task.archived_at.is_(None))
    ).all())


def _points(task: Task) -> float:
    return float(task.points or 0)


def sprint_out(db: Session, lst: TaskList, now: Optional[datetime] = None) -> sp.SprintOut:
    now = now or _now()
    rows = _task_rows(db, lst)
    done = [t for t, g in rows if g in DONE_GROUPS]
    return sp.SprintOut(
        id=lst.id, name=lst.name, start_date=lst.start_date, due_date=lst.due_date, completed_at=lst.sprint_completed_at,
        current=bool(lst.sprint_completed_at is None and lst.start_date and lst.due_date and lst.start_date <= now <= lst.due_date),
        total_points=sum(_points(t) for t, _ in rows), done_points=sum(_points(t) for t in done),
        task_count=len(rows), done_count=len(done),
    )


def sprints(db: Session, opened: Opened[Folder]) -> List[sp.SprintOut]:
    folder = opened.obj
    out = []
    for lst in _sprint_lists(db, folder):
        if opened.access.level(chain_for_list(db, lst)) is not None:
            out.append(sprint_out(db, lst))
    return out


def _folder_of(db: Session, lst: TaskList) -> Folder:
    folder = db.get(Folder, lst.folder_id) if lst.folder_id else None
    if folder is None or folder.sprint_settings is None:
        raise Invalid("This List isn't a sprint")
    return folder


def complete(db: Session, opened: Opened[TaskList]) -> sp.SprintCompleteOut:
    """Mark the sprint done; if the Folder rolls over, unfinished tasks move to the next sprint."""
    from app.services.work import tasks as task_service

    lst, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the sprint to complete it")
    folder = _folder_of(db, lst)
    if lst.sprint_completed_at is not None:
        raise Invalid("This sprint is already complete")
    lst.sprint_completed_at = _now()
    db.flush()
    moved, next_id = 0, None
    if folder.sprint_settings.get("rollover", True):
        unfinished = [t for t, g in _task_rows(db, lst) if g not in DONE_GROUPS and t.parent_id is None]
        folder_opened = Opened(folder, access, PermissionLevel.full)
        later = [x for x in _sprint_lists(db, folder)
                 if x.id != lst.id and x.sprint_completed_at is None and x.start_date and lst.due_date and x.start_date > lst.due_date]
        target = later[0] if later else create_next(db, folder_opened)
        next_id = target.id
        target_opened = Opened(target, access, PermissionLevel.full)
        for task in sorted(unfinished, key=lambda t: t.orderindex):
            task_service.move_task(db, Opened(task, access, PermissionLevel.full), target_opened, {})
            events.record(db, task, access.user_id, "sprint_rollover", {"from": lst.name, "to": target.name})
            moved += 1
    db.flush()
    return sp.SprintCompleteOut(completed=sprint_out(db, lst), moved=moved, next_list_id=next_id)


def report(db: Session, opened: Opened[TaskList], today: Optional[date] = None) -> sp.SprintReport:
    lst = opened.obj
    folder = _folder_of(db, lst)
    if not (lst.start_date and lst.due_date):
        raise Invalid("This sprint has no dates")
    today = today or _now().date()
    rows = _task_rows(db, lst)
    use_points = any(t.points for t, _ in rows)
    weight = (lambda t: _points(t)) if use_points else (lambda t: 1.0)
    total = sum(weight(t) for t, _ in rows)
    start, end = lst.start_date.date(), lst.due_date.date()
    days = (end - start).days
    burndown = []
    for i in range(days + 1):
        day = start + timedelta(days=i)
        cutoff = _end_of(day)
        done = sum(weight(t) for t, g in rows if g in DONE_GROUPS and t.date_done and t.date_done <= cutoff)
        ideal = round(total * (1 - i / days), 2) if days else 0.0
        burndown.append(sp.BurndownDay(day=day, remaining=round(total - done, 2) if day <= today else None, ideal=ideal))
    velocity = []
    for past in _sprint_lists(db, folder):
        if past.sprint_completed_at is None or opened.access.level(chain_for_list(db, past)) is None:
            continue
        out = sprint_out(db, past)
        velocity.append({"id": str(past.id), "name": past.name, "done_points": out.done_points, "total_points": out.total_points})
    average = round(sum(v["done_points"] for v in velocity) / len(velocity), 2) if velocity else 0.0
    return sp.SprintReport(sprint=sprint_out(db, lst), folder_id=folder.id, burndown=burndown, velocity=velocity,
                           average_velocity=average, unit="points" if use_points else "tasks")


def run_due(db: Session, now: Optional[datetime] = None) -> int:
    """Sprint Folders set to auto-complete: finish sprints whose end has passed (as the Folder's creator)."""
    now = now or _now()
    done = 0
    for folder in db.scalars(select(Folder).where(Folder.sprint_settings.isnot(None), Folder.archived_at.is_(None))):
        if not (folder.sprint_settings or {}).get("auto_complete") or not folder.created_by:
            continue
        for lst in _sprint_lists(db, folder):
            if lst.sprint_completed_at is None and lst.due_date and lst.due_date < now:
                from app.db.models import Space

                space = db.get(Space, folder.space_id)
                try:
                    access = Access.for_workspace(db, folder.created_by, space.workspace_id)
                except Exception:  # the creator left; skip until someone completes it by hand
                    break
                complete(db, Opened(lst, access, PermissionLevel.full))
                done += 1
    return done

