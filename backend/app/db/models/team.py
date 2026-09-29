import uuid
from datetime import datetime
from typing import Optional

from typing import Any, Dict, List

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class Team(TimestampMixin, Base):
    """A named group of workspace members (ClickUp "Teams", a.k.a. user groups).

    Anything that can be shared with a person can be shared with a Team.
    """

    __tablename__ = "teams"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(7))
    # Teams Hub: what the team is for, how to @mention it, and where it works.
    description: Mapped[Optional[str]] = mapped_column(Text)
    handle: Mapped[Optional[str]] = mapped_column(String(64))
    icon: Mapped[Optional[str]] = mapped_column(String(32))
    locations: Mapped[List[Dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # A sub-team: its people count as members of the parent Team too (shares, mentions, dashboards).
    parent_team_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)


Index(
    "uq_teams_workspace_name",
    Team.__table__.c.workspace_id,
    func.lower(Team.__table__.c.name),
    unique=True,
)


class TeamMember(Base):
    __tablename__ = "team_members"

    team_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # A Team lead manages the Team's dashboards, and sees the Team's dashboards and
    # tracked time.
    is_lead: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
