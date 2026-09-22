"""Scheduled Dashboard email reports.

A schedule belongs to a Dashboard and is created by someone with edit access. When it
runs, the Dashboard is computed exactly as its creator would see it at that moment,
and emailed to the chosen workspace members. Every run is kept (with its HTML) so it
can be previewed and audited, even when email is not configured.
"""

import html
import logging
import smtplib
import threading
import uuid
from datetime import date, datetime, time, timedelta, timezone
from email.message import EmailMessage
from typing import Any, List, Optional, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    Dashboard,
    PermissionLevel,
    ReportRun,
    ReportSchedule,
    User,
    WorkspaceMember,
)
from app.schemas import dashboards as d
from app.schemas import work as s
from app.services.work.dashboards.access import OpenedDashboard, at_least, open_dashboard
from app.services.work.dashboards.engine import Engine
from app.services.work.dashboards.service import cards_of
from app.services.work.errors import Forbidden, Invalid, NotFound, WorkError

log = logging.getLogger(__name__)
RUN_HISTORY = 50


class EmailNotConfigured(Exception):
    pass


# --- timing ----------------------------------------------------------------------


def _fires_on(schedule: ReportSchedule, day: date) -> bool:
    if schedule.frequency == "daily":
        return True
    if schedule.frequency == "weekdays":
        return day.weekday() < 5
    if schedule.frequency == "weekly":
        return day.weekday() == schedule.weekday
    return day.day == schedule.day_of_month


def next_run(schedule: ReportSchedule, after: datetime) -> datetime:
    """The first send time strictly after `after`, in the schedule's timezone."""
    tz = ZoneInfo(schedule.timezone)
    hour, minute = (int(x) for x in schedule.send_time.split(":"))
    day = after.astimezone(tz).date()
    for _ in range(400):
        if _fires_on(schedule, day):
            candidate = datetime.combine(day, time(hour, minute), tz).astimezone(timezone.utc)
            if candidate > after:
                return candidate
        day += timedelta(days=1)
    raise Invalid("This schedule never fires")  # unreachable with validated input


# --- schedules ---------------------------------------------------------------------


def _check_recipients(db: Session, workspace_id: uuid.UUID, ids: List[str]) -> List[str]:
    wanted = list(dict.fromkeys(ids))
    members = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id.in_(wanted)
            )
        )
    )
    missing = [uid for uid in wanted if uid not in members]
    if missing:
        raise Invalid("Reports can only be sent to members of this workspace")
    return wanted


def schedule_out(db: Session, schedule: ReportSchedule) -> d.ScheduleOut:
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(list(schedule.recipient_ids) + [schedule.created_by or ""])))}
    creator = people.get(schedule.created_by) if schedule.created_by else None
    return d.ScheduleOut(
        id=schedule.id,
        dashboard_id=schedule.dashboard_id,
        created_by=s.UserOut.model_validate(creator) if creator else None,
        recipients=[s.UserOut.model_validate(people[uid]) for uid in schedule.recipient_ids if uid in people],
        subject=schedule.subject,
        frequency=schedule.frequency,
        weekday=schedule.weekday,
        day_of_month=schedule.day_of_month,
        send_time=schedule.send_time,
        timezone=schedule.timezone,
        active=schedule.active,
        next_run_at=schedule.next_run_at,
        last_run_at=schedule.last_run_at,
    )


def _require_edit(opened: OpenedDashboard) -> None:
    if not at_least(opened.level, PermissionLevel.edit):
        raise Forbidden("You need edit access to manage this Dashboard's email reports")


def list_schedules(db: Session, opened: OpenedDashboard) -> List[d.ScheduleOut]:
    rows = db.scalars(
        select(ReportSchedule).where(ReportSchedule.dashboard_id == opened.dashboard.id).order_by(ReportSchedule.created_at)
    )
    return [schedule_out(db, x) for x in rows]


def _apply(db: Session, opened: OpenedDashboard, schedule: ReportSchedule, data: d.ScheduleIn, now: datetime) -> None:
    schedule.recipient_ids = _check_recipients(db, opened.dashboard.workspace_id, data.recipient_ids)
    schedule.subject = data.subject or None
    schedule.frequency = data.frequency
    schedule.weekday = data.weekday if data.frequency == "weekly" else None
    schedule.day_of_month = data.day_of_month if data.frequency == "monthly" else None
    schedule.send_time = data.send_time
    schedule.timezone = data.timezone
    schedule.active = data.active
    schedule.next_run_at = next_run(schedule, now) if data.active else None


def create_schedule(db: Session, opened: OpenedDashboard, data: d.ScheduleIn, now: Optional[datetime] = None) -> ReportSchedule:
    _require_edit(opened)
    schedule = ReportSchedule(dashboard_id=opened.dashboard.id, created_by=opened.access.user_id)
    _apply(db, opened, schedule, data, now or datetime.now(timezone.utc))
    db.add(schedule)
    db.flush()
    return schedule


def _schedule(db: Session, user_id: str, schedule_id: uuid.UUID) -> Tuple[ReportSchedule, OpenedDashboard]:
    schedule = db.get(ReportSchedule, schedule_id)
    if schedule is None:
        raise NotFound("Report not found")
    opened = open_dashboard(db, user_id, schedule.dashboard_id)
    return schedule, opened


def update_schedule(db: Session, user_id: str, schedule_id: uuid.UUID, data: d.ScheduleIn, now: Optional[datetime] = None) -> ReportSchedule:
    schedule, opened = _schedule(db, user_id, schedule_id)
    _require_edit(opened)
    _apply(db, opened, schedule, data, now or datetime.now(timezone.utc))
    # The report is gathered as whoever set it up last.
    schedule.created_by = user_id
    db.flush()
    return schedule


def delete_schedule(db: Session, user_id: str, schedule_id: uuid.UUID) -> None:
    schedule, opened = _schedule(db, user_id, schedule_id)
    _require_edit(opened)
    db.delete(schedule)
    db.flush()


def list_runs(db: Session, opened: OpenedDashboard) -> List[ReportRun]:
    # Runs hold the report as its creator saw it, so only editors may look at them.
    _require_edit(opened)
    return list(
        db.scalars(
            select(ReportRun).where(ReportRun.dashboard_id == opened.dashboard.id)
            .order_by(ReportRun.created_at.desc()).limit(RUN_HISTORY)
        )
    )


def get_run(db: Session, user_id: str, run_id: uuid.UUID) -> ReportRun:
    run = db.get(ReportRun, run_id)
    if run is None:
        raise NotFound("Report run not found")
    _require_edit(open_dashboard(db, user_id, run.dashboard_id))
    return run


# --- rendering ------------------------------------------------------------------------


def _duration(seconds: Optional[float]) -> str:
    if not seconds:
        return "0m"
    seconds = int(seconds)
    h, m = seconds // 3600, (seconds % 3600) // 60
    return f"{h}h {m}m" if h and m else f"{h}h" if h else f"{m}m"


def _value(value: Any, fmt: str) -> str:
    if value is None:
        return "–"
    return _duration(value) if fmt == "duration" else f"{value:,}"


_CELL = "padding:6px 8px;border-bottom:1px solid #eef0f3;font-size:13px;color:#374151;text-align:left"
_HEAD = "padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#6b7280;text-align:left;font-weight:600"


def _table(headers: List[str], rows: List[List[str]]) -> str:
    if not rows:
        return '<p style="color:#9ca3af;font-size:13px;margin:4px 0">Nothing to show.</p>'
    head = "".join(f'<th style="{_HEAD}">{html.escape(h)}</th>' for h in headers)
    body = "".join("<tr>" + "".join(f'<td style="{_CELL}">{c}</td>' for c in row) + "</tr>" for row in rows)
    return f'<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse">{"<tr>" + head + "</tr>"}{body}</table>'


def _bar(value: float, top: float, color: str) -> str:
    width = 0 if not top else max(2, round(180 * value / top))
    return f'<span style="display:inline-block;height:10px;width:{width}px;background:{color};border-radius:3px"></span>'


def render_card(card, data: d.CardData) -> str:
    esc = html.escape
    if data.no_access:
        return '<p style="color:#9ca3af;font-size:13px">You do not have access to the locations this card uses.</p>'
    if data.error:
        return f'<p style="color:#b91c1c;font-size:13px">{esc(data.error)}</p>'
    x = data.data
    if card.type == "notes":
        return f'<p style="white-space:pre-wrap;font-size:13px;color:#374151">{esc(x.get("text", ""))}</p>'
    if card.type == "calculation":
        unit = f' <span style="font-size:14px;color:#6b7280">{esc(x["unit"])}</span>' if x.get("unit") else ""
        return f'<div style="font-size:30px;font-weight:700;color:#111827">{_value(x["value"], x["format"])}{unit}</div>'
    if card.type in ("pie", "bar", "line"):
        segs = x["segments"]
        top = max((sg["value"] for sg in segs), default=0)
        rows = [[esc(sg["label"]), _value(sg["value"], x["format"]), _bar(sg["value"], top, sg["color"])] for sg in segs]
        return _table(["", "Value", ""], rows)
    if card.type == "task_list":
        rows = []
        for t in x["tasks"][:50]:
            who = ", ".join(a.get("display_name") or a["email"] for a in t["assignees"]) or "–"
            due = t["due_date"][:10] if t.get("due_date") else "–"
            rows.append([esc(t["name"]), esc(t["status"]["name"]), esc(who), due])
        more = x["total"] - len(rows)
        tail = f'<p style="font-size:12px;color:#6b7280">and {more} more</p>' if more > 0 else ""
        return _table(["Task", "Status", "Assignees", "Due"], rows) + tail
    if card.type == "time_report":
        rows = []
        for r in x["rows"]:
            rows.append([f"<b>{esc(r['label'])}</b>", f"<b>{_duration(r['seconds'])}</b>"])
            for c in r["children"][:10]:
                rows.append([f'<span style="padding-left:14px">{esc(c["label"])}</span>', _duration(c["seconds"])])
        rows.append(["<b>Total</b>", f"<b>{_duration(x['total_seconds'])}</b>"])
        return _table(["", "Tracked"], rows)
    if card.type == "timesheet":
        days = [datetime.fromisoformat(day).strftime("%a %d") for day in x["days"]]
        rows = [
            [esc(r["user"]["display_name"] or r["user"]["email"])] + [_duration(v) if v else "–" for v in r["seconds_per_day"]] + [f"<b>{_duration(r['total'])}</b>"]
            for r in x["rows"]
        ]
        return _table(["Person"] + days + ["Total"], rows)
    if card.type == "embed":
        url = x.get("url") or ""
        return f'<p style="font-size:13px"><a href="{esc(url)}" style="color:#4f46e5">{esc(url) or "Embedded page"}</a></p>'
    if card.type == "discussion":
        return f'<p style="font-size:13px;color:#374151">{x.get("count", 0)} message(s) in the discussion.</p>'
    if card.type == "behind":
        if not x["rows"]:
            return '<p style="color:#16a34a;margin:0">Nobody is behind. 🎉</p>'
        rows = [
            [esc((r["user"] or {}).get("display_name") or (r["user"] or {}).get("email") or "Unassigned"), f'<b>{r["overdue"]}</b>', f'{r["oldest_days"]} days']
            for r in x["rows"]
        ]
        return _table(["Person", "Overdue", "Most overdue"], rows)
    if card.type == "completed":
        rows = [
            [esc((r["user"] or {}).get("display_name") or (r["user"] or {}).get("email") or "Unassigned"), f'<b>{r["done"]}</b>', str(r["late"])]
            for r in x["rows"]
        ]
        rows.append(["<b>Total</b>", f'<b>{x["total"]}</b>', str(x["late"])])
        return _table(["Person", "Completed", "Late"], rows)
    if card.type == "portfolio":
        rows = [
            [esc(r["path"]), f'{r["progress"]}%', str(r["open"]), str(r["overdue"]), _duration(r["estimate_seconds"]), _duration(r["tracked_seconds"])]
            for r in x["rows"]
        ]
        return _table(["List", "Done", "Open", "Overdue", "Estimated", "Tracked"], rows)
    return ""


def render_report(db: Session, opened: OpenedDashboard, tz: ZoneInfo, now: Optional[datetime] = None) -> str:
    dash = opened.dashboard
    engine = Engine(db, opened.access, tz, d.Filters.model_validate(dash.filters or {}), now=now)
    moment = engine.now.astimezone(tz)
    blocks = []
    for card in cards_of(db, dash.id):
        data = engine.compute(card)
        blocks.append(
            '<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 14px;background:#ffffff">'
            f'<div style="font-size:14px;font-weight:600;color:#111827;margin-bottom:8px">{html.escape(card.title)}</div>'
            f"{render_card(card, data)}</div>"
        )
    link = f"{settings.APP_URL.rstrip('/')}/dashboards/{dash.id}"
    return (
        '<div style="background:#f5f6f8;padding:24px 12px;font-family:Segoe UI,Arial,sans-serif">'
        '<div style="max-width:760px;margin:0 auto">'
        f'<div style="font-size:12px;color:#6b7280">Timetriq Dashboard report · {moment.strftime("%a %d %b %Y, %H:%M")} ({tz.key})</div>'
        f'<h1 style="font-size:22px;color:#111827;margin:6px 0 16px">{html.escape(dash.name)}</h1>'
        + ("".join(blocks) or '<p style="color:#6b7280">This Dashboard has no cards yet.</p>')
        + f'<p style="font-size:12px;color:#6b7280">Figures are what the person who set up this report can see. '
        f'<a href="{html.escape(link)}" style="color:#4f46e5">Open the Dashboard in Timetriq</a></p>'
        "</div></div>"
    )


# --- sending ------------------------------------------------------------------------


def send_email(recipients: List[str], subject: str, body_html: str) -> None:
    if not settings.SMTP_HOST:
        raise EmailNotConfigured("Email is not configured on the server (SMTP_HOST is not set)")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.SMTP_FROM or settings.SMTP_USER or "timetriq@localhost"
    message["To"] = ", ".join(recipients)
    message.set_content("This report is best viewed in an email client that shows HTML.")
    message.add_alternative(body_html, subtype="html")
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as smtp:
        if settings.SMTP_STARTTLS:
            smtp.starttls()
        if settings.SMTP_USER:
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD or "")
        smtp.send_message(message)


def run_schedule(db: Session, schedule: ReportSchedule, triggered_by: Optional[str], now: Optional[datetime] = None) -> ReportRun:
    """Build and send one report now, and record the attempt."""
    dash = db.get(Dashboard, schedule.dashboard_id)
    assert dash is not None
    subject = schedule.subject or f"{dash.name} — Dashboard report"
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_(schedule.recipient_ids)))}
    members = set(
        db.scalars(
            select(WorkspaceMember.user_id).where(
                WorkspaceMember.workspace_id == dash.workspace_id, WorkspaceMember.user_id.in_(schedule.recipient_ids)
            )
        )
    )
    emails = [people[uid].email for uid in schedule.recipient_ids if uid in people and uid in members]
    run = ReportRun(schedule_id=schedule.id, dashboard_id=dash.id, triggered_by=triggered_by, subject=subject,
                    recipients=emails, html="", status="failed")
    try:
        if not schedule.created_by:
            raise Forbidden("The person who set up this report no longer exists")
        opened = open_dashboard(db, schedule.created_by, dash.id)
        run.html = render_report(db, opened, ZoneInfo(schedule.timezone), now)
        if not emails:
            raise Invalid("None of the recipients are in the workspace any more")
        send_email(emails, subject, run.html)
        run.status = "sent"
    except EmailNotConfigured as exc:
        run.status, run.error = "not_sent", str(exc)
    except WorkError as exc:
        # The creator lost access (or left): stop sending until someone fixes it.
        run.error = f"{exc}. The schedule was paused."
        schedule.active = False
        schedule.next_run_at = None
    except Exception as exc:  # SMTP and network errors
        log.exception("Sending report %s failed", schedule.id)
        run.error = f"Sending failed: {exc}"
    db.add(run)
    db.flush()
    return run


def send_now(db: Session, user_id: str, schedule_id: uuid.UUID) -> ReportRun:
    schedule, opened = _schedule(db, user_id, schedule_id)
    _require_edit(opened)
    return run_schedule(db, schedule, user_id)


def run_due(db: Session, now: Optional[datetime] = None) -> int:
    """Send every report that is due. Safe to run from several processes at once."""
    now = now or datetime.now(timezone.utc)
    due = list(
        db.scalars(
            select(ReportSchedule)
            .where(ReportSchedule.active.is_(True), ReportSchedule.next_run_at <= now)
            .order_by(ReportSchedule.next_run_at)
            .limit(20)
            .with_for_update(skip_locked=True)
        )
    )
    for schedule in due:
        schedule.last_run_at = now
        schedule.next_run_at = next_run(schedule, now)
        run_schedule(db, schedule, None, now)
    db.commit()
    return len(due)


# --- the background loop ------------------------------------------------------------------

_stop = threading.Event()


def _loop() -> None:
    from app.db.session import new_session

    from app.services.work import recurrence

    while not _stop.wait(60):
        try:
            with new_session() as db:
                while run_due(db) == 20:
                    pass  # more were waiting
        except Exception:
            log.exception("Checking for due Dashboard reports failed")
        try:
            with new_session() as db:
                while recurrence.run_due(db) == 100:
                    pass
        except Exception:
            log.exception("Creating scheduled recurring tasks failed")
        try:
            from app.services.work import inbox

            with new_session() as db:
                while inbox.run_due_reminders(db) == 200:
                    pass
        except Exception:
            log.exception("Sending due reminders failed")


def start_scheduler() -> Optional[threading.Thread]:
    if not (settings.REPORTS_SCHEDULER_ENABLED and settings.DATABASE_URL):
        return None
    _stop.clear()
    thread = threading.Thread(target=_loop, name="dashboard-reports", daemon=True)
    thread.start()
    return thread


def stop_scheduler() -> None:
    _stop.set()
