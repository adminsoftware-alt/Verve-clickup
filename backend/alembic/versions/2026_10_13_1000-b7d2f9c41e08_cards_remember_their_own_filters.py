"""Cards remember the filters they were built with

"Clear all filters" puts each card back to how it was made rather than to no filters at all,
which would turn every Overdue card into a count of all work. New cards record that as
`config.base_filters` when they are created; this records it for the cards that already exist,
taking what each one filters by today as its starting point.

Revision ID: b7d2f9c41e08
Revises: a4c8e1b52d77
"""

from typing import Sequence, Union

from alembic import op

revision: str = "b7d2f9c41e08"
down_revision: Union[str, None] = "a4c8e1b52d77"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE dashboard_cards "
        "SET config = jsonb_set(config::jsonb, '{base_filters}', COALESCE(config::jsonb -> 'filters', '{}'::jsonb)) "
        "WHERE NOT (config::jsonb ? 'base_filters') OR config::jsonb -> 'base_filters' = 'null'::jsonb"
    )


def downgrade() -> None:
    op.execute("UPDATE dashboard_cards SET config = config::jsonb - 'base_filters'")
