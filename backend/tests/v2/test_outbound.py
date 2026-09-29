"""Email (instant and daily digest), push, WhatsApp and the weekly team digest — all with the outside world stubbed."""

from datetime import date, datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.services.work import outbound
from app.services.work.dashboards import reports
from tests.v2.conftest import ok


@pytest.fixture
def world(api, workspace, monkeypatch):
    sent = {"email": [], "push": [], "whatsapp": []}
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "WHATSAPP_TOKEN", "t")
    monkeypatch.setattr(settings, "WHATSAPP_PHONE_NUMBER_ID", "123")
    monkeypatch.setattr(reports, "send_email", lambda to, subject, body: sent["email"].append((to, subject, body)))
    monkeypatch.setattr(outbound, "_webpush", lambda sub, payload: sent["push"].append((sub.endpoint, payload)) or None)
    monkeypatch.setattr(outbound, "_whatsapp_post", lambda phone, text: sent["whatsapp"].append((phone, text)))
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    return {"ws": ws, "list": lst, "sent": sent}


def run(fn, now=None):
    with db_session.new_session() as db:
        out = fn(db, now) if now else fn(db)
        db.commit()
    return out


def test_delivery_settings(api, world):
    ws = world["ws"]
    d = ok(api.get(f"/workspaces/{ws}/delivery", "member"))
    assert d["email_notifications"] == "daily" and d["channels"] == {"email": True, "push": True, "whatsapp": True}
    assert api.put(f"/workspaces/{ws}/delivery", "member", {"whatsapp_opt_in": True}).status_code == 400  # no phone yet
    ok(api.patch(f"/workspaces/{ws}/people/member", "member", {"phone": "98765 43210"}))
    d = ok(api.put(f"/workspaces/{ws}/delivery", "member", {"whatsapp_opt_in": True, "email_notifications": "instant", "digest_hour": 9}))
    assert d["whatsapp_opt_in"] and d["email_notifications"] == "instant" and d["digest_hour"] == 9
    assert api.put(f"/workspaces/{ws}/delivery", "member", {"timezone": "Mars/Base"}).status_code == 400
    assert outbound.normalise_phone("98765 43210") == "919876543210" and outbound.normalise_phone("123") is None


def test_new_notifications_go_out_once_by_push_whatsapp_and_email(api, world):
    ws, sent = world["ws"], world["sent"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "member", {"phone": "+91 98765 43210"}))
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"whatsapp_opt_in": True, "email_notifications": "instant"}))
    ok(api.post(f"/workspaces/{ws}/push-subscriptions", "member", {"endpoint": "https://push.example.com/abc", "keys": {"p256dh": "k" * 20, "auth": "a" * 8}}), 204)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner", {"name": "Run payroll", "assignees": ["member"]}), 201)
    assert run(outbound.run_instant) == 1
    assert sent["push"][0][1]["title"] == "Run payroll" and "assigned you" in sent["push"][0][1]["body"]
    assert sent["whatsapp"] == [("919876543210", "Run payroll: Owner assigned you to this task")]
    assert sent["email"][0][0] == ["member@example.com"] and "1 update" in sent["email"][0][1]
    assert run(outbound.run_instant) == 0  # nothing twice


def test_gone_devices_are_forgotten(api, world, monkeypatch):
    ws = world["ws"]
    ok(api.post(f"/workspaces/{ws}/push-subscriptions", "member", {"endpoint": "https://push.example.com/old", "keys": {"p256dh": "k" * 20, "auth": "a" * 8}}), 204)
    monkeypatch.setattr(outbound, "_webpush", lambda sub, payload: 410)
    ok(api.post(f"/workspaces/{ws}/push-test", "member"), 204)
    assert ok(api.get(f"/workspaces/{ws}/delivery", "member"))["devices"] == 0


def test_daily_digest_at_the_chosen_hour(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner", {"name": "File TDS", "assignees": ["member"], "due_date": (now - timedelta(days=1)).isoformat()}), 201)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner", {"name": "Later", "assignees": ["member"], "due_date": (now + timedelta(days=9)).isoformat()}), 201)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"digest_hour": 8, "timezone": "Asia/Kolkata"}))
    # Off the same clock the tasks were dated from: a date typed in here goes stale the day after
    # it is written, and the digest then truthfully reports an empty day.
    early = now.replace(hour=1, minute=0, second=0, microsecond=0)  # 06:30 in India: too early
    run(outbound.run_daily_digests, early)
    assert not [e for e in sent["email"] if e[0] == ["member@example.com"]]
    at_nine = now.replace(hour=3, minute=30, second=0, microsecond=0)  # 09:00 in India
    run(outbound.run_daily_digests, at_nine)
    mine = [e for e in sent["email"] if e[0] == ["member@example.com"]]
    # "Later" isn't due, but its assignment is an unread update, so it's listed as that.
    assert len(mine) == 1 and mine[0][1] == "Your day: 1 due, 1 overdue" and "File TDS" in mine[0][2]
    run(outbound.run_daily_digests, at_nine + timedelta(hours=2))
    assert len([e for e in sent["email"] if e[0] == ["member@example.com"]]) == 1  # once a day


def test_team_digest_for_a_manager(api, world):
    ws = world["ws"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner", {"name": "Late one", "assignees": ["member"], "due_date": (now - timedelta(days=3)).isoformat()}), 201)
    digest = ok(api.get(f"/workspaces/{ws}/team-digest", "admin"))
    assert [p["user"]["id"] for p in digest["people"]] == ["member"]
    assert digest["people"][0]["overdue"] == 1 and digest["people"][0]["overdue_tasks"][0]["name"] == "Late one"
    assert ok(api.get(f"/workspaces/{ws}/team-digest", "member"))["people"] == []
    # The next Monday, whenever that is, rather than one typed in: the tasks above are dated off
    # the real clock, so a fixed date drifts out from under them.
    monday_10 = (now + timedelta(days=7 - now.weekday())).replace(hour=4, minute=30, second=0, microsecond=0)  # 10:00 in India
    assert run(outbound.run_team_digests, monday_10) == 1
    assert run(outbound.run_team_digests, monday_10 + timedelta(hours=1)) == 0
    subject = next(e for e in world["sent"]["email"] if e[0] == ["admin@example.com"])[1]
    assert subject.startswith("Your team's week")


def test_monthly_review_packs(api, world):
    ws = world["ws"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    out = ok(api.post(f"/workspaces/{ws}/review-packs", "owner", {"user_ids": ["member"]}))
    assert out["created"] == 1
    again = ok(api.post(f"/workspaces/{ws}/review-packs", "owner", {"user_ids": ["member"]}))
    assert again == {"created": 0, "existing": 1, "dashboards": out["dashboards"]}
    dash_id = out["dashboards"][0]
    dash = ok(api.get(f"/dashboards/{dash_id}", "member"))  # shared with the person
    assert dash["name"] == "Monthly review – Member" and dash["filters"]["assignees"] == ["member"]
    assert "Completed this month: on time or late" in [c["title"] for c in dash["cards"]]
    ok(api.get(f"/dashboards/{dash_id}", "admin"))  # and their manager
    schedule = ok(api.get(f"/dashboards/{dash_id}/reports", "owner"))["schedules"][0]
    assert schedule["frequency"] == "monthly" and schedule["day_of_month"] == 1
    assert {r["id"] for r in schedule["recipients"]} == {"member", "admin"}
    assert api.post(f"/workspaces/{ws}/review-packs", "member", {}).status_code == 403
    assert ok(api.post(f"/workspaces/{ws}/review-packs", "owner", {"email_monthly": False}))["created"] == 2  # owner and admin; member has one
