"""How much time each person actually has: their working hours, less the days the company is shut.

This is what Workload, the timesheets and the capacity cards on every Dashboard divide by, so it
is load-bearing in eleven places. It used to live in the leave module because approved leave was
a third subtraction; with leave gone the sum is simpler, and holidays -- which were never leave --
kept the maths that depends on them.
"""

import uuid
from datetime import date
from typing import Dict, Iterable, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Holiday
from app.schemas import working_time as wt
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace


def _require_admin(access: Access, what: str) -> None:
    if not can_manage_workspace(access):
        raise Forbidden(f"Only an admin can {what}")


# --- the holiday calendar ------------------------------------------------------------------------------


def holidays(db: Session, access: Access, year: Optional[int] = None) -> List[Holiday]:
    query = select(Holiday).where(Holiday.workspace_id == access.workspace_id)
    if year:
        query = query.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    return list(db.scalars(query.order_by(Holiday.day)))


def add_holiday(db: Session, access: Access, data: wt.HolidayIn) -> Holiday:
    _require_admin(access, "change holidays")
    if db.scalars(select(Holiday).where(Holiday.workspace_id == access.workspace_id, Holiday.day == data.day)).first():
        raise Invalid(f"{data.day.isoformat()} is already a holiday")
    row = Holiday(workspace_id=access.workspace_id, day=data.day, name=data.name)
    db.add(row)
    db.flush()
    return row


def remove_holiday(db: Session, access: Access, holiday_id: uuid.UUID) -> None:
    _require_admin(access, "change holidays")
    row = db.get(Holiday, holiday_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Holiday not found")
    db.delete(row)
    db.flush()


# --- capacity -------------------------------------------------------------------------------------------


def _weekly(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str]) -> Dict[str, List[int]]:
    from app.services.work.timesheets import capacity_of

    return {uid: capacity_of(db, workspace_id, uid)[0] for uid in user_ids}


def holiday_days(db: Session, workspace_id: uuid.UUID, first: date, last: date) -> Dict[date, str]:
    """Every shut day in the span, by date, so a caller can say why a day is empty."""
    return {
        h.day: h.name
        for h in db.scalars(select(Holiday).where(
            Holiday.workspace_id == workspace_id, Holiday.day >= first, Holiday.day <= last))
    }


def daily_capacity(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str],
                   days: Sequence[date]) -> Dict[str, List[int]]:
    """Seconds each person is available per day: their working hours, minus company holidays."""
    ids = list(dict.fromkeys(user_ids))
    if not ids or not days:
        return {uid: [0] * len(days) for uid in ids}
    weekly = _weekly(db, workspace_id, ids)
    off = holiday_days(db, workspace_id, min(days), max(days))
    return {
        uid: [0 if d in off else weekly[uid][d.weekday()] for d in days]
        for uid in ids
    }
