from datetime import datetime, timedelta, timezone

from tests.v2.conftest import ok


def iso(dt):
    return dt.isoformat()


# --- views -------------------------------------------------------------------


def test_spaces_open_on_overview_and_lists_on_list_view(api, space, folderless_list):
    space_views = ok(api.get(f"/spaces/{space['id']}/views", "owner"))
    assert [(v["type"], v["is_required"]) for v in space_views] == [("overview", True), ("list", True)]
    list_views = ok(api.get(f"/lists/{folderless_list['id']}/views", "owner"))
    assert [(v["type"], v["name"], v["is_required"]) for v in list_views] == [("list", "List", True)]


def test_overview_cannot_be_added_or_deleted(api, space):
    assert api.post(f"/spaces/{space['id']}/views", "owner", {"type": "overview"}).status_code == 400
    overview = ok(api.get(f"/spaces/{space['id']}/views", "owner"))[0]
    assert api.delete(f"/views/{overview['id']}", "owner").status_code == 400


def test_views_are_added_in_order_and_the_required_one_cannot_be_deleted(api, folderless_list):
    path = f"/lists/{folderless_list['id']}/views"
    ok(api.post(path, "owner", {"type": "calendar"}), 201)
    ok(api.post(path, "owner", {"type": "dashboard", "name": "Review"}), 201)
    views = ok(api.get(path, "owner"))
    assert [v["name"] for v in views] == ["List", "Calendar", "Review"]
    required = views[0]
    assert api.delete(f"/views/{required['id']}", "owner").status_code == 400
    ok(api.delete(f"/views/{views[1]['id']}", "owner"), 204)
    assert [v["name"] for v in ok(api.get(path, "owner"))] == ["List", "Review"]


def test_view_only_access_cannot_add_views(api, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    assert api.post(f"/lists/{folderless_list['id']}/views", "member", {"type": "calendar"}).status_code == 403


# --- tasks above a single List -----------------------------------------------


def test_space_and_folder_views_gather_tasks_from_their_lists(api, space, folderless_list):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Learning"}), 201)
    folder_list = ok(api.get(f"/folders/{folder['id']}/views", "owner"))  # touch: views exist
    assert folder_list
    tree = ok(api.get(f"/workspaces/{space['workspace_id']}/hierarchy", "owner"))
    team_list = tree["spaces"][0]["folders"][0]["lists"][0]["id"]
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "in space"}), 201)
    ok(api.post(f"/lists/{team_list}/tasks", "owner", {"name": "in folder"}), 201)

    space_tasks = ok(api.get(f"/spaces/{space['id']}/tasks", "owner"))["tasks"]
    assert sorted(t["name"] for t in space_tasks) == ["in folder", "in space"]
    folder_tasks = ok(api.get(f"/folders/{folder['id']}/tasks", "owner"))["tasks"]
    assert [t["name"] for t in folder_tasks] == ["in folder"]


def test_space_view_hides_tasks_in_lists_the_caller_cannot_see(api, space, folderless_list):
    private = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Secret", "is_private": True}), 201)
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "public"}), 201)
    ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "secret"}), 201)
    names = [t["name"] for t in ok(api.get(f"/spaces/{space['id']}/tasks", "member"))["tasks"]]
    assert names == ["public"]


def test_calendar_window_keeps_tasks_starting_or_due_inside_it(api, folderless_list):
    list_id = folderless_list["id"]
    base = datetime(2026, 10, 1, tzinfo=timezone.utc)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "due inside", "due_date": iso(base + timedelta(days=3))}), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "starts inside", "start_date": iso(base + timedelta(days=5)), "due_date": iso(base + timedelta(days=60))}), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "outside", "due_date": iso(base + timedelta(days=90))}), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "undated"}), 201)
    params = {"date_from": iso(base), "date_to": iso(base + timedelta(days=31))}
    names = sorted(t["name"] for t in ok(api.get(f"/lists/{list_id}/tasks", "owner", params=params))["tasks"])
    assert names == ["due inside", "starts inside"]


# --- dashboard ---------------------------------------------------------------


def test_dashboard_counts_the_hygiene_buckets(api, folderless_list):
    list_id = folderless_list["id"]
    now = datetime.now(timezone.utc)
    statuses = {s["name"]: s["id"] for s in ok(api.get(f"/lists/{list_id}/statuses", "owner"))["statuses"]}

    # Overdue, unassigned, no estimate.
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "late", "due_date": iso(now - timedelta(days=2))}), 201)
    # Fully set up: assigned, estimated, scheduled in the future.
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {
        "name": "tidy", "assignees": ["member"], "time_estimate_seconds": 3600, "due_date": iso(now + timedelta(days=2)),
    }), 201)
    # Unscheduled and unassigned.
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "floating", "time_estimate_seconds": 600}), 201)
    # Finished today.
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "shipped", "status_id": statuses["Complete"]}), 201)

    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    d = ok(api.get(f"/lists/{list_id}/dashboard", "owner", params={"day_start": iso(day_start)}))
    assert d["total_open"] == 3
    assert [t["name"] for t in d["overdue"]["tasks"]] == ["late"]
    assert sorted(t["name"] for t in d["unassigned"]["tasks"]) == ["floating", "late"]
    assert [t["name"] for t in d["no_estimate"]["tasks"]] == ["late"]
    assert [t["name"] for t in d["unscheduled"]["tasks"]] == ["floating"]
    assert [t["name"] for t in d["done_today"]["tasks"]] == ["shipped"]
    assert {s["name"]: s["count"] for s in d["by_status"]} == {"To do": 3}  # closed work is left out
    by_user = {(a["user"]["id"] if a["user"] else None): a["count"] for a in d["by_assignee"]}
    assert by_user == {"member": 1, None: 2}
