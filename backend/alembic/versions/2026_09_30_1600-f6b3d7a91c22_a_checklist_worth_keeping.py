"""a checklist worth keeping

The same checklist gets typed out again on every task of a kind -- the month-end close, the
joiner pack, the filing steps. Saving one keeps the wording, and the order, the same each time.

Revision ID: f6b3d7a91c22
Revises: e5c2a4b91f77
Create Date: 2026-09-30 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'f6b3d7a91c22'
down_revision: Union[str, Sequence[str], None] = 'e5c2a4b91f77'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'checklist_templates',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'name', name='uq_checklist_template_name'),
    )
    op.create_index(op.f('ix_checklist_templates_workspace_id'), 'checklist_templates', ['workspace_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_checklist_templates_workspace_id'), table_name='checklist_templates')
    op.drop_table('checklist_templates')
