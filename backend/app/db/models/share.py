import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.models._types import enum_type
from app.db.models.enums import PermissionLevel


class Share(Base):
    """An explicit permission for one person or one Team on a Space, Folder, List or Task.

    Shares are how people reach private items, and how access is narrowed on public ones.
    """

    __tablename__ = "shares"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(space_id, folder_id, list_id, task_id) = 1", name="one_target"
        ),
        CheckConstraint("num_nonnulls(user_id, team_id) = 1", name="one_grantee"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    team_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("teams.id", ondelete="CASCADE"), index=True
    )
    level: Mapped[PermissionLevel] = mapped_column(
        enum_type(PermissionLevel, "permission_level"), nullable=False
    )
    space_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("folders.id", ondelete="CASCADE"), index=True
    )
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("lists.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), index=True
    )
    granted_by: Mapped[Optional[str]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


# One share per person, and per Team, per item.
for _target in ("space_id", "folder_id", "list_id", "task_id"):
    _col = Share.__table__.c[_target]
    Index(
        f"uq_shares_user_{_target}",
        Share.__table__.c.user_id,
        _col,
        unique=True,
        postgresql_where=_col.isnot(None),
    )
    Index(
        f"uq_shares_team_{_target}",
        Share.__table__.c.team_id,
        _col,
        unique=True,
        postgresql_where=_col.isnot(None) & Share.__table__.c.team_id.isnot(None),
    )
