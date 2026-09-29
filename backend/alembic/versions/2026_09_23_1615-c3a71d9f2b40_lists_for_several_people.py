"""a List can belong to several people

Revision ID: c3a71d9f2b40
Revises: b18e4c7a90d1
Create Date: 2026-09-23 16:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c3a71d9f2b40'
down_revision: Union[str, Sequence[str], None] = 'b18e4c7a90d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'list_assignees',
        sa.Column('list_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.String(length=128), nullable=False),
        sa.Column('assigned_by', sa.String(length=128), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['list_id'], ['lists.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assigned_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('list_id', 'user_id'),
    )
    op.create_index(op.f('ix_list_assignees_user_id'), 'list_assignees', ['user_id'], unique=False)
    # Lists already handed to one person keep that person.
    op.execute(
        "INSERT INTO list_assignees (list_id, user_id) "
        "SELECT id, assignee_id FROM lists WHERE assignee_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_list_assignees_user_id'), table_name='list_assignees')
    op.drop_table('list_assignees')
