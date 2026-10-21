"""A Dashboard's scope is not a filter

"My work" was made with the filter `assignees: ["me"]`, and every Team dashboard with
`assignees: ["team:<id>"]`. Both showed in the filter bar as a chip somebody had to notice and
leave alone, and "me" means whoever is looking -- so an admin opening someone's own board saw
their own tasks on it. Whose work a board is about now comes from the board itself
(dashboards/standard.py `scope_of`), and the filter bar starts empty.

This takes the old defaults off the boards that still carry them exactly as they were made. A
filter somebody changed is theirs and is left alone.

Revision ID: f3b9d7a40c66
Revises: e2a8c6f39b55
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3b9d7a40c66"
down_revision: Union[str, None] = "e2a8c6f39b55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, standard, team_id, filters FROM dashboards")).mappings().all()
    for row in rows:
        filters = dict(row["filters"] or {})
        assignees = filters.get("assignees")
        default = None
        if row["standard"] == "my_work":
            default = ["me"]
        elif row["team_id"] is not None:
            default = [f"team:{row['team_id']}"]
        if default is None or assignees != default:
            continue
        filters.pop("assignees")
        conn.execute(
            sa.text("UPDATE dashboards SET filters = CAST(:f AS jsonb) WHERE id = :id"),
            {"f": json.dumps(filters), "id": row["id"]},
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(
        "UPDATE dashboards SET filters = CAST(filters AS jsonb) || '{\"assignees\": [\"me\"]}'::jsonb "
        "WHERE standard = 'my_work' AND NOT (CAST(filters AS jsonb) ? 'assignees')"
    ))
    conn.execute(sa.text(
        "UPDATE dashboards SET filters = CAST(filters AS jsonb) || "
        "jsonb_build_object('assignees', jsonb_build_array('team:' || team_id::text)) "
        "WHERE team_id IS NOT NULL AND NOT (CAST(filters AS jsonb) ? 'assignees')"
    ))
