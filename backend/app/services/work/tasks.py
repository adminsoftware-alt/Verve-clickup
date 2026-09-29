"""Tasks and subtasks: creation, updates, moves, and listing with per-task permissions."""

import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    PermissionLevel,
    Space,
    Status,
    StatusGroup,
    Tag,
    Task,
    TaskAssignee,
    TaskGroup,
    TaskList,
    TaskTag,
    TaskType,
    User,
    WorkspaceMember,
    WorkspaceRole,
)
from app.core.config import settings
from app.schemas import work as s
from app.services.work.access import (
    Access,
    Opened,
    chain_for_list,
    chain_for_task,
    task_node,
)
from app.services.work import groups as task_groups
from app.services.work import comments as comment_service
from app.services.work import customfields, events, extras, recurrence
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import Node
from app.services.work.timetracking import tracked_totals
from app.services.work.statuses import (
    OPEN_GROUPS,
    apply_group_transition,
    default_status,
    effective_statuses,
    pick_replacement,
)

MAX_SUBTASK_DEPTH = 7
_TAG_PALETTE = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#12a594", "#0090ff", "#8e4ec6", "#d6409f"]


# --- helpers -----------------------------------------------------------------


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _space_of(db: Session, lst: TaskList) -> Space:
    space = db.get(Space, lst.space_id)
    assert space is not None
    return space


def _check_type(db: Session, access: Access, type_id: Optional[uuid.UUID]) -> Optional[uuid.UUID]:
    if type_id is None:
        return None
    kind = db.get(TaskType, type_id)
    if kind is None or kind.workspace_id != access.workspace_id:
        raise Invalid("Unknown task type")
    return type_id


def next_seq(db: Session, space_id: uuid.UUID) -> int:
    """The next custom task ID number in a Space ("HR-13"). Atomic under concurrent creates."""
    return db.execute(
        update(Space).where(Space.id == space_id).values(task_seq=Space.task_seq + 1).returning(Space.task_seq)
    ).scalar_one()


def renumber(db: Session, rows: Sequence[Task], space_id: uuid.UUID) -> None:
    """Tasks that move to another Space take that Space's IDs, as in ClickUp."""
    for row in rows:
        row.seq = next_seq(db, space_id)


def _check_assignees(
    db: Session, workspace_id: uuid.UUID, user_ids: Sequence[str], chain: Optional[List[Node]] = None,
) -> List[str]:
    unique = list(dict.fromkeys(user_ids))
    if not unique:
        return []
    rows = {
        m.user_id: m
        for m in db.scalars(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id,
                WorkspaceMember.user_id.in_(unique),
            )
        )
    }
    missing = [uid for uid in unique if uid not in rows]
    if missing:
        raise Invalid(f"Assignees must be workspace members: {', '.join(missing)}")
    if chain is not None:
        # Someone who can't open the List can't be given work in it; share it with them first.
        blind = [uid for uid in unique if Access(db, uid, workspace_id, rows[uid].role).level(chain) is None]
        if blind:
            names = [db.get(User, uid).display_name or uid for uid in blind]
            raise Invalid(f"{', '.join(names)} can't see this List. Share it with them first, then assign it.")
    return unique


def people_who_can_see(db: Session, opened: Opened) -> List[User]:
    """The workspace members who can open this Space, Folder or List: who work here can be given to."""
    chain = _chain_of(db, opened.obj)
    out = []
    for member, user in db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == opened.access.workspace_id, WorkspaceMember.deactivated_at.is_(None))
        .order_by(User.display_name, User.email)
    ):
        if Access(db, user.id, opened.access.workspace_id, member.role).level(chain) is not None:
            out.append(user)
    return out


def _chain_of(db: Session, obj) -> List[Node]:
    from app.services.work.access import chain_for_folder, chain_for_list, chain_for_space

    if isinstance(obj, TaskList):
        return chain_for_list(db, obj)
    if isinstance(obj, Folder):
        return chain_for_folder(db, obj)
    return chain_for_space(obj)


def _resolve_tags(db: Session, access: Access, space_id: uuid.UUID, names: Sequence[str]) -> List[Tag]:
    """Look tags up by name within the Space, creating missing ones (not allowed for guests)."""
    wanted = list(dict.fromkeys(n.strip() for n in names if n.strip()))
    if not wanted:
        return []
    existing = {
        tag.name.lower(): tag
        for tag in db.scalars(
            select(Tag).where(Tag.space_id == space_id, func.lower(Tag.name).in_([w.lower() for w in wanted]))
        )
    }
    result = []
    for name in wanted:
        tag = existing.get(name.lower())
        if tag is None:
            if access.role == WorkspaceRole.guest:
                raise Forbidden(f"Guests cannot create new tags: {name}")
            color = _TAG_PALETTE[zlib.crc32(name.lower().encode()) % len(_TAG_PALETTE)]
            tag = Tag(space_id=space_id, name=name, fg_color="#ffffff", bg_color=color)
            db.add(tag)
            db.flush()
            existing[name.lower()] = tag
        result.append(tag)
    return result


def _set_assignees(db: Session, task: Task, user_ids: Sequence[str]) -> None:
    current = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    wanted = set(user_ids)
    for uid in current - wanted:
        db.delete(db.get(TaskAssignee, (task.id, uid)))
    for uid in wanted - current:
        db.add(TaskAssignee(task_id=task.id, user_id=uid))


def _set_tags(db: Session, task: Task, tags: Sequence[Tag]) -> None:
    current = set(db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == task.id)))
    wanted = {t.id for t in tags}
    for tag_id in current - wanted:
        db.delete(db.get(TaskTag, (task.id, tag_id)))
    for tag_id in wanted - current:
        db.add(TaskTag(task_id=task.id, tag_id=tag_id))


def _tree_rows(db: Session, task: Task) -> List[Task]:
    """Every task in the same subtask tree as `task`, including the root."""
    root_id = task.top_level_parent_id or task.id
    return list(
        db.scalars(select(Task).where((Task.id == root_id) | (Task.top_level_parent_id == root_id)))
    )


def _descendants(task: Task, tree: Sequence[Task]) -> List[Task]:
    children: Dict[uuid.UUID, List[Task]] = {}
    for row in tree:
        if row.parent_id is not None:
            children.setdefault(row.parent_id, []).append(row)
    found, stack = [], list(children.get(task.id, []))
    while stack:
        row = stack.pop()
        found.append(row)
        stack.extend(children.get(row.id, []))
    return found


def _depth(db: Session, task: Task) -> int:
    """Number of ancestors: 0 for a top-level task."""
    depth, parent_id = 0, task.parent_id
    while parent_id is not None:
        depth += 1
        parent = db.get(Task, parent_id)
        assert parent is not None
        parent_id = parent.parent_id
    return depth


def _subtree_height(task: Task, tree: Sequence[Task]) -> int:
    children: Dict[uuid.UUID, List[Task]] = {}
    for row in tree:
        if row.parent_id is not None:
            children.setdefault(row.parent_id, []).append(row)

    def height(node_id: uuid.UUID) -> int:
        kids = children.get(node_id, [])
        return 0 if not kids else 1 + max(height(k.id) for k in kids)

    return height(task.id)


def _status_in(statuses: Sequence[Status], status_id: uuid.UUID) -> Status:
    for status in statuses:
        if status.id == status_id:
            return status
    raise Invalid("That status is not available in this List")


def _group_of(db: Session, status_id: uuid.UUID):
    status = db.get(Status, status_id)
    assert status is not None
    return status.group


def _check_clickapps(db: Session, space_id: uuid.UUID, data, fields) -> None:
    """Refuse values for features this Space has switched off (its ClickApps)."""
    from app.services.work import space_admin

    apps = space_admin.clickapps(db.get(Space, space_id))
    checks = (
        ("priority", "priorities", lambda v: v is not None),
        ("points", "sprint_points", lambda v: v is not None),
        ("time_estimate_seconds", "time_estimates", lambda v: v is not None),
        ("tags", "tags", lambda v: bool(v)),
        ("assignees", "multiple_assignees", lambda v: v is not None and len(set(v)) > 1),
    )
    for field, app, used in checks:
        if field in fields and not apps[app] and used(getattr(data, field)):
            raise Invalid(f"{space_admin.CLICKAPP_LABELS[app]} is turned off for this Space")


# --- create ------------------------------------------------------------------


def _check_details(data: s.TaskCreate) -> None:
    """A task somebody types in has to say who is on it, when it runs and how big it is.

    Without these, half the Dashboard is guessing: the workload card cannot place the task in a
    day, the priority chart fills up with "No priority", and the task lands in a backlog nobody
    revisits. Tasks the system makes for you -- from a template, a recurrence, an import or an
    incoming email -- are exempt, because there is nobody there to ask.
    """
    missing = []
    if not data.assignees:
        missing.append("an assignee")
    if data.start_date is None:
        missing.append("a start date")
    if data.due_date is None:
        missing.append("a due date")
    if data.time_estimate_seconds is None:
        missing.append("an estimate")
    if data.priority is None:
        missing.append("a priority")
    if not missing:
        return
    if len(missing) > 1:
        missing[-1] = f"and {missing[-1]}"
    raise Invalid(f"A new task needs {', '.join(missing) if len(missing) > 2 else ' '.join(missing)}.")


def create_task(
    db: Session, opened: Opened[TaskList], data: s.TaskCreate, *,
    check_assignee_access: bool = True, require_details: bool = False,
) -> Task:
    lst, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the List to create tasks in it")
    # Subtasks inherit their parent's plan, so only top-level work has to be filled in.
    if require_details and settings.REQUIRE_TASK_DETAILS and data.parent_id is None:
        _check_details(data)

    parent: Optional[Task] = None
    if data.parent_id is not None:
        parent = db.get(Task, data.parent_id)
        if parent is None or access.level(chain_for_task(db, parent)) is None:
            raise NotFound("Parent task not found")
        if parent.list_id != lst.id:
            raise Invalid("A subtask must be created in its parent's List")
        if _depth(db, parent) + 1 > MAX_SUBTASK_DEPTH:
            raise Invalid(f"Subtasks can be nested at most {MAX_SUBTASK_DEPTH} levels deep")

    _check_clickapps(db, lst.space_id, data, data.model_fields_set | {"assignees", "tags"})
    statuses = effective_statuses(db, lst)
    status = _status_in(statuses, data.status_id) if data.status_id else default_status(statuses)
    assignees = _check_assignees(
        db, access.workspace_id, data.assignees, chain_for_list(db, lst) if check_assignee_access else None,
    )
    tags = _resolve_tags(db, access, lst.space_id, data.tags)

    task = Task(
        list_id=lst.id,
        parent_id=parent.id if parent else None,
        top_level_parent_id=(parent.top_level_parent_id or parent.id) if parent else None,
        name=data.name,
        description=data.description,
        status_id=status.id,
        priority=data.priority,
        start_date=data.start_date,
        due_date=data.due_date,
        time_estimate_seconds=data.time_estimate_seconds,
        is_private=data.is_private,
        group_id=task_groups.check_for_list(db, lst, data.group_id),
        type_id=_check_type(db, access, data.type_id),
        points=data.points,
        seq=next_seq(db, lst.space_id),
        created_by=access.user_id,
        orderindex=(db.scalar(select(func.max(Task.orderindex)).where(Task.list_id == lst.id)) or 0.0) + 1.0,
    )
    apply_group_transition(task, None, status.group)
    if data.recurrence is not None:
        recurrence.set_rule(task, data.recurrence)
    db.add(task)
    db.flush()
    _set_assignees(db, task, assignees)
    _set_tags(db, task, tags)
    db.flush()
    if data.custom_fields:
        from app.services.work import customfields

        opened_task = Opened(task, access, PermissionLevel.full)
        for field_id, value in data.custom_fields.items():
            customfields.set_value(db, opened_task, field_id, value)
        db.flush()
    events.record(db, task, access.user_id, "created", {"list": lst.name})
    events.watch(db, task.id, [access.user_id])
    events.assigned(db, task, access.user_id, assignees)
    return task


# --- update ------------------------------------------------------------------


def _reparent(db: Session, opened: Opened[Task], new_parent_id: Optional[uuid.UUID]) -> None:
    task, access = opened.obj, opened.access
    if new_parent_id == task.parent_id:
        return
    tree = _tree_rows(db, task)
    descendants = _descendants(task, tree)

    if new_parent_id is None:
        new_root = task.id
        task.parent_id = None
        task.top_level_parent_id = None
    else:
        parent = db.get(Task, new_parent_id)
        if parent is None or access.level(chain_for_task(db, parent)) is None:
            raise NotFound("Parent task not found")
        if parent.id == task.id or parent.id in {d.id for d in descendants}:
            raise Invalid("A task cannot become a subtask of itself or of its own subtasks")
        if parent.list_id != task.list_id:
            raise Invalid("A subtask must be in its parent's List; move the task first")
        if _depth(db, parent) + 1 + _subtree_height(task, tree) > MAX_SUBTASK_DEPTH:
            raise Invalid(f"Subtasks can be nested at most {MAX_SUBTASK_DEPTH} levels deep")
        new_root = parent.top_level_parent_id or parent.id
        task.parent_id = parent.id
        task.top_level_parent_id = new_root
    for row in descendants:
        row.top_level_parent_id = new_root


def update_task(db: Session, opened: Opened[Task], data: s.TaskUpdate) -> Task:
    task, access = opened.obj, opened.access
    fields = data.model_fields_set
    if not opened.level.at_least(PermissionLevel.edit):
        # As in ClickUp, an assignee with comment access may still move their task along.
        is_assignee = db.get(TaskAssignee, (task.id, access.user_id)) is not None
        status_only = fields <= {"status_id"}
        if not (opened.level == PermissionLevel.comment and is_assignee and status_only):
            raise Forbidden("You need edit access to change this task")
    if "is_private" in fields and opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to change this task's privacy")

    for required in ("name", "status_id", "is_private", "orderindex", "archived"):
        if required in fields and getattr(data, required) is None:
            raise Invalid(f"{required} cannot be null")
    if "assignees" in fields and data.assignees is None:
        raise Invalid("Send an empty list to clear assignees")
    if "tags" in fields and data.tags is None:
        raise Invalid("Send an empty list to clear tags")

    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    _check_clickapps(db, lst.space_id, data, fields)
    before = _snapshot(db, task)

    for name in ("name", "description", "priority", "time_estimate_seconds", "orderindex", "points"):
        if name in fields:
            setattr(task, name, getattr(data, name))

    start = data.start_date if "start_date" in fields else task.start_date
    due = data.due_date if "due_date" in fields else task.due_date
    if start and due and due < start:
        raise Invalid("due_date must be on or after start_date")
    task.start_date, task.due_date = start, due
    recurrence.refresh_schedule(task)

    if "group_id" in fields:
        task.group_id = task_groups.check_for_list(db, lst, data.group_id)
    if "type_id" in fields:
        new_type = _check_type(db, access, data.type_id)
        if new_type != task.type_id:
            task.type_id = new_type
            kind = db.get(TaskType, new_type) if new_type else None
            events.record(db, task, access.user_id, "task_type", {"to": kind.name if kind else "Task"})
    if "recurrence" in fields:
        recurrence.set_rule(task, data.recurrence)

    if "status_id" in fields and data.status_id != task.status_id:
        assert data.status_id is not None
        new_status = _status_in(effective_statuses(db, lst), data.status_id)
        old_group = _group_of(db, task.status_id)
        apply_group_transition(task, old_group, new_status.group)
        task.status_id = new_status.id
        db.flush()
        recurrence.on_status_change(db, task, old_group, new_status.group, access.user_id)

    if "assignees" in fields:
        assert data.assignees is not None
        _set_assignees(db, task, _check_assignees(db, access.workspace_id, data.assignees, chain_for_task(db, task)))
    if "tags" in fields:
        assert data.tags is not None
        _set_tags(db, task, _resolve_tags(db, access, lst.space_id, data.tags))
    if "parent_id" in fields:
        _reparent(db, opened, data.parent_id)
    if "is_private" in fields:
        assert data.is_private is not None
        task.is_private = data.is_private
    if "archived" in fields:
        stamp = _now() if data.archived else None
        for row in [task] + _descendants(task, _tree_rows(db, task)):
            row.archived_at = stamp

    db.flush()
    _record_changes(db, task, access.user_id, before, _snapshot(db, task))
    return task


def _snapshot(db: Session, task: Task) -> dict:
    """What a task looks like now, for recording what an update changed."""
    status = db.get(Status, task.status_id)
    return {
        "name": task.name,
        "description": task.description,
        "status": (status.name, status.color) if status else None,
        "priority": task.priority,
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "time_estimate_seconds": task.time_estimate_seconds,
        "points": task.points,
        "group_id": str(task.group_id) if task.group_id else None,
        "recurrence": task.recurrence,
        "archived": task.archived_at is not None,
        "assignees": set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id))),
        "tags": sorted(db.scalars(select(Tag.name).join(TaskTag, TaskTag.tag_id == Tag.id).where(TaskTag.task_id == task.id))),
        "parent_id": str(task.parent_id) if task.parent_id else None,
    }


def _record_changes(db: Session, task: Task, actor: str, old: dict, new: dict) -> None:
    for key in ("name", "priority", "start_date", "due_date", "time_estimate_seconds", "points", "archived", "parent_id"):
        if old[key] != new[key]:
            events.record(db, task, actor, key, {"from": old[key], "to": new[key]})
    if old["description"] != new["description"]:
        events.record(db, task, actor, "description", {})
    if old["status"] != new["status"]:
        events.record(db, task, actor, "status", {
            "from": old["status"][0] if old["status"] else None, "to": new["status"][0] if new["status"] else None,
            "color": new["status"][1] if new["status"] else None,
        })
    if old["group_id"] != new["group_id"]:
        group = db.get(TaskGroup, uuid.UUID(new["group_id"])) if new["group_id"] else None
        events.record(db, task, actor, "group", {"to": group.name if group else None})
    if old["recurrence"] != new["recurrence"]:
        events.record(db, task, actor, "recurrence", {"on": new["recurrence"] is not None})
    if old["tags"] != new["tags"]:
        events.record(db, task, actor, "tags", {"added": sorted(set(new["tags"]) - set(old["tags"])),
                                                "removed": sorted(set(old["tags"]) - set(new["tags"]))})
    added, removed = new["assignees"] - old["assignees"], old["assignees"] - new["assignees"]
    if added or removed:
        events.record(db, task, actor, "assignees", {"added": sorted(added), "removed": sorted(removed)})
        events.assigned(db, task, actor, sorted(added))


# --- move --------------------------------------------------------------------


def move_task(
    db: Session,
    opened: Opened[Task],
    target: Opened[TaskList],
    status_mapping: Dict[uuid.UUID, uuid.UUID],
) -> Task:
    task, access = opened.obj, opened.access
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to move this task")
    if target.level != PermissionLevel.full:
        raise Forbidden("You need full access to the destination List")
    if task.parent_id is not None:
        raise Invalid("Subtasks move with their parent; detach it first to move it on its own")
    if target.access.workspace_id != access.workspace_id:
        raise Invalid("Tasks cannot be moved between workspaces")
    if target.obj.id == task.list_id:
        return task

    source_list = db.get(TaskList, task.list_id)
    assert source_list is not None
    new_list = target.obj
    tree = [task] + _descendants(task, _tree_rows(db, task))
    candidates = effective_statuses(db, new_list)
    candidate_ids = {c.id for c in candidates}
    now = _now()
    base = db.scalar(select(func.max(Task.orderindex)).where(Task.list_id == new_list.id)) or 0.0

    for offset, row in enumerate(tree):
        if row.status_id not in candidate_ids:
            old = db.get(Status, row.status_id)
            assert old is not None
            replacement = pick_replacement(old.id, old.name, old.group, candidates, status_mapping)
            apply_group_transition(row, old.group, replacement.group, now)
            row.status_id = replacement.id
        row.list_id = new_list.id
        if row.id == task.id:
            row.orderindex = base + 1.0 + offset

    usable = {g.id for g in task_groups.available(db, new_list)}
    for row in tree:
        if row.group_id is not None and row.group_id not in usable:
            row.group_id = None
    if new_list.space_id != source_list.space_id:
        _carry_tags(db, access, tree, new_list.space_id)
        renumber(db, tree, new_list.space_id)
    db.flush()
    _drop_blind_assignees(db, access.workspace_id, tree)
    db.flush()
    from app.services.work import multilist

    multilist.forget_home(db, task.id, new_list.id)
    events.record(db, task, access.user_id, "moved", {"from": source_list.name, "to": new_list.name})
    return task


def _carry_tags(db: Session, access: Access, tree: Sequence[Task], space_id: uuid.UUID) -> None:
    """Tags are per Space, so moved tasks take their tags with them by name."""
    ids = [t.id for t in tree]
    rows = db.execute(
        select(TaskTag.task_id, Tag.name).join(Tag, Tag.id == TaskTag.tag_id).where(TaskTag.task_id.in_(ids))
    ).all()
    names_by_task: Dict[uuid.UUID, List[str]] = {}
    for task_id, name in rows:
        names_by_task.setdefault(task_id, []).append(name)
    for row in tree:
        names = names_by_task.get(row.id, [])
        _set_tags(db, row, _resolve_tags(db, access, space_id, names) if names else [])


def _drop_blind_assignees(db: Session, workspace_id: uuid.UUID, tree: Sequence[Task]) -> None:
    """After a move, assignees who can no longer see a task are unassigned from it."""
    ids = [t.id for t in tree]
    pairs = db.execute(select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(ids))).all()
    by_id = {t.id: t for t in tree}
    access_cache: Dict[str, Optional[Access]] = {}
    for task_id, user_id in pairs:
        if user_id not in access_cache:
            try:
                access_cache[user_id] = Access.for_workspace(db, user_id, workspace_id)
            except NotFound:
                access_cache[user_id] = None
        user_access = access_cache[user_id]
        if user_access is None or user_access.level(chain_for_task(db, by_id[task_id])) is None:
            db.delete(db.get(TaskAssignee, (task_id, user_id)))


# --- delete ------------------------------------------------------------------


def delete_task(db: Session, opened: Opened[Task]) -> None:
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to delete this task")
    db.delete(opened.obj)  # subtasks cascade
    db.flush()


# --- reading -----------------------------------------------------------------


def _is_overdue(task: Task, status: Status, now: datetime) -> bool:
    return task.due_date is not None and task.due_date < now and status.group in OPEN_GROUPS


def serialise_tasks(
    db: Session, tasks: Sequence[Task], levels: Dict[uuid.UUID, PermissionLevel]
) -> List[s.TaskOut]:
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks})))}

    assignees: Dict[uuid.UUID, List[User]] = {}
    for task_id, user in db.execute(
        select(TaskAssignee.task_id, User)
        .join(User, User.id == TaskAssignee.user_id)
        .where(TaskAssignee.task_id.in_(ids))
        .order_by(User.email)
    ):
        assignees.setdefault(task_id, []).append(user)

    tags: Dict[uuid.UUID, List[Tag]] = {}
    for task_id, tag in db.execute(
        select(TaskTag.task_id, Tag).join(Tag, Tag.id == TaskTag.tag_id).where(TaskTag.task_id.in_(ids)).order_by(Tag.name)
    ):
        tags.setdefault(task_id, []).append(tag)

    tracked = tracked_totals(db, ids)
    comment_counts = comment_service.counts(db, ids)
    attachment_counts = extras.counts(db, ids)
    checklist = extras.progress(db, ids)
    field_values = customfields.values_for(db, ids)
    from app.services.work import links as link_service  # links imports this module

    link_counts = link_service.counts(db, ids)
    prefixes = dict(db.execute(
        select(TaskList.id, Space.task_prefix).join(Space, Space.id == TaskList.space_id)
        .where(TaskList.id.in_({t.list_id for t in tasks}))
    ).all())
    group_ids = {t.group_id for t in tasks if t.group_id}
    group_refs = {
        g.id: s.TaskGroupRef(id=g.id, name=g.name, color=g.color)
        for g in db.scalars(select(TaskGroup).where(TaskGroup.id.in_(group_ids)))
    } if group_ids else {}

    from app.services.work import multilist

    extra_lists = multilist.extra_lists_for(db, ids)
    subtask_counts = dict(
        db.execute(
            select(Task.parent_id, func.count())
            .where(Task.parent_id.in_(ids), Task.archived_at.is_(None))
            .group_by(Task.parent_id)
        ).all()
    )

    now = _now()
    out = []
    for task in tasks:
        status = statuses[task.status_id]
        out.append(
            s.TaskOut(
                id=task.id,
                list_id=task.list_id,
                parent_id=task.parent_id,
                top_level_parent_id=task.top_level_parent_id,
                name=task.name,
                description=task.description,
                status=s.StatusOut.model_validate(status),
                priority=task.priority,
                start_date=task.start_date,
                due_date=task.due_date,
                time_estimate_seconds=task.time_estimate_seconds,
                time_tracked_seconds=tracked.get(task.id, 0),
                is_private=task.is_private,
                orderindex=task.orderindex,
                created_by=task.created_by,
                created_at=task.created_at,
                updated_at=task.updated_at,
                date_done=task.date_done,
                date_closed=task.date_closed,
                archived=task.archived_at is not None,
                is_overdue=_is_overdue(task, status, now),
                group=group_refs.get(task.group_id) if task.group_id else None,
                recurrence=s.Recurrence.model_validate(task.recurrence) if task.recurrence else None,
                recurs_from_id=task.recurs_from_id,
                custom_id=f"{prefixes.get(task.list_id) or 'T'}-{task.seq}" if task.seq else None,
                type_id=task.type_id,
                waiting_on_open=link_counts.get(task.id, {}).get("waiting", 0),
                blocking_count=link_counts.get(task.id, {}).get("blocking", 0),
                link_count=link_counts.get(task.id, {}).get("links", 0),
                comment_count=comment_counts.get(task.id, 0),
                attachment_count=attachment_counts.get(task.id, 0),
                checklist_done=checklist.get(task.id, (0, 0))[0],
                checklist_total=checklist.get(task.id, (0, 0))[1],
                custom_fields=field_values.get(task.id, {}),
                assignees=[s.UserOut.model_validate(u) for u in assignees.get(task.id, [])],
                tags=[s.TagOut.model_validate(t) for t in tags.get(task.id, [])],
                subtask_count=subtask_counts.get(task.id, 0),
                permission_level=levels[task.id],
                points=task.points,
                extra_list_ids=extra_lists.get(task.id, []),
            )
        )
    return out


def task_detail(db: Session, opened: Opened[Task]) -> s.TaskDetailOut:
    task = opened.obj
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    space = _space_of(db, lst)
    folder = db.get(Folder, lst.folder_id) if lst.folder_id else None
    base = serialise_tasks(db, [task], {task.id: opened.level})[0]
    return s.TaskDetailOut(
        **base.model_dump(),
        location=s.TaskLocation(
            space=s.LocationRef(id=space.id, name=space.name),
            folder=s.LocationRef(id=folder.id, name=folder.name) if folder else None,
            list=s.LocationRef(id=lst.id, name=lst.name),
        ),
        fields=[customfields.field_out(f) for f in customfields.available(db, lst)],
    )


@dataclass
class TaskFilter:
    include_closed: bool = False
    include_archived: bool = False
    include_subtasks: bool = True
    # Calendar window: keep tasks whose start or due date falls in [date_from, date_to).
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None


def visible_lists(db: Session, opened: Opened) -> List[Tuple[TaskList, List[Node]]]:
    """The non-archived Lists inside a Space, Folder or List that the caller can open."""
    obj, access = opened.obj, opened.access
    if isinstance(obj, TaskList):
        candidates = [obj]
    elif isinstance(obj, Space):
        candidates = list(db.scalars(select(TaskList).where(TaskList.space_id == obj.id)))
    else:
        folder_ids = [obj.id] + list(db.scalars(select(Folder.id).where(Folder.parent_folder_id == obj.id)))
        candidates = list(db.scalars(select(TaskList).where(TaskList.folder_id.in_(folder_ids))))
    result = []
    for lst in sorted(candidates, key=lambda item: (item.orderindex, item.name.lower())):
        if lst.archived_at is not None and lst is not obj:
            continue
        folder = db.get(Folder, lst.folder_id) if lst.folder_id else None
        if folder is not None and folder.archived_at is not None and folder is not obj:
            continue
        chain = chain_for_list(db, lst)
        if access.level(chain) is not None:
            result.append((lst, chain))
    return result


def _in_window(task: Task, f: TaskFilter) -> bool:
    if f.date_from is None and f.date_to is None:
        return True
    for day in (task.start_date, task.due_date):
        if day is None:
            continue
        if (f.date_from is None or day >= f.date_from) and (f.date_to is None or day < f.date_to):
            return True
    return False


def visible_tasks(
    db: Session, access: Access, lists: Sequence[Tuple[TaskList, List[Node]]], f: TaskFilter
) -> Tuple[List[Task], Dict[uuid.UUID, PermissionLevel], Dict[uuid.UUID, StatusGroup]]:
    """Tasks in the given Lists that the caller may see, in list order then manual order.

    Subtasks always share their parent's List, so loading a List's tasks gives every
    task's full ancestry and permissions resolve exactly, without extra queries.
    """
    if not lists:
        return [], {}, {}
    chain_by_list = {lst.id: chain for lst, chain in lists}
    position = {lst.id: i for i, (lst, _) in enumerate(lists)}
    rows = list(
        db.execute(
            select(Task, Status.group)
            .join(Status, Status.id == Task.status_id)
            .where(Task.list_id.in_(list(chain_by_list)))
        ).all()
    )
    # Tasks whose home is elsewhere but that were added to one of these Lists too.
    from app.services.work.multilist import linked_rows

    via: Dict[uuid.UUID, uuid.UUID] = {}
    for task, group, list_id in linked_rows(db, list(chain_by_list)):
        if task.id not in via:
            via[task.id] = list_id
            rows.append((task, group))
    rows.sort(key=lambda r: (position[via.get(r[0].id, r[0].list_id)], r[0].orderindex, r[0].created_at, str(r[0].id)))
    by_id = {task.id: task for task, _ in rows}

    def ancestry(task: Task) -> List[Node]:
        chain = [task_node(task)]
        parent_id = task.parent_id
        while parent_id is not None:
            parent = by_id[parent_id]
            chain.append(task_node(parent))
            parent_id = parent.parent_id
        return chain

    levels: Dict[uuid.UUID, PermissionLevel] = {}
    groups: Dict[uuid.UUID, StatusGroup] = {}
    visible: List[Task] = []
    for task, group in rows:
        if not f.include_archived and task.archived_at is not None:
            continue
        if not f.include_closed and group == StatusGroup.closed:
            continue
        if not f.include_subtasks and task.parent_id is not None:
            continue
        if not _in_window(task, f):
            continue
        if task.id in via:
            # Seen through the extra List; its home List may still grant more.
            from app.services.work.access import best_task_level

            level = best_task_level(db, access, task)
        else:
            level = access.level(ancestry(task) + chain_by_list[task.list_id])
        if level is None:
            continue
        levels[task.id] = level
        groups[task.id] = group
        visible.append(task)
    return visible, levels, groups


def location_tasks(db: Session, opened: Opened, f: TaskFilter, limit: int, offset: int) -> s.TaskPage:
    """Tasks the caller can see anywhere inside a Space, Folder or List."""
    tasks, levels, _ = visible_tasks(db, opened.access, visible_lists(db, opened), f)
    return s.TaskPage(
        tasks=serialise_tasks(db, tasks[offset : offset + limit], levels),
        total=len(tasks),
        limit=limit,
        offset=offset,
    )


# --- dashboard ---------------------------------------------------------------

_BUCKET_SIZE = 50
_FAR_FUTURE = datetime.max.replace(tzinfo=timezone.utc)


def _bucket(tasks: Sequence[Task], statuses: Dict[uuid.UUID, Status]) -> s.TaskBucket:
    ordered = sorted(tasks, key=lambda t: (t.due_date or _FAR_FUTURE, t.name.lower()))
    return s.TaskBucket(
        count=len(tasks),
        tasks=[
            s.TaskSummary(
                id=t.id,
                name=t.name,
                list_id=t.list_id,
                due_date=t.due_date,
                status=s.StatusOut.model_validate(statuses[t.status_id]),
            )
            for t in ordered[:_BUCKET_SIZE]
        ],
    )


def dashboard(db: Session, opened: Opened, day_start: datetime) -> s.DashboardOut:
    """The review metrics from Verve's dashboard SOP, for one Space, Folder or List."""
    tasks, _, groups = visible_tasks(
        db, opened.access, visible_lists(db, opened), TaskFilter(include_closed=True)
    )
    statuses: Dict[uuid.UUID, Status] = {}
    assignees: Dict[uuid.UUID, List[str]] = {}
    users: Dict[str, User] = {}
    if tasks:
        statuses = {
            st.id: st
            for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks})))
        }
        for task_id, user in db.execute(
            select(TaskAssignee.task_id, User)
            .join(User, User.id == TaskAssignee.user_id)
            .where(TaskAssignee.task_id.in_([t.id for t in tasks]))
        ):
            assignees.setdefault(task_id, []).append(user.id)
            users[user.id] = user

    now = _now()
    open_tasks = [t for t in tasks if groups[t.id] in OPEN_GROUPS]
    finished_today = [
        t
        for t in tasks
        if groups[t.id] in (StatusGroup.done, StatusGroup.closed)
        and t.date_done is not None
        and t.date_done >= day_start
    ]

    by_status: Dict[Tuple[str, StatusGroup], s.StatusCount] = {}
    for t in tasks:
        if groups[t.id] == StatusGroup.closed:
            continue  # closed work piles up forever and would swamp the chart
        st = statuses[t.status_id]
        key = (st.name.lower(), st.group)
        if key not in by_status:
            by_status[key] = s.StatusCount(name=st.name, color=st.color, group=st.group, count=0)
        by_status[key].count += 1

    per_user: Dict[Optional[str], int] = {}
    for t in open_tasks:
        for uid in assignees.get(t.id) or [None]:
            per_user[uid] = per_user.get(uid, 0) + 1

    group_order = [StatusGroup.not_started, StatusGroup.active, StatusGroup.done]
    return s.DashboardOut(
        total_open=len(open_tasks),
        done_today=_bucket(finished_today, statuses),
        overdue=_bucket([t for t in open_tasks if t.due_date and t.due_date < now], statuses),
        unassigned=_bucket([t for t in open_tasks if not assignees.get(t.id)], statuses),
        no_estimate=_bucket([t for t in open_tasks if t.time_estimate_seconds is None], statuses),
        unscheduled=_bucket(
            [t for t in open_tasks if t.start_date is None and t.due_date is None], statuses
        ),
        by_status=sorted(by_status.values(), key=lambda c: (group_order.index(c.group), -c.count)),
        by_assignee=sorted(
            (
                s.AssigneeCount(user=s.UserOut.model_validate(users[uid]) if uid else None, count=n)
                for uid, n in per_user.items()
            ),
            key=lambda c: -c.count,
        ),
    )
