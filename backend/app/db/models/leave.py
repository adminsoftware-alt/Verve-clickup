"""Leave, holidays and billing: the parts of people's time that aren't task work, and what time is worth."""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Numeric, SmallInteger, String, Text, UniqueConstraint,
    false, func, text, true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class LeaveType(Base):
    """A kind of leave with its yearly allowance, e.g. Casual (12 days), Sick (12 days)."""

    __tablename__ = "leave_types"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_leave_types_name"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(9), nullable=False, default="#0ea5e9")
    yearly_days: Mapped[Optional[float]] = mapped_column(Float)  # None: no limit
    paid: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    needs_approval: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    archived: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)


class Holiday(Base):
    """A company holiday: nobody is expected to work, so it counts as no capacity and no leave."""

    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("workspace_id", "day", name="uq_holidays_day"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)


class LeavePolicy(Base):
    """One workspace's leave rules. Absent means the defaults below, which suit an Indian firm."""

    __tablename__ = "leave_policies"
    __table_args__ = (
        CheckConstraint("year_start_month BETWEEN 1 AND 12", name="year_start_month_range"),
        CheckConstraint("min_notice_days >= 0", name="min_notice_days_not_negative"),
        CheckConstraint("carry_forward_days IS NULL OR carry_forward_days >= 0", name="carry_forward_not_negative"),
        CheckConstraint("escalate_after_days IS NULL OR escalate_after_days > 0", name="escalate_after_days_positive"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    #: 4 = April, the financial year most Indian firms run on. 1 is the calendar year.
    year_start_month: Mapped[int] = mapped_column(SmallInteger, nullable=False, server_default="4", default=4)
    #: None: nothing carries over. 0 is a different answer, so they cannot share a value.
    carry_forward_days: Mapped[Optional[float]] = mapped_column(Float)
    prorate_joiners: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    min_notice_days: Mapped[int] = mapped_column(SmallInteger, server_default="0", nullable=False, default=0)
    allow_backdated: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    #: The sandwich rule: whether weekends and holidays inside a span are counted as leave.
    count_days_off_inside: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    #: None: a request waits for its approver for as long as that takes.
    escalate_after_days: Mapped[Optional[int]] = mapped_column(SmallInteger)
    #: HR: they see every request, and they decide when the manager cannot.
    hr_team_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"))
    #: [{"from": "09-15", "to": "09-30", "reason": "Audit season"}] -- days nobody may book.
    blackout: Mapped[list] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class LeaveAdjustment(Base):
    """Days added to or taken off a balance: carried forward, granted, or corrected by hand."""

    __tablename__ = "leave_adjustments"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", "type_id", "year", name="uq_leave_adjustments_person_year"),
        Index("ix_leave_adjustments_lookup", "workspace_id", "user_id", "year"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("leave_types.id", ondelete="CASCADE"), nullable=False)
    #: The leave year, named by the calendar year it starts in.
    year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    days: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(200))
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class LeaveRequest(Base):
    """Someone's time off, from request to decision. `days` counts working days only (weekends and holidays excluded)."""

    __tablename__ = "leave_requests"
    __table_args__ = (
        CheckConstraint("end_date >= start_date", name="ends_after_start"),
        CheckConstraint("status IN ('pending', 'approved', 'rejected', 'cancelled')", name="status_kind"),
        CheckConstraint("part IN ('full', 'first_half', 'second_half')", name="part_kind"),
        UniqueConstraint("workspace_id", "source_id", name="uq_leave_requests_source"),
        Index("ix_leave_requests_workspace_dates", "workspace_id", "start_date", "end_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("leave_types.id", ondelete="SET NULL"))
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    part: Mapped[str] = mapped_column(String(12), nullable=False, default="full")  # half days are single-day requests
    days: Mapped[float] = mapped_column(Float, nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="pending")
    approver_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    decision_note: Mapped[Optional[str]] = mapped_column(String(500))
    source_id: Mapped[Optional[str]] = mapped_column(String(128))  # e.g. the old system's id, for imports
    #: When HR was told this had been waiting too long. Set once, so nobody is told twice.
    escalated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    #: Who covers the work while they are away. Named by the approver, not the person asking.
    cover_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ImportedRecord(Base):
    """What an import has already brought over (by its id in the old system), so running it again adds nothing twice."""

    __tablename__ = "imported_records"
    __table_args__ = (UniqueConstraint("workspace_id", "source", "source_id", name="uq_imported_records_source"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. "v1.task", "v1.time_entry"
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class BillingRate(Base):
    """An hourly billing rate: a person's default (no location), or a rate on a Space/Folder/List (for a person or everyone)."""

    __tablename__ = "billing_rates"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) <= 1", name="one_location"),
        CheckConstraint("user_id IS NOT NULL OR num_nonnulls(space_id, folder_id, list_id) = 1", name="someone_or_somewhere"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"))
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"))
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"))
    hourly_rate: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")


class ClientFee(Base):
    """What a client (a Space, Folder or List) pays: a monthly retainer or a one-off fee for the engagement."""

    __tablename__ = "client_fees"
    __table_args__ = (CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_location"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), unique=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), unique=True)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), unique=True)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    period: Mapped[str] = mapped_column(String(10), nullable=False, default="monthly")  # monthly | one_off
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    client_name: Mapped[Optional[str]] = mapped_column(String(200))
