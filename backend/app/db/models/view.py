import uuid
from typing import Any, Dict, Optional

from sqlalchemy import Boolean, CheckConstraint, Float, ForeignKey, String, false, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.models._types import enum_type
from app.db.models.enums import ViewType


class View(TimestampMixin, Base):
    """A saved way of looking at a location's tasks, shown as a tab in the views bar.

    Every Space, Folder and List has one required List view that cannot be deleted.
    `settings` holds view configuration (filters, grouping, sort, columns) as it grows.
    """

    __tablename__ = "views"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_parent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True
    )
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[ViewType] = mapped_column("view_type", enum_type(ViewType, "view_type"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    settings: Mapped[Dict[str, Any]] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False, default=dict
    )
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # ClickUp view options: only its creator sees a private view; a protected view's
    # settings can't be changed (only saved by its creator or an admin); the default view opens first.
    private_to: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    protected: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
