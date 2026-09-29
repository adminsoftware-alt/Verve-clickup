"""Dashboards: grids of configurable cards, plus scheduled email reports.

A Dashboard belongs to the person who created it. It can also belong to a Team, which
makes it that Team's dashboard: the Team's leads manage it. Who else can open it is
decided in services/work/dashboards/access.py.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
    true,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.models._types import enum_type
from app.db.models.enums import PermissionLevel


class Dashboard(TimestampMixin, Base):
    __tablename__ = "dashboards"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # The creator. Kept when they leave so the Dashboard can still be listed and reassigned.
    owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Set for a Team dashboard.
    team_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    # Dashboard-level filters, applied to every card that supports them.
    filters: Mapped[Dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict
    )
    auto_refresh: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    # Set for the Dashboard behind a Space/Folder/List's Dashboard view: it follows that
    # location's permissions and isn't listed in the Dashboards hub.
    view_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("views.id", ondelete="CASCADE"), unique=True)
    # "my_work", "team" or "company" for the ones made for people automatically; None for hand-made ones.
    # Marked so they're only ever made once each, and so the hub can show them first.
    standard: Mapped[Optional[str]] = mapped_column(String(16), index=True)


class DashboardCard(TimestampMixin, Base):
    """One card. `config` holds everything type-specific (sources, filters, measure, ...)."""

    __tablename__ = "dashboard_cards"
    __table_args__ = (
        CheckConstraint("width BETWEEN 1 AND 12", name="width_range"),
        CheckConstraint("height BETWEEN 1 AND 6", name="height_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[str] = mapped_column("card_type", String(24), nullable=False)
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    config: Mapped[Dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict
    )
    # Layout: cards flow left to right in `position` order on a 12-column grid.
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=6)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=2)


class DashboardShare(Base):
    """Access to a Dashboard for one person or one Team."""

    __tablename__ = "dashboard_shares"
    __table_args__ = (CheckConstraint("num_nonnulls(user_id, team_id) = 1", name="one_grantee"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    team_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    level: Mapped[PermissionLevel] = mapped_column(
        enum_type(PermissionLevel, "permission_level"), nullable=False
    )
    granted_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


Index(
    "uq_dashboard_shares_user",
    DashboardShare.__table__.c.dashboard_id,
    DashboardShare.__table__.c.user_id,
    unique=True,
    postgresql_where=DashboardShare.__table__.c.user_id.isnot(None),
)
Index(
    "uq_dashboard_shares_team",
    DashboardShare.__table__.c.dashboard_id,
    DashboardShare.__table__.c.team_id,
    unique=True,
    postgresql_where=DashboardShare.__table__.c.team_id.isnot(None),
)


class ReportSchedule(TimestampMixin, Base):
    """Email a Dashboard to people on a schedule. Data is gathered as `created_by` sees it."""

    __tablename__ = "report_schedules"
    __table_args__ = (
        CheckConstraint("frequency IN ('daily', 'weekdays', 'weekly', 'monthly')", name="frequency_values"),
        CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="weekday_range"),
        CheckConstraint("day_of_month IS NULL OR day_of_month BETWEEN 1 AND 28", name="day_range"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    recipient_ids: Mapped[List[str]] = mapped_column(ARRAY(String(128)), nullable=False, default=list)
    subject: Mapped[Optional[str]] = mapped_column(String(200))
    frequency: Mapped[str] = mapped_column(String(16), nullable=False)
    weekday: Mapped[Optional[int]] = mapped_column(Integer)  # 0 = Monday
    day_of_month: Mapped[Optional[int]] = mapped_column(Integer)
    send_time: Mapped[str] = mapped_column(String(5), nullable=False)  # "HH:MM"
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)
    next_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), index=True)
    last_run_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class ReportRun(Base):
    """One attempt to send a report, kept for the Activity list and for previewing."""

    __tablename__ = "report_runs"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    schedule_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("report_schedules.id", ondelete="CASCADE"), index=True
    )
    dashboard_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    triggered_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # sent / not_sent / failed
    recipients: Mapped[List[str]] = mapped_column(ARRAY(String(320)), nullable=False, default=list)
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    html: Mapped[str] = mapped_column(Text, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DashboardComment(Base):
    """A message on a Dashboard's discussion card."""

    __tablename__ = "dashboard_comments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    card_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("dashboard_cards.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
