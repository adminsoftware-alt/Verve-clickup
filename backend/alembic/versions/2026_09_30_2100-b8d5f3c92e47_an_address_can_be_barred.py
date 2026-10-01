"""an address can be barred

Turning someone's access off stops them today; removing them takes away the row that said so.
Neither stopped them being added back -- by the next admin who did not know, or by an import of
an old spreadsheet. A barred address is refused wherever a person can be added.

Revision ID: b8d5f3c92e47
Revises: a7c4e2b83d15
Create Date: 2026-09-30 21:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b8d5f3c92e47'
down_revision: Union[str, Sequence[str], None] = 'a7c4e2b83d15'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'blocked_emails',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('workspace_id', sa.Uuid(), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('reason', sa.String(length=300), nullable=True),
        sa.Column('blocked_by', sa.String(), nullable=True),
        sa.Column('blocked_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['blocked_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'email', name='uq_blocked_email'),
    )
    op.create_index(op.f('ix_blocked_emails_workspace_id'), 'blocked_emails', ['workspace_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_blocked_emails_workspace_id'), table_name='blocked_emails')
    op.drop_table('blocked_emails')
