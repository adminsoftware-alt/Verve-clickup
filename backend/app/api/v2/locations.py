import uuid
from typing import Callable, List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user, require_level
from app.db.models import LocationKind, PermissionLevel, Space, User
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import assignment, copying, customfields, groups, hierarchy, sharing
from app.services.work import tasks as task_service
from app.services.work.access import open_folder, open_list, open_space, open_task
from app.services.work.statuses import (
    StatusInput,
    effective_statuses,
    set_statuses,
    source_kind,
    status_source,
)

router = APIRouter()
VIEW, FULL = PermissionLevel.view, PermissionLevel.full


# --- spaces ------------------------------------------------------------------


@router.get("/spaces/{space_id}", response_model=s.SpaceOut)
def get_space(space_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_space(db, user.id, space_id, VIEW)
    return hierarchy.space_out(opened.obj, opened.level)


@router.patch("/spaces/{space_id}", response_model=s.SpaceOut)
def update_space(
    space_id: uuid.UUID, data: s.SpaceUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_space(db, user.id, space_id, VIEW)
    hierarchy.update_space(db, opened, data)
    db.commit()
    return hierarchy.space_out(opened.obj, opened.level)


@router.delete("/spaces/{space_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_space(space_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hierarchy.delete_location(db, open_space(db, user.id, space_id, VIEW))
    db.commit()


@router.post("/spaces/{space_id}/folders", response_model=s.FolderOut, status_code=status.HTTP_201_CREATED)
def create_folder(
    space_id: uuid.UUID, data: s.FolderCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_space(db, user.id, space_id, VIEW)
    require_level(opened, FULL, "create folders here")
    folder = hierarchy.create_folder(db, opened.access, opened.obj, data)
    db.commit()
    return hierarchy.folder_out(folder, PermissionLevel.full)


@router.post("/spaces/{space_id}/lists", response_model=s.ListOut, status_code=status.HTTP_201_CREATED)
def create_folderless_list(
    space_id: uuid.UUID, data: s.ListCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_space(db, user.id, space_id, VIEW)
    require_level(opened, FULL, "create lists here")
    lst = hierarchy.create_list(db, opened.access, opened.obj, data)
    db.commit()
    return hierarchy.list_out(lst, PermissionLevel.full)


# --- folders -----------------------------------------------------------------


@router.get("/folders/{folder_id}", response_model=s.FolderOut)
def get_folder(folder_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_folder(db, user.id, folder_id, VIEW)
    return hierarchy.folder_out(opened.obj, opened.level)


@router.patch("/folders/{folder_id}", response_model=s.FolderOut)
def update_folder(
    folder_id: uuid.UUID, data: s.FolderUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_folder(db, user.id, folder_id, VIEW)
    hierarchy.update_folder(db, opened, data)
    db.commit()
    return hierarchy.folder_out(opened.obj, opened.level)


@router.delete("/folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(folder_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hierarchy.delete_location(db, open_folder(db, user.id, folder_id, VIEW))
    db.commit()


@router.post(
    "/folders/{folder_id}/folders", response_model=s.FolderOut, status_code=status.HTTP_201_CREATED
)
def create_subfolder(
    folder_id: uuid.UUID, data: s.FolderCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_folder(db, user.id, folder_id, VIEW)
    require_level(opened, FULL, "create subfolders here")
    space = db.get(Space, opened.obj.space_id)
    folder = hierarchy.create_folder(db, opened.access, space, data, parent=opened.obj)
    db.commit()
    return hierarchy.folder_out(folder, PermissionLevel.full)


@router.post("/folders/{folder_id}/lists", response_model=s.ListOut, status_code=status.HTTP_201_CREATED)
def create_list_in_folder(
    folder_id: uuid.UUID, data: s.ListCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_folder(db, user.id, folder_id, VIEW)
    require_level(opened, FULL, "create lists here")
    space = db.get(Space, opened.obj.space_id)
    lst = hierarchy.create_list(db, opened.access, space, data, folder=opened.obj)
    db.commit()
    return hierarchy.list_out(lst, PermissionLevel.full)


# --- lists -------------------------------------------------------------------


@router.get("/lists/{list_id}", response_model=s.ListOut)
def get_list(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_list(db, user.id, list_id, VIEW)
    return hierarchy.list_out(opened.obj, opened.level)


@router.patch("/lists/{list_id}", response_model=s.ListOut)
def update_list(
    list_id: uuid.UUID, data: s.ListUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_list(db, user.id, list_id, VIEW)
    hierarchy.update_list(db, opened, data)
    db.commit()
    return hierarchy.list_out(opened.obj, opened.level)


@router.delete("/lists/{list_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_list(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    hierarchy.delete_location(db, open_list(db, user.id, list_id, VIEW))
    db.commit()


# --- statuses: GET effective set, PUT a replacement or inherit ----------------


def _status_set_out(db: Session, owner) -> s.StatusSetOut:
    source = status_source(db, owner)
    return s.StatusSetOut(
        source=s.StatusSource(kind=source_kind(source), id=source.id),
        inherited=source.id != owner.id,
        statuses=[s.StatusOut.model_validate(st) for st in effective_statuses(db, owner)],
    )


def _register_status_routes(path: str, opener: Callable) -> None:
    @router.get(f"{path}/statuses", response_model=s.StatusSetOut)
    def get_statuses(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        return _status_set_out(db, opener(db, user.id, obj_id, VIEW).obj)

    @router.put(f"{path}/statuses", response_model=s.StatusSetOut)
    def put_statuses(
        obj_id: uuid.UUID,
        data: s.StatusSetUpdate,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        opened = opener(db, user.id, obj_id, VIEW)
        require_level(opened, FULL, "change statuses")
        inputs = (
            None
            if data.inherit
            else [StatusInput(name=i.name, color=i.color, group=i.group, id=i.id) for i in data.statuses or []]
        )
        set_statuses(db, opened.obj, inputs, data.mapping)
        db.commit()
        return _status_set_out(db, opened.obj)


_register_status_routes("/spaces/{obj_id}", open_space)
_register_status_routes("/folders/{obj_id}", open_folder)
_register_status_routes("/lists/{obj_id}", open_list)


# --- sharing -----------------------------------------------------------------


def _register_share_routes(path: str, kind: LocationKind, opener: Callable) -> None:
    @router.get(f"{path}/shares", response_model=List[s.ShareOut])
    def get_shares(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        return sharing.list_shares(db, opener(db, user.id, obj_id, VIEW), kind)

    @router.get(f"{path}/sharing", response_model=s.SharingOut)
    def get_sharing(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        return sharing.sharing(db, opener(db, user.id, obj_id, VIEW), kind)

    @router.post(f"{path}/shares", response_model=s.ShareOut, status_code=status.HTTP_201_CREATED)
    def add_share(
        obj_id: uuid.UUID,
        data: s.ShareCreate,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        out = sharing.grant_share(db, opener(db, user.id, obj_id, VIEW), kind, data)
        db.commit()
        return out

    # Registered before the person route, so "teams" is never read as a user id.
    @router.delete(f"{path}/shares/teams/{{team_id}}", status_code=status.HTTP_204_NO_CONTENT)
    def remove_team_share(
        obj_id: uuid.UUID, team_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
    ):
        sharing.revoke_share(db, opener(db, user.id, obj_id, VIEW), kind, team_id=team_id)
        db.commit()

    @router.delete(f"{path}/shares/{{user_id}}", status_code=status.HTTP_204_NO_CONTENT)
    def remove_share(
        obj_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
    ):
        sharing.revoke_share(db, opener(db, user.id, obj_id, VIEW), kind, user_id=user_id)
        db.commit()


_register_share_routes("/spaces/{obj_id}", LocationKind.space, open_space)
_register_share_routes("/folders/{obj_id}", LocationKind.folder, open_folder)
_register_share_routes("/lists/{obj_id}", LocationKind.list, open_list)
_register_share_routes("/tasks/{obj_id}", LocationKind.task, open_task)


# --- task groups: named sets of similar tasks -----------------------------------------


def _register_group_routes(path: str, kind: LocationKind, opener: Callable) -> None:
    @router.get(f"{path}/groups", response_model=List[s.TaskGroupOut])
    def list_groups(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        """Groups usable here: defined on this location or above it."""
        return [groups.group_out(g) for g in groups.available(db, opener(db, user.id, obj_id, VIEW).obj)]

    @router.post(f"{path}/groups", response_model=s.TaskGroupOut, status_code=status.HTTP_201_CREATED)
    def create_group(
        obj_id: uuid.UUID, data: s.TaskGroupIn, user: User = Depends(current_user), db: Session = Depends(get_db)
    ):
        group = groups.create(db, opener(db, user.id, obj_id, VIEW), kind, data)
        db.commit()
        return groups.group_out(group)


_register_group_routes("/spaces/{obj_id}", LocationKind.space, open_space)
_register_group_routes("/folders/{obj_id}", LocationKind.folder, open_folder)
_register_group_routes("/lists/{obj_id}", LocationKind.list, open_list)


@router.patch("/groups/{group_id}", response_model=s.TaskGroupOut)
def update_group(group_id: uuid.UUID, data: s.TaskGroupIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    group = groups.update(db, user.id, group_id, data)
    db.commit()
    return groups.group_out(group)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(group_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    groups.delete(db, user.id, group_id)
    db.commit()


# --- custom fields -------------------------------------------------------------------------


def _register_field_routes(path: str, kind: LocationKind, opener: Callable) -> None:
    @router.get(f"{path}/fields", response_model=List[s.CustomFieldOut])
    def list_fields(
        obj_id: uuid.UUID,
        include_below: bool = Query(False, description="Also fields defined in the Lists and Folders inside"),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ):
        """Fields usable here (defined here or above); with include_below, every field a view here can show."""
        opened = opener(db, user.id, obj_id, VIEW)
        if include_below:
            lists = [lst for lst, _ in task_service.visible_lists(db, opened)]
            return [customfields.field_out(f) for f in customfields.in_view(db, opened.obj, lists)]
        return [customfields.field_out(f) for f in customfields.available(db, opened.obj)]

    @router.post(f"{path}/fields", response_model=s.CustomFieldOut, status_code=status.HTTP_201_CREATED)
    def create_field(
        obj_id: uuid.UUID, data: s.CustomFieldIn, user: User = Depends(current_user), db: Session = Depends(get_db)
    ):
        field = customfields.create(db, opener(db, user.id, obj_id, VIEW), kind, data)
        db.commit()
        return customfields.field_out(field)


_register_field_routes("/spaces/{obj_id}", LocationKind.space, open_space)
_register_field_routes("/folders/{obj_id}", LocationKind.folder, open_folder)
_register_field_routes("/lists/{obj_id}", LocationKind.list, open_list)


@router.patch("/fields/{field_id}", response_model=s.CustomFieldOut)
def update_field(field_id: uuid.UUID, data: s.CustomFieldUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    field = customfields.update(db, user.id, field_id, data)
    db.commit()
    return customfields.field_out(field)


@router.delete("/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    customfields.delete(db, user.id, field_id)
    db.commit()


@router.put("/tasks/{task_id}/fields/{field_id}", response_model=s.FieldValueOut)
def set_field_value(
    task_id: uuid.UUID, field_id: uuid.UUID, data: s.FieldValueIn,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    stored = customfields.set_value(db, open_task(db, user.id, task_id, VIEW), field_id, data.value)
    db.commit()
    return s.FieldValueOut(field_id=field_id, value=stored)


# --- assigning a List to a person -------------------------------------------------------


@router.put("/lists/{list_id}/assignee", response_model=s.ListOut)
def assign_list(list_id: uuid.UUID, data: s.ListAssign, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_list(db, user.id, list_id, VIEW)
    lst = assignment.assign_list(db, opened, data)
    db.commit()
    return hierarchy.list_out(lst, opened.level)


# --- moving and duplicating ---------------------------------------------------------------


def _open_target(db: Session, user: User, target: s.MoveTarget):
    if target.folder_id is not None:
        return open_folder(db, user.id, target.folder_id, VIEW)
    assert target.space_id is not None
    return open_space(db, user.id, target.space_id, VIEW)


def _open_parent(db: Session, user: User, obj):
    """The Space or Folder a List or Folder sits in."""
    parent_folder = getattr(obj, "folder_id", None) or getattr(obj, "parent_folder_id", None)
    if parent_folder:
        return open_folder(db, user.id, parent_folder, VIEW)
    return open_space(db, user.id, obj.space_id, VIEW)


@router.post("/lists/{list_id}/move", response_model=s.ListOut)
def move_list(list_id: uuid.UUID, data: s.MoveTarget, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_list(db, user.id, list_id, VIEW)
    copying.move_list(db, opened, _open_target(db, user, data))
    db.commit()
    return hierarchy.list_out(opened.obj, opened.level)


@router.post("/folders/{folder_id}/move", response_model=s.FolderOut)
def move_folder(folder_id: uuid.UUID, data: s.MoveTarget, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_folder(db, user.id, folder_id, VIEW)
    copying.move_folder(db, opened, _open_target(db, user, data))
    db.commit()
    return hierarchy.folder_out(opened.obj, opened.level)


@router.post("/lists/{list_id}/duplicate", response_model=s.ListOut, status_code=status.HTTP_201_CREATED)
def duplicate_list(list_id: uuid.UUID, data: s.DuplicateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_list(db, user.id, list_id, VIEW)
    copy = copying.duplicate_list(db, opened, _open_parent(db, user, opened.obj), data.name, data.include_tasks)
    db.commit()
    return hierarchy.list_out(copy, FULL)


@router.post("/folders/{folder_id}/duplicate", response_model=s.FolderOut, status_code=status.HTTP_201_CREATED)
def duplicate_folder(folder_id: uuid.UUID, data: s.DuplicateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_folder(db, user.id, folder_id, VIEW)
    copy = copying.duplicate_folder(db, opened, _open_parent(db, user, opened.obj), data.name, data.include_tasks)
    db.commit()
    return hierarchy.folder_out(copy, FULL)


@router.post("/tasks/{task_id}/duplicate", response_model=s.TaskDetailOut, status_code=status.HTTP_201_CREATED)
def duplicate_task(task_id: uuid.UUID, data: s.DuplicateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    target = open_list(db, user.id, data.list_id or opened.obj.list_id, VIEW)
    copy = copying.duplicate_task(db, opened, target, data.name, data.include_subtasks)
    db.commit()
    return task_service.task_detail(db, open_task(db, user.id, copy.id, VIEW))
