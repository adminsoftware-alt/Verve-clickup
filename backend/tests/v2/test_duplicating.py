"""What a duplicate carries, and whose desk it lands on."""
from datetime import datetime, timedelta, timezone

from tests.v2.conftest import ok


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def _furnished(api, list_id):
    """A task with something of everything on it, so a copy has something to drop."""
    now = datetime.now(timezone.utc)
    task = ok(api.post(f"/lists/{list_id}/tasks", "owner", {
        "name": "Quarterly filing", "assignees": ["member"], "priority": 2,
        "start_date": iso(now), "due_date": iso(now + timedelta(days=3)),
        "time_estimate_seconds": 7200, "tags": ["gst"],
    }), 201)
    ok(api.post(f"/tasks/{task['id']}/checklists", "owner", {"name": "Steps"}), 201)
    ok(api.post(f"/tasks/{task['id']}/comments", "owner", {"body": "Client sent the workings"}), 201)
    return task


def test_everything_comes_across_when_everything_is_asked_for(api, folderless_list):
    task = _furnished(api, folderless_list["id"])
    copy = ok(api.post(f"/tasks/{task['id']}/duplicate", "owner", {
        "parts": {"comments": True},
    }), 201)

    assert copy["id"] != task["id"] and copy["name"] == "Quarterly filing (copy)"
    assert [a["id"] for a in copy["assignees"]] == ["member"]
    assert copy["priority"] == 2 and copy["due_date"] is not None
    assert [t["name"] for t in copy["tags"]] == ["gst"]
    assert [c["name"] for c in ok(api.get(f"/tasks/{copy['id']}/checklists", "owner"))] == ["Steps"]
    # The conversation comes over in the name of whoever said it, not the person copying.
    said = ok(api.get(f"/tasks/{copy['id']}/comments", "owner"))
    assert [c["body"] for c in said] == ["Client sent the workings"]
    assert said[0]["user"]["id"] == "owner"


def test_unticking_a_part_leaves_it_behind(api, folderless_list):
    """The point of Customize: a copy that carries someone else's dates is a copy already late."""
    task = _furnished(api, folderless_list["id"])
    bare = ok(api.post(f"/tasks/{task['id']}/duplicate", "owner", {
        "name": "Next quarter",
        "parts": {
            "assignees": False, "dates": False, "tags": False, "checklists": False,
            "comments": False, "custom_fields": False, "attachments": False,
        },
    }), 201)

    assert bare["name"] == "Next quarter"
    assert bare["assignees"] == [] and bare["tags"] == []
    assert bare["start_date"] is None and bare["due_date"] is None
    assert ok(api.get(f"/tasks/{bare['id']}/checklists", "owner")) == []
    assert ok(api.get(f"/tasks/{bare['id']}/comments", "owner")) == []
    # Priority and estimate are the shape of the work, not its history: they always come.
    assert bare["priority"] == 2 and bare["time_estimate_seconds"] == 7200


def test_comments_stay_behind_by_default(api, folderless_list):
    """A copy that repeats last quarter's conversation is a copy that lies about itself."""
    task = _furnished(api, folderless_list["id"])
    copy = ok(api.post(f"/tasks/{task['id']}/duplicate", "owner", {}), 201)
    assert ok(api.get(f"/tasks/{copy['id']}/comments", "owner")) == []


def test_a_copy_each_lands_on_their_own_lists(api, workspace, folderless_list):
    """The other half of the choice: separate tasks, assigned to their owners."""
    task = _furnished(api, folderless_list["id"])
    out = ok(api.post(f"/tasks/{task['id']}/duplicate-to-people", "owner",
                      {"user_ids": ["member", "admin"], "name": "Quarterly filing (yours)"}), 201)
    assert sorted(out["people"]) == ["admin", "member"]

    # Each gets their own, with their own name on it -- not the source task's assignee.
    for who in ("member", "admin"):
        page = ok(api.get(f"/workspaces/{workspace['id']}/my-tasks", who))
        mine = [t for t in page["tasks"] if t["name"] == "Quarterly filing (yours)"]
        assert len(mine) == 1
        assert [a["id"] for a in mine[0]["assignees"]] == [who]
        assert mine[0]["id"] != task["id"]


def test_only_admins_put_a_copy_on_someone_elses_list(api, folderless_list):
    task = _furnished(api, folderless_list["id"])
    refused = api.post(f"/tasks/{task['id']}/duplicate-to-people", "member", {"user_ids": ["admin"]})
    assert refused.status_code == 403 and "admins" in refused.json()["detail"]
    ok(api.post(f"/tasks/{task['id']}/duplicate-to-people", "member", {"user_ids": ["member"]}), 201)
