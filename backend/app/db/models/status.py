import uuid
from typing import Optional

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models._types import enum_type
from app.db.models.enums import StatusGroup


class Status(Base):
    """A workflow status owned by exactly one Space, Folder or List.

    Folders and Lists inherit their parent's set unless override_statuses is on,
    so most Lists own no rows here at all.
    """

    __tablename__ = "statuses"
    __table_args__ = (
        CheckConstraint("num_nonnulls(space_id, folder_id, list_id) = 1", name="one_scope"),
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
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    group: Mapped[StatusGroup] = mapped_column(
        "status_group", enum_type(StatusGroup, "status_group"), nullable=False
    )
    orderindex: Mapped[int] = mapped_column(Integer, nullable=False)


# Status names are unique (case-insensitively) within the set that owns them.
for _scope in ("space_id", "folder_id", "list_id"):
    _col = Status.__table__.c[_scope]
    Index(
        f"uq_statuses_{_scope}_name",
        _col,
        func.lower(Status.__table__.c.name),
        unique=True,
        postgresql_where=_col.isnot(None),
    )
