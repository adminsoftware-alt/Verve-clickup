"""Moving and duplicating Lists, Folders and tasks, as in ClickUp.

Moving a List or Folder keeps its tasks. What depends on the location is repaired:
  * statuses: tasks whose status the new location doesn't have are remapped (same name,
    then same group, then the first status), as when a task is moved;
  * tags belong to a Space, so moving to another Space carries tags over by name;
  * task groups the new location can't use are cleared.
Duplicating copies the structure and tasks (with subtasks, assignees, tags, groups and
repeat rules) but not time entries, comments or shares; the copy is created by, and so
fully accessible to, whoever duplicates it.
"""

import uuid
from typing import Dict, List, Optional, Sequence, Union

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    PermissionLevel,
    Space,
    Status,
    Task,
    TaskAssignee,
    TaskGroup,
    TaskList,
    TaskTag,
)
from app.services.work import customfields, events, extras
from app.services.work import groups as task_groups
from app.services.work.access import Access, Opened
from app.services.work.errors import Forbidden, Invalid
from app.services.work.hierarchy import _next_orderindex
from app.services.work.mywork import ensure_not_personal
from app.services.work.tasks import _carry_tags, next_seq, renumber
from app.services.work.statuses import apply_group_transition, effective_statuses, pick_replacement
from app.services.work.views import add_required_views

Container = Union[Space, Folder]


def _require_full(opened: Opened, what: str) -> None:
    if opened.level != PermissionLevel.full:
        raise Forbidden(f"You need full access to {what}")


def _space_of(obj: Union[Space, Folder, TaskList]) -> uuid.UUID:
    return obj.id if isinstance(obj, Space) else obj.space_id


# --- repairs after a move ---------------------------------------------------------------


def _repair(db: Session, access: Access, lists: Sequence[TaskList], space_changed: bool) -> None:
    for lst in lists:
        allowed = effective_statuses(db, lst)
        allowed_ids = {s.id for s in allowed}
        rows = list(db.scalars(select(Task).where(Task.list_id == lst.id)))
        for task in rows:
            if task.status_id not in allowed_ids:
                old = db.get(Status, task.status_id)
                assert old is not None
                new = pick_replacement(old.id, old.name, old.group, allowed, {})
                apply_group_transition(task, old.group, new.group)
                task.status_id = new.id
        usable = {g.id for g in task_groups.available(db, lst)}
        for task in rows:
            if task.group_id is not None and task.group_id not in usable:
                task.group_id = None
        if space_changed and rows:
            _carry_tags(db, access, rows, lst.space_id)
            renumber(db, sorted(rows, key=lambda t: t.created_at), lst.space_id)
    db.flush()


def move_list(db: Session, opened: Opened[TaskList], target: Opened) -> TaskList:
    lst = opened.obj
    ensure_not_personal(db, lst, "moved")
    _require_full(opened, "move this List")
    _require_full(target, "the place you are moving it to")
    dest = target.obj
    ensure_not_personal(db, dest, "given more Lists")
    if target.access.workspace_id != opened.access.workspace_id:
        raise Invalid("Lists can only move within the workspace")
    old_space = lst.space_id
    new_space = _space_of(dest)
    lst.space_id = new_space
    lst.folder_id = dest.id if isinstance(dest, Folder) else None
    lst.orderindex = _next_orderindex(
        db, TaskList.orderindex, TaskList.space_id == new_space,
        TaskList.folder_id == lst.folder_id if lst.folder_id else TaskList.folder_id.is_(None),
    )
    db.flush()
    _repair(db, opened.access, [lst], old_space != new_space)
    return lst


def move_folder(db: Session, opened: Opened[Folder], target: Opened) -> Folder:
    folder = opened.obj
    ensure_not_personal(db, folder, "moved")
    _require_full(opened, "move this Folder")
    _require_full(target, "the place you are moving it to")
    dest = target.obj
    ensure_not_personal(db, dest, "given Folders")
    if target.access.workspace_id != opened.access.workspace_id:
        raise Invalid("Folders can only move within the workspace")
    children = list(db.scalars(select(Folder).where(Folder.parent_folder_id == folder.id)))
    if isinstance(dest, Folder):
        if dest.id == folder.id or dest.parent_folder_id is not None:
            raise Invalid("A Folder can only go inside a top-level Folder")
        if children:
            raise Invalid("This Folder has Subfolders, so it can't become a Subfolder itself")
    old_space = folder.space_id
    new_space = _space_of(dest)
    folder.space_id = new_space
    folder.parent_folder_id = dest.id if isinstance(dest, Folder) else None
    folder.orderindex = _next_orderindex(db, Folder.orderindex, Folder.space_id == new_space)
    folder_ids = [folder.id] + [c.id for c in children]
    for child in children:
        child.space_id = new_space
    lists = list(db.scalars(select(TaskList).where(TaskList.folder_id.in_(folder_ids))))
    for lst in lists:
        lst.space_id = new_space
    db.flush()
    _repair(db, opened.access, lists, old_space != new_space)
    return folder


# --- duplicating ---------------------------------------------------------------------------


def _copy_task_tree(
    db: Session,
    root: Task,
    target_list: TaskList,
    actor: str,
    name: Optional[str] = None,
    include_subtasks: bool = True,
    status_map: Optional[Dict[uuid.UUID, uuid.UUID]] = None,
    group_map: Optional[Dict[uuid.UUID, uuid.UUID]] = None,
    parent: Optional[Task] = None,
) -> Task:
    """Copy one task (and optionally its subtasks) into `target_list`."""
    status_map = status_map or {}
    group_map = group_map or {}
    status_id = status_map.get(root.status_id, root.status_id)
    allowed = effective_statuses(db, target_list)
    if status_id not in {s.id for s in allowed}:
        old = db.get(Status, root.status_id)
        assert old is not None
        status_id = pick_replacement(old.id, old.name, old.group, allowed, {}).id
    group_id = group_map.get(root.group_id, root.group_id) if root.group_id else None
    if group_id is not None and group_id not in {g.id for g in task_groups.available(db, target_list)}:
        group_id = None
    copy = Task(
        list_id=target_list.id,
        parent_id=parent.id if parent else None,
        top_level_parent_id=(parent.top_level_parent_id or parent.id) if parent else None,
        name=name or root.name,
        description=root.description,
        status_id=status_id,
        priority=root.priority,
        start_date=root.start_date,
        due_date=root.due_date,
        time_estimate_seconds=root.time_estimate_seconds,
        is_private=root.is_private,
        group_id=group_id,
        recurrence=root.recurrence,
        recurrence_next_at=root.recurrence_next_at,
        created_by=actor,
        type_id=root.type_id,
        seq=next_seq(db, target_list.space_id),
        orderindex=(db.scalar(select(func.max(Task.orderindex)).where(Task.list_id == target_list.id)) or 0.0) + 1.0,
    )
    new_status = db.get(Status, status_id)
    assert new_status is not None
    apply_group_transition(copy, None, new_status.group)
    copy.date_done, copy.date_closed = root.date_done, root.date_closed
    db.add(copy)
    db.flush()
    assignee_ids = list(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == root.id)))
    for user_id in assignee_ids:
        db.add(TaskAssignee(task_id=copy.id, user_id=user_id))
    events.record(db, copy, actor, "created", {"list": target_list.name, "copied_from": root.name})
    events.watch(db, copy.id, [actor, *assignee_ids])
    if target_list.space_id == db.get(TaskList, root.list_id).space_id:  # type: ignore[union-attr]
        for tag_id in db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == root.id)):
            db.add(TaskTag(task_id=copy.id, tag_id=tag_id))
    extras.copy_task_extras(db, root, copy)
    customfields.copy_values(db, root, copy)
    if include_subtasks:
        for child in db.scalars(
            select(Task).where(Task.parent_id == root.id, Task.archived_at.is_(None)).order_by(Task.orderindex)
        ):
            _copy_task_tree(db, child, target_list, actor, None, True, status_map, group_map, copy)
    db.flush()
    return copy


def duplicate_task(
    db: Session, opened: Opened[Task], target: Opened[TaskList], name: Optional[str], include_subtasks: bool
) -> Task:
    if not opened.level.at_least(PermissionLevel.view):
        raise Forbidden("You can't see this task")
    _require_full(target, "create tasks in that List")
    task = opened.obj
    return _copy_task_tree(
        db, task, target.obj, opened.access.user_id, name or f"{task.name} (copy)", include_subtasks,
        parent=db.get(Task, task.parent_id) if task.parent_id and target.obj.id == task.list_id else None,
    )


def _copy_own_statuses(db: Session, source, target) -> Dict[uuid.UUID, uuid.UUID]:
    """Copy statuses owned by `source` onto `target`; returns old id -> new id."""
    mapping: Dict[uuid.UUID, uuid.UUID] = {}
    column = {Space: Status.space_id, Folder: Status.folder_id, TaskList: Status.list_id}[type(source)]
    own = list(db.scalars(select(Status).where(column == source.id).order_by(Status.orderindex)))
    if not own:
        return mapping
    field = column.key
    for st in own:
        new = Status(name=st.name, color=st.color, group=st.group, orderindex=st.orderindex, **{field: target.id})
        db.add(new)
        db.flush()
        mapping[st.id] = new.id
    if hasattr(target, "override_statuses"):
        target.override_statuses = True
    return mapping


def _copy_own_groups(db: Session, source, target, actor: str) -> Dict[uuid.UUID, uuid.UUID]:
    column = {Folder: TaskGroup.folder_id, TaskList: TaskGroup.list_id}[type(source)]
    mapping = {}
    for g in db.scalars(select(TaskGroup).where(column == source.id)):
        new = TaskGroup(name=g.name, color=g.color, orderindex=g.orderindex, created_by=actor, **{column.key: target.id})
        db.add(new)
        db.flush()
        mapping[g.id] = new.id
    return mapping


def _copy_list(
    db: Session, lst: TaskList, space_id: uuid.UUID, folder_id: Optional[uuid.UUID], actor: str, name: str,
    include_tasks: bool, status_map: Dict[uuid.UUID, uuid.UUID], group_map: Dict[uuid.UUID, uuid.UUID],
) -> TaskList:
    copy = TaskList(
        space_id=space_id, folder_id=folder_id, name=name, description=lst.description, color=lst.color,
        is_private=lst.is_private, created_by=actor,
        orderindex=_next_orderindex(
            db, TaskList.orderindex, TaskList.space_id == space_id,
            TaskList.folder_id == folder_id if folder_id else TaskList.folder_id.is_(None),
        ),
    )
    db.add(copy)
    db.flush()
    statuses = {**status_map, **_copy_own_statuses(db, lst, copy)} if lst.override_statuses else dict(status_map)
    groups = {**group_map, **_copy_own_groups(db, lst, copy, actor)}
    add_required_views(db, copy, actor)
    if include_tasks:
        for task in db.scalars(
            select(Task).where(Task.list_id == lst.id, Task.parent_id.is_(None), Task.archived_at.is_(None)).order_by(Task.orderindex)
        ):
            _copy_task_tree(db, task, copy, actor, None, True, statuses, groups)
    db.flush()
    return copy


def duplicate_list(db: Session, opened: Opened[TaskList], parent: Opened, name: Optional[str], include_tasks: bool) -> TaskList:
    lst = opened.obj
    ensure_not_personal(db, lst, "duplicated")
    _require_full(parent, "add Lists there")
    return _copy_list(
        db, lst, lst.space_id, lst.folder_id, opened.access.user_id, name or f"{lst.name} (copy)", include_tasks, {}, {},
    )


def duplicate_folder(db: Session, opened: Opened[Folder], parent: Opened, name: Optional[str], include_tasks: bool) -> Folder:
    folder = opened.obj
    ensure_not_personal(db, folder, "duplicated")
    _require_full(parent, "add Folders there")
    actor = opened.access.user_id

    def copy_folder(src: Folder, parent_id: Optional[uuid.UUID], new_name: str) -> Folder:
        new = Folder(
            space_id=src.space_id, parent_folder_id=parent_id, name=new_name, color=src.color,
            is_private=src.is_private, created_by=actor,
            orderindex=_next_orderindex(db, Folder.orderindex, Folder.space_id == src.space_id),
        )
        db.add(new)
        db.flush()
        statuses = _copy_own_statuses(db, src, new) if src.override_statuses else {}
        groups = _copy_own_groups(db, src, new, actor)
        add_required_views(db, new, actor)
        for sub in db.scalars(select(Folder).where(Folder.parent_folder_id == src.id, Folder.archived_at.is_(None))):
            copy_folder(sub, new.id, sub.name)
        for lst in db.scalars(select(TaskList).where(TaskList.folder_id == src.id, TaskList.archived_at.is_(None)).order_by(TaskList.orderindex)):
            _copy_list(db, lst, new.space_id, new.id, actor, lst.name, include_tasks, statuses, groups)
        return new

    return copy_folder(folder, folder.parent_folder_id, name or f"{folder.name} (copy)")
