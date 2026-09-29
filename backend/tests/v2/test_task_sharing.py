"""Sharing one task with people: the same task, not a copy of it."""
from datetime import datetime, timedelta, timezone

import pytest

from tests.v2.conftest import ok


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


def test_a_shared_task_is_one_task_and_everyone_sees_the_same_hours(api, workspace, folderless_list):
    """The point of sharing rather than duplicating: an hour one person logs is an hour the other sees.

    A copy would drift. Two people would each track against their own row, the estimate would be
    compared against half the real time twice, and nobody could say how long the work took. This
    puts the one task in both their Lists instead.
    """
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "Working on the build"}), 201)

    shared = ok(api.post(f"/tasks/{task['id']}/shared-with", "owner", {"user_ids": ["member", "admin"]}))
    assert sorted(shared["people"]) == ["admin", "member"]
    # A Personal List stays invisible even to the admin who put work in it, so the sharer sees
    # only the home List -- and the names of the people, which is what they actually need.
    assert [l["home"] for l in shared["lists"]] == [True]

    # Both can now open it, and it is the same task -- same id, not a copy with a new one.
    for who in ("member", "admin"):
        theirs = ok(api.get(f"/tasks/{task['id']}", who))
        assert theirs["id"] == task["id"]
        # Sharing put both their names on it; the admin who shared it did not put their own.
        assert sorted(a["id"] for a in theirs["assignees"]) == ["admin", "member"]

    # One of them tracks two hours.
    now = datetime.now(timezone.utc)
    ok(api.post(f"/tasks/{task['id']}/time", "member",
                {"started_at": iso(now - timedelta(hours=2)), "ended_at": iso(now)}), 201)

    # The other sees them, because there is only one task to see them on.
    assert ok(api.get(f"/tasks/{task['id']}", "admin"))["time_tracked_seconds"] == 2 * 3600
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["time_tracked_seconds"] == 2 * 3600

    # And a comment from one is a comment for the other: one thread, not two.
    ok(api.post(f"/tasks/{task['id']}/comments", "admin", {"body": "Two hours in, going well"}), 201)
    assert [c["body"] for c in ok(api.get(f"/tasks/{task['id']}/comments", "member"))] == ["Two hours in, going well"]


def test_only_admins_put_work_in_someone_elses_personal_list(api, folderless_list):
    """A Personal List is private to its owner; that is what makes it personal.

    Handing someone work is what running the place consists of, so admins may. Anyone else may
    only share a task with themselves.
    """
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "Quarterly filing"}), 201)

    refused = api.post(f"/tasks/{task['id']}/shared-with", "member", {"user_ids": ["admin"]})
    assert refused.status_code == 403 and "admins" in refused.json()["detail"]

    # With themselves is always allowed: it is their own List.
    mine = ok(api.post(f"/tasks/{task['id']}/shared-with", "member", {"user_ids": ["member"]}))
    assert mine["people"] == ["member"]


def test_unsharing_takes_back_the_view_and_leaves_the_task_alone(api, folderless_list):
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "Board pack"}), 201)
    ok(api.post(f"/tasks/{task['id']}/shared-with", "owner", {"user_ids": ["member"]}))

    after = ok(api.delete(f"/tasks/{task['id']}/shared-with/member", "owner"))
    assert after["people"] == []
    # The task and its assignees are untouched -- unsharing is about where it shows, not who owns it.
    still = ok(api.get(f"/tasks/{task['id']}", "owner"))
    assert still["name"] == "Board pack" and "member" in [a["id"] for a in still["assignees"]]


def test_sharing_without_assigning_is_possible_but_not_the_default(api, folderless_list):
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "For your information"}), 201)
    ok(api.post(f"/tasks/{task['id']}/shared-with", "owner", {"user_ids": ["member"], "assign": False}))
    assert [a["id"] for a in ok(api.get(f"/tasks/{task['id']}", "owner"))["assignees"]] == []
    assert ok(api.get(f"/tasks/{task['id']}", "member"))["name"] == "For your information"
