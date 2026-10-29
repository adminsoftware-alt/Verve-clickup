"""Phase D: duplicating Spaces and Space templates, public links, tasks in several Lists, time in status, sprints, Email-to-List, and the Doc, Chat and Embed views."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.db.models import Task, TaskActivity
from app.services.work import email_to_list, sprints
from tests.v2.conftest import ok


def _today() -> date:
    """The server's "today" is the UTC date; the local date differs for part of the day in India."""
    return datetime.now(timezone.utc).date()


def _task(api, list_id, name, who="owner", **extra):
    return ok(api.post(f"/lists/{list_id}/tasks", who, {"name": name, **extra}), 201)


def _names(api, list_id, who="owner"):
    return [t["name"] for t in ok(api.get(f"/lists/{list_id}/tasks", who))["tasks"]]


# --- duplicating Spaces, Space templates ----------------------------------------------------------


def test_duplicate_space_and_space_templates(api, workspace, space, folderless_list):
    ws, lst = workspace["id"], folderless_list["id"]
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Payroll"}), 201)
    field = ok(api.post(f"/spaces/{space['id']}/fields", "owner", {"name": "Client code", "type": "text"}), 201)
    t = _task(api, lst, "Monthly close", tags=["finance"], points=3, assignees=["member"])
    ok(api.put(f"/tasks/{t['id']}/fields/{field['id']}", "owner", {"value": "ACME"}))
    assert api.post(f"/spaces/{space['id']}/duplicate", "guest", {}).status_code == 404

    copy = ok(api.post(f"/spaces/{space['id']}/duplicate", "owner", {"name": "Operations 2"}), 201)
    assert copy["name"] == "Operations 2"
    tree = ok(api.get(f"/workspaces/{ws}/hierarchy", "owner"))
    node = next(x for x in tree["spaces"] if x["id"] == copy["id"])
    assert [f["name"] for f in node["folders"]] == [folder["name"]] and [x["name"] for x in node["lists"]] == ["Backlog"]
    new_list = node["lists"][0]["id"]
    [task] = ok(api.get(f"/lists/{new_list}/tasks", "owner"))["tasks"]
    assert task["name"] == "Monthly close" and task["points"] == 3 and [x["name"] for x in task["tags"]] == ["finance"]
    assert [a["id"] for a in task["assignees"]] == ["member"] and list(task["custom_fields"].values()) == ["ACME"]

    tpl = ok(api.post(f"/spaces/{space['id']}/save-template", "owner", {"name": "Client Space"}), 201)
    assert tpl["kind"] == "space" and tpl["task_count"] == 1
    # A Space from a template is still a new Space, so the same people may make one.
    assert api.post(f"/templates/{tpl['id']}/apply", "member", {"name": "Acme"}).status_code == 403
    made = ok(api.post(f"/templates/{tpl['id']}/apply", "admin", {"name": "Acme"}), 201)
    assert made["kind"] == "space"
    assert ok(api.get(f"/spaces/{made['id']}", "admin"))["name"] == "Acme"
    assert api.post(f"/templates/{tpl['id']}/apply", "guest", {}).status_code == 404


# --- public links ---------------------------------------------------------------------------------


def test_public_links_show_tasks_without_signing_in(api, workspace, space, folderless_list):
    lst = folderless_list["id"]
    task = _task(api, lst, "File GST", description="Before the 20th", assignees=["member"])
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Checklist", "parent_id": task["id"]}), 201)
    _task(api, lst, "Salary review", is_private=True)
    assert api.post("/public-links", "guest", {"kind": "list", "target_id": lst}).status_code == 404

    link = ok(api.post("/public-links", "owner", {"kind": "list", "target_id": lst, "show_assignees": True}), 201)
    anon = api.client.get(f"/api/v2/public/{link['token']}")
    page = anon.json()
    assert anon.status_code == 200 and page["title"] == "Backlog" and page["workspace"] == "Verve"
    assert [t["name"] for t in page["tasks"]] == ["File GST", "Checklist"]  # the private task never shows
    assert page["tasks"][0]["assignees"] == ["Member"] and page["tasks"][0]["description"] == "Before the 20th"

    tl = ok(api.post("/public-links", "member", {"kind": "task", "target_id": task["id"], "show_description": False}), 201)
    tp = api.client.get(f"/api/v2/public/{tl['token']}").json()
    assert tp["task"]["name"] == "File GST" and tp["task"]["description"] is None and [x["name"] for x in tp["subtasks"]] == ["Checklist"]
    assert tp["task"]["assignees"] == []

    views = ok(api.get(f"/lists/{lst}/views", "owner"))
    vl = ok(api.post("/public-links", "owner", {"kind": "view", "target_id": views[0]["id"]}), 201)
    assert api.client.get(f"/api/v2/public/{vl['token']}").json()["view_type"] == "list"

    assert [x["id"] for x in ok(api.get(f"/public-links?kind=list&target_id={lst}", "member"))] == [link["id"]]
    assert len(ok(api.get(f"/workspaces/{workspace['id']}/public-links", "owner"))) == 3
    assert len(ok(api.get(f"/workspaces/{workspace['id']}/public-links", "member"))) == 1
    assert api.delete(f"/public-links/{link['id']}", "guest").status_code == 404
    ok(api.delete(f"/public-links/{link['id']}", "owner"), 204)
    assert api.client.get(f"/api/v2/public/{link['token']}").status_code == 404

    old = ok(api.post("/public-links", "owner", {"kind": "list", "target_id": lst, "expires_on": (_today() - timedelta(days=1)).isoformat()}), 201)
    assert api.client.get(f"/api/v2/public/{old['token']}").status_code == 404
    assert api.post("/public-links", "owner", {"kind": "task", "target_id": ok(api.get(f"/lists/{lst}/tasks", "owner"))["tasks"][2]["id"]}).status_code == 403


# --- tasks in several Lists -----------------------------------------------------------------------


def test_a_task_can_live_in_several_lists(api, workspace, space, folderless_list):
    ws, home = workspace["id"], folderless_list["id"]
    clients = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Clients", "is_private": True}), 201)
    acme = ok(api.post(f"/spaces/{clients['id']}/lists", "owner", {"name": "Acme"}), 201)["id"]
    ok(api.patch(f"/spaces/{space['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/lists/{acme}/shares", "owner", {"user_id": "guest", "level": "view"}), 201)
    task = _task(api, home, "Audit prep")
    assert api.get(f"/tasks/{task['id']}", "guest").status_code == 404

    refs = ok(api.put(f"/tasks/{task['id']}/lists/{acme}", "owner", {}))
    assert [(r["name"], r["home"]) for r in refs] == [("Backlog", True), ("Acme", False)]
    assert _names(api, acme) == ["Audit prep"] and _names(api, home) == ["Audit prep"]
    assert ok(api.get(f"/tasks/{task['id']}", "guest"))["extra_list_ids"] == [acme]  # through Acme
    assert _names(api, acme, "guest") == ["Audit prep"]
    assert api.patch(f"/tasks/{task['id']}", "guest", {"name": "x"}).status_code == 403
    assert api.put(f"/tasks/{task['id']}/lists/{home}", "owner", {}).status_code == 400

    ok(api.post(f"/tasks/{task['id']}/move", "owner", {"list_id": acme}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["extra_list_ids"] == []
    ok(api.put(f"/tasks/{task['id']}/lists/{home}", "owner", {}))
    ok(api.delete(f"/tasks/{task['id']}/lists/{home}", "owner"))
    assert _names(api, home) == []


# --- time in status -------------------------------------------------------------------------------


def test_time_in_status_from_history(api, space, folderless_list):
    lst = folderless_list["id"]
    task = _task(api, lst, "Review")
    statuses = {s["name"].lower(): s["id"] for s in ok(api.get(f"/lists/{lst}/statuses", "owner"))["statuses"]}
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": statuses["in progress"]}))
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": statuses["to do"]}))
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": statuses["in progress"]}))
    now = datetime.now(timezone.utc)
    with db_session.new_session() as db:  # pretend each change happened an hour apart
        row = db.get(Task, task["id"])
        row.created_at = now - timedelta(hours=4)
        for i, act in enumerate(db.query(TaskActivity).filter_by(task_id=row.id, kind="status").order_by(TaskActivity.created_at)):
            act.created_at = now - timedelta(hours=3 - i)
        db.commit()
    out = ok(api.get(f"/tasks/{task['id']}/time-in-status", "member"))
    assert [s["status"].lower() for s in out["spells"]] == ["to do", "in progress", "to do", "in progress"]
    totals = {t["status"].lower(): t for t in out["totals"]}
    assert totals["to do"]["times"] == 2 and 7190 <= totals["to do"]["seconds"] <= 7210
    assert out["spells"][-1]["until"] is None and out["current"].lower() == "in progress"


# --- sprints --------------------------------------------------------------------------------------


def test_sprints_roll_over_and_report(api, workspace, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Engineering"}), 201)
    monday = _today() - timedelta(days=_today().weekday())
    assert api.put(f"/folders/{folder['id']}/sprints", "guest", {}).status_code == 404
    out = ok(api.put(f"/folders/{folder['id']}/sprints", "owner", {"weeks": 1, "first_start": monday.isoformat()}))
    assert out["sprint_settings"]["weeks"] == 1
    [first] = ok(api.get(f"/folders/{folder['id']}/sprints", "owner"))
    assert first["name"].startswith("Sprint 1") and first["current"]
    statuses = {s["name"].lower(): s["id"] for s in ok(api.get(f"/lists/{first['id']}/statuses", "owner"))["statuses"]}
    done = _task(api, first["id"], "Login page", points=5)
    _task(api, first["id"], "Reports", points=3)
    ok(api.patch(f"/tasks/{done['id']}", "owner", {"status_id": statuses["complete"]}))

    report = ok(api.get(f"/lists/{first['id']}/sprint", "member"))
    assert report["unit"] == "points" and report["sprint"]["total_points"] == 8 and report["sprint"]["done_points"] == 5
    assert report["burndown"][0]["ideal"] == 8 and report["burndown"][-1]["ideal"] == 0
    today = next(d for d in report["burndown"] if d["day"] == _today().isoformat())
    assert today["remaining"] == 3

    assert api.post(f"/lists/{first['id']}/sprint/complete", "guest", {}).status_code == 404
    result = ok(api.post(f"/lists/{first['id']}/sprint/complete", "owner", {}))
    assert result["moved"] == 1 and result["completed"]["done_points"] == 5
    assert _names(api, result["next_list_id"]) == ["Reports"]
    sprints_now = ok(api.get(f"/folders/{folder['id']}/sprints", "owner"))
    assert [x["name"][:8] for x in sprints_now] == ["Sprint 1", "Sprint 2"] and sprints_now[1]["start_date"][:10] == (monday + timedelta(days=7)).isoformat()
    assert ok(api.get(f"/lists/{result['next_list_id']}/sprint", "owner"))["velocity"][0]["done_points"] == 5
    assert api.post(f"/lists/{first['id']}/sprint/complete", "owner", {}).status_code == 400
    tree = ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", "owner"))
    assert tree["spaces"][0]["folders"][0]["is_sprint"] is True


def test_sprints_auto_complete_when_their_end_passes(api, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Eng"}), 201)
    start = _today() - timedelta(days=21)
    ok(api.put(f"/folders/{folder['id']}/sprints", "owner", {"weeks": 1, "first_start": start.isoformat(), "auto_complete": True}))
    [first] = ok(api.get(f"/folders/{folder['id']}/sprints", "owner"))
    _task(api, first["id"], "Carry me")
    with db_session.new_session() as db:
        assert sprints.run_due(db) >= 1
        db.commit()
    got = ok(api.get(f"/folders/{folder['id']}/sprints", "owner"))
    assert got[0]["completed_at"] is not None and got[1]["task_count"] == 1


# --- Email-to-List --------------------------------------------------------------------------------


def _mail(to, sender, subject="Client sent documents", message_id="<m1@example.com>", attach=True):
    boundary = "b1"
    body = (
        f"From: {sender}\r\nTo: {to}\r\nSubject: {subject}\r\nMessage-ID: {message_id}\r\n"
        f'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="{boundary}"\r\n\r\n'
        f"--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlease file the attached.\r\n"
    )
    if attach:
        body += (f"--{boundary}\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"pan.pdf\"\r\n"
                 f"Content-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n")
    return (body + f"--{boundary}--\r\n").encode()


def test_email_to_list(api, space, folderless_list, monkeypatch):
    lst = folderless_list["id"]
    monkeypatch.setattr(settings, "INBOUND_EMAIL_ADDRESS", "tasks@verve.test")
    monkeypatch.setattr(settings, "INBOUND_EMAIL_SECRET", "s3cret")
    assert ok(api.get(f"/lists/{lst}/email", "owner")) == {"address": None, "configured": True}
    assert api.post(f"/lists/{lst}/email", "guest", {}).status_code == 404
    address = ok(api.post(f"/lists/{lst}/email", "owner", {}))["address"]
    assert address.startswith("tasks+") and address.endswith("@verve.test")

    def send(raw, secret="s3cret"):
        return api.client.post("/api/v2/inbound-email", content=raw, headers={"X-Inbound-Secret": secret, "Content-Type": "message/rfc822"})

    assert send(_mail(address, "member@example.com"), secret="nope").status_code == 403
    assert send(_mail(address, "member@example.com")).json() == {"outcome": "created"}
    assert send(_mail(address, "member@example.com")).json() == {"outcome": "duplicate"}
    assert send(_mail(address, "stranger@else.com", message_id="<m2@x>")).json() == {"outcome": "sender_not_allowed"}
    assert send(_mail("tasks+0000000000000000@verve.test", "member@example.com", message_id="<m3@x>")).json() == {"outcome": "unknown_list"}
    [task] = ok(api.get(f"/lists/{lst}/tasks", "owner"))["tasks"]
    assert task["name"] == "Client sent documents" and task["description"] == "Please file the attached." and task["attachment_count"] == 1
    assert task["created_by"] == "member"

    new = ok(api.post(f"/lists/{lst}/email?rotate=true", "owner", {}))["address"]
    assert new != address
    with db_session.new_session() as db:
        assert email_to_list.ingest(db, _mail(address, "member@example.com", message_id="<m4@x>")) == "unknown_list"
        db.commit()


# --- Doc, Chat, Embed, Map --------------------------------------------------------------------------


def test_doc_view_saves_with_versions(api, space, folderless_list):
    lst = folderless_list["id"]
    doc = ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "doc"}), 201)
    assert doc["name"] == "Doc"
    assert ok(api.get(f"/views/{doc['id']}/content", "member")) == {"content": {}, "version": 0, "updated_by": None, "updated_at": None}
    saved = ok(api.put(f"/views/{doc['id']}/content", "member", {"content": {"pages": [{"title": "SOP", "body": "<p>Step 1</p>"}]}, "version": 0}))
    assert saved["version"] == 1 and saved["updated_by"]["id"] == "member"
    assert api.put(f"/views/{doc['id']}/content", "owner", {"content": {"pages": []}, "version": 0}).status_code == 409
    assert api.put(f"/views/{doc['id']}/content", "guest", {"content": {}, "version": 1}).status_code == 404
    lv = ok(api.get(f"/lists/{lst}/views", "owner"))[0]
    assert api.get(f"/views/{lv['id']}/content", "owner").status_code == 400
    wb = ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "whiteboard"}), 201)
    ok(api.put(f"/views/{wb['id']}/content", "owner", {"content": {"items": [{"kind": "sticky", "text": "Idea"}]}, "version": 0}))
    link = ok(api.post("/public-links", "owner", {"kind": "view", "target_id": doc["id"]}), 201)
    assert api.client.get(f"/api/v2/public/{link['token']}").json()["doc"]["pages"][0]["title"] == "SOP"


def test_chat_view_messages_mentions_and_tasks(api, workspace, space, folderless_list):
    lst = folderless_list["id"]
    chat = ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "chat"}), 201)
    ok(api.post(f"/views/{chat['id']}/chat", "owner", {"body": "Morning all"}), 201)
    m = ok(api.post(f"/views/{chat['id']}/chat", "member", {"body": "@Owner can you check Acme's TDS?\nIt's due Friday", "mention_user_ids": ["owner", "guest"]}), 201)
    msgs = ok(api.get(f"/views/{chat['id']}/chat", "owner"))
    assert [x["body"][:7] for x in msgs] == ["Morning", "@Owner "] and msgs[1]["mine"] is False
    inbox = ok(api.get(f"/workspaces/{workspace['id']}/inbox", "owner"))
    assert inbox[0]["kind"] == "chat_mention" and inbox[0]["data"]["location_id"] == space["id"]
    assert ok(api.get(f"/workspaces/{workspace['id']}/inbox", "guest")) == []  # can't see the chat
    assert api.get(f"/views/{chat['id']}/chat", "guest").status_code == 404
    assert api.patch(f"/chat/{m['id']}", "owner", {"body": "x"}).status_code == 403
    assert ok(api.patch(f"/chat/{m['id']}", "member", {"body": "@Owner check Acme TDS"}))["edited_at"]
    assert api.post(f"/chat/{m['id']}/task", "member", {}).status_code == 400  # a Space chat: pick a List
    task = ok(api.post(f"/chat/{m['id']}/task", "member", {"list_id": lst}), 201)
    assert task["name"] == "@Owner check Acme TDS"
    assert ok(api.get(f"/views/{chat['id']}/chat", "owner"))[1]["task_id"] == task["id"]
    after = msgs[0]["created_at"]
    assert len(ok(api.get(f"/views/{chat['id']}/chat", "owner", params={"after": after}))) == 1
    ok(api.delete(f"/chat/{m['id']}", "owner"), 204)  # full access may tidy up


def test_embed_view_and_location_field(api, space, folderless_list):
    lst = folderless_list["id"]
    emb = ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "embed"}), 201)
    out = ok(api.put(f"/views/{emb['id']}/embed", "owner", {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}))
    assert out["settings"]["url"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert api.put(f"/views/{emb['id']}/embed", "owner", {"url": "http://example.com"}).status_code == 422
    sheet = ok(api.put(f"/views/{emb['id']}/embed", "owner", {"url": "https://docs.google.com/spreadsheets/d/abc/edit#gid=0"}))
    assert sheet["settings"]["url"] == "https://docs.google.com/spreadsheets/d/abc/preview"

    field = ok(api.post(f"/lists/{lst}/fields", "owner", {"name": "Office", "type": "location"}), 201)
    task = _task(api, lst, "Site visit")
    val = ok(api.put(f"/tasks/{task['id']}/fields/{field['id']}", "owner", {"value": {"address": "Bandra, Mumbai", "lat": 19.0596, "lng": 72.8295}}))
    assert val["value"]["lat"] == 19.0596
    assert api.put(f"/tasks/{task['id']}/fields/{field['id']}", "owner", {"value": {"lat": 200, "lng": 0}}).status_code == 400
    ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "map"}), 201)
    ok(api.post(f"/spaces/{space['id']}/views", "owner", {"type": "mind_map"}), 201)


@pytest.fixture(autouse=True)
def _no_inbound_config(monkeypatch):
    monkeypatch.setattr(settings, "IMAP_HOST", None)
