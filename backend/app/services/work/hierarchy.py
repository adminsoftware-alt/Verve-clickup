"""Spaces, Folders and Lists: creation, updates, and the sidebar tree."""

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Union

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    LocationKind,
    PermissionLevel,
    Share,
    Space,
    Status,
    StatusGroup,
    Task,
    TaskList,
    Team,
    WorkspaceRole,
)
from app.schemas import work as s
from app.services.work.access import (
    Access,
    Opened,
    folder_node,
    list_node,
    space_node,
    task_ancestry,
)
from app.services.work.errors import Conflict, Forbidden, Invalid
from app.services.work.mywork import ensure_not_personal
from app.services.work.permissions import Node, can_create_spaces, can_manage_workspace
from app.services.work.statuses import seed_space_statuses
from app.services.work.views import add_required_views

Location = Union[Space, Folder, TaskList]


def _next_orderindex(db: Session, column, *conditions) -> float:
    current = db.scalar(select(func.max(column)).where(*conditions))
    return (current or 0.0) + 1.0


def _grant_on_privatise(db: Session, access: Access, kind: LocationKind, obj) -> None:
    """Making something private must not lock out the person who did it.

    Creators keep access anyway; anyone else is given a full share first.
    """
    if obj.created_by == access.user_id:
        return
    column = {
        LocationKind.space: Share.space_id,
        LocationKind.folder: Share.folder_id,
        LocationKind.list: Share.list_id,
        LocationKind.task: Share.task_id,
    }[kind]
    existing = db.scalars(
        select(Share).where(Share.user_id == access.user_id, column == obj.id)
    ).first()
    if existing is None:
        db.add(
            Share(
                user_id=access.user_id,
                level=PermissionLevel.full,
                granted_by=access.user_id,
                **{column.key: obj.id},
            )
        )
    else:
        existing.level = PermissionLevel.full
    access.shares[(kind, obj.id)] = PermissionLevel.full


def _own_personal(db: Session, obj, user_id: str) -> bool:
    """True when this is the caller's own Personal Space or the List inside it."""
    space = obj if isinstance(obj, Space) else db.get(Space, getattr(obj, "space_id", None))
    return space is not None and space.personal_owner_id == user_id


def _apply_location_update(
    db: Session, opened: Opened, kind: LocationKind, data: s.LocationUpdate
) -> None:
    obj = opened.obj
    fields = data.model_fields_set
    if ("is_private" in fields) or ("archived" in fields):
        ensure_not_personal(db, obj, "made public or archived")
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to change this")
    # Renaming is how everyone else finds their work again. A Space called something different
    # from what the firm calls it breaks every person's mental map of the place at once, and the
    # only trace is one line in the audit log, so the name is an admin's to change. Colour, dates
    # and description are still anyone's with edit access -- they cost nothing if they are wrong.
    #
    # Except a Personal List: nobody else can see it, so there is no shared map to break. Its
    # owner names it whatever they like.
    if "name" in fields and not can_manage_workspace(opened.access.role) and not _own_personal(db, obj, opened.access.user_id):
        raise Forbidden("Only admins can rename a Space, Folder or List. Ask an admin to change it.")
    touches_admin = ("is_private" in fields) or ("archived" in fields)
    if touches_admin and opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to change privacy or archive this")
    for name in ("name", "color", "orderindex", "description", "icon", "task_prefix", "start_date", "due_date"):
        if name in fields and hasattr(obj, name):
            value = getattr(data, name)
            if name == "name" and value is None:
                raise Invalid("Name cannot be empty")
            if name == "name" and kind == LocationKind.space and getattr(obj, "personal_owner_id", None) is None                     and value.strip().lower() != (obj.name or "").strip().lower():
                ensure_space_name_free(db, obj.workspace_id, value, keep=obj.id)
            setattr(obj, name, value)
    if "is_private" in fields and data.is_private is not None:
        if data.is_private and not obj.is_private:
            _grant_on_privatise(db, opened.access, kind, obj)
        obj.is_private = data.is_private
    if "archived" in fields and data.archived is not None:
        if bool(obj.archived_at) != data.archived and kind == LocationKind.space:
            from app.services.work import audit

            audit.record(db, opened.access.workspace_id, opened.access.user_id, "space.archived" if data.archived else "space.restored",
                         "space", obj.id, obj.name)
        obj.archived_at = datetime.now(timezone.utc) if data.archived else None
    start, due = getattr(obj, "start_date", None), getattr(obj, "due_date", None)
    if start and due and due < start:
        raise Invalid("The List's due date must be on or after its start date")
    db.flush()


# --- spaces ------------------------------------------------------------------


def default_prefix(name: str) -> str:
    """A Space's starting custom-ID prefix: the first letters of its name ("HR & Admin" → "HRA")."""
    letters = "".join(ch for ch in name.upper() if ch.isascii() and ch.isalnum())
    return letters[:3] or "T"


def ensure_space_name_free(db: Session, workspace_id: uuid.UUID, name: str, keep: Optional[uuid.UUID] = None) -> None:
    """Two Spaces with one name is two places people think are the same one.

    Compared trimmed and case-blind, among the workspace's live shared Spaces -- each person's
    Personal Space is called Personal and that is fine, since nobody sees anyone else's. Checked
    here rather than by a unique index because some workspaces already hold duplicates, and an
    index would refuse the migration instead of just the next one.
    """
    wanted = name.strip().lower()
    q = select(Space.id).where(
        Space.workspace_id == workspace_id,
        Space.archived_at.is_(None),
        Space.personal_owner_id.is_(None),
        func.lower(func.trim(Space.name)) == wanted,
    )
    if keep is not None:
        q = q.where(Space.id != keep)
    if db.scalar(q.limit(1)) is not None:
        raise Conflict(f"There is already a Space called {name.strip()}. Pick another name.")


def create_space(db: Session, access: Access, data: s.SpaceCreate) -> Space:
    if not can_create_spaces(access.role):
        raise Forbidden("Guests cannot create Spaces")
    # A Space is the firm's shape, so only the people who run the place may add one.
    if not can_manage_workspace(access.role):
        raise Forbidden("Only admins can create Spaces. Ask one of them to add it.")
    ensure_space_name_free(db, access.workspace_id, data.name)
    space = Space(
        workspace_id=access.workspace_id,
        name=data.name,
        description=data.description,
        color=data.color,
        icon=data.icon,
        is_private=data.is_private,
        created_by=access.user_id,
        task_prefix=default_prefix(data.name),
        orderindex=_next_orderindex(db, Space.orderindex, Space.workspace_id == access.workspace_id),
        default_permission=data.default_permission,
    )
    db.add(space)
    db.flush()
    if data.statuses:
        from app.db.models import Status
        from app.services.work.statuses import StatusInput, validate_status_set

        validate_status_set([StatusInput(name=st.name, color=st.color, group=st.group) for st in data.statuses])
        for position, st in enumerate(data.statuses):
            db.add(Status(space_id=space.id, name=st.name, color=st.color, group=st.group, orderindex=position))
    else:
        seed_space_statuses(db, space)
    add_required_views(db, space, access.user_id)
    db.flush()
    from app.services.work import audit

    audit.record(db, access.workspace_id, access.user_id, "space.created", "space", space.id, space.name)
    return space


def update_space(db: Session, opened: Opened[Space], data: s.SpaceUpdate) -> Space:
    fields = data.model_fields_set
    _apply_location_update(db, opened, LocationKind.space, data)
    if "default_permission" in fields:
        if opened.level != PermissionLevel.full:
            raise Forbidden("You need full access to change this Space's default permission")
        opened.obj.default_permission = data.default_permission
    db.flush()
    return opened.obj


# --- folders -----------------------------------------------------------------


def _home_team(db: Session, access: Access, space: Space, folder: Optional[Folder]) -> Optional[uuid.UUID]:
    """Which Team a new Folder or List belongs to.

    Its parent's Team if the parent has one, so a Team's Folder stays the Team's. Otherwise, when a
    Team lead makes it, the Team they lead -- the first by name if they lead several -- so a lead's
    new List is their Team's work and not every Team's. An admin's is the workspace's unless its
    parent says otherwise; they can hand it to a Team afterwards.
    """
    for parent in (folder, db.get(Folder, folder.parent_folder_id) if folder and folder.parent_folder_id else None, space):
        if parent is not None and parent.team_id is not None:
            return parent.team_id
    if can_manage_workspace(access.role):
        return None
    from app.services.work.teams import led_team_ids

    led = led_team_ids(db, access.workspace_id, access.user_id)
    if not led:
        return None
    return db.scalars(select(Team.id).where(Team.id.in_(list(led))).order_by(func.lower(Team.name))).first()


def create_folder(
    db: Session,
    access: Access,
    space: Space,
    data: s.FolderCreate,
    parent: Optional[Folder] = None,
) -> Folder:
    ensure_not_personal(db, space, "given Folders")
    # Folders organise a Space, so managers -- the leads of a Team -- and admins may add them.
    if not can_manage_workspace(access.role):
        from app.services.work.teams import led_team_ids

        if not led_team_ids(db, access.workspace_id, access.user_id):
            raise Forbidden("Only admins and managers can create Folders. You can add Lists and tasks inside one.")
    if parent is not None and parent.parent_folder_id is not None:
        raise Invalid("Subfolders can only be one level deep")
    parent_condition = (
        Folder.parent_folder_id == parent.id if parent else Folder.parent_folder_id.is_(None)
    )
    team_id = _home_team(db, access, space, parent)
    folder = Folder(
        space_id=space.id,
        parent_folder_id=parent.id if parent else None,
        name=data.name,
        color=data.color,
        is_private=data.is_private,
        created_by=access.user_id,
        team_id=team_id,
        orderindex=_next_orderindex(
            db, Folder.orderindex, Folder.space_id == space.id, parent_condition
        ),
    )
    db.add(folder)
    db.flush()
    add_required_views(db, folder, access.user_id)
    # A Folder is only useful with somewhere to put tasks, so it starts with one List.
    starter = TaskList(
        space_id=space.id,
        folder_id=folder.id,
        name="List",
        created_by=access.user_id,
        team_id=team_id,
        orderindex=1.0,
    )
    db.add(starter)
    db.flush()
    add_required_views(db, starter, access.user_id)
    db.flush()
    return folder


def update_folder(db: Session, opened: Opened[Folder], data: s.FolderUpdate) -> Folder:
    _apply_location_update(db, opened, LocationKind.folder, data)
    return opened.obj


# --- lists -------------------------------------------------------------------


def create_list(
    db: Session,
    access: Access,
    space: Space,
    data: s.ListCreate,
    folder: Optional[Folder] = None,
) -> TaskList:
    ensure_not_personal(db, space, "given more Lists")
    # Anyone with full edit on the Space or Folder may add a List to it -- Employees included, as
    # the firm asked on 2026-10-16. The route has already checked that level; a Space whose default
    # permission is Edit or lower is how an admin keeps Employees from adding Lists there.
    if access.role == WorkspaceRole.guest:
        raise Forbidden("Guests can't create Lists")
    parent_condition = (
        TaskList.folder_id == folder.id if folder else TaskList.folder_id.is_(None)
    )
    lst = TaskList(
        space_id=space.id,
        folder_id=folder.id if folder else None,
        name=data.name,
        description=data.description,
        color=data.color,
        is_private=data.is_private,
        created_by=access.user_id,
        team_id=_home_team(db, access, space, folder),
        orderindex=_next_orderindex(
            db, TaskList.orderindex, TaskList.space_id == space.id, parent_condition
        ),
    )
    db.add(lst)
    db.flush()
    add_required_views(db, lst, access.user_id)
    db.flush()
    return lst


def update_list(db: Session, opened: Opened[TaskList], data: s.ListUpdate) -> TaskList:
    _apply_location_update(db, opened, LocationKind.list, data)
    return opened.obj


def delete_location(db: Session, opened: Opened) -> None:
    ensure_not_personal(db, opened.obj, "deleted")
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to delete this")
    # Deleting a Space takes its Folders, its Lists and every task in them, and there is no undo:
    # the audit log records who did it, not how to get it back. Everyone who can see a public
    # Space resolves to full access on it (see permissions.resolve_level), so without this an
    # intern's stray click ends a year of work. Only admins.
    if not can_manage_workspace(opened.access.role):
        raise Forbidden("Only admins can delete a Space, Folder or List. Ask an admin to remove it.")
    from app.services.work import audit

    kind = "space" if isinstance(opened.obj, Space) else "folder" if isinstance(opened.obj, Folder) else "list"
    audit.record(db, opened.access.workspace_id, opened.access.user_id, f"{kind}.deleted", kind, opened.obj.id, opened.obj.name)
    db.delete(opened.obj)
    db.flush()


# --- serialisation -----------------------------------------------------------


def _team_ref(obj) -> Optional[s.TeamRef]:
    """The Team this belongs to, if it was given to one."""
    team = getattr(obj, "team", None)
    if team is None:
        return None
    return s.TeamRef(id=team.id, name=team.name, color=team.color)


def _common(obj: Location, level: PermissionLevel) -> dict:
    return dict(
        id=obj.id,
        team=_team_ref(obj),
        name=obj.name,
        color=obj.color,
        is_private=obj.is_private,
        orderindex=obj.orderindex,
        archived=obj.archived_at is not None,
        created_by=obj.created_by,
        created_at=obj.created_at,
        permission_level=level,
    )


def space_out(space: Space, level: PermissionLevel) -> s.SpaceOut:
    return s.SpaceOut(
        **_common(space, level),
        workspace_id=space.workspace_id,
        description=space.description,
        icon=space.icon,
        task_prefix=space.task_prefix,
        default_permission=space.default_permission,
    )


def folder_out(folder: Folder, level: PermissionLevel) -> s.FolderOut:
    return s.FolderOut(
        **_common(folder, level),
        space_id=folder.space_id,
        parent_folder_id=folder.parent_folder_id,
        override_statuses=folder.override_statuses,
        sprint_settings=folder.sprint_settings,
    )


def list_out(lst: TaskList, level: PermissionLevel) -> s.ListOut:
    return s.ListOut(
        **_common(lst, level),
        space_id=lst.space_id,
        folder_id=lst.folder_id,
        description=lst.description,
        override_statuses=lst.override_statuses,
        assignee_id=lst.assignee_id,
        assignees=[s.UserOut.model_validate(row.user) for row in lst.assignee_rows if row.user],
        start_date=lst.start_date,
        due_date=lst.due_date,
        sprint_completed_at=lst.sprint_completed_at,
    )


# --- the sidebar tree --------------------------------------------------------


def _sort_key(node) -> tuple:
    return (node.orderindex, node.name.lower())


def get_hierarchy(db: Session, access: Access, include_archived: bool = False) -> s.HierarchyOut:
    spaces = list(db.scalars(select(Space).where(Space.workspace_id == access.workspace_id)))
    space_ids = [sp.id for sp in spaces]
    folders = (
        list(db.scalars(select(Folder).where(Folder.space_id.in_(space_ids)))) if space_ids else []
    )
    lists = (
        list(db.scalars(select(TaskList).where(TaskList.space_id.in_(space_ids))))
        if space_ids
        else []
    )
    counts: Dict[uuid.UUID, int] = {}
    if lists:
        rows = db.execute(
            select(Task.list_id, func.count())
            .join(Status, Status.id == Task.status_id)
            .where(
                Task.list_id.in_([lst.id for lst in lists]),
                Task.archived_at.is_(None),
                Status.group != StatusGroup.closed,
            )
            .group_by(Task.list_id)
        )
        counts = {list_id: count for list_id, count in rows}

    space_by_id = {sp.id: sp for sp in spaces}
    folder_by_id = {f.id: f for f in folders}

    def folder_chain(folder: Folder) -> List[Node]:
        chain = [folder_node(folder)]
        if folder.parent_folder_id is not None:
            chain.append(folder_node(folder_by_id[folder.parent_folder_id]))
        return chain + [space_node(space_by_id[folder.space_id])]

    def list_chain(lst: TaskList) -> List[Node]:
        parent = (
            folder_chain(folder_by_id[lst.folder_id])
            if lst.folder_id
            else [space_node(space_by_id[lst.space_id])]
        )
        return [list_node(lst)] + parent

    def visible(obj) -> bool:
        return include_archived or obj.archived_at is None

    # Personal Spaces stay out of the tree; the caller's own List is returned on its own.
    personal_ids = {sp.id for sp in spaces if sp.personal_owner_id is not None}
    my_personal: Optional[s.ListNode] = None

    shared = s.SharedWithMe()
    space_nodes: Dict[uuid.UUID, s.SpaceNode] = {}
    for space in spaces:
        if space.id in personal_ids:
            continue
        level = access.level([space_node(space)])
        if level is None or not visible(space):
            continue
        space_nodes[space.id] = s.SpaceNode(
            id=space.id,
            name=space.name,
            color=space.color,
            icon=space.icon,
            is_private=space.is_private,
            archived=space.archived_at is not None,
            orderindex=space.orderindex,
            permission_level=level,
        )

    folder_nodes: Dict[uuid.UUID, s.FolderNode] = {}
    # Top-level folders first, so subfolders can find their parent node.
    for folder in sorted(folders, key=lambda f: f.parent_folder_id is not None):
        if folder.space_id in personal_ids:
            continue
        level = access.level(folder_chain(folder))
        parent_hidden = (
            folder.parent_folder_id is not None and not visible(folder_by_id[folder.parent_folder_id])
        ) or not visible(space_by_id[folder.space_id])
        if level is None or not visible(folder) or parent_hidden:
            continue
        node = s.FolderNode(
            id=folder.id,
            name=folder.name,
            color=folder.color,
            is_private=folder.is_private,
            archived=folder.archived_at is not None,
            orderindex=folder.orderindex,
            permission_level=level,
            is_sprint=folder.sprint_settings is not None,
        )
        folder_nodes[folder.id] = node
        if folder.parent_folder_id is not None:
            parent_node = folder_nodes.get(folder.parent_folder_id)
            (parent_node.folders if parent_node else shared.folders).append(node)
        else:
            space_node_ = space_nodes.get(folder.space_id)
            (space_node_.folders if space_node_ else shared.folders).append(node)

    placed_lists = set()
    for lst in lists:
        level = access.level(list_chain(lst))
        if level is None or not visible(lst):
            continue
        if lst.folder_id is not None:
            folder = folder_by_id[lst.folder_id]
            ancestors_visible = visible(folder) and visible(space_by_id[lst.space_id]) and (
                folder.parent_folder_id is None or visible(folder_by_id[folder.parent_folder_id])
            )
        else:
            ancestors_visible = visible(space_by_id[lst.space_id])
        if not ancestors_visible:
            continue
        node = s.ListNode(
            id=lst.id,
            name=lst.name,
            color=lst.color,
            is_private=lst.is_private,
            archived=lst.archived_at is not None,
            orderindex=lst.orderindex,
            permission_level=level,
            open_task_count=counts.get(lst.id, 0),
            team=_team_ref(lst),
            assignee_id=lst.assignee_id,
            assignee_ids=lst.assignee_ids,
            start_date=lst.start_date,
            due_date=lst.due_date,
            description=lst.description,
            sprint_completed_at=lst.sprint_completed_at,
        )
        placed_lists.add(lst.id)
        if lst.space_id in personal_ids:
            if space_by_id[lst.space_id].personal_owner_id == access.user_id:
                my_personal = node
            continue
        parent_node = (
            folder_nodes.get(lst.folder_id) if lst.folder_id else space_nodes.get(lst.space_id)
        )
        (parent_node.lists if parent_node else shared.lists).append(node)

    shared.tasks = _shared_tasks(db, access, lists, list_chain, placed_lists)

    # A Folder whose Lists all belong to other Teams is an empty heading to this person -- "Learning"
    # with nothing under it, on every Team's sidebar. Admins see everything, and someone who made
    # the Folder keeps it; a Folder that is empty for everyone (just made) stays too.
    if not can_manage_workspace(access.role):
        holds_lists = {lst.folder_id for lst in lists if lst.folder_id and visible(lst)}
        holds_lists |= {f.parent_folder_id for f in folders if f.parent_folder_id and f.id in holds_lists}

        def prune(nodes: List[s.FolderNode]) -> List[s.FolderNode]:
            kept = []
            for node in nodes:
                node.folders = prune(node.folders)
                folder = folder_by_id[node.id]
                empty_to_me = not node.lists and not node.folders and node.id in holds_lists
                if empty_to_me and folder.created_by != access.user_id:
                    continue
                kept.append(node)
            return kept

        for space_node_ in space_nodes.values():
            space_node_.folders = prune(space_node_.folders)
        shared.folders = prune(shared.folders)

    for node in list(space_nodes.values()) + list(folder_nodes.values()):
        node.folders.sort(key=_sort_key)
        node.lists.sort(key=_sort_key)
    shared.folders.sort(key=_sort_key)
    shared.lists.sort(key=_sort_key)

    return s.HierarchyOut(
        workspace_id=access.workspace_id,
        role=access.role,
        spaces=sorted(space_nodes.values(), key=_sort_key),
        shared_with_me=shared,
        personal_list=my_personal,
    )


def _shared_tasks(db, access: Access, lists, list_chain, placed_lists) -> List[s.SharedTaskRef]:
    """Tasks shared directly with the caller whose List they cannot otherwise open."""
    shared_task_ids = [
        obj_id
        for (kind, obj_id) in {**access.shares, **access.team_shares}
        if kind == LocationKind.task
    ]
    if not shared_task_ids:
        return []
    list_by_id = {lst.id: lst for lst in lists}
    refs = []
    tasks = db.scalars(
        select(Task).where(Task.id.in_(shared_task_ids), Task.archived_at.is_(None))
    )
    for task in tasks:
        lst = list_by_id.get(task.list_id)
        if lst is None or task.list_id in placed_lists:
            continue  # other workspace, or already reachable through its List
        level = access.level(task_ancestry(db, task) + list_chain(lst))
        if level is not None:
            refs.append(
                s.SharedTaskRef(id=task.id, name=task.name, list_id=task.list_id, permission_level=level)
            )
    return sorted(refs, key=lambda r: r.name.lower())
