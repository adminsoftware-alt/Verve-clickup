"""What an import has already brought over, so running it twice does not duplicate anything.

This lived in the leave module for no better reason than that it was written the same week. It
belongs to the v1 Firestore importer in app/services/work/v1_import.py, which is its only user.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImportedRecord(Base):
    """One record already carried over, keyed by its id in the old system."""

    __tablename__ = "imported_records"
    __table_args__ = (UniqueConstraint("workspace_id", "source", "source_id", name="uq_imported_records_source"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)  # e.g. "v1.task", "v1.time_entry"
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    target_id: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
