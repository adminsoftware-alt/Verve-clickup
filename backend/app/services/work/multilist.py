"""Tasks in Multiple Lists, as in ClickUp: a task keeps one home List but can also show in others.

It keeps its home List's statuses, custom IDs and fields; people who can open any of its Lists can open it.
"""

import uuid
from typing import Dict, List, Sequence, Tuple

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder, PermissionLevel, Space, Status, StatusGroup, Task, TaskAssignee, TaskList, TaskListLink,
    WorkspaceMember,
)
from app.schemas import spaces as sp
from app.services.work import events
from app.services.work.access import Opened, open_list
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

MAX_EXTRA_LISTS = 20


def extra_lists_for(db: Session, task_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, List[uuid.UUID]]:
    if not task_ids:
        return {}
    out: Dict[uuid.UUID, List[uuid.UUID]] = {}
    for task_id, list_id in db.execute(
        select(TaskListLink.task_id, TaskListLink.list_id).where(TaskListLink.task_id.in_(list(task_ids))).order_by(TaskListLink.created_at)
    ):
        out.setdefault(task_id, []).append(list_id)
    return out


def linked_rows(db: Session, list_ids: Sequence[uuid.UUID]) -> List[Tuple[Task, StatusGroup, uuid.UUID]]:
    """Tasks added to these Lists whose home List is not one of them."""
    if not list_ids:
        return []
    return [
        (task, group, list_id)
        for task, group, list_id in db.execute(
            select(Task, Status.group, TaskListLink.list_id)
            .join(TaskListLink, TaskListLink.task_id == Task.id)
            .join(Status, Status.id == Task.status_id)
            .where(TaskListLink.list_id.in_(list(list_ids)), Task.list_id.notin_(list(list_ids)))
        ).all()
    ]


def _path(db: Session, lst: TaskList) -> str:
    space = db.get(Space, lst.space_id)
    folder = db.get(Folder, lst.folder_id) if lst.folder_id else None
    return " / ".join(x for x in (space.name if space else None, folder.name if folder else None, lst.name) if x)


def lists_of(db: Session, opened: Opened[Task]) -> List[sp.TaskListRef]:
    """The task's home List first, then the other Lists it's in that the caller can see."""
    task = opened.obj
    home = db.get(TaskList, task.list_id)
    out = [sp.TaskListRef(id=home.id, name=home.name, path=_path(db, home), home=True)]
    for list_id in extra_lists_for(db, [task.id]).get(task.id, []):
        try:
            lst = open_list(db, opened.access.user_id, list_id, PermissionLevel.view).obj
        except (NotFound, Forbidden):
            continue
        out.append(sp.TaskListRef(id=lst.id, name=lst.name, path=_path(db, lst), home=False))
    return out


def add(db: Session, opened: Opened[Task], target: Opened[TaskList]) -> None:
    from app.services.work import space_admin

    task, access = opened.obj, opened.access
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to the task to add it to another List")
    if target.level != PermissionLevel.full:
        raise Forbidden("You need full access to the List to add tasks to it")
    if task.parent_id is not None:
        raise Invalid("Subtasks follow their parent; add the parent task instead")
    if target.access.workspace_id != access.workspace_id:
        raise Invalid("Tasks can't be added to a List in another workspace")
    if target.obj.id == task.list_id:
        raise Invalid("This is already the task's home List")
    home = db.get(TaskList, task.list_id)
    for space_id in {home.space_id, target.obj.space_id}:
        space_admin.require(db, space_id, "multiple_lists")
    if db.get(TaskListLink, (task.id, target.obj.id)) is not None:
        return
    if len(extra_lists_for(db, [task.id]).get(task.id, [])) >= MAX_EXTRA_LISTS:
        raise Invalid(f"A task can be in at most {MAX_EXTRA_LISTS} other Lists")
    db.add(TaskListLink(task_id=task.id, list_id=target.obj.id, added_by=access.user_id))
    db.flush()
    events.record(db, task, access.user_id, "list_added", {"list": target.obj.name})


def remove(db: Session, opened: Opened[Task], list_id: uuid.UUID) -> None:
    task = opened.obj
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to the task to take it out of a List")
    row = db.get(TaskListLink, (task.id, list_id))
    if row is None:
        raise NotFound("The task isn't in that List")
    lst = db.get(TaskList, list_id)
    db.delete(row)
    db.flush()
    events.record(db, task, opened.access.user_id, "list_removed", {"list": lst.name if lst else ""})


def forget_home(db: Session, task_id: uuid.UUID, list_id: uuid.UUID) -> None:
    """After a move, the new home List no longer needs a link."""
    db.execute(delete(TaskListLink).where(TaskListLink.task_id == task_id, TaskListLink.list_id == list_id))



# --- sharing one task with people -----------------------------------------------------------------


def share_with_people(db: Session, opened: Opened[Task], user_ids: List[str], assign: bool = True) -> List[str]:
    """Put this task in each person's Personal List. Returns who it reached.

    Not a copy. There is one task, one set of time entries, one comment thread: an hour Harish
    tracks is an hour Anjali sees, because they are looking at the same row. What each person
    gets is a way in -- the task appears in their own List, and `best_task_level` already reads
    access through any List a task is in.

    A Personal List is private to its owner, so nobody can place work there by holding access to
    it; that is the point of it. Admins may, deliberately, because handing work to someone is
    what running the place consists of. Sharing with yourself needs no such permission.
    """
    from app.services.work import mywork

    task, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the task to share it")
    if task.parent_id is not None:
        raise Invalid("Subtasks follow their parent; share the parent task instead")

    others = [uid for uid in dict.fromkeys(user_ids) if uid != access.user_id]
    if others and not can_manage_workspace(access.role):
        raise Forbidden("Only admins can share a task into someone else's Personal List.")

    home = db.get(TaskList, task.list_id)
    assert home is not None
    already = set(extra_lists_for(db, [task.id]).get(task.id, []))
    assigned = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    reached: List[str] = []

    for user_id in dict.fromkeys(user_ids):
        if db.get(WorkspaceMember, (access.workspace_id, user_id)) is None:
            continue
        lst = mywork.personal_list_of(db, access.workspace_id, user_id, create=True)
        if lst is None or lst.id == home.id:
            continue
        if lst.id not in already:
            if len(already) >= MAX_EXTRA_LISTS:
                raise Invalid(f"A task can be in at most {MAX_EXTRA_LISTS} other Lists")
            db.add(TaskListLink(task_id=task.id, list_id=lst.id, added_by=access.user_id))
            already.add(lst.id)
        # Sharing without assigning leaves the work in a place with nobody's name on it.
        if assign and user_id not in assigned:
            db.add(TaskAssignee(task_id=task.id, user_id=user_id))
            assigned.add(user_id)
        reached.append(user_id)

    if not reached:
        return []
    db.flush()
    events.record(db, task, access.user_id, "shared_with", {"people": reached, "assigned": assign})
    events.watch(db, task.id, reached)
    events.notify(
        db, access.workspace_id, reached, access.user_id, "shared", "primary", task=task,
        data={"what": "task", "name": task.name, "level": "full", "mutual": True},
    )
    return reached


def unshare_from_person(db: Session, opened: Opened[Task], user_id: str) -> None:
    """Take the task back out of one person's Personal List. The task itself is untouched."""
    from app.services.work import mywork

    task, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the task to change who it is shared with")
    if user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("Only admins can change who a task is shared with.")
    lst = mywork.personal_list_of(db, access.workspace_id, user_id)
    if lst is None or db.get(TaskListLink, (task.id, lst.id)) is None:
        raise NotFound("The task isn't shared with that person")
    db.execute(delete(TaskListLink).where(TaskListLink.task_id == task.id, TaskListLink.list_id == lst.id))
    db.flush()
    events.record(db, task, access.user_id, "unshared_with", {"people": [user_id]})


def shared_with(db: Session, task: Task, workspace_id: uuid.UUID) -> List[str]:
    """Who this task sits with personally: the owners of the Personal Lists it has been put in."""
    lists = extra_lists_for(db, [task.id]).get(task.id, [])
    if not lists:
        return []
    return list(db.scalars(
        select(Space.personal_owner_id)
        .join(TaskList, TaskList.space_id == Space.id)
        .where(TaskList.id.in_(lists), Space.personal_owner_id.is_not(None), Space.workspace_id == workspace_id)
    ))
