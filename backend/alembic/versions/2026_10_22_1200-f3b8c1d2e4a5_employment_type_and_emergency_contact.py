"""Employment type and emergency contact on each person

Added for the onboarding workbook (2026-10-22): the firm separates articles and interns from
full-time staff, and HR keeps someone to call. Levels widen from 1-3 to L1-L6 in the API only;
the column was already a plain small integer.

Revision ID: f3b8c1d2e4a5
Revises: e2f7a9b4c180
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f3b8c1d2e4a5"
down_revision: Union[str, None] = "e2f7a9b4c180"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workspace_members", sa.Column("employment_type", sa.String(20), nullable=True))
    op.add_column("workspace_members", sa.Column("emergency_contact_name", sa.String(100), nullable=True))
    op.add_column("workspace_members", sa.Column("emergency_contact_phone", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "emergency_contact_phone")
    op.drop_column("workspace_members", "emergency_contact_name")
    op.drop_column("workspace_members", "employment_type")
