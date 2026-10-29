"""Drop removed Space features

The All Spaces page (join requests, leaving a Space), personal sidebar sections, ClickApps,
discoverable private Spaces and per-Space default views were taken out of the app (2026-10-29).
Production had no rows in the three tables and nothing set on the columns worth keeping, so they
are dropped. The downgrade puts them back empty, as the Phase D and default-views revisions made them.

Revision ID: c1e5a7d9f3b2
Revises: b7d2f4a8c6e1
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c1e5a7d9f3b2"
down_revision: Union[str, None] = "b7d2f4a8c6e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_space_join_requests_user_id"), table_name="space_join_requests")
    op.drop_index(op.f("ix_space_join_requests_space_id"), table_name="space_join_requests")
    op.drop_table("space_join_requests")
    op.drop_table("hidden_spaces")
    op.drop_index(op.f("ix_sidebar_sections_user_id"), table_name="sidebar_sections")
    op.drop_table("sidebar_sections")
    op.drop_column("spaces", "default_views")
    op.drop_column("spaces", "discoverable")
    op.drop_column("spaces", "clickapps")


def downgrade() -> None:
    op.add_column("spaces", sa.Column(
        "clickapps", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False,
    ))
    op.add_column("spaces", sa.Column("discoverable", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    op.add_column("spaces", sa.Column("default_views", postgresql.JSONB(), nullable=True))
    op.create_table(
        "sidebar_sections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("orderindex", sa.Float(), nullable=False),
        sa.Column("space_ids", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("collapsed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_sidebar_sections_user_id_users"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspaces.id"], name=op.f("fk_sidebar_sections_workspace_id_workspaces"), ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sidebar_sections")),
    )
    op.create_index(op.f("ix_sidebar_sections_user_id"), "sidebar_sections", ["user_id"], unique=False)
    op.create_table(
        "hidden_spaces",
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["space_id"], ["spaces.id"], name=op.f("fk_hidden_spaces_space_id_spaces"), ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_hidden_spaces_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "space_id", name=op.f("pk_hidden_spaces")),
    )
    op.create_table(
        "space_join_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.String(length=128), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("decided_by", sa.String(length=128), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("status IN ('pending', 'approved', 'declined')", name=op.f("ck_space_join_requests_status")),
        sa.ForeignKeyConstraint(
            ["decided_by"], ["users.id"], name=op.f("fk_space_join_requests_decided_by_users"), ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"], ["spaces.id"], name=op.f("fk_space_join_requests_space_id_spaces"), ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_space_join_requests_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_space_join_requests")),
    )
    op.create_index(op.f("ix_space_join_requests_space_id"), "space_join_requests", ["space_id"], unique=False)
    op.create_index(op.f("ix_space_join_requests_user_id"), "space_join_requests", ["user_id"], unique=False)
