"""Workspace search (ClickUp's Ctrl+K): tasks by name or description.

Spaces, Folders, Lists and people are searched in the browser from the permission-filtered
sidebar tree and member list; tasks need the server. Only tasks the caller can open are
returned, so search never reveals private work.
"""

import re
import uuid
from typing import List

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Folder, Space, Task, TaskList
from app.schemas import work as s
from app.services.work.access import Access, chain_for_task
from app.services.work.tasks import serialise_tasks

CANDIDATES = 300


def _like(text: str) -> str:
    """Escape LIKE wildcards so they are searched for literally."""
    return text.replace(chr(92), chr(92) * 2).replace("%", chr(92) + "%").replace("_", chr(92) + "_")


def search_tasks(db: Session, user_id: str, workspace_id: uuid.UUID, query: str, limit: int) -> List[s.TaskOut]:
    access = Access.for_workspace(db, user_id, workspace_id)
    q = query.strip()
    if not q:
        return []
    found, levels = [], {}
    code = re.fullmatch(r"([A-Za-z0-9]+)-(\d+)", q)
    if code:
        # A custom task ID such as HR-12 finds that task first.
        exact = db.scalars(
            select(Task).join(TaskList, TaskList.id == Task.list_id).join(Space, Space.id == TaskList.space_id)
            .where(Space.workspace_id == workspace_id, func.upper(Space.task_prefix) == code.group(1).upper(), Task.seq == int(code.group(2)))
        ).first()
        if exact is not None:
            level = access.level(chain_for_task(db, exact))
            if level is not None:
                found.append(exact)
                levels[exact.id] = level
    pattern = f"%{_like(q)}%"
    starts = f"{_like(q)}%"
    rows = db.scalars(
        select(Task)
        .join(TaskList, TaskList.id == Task.list_id)
        .join(Space, Space.id == TaskList.space_id)
        .outerjoin(Folder, Folder.id == TaskList.folder_id)
        .where(
            Space.workspace_id == workspace_id,
            Task.archived_at.is_(None),
            TaskList.archived_at.is_(None),
            Space.archived_at.is_(None),
            or_(Folder.id.is_(None), Folder.archived_at.is_(None)),
            or_(Task.name.ilike(pattern, escape="\\"), Task.description.ilike(pattern, escape="\\")),
        )
        # Names that start with the words first, then names that contain them, then descriptions.
        .order_by(
            case((Task.name.ilike(starts, escape="\\"), 0), (Task.name.ilike(pattern, escape="\\"), 1), else_=2),
            Task.updated_at.desc(),
        )
        .limit(CANDIDATES)
    )
    for task in rows:
        if task.id in levels:
            continue
        level = access.level(chain_for_task(db, task))
        if level is None:
            continue
        found.append(task)
        levels[task.id] = level
        if len(found) >= limit:
            break
    return serialise_tasks(db, found, levels)
