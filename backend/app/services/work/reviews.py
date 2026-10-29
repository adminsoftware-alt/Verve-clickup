"""Monthly reviews: everyone fills in their review on the firm's PMS and marks it done here.

The review for a month opens on its 25th and is due on the 5th of the next. It can be marked done
for this month or the one before -- a review opened on 25 October can still be marked on 3 November
-- and never for a month that has not opened yet. A person marks their own; an admin can mark or
undo anyone's (someone who did theirs on paper). Who has finished is seen by the person's Managers
(the Teams they lead) and by admins, as everywhere else in Verveflow.
"""

from datetime import date, datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select

from app.db.models import MonthlyReview, WorkspaceMember, WorkspaceRole
from app.services.work.access import Access
from app.services.work.dashboards.access import Standing
from app.services.work.errors import Forbidden, Invalid

OPENS_ON = 25


def month_of(text: str) -> date:
    """"2026-10" -> 1 October 2026."""
    try:
        year, month = (int(x) for x in text.split("-")[:2])
        return date(year, month, 1)
    except (ValueError, TypeError):
        raise Invalid("Give the month as YYYY-MM")


def open_months(today: date) -> List[date]:
    """The months whose review may be marked today: last month, and this one from its 25th."""
    this = today.replace(day=1)
    last = date(this.year - (this.month == 1), 12 if this.month == 1 else this.month - 1, 1)
    return [last, this] if today.day >= OPENS_ON else [last]


def _who_may_see(db, access: Access) -> Optional[set]:
    """None for admins (everyone); a Manager's led people; nobody else's for an Employee."""
    standing = Standing.load(db, access)
    if standing.is_admin:
        return None
    return set(standing.led_people) - {access.user_id}


def mark(db, access: Access, user_id: str, period: date, done: bool, today: Optional[date] = None) -> Optional[MonthlyReview]:
    if user_id != access.user_id and not Standing.load(db, access).is_admin:
        raise Forbidden("Only the person or an admin can mark a monthly review")
    if period not in open_months(today or date.today()):
        raise Invalid("That month's review is not open")
    if db.get(WorkspaceMember, (access.workspace_id, user_id)) is None:
        raise Invalid("They are not in this workspace")
    row = db.scalars(select(MonthlyReview).where(
        MonthlyReview.workspace_id == access.workspace_id, MonthlyReview.user_id == user_id, MonthlyReview.period == period)).first()
    if done and row is None:
        row = MonthlyReview(workspace_id=access.workspace_id, user_id=user_id, period=period,
                            completed_at=datetime.now(timezone.utc), marked_by=access.user_id)
        db.add(row)
        db.flush()
    elif not done and row is not None:
        db.delete(row)
        db.flush()
        row = None
    return row


def mine(db, access: Access, periods: List[date]) -> Dict[str, Optional[datetime]]:
    """The caller's own reviews for these months: "2026-10" -> when it was marked done, or None."""
    rows = {r.period: r.completed_at for r in db.scalars(select(MonthlyReview).where(
        MonthlyReview.workspace_id == access.workspace_id, MonthlyReview.user_id == access.user_id,
        MonthlyReview.period.in_(periods)))}
    return {p.strftime("%Y-%m"): rows.get(p) for p in periods}


def team(db, access: Access, period: date) -> List[dict]:
    """Everyone the caller looks after, done or not, for one month. Admins: every member."""
    allowed = _who_may_see(db, access)
    if allowed is not None and not allowed:
        raise Forbidden("Only admins and Managers see other people's monthly reviews")
    ids = [uid for uid in db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.deactivated_at.is_(None),
        WorkspaceMember.role.in_([WorkspaceRole.member, WorkspaceRole.limited]),
    )) if allowed is None or uid in allowed]
    done = {r.user_id: r for r in db.scalars(select(MonthlyReview).where(
        MonthlyReview.workspace_id == access.workspace_id, MonthlyReview.period == period, MonthlyReview.user_id.in_(ids)))} if ids else {}
    return [{"user_id": uid, "completed_at": done[uid].completed_at if uid in done else None,
             "marked_by": done[uid].marked_by if uid in done else None} for uid in ids]
