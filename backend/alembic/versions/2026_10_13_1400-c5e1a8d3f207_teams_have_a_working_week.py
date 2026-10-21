"""Teams have a working week

An admin can give a Team its own hours -- one Team works six days, another five -- between a
person's own hours and the company's. Null means the Team follows the company.

Revision ID: c5e1a8d3f207
Revises: b7d2f9c41e08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "c5e1a8d3f207"
down_revision: Union[str, None] = "b7d2f9c41e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("teams", sa.Column("capacity_seconds", postgresql.ARRAY(sa.Integer()), nullable=True))


def downgrade() -> None:
    op.drop_column("teams", "capacity_seconds")
