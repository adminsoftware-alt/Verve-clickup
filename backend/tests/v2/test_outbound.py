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
    # The real sender takes an unsubscribe link as well; the stub has to accept whatever it is
    # given, or every digest fails for a reason that has nothing to do with what it says.
    monkeypatch.setattr(reports, "send_email",
                        lambda to, subject, body, unsubscribe=None: sent["email"].append((to, subject, body, unsubscribe)))
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


def _next(weekday: int, now: datetime) -> datetime:
    """The next date whose *Indian* weekday is this one, at 09:00 India time.

    The jobs read each person's local day, and 03:30 UTC is 09:00 in Kolkata -- which is the same
    date either way, so the weekday can be counted in UTC without drifting.
    """
    at_nine = now.replace(hour=3, minute=30, second=0, microsecond=0)
    while at_nine.weekday() != weekday:
        at_nine += timedelta(days=1)
    return at_nine


def test_a_weekly_digest_is_the_week_ahead_and_arrives_once(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "File TDS", "assignees": ["member"], "due_date": (now + timedelta(days=2)).isoformat()}), 201)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Next month", "assignees": ["member"], "due_date": (now + timedelta(days=40)).isoformat()}), 201)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"email_notifications": "weekly", "digest_hour": 8,
                                                        "timezone": "Asia/Kolkata"}))
    monday = _next(0, now)
    # Not on a Tuesday, however many times the scheduler asks.
    run(outbound.run_weekly_digests, monday + timedelta(days=1))
    assert not [e for e in sent["email"] if e[0] == ["member@example.com"]]

    run(outbound.run_weekly_digests, monday)
    mine = [e for e in sent["email"] if e[0] == ["member@example.com"]]
    assert len(mine) == 1 and mine[0][1].startswith("Your week:")
    assert "File TDS" in mine[0][2] and "Next month" not in mine[0][2]  # a week, not everything

    # The same Monday, and the next hour of it, is still the same week.
    run(outbound.run_weekly_digests, monday + timedelta(hours=3))
    assert len([e for e in sent["email"] if e[0] == ["member@example.com"]]) == 1


def test_overdue_is_chased_separately_and_the_manager_is_copied(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    # One that is properly late, and one that is late but only since yesterday.
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Long overdue", "assignees": ["member"], "due_date": (now - timedelta(days=10)).isoformat()}), 201)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Only just late", "assignees": ["member"], "due_date": (now - timedelta(days=1)).isoformat()}), 201)
    for who in ("member", "admin"):
        ok(api.put(f"/workspaces/{ws}/delivery", who, {"timezone": "Asia/Kolkata"}))

    wednesday = _next(2, now)
    run(outbound.run_overdue_nudges, wednesday)
    theirs = [e for e in sent["email"] if e[0] == ["member@example.com"]]
    assert len(theirs) == 1 and "Long overdue" in theirs[0][2]
    # Three days is the line: yesterday's slip is the daily digest's business, not a chase.
    assert "Only just late" not in theirs[0][2]

    boss = [e for e in sent["email"] if e[0] == ["admin@example.com"]]
    assert len(boss) == 1 and boss[0][1].startswith("Your team:")
    assert "Member" in boss[0][2] and "Long overdue" in boss[0][2]  # named, so it can be asked about

    run(outbound.run_overdue_nudges, wednesday + timedelta(hours=4))
    assert len([e for e in sent["email"] if e[0] == ["member@example.com"]]) == 1  # once a week


def test_somebody_who_never_signed_in_is_reminded_a_few_times_and_then_left_alone(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    added = ok(api.post(f"/workspaces/{ws}/people", "owner",
                        {"email": "newjoiner@example.com", "name": "New Joiner", "send_invite": False}), 201)
    uid = added["person"]["user"]["id"]

    with db_session.new_session() as db:
        from app.db.models import User, WorkspaceMember
        import uuid as _uuid
        m = db.get(WorkspaceMember, (_uuid.UUID(ws), uid))
        m.invite_sent_at = now - timedelta(days=9)
        m.timezone = "Asia/Kolkata"
        db.get(User, uid).auth_uid = None  # invited, never arrived
        db.commit()

    monday = _next(0, now)
    for week in range(5):
        run(outbound.run_invite_reminders, monday + timedelta(weeks=week))
    theirs = [e for e in sent["email"] if e[0] == ["newjoiner@example.com"]]
    # Three reminders, and then it stops: a fourth is spam, and the problem is no longer the email.
    assert len(theirs) == outbound.REMIND_INVITE_TIMES
    assert all(e[1].startswith("You still have an account waiting") for e in theirs)
    # It must read like an invitation, not like a digest for somebody who is already inside.
    assert "Sign in" in theirs[0][2] and "Inbox" not in theirs[0][2]


def test_a_cadence_only_goes_to_the_people_who_asked_for_it(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Something", "assignees": ["member", "admin"], "due_date": (now + timedelta(days=1)).isoformat()}), 201)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"email_notifications": "weekly", "timezone": "Asia/Kolkata"}))
    ok(api.put(f"/workspaces/{ws}/delivery", "admin", {"email_notifications": "daily", "timezone": "Asia/Kolkata"}))
    run(outbound.run_weekly_digests, _next(0, now))
    assert [e for e in sent["email"] if e[0] == ["member@example.com"]]
    # The same task, the same Monday, somebody who asked for daily: the weekly job is not theirs.
    assert not [e for e in sent["email"] if e[0] == ["admin@example.com"]]


def test_the_friday_recap_says_what_went_right_and_stays_quiet_otherwise(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"timezone": "Asia/Kolkata"}))
    friday = _next(4, now).replace(hour=11, minute=30)  # 17:00 in India

    # A week with nothing closed and no hours is a week this email should not comment on.
    run(outbound.run_friday_recaps, friday)
    assert not [e for e in sent["email"] if e[0] == ["member@example.com"]]

    task = ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                       {"name": "Filed the return", "assignees": ["member"]}), 201)
    closed = [g for g in ok(api.get(f"/lists/{world['list']['id']}/statuses", "owner"))["statuses"]
              if g["group"] in ("done", "closed")][0]
    ok(api.patch(f"/tasks/{task['id']}", "member", {"status_id": closed["id"]}))

    run(outbound.run_friday_recaps, friday)
    mine = [e for e in sent["email"] if e[0] == ["member@example.com"]]
    assert len(mine) == 1 and "Filed the return" in mine[0][2]
    assert "finished" in mine[0][1]
    run(outbound.run_friday_recaps, friday + timedelta(hours=1))
    assert len([e for e in sent["email"] if e[0] == ["member@example.com"]]) == 1


def test_a_manager_is_reminded_only_when_something_is_waiting(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    ok(api.put(f"/workspaces/{ws}/delivery", "admin", {"timezone": "Asia/Kolkata"}))
    monday = _next(0, now)

    # An empty in-tray is not news, and a daily "nothing to approve" teaches people to delete it.
    run(outbound.run_approval_reminders, monday)
    assert not [e for e in sent["email"] if e[0] == ["admin@example.com"]]

    kinds = {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/leave/types", "owner"))}
    start = (monday + timedelta(days=30)).date()
    ok(api.post(f"/workspaces/{ws}/leave", "member", {
        "type_id": kinds["Casual"]["id"], "start_date": start.isoformat(),
        "end_date": start.isoformat(), "reason": "A wedding"}), 201)

    run(outbound.run_approval_reminders, monday + timedelta(days=1))  # Tuesday: a new day, a new look
    theirs = [e for e in sent["email"] if e[0] == ["admin@example.com"]]
    assert len(theirs) == 1 and "waiting for your decision" in theirs[0][1]
    assert "Member" in theirs[0][2] and "leave" in theirs[0][2]
    # The reason is between the person and whoever decides it; the subject must not leak it.
    assert "A wedding" not in theirs[0][1]


def test_the_manager_hears_who_is_away_and_whose_week_was_empty(api, world):
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    ok(api.put(f"/workspaces/{ws}/delivery", "admin", {"timezone": "Asia/Kolkata"}))
    monday = _next(0, now)
    kinds = {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/leave/types", "owner"))}
    away = (monday + timedelta(days=2)).date()
    ok(api.post(f"/workspaces/{ws}/leave", "owner", {
        "type_id": kinds["Casual"]["id"], "start_date": away.isoformat(),
        "end_date": away.isoformat(), "user_id": "member"}), 201)  # an admin booking it approves it

    run(outbound.run_manager_heads_up, monday)
    theirs = [e for e in sent["email"] if e[0] == ["admin@example.com"]]
    assert len(theirs) == 1
    assert "is away" in theirs[0][2] and "Member" in theirs[0][2]
    # Nobody logged anything last week either, so that half shows up as well.
    assert "logged nothing" in theirs[0][2]


# --- the rules that decide whether to send at all -------------------------------------------------


def test_nobody_is_emailed_on_their_own_holiday(api, world):
    """A digest that lands on somebody's leave is how an app gets muted for good."""
    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Waiting for them", "assignees": ["member"],
                 "due_date": (now + timedelta(days=2)).isoformat()}), 201)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"email_notifications": "weekly", "timezone": "Asia/Kolkata"}))
    monday = _next(0, now)
    kinds = {t["name"]: t for t in ok(api.get(f"/workspaces/{ws}/leave/types", "owner"))}
    ok(api.post(f"/workspaces/{ws}/leave", "owner", {
        "type_id": kinds["Casual"]["id"], "start_date": monday.date().isoformat(),
        "end_date": monday.date().isoformat(), "user_id": "member"}), 201)

    run(outbound.run_weekly_digests, monday)
    assert not [e for e in sent["email"] if e[0] == ["member@example.com"]]
    # It is recorded as held rather than forgotten, so it does not fire the moment they are back.
    with db_session.new_session() as db:
        from app.db.models import EmailLog
        from sqlalchemy import select as _select
        row = db.scalars(_select(EmailLog).where(EmailLog.kind == "weekly", EmailLog.to_email == "member@example.com")).first()
        assert row is not None and row.sent is False and row.problem == "on leave"


def test_an_address_that_refuses_everything_is_left_alone(api, world):
    """Five failures in a row is a mailbox that is gone, and each retry costs a timeout."""
    ws = world["ws"]
    now = datetime.now(timezone.utc)
    with db_session.new_session() as db:
        from app.db.models import EmailLog, User
        import uuid as _uuid
        from sqlalchemy import select as _select
        user = db.scalars(_select(User).where(User.id == "member")).first()
        for i in range(outbound.BOUNCE_LIMIT):
            db.add(EmailLog(workspace_id=_uuid.UUID(ws), user_id="member", kind="daily",
                            period=f"2020-01-{i + 1:02d}", to_email=user.email, subject="old",
                            items=3, sent=False, problem="the email could not be sent"))
        db.commit()
        assert outbound.address_is_dead(db, _uuid.UUID(ws), user.email) is True
        # One success anywhere recent and it is a live mailbox again.
        db.add(EmailLog(workspace_id=_uuid.UUID(ws), user_id="member", kind="daily",
                        period="2020-02-01", to_email=user.email, subject="got through",
                        items=1, sent=True))
        db.commit()
        assert outbound.address_is_dead(db, _uuid.UUID(ws), user.email) is False


def test_every_digest_carries_a_link_that_turns_it_off(api, world):
    """The seventy-three people here who have never signed in cannot use "change it in Settings"."""
    from app.services.work import email_links

    ws, sent = world["ws"], world["sent"]
    now = datetime.now(timezone.utc)
    ok(api.post(f"/lists/{world['list']['id']}/tasks", "owner",
                {"name": "Something", "assignees": ["member"], "due_date": (now + timedelta(days=2)).isoformat()}), 201)
    ok(api.put(f"/workspaces/{ws}/delivery", "member", {"email_notifications": "weekly", "timezone": "Asia/Kolkata"}))
    run(outbound.run_weekly_digests, _next(0, now))

    to, subject, body, unsub = [e for e in sent["email"] if e[0] == ["member@example.com"]][0]
    assert unsub and "/api/v2/e/" in unsub, "the List-Unsubscribe header mail clients read"
    assert "Stop these emails" in body and unsub in body
    # The token says who it is for and what it does, and nothing else can be put in its place.
    read = email_links.read(unsub.rsplit("/", 1)[-1])
    assert read is not None and read["u"] == "member" and read["a"] == "unsubscribe"
    assert email_links.read(unsub.rsplit("/", 1)[-1] + "x") is None

    # Following it leaves them with no email, from a page that needed no sign-in at all -- so it
    # is fetched straight off the client, with no user header of any kind.
    page = api.client.get(f"/api/v2/e/{unsub.rsplit('/', 1)[-1]}")
    assert page.status_code == 200 and "Done" in page.text
    assert ok(api.get(f"/workspaces/{ws}/delivery", "member"))["email_notifications"] == "off"


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
