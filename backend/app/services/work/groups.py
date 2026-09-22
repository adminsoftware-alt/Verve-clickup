"""Task groups: named sets of similar tasks ("Meetings", "Client calls") within a location.

A group is defined on a Space, Folder or List and can be used by every List at or below
it, like statuses. Managing groups needs edit access to where they are defined.
"""

import uuid
from typing import List, Optional, Union

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Folder, LocationKind, PermissionLevel, Space, TaskGroup, TaskList
from app.schemas import work as s
from app.services.work.access import Opened, open_folder, open_list, open_space
from app.services.work.errors import Forbidden, Invalid, NotFound

Location = Union[Space, Folder, TaskList]
PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899"]


def _chain_filters(db: Session, obj: Location):
    """SQL conditions for groups defined at this location or above it."""
    conds = []
    if isinstance(obj, TaskList):
        conds.append(TaskGroup.list_id == obj.id)
        folder = db.get(Folder, obj.folder_id) if obj.folder_id else None
        space_id = obj.space_id
    elif isinstance(obj, Folder):
        folder, space_id = obj, obj.space_id
    else:
        folder, space_id = None, obj.id
    while folder is not None:
        conds.append(TaskGroup.folder_id == folder.id)
        folder = db.get(Folder, folder.parent_folder_id) if folder.parent_folder_id else None
    conds.append(TaskGroup.space_id == space_id)
    return or_(*conds)


def available(db: Session, obj: Location) -> List[TaskGroup]:
    """Groups a location can use: its own and its ancestors', nearest first."""
    groups = list(db.scalars(select(TaskGroup).where(_chain_filters(db, obj))))
    depth = lambda g: 0 if g.list_id else 1 if g.folder_id else 2
    return sorted(groups, key=lambda g: (depth(g), g.orderindex, g.name.lower()))


def check_for_list(db: Session, lst: TaskList, group_id: Optional[uuid.UUID]) -> Optional[uuid.UUID]:
    """The group id if this List may use it; raises otherwise."""
    if group_id is None:
        return None
    if group_id not in {g.id for g in available(db, lst)}:
        raise Invalid("That group isn't available in this List")
    return group_id


def group_out(g: TaskGroup) -> s.TaskGroupOut:
    kind, loc = (
        (LocationKind.list, g.list_id) if g.list_id
        else (LocationKind.folder, g.folder_id) if g.folder_id
        else (LocationKind.space, g.space_id)
    )
    assert loc is not None
    return s.TaskGroupOut(id=g.id, name=g.name, color=g.color, location=kind, location_id=loc, orderindex=g.orderindex)


def create(db: Session, opened: Opened, kind: LocationKind, data: s.TaskGroupIn) -> TaskGroup:
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access here to create groups")
    obj = opened.obj
    clash = [g for g in available(db, obj) if g.name.lower() == data.name.lower()]
    if clash:
        raise Invalid(f"A group called {data.name} already exists here")
    column = {LocationKind.space: "space_id", LocationKind.folder: "folder_id", LocationKind.list: "list_id"}[kind]
    count = db.scalar(select(func.count()).select_from(TaskGroup).where(getattr(TaskGroup, column) == obj.id)) or 0
    group = TaskGroup(
        name=data.name,
        color=data.color or PALETTE[count % len(PALETTE)],
        orderindex=data.orderindex if data.orderindex is not None else float(count + 1),
        created_by=opened.access.user_id,
        **{column: obj.id},
    )
    db.add(group)
    db.flush()
    return group


def open_group(db: Session, user_id: str, group_id: uuid.UUID, minimum: PermissionLevel) -> TaskGroup:
    group = db.get(TaskGroup, group_id)
    if group is None:
        raise NotFound("Group not found")
    if group.list_id:
        open_list(db, user_id, group.list_id, minimum)
    elif group.folder_id:
        open_folder(db, user_id, group.folder_id, minimum)
    else:
        assert group.space_id is not None
        open_space(db, user_id, group.space_id, minimum)
    return group


def update(db: Session, user_id: str, group_id: uuid.UUID, data: s.TaskGroupIn) -> TaskGroup:
    group = open_group(db, user_id, group_id, PermissionLevel.edit)
    group.name = data.name
    if data.color:
        group.color = data.color
    if data.orderindex is not None:
        group.orderindex = data.orderindex
    db.flush()
    return group


def delete(db: Session, user_id: str, group_id: uuid.UUID) -> None:
    """Tasks in the group stay; they just lose the group."""
    db.delete(open_group(db, user_id, group_id, PermissionLevel.edit))
    db.flush()
