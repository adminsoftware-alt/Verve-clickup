"""a Space, Folder or List can belong to a Team

Revision ID: d4f8c1b27e30
Revises: c3a71d9f2b40
Create Date: 2026-09-23 20:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd4f8c1b27e30'
down_revision: Union[str, Sequence[str], None] = 'c3a71d9f2b40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('spaces', 'folders', 'lists')


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column('team_id', sa.Uuid(), nullable=True))
        op.create_index(op.f(f'ix_{table}_team_id'), table, ['team_id'], unique=False)
        op.create_foreign_key(f'fk_{table}_team_id_teams', table, 'teams', ['team_id'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    for table in TABLES:
        op.drop_constraint(f'fk_{table}_team_id_teams', table, type_='foreignkey')
        op.drop_index(op.f(f'ix_{table}_team_id'), table_name=table)
        op.drop_column(table, 'team_id')
