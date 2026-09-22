"""Home: the caller's own work across the workspace, and their Personal List.

As in ClickUp, "My Tasks" gathers every task assigned to you that you can still open,
wherever it lives, and the Personal List is a private List only you can see. It lives
in a hidden Space of its own so it gets statuses and views like any other List, and it
is kept out of the sidebar tree.
"""

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Union

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.db.models import Folder, Space, Task, TaskAssignee, TaskList
from app.schemas import work as s
from app.services.work.access import Access, chain_for_list
from app.services.work.errors import Invalid
from app.services.work.statuses import seed_space_statuses
from app.services.work.tasks import TaskFilter, serialise_tasks, visible_tasks
from app.services.work.views import add_required_views

PERSONAL_LIST_NAME = "Personal List"


def is_personal(db: Session, obj: Union[Space, Folder, TaskList]) -> bool:
    space = obj if isinstance(obj, Space) else db.get(Space, obj.space_id)
    return space is not None and space.personal_owner_id is not None


def personal_list(db: Session, access: Access, create: bool = False) -> Optional[TaskList]:
    """The caller's Personal List in this workspace, created on first use when asked."""
    space = db.scalars(
        select(Space).where(
            Space.workspace_id == access.workspace_id,
            Space.personal_owner_id == access.user_id,
        )
    ).first()
    if space is None:
        if not create:
            return None
        space = Space(
            workspace_id=access.workspace_id,
            name="Personal",
            is_private=True,
            created_by=access.user_id,
            personal_owner_id=access.user_id,
            orderindex=0,
        )
        db.add(space)
        db.flush()
        seed_space_statuses(db, space)
        lst = TaskList(
            space_id=space.id,
            name=PERSONAL_LIST_NAME,
            is_private=True,
            created_by=access.user_id,
            orderindex=0,
        )
        db.add(lst)
        db.flush()
        add_required_views(db, lst, access.user_id)
        db.flush()
        return lst
    return db.scalars(select(TaskList).where(TaskList.space_id == space.id)).first()


def my_tasks(db: Session, access: Access, include_closed: bool) -> List[s.TaskOut]:
    """Every task assigned to the caller that they can open, in any Space."""
    return tasks_assigned_to(db, access, [access.user_id], include_closed)


def tasks_assigned_to(db: Session, access: Access, user_ids: List[str], include_closed: bool) -> List[s.TaskOut]:
    """Tasks assigned to any of these people that the caller can open (a person's or a team's work)."""
    if not user_ids:
        return []
    return tasks_among(db, access, select(TaskAssignee.task_id).where(TaskAssignee.user_id.in_(user_ids)), include_closed)


def tasks_among(db: Session, access: Access, task_ids: Select, include_closed: bool) -> List[s.TaskOut]:
    """The tasks picked by `task_ids` (a query of ids) that the caller can open, in this workspace."""
    mine = task_ids
    list_ids = set(
        db.scalars(
            select(Task.list_id)
            .join(TaskList, TaskList.id == Task.list_id)
            .join(Space, Space.id == TaskList.space_id)
            .where(Task.id.in_(mine), Space.workspace_id == access.workspace_id)
            .distinct()
        )
    )
    lists = []
    for lst in db.scalars(select(TaskList).where(TaskList.id.in_(list_ids))) if list_ids else []:
        if lst.archived_at is not None:
            continue
        folder = db.get(Folder, lst.folder_id) if lst.folder_id else None
        space = db.get(Space, lst.space_id)
        if (folder is not None and folder.archived_at is not None) or (space and space.archived_at is not None):
            continue
        chain = chain_for_list(db, lst)
        if access.level(chain) is not None:
            lists.append((lst, chain))
    assigned = set(db.scalars(mine))
    tasks, levels, _ = visible_tasks(db, access, lists, TaskFilter(include_closed=include_closed))
    return serialise_tasks(db, [t for t in tasks if t.id in assigned], levels)


def done_recently(db: Session, access: Access, days: int = 30) -> List[s.TaskOut]:
    """My Work "Done": tasks assigned to the caller that were finished in the last `days` days, newest first."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    ids = (
        select(TaskAssignee.task_id)
        .join(Task, Task.id == TaskAssignee.task_id)
        .where(TaskAssignee.user_id == access.user_id, Task.date_done.is_not(None), Task.date_done >= since)
    )
    found = tasks_among(db, access, ids, include_closed=True)
    return sorted(found, key=lambda t: t.date_done or since, reverse=True)


def delegated(db: Session, access: Access) -> List[s.TaskOut]:
    """My Work "Delegated": open tasks the caller created and gave to other people (not to themselves)."""
    mine = select(TaskAssignee.task_id).where(TaskAssignee.user_id == access.user_id)
    ids = (
        select(Task.id)
        .where(Task.created_by == access.user_id, Task.id.not_in(mine))
        .where(Task.id.in_(select(TaskAssignee.task_id)))
    )
    return tasks_among(db, access, ids, include_closed=False)


def ensure_not_personal(db: Session, obj: Union[Space, Folder, TaskList], action: str) -> None:
    if is_personal(db, obj):
        raise Invalid(f"Your Personal List cannot be {action}")

