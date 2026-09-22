"""gantt timeline activity form views

Revision ID: eab7660183f4
Revises: 4872f3ee1685
Create Date: 2026-09-22 13:27:15.305475

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eab7660183f4'
down_revision: Union[str, Sequence[str], None] = '4872f3ee1685'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


VIEW_TYPES_OLD = "('list', 'board', 'calendar', 'dashboard', 'workload', 'overview', 'table', 'team')"
VIEW_TYPES_NEW = "('list', 'board', 'calendar', 'dashboard', 'workload', 'overview', 'table', 'team', 'gantt', 'timeline', 'activity', 'form')"


def upgrade() -> None:
    """Upgrade schema: allow the Gantt, Timeline, Activity and Form view types."""
    op.drop_constraint(op.f('ck_views_view_type'), 'views', type_='check')
    op.create_check_constraint(op.f('ck_views_view_type'), 'views', f"view_type IN {VIEW_TYPES_NEW}")


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM views WHERE view_type IN ('gantt', 'timeline', 'activity', 'form')")
    op.drop_constraint(op.f('ck_views_view_type'), 'views', type_='check')
    op.create_check_constraint(op.f('ck_views_view_type'), 'views', f"view_type IN {VIEW_TYPES_OLD}")
