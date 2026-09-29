"""a task type can describe itself

A type called "Adhoc Task" means something to whoever named it and nothing to the person meeting
it three months later. One line of explanation, shown where the type is chosen.

Revision ID: e5c2a4b91f77
Revises: d4f8c1b27e30
Create Date: 2026-09-28 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'e5c2a4b91f77'
down_revision: Union[str, Sequence[str], None] = 'd4f8c1b27e30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('task_types', sa.Column('description', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('task_types', 'description')
