"""Working hours: the company's week, a Team's, and a person's -- set by admins, read by everything."""

from datetime import date, datetime, timedelta, timezone

from tests.v2.conftest import ok

HOUR = 3600
FIVE = [8 * HOUR] * 5 + [0, 0]
SIX = [8 * HOUR] * 6 + [0]
SEVEN = [6 * HOUR] * 7


def _team(api, ws, name, members, parent=None):
    body = {"name": name, "member_ids": members}
    if parent:
        body["parent_team_id"] = parent
    return ok(api.post(f"/workspaces/{ws}/teams", "owner", body), 201)


def _people(out):
    return {p["user"]["id"]: p for p in out["people"]}


def test_team_hours_reach_members_and_a_persons_own_hours_win(api, workspace):
    ws = workspace["id"]
    accounts = _team(api, ws, "Accounts", ["member"])
    base = f"/workspaces/{ws}/working-hours"

    out = ok(api.get(base, "admin"))
    assert out["company"] == FIVE
    assert _people(out)["member"]["source"] == "company"

    out = ok(api.put(f"{base}/teams/{accounts['id']}", "admin", {"capacity_seconds": SIX}))
    member = _people(out)["member"]
    assert (member["source"], member["team_name"], member["capacity_seconds"]) == ("team", "Accounts", SIX)
    assert _people(out)["admin"]["source"] == "company"
    # Everything that reads capacity sees the Team's week, e.g. the timesheet.
    assert ok(api.get(f"/workspaces/{ws}/members/member/capacity", "member"))["capacity_seconds"] == SIX

    # A person's own hours beat their Team's; clearing them puts the Team's back.
    out = ok(api.put(f"{base}/people", "admin", {"user_ids": ["member", "guest"], "capacity_seconds": SEVEN}))
    assert [(_people(out)[u]["source"], _people(out)[u]["capacity_seconds"]) for u in ("member", "guest")] == [("person", SEVEN)] * 2
    out = ok(api.put(f"{base}/people", "admin", {"user_ids": ["member"], "capacity_seconds": None}))
    assert _people(out)["member"]["source"] == "team"

    # The company's week moves everyone still on it.
    out = ok(api.put(f"{base}/company", "admin", {"capacity_seconds": SIX}))
    assert _people(out)["admin"]["capacity_seconds"] == SIX
    # And a Team set back to null follows the company again.
    out = ok(api.put(f"{base}/teams/{accounts['id']}", "admin", {"capacity_seconds": None}))
    assert _people(out)["member"]["source"] == "company"


def test_a_sub_teams_week_is_more_specific_than_its_parents(api, workspace):
    ws = workspace["id"]
    firm = _team(api, ws, "Firm", ["admin"])
    tax = _team(api, ws, "Tax", ["member"], parent=firm["id"])
    base = f"/workspaces/{ws}/working-hours"
    ok(api.put(f"{base}/teams/{firm['id']}", "owner", {"capacity_seconds": SIX}))
    people = _people(ok(api.get(base, "owner")))
    # The parent's week reaches the sub-team's people...
    assert (people["member"]["team_name"], people["member"]["capacity_seconds"]) == ("Firm", SIX)
    # ...until the sub-team has a week of its own.
    ok(api.put(f"{base}/teams/{tax['id']}", "owner", {"capacity_seconds": SEVEN}))
    people = _people(ok(api.get(base, "owner")))
    assert (people["member"]["team_name"], people["admin"]["team_name"]) == ("Tax", "Firm")


def test_only_admins_set_or_see_working_hours(api, workspace):
    ws = workspace["id"]
    team = _team(api, ws, "Dev", ["member"])
    base = f"/workspaces/{ws}/working-hours"
    assert api.get(base, "member").status_code == 403
    assert api.put(f"{base}/teams/{team['id']}", "member", {"capacity_seconds": SIX}).status_code == 403
    assert api.put(f"{base}/people", "member", {"user_ids": ["member"], "capacity_seconds": SEVEN}).status_code == 403
    assert api.put(f"{base}/company", "member", {"capacity_seconds": SEVEN}).status_code == 403
    assert api.put(f"{base}/people", "admin", {"user_ids": ["outsider"], "capacity_seconds": SEVEN}).status_code == 404
    assert api.put(f"{base}/people", "admin", {"user_ids": ["member"], "capacity_seconds": [HOUR] * 6}).status_code == 422
    actions = [e["action"] for e in ok(api.get(f"/workspaces/{ws}/audit", "admin"))]
    assert "hours.team" not in actions  # nothing was changed, so nothing was logged


def test_workload_spreads_estimates_over_each_persons_own_days(api, workspace, space, folderless_list):
    ws = workspace["id"]
    six_day = _team(api, ws, "Field", ["member"])
    ok(api.put(f"/workspaces/{ws}/working-hours/teams/{six_day['id']}", "owner", {"capacity_seconds": SIX}))
    monday = date(2026, 9, 21)
    sunday = monday + timedelta(days=6)
    at = lambda d: datetime(d.year, d.month, d.day, tzinfo=timezone.utc).isoformat()  # noqa: E731
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {
        "name": "week of work", "assignees": ["member", "admin"], "time_estimate_seconds": 30 * HOUR,
        "start_date": at(monday), "due_date": at(sunday),
    }), 201)
    w = ok(api.get(f"/spaces/{space['id']}/workload", "owner", params={"start": monday.isoformat(), "days": 7}))
    rows = {(r["user"]["id"] if r["user"] else None): r for r in w["rows"]}
    # Six working days for the six-day Team: Saturday takes its share. Five for everyone else.
    assert rows["member"]["capacity_seconds"] == SIX
    assert rows["member"]["scheduled_seconds"] == [5 * HOUR] * 6 + [0]
    assert rows["admin"]["scheduled_seconds"] == [6 * HOUR] * 5 + [0, 0]


def test_admins_can_change_holidays(api, workspace):
    # The admin check on holidays was handed the wrong value and refused everyone.
    ws = workspace["id"]
    ok(api.post(f"/workspaces/{ws}/holidays", "admin", {"day": "2026-12-25", "name": "Christmas"}), 201)
    assert api.post(f"/workspaces/{ws}/holidays", "member", {"day": "2026-12-26", "name": "Boxing Day"}).status_code == 403
