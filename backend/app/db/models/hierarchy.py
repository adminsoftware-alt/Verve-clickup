import uuid
from datetime import datetime
from typing import List, Optional

from typing import Any, Dict

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, false, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, declared_attr, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class LocationMixin(TimestampMixin):
    """Columns shared by every level of the hierarchy."""

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    color: Mapped[Optional[str]] = mapped_column(String(7))
    is_private: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    @declared_attr
    def created_by(cls) -> Mapped[Optional[str]]:
        return mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    @declared_attr
    def team(cls) -> Mapped[Optional["Team"]]:
        return relationship("Team", lazy="selectin", foreign_keys=f"{cls.__name__}.team_id")

    @declared_attr
    def team_id(cls) -> Mapped[Optional[uuid.UUID]]:
        """The Team this belongs to. Set, and only that Team (plus owners, admins, and anyone it
        was shared with) sees it -- "this Space is the Dev team's"."""
        return mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), index=True)


class Space(LocationMixin, Base):
    """A department, team or client. Owns the default status set and the tag vocabulary."""

    __tablename__ = "spaces"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)
    icon: Mapped[Optional[str]] = mapped_column(String(64))
    # Custom task IDs ("HR-12"): the prefix, and the last number handed out in this Space.
    task_prefix: Mapped[Optional[str]] = mapped_column(String(10))
    task_seq: Mapped[int] = mapped_column(Integer, server_default=text("0"), nullable=False, default=0)
    # Set on the hidden, private Space that holds one person's Personal List.
    # It never appears in the sidebar tree; its List is shown under Home instead.
    personal_owner_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    # ClickApps: which optional features this Space uses, {name: on}. A missing name means its default.
    clickapps: Mapped[Dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict)
    # A private Space that still shows on the All Spaces page, so people can ask to join it.
    discoverable: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False, default=False)

    __table_args__ = (
        Index(
            "uq_spaces_personal_per_user",
            "workspace_id",
            "personal_owner_id",
            unique=True,
            postgresql_where=text("personal_owner_id IS NOT NULL"),
        ),
    )


class Folder(LocationMixin, Base):
    """Optional grouping inside a Space. A subfolder is a Folder with a parent_folder_id.

    Nesting is limited to one level; that is enforced in the service layer.
    """

    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True
    )
    override_statuses: Mapped[bool] = mapped_column(
        Boolean, server_default=false(), nullable=False
    )
    # Set on a Sprint Folder: {"weeks": 2, "start_weekday": 0, "rollover": true}. Its Lists are the sprints.
    sprint_settings: Mapped[Optional[Dict[str, Any]]] = mapped_column(JSONB)


class TaskList(LocationMixin, Base):
    """Holds tasks. Lives in a Folder, or directly in a Space (a "folderless" list)."""

    __tablename__ = "lists"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[Optional[str]] = mapped_column(Text)
    # List info, as in ClickUp: when the List's work starts and is due.
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    override_statuses: Mapped[bool] = mapped_column(
        Boolean, server_default=false(), nullable=False
    )
    # The first person this List was handed to. Kept for anything that reads a single owner;
    # who it belongs to now is the full set in `assignee_rows`.
    assignee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    # Email-to-List: mail sent to <inbox>+<token>@<domain> becomes a task here.
    email_token: Mapped[Optional[str]] = mapped_column(String(32), unique=True)
    # A sprint List that has been completed (its unfinished work rolled over).
    sprint_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    assignee_rows: Mapped[List["ListAssignee"]] = relationship(
        back_populates="list", cascade="all, delete-orphan", lazy="selectin", order_by="ListAssignee.created_at",
    )

    @property
    def assignee_ids(self) -> List[str]:
        """Everyone this List was handed to, in the order they were added."""
        return [row.user_id for row in self.assignee_rows]


class ListAssignee(TimestampMixin, Base):
    """One of the people a List belongs to. A List can be shared work for several people."""

    __tablename__ = "list_assignees"

    list_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    assigned_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    list: Mapped["TaskList"] = relationship(back_populates="assignee_rows", foreign_keys=[list_id])
    user: Mapped["User"] = relationship(foreign_keys=[user_id], lazy="selectin")
