"""Goals, as in ClickUp: measurable targets (numbers, money, yes/no, or tasks to finish) with owners.
A Team goal belongs to a Team; progress is the average of its targets."""

import uuid
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, String, Text, false, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Goal(TimestampMixin, Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), nullable=False, default="#6366f1")
    folder: Mapped[Optional[str]] = mapped_column(String(80))  # e.g. "FY 2026-27", "Q3"
    team_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)
    owner_ids: Mapped[List[str]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    is_private: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class GoalTarget(Base):
    """One measurable part of a goal."""

    __tablename__ = "goal_targets"
    __table_args__ = (CheckConstraint("kind IN ('number', 'currency', 'true_false', 'tasks')", name="kind"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    goal_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goals.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    start_value: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    target_value: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    current_value: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    unit: Mapped[Optional[str]] = mapped_column(String(20))  # "clients", "INR"
    # tasks: finish these tasks, or every task in these Lists
    task_ids: Mapped[List[str]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    list_ids: Mapped[List[str]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    owner_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class GoalCheckIn(Base):
    """A new value for a target, with a note: the history behind a goal's progress."""

    __tablename__ = "goal_check_ins"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    target_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("goal_targets.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    value: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[Optional[str]] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

