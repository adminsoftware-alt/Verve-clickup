"""When each person last looked at a task's comments

Drives the "New" divider in a task's feed (2026-10-22): comments by others after this moment
are the ones you have not seen yet.

Revision ID: a4c9e1f7b2d3
Revises: f3b8c1d2e4a5
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4c9e1f7b2d3"
down_revision: Union[str, None] = "f3b8c1d2e4a5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "task_reads",
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.String(128), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("task_reads")
