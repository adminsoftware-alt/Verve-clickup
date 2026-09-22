from datetime import date, datetime, timedelta, timezone

import pytest

from app.services.work.workload import spread
from tests.v2.conftest import ok

HOUR = 3600


def make_team(api, workspace, name, members, as_user="owner"):
    return ok(api.post(f"/workspaces/{workspace['id']}/teams", as_user, {"name": name, "member_ids": members}), 201)


# --- teams -------------------------------------------------------------------


def test_owners_and_admins_manage_teams(api, workspace):
    team = make_team(api, workspace, "HR", ["member"])
    assert [m["id"] for m in team["members"]] == ["member"]
    ok(api.put(f"/teams/{team['id']}/members", "admin", {"user_ids": ["member", "guest"]}))
    teams = ok(api.get(f"/workspaces/{workspace['id']}/teams", "member"))  # everyone can see Teams
    assert sorted(m["id"] for m in teams[0]["members"]) == ["guest", "member"]


def test_members_cannot_manage_teams(api, workspace):
    r = api.post(f"/workspaces/{workspace['id']}/teams", "member", {"name": "Rogue"})
    assert r.status_code == 403


def test_team_names_are_unique_ignoring_case(api, workspace):
    make_team(api, workspace, "Dev", [])
    r = api.post(f"/workspaces/{workspace['id']}/teams", "owner", {"name": "dev"})
    assert r.status_code == 400


def test_team_members_must_be_in_the_workspace(api, workspace):
    r = api.post(f"/workspaces/{workspace['id']}/teams", "owner", {"name": "X", "member_ids": ["outsider"]})
    assert r.status_code == 400


def test_leaving_the_workspace_leaves_its_teams(api, workspace):
    team = make_team(api, workspace, "HR", ["member"])
    ok(api.delete(f"/workspaces/{workspace['id']}/members/member", "member"), 204)
    teams = ok(api.get(f"/workspaces/{workspace['id']}/teams", "owner"))
    assert teams[0]["id"] == team["id"] and teams[0]["members"] == []


# --- sharing with teams ------------------------------------------------------


def test_team_share_opens_a_private_list_for_its_members(api, workspace, space):
    team = make_team(api, workspace, "HR", ["member"])
    private = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "HR only", "is_private": True}), 201)
    assert api.get(f"/lists/{private['id']}", "member").status_code == 404
    ok(api.post(f"/lists/{private['id']}/shares", "owner", {"team_id": team["id"], "level": "edit"}), 201)
    assert ok(api.get(f"/lists/{private['id']}", "member"))["permission_level"] == "edit"
    assert api.get(f"/lists/{private['id']}", "admin").status_code == 404  # not in the Team


def test_personal_share_beats_team_share_on_the_same_item(api, workspace, folderless_list):
    team = make_team(api, workspace, "HR", ["member"])
    path = f"/lists/{folderless_list['id']}/shares"
    ok(api.post(path, "owner", {"team_id": team["id"], "level": "full"}), 201)
    ok(api.post(path, "owner", {"user_id": "member", "level": "view"}), 201)
    assert ok(api.get(f"/lists/{folderless_list['id']}", "member"))["permission_level"] == "view"


def test_highest_level_wins_across_several_teams(api, workspace, folderless_list):
    a = make_team(api, workspace, "A", ["member"])
    b = make_team(api, workspace, "B", ["member"])
    path = f"/lists/{folderless_list['id']}/shares"
    ok(api.post(path, "owner", {"team_id": a["id"], "level": "view"}), 201)
    ok(api.post(path, "owner", {"team_id": b["id"], "level": "edit"}), 201)
    assert ok(api.get(f"/lists/{folderless_list['id']}", "member"))["permission_level"] == "edit"


def test_guests_in_a_team_still_never_get_a_space(api, workspace, space, folderless_list):
    team = make_team(api, workspace, "Mixed", ["member", "guest"])
    ok(api.post(f"/spaces/{space['id']}/shares", "owner", {"team_id": team["id"], "level": "view"}), 201)
    assert api.get(f"/spaces/{space['id']}", "guest").status_code == 404
    assert api.get(f"/lists/{folderless_list['id']}", "guest").status_code == 404


def test_sharing_summary_lists_teams_and_people(api, workspace, folderless_list):
    team = make_team(api, workspace, "HR", ["member"])
    path = f"/lists/{folderless_list['id']}"
    ok(api.post(f"{path}/shares", "owner", {"team_id": team["id"], "level": "edit"}), 201)
    ok(api.post(f"{path}/shares", "owner", {"user_id": "guest", "level": "comment"}), 201)
    info = ok(api.get(f"{path}/sharing", "owner"))
    assert info["your_level"] == "full" and info["is_private"] is False
    assert [(x["team"] or x["user"])["id"] for x in info["shares"]] == [team["id"], "guest"]
    ok(api.delete(f"{path}/shares/teams/{team['id']}", "owner"), 204)
    assert len(ok(api.get(f"{path}/sharing", "owner"))["shares"]) == 1


def test_share_needs_exactly_one_grantee(api, workspace, folderless_list):
    team = make_team(api, workspace, "HR", [])
    body = {"user_id": "member", "team_id": team["id"], "level": "view"}
    assert api.post(f"/lists/{folderless_list['id']}/shares", "owner", body).status_code == 422


# --- comment access ----------------------------------------------------------


def test_assignee_with_comment_access_can_only_change_status(api, folderless_list):
    list_id = folderless_list["id"]
    statuses = {s["name"]: s["id"] for s in ok(api.get(f"/lists/{list_id}/statuses", "owner"))["statuses"]}
    mine = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "mine", "assignees": ["member"]}), 201)
    other = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "other"}), 201)
    ok(api.post(f"/lists/{list_id}/shares", "owner", {"user_id": "member", "level": "comment"}), 201)

    moved = ok(api.patch(f"/tasks/{mine['id']}", "member", {"status_id": statuses["In progress"]}))
    assert moved["status"]["name"] == "In progress"
    assert api.patch(f"/tasks/{mine['id']}", "member", {"name": "renamed"}).status_code == 403
    assert api.patch(f"/tasks/{other['id']}", "member", {"status_id": statuses["In progress"]}).status_code == 403


# --- workload ----------------------------------------------------------------


def test_estimate_is_spread_evenly_over_working_days():
    monday = date(2026, 9, 21)
    assert spread(8 * HOUR, monday, monday + timedelta(days=1)) == {monday: 4 * HOUR, monday + timedelta(days=1): 4 * HOUR}
    # Friday to Monday: the weekend gets nothing.
    friday = date(2026, 9, 25)
    result = spread(8 * HOUR, friday, friday + timedelta(days=3))
    assert result == {friday: 4 * HOUR, friday + timedelta(days=3): 4 * HOUR}


def test_weekend_only_work_still_shows_up():
    saturday = date(2026, 9, 26)
    assert spread(2 * HOUR, saturday, saturday) == {saturday: 2 * HOUR}


def test_spread_keeps_every_second():
    monday = date(2026, 9, 21)
    assert sum(spread(10 * HOUR + 1, monday, monday + timedelta(days=2)).values()) == 10 * HOUR + 1


def at(day: date) -> str:
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).isoformat()


def test_workload_rows_capacity_and_multi_assignee(api, workspace, space, folderless_list):
    list_id = folderless_list["id"]
    monday = date(2026, 9, 21)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {
        "name": "pair work", "assignees": ["member", "admin"], "time_estimate_seconds": 8 * HOUR,
        "start_date": at(monday), "due_date": at(monday + timedelta(days=1)),
    }), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {
        "name": "nobody's", "time_estimate_seconds": 2 * HOUR, "due_date": at(monday),
    }), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "someday", "assignees": ["member"]}), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "no estimate", "due_date": at(monday)}), 201)

    w = ok(api.get(f"/spaces/{space['id']}/workload", "owner", params={"start": monday.isoformat(), "days": 7}))
    assert len(w["days"]) == 7 and w["days"][0] == "2026-09-21"
    rows = {(r["user"]["id"] if r["user"] else None): r for r in w["rows"]}
    # Everyone who can see the Space gets a row, guests excluded.
    assert set(rows) == {"owner", "member", "admin", None}
    assert rows["member"]["capacity_seconds"] == [8 * HOUR] * 5 + [0, 0]
    # A two-person task counts in full for each of them.
    assert rows["member"]["scheduled_seconds"][:2] == [4 * HOUR, 4 * HOUR]
    assert rows["admin"]["scheduled_seconds"][:2] == [4 * HOUR, 4 * HOUR]
    assert rows[None]["scheduled_seconds"][0] == 2 * HOUR
    assert [t["name"] for t in w["unscheduled"]] == ["someday"]
    assert [t["name"] for t in w["no_estimate"]] == ["no estimate"]


def test_workload_can_be_narrowed_to_a_team(api, workspace, space, folderless_list):
    team = make_team(api, workspace, "HR", ["member"])
    monday = date(2026, 9, 21)
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {
        "name": "hr", "assignees": ["member"], "time_estimate_seconds": HOUR, "due_date": at(monday),
    }), 201)
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {
        "name": "admin's", "assignees": ["admin"], "time_estimate_seconds": HOUR, "due_date": at(monday),
    }), 201)
    params = {"start": monday.isoformat(), "days": 7, "team_id": team["id"]}
    w = ok(api.get(f"/spaces/{space['id']}/workload", "owner", params=params))
    assert [r["user"]["id"] for r in w["rows"]] == ["member"]
    assert [t["name"] for t in w["rows"][0]["tasks"]] == ["hr"]


def test_workload_uses_the_viewers_timezone(api, space, folderless_list):
    # 23:30 UTC on Monday is already Tuesday in India (UTC+5:30).
    late = datetime(2026, 9, 21, 23, 30, tzinfo=timezone.utc).isoformat()
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {
        "name": "late", "assignees": ["owner"], "time_estimate_seconds": HOUR, "due_date": late,
    }), 201)
    params = {"start": "2026-09-21", "days": 3, "tz_offset": -330}
    rows = {r["user"]["id"]: r for r in ok(api.get(f"/spaces/{space['id']}/workload", "owner", params=params))["rows"] if r["user"]}
    assert rows["owner"]["scheduled_seconds"] == [0, HOUR, 0]


@pytest.mark.parametrize("level", ["space", "folder", "list"])
def test_workload_works_at_every_level(api, space, level):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Monthly Review"}), 201)
    lst = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "PMS - Dev"}), 201)
    monday = date(2026, 9, 21)
    ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {
        "name": "review", "assignees": ["member"], "time_estimate_seconds": 2 * HOUR, "due_date": at(monday),
    }), 201)
    path = {"space": f"/spaces/{space['id']}", "folder": f"/folders/{folder['id']}", "list": f"/lists/{lst['id']}"}[level]
    assert ok(api.post(f"{path}/views", "owner", {"type": "workload"}), 201)["name"] == "Workload"
    w = ok(api.get(f"{path}/workload", "owner", params={"start": monday.isoformat(), "days": 7}))
    rows = {r["user"]["id"]: r for r in w["rows"] if r["user"]}
    assert rows["member"]["scheduled_seconds"][0] == 2 * HOUR
