"""Spaces have a default permission and default views

ClickUp's Create a Space: what members get in the Space unless something is shared with them
(NULL: full edit, as before), and the views each new Folder and List in it starts with.

Revision ID: d8a4c2e6b913
Revises: c5e1a8d3f207
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d8a4c2e6b913"
down_revision: Union[str, None] = "c5e1a8d3f207"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("spaces", sa.Column(
        "default_permission",
        sa.Enum("view", "comment", "edit", "full", name="space_default_permission", native_enum=False, create_constraint=True, length=16),
        nullable=True,
    ))
    op.add_column("spaces", sa.Column("default_views", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("spaces", "default_views")
    op.drop_column("spaces", "default_permission")
