"""The statutory compliance calendar: repeating filings and payments per client, turned into dated tasks.

A workspace has a catalogue of obligations (GSTR-3B on the 20th, TDS returns quarterly, AOC-4 yearly…),
seeded with common Indian due dates that admins can change: the authorities extend dates by notification,
so the catalogue is a starting point to check, not the law. A client is a List; ticking obligations for it
creates one task per period, a few days before it falls due, for the people named. The scheduler keeps
the next two months of tasks in place.
"""

import calendar
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    ClientCompliance, ComplianceObligation, ComplianceTask, PermissionLevel, Space, Status, StatusGroup, Task, TaskList, User,
    WorkspaceMember,
)
from app.schemas import outbound as o
from app.schemas import work as s
from app.services.work.access import Access, Opened, chain_for_list
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

HORIZON = timedelta(days=62)
TZ = ZoneInfo("Asia/Kolkata")
CHECK_NOTE = "Check the current due date with the authority: due dates are sometimes extended by notification."

# code, name, authority, frequency, due_day, due_months, lead_days, notes
DEFAULT_CATALOGUE = [
    ("gstr1", "GSTR-1", "GST", "monthly", 11, [], 5, "Outward supplies for the previous month (monthly filers)."),
    ("gstr3b", "GSTR-3B", "GST", "monthly", 20, [], 5, "Summary return and tax payment for the previous month."),
    ("gstr1_qrmp", "GSTR-1 (QRMP)", "GST", "quarterly", 13, [1, 4, 7, 10], 7, "For quarterly filers under QRMP."),
    ("gstr9", "GSTR-9 annual return", "GST", "yearly", 31, [12], 20, "For the previous financial year."),
    ("tds_payment", "TDS / TCS payment", "Income Tax", "monthly", 7, [], 3, "Tax deducted in the previous month. March deductions are due by 30 April."),
    ("tds_return", "TDS returns (24Q / 26Q)", "Income Tax", "quarterly", 31, [5, 7, 10, 1], 10, "For the quarter just ended."),
    ("form16", "Form 16 to employees", "Income Tax", "yearly", 15, [6], 10, None),
    ("advance_tax", "Advance tax instalment", "Income Tax", "quarterly", 15, [6, 9, 12, 3], 7, "15%, 45%, 75% and 100% of the year's tax."),
    ("itr", "Income tax return (non-audit)", "Income Tax", "yearly", 31, [7], 21, None),
    ("tax_audit", "Tax audit report (Form 3CA/3CB-3CD)", "Income Tax", "yearly", 30, [9], 21, None),
    ("itr_audit", "Income tax return (audit cases)", "Income Tax", "yearly", 31, [10], 21, None),
    ("pf", "PF contribution and ECR", "EPFO", "monthly", 15, [], 3, "For the previous month's wages."),
    ("esi", "ESI contribution", "ESIC", "monthly", 15, [], 3, "For the previous month's wages."),
    ("aoc4", "AOC-4 (financial statements)", "MCA", "yearly", 30, [10], 14, "30 days from the AGM; shown for an AGM on 30 September."),
    ("mgt7", "MGT-7 (annual return)", "MCA", "yearly", 29, [11], 14, "60 days from the AGM; shown for an AGM on 30 September."),
    ("dir3kyc", "DIR-3 KYC", "MCA", "yearly", 30, [9], 14, "For every director with a DIN."),
    ("msme1", "MSME-1 (dues to micro and small enterprises)", "MCA", "half_yearly", 30, [4, 10], 10, None),
]


# --- the catalogue -------------------------------------------------------------------------------------------


def obligations(db: Session, access: Access, include_archived: bool = False) -> List[ComplianceObligation]:
    rows = list(db.scalars(select(ComplianceObligation).where(ComplianceObligation.workspace_id == access.workspace_id)
                           .order_by(ComplianceObligation.authority, ComplianceObligation.name)))
    if not rows:
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        db.execute(pg_insert(ComplianceObligation).values([
            dict(id=uuid.uuid4(), workspace_id=access.workspace_id, code=c, name=n, authority=a, frequency=f, due_day=d,
                 due_months=sorted(m), lead_days=lead, notes=notes, archived=False)
            for c, n, a, f, d, m, lead, notes in DEFAULT_CATALOGUE
        ]).on_conflict_do_nothing(constraint="uq_compliance_obligations_code"))
        db.flush()
        return obligations(db, access, include_archived)
    return [r for r in rows if include_archived or not r.archived]


def obligation_out(r: ComplianceObligation) -> o.ObligationOut:
    return o.ObligationOut(id=r.id, code=r.code, name=r.name, authority=r.authority, frequency=r.frequency, due_day=r.due_day,
                           due_months=r.due_months or [], lead_days=r.lead_days, notes=r.notes, archived=r.archived)


def _check_months(data: o.ObligationIn) -> List[int]:
    months = sorted(set(data.due_months))
    need = {"monthly": 0, "quarterly": 4, "half_yearly": 2, "yearly": 1}[data.frequency]
    if data.frequency == "monthly":
        return []
    if len(months) != need:
        raise Invalid(f"A {data.frequency.replace('_', '-')} obligation needs {need} due month{'s' if need != 1 else ''}")
    return months


def save_obligation(db: Session, access: Access, obligation_id: Optional[uuid.UUID], data: o.ObligationIn) -> ComplianceObligation:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can change the compliance catalogue")
    months = _check_months(data)
    clash = db.scalars(select(ComplianceObligation).where(ComplianceObligation.workspace_id == access.workspace_id,
                                                         ComplianceObligation.code == data.code)).first()
    if clash is not None and clash.id != obligation_id:
        raise Invalid(f"The code {data.code} is already used")
    if obligation_id is None:
        row = ComplianceObligation(workspace_id=access.workspace_id)
        db.add(row)
    else:
        row = db.get(ComplianceObligation, obligation_id)
        if row is None or row.workspace_id != access.workspace_id:
            raise NotFound("Obligation not found")
    row.code, row.name, row.authority, row.frequency, row.due_day = data.code, data.name, data.authority, data.frequency, data.due_day
    row.due_months, row.lead_days, row.notes, row.archived = months, data.lead_days, data.notes, data.archived
    db.flush()
    return row


# --- dates --------------------------------------------------------------------------------------------------


def _on(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def occurrences(ob: ComplianceObligation, first: date, last: date) -> List[Tuple[date, str, str]]:
    """(due date, period key, period label) for every due date in [first, last]."""
    out = []
    y, m = first.year, first.month
    while (y, m) <= (last.year, last.month):
        if ob.frequency == "monthly" or m in (ob.due_months or []):
            due = _on(y, m, ob.due_day)
            if first <= due <= last:
                if ob.frequency == "monthly":
                    py, pm = (y, m - 1) if m > 1 else (y - 1, 12)  # due this month for last month's period
                    out.append((due, f"{py}-{pm:02d}", date(py, pm, 1).strftime("%b %Y")))
                else:
                    out.append((due, f"{y}-{m:02d}", f"due {due.strftime('%d %b %Y')}"))
        y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return out


# --- clients ------------------------------------------------------------------------------------------------


def _open_list(db: Session, access: Access, list_id: uuid.UUID) -> TaskList:
    lst = db.get(TaskList, list_id)
    space = db.get(Space, lst.space_id) if lst else None
    if lst is None or space is None or space.workspace_id != access.workspace_id:
        raise NotFound("List not found")
    return lst


def client_out(db: Session, cc: ClientCompliance) -> o.ClientComplianceOut:
    lst = db.get(TaskList, cc.list_id)
    people = [db.get(User, u) for u in cc.assignee_ids]
    return o.ClientComplianceOut(id=cc.id, obligation=obligation_out(db.get(ComplianceObligation, cc.obligation_id)), list_id=cc.list_id,
                                 list_name=lst.name if lst else "", client_name=cc.client_name,
                                 assignees=[s.UserOut.model_validate(u) for u in people if u], active=cc.active)


def list_clients(db: Session, access: Access) -> List[o.ClientComplianceOut]:
    rows = list(db.scalars(select(ClientCompliance).where(ClientCompliance.workspace_id == access.workspace_id)
                           .order_by(ClientCompliance.client_name)))
    return [client_out(db, r) for r in rows if access.level(chain_for_list(db, db.get(TaskList, r.list_id))) is not None]


def add_client(db: Session, access: Access, data: o.ClientComplianceIn, today: Optional[date] = None) -> List[o.ClientComplianceOut]:
    lst = _open_list(db, access, data.list_id)
    if access.level(chain_for_list(db, lst)) != PermissionLevel.full:
        raise Forbidden("You need full access to the client's List")
    members = set(db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == access.workspace_id,
                                                                   WorkspaceMember.user_id.in_(data.assignee_ids)))) if data.assignee_ids else set()
    if set(data.assignee_ids) - members:
        raise Invalid("Everyone assigned must be in the workspace")
    catalogue = {ob.id: ob for ob in obligations(db, access)}
    added = []
    for ob_id in data.obligation_ids:
        if ob_id not in catalogue:
            raise Invalid("Unknown obligation")
        row = db.scalars(select(ClientCompliance).where(ClientCompliance.obligation_id == ob_id, ClientCompliance.list_id == lst.id)).first()
        if row is None:
            row = ClientCompliance(workspace_id=access.workspace_id, obligation_id=ob_id, list_id=lst.id, created_by=access.user_id)
            db.add(row)
        row.client_name, row.assignee_ids, row.active = data.client_name, sorted(members), True
        db.flush()
        added.append(row)
    for row in added:
        ensure_tasks(db, row, access.user_id, today)
    return [client_out(db, r) for r in added]


def remove_client(db: Session, access: Access, cc_id: uuid.UUID) -> None:
    row = db.get(ClientCompliance, cc_id)
    if row is None or row.workspace_id != access.workspace_id:
        raise NotFound("Not found")
    lst = _open_list(db, access, row.list_id)
    if access.level(chain_for_list(db, lst)) != PermissionLevel.full:
        raise Forbidden("You need full access to the client's List")
    db.delete(row)  # tasks already made stay; no new ones are made
    db.flush()


# --- making the tasks ---------------------------------------------------------------------------------------


def ensure_tasks(db: Session, cc: ClientCompliance, actor_id: Optional[str], today: Optional[date] = None) -> int:
    """Create the tasks for due dates from today to two months ahead that don't have one yet."""
    from app.services.work import tasks as task_service

    if not cc.active:
        return 0
    ob = db.get(ComplianceObligation, cc.obligation_id)
    lst = db.get(TaskList, cc.list_id)
    if ob is None or ob.archived or lst is None or lst.archived_at is not None:
        return 0
    today = today or datetime.now(TZ).date()
    space = db.get(Space, lst.space_id)
    member = db.get(WorkspaceMember, (space.workspace_id, actor_id)) if actor_id else None
    if member is None:  # the scheduler acts as whoever set the client up
        member = db.get(WorkspaceMember, (space.workspace_id, cc.created_by)) if cc.created_by else None
    if member is None:
        return 0
    access = Access(db, member.user_id, space.workspace_id, member.role)
    made = 0
    for due, key, label in occurrences(ob, today, today + HORIZON):
        if db.scalars(select(ComplianceTask).where(ComplianceTask.client_compliance_id == cc.id, ComplianceTask.period_key == key)).first():
            continue
        due_at = datetime.combine(due, time(18), TZ)
        start_at = datetime.combine(due - timedelta(days=ob.lead_days), time(9), TZ)
        notes = "\n\n".join(x for x in (ob.notes, CHECK_NOTE) if x)
        task = task_service.create_task(db, Opened(lst, access, PermissionLevel.full), s.TaskCreate(
            name=f"{ob.name} – {label} – {cc.client_name}"[:500], description=notes, start_date=min(start_at, due_at), due_date=due_at,
            assignees=[u for u in cc.assignee_ids if db.get(WorkspaceMember, (space.workspace_id, u))],
            tags=[t for t in ("compliance", ob.authority) if t], priority=2,
        ), check_assignee_access=False)
        db.add(ComplianceTask(client_compliance_id=cc.id, period_key=key, task_id=task.id))
        db.flush()
        made += 1
    return made


def run_due(db: Session, today: Optional[date] = None) -> int:
    return sum(ensure_tasks(db, cc, None, today) for cc in list(db.scalars(select(ClientCompliance).where(ClientCompliance.active.is_(True)))))


# --- the calendar ---------------------------------------------------------------------------------------------


def calendar_items(db: Session, access: Access, first: date, last: date) -> List[o.ComplianceItem]:
    if last < first or (last - first).days > 400:
        raise Invalid("Pick up to a year")
    today = datetime.now(TZ).date()
    items = []
    for cc in db.scalars(select(ClientCompliance).where(ClientCompliance.workspace_id == access.workspace_id, ClientCompliance.active.is_(True))):
        lst = db.get(TaskList, cc.list_id)
        if lst is None or access.level(chain_for_list(db, lst)) is None:
            continue
        ob = db.get(ComplianceObligation, cc.obligation_id)
        made = {ct.period_key: ct.task_id for ct in db.scalars(select(ComplianceTask).where(ComplianceTask.client_compliance_id == cc.id))}
        for due, key, label in occurrences(ob, first, last):
            task = db.get(Task, made[key]) if made.get(key) else None
            status = db.get(Status, task.status_id) if task else None
            done = bool(status and status.group in (StatusGroup.done, StatusGroup.closed))
            items.append(o.ComplianceItem(
                client_compliance_id=cc.id, client_name=cc.client_name, obligation=ob.name, authority=ob.authority, period_label=label,
                due_date=due, task_id=task.id if task else None, list_id=task.list_id if task else cc.list_id, status=status.name if status else None,
                status_group=status.group.value if status else None, done=done, overdue=not done and due < today,
            ))
    return sorted(items, key=lambda i: (i.due_date, i.client_name.lower(), i.obligation))
