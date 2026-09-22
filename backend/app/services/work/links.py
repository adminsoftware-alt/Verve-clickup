"""Dependencies, task links and merging duplicate tasks, as in ClickUp.

A dependency says one task is *waiting on* another (the other is *blocking* it). ClickUp
warns, rather than refuses, when a waiting task is finished before what it waits on, so the
server only reports how many open blockers a task has; the app asks before closing it.
Dependencies may not loop. A plain link just ties related tasks together.

Merging folds duplicate tasks into one: their comments, history, files, checklists, time,
subtasks, assignees, tags, watchers, links and field values move to the task you keep, and
the duplicates are deleted.
"""

import uuid
from typing import Dict, List, Sequence, Set

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.db.models import (
    Attachment,
    Checklist,
    PermissionLevel,
    Reminder,
    Status,
    Task,
    TaskActivity,
    TaskAssignee,
    TaskComment,
    TaskFieldValue,
    TaskLink,
    TaskTag,
    TaskWatcher,
    TimeEntry,
)
from app.db.models.enums import StatusGroup
from app.schemas import work as s
from app.services.work import events
from app.services.work import tasks as task_service
from app.services.work.access import Opened, chain_for_task, open_list, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound

VIEW = PermissionLevel.view
FINISHED = (StatusGroup.done, StatusGroup.closed)


def _ref(db: Session, task: Task, link_id: uuid.UUID) -> s.LinkedTask:
    status = db.get(Status, task.status_id)
    assert status is not None
    return s.LinkedTask(
        link_id=link_id, id=task.id, name=task.name, list_id=task.list_id, status=s.StatusOut.model_validate(status),
        due_date=task.due_date, finished=status.group in FINISHED,
    )


def links_for(db: Session, opened: Opened[Task]) -> s.TaskLinks:
    task, access = opened.obj, opened.access
    rows = list(db.scalars(select(TaskLink).where(or_(TaskLink.task_id == task.id, TaskLink.other_id == task.id))))
    out = s.TaskLinks(waiting_on=[], blocking=[], linked=[])
    for row in rows:
        other_id = row.other_id if row.task_id == task.id else row.task_id
        other = db.get(Task, other_id)
        if other is None or access.level(chain_for_task(db, other)) is None:
            continue  # links to tasks you can't see stay hidden
        ref = _ref(db, other, row.id)
        if row.kind == "relates":
            out.linked.append(ref)
        elif row.other_id == task.id:
            out.waiting_on.append(ref)  # the other task blocks this one
        else:
            out.blocking.append(ref)
    return out


def _blocks_path(db: Session, start: uuid.UUID, goal: uuid.UUID) -> bool:
    """Does `start` (transitively) block `goal`?"""
    seen: Set[uuid.UUID] = set()
    stack = [start]
    while stack:
        current = stack.pop()
        if current == goal:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(db.scalars(select(TaskLink.other_id).where(TaskLink.task_id == current, TaskLink.kind == "blocks")))
    return False


def add_link(db: Session, opened: Opened[Task], data: s.LinkIn) -> TaskLink:
    task, access = opened.obj, opened.access
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to this task to link it")
    other = open_task(db, access.user_id, data.other_id, VIEW).obj
    if other.id == task.id:
        raise Invalid("A task can't depend on itself")
    if data.kind == "relates":
        a, b, kind = sorted([task.id, other.id], key=str)[0], sorted([task.id, other.id], key=str)[1], "relates"
    elif data.kind == "waiting_on":
        a, b, kind = other.id, task.id, "blocks"  # the other task blocks this one
    else:
        a, b, kind = task.id, other.id, "blocks"
    if kind == "blocks" and _blocks_path(db, b, a):
        raise Invalid("That would make a loop: the tasks would wait on each other")
    existing = db.scalars(select(TaskLink).where(TaskLink.task_id == a, TaskLink.other_id == b, TaskLink.kind == kind)).first()
    if existing is not None:
        return existing
    link = TaskLink(task_id=a, other_id=b, kind=kind, created_by=access.user_id)
    db.add(link)
    db.flush()
    label = {"relates": "linked", "waiting_on": "waiting_on", "blocking": "blocking"}[data.kind]
    events.record(db, task, access.user_id, "dependency", {"kind": label, "other": other.name})
    return link


def remove_link(db: Session, user_id: str, link_id: uuid.UUID) -> None:
    link = db.get(TaskLink, link_id)
    if link is None:
        raise NotFound("Link not found")
    levels = []
    for tid in (link.task_id, link.other_id):
        try:
            levels.append(open_task(db, user_id, tid, VIEW).level)
        except NotFound:
            continue
    if not any(level.at_least(PermissionLevel.edit) for level in levels):
        raise Forbidden("You need edit access to one of the tasks to remove this link")
    db.delete(link)
    db.flush()


def counts(db: Session, task_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, Dict[str, int]]:
    """Per task: open blockers it waits on, tasks it blocks, and plain links."""
    out: Dict[uuid.UUID, Dict[str, int]] = {}
    if not task_ids:
        return out
    ids = set(task_ids)
    rows = list(db.scalars(select(TaskLink).where(or_(TaskLink.task_id.in_(ids), TaskLink.other_id.in_(ids)))))
    finished = {
        tid for tid, group in db.execute(
            select(Task.id, Status.group).join(Status, Status.id == Task.status_id)
            .where(Task.id.in_({r.task_id for r in rows}))
        ) if group in FINISHED
    }
    for r in rows:
        if r.kind == "relates":
            for tid in (r.task_id, r.other_id):
                if tid in ids:
                    out.setdefault(tid, {}).setdefault("links", 0)
                    out[tid]["links"] += 1
            continue
        if r.other_id in ids and r.task_id not in finished:
            out.setdefault(r.other_id, {}).setdefault("waiting", 0)
            out[r.other_id]["waiting"] += 1
        if r.task_id in ids:
            out.setdefault(r.task_id, {}).setdefault("blocking", 0)
            out[r.task_id]["blocking"] += 1
    return out


# --- merging ------------------------------------------------------------------------------------


def merge(db: Session, user_id: str, target_id: uuid.UUID, source_ids: Sequence[uuid.UUID]) -> Task:
    opened = open_task(db, user_id, target_id, VIEW)
    target, access = opened.obj, opened.access
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to the task you merge into")
    sources: List[Task] = []
    for sid in dict.fromkeys(source_ids):
        if sid == target.id:
            continue
        src = open_task(db, user_id, sid, VIEW)
        if src.level != PermissionLevel.full:
            raise Forbidden(f"You need full access to “{src.obj.name}” to merge it away")
        below = task_service._descendants(src.obj, task_service._tree_rows(db, src.obj))
        if any(t.id == target.id for t in below):
            raise Invalid("A task can't be merged into one of its own subtasks")
        sources.append(src.obj)
    if not sources:
        raise Invalid("Choose at least one other task to merge")

    names = []
    for src in sources:
        if src.list_id != target.list_id:
            if src.parent_id is not None:
                raise Invalid(f"“{src.name}” is a subtask in another List; move it first")
            # Bring it (and its subtasks) into the kept task's List first: statuses, tags and IDs follow.
            task_service.move_task(db, open_task(db, user_id, src.id, VIEW), open_list(db, user_id, target.list_id, VIEW), {})
        names.append(src.name)
        _fold(db, access.user_id, src, target)
    db.flush()
    events.record(db, target, access.user_id, "merged", {"names": names})
    return target


def _fold(db: Session, actor: str, src: Task, target: Task) -> None:
    """Move everything from `src` onto `target`, then delete `src`."""
    for model in (TaskComment, Attachment, Checklist, TimeEntry, TaskActivity, Reminder):
        db.execute(update(model).where(model.task_id == src.id).values(task_id=target.id))
    # Subtasks come along, keeping their own subtasks.
    for child in list(db.scalars(select(Task).where(Task.parent_id == src.id))):
        child.parent_id = target.id
        root = target.top_level_parent_id or target.id
        for row in [child] + task_service._descendants(child, task_service._tree_rows(db, src)):
            row.top_level_parent_id = root
    # People, tags, watchers: the union of both.
    have = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == target.id)))
    for uid in db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == src.id)):
        if uid not in have:
            db.add(TaskAssignee(task_id=target.id, user_id=uid))
    have_tags = set(db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == target.id)))
    for tag_id in db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == src.id)):
        if tag_id not in have_tags:
            db.add(TaskTag(task_id=target.id, tag_id=tag_id))
    watching = set(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == target.id)))
    for uid in db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == src.id)):
        if uid not in watching:
            db.add(TaskWatcher(task_id=target.id, user_id=uid))
    # Field values fill in what the kept task doesn't have yet.
    filled = set(db.scalars(select(TaskFieldValue.field_id).where(TaskFieldValue.task_id == target.id)))
    for row in list(db.scalars(select(TaskFieldValue).where(TaskFieldValue.task_id == src.id))):
        if row.field_id not in filled:
            db.add(TaskFieldValue(task_id=target.id, field_id=row.field_id, value=row.value, updated_by=actor))
    # Links now point at the kept task (dropping ones that would link it to itself or repeat).
    for link in list(db.scalars(select(TaskLink).where(or_(TaskLink.task_id == src.id, TaskLink.other_id == src.id)))):
        a = target.id if link.task_id == src.id else link.task_id
        b = target.id if link.other_id == src.id else link.other_id
        duplicate = db.scalars(select(TaskLink).where(TaskLink.task_id == a, TaskLink.other_id == b, TaskLink.kind == link.kind, TaskLink.id != link.id)).first()
        if a == b or duplicate is not None:
            db.delete(link)
        else:
            link.task_id, link.other_id = a, b
    if src.description:
        target.description = f"{target.description or ''}\n\n---\nMerged from “{src.name}”:\n{src.description}".strip()
    db.flush()
    db.delete(src)
    db.flush()
