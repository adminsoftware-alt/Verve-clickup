"""Leave (requests, approvals, balances, capacity), billing (rates, fees, profitability, invoices), v1 import, timesheet nudges."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import session as db_session
from app.services.work import leave as leave_service
from app.services.work import timesheets as ts_service
from app.services.work import v1_import
from app.services.work.access import Access
from tests.v2.conftest import ok

MON = date(2026, 10, 5)  # a Monday
HOUR = 3600


@pytest.fixture
def ws(api, workspace):
    ws = workspace["id"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    return ws


def types(api, ws, who="owner"):
    return {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/leave/types", who))}


def ask(api, ws, who, kind, start, end, **kw):
    return api.post(f"/workspaces/{ws}/leave", who, {"type_id": kind["id"], "start_date": start.isoformat(), "end_date": end.isoformat(), **kw})


# --- leave ---------------------------------------------------------------------------------------------------


def test_leave_request_goes_to_the_manager_and_counts_working_days(api, ws):
    casual = types(api, ws)["Casual"]
    assert casual["yearly_days"] == 12
    r = ok(ask(api, ws, "member", casual, MON + timedelta(days=3), MON + timedelta(days=7), reason="Family function"), 201)
    assert r["days"] == 3 and r["status"] == "pending" and r["approver"]["id"] == "admin"  # Thu, Fri, Mon: not the weekend
    inbox = ok(api.get(f"/workspaces/{ws}/inbox", "admin"))
    assert any(n["kind"] == "leave_request" for n in inbox)
    assert ok(api.get(f"/workspaces/{ws}/leave", "admin", params={"scope": "approvals"}))[0]["can_decide"] is True
    assert api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "member", {"approve": True}).status_code == 403  # not your own
    ok(api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "admin", {"approve": True, "note": "Enjoy"}))
    bal = {b["type"]["name"]: b for b in ok(api.get(f"/workspaces/{ws}/leave/balances", "member", params={"year": 2026}))}
    assert (bal["Casual"]["used"], bal["Casual"]["remaining"]) == (3, 9)
    assert any(n["kind"] == "leave_decision" for n in ok(api.get(f"/workspaces/{ws}/inbox", "member")))
    # Overlaps are refused; the reason is private to the person, their approver and admins.
    assert ask(api, ws, "member", casual, MON + timedelta(days=7), MON + timedelta(days=7)).status_code == 400
    cal = ok(api.get(f"/workspaces/{ws}/leave/calendar", "guest", params={"start": MON.isoformat(), "end": (MON + timedelta(days=14)).isoformat()}))
    assert cal["leave"][0]["user"]["id"] == "member" and cal["leave"][0]["reason"] is None


def test_allowance_half_days_holidays_and_admin_bookings(api, ws):
    t = types(api, ws)
    ok(api.post(f"/workspaces/{ws}/holidays", "owner", {"day": MON.isoformat(), "name": "Dussehra"}), 201)
    week = ok(ask(api, ws, "member", t["Sick"], MON, MON + timedelta(days=4)), 201)
    assert week["days"] == 4  # the holiday doesn't count
    half = ok(ask(api, ws, "member", t["Casual"], MON + timedelta(days=14), MON + timedelta(days=14), part="first_half"), 201)
    assert half["days"] == 0.5
    assert ask(api, ws, "member", t["Casual"], MON + timedelta(days=35), MON + timedelta(days=36), part="first_half").status_code == 400
    assert ask(api, ws, "member", t["Casual"], MON + timedelta(days=5), MON + timedelta(days=6)).status_code == 400  # a weekend
    assert ask(api, ws, "member", t["Earned"], MON + timedelta(days=21), MON + timedelta(days=60)).status_code == 400  # over 15 days
    booked = ok(ask(api, ws, "admin", t["Casual"], MON + timedelta(days=28), MON + timedelta(days=28), user_id="member"), 201)
    assert booked["status"] == "approved"  # an admin recording it decides it
    assert ask(api, ws, "member", t["Casual"], MON, MON, user_id="admin").status_code == 403
    # Removing the holiday recounts the week.
    hid = ok(api.get(f"/workspaces/{ws}/holidays", "owner"))[0]["id"]
    ok(api.delete(f"/workspaces/{ws}/holidays/{hid}", "owner"), 204)
    mine = {r["id"]: r for r in ok(api.get(f"/workspaces/{ws}/leave", "member"))}
    assert mine[week["id"]]["days"] == 5
    assert ok(api.post(f"/workspaces/{ws}/leave/{half['id']}/cancel", "member"))["status"] == "cancelled"
    assert {r["id"]: r for r in ok(api.get(f"/workspaces/{ws}/leave", "member"))}[half["id"]]["status"] == "cancelled"


def test_leave_and_holidays_take_away_capacity(api, ws):
    t = types(api, ws)
    ok(api.post(f"/workspaces/{ws}/holidays", "owner", {"day": (MON + timedelta(days=2)).isoformat(), "name": "Gandhi Jayanti"}), 201)
    r = ok(ask(api, ws, "member", t["Casual"], MON, MON), 201)
    ok(api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "admin", {"approve": True}))
    ok(ask(api, ws, "member", t["Casual"], MON + timedelta(days=1), MON + timedelta(days=1), part="second_half"), 201)  # pending: no effect yet
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    load = ok(api.get(f"/lists/{lst['id']}/workload", "owner", params={"start": MON.isoformat(), "days": 5}))
    member = next(r for r in load["rows"] if r["user"] and r["user"]["id"] == "member")
    assert member["capacity_seconds"] == [0, 8 * HOUR, 0, 8 * HOUR, 8 * HOUR]
    sheet = ok(api.get(f"/workspaces/{ws}/timesheet", "member", params={"start": MON.isoformat()}))
    assert sheet["capacity_per_day"][sheet["days"].index(MON.isoformat())] == 0


def test_import_leave_from_the_old_app(api, ws):
    with db_session.new_session() as db:
        from app.db.models import WorkspaceMember, WorkspaceRole
        import uuid as _uuid

        access = Access(db, "owner", _uuid.UUID(ws), WorkspaceRole.owner)
        records = [
            {"id": "a1", "userId": "member", "leaveType": "Vacation", "startDate": "2026-10-05", "endDate": "2026-10-06", "status": "Approved", "reason": "Trip"},
            {"id": "a2", "userId": "nobody", "leaveType": "Sick", "startDate": "2026-10-05", "endDate": "2026-10-05", "status": "Pending"},
        ]
        assert leave_service.import_v1(db, access, records) == {"imported": 1, "skipped": 0, "unknown_person": 1}
        assert leave_service.import_v1(db, access, records)["skipped"] == 1  # not twice
        db.commit()
    mine = ok(api.get(f"/workspaces/{ws}/leave", "member"))
    assert mine[0]["type"]["name"] == "Earned" and mine[0]["status"] == "approved" and mine[0]["days"] == 2


# --- billing -----------------------------------------------------------------------------------------------------


@pytest.fixture
def client_work(api, ws):
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Clients"}), 201)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Acme Ltd"}), 201)
    lst = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Audit FY26"}), 201)
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Vouching", "assignees": ["member", "admin"]}), 201)
    at = datetime(2026, 10, 6, 5, 0, tzinfo=timezone.utc)
    for who, hours, billable in (("member", 10, True), ("admin", 4, True), ("member", 2, False)):
        ok(api.post(f"/tasks/{task['id']}/time", who, {"started_at": at.isoformat(), "duration_seconds": hours * HOUR, "billable": billable}), 201)
    return {"space": space, "folder": folder, "list": lst, "task": task}


def test_rates_fees_profitability_and_invoice(api, ws, client_work):
    ok(api.post(f"/workspaces/{ws}/billing/rates", "owner", {"user_id": "member", "hourly_rate": 1000}))
    ok(api.post(f"/workspaces/{ws}/billing/rates", "owner", {"location_kind": "folder", "location_id": client_work["folder"]["id"], "hourly_rate": 2500}))
    ok(api.post(f"/workspaces/{ws}/billing/rates", "owner", {"user_id": "member", "hourly_rate": 1500}))  # replaces the default
    assert len(ok(api.get(f"/workspaces/{ws}/billing/rates", "owner"))) == 2
    ok(api.put(f"/workspaces/{ws}/billing/fees/folder/{client_work['folder']['id']}", "owner",
               {"fee": {"amount": 62000, "period": "monthly", "client_name": "Acme Ltd"}}))
    report = ok(api.get(f"/workspaces/{ws}/billing/profitability", "owner", params={"start": "2026-10-01", "end": "2026-10-31"}))
    row = report["rows"][0]
    # Everyone's time on Acme is worth 2,500/h (the Folder's rate beats member's own 1,500): 14 billable hours.
    assert (row["billable_seconds"], row["non_billable_seconds"], row["value"], row["fee"]) == (14 * HOUR, 2 * HOUR, 35000, 62000)
    assert row["margin"] == 27000 and row["realisation"] == pytest.approx(177.1, 0.1)
    half = ok(api.get(f"/workspaces/{ws}/billing/profitability", "owner", params={"start": "2026-10-01", "end": "2026-10-15"}))
    assert half["rows"][0]["fee"] == 30000  # 15 of 31 days of the retainer
    inv = ok(api.get(f"/workspaces/{ws}/billing/invoice", "owner", params={
        "kind": "folder", "location_id": client_work["folder"]["id"], "start": "2026-10-01", "end": "2026-10-31"}))
    assert inv["total"] == 35000 and len(inv["lines"]) == 2 and inv["client_name"] == "Acme Ltd"
    assert api.get(f"/workspaces/{ws}/billing/rates", "member").status_code == 403


def test_unpriced_time_is_reported(api, ws, client_work):
    report = ok(api.get(f"/workspaces/{ws}/billing/profitability", "owner", params={
        "start": "2026-10-01", "end": "2026-10-31", "kind": "list", "location_id": client_work["list"]["id"]}))
    assert report["rows"][0]["unpriced_seconds"] == 14 * HOUR and report["rows"][0]["fee"] is None


# --- v1 import, timesheet nudges --------------------------------------------------------------------------------


def test_import_tasks_and_hours_from_the_old_app(api, ws):
    import uuid as _uuid

    from app.db.models import WorkspaceRole

    tasks = [
        {"id": "t1", "title": "Prepare MIS", "assignees": ["member"], "estimatedHours": 5, "startDate": "2026-09-01",
         "dueDate": "2026-09-03", "status": "Completed", "priority": "High", "completedDate": "2026-09-03"},
        {"id": "t2", "title": "Bank reconciliation", "assignedUserId": "member", "estimatedHours": 2, "startDate": "2026-09-04",
         "dueDate": "2026-09-05", "status": "Todo", "priority": "Low"},
    ]
    entries = [{"id": "e1", "task_id": "t1", "owner_id": "member", "date": "2026-09-02", "hours_worked": 3.5, "notes": "Draft"},
               {"id": "e2", "task_id": "missing", "owner_id": "member", "date": "2026-09-02", "hours_worked": 1}]
    with db_session.new_session() as db:
        access = Access(db, "owner", _uuid.UUID(ws), WorkspaceRole.owner)
        counts = v1_import.import_work(db, access, tasks, entries)
        assert (counts["tasks"], counts["entries"], counts["entries_skipped"]) == (2, 1, 1)
        again = v1_import.import_work(db, access, tasks, entries)
        assert (again["tasks"], again["tasks_skipped"], again["entries"]) == (0, 2, 0)
        db.commit()
    tree = ok(api.get(f"/workspaces/{ws}/hierarchy", "owner"))
    space = next(sp for sp in tree["spaces"] if sp["name"] == "Imported from old Timetriq")
    lst = space["lists"][0]
    got = {t["name"]: t for t in ok(api.get(f"/lists/{lst['id']}/tasks", "owner", params={"include_closed": True}))["tasks"]}
    assert got["Prepare MIS"]["status"]["group"] == "closed" and got["Prepare MIS"]["priority"] == 2
    assert got["Prepare MIS"]["time_estimate_seconds"] == 5 * HOUR and got["Prepare MIS"]["time_tracked_seconds"] == int(3.5 * HOUR)


def test_timesheet_reminder_and_fill_from_planner(api, ws):
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Run payroll", "assignees": ["member"]}), 201)
    start = datetime(2026, 9, 21, 4, 0, tzinfo=timezone.utc)  # a Monday, 09:30 in India
    ok(api.post(f"/workspaces/{ws}/time-blocks", "member", {"task_id": task["id"], "start_at": start.isoformat(),
                                                           "end_at": (start + timedelta(hours=2)).isoformat()}), 201)
    out = ok(api.post(f"/workspaces/{ws}/timesheet/prefill", "member", params={"day": "2026-09-21", "tz": "Asia/Kolkata"}))
    assert out == {"entries": 1, "seconds": 2 * HOUR}
    assert ok(api.post(f"/workspaces/{ws}/timesheet/prefill", "member", params={"day": "2026-09-21", "tz": "Asia/Kolkata"}))["entries"] == 0
    friday_5pm = datetime(2026, 9, 25, 11, 30, tzinfo=timezone.utc)  # 17:00 in India
    with db_session.new_session() as db:
        sent = ts_service.run_timesheet_reminders(db, friday_5pm)
        again = ts_service.run_timesheet_reminders(db, friday_5pm)
        db.commit()
    assert sent >= 1 and again == 0
    nudges = [n for n in ok(api.get(f"/workspaces/{ws}/inbox", "member")) if n["kind"] == "timesheet_reminder"]
    assert nudges and nudges[0]["data"]["tracked"] == 2 * HOUR
