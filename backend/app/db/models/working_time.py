"""The calendar behind everybody's capacity: which days the company does not work.

Holidays used to sit in the leave module, alongside leave types, requests and billing rates.
They were never leave -- they are an input to how much time a person has in a week, which is what
the capacity cards, the timesheets and the workload view all divide by. When leave and billing
were taken out, this stayed.
"""

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Holiday(Base):
    """A company holiday: nobody is expected to work, so it counts as no capacity."""

    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("workspace_id", "day", name="uq_holidays_day"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
