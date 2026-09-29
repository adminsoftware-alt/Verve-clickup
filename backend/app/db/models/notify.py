"""Keeping people informed outside the app (email, push, WhatsApp) and the statutory compliance calendar."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, false, func, text, true
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class AutomationRun(Base):
    """A scheduled rule (due soon, overdue) that already fired for a task, so it fires once per due date."""

    __tablename__ = "automation_runs"
    __table_args__ = (UniqueConstraint("rule_id", "task_id", "key", name="uq_automation_runs_once"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g. the due date it fired for
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class PushSubscription(Base):
    """A browser or installed app that wants push notifications for a person (Web Push)."""

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    device: Mapped[Optional[str]] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ComplianceObligation(Base):
    """A statutory filing or payment that repeats, e.g. GSTR-3B on the 20th of each month."""

    __tablename__ = "compliance_obligations"
    __table_args__ = (
        CheckConstraint("frequency IN ('monthly', 'quarterly', 'half_yearly', 'yearly')", name="frequency_kind"),
        CheckConstraint("due_day BETWEEN 1 AND 31", name="day_range"),
        UniqueConstraint("workspace_id", "code", name="uq_compliance_obligations_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. "gstr3b"
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    authority: Mapped[Optional[str]] = mapped_column(String(60))  # GST, Income Tax, MCA, EPFO…
    frequency: Mapped[str] = mapped_column(String(12), nullable=False)
    due_day: Mapped[int] = mapped_column(Integer, nullable=False)
    # For monthly: the due date is in the month after the period. For the others: the months the due dates fall in.
    due_months: Mapped[List[int]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False, default=list)
    lead_days: Mapped[int] = mapped_column(Integer, nullable=False, default=5)  # the task starts this many days before
    notes: Mapped[Optional[str]] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)


class ClientCompliance(Base):
    """An obligation that applies to a client: its tasks are created in the client's List, for the people named."""

    __tablename__ = "client_compliance"
    __table_args__ = (UniqueConstraint("obligation_id", "list_id", name="uq_client_compliance_once"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    obligation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("compliance_obligations.id", ondelete="CASCADE"), nullable=False)
    list_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True)
    client_name: Mapped[str] = mapped_column(String(200), nullable=False)
    assignee_ids: Mapped[List[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ComplianceTask(Base):
    """The task made for one period of a client's obligation (e.g. GSTR-3B for September 2026)."""

    __tablename__ = "compliance_tasks"
    __table_args__ = (UniqueConstraint("client_compliance_id", "period_key", name="uq_compliance_tasks_period"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    client_compliance_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("client_compliance.id", ondelete="CASCADE"), nullable=False)
    period_key: Mapped[str] = mapped_column(String(20), nullable=False)  # e.g. "2026-09" or "2026-Q2"
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
