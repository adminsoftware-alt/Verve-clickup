from datetime import datetime, timedelta, timezone

from tests.v2.conftest import ok

HOUR = 3600


def new_task(api, list_id, **fields):
    return ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "Task", **fields}), 201)


def test_timer_starts_and_stops(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    started = ok(api.post(f"/tasks/{task['id']}/timer", "member"), 201)
    assert started["running"] is True and started["duration_seconds"] is None
    running = ok(api.get("/timer", "member"))
    assert running["entry"]["id"] == started["id"] and running["task_name"] == "Task"
    stopped = ok(api.post("/timer/stop", "member"))
    assert stopped["running"] is False and stopped["duration_seconds"] >= 0
    assert ok(api.get("/timer", "member")) is None


def test_starting_a_second_timer_stops_the_first(api, folderless_list):
    a = new_task(api, folderless_list["id"], name="a")
    b = new_task(api, folderless_list["id"], name="b")
    first = ok(api.post(f"/tasks/{a['id']}/timer", "member"), 201)
    ok(api.post(f"/tasks/{b['id']}/timer", "member"), 201)
    assert ok(api.get("/timer", "member"))["task_name"] == "b"
    entries = ok(api.get(f"/tasks/{a['id']}/time", "member"))["entries"]
    assert [(e["id"], e["running"]) for e in entries] == [(first["id"], False)]


def test_starting_the_same_timer_twice_keeps_one_entry(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    first = ok(api.post(f"/tasks/{task['id']}/timer", "member"), 201)
    again = ok(api.post(f"/tasks/{task['id']}/timer", "member"), 201)
    assert first["id"] == again["id"]


def test_stopping_with_no_timer_is_a_404(api, workspace):
    assert api.post("/timer/stop", "member").status_code == 404


def test_manual_entry_counts_toward_the_task_total(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    ok(api.post(f"/tasks/{task['id']}/time", "member", {"duration_seconds": 2 * HOUR, "description": "PMS form"}), 201)
    start = datetime(2026, 9, 21, 9, tzinfo=timezone.utc)
    ok(api.post(f"/tasks/{task['id']}/time", "member", {
        "started_at": start.isoformat(), "ended_at": (start + timedelta(minutes=45)).isoformat(),
    }), 201)
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["time_tracked_seconds"] == 2 * HOUR + 45 * 60
    listed = ok(api.get(f"/lists/{folderless_list['id']}/tasks", "owner"))["tasks"][0]
    assert listed["time_tracked_seconds"] == 2 * HOUR + 45 * 60


def test_running_timers_do_not_count_until_stopped(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    ok(api.post(f"/tasks/{task['id']}/timer", "member"), 201)
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["time_tracked_seconds"] == 0


def test_entry_needs_a_duration_or_a_range(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    assert api.post(f"/tasks/{task['id']}/time", "member", {"description": "?"}).status_code == 422
    too_long = {"duration_seconds": 25 * HOUR}
    assert api.post(f"/tasks/{task['id']}/time", "member", too_long).status_code == 422


def test_comment_access_cannot_track_time(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "comment"}), 201)
    assert api.post(f"/tasks/{task['id']}/timer", "member").status_code == 403
    assert api.post(f"/tasks/{task['id']}/time", "member", {"duration_seconds": 60}).status_code == 403


def test_only_owners_and_admins_log_time_for_others(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    body = {"duration_seconds": HOUR, "user_id": "member"}
    assert api.post(f"/tasks/{task['id']}/time", "guest", body).status_code in (403, 404)
    other = ok(api.post(f"/tasks/{task['id']}/time", "admin", body), 201)
    assert other["user"]["id"] == "member"
    assert api.post(f"/tasks/{task['id']}/time", "member", {**body, "user_id": "admin"}).status_code == 403


def test_members_see_only_their_own_entries_but_everyone_sees_the_total(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    ok(api.post(f"/tasks/{task['id']}/time", "member", {"duration_seconds": HOUR}), 201)
    ok(api.post(f"/tasks/{task['id']}/time", "admin", {"duration_seconds": 2 * HOUR}), 201)
    mine = ok(api.get(f"/tasks/{task['id']}/time", "member"))
    assert mine["total_seconds"] == 3 * HOUR and mine["shows_everyone"] is False
    assert [e["user"]["id"] for e in mine["entries"]] == ["member"]
    everyone = ok(api.get(f"/tasks/{task['id']}/time", "owner"))
    assert sorted(e["user"]["id"] for e in everyone["entries"]) == ["admin", "member"]


def test_people_edit_their_own_entries_and_admins_edit_anyones(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    mine = ok(api.post(f"/tasks/{task['id']}/time", "member", {"duration_seconds": HOUR}), 201)
    admins = ok(api.post(f"/tasks/{task['id']}/time", "admin", {"duration_seconds": HOUR}), 201)
    ok(api.patch(f"/time/{mine['id']}", "member", {"duration_seconds": 1800, "billable": True}))
    assert api.patch(f"/time/{admins['id']}", "member", {"duration_seconds": 60}).status_code == 404
    ok(api.delete(f"/time/{mine['id']}", "owner"), 204)
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["time_tracked_seconds"] == HOUR


def test_deleting_a_task_deletes_its_time(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    entry = ok(api.post(f"/tasks/{task['id']}/time", "member", {"duration_seconds": HOUR}), 201)
    ok(api.delete(f"/tasks/{task['id']}", "owner"), 204)
    assert api.patch(f"/time/{entry['id']}", "member", {"billable": True}).status_code == 404
