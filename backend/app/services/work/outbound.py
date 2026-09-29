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
    LeaveRequest, LeaveType, Notification, PushSubscription, Status, StatusGroup, Task, TaskAssignee, TaskList, Team,
    TeamMember, TimeEntry, User, Workspace, WorkspaceMember, WorkspaceRole,
)
from app.schemas import outbound as o
from app.schemas import work as s
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


def _email(to: str, subject: str, rows: List[Tuple[str, str, str]], intro: str) -> bool:
    from app.services.work.dashboards.reports import send_email

    if not settings.SMTP_HOST:
        return False
    esc = html.escape
    items = "".join(
        f'<tr><td style="padding:8px 0;border-bottom:1px solid #eee"><b style="color:#111827">{esc(t)}</b><br>'
        f'<span style="color:#4b5563">{esc(line)}</span> <a href="{esc(url)}" style="color:#4f46e5">Open</a></td></tr>'
        for t, line, url in rows
    )
    body = (f'<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px">'
            f'<p style="color:#374151">{esc(intro)}</p><table style="width:100%;border-collapse:collapse">{items}</table>'
            f'<p style="color:#9ca3af;font-size:12px;margin-top:16px">Change what you get in Verve Workflow: Inbox → Settings.</p></div>')
    try:
        send_email([to], subject, body)
        return True
    except Exception:  # noqa: BLE001
        log.exception("Email to %s failed", to)
        return False


# --- the jobs ----------------------------------------------------------------------------------------------------------


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
