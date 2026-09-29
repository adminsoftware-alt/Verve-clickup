"""Workspace administration: the audit log, and tasks created for a person by the joiner checklist."""

import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import DateTime, ForeignKey, Index, String, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AuditEvent(Base):
    """Something an admin (or a person, about their own access) changed. Kept even if the target is deleted."""

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_workspace_time", "workspace_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_kind: Mapped[Optional[str]] = mapped_column(String(30))
    target_id: Mapped[Optional[str]] = mapped_column(String(128))
    # A readable name for the target at the time, e.g. the person's name or the Space's name.
    target_label: Mapped[Optional[str]] = mapped_column(String(300))
    data: Mapped[Dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PersonTask(Base):
    """A task the joiner checklist made for someone, so the leaver steps know what to keep or delete."""

    __tablename__ = "person_tasks"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", "rule_key", name="one_per_rule"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_key: Mapped[str] = mapped_column(String(60), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
