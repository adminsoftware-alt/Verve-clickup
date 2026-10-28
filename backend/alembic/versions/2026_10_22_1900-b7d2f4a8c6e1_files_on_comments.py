"""Files sent with a comment

A comment can carry pictures and documents (2026-10-22). They are ordinary task attachments
that also point at their comment, and are deleted with it.

Revision ID: b7d2f4a8c6e1
Revises: a4c9e1f7b2d3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b7d2f4a8c6e1"
down_revision: Union[str, None] = "a4c9e1f7b2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("attachments", sa.Column("comment_id", sa.Uuid(), sa.ForeignKey("task_comments.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_attachments_comment_id", "attachments", ["comment_id"])


def downgrade() -> None:
    op.drop_index("ix_attachments_comment_id", table_name="attachments")
    op.drop_column("attachments", "comment_id")
