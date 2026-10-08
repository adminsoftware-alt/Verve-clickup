"""A record of what was emailed, and to whom

Every scheduled email so far has remembered itself with a column of its own on the membership --
`last_digest_on`, `last_team_digest_on` -- which works until there are five cadences and five
columns, none of which can answer "did Priya actually get hers on Tuesday?".

One row per message instead: who, what kind, which period it covered, whether it went. Adding a
weekly or a monthly digest then costs a constant, not a migration, and support can answer the
question by reading a table. The old columns stay where they are: they still drive the jobs that
were written against them, and nothing is gained by rewriting those in the same change.

Revision ID: e2a8c6f39b55
Revises: d1f7b5e28a94
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e2a8c6f39b55"
down_revision: Union[str, None] = "d1f7b5e28a94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "email_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # "daily", "weekly", "monthly", "overdue", "invite_reminder", ...
        sa.Column("kind", sa.String(length=32), nullable=False),
        # The window it covered, as a key that cannot repeat: "2026-10-07", "2026-W41", "2026-10".
        # Unique with the rest, so a job that runs twice in an hour sends once.
        sa.Column("period", sa.String(length=16), nullable=False),
        sa.Column("to_email", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=300), nullable=False),
        # How many things the message was about. Zero means it was worth skipping, and the row is
        # kept anyway so the job does not reconsider the same empty day every hour.
        sa.Column("items", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sent", sa.Boolean(), nullable=False, server_default=sa.false()),
        # Why it did not go, where it did not: no SMTP, a refused address, a timeout.
        sa.Column("problem", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("workspace_id", "user_id", "kind", "period", name="uq_email_log_once"),
    )
    op.create_index("ix_email_log_recent", "email_log", ["workspace_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_email_log_recent", table_name="email_log")
    op.drop_table("email_log")
