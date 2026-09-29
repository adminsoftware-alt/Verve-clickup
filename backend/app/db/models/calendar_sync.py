"""Two-way calendar sync with Google Calendar and Outlook (Microsoft 365).

A connection belongs to one person in one workspace. Their tasks with due dates and their Planner
time blocks are written to the calendar; the calendar's events show in the Planner, and moving one
of the events we wrote moves the task or time block here too.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint, func, text, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"
    __table_args__ = (
        CheckConstraint("provider IN ('google', 'microsoft')", name="provider"),
        UniqueConstraint("workspace_id", "user_id", "provider", name="uq_calendar_connections_one_per_provider"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(10), nullable=False)
    account_email: Mapped[Optional[str]] = mapped_column(String(320))
    calendar_id: Mapped[str] = mapped_column(String(300), nullable=False, default="primary")
    # Tokens are stored encrypted (see services/work/calendar_sync.py).
    access_token: Mapped[Optional[str]] = mapped_column(Text)
    refresh_token: Mapped[Optional[str]] = mapped_column(Text)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    push_tasks: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    push_blocks: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    pull_events: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#16a34a")
    events: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False, default=list)
    synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    error: Mapped[Optional[str]] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CalendarSyncItem(Base):
    """One task or time block we wrote to the calendar, and what it looked like when we last agreed."""

    __tablename__ = "calendar_sync_items"
    __table_args__ = (
        CheckConstraint("kind IN ('task', 'block')", name="kind"),
        UniqueConstraint("connection_id", "kind", "local_id", name="uq_calendar_sync_items_local"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("calendar_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(5), nullable=False)
    local_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    remote_id: Mapped[str] = mapped_column(String(300), nullable=False)
    # "start|end|title" as both sides last agreed; a change on either side is measured against it.
    agreed: Mapped[str] = mapped_column(String(500), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
