"""Two-way calendar sync, against a fake Google Calendar / Microsoft Graph (nothing leaves the machine)."""

import base64
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.db.models import CalendarConnection
from app.services.work import calendar_sync
from tests.v2.conftest import ok


def _id_token(email):
    body = base64.urlsafe_b64encode(json.dumps({"email": email}).encode()).decode().rstrip("=")
    return f"x.{body}.y"


class FakeCalendar:
    """Just enough of Google Calendar and Microsoft Graph for the sync."""

    def __init__(self):
        self.events = {}  # id -> event as the provider stores it
        self.calls = []
        self.token_grants = []
        self.n = 0

    def __call__(self, method, url, *, token=None, json_body=None, form=None, params=None, headers=None):
        self.calls.append((method, url))
        if url.endswith("/token"):
            self.token_grants.append(form["grant_type"])
            return {"access_token": f"at-{len(self.token_grants)}", "refresh_token": "rt-1", "expires_in": 3600,
                    "id_token": _id_token("me@verve.example")}
        assert token and token.startswith("at-"), "calls must carry a fresh access token"
        is_ms = "graph.microsoft.com" in url
        if method == "GET":
            items = list(self.events.values())
            return {"value": items} if is_ms else {"items": items}
        if method == "POST":
            self.n += 1
            ev = {**json_body, "id": f"ev{self.n}"}
            self.events[ev["id"]] = ev
            return ev
        rid = url.rsplit("/", 1)[1]
        if method == "PATCH":
            self.events[rid].update(json_body)
            return self.events[rid]
        if method == "DELETE":
            if rid not in self.events:
                raise calendar_sync.ProviderError(404, "gone")
            del self.events[rid]
            return None
        raise AssertionError(method)

    def ours(self):
        return [e for e in self.events.values() if (e.get("extendedProperties") or {}).get("private", {}).get("timetriq") or "Verve Workflow" in (e.get("categories") or [])]


@pytest.fixture
def cal(monkeypatch):
    fake = FakeCalendar()
    monkeypatch.setattr(calendar_sync, "_http", fake)
    for k, v in (("GOOGLE_OAUTH_CLIENT_ID", "gid"), ("GOOGLE_OAUTH_CLIENT_SECRET", "gsecret"),
                 ("MICROSOFT_OAUTH_CLIENT_ID", "mid"), ("MICROSOFT_OAUTH_CLIENT_SECRET", "msecret"),
                 ("APP_URL", "http://app.test"), ("OAUTH_REDIRECT_BASE", "http://api.test")):
        monkeypatch.setattr(settings, k, v)
    return fake


def _connect(api, ws, provider="google", who="member"):
    start = ok(api.post(f"/workspaces/{ws}/calendar-connections/{provider}/start", who, {}))
    q = parse_qs(urlsplit(start["url"]).query)
    assert q["redirect_uri"] == [f"http://api.test/api/v2/calendar-oauth/{provider}/callback"]
    r = api.client.get(f"/api/v2/calendar-oauth/{provider}/callback", params={"code": "c0de", "state": q["state"][0]}, follow_redirects=False)
    assert r.status_code == 302 and r.headers["location"] == "http://app.test/planner?calendar=connected", r.headers.get("location")
    return ok(api.get(f"/workspaces/{ws}/calendar-connections", who))[0]


def _sync(api, conn, who="member"):
    return ok(api.post(f"/calendar-connections/{conn['id']}/sync", who, {}))


def test_nothing_happens_until_the_server_is_set_up(api, workspace, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_OAUTH_CLIENT_ID", None)
    assert ok(api.get("/calendar-sync/providers", "member"))["google"] is False
    assert api.post(f"/workspaces/{workspace['id']}/calendar-connections/google/start", "member", {}).status_code == 400


def test_connecting_stores_tokens_encrypted_and_checks_the_state(api, workspace, cal):
    ws = workspace["id"]
    assert ok(api.get("/calendar-sync/providers", "member")) == {"google": True, "microsoft": True}
    conn = _connect(api, ws)
    assert conn["provider"] == "google" and conn["account_email"] == "me@verve.example" and conn["error"] is None
    with db_session.new_session() as db:
        row = db.get(CalendarConnection, conn["id"])
        assert row.refresh_token != "rt-1" and calendar_sync.unseal(row.refresh_token) == "rt-1"
    bad = api.client.get("/api/v2/calendar-oauth/google/callback", params={"code": "c", "state": "forged.sig"}, follow_redirects=False)
    assert bad.status_code == 302 and "calendar_error=" in bad.headers["location"]
    other = ok(api.post(f"/workspaces/{ws}/calendar-connections/google/start", "member", {}))
    state = parse_qs(urlsplit(other["url"]).query)["state"][0]
    swapped = api.client.get("/api/v2/calendar-oauth/microsoft/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert "calendar_error=" in swapped.headers["location"]  # a Google state can't finish a Microsoft sign-in
    denied = api.client.get("/api/v2/calendar-oauth/google/callback", params={"error": "access_denied"}, follow_redirects=False)
    assert "access_denied" in denied.headers["location"]
    assert api.post(f"/calendar-connections/{conn['id']}/sync", "owner", {}).status_code == 404


def test_two_way_sync_with_google(api, workspace, folderless_list, cal):
    ws, lst = workspace["id"], folderless_list["id"]
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    due = now + timedelta(days=2)
    task = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "File TDS return", "assignees": ["member"], "due_date": due.isoformat()}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Someone else's", "assignees": ["owner"], "due_date": due.isoformat()}), 201)
    block = ok(api.post(f"/workspaces/{ws}/time-blocks", "member", {"title": "Deep work", "start_at": (now + timedelta(days=1)).isoformat(),
                                                                      "end_at": (now + timedelta(days=1, hours=2)).isoformat()}), 201)
    cal.events["meet1"] = {"id": "meet1", "summary": "Client call", "start": {"dateTime": (now + timedelta(hours=5)).isoformat()},
                           "end": {"dateTime": (now + timedelta(hours=6)).isoformat()}}
    conn = _connect(api, ws)  # connecting syncs straight away
    ours = {e["summary"].removeprefix("OPE-1 "): e for e in cal.ours()}  # tasks carry their custom ID
    assert set(ours) == {"File TDS return", "Deep work"}
    assert ours["File TDS return"]["end"]["dateTime"].startswith(due.isoformat()[:16])

    # Their own meetings show in the Planner; ours don't show twice.
    planner = ok(api.get(f"/workspaces/{ws}/planner", "member", params={"start": now.isoformat(), "end": (now + timedelta(days=7)).isoformat()}))
    assert [e["title"] for e in planner["events"]] == ["Client call"]

    # A change here goes out…
    ok(api.patch(f"/workspaces/{ws}/time-blocks/{block['id']}", "member", {"end_at": (now + timedelta(days=1, hours=3)).isoformat()}))
    assert _sync(api, conn)["updated"] == 1
    assert cal.events[ours["Deep work"]["id"]]["end"]["dateTime"].startswith((now + timedelta(days=1, hours=3)).isoformat()[:16])

    # …and a move in the calendar comes back: the task's due date follows.
    new_due = due + timedelta(days=1)
    ev = cal.events[ours["File TDS return"]["id"]]
    ev["start"] = {"dateTime": (new_due - timedelta(minutes=30)).isoformat()}
    ev["end"] = {"dateTime": new_due.isoformat()}
    assert _sync(api, conn)["pulled"] == 1
    assert ok(api.get(f"/tasks/{task['id']}", "member"))["due_date"][:16] == new_due.isoformat()[:16]
    settled = _sync(api, conn)
    assert (settled["updated"], settled["created"], settled["pulled"]) == (0, 0, 0)  # settled: nothing more to do

    # Deleting the time block's event in the calendar removes the block; finishing the task removes its event.
    del cal.events[ours["Deep work"]["id"]]
    _sync(api, conn)
    assert api.patch(f"/workspaces/{ws}/time-blocks/{block['id']}", "member", {"title": "x"}).status_code == 404
    closed = [st for st in ok(api.get(f"/lists/{lst}/statuses", "owner"))["statuses"] if st["group"] == "closed"][0]
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": closed["id"]}))
    assert _sync(api, conn)["deleted"] == 1 and cal.ours() == []

    # Settings, and disconnecting (which tidies up our events).
    ok(api.patch(f"/calendar-connections/{conn['id']}", "member", {"pull_events": False, "color": "#123456"}))
    _sync(api, conn)
    assert ok(api.get(f"/workspaces/{ws}/calendar-connections", "member"))[0]["event_count"] == 0
    ok(api.delete(f"/calendar-connections/{conn['id']}", "member"), 204)
    assert ok(api.get(f"/workspaces/{ws}/calendar-connections", "member")) == []


def test_expired_tokens_are_refreshed_and_outlook_works_too(api, workspace, folderless_list, cal):
    ws, lst = workspace["id"], folderless_list["id"]
    due = datetime.now(timezone.utc) + timedelta(days=3)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Board pack", "assignees": ["member"], "due_date": due.isoformat()}), 201)
    conn = _connect(api, ws, "microsoft")
    assert [e["subject"] for e in cal.ours()] == ["OPE-1 Board pack"] and cal.ours()[0]["start"]["timeZone"] == "UTC"
    assert any("graph.microsoft.com/v1.0/me/events" in u for _, u in cal.calls)
    with db_session.new_session() as db:
        row = db.get(CalendarConnection, conn["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    grants = len(cal.token_grants)
    _sync(api, conn)
    assert cal.token_grants[grants:] == ["refresh_token"]

    def refuse(*args, **kwargs):
        raise calendar_sync.ProviderError(400, "invalid_grant")

    with db_session.new_session() as db:
        row = db.get(CalendarConnection, conn["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
    cal_call = calendar_sync._http
    calendar_sync._http = refuse
    try:
        out = _sync(api, conn)
    finally:
        calendar_sync._http = cal_call
    assert "connect it again" in out["connection"]["error"]


def test_lost_records_are_adopted_and_copies_removed(api, workspace, folderless_list, cal):
    from app.db.models import CalendarSyncItem

    ws = workspace["id"]
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    ok(api.post(f"/workspaces/{ws}/time-blocks", "member", {"title": "Deep work", "start_at": (now + timedelta(hours=3)).isoformat(),
                                                            "end_at": (now + timedelta(hours=4)).isoformat()}), 201)
    conn = _connect(api, ws)
    [ev] = cal.ours()
    cal.events["copy"] = {**ev, "id": "copy"}  # a second copy of our event
    with db_session.new_session() as db:  # and the record of the first is lost
        db.query(CalendarSyncItem).delete()
        db.commit()
    out = _sync(api, conn)
    assert out["created"] == 0 and out["deleted"] == 1 and len(cal.ours()) == 1
    assert _sync(api, conn)["deleted"] == 0
    ok(api.delete(f"/calendar-connections/{conn['id']}", "member"), 204)
    assert cal.ours() == []
