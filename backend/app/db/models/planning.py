"""Personal planning (ClickUp's Planner, LineUp and calendar sync) and simple automations."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func, text, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class TimeBlock(Base):
    """A slot on someone's Planner: time set aside for a task, or for anything else ("Focus time")."""

    __tablename__ = "time_blocks"
    __table_args__ = (
        CheckConstraint("end_at > start_at", name="ends_after_start"),
        CheckConstraint("task_id IS NOT NULL OR title IS NOT NULL", name="task_or_title"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    title: Mapped[Optional[str]] = mapped_column(String(200))
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LineupItem(Base):
    """A task someone put in their personal LineUp (their own ordered top priorities)."""

    __tablename__ = "lineup_items"
    __table_args__ = (UniqueConstraint("user_id", "task_id", name="once"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    position: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class CalendarFeed(Base):
    """An outside calendar (Google, Outlook…) someone subscribed to by its secret iCal address.

    Events are fetched by the server and cached here, so the Planner can show meetings next to tasks.
    """

    __tablename__ = "calendar_feeds"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#0ea5e9")
    events: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False, default=list)
    fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error: Mapped[Optional[str]] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Automation(Base):
    """A fixed "when this happens, do that" rule on a Space, Folder or List (ClickUp Automations, simplified).

    trigger: "task_created" or "status_changed" (config.status: a status name, or empty for any change).
    action: "assign" (config.user_ids), "notify" (config.user_ids), "set_priority" (config.priority)
    or "set_status" (config.status_name: a status of the task's List).
    """

    __tablename__ = "automations"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_location"),
        CheckConstraint("trigger IN ('task_created', 'status_changed')", name="trigger_kind"),
        CheckConstraint("action IN ('assign', 'notify', 'set_priority', 'set_status')", name="action_kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    trigger_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    action_config: Mapped[Dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    run_count: Mapped[int] = mapped_column(server_default=text("0"), nullable=False, default=0)
