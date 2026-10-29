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
    assert api.post(f"/spaces/{space['id']}/folders", "member", {"name": "Mine"}).status_code == 403
    assert api.patch(f"/spaces/{space['id']}", "member", {"name": "Renamed"}).status_code == 403
    assert api.delete(f"/lists/{lst['id']}", "member").status_code == 403
    assert api.delete(f"/spaces/{space['id']}", "member").status_code == 403


def test_who_hands_out_access(api, workspace):
    """A Space only by an admin; a Folder or a List by an admin or a manager; never by an employee."""
    ws = workspace["id"]
    space, lst = area(api, ws)
    assert api.post(f"/lists/{lst['id']}/shares", "member", {"user_id": "admin", "level": "edit"}).status_code == 403
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "lead_ids": ["member"]}), 201)
    assert "member" in team["lead_ids"]

    assert api.post(f"/spaces/{space['id']}/shares", "member", {"user_id": "admin", "level": "edit"}).status_code == 403
    ok(api.post(f"/lists/{lst['id']}/shares", "member", {"user_id": "admin", "level": "edit"}), 201)
    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)

def test_an_employee_adds_lists_where_they_have_full_edit(api, workspace):
    ws = workspace["id"]
    space, _ = area(api, ws)
    ok(api.post(f"/spaces/{space['id']}/lists", "member", {"name": "Mine"}), 201)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Monthly"}), 201)
    ok(api.post(f"/folders/{folder['id']}/lists", "member", {"name": "Mine too"}), 201)
    # An admin who sets the Space's default permission to Edit keeps employees from adding Lists.
    ok(api.patch(f"/spaces/{space['id']}", "owner", {"default_permission": "edit"}))
    assert api.post(f"/spaces/{space['id']}/lists", "member", {"name": "Not now"}).status_code == 403
    assert api.post(f"/spaces/{space['id']}/lists", "guest", {"name": "Never"}).status_code in (403, 404)


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


def test_a_list_share_does_not_lift_the_cap(api, workspace):
    """Sharing a place is about seeing and working in it, not rewriting other people's tasks there.

    Found in the dev data: Lists and Spaces shared at full (to a person or to their Team) let an
    employee edit and delete a colleague's task, and List views reported `full` on every task in
    them. The cap now holds whatever the List or Space says.
    """
    ws = workspace["id"]
    space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                         {"name": "Verve year end", "assignees": ["admin"]}), 201)

    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "full"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "member_ids": ["member"]}), 201)
    ok(api.post(f"/spaces/{space['id']}/shares", "owner", {"team_id": team["id"], "level": "full"}), 201)

    assert ok(api.get(f"/tasks/{theirs['id']}", "member"))["permission_level"] == "comment"
    listed = ok(api.get(f"/lists/{lst['id']}/tasks", "member"))["tasks"]
    assert [t["permission_level"] for t in listed if t["id"] == theirs["id"]] == ["comment"]
    found = ok(api.get(f"/workspaces/{ws}/search/tasks?q=Verve", "member"))
    assert [t["permission_level"] for t in found if t["id"] == theirs["id"]] == ["comment"]

    assert api.patch(f"/tasks/{theirs['id']}", "member", {"name": "mine now"}).status_code == 403
    assert api.delete(f"/tasks/{theirs['id']}", "member").status_code == 403
    bulk = ok(api.post("/tasks/bulk", "member", {"task_ids": [theirs["id"]], "delete": True}))
    assert bulk["updated"] == []
    assert ok(api.get(f"/tasks/{theirs['id']}", "owner"))["name"] == "Verve year end"

    # The share still lets them work in the List: raise a task there, and own it fully.
    mine = ok(api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "My bit"}), 201)
    ok(api.patch(f"/tasks/{mine['id']}", "member", {"name": "My bit, done"}))
    assert api.delete(f"/tasks/{mine['id']}", "member").status_code == 204


def test_a_share_on_the_task_itself_lets_one_person_work_on_it(api, workspace):
    """The admin's escape hatch: share the one task that somebody needs to change."""
    ws = workspace["id"]
    _space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                         {"name": "Verve year end", "assignees": ["admin"]}), 201)
    assert api.patch(f"/tasks/{theirs['id']}", "member", {"name": "before"}).status_code == 403

    ok(api.post(f"/tasks/{theirs['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    ok(api.patch(f"/tasks/{theirs['id']}", "member", {"name": "after"}))
    # A share at edit is still not a licence to delete: that needs full.
    assert api.delete(f"/tasks/{theirs['id']}", "member").status_code == 403


def test_a_manager_may_change_and_delete_their_teams_tasks(api, workspace):
    """Leading a Team makes you its manager: its people's tasks are yours to change, nobody else's."""
    ws = workspace["id"]
    _space, lst = area(api, ws)
    for uid in ("lead", "outsider2"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))

    reports = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                          {"name": "Member's audit", "assignees": ["member"]}), 201)
    elsewhere = ok(api.post(f"/lists/{lst['id']}/tasks", "owner",
                            {"name": "Someone else's audit", "assignees": ["outsider2"]}), 201)

    assert ok(api.get(f"/tasks/{reports['id']}", "lead"))["permission_level"] == "full"
    ok(api.patch(f"/tasks/{reports['id']}", "lead", {"name": "Member's audit (reviewed)"}))
    assert ok(api.get(f"/tasks/{elsewhere['id']}", "lead"))["permission_level"] == "comment"
    assert api.patch(f"/tasks/{elsewhere['id']}", "lead", {"name": "nope"}).status_code == 403
    assert api.delete(f"/tasks/{elsewhere['id']}", "lead").status_code == 403
    assert api.delete(f"/tasks/{reports['id']}", "lead").status_code == 204

    # Leading a Team does not reach upwards: the member still cannot touch the lead's task.
    leads = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Lead's audit", "assignees": ["lead"]}), 201)
    assert api.delete(f"/tasks/{leads['id']}", "member").status_code == 403


def test_admins_are_untouched(api, workspace):
    ws = workspace["id"]
    space, lst = area(api, ws)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "Raised by an employee"}), 201)
    ok(api.patch(f"/tasks/{theirs['id']}", "admin", {"name": "Reviewed"}))
    assert api.delete(f"/tasks/{theirs['id']}", "admin").status_code == 204
    ok(api.post(f"/spaces/{space['id']}/lists", "admin", {"name": "Another"}), 201)
    # Even on a task neither raised by nor assigned to them, and a List shared narrowly.
    other = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Owner's", "assignees": ["member"]}), 201)
    assert ok(api.get(f"/tasks/{other['id']}", "admin"))["permission_level"] == "full"
    assert api.delete(f"/tasks/{other['id']}", "admin").status_code == 204
    assert api.delete(f"/lists/{lst['id']}", "admin").status_code == 204


# --- what the List lets you change in place ------------------------------------------------------

def test_the_list_marks_which_rows_can_be_edited_in_place(api, workspace):
    """The List draws a row's values as editors only where the row says edit or full, so the
    level it carries is the whole story: an employee's own task is editable, a colleague's is not."""
    ws = workspace["id"]
    _space, lst = area(api, ws)
    mine = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "My audit", "assignees": ["member"]}), 201)
    theirs = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Their audit", "assignees": ["admin"]}), 201)

    rows = {t["id"]: t for t in ok(api.get(f"/lists/{lst['id']}/tasks", "member"))["tasks"]}
    assert rows[mine["id"]]["permission_level"] in ("edit", "full")
    assert rows[theirs["id"]]["permission_level"] == "comment"
    # An admin edits everything in place.
    rows = {t["id"]: t for t in ok(api.get(f"/lists/{lst['id']}/tasks", "admin"))["tasks"]}
    assert all(t["permission_level"] in ("edit", "full") for t in rows.values())


def test_every_in_place_field_saves_on_an_employees_own_task(api, workspace):
    """Status, priority, start and due dates, estimate and people -- each cell the List edits."""
    ws = workspace["id"]
    _space, lst = area(api, ws)
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Quarterly review", "assignees": ["member"]}), 201)
    statuses = ok(api.get(f"/lists/{lst['id']}/statuses", "member"))["statuses"]
    doing = next(st for st in statuses if st["group"] == "active")

    url = f"/tasks/{task['id']}"
    assert ok(api.patch(url, "member", {"status_id": doing["id"]}))["status"]["id"] == doing["id"]
    assert ok(api.patch(url, "member", {"priority": 2}))["priority"] == 2
    assert ok(api.patch(url, "member", {"start_date": "2026-11-02T00:00:00Z"}))["start_date"].startswith("2026-11-02")
    assert ok(api.patch(url, "member", {"due_date": "2026-11-06T00:00:00Z"}))["due_date"].startswith("2026-11-06")
    assert ok(api.patch(url, "member", {"time_estimate_seconds": 7200}))["time_estimate_seconds"] == 7200
    people = ok(api.patch(url, "member", {"assignees": ["member", "owner"]}))["assignees"]
    assert {u["id"] for u in people} == {"member", "owner"}
