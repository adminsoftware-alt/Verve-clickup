"""Holes found by asking the running server directly (the 14 Oct test report).

Each test here is one of them: what a colleague could read about a colleague, what an employee
could still add to a task they may only comment on, the task given to someone in a List they
can't open, the private List nobody but its maker could open, a leaver offered when building a
Team, and the 403 that should have said "not signed in".
"""
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.main import app
from tests.v2.conftest import ok

PRIVATE = {
    "phone": "+91 98200 00000", "employee_code": "VAPL-042", "date_of_joining": "2021-04-01",
    "date_of_birth": "1995-06-15", "marriage_anniversary": "2020-11-20", "address": "12 Hill Road",
}


def join(api, ws, uid, role="member"):
    ok(api.get("/workspaces", uid))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": role}), 201)


def area(api, ws):
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Client work"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Audits"}), 201)
    return space, lst


# --- #4: a colleague's private details, and the admin settings ------------------------------------

def test_a_colleagues_private_details_go_only_to_admins_themselves_and_their_manager(api, workspace):
    ws = workspace["id"]
    join(api, ws, "member2")
    join(api, ws, "lead")
    # member and member2 are Team-mates, so each sees the other in the directory; lead leads them.
    ok(api.post(f"/workspaces/{ws}/teams", "owner",
                {"name": "Audit", "member_ids": ["member", "member2", "lead"], "lead_ids": ["lead"]}), 201)
    ok(api.patch(f"/workspaces/{ws}/people/member2", "owner", PRIVATE))

    colleague = ok(api.get(f"/workspaces/{ws}/people/member2", "member"))
    assert colleague["designation"] is None or isinstance(colleague["designation"], str)
    for field in PRIVATE:
        assert colleague[field] is None, field
    listed = next(p for p in ok(api.get(f"/workspaces/{ws}/people", "member")) if p["user"]["id"] == "member2")
    for field in PRIVATE:
        assert listed[field] is None, field

    # Their Manager sees how to reach them and their HR record, not their birthday.
    managed = ok(api.get(f"/workspaces/{ws}/people/member2", "lead"))
    assert managed["phone"] == PRIVATE["phone"] and managed["employee_code"] == "VAPL-042"
    assert managed["date_of_joining"] == "2021-04-01"
    assert managed["date_of_birth"] is None and managed["marriage_anniversary"] is None

    for who in ("member2", "owner", "admin"):
        everything = ok(api.get(f"/workspaces/{ws}/people/member2", who))
        for field, value in PRIVATE.items():
            assert everything[field] == value, (who, field)


def test_admin_settings_are_admin_only_to_read_too(api, workspace):
    ws = workspace["id"]
    for path in ("sign-in-rules", "joiner-plan", "email-status", "blocked-emails"):
        assert api.get(f"/workspaces/{ws}/{path}", "member").status_code == 403, path
        ok(api.get(f"/workspaces/{ws}/{path}", "admin"))


# --- #9 and #10: private Lists -------------------------------------------------------------------

def test_an_assignee_opens_their_task_in_a_private_list(api, workspace):
    ws = workspace["id"]
    space, _ = area(api, ws)
    private = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Board"}), 201)
    given = ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "Minutes", "assignees": ["member"]}), 201)
    other = ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "Not yours"}), 201)
    # Given while the List was open, then the List was made private: the notification still
    # points at the task, and the task has to open.
    ok(api.patch(f"/lists/{private['id']}", "owner", {"is_private": True}))

    assert ok(api.get(f"/tasks/{given['id']}", "member"))["name"] == "Minutes"
    ok(api.patch(f"/tasks/{given['id']}", "member", {"priority": 2}))
    # The task, not the List: its other tasks and the List itself stay closed.
    assert api.get(f"/tasks/{other['id']}", "member").status_code == 404
    assert api.get(f"/lists/{private['id']}", "member").status_code == 404


def test_admins_open_a_private_list_someone_else_made(api, workspace):
    ws = workspace["id"]
    space, _ = area(api, ws)
    private = ok(api.post(f"/spaces/{space['id']}/lists", "admin", {"name": "Mine alone", "is_private": True}), 201)
    ok(api.get(f"/lists/{private['id']}", "owner"))
    assert api.get(f"/lists/{private['id']}", "member").status_code == 404
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "admin", {"name": "Closed", "is_private": True}), 201)
    ok(api.get(f"/folders/{folder['id']}", "owner"))
    hidden = ok(api.post(f"/workspaces/{ws}/spaces", "admin", {"name": "Secret", "is_private": True}), 201)
    ok(api.get(f"/spaces/{hidden['id']}", "owner"))
    assert api.get(f"/spaces/{hidden['id']}", "member").status_code == 404


# --- #11: comment access adds nothing to the task ------------------------------------------------

def test_comment_access_cannot_attach_add_subtasks_or_copy(api, workspace):
    ws = workspace["id"]
    _space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Sharma audit", "assignees": ["admin"]}), 201)
    assert ok(api.get(f"/tasks/{theirs['id']}", "member"))["permission_level"] == "comment"

    upload = api.post(f"/tasks/{theirs['id']}/attachments", "member", files={"file": ("x.txt", b"hello", "text/plain")})
    assert upload.status_code == 403
    sub = api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "Mine under theirs", "parent_id": theirs["id"]})
    assert sub.status_code == 403
    assert api.post(f"/tasks/{theirs['id']}/duplicate", "member", {}).status_code == 403
    assert api.post(f"/tasks/{theirs['id']}/duplicate-to-people", "member", {"user_ids": ["member"]}).status_code == 403

    # Commenting still works, and the owner still can do all three.
    ok(api.post(f"/tasks/{theirs['id']}/comments", "member", {"body": "Looks fine"}), 201)
    ok(api.post(f"/tasks/{theirs['id']}/attachments", "owner", files={"file": ("x.txt", b"hello", "text/plain")}), 201)
    ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Step", "parent_id": theirs["id"]}), 201)
    ok(api.post(f"/tasks/{theirs['id']}/duplicate", "owner", {}), 201)


# --- #21: a leaver is not offered for a Team -----------------------------------------------------

def test_someone_who_has_left_cannot_be_put_in_a_team(api, workspace):
    ws = workspace["id"]
    join(api, ws, "member2")
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "member_ids": ["member2"]}), 201)
    ok(api.post(f"/workspaces/{ws}/people/member/deactivate", "owner"))
    refused = api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Tax", "member_ids": ["member"]})
    assert refused.status_code == 400 and "left" in refused.json()["detail"]
    assert api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["member2", "member"]}).status_code == 400
    # A leaver already in a Team doesn't stop that Team being saved.
    ok(api.post(f"/workspaces/{ws}/people/member2/deactivate", "owner"))
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["member2"]}))


# --- #15 and #22 ---------------------------------------------------------------------------------

def test_leave_is_gone_from_the_server():
    assert not [r.path for r in app.routes if "leave" in getattr(r, "path", "").lower()]


def test_not_signed_in_is_401_not_403(database_url):
    previous = app.dependency_overrides.pop(get_current_user, None)
    try:
        client = TestClient(app)
        assert client.get("/api/v2/workspaces").status_code == 401
        assert client.get("/api/v2/me", headers={"Authorization": "Bearer "}).status_code == 401
    finally:
        if previous is not None:
            app.dependency_overrides[get_current_user] = previous
