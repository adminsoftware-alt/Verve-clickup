"""Favourites, task types and the Tag Manager."""

import uuid
from typing import List

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import organise
from app.services.work.access import Access, open_space

router = APIRouter()


class FavoriteOrder(BaseModel):
    ids: List[uuid.UUID]


@router.get("/workspaces/{workspace_id}/favorites", response_model=List[s.FavoriteOut])
def favorites(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return organise.list_favorites(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/favorites", response_model=List[s.FavoriteOut], status_code=status.HTTP_201_CREATED)
def add_favorite(workspace_id: uuid.UUID, data: s.FavoriteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    organise.add_favorite(db, access, data)
    db.commit()
    return organise.list_favorites(db, access)


@router.delete("/workspaces/{workspace_id}/favorites/{kind}/{target_id}", response_model=List[s.FavoriteOut])
def remove_favorite(workspace_id: uuid.UUID, kind: str, target_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    organise.remove_favorite(db, access, kind, target_id)
    db.commit()
    return organise.list_favorites(db, access)


@router.put("/workspaces/{workspace_id}/favorites/order", response_model=List[s.FavoriteOut])
def order_favorites(workspace_id: uuid.UUID, data: FavoriteOrder, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    organise.reorder_favorites(db, access, data.ids)
    db.commit()
    return organise.list_favorites(db, access)


@router.get("/workspaces/{workspace_id}/task-types", response_model=List[s.TaskTypeOut])
def task_types(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = organise.types_out(db, Access.for_workspace(db, user.id, workspace_id))
    db.commit()
    return rows


@router.post("/workspaces/{workspace_id}/task-types", response_model=s.TaskTypeOut, status_code=status.HTTP_201_CREATED)
def create_task_type(workspace_id: uuid.UUID, data: s.TaskTypeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    kind = organise.create_type(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return kind


@router.patch("/workspaces/{workspace_id}/task-types/{type_id}", response_model=s.TaskTypeOut)
def update_task_type(workspace_id: uuid.UUID, type_id: uuid.UUID, data: s.TaskTypeUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    kind = organise.update_type(db, Access.for_workspace(db, user.id, workspace_id), type_id, data)
    db.commit()
    return kind


@router.delete("/workspaces/{workspace_id}/task-types/{type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_type(workspace_id: uuid.UUID, type_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    organise.delete_type(db, Access.for_workspace(db, user.id, workspace_id), type_id)
    db.commit()


@router.get("/spaces/{space_id}/tags", response_model=List[s.TagUsage])
def space_tags(space_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return organise.tags_in_space(db, open_space(db, user.id, space_id, PermissionLevel.view))


@router.post("/spaces/{space_id}/tags", response_model=s.TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(space_id: uuid.UUID, data: s.TagIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tag = organise.create_tag(db, open_space(db, user.id, space_id, PermissionLevel.view), data)
    db.commit()
    return tag


@router.patch("/tags/{tag_id}", response_model=s.TagOut)
def update_tag(tag_id: uuid.UUID, data: s.TagUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tag = organise.update_tag(db, user.id, tag_id, data)
    db.commit()
    return tag


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(tag_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    organise.delete_tag(db, user.id, tag_id)
    db.commit()
