"""The leave workflow: the firm's policy, the chain from person to manager to HR, and the balance.

Dates here are computed from today rather than written down. A fixed Monday drifts into the past
as the weeks go by, and a rule about notice periods then fails for a reason that has nothing to do
with notice periods.
"""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.db import session as db_session
from app.db.models import LeaveRequest
from app.services.work import leave as leave_service
from tests.v2.conftest import ok

TODAY = date.today()


def coming(weekday: int, at_least: int = 1) -> date:
    """The next given weekday (0 = Monday) at least `at_least` days from today."""
    day = TODAY + timedelta(days=at_least)
    while day.weekday() != weekday:
        day += timedelta(days=1)
    return day


def gone(at_least: int = 1) -> date:
    """A working day in the past. A Saturday would be refused for being a Saturday."""
    day = TODAY - timedelta(days=at_least)
    while day.weekday() > 4:
        day -= timedelta(days=1)
    return day


@pytest.fixture
def ws(api, workspace):
    """A workspace where member reports to admin, and member2 is an ordinary member."""
    ws = workspace["id"]
    ok(api.get("/workspaces", "member2"))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": "member2@example.com", "role": "member"}), 201)
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    return ws


@pytest.fixture
def hr(api, ws):
    """member2 is HR: a plain member whose say over leave comes from the team, not from a role."""
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["member2"]}), 201)
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"hr_team_id": team["id"]}))
    return team


def types(api, ws, who="owner"):
    return {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/leave/types", who))}


def ask(api, ws, who, kind, start, end, **kw):
    body = {"type_id": kind["id"], "start_date": start.isoformat(), "end_date": end.isoformat(), **kw}
    return api.post(f"/workspaces/{ws}/leave", who, body)


def balance(api, ws, who, name, **params):
    rows = ok(api.get(f"/workspaces/{ws}/leave/balances", who, params=params))
    return next(b for b in rows if b["type"]["name"] == name)


# --- the policy -------------------------------------------------------------------------------------


def test_the_leave_policy_is_the_firms_and_only_an_admin_changes_it(api, ws):
    out = ok(api.get(f"/workspaces/{ws}/leave/policy", "member"))
    # The defaults suit an Indian firm: an April year, and nothing else assumed.
    assert out["year_start_month"] == 4 and out["carry_forward_days"] is None
    assert out["min_notice_days"] == 0 and out["allow_backdated"] is True
    assert out["count_days_off_inside"] is False and out["blackout"] == []

    assert api.put(f"/workspaces/{ws}/leave/policy", "member", {"year_start_month": 1}).status_code == 403
    saved = ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {
        "year_start_month": 4, "carry_forward_days": 5, "prorate_joiners": True, "min_notice_days": 7,
        "allow_backdated": False, "count_days_off_inside": True, "escalate_after_days": 2,
        "blackout": [{"from": "09-15", "to": "09-30", "reason": "Audit season"}],
    }))
    assert saved["min_notice_days"] == 7 and saved["escalate_after_days"] == 2
    assert saved["blackout"] == [{"from": "09-15", "to": "09-30", "reason": "Audit season"}]
    # It survives the round trip, including the field named "from".
    assert ok(api.get(f"/workspaces/{ws}/leave/policy", "guest"))["blackout"][0]["from"] == "09-15"
    assert api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 13}).status_code == 422


def test_naming_an_hr_team_puts_them_in_the_chain(api, ws, hr):
    out = ok(api.get(f"/workspaces/{ws}/leave/policy", "member"))
    assert out["hr_team_id"] == hr["id"] and out["hr_team_name"] == "HR"
    # HR is a plain member, and still sees everyone's leave.
    assert ok(api.get(f"/workspaces/{ws}/leave", "member2", params={"scope": "all"})) == []
    assert api.get(f"/workspaces/{ws}/leave", "member", params={"scope": "all"}).status_code == 403


# --- the leave year, carry-forward and adjustments ----------------------------------------------------


def test_a_balance_runs_on_the_firms_leave_year(api, ws):
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4}))
    b = balance(api, ws, "member", "Casual", year=2026)
    assert (b["year_start"], b["year_end"]) == ("2026-04-01", "2027-03-31")
    assert b["earned"] == 12 and b["carried_forward"] == 0 and b["allowance"] == 12
    # A calendar year is a setting, not a law.
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 1}))
    b = balance(api, ws, "member", "Casual", year=2026)
    assert (b["year_start"], b["year_end"]) == ("2026-01-01", "2026-12-31")
    # Asking without a year gets the leave year we are in now.
    assert balance(api, ws, "member", "Casual")["year"] in (TODAY.year, TODAY.year - 1)


def test_unused_days_carry_over_up_to_the_cap(api, ws):
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "carry_forward_days": 5, "allow_backdated": True}))
    casual = types(api, ws)["Casual"]
    # An admin recording someone's past leave is doing paperwork, so the notice rules are not theirs.
    last_year = ok(ask(api, ws, "admin", casual, date(2025, 6, 2), date(2025, 6, 6), user_id="member"), 201)
    assert last_year["days"] == 5 and last_year["status"] == "approved"
    assert balance(api, ws, "member", "Casual", year=2025)["used"] == 5

    carried = balance(api, ws, "member", "Casual", year=2026)
    # 12 earned last year, 5 taken, 7 spare -- but the cap is 5.
    assert carried["carried_forward"] == 5 and carried["earned"] == 12 and carried["allowance"] == 17

    # Raise the cap and the whole 7 comes over; turn it off and nothing does.
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "carry_forward_days": 20, "allow_backdated": True}))
    assert balance(api, ws, "member", "Casual", year=2026)["carried_forward"] == 7
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "allow_backdated": True}))
    assert balance(api, ws, "member", "Casual", year=2026)["carried_forward"] == 0


def test_a_mid_year_joiner_earns_the_months_they_are_here(api, ws):
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "prorate_joiners": True}))
    # Joined 1 October: six of the twelve months of an April year, so half of 12.
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"date_of_joining": "2026-10-01"}))
    assert balance(api, ws, "member", "Casual", year=2026)["earned"] == 6
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "prorate_joiners": False}))
    assert balance(api, ws, "member", "Casual", year=2026)["earned"] == 12


def test_hr_can_grant_or_take_back_days(api, ws, hr):
    casual = types(api, ws)["Casual"]
    body = {"user_id": "member", "type_id": casual["id"], "year": 2026, "days": 3, "reason": "Comp-off for audit weekend"}
    assert api.put(f"/workspaces/{ws}/leave/adjustments", "member", body).status_code == 403
    rows = ok(api.put(f"/workspaces/{ws}/leave/adjustments", "member2", body))  # HR, not an admin
    assert [(r["days"], r["reason"]) for r in rows] == [(3, "Comp-off for audit weekend")]
    b = balance(api, ws, "member", "Casual", year=2026)
    assert b["adjusted"] == 3 and b["allowance"] == 15 and b["remaining"] == 15

    # Saving again replaces rather than stacks, and zero removes it.
    ok(api.put(f"/workspaces/{ws}/leave/adjustments", "member2", {**body, "days": -2}))
    assert balance(api, ws, "member", "Casual", year=2026)["allowance"] == 10
    assert ok(api.put(f"/workspaces/{ws}/leave/adjustments", "member2", {**body, "days": 0})) == []
    assert balance(api, ws, "member", "Casual", year=2026)["allowance"] == 12
    assert ok(api.get(f"/workspaces/{ws}/leave/adjustments", "member", params={"year": 2026})) == []


# --- what a request has to satisfy -------------------------------------------------------------------


def test_notice_periods_closed_seasons_and_the_past(api, ws):
    shut = coming(2, 170)  # a Wednesday about half a year out
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {
        "min_notice_days": 7, "allow_backdated": False,
        "blackout": [{"from": shut.strftime("%m-%d"), "to": shut.strftime("%m-%d"), "reason": "Audit season"}],
    }))
    casual = types(api, ws)["Casual"]

    tomorrow = coming(0, 1) if (TODAY + timedelta(days=1)).weekday() > 4 else TODAY + timedelta(days=1)
    short = ask(api, ws, "member", casual, tomorrow, tomorrow)
    assert short.status_code == 400 and "7 days' notice" in short.text

    far = coming(1, 14)  # a Tuesday a fortnight out: enough notice, and not the closed day
    assert ok(ask(api, ws, "member", casual, far, far), 201)["days"] == 1

    past = gone(10)
    refused = ask(api, ws, "member", casual, past, past)
    assert refused.status_code == 400 and "in the past" in refused.text
    # An admin recording it afterwards is the way round that, and is meant to be.
    assert ok(ask(api, ws, "admin", casual, past, past, user_id="member"), 201)["status"] == "approved"

    closed = ask(api, ws, "member", casual, shut, shut)
    assert closed.status_code == 400 and "Audit season" in closed.text
    assert ok(ask(api, ws, "admin", casual, shut, shut, user_id="member"), 201)["days"] == 1

    # A typo in a year is not a ten-year sabbatical.
    assert ask(api, ws, "member", casual, far, far + timedelta(days=400)).status_code == 422


def test_leave_cannot_straddle_the_end_of_the_leave_year(api, ws):
    """Otherwise the same days are charged to two years at once."""
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"year_start_month": 4, "allow_backdated": True}))
    casual = types(api, ws)["Casual"]
    across = ask(api, ws, "admin", casual, date(2027, 3, 29), date(2027, 4, 2), user_id="member")
    assert across.status_code == 400 and "2027-03-31" in across.text
    # Either half on its own is fine, and each lands in its own year.
    ok(ask(api, ws, "admin", casual, date(2027, 3, 29), date(2027, 3, 31), user_id="member"), 201)
    ok(ask(api, ws, "admin", casual, date(2027, 4, 1), date(2027, 4, 2), user_id="member"), 201)
    assert balance(api, ws, "member", "Casual", year=2026)["used"] == 3
    assert balance(api, ws, "member", "Casual", year=2027)["used"] == 2


def test_the_sandwich_rule_counts_the_weekend_in_the_middle(api, ws):
    friday, monday = coming(4, 10), coming(0, 13)
    assert monday == friday + timedelta(days=3)
    casual = types(api, ws)["Casual"]

    off = ok(ask(api, ws, "member", casual, friday, monday), 201)
    assert off["days"] == 2  # by default the weekend between them is free
    ok(api.post(f"/workspaces/{ws}/leave/{off['id']}/cancel", "member"))

    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"count_days_off_inside": True}))
    on = ok(ask(api, ws, "member", casual, friday, monday), 201)
    assert on["days"] == 4  # Friday, Saturday, Sunday, Monday
    # A weekend at either end is still never charged -- only Friday is asked for here.
    ok(api.post(f"/workspaces/{ws}/leave/{on['id']}/cancel", "member"))
    assert ok(ask(api, ws, "member", casual, friday, friday + timedelta(days=2)), 201)["days"] == 1

    # Turning the rule on re-prices what is already in flight, so no two screens disagree.
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"count_days_off_inside": False}))
    mine = ok(api.get(f"/workspaces/{ws}/leave", "member"))
    assert all(r["days"] == 1 for r in mine if r["status"] == "pending")


# --- the chain: person, manager, HR ------------------------------------------------------------------


def test_hr_decides_when_the_manager_is_away(api, ws, hr):
    casual = types(api, ws)["Casual"]
    span_start, span_end = coming(0, 20), coming(4, 24)
    # The manager (admin) is away for those very days.
    ok(ask(api, ws, "owner", casual, span_start, span_end, user_id="admin"), 201)

    r = ok(ask(api, ws, "member", casual, span_start, span_start), 201)
    assert r["approver"]["id"] == "member2", "a request should not wait in the inbox of someone on leave"
    assert any(n["kind"] == "leave_request" for n in ok(api.get(f"/workspaces/{ws}/inbox", "member2")))
    # HR decides it, though HR is only a member.
    waiting = ok(api.get(f"/workspaces/{ws}/leave", "member2", params={"scope": "approvals"}))
    assert [(x["id"], x["can_decide"]) for x in waiting] == [(r["id"], True)]
    assert ok(api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "member2", {"approve": True}))["status"] == "approved"

    # When the manager is there, it is still theirs to decide.
    later = coming(0, 60)
    assert ok(ask(api, ws, "member", casual, later, later), 201)["approver"]["id"] == "admin"


def test_hr_is_told_about_a_request_nobody_has_decided(api, ws, hr):
    ok(api.put(f"/workspaces/{ws}/leave/policy", "owner", {"hr_team_id": hr["id"], "escalate_after_days": 2}))
    casual = types(api, ws)["Casual"]
    day = coming(2, 30)
    r = ok(ask(api, ws, "member", casual, day, day), 201)

    with db_session.new_session() as db:
        assert leave_service.run_escalations(db) == 0, "nothing has waited yet"
        row = db.get(LeaveRequest, r["id"])
        row.created_at = datetime.now(timezone.utc) - timedelta(days=3)
        db.commit()
        assert leave_service.run_escalations(db) == 1
        db.commit()
        assert leave_service.run_escalations(db) == 0, "HR should not be told twice"
        db.commit()

    chased = [n for n in ok(api.get(f"/workspaces/{ws}/inbox", "member2")) if n["kind"] == "leave_escalated"]
    assert len(chased) == 1 and chased[0]["data"]["waited_days"] == 3
    assert ok(api.get(f"/workspaces/{ws}/leave", "member2", params={"scope": "all"}))[0]["escalated_at"] is not None
    assert ok(api.get(f"/workspaces/{ws}/leave", "member"))[0]["waiting_days"] == 3


# --- cover and clashes --------------------------------------------------------------------------------


def test_the_approver_sees_what_is_due_in_those_days(api, ws, folderless_list):
    casual = types(api, ws)["Casual"]
    day = coming(2, 20)
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {
        "name": "GSTR-3B for Sharma & Co", "assignees": ["member"], "priority": 1,
        "due_date": datetime.combine(day, datetime.min.time()).isoformat(),
    }), 201)
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "No date on this one", "assignees": ["member"]}), 201)

    r = ok(ask(api, ws, "member", casual, day, day), 201)
    clashes = ok(api.get(f"/workspaces/{ws}/leave/clashes", "admin", params={
        "user_id": "member", "start": day.isoformat(), "end": day.isoformat()}))
    assert [(t["name"], t["priority"]) for t in clashes["tasks"]] == [("GSTR-3B for Sharma & Co", 1)]
    assert clashes["tasks"][0]["id"] == task["id"]
    # Somebody unconnected cannot go looking.
    assert api.get(f"/workspaces/{ws}/leave/clashes", "member2", params={
        "user_id": "member", "start": day.isoformat(), "end": day.isoformat()}).status_code == 403
    assert r["cover"] is None


def test_approving_names_who_covers_and_tells_them(api, ws):
    casual = types(api, ws)["Casual"]
    day = coming(3, 20)
    r = ok(ask(api, ws, "member", casual, day, day), 201)

    assert api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "admin",
                    {"approve": True, "cover_id": "member"}).status_code == 400  # not their own cover
    assert api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "admin",
                    {"approve": True, "cover_id": "nobody"}).status_code == 400
    done = ok(api.post(f"/workspaces/{ws}/leave/{r['id']}/decision", "admin", {"approve": True, "cover_id": "member2"}))
    assert done["cover"]["id"] == "member2" and done["status"] == "approved"

    told = [n for n in ok(api.get(f"/workspaces/{ws}/inbox", "member2")) if n["kind"] == "leave_cover"]
    assert len(told) == 1 and told[0]["data"]["days"] == 1


def test_hr_and_admins_read_a_reason_and_the_office_does_not(api, ws, hr):
    casual = types(api, ws)["Casual"]
    day = coming(1, 20)
    ok(ask(api, ws, "member", casual, day, day, reason="Hospital appointment"), 201)
    assert ok(api.get(f"/workspaces/{ws}/leave", "member2", params={"scope": "all"}))[0]["reason"] == "Hospital appointment"
    seen_by_office = ok(api.get(f"/workspaces/{ws}/leave/calendar", "guest", params={
        "start": day.isoformat(), "end": day.isoformat()}))
    assert seen_by_office["leave"][0]["reason"] is None
