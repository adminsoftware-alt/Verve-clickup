"""People have an address

Shown on their own profile next to the phone number, which it is treated like: the person keeps
it up to date, admins can too, and guests never see it.

Revision ID: a4c8e1b52d77
Revises: f3b9d7a40c66
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4c8e1b52d77"
down_revision: Union[str, None] = "f3b9d7a40c66"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("workspace_members", sa.Column("address", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("workspace_members", "address")
