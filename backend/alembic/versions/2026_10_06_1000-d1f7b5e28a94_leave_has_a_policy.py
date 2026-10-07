"""Leave has a policy, and a balance can be adjusted

A leave engine without a policy makes every firm's rules the same firm's rules: a January year,
no carry-forward, no notice, and whoever the reporting manager happens to be. An Indian advisory
firm runs April to March, carries a few days over, wants a week's notice outside an emergency,
and needs someone to turn to when the manager is themselves away. All of that is a setting.

The adjustments table is what carry-forward and a mid-year joiner's opening balance are made of:
a balance is otherwise computed from scratch each year and has nowhere to remember them.

Revision ID: d1f7b5e28a94
Revises: c9e6a4d13f88
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d1f7b5e28a94"
down_revision: Union[str, None] = "c9e6a4d13f88"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "leave_policies",
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True),
        # 4 = April, the Indian financial year. 1 would be the calendar year.
        sa.Column("year_start_month", sa.SmallInteger(), nullable=False, server_default="4"),
        # NULL: nothing carries over. 0 is a real answer too, so the two cannot share a value.
        sa.Column("carry_forward_days", sa.Float(), nullable=True),
        sa.Column("prorate_joiners", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("min_notice_days", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("allow_backdated", sa.Boolean(), nullable=False, server_default=sa.true()),
        # The sandwich rule: whether holidays and weekends inside a leave span are counted.
        sa.Column("count_days_off_inside", sa.Boolean(), nullable=False, server_default=sa.false()),
        # NULL: a request waits for its approver however long that takes.
        sa.Column("escalate_after_days", sa.SmallInteger(), nullable=True),
        sa.Column("hr_team_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("teams.id", ondelete="SET NULL"), nullable=True),
        # [{"from": "09-15", "to": "09-30", "reason": "Audit season"}] -- days nobody may book.
        sa.Column("blackout", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("year_start_month BETWEEN 1 AND 12", name="year_start_month_range"),
        sa.CheckConstraint("min_notice_days >= 0", name="min_notice_days_not_negative"),
        sa.CheckConstraint("carry_forward_days IS NULL OR carry_forward_days >= 0", name="carry_forward_not_negative"),
        sa.CheckConstraint("escalate_after_days IS NULL OR escalate_after_days > 0", name="escalate_after_days_positive"),
    )

    op.create_table(
        "leave_adjustments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("leave_types.id", ondelete="CASCADE"), nullable=False),
        # The leave year this belongs to, named by the year it starts in.
        sa.Column("year", sa.SmallInteger(), nullable=False),
        # Positive adds days (carried forward, granted); negative takes them away.
        sa.Column("days", sa.Float(), nullable=False),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("created_by", sa.String(length=128), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("workspace_id", "user_id", "type_id", "year", name="uq_leave_adjustments_person_year"),
    )
    op.create_index("ix_leave_adjustments_lookup", "leave_adjustments", ["workspace_id", "user_id", "year"])

    # An escalation is sent once per request, so the request has to remember that it happened.
    op.add_column("leave_requests", sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True))
    # Who covers the work while they are away. Named on approval, not on the request.
    op.add_column("leave_requests", sa.Column("cover_id", sa.String(length=128), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("leave_requests", "cover_id")
    op.drop_column("leave_requests", "escalated_at")
    op.drop_index("ix_leave_adjustments_lookup", table_name="leave_adjustments")
    op.drop_table("leave_adjustments")
    op.drop_table("leave_policies")
