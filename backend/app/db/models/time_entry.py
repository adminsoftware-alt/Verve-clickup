import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, Text, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class TimeEntry(TimestampMixin, Base):
    """Time someone spent on a task: a running timer (ended_at is NULL) or a finished entry."""

    __tablename__ = "time_entries"
    __table_args__ = (
        CheckConstraint("ended_at IS NULL OR ended_at >= started_at", name="ends_after_start"),
        CheckConstraint("duration_seconds IS NULL OR duration_seconds >= 0", name="duration_non_negative"),
        CheckConstraint(
            "(ended_at IS NULL) = (duration_seconds IS NULL)", name="finished_entries_have_duration"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    description: Mapped[Optional[str]] = mapped_column(Text)
    billable: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


# One running timer per person, as in ClickUp: starting another stops the first.
Index(
    "uq_time_entries_running_per_user",
    TimeEntry.__table__.c.user_id,
    unique=True,
    postgresql_where=TimeEntry.__table__.c.ended_at.is_(None),
)
