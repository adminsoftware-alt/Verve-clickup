"""All Tasks, Gantt dependencies, the Activity view and Forms."""

import uuid
from datetime import datetime
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, User, View
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import viewdata
from app.services.work.access import Access, open_folder, open_list, open_space
from app.services.work.errors import NotFound

router = APIRouter()
VIEW = PermissionLevel.view


@router.get("/workspaces/{workspace_id}/all-tasks", response_model=s.TaskPage)
def all_tasks(
    workspace_id: uuid.UUID, include_closed: bool = Query(False), limit: int = Query(2000, ge=1, le=5000),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return viewdata.all_tasks(db, Access.for_workspace(db, user.id, workspace_id), include_closed, limit)


def _location_routes(path: str, opener: Callable) -> None:
    @router.get(f"{path}/dependencies", response_model=List[s.DependencyOut])
    def dependencies(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        return viewdata.dependencies_in(db, opener(db, user.id, obj_id, VIEW))

    @router.get(f"{path}/activity", response_model=List[s.LocationActivity])
    def activity(
        obj_id: uuid.UUID, limit: int = Query(100, ge=1, le=500), before: Optional[datetime] = Query(None),
        user: User = Depends(current_user), db: Session = Depends(get_db),
    ):
        return viewdata.activity_in(db, opener(db, user.id, obj_id, VIEW), limit, before)


_location_routes("/spaces/{obj_id}", open_space)
_location_routes("/folders/{obj_id}", open_folder)
_location_routes("/lists/{obj_id}", open_list)


def _form_access(db: Session, user_id: str, view_id: uuid.UUID) -> Access:
    view = db.get(View, view_id)
    if view is None or view.list_id is None:
        raise NotFound("Form not found")
    from app.db.models import Space, TaskList

    lst = db.get(TaskList, view.list_id)
    space = db.get(Space, lst.space_id) if lst else None
    if space is None:
        raise NotFound("Form not found")
    try:
        return Access.for_workspace(db, user_id, space.workspace_id)
    except NotFound:
        raise NotFound("Form not found") from None


@router.get("/forms/{view_id}", response_model=s.FormOut)
def get_form(view_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return viewdata.form_for(db, _form_access(db, user.id, view_id), view_id)


@router.post("/forms/{view_id}/submit", response_model=s.FormSubmitted, status_code=status.HTTP_201_CREATED)
def submit_form(view_id: uuid.UUID, data: s.FormSubmit, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _form_access(db, user.id, view_id)
    task_id = viewdata.submit_form(db, access, view_id, data.answers)
    message = viewdata.form_for(db, access, view_id).success
    db.commit()
    return s.FormSubmitted(task_id=task_id, message=message)
