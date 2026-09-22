"""Task dependencies, links and merging."""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import links
from app.services.work import tasks as task_service
from app.services.work.access import open_task

router = APIRouter()
VIEW = PermissionLevel.view


@router.get("/tasks/{task_id}/links", response_model=s.TaskLinks)
def task_links(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return links.links_for(db, open_task(db, user.id, task_id, VIEW))


@router.post("/tasks/{task_id}/links", response_model=s.TaskLinks, status_code=status.HTTP_201_CREATED)
def add_link(task_id: uuid.UUID, data: s.LinkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    links.add_link(db, opened, data)
    db.commit()
    return links.links_for(db, open_task(db, user.id, task_id, VIEW))


@router.delete("/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    links.remove_link(db, user.id, link_id)
    db.commit()


@router.post("/tasks/{task_id}/merge", response_model=s.TaskDetailOut)
def merge_tasks(task_id: uuid.UUID, data: s.MergeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    links.merge(db, user.id, task_id, data.source_ids)
    db.commit()
    return task_service.task_detail(db, open_task(db, user.id, task_id, VIEW))
