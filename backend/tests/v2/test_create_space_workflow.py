"""ClickUp's Create a Space: default permission, then the workflow -- statuses, views, ClickApps."""

from tests.v2.conftest import ok


def make(api, workspace, **extra):
    return ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Marketing", **extra}), 201)


def test_a_plain_space_keeps_the_old_defaults(api, workspace):
    sp = make(api, workspace)
    assert sp["default_permission"] is None
    names = [s["name"] for s in ok(api.get(f"/spaces/{sp['id']}/statuses", "owner"))["statuses"]]
    assert names == ["To do", "In progress", "Complete"]


def test_the_workflow_chosen_is_the_one_made(api, workspace):
    sp = make(api, workspace, description="Campaigns", icon="M", color="#7b68ee",
              statuses=[{"name": "Idea", "color": "#87909e", "group": "not_started"},
                        {"name": "In review", "color": "#5b9fef", "group": "active"},
                        {"name": "Live", "color": "#008844", "group": "closed"}],
              views=["board", "calendar"], clickapps={"sprint_points": True, "time_tracking": False})
    assert sp["description"] == "Campaigns" and sp["clickapps"]["sprint_points"] and not sp["clickapps"]["time_tracking"]
    names = [s["name"] for s in ok(api.get(f"/spaces/{sp['id']}/statuses", "owner"))["statuses"]]
    assert names == ["Idea", "In review", "Live"]
    # The Space and its new Folders open with the chosen views; a List keeps only its List view.
    assert [v["type"] for v in ok(api.get(f"/spaces/{sp['id']}/views", "owner"))] == ["overview", "list", "board", "calendar"]
    folder = ok(api.post(f"/spaces/{sp['id']}/folders", "owner", {"name": "Q4"}), 201)
    assert [v["type"] for v in ok(api.get(f"/folders/{folder['id']}/views", "owner"))] == ["overview", "list", "board", "calendar"]
    lst = ok(api.post(f"/spaces/{sp['id']}/lists", "owner", {"name": "Q4 list"}), 201)
    assert [v["type"] for v in ok(api.get(f"/lists/{lst['id']}/views", "owner"))] == ["list"]


def test_a_status_set_without_a_closed_status_is_refused(api, workspace):
    r = api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Bad", "statuses": [
        {"name": "A", "color": "#87909e", "group": "not_started"}, {"name": "B", "color": "#5b9fef", "group": "active"}]})
    assert r.status_code == 400 and "closed" in r.json()["detail"]


def test_default_permission_holds_members_to_it(api, workspace):
    sp = make(api, workspace, default_permission="comment")
    lst = ok(api.post(f"/spaces/{sp['id']}/lists", "owner", {"name": "Plans"}), 201)
    assert ok(api.get(f"/lists/{lst['id']}", "member"))["permission_level"] == "comment"
    assert ok(api.get(f"/lists/{lst['id']}", "admin"))["permission_level"] == "full"
    r = api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "Try"})
    assert r.status_code == 403
    # Raised back to full edit, members can work in it again.
    ok(api.patch(f"/spaces/{sp['id']}", "owner", {"default_permission": "full"}))
    assert ok(api.get(f"/lists/{lst['id']}", "member"))["permission_level"] == "full"
