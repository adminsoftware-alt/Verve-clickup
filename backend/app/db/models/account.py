import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.models._types import enum_type
from app.db.models.enums import WorkspaceRole


class User(TimestampMixin, Base):
    """A person. Usually keyed by their Firebase uid and created on first sign-in.

    An admin can also add someone before they ever sign in (with their name, designation
    and manager). Such a person gets a "pending-…" id and no `auth_uid`; the first time they
    sign in with that (verified) email, their Firebase uid is linked to this row, so
    everything already assigned or shared with them is theirs from day one.
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    auth_uid: Mapped[Optional[str]] = mapped_column(String(128), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    # The name was set by an admin or in the profile, so signing in doesn't replace it.
    name_from_profile: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)


class Workspace(TimestampMixin, Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"

    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    role: Mapped[WorkspaceRole] = mapped_column(
        enum_type(WorkspaceRole, "workspace_role"), nullable=False
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Profile inside this workspace (ClickUp's People page and Org Chart).
    designation: Mapped[Optional[str]] = mapped_column(String(100))
    department: Mapped[Optional[str]] = mapped_column(String(100))
    manager_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40))
    employee_code: Mapped[Optional[str]] = mapped_column(String(40))
    date_of_joining: Mapped[Optional[date]] = mapped_column(Date)
    location: Mapped[Optional[str]] = mapped_column(String(100))
    added_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    invite_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # My Tasks home: which cards show, in what order and size (null = the standard layout).
    home_layout: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB)
    # Secret address of this person's task calendar (.ics), for Google/Outlook to subscribe to.
    ical_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True)
