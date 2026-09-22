"""Bulk edit, like ClickUp's bulk action toolbar.

The change is applied task by task, each in its own savepoint, with the same rules as a
single edit. Tasks the caller can't change are skipped and reported rather than failing
the whole batch, so selecting a mix of your own and read-only tasks still does what it can.
"""

import uuid
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PermissionLevel, Tag, Task, TaskAssignee, TaskList, TaskTag
from app.schemas import work as s
from app.services.work import tasks
from app.services.work.access import open_list, open_task
from app.services.work.errors import Invalid, NotFound, WorkError
from app.services.work.statuses import effective_statuses

VIEW = PermissionLevel.view


def _status_by_name(db: Session, task: Task, name: str) -> uuid.UUID:
    """Lists can have different statuses, so a bulk status change is by name."""
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    for st in effective_statuses(db, lst):
        if st.name.strip().lower() == name.strip().lower():
            return st.id
    raise Invalid(f"Its List has no “{name}” status")


def _current_assignees(db: Session, task: Task) -> List[str]:
    return list(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))


def _current_tags(db: Session, task: Task) -> List[str]:
    return list(db.scalars(select(Tag.name).join(TaskTag, TaskTag.tag_id == Tag.id).where(TaskTag.task_id == task.id)))


def _merge(current: List[str], add: List[str], remove: List[str], key=lambda x: x) -> List[str]:
    gone = {key(r) for r in remove}
    out = [c for c in current if key(c) not in gone]
    have = {key(c) for c in out}
    out += [a for a in add if key(a) not in have and key(a) not in gone]
    return out


def bulk_edit(db: Session, user_id: str, data: s.BulkEdit) -> s.BulkResult:
    fields = data.model_fields_set
    target: Optional[Any] = None
    if data.list_id is not None:
        target = open_list(db, user_id, data.list_id, VIEW)

    done: List[uuid.UUID] = []
    skipped: List[s.BulkSkip] = []
    deleted: set = set()
    for task_id in dict.fromkeys(data.task_ids):  # keep order, drop repeats
        if task_id in deleted:
            continue
        name = ""
        try:
            with db.begin_nested():
                opened = open_task(db, user_id, task_id, VIEW)
                task = opened.obj
                name = task.name
                if data.delete:
                    subtree = {t.id for t in tasks._tree_rows(db, task)}
                    tasks.delete_task(db, opened)
                    deleted |= subtree
                    done.append(task_id)
                    continue
                if target is not None and task.list_id != target.obj.id:
                    tasks.move_task(db, opened, target, {})
                    opened = open_task(db, user_id, task_id, VIEW)
                    task = opened.obj

                change: Dict[str, Any] = {}
                if data.status is not None:
                    change["status_id"] = _status_by_name(db, task, data.status)
                for key in ("priority", "start_date", "due_date", "group_id", "archived"):
                    if key in fields:
                        change[key] = getattr(data, key)
                if data.add_assignees or data.remove_assignees:
                    change["assignees"] = _merge(_current_assignees(db, task), data.add_assignees, data.remove_assignees)
                if data.add_tags or data.remove_tags:
                    change["tags"] = _merge(_current_tags(db, task), data.add_tags, data.remove_tags, key=str.lower)
                if change:
                    tasks.update_task(db, opened, s.TaskUpdate(**change))
                done.append(task_id)
        except NotFound:
            skipped.append(s.BulkSkip(id=task_id, name=name, reason="Not found, or you can't see it"))
        except WorkError as e:
            skipped.append(s.BulkSkip(id=task_id, name=name, reason=e.message))
    db.flush()
    return s.BulkResult(updated=done, skipped=skipped)
