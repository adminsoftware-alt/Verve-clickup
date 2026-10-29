"""Monthly reviews

Each person marks their monthly review done once it is filled in on the firm's PMS (2026-10-29), so
their Manager and the admins can see who has finished. One row per person per month.

Revision ID: d4f8b2c6a1e9
Revises: c1e5a7d9f3b2
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f8b2c6a1e9"
down_revision: Union[str, None] = "c1e5a7d9f3b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "monthly_reviews",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("marked_by", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], name=op.f("fk_monthly_reviews_workspace_id_workspaces"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_monthly_reviews_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["marked_by"], ["users.id"], name=op.f("fk_monthly_reviews_marked_by_users"), ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_monthly_reviews")),
        sa.UniqueConstraint("workspace_id", "user_id", "period", name="uq_monthly_review_person_month"),
    )
    op.create_index(op.f("ix_monthly_reviews_workspace_id"), "monthly_reviews", ["workspace_id"], unique=False)
    op.create_index(op.f("ix_monthly_reviews_user_id"), "monthly_reviews", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_monthly_reviews_user_id"), table_name="monthly_reviews")
    op.drop_index(op.f("ix_monthly_reviews_workspace_id"), table_name="monthly_reviews")
    op.drop_table("monthly_reviews")
