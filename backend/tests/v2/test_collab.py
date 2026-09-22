from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.services.work import inbox as inbox_service
from tests.v2.conftest import ok

UTC = timezone.utc


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    ok(api.get("/workspaces", "member2"))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": "member2@example.com", "role": "member"}), 201)
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Salary sheet", "assignees": ["member"]}), 201)
    return {"ws": ws, "space": space, "list": lst, "task": task}


def inbox(api, org, who, tab="primary"):
    return ok(api.get(f"/workspaces/{org['ws']}/inbox", who, params={"tab": tab}))


def kinds(items):
    return sorted(i["kind"] for i in items)


# --- phase 1: move and duplicate -----------------------------------------------------------


def test_moving_a_list_to_another_space_repairs_statuses_tags_and_groups(api, org):
    other = ok(api.post(f"/workspaces/{org['ws']}/spaces", "owner", {"name": "HR"}), 201)
    statuses = ok(api.get(f"/spaces/{org['space']['id']}/statuses", "owner"))["statuses"]
    ok(api.put(f"/spaces/{org['space']['id']}/statuses", "owner", {"statuses": [
        {"id": st["id"], "name": st["name"], "color": st["color"], "group": st["group"]} for st in statuses
    ] + [{"name": "In review", "color": "#f59e0b", "group": "active"}]}))
    review = next(st for st in ok(api.get(f"/lists/{org['list']['id']}/statuses", "owner"))["statuses"] if st["name"] == "In review")
    g = ok(api.post(f"/spaces/{org['space']['id']}/groups", "owner", {"name": "Monthly"}), 201)
    ok(api.patch(f"/tasks/{org['task']['id']}", "owner", {"status_id": review["id"], "tags": ["urgent-pay"], "group_id": g["id"]}))
    ok(api.post(f"/lists/{org['list']['id']}/move", "owner", {"space_id": other["id"]}))
    t = ok(api.get(f"/tasks/{org['task']['id']}", "owner"))
    assert t["status"]["group"] == "active" and t["status"]["name"] != "In review"  # remapped to HR's active status
    assert [x["name"] for x in t["tags"]] == ["urgent-pay"]
    assert t["group"] is None
    assert t["location"]["space"]["name"] == "HR"


def test_folder_moves_and_their_limits(api, org):
    a = ok(api.post(f"/spaces/{org['space']['id']}/folders", "owner", {"name": "A"}), 201)
    b = ok(api.post(f"/spaces/{org['space']['id']}/folders", "owner", {"name": "B"}), 201)
    ok(api.post(f"/folders/{b['id']}/move", "owner", {"folder_id": a["id"]}))
    assert api.post(f"/folders/{a['id']}/move", "owner", {"folder_id": b["id"]}).status_code == 400  # b is now inside a
    assert api.post(f"/folders/{a['id']}/move", "member", {"space_id": org["space"]["id"]}).status_code in (200, 403)


def test_duplicating_lists_folders_and_tasks(api, org):
    sub = ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {"name": "Check TDS", "parent_id": org["task"]["id"]}), 201)
    ok(api.post(f"/tasks/{org['task']['id']}/checklists", "owner", {"name": "Steps", "items": ["Export", "Verify"]}), 201)
    copy = ok(api.post(f"/lists/{org['list']['id']}/duplicate", "owner", {}), 201)
    assert copy["name"] == "Payroll (copy)"
    tasks = ok(api.get(f"/lists/{copy['id']}/tasks", "owner"))["tasks"]
    assert sorted(t["name"] for t in tasks) == ["Check TDS", "Salary sheet"]
    parent = next(t for t in tasks if t["name"] == "Salary sheet")
    assert parent["checklist_total"] == 2 and [a["id"] for a in parent["assignees"]] == ["member"]
    assert next(t for t in tasks if t["name"] == "Check TDS")["parent_id"] == parent["id"]
    folder = ok(api.post(f"/spaces/{org['space']['id']}/folders", "owner", {"name": "Reviews"}), 201)
    fcopy = ok(api.post(f"/folders/{folder['id']}/duplicate", "owner", {"name": "Reviews 2027"}), 201)
    assert fcopy["name"] == "Reviews 2027"
    t = ok(api.post(f"/tasks/{org['task']['id']}/duplicate", "owner", {"include_subtasks": False}), 201)
    assert t["name"] == "Salary sheet (copy)" and t["subtask_count"] == 0
    history = ok(api.get(f"/tasks/{t['id']}/activity", "owner"))
    assert [(h["kind"], h["data"].get("copied_from")) for h in history] == [("created", "Salary sheet")]
    watching = ok(api.get(f"/tasks/{t['id']}/watchers", "owner"))
    assert {w["id"] for w in watching["watchers"]} == {"owner", "member"}
    assert sub["id"]


# --- phase 2: comments, mentions, assigned comments, activity --------------------------------------


def test_comments_mentions_replies_and_watchers(api, org):
    tid = org["task"]["id"]
    # The assignee (member) is a watcher already; member2 is mentioned.
    first = ok(api.post(f"/tasks/{tid}/comments", "owner", {"body": "Please check @Member2", "mention_user_ids": ["member2"]}), 201)
    assert "mentioned" in kinds(inbox(api, org, "member2"))
    assert "comment" in kinds(inbox(api, org, "member", "other"))
    assert inbox(api, org, "owner") == []  # never notified about your own actions
    ok(api.post(f"/tasks/{tid}/comments", "member2", {"body": "On it", "parent_id": first["id"]}), 201)
    assert "reply" in kinds(inbox(api, org, "owner"))
    thread = ok(api.get(f"/tasks/{tid}/comments", "member"))
    assert [c["parent_id"] for c in thread] == [None, first["id"]]
    assert ok(api.get(f"/workspaces/{org['ws']}/replies", "owner"))[0]["body"] == "On it"
    watchers = ok(api.get(f"/tasks/{tid}/watchers", "owner"))
    assert {w["id"] for w in watchers["watchers"]} == {"owner", "member", "member2"}


def test_assigned_comments_and_reactions(api, org):
    tid = org["task"]["id"]
    c = ok(api.post(f"/tasks/{tid}/comments", "owner", {"body": "Send the file", "assignee_id": "member2"}), 201)
    assert "assigned_comment" in kinds(inbox(api, org, "member2"))
    todo = ok(api.get(f"/workspaces/{org['ws']}/assigned-comments", "member2"))
    assert [x["id"] for x in todo] == [c["id"]] and todo[0]["task"]["name"] == "Salary sheet"
    ok(api.patch(f"/comments/{c['id']}", "member2", {"resolved": True}))
    assert ok(api.get(f"/workspaces/{org['ws']}/assigned-comments", "member2")) == []
    liked = ok(api.post(f"/comments/{c['id']}/reactions", "member", {"emoji": "👍"}))
    assert liked["reactions"] == [{"emoji": "👍", "count": 1, "mine": True, "users": ["Member"]}]
    assert api.patch(f"/comments/{c['id']}", "member", {"body": "hacked"}).status_code == 403
    assert api.delete(f"/comments/{c['id']}", "member").status_code == 204  # full access may delete


def test_commenting_needs_comment_access(api, org):
    private = ok(api.post(f"/spaces/{org['space']['id']}/lists", "owner", {"name": "Board", "is_private": True}), 201)
    t = ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "Secret"}), 201)
    ok(api.post(f"/tasks/{t['id']}/shares", "owner", {"user_id": "member2", "level": "view"}), 201)
    assert api.post(f"/tasks/{t['id']}/comments", "member2", {"body": "hi"}).status_code == 403
    ok(api.post(f"/tasks/{t['id']}/shares", "owner", {"user_id": "member2", "level": "comment"}), 201)
    ok(api.post(f"/tasks/{t['id']}/comments", "member2", {"body": "hi"}), 201)


def test_activity_history_and_change_notifications(api, org):
    tid = org["task"]["id"]
    closed = next(st for st in ok(api.get(f"/lists/{org['list']['id']}/statuses", "owner"))["statuses"] if st["group"] == "closed")
    ok(api.patch(f"/tasks/{tid}", "owner", {"status_id": closed["id"], "assignees": ["member", "member2"], "priority": 1}))
    history = {a["kind"]: a for a in ok(api.get(f"/tasks/{tid}/activity", "member"))}
    assert {"created", "status", "assignees", "priority"} <= set(history)
    assert history["status"]["data"]["to"] == closed["name"] and history["assignees"]["data"]["added"] == ["member2"]
    assert "assigned" in kinds(inbox(api, org, "member2"))
    other = kinds(inbox(api, org, "member", "other"))
    assert "status" in other and "assignees" in other


def test_people_who_cannot_see_the_task_are_not_notified(api, org):
    private = ok(api.post(f"/spaces/{org['space']['id']}/lists", "owner", {"name": "Board", "is_private": True}), 201)
    t = ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "Secret"}), 201)
    ok(api.post(f"/tasks/{t['id']}/comments", "owner", {"body": "@Member2", "mention_user_ids": ["member2"]}), 201)
    assert inbox(api, org, "member2") == []


def test_muted_kinds_are_not_delivered(api, org):
    ok(api.put(f"/workspaces/{org['ws']}/notification-settings", "member2", {"enabled": {"mentioned": False}}))
    rows = {r["kind"]: r["enabled"] for r in ok(api.get(f"/workspaces/{org['ws']}/notification-settings", "member2"))}
    assert rows["mentioned"] is False and rows["assigned"] is True
    ok(api.post(f"/tasks/{org['task']['id']}/comments", "owner", {"body": "x", "mention_user_ids": ["member2"]}), 201)
    assert inbox(api, org, "member2") == []


# --- phase 3: Inbox tabs, reminders ----------------------------------------------------------------


def test_inbox_read_snooze_clear(api, org):
    ok(api.patch(f"/tasks/{org['task']['id']}", "owner", {"assignees": ["member", "member2"]}))
    [item] = inbox(api, org, "member2")
    counts = ok(api.get(f"/workspaces/{org['ws']}/inbox/counts", "member2"))
    assert counts["primary"] == 1
    later = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    ok(api.patch(f"/notifications/{item['id']}", "member2", {"snoozed_until": later}), 204)
    assert inbox(api, org, "member2") == [] and len(inbox(api, org, "member2", "later")) == 1
    ok(api.patch(f"/notifications/{item['id']}", "member2", {"unsnooze": True}), 204)
    ok(api.post(f"/workspaces/{org['ws']}/inbox/read-all", "member2", {"tab": "primary"}), 204)
    assert ok(api.get(f"/workspaces/{org['ws']}/inbox/counts", "member2"))["primary"] == 0
    ok(api.post(f"/workspaces/{org['ws']}/inbox/clear-all", "member2", {"tab": "primary"}), 204)
    assert inbox(api, org, "member2") == [] and len(inbox(api, org, "member2", "cleared")) == 1
    assert api.patch(f"/notifications/{item['id']}", "member", {"read": True}).status_code == 404


def test_reminders_arrive_in_the_inbox_when_due(api, org):
    soon = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    r = ok(api.post(f"/workspaces/{org['ws']}/reminders", "member", {"task_id": org["task"]["id"], "remind_at": soon}), 201)
    assert r["title"] == "Salary sheet"
    delegated = ok(api.post(f"/workspaces/{org['ws']}/reminders", "member", {"title": "Call vendor", "remind_at": soon, "user_id": "member2"}), 201)
    with db_session.new_session() as db:
        assert inbox_service.run_due_reminders(db) == 2
        assert inbox_service.run_due_reminders(db) == 0
    assert kinds(inbox(api, org, "member")) == ["assigned", "reminder"]  # assigned in the fixture
    assert [i["reminder"]["title"] for i in inbox(api, org, "member2")] == ["Call vendor"]
    ok(api.patch(f"/workspaces/{org['ws']}/reminders/{r['id']}", "member", {"done": True}))
    assert ok(api.get(f"/workspaces/{org['ws']}/reminders", "member")) == []
    assert delegated["user"]["id"] == "member2"


# --- phase 4: checklists and attachments -------------------------------------------------------------


def test_checklists_progress_and_assigned_items(api, org):
    tid = org["task"]["id"]
    [cl] = ok(api.post(f"/tasks/{tid}/checklists", "owner", {"name": "Month end", "items": ["Export", "Reconcile"]}), 201)
    after = ok(api.post(f"/checklists/{cl['id']}/items", "owner", {"name": "Sign off", "assignee_id": "member2"}), 201)
    item = after[0]["items"][2]
    assert "checklist_item" in kinds(inbox(api, org, "member2"))
    ok(api.patch(f"/checklist-items/{cl['items'][0]['id']}", "owner", {"resolved": True}))
    t = ok(api.get(f"/tasks/{tid}", "owner"))
    assert (t["checklist_done"], t["checklist_total"]) == (1, 3)
    # member2 can tick their own item with only comment access, but not rename it.
    ok(api.patch(f"/lists/{org['list']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/tasks/{tid}/shares", "owner", {"user_id": "member2", "level": "comment"}), 201)
    ok(api.patch(f"/checklist-items/{item['id']}", "member2", {"resolved": True}))
    assert api.patch(f"/checklist-items/{item['id']}", "member2", {"name": "x"}).status_code == 403


def test_repeating_task_copies_checklists_unticked(api, org):
    due = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0).isoformat()
    t = ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {"name": "Daily log", "due_date": due, "recurrence": {"frequency": "daily"}}), 201)
    [cl] = ok(api.post(f"/tasks/{t['id']}/checklists", "owner", {"items": ["Calls"]}), 201)
    ok(api.patch(f"/checklist-items/{cl['items'][0]['id']}", "owner", {"resolved": True}))
    closed = next(st for st in ok(api.get(f"/lists/{org['list']['id']}/statuses", "owner"))["statuses"] if st["group"] == "closed")
    ok(api.patch(f"/tasks/{t['id']}", "owner", {"status_id": closed["id"]}))
    nxt = next(x for x in ok(api.get(f"/lists/{org['list']['id']}/tasks", "owner"))["tasks"] if x["recurs_from_id"] == t["id"])
    assert (nxt["checklist_done"], nxt["checklist_total"]) == (0, 1)


def test_attachments_upload_download_delete(api, org, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    tid = org["task"]["id"]
    up = api.client.post(f"/api/v2/tasks/{tid}/attachments", headers={"X-Test-User": "member"},
                         files={"file": ("salary.csv", b"name,amount\nA,100\n", "text/csv")})
    assert up.status_code == 201, up.text
    a = up.json()
    assert a["filename"] == "salary.csv" and a["size"] == 18
    dl = api.get(f"/attachments/{a['id']}/download", "owner")
    assert dl.status_code == 200 and dl.content == b"name,amount\nA,100\n"
    assert ok(api.get(f"/tasks/{tid}", "owner"))["attachment_count"] == 1
    assert "attachment" in kinds(inbox(api, org, "owner", "other"))  # the creator watches the task
    assert api.get(f"/attachments/{a['id']}/download", "outsider").status_code == 404
    # With only edit access, member2 can't delete someone else's file.
    ok(api.patch(f"/lists/{org['list']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/tasks/{tid}/shares", "owner", {"user_id": "member2", "level": "edit"}), 201)
    ok(api.post(f"/tasks/{tid}/shares", "owner", {"user_id": "member", "level": "comment"}), 201)  # the uploader
    assert api.delete(f"/attachments/{a['id']}", "member2").status_code == 403
    ok(api.delete(f"/attachments/{a['id']}", "member"), 204)
    monkeypatch.setattr(settings, "MAX_UPLOAD_MB", 0)
    big = api.client.post(f"/api/v2/tasks/{tid}/attachments", headers={"X-Test-User": "member"}, files={"file": ("x.txt", b"x", "text/plain")})
    assert big.status_code == 400
