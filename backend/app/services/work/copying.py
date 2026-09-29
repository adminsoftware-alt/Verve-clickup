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

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    PermissionLevel,
    Space,
    Status,
    Task,
    TaskAssignee,
    TaskComment,
    TaskGroup,
    TaskLink,
    TaskList,
    TaskTag,
    TaskWatcher,
)
from app.schemas import work as s
from app.services.work import customfields, events, extras
from app.services.work import groups as task_groups
from app.services.work.access import Access, Opened
from app.services.work.errors import Forbidden, Invalid
from app.services.work.hierarchy import _next_orderindex
from app.services.work.mywork import ensure_not_personal
from app.services.work.tasks import _carry_tags, next_seq, renumber
from app.services.work.statuses import apply_group_transition, default_status, effective_statuses, pick_replacement
from app.services.work.views import add_required_views

Container = Union[Space, Folder]


def _require_full(opened: Opened, what: str) -> None:
    if opened.level != PermissionLevel.full:
        raise Forbidden(f"You need full access to {what}")


def _require_manager(access: Access, what: str) -> None:
    """Copying a Folder or a List makes a new part of the firm's structure, so it is a manager's.

    Access alone is not the test: everyone who can see a public Space resolves to full access on
    everything inside it, so without this any intern could duplicate a 141-task Folder and leave
    the sidebar with two of everything. Duplicating a task is still anyone's -- that is one row,
    in a List they already work in.
    """
    from app.services.work.permissions import is_manager

    if not is_manager(access.db, access.workspace_id, access.user_id, access.role):
        raise Forbidden(f"Only admins and managers can duplicate a {what}.")


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


def _copy_comments(db: Session, root: Task, copy: Task) -> None:
    """The conversation, kept in order and still in the names of the people who said it.

    Replies point at the first comment of their thread, so the parents are mapped as we go.
    Nobody is notified: these were read when they were written.
    """
    mapping: Dict[uuid.UUID, uuid.UUID] = {}
    for c in db.scalars(select(TaskComment).where(TaskComment.task_id == root.id).order_by(TaskComment.created_at)):
        new = TaskComment(
            task_id=copy.id, parent_id=mapping.get(c.parent_id) if c.parent_id else None, user_id=c.user_id,
            body=c.body, mention_user_ids=list(c.mention_user_ids), mention_team_ids=list(c.mention_team_ids),
            assignee_id=c.assignee_id, resolved_at=c.resolved_at, resolved_by=c.resolved_by,
        )
        db.add(new)
        db.flush()
        mapping[c.id] = new.id


def _copy_links(db: Session, root: Task, copy: Task) -> None:
    """Who the task waits on, blocks and relates to. Links to itself are dropped."""
    for link in db.scalars(select(TaskLink).where(or_(TaskLink.task_id == root.id, TaskLink.other_id == root.id))):
        task_id = copy.id if link.task_id == root.id else link.task_id
        other_id = copy.id if link.other_id == root.id else link.other_id
        if task_id == other_id:
            continue
        db.add(TaskLink(task_id=task_id, other_id=other_id, kind=link.kind, created_by=copy.created_by))
    db.flush()


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
    parts: Optional[s.CopyParts] = None,
) -> Task:
    """Copy one task (and optionally its subtasks) into `target_list`.

    `parts` says what comes along; leaving it out carries everything a duplicate used to carry,
    so every existing caller -- repeats, List and Folder copies, templates -- is unchanged.
    """
    parts = parts or s.CopyParts(comments=False)
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
        start_date=root.start_date if parts.dates else None,
        due_date=root.due_date if parts.dates else None,
        time_estimate_seconds=root.time_estimate_seconds,
        is_private=root.is_private,
        group_id=group_id,
        recurrence=root.recurrence if parts.recurrence else None,
        recurrence_next_at=root.recurrence_next_at if parts.recurrence else None,
        created_by=actor,
        type_id=root.type_id if parts.task_type else None,
        seq=next_seq(db, target_list.space_id),
        orderindex=(db.scalar(select(func.max(Task.orderindex)).where(Task.list_id == target_list.id)) or 0.0) + 1.0,
    )
    if not parts.keep_status:
        copy.status_id = status_id = default_status(allowed).id
    new_status = db.get(Status, status_id)
    assert new_status is not None
    apply_group_transition(copy, None, new_status.group)
    if parts.keep_status:
        copy.date_done, copy.date_closed = root.date_done, root.date_closed
    db.add(copy)
    db.flush()
    assignee_ids = list(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == root.id))) if parts.assignees else []
    for user_id in assignee_ids:
        db.add(TaskAssignee(task_id=copy.id, user_id=user_id))
    events.record(db, copy, actor, "created", {"list": target_list.name, "copied_from": root.name})
    watchers = [actor, *assignee_ids]
    if parts.followers:
        watchers += list(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == root.id)))
    events.watch(db, copy.id, list(dict.fromkeys(watchers)))
    # A tag belongs to its Space, so it only means anything inside the one it came from.
    if parts.tags and target_list.space_id == db.get(TaskList, root.list_id).space_id:  # type: ignore[union-attr]
        for tag_id in db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == root.id)):
            db.add(TaskTag(task_id=copy.id, tag_id=tag_id))
    if parts.checklists:
        extras.copy_task_extras(db, root, copy, reset=not parts.keep_checked_items)
    if parts.custom_fields:
        customfields.copy_values(db, root, copy)
    if parts.attachments:
        extras.copy_attachments(db, root, copy)
    if parts.comments:
        _copy_comments(db, root, copy)
    if parts.relationships and parent is None:
        _copy_links(db, root, copy)
    if include_subtasks and parts.subtasks:
        for child in db.scalars(
            select(Task).where(Task.parent_id == root.id, Task.archived_at.is_(None)).order_by(Task.orderindex)
        ):
            _copy_task_tree(db, child, target_list, actor, None, True, status_map, group_map, copy, parts)
    db.flush()
    return copy


def duplicate_task(
    db: Session, opened: Opened[Task], target: Opened[TaskList], name: Optional[str], include_subtasks: bool,
    parts: Optional[s.CopyParts] = None,
) -> Task:
    if not opened.level.at_least(PermissionLevel.view):
        raise Forbidden("You can't see this task")
    _require_full(target, "create tasks in that List")
    task = opened.obj
    return _copy_task_tree(
        db, task, target.obj, opened.access.user_id, name or f"{task.name} (copy)", include_subtasks,
        parent=db.get(Task, task.parent_id) if task.parent_id and target.obj.id == task.list_id else None,
        parts=parts,
    )


def duplicate_to_people(
    db: Session, opened: Opened[Task], user_ids: List[str], name: Optional[str],
    include_subtasks: bool, parts: Optional[s.CopyParts] = None,
) -> List[str]:
    """A copy each, on their own Personal List. Returns who got one.

    The other half of the choice: these are separate tasks from here on, and what one person does
    to theirs leaves the rest alone. When the work is one job that several people are on, share it
    instead -- multilist.share_with_people -- so the hours add up to the job rather than to copies
    of it. Each copy is assigned to its owner, whatever the source task said.
    """
    from app.db.models import WorkspaceMember
    from app.services.work import mywork
    from app.services.work.permissions import can_manage_workspace

    access = opened.access
    if not opened.level.at_least(PermissionLevel.view):
        raise Forbidden("You can't see this task")
    others = [uid for uid in dict.fromkeys(user_ids) if uid != access.user_id]
    # A Personal List is private to its owner; putting work there is an admin's doing.
    if others and not can_manage_workspace(access.role):
        raise Forbidden("Only admins can put a copy on someone else's Personal List.")

    made: List[str] = []
    for user_id in dict.fromkeys(user_ids):
        if db.get(WorkspaceMember, (access.workspace_id, user_id)) is None:
            continue
        lst = mywork.personal_list_of(db, access.workspace_id, user_id, create=True)
        if lst is None:
            continue
        copy = _copy_task_tree(
            db, opened.obj, lst, access.user_id, name or opened.obj.name, include_subtasks, parts=parts,
        )
        db.execute(delete(TaskAssignee).where(TaskAssignee.task_id == copy.id))
        db.add(TaskAssignee(task_id=copy.id, user_id=user_id))
        db.flush()
        events.watch(db, copy.id, [user_id])
        events.notify(
            db, access.workspace_id, [user_id], access.user_id, "assigned", "primary", task=copy,
        )
        made.append(user_id)
    return made


def _view_columns():
    from app.db.models import Automation, View

    return (
        {Space: View.space_id, Folder: View.folder_id, TaskList: View.list_id},
        {Space: Automation.space_id, Folder: Automation.folder_id, TaskList: Automation.list_id},
    )


class _Lazy(dict):
    """The model columns, looked up on first use: importing them at module load loops."""

    def __init__(self, which):
        super().__init__()
        self.which = which

    def __missing__(self, key):
        self.update(_view_columns()[self.which])
        return dict.__getitem__(self, key)


_VIEW_COLUMN = _Lazy(0)
_AUTOMATION_COLUMN = _Lazy(1)


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


def _copy_views(db: Session, source, target, actor: str) -> int:
    """The views someone built here, not just the required ones.

    A List is largely the views people made on it -- the grouping, the filters, the columns they
    settled on. A copy without them is a copy of the tasks, not of the way of working.
    """
    from app.db.models import View

    column = _VIEW_COLUMN[type(source)]
    made = 0
    for v in db.scalars(select(View).where(column == source.id, View.is_required.is_(False)).order_by(View.orderindex)):
        db.add(View(
            type=v.type, name=v.name, orderindex=v.orderindex, is_required=False, created_by=actor,
            settings=dict(v.settings or {}), **{column.key: target.id},
        ))
        made += 1
    db.flush()
    return made


def _copy_automations(db: Session, source, target, actor: str) -> int:
    """The rules that run on this place. They point at people and statuses by name, so they travel."""
    from app.db.models import Automation

    column = _AUTOMATION_COLUMN[type(source)]
    made = 0
    for rule in db.scalars(select(Automation).where(column == source.id)):
        db.add(Automation(
            workspace_id=rule.workspace_id, trigger=rule.trigger, trigger_config=dict(rule.trigger_config or {}),
            action=rule.action, action_config=dict(rule.action_config or {}), active=rule.active,
            created_by=actor, **{column.key: target.id},
        ))
        made += 1
    db.flush()
    return made


def _copy_list(
    db: Session, lst: TaskList, space_id: uuid.UUID, folder_id: Optional[uuid.UUID], actor: str, name: str,
    include_tasks: bool, status_map: Dict[uuid.UUID, uuid.UUID], group_map: Dict[uuid.UUID, uuid.UUID],
    opts: Optional[s.DuplicateIn] = None,
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
    want = opts or s.DuplicateIn()
    statuses = {**status_map, **_copy_own_statuses(db, lst, copy)} if (lst.override_statuses and want.statuses) else dict(status_map)
    groups = {**group_map, **_copy_own_groups(db, lst, copy, actor)}
    add_required_views(db, copy, actor)
    if want.views:
        _copy_views(db, lst, copy, actor)
    if want.automations:
        _copy_automations(db, lst, copy, actor)
    if include_tasks:
        where = [Task.list_id == lst.id, Task.parent_id.is_(None)]
        if not want.include_archived:
            where.append(Task.archived_at.is_(None))
        for task in db.scalars(select(Task).where(*where).order_by(Task.orderindex)):
            _copy_task_tree(db, task, copy, actor, None, True, statuses, groups, parts=want.parts)
    db.flush()
    return copy


def hand_to_people(db: Session, opened: Opened, kind, copy, user_ids: List[str], level) -> List[str]:
    """Make the copy private and share it with these people. Returns who got it.

    Without this, "duplicate this for Harish" means duplicating it for the whole firm and then
    asking Harish to find it. Private plus a share each is what actually makes a copy his.

    The usual rules still apply underneath: grant_share refuses a Space to anyone but an admin,
    and a Folder or List to anyone who is not a manager, so this cannot be a way around them.
    """
    from app.services.work import sharing

    people = [uid for uid in dict.fromkeys(user_ids) if uid]
    if not people:
        return []
    copy.is_private = True
    db.flush()
    made: List[str] = []
    for user_id in people:
        # Re-open the copy each time: sharing reads the caller's level on the thing being shared,
        # and privatising it a moment ago changed that.
        target = _reopen(db, opened.access.user_id, kind, copy.id)
        sharing.grant_share(db, target, kind, s.ShareCreate(user_id=user_id, level=level))
        made.append(user_id)
    return made


def _reopen(db: Session, user_id: str, kind, obj_id: uuid.UUID):
    from app.db.models import LocationKind
    from app.services.work.access import open_folder, open_list, open_space

    return {
        LocationKind.space: open_space, LocationKind.folder: open_folder, LocationKind.list: open_list,
    }[kind](db, user_id, obj_id, PermissionLevel.view)


def duplicate_list(
    db: Session, opened: Opened[TaskList], parent: Opened, name: Optional[str], include_tasks: bool,
    opts: Optional[s.DuplicateIn] = None,
) -> TaskList:
    """Copy a List into `parent` -- a Space or a Folder.

    It used to take a parent and then copy into the source List's own Space and Folder regardless,
    so a copy could only ever land beside the original. Asking where it should go and then not
    going there is worse than not asking.
    """
    lst = opened.obj
    ensure_not_personal(db, lst, "duplicated")
    _require_manager(opened.access, "List")
    _require_full(parent, "add Lists there")
    if isinstance(parent.obj, Folder):
        space_id, folder_id = parent.obj.space_id, parent.obj.id
    else:  # a Space: the List sits directly in it
        space_id, folder_id = parent.obj.id, None
    return _copy_list(
        db, lst, space_id, folder_id, opened.access.user_id, name or f"{lst.name} (copy)", include_tasks, {}, {}, opts,
    )


def duplicate_folder(
    db: Session, opened: Opened[Folder], parent: Opened, name: Optional[str], include_tasks: bool,
    opts: Optional[s.DuplicateIn] = None,
) -> Folder:
    """Copy a Folder, its sub-Folders and its Lists into `parent` -- a Space, or another Folder."""
    folder = opened.obj
    ensure_not_personal(db, folder, "duplicated")
    _require_manager(opened.access, "Folder")
    _require_full(parent, "add Folders there")
    actor = opened.access.user_id
    want = opts or s.DuplicateIn()
    if isinstance(parent.obj, Folder):
        into_space, into_folder = parent.obj.space_id, parent.obj.id
    else:
        into_space, into_folder = parent.obj.id, None

    def copy_folder(src: Folder, space_id: uuid.UUID, parent_id: Optional[uuid.UUID], new_name: str) -> Folder:
        new = Folder(
            space_id=space_id, parent_folder_id=parent_id, name=new_name, color=src.color,
            is_private=src.is_private, created_by=actor,
            orderindex=_next_orderindex(db, Folder.orderindex, Folder.space_id == space_id),
        )
        db.add(new)
        db.flush()
        statuses = _copy_own_statuses(db, src, new) if (src.override_statuses and want.statuses) else {}
        groups = _copy_own_groups(db, src, new, actor)
        add_required_views(db, new, actor)
        if want.views:
            _copy_views(db, src, new, actor)
        if want.automations:
            _copy_automations(db, src, new, actor)
        for child in db.scalars(select(Folder).where(Folder.parent_folder_id == src.id, Folder.archived_at.is_(None))):
            copy_folder(child, space_id, new.id, child.name)
        for lst in db.scalars(select(TaskList).where(TaskList.folder_id == src.id, TaskList.archived_at.is_(None)).order_by(TaskList.orderindex)):
            _copy_list(db, lst, space_id, new.id, actor, lst.name, include_tasks, statuses, groups, opts)
        return new

    return copy_folder(folder, into_space, into_folder, name or f"{folder.name} (copy)")
