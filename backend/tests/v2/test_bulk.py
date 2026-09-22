from datetime import datetime, timezone

import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    payroll = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    audit = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Audit"}), 201)
    # Audit has its own statuses, without "in progress".
    ok(api.put(f"/lists/{audit['id']}/statuses", "owner", {"statuses": [
        {"name": "open", "color": "#87909e", "group": "not_started"},
        {"name": "review", "color": "#1090e0", "group": "active"},
        {"name": "closed", "color": "#008844", "group": "closed"},
    ]}))
    due = datetime(2026, 10, 1, tzinfo=timezone.utc).isoformat()
    a = ok(api.post(f"/lists/{payroll['id']}/tasks", "owner", {"name": "Salary sheet", "due_date": due}), 201)
    b = ok(api.post(f"/lists/{payroll['id']}/tasks", "owner", {"name": "PF challan", "tags": ["monthly"]}), 201)
    c = ok(api.post(f"/lists/{audit['id']}/tasks", "owner", {"name": "Vendor audit"}), 201)
    return {"ws": ws, "space": space, "payroll": payroll, "audit": audit, "a": a, "b": b, "c": c}


def task(api, t, who="owner"):
    return ok(api.get(f"/tasks/{t['id']}", who))


def test_bulk_status_priority_assignees_and_tags_across_lists(api, org):
    ids = [org["a"]["id"], org["b"]["id"], org["c"]["id"]]
    out = ok(api.post("/tasks/bulk", "owner", {
        "task_ids": ids, "status": "In Progress", "priority": 1,
        "add_assignees": ["member"], "add_tags": ["urgent"],
    }))
    # Audit has no "in progress", so that task is skipped with a reason; the rest change.
    assert out["updated"] == ids[:2]
    assert [(x["name"], x["reason"]) for x in out["skipped"]] == [("Vendor audit", "Its List has no “In Progress” status")]
    for t in (org["a"], org["b"]):
        got = task(api, t)
        assert got["status"]["name"] == "In progress" and got["priority"] == 1
        assert [u["id"] for u in got["assignees"]] == ["member"]
    assert sorted(x["name"] for x in task(api, org["b"])["tags"]) == ["monthly", "urgent"]
    # The change is in each task's history, like a single edit.
    kinds = {h["kind"] for h in ok(api.get(f"/tasks/{org['a']['id']}/activity", "owner"))}
    assert {"status", "priority", "assignees", "tags"} <= kinds


def test_bulk_remove_clear_and_archive(api, org):
    ids = [org["a"]["id"], org["b"]["id"]]
    ok(api.post("/tasks/bulk", "owner", {"task_ids": ids, "add_assignees": ["member", "admin"]}))
    ok(api.post("/tasks/bulk", "owner", {"task_ids": ids, "remove_assignees": ["member"], "remove_tags": ["Monthly"], "due_date": None}))
    a, b = task(api, org["a"]), task(api, org["b"])
    assert [u["id"] for u in a["assignees"]] == ["admin"] and a["due_date"] is None
    assert b["tags"] == []
    ok(api.post("/tasks/bulk", "owner", {"task_ids": ids, "archived": True}))
    assert task(api, org["a"])["archived"] is True
    listed = ok(api.get(f"/lists/{org['payroll']['id']}/tasks", "owner"))["tasks"]
    assert listed == []


def test_bulk_move_and_delete(api, org):
    out = ok(api.post("/tasks/bulk", "owner", {"task_ids": [org["a"]["id"], org["b"]["id"]], "list_id": org["audit"]["id"]}))
    assert len(out["updated"]) == 2
    moved = task(api, org["a"])
    assert moved["list_id"] == org["audit"]["id"] and moved["status"]["name"] == "open"
    sub = ok(api.post(f"/lists/{org['audit']['id']}/tasks", "owner", {"name": "Step", "parent_id": org["c"]["id"]}), 201)
    # Deleting a parent and its subtask together: the subtask goes with the parent, not "not found".
    out = ok(api.post("/tasks/bulk", "owner", {"task_ids": [org["c"]["id"], sub["id"]], "delete": True}))
    assert out["updated"] == [org["c"]["id"]] and out["skipped"] == []
    assert api.get(f"/tasks/{sub['id']}", "owner").status_code == 404


def test_bulk_respects_each_tasks_permissions(api, org):
    # Payroll becomes private; the member may only view it.
    ok(api.patch(f"/lists/{org['payroll']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/lists/{org['payroll']['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    out = ok(api.post("/tasks/bulk", "member", {"task_ids": [org["a"]["id"], org["c"]["id"]], "priority": 2}))
    assert out["updated"] == [org["c"]["id"]]
    assert out["skipped"][0]["reason"] == "You need edit access to change this task"
    assert task(api, org["a"])["priority"] is None
    # Deleting needs full access; someone who can't see a task learns nothing about it.
    out = ok(api.post("/tasks/bulk", "guest", {"task_ids": [org["a"]["id"]], "delete": True}))
    assert out["skipped"] == [{"id": org["a"]["id"], "name": "", "reason": "Not found, or you can't see it"}]


def test_search_finds_only_tasks_you_can_open(api, org):
    ok(api.post(f"/lists/{org['payroll']['id']}/tasks", "owner", {"name": "Quarterly TDS return", "description": "Form 24Q"}), 201)
    ok(api.post(f"/lists/{org['audit']['id']}/tasks", "owner", {"name": "Review 24Q working"}), 201)
    ok(api.post(f"/lists/{org['audit']['id']}/tasks", "owner", {"name": "100%_done? odd name"}), 201)
    names = lambda who, q: [t["name"] for t in ok(api.get(f"/workspaces/{org['ws']}/search/tasks", who, params={"q": q}))]  # noqa: E731
    # Name matches come before description matches.
    assert names("owner", "24q") == ["Review 24Q working", "Quarterly TDS return"]
    assert names("owner", "%_") == ["100%_done? odd name"]  # wildcards are searched literally
    # Private work stays private.
    ok(api.patch(f"/lists/{org['payroll']['id']}", "owner", {"is_private": True}))
    assert names("member", "24q") == ["Review 24Q working"]
    assert api.get(f"/workspaces/{org['ws']}/search/tasks", "outsider", params={"q": "24q"}).status_code == 404


def test_team_view_can_be_added(api, org):
    view = ok(api.post(f"/lists/{org['payroll']['id']}/views", "owner", {"type": "team"}), 201)
    assert (view["type"], view["name"]) == ("team", "Team")
