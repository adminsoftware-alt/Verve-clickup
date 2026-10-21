"""A List shows only its List view

Decided by the firm on 2026-10-16: every List looks the same -- the List view and nothing beside
it. Boards, tables, calendars, mind maps and dashboards added to Lists are removed (a Dashboard
view's dashboard goes with it, by the existing cascade). Spaces and Folders keep their views, and
the induction questionnaire (a Form on the Induction List) stays.
Not reversible: the removed views are gone.

Revision ID: e2f7a9b4c180
Revises: d8a4c2e6b913
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e2f7a9b4c180"
down_revision: Union[str, None] = "d8a4c2e6b913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Not the induction questionnaire: a Form the app keeps on the Induction List, opened from the
    # link in each joiner's induction task.
    op.execute("DELETE FROM views WHERE list_id IS NOT NULL AND NOT (view_type = 'list' AND is_required) AND view_type <> 'form'")


def downgrade() -> None:
    pass  # the views removed are not coming back
