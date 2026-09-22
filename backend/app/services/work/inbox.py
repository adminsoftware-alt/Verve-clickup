"""The Inbox (notifications), notification settings and reminders."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.orm import Session

from app.db.models import (
    Notification,
    NotificationSetting,
    Reminder,
    Status,
    Task,
    TaskComment,
    User,
    WorkspaceMember,
)
from app.schemas import collab as c
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Access, chain_for_task, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.db.models import PermissionLevel

CLEARED_DAYS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _tab_filter(tab: str, now: datetime):
    awake = or_(Notification.snoozed_until.is_(None), Notification.snoozed_until <= now)
    if tab == "cleared":
        return and_(Notification.cleared_at.is_not(None), Notification.cleared_at >= now - timedelta(days=CLEARED_DAYS))
    if tab == "later":
        return and_(Notification.cleared_at.is_(None), or_(Notification.snoozed_until > now, Notification.saved.is_(True)))
    if tab == "all":
        return and_(Notification.cleared_at.is_(None), awake)
    return and_(Notification.cleared_at.is_(None), awake, Notification.category == tab)


def _mine(access: Access):
    return and_(Notification.user_id == access.user_id, Notification.workspace_id == access.workspace_id)


def items(db: Session, access: Access, tab: str, limit: int = 100) -> List[c.InboxItem]:
    now = _now()
    rows = list(db.scalars(select(Notification).where(_mine(access), _tab_filter(tab, now)).order_by(Notification.created_at.desc()).limit(limit)))
    if not rows:
        return []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.actor_id for r in rows if r.actor_id})))}
    tasks = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_({r.task_id for r in rows if r.task_id})))}
    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks.values()})))} if tasks else {}
    comments = {x.id: x for x in db.scalars(select(TaskComment).where(TaskComment.id.in_({r.comment_id for r in rows if r.comment_id})))}
    reminders = {x.id: x for x in db.scalars(select(Reminder).where(Reminder.id.in_({r.reminder_id for r in rows if r.reminder_id})))}
    visible = {tid for tid, t in tasks.items() if access.level(chain_for_task(db, t)) is not None}
    out = []
    for r in rows:
        if r.task_id and r.task_id not in visible:
            continue  # access was removed since
        task = tasks.get(r.task_id) if r.task_id else None
        comment = comments.get(r.comment_id) if r.comment_id else None
        reminder = reminders.get(r.reminder_id) if r.reminder_id else None
        out.append(c.InboxItem(
            id=r.id, kind=r.kind, category=r.category,
            actor=s.UserOut.model_validate(users[r.actor_id]) if r.actor_id in users else None,
            task=c.TaskRefOut(id=task.id, name=task.name, list_id=task.list_id, status=s.StatusOut.model_validate(statuses[task.status_id])) if task else None,
            comment={"id": str(comment.id), "body": comment.body[:300]} if comment else None,
            reminder={"id": str(reminder.id), "title": reminder.title, "remind_at": reminder.remind_at.isoformat()} if reminder else None,
            data=r.data, read=r.read_at is not None, cleared=r.cleared_at is not None, saved=r.saved,
            snoozed_until=r.snoozed_until, created_at=r.created_at,
        ))
    return out


def counts(db: Session, access: Access) -> c.InboxCounts:
    now = _now()
    unread = lambda tab: db.scalar(select(func.count()).select_from(Notification).where(
        _mine(access), _tab_filter(tab, now), Notification.read_at.is_(None))) or 0
    return c.InboxCounts(primary=unread("primary"), other=unread("other"), later=unread("later"))


def _own(db: Session, user_id: str, notification_id: uuid.UUID) -> Notification:
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user_id:
        raise NotFound("Notification not found")
    return row


def update_item(db: Session, user_id: str, notification_id: uuid.UUID, data: c.NotificationUpdate) -> Notification:
    row = _own(db, user_id, notification_id)
    now = _now()
    if data.read is not None:
        row.read_at = now if data.read else None
    if data.cleared is not None:
        row.cleared_at = now if data.cleared else None
        if data.cleared:
            row.read_at = row.read_at or now
    if data.saved is not None:
        row.saved = data.saved
    if data.unsnooze:
        row.snoozed_until = None
    elif data.snoozed_until is not None:
        if data.snoozed_until <= now:
            raise Invalid("Snooze until a time in the future")
        row.snoozed_until = data.snoozed_until
        row.read_at = None  # it comes back as new
    db.flush()
    return row


def bulk(db: Session, access: Access, tab: str, action: str) -> int:
    now = _now()
    values = {"read_at": now} if action == "read" else {"cleared_at": now, "read_at": now}
    cond = [_mine(access), _tab_filter(tab, now)]
    if action == "read":
        cond.append(Notification.read_at.is_(None))
    result = db.execute(update(Notification).where(*cond).values(**values).execution_options(synchronize_session=False))
    db.flush()
    return result.rowcount or 0


def settings(db: Session, access: Access) -> List[c.SettingRow]:
    row = db.get(NotificationSetting, (access.workspace_id, access.user_id))
    muted = row.muted if row else {}
    return [c.SettingRow(kind=k, label=label, enabled=not muted.get(k)) for k, label in events.KIND_LABELS.items()]


def save_settings(db: Session, access: Access, data: c.SettingsIn) -> List[c.SettingRow]:
    unknown = set(data.enabled) - set(events.KIND_LABELS)
    if unknown:
        raise Invalid(f"Unknown notification kinds: {', '.join(sorted(unknown))}")
    row = db.get(NotificationSetting, (access.workspace_id, access.user_id))
    if row is None:
        row = NotificationSetting(workspace_id=access.workspace_id, user_id=access.user_id, muted={})
        db.add(row)
    muted = dict(row.muted or {})
    for kind, on in data.enabled.items():
        if on:
            muted.pop(kind, None)
        else:
            muted[kind] = True
    row.muted = muted
    db.flush()
    return settings(db, access)


# --- reminders ---------------------------------------------------------------------------------


def _reminder_out(db: Session, access: Access, r: Reminder) -> c.ReminderOut:
    task = db.get(Task, r.task_id) if r.task_id else None
    ref = None
    if task is not None and access.level(chain_for_task(db, task)) is not None:
        status = db.get(Status, task.status_id)
        ref = c.TaskRefOut(id=task.id, name=task.name, list_id=task.list_id, status=s.StatusOut.model_validate(status) if status else None)
    user = db.get(User, r.user_id)
    assert user is not None
    return c.ReminderOut(id=r.id, title=r.title, task=ref, remind_at=r.remind_at, done=r.done_at is not None,
                         notified=r.notified_at is not None, user=s.UserOut.model_validate(user), created_by=r.created_by)


def list_reminders(db: Session, access: Access, state: str) -> List[c.ReminderOut]:
    q = select(Reminder).where(Reminder.workspace_id == access.workspace_id, Reminder.user_id == access.user_id)
    if state == "upcoming":
        q = q.where(Reminder.done_at.is_(None)).order_by(Reminder.remind_at)
    elif state == "done":
        q = q.where(Reminder.done_at.is_not(None)).order_by(Reminder.done_at.desc())
    else:
        q = q.order_by(Reminder.remind_at)
    return [_reminder_out(db, access, r) for r in db.scalars(q.limit(300))]


def create_reminder(db: Session, access: Access, data: c.ReminderIn) -> c.ReminderOut:
    target = data.user_id or access.user_id
    member = db.get(WorkspaceMember, (access.workspace_id, target))
    if member is None:
        raise NotFound("That person is not in this workspace")
    title = data.title
    if data.task_id is not None:
        opened = open_task(db, access.user_id, data.task_id, PermissionLevel.view)
        if opened.access.workspace_id != access.workspace_id:
            raise NotFound("Task not found")
        if target != access.user_id and Access(db, target, access.workspace_id, member.role).level(chain_for_task(db, opened.obj)) is None:
            raise Invalid("That person can't see this task")
        title = title or opened.obj.name
    if not title:
        raise Invalid("Give the reminder a title")
    r = Reminder(workspace_id=access.workspace_id, user_id=target, created_by=access.user_id, task_id=data.task_id,
                 title=title, remind_at=data.remind_at)
    db.add(r)
    db.flush()
    return _reminder_out(db, access, r)


def _own_reminder(db: Session, access: Access, reminder_id: uuid.UUID) -> Reminder:
    r = db.get(Reminder, reminder_id)
    if r is None or r.workspace_id != access.workspace_id or access.user_id not in (r.user_id, r.created_by):
        raise NotFound("Reminder not found")
    return r


def update_reminder(db: Session, access: Access, reminder_id: uuid.UUID, data: c.ReminderUpdate) -> c.ReminderOut:
    r = _own_reminder(db, access, reminder_id)
    if data.title is not None:
        r.title = data.title
    if data.remind_at is not None:
        r.remind_at = data.remind_at
        r.notified_at = None
    if data.done is not None:
        r.done_at = _now() if data.done else None
    db.flush()
    return _reminder_out(db, access, r)


def delete_reminder(db: Session, access: Access, reminder_id: uuid.UUID) -> None:
    db.delete(_own_reminder(db, access, reminder_id))
    db.flush()


def run_due_reminders(db: Session, now: Optional[datetime] = None) -> int:
    """Put reminders that have come due into their owner's Inbox."""
    now = now or _now()
    due = list(db.scalars(
        select(Reminder).where(Reminder.remind_at <= now, Reminder.notified_at.is_(None), Reminder.done_at.is_(None))
        .limit(200).with_for_update(skip_locked=True)
    ))
    for r in due:
        task = db.get(Task, r.task_id) if r.task_id else None
        events.notify(db, r.workspace_id, [r.user_id], r.created_by if r.created_by != r.user_id else None,
                      "reminder", "primary", task=task, reminder_id=r.id, data={"title": r.title})
        r.notified_at = now
    db.commit()
    return len(due)
