"""Leave, holidays and billing: the parts of people's time that aren't task work, and what time is worth."""

import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, Float, ForeignKey, Index, Numeric, String, Text, UniqueConstraint, false, func, true,
)
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
