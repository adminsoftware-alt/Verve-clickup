import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    hr = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR & Admin"}), 201)
    fin = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Finance"}), 201)
    a = ok(api.post(f"/spaces/{hr['id']}/lists", "owner", {"name": "Onboarding"}), 201)
    b = ok(api.post(f"/spaces/{fin['id']}/lists", "owner", {"name": "Payroll"}), 201)
    return {"ws": ws, "hr": hr, "fin": fin, "a": a, "b": b}


def new(api, lst, name, who="owner", **extra):
    return ok(api.post(f"/lists/{lst['id']}/tasks", who, {"name": name, **extra}), 201)


def test_custom_task_ids_per_space(api, org):
    assert org["hr"]["task_prefix"] == "HRA"
    t1, t2 = new(api, org["a"], "One"), new(api, org["a"], "Two")
    assert (t1["custom_id"], t2["custom_id"]) == ("HRA-1", "HRA-2")
    sub = new(api, org["a"], "Sub", parent_id=t1["id"])
    assert sub["custom_id"] == "HRA-3"
    # A new prefix shows on every task at once.
    ok(api.patch(f"/spaces/{org['hr']['id']}", "owner", {"task_prefix": "hr"}))
    assert ok(api.get(f"/tasks/{t2['id']}", "owner"))["custom_id"] == "HR-2"
    # Moving to another Space takes that Space's numbers.
    moved = ok(api.post(f"/tasks/{t1['id']}/move", "owner", {"list_id": org["b"]["id"]}))
    assert moved["custom_id"] == "FIN-1"
    assert ok(api.get(f"/tasks/{sub['id']}", "owner"))["custom_id"] == "FIN-2"
    copy = ok(api.post(f"/tasks/{t2['id']}/duplicate", "owner", {}), 201)
    assert copy["custom_id"] == "HR-4"
    # Search finds a task by its ID.
    found = ok(api.get(f"/workspaces/{org['ws']}/search/tasks", "owner", params={"q": "hr-2"}))
    assert found[0]["id"] == t2["id"]
    assert api.patch(f"/spaces/{org['hr']['id']}", "owner", {"task_prefix": "HR-1"}).status_code == 422


def test_task_types_and_milestones(api, org):
    types = ok(api.get(f"/workspaces/{org['ws']}/task-types", "owner"))
    assert [(t["name"], t["is_milestone"]) for t in types] == [("Milestone", True)]
    req = ok(api.post(f"/workspaces/{org['ws']}/task-types", "owner", {"name": "Request", "icon": "inbox", "color": "#0ea5e9"}), 201)
    assert api.post(f"/workspaces/{org['ws']}/task-types", "member", {"name": "Bug"}).status_code == 403
    assert api.post(f"/workspaces/{org['ws']}/task-types", "owner", {"name": "task"}).status_code == 400
    t = new(api, org["a"], "Go-live", type_id=types[0]["id"])
    assert t["type_id"] == types[0]["id"]
    ok(api.patch(f"/tasks/{t['id']}", "owner", {"type_id": req["id"]}))
    history = ok(api.get(f"/tasks/{t['id']}/activity", "owner"))
    assert history[-1]["kind"] == "task_type" and history[-1]["data"]["to"] == "Request"
    ok(api.delete(f"/workspaces/{org['ws']}/task-types/{req['id']}", "owner"), 204)
    assert ok(api.get(f"/tasks/{t['id']}", "owner"))["type_id"] is None


def test_favourites_follow_what_you_can_see(api, org):
    ws = org["ws"]
    t = new(api, org["a"], "Prepare offer letter")
    ok(api.post(f"/workspaces/{ws}/favorites", "member", {"kind": "list", "target_id": org["a"]["id"]}), 201)
    favs = ok(api.post(f"/workspaces/{ws}/favorites", "member", {"kind": "task", "target_id": t["id"]}), 201)
    assert [(f["kind"], f["name"]) for f in favs] == [("list", "Onboarding"), ("task", "Prepare offer letter")]
    assert favs[1]["list_id"] == org["a"]["id"]
    ok(api.post(f"/workspaces/{ws}/favorites", "member", {"kind": "task", "target_id": t["id"]}), 201)  # no duplicates
    favs = ok(api.put(f"/workspaces/{ws}/favorites/order", "member", {"ids": [favs[1]["id"], favs[0]["id"]]}))
    assert [f["kind"] for f in favs] == ["task", "list"]
    # When the List goes private, both drop out.
    ok(api.patch(f"/lists/{org['a']['id']}", "owner", {"is_private": True}))
    assert ok(api.get(f"/workspaces/{ws}/favorites", "member")) == []
    assert ok(api.get(f"/workspaces/{ws}/favorites", "owner")) == []  # favourites are personal
    assert api.post(f"/workspaces/{ws}/favorites", "member", {"kind": "list", "target_id": org["a"]["id"]}).status_code == 404


def test_tag_manager(api, org):
    t1 = new(api, org["a"], "A", tags=["urgent"])
    t2 = new(api, org["a"], "B", tags=["Urgent-2", "docs"])
    tags = {x["name"]: x for x in ok(api.get(f"/spaces/{org['hr']['id']}/tags", "owner"))}
    assert tags["urgent"]["task_count"] == 1 and tags["docs"]["task_count"] == 1
    ok(api.patch(f"/tags/{tags['docs']['id']}", "owner", {"name": "documents", "bg_color": "#fee2e2"}))
    # Renaming onto an existing name merges the two.
    merged = ok(api.patch(f"/tags/{tags['Urgent-2']['id']}", "owner", {"name": "Urgent"}))
    assert merged["id"] == tags["urgent"]["id"]
    after = {x["name"]: x for x in ok(api.get(f"/spaces/{org['hr']['id']}/tags", "owner"))}
    assert after["urgent"]["task_count"] == 2 and "Urgent-2" not in after and after["documents"]["bg_color"] == "#fee2e2"
    ok(api.post(f"/spaces/{org['hr']['id']}/tags", "owner", {"name": "Q3"}), 201)
    assert api.post(f"/spaces/{org['hr']['id']}/tags", "owner", {"name": "q3"}).status_code == 400
    ok(api.delete(f"/tags/{after['urgent']['id']}", "owner"), 204)
    assert ok(api.get(f"/tasks/{t1['id']}", "owner"))["tags"] == []
    assert [x["name"] for x in ok(api.get(f"/tasks/{t2['id']}", "owner"))["tags"]] == ["documents"]
    assert api.post(f"/spaces/{org['hr']['id']}/tags", "guest", {"name": "x"}).status_code == 404


def test_view_options(api, org):
    L = org["a"]["id"]
    board = ok(api.post(f"/lists/{L}/views", "owner", {"type": "board"}), 201)
    mine = ok(api.post(f"/lists/{L}/views", "member", {"type": "table", "private": True}), 201)
    assert mine["private"] is True
    assert [v["name"] for v in ok(api.get(f"/lists/{L}/views", "owner"))] == ["List", "Board"]
    assert "Table" in [v["name"] for v in ok(api.get(f"/lists/{L}/views", "member"))]
    assert api.patch(f"/views/{mine['id']}", "owner", {"name": "x"}).status_code == 404
    # Default view comes first.
    ok(api.patch(f"/views/{board['id']}", "owner", {"is_default": True}))
    assert ok(api.get(f"/lists/{L}/views", "owner"))[0]["id"] == board["id"]
    # Protected views refuse changes until unprotected — and only the creator or an admin may unprotect.
    ok(api.patch(f"/views/{board['id']}", "owner", {"protected": True}))
    assert api.patch(f"/views/{board['id']}", "member", {"settings": {"groupBy": "none"}}).status_code == 403
    assert api.patch(f"/views/{board['id']}", "member", {"protected": False}).status_code == 403
    assert api.delete(f"/views/{board['id']}", "owner").status_code == 403
    ok(api.patch(f"/views/{board['id']}", "owner", {"protected": False, "name": "Kanban"}))
    # Rename and reorder.
    ok(api.patch(f"/views/{board['id']}", "member", {"orderindex": 0.5}))


def test_list_info_dates(api, org):
    got = ok(api.patch(f"/lists/{org['a']['id']}", "owner", {"start_date": "2026-10-01T00:00:00", "due_date": "2026-10-31T00:00:00"}))
    assert got["start_date"].startswith("2026-10-01") and got["due_date"].startswith("2026-10-31")
    assert api.patch(f"/lists/{org['a']['id']}", "owner", {"due_date": "2026-09-01T00:00:00"}).status_code == 400
