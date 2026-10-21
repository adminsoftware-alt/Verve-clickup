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


def test_a_form_can_no_longer_be_added(api, org):
    """Forms lived on a List, and a List now shows only its List view (2026-10-16)."""
    assert api.post(f"/spaces/{org['space']['id']}/views", "owner", {"type": "form"}).status_code == 400
    assert api.post(f"/lists/{org['secret']['id']}/views", "owner", {"type": "form"}).status_code == 400

