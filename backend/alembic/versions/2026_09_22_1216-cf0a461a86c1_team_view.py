"""team view

Revision ID: cf0a461a86c1
Revises: da1aeea81e02
Create Date: 2026-09-22 12:16:21.881906

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'cf0a461a86c1'
down_revision: Union[str, Sequence[str], None] = 'da1aeea81e02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


VIEW_TYPES_OLD = "('list', 'board', 'calendar', 'dashboard', 'workload', 'overview', 'table')"
VIEW_TYPES_NEW = "('list', 'board', 'calendar', 'dashboard', 'workload', 'overview', 'table', 'team')"


def upgrade() -> None:
    """Upgrade schema: allow the 'team' view type."""
    op.drop_constraint(op.f('ck_views_view_type'), 'views', type_='check')
    op.create_check_constraint(op.f('ck_views_view_type'), 'views', f"view_type IN {VIEW_TYPES_NEW}")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM views WHERE view_type = 'team'")
    op.drop_constraint(op.f('ck_views_view_type'), 'views', type_='check')
    op.create_check_constraint(op.f('ck_views_view_type'), 'views', f"view_type IN {VIEW_TYPES_OLD}")
