"""Each Team sees its own work: new and copied Lists keep their Team, and Folders that hold only
other Teams' Lists drop out of a member's sidebar."""

from datetime import datetime, timedelta, timezone

from app.db import session as db_session
from app.db.models import TimeEntry
from tests.v2.conftest import ok


def tree(api, workspace, who):
    return ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", who))


def folder_names(api, workspace, who):
    return [f["name"] for sp in tree(api, workspace, who)["spaces"] for f in sp["folders"]]


def list_names(api, workspace, who):
    def walk(node):
        yield from (l["name"] for l in node["lists"])
        for f in node["folders"]:
            yield from walk(f)
    return [name for sp in tree(api, workspace, who)["spaces"] for name in walk(sp)]


def _teams(api, workspace):
    ws = workspace["id"]
    for uid in ("lead", "member2"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    dev = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Dev", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{dev['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))
    sales = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Sales", "member_ids": ["member2"]}), 201)
    return dev, sales


def test_a_leads_new_list_is_their_teams(api, workspace, space):
    dev, _ = _teams(api, workspace)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "lead", {"name": "Dev backlog"}), 201)
    assert lst["team"]["name"] == "Dev"
    assert "Dev backlog" in list_names(api, workspace, "member")       # a Dev member
    assert "Dev backlog" not in list_names(api, workspace, "member2")  # Sales
    assert "Dev backlog" in list_names(api, workspace, "admin")        # admins see all
    # An admin's new List is the workspace's unless its parent belongs to a Team.
    open_list = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Everyone"}), 201)
    assert open_list.get("team") is None
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Dev only"}), 201)
    ok(api.put(f"/folders/{folder['id']}/team", "owner", {"team_id": dev["id"]}))
    inside = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Inside"}), 201)
    assert inside["team"]["name"] == "Dev"


def test_a_copy_of_a_teams_list_is_still_the_teams(api, workspace, space):
    dev, _ = _teams(api, workspace)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Events - Dev"}), 201)
    ok(api.put(f"/lists/{lst['id']}/team", "owner", {"team_id": dev["id"]}))
    copy = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner", {"name": "Events - Dev (copy)"}), 201)
    assert "Events - Dev (copy)" not in list_names(api, workspace, "member2")
    assert "Events - Dev (copy)" in list_names(api, workspace, "member")
    assert copy["id"] != lst["id"]


def test_a_folder_of_other_teams_lists_is_not_shown(api, workspace, space):
    dev, sales = _teams(api, workspace)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Special events"}), 201)
    ws_tree = tree(api, workspace, "owner")
    starter = next(f for f in ws_tree["spaces"][0]["folders"] if f["id"] == folder["id"])["lists"][0]
    ok(api.put(f"/lists/{starter['id']}/team", "owner", {"team_id": sales["id"]}))
    # Only a Sales List inside: Dev people don't get an empty "Special events" heading.
    assert "Special events" not in folder_names(api, workspace, "member")
    assert "Special events" in folder_names(api, workspace, "member2")
    assert "Special events" in folder_names(api, workspace, "admin")
    # Once a Dev List is added, the folder shows to Dev with just that List.
    dev_list = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Events - Dev"}), 201)
    ok(api.put(f"/lists/{dev_list['id']}/team", "owner", {"team_id": dev["id"]}))
    assert "Special events" in folder_names(api, workspace, "member")
    assert "Events - Dev" in list_names(api, workspace, "member") and "List" not in list_names(api, workspace, "member")


def test_highlights_say_whose_board_and_the_hours_logged(api, workspace, space, folderless_list):
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "member", {"name": "Draft", "assignees": ["member"]}), 201)
    home = ok(api.get(f"/workspaces/{workspace['id']}/dashboards/home", "member"))
    yesterday = datetime.now(timezone.utc).replace(hour=10, minute=0, second=0, microsecond=0) - timedelta(days=1)
    with db_session.new_session() as db:
        db.add(TimeEntry(task_id=task["id"], user_id="member", started_at=yesterday,
                         ended_at=yesterday + timedelta(hours=2), duration_seconds=7200))
        db.commit()
    out = ok(api.get(f"/dashboards/{home['id']}/insights", "member", params={"tz": "UTC"}))
    assert out["who"] == "me"
    assert out["logged_yesterday"] == 7200
    assert out["capacity_yesterday"] is not None
    assert {"starts_today", "over_estimate", "running_timers", "birthdays", "holidays_this_week"} <= set(out)


def test_highlights_add_what_no_card_says(api, workspace, folderless_list):
    """A timer left on, a task past its estimate, work held up by a late task, a birthday, and on a
    Team board, who logged nothing yesterday -- each said once, in a sentence."""
    from app.db.models import WorkspaceMember
    from app.services.work.dashboards.insights import sentences

    ws = workspace["id"]
    ok(api.get("/workspaces", "lead"))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": "lead@example.com", "role": "member"}), 201)
    ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["lead", "member"], "lead_ids": ["lead"]}), 201)
    lst = folderless_list["id"]
    now = datetime.now(timezone.utc)
    big = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Audit", "assignees": ["member"], "time_estimate_seconds": 3600}), 201)
    blocker = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Get bank letters", "assignees": ["lead"],
                                                           "due_date": (now - timedelta(days=2)).isoformat()}), 201)
    waiting = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "File return", "assignees": ["member"]}), 201)
    ok(api.post(f"/tasks/{blocker['id']}/links", "owner", {"other_id": waiting["id"], "kind": "blocking"}), 201)
    with db_session.new_session() as db:
        db.add(TimeEntry(task_id=big["id"], user_id="member", started_at=now - timedelta(days=3),
                         ended_at=now - timedelta(days=3) + timedelta(hours=2), duration_seconds=7200))
        db.add(TimeEntry(task_id=big["id"], user_id="member", started_at=now - timedelta(days=1, hours=1)))  # left running
        m = db.get(WorkspaceMember, (ws, "member"))
        m.date_of_birth = now.date().replace(year=1995)
        db.commit()

    home = ok(api.get(f"/workspaces/{ws}/dashboards/home", "member"))
    mine = ok(api.get(f"/dashboards/{home['id']}/insights", "member", params={"tz": "UTC"}))
    assert [t["name"] for t in mine["over_estimate"]["tasks"]] == ["Audit"]
    assert [t["task_name"] for t in mine["running_timers"]] == ["Audit"]
    assert [t["name"] for t in mine["blocked_by_late"]["tasks"]] == ["File return"]
    assert [p["id"] for p in mine["birthdays"]] == ["member"]
    assert mine["overloaded"] == [] and mine["no_time_yesterday"] == []  # Team items stay off a personal board
    said = " ".join(sentences(mine))
    assert "Your timer on Audit" in said and "birthday today" in said and "waiting on a task that is late" in said

    boards = {x["standard"]: x for x in ok(api.get(f"/workspaces/{ws}/dashboards", "lead"))}
    team = ok(api.get(f"/dashboards/{boards['team']['id']}/insights", "lead", params={"tz": "UTC"}))
    assert team["who"] == "team"
    assert {t["user"]["id"] for t in team["running_timers"]} == {"member"}
