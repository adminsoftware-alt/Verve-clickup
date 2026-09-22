"""Timesheets: time tags, added rows, capacity, settings and weekly approvals.

A timesheet is a view over time entries (see services/work/timesheets.py); nothing here
stores the hours themselves.
"""

import uuid
from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    false,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class TimeTag(TimestampMixin, Base):
    """A label for time entries ("time tracking tags"), separate from task tags."""

    __tablename__ = "time_tags"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    bg_color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#e0e7ff")
    fg_color: Mapped[str] = mapped_column(String(7), nullable=False, server_default="#3730a3")
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


Index("uq_time_tags_workspace_name", TimeTag.__table__.c.workspace_id, func.lower(TimeTag.__table__.c.name), unique=True)


class TimeEntryTag(Base):
    __tablename__ = "time_entry_tags"

    time_entry_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("time_entries.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("time_tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class TimesheetRow(Base):
    """A task added to someone's timesheet for a period, so it shows even at 0h."""

    __tablename__ = "timesheet_rows"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    period_start: Mapped[date] = mapped_column(Date, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TimesheetSettings(Base):
    """Per-workspace timesheet settings, set by owners and admins."""

    __tablename__ = "timesheet_settings"
    __table_args__ = (CheckConstraint("week_start BETWEEN 0 AND 6", name="week_start_range"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    week_start: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("6"))  # 0 = Monday, 6 = Sunday
    approvals_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=false())
    # Default capacity per weekday (Monday first), in seconds: the workspace work schedule.
    capacity_seconds: Mapped[List[int]] = mapped_column(
        ARRAY(Integer), nullable=False, server_default=text("'{28800,28800,28800,28800,28800,0,0}'")
    )


class MemberCapacity(Base):
    """Someone's own working hours per weekday (Monday first), overriding the workspace's."""

    __tablename__ = "member_capacity"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    capacity_seconds: Mapped[List[int]] = mapped_column(ARRAY(Integer), nullable=False)


class TimesheetApprover(Base):
    """Who approves whose timesheet. Without an entry, the submitter's Team leads approve."""

    __tablename__ = "timesheet_approvers"

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    submitter_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    approver_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class TimesheetSubmission(TimestampMixin, Base):
    """One person's timesheet for one period, as it moves through approval.

    pending -> approved | changes_needed; pending -> withdrawn; approved -> changes_needed (reopen).
    Entries in the period are locked while pending or approved.
    """

    __tablename__ = "timesheet_submissions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'changes_needed', 'withdrawn')", name="status_values"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)  # inclusive
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Totals when submitted, so reviewers see what was sent even if it changes later.
    tracked_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    billable_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    capacity_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


Index(
    "uq_timesheet_submissions_period",
    TimesheetSubmission.__table__.c.workspace_id,
    TimesheetSubmission.__table__.c.user_id,
    TimesheetSubmission.__table__.c.period_start,
    unique=True,
)


class TimesheetComment(Base):
    """The conversation on a submission, including approve / request-changes notes."""

    __tablename__ = "timesheet_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    submission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("timesheet_submissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # A status change this comment records ("submitted", "approved", ...), or None for a plain comment.
    event: Mapped[Optional[str]] = mapped_column(String(24))
    body: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
