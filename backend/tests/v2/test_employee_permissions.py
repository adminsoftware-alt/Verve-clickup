"""What an employee may do, and what only an admin may do.

The firm has two tiers and no middle: admins do everything, and everybody else -- interns, executives,
senior executives, managers -- is an employee. An employee reads the work, raises tasks, finishes or
removes the ones that are theirs, and records their hours. They do not restructure the workspace and
they do not touch a colleague's task.

Most of that was already enforced. Three things were not, and all three were found by asking the
running server rather than reading the source, which is the only way to get an answer about a
permission that resolves up a chain of Spaces, Folders, Lists and shares:

  * an employee could rename a colleague's task;
  * an employee could permanently delete one, because deleting needs full access and every member
    resolved to full on anything in a public Space;
  * anyone leading a Team could hand out access to a Folder or a List.

The pair of tests at the end matter as much as the refusals above them. A permission change that
only blocks things is easy and proves nothing: what has to keep working is the day's real work --
hours against an audit somebody else raised -- and the admin's escape hatch, a share that lets one
person work in one place without making them an admin.
"""
from tests.v2.conftest import ok


def area(api, ws):
    """A Space and a List made by the owner, so nothing in it is an employee's by authorship."""
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Client work"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Audits"}), 201)
    return space, lst


# --- what an employee may not do ----------------------------------------------------------------

def test_an_employee_cannot_change_or_delete_a_colleagues_task(api, workspace):
    ws = workspace["id"]
    _space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                         {"name": "Sharma audit", "assignees": ["admin"]}), 201)

    assert api.patch(f"/tasks/{theirs['id']}", "member", {"name": "mine now"}).status_code == 403
    assert api.delete(f"/tasks/{theirs['id']}", "member").status_code == 403
    # Still there, and still called what the admin called it.
    assert ok(api.get(f"/tasks/{theirs['id']}", "member"))["name"] == "Sharma audit"


def test_an_employee_cannot_restructure_the_workspace(api, workspace):
    ws = workspace["id"]
    space, lst = area(api, ws)
    assert api.post(f"/workspaces/{ws}/spaces", "member", {"name": "Mine"}).status_code == 403
    assert api.post(f"/spaces/{space['id']}/lists", "member", {"name": "Mine"}).status_code == 403
    assert api.post(f"/spaces/{space['id']}/folders", "member", {"name": "Mine"}).status_code == 403
    assert api.patch(f"/spaces/{space['id']}", "member", {"name": "Renamed"}).status_code == 403
    assert api.delete(f"/lists/{lst['id']}", "member").status_code == 403
    assert api.delete(f"/spaces/{space['id']}", "member").status_code == 403


def test_only_admins_hand_out_access(api, workspace):
    """Including to somebody who leads a Team: leading one is not a rank here."""
    ws = workspace["id"]
    space, lst = area(api, ws)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "lead_ids": ["member"]}), 201)
    assert "member" in team["lead_ids"]

    assert api.post(f"/spaces/{space['id']}/shares", "member", {"user_id": "admin", "level": "edit"}).status_code == 403
    assert api.post(f"/lists/{lst['id']}/shares", "member", {"user_id": "admin", "level": "edit"}).status_code == 403
    # The admin may, which is the whole point of the refusals above.
    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)


# --- what an employee may do ---------------------------------------------------------------------

def test_an_employee_owns_the_work_that_is_theirs(api, workspace):
    ws = workspace["id"]
    _space, lst = area(api, ws)

    # Raised by them.
    mine = ok(api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "Call the auditor"}), 201)
    ok(api.patch(f"/tasks/{mine['id']}", "member", {"name": "Call the auditor back"}))
    ok(api.post(f"/tasks/{mine['id']}/time", "member", {"duration_seconds": 1800}), 201)
    assert api.delete(f"/tasks/{mine['id']}", "member").status_code == 204

    # Raised by the owner and given to them, which is the commonest shape of all.
    assigned = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                           {"name": "File the GST return", "assignees": ["member"]}), 201)
    ok(api.patch(f"/tasks/{assigned['id']}", "member", {"name": "File the GST return (Q2)"}))
    ok(api.post(f"/tasks/{assigned['id']}/time", "member", {"duration_seconds": 3600}), 201)
    assert api.delete(f"/tasks/{assigned['id']}", "member").status_code == 204


def test_an_employee_can_still_read_comment_and_log_hours_on_a_colleagues_task(api, workspace):
    """The cap is read-and-comment, not invisibility.

    A firm where nobody can see the audit they are not on is a firm that cannot cover for anybody.
    And hours are the one thing every employee has to be able to record: two people work an audit
    while only one of them is the assignee, so requiring edit access to log time would have left the
    second unable to put their own hours in without an admin reassigning the task.
    """
    ws = workspace["id"]
    _space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                         {"name": "Patel audit", "assignees": ["admin"]}), 201)

    assert ok(api.get(f"/tasks/{theirs['id']}", "member"))["name"] == "Patel audit"
    ok(api.post(f"/tasks/{theirs['id']}/comments", "member", {"body": "Shall I take this one?"}), 201)
    ok(api.post(f"/tasks/{theirs['id']}/time", "member", {"duration_seconds": 900}), 201)
    # But the task itself is still not theirs to change.
    assert api.patch(f"/tasks/{theirs['id']}", "member", {"name": "nope"}).status_code == 403


def test_a_share_lets_one_person_work_in_one_place(api, workspace):
    """The admin's escape hatch, and the reason the cap is a cap rather than a refusal.

    Somebody genuinely needs to work in an area: an admin shares it at edit, and the cap gives way.
    Without this the only way to let a person edit anything would be to make them an admin.
    """
    ws = workspace["id"]
    _space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                         {"name": "Verve year end", "assignees": ["admin"]}), 201)
    assert api.patch(f"/tasks/{theirs['id']}", "member", {"name": "before"}).status_code == 403

    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    ok(api.patch(f"/tasks/{theirs['id']}", "member", {"name": "after"}))
    # A share at edit is still not a licence to delete: that needs full.
    assert api.delete(f"/tasks/{theirs['id']}", "member").status_code == 403


def test_admins_are_untouched(api, workspace):
    ws = workspace["id"]
    space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "Raised by an employee"}), 201)
    ok(api.patch(f"/tasks/{theirs['id']}", "admin", {"name": "Reviewed"}))
    assert api.delete(f"/tasks/{theirs['id']}", "admin").status_code == 204
    ok(api.post(f"/spaces/{space['id']}/lists", "admin", {"name": "Another"}), 201)
    assert api.delete(f"/lists/{lst['id']}", "admin").status_code == 204
