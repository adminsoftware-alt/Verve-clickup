"""Templates: a saved snapshot of a task, List or Folder to create new ones from (ClickUp's Template Center)."""

import enum
import uuid
from typing import Any, Dict, Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin
from app.db.models._types import enum_type


class TemplateKind(str, enum.Enum):
    task = "task"
    list = "list"
    folder = "folder"
    space = "space"


class Template(TimestampMixin, Base):
    """`data` is a self-contained snapshot, so a template keeps working when its source
    changes or is deleted. Private templates are visible only to their creator."""

    __tablename__ = "templates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[TemplateKind] = mapped_column("template_kind", enum_type(TemplateKind, "template_kind"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    data: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False)
    is_private: Mapped[bool] = mapped_column(Boolean, server_default=false(), nullable=False)
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
