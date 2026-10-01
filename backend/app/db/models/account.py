import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, SmallInteger, String, UniqueConstraint, false, func, text, true
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
    # Profile photo, stored under UPLOAD_DIR/avatars/<key>; the key is random so its URL can be public.
    avatar_key: Mapped[Optional[str]] = mapped_column(String(64))
    # How they last signed in, for workspace sign-in rules (e.g. "google.com", two-step on).
    last_sign_in_provider: Mapped[Optional[str]] = mapped_column(String(40))
    last_second_factor: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)


class Workspace(TimestampMixin, Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Sign-in rules. Empty domains = anyone the admins add.
    allowed_email_domains: Mapped[List[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"), nullable=False, default=list)
    allow_outside_guests: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    require_google_sign_in: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    require_two_step: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    # The joiner checklist (Verve's SOP by default when null); see services/work/onboarding.py.
    joiner_plan: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)


class BlockedEmail(Base):
    """An address an admin has barred from this workspace.

    Turning someone's access off stops them today; removing them takes the row that said so
    away. Neither stops them being added again -- by the next admin who does not know, or by an
    import of last quarter's spreadsheet. This does: the address is refused wherever a person
    can be added, and the refusal says who barred it and when.

    The email is the key rather than the user, because the user row may be gone, and because
    someone who signs up fresh with the same address is the same person.
    """

    __tablename__ = "blocked_emails"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(String(300))
    blocked_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    blocked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (UniqueConstraint("workspace_id", "email", name="uq_blocked_email"),)


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
    # The rung, 1 upwards, apart from the job title. "Executive" and "Senior Executive" are two
    # designations at two levels; two people can share a level and carry different titles.
    level: Mapped[Optional[int]] = mapped_column(SmallInteger)
    department: Mapped[Optional[str]] = mapped_column(String(100))
    manager_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40))
    employee_code: Mapped[Optional[str]] = mapped_column(String(40))
    date_of_joining: Mapped[Optional[date]] = mapped_column(Date)
    location: Mapped[Optional[str]] = mapped_column(String(100))
    added_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    invite_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Dates the joiner checklist uses for HR reminders.
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    marriage_anniversary: Mapped[Optional[date]] = mapped_column(Date)
    takes_interviews: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    # Offboarded: kept for history, but can no longer open the workspace.
    deactivated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    deactivated_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # How they hear about things outside the app.
    email_notifications: Mapped[str] = mapped_column(String(10), server_default=text("'daily'"), nullable=False, default="daily")  # off | instant | daily
    digest_hour: Mapped[int] = mapped_column(server_default=text("8"), nullable=False, default=8)
    timezone: Mapped[str] = mapped_column(String(64), server_default=text("'Asia/Kolkata'"), nullable=False, default="Asia/Kolkata")
    last_digest_on: Mapped[Optional[date]] = mapped_column(Date)
    weekly_team_digest: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False, default=True)
    last_team_digest_on: Mapped[Optional[date]] = mapped_column(Date)
    whatsapp_opt_in: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)
    # My Tasks home: which cards show, in what order and size (null = the standard layout).
    home_layout: Mapped[Optional[List[Dict[str, Any]]]] = mapped_column(JSONB)
    # Secret address of this person's task calendar (.ics), for Google/Outlook to subscribe to.
    ical_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True)
