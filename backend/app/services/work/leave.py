"""Leave: the policy, types and allowances, holidays, requests and approvals, balances, who is off when.

Approved leave and company holidays take capacity away, so Workload, timesheets and Dashboards
see them (see `daily_capacity`). Leave types that don't need approval are approved straight away.

The chain a request walks: the person asks, their reporting manager decides, and HR decides
instead when the manager cannot -- they are away, deactivated, or there is no manager. HR and
admins see every request; if nobody has looked at one for the number of days the policy allows,
HR is told. One workspace's rules live in `LeavePolicy` (see `policy`), because a firm's leave
year, carry-forward, notice period and busy season are not something code should decide.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Holiday, LeaveAdjustment, LeavePolicy, LeaveRequest, LeaveType, Team, TeamMember, User, WorkspaceMember, WorkspaceRole,
)
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
#: Nobody books a decade off; a typo should not be mistaken for one.
MAX_SPAN_DAYS = 366


# --- the policy ----------------------------------------------------------------------------------------


def policy(db: Session, workspace_id: uuid.UUID) -> LeavePolicy:
    """This workspace's rules, or the defaults. Not saved until an admin saves it.

    The defaults are spelled out rather than left to the columns: a row that is never flushed never
    gets its column defaults, and every field would read None -- which compares badly against an
    integer and reads as "no" for every boolean.
    """
    row = db.get(LeavePolicy, workspace_id)
    if row is not None:
        return row
    return LeavePolicy(
        workspace_id=workspace_id, year_start_month=4, carry_forward_days=None, prorate_joiners=True,
        min_notice_days=0, allow_backdated=True, count_days_off_inside=False, escalate_after_days=None,
        hr_team_id=None, blackout=[],
    )


def policy_out(db: Session, p: LeavePolicy) -> lv.LeavePolicyOut:
    team = db.get(Team, p.hr_team_id) if p.hr_team_id else None
    return lv.LeavePolicyOut(
        year_start_month=p.year_start_month, carry_forward_days=p.carry_forward_days, prorate_joiners=p.prorate_joiners,
        min_notice_days=p.min_notice_days, allow_backdated=p.allow_backdated, count_days_off_inside=p.count_days_off_inside,
        escalate_after_days=p.escalate_after_days, hr_team_id=p.hr_team_id, hr_team_name=team.name if team else None,
        blackout=[lv.Blackout(**b) for b in (p.blackout or []) if isinstance(b, dict)],
    )


def save_policy(db: Session, access: Access, data: lv.LeavePolicyIn) -> lv.LeavePolicyOut:
    _require_admin(access, "change the leave policy")
    if data.hr_team_id is not None:
        team = db.get(Team, data.hr_team_id)
        if team is None or team.workspace_id != access.workspace_id:
            raise Invalid("Choose a Team for HR")
    row = db.get(LeavePolicy, access.workspace_id)
    if row is None:
        row = LeavePolicy(workspace_id=access.workspace_id)
        db.add(row)
    for field in ("year_start_month", "carry_forward_days", "prorate_joiners", "min_notice_days", "allow_backdated",
                  "count_days_off_inside", "escalate_after_days", "hr_team_id"):
        setattr(row, field, getattr(data, field))
    row.blackout = [b.model_dump() for b in data.blackout]
    db.flush()
    # The sandwich rule changes what every live request is worth.
    _recount_all(db, access.workspace_id)
    return policy_out(db, row)


def leave_year(p: LeavePolicy, day: date) -> Tuple[int, date, date]:
    """The leave year containing `day`, named by the calendar year it starts in."""
    year = day.year if day.month >= p.year_start_month else day.year - 1
    first = date(year, p.year_start_month, 1)
    last = date(year + 1, p.year_start_month, 1) - timedelta(days=1)
    return year, first, last


def hr_ids(db: Session, p: LeavePolicy) -> Set[str]:
    """Everyone in the HR team. Empty where no HR team is set."""
    if not p.hr_team_id:
        return set()
    return set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == p.hr_team_id)))


def _blackout_reason(p: LeavePolicy, start: date, end: date) -> Optional[str]:
    """The first closed window these dates fall in. Windows are month-day, so they repeat yearly."""
    for window in p.blackout or []:
        if not isinstance(window, dict):
            continue
        try:
            opens = tuple(int(x) for x in str(window.get("from", "")).split("-"))
            closes = tuple(int(x) for x in str(window.get("to", "")).split("-"))
        except ValueError:
            continue
        if len(opens) != 2 or len(closes) != 2:
            continue
        day = start
        while day <= end:
            here = (day.month, day.day)
            # A window that runs over New Year reads the other way round.
            inside = opens <= here <= closes if opens <= closes else (here >= opens or here <= closes)
            if inside:
                return str(window.get("reason") or "").strip() or f"{window['from']} to {window['to']}"
            day += timedelta(days=1)
    return None


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


def count_days(weekly: Sequence[int], off: Dict[date, str], start: date, end: date, part: str,
               days_off_inside: bool = False) -> float:
    """What a span costs: working days in [start, end], with a half day counting 0.5.

    `days_off_inside` is the sandwich rule. Off by default, a Friday and the following Monday cost
    two days. On, the weekend between them is counted too, so they cost four -- but a weekend
    at either end of the span never is, or asking for Friday off would bill until Monday.
    """
    working = []
    day = start
    while day <= end:
        working.append(weekly[day.weekday()] > 0 and day not in off)
        day += timedelta(days=1)
    if not any(working):
        return 0.0
    if days_off_inside:
        first, last = working.index(True), len(working) - 1 - working[::-1].index(True)
        total = float(last - first + 1)
    else:
        total = float(sum(working))
    return total / 2 if part != "full" else total


def _cost(db: Session, workspace_id: uuid.UUID, user_id: str, start: date, end: date, part: str,
          p: Optional[LeavePolicy] = None) -> float:
    """What this span costs that person, under this workspace's rules."""
    p = p if p is not None else policy(db, workspace_id)
    weekly = _weekly(db, workspace_id, [user_id])[user_id]
    off = _holiday_days(db, workspace_id, start, end)
    return count_days(weekly, off, start, end, part, p.count_days_off_inside)


def _recount_rows(db: Session, workspace_id: uuid.UUID, rows: List[LeaveRequest]) -> None:
    if not rows:
        return
    p = policy(db, workspace_id)
    weekly = _weekly(db, workspace_id, {r.user_id for r in rows})
    for r in rows:
        off = _holiday_days(db, workspace_id, r.start_date, r.end_date)
        r.days = count_days(weekly[r.user_id], off, r.start_date, r.end_date, r.part, p.count_days_off_inside)
    db.flush()


def _recount(db: Session, workspace_id: uuid.UUID, first: date, last: date) -> None:
    """Holidays changed: recount the live requests that overlap those days."""
    _recount_rows(db, workspace_id, list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == workspace_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= last, LeaveRequest.end_date >= first))))


def _recount_all(db: Session, workspace_id: uuid.UUID) -> None:
    """The sandwich rule changed: every request still in play is worth something different."""
    _recount_rows(db, workspace_id, list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == workspace_id, LeaveRequest.status.in_(LIVE)))))


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


def is_away(db: Session, workspace_id: uuid.UUID, user_id: str, start: date, end: date) -> bool:
    """Is this person on approved leave for any of these days?"""
    return db.scalars(select(LeaveRequest.id).where(
        LeaveRequest.workspace_id == workspace_id, LeaveRequest.user_id == user_id, LeaveRequest.status == "approved",
        LeaveRequest.start_date <= end, LeaveRequest.end_date >= start)).first() is not None


def _owner_of(db: Session, workspace_id: uuid.UUID) -> Optional[str]:
    return db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == WorkspaceRole.owner)).first()


def _approver_for(db: Session, access: Access, user_id: str, start: Optional[date] = None,
                  end: Optional[date] = None) -> Optional[str]:
    """The reporting manager, unless they cannot decide it, in which case HR, and failing that the owner.

    "Cannot decide it" means no manager, a deactivated one, themselves, or one who is on approved
    leave for the whole of the days in question -- the gap that otherwise leaves a request sitting
    in the inbox of somebody on a beach.
    """
    member = _member(db, access, user_id)
    ws = access.workspace_id
    if member.manager_id and member.manager_id != user_id:
        mgr = db.get(WorkspaceMember, (ws, member.manager_id))
        away = start is not None and end is not None and is_away(db, ws, member.manager_id, start, end)
        if mgr is not None and mgr.deactivated_at is None and not away:
            return member.manager_id
    for candidate in sorted(hr_ids(db, policy(db, ws)) - {user_id}):
        hr = db.get(WorkspaceMember, (ws, candidate))
        if hr is not None and hr.deactivated_at is None:
            return candidate
    owner = _owner_of(db, ws)
    return owner if owner != user_id else None


def _is_hr(db: Session, access: Access) -> bool:
    return access.user_id in hr_ids(db, policy(db, access.workspace_id))


def can_decide(db: Session, access: Access, req: LeaveRequest) -> bool:
    """Their named approver, HR, or an admin. Never themselves, the owner aside."""
    if req.user_id == access.user_id and not access.role == WorkspaceRole.owner:
        return False
    return req.approver_id == access.user_id or can_manage_workspace(access.role) or _is_hr(db, access)


def request_out(db: Session, access: Access, r: LeaveRequest, users: Dict[str, User], types_by_id: Dict[uuid.UUID, LeaveType],
                is_hr: bool = False) -> lv.LeaveRequestOut:
    # A reason is between the person, whoever decides it, HR and the admins. Not the whole office.
    see_reason = r.user_id == access.user_id or r.approver_id == access.user_id or can_manage_workspace(access.role) or is_hr
    t = types_by_id.get(r.type_id) if r.type_id else None
    u = users.get(r.user_id)
    waiting = (datetime.now(timezone.utc) - r.created_at).days if r.status == "pending" else None
    return lv.LeaveRequestOut(
        id=r.id, user=s.UserOut.model_validate(u) if u else None, type=type_out(t) if t else None, start_date=r.start_date,
        end_date=r.end_date, part=r.part, days=r.days, reason=r.reason if see_reason else None, status=r.status,
        approver=s.UserOut.model_validate(users[r.approver_id]) if r.approver_id in users else None,
        decided_by=s.UserOut.model_validate(users[r.decided_by]) if r.decided_by in users else None,
        decided_at=r.decided_at, decision_note=r.decision_note if see_reason else None, created_at=r.created_at,
        can_decide=r.status == "pending" and can_decide(db, access, r),
        cover=s.UserOut.model_validate(users[r.cover_id]) if r.cover_id in users else None,
        escalated_at=r.escalated_at, waiting_days=waiting,
    )


def _out_many(db: Session, access: Access, rows: List[LeaveRequest]) -> List[lv.LeaveRequestOut]:
    ids = {x for r in rows for x in (r.user_id, r.approver_id, r.decided_by, r.cover_id) if x}
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}
    tmap = {t.id: t for t in types(db, access, include_archived=True)}
    is_hr = _is_hr(db, access)
    return [request_out(db, access, r, users, tmap, is_hr) for r in rows]


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
    if (data.end_date - data.start_date).days + 1 > MAX_SPAN_DAYS:
        raise Invalid("That is longer than a year -- check the dates")
    p = policy(db, access.workspace_id)
    # One request belongs to one leave year. Without this, a span from late March into April would
    # be counted in full against both years' allowances -- the same days spent twice.
    if leave_year(p, data.start_date)[0] != leave_year(p, data.end_date)[0]:
        _, _, ends = leave_year(p, data.start_date)
        raise Invalid(f"This crosses the end of the leave year ({ends.isoformat()}). Ask for the two halves separately.")
    # An admin recording leave for somebody else is doing the paperwork after the fact, so the
    # notice period and the closed windows are not theirs to satisfy.
    on_their_own_behalf = user_id == access.user_id
    if on_their_own_behalf:
        today = date.today()
        if data.start_date < today and not p.allow_backdated:
            raise Invalid("Leave can't be asked for in the past. Ask an admin to record it.")
        notice = (data.start_date - today).days
        if data.start_date >= today and p.min_notice_days and notice < p.min_notice_days:
            raise Invalid(
                f"{p.min_notice_days} days' notice is needed, and this is {notice}. "
                "Ask an admin to record it if it couldn't wait."
            )
        shut = _blackout_reason(p, data.start_date, data.end_date)
        if shut:
            raise Invalid(f"Leave is closed over those dates ({shut}). An admin can still record it.")
    overlap = db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id == user_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= data.end_date, LeaveRequest.end_date >= data.start_date)).first()
    if overlap is not None:
        raise Invalid(f"This overlaps your leave from {overlap.start_date.isoformat()} to {overlap.end_date.isoformat()}")
    days = _cost(db, access.workspace_id, user_id, data.start_date, data.end_date, data.part, p)
    if days == 0:
        raise Invalid("Those dates are all weekends or holidays, so no leave is needed")
    if kind.yearly_days is not None:
        year, _, _ = leave_year(p, data.start_date)
        bal = next(b for b in balances(db, access, user_id, year) if b.type.id == kind.id)
        if days > bal.remaining + 1e-9:
            raise Invalid(f"Only {bal.remaining:g} {kind.name} days left in this leave year")
    row = LeaveRequest(workspace_id=access.workspace_id, user_id=user_id, type_id=kind.id, start_date=data.start_date,
                       end_date=data.end_date, part=data.part, days=days, reason=data.reason,
                       approver_id=_approver_for(db, access, user_id, data.start_date, data.end_date))
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


def decide(db: Session, access: Access, leave_id: uuid.UUID, approve: bool, note: Optional[str],
           cover_id: Optional[str] = None) -> lv.LeaveRequestOut:
    row = _get(db, access, leave_id)
    if row.status != "pending":
        raise Invalid("This request has already been decided")
    if not can_decide(db, access, row):
        raise Forbidden("Only their reporting manager, HR or an admin can decide this")
    if cover_id is not None:
        if cover_id == row.user_id:
            raise Invalid("Someone cannot cover their own leave")
        cover = db.get(WorkspaceMember, (access.workspace_id, cover_id))
        if cover is None or cover.deactivated_at is not None:
            raise Invalid("Choose someone who is still here to cover")
        row.cover_id = cover_id
    row.status = "approved" if approve else "rejected"
    row.decided_by, row.decided_at, row.decision_note = access.user_id, datetime.now(timezone.utc), note
    db.flush()
    kind = db.get(LeaveType, row.type_id) if row.type_id else None
    span = {"from": row.start_date.isoformat(), "to": row.end_date.isoformat()}
    events.notify(db, access.workspace_id, [row.user_id], access.user_id, "leave_decision", "primary",
                  data={"leave_id": str(row.id), "status": row.status, "type": kind.name if kind else "Leave",
                        "note": note, **span})
    # Being named as cover is news to the person covering, not just a field on a record.
    if approve and row.cover_id and row.cover_id != access.user_id:
        away = db.get(User, row.user_id)
        events.notify(db, access.workspace_id, [row.cover_id], access.user_id, "leave_cover", "primary",
                      data={"leave_id": str(row.id), "who": (away.display_name or away.email) if away else "A colleague",
                            "days": row.days, **span})
    return _out_many(db, access, [row])[0]


# --- what the approver needs to know -------------------------------------------------------------------


def clashes(db: Session, access: Access, user_id: str, start: date, end: date) -> lv.LeaveClashes:
    """What this person already has due in those days, so nobody approves leave over a filing date."""
    from app.services.work import mywork

    if user_id != access.user_id and not can_manage_workspace(access.role) and not _is_hr(db, access):
        member = _member(db, access, user_id)
        if member.manager_id != access.user_id:
            raise Forbidden("You can see your own clashes, your direct reports' and (as HR or an admin) everyone's")
    theirs = Access(db, user_id, access.workspace_id, _member(db, access, user_id).role)
    due = []
    for t in mywork.my_tasks(db, theirs, include_closed=False):
        if t.due_date and start <= t.due_date.date() <= end:
            due.append(lv.ClashTask(id=t.id, name=t.name, list_id=t.list_id, due_date=t.due_date,
                                    priority=t.priority, compliance=False))
    # A statutory filing is the one a firm cannot move, so it is worth naming separately.
    from app.db.models import ComplianceTask

    filings = set(db.scalars(select(ComplianceTask.task_id).where(ComplianceTask.task_id.in_([c.id for c in due] or [uuid.uuid4()]))))
    for c in due:
        c.compliance = c.id in filings
    due.sort(key=lambda c: (not c.compliance, c.due_date))
    others = [
        lv.ClashPerson(user=s.UserOut.model_validate(db.get(User, r.user_id)), start_date=r.start_date, end_date=r.end_date,
                       status=r.status, days=r.days)
        for r in db.scalars(select(LeaveRequest).where(
            LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id != user_id,
            LeaveRequest.status.in_(LIVE), LeaveRequest.start_date <= end, LeaveRequest.end_date >= start))
        if db.get(User, r.user_id) is not None
    ]
    return lv.LeaveClashes(tasks=due, also_away=others)


# --- chasing a request nobody has looked at -------------------------------------------------------------


def run_escalations(db: Session, now: Optional[datetime] = None) -> int:
    """Tell HR about requests that have waited longer than the policy allows. Once each."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    for p in db.scalars(select(LeavePolicy).where(LeavePolicy.escalate_after_days.is_not(None))):
        people = hr_ids(db, p) or ({_owner_of(db, p.workspace_id)} - {None})
        if not people:
            continue
        cutoff = now - timedelta(days=p.escalate_after_days)
        for row in db.scalars(select(LeaveRequest).where(
            LeaveRequest.workspace_id == p.workspace_id, LeaveRequest.status == "pending",
            LeaveRequest.escalated_at.is_(None), LeaveRequest.created_at <= cutoff,
        )):
            who = db.get(User, row.user_id)
            kind = db.get(LeaveType, row.type_id) if row.type_id else None
            waited = max(1, (now - row.created_at).days)
            events.notify(db, p.workspace_id, sorted(people - {row.user_id}), None, "leave_escalated", "primary",
                          data={"leave_id": str(row.id), "who": (who.display_name or who.email) if who else "Someone",
                                "type": kind.name if kind else "Leave", "waited_days": waited,
                                "from": row.start_date.isoformat(), "to": row.end_date.isoformat()})
            row.escalated_at = now
            sent += 1
    db.flush()
    return sent


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


def list_requests(db: Session, access: Access, scope: str, year: Optional[int] = None,
                  status: Optional[str] = None, user_id: Optional[str] = None) -> List[lv.LeaveRequestOut]:
    """mine: my requests; approvals: pending ones I can decide; all: everyone's (HR and admins).

    `year` is a leave year, so with an April start "2026" runs to March 2027 -- the same year the
    balances are counted in, which is the only way the two screens can agree.
    """
    p = policy(db, access.workspace_id)
    is_hr = _is_hr(db, access)
    query = select(LeaveRequest).where(LeaveRequest.workspace_id == access.workspace_id)
    if scope == "mine":
        query = query.where(LeaveRequest.user_id == access.user_id)
    elif scope == "approvals":
        query = query.where(LeaveRequest.status == "pending", LeaveRequest.user_id != access.user_id)
        if not can_manage_workspace(access.role) and not is_hr:
            query = query.where(LeaveRequest.approver_id == access.user_id)
    elif scope == "all":
        if not can_manage_workspace(access.role) and not is_hr:
            raise Forbidden("Only HR or an admin can see everyone's leave")
        if user_id:
            query = query.where(LeaveRequest.user_id == user_id)
    if status:
        query = query.where(LeaveRequest.status == status)
    if year:
        first, last = _year_bounds(p, year)
        query = query.where(LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)
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


def _year_bounds(p: LeavePolicy, year: int) -> Tuple[date, date]:
    """The leave year named by `year`: 2026 with an April start is 1 Apr 2026 to 31 Mar 2027."""
    return date(year, p.year_start_month, 1), date(year + 1, p.year_start_month, 1) - timedelta(days=1)


def _taken(db: Session, workspace_id: uuid.UUID, user_id: str, first: date, last: date) -> List[LeaveRequest]:
    return list(db.scalars(select(LeaveRequest).where(
        LeaveRequest.workspace_id == workspace_id, LeaveRequest.user_id == user_id, LeaveRequest.status.in_(LIVE),
        LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)))


def _adjustments(db: Session, workspace_id: uuid.UUID, user_id: str, year: int) -> Dict[uuid.UUID, float]:
    return {a.type_id: a.days for a in db.scalars(select(LeaveAdjustment).where(
        LeaveAdjustment.workspace_id == workspace_id, LeaveAdjustment.user_id == user_id, LeaveAdjustment.year == year))}


def _prorated(allowance: float, joined: Optional[date], first: date, last: date) -> float:
    """A mid-year joiner earns the months they are here, to the nearest half day."""
    if joined is None or joined <= first:
        return allowance
    if joined > last:
        return 0.0
    months_left = (last.year - joined.year) * 12 + (last.month - joined.month) + 1
    total_months = (last.year - first.year) * 12 + (last.month - first.month) + 1
    return round(allowance * months_left / total_months * 2) / 2


def _carried(db: Session, access: Access, user_id: str, year: int, p: LeavePolicy,
             kinds: Sequence[LeaveType]) -> Dict[uuid.UUID, float]:
    """What was left at the end of last leave year, capped by the policy.

    Only one year back: days carried into last year were already spent or lost by its end, and a
    chain of recursion down every year a person has worked here would answer a question nobody
    asked.
    """
    if p.carry_forward_days is None:
        return {}
    first, last = _year_bounds(p, year - 1)
    if last < first:  # cannot happen, but a bad policy should not produce a silent nonsense
        return {}
    rows = _taken(db, access.workspace_id, user_id, first, last)
    adjust = _adjustments(db, access.workspace_id, user_id, year - 1)
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    joined = member.date_of_joining if member else None
    out = {}
    for t in kinds:
        if t.yearly_days is None:
            continue  # nothing to carry when there was no limit
        allowance = _prorated(t.yearly_days, joined, first, last) if p.prorate_joiners else t.yearly_days
        used = sum(r.days for r in rows if r.type_id == t.id and r.status == "approved")
        spare = allowance + adjust.get(t.id, 0.0) - used
        if spare > 0:
            out[t.id] = min(spare, p.carry_forward_days)
    return out


def balances(db: Session, access: Access, user_id: str, year: Optional[int] = None) -> List[lv.LeaveBalance]:
    """Where someone stands in a leave year: what they are owed, what they carried, what is gone."""
    if user_id != access.user_id and not can_manage_workspace(access.role) and not _is_hr(db, access):
        member = _member(db, access, user_id)
        if member.manager_id != access.user_id:
            raise Forbidden("You can see your own balance, your direct reports' and (as HR or an admin) everyone's")
    p = policy(db, access.workspace_id)
    if year is None:
        year, _, _ = leave_year(p, date.today())
    first, last = _year_bounds(p, year)
    rows = _taken(db, access.workspace_id, user_id, first, last)
    kinds = types(db, access)
    adjust = _adjustments(db, access.workspace_id, user_id, year)
    carried = _carried(db, access, user_id, year, p, kinds)
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    joined = member.date_of_joining if member else None
    out = []
    for t in kinds:
        used = sum(r.days for r in rows if r.type_id == t.id and r.status == "approved")
        pending = sum(r.days for r in rows if r.type_id == t.id and r.status == "pending")
        earned = None
        if t.yearly_days is not None:
            earned = _prorated(t.yearly_days, joined, first, last) if p.prorate_joiners else t.yearly_days
        brought = carried.get(t.id, 0.0)
        extra = adjust.get(t.id, 0.0)
        allowance = None if earned is None else earned + brought + extra
        remaining = 9999.0 if allowance is None else allowance - used - pending
        out.append(lv.LeaveBalance(
            type=type_out(t), allowance=allowance, used=used, pending=pending, remaining=remaining,
            earned=earned, carried_forward=brought, adjusted=extra,
            year=year, year_start=first, year_end=last,
        ))
    return out


# --- adjusting a balance by hand ------------------------------------------------------------------------


def adjustments(db: Session, access: Access, user_id: str, year: int) -> List[lv.LeaveAdjustmentOut]:
    if user_id != access.user_id and not can_manage_workspace(access.role) and not _is_hr(db, access):
        raise Forbidden("Only HR or an admin can see someone else's adjustments")
    kinds = {t.id: t for t in types(db, access, include_archived=True)}
    rows = db.scalars(select(LeaveAdjustment).where(
        LeaveAdjustment.workspace_id == access.workspace_id, LeaveAdjustment.user_id == user_id,
        LeaveAdjustment.year == year).order_by(LeaveAdjustment.created_at))
    out = []
    for a in rows:
        t = kinds.get(a.type_id)
        by = db.get(User, a.created_by) if a.created_by else None
        out.append(lv.LeaveAdjustmentOut(
            id=a.id, type=type_out(t) if t else None, year=a.year, days=a.days, reason=a.reason,
            created_by=s.UserOut.model_validate(by) if by else None, created_at=a.created_at))
    return out


def set_adjustment(db: Session, access: Access, data: lv.LeaveAdjustmentIn) -> List[lv.LeaveAdjustmentOut]:
    """Grant or take back days for one person, one type, one leave year. Zero removes the row."""
    if not can_manage_workspace(access.role) and not _is_hr(db, access):
        raise Forbidden("Only HR or an admin can adjust a balance")
    _member(db, access, data.user_id)
    kind = db.get(LeaveType, data.type_id)
    if kind is None or kind.workspace_id != access.workspace_id:
        raise Invalid("Choose a leave type")
    row = db.scalars(select(LeaveAdjustment).where(
        LeaveAdjustment.workspace_id == access.workspace_id, LeaveAdjustment.user_id == data.user_id,
        LeaveAdjustment.type_id == data.type_id, LeaveAdjustment.year == data.year)).first()
    if data.days == 0:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(LeaveAdjustment(workspace_id=access.workspace_id, user_id=data.user_id, type_id=data.type_id,
                               year=data.year, days=data.days, reason=data.reason, created_by=access.user_id))
    else:
        row.days, row.reason, row.created_by = data.days, data.reason, access.user_id
    db.flush()
    return adjustments(db, access, data.user_id, data.year)


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
