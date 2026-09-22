"""Task history and Inbox notifications.

Every change worth remembering is recorded as TaskActivity. Some changes also notify
people, as in ClickUp:
  * primary (about you): you were assigned, mentioned, someone replied in your thread,
    a comment was assigned to you, your reminder is due;
  * other (activity on tasks you watch): new comments, status changes, due date changes,
    assignee changes, new attachments.
Watchers are added automatically: the creator, assignees, commenters and anyone mentioned.
People are never notified about their own actions, about tasks they can't see, or about
kinds they have turned off.
"""

import uuid
from typing import Any, Dict, Iterable, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Notification,
    NotificationSetting,
    Space,
    Task,
    TaskActivity,
    TaskList,
    TaskWatcher,
    WorkspaceMember,
)
from app.services.work.access import Access, chain_for_task

# kind -> (who hears about it: "watchers" | None, human label)
ACTIVITY_NOTIFIES = {
    "status": "watchers",
    "due_date": "watchers",
    "assignees": "watchers",
    "attachment": "watchers",
    "custom_field": "watchers",
}

KIND_LABELS = {
    "assigned": "Assigned to me",
    "mentioned": "Mentions",
    "reply": "Replies to my comments",
    "comment": "Comments on tasks I watch",
    "assigned_comment": "Comments assigned to me",
    "status": "Status changes",
    "due_date": "Due date changes",
    "assignees": "Assignee changes",
    "attachment": "New attachments",
    "custom_field": "Custom field changes",
    "checklist_item": "Checklist items assigned to me",
    "reminder": "Reminders",
    "automation": "Automation messages",
}


def workspace_of(db: Session, task: Task) -> uuid.UUID:
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    space = db.get(Space, lst.space_id)
    assert space is not None
    return space.workspace_id


def watch(db: Session, task_id: uuid.UUID, user_ids: Iterable[Optional[str]]) -> None:
    current = set(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)))
    for uid in {u for u in user_ids if u} - current:
        db.add(TaskWatcher(task_id=task_id, user_id=uid))
    db.flush()


def unwatch(db: Session, task_id: uuid.UUID, user_id: str) -> None:
    row = db.get(TaskWatcher, (task_id, user_id))
    if row is not None:
        db.delete(row)
        db.flush()


def watchers(db: Session, task_id: uuid.UUID) -> Set[str]:
    return set(db.scalars(select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)))


def _muted(db: Session, workspace_id: uuid.UUID, user_id: str) -> Dict[str, Any]:
    row = db.get(NotificationSetting, (workspace_id, user_id))
    return row.muted if row else {}


def notify(
    db: Session,
    workspace_id: uuid.UUID,
    recipients: Iterable[Optional[str]],
    actor_id: Optional[str],
    kind: str,
    category: str,
    task: Optional[Task] = None,
    comment_id: Optional[uuid.UUID] = None,
    reminder_id: Optional[uuid.UUID] = None,
    data: Optional[Dict[str, Any]] = None,
    already: Optional[Set[str]] = None,
) -> Set[str]:
    """Create Inbox items; returns who was notified (so callers can avoid doubles)."""
    sent: Set[str] = set()
    chain = chain_for_task(db, task) if task is not None else None
    for uid in {r for r in recipients if r}:
        if uid == actor_id or (already and uid in already):
            continue
        member = db.get(WorkspaceMember, (workspace_id, uid))
        if member is None:
            continue
        if chain is not None and Access(db, uid, workspace_id, member.role).level(chain) is None:
            continue
        if _muted(db, workspace_id, uid).get(kind):
            continue
        db.add(Notification(
            workspace_id=workspace_id, user_id=uid, actor_id=actor_id, task_id=task.id if task else None,
            comment_id=comment_id, reminder_id=reminder_id, kind=kind, category=category, data=data or {},
        ))
        sent.add(uid)
    db.flush()
    return sent


def record(
    db: Session, task: Task, actor_id: Optional[str], kind: str, data: Optional[Dict[str, Any]] = None,
) -> TaskActivity:
    """Remember a change, and tell watchers when it's the kind they hear about."""
    row = TaskActivity(task_id=task.id, user_id=actor_id, kind=kind, data=data or {})
    db.add(row)
    db.flush()
    if ACTIVITY_NOTIFIES.get(kind) == "watchers":
        notify(db, workspace_of(db, task), watchers(db, task.id), actor_id, kind, "other", task=task, data=data)
    if kind in ("created", "status"):
        from app.services.work import automations  # local: automations record events themselves

        automations.fire(db, task, kind, data or {})
    return row


def assigned(db: Session, task: Task, actor_id: Optional[str], user_ids: Iterable[str]) -> None:
    """New assignees watch the task and get a primary notification."""
    ids = list(user_ids)
    if not ids:
        return
    watch(db, task.id, ids)
    notify(db, workspace_of(db, task), ids, actor_id, "assigned", "primary", task=task)
