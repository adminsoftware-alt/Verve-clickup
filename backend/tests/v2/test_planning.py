from datetime import datetime, timedelta, timezone

import pytest

from app.services.work import planning
from app.services.work.errors import Invalid
from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    st = {x["group"]: x for x in ok(api.get(f"/lists/{lst['id']}/statuses", "owner"))["statuses"]}
    t = lambda name, **kw: ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": name, **kw}), 201)  # noqa: E731
    return {"ws": ws, "space": space, "lst": lst, "st": st, "t": t}


def at(hours: float) -> str:
    base = datetime(2026, 9, 23, 0, 0, tzinfo=timezone.utc)
    return (base + timedelta(hours=hours)).isoformat()


# --- Planner ----------------------------------------------------------------------------------


def test_time_blocks_are_personal_and_follow_task_access(api, org):
    ws = org["ws"]
    task = org["t"]("Run payroll", assignees=["member"])
    block = ok(api.post(f"/workspaces/{ws}/time-blocks", "member", {"task_id": task["id"], "start_at": at(9), "end_at": at(11)}), 201)
    assert block["task"]["name"] == "Run payroll"
    ok(api.post(f"/workspaces/{ws}/time-blocks", "member", {"title": "Focus time", "start_at": at(14), "end_at": at(15)}), 201)
    week = {"start": at(0), "end": at(24 * 7)}
    mine = ok(api.get(f"/workspaces/{ws}/planner", "member", params=week))
    assert [b["title"] or b["task"]["name"] for b in mine["blocks"]] == ["Run payroll", "Focus time"]
    assert ok(api.get(f"/workspaces/{ws}/planner", "owner", params=week))["blocks"] == []  # only your own

    moved = ok(api.patch(f"/workspaces/{ws}/time-blocks/{block['id']}", "member", {"start_at": at(10), "end_at": at(12)}))
    assert moved["start_at"].startswith("2026-09-23T10:00")
    assert api.patch(f"/workspaces/{ws}/time-blocks/{block['id']}", "member", {"end_at": at(9)}).status_code == 400
    assert api.delete(f"/workspaces/{ws}/time-blocks/{block['id']}", "owner").status_code == 404  # not theirs

    # A private task the guest can't open can't be blocked out, and a block without task or title is refused.
    private = org["t"]("Salaries", is_private=True)
    assert api.post(f"/workspaces/{ws}/time-blocks", "guest", {"task_id": private["id"], "start_at": at(9), "end_at": at(10)}).status_code in (403, 404)
    assert api.post(f"/workspaces/{ws}/time-blocks", "member", {"start_at": at(9), "end_at": at(10)}).status_code == 422


ICS = b"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:standup@test
SUMMARY:Daily stand-up
DTSTART:20260921T090000Z
DTEND:20260921T091500Z
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
BEGIN:VEVENT
UID:offsite@test
SUMMARY:Offsite
DTSTART;VALUE=DATE:20260925
DTEND;VALUE=DATE:20260926
END:VEVENT
BEGIN:VEVENT
UID:gone@test
SUMMARY:Cancelled call
STATUS:CANCELLED
DTSTART:20260923T120000Z
DTEND:20260923T130000Z
END:VEVENT
END:VCALENDAR
"""


def test_calendar_feeds_show_meetings_with_repeats_expanded(api, org, monkeypatch):
    ws = org["ws"]
    fetched = []
    monkeypatch.setattr(planning, "_download", lambda url: fetched.append(url) or ICS)
    monkeypatch.setattr(planning, "_now", lambda: datetime(2026, 9, 22, tzinfo=timezone.utc))
    assert api.post(f"/workspaces/{ws}/calendars", "member", {"name": "Work", "url": "http://cal.example.com/x.ics"}).status_code == 400
    feed = ok(api.post(f"/workspaces/{ws}/calendars", "member", {"name": "Work", "url": "webcal://cal.example.com/secret.ics"}), 201)
    assert fetched == ["https://cal.example.com/secret.ics"]
    assert feed["host"] == "cal.example.com" and "secret" not in str(feed) and feed["event_count"] == 6
    out = ok(api.get(f"/workspaces/{ws}/planner", "member", params={"start": at(0), "end": at(24 * 2)}))
    assert [e["title"] for e in out["events"]] == ["Daily stand-up"] * 2  # the 23rd and 24th
    week = ok(api.get(f"/workspaces/{ws}/planner", "member", params={"start": at(0), "end": at(24 * 7)}))
    offsite = [e for e in week["events"] if e["title"] == "Offsite"]
    assert len(offsite) == 1 and offsite[0]["all_day"]
    assert "Cancelled call" not in {e["title"] for e in week["events"]}
    assert ok(api.get(f"/workspaces/{ws}/calendars", "owner")) == []

    def broken(url):
        raise Invalid("The calendar answered 404")
    monkeypatch.setattr(planning, "_download", broken)
    synced = ok(api.post(f"/workspaces/{ws}/calendars/{feed['id']}/sync", "member"))
    assert synced["error"] == "The calendar answered 404" and synced["event_count"] == 6  # keeps the last good copy


def test_private_addresses_are_refused():
    with pytest.raises(Invalid):
        planning._check_public_host("127.0.0.1")
    with pytest.raises(Invalid):
        planning._check_public_host("10.1.2.3")


def test_tasks_calendar_link(api, org):
    ws = org["ws"]
    org["t"]("File returns", assignees=["member"], due_date=at(17))
    org["t"]("No date", assignees=["member"])
    link = ok(api.post(f"/workspaces/{ws}/calendar-link", "member"))["url"]
    path = link.split("/api/v2", 1)[1]
    body = api.client.get(f"/api/v2{path}").text  # no sign-in: the secret address is the key
    assert "BEGIN:VCALENDAR" in body and "File returns" in body and "No date" not in body
    new = ok(api.post(f"/workspaces/{ws}/calendar-link", "member", params={"reset": True}))["url"]
    assert new != link and api.client.get(f"/api/v2{path}").status_code == 404
    assert api.delete(f"/workspaces/{ws}/calendar-link", "member").status_code == 204
    assert ok(api.get(f"/workspaces/{ws}/calendar-link", "member"))["url"] is None


# --- LineUp, Home layout, My Work -----------------------------------------------------------------------


def test_lineup_is_your_own_ordered_list(api, org):
    ws = org["ws"]
    a, b, c = (org["t"](n, assignees=["member"]) for n in ("A", "B", "C"))
    for t in (a, b, c):
        ok(api.post(f"/workspaces/{ws}/lineup", "member", {"task_id": t["id"]}))
    ok(api.post(f"/workspaces/{ws}/lineup", "member", {"task_id": a["id"]}))  # adding twice is harmless
    out = ok(api.put(f"/workspaces/{ws}/lineup/order", "member", {"task_ids": [c["id"], a["id"], b["id"]]}))
    assert [t["name"] for t in out] == ["C", "A", "B"]
    assert ok(api.get(f"/workspaces/{ws}/lineup", "owner")) == []
    ok(api.patch(f"/tasks/{c['id']}", "owner", {"status_id": org["st"]["closed"]["id"]}))
    assert [t["name"] for t in ok(api.get(f"/workspaces/{ws}/lineup", "member"))] == ["A", "B"]  # finished work drops out
    assert [t["name"] for t in ok(api.delete(f"/workspaces/{ws}/lineup/{a['id']}", "member"))] == ["B"]
    assert api.put(f"/workspaces/{ws}/lineup/order", "member", {"task_ids": [a["id"]]}).status_code == 400


def test_home_layout_is_saved_per_person(api, org):
    ws = org["ws"]
    assert ok(api.get(f"/workspaces/{ws}/home-layout", "member"))["cards"] is None
    cards = [{"key": "lineup", "size": "full"}, {"key": "agenda"}, {"key": "recents", "hidden": True}]
    saved = ok(api.put(f"/workspaces/{ws}/home-layout", "member", {"cards": cards}))
    assert [(c["key"], c["hidden"], c["size"]) for c in saved["cards"]] == [("lineup", False, "full"), ("agenda", False, "half"), ("recents", True, "half")]
    assert api.put(f"/workspaces/{ws}/home-layout", "member", {"cards": [{"key": "agenda"}, {"key": "agenda"}]}).status_code == 422
    assert api.put(f"/workspaces/{ws}/home-layout", "member", {"cards": [{"key": "weather"}]}).status_code == 422
    assert ok(api.get(f"/workspaces/{ws}/home-layout", "owner"))["cards"] is None
    assert ok(api.put(f"/workspaces/{ws}/home-layout", "member", {"cards": None}))["cards"] is None  # back to standard


def test_done_and_delegated_tabs(api, org):
    ws = org["ws"]
    mine = org["t"]("Mine", assignees=["owner"])
    given = org["t"]("Given away", assignees=["member"])
    org["t"]("Shared work", assignees=["owner", "member"])
    org["t"]("Unassigned")
    assert [t["name"] for t in ok(api.get(f"/workspaces/{ws}/my-work/delegated", "owner"))] == ["Given away"]
    ok(api.patch(f"/tasks/{mine['id']}", "owner", {"status_id": org["st"]["closed"]["id"]}))
    ok(api.patch(f"/tasks/{given['id']}", "member", {"status_id": org["st"]["closed"]["id"]}))
    assert [t["name"] for t in ok(api.get(f"/workspaces/{ws}/my-work/done", "owner"))] == ["Mine"]
    assert ok(api.get(f"/workspaces/{ws}/my-work/delegated", "owner")) == []  # finished delegated work leaves the tab
    assert [t["name"] for t in ok(api.get(f"/workspaces/{ws}/my-work/done", "member"))] == ["Given away"]


# --- Automations ------------------------------------------------------------------------------------------


def test_new_tasks_are_assigned_by_a_space_rule(api, org):
    rule = ok(api.post(f"/spaces/{org['space']['id']}/automations", "owner", {
        "trigger": "task_created", "action": "assign", "action_config": {"user_ids": ["member"]}}), 201)
    task = org["t"]("Payslips")
    assert [u["id"] for u in ok(api.get(f"/tasks/{task['id']}", "owner"))["assignees"]] == ["member"]
    listed = ok(api.get(f"/lists/{org['lst']['id']}/automations", "owner"))
    assert listed[0]["id"] == rule["id"] and listed[0]["inherited"] and listed[0]["run_count"] == 1
    inbox = ok(api.get(f"/workspaces/{org['ws']}/inbox", "member"))
    assert any(n["kind"] == "assigned" for n in (inbox["items"] if isinstance(inbox, dict) else inbox))
    ok(api.patch(f"/automations/{rule['id']}", "owner", {"active": False}))
    assert ok(api.get(f"/tasks/{org['t']('Later')['id']}", "owner"))["assignees"] == []


def test_status_rules_chain_but_never_loop(api, org):
    lst = org["lst"]["id"]
    st = org["st"]
    done_name, active_name = st["closed"]["name"], st["active"]["name"] if "active" in st else None
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "status_changed", "trigger_config": {"status": done_name},
        "action": "set_priority", "action_config": {"priority": 4}}), 201)
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "status_changed", "trigger_config": {"status": done_name},
        "action": "notify", "action_config": {"user_ids": ["member"]}}), 201)
    task = org["t"]("Close month", priority=1)
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": st["closed"]["id"]}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["priority"] == 4

    # Two rules that bounce a task between statuses stop instead of looping.
    if active_name:
        todo_name = st["not_started"]["name"]
        ok(api.post(f"/lists/{lst}/automations", "owner", {"trigger": "status_changed", "trigger_config": {"status": active_name},
                                                           "action": "set_status", "action_config": {"status_name": todo_name}}), 201)
        ok(api.post(f"/lists/{lst}/automations", "owner", {"trigger": "status_changed", "trigger_config": {"status": todo_name},
                                                           "action": "set_status", "action_config": {"status_name": active_name}}), 201)
        other = org["t"]("Bounce")
        r = api.patch(f"/tasks/{other['id']}", "owner", {"status_id": st["active"]["id"]})
        assert r.status_code == 200


def test_automation_rules_are_checked(api, org):
    lst = org["lst"]["id"]
    bad = [
        {"trigger": "task_created", "action": "assign", "action_config": {"user_ids": []}},
        {"trigger": "task_created", "action": "assign", "action_config": {"user_ids": ["outsider"]}},
        {"trigger": "task_created", "action": "set_priority", "action_config": {"priority": 9}},
        {"trigger": "task_created", "action": "set_status", "action_config": {"status_name": "Nope"}},
        {"trigger": "status_changed", "trigger_config": {"status": "x"}, "action": "set_status", "action_config": {"status_name": "x"}},
    ]
    for body in bad:
        assert api.post(f"/lists/{lst}/automations", "owner", body).status_code == 400, body
    assert api.post(f"/lists/{lst}/automations", "guest", {"trigger": "task_created", "action": "set_priority", "action_config": {"priority": 1}}).status_code in (403, 404)


# --- scheduled automations, conditions, escalation ------------------------------------------------------------


def test_due_soon_and_overdue_rules_escalate_once(api, org):
    from app.db import session as db_session
    from app.services.work import automations

    ws = org["ws"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    lst = org["lst"]["id"]
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "overdue", "trigger_config": {"days_after": 1, "conditions": {"priorities": [1, 2]}},
        "action": "escalate", "action_config": {"levels": 1, "message": "Please follow up"}}), 201)
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "due_soon", "trigger_config": {"days_before": 2}, "action": "add_tag", "action_config": {"tag": "due-soon"}}), 201)
    now = datetime.now(timezone.utc)
    late = org["t"]("Late urgent", assignees=["member"], priority=1, due_date=(now - timedelta(days=2)).isoformat())
    org["t"]("Late but low", assignees=["member"], priority=4, due_date=(now - timedelta(days=2)).isoformat())
    soon = org["t"]("Due tomorrow", assignees=["member"], due_date=(now + timedelta(days=1)).isoformat())
    org["t"]("Due next month", assignees=["member"], due_date=(now + timedelta(days=30)).isoformat())
    with db_session.new_session() as db:
        assert automations.run_scheduled(db) == 2  # the urgent late task, and the one due tomorrow
        assert automations.run_scheduled(db) == 0  # once per due date
        db.commit()
    alerts = [n for n in ok(api.get(f"/workspaces/{ws}/inbox", "admin")) if n["kind"] == "escalation"]
    assert len(alerts) == 1 and alerts[0]["task"]["id"] == late["id"] and alerts[0]["data"]["message"] == "Please follow up"
    assert [t["name"] for t in ok(api.get(f"/tasks/{soon['id']}", "owner"))["tags"]] == ["due-soon"]
    # Moving the due date lets the rule fire again for the new date.
    ok(api.patch(f"/tasks/{late['id']}", "owner", {"due_date": (now - timedelta(days=3)).isoformat()}))
    with db_session.new_session() as db:
        assert automations.run_scheduled(db) == 1
        db.commit()


def test_priority_and_assignee_triggers_with_conditions(api, org):
    lst = org["lst"]["id"]
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "priority_changed", "trigger_config": {"priority": 1}, "action": "notify", "action_config": {"user_ids": ["admin"]}}), 201)
    ok(api.post(f"/lists/{lst}/automations", "owner", {
        "trigger": "assignee_added", "trigger_config": {"conditions": {"assignees": ["guest"]}},
        "action": "add_tag", "action_config": {"tag": "external"}}), 201)
    task = org["t"]("Board pack")
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"priority": 2}))
    assert not [n for n in ok(api.get(f"/workspaces/{org['ws']}/inbox", "admin")) if n["kind"] == "automation"]
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"priority": 1}))
    assert [n for n in ok(api.get(f"/workspaces/{org['ws']}/inbox", "admin")) if n["kind"] == "automation"]
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"assignees": ["member"]}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["tags"] == []  # condition: only when the guest is on it
    bad = api.post(f"/lists/{lst}/automations", "owner", {"trigger": "overdue", "trigger_config": {"days_after": 99}, "action": "escalate"})
    assert bad.status_code == 400
