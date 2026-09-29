"""Leave: types and allowances, holidays, requests and approvals, balances, and who is off when.

Approved leave and company holidays take capacity away, so Workload, timesheets and Dashboards
see them (see `daily_capacity`). Requests go to the person's reporting manager (admins can decide
any request); leave types that don't need approval are approved straight away.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import Holiday, LeaveRequest, LeaveType, User, WorkspaceMember, WorkspaceRole
from app.schemas import leave as lv
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

DEFAULT_TYPES = [
    ("Casual", "#0ea5e9", 12.0, True),
    ("Sick", "#f97316", 12.0, True),
    ("Earned", "#10b981", 15.0, True),
    ("Unpaid", "#64748b", None, False),
]
LIVE = ("pending", "approved")


# --- types and holidays ------------------------------------------------------------------------------


def _require_admin(access: Access, what: str) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden(f"Only owners and admins can {what}")


def types(db: Session, access: Access, include_archived: bool = False) -> List[LeaveType]:
    rows = list(db.scalars(select(LeaveType).where(LeaveType.workspace_id == access.workspace_id).order_by(LeaveType.orderindex, LeaveType.name)))
    if not rows:
        # The first visit often sends several requests at once; each may try to add the defaults.
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        db.execute(pg_insert(LeaveType).values([
            dict(id=uuid.uuid4(), workspace_id=access.workspace_id, name=name, color=color, yearly_days=days, paid=paid,
                 needs_approval=True, archived=False, orderindex=float(i))
            for i, (name, color, days, paid) in enumerate(DEFAULT_TYPES)
        ]).on_conflict_do_nothing(constraint="uq_leave_types_name"))
        db.flush()
        return types(db, access, include_archived)
    return [t for t in rows if include_archived or not t.archived]


def type_out(t: LeaveType) -> lv.LeaveTypeOut:
    return lv.LeaveTypeOut(id=t.id, name=t.name, color=t.color, yearly_days=t.yearly_days, paid=t.paid,
                           needs_approval=t.needs_approval, archived=t.archived)


def save_type(db: Session, access: Access, type_id: Optional[uuid.UUID], data: lv.LeaveTypeIn) -> LeaveType:
    _require_admin(access, "change leave types")
    clash = db.scalars(select(LeaveType).where(LeaveType.workspace_id == access.workspace_id, func.lower(LeaveType.name) == data.name.lower())).first()
    if clash is not None and clash.id != type_id:
        raise Invalid(f"There is already a leave type called {data.name}")
    if type_id is None:
        count = db.scalar(select(func.count()).select_from(LeaveType).where(LeaveType.workspace_id == access.workspace_id)) or 0
        row = LeaveType(workspace_id=access.workspace_id, orderindex=float(count))
        db.add(row)
    else:
        row = db.get(LeaveType, type_id)
        if row is None or row.workspace_id != access.workspace_id:
            raise NotFound("Leave type not found")
    row.name, row.color, row.yearly_days, row.paid, row.needs_approval, row.archived = (
        data.name, data.color, data.yearly_days, data.paid, data.needs_approval, data.archived)
    db.flush()
    return row


def holidays(db: Session, access: Access, year: Optional[int] = None) -> List[Holiday]:
    query = select(Holiday).where(Holiday.workspace_id == access.workspace_id)
    if year:
        query = query.where(Holiday.day >= date(year, 1, 1), Holiday.day <= date(year, 12, 31))
    return list(db.scalars(query.order_by(Holiday.day)))


def add_holiday(db: Session, access: Access, data: lv.HolidayIn) -> Holiday:
    _require_admin(access, "change holidays")
    if db.scalars(select(Holiday).where(Holiday.workspace_id == access.workspace_id, Holiday.day == data.day)).first():
        raise Invalid(f"{data.day.isoformat()} is already a holiday")
    row = Holiday(workspace_id=access.workspace_id, day=data.day, name=data.name)
    db.add(row)
    db.flush()
    _recount(db, access.workspace_id, data.day, data.day)
    return row


def remove_holiday(db: Session, access: Access, holiday_id: uuid.UUID) -> None:
    _require_admin(access, "change holidays")
    row = db.get(Holiday, holiday_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Holiday not found")
    day = row.day
    db.delete(row)
    db.flush()
    _recount(db, access.workspace_id, day, day)


# --- counting days and capacity --------------------------------------------------------------------------


def _weekly(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str]) -> Dict[str, List[int]]:
    from app.services.work.timesheets import capacity_of

    return {uid: capacity_of(db, workspace_id, uid)[0] for uid in user_ids}


def _holiday_days(db: Session, workspace_id: uuid.UUID, first: date, last: date) -> Dict[date, str]:
    return {h.day: h.name for h in db.scalars(select(Holiday).where(Holiday.workspace_id == workspace_id, Holiday.day >= first, Holiday.day <= last))}


def count_days(weekly: Sequence[int], off: Dict[date, str], start: date, end: date, part: str) -> float:
    """Working days in [start, end]: days with scheduled hours that aren't holidays; a half day counts 0.5."""
    total = 0.0
    day = start
    while day <= end:
        if weekly[day.weekday()] > 0 and day not in off:
            total += 1
        day += timedelta(days=1)
    return total / 2 if part != "full" and total else total


def _recount(db: Session, workspace_id: uuid.UUID, first: date, last: date) -> None:
    """Holidays changed: recount the live requests that overlap those days."""
    rows = list(db.scalars(select(LeaveRequest).where(LeaveRequest.workspace_id == workspace_id, LeaveRequest.status.in_(LIVE),
                                                      LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)))
    weekly = _weekly(db, workspace_id, {r.user_id for r in rows})
    for r in rows:
        r.days = count_days(weekly[r.user_id], _holiday_days(db, workspace_id, r.start_date, r.end_date), r.start_date, r.end_date, r.part)
    db.flush()


def daily_capacity(db: Session, workspace_id: uuid.UUID, user_ids: Iterable[str], days: Sequence[date]) -> Dict[str, List[int]]:
    """Seconds each person is available per day: their working hours, minus holidays and approved leave."""
    ids = list(dict.fromkeys(user_ids))
    if not ids or not days:
        return {uid: [0] * len(days) for uid in ids}
    first, last = min(days), max(days)
    weekly = _weekly(db, workspace_id, ids)
    off = _holiday_days(db, workspace_id, first, last)
    leave: Dict[Tuple[str, date], float] = {}
    for r in db.scalars(select(LeaveRequest).where(
            LeaveRequest.workspace_id == workspace_id, LeaveRequest.user_id.in_(ids), LeaveRequest.status == "approved",
            LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)):
        d = max(r.start_date, first)
        while d <= min(r.end_date, last):
            leave[(r.user_id, d)] = max(leave.get((r.user_id, d), 0.0), 0.5 if r.part != "full" else 1.0)
            d += timedelta(days=1)
    out = {}
    for uid in ids:
        row = []
        for d in days:
            base = 0 if d in off else weekly[uid][d.weekday()]
            row.append(int(base * (1 - leave.get((uid, d), 0.0))))
        out[uid] = row
    return out


# --- requests -----------------------------------------------------------------------------------------------


def _member(db: Session, access: Access, user_id: str) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    if member is None:
        raise NotFound("Person not found")
    return member


def _approver_for(db: Session, access: Access, user_id: str) -> Optional[str]:
    member = _member(db, access, user_id)
    if member.manager_id:
        mgr = db.get(WorkspaceMember, (access.workspace_id, member.manager_id))
        if mgr is not None and mgr.deactivated_at is None:
            return member.manager_id
    owner = db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == access.workspace_id,
                                                           WorkspaceMember.role == WorkspaceRole.owner)).first()
    return owner if owner != user_id else None


def can_decide(db: Session, access: Access, req: LeaveRequest) -> bool:
    if req.user_id == access.user_id and not access.role == WorkspaceRole.owner:
        return False
    return req.approver_id == access.user_id or can_manage_workspace(access.role)


def request_out(db: Session, access: Access, r: LeaveRequest, users: Dict[str, User], types_by_id: Dict[uuid.UUID, LeaveType]) -> lv.LeaveRequestOut:
    see_reason = r.user_id == access.user_id or r.approver_id == access.user_id or can_manage_workspace(access.role)
    t = types_by_id.get(r.type_id) if r.type_id else None
    u = users.get(r.user_id)
    return lv.LeaveRequestOut(
        id=r.id, user=s.UserOut.model_validate(u) if u else None, type=type_out(t) if t else None, start_date=r.start_date,
        end_date=r.end_date, part=r.part, days=r.days, reason=r.reason if see_reason else None, status=r.status,
        approver=s.UserOut.model_validate(users[r.approver_id]) if r.approver_id in users else None,
        decided_by=s.UserOut.model_validate(users[r.decided_by]) if r.decided_by in users else None,
        decided_at=r.decided_at, decision_note=r.decision_note if see_reason else None, created_at=r.created_at,
        can_decide=r.status == "pending" and can_decide(db, access, r),
    )


def _out_many(db: Session, access: Access, rows: List[LeaveRequest]) -> List[lv.LeaveRequestOut]:
    ids = {x for r in rows for x in (r.user_id, r.approver_id, r.decided_by) if x}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    tmap = {t.id: t for t in types(db, access, include_archived=True)}
    return [request_out(db, access, r, users, tmap) for r in rows]


def create_request(db: Session, access: Access, data: lv.LeaveRequestIn) -> lv.LeaveRequestOut:
    user_id = data.user_id or access.user_id
    if user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("You can only request leave for yourself")
    if access.role == WorkspaceRole.guest:
        raise Forbidden("Guests don't take leave here")
    member = _member(db, access, user_id)
    if member.deactivated_at is not None:
        raise Invalid("Their access is turned off")
    kind = db.get(LeaveType, data.type_id)
    if kind is None or kind.workspace_id != access.workspace_id or kind.archived:
        raise Invalid("Choose a leave type")
    if data.part != "full" and data.start_date != data.end_date:
        raise Invalid("A half day is a single day")
    overlap = db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id == user_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= data.end_date, LeaveRequest.end_date >= data.start_date)).first()
    if overlap is not None:
        raise Invalid(f"This overlaps your leave from {overlap.start_date.isoformat()} to {overlap.end_date.isoformat()}")
    weekly = _weekly(db, access.workspace_id, [user_id])[user_id]
    days = count_days(weekly, _holiday_days(db, access.workspace_id, data.start_date, data.end_date), data.start_date, data.end_date, data.part)
    if days == 0:
        raise Invalid("Those dates are all weekends or holidays, so no leave is needed")
    if kind.yearly_days is not None:
        bal = next(b for b in balances(db, access, user_id, data.start_date.year) if b.type.id == kind.id)
        if days > bal.remaining + 1e-9:
            raise Invalid(f"Only {bal.remaining:g} {kind.name} days left this year")
    row = LeaveRequest(workspace_id=access.workspace_id, user_id=user_id, type_id=kind.id, start_date=data.start_date,
                       end_date=data.end_date, part=data.part, days=days, reason=data.reason, approver_id=_approver_for(db, access, user_id))
    db.add(row)
    db.flush()
    admin_booking = user_id != access.user_id  # an admin recording someone's leave decides it too
    if not kind.needs_approval or admin_booking or row.approver_id is None:
        row.status, row.decided_by, row.decided_at = "approved", access.user_id, datetime.now(timezone.utc)
        db.flush()
    else:
        events.notify(db, access.workspace_id, [row.approver_id], access.user_id, "leave_request", "primary",
                      data={"leave_id": str(row.id), "days": days, "type": kind.name, "from": data.start_date.isoformat(), "to": data.end_date.isoformat()})
    return _out_many(db, access, [row])[0]


def _get(db: Session, access: Access, leave_id: uuid.UUID) -> LeaveRequest:
    row = db.get(LeaveRequest, leave_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Leave request not found")
    return row


def decide(db: Session, access: Access, leave_id: uuid.UUID, approve: bool, note: Optional[str]) -> lv.LeaveRequestOut:
    row = _get(db, access, leave_id)
    if row.status != "pending":
        raise Invalid("This request has already been decided")
    if not can_decide(db, access, row):
        raise Forbidden("Only their reporting manager or an admin can decide this")
    row.status = "approved" if approve else "rejected"
    row.decided_by, row.decided_at, row.decision_note = access.user_id, datetime.now(timezone.utc), note
    db.flush()
    kind = db.get(LeaveType, row.type_id) if row.type_id else None
    events.notify(db, access.workspace_id, [row.user_id], access.user_id, "leave_decision", "primary",
                  data={"leave_id": str(row.id), "status": row.status, "type": kind.name if kind else "Leave",
                        "from": row.start_date.isoformat(), "to": row.end_date.isoformat(), "note": note})
    return _out_many(db, access, [row])[0]


def cancel(db: Session, access: Access, leave_id: uuid.UUID) -> lv.LeaveRequestOut:
    row = _get(db, access, leave_id)
    if row.user_id != access.user_id and not can_manage_workspace(access.role):
        raise Forbidden("You can only cancel your own leave")
    if row.status not in LIVE:
        raise Invalid("Only pending or approved leave can be cancelled")
    if row.status == "approved" and row.end_date < date.today() and not can_manage_workspace(access.role):
        raise Invalid("Leave that has already been taken can only be cancelled by an admin")
    row.status = "cancelled"
    db.flush()
    return _out_many(db, access, [row])[0]


def list_requests(db: Session, access: Access, scope: str, year: Optional[int] = None) -> List[lv.LeaveRequestOut]:
    """mine: my requests; approvals: pending requests I can decide; all: everyone's (admins)."""
    query = select(LeaveRequest).where(LeaveRequest.workspace_id == access.workspace_id)
    if scope == "mine":
        query = query.where(LeaveRequest.user_id == access.user_id)
    elif scope == "approvals":
        query = query.where(LeaveRequest.status == "pending", LeaveRequest.user_id != access.user_id)
        if not can_manage_workspace(access.role):
            query = query.where(LeaveRequest.approver_id == access.user_id)
    elif scope == "all":
        _require_admin(access, "see everyone's leave requests")
    if year:
        query = query.where(LeaveRequest.start_date <= date(year, 12, 31), LeaveRequest.end_date >= date(year, 1, 1))
    return _out_many(db, access, list(db.scalars(query.order_by(LeaveRequest.start_date.desc()).limit(500))))


def calendar(db: Session, access: Access, start: date, end: date) -> lv.LeaveCalendarOut:
    """Who is off when (approved, plus pending marked as such), and the holidays. Everyone in the workspace sees this."""
    if end < start or (end - start).days > 400:
        raise Invalid("Pick a range of up to a year")
    rows = list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= end, LeaveRequest.end_date >= start).order_by(LeaveRequest.start_date)))
    return lv.LeaveCalendarOut(
        leave=_out_many(db, access, rows),
        holidays=[lv.HolidayOut(id=h.id, day=h.day, name=h.name) for h in db.scalars(select(Holiday).where(
            Holiday.workspace_id == access.workspace_id, Holiday.day >= start, Holiday.day <= end).order_by(Holiday.day))],
    )


def balances(db: Session, access: Access, user_id: str, year: int) -> List[lv.LeaveBalance]:
    if user_id != access.user_id and not can_manage_workspace(access.role):
        member = _member(db, access, user_id)
        if member.manager_id != access.user_id:
            raise Forbidden("You can see your own balance, your direct reports' and (as an admin) everyone's")
    out = []
    first, last = date(year, 1, 1), date(year, 12, 31)
    rows = list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id == user_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)))
    for t in types(db, access):
        used = sum(r.days for r in rows if r.type_id == t.id and r.status == "approved")
        pending = sum(r.days for r in rows if r.type_id == t.id and r.status == "pending")
        remaining = (t.yearly_days - used - pending) if t.yearly_days is not None else float("inf")
        out.append(lv.LeaveBalance(type=type_out(t), allowance=t.yearly_days, used=used, pending=pending,
                                   remaining=remaining if remaining != float("inf") else 9999))
    return out


# --- importing from the old system ----------------------------------------------------------------------------


def import_v1(db: Session, access: Access, records: List[dict]) -> Dict[str, int]:
    """Bring leave from the old Firestore app: {userId (Firebase uid), leaveType, startDate, endDate, reason, status, id}."""
    _require_admin(access, "import leave")
    by_name = {t.name.lower(): t for t in types(db, access, include_archived=True)}
    mapping = {"vacation": "earned", "other": "unpaid"}
    counts = {"imported": 0, "skipped": 0, "unknown_person": 0}
    for rec in records:
        source_id = f"v1:{rec.get('id')}"
        if db.scalars(select(LeaveRequest.id).where(LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.source_id == source_id)).first():
            counts["skipped"] += 1
            continue
        uid = str(rec.get("userId") or "")
        user = db.scalars(select(User).where(or_(User.auth_uid == uid, User.id == uid))).first()
        if user is None or db.get(WorkspaceMember, (access.workspace_id, user.id)) is None:
            counts["unknown_person"] += 1
            continue
        name = str(rec.get("leaveType") or "Other").lower()
        kind = by_name.get(name) or by_name.get(mapping.get(name, "")) or next(iter(by_name.values()))
        try:
            start, end = date.fromisoformat(str(rec["startDate"])[:10]), date.fromisoformat(str(rec["endDate"])[:10])
        except (KeyError, ValueError):
            counts["skipped"] += 1
            continue
        weekly = _weekly(db, access.workspace_id, [user.id])[user.id]
        status = {"approved": "approved", "rejected": "rejected"}.get(str(rec.get("status") or "").lower(), "pending")
        db.add(LeaveRequest(
            workspace_id=access.workspace_id, user_id=user.id, type_id=kind.id, start_date=start, end_date=max(start, end), part="full",
            days=count_days(weekly, _holiday_days(db, access.workspace_id, start, max(start, end)), start, max(start, end), "full"),
            reason=rec.get("reason") or None, status=status, approver_id=_approver_for(db, access, user.id), source_id=source_id,
            decided_at=datetime.now(timezone.utc) if status != "pending" else None,
        ))
        counts["imported"] += 1
    db.flush()
    return counts
