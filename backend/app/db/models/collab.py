"""Working together on tasks: comments, reactions, watchers, activity, Inbox and reminders."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Index, String, Text, false, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TaskComment(Base):
    """A comment on a task. Replies point at the thread's first comment (parent_id)."""

    __tablename__ = "task_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("task_comments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    mention_user_ids: Mapped[List[str]] = mapped_column(ARRAY(String(128)), nullable=False, server_default=text("'{}'"))
    mention_team_ids: Mapped[List[str]] = mapped_column(ARRAY(String(64)), nullable=False, server_default=text("'{}'"))
    # An assigned comment is a small to-do for someone; it is done when resolved.
    assignee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    resolved_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class CommentReaction(Base):
    __tablename__ = "comment_reactions"

    comment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_comments.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    emoji: Mapped[str] = mapped_column(String(16), primary_key=True)


class TaskWatcher(Base):
    """Someone following a task: they hear about its activity in their Inbox."""

    __tablename__ = "task_watchers"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)


class TaskActivity(Base):
    """One change to a task, for its history (who changed what, when)."""

    __tablename__ = "task_activity"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class Notification(Base):
    """An Inbox item for one person.

    category "primary" is about you (assigned, mentioned, replies, reminders); "other" is
    activity on tasks you follow. Snoozed items show under "Later"; cleared ones under
    "Cleared".
    """

    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    comment_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("task_comments.id", ondelete="CASCADE"))
    reminder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("reminders.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    category: Mapped[str] = mapped_column(String(8), nullable=False)
    data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    cleared_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    snoozed_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    saved: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Sent outside the app: an instant email (or included in a digest), and a push to the person's devices.
    emailed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    pushed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


Index("ix_notifications_inbox", Notification.__table__.c.user_id, Notification.__table__.c.workspace_id, Notification.__table__.c.created_at)


class NotificationSetting(Base):
    """Which kinds of notification someone wants: {kind: false} turns one off."""

    __tablename__ = "notification_settings"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    muted: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))


class Reminder(Base):
    """"Remind me about this at …" — personal, optionally about a task."""

    __tablename__ = "reminders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    remind_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    done_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
