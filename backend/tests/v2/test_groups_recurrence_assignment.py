from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.db import session as db_session
from app.schemas.work import Recurrence
from app.services.work import recurrence
from tests.v2.conftest import ok

HOUR = 3600


@pytest.fixture
def org(api, workspace):
    """'lead' leads Team HR = {lead, member}; 'member2' is outside it. A HR space with Anjali's folder."""
    ws = workspace["id"]
    for uid in ("lead", "member2"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR & Admin"}), 201)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "HRBP_Anjali"}), 201)
    daily = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Daily Calls"}), 201)
    other = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Elsewhere"}), 201)
    return {"ws": ws, "space": space, "folder": folder, "daily": daily, "other": other}


def task(api, lst, who="owner", **fields):
    return ok(api.post(f"/lists/{lst['id']}/tasks", who, {"name": "Task", **fields}), 201)


def closed_status(api, lst, who="owner"):
    return next(st for st in ok(api.get(f"/lists/{lst['id']}/statuses", who))["statuses"] if st["group"] == "closed")


# --- task groups -------------------------------------------------------------------------


def test_groups_defined_on_a_folder_apply_to_its_lists(api, org):
    meeting = ok(api.post(f"/folders/{org['folder']['id']}/groups", "owner", {"name": "Meetings"}), 201)
    calls = ok(api.post(f"/lists/{org['daily']['id']}/groups", "owner", {"name": "Client calls"}), 201)
    names = [g["name"] for g in ok(api.get(f"/lists/{org['daily']['id']}/groups", "member"))]
    assert names == ["Client calls", "Meetings"]  # nearest first
    assert api.post(f"/lists/{org['daily']['id']}/groups", "owner", {"name": "meetings"}).status_code == 400
    t = task(api, org["daily"], name="Weekly sync", group_id=meeting["id"])
    assert t["group"] == {"id": meeting["id"], "name": "Meetings", "color": meeting["color"]}
    moved = ok(api.patch(f"/tasks/{t['id']}", "owner", {"group_id": calls["id"]}))
    assert moved["group"]["name"] == "Client calls"
    # A List outside the folder cannot use the folder's groups.
    assert api.post(f"/lists/{org['other']['id']}/tasks", "owner", {"name": "x", "group_id": meeting["id"]}).status_code == 400


def test_moving_a_task_out_of_the_groups_reach_drops_the_group(api, org):
    meeting = ok(api.post(f"/folders/{org['folder']['id']}/groups", "owner", {"name": "Meetings"}), 201)
    t = task(api, org["daily"], group_id=meeting["id"])
    ok(api.post(f"/tasks/{t['id']}/move", "owner", {"list_id": org["other"]["id"]}))
    assert ok(api.get(f"/tasks/{t['id']}", "owner"))["group"] is None


def test_deleting_a_group_keeps_its_tasks_and_needs_edit_access(api, org):
    g = ok(api.post(f"/lists/{org['daily']['id']}/groups", "owner", {"name": "Reviews"}), 201)
    t = task(api, org["daily"], group_id=g["id"])
    assert api.delete(f"/groups/{g['id']}", "guest").status_code == 404
    ok(api.patch(f"/groups/{g['id']}", "member", {"name": "Monthly reviews", "color": "#10b981"}))
    assert ok(api.get(f"/tasks/{t['id']}", "owner"))["group"]["name"] == "Monthly reviews"
    assert api.delete(f"/groups/{g['id']}", "member").status_code == 204
    assert ok(api.get(f"/tasks/{t['id']}", "owner"))["group"] is None


# --- recurrence rules ------------------------------------------------------------------------


def _next(rule, due, now):
    fake = SimpleNamespace(due_date=due, start_date=None)
    return recurrence.next_dates(fake, Recurrence(**rule), now)


UTC = timezone.utc


def test_rules_step_through_the_calendar():
    wed = datetime(2026, 9, 23, 9, tzinfo=UTC)
    now = datetime(2026, 9, 23, 12, tzinfo=UTC)
    assert _next({"frequency": "daily"}, wed, now)[1] == datetime(2026, 9, 24, 9, tzinfo=UTC)
    assert _next({"frequency": "daily", "interval": 3}, wed, now)[1] == datetime(2026, 9, 26, 9, tzinfo=UTC)
    # Every other week on Monday and Friday, counted from the task's week.
    rule = {"frequency": "weekly", "interval": 2, "weekdays": [0, 4]}
    assert _next(rule, wed, now)[1] == datetime(2026, 9, 25, 9, tzinfo=UTC)  # Friday, same week
    fri = datetime(2026, 9, 25, 9, tzinfo=UTC)
    assert _next(rule, fri, now)[1] == datetime(2026, 10, 5, 9, tzinfo=UTC)  # Monday, two weeks on
    # Monthly on the 31st clamps to shorter months; yearly on 29 Feb falls back to the 28th.
    jan31 = datetime(2027, 1, 31, 9, tzinfo=UTC)
    assert _next({"frequency": "monthly", "month_day": 31}, jan31, jan31)[1] == datetime(2027, 2, 28, 9, tzinfo=UTC)
    leap = datetime(2028, 2, 29, 9, tzinfo=UTC)
    assert _next({"frequency": "yearly"}, leap, leap)[1] == datetime(2029, 2, 28, 9, tzinfo=UTC)


def test_missed_occurrences_are_skipped_and_limits_end_the_series():
    long_ago = datetime(2026, 9, 1, 9, tzinfo=UTC)
    now = datetime(2026, 9, 23, 12, tzinfo=UTC)
    assert _next({"frequency": "daily"}, long_ago, now)[1] == datetime(2026, 9, 23, 9, tzinfo=UTC)  # today, not 2 Sept
    assert _next({"frequency": "daily", "until": "2026-09-20"}, long_ago, now) is None
    assert _next({"frequency": "daily", "count": 0}, long_ago, now) is None


def test_a_repeat_can_count_from_the_day_it_was_finished():
    long_ago = datetime(2026, 9, 1, 9, tzinfo=UTC)
    now = datetime(2026, 9, 23, 12, tzinfo=UTC)
    # "Three days after it is done" ignores the old due date entirely.
    assert _next({"frequency": "days_after", "interval": 3}, long_ago, now)[1] == datetime(2026, 9, 26, 9, tzinfo=UTC)
    # Weekly, synced to the due date: the series keeps its original rhythm (1, 8, 15, 29 Sept).
    weekly = {"frequency": "daily", "interval": 7}
    assert _next(weekly, long_ago, now)[1] == datetime(2026, 9, 29, 9, tzinfo=UTC)
    # Unsynced: the week starts again from the day it was finished.
    assert _next({**weekly, "sync_to_due": False}, long_ago, now)[1] == datetime(2026, 9, 30, 9, tzinfo=UTC)


def test_days_after_cannot_run_on_a_schedule():
    # There is no schedule to run on: the date is only known once the task is done.
    with pytest.raises(ValueError):
        Recurrence(frequency="days_after", interval=2, trigger="on_schedule")


def test_dates_move_in_the_rules_timezone():
    # 1st of the month, local midnight in India (18:30 UTC the day before)
    due = datetime(2026, 9, 30, 18, 30, tzinfo=UTC)
    out = _next({"frequency": "monthly", "tz": "Asia/Kolkata"}, due, due)[1]
    assert out == datetime(2026, 10, 31, 18, 30, tzinfo=UTC)  # 1 November, local midnight


# --- recurrence through the API ----------------------------------------------------------------


def test_completing_a_repeating_task_creates_the_next_one(api, org):
    today = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    g = ok(api.post(f"/lists/{org['daily']['id']}/groups", "owner", {"name": "Calls"}), 201)
    t = task(api, org["daily"], name="Daily call log", due_date=today.isoformat(), assignees=["member"],
             group_id=g["id"], time_estimate_seconds=HOUR, recurrence={"frequency": "daily", "count": 2})
    assert t["recurrence"]["frequency"] == "daily"
    ok(api.patch(f"/tasks/{t['id']}", "member", {"status_id": closed_status(api, org["daily"])["id"]}))
    tasks = ok(api.get(f"/lists/{org['daily']['id']}/tasks", "owner", params={"include_closed": True}))["tasks"]
    old = next(x for x in tasks if x["id"] == t["id"])
    new = next(x for x in tasks if x["recurs_from_id"] == t["id"])
    assert old["recurrence"] is None and old["status"]["group"] == "closed"
    assert new["status"]["group"] == "not_started" and new["recurrence"]["count"] == 1
    assert datetime.fromisoformat(new["due_date"]) == today + timedelta(days=1)
    assert [a["id"] for a in new["assignees"]] == ["member"] and new["group"]["name"] == "Calls"
    assert new["time_estimate_seconds"] == HOUR


def test_reopen_moves_the_same_task_forward(api, org):
    due = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    t = task(api, org["daily"], due_date=due.isoformat(), recurrence={"frequency": "weekly", "action": "reopen"})
    after = ok(api.patch(f"/tasks/{t['id']}", "owner", {"status_id": closed_status(api, org["daily"])["id"]}))
    assert after["status"]["group"] == "not_started"
    assert datetime.fromisoformat(after["due_date"]) == due + timedelta(days=7)
    assert len(ok(api.get(f"/lists/{org['daily']['id']}/tasks", "owner"))["tasks"]) == 1


def test_scheduled_repeats_are_created_when_due(api, org):
    assert api.post(f"/lists/{org['daily']['id']}/tasks", "owner", {
        "name": "x", "recurrence": {"frequency": "daily", "trigger": "on_schedule"}}).status_code == 400
    due = datetime.now(UTC) - timedelta(minutes=5)
    task(api, org["daily"], name="GST reminder", due_date=due.isoformat(), recurrence={"frequency": "monthly", "trigger": "on_schedule"})
    with db_session.new_session() as db:
        assert recurrence.run_due(db) == 1
        assert recurrence.run_due(db) == 0
    names = [x["name"] for x in ok(api.get(f"/lists/{org['daily']['id']}/tasks", "owner"))["tasks"]]
    assert names == ["GST reminder", "GST reminder"]  # the original stays open; the next one is waiting


def test_the_rule_can_name_the_status_the_next_one_opens_in(api, org):
    statuses = ok(api.get(f"/lists/{org['daily']['id']}/statuses", "owner"))["statuses"]
    waiting = next(st for st in statuses if st["group"] == "active")
    due = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    t = task(api, org["daily"], due_date=due.isoformat(),
             recurrence={"frequency": "daily", "reset_status_id": waiting["id"]})
    ok(api.patch(f"/tasks/{t['id']}", "owner", {"status_id": closed_status(api, org["daily"])["id"]}))
    tasks = ok(api.get(f"/lists/{org['daily']['id']}/tasks", "owner", params={"include_closed": True}))["tasks"]
    new = next(x for x in tasks if x["recurs_from_id"] == t["id"])
    assert new["status"]["id"] == waiting["id"]  # not the List's first status


def test_removing_the_rule(api, org):
    t = task(api, org["daily"], recurrence={"frequency": "daily"})
    assert ok(api.patch(f"/tasks/{t['id']}", "owner", {"recurrence": None}))["recurrence"] is None


# --- assigning a List to a person ------------------------------------------------------------------


def visible_lists(api, org, who):
    tree = ok(api.get(f"/workspaces/{org['ws']}/hierarchy", who))
    names = set()

    def walk(node):
        for f in node.get("folders", []):
            walk(f)
        for lst in node.get("lists", []):
            names.add(lst["name"])

    for sp in tree["spaces"]:
        walk(sp)
    walk(tree["shared_with_me"])
    return names


def test_a_manager_hands_a_list_to_someone_in_their_team(api, org):
    lst = ok(api.post(f"/folders/{org['folder']['id']}/lists", "lead", {"name": "Intern onboarding"}), 201)
    # Not someone outside the Team they lead.
    assert api.put(f"/lists/{lst['id']}/assignee", "lead", {"user_id": "member2"}).status_code == 403
    out = ok(api.put(f"/lists/{lst['id']}/assignee", "lead", {"user_id": "member"}))
    assert out["assignee_id"] == "member" and out["is_private"] is True

    # Only the assignee and the manager see it now.
    assert "Intern onboarding" in visible_lists(api, org, "member")
    assert "Intern onboarding" in visible_lists(api, org, "lead")
    assert "Intern onboarding" not in visible_lists(api, org, "member2")
    assert api.get(f"/lists/{lst['id']}/tasks", "member2").status_code == 404

    # The assignee adds a task, assigns themselves, tracks time and completes it.
    t = task(api, lst, who="member", name="Read the induction SOP", time_estimate_seconds=2 * HOUR,
             due_date=datetime.now(UTC).isoformat())
    ok(api.patch(f"/tasks/{t['id']}", "member", {"assignees": ["member"]}))
    ok(api.post(f"/tasks/{t['id']}/time", "member", {"duration_seconds": HOUR}), 201)
    mine = ok(api.get(f"/workspaces/{org['ws']}/my-tasks", "member"))["tasks"]
    assert [x["name"] for x in mine] == ["Read the induction SOP"]
    today = datetime.now(UTC).date().isoformat()
    workload = ok(api.get(f"/lists/{lst['id']}/workload", "lead", params={"start": today, "days": 1}))
    row = next(r for r in workload["rows"] if r["user"] and r["user"]["id"] == "member")
    assert sum(row["scheduled_seconds"]) > 0
    ok(api.patch(f"/tasks/{t['id']}", "member", {"status_id": closed_status(api, lst, "member")["id"]}))
    # The workspace owner did not create or assign it, so this private List is hidden from them too.
    assert api.get(f"/lists/{lst['id']}/tasks", "owner").status_code == 404
    assert ok(api.get(f"/tasks/{t['id']}/time", "lead"))["total_seconds"] == HOUR  # the lead sees their team's time


def test_admins_assign_to_anyone_and_taking_it_back_removes_access(api, org):
    out = ok(api.put(f"/lists/{org['other']['id']}/assignee", "admin", {"user_id": "member2"}))
    assert out["assignee_id"] == "member2"
    task(api, org["other"], who="member2", name="Mine now")
    assert api.put(f"/lists/{org['other']['id']}/assignee", "admin", {"user_id": "guest"}).status_code == 400
    ok(api.put(f"/lists/{org['other']['id']}/assignee", "admin", {"user_id": None}))
    assert api.get(f"/lists/{org['other']['id']}/tasks", "member2").status_code == 404
    # The admin who assigned it kept access, and so did the List's creator.
    ok(api.get(f"/lists/{org['other']['id']}/tasks", "admin"))
    ok(api.get(f"/lists/{org['other']['id']}/tasks", "owner"))


def test_a_list_can_belong_to_several_people_at_once(api, org):
    url = f"/lists/{org['other']['id']}/assignee"
    out = ok(api.put(url, "admin", {"user_ids": ["member", "member2"]}))
    assert [u["id"] for u in out["assignees"]] == ["member", "member2"]
    assert out["assignee_id"] == "member"  # the first of them, for anything that reads one owner
    # Both can open it and work in it.
    for who in ("member", "member2"):
        task(api, org["other"], who=who, name=f"{who}'s job")
    tree = ok(api.get(f"/workspaces/{org['ws']}/hierarchy", "admin"))
    node = next(n for sp in tree["spaces"] for n in sp["lists"] if n["id"] == str(org["other"]["id"]))
    assert node["assignee_ids"] == ["member", "member2"]

    # Dropping one takes their access back and leaves the other in place.
    kept = ok(api.put(url, "admin", {"user_ids": ["member2"]}))
    assert [u["id"] for u in kept["assignees"]] == ["member2"]
    assert api.get(f"/lists/{org['other']['id']}/tasks", "member").status_code == 404
    ok(api.get(f"/lists/{org['other']['id']}/tasks", "member2"))

    # Guests still can't be given a List, and neither can a crowd.
    assert api.put(url, "admin", {"user_ids": ["member2", "guest"]}).status_code == 400
    assert api.put(url, "admin", {"user_ids": [f"nobody{i}" for i in range(21)]}).status_code == 422
    # Handing it back to nobody clears everyone.
    assert ok(api.put(url, "admin", {"user_ids": []}))["assignees"] == []


def test_members_cannot_assign_lists_they_do_not_manage(api, org):
    assert api.put(f"/lists/{org['daily']['id']}/assignee", "member", {"user_id": "member2"}).status_code == 403
    # ...but may take a List on themselves when they have full access.
    assert ok(api.put(f"/lists/{org['daily']['id']}/assignee", "member", {"user_id": "member", "private": False}))["assignee_id"] == "member"
