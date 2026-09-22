"""Timesheet locks: time in a submitted (pending) or approved week cannot change.

Owners and admins can still change it, as in ClickUp. "Changes needed" and withdrawn
timesheets are open again.
"""

import uuid
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import TimesheetSubmission, WorkspaceRole
from app.services.work.errors import Forbidden

LOCKED = ("pending", "approved")


def locking_submission(
    db: Session, workspace_id: uuid.UUID, user_id: str, moment: datetime
) -> Optional[TimesheetSubmission]:
    """The pending or approved submission covering `moment` for this person, if any."""
    around = moment.date()
    candidates = db.scalars(
        select(TimesheetSubmission).where(
            TimesheetSubmission.workspace_id == workspace_id,
            TimesheetSubmission.user_id == user_id,
            TimesheetSubmission.status.in_(LOCKED),
            TimesheetSubmission.period_start <= around + timedelta(days=1),
            TimesheetSubmission.period_end >= around - timedelta(days=1),
        )
    )
    for sub in candidates:
        local: date = moment.astimezone(ZoneInfo(sub.timezone)).date()
        if sub.period_start <= local <= sub.period_end:
            return sub
    return None


def ensure_unlocked(
    db: Session, workspace_id: uuid.UUID, user_id: str, moment: datetime, actor_role: WorkspaceRole
) -> None:
    if actor_role in (WorkspaceRole.owner, WorkspaceRole.admin):
        return
    sub = locking_submission(db, workspace_id, user_id, moment)
    if sub is not None:
        state = "submitted for approval" if sub.status == "pending" else "approved"
        raise Forbidden(f"This time is in a timesheet that has been {state}, so it can't be changed")
