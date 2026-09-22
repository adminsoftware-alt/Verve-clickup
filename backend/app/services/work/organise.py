"""Favourites, task types and the Tag Manager (ClickUp's small organising tools)."""

import uuid
from typing import List, Optional, Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.db.models import Favorite, PermissionLevel, Tag, Task, TaskTag, TaskType
from app.schemas import work as s
from app.services.work.access import Access, Opened, open_folder, open_list, open_space, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

VIEW = PermissionLevel.view
DEFAULT_TAG_BG = "#e0e7ff"
DEFAULT_TAG_FG = "#3730a3"


# --- favourites ----------------------------------------------------------------------------------


def _resolve(db: Session, user_id: str, kind: str, target_id: uuid.UUID) -> Optional[dict]:
    """Name and where it opens, if the person can still see it."""
    from app.services.work import views as view_service
    from app.services.work.dashboards.access import open_dashboard

    try:
        if kind == "space":
            obj = open_space(db, user_id, target_id, VIEW).obj
            return {"name": obj.name, "location_kind": "space", "location_id": obj.id}
        if kind == "folder":
            obj = open_folder(db, user_id, target_id, VIEW).obj
            return {"name": obj.name, "location_kind": "folder", "location_id": obj.id}
        if kind == "list":
            obj = open_list(db, user_id, target_id, VIEW).obj
            return {"name": obj.name, "location_kind": "list", "location_id": obj.id}
        if kind == "task":
            task = open_task(db, user_id, target_id, VIEW).obj
            return {"name": task.name, "list_id": task.list_id}
        if kind == "dashboard":
            return {"name": open_dashboard(db, user_id, target_id).dashboard.name}
        if kind == "view":
            view = view_service.open_view(db, user_id, target_id, VIEW).obj
            loc_kind, loc_id = ("space", view.space_id) if view.space_id else ("folder", view.folder_id) if view.folder_id else ("list", view.list_id)
            return {"name": view.name, "location_kind": loc_kind, "location_id": loc_id}
    except (NotFound, Forbidden):
        return None
    return None


def list_favorites(db: Session, access: Access) -> List[s.FavoriteOut]:
    out = []
    for fav in db.scalars(
        select(Favorite).where(Favorite.user_id == access.user_id, Favorite.workspace_id == access.workspace_id)
        .order_by(Favorite.orderindex, Favorite.created_at)
    ):
        info = _resolve(db, access.user_id, fav.kind, fav.target_id)
        if info is not None:  # things they can no longer open simply drop out
            out.append(s.FavoriteOut(id=fav.id, kind=fav.kind, target_id=fav.target_id, orderindex=fav.orderindex, **info))
    return out


def add_favorite(db: Session, access: Access, data: s.FavoriteIn) -> None:
    if _resolve(db, access.user_id, data.kind, data.target_id) is None:
        raise NotFound("Nothing to favourite there")
    existing = db.scalars(select(Favorite).where(
        Favorite.user_id == access.user_id, Favorite.kind == data.kind, Favorite.target_id == data.target_id)).first()
    if existing is not None:
        return
    top = db.scalar(select(func.max(Favorite.orderindex)).where(Favorite.user_id == access.user_id)) or 0.0
    db.add(Favorite(workspace_id=access.workspace_id, user_id=access.user_id, kind=data.kind, target_id=data.target_id, orderindex=top + 1))
    db.flush()


def remove_favorite(db: Session, access: Access, kind: str, target_id: uuid.UUID) -> None:
    db.execute(delete(Favorite).where(Favorite.user_id == access.user_id, Favorite.kind == kind, Favorite.target_id == target_id))
    db.flush()


def reorder_favorites(db: Session, access: Access, ids: Sequence[uuid.UUID]) -> None:
    for i, fav_id in enumerate(ids):
        db.execute(update(Favorite).where(Favorite.id == fav_id, Favorite.user_id == access.user_id).values(orderindex=float(i + 1)))
    db.flush()


# --- task types --------------------------------------------------------------------------------


def list_types(db: Session, access: Access) -> List[TaskType]:
    rows = list(db.scalars(select(TaskType).where(TaskType.workspace_id == access.workspace_id).order_by(TaskType.orderindex, TaskType.name)))
    if not rows and can_manage_workspace(access.role):
        # Every workspace starts with Milestone, as in ClickUp; "Task" is the built-in default.
        db.add(TaskType(workspace_id=access.workspace_id, name="Milestone", name_plural="Milestones", icon="diamond", color="#7c3aed", is_milestone=True, orderindex=1))
        db.flush()
        rows = list(db.scalars(select(TaskType).where(TaskType.workspace_id == access.workspace_id)))
    return rows


def _type(db: Session, access: Access, type_id: uuid.UUID) -> TaskType:
    kind = db.get(TaskType, type_id)
    if kind is None or kind.workspace_id != access.workspace_id:
        raise NotFound("Task type not found")
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can manage task types")
    return kind


def create_type(db: Session, access: Access, data: s.TaskTypeIn) -> TaskType:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can manage task types")
    if data.name.lower() == "task":
        raise Invalid("“Task” is the built-in type")
    if db.scalar(select(TaskType.id).where(TaskType.workspace_id == access.workspace_id, func.lower(TaskType.name) == data.name.lower())):
        raise Invalid(f"A task type called {data.name} already exists")
    top = db.scalar(select(func.max(TaskType.orderindex)).where(TaskType.workspace_id == access.workspace_id)) or 0.0
    kind = TaskType(workspace_id=access.workspace_id, orderindex=top + 1, **data.model_dump())
    db.add(kind)
    db.flush()
    return kind


def update_type(db: Session, access: Access, type_id: uuid.UUID, data: s.TaskTypeUpdate) -> TaskType:
    kind = _type(db, access, type_id)
    for field in data.model_fields_set:
        value = getattr(data, field)
        if value is not None:
            setattr(kind, field, value)
    db.flush()
    return kind


def delete_type(db: Session, access: Access, type_id: uuid.UUID) -> None:
    """Tasks of a deleted type become plain tasks."""
    db.delete(_type(db, access, type_id))
    db.flush()


# --- the Tag Manager ---------------------------------------------------------------------------


def tags_in_space(db: Session, opened: Opened) -> List[s.TagUsage]:
    counts = dict(db.execute(
        select(TaskTag.tag_id, func.count()).join(Task, Task.id == TaskTag.task_id)
        .where(Task.archived_at.is_(None)).group_by(TaskTag.tag_id)
    ).all())
    return [
        s.TagUsage(id=t.id, name=t.name, bg_color=t.bg_color, fg_color=t.fg_color, task_count=counts.get(t.id, 0))
        for t in db.scalars(select(Tag).where(Tag.space_id == opened.obj.id).order_by(func.lower(Tag.name)))
    ]


def _need_edit(opened: Opened) -> None:
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to the Space to manage its tags")


def create_tag(db: Session, opened: Opened, data: s.TagIn) -> Tag:
    _need_edit(opened)
    if db.scalar(select(Tag.id).where(Tag.space_id == opened.obj.id, func.lower(Tag.name) == data.name.lower())):
        raise Invalid(f"The tag “{data.name}” already exists")
    tag = Tag(space_id=opened.obj.id, name=data.name, bg_color=data.bg_color or DEFAULT_TAG_BG, fg_color=data.fg_color or DEFAULT_TAG_FG)
    db.add(tag)
    db.flush()
    return tag


def open_tag(db: Session, user_id: str, tag_id: uuid.UUID) -> "tuple[Tag, Opened]":
    tag = db.get(Tag, tag_id)
    if tag is None:
        raise NotFound("Tag not found")
    return tag, open_space(db, user_id, tag.space_id, VIEW)


def update_tag(db: Session, user_id: str, tag_id: uuid.UUID, data: s.TagUpdate) -> Tag:
    """Rename or recolour. Renaming to an existing tag's name merges the two, as in ClickUp."""
    tag, opened = open_tag(db, user_id, tag_id)
    _need_edit(opened)
    fields = data.model_fields_set
    if "bg_color" in fields and data.bg_color:
        tag.bg_color = data.bg_color
    if "fg_color" in fields and data.fg_color:
        tag.fg_color = data.fg_color
    if "name" in fields and data.name and data.name != tag.name:
        other = db.scalars(select(Tag).where(Tag.space_id == tag.space_id, func.lower(Tag.name) == data.name.lower(), Tag.id != tag.id)).first()
        if other is None:
            tag.name = data.name
        else:
            already = set(db.scalars(select(TaskTag.task_id).where(TaskTag.tag_id == other.id)))
            for row in list(db.scalars(select(TaskTag).where(TaskTag.tag_id == tag.id))):
                if row.task_id not in already:
                    db.add(TaskTag(task_id=row.task_id, tag_id=other.id))
            db.flush()
            db.delete(tag)
            db.flush()
            return other
    db.flush()
    return tag


def delete_tag(db: Session, user_id: str, tag_id: uuid.UUID) -> None:
    """Removes the tag from every task in the Space."""
    tag, opened = open_tag(db, user_id, tag_id)
    _need_edit(opened)
    db.delete(tag)
    db.flush()
