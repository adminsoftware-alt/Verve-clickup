from datetime import date, datetime, timedelta, timezone

import pytest

from tests.v2.conftest import ok

HOUR = 3600
SUNDAY = date(2026, 9, 6)  # the default week starts on Sunday
MONDAY = SUNDAY + timedelta(days=1)


@pytest.fixture
def org(api, workspace):
    """Adds 'lead' and 'member2'; Team HR = {lead (lead), member}; a List with two tasks."""
    ws = workspace["id"]
    for uid in ("lead", "member2"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    a = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Salary sheet"}), 201)
    b = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "GST return"}), 201)
    return {"ws": ws, "team": team, "list": lst, "a": a, "b": b}


def log(api, task, who, day, hours, hour=10, **extra):
    start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
    return ok(api.post(f"/tasks/{task['id']}/time", who, {
        "started_at": start.isoformat(), "ended_at": (start + timedelta(hours=hours)).isoformat(), **extra}), 201)


def sheet(api, org, who, user_id=None, day=MONDAY, **params):
    query = {"start": day.isoformat(), "tz": "UTC", **params}
    if user_id:
        query["user_id"] = user_id
    return ok(api.get(f"/workspaces/{org['ws']}/timesheet", who, params=query))


def cell(api, org, who, task, day, hours, user_id=None):
    body = {"task_id": task["id"], "day": day.isoformat(), "seconds": int(hours * HOUR), "tz": "UTC"}
    if user_id:
        body["user_id"] = user_id
    return api.put(f"/workspaces/{org['ws']}/timesheet/cell", who, body)


# --- the grid ----------------------------------------------------------------------------


def test_grid_groups_time_by_task_and_day(api, org):
    log(api, org["a"], "member", MONDAY, 2)
    log(api, org["a"], "member", MONDAY, 1, hour=14)
    log(api, org["b"], "member", SUNDAY + timedelta(days=3), 1.5)
    log(api, org["a"], "member", SUNDAY + timedelta(days=8), 5)  # next week
    out = sheet(api, org, "member")
    assert out["period_start"] == "2026-09-06" and out["period_end"] == "2026-09-12"
    rows = {r["task"]["name"]: r for r in out["rows"]}
    assert rows["Salary sheet"]["seconds_per_day"] == [0, 3 * HOUR, 0, 0, 0, 0, 0]
    assert rows["GST return"]["total_seconds"] == int(1.5 * HOUR)
    assert rows["Salary sheet"]["task"]["location"] == "Ops / Payroll"
    assert out["tracked_per_day"][1] == 3 * HOUR and out["total_seconds"] == int(4.5 * HOUR)
    # Sunday and Saturday have no capacity; weekdays 8h.
    assert out["capacity_per_day"] == [0] + [8 * HOUR] * 5 + [0]


def test_typing_a_higher_total_adds_an_entry_for_the_difference(api, org):
    log(api, org["a"], "member", MONDAY, 1)
    assert cell(api, org, "member", org["a"], MONDAY, 3).status_code == 204
    row = sheet(api, org, "member")["rows"][0]
    assert row["seconds_per_day"][1] == 3 * HOUR
    assert sorted(e["duration_seconds"] for e in row["entries"]) == [HOUR, 2 * HOUR]


def test_typing_a_lower_total_trims_the_newest_entries(api, org):
    log(api, org["a"], "member", MONDAY, 2, hour=8)
    log(api, org["a"], "member", MONDAY, 1, hour=13)
    cell(api, org, "member", org["a"], MONDAY, 1.5)
    row = sheet(api, org, "member")["rows"][0]
    assert [e["duration_seconds"] for e in row["entries"]] == [int(1.5 * HOUR)]  # the 1h entry went, the 2h shrank
    cell(api, org, "member", org["a"], MONDAY, 0)
    assert sheet(api, org, "member")["rows"] == []


def test_added_rows_stay_at_zero_and_delete_row_clears_the_week(api, org):
    ok(api.post(f"/workspaces/{org['ws']}/timesheet/rows", "member", {"task_id": org["b"]["id"], "start": MONDAY.isoformat()}), 204)
    rows = sheet(api, org, "member")["rows"]
    assert [(r["task"]["name"], r["total_seconds"]) for r in rows] == [("GST return", 0)]
    assert sheet(api, org, "member", day=MONDAY + timedelta(days=7))["rows"] == []  # only that week
    log(api, org["b"], "member", MONDAY, 2)
    ok(api.post(f"/workspaces/{org['ws']}/timesheet/rows/delete", "member", {"task_id": org["b"]["id"], "start": MONDAY.isoformat(), "tz": "UTC"}), 204)
    assert sheet(api, org, "member")["rows"] == []


def test_filters_billable_tags_archived_and_tracked(api, org):
    tag = ok(api.post(f"/workspaces/{org['ws']}/time-tags", "member", {"name": "Client call"}), 201)
    log(api, org["a"], "member", MONDAY, 2, billable=True, tag_ids=[tag["id"]])
    log(api, org["b"], "member", MONDAY, 1)
    names = lambda **p: sorted(r["task"]["name"] for r in sheet(api, org, "member", **p)["rows"])
    assert names(billable="billable") == ["Salary sheet"]
    assert names(billable="non_billable") == ["GST return"]
    assert names(tag_ids=[tag["id"]]) == ["Salary sheet"]
    assert names(tracked_op="gt", tracked_seconds=int(1.5 * HOUR)) == ["Salary sheet"]
    ok(api.patch(f"/tasks/{org['b']['id']}", "owner", {"archived": True}))
    assert names() == ["Salary sheet"]
    assert names(include_archived=True) == ["GST return", "Salary sheet"]
    assert sheet(api, org, "member")["billable_per_day"][1] == 2 * HOUR


def test_sort_by_name_and_reverse(api, org):
    log(api, org["a"], "member", MONDAY, 1)
    log(api, org["b"], "member", MONDAY, 1)
    by_name = [r["task"]["name"] for r in sheet(api, org, "member", sort="name")["rows"]]
    assert by_name == ["GST return", "Salary sheet"]
    assert [r["task"]["name"] for r in sheet(api, org, "member", sort="name", descending=True)["rows"]] == by_name[::-1]


# --- who sees and edits whose timesheet ------------------------------------------------------------


def test_timesheet_visibility_follows_time_visibility(api, org):
    log(api, org["a"], "member", MONDAY, 1)
    assert api.get(f"/workspaces/{org['ws']}/timesheet", "member2", params={"start": MONDAY.isoformat(), "user_id": "member"}).status_code == 404
    assert sheet(api, org, "lead", user_id="member")["total_seconds"] == HOUR
    assert sheet(api, org, "admin", user_id="member")["total_seconds"] == HOUR
    # Admins change anyone's time; a Team lead changes the time of the people they lead.
    assert sheet(api, org, "lead", user_id="member")["can_edit"] is True
    assert cell(api, org, "lead", org["a"], MONDAY, 2, user_id="member").status_code == 204
    assert cell(api, org, "admin", org["a"], MONDAY, 2.5, user_id="member").status_code == 204
    assert sheet(api, org, "member")["total_seconds"] == int(2.5 * HOUR)
    # Not someone outside their Teams.
    log(api, org["a"], "member2", MONDAY, 1)
    assert cell(api, org, "lead", org["a"], MONDAY, 2, user_id="member2").status_code == 404


def inbox(api, org, who):
    return ok(api.get(f"/workspaces/{org['ws']}/inbox", who, params={"tab": "primary"}))


def test_a_team_lead_fixes_a_team_members_time_and_the_member_is_told(api, org):
    entry = log(api, org["a"], "member", MONDAY, 3)
    # Through the time entry itself: change it, then delete it.
    changed = ok(api.patch(f"/time/{entry['id']}", "lead", {"duration_seconds": 2 * HOUR}))
    assert changed["duration_seconds"] == 2 * HOUR
    told = [n for n in inbox(api, org, "member") if n["kind"] == "time_changed"]
    assert len(told) == 1 and told[0]["data"]["before"] == 3 * HOUR and told[0]["data"]["seconds"] == 2 * HOUR
    assert told[0]["actor"]["id"] == "lead"
    ok(api.delete(f"/time/{entry['id']}", "lead"), 204)
    assert sheet(api, org, "member")["total_seconds"] == 0
    # The lead may also log time for them...
    log(api, org["b"], "lead", MONDAY, 1, user_id="member")
    assert sheet(api, org, "member")["total_seconds"] == HOUR
    actions = sorted(n["data"]["action"] for n in inbox(api, org, "member") if n["kind"] == "time_changed")
    assert actions == ["changed", "deleted", "logged"]
    # ...and their own changes to their own time tell nobody.
    assert not [n for n in inbox(api, org, "lead") if n["kind"] == "time_changed"]
    # Each change is kept in the audit log.
    actions = {r["action"] for r in ok(api.get(f"/workspaces/{org['ws']}/audit", "owner"))}
    assert {"time.changed", "time.deleted", "time.logged"} <= actions


def test_a_team_lead_cannot_touch_time_outside_their_teams(api, org):
    entry = log(api, org["a"], "member2", MONDAY, 1)
    assert api.patch(f"/time/{entry['id']}", "lead", {"duration_seconds": HOUR // 2}).status_code == 404
    assert api.delete(f"/time/{entry['id']}", "lead").status_code == 404
    start = datetime(MONDAY.year, MONDAY.month, MONDAY.day, 10, tzinfo=timezone.utc)
    body = {"started_at": start.isoformat(), "ended_at": (start + timedelta(hours=1)).isoformat(), "user_id": "member2"}
    assert api.post(f"/tasks/{org['a']['id']}/time", "lead", body).status_code == 403
    # A plain member cannot change a colleague's time either.
    mine = log(api, org["a"], "member", MONDAY, 1)
    assert api.patch(f"/time/{mine['id']}", "member2", {"duration_seconds": 60}).status_code == 404


def test_all_timesheets_for_leads_and_admins_only(api, org):
    log(api, org["a"], "member", MONDAY, 1)
    log(api, org["a"], "member2", MONDAY, 2)
    url = f"/workspaces/{org['ws']}/timesheets"
    params = {"start": MONDAY.isoformat(), "tz": "UTC"}
    assert api.get(url, "member", params=params).status_code == 403
    lead_view = {p["user"]["id"]: p["total_seconds"] for p in ok(api.get(url, "lead", params=params))["people"]}
    assert lead_view == {"lead": 0, "member": HOUR}
    admin_view = {p["user"]["id"]: p["total_seconds"] for p in ok(api.get(url, "admin", params=params))["people"]}
    assert admin_view["member2"] == 2 * HOUR and "guest" not in admin_view
    team_view = ok(api.get(url, "admin", params={**params, "team_id": org["team"]["id"]}))["people"]
    assert sorted(p["user"]["id"] for p in team_view) == ["lead", "member"]


# --- settings, capacity and tags -----------------------------------------------------------------------


def test_week_start_and_capacity_settings(api, org):
    url = f"/workspaces/{org['ws']}/timesheet-settings"
    assert api.patch(url, "member", {"week_start": 0}).status_code == 403
    ok(api.patch(url, "admin", {"week_start": 0}))
    assert sheet(api, org, "member", day=SUNDAY)["period_start"] == "2026-08-31"  # Monday weeks now
    # Working hours are what every "are they over" figure is measured against, so they are set
    # for people rather than by them -- a member cannot give themselves a shorter week, and
    # neither can a Team lead.
    cap = f"/workspaces/{org['ws']}/members/member/capacity"
    assert api.put(cap, "member", {"capacity_seconds": [4 * HOUR] * 4 + [0, 0, 0]}).status_code == 403
    assert api.put(cap, "lead", {"capacity_seconds": [4 * HOUR] * 4 + [0, 0, 0]}).status_code == 403
    ok(api.put(cap, "admin", {"capacity_seconds": [4 * HOUR] * 4 + [0, 0, 0]}))
    assert sheet(api, org, "member")["capacity_per_day"][:5] == [4 * HOUR] * 4 + [0]
    assert api.put(f"/workspaces/{org['ws']}/members/member2/capacity", "member", {"capacity_seconds": None}).status_code == 403


def test_time_tags_and_editing_entries(api, org):
    url = f"/workspaces/{org['ws']}/time-tags"
    tag = ok(api.post(url, "member", {"name": "Overtime"}), 201)
    assert api.post(url, "member2", {"name": "overtime"}).status_code == 400
    assert api.patch(f"{url}/{tag['id']}", "member2", {"name": "OT"}).status_code == 403
    entry = log(api, org["a"], "member", MONDAY, 1)
    moved = ok(api.patch(f"/time/{entry['id']}", "member", {
        "tag_ids": [tag["id"]], "task_id": org["b"]["id"],
        "started_at": datetime(2026, 9, 8, 9, tzinfo=timezone.utc).isoformat(), "description": "Filing"}))
    assert moved["task_id"] == org["b"]["id"] and [t["name"] for t in moved["tags"]] == ["Overtime"]
    row = sheet(api, org, "member")["rows"][0]
    assert row["task"]["name"] == "GST return" and row["seconds_per_day"][2] == HOUR
    stretched = ok(api.patch(f"/time/{entry['id']}", "member", {"ended_at": datetime(2026, 9, 8, 12, tzinfo=timezone.utc).isoformat()}))
    assert stretched["duration_seconds"] == 3 * HOUR


def test_add_task_picker_lists_trackable_tasks(api, org):
    found = ok(api.get(f"/workspaces/{org['ws']}/timesheet/tasks", "member", params={"q": "gst"}))
    assert [x["name"] for x in found] == ["GST return"] and found[0]["location"] == "Ops / Payroll"


def test_add_task_picker_puts_my_open_tasks_first(api, org):
    lst = org["list"]["id"]
    closed = [st for st in ok(api.get(f"/lists/{lst}/statuses", "owner"))["statuses"] if st["group"] == "closed"][0]
    mine = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "My open one", "assignees": ["member"]}), 201)
    finished = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "My finished one", "assignees": ["member"]}), 201)
    ok(api.patch(f"/tasks/{finished['id']}", "owner", {"status_id": closed["id"]}))
    ok(api.patch(f"/tasks/{org['a']['id']}", "owner", {"name": "Salary sheet v2"}))  # most recently touched
    names = [x["name"] for x in ok(api.get(f"/workspaces/{org['ws']}/timesheet/tasks", "member", params={"q": ""}))]
    assert names[0] == "My open one" and names[-1] == "My finished one"
    assert names.index("Salary sheet v2") < names.index("My finished one")
    assert mine["id"]


# --- approvals --------------------------------------------------------------------------------------------


def submit(api, org, who, **extra):
    return api.post(f"/workspaces/{org['ws']}/timesheet/submit", who, {"start": MONDAY.isoformat(), "tz": "UTC", **extra})


def test_approvals_must_be_turned_on(api, org):
    assert submit(api, org, "member").status_code == 400


@pytest.fixture
def approvals_on(api, org):
    ok(api.patch(f"/workspaces/{org['ws']}/timesheet-settings", "owner", {"approvals_enabled": True}))
    return org


def test_submit_locks_the_week_and_the_team_lead_approves(api, approvals_on):
    org = approvals_on
    entry = log(api, org["a"], "member", MONDAY, 2)
    sub = ok(submit(api, org, "member", comment="All done"))
    assert sub["status"] == "pending" and sub["tracked_seconds"] == 2 * HOUR
    assert [a["id"] for a in sub["approvers"]] == ["lead"]

    # Locked for the member...
    assert sheet(api, org, "member")["locked"] is True and sheet(api, org, "member")["can_edit"] is False
    assert cell(api, org, "member", org["a"], MONDAY, 3).status_code == 403
    assert api.patch(f"/time/{entry['id']}", "member", {"description": "x"}).status_code == 403
    assert api.delete(f"/time/{entry['id']}", "member").status_code == 403
    assert submit(api, org, "member").status_code == 400  # already submitted
    # ...but not for admins.
    assert cell(api, org, "admin", org["a"], MONDAY, 2.5, user_id="member").status_code == 204

    # Someone who is not an approver cannot decide.
    assert api.post(f"/timesheet-submissions/{sub['id']}/approve", "member2", {}).status_code == 404
    to_review = ok(api.get(f"/workspaces/{org['ws']}/timesheet-submissions", "lead"))
    assert [x["id"] for x in to_review] == [sub["id"]] and to_review[0]["can_review"] is True
    approved = ok(api.post(f"/timesheet-submissions/{sub['id']}/approve", "lead", {"comment": "Thanks"}))
    assert approved["status"] == "approved" and approved["decided_by"]["id"] == "lead"
    assert cell(api, org, "member", org["a"], MONDAY, 1).status_code == 403

    # Reopening needs a reason, and unlocks.
    assert api.post(f"/timesheet-submissions/{sub['id']}/reopen", "lead", {}).status_code == 400
    ok(api.post(f"/timesheet-submissions/{sub['id']}/reopen", "lead", {"comment": "Monday is wrong"}))
    assert sheet(api, org, "member")["submission"]["status"] == "changes_needed"
    assert cell(api, org, "member", org["a"], MONDAY, 1).status_code == 204
    events = [c["event"] for c in ok(api.get(f"/timesheet-submissions/{sub['id']}/comments", "member"))]
    assert events == ["submitted", "approved", "reopened"]


def test_the_team_lead_fixes_a_submitted_week_but_not_an_approved_one(api, approvals_on):
    org = approvals_on
    entry = log(api, org["a"], "member", MONDAY, 2)
    sub = ok(submit(api, org, "member"))
    # Reviewing a submitted week is when a Manager spots the mistake, so they may fix it then.
    assert sheet(api, org, "lead", user_id="member")["can_edit"] is True
    assert cell(api, org, "lead", org["a"], MONDAY, 1.5, user_id="member").status_code == 204
    # The member still cannot: their week is waiting for a decision.
    assert cell(api, org, "member", org["a"], MONDAY, 3).status_code == 403
    ok(api.post(f"/timesheet-submissions/{sub['id']}/approve", "lead", {}))
    # Approved is final for everyone but admins.
    assert sheet(api, org, "lead", user_id="member")["can_edit"] is False
    assert cell(api, org, "lead", org["a"], MONDAY, 1, user_id="member").status_code == 403
    assert api.delete(f"/time/{entry['id']}", "lead").status_code == 403
    assert cell(api, org, "admin", org["a"], MONDAY, 1, user_id="member").status_code == 204


def test_request_changes_withdraw_and_resubmit(api, approvals_on):
    org = approvals_on
    log(api, org["a"], "member", MONDAY, 1)
    sub = ok(submit(api, org, "member"))
    ok(api.post(f"/timesheet-submissions/{sub['id']}/request-changes", "lead", {"comment": "Add Friday"}))
    assert cell(api, org, "member", org["a"], MONDAY, 2).status_code == 204  # changes needed: editable
    again = ok(submit(api, org, "member"))
    assert again["id"] == sub["id"] and again["status"] == "pending" and again["tracked_seconds"] == 2 * HOUR
    assert api.post(f"/timesheet-submissions/{sub['id']}/withdraw", "lead", {}).status_code == 403
    ok(api.post(f"/timesheet-submissions/{sub['id']}/withdraw", "member", {}))
    assert sheet(api, org, "member")["locked"] is False


def test_admins_can_set_explicit_approvers(api, approvals_on):
    org = approvals_on
    url = f"/workspaces/{org['ws']}/timesheet-approvers"
    assert api.get(url, "member").status_code == 403
    assert api.put(f"{url}/member", "admin", {"approver_ids": ["member"]}).status_code == 400
    ok(api.put(f"{url}/member", "admin", {"approver_ids": ["member2"]}), 204)
    rows = {r["submitter"]["id"]: r for r in ok(api.get(url, "admin"))}
    assert [a["id"] for a in rows["member"]["approvers"]] == ["member2"] and rows["member"]["is_custom"] is True
    sub = ok(submit(api, org, "member"))
    # The explicit approver can now open the timesheet and decide; the Team lead no longer reviews it.
    assert sheet(api, org, "member2", user_id="member")["submission"]["can_review"] is True
    assert ok(api.get(f"/workspaces/{org['ws']}/timesheet-submissions", "lead")) == []
    ok(api.post(f"/timesheet-submissions/{sub['id']}/approve", "member2", {}))


def test_timer_cannot_start_in_a_locked_week(api, approvals_on):
    org = approvals_on
    today = datetime.now(timezone.utc).date()
    ok(api.post(f"/workspaces/{org['ws']}/timesheet/submit", "member", {"start": today.isoformat(), "tz": "UTC"}))
    assert api.post(f"/tasks/{org['a']['id']}/timer", "member").status_code == 403


def test_cells_for_days_ahead_are_refused_and_today_ends_now(api, org):
    today = datetime.now(timezone.utc).date()
    tomorrow = today + timedelta(days=1)
    r = cell(api, org, "member", org["a"], tomorrow, 2)
    assert r.status_code == 400 and "already started" in r.json()["detail"]
    now = datetime.now(timezone.utc)
    if now.hour >= 1:  # an hour fits in the day so far
        assert cell(api, org, "member", org["a"], today, 1).status_code == 204
        entries = ok(api.get(f"/tasks/{org['a']['id']}/time", "member"))["entries"]
        ended = datetime.fromisoformat(entries[0]["ended_at"].replace("Z", "+00:00"))
        assert ended <= datetime.now(timezone.utc) + timedelta(seconds=5)
    # more than the day has held so far would be work not done yet
    if now.hour < 23:
        assert cell(api, org, "member", org["a"], today, 23.99).status_code == 400
