"""what running this costs

A register of what the firm pays to keep this running -- a server, a database, a mailbox, a
domain. Nothing is discovered from a billing API; an admin records the figures and the app does
the arithmetic across day, month, year and per person.

Revision ID: c9e6a4d13f88
Revises: b8d5f3c92e47
Create Date: 2026-10-05 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c9e6a4d13f88'
down_revision: Union[str, Sequence[str], None] = 'b8d5f3c92e47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'cost_items',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('category', sa.String(length=32), server_default=sa.text("'other'"), nullable=False),
        # Minor units as an integer: a monthly figure divided three ways in floating point drifts.
        sa.Column('amount_minor', sa.BigInteger(), nullable=False),
        sa.Column('currency', sa.String(length=3), server_default=sa.text("'INR'"), nullable=False),
        sa.Column('period', sa.String(length=10), server_default=sa.text("'monthly'"), nullable=False),
        sa.Column('scales', sa.String(length=12), server_default=sa.text("'flat'"), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=True),
        sa.Column('active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_cost_items_workspace_id'), 'cost_items', ['workspace_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_cost_items_workspace_id'), table_name='cost_items')
    op.drop_table('cost_items')
