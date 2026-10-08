"""Reaching people outside the app: email (instant or a daily digest), a weekly team digest for managers,
push notifications to installed apps and browsers, and WhatsApp.

Everything here is optional and switches on with its settings: SMTP_* for email, VAPID keys for push
(generated on first use), WHATSAPP_* for WhatsApp. Each person chooses what they get in their
notification settings. The scheduler calls the `run_*` functions every minute.
"""

import base64
import html
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Dict, List, Optional, Sequence, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    EmailLog, LeaveRequest, LeaveType, Notification, PushSubscription, Space, Status, StatusGroup, Task,
    TaskAssignee, TaskList, Team, TeamMember, TimeEntry, User, Workspace, WorkspaceMember, WorkspaceRole,
)
from app.schemas import outbound as o
from app.schemas import work as s
from app.services.work import email_links
from app.services.work.access import Access
from app.services.work.errors import Invalid, NotFound

log = logging.getLogger(__name__)
WHATSAPP_KINDS = {"assigned", "mentioned", "escalation", "leave_request", "leave_decision", "timesheet_reminder", "reminder", "automation"}
FRESH = timedelta(minutes=30)  # push and WhatsApp only for news, never a backlog


# --- settings per person -------------------------------------------------------------------------------------


def _member(db: Session, access: Access) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (access.workspace_id, access.user_id))
    if member is None:
        raise NotFound("Not a member")
    return member


def delivery(db: Session, access: Access) -> o.DeliveryOut:
    m = _member(db, access)
    return o.DeliveryOut(
        email_notifications=m.email_notifications or "daily", digest_hour=m.digest_hour, timezone=m.timezone or "Asia/Kolkata",
        weekly_team_digest=m.weekly_team_digest, whatsapp_opt_in=m.whatsapp_opt_in, phone=m.phone,
        devices=db.scalar(select(func.count()).select_from(PushSubscription).where(PushSubscription.user_id == access.user_id)) or 0,
        channels=channels(),
    )


def save_delivery(db: Session, access: Access, data: o.DeliveryIn) -> o.DeliveryOut:
    m = _member(db, access)
    fields = data.model_fields_set
    if "timezone" in fields and data.timezone:
        try:
            ZoneInfo(data.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            raise Invalid("Unknown timezone")
        m.timezone = data.timezone
    for name in ("email_notifications", "digest_hour", "weekly_team_digest"):
        if name in fields and getattr(data, name) is not None:
            setattr(m, name, getattr(data, name))
    if "whatsapp_opt_in" in fields and data.whatsapp_opt_in is not None:
        if data.whatsapp_opt_in and not normalise_phone(m.phone or ""):
            raise Invalid("Add your mobile number to your profile first")
        m.whatsapp_opt_in = data.whatsapp_opt_in
    db.flush()
    return delivery(db, access)


def channels() -> o.Channels:
    return o.Channels(email=bool(settings.SMTP_HOST), push=True,
                      whatsapp=bool(settings.WHATSAPP_TOKEN and settings.WHATSAPP_PHONE_NUMBER_ID))


# --- words for a notification ----------------------------------------------------------------------------------


def describe(db: Session, n: Notification) -> Tuple[str, str]:
    """(title, one line), e.g. ("Reconcile bank", "Priya assigned you to this task")."""
    actor = db.get(User, n.actor_id) if n.actor_id else None
    who = (actor.display_name or actor.email) if actor else ""
    task = db.get(Task, n.task_id) if n.task_id else None
    d = n.data or {}
    lines = {
        "assigned": "assigned you to this task",
        "mentioned": "mentioned you",
        "reply": "replied to you",
        "comment": "commented",
        "assigned_comment": "assigned you a comment",
        "status": f"changed the status to {d.get('to')}",
        "due_date": "changed the due date",
        "escalation": f"Escalation: {d.get('message') or d.get('rule') or 'a task needs attention'}",
        "automation": f"Automation: {d.get('rule', '')}",
        "leave_request": f"asked for {d.get('type')} leave, {d.get('from')} to {d.get('to')}",
        "leave_decision": f"{'approved' if d.get('status') == 'approved' else 'declined'} your {d.get('type')} leave, {d.get('from')} to {d.get('to')}",
        "timesheet_reminder": f"Your timesheet shows {round((d.get('tracked') or 0) / 3600, 1)}h of {round((d.get('expected') or 0) / 3600, 1)}h this week",
        "reminder": "Reminder",
        "space_join_request": f"asked to join the {d.get('space')} Space",
        "space_join_decision": f"{'let you into' if d.get('status') == 'approved' else 'declined your request to join'} the {d.get('space')} Space",
        "chat_mention": f"mentioned you in {d.get('view') or 'a chat'}: {(d.get('body') or '')[:120]}",
    }
    line = lines.get(n.kind, n.kind.replace("_", " "))
    text = f"{who} {line}".strip() if who and not line[0].isupper() else line
    return (task.name if task else "Verve Workflow"), text


def _link(n: Notification) -> str:
    base = settings.APP_URL.rstrip("/")
    if n.task_id:
        return f"{base}/inbox"
    if n.kind.startswith("leave_"):
        return f"{base}/leave"
    if n.kind == "timesheet_reminder":
        return f"{base}/timesheets"
    return f"{base}/inbox"


# --- push ------------------------------------------------------------------------------------------------------------

_KEYS: Optional[Tuple[str, str]] = None


def vapid_keys() -> Tuple[str, str]:
    """(public key for the browser, private key PEM). From settings, or generated once into VAPID_FILE."""
    global _KEYS
    if _KEYS:
        return _KEYS
    if settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY:
        _KEYS = (settings.VAPID_PUBLIC_KEY, settings.VAPID_PRIVATE_KEY)
        return _KEYS
    path = settings.VAPID_FILE
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as fh:
            saved = json.load(fh)
        _KEYS = (saved["public"], saved["private"])
        return _KEYS
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid01

    v = Vapid01()
    v.generate_keys()
    public = base64.urlsafe_b64encode(v.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).decode().rstrip("=")
    private = v.private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                          serialization.NoEncryption()).decode()
    with open(path, "w", encoding="utf-8") as fh:
        json.dump({"public": public, "private": private}, fh)
    _KEYS = (public, private)
    return _KEYS


def subscribe(db: Session, access: Access, data: o.PushSubscriptionIn) -> None:
    row = db.scalars(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint)).first()
    if row is None:
        row = PushSubscription(endpoint=data.endpoint, user_id=access.user_id, p256dh=data.keys.p256dh, auth=data.keys.auth)
        db.add(row)
    row.user_id, row.p256dh, row.auth, row.device = access.user_id, data.keys.p256dh, data.keys.auth, (data.device or None)
    db.flush()


def unsubscribe(db: Session, access: Access, endpoint: str) -> None:
    row = db.scalars(select(PushSubscription).where(PushSubscription.endpoint == endpoint, PushSubscription.user_id == access.user_id)).first()
    if row is not None:
        db.delete(row)
        db.flush()


def _webpush(sub: PushSubscription, payload: dict) -> Optional[int]:
    """Send one push; returns the HTTP status on failure (404/410 mean the device is gone). Tests replace this."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=json.dumps(payload), vapid_private_key=vapid_keys()[1], vapid_claims={"sub": settings.VAPID_SUBJECT}, timeout=10)
        return None
    except WebPushException as exc:
        return exc.response.status_code if exc.response is not None else 0


def push(db: Session, user_id: str, title: str, body: str, url: str) -> int:
    sent = 0
    for sub in list(db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id))):
        failed = _webpush(sub, {"title": title, "body": body, "url": url})
        if failed in (404, 410):
            db.delete(sub)
        elif failed is None:
            sent += 1
    db.flush()
    return sent


# --- WhatsApp -------------------------------------------------------------------------------------------------------


def normalise_phone(phone: str) -> Optional[str]:
    """International format without "+": a 10-digit Indian mobile gets 91 in front."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        digits = "91" + digits
    elif len(digits) == 11 and digits.startswith("0"):
        digits = "91" + digits[1:]
    return digits if 11 <= len(digits) <= 15 else None


def _whatsapp_post(phone: str, text: str) -> None:
    """Send a template message with one text parameter. Tests replace this."""
    url = f"{settings.WHATSAPP_API.rstrip('/')}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    body = {
        "messaging_product": "whatsapp", "to": phone, "type": "template",
        "template": {"name": settings.WHATSAPP_TEMPLATE, "language": {"code": settings.WHATSAPP_LANGUAGE},
                     "components": [{"type": "body", "parameters": [{"type": "text", "text": text[:1000]}]}]},
    }
    resp = httpx.post(url, json=body, headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN}"}, timeout=15)
    if resp.status_code >= 300:
        raise RuntimeError(f"WhatsApp answered {resp.status_code}: {resp.text[:200]}")


def whatsapp(member: WorkspaceMember, text: str) -> bool:
    if not (channels().whatsapp and member.whatsapp_opt_in):
        return False
    phone = normalise_phone(member.phone or "")
    if not phone:
        return False
    try:
        _whatsapp_post(phone, text)
        return True
    except Exception:  # noqa: BLE001 - a failed message must not stop the others
        log.exception("WhatsApp message failed")
        return False


# --- email -----------------------------------------------------------------------------------------------------------


def _email(to: str, subject: str, rows: List[Tuple[str, str, str]], intro: str,
           link_text: str = "Open", footer: Optional[str] = None,
           unsubscribe: Optional[str] = None, weekly_instead: Optional[str] = None) -> bool:
    """One message: a line of introduction, then a row per thing, each with a link.

    `link_text` and `footer` exist for the messages that go to somebody who is not a user yet.
    "Open" and "change your settings in the Inbox" are good advice for a colleague and gibberish
    for a person who has never signed in -- and the invitation reminder is the one email in here
    that is read only by people in the second group.
    """
    from app.services.work.dashboards.reports import send_email

    if not settings.SMTP_HOST:
        return False
    esc = html.escape
    items = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b style="color:#111827">{esc(t)}</b><br>'
        f'<span style="color:#4b5563">{esc(line)}</span> <a href="{esc(url)}" style="color:#4f46e5">{esc(link_text)}</a></td></tr>'
        for t, line, url in rows
    )
    if footer is not None:
        tail = esc(footer)
    elif unsubscribe:
        # A link, not an instruction. "Change it under Inbox → Settings" is useless advice to the
        # seventy-three people here who have never signed in, and an email they cannot stop is an
        # email they will mark as spam -- which costs the domain's reputation, not just the reader.
        tail = (f'<a href="{esc(unsubscribe)}" style="color:#9ca3af">Stop these emails</a>'
                f' &middot; <a href="{esc(weekly_instead or unsubscribe)}" style="color:#9ca3af">once a week instead</a>')
    else:
        tail = esc("Change what you get in Verve Workflow: Inbox → Settings.")
    body = (f'<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px">'
            f'<p style="color:#374151">{esc(intro)}</p><table style="width:100%;border-collapse:collapse">{items}</table>'
            f'<p style="color:#9ca3af;font-size:12px;margin-top:16px">{tail}</p></div>')
    try:
        # The header mail clients read to put an "Unsubscribe" button beside the sender's name,
        # which is where people look before they reach for "report spam".
        send_email([to], subject, body, unsubscribe=unsubscribe)
        return True
    except Exception:  # noqa: BLE001
        log.exception("Email to %s failed", to)
        return False


# --- the jobs ----------------------------------------------------------------------------------------------------------


# --- whether a message should exist at all --------------------------------------------------------


#: Consecutive failures to one address before the jobs stop trying. A mailbox that has refused
#: five messages is not going to take the sixth, and the attempts cost a timeout each.
BOUNCE_LIMIT = 5


def address_is_dead(db: Session, workspace_id: uuid.UUID, email: str) -> bool:
    """Has this address refused everything we have sent it lately?

    Only a run of failures counts: one timeout on a Tuesday is the network, five in a row is a
    mailbox that no longer exists. A single success anywhere in the recent history clears it.
    """
    recent = list(db.scalars(select(EmailLog).where(
        EmailLog.workspace_id == workspace_id, EmailLog.to_email == email,
        EmailLog.items > 0,  # a message with nothing in it was never attempted
    ).order_by(EmailLog.created_at.desc()).limit(BOUNCE_LIMIT)))
    return len(recent) >= BOUNCE_LIMIT and not any(r.sent for r in recent)


def on_leave(db: Session, member: WorkspaceMember, day: date) -> bool:
    """Is this person on approved leave today?

    A digest that arrives on somebody's holiday is how an app teaches people to mute it. The
    leave module already knows, and the chasing emails are exactly the ones worth holding: the
    work is late, and the person responsible is on a beach and cannot do anything about it.
    """
    from app.services.work.leave import is_away

    return is_away(db, member.workspace_id, member.user_id, day, day)


def _skip(db: Session, member: WorkspaceMember, user: User, local: datetime) -> Optional[str]:
    """Why this person should not be emailed right now, if they should not be."""
    if on_leave(db, member, local.date()):
        return "on leave"
    if address_is_dead(db, member.workspace_id, user.email):
        return f"the address has refused the last {BOUNCE_LIMIT} messages"
    return None


# --- sending a thing once per period ------------------------------------------------------------


def _period_key(kind: str, local: datetime) -> str:
    """The window a message covers, in a form that cannot come round twice."""
    if kind == "weekly":
        year, week, _ = local.isocalendar()
        return f"{year}-W{week:02d}"
    if kind == "monthly":
        return local.strftime("%Y-%m")
    return local.date().isoformat()  # daily, and anything else that runs at most once a day


def already_sent(db: Session, workspace_id: uuid.UUID, user_id: str, kind: str, period: str) -> bool:
    return db.scalars(select(EmailLog.id).where(
        EmailLog.workspace_id == workspace_id, EmailLog.user_id == user_id,
        EmailLog.kind == kind, EmailLog.period == period)).first() is not None


def _once(db: Session, member: WorkspaceMember, user: User, kind: str, period: str,
          subject: str, rows: List[Tuple[str, str, str]], intro: str,
          link_text: str = "Open", footer: Optional[str] = None,
          now: Optional[datetime] = None) -> bool:
    """Send this message unless it has gone already. Returns whether it went this time.

    The row is written whether or not the send worked, and whether or not there was anything to
    say -- an empty Tuesday should be decided once, not reconsidered every hour until midnight.
    """
    if already_sent(db, member.workspace_id, user.id, kind, period):
        return False
    # An invitation reminder is the one message worth sending to somebody on leave: it is not
    # about today's work, and it is the only way they ever become a user.
    # The job's own clock, not the wall clock: a job replayed for last Monday has to decide who
    # was on leave last Monday, and a check that only works today cannot be tested.
    held = None if kind == "invite_reminder" else _skip(db, member, user, _local(member, now or datetime.now(timezone.utc)))
    stop = email_links.url("unsubscribe", str(member.workspace_id), user.id)
    weekly = email_links.url("digest_weekly", str(member.workspace_id), user.id)
    ok = held is None and bool(rows) and _email(
        user.email, subject, rows, intro, link_text, footer,
        # An invitation reminder gives its own footer and stops after three; there is nothing to
        # unsubscribe from, and offering it to somebody who is not yet a user is a confusing ask.
        unsubscribe=None if footer is not None else stop,
        weekly_instead=None if footer is not None else weekly,
    )
    db.add(EmailLog(
        workspace_id=member.workspace_id, user_id=user.id, kind=kind, period=period,
        to_email=user.email, subject=subject[:300], items=len(rows), sent=ok,
        problem=None if ok else (held or ("nothing to say" if not rows else "the email could not be sent")),
    ))
    db.flush()
    return ok


def run_instant(db: Session, now: Optional[datetime] = None) -> int:
    """New primary notifications: push to devices, WhatsApp (opted-in kinds), and email to people who want it at once."""
    now = now or datetime.now(timezone.utc)
    rows = list(db.scalars(select(Notification).where(
        Notification.pushed_at.is_(None), Notification.category == "primary", Notification.created_at >= now - FRESH,
    ).order_by(Notification.created_at).limit(500)))
    emails: Dict[Tuple[uuid.UUID, str], List[Notification]] = {}
    for n in rows:
        title, line = describe(db, n)
        push(db, n.user_id, title, line, _link(n))
        member = db.get(WorkspaceMember, (n.workspace_id, n.user_id))
        if member is not None and n.kind in WHATSAPP_KINDS:
            whatsapp(member, f"{title}: {line}" if title != "Verve Workflow" else line)
        n.pushed_at = now
        if member is not None and member.email_notifications == "instant" and n.emailed_at is None:
            emails.setdefault((n.workspace_id, n.user_id), []).append(n)
    for (ws_id, uid), items in emails.items():
        user = db.get(User, uid)
        if user and _email(user.email, f"Verve Workflow: {len(items)} update{'s' if len(items) != 1 else ''}",
                           [(*describe(db, n), _link(n)) for n in items], "Here's what's new for you:"):
            for n in items:
                n.emailed_at = now
    db.flush()
    return len(rows)


def _local(member: WorkspaceMember, now: datetime) -> datetime:
    try:
        return now.astimezone(ZoneInfo(member.timezone or "Asia/Kolkata"))
    except (ZoneInfoNotFoundError, ValueError):
        return now.astimezone(ZoneInfo("Asia/Kolkata"))


def run_daily_digests(db: Session, now: Optional[datetime] = None) -> int:
    """At each person's digest hour: unread updates plus what's due today and overdue, by email and WhatsApp."""
    from app.services.work import mywork

    now = now or datetime.now(timezone.utc)
    sent = 0
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        local = _local(m, now)
        if local.hour < (m.digest_hour if m.digest_hour is not None else 8) or m.last_digest_on == local.date():
            continue
        m.last_digest_on = local.date()
        if m.email_notifications != "daily" and not m.whatsapp_opt_in:
            continue
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is None:
            continue
        access = Access(db, m.user_id, m.workspace_id, m.role)
        mine = mywork.my_tasks(db, access, include_closed=False)
        end_of_day = datetime.combine(local.date() + timedelta(days=1), time.min, local.tzinfo)
        due = [t for t in mine if t.due_date and t.due_date < end_of_day]
        overdue = [t for t in due if t.is_overdue]
        unread = list(db.scalars(select(Notification).where(
            Notification.workspace_id == m.workspace_id, Notification.user_id == m.user_id, Notification.category == "primary",
            Notification.read_at.is_(None), Notification.cleared_at.is_(None), Notification.emailed_at.is_(None),
            Notification.created_at >= now - timedelta(days=2)).order_by(Notification.created_at.desc()).limit(20)))
        if not due and not unread:
            continue
        base = settings.APP_URL.rstrip("/")
        rows = [(t.name, "Overdue" if t.is_overdue else "Due today", f"{base}/l/{t.list_id}?task={t.id}") for t in due[:20]]
        rows += [(*describe(db, n), _link(n)) for n in unread]
        if m.email_notifications == "daily" and _email(
                user.email, f"Your day: {len(due)} due, {len(overdue)} overdue", rows,
                f"Good morning. {len(due)} task{'s' if len(due) != 1 else ''} due today or overdue, and {len(unread)} new update{'s' if len(unread) != 1 else ''}."):
            for n in unread:
                n.emailed_at = now
            sent += 1
        if m.whatsapp_opt_in and due:
            whatsapp(m, f"Good morning. {len(due)} task{'s' if len(due) != 1 else ''} due today"
                        f"{f' ({len(overdue)} overdue)' if overdue else ''}: " + ", ".join(t.name for t in due[:5]))
    db.flush()
    return sent


# --- a person's own week and month ---------------------------------------------------------------


def _their_work(db: Session, member: WorkspaceMember):
    from app.services.work import mywork

    access = Access(db, member.user_id, member.workspace_id, member.role)
    return access, mywork.my_tasks(db, access, include_closed=False)


def _digest_people(db: Session, wanted: str):
    """Everyone who has asked for this cadence, has signed in, and is still here."""
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        if m.email_notifications != wanted:
            continue
        user = db.get(User, m.user_id)
        # Somebody who has never signed in has no work to summarise. They get the invitation
        # reminder below instead, which is the message that actually applies to them.
        if user is None or user.auth_uid is None:
            continue
        yield m, user


def run_weekly_digests(db: Session, now: Optional[datetime] = None) -> int:
    """Monday morning: the week ahead, for people who want a week at a time rather than a day."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    for m, user in _digest_people(db, "weekly"):
        local = _local(m, now)
        if local.weekday() != 0 or local.hour < (m.digest_hour if m.digest_hour is not None else 8):
            continue
        period = _period_key("weekly", local)
        if already_sent(db, m.workspace_id, user.id, "weekly", period):
            continue
        _, mine = _their_work(db, m)
        end = datetime.combine(local.date() + timedelta(days=7), time.min, local.tzinfo)
        ahead = sorted([t for t in mine if t.due_date and t.due_date < end], key=lambda t: t.due_date)
        overdue = [t for t in ahead if t.is_overdue]
        base = settings.APP_URL.rstrip("/")
        rows = [(t.name, "Overdue" if t.is_overdue else f"Due {t.due_date:%a %d %b}", f"{base}/l/{t.list_id}?task={t.id}")
                for t in ahead[:25]]
        subject = f"Your week: {len(ahead)} due" + (f", {len(overdue)} already overdue" if overdue else "")
        if _once(db, m, user, "weekly", period, subject, rows,
                 f"The week ahead: {len(ahead)} task{'s' if len(ahead) != 1 else ''} due by "
                 f"{(local.date() + timedelta(days=6)):%d %b}" + (f", {len(overdue)} of them already overdue." if overdue else "."),
                 now=now):
            sent += 1
    db.flush()
    return sent


def run_monthly_digests(db: Session, now: Optional[datetime] = None) -> int:
    """The first working morning of the month: what was finished, and what is still carried."""
    from app.services.work import mywork

    now = now or datetime.now(timezone.utc)
    sent = 0
    for m, user in _digest_people(db, "monthly"):
        local = _local(m, now)
        # The 1st, unless it falls at a weekend, in which case the following Monday.
        first_working = local.day <= 3 and local.weekday() < 5 and (local.day == 1 or local.weekday() == 0)
        if not first_working or local.hour < (m.digest_hour if m.digest_hour is not None else 8):
            continue
        period = _period_key("monthly", local)
        if already_sent(db, m.workspace_id, user.id, "monthly", period):
            continue
        access, mine = _their_work(db, m)
        last_month_end = datetime.combine(local.date().replace(day=1), time.min, local.tzinfo)
        last_month_start = datetime.combine(
            (local.date().replace(day=1) - timedelta(days=1)).replace(day=1), time.min, local.tzinfo)
        done = mywork.my_tasks(db, access, include_closed=True)
        finished = [t for t in done if t.date_done and last_month_start <= t.date_done < last_month_end]
        overdue = [t for t in mine if t.is_overdue]
        base = settings.APP_URL.rstrip("/")
        rows = [(t.name, "Still overdue", f"{base}/l/{t.list_id}?task={t.id}") for t in overdue[:20]]
        subject = f"Last month: {len(finished)} finished, {len(overdue)} still open and overdue"
        intro = (f"In {last_month_start:%B} you finished {len(finished)} task{'s' if len(finished) != 1 else ''}. "
                 + (f"{len(overdue)} are still overdue:" if overdue else "Nothing is overdue."))
        # Worth sending even with nothing overdue, because the count of finished work is the point.
        if not rows and finished:
            rows = [("Nothing overdue", f"{len(finished)} finished in {last_month_start:%B}", f"{base}/my-tasks")]
        if _once(db, m, user, "monthly", period, subject, rows, intro, now=now):
            sent += 1
    db.flush()
    return sent


# --- chasing work that is late --------------------------------------------------------------------


#: How late a task has to be before it is worth a message of its own, rather than a line in the
#: daily digest everybody has learned to skim.
OVERDUE_AFTER_DAYS = 3


def run_overdue_nudges(db: Session, now: Optional[datetime] = None) -> int:
    """Once a week, the work that has been late for a while -- to the person, and to their manager.

    The daily digest already lists what is overdue, which is precisely why it stops being read.
    This goes out on one morning a week, carries only the tasks that have been late for more than
    a few days, and copies the manager, because that is the difference between a reminder and a
    conversation.
    """
    now = now or datetime.now(timezone.utc)
    sent = 0
    cutoff = now - timedelta(days=OVERDUE_AFTER_DAYS)
    base = settings.APP_URL.rstrip("/")
    by_manager: Dict[Tuple[uuid.UUID, str], List[Tuple[str, str, str]]] = {}

    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        local = _local(m, now)
        if local.weekday() != 2 or local.hour < 9:  # Wednesday: late enough to act on, early enough to fix
            continue
        if m.email_notifications == "off":
            continue
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is None:
            continue
        period = _period_key("weekly", local)
        if already_sent(db, m.workspace_id, user.id, "overdue", period):
            continue
        _, mine = _their_work(db, m)
        late = sorted([t for t in mine if t.is_overdue and t.due_date and t.due_date < cutoff],
                      key=lambda t: t.due_date)
        rows = [(t.name, f"Due {t.due_date:%d %b} — {(now - t.due_date).days} days ago",
                 f"{base}/l/{t.list_id}?task={t.id}") for t in late[:20]]
        subject = f"{len(late)} task{'s' if len(late) != 1 else ''} more than {OVERDUE_AFTER_DAYS} days late"
        if _once(db, m, user, "overdue", period, subject, rows,
                 "These have been overdue for a while. Move the date, hand them on, or close them:", now=now):
            sent += 1
        # The manager hears about it once, with everybody's together, rather than one mail a person.
        if late and m.manager_id:
            who = user.display_name or user.email
            by_manager.setdefault((m.workspace_id, m.manager_id), []).extend(
                (f"{who}: {name}", when, link) for name, when, link in rows[:5])

    for (workspace_id, manager_id), rows in by_manager.items():
        boss = db.get(WorkspaceMember, (workspace_id, manager_id))
        user = db.get(User, manager_id)
        if boss is None or boss.deactivated_at is not None or user is None or user.auth_uid is None:
            continue
        if boss.email_notifications == "off":
            continue
        period = _period_key("weekly", _local(boss, now))
        if _once(db, boss, user, "overdue_team", period,
                 f"Your team: {len(rows)} task{'s' if len(rows) != 1 else ''} running late", rows,
                 "Work in your team that has been overdue for more than a few days:", now=now):
            sent += 1
    db.flush()
    return sent


def _logged_seconds(db: Session, workspace_id: uuid.UUID, user_id: str,
                    start: datetime, end: Optional[datetime] = None) -> int:
    """Hours this person put in, inside this workspace.

    A time entry hangs off a task, not off a workspace, so the workspace is reached through the
    List and the Space -- the same join the timesheet itself uses, because two different answers
    to "how much did they log" is how a firm ends up arguing with its own reports.
    """
    q = (select(func.coalesce(func.sum(TimeEntry.duration_seconds), 0))
         .select_from(TimeEntry)
         .join(Task, Task.id == TimeEntry.task_id)
         .join(TaskList, TaskList.id == Task.list_id)
         .join(Space, Space.id == TaskList.space_id)
         .where(Space.workspace_id == workspace_id, TimeEntry.user_id == user_id,
                TimeEntry.started_at >= start))
    if end is not None:
        q = q.where(TimeEntry.started_at < end)
    return db.scalar(q) or 0


# --- the end of someone's week ---------------------------------------------------------------------


def run_friday_recaps(db: Session, now: Optional[datetime] = None) -> int:
    """Friday afternoon: what you finished this week.

    Every other message in here is a demand -- what is due, what is late, what you have not filled
    in. This one is the only email that tells somebody they did something, which is why it is the
    one they will open. It goes to everybody whose email is on at all, because a person on the
    daily cadence still only hears about work they have not done.
    """
    from app.services.work import mywork

    now = now or datetime.now(timezone.utc)
    sent = 0
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        if m.email_notifications == "off":
            continue
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is None:
            continue
        local = _local(m, now)
        if local.weekday() != 4 or local.hour < 16:  # Friday, late enough that the week is done
            continue
        period = _period_key("weekly", local)
        if already_sent(db, m.workspace_id, user.id, "recap", period):
            continue
        access = Access(db, m.user_id, m.workspace_id, m.role)
        week_start = datetime.combine(local.date() - timedelta(days=local.weekday()), time.min, local.tzinfo)
        finished = [t for t in mywork.my_tasks(db, access, include_closed=True)
                    if t.date_done and t.date_done >= week_start]
        hours = _logged_seconds(db, m.workspace_id, m.user_id, week_start)
        if not finished and not hours:
            continue  # nothing to be pleased about; say nothing rather than rub it in
        base = settings.APP_URL.rstrip("/")
        rows = [(t.name, "Finished", f"{base}/l/{t.list_id}?task={t.id}") for t in finished[:20]]
        if not rows:
            rows = [(f"{round(hours / 3600, 1)}h logged", "No tasks closed, but the time is in", f"{base}/timesheets")]
        subject = f"Your week: {len(finished)} finished, {round(hours / 3600, 1)}h logged"
        if _once(db, m, user, "recap", period, subject, rows,
                 f"Nice work. This week you closed {len(finished)} task{'s' if len(finished) != 1 else ''} "
                 f"and logged {round(hours / 3600, 1)} hours.", now=now):
            sent += 1
    db.flush()
    return sent


# --- what a manager owes a decision on --------------------------------------------------------------


def run_approval_reminders(db: Session, now: Optional[datetime] = None) -> int:
    """Each weekday morning: leave and timesheets waiting on this manager, if there are any.

    Only when there is something. A daily "you have nothing to approve" is how a person learns to
    delete the message without reading the subject.
    """
    from app.db.models import LeaveRequest, TimesheetSubmission

    now = now or datetime.now(timezone.utc)
    sent = 0
    base = settings.APP_URL.rstrip("/")
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        if m.email_notifications == "off":
            continue
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is None:
            continue
        local = _local(m, now)
        if local.weekday() > 4 or local.hour < 9:
            continue
        period = local.date().isoformat()
        if already_sent(db, m.workspace_id, user.id, "approvals", period):
            continue

        rows: List[Tuple[str, str, str]] = []
        for r in db.scalars(select(LeaveRequest).where(
                LeaveRequest.workspace_id == m.workspace_id, LeaveRequest.status == "pending",
                LeaveRequest.approver_id == m.user_id).order_by(LeaveRequest.start_date).limit(15)):
            who = db.get(User, r.user_id)
            waited = (now - r.created_at).days
            rows.append((f"{(who.display_name or who.email) if who else 'Someone'} — leave",
                         f"{r.start_date:%d %b} to {r.end_date:%d %b}, {r.days:g} day(s)"
                         + (f", waiting {waited} days" if waited else ""), f"{base}/leave"))
        # Timesheets: whoever leads their Team, which is what the approvals screen uses.
        theirs = set(_team_of(db, m.workspace_id, m.user_id))
        if theirs:
            for sub_ in db.scalars(select(TimesheetSubmission).where(
                    TimesheetSubmission.workspace_id == m.workspace_id, TimesheetSubmission.status == "pending",
                    TimesheetSubmission.user_id.in_(theirs)).order_by(TimesheetSubmission.period_start).limit(15)):
                who = db.get(User, sub_.user_id)
                rows.append((f"{(who.display_name or who.email) if who else 'Someone'} — timesheet",
                             f"{sub_.period_start:%d %b} to {sub_.period_end:%d %b}", f"{base}/timesheets"))
        if not rows:
            continue  # nothing waiting: say nothing, and do not write a row that blocks tomorrow
        subject = f"{len(rows)} thing{'s' if len(rows) != 1 else ''} waiting for your decision"
        if _once(db, m, user, "approvals", period, subject, rows,
                 "These are waiting on you. Each one is somebody who cannot get on until you answer:", now=now):
            sent += 1
    db.flush()
    return sent


# --- who is away, and whose week is empty -------------------------------------------------------------


def run_manager_heads_up(db: Session, now: Optional[datetime] = None) -> int:
    """Monday: who in your team is away this week, and who logged nothing last week.

    Two facts a manager otherwise finds out by being surprised. They travel together because they
    answer the same question -- is anybody's week about to go wrong -- and because two emails on a
    Monday morning is one email too many.
    """
    from app.services.work.leave import LIVE

    now = now or datetime.now(timezone.utc)
    sent = 0
    base = settings.APP_URL.rstrip("/")
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None))):
        if m.email_notifications == "off":
            continue
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is None:
            continue
        local = _local(m, now)
        if local.weekday() != 0 or local.hour < 9:
            continue
        theirs = _team_of(db, m.workspace_id, m.user_id)
        if not theirs:
            continue
        period = _period_key("weekly", local)
        if already_sent(db, m.workspace_id, user.id, "heads_up", period):
            continue

        week_start, week_end = local.date(), local.date() + timedelta(days=6)
        rows: List[Tuple[str, str, str]] = []
        from app.db.models import LeaveRequest

        for r in db.scalars(select(LeaveRequest).where(
                LeaveRequest.workspace_id == m.workspace_id, LeaveRequest.user_id.in_(theirs),
                LeaveRequest.status.in_(LIVE), LeaveRequest.start_date <= week_end,
                LeaveRequest.end_date >= week_start).order_by(LeaveRequest.start_date)):
            who = db.get(User, r.user_id)
            rows.append((f"{(who.display_name or who.email) if who else 'Someone'} is away",
                         f"{r.start_date:%d %b} to {r.end_date:%d %b}"
                         + (" (not yet approved)" if r.status == "pending" else ""), f"{base}/leave"))

        # Last week's silence. Somebody who logged nothing either did nothing or recorded nothing,
        # and a manager wants to know which before the month closes.
        last_start = datetime.combine(week_start - timedelta(days=7), time.min, local.tzinfo)
        last_end = datetime.combine(week_start, time.min, local.tzinfo)
        for uid in theirs:
            member = db.get(WorkspaceMember, (m.workspace_id, uid))
            if member is None or member.deactivated_at is not None:
                continue
            if is_away_all_week(db, m.workspace_id, uid, last_start.date(), last_end.date() - timedelta(days=1)):
                continue  # they were on leave; an empty timesheet is the right answer
            logged = _logged_seconds(db, m.workspace_id, uid, last_start, last_end)
            if logged:
                continue
            who = db.get(User, uid)
            rows.append((f"{(who.display_name or who.email) if who else 'Someone'} logged nothing",
                         f"Week of {last_start:%d %b}", f"{base}/timesheets"))

        if not rows:
            continue
        away = sum(1 for r in rows if "is away" in r[0])
        subject = f"Your week: {away} away, {len(rows) - away} with no hours logged"
        if _once(db, m, user, "heads_up", period, subject, rows,
                 "Before the week starts, two things about your team:", now=now):
            sent += 1
    db.flush()
    return sent


def is_away_all_week(db: Session, workspace_id: uuid.UUID, user_id: str, start: date, end: date) -> bool:
    """Approved leave covering every working day of the span."""
    from app.db.models import LeaveRequest

    day = start
    while day <= end:
        if day.weekday() < 5:
            covered = db.scalars(select(LeaveRequest.id).where(
                LeaveRequest.workspace_id == workspace_id, LeaveRequest.user_id == user_id,
                LeaveRequest.status == "approved", LeaveRequest.start_date <= day,
                LeaveRequest.end_date >= day)).first()
            if covered is None:
                return False
        day += timedelta(days=1)
    return True


# --- the people who have never been through the door -----------------------------------------------


#: How long to leave an invitation before saying it again, and how many times to bother.
REMIND_INVITE_AFTER_DAYS = 4
REMIND_INVITE_TIMES = 3


def run_invite_reminders(db: Session, now: Optional[datetime] = None) -> int:
    """Ask again, a few times, the people who were invited and have not signed in.

    An invitation that arrives on a busy Tuesday is an invitation nobody opens. This says it again
    after a few days -- three times, and then it stops, because a fourth is spam and the problem
    is no longer the email.
    """
    from app.services.work.people import invite_link

    now = now or datetime.now(timezone.utc)
    sent = 0
    for m in db.scalars(select(WorkspaceMember).where(
            WorkspaceMember.deactivated_at.is_(None), WorkspaceMember.invite_sent_at.is_not(None))):
        user = db.get(User, m.user_id)
        if user is None or user.auth_uid is not None:
            continue  # they are in; nothing to remind them of
        local = _local(m, now)
        if local.hour < 9 or local.weekday() > 4:
            continue
        since = (now - m.invite_sent_at).days
        if since < REMIND_INVITE_AFTER_DAYS:
            continue
        already = db.scalar(select(func.count()).select_from(EmailLog).where(
            EmailLog.workspace_id == m.workspace_id, EmailLog.user_id == user.id,
            EmailLog.kind == "invite_reminder")) or 0
        if already >= REMIND_INVITE_TIMES:
            continue
        # One a week after the first few days, so three reminders span a fortnight rather than
        # three mornings.
        period = _period_key("weekly", local)
        workspace = db.get(Workspace, m.workspace_id)
        name = workspace.name if workspace else "your workspace"
        rows = [("Sign in to " + name, "Your account is waiting", invite_link())]
        if _once(db, m, user, "invite_reminder", period, f"You still have an account waiting on {name}",
                 rows, f"You were invited to {name} {since} days ago and have not signed in yet. "
                       "It takes a minute, and your work is already there.",
                 link_text="Sign in",
                 footer=f"If you did not expect this, nobody at {name} will mind if you ignore it."):
            sent += 1
    db.flush()
    return sent


# --- weekly team digest for managers ------------------------------------------------------------------------------------


def _team_of(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[str]:
    """Direct reports, plus the members of Teams they lead."""
    from app.services.work.teams import led_team_ids

    ids = set(db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.manager_id == user_id, WorkspaceMember.deactivated_at.is_(None))))
    led = led_team_ids(db, workspace_id, user_id)
    if led:
        from app.services.work import team_tree

        ids |= team_tree.people(db, led)
    ids.discard(user_id)
    active = set(db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id.in_(ids), WorkspaceMember.deactivated_at.is_(None))))
    return sorted(active)


def team_digest(db: Session, access: Access, today: Optional[date] = None) -> o.TeamDigest:
    """Last week and the week ahead for each person the caller manages or leads."""
    from app.services.work import mywork
    from app.services.work.leave import daily_capacity
    from app.services.work.timesheets import current_submission, period_of

    today = today or datetime.now(ZoneInfo("Asia/Kolkata")).date()
    last_monday = today - timedelta(days=today.weekday() + 7)
    last_week = [last_monday + timedelta(days=i) for i in range(7)]
    people = _team_of(db, access.workspace_id, access.user_id)
    capacity = daily_capacity(db, access.workspace_id, people, last_week)
    since = datetime.combine(last_monday, time.min, timezone.utc)
    until = since + timedelta(days=7)
    out = []
    for uid in people:
        user = db.get(User, uid)
        tasks = mywork.tasks_assigned_to(db, access, [uid], include_closed=True)
        overdue = [t for t in tasks if t.is_overdue]
        done = [t for t in tasks if t.date_done and since <= t.date_done < until]
        tracked = db.scalar(select(func.coalesce(func.sum(TimeEntry.duration_seconds), 0)).where(
            TimeEntry.user_id == uid, TimeEntry.started_at >= since, TimeEntry.started_at < until)) or 0
        period_start, _ = period_of(db, access.workspace_id, last_monday)
        sub = current_submission(db, access.workspace_id, uid, period_start)
        leave = []
        for r in db.scalars(select(LeaveRequest).where(
                LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id == uid, LeaveRequest.status.in_(("pending", "approved")),
                LeaveRequest.start_date <= today + timedelta(days=13), LeaveRequest.end_date >= today)):
            kind = db.get(LeaveType, r.type_id) if r.type_id else None
            leave.append(o.DigestLeave(start_date=r.start_date, end_date=r.end_date, type=kind.name if kind else "Leave", status=r.status))
        out.append(o.DigestPerson(
            user=s.UserOut.model_validate(user), overdue=len(overdue),
            overdue_tasks=[o.DigestTask(id=t.id, name=t.name, list_id=t.list_id, due_date=t.due_date) for t in sorted(overdue, key=lambda t: t.due_date)[:5]],
            done_last_week=len(done), tracked_seconds=int(tracked), capacity_seconds=sum(capacity.get(uid, [])),
            timesheet_status=sub.status if sub else None, leave=leave,
        ))
    out.sort(key=lambda p: (-p.overdue, (p.user.display_name or p.user.email).lower()))
    return o.TeamDigest(week_start=last_monday, week_end=last_week[-1], people=out)


def run_team_digests(db: Session, now: Optional[datetime] = None) -> int:
    """Monday 09:00 local: email each manager / team lead their team's week, once a week."""
    now = now or datetime.now(timezone.utc)
    sent = 0
    if not settings.SMTP_HOST:
        return 0
    for m in db.scalars(select(WorkspaceMember).where(WorkspaceMember.deactivated_at.is_(None), WorkspaceMember.weekly_team_digest.is_(True))):
        local = _local(m, now)
        if local.weekday() != 0 or local.hour < 9 or m.last_team_digest_on == local.date():
            continue
        m.last_team_digest_on = local.date()
        if not _team_of(db, m.workspace_id, m.user_id):
            continue
        user = db.get(User, m.user_id)
        digest = team_digest(db, Access(db, m.user_id, m.workspace_id, m.role), local.date())
        base = settings.APP_URL.rstrip("/")
        rows = [((p.user.display_name or p.user.email),
                 f"{p.overdue} overdue · {p.done_last_week} done · {round(p.tracked_seconds / 3600, 1)}h of {round(p.capacity_seconds / 3600, 1)}h logged"
                 + (f" · timesheet {p.timesheet_status}" if p.timesheet_status else "")
                 + ("".join(f" · {lv.type} leave {lv.start_date:%d %b}–{lv.end_date:%d %b}" for lv in p.leave)),
                 f"{base}/team-week") for p in digest.people]
        if user and _email(user.email, f"Your team's week ({digest.week_start:%d %b} – {digest.week_end:%d %b})", rows, "How your team did last week, and who is away soon:"):
            sent += 1
    db.flush()
    return sent
