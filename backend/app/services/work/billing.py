"""Billing rates, client fees, profitability and invoice drafts (owners and admins only).

A rate applies to billable time. The most specific rate wins, from a person's rate on the task's List,
their rate on its Folder or Space, the List's/Folder's/Space's rate for everyone, down to the person's
own default rate. A client is any Space, Folder or List that has a fee: a monthly retainer or a one-off.
"""

import calendar
import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models import BillingRate, ClientFee, Folder, Space, Task, TaskList, TimeEntry, User, WorkspaceMember
from app.schemas import leave as lv
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

MODELS = {"space": Space, "folder": Folder, "list": TaskList}


def _require_admin(access: Access) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can see or change billing")


def _location(db: Session, access: Access, kind: str, loc_id: uuid.UUID):
    obj = db.get(MODELS[kind], loc_id)
    if obj is None:
        raise NotFound("Location not found")
    space = obj if kind == "space" else db.get(Space, obj.space_id)
    if space is None or space.workspace_id != access.workspace_id:
        raise NotFound("Location not found")
    return obj


# --- rates --------------------------------------------------------------------------------------------------


def _rate_out(db: Session, r: BillingRate) -> lv.BillingRateOut:
    kind = "space" if r.space_id else "folder" if r.folder_id else "list" if r.list_id else None
    loc_id = r.space_id or r.folder_id or r.list_id
    obj = db.get(MODELS[kind], loc_id) if kind else None
    user = db.get(User, r.user_id) if r.user_id else None
    return lv.BillingRateOut(id=r.id, user=s.UserOut.model_validate(user) if user else None, location_kind=kind, location_id=loc_id,
                             location_name=obj.name if obj else None, hourly_rate=float(r.hourly_rate), currency=r.currency)


def list_rates(db: Session, access: Access) -> List[lv.BillingRateOut]:
    _require_admin(access)
    return [_rate_out(db, r) for r in db.scalars(select(BillingRate).where(BillingRate.workspace_id == access.workspace_id))]


def set_rate(db: Session, access: Access, data: lv.BillingRateIn) -> lv.BillingRateOut:
    """Add or replace the rate for this person / location combination."""
    _require_admin(access)
    if data.user_id and db.get(WorkspaceMember, (access.workspace_id, data.user_id)) is None:
        raise Invalid("That person is not in the workspace")
    column = {"space": BillingRate.space_id, "folder": BillingRate.folder_id, "list": BillingRate.list_id}
    query = select(BillingRate).where(BillingRate.workspace_id == access.workspace_id,
                                      BillingRate.user_id == data.user_id if data.user_id else BillingRate.user_id.is_(None))
    for kind, col in column.items():
        query = query.where(col == data.location_id if data.location_kind == kind else col.is_(None))
    if data.location_kind:
        _location(db, access, data.location_kind, data.location_id)
    row = db.scalars(query).first()
    if row is None:
        row = BillingRate(workspace_id=access.workspace_id, user_id=data.user_id,
                          **({f"{data.location_kind}_id": data.location_id} if data.location_kind else {}))
        db.add(row)
    row.hourly_rate, row.currency = data.hourly_rate, data.currency
    db.flush()
    return _rate_out(db, row)


def remove_rate(db: Session, access: Access, rate_id: uuid.UUID) -> None:
    _require_admin(access)
    row = db.get(BillingRate, rate_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Rate not found")
    db.delete(row)
    db.flush()


class Rates:
    """Resolves the rate for (person, List) using the most specific rate that exists."""

    def __init__(self, db: Session, workspace_id: uuid.UUID):
        self.db = db
        self.rows = list(db.scalars(select(BillingRate).where(BillingRate.workspace_id == workspace_id)))
        self._chains: Dict[uuid.UUID, List[Tuple[str, uuid.UUID]]] = {}

    def _chain(self, list_id: uuid.UUID) -> List[Tuple[str, uuid.UUID]]:
        if list_id not in self._chains:
            lst = self.db.get(TaskList, list_id)
            chain = [("list", lst.id)]
            folder_id = lst.folder_id
            while folder_id:
                folder = self.db.get(Folder, folder_id)
                chain.append(("folder", folder.id))
                folder_id = folder.parent_folder_id
            chain.append(("space", lst.space_id))
            self._chains[list_id] = chain
        return self._chains[list_id]

    def for_(self, user_id: str, list_id: uuid.UUID) -> Optional[BillingRate]:
        def at(kind: str, loc: uuid.UUID, who: Optional[str]) -> Optional[BillingRate]:
            return next((r for r in self.rows if r.user_id == who and getattr(r, f"{kind}_id") == loc), None)

        chain = self._chain(list_id)
        for who in (user_id, None):
            for kind, loc in chain:
                hit = at(kind, loc, who)
                if hit:
                    return hit
        return next((r for r in self.rows if r.user_id == user_id and not (r.space_id or r.folder_id or r.list_id)), None)


# --- fees ----------------------------------------------------------------------------------------------------


def _fee_out(db: Session, f: ClientFee) -> lv.ClientFeeOut:
    kind = "space" if f.space_id else "folder" if f.folder_id else "list"
    obj = db.get(MODELS[kind], f.space_id or f.folder_id or f.list_id)
    return lv.ClientFeeOut(amount=float(f.amount), period=f.period, currency=f.currency, client_name=f.client_name,
                           location_kind=kind, location_id=obj.id, location_name=obj.name)


def list_fees(db: Session, access: Access) -> List[lv.ClientFeeOut]:
    _require_admin(access)
    return [_fee_out(db, f) for f in db.scalars(select(ClientFee).where(ClientFee.workspace_id == access.workspace_id))]


def set_fee(db: Session, access: Access, kind: str, loc_id: uuid.UUID, data: Optional[lv.ClientFeeIn]) -> Optional[lv.ClientFeeOut]:
    _require_admin(access)
    _location(db, access, kind, loc_id)
    row = db.scalars(select(ClientFee).where(getattr(ClientFee, f"{kind}_id") == loc_id)).first()
    if data is None:
        if row is not None:
            db.delete(row)
            db.flush()
        return None
    if row is None:
        row = ClientFee(workspace_id=access.workspace_id, **{f"{kind}_id": loc_id})
        db.add(row)
    row.amount, row.period, row.currency, row.client_name = data.amount, data.period, data.currency, data.client_name
    db.flush()
    return _fee_out(db, row)


# --- profitability ------------------------------------------------------------------------------------------------


def _lists_under(db: Session, kind: str, obj) -> List[uuid.UUID]:
    if kind == "list":
        return [obj.id]
    if kind == "space":
        return list(db.scalars(select(TaskList.id).where(TaskList.space_id == obj.id)))
    folders = [obj.id] + list(db.scalars(select(Folder.id).where(Folder.parent_folder_id == obj.id)))
    return list(db.scalars(select(TaskList.id).where(TaskList.folder_id.in_(folders))))


def _window(start: date, end: date, tz_name: str) -> Tuple[datetime, datetime]:
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError):
        raise Invalid("Unknown timezone")
    return datetime.combine(start, time.min, tz), datetime.combine(end + timedelta(days=1), time.min, tz)


def _fee_for(fee: Optional[ClientFee], start: date, end: date) -> Optional[float]:
    """A monthly retainer counts for the share of each month in the period; a one-off fee counts in full."""
    if fee is None:
        return None
    if fee.period == "one_off":
        return float(fee.amount)
    total = 0.0
    day = start
    while day <= end:
        days_in = calendar.monthrange(day.year, day.month)[1]
        month_end = date(day.year, day.month, days_in)
        covered = (min(month_end, end) - day).days + 1
        total += float(fee.amount) * covered / days_in
        day = month_end + timedelta(days=1)
    return round(total, 2)


def _entries(db: Session, list_ids: Sequence[uuid.UUID], since: datetime, until: datetime) -> List[Tuple[TimeEntry, Task]]:
    if not list_ids:
        return []
    return list(db.execute(
        select(TimeEntry, Task).join(Task, Task.id == TimeEntry.task_id)
        .where(Task.list_id.in_(list_ids), TimeEntry.started_at >= since, TimeEntry.started_at < until,
               TimeEntry.duration_seconds.is_not(None))
    ).tuples())


def profitability(db: Session, access: Access, start: date, end: date, tz: str,
                  kind: Optional[str] = None, loc_id: Optional[uuid.UUID] = None) -> lv.ProfitReport:
    _require_admin(access)
    if end < start or (end - start).days > 400:
        raise Invalid("Pick a period of up to a year")
    since, until = _window(start, end, tz)
    rates = Rates(db, access.workspace_id)
    if kind and loc_id:
        targets = [(kind, _location(db, access, kind, loc_id))]
    else:
        targets = []
        for f in db.scalars(select(ClientFee).where(ClientFee.workspace_id == access.workspace_id)):
            k = "space" if f.space_id else "folder" if f.folder_id else "list"
            targets.append((k, db.get(MODELS[k], f.space_id or f.folder_id or f.list_id)))
    users = {u.id: u for u in db.scalars(select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
                                         .where(WorkspaceMember.workspace_id == access.workspace_id))}
    rows = []
    for k, obj in targets:
        fee = db.scalars(select(ClientFee).where(getattr(ClientFee, f"{k}_id") == obj.id)).first()
        per: Dict[str, Dict[str, float]] = defaultdict(lambda: {"b": 0, "n": 0, "value": 0.0, "rate": None})
        unpriced = 0
        currency = fee.currency if fee else "INR"
        for entry, task in _entries(db, _lists_under(db, k, obj), since, until):
            p = per[entry.user_id]
            if not entry.billable:
                p["n"] += entry.duration_seconds
                continue
            p["b"] += entry.duration_seconds
            rate = rates.for_(entry.user_id, task.list_id)
            if rate is None:
                unpriced += entry.duration_seconds
                continue
            p["rate"] = float(rate.hourly_rate)
            p["value"] += entry.duration_seconds / 3600 * float(rate.hourly_rate)
            currency = rate.currency if not fee else currency
        value = round(sum(p["value"] for p in per.values()), 2)
        fee_amount = _fee_for(fee, start, end)
        rows.append(lv.ProfitRow(
            location_kind=k, location_id=obj.id, name=obj.name, client_name=fee.client_name if fee else None, currency=currency,
            fee=fee_amount, billable_seconds=int(sum(p["b"] for p in per.values())), non_billable_seconds=int(sum(p["n"] for p in per.values())),
            value=value, unpriced_seconds=unpriced,
            realisation=round(100 * fee_amount / value, 1) if fee_amount is not None and value else None,
            margin=round(fee_amount - value, 2) if fee_amount is not None else None,
            people=sorted([
                lv.ProfitPerson(user=s.UserOut.model_validate(users[uid]) if uid in users else None, billable_seconds=int(p["b"]),
                                non_billable_seconds=int(p["n"]), rate=p["rate"], value=round(p["value"], 2))
                for uid, p in per.items()
            ], key=lambda x: -(x.billable_seconds + x.non_billable_seconds)),
        ))
    rows.sort(key=lambda r: r.name.lower())
    return lv.ProfitReport(start=start, end=end, rows=rows)


def invoice(db: Session, access: Access, kind: str, loc_id: uuid.UUID, start: date, end: date, tz: str) -> lv.InvoiceDraft:
    """Billable time in a period, one line per task and person, priced at their rate."""
    _require_admin(access)
    obj = _location(db, access, kind, loc_id)
    since, until = _window(start, end, tz)
    rates = Rates(db, access.workspace_id)
    fee = db.scalars(select(ClientFee).where(getattr(ClientFee, f"{kind}_id") == obj.id)).first()
    lines: Dict[Tuple[uuid.UUID, str], Dict] = {}
    currency = fee.currency if fee else "INR"
    for entry, task in _entries(db, _lists_under(db, kind, obj), since, until):
        if not entry.billable:
            continue
        line = lines.setdefault((task.id, entry.user_id), {"task": task, "user": entry.user_id, "seconds": 0})
        line["seconds"] += entry.duration_seconds
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({u for _, u in lines})))} if lines else {}
    out: List[lv.InvoiceLine] = []
    for (task_id, uid), line in sorted(lines.items(), key=lambda kv: (kv[1]["task"].name.lower(), kv[1]["user"])):
        rate = rates.for_(uid, line["task"].list_id)
        amount = round(line["seconds"] / 3600 * float(rate.hourly_rate), 2) if rate else 0.0
        if rate and not fee:
            currency = rate.currency
        task = line["task"]
        prefix = db.get(Space, db.get(TaskList, task.list_id).space_id).task_prefix
        out.append(lv.InvoiceLine(task_id=task.id, task_name=task.name, custom_id=f"{prefix}-{task.seq}" if prefix and task.seq else None,
                                  user=s.UserOut.model_validate(users[uid]) if uid in users else None, seconds=line["seconds"],
                                  rate=float(rate.hourly_rate) if rate else None, amount=amount))
    return lv.InvoiceDraft(location_kind=kind, location_id=obj.id, name=obj.name, client_name=fee.client_name if fee else None,
                           currency=currency, start=start, end=end, lines=out, total_seconds=sum(l.seconds for l in out),
                           total=round(sum(l.amount for l in out), 2), fee=_fee_for(fee, start, end))
