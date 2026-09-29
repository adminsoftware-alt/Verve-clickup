"""Phase E: sub-teams, Goals (and Team goals), and the Worked on, Battery, Goal and Sprint dashboard cards."""

from datetime import date, datetime, timedelta, timezone

from tests.v2.conftest import ok


def _team(api, ws, name, members, parent=None, as_user="owner"):
    body = {"name": name, "member_ids": members}
    if parent:
        body["parent_team_id"] = parent
    return ok(api.post(f"/workspaces/{ws}/teams", as_user, body), 201)


# --- sub-teams -----------------------------------------------------------------------------------


def test_sub_teams_count_as_members_of_their_parent(api, workspace, space, folderless_list):
    ws = workspace["id"]
    firm = _team(api, ws, "Audit", ["admin"])
    sub = _team(api, ws, "Audit – Mumbai", ["member"], parent=firm["id"])
    assert sub["parent_team_id"] == firm["id"]
    teams = {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/teams", "member"))}
    assert set(teams["Audit"]["all_member_ids"]) == {"admin", "member"} and [u["id"] for u in teams["Audit"]["members"]] == ["admin"]

    # A share with the parent Team reaches the sub-team's people.
    secret = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Audit files", "is_private": True}), 201)
    assert api.get(f"/spaces/{secret['id']}", "member").status_code == 404
    ok(api.post(f"/spaces/{secret['id']}/shares", "owner", {"team_id": firm["id"], "level": "edit"}), 201)
    assert ok(api.get(f"/spaces/{secret['id']}", "member"))["permission_level"] == "edit"

    # No loops, and only admins may rearrange Teams.
    assert api.patch(f"/teams/{firm['id']}", "owner", {"parent_team_id": sub["id"]}).status_code == 400
    assert api.patch(f"/teams/{firm['id']}", "owner", {"parent_team_id": firm["id"]}).status_code == 400
    assert api.patch(f"/teams/{sub['id']}", "member", {"parent_team_id": None}).status_code == 403
    ok(api.patch(f"/teams/{sub['id']}", "owner", {"parent_team_id": None}))
    assert api.get(f"/spaces/{secret['id']}", "member").status_code == 404

    # Workload for the parent Team includes the sub-team's people.
    ok(api.patch(f"/teams/{sub['id']}", "owner", {"parent_team_id": firm["id"]}))
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "Fieldwork", "assignees": ["member"],
                                                                    "due_date": datetime.now(timezone.utc).isoformat(), "time_estimate_seconds": 3600}), 201)
    wl = ok(api.get(f"/spaces/{space['id']}/workload", "owner", params={"start": date.today().isoformat(), "days": 7, "team_id": firm["id"]}))
    assert {r["user"]["id"] for r in wl["rows"] if r["user"]} == {"admin", "member"}


# --- goals ---------------------------------------------------------------------------------------


def test_goals_with_number_money_yes_no_and_task_targets(api, workspace, space, folderless_list):
    ws, lst = workspace["id"], folderless_list["id"]
    tasks = [ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": f"Onboard client {i}"}), 201) for i in range(4)]
    goal = ok(api.post(f"/workspaces/{ws}/goals", "member", {
        "name": "Grow the practice", "folder": "FY 2026-27", "due_date": (datetime.now(timezone.utc) + timedelta(days=90)).isoformat(),
        "targets": [
            {"name": "New clients", "kind": "number", "start_value": 0, "target_value": 20, "unit": "clients"},
            {"name": "Fees billed", "kind": "currency", "start_value": 0, "target_value": 1000000, "unit": "INR"},
            {"name": "Website live", "kind": "true_false"},
            {"name": "Onboarding done", "kind": "tasks", "list_ids": [lst]},
        ],
    }), 201)
    assert goal["progress"] == 0 and goal["owners"][0]["id"] == "member" and goal["can_edit"]
    t = {x["name"]: x for x in goal["targets"]}
    assert t["Onboarding done"]["total_tasks"] == 4

    goal = ok(api.post(f"/goal-targets/{t['New clients']['id']}/check-ins", "member", {"value": 10, "note": "Half way"}), 201)
    goal = ok(api.post(f"/goal-targets/{t['Website live']['id']}/check-ins", "member", {"value": 1}), 201)
    closed = [st for st in ok(api.get(f"/lists/{lst}/statuses", "owner"))["statuses"] if st["group"] == "closed"][0]
    ok(api.patch(f"/tasks/{tasks[0]['id']}", "owner", {"status_id": closed["id"]}))
    goal = ok(api.get(f"/goals/{goal['id']}", "admin"))
    t = {x["name"]: x for x in goal["targets"]}
    assert t["New clients"]["progress"] == 50 and t["Website live"]["progress"] == 100 and t["Onboarding done"]["progress"] == 25
    assert goal["progress"] == round((50 + 0 + 100 + 25) / 4, 1) and goal["on_track"] is True
    history = ok(api.get(f"/goal-targets/{t['New clients']['id']}/check-ins", "owner"))
    assert history[0]["note"] == "Half way" and history[0]["user"]["id"] == "member"
    assert api.post(f"/goal-targets/{t['Onboarding done']['id']}/check-ins", "member", {"value": 3}).status_code == 400

    # Others can read it; only owners, creators and admins change it; guests can't see it.
    assert ok(api.get(f"/goals/{goal['id']}", "owner"))["can_edit"] is True  # admins and owners
    assert api.get(f"/goals/{goal['id']}", "guest").status_code == 404
    assert api.post(f"/workspaces/{ws}/goals", "guest", {"name": "x"}).status_code == 403
    assert api.post(f"/workspaces/{ws}/goals", "member", {"name": "x", "targets": [{"name": "y", "kind": "number", "start_value": 1, "target_value": 1}]}).status_code == 422

    ok(api.patch(f"/goals/{goal['id']}", "member", {"is_private": True}))
    assert api.get(f"/goals/{goal['id']}", "owner").status_code == 200  # owner is an admin
    ok(api.patch(f"/goals/{goal['id']}", "member", {"archived": True}))
    assert ok(api.get(f"/workspaces/{ws}/goals", "member")) == []
    assert len(ok(api.get(f"/workspaces/{ws}/goals?include_archived=true", "member"))) == 1
    ok(api.delete(f"/goals/{goal['id']}", "member"), 204)


def test_team_goals_are_seen_by_the_team_and_managed_by_its_leads(api, workspace):
    ws = workspace["id"]
    for uid in ("m2", "m3"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Tax", "member_ids": ["member", "m2"], "lead_ids": ["member"]}), 201)
    goal = ok(api.post(f"/workspaces/{ws}/goals", "owner", {
        "name": "Zero late filings", "team_id": team["id"], "is_private": True, "owner_ids": ["owner"],
        "targets": [{"name": "Late filings this year", "kind": "number", "start_value": 10, "target_value": 0}],
    }), 201)
    assert goal["team"]["name"] == "Tax"
    assert ok(api.get(f"/goals/{goal['id']}", "m2"))["can_edit"] is False  # in the team: sees it
    assert ok(api.get(f"/goals/{goal['id']}", "member"))["can_edit"] is True  # the team's lead
    assert api.get(f"/goals/{goal['id']}", "m3").status_code == 404  # private, not in the team
    target = goal["targets"][0]["id"]
    assert api.post(f"/goal-targets/{target}/check-ins", "m2", {"value": 4}).status_code == 403
    out = ok(api.post(f"/goal-targets/{target}/check-ins", "member", {"value": 4}), 201)
    assert out["targets"][0]["progress"] == 60  # counting down from 10 to 0
    assert [x["name"] for x in ok(api.get(f"/workspaces/{ws}/goals?team_id={team['id']}", "m2"))] == ["Zero late filings"]
    ok(api.post(f"/workspaces/{ws}/favorites", "m2", {"kind": "goal", "target_id": goal["id"]}), 201)
    assert ok(api.get(f"/workspaces/{ws}/favorites", "m2"))[0]["name"] == "Zero late filings"


# --- cards ---------------------------------------------------------------------------------------


def _card(api, dash, body):
    return ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", body), 201)


def _data(api, dash, card, who="owner"):
    return ok(api.get(f"/dashboards/{dash['id']}/cards/{card['id']}/data", who, params={"tz": "UTC"}))


def test_battery_worked_on_goal_and_sprint_cards(api, workspace, space, folderless_list):
    ws, lst = workspace["id"], folderless_list["id"]
    statuses = {st["group"]: st for st in ok(api.get(f"/lists/{lst}/statuses", "owner"))["statuses"]}
    a = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Audit", "assignees": ["member"]}), 201)
    b = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "GST", "assignees": ["member"]}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Payroll"}), 201)
    ok(api.patch(f"/tasks/{a['id']}", "member", {"status_id": statuses["closed"]["id"]}))
    ok(api.post(f"/tasks/{b['id']}/time", "member", {"duration_seconds": 5400}), 201)
    ok(api.post(f"/tasks/{b['id']}/comments", "member", {"body": "Filed the draft"}), 201)
    dash = ok(api.post(f"/workspaces/{ws}/dashboards", "owner", {"name": "Practice"}), 201)

    battery = _card(api, dash, {"type": "battery", "config": {"sources": [{"kind": "list", "id": lst}]}})
    got = _data(api, dash, battery)["data"]
    assert got["total"] == 3 and got["done"] == 1 and got["percent"] == 33

    worked = _card(api, dash, {"type": "worked_on", "config": {"period": {"preset": "this_week"}}})
    rows = {r["key"]: r for r in _data(api, dash, worked)["data"]["rows"]}
    mine = {t["name"]: t for t in rows["member"]["tasks"]}
    assert mine["GST"]["tracked_seconds"] == 5400 and mine["GST"]["comments"] == 1 and mine["Audit"]["completed"] is True
    assert rows["member"]["tracked_seconds"] == 5400
    only_owner = _card(api, dash, {"type": "worked_on", "config": {"filters": {"assignees": ["owner"]}}})
    assert _data(api, dash, only_owner)["data"]["rows"] == []  # creating tasks isn't working on them

    goal = ok(api.post(f"/workspaces/{ws}/goals", "owner", {"name": "Clients", "targets": [{"name": "n", "kind": "number", "target_value": 4}]}), 201)
    ok(api.post(f"/goal-targets/{goal['targets'][0]['id']}/check-ins", "owner", {"value": 1}), 201)
    assert api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "goal"}).status_code == 422
    gc = _card(api, dash, {"type": "goal", "config": {"goal_ids": [goal["id"]]}})
    assert _data(api, dash, gc)["data"]["goals"][0]["progress"] == 25

    ok(api.patch(f"/spaces/{space['id']}", "owner", {"clickapps": {"sprint_points": True}}))
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Eng"}), 201)
    ok(api.put(f"/folders/{folder['id']}/sprints", "owner", {"weeks": 1}))
    [sprint] = ok(api.get(f"/folders/{folder['id']}/sprints", "owner"))
    ok(api.post(f"/lists/{sprint['id']}/tasks", "owner", {"name": "Story", "points": 8}), 201)
    sc = _card(api, dash, {"type": "sprint", "config": {"folder_id": folder["id"]}})
    rep = _data(api, dash, sc)["data"]
    assert rep["folder"] == "Eng" and rep["report"]["sprint"]["total_points"] == 8
