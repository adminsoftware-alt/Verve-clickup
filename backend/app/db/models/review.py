import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin


class MonthlyReview(TimestampMixin, Base):
    """Someone's monthly review, marked done once they have filled it in on the firm's PMS.

    One row per person per month, made when it is marked done and deleted when that is undone, so
    "no row" simply means "not done yet". Who marked it is kept: usually the person, sometimes an
    admin on their behalf.
    """

    __tablename__ = "monthly_reviews"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id", "period", name="uq_monthly_review_person_month"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # The first day of the month the review is for.
    period: Mapped[date] = mapped_column(Date, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    marked_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
