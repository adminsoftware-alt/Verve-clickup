import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Task(TimestampMixin, Base):
    """A unit of work. Always lives in exactly one List (its home List).

    Subtasks are Tasks with a parent_id, and must share their parent's List.
    """

    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority BETWEEN 1 AND 4", name="priority_range"),
        CheckConstraint("time_estimate_seconds >= 0", name="estimate_non_negative"),
        CheckConstraint(
            "due_date IS NULL OR start_date IS NULL OR due_date >= start_date",
            name="due_after_start",
        ),
        CheckConstraint("parent_id IS NULL OR parent_id <> id", name="not_own_parent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    list_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    # Root of the subtask tree; NULL for top-level tasks. Makes whole-tree loads one query.
    top_level_parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    status_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("statuses.id"), nullable=False, index=True
    )
    # 1 = urgent, 2 = high, 3 = normal, 4 = low. NULL = no priority.
    priority: Mapped[Optional[int]] = mapped_column(SmallInteger)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    time_estimate_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    is_private: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    date_done: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    date_closed: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Custom task ID number within the task's Space (shown as "<prefix>-<seq>").
    seq: Mapped[Optional[int]] = mapped_column(Integer)
    type_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("task_types.id", ondelete="SET NULL"), index=True)
    # A named group of similar tasks ("Meetings", "Client calls"), defined on the List or above.
    group_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("task_groups.id", ondelete="SET NULL"), index=True
    )
    # How this task repeats (see services/work/recurrence.py); NULL for one-off tasks.
    recurrence: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)
    # For "create on schedule": when the next occurrence is due to be created.
    recurrence_next_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    # The earlier occurrence this task was created from.
    recurs_from_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))


class TaskGroup(TimestampMixin, Base):
    """A named group of similar tasks, defined on a Space, Folder or List.

    Every List at or below where it is defined can use it.
    """

    __tablename__ = "task_groups"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_parent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6366f1")
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class TaskAssignee(Base):
    __tablename__ = "task_assignees"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class Tag(Base):
    """Tags are defined per Space, like ClickUp's Tag Manager."""

    __tablename__ = "tags"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    fg_color: Mapped[str] = mapped_column(String(7), nullable=False)
    bg_color: Mapped[str] = mapped_column(String(7), nullable=False)


Index(
    "uq_tags_space_name",
    Tag.__table__.c.space_id,
    func.lower(Tag.__table__.c.name),
    unique=True,
)


class TaskTag(Base):
    __tablename__ = "task_tags"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class TaskType(TimestampMixin, Base):
    """ClickUp's task types: "Task" is the default; others (Milestone, Request, Bug…) get their own icon.

    A milestone type shows as a diamond and marks a key date.
    """

    __tablename__ = "task_types"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    name_plural: Mapped[Optional[str]] = mapped_column(String(40))
    icon: Mapped[str] = mapped_column(String(32), nullable=False, default="circle")
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6366f1")
    is_milestone: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class Favorite(Base):
    """Something a person starred to keep at the top of their sidebar."""

    __tablename__ = "favorites"
    __table_args__ = (CheckConstraint("kind IN ('space', 'folder', 'list', 'task', 'dashboard', 'view')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


Index("uq_favorites_user_target", Favorite.__table__.c.user_id, Favorite.__table__.c.kind, Favorite.__table__.c.target_id, unique=True)
Index("ix_favorites_user_workspace", Favorite.__table__.c.user_id, Favorite.__table__.c.workspace_id)
