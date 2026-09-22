import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Requests"}), 201)
    secret = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Salaries", "is_private": True}), 201)
    return {"ws": ws, "space": space, "lst": lst, "secret": secret}


def task(api, lst, name, **kw):
    return ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": name, **kw}), 201)


def test_all_tasks_shows_everything_you_can_open(api, org):
    task(api, org["lst"], "Laptop request")
    task(api, org["secret"], "Revise pay bands")
    other = ok(api.post(f"/workspaces/{org['ws']}/spaces", "owner", {"name": "Finance"}), 201)
    task(api, ok(api.post(f"/spaces/{other['id']}/lists", "owner", {"name": "Close"}), 201), "Book accruals")
    mine = {t["name"] for t in ok(api.get(f"/workspaces/{org['ws']}/all-tasks", "owner"))["tasks"]}
    assert mine == {"Laptop request", "Revise pay bands", "Book accruals"}
    theirs = {t["name"] for t in ok(api.get(f"/workspaces/{org['ws']}/all-tasks", "member"))["tasks"]}
    assert theirs == {"Laptop request", "Book accruals"}


def test_dependencies_and_activity_for_a_location(api, org):
    a, b = task(api, org["lst"], "Approve"), task(api, org["lst"], "Order laptop")
    hidden = task(api, org["secret"], "Budget")
    ok(api.post(f"/tasks/{b['id']}/links", "owner", {"other_id": a["id"], "kind": "waiting_on"}), 201)
    ok(api.post(f"/tasks/{b['id']}/links", "owner", {"other_id": hidden["id"], "kind": "waiting_on"}), 201)
    deps = ok(api.get(f"/spaces/{org['space']['id']}/dependencies", "member"))
    assert deps == [{"blocker_id": a["id"], "waiting_id": b["id"]}]  # the private one stays hidden
    ok(api.post(f"/tasks/{a['id']}/comments", "owner", {"body": "Approved by finance"}), 201)
    feed = ok(api.get(f"/lists/{org['lst']['id']}/activity", "member"))
    assert feed[0]["kind"] == "comment" and feed[0]["comment"] == "Approved by finance" and feed[0]["task_name"] == "Approve"
    assert {f["kind"] for f in feed} >= {"created", "dependency", "comment"}
    assert all(f["task_name"] != "Budget" for f in ok(api.get(f"/spaces/{org['space']['id']}/activity", "member")))


def test_forms_create_tasks_for_anyone_in_the_workspace(api, org):
    fee = ok(api.post(f"/lists/{org['secret']['id']}/fields", "owner", {"name": "Amount", "type": "money"}), 201)
    assert api.post(f"/spaces/{org['space']['id']}/views", "owner", {"type": "form"}).status_code == 400
    view = ok(api.post(f"/lists/{org['secret']['id']}/views", "owner", {"type": "form"}), 201)
    ok(api.patch(f"/views/{view['id']}", "owner", {"settings": {"form": {
        "title": "Reimbursement request", "description": "Claim expenses",
        "fields": [{"key": "name", "label": "What for?"}, {"key": "due_date"}, {"key": f"cf:{fee['id']}", "required": True}, {"key": "priority"}],
        "assignee_ids": ["admin"], "success": "We'll get back to you",
    }}}))
    # The member can't open the private List, but can use its form.
    form = ok(api.get(f"/forms/{view['id']}", "member"))
    assert form["title"] == "Reimbursement request" and [f["key"] for f in form["fields"]] == ["name", "due_date", f"cf:{fee['id']}", "priority"]
    assert form["fields"][2]["field"]["type"] == "money"
    r = api.post(f"/forms/{view['id']}/submit", "member", {"answers": {"name": "Taxi to client"}})
    assert r.status_code == 400 and "Amount" in r.json()["detail"]
    out = ok(api.post(f"/forms/{view['id']}/submit", "member", {"answers": {"name": "Taxi to client", f"cf:{fee['id']}": 540, "priority": 2, "due_date": "2026-10-05"}}), 201)
    assert out["message"] == "We'll get back to you"
    got = ok(api.get(f"/tasks/{out['task_id']}", "owner"))
    assert (got["name"], got["priority"], got["created_by"]) == ("Taxi to client", 2, "member")
    assert [a["id"] for a in got["assignees"]] == ["admin"] and got["custom_fields"][fee["id"]] == 540
    # The List stays private, but people can follow the request they made (they created it).
    assert api.get(f"/lists/{org['secret']['id']}", "member").status_code == 404
    assert ok(api.get(f"/tasks/{out['task_id']}", "member"))["name"] == "Taxi to client"
    # Guests can't use forms; a paused form takes no answers.
    assert api.get(f"/forms/{view['id']}", "guest").status_code == 404
    ok(api.patch(f"/views/{view['id']}", "owner", {"settings": {"form": {"active": False}}}))
    assert api.post(f"/forms/{view['id']}/submit", "member", {"answers": {"name": "x"}}).status_code == 403
