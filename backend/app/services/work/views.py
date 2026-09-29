"""Saved views: the tabs in a location's views bar."""

import uuid
from typing import List, Sequence, Union

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Folder, PermissionLevel, Space, TaskList, View, ViewType
from app.schemas import work as s
from app.services.work.access import Opened, open_folder, open_list, open_space
from app.services.work.errors import Forbidden, Invalid, NotFound

Owner = Union[Space, Folder, TaskList]

DEFAULT_NAMES = {
    ViewType.list: "List",
    ViewType.board: "Board",
    ViewType.calendar: "Calendar",
    ViewType.dashboard: "Dashboard",
    ViewType.workload: "Workload",
    ViewType.overview: "Overview",
    ViewType.table: "Table",
    ViewType.team: "Team",
    ViewType.gantt: "Gantt",
    ViewType.timeline: "Timeline",
    ViewType.activity: "Activity",
    ViewType.form: "Form",
    ViewType.doc: "Doc",
    ViewType.whiteboard: "Whiteboard",
    ViewType.mind_map: "Mind map",
    ViewType.map: "Map",
    ViewType.chat: "Chat",
    ViewType.embed: "Embed",
}


def _parent_column(owner: Owner):
    return {Space: View.space_id, Folder: View.folder_id, TaskList: View.list_id}[type(owner)]


def _required_types(owner: Owner) -> List[ViewType]:
    """Every location has a List view; Spaces and Folders also open on an Overview, as in ClickUp."""
    if isinstance(owner, TaskList):
        return [ViewType.list]
    return [ViewType.overview, ViewType.list]


def add_required_views(db: Session, owner: Owner, user_id: str, existing: Sequence[View] = ()) -> None:
    """Create whichever required views `owner` is missing."""
    column = _parent_column(owner)
    have = {v.type for v in existing if v.is_required}
    for position, view_type in enumerate(_required_types(owner)):
        if view_type in have:
            continue
        db.add(
            View(
                type=view_type,
                name=DEFAULT_NAMES[view_type],
                orderindex=float(position) - 10.0,  # before any view someone adds
                is_required=True,
                created_by=user_id,
                **{column.key: owner.id},
            )
        )



def list_views(db: Session, opened: Opened) -> List[View]:
    """The views here, without other people's private views; the default view comes first."""
    column = _parent_column(opened.obj)
    query = select(View).where(column == opened.obj.id).order_by(View.orderindex, View.created_at)
    views = list(db.scalars(query))
    required = {v.type for v in views if v.is_required}
    if not set(_required_types(opened.obj)) <= required:
        # Locations created before a required view existed get it on first visit.
        add_required_views(db, opened.obj, opened.access.user_id, views)
        db.flush()
        views = list(db.scalars(query))
    mine = [v for v in views if v.private_to is None or v.private_to == opened.access.user_id]
    return sorted(mine, key=lambda v: not v.is_default)


def create_view(db: Session, opened: Opened, data: s.ViewCreate) -> View:
    # As in ClickUp, anyone who can see a location may add a private view for themselves.
    if not data.private and not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to add views here")
    if data.type == ViewType.overview:
        raise Invalid("Every Space and Folder already has its Overview")
    if data.type == ViewType.form and not isinstance(opened.obj, TaskList):
        raise Invalid("Forms create tasks in one List, so add them to a List")
    column = _parent_column(opened.obj)
    current = db.scalar(select(func.max(View.orderindex)).where(column == opened.obj.id)) or 0.0
    view = View(
        type=data.type,
        name=data.name or DEFAULT_NAMES[data.type],
        orderindex=current + 1.0,
        created_by=opened.access.user_id,
        private_to=opened.access.user_id if data.private else None,
        **{column.key: opened.obj.id},
    )
    db.add(view)
    db.flush()
    return view


def open_view(db: Session, user_id: str, view_id: uuid.UUID, minimum: PermissionLevel) -> Opened[View]:
    """Views take their permissions from the location they belong to."""
    view = db.get(View, view_id)
    if view is None:
        raise NotFound("View not found")
    if view.space_id:
        parent = open_space(db, user_id, view.space_id, minimum)
    elif view.folder_id:
        parent = open_folder(db, user_id, view.folder_id, minimum)
    else:
        assert view.list_id is not None
        parent = open_list(db, user_id, view.list_id, minimum)
    if view.private_to is not None and view.private_to != user_id:
        raise NotFound("View not found")
    return Opened(view, parent.access, parent.level)


def _is_admin(opened: Opened) -> bool:
    return opened.access.role.value in ("owner", "admin")


def update_view(db: Session, opened: Opened[View], data: s.ViewUpdate) -> View:
    view = opened.obj
    fields = data.model_fields_set
    own_private = view.private_to == opened.access.user_id
    if not own_private and not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to change views here")
    may_lock = view.created_by == opened.access.user_id or _is_admin(opened)
    if "protected" in fields and data.protected is not None and data.protected != view.protected:
        if not may_lock:
            raise Forbidden("Only the view's creator or an admin can protect or unprotect it")
        view.protected = data.protected
    if view.protected and fields & {"name", "settings"}:
        raise Forbidden("This view is protected. Unprotect it to change it.")
    if "private" in fields and data.private is not None and data.private != (view.private_to is not None):
        if view.is_required:
            raise Invalid("Required views can't be private")
        if view.created_by != opened.access.user_id:
            raise Forbidden("Only the view's creator can make it private or share it")
        view.private_to = opened.access.user_id if data.private else None
    if "is_default" in fields and data.is_default is not None:
        if not opened.level.at_least(PermissionLevel.edit) or view.private_to is not None:
            raise Forbidden("You need edit access, and a shared view, to set the default view")
        if data.is_default:
            column = _parent_column_of_view(view)
            for other in db.scalars(select(View).where(column == getattr(view, column.key), View.id != view.id, View.is_default.is_(True))):
                other.is_default = False
        view.is_default = data.is_default
    if "name" in fields:
        if data.name is None:
            raise Invalid("Name cannot be empty")
        view.name = data.name
    if "orderindex" in fields and data.orderindex is not None:
        view.orderindex = data.orderindex
    if "settings" in fields and data.settings is not None:
        view.settings = data.settings
    db.flush()
    return view


def delete_view(db: Session, opened: Opened[View]) -> None:
    if opened.obj.private_to != opened.access.user_id and not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to delete views here")
    if opened.obj.protected:
        raise Forbidden("This view is protected. Unprotect it to delete it.")
    if opened.obj.is_required:
        raise Invalid("Required views (List, Overview) cannot be deleted")
    db.delete(opened.obj)
    db.flush()


def view_out(view: View) -> s.ViewOut:
    return s.ViewOut(
        id=view.id,
        type=view.type,
        name=view.name,
        orderindex=view.orderindex,
        is_required=view.is_required,
        settings=view.settings or {},
        private=view.private_to is not None,
        protected=view.protected,
        is_default=view.is_default,
        created_by=view.created_by,
    )


def _parent_column_of_view(view: View):
    return View.space_id if view.space_id else View.folder_id if view.folder_id else View.list_id
