"""a person has a level

"Executive" and "Senior Executive" are two job titles at two rungs, and the title alone does not
say which is which -- every firm words them differently. A number does, and it is what the org
chart and any pay or review banding actually read.

Revision ID: a7c4e2b83d15
Revises: f6b3d7a91c22
Create Date: 2026-09-30 19:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a7c4e2b83d15'
down_revision: Union[str, Sequence[str], None] = 'f6b3d7a91c22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('workspace_members', sa.Column('level', sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column('workspace_members', 'level')
