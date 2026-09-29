"""Custom fields: extra, typed columns on tasks (ClickUp's Custom Fields)."""

import enum
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.models._types import enum_type


class FieldType(str, enum.Enum):
    text = "text"  # one line
    long_text = "long_text"
    number = "number"
    money = "money"
    dropdown = "dropdown"  # one option
    labels = "labels"  # several options
    date = "date"
    checkbox = "checkbox"
    email = "email"
    phone = "phone"
    url = "url"
    rating = "rating"
    progress = "progress"  # 0-100, set by hand
    people = "people"
    location = "location"  # {address, lat, lng}; shown on the Map view


class CustomField(TimestampMixin, Base):
    """A field defined on a Space, Folder or List, usable by every task at or below it.

    `config` depends on the type: options [{id, name, color}] for dropdown/labels,
    currency for money, precision for number, max for rating.
    """

    __tablename__ = "custom_fields"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_parent"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[FieldType] = mapped_column("field_type", enum_type(FieldType, "field_type"), nullable=False)
    config: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class TaskFieldValue(Base):
    """One task's value for one custom field. No row means empty."""

    __tablename__ = "task_field_values"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    field_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("custom_fields.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    value: Mapped[Any] = mapped_column(JSONB, nullable=False)
    updated_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
