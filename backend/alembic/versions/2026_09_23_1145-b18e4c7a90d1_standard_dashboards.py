"""standard dashboards (my work / team / company)

Revision ID: b18e4c7a90d1
Revises: 797cc2af52da
Create Date: 2026-09-23 11:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b18e4c7a90d1'
down_revision: Union[str, Sequence[str], None] = '797cc2af52da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('dashboards', sa.Column('standard', sa.String(length=16), nullable=True))
    op.create_index(op.f('ix_dashboards_standard'), 'dashboards', ['standard'], unique=False)
    # One "My work" per person, one per Team, one "Company" per workspace.
    op.create_index(
        'uq_dashboards_standard_owner', 'dashboards', ['workspace_id', 'standard', 'owner_id'],
        unique=True, postgresql_where=sa.text("standard = 'my_work'"),
    )
    op.create_index(
        'uq_dashboards_standard_team', 'dashboards', ['workspace_id', 'standard', 'team_id'],
        unique=True, postgresql_where=sa.text("standard = 'team'"),
    )
    op.create_index(
        'uq_dashboards_standard_company', 'dashboards', ['workspace_id', 'standard'],
        unique=True, postgresql_where=sa.text("standard = 'company'"),
    )


def downgrade() -> None:
    op.drop_index('uq_dashboards_standard_company', table_name='dashboards')
    op.drop_index('uq_dashboards_standard_team', table_name='dashboards')
    op.drop_index('uq_dashboards_standard_owner', table_name='dashboards')
    op.drop_index(op.f('ix_dashboards_standard'), table_name='dashboards')
    op.drop_column('dashboards', 'standard')
