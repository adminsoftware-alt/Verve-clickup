import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, false, text
from sqlalchemy.orm import Mapped, declared_attr, mapped_column

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
    # The person this List was handed to: it is theirs to fill with tasks and work through.
    assignee_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
