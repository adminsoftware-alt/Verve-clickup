"""My Tasks extras, as in ClickUp: the Planner (time blocks next to your meetings), calendar sync both ways,
your personal LineUp, and the layout of the My Tasks home.

Calendar sync:
- In: someone pastes the secret iCal address of their Google or Outlook calendar. The server fetches it
  (https only, never an internal address), expands repeating meetings, and caches the events.
- Out: each person can get a secret .ics address of their own tasks (by due date) and time blocks,
  which Google or Outlook can subscribe to.
"""

import ipaddress
import secrets
import socket
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlsplit

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import CalendarFeed, LineupItem, PermissionLevel, Task, TimeBlock, WorkspaceMember
from app.schemas import planning as p
from app.services.work import mywork
from app.services.work.access import Access, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound

MAX_LINEUP = 50
MAX_FEEDS = 10
MAX_FEED_BYTES = 5 * 1024 * 1024
MAX_EVENTS = 2000
FEED_TTL = timedelta(minutes=30)
FEED_WINDOW = (timedelta(days=-30), timedelta(days=120))


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- Planner: time blocks ---------------------------------------------------------------------------


def _task_in_workspace(db: Session, access: Access, task_id: uuid.UUID) -> Task:
    opened = open_task(db, access.user_id, task_id, PermissionLevel.view)
    if opened.access.workspace_id != access.workspace_id:
        raise NotFound("Task not found")
    return opened.obj


def _block_out(block: TimeBlock, tasks: Dict[uuid.UUID, Any]) -> p.TimeBlockOut:
    return p.TimeBlockOut(
        id=block.id, task_id=block.task_id, title=block.title, start_at=block.start_at, end_at=block.end_at,
        task=tasks.get(block.task_id) if block.task_id else None,
    )


def _blocks_out(db: Session, access: Access, blocks: List[TimeBlock]) -> List[p.TimeBlockOut]:
    ids = {b.task_id for b in blocks if b.task_id}
    tasks = {t.id: t for t in mywork.tasks_among(db, access, select(Task.id).where(Task.id.in_(ids)), include_closed=True)} if ids else {}
    # A block for a task the person can no longer open is left out.
    return [_block_out(b, tasks) for b in blocks if b.task_id is None or b.task_id in tasks]


def planner(db: Session, access: Access, start: datetime, end: datetime) -> p.PlannerOut:
    if end <= start or end - start > timedelta(days=62):
        raise Invalid("Pick a range of up to two months")
    blocks = list(db.scalars(
        select(TimeBlock)
        .where(TimeBlock.workspace_id == access.workspace_id, TimeBlock.user_id == access.user_id,
               TimeBlock.start_at < end, TimeBlock.end_at > start)
        .order_by(TimeBlock.start_at)
    ))
    events: List[p.CalendarEvent] = []
    errors: Dict[str, str] = {}
    for feed in _feeds(db, access):
        if feed.fetched_at is None or _now() - feed.fetched_at > FEED_TTL:
            refresh_feed(db, feed)
        if feed.error:
            errors[str(feed.id)] = feed.error
        for ev in feed.events:
            ev_start, ev_end = datetime.fromisoformat(ev["start"]), datetime.fromisoformat(ev["end"])
            if ev_start < end and ev_end > start:
                events.append(p.CalendarEvent(feed_id=feed.id, title=ev["title"], start=ev_start, end=ev_end,
                                              all_day=ev["all_day"], location=ev.get("location"), color=feed.color))
    from app.services.work import calendar_sync

    events.extend(calendar_sync.planner_events(db, access, start, end))  # Google / Outlook, two-way
    events.sort(key=lambda e: e.start)
    return p.PlannerOut(blocks=_blocks_out(db, access, blocks), events=events, feed_errors=errors,
                        days_off=_days_off(db, access, start.date() - timedelta(days=1), end.date()))


def _days_off(db: Session, access: Access, first: date, last: date) -> List[p.DayOff]:
    """The caller's leave (approved or pending) and company holidays, day by day."""
    from app.db.models import Holiday, LeaveRequest, LeaveType

    out = [p.DayOff(day=h.day, label=h.name, kind="holiday") for h in db.scalars(select(Holiday).where(
        Holiday.workspace_id == access.workspace_id, Holiday.day >= first, Holiday.day <= last))]
    for r in db.scalars(select(LeaveRequest).where(
            LeaveRequest.workspace_id == access.workspace_id, LeaveRequest.user_id == access.user_id,
            LeaveRequest.status.in_(("pending", "approved")), LeaveRequest.start_date <= last, LeaveRequest.end_date >= first)):
        kind = db.get(LeaveType, r.type_id) if r.type_id else None
        day = max(r.start_date, first)
        while day <= min(r.end_date, last):
            out.append(p.DayOff(day=day, label=f"{kind.name if kind else 'Leave'} leave", part=r.part, kind="leave", pending=r.status == "pending"))
            day += timedelta(days=1)
    return sorted(out, key=lambda d: d.day)


def add_block(db: Session, access: Access, data: p.TimeBlockIn) -> p.TimeBlockOut:
    if data.task_id is not None:
        _task_in_workspace(db, access, data.task_id)
    block = TimeBlock(workspace_id=access.workspace_id, user_id=access.user_id, task_id=data.task_id,
                      title=data.title, start_at=data.start_at, end_at=data.end_at)
    db.add(block)
    db.flush()
    return _blocks_out(db, access, [block])[0]


def _own_block(db: Session, access: Access, block_id: uuid.UUID) -> TimeBlock:
    block = db.get(TimeBlock, block_id)
    if block is None or block.workspace_id != access.workspace_id or block.user_id != access.user_id:
        raise NotFound("Time block not found")
    return block


def update_block(db: Session, access: Access, block_id: uuid.UUID, data: p.TimeBlockUpdate) -> p.TimeBlockOut:
    block = _own_block(db, access, block_id)
    fields = data.model_fields_set
    if "title" in fields:
        if data.title is None and block.task_id is None:
            raise Invalid("A time block needs a task or a title")
        block.title = data.title
    start = data.start_at if "start_at" in fields and data.start_at else block.start_at
    end = data.end_at if "end_at" in fields and data.end_at else block.end_at
    if start.tzinfo is None or end.tzinfo is None:
        raise Invalid("Times must include a timezone")
    if end <= start or (end - start).total_seconds() > 24 * 3600:
        raise Invalid("A time block must end after it starts, and last at most 24 hours")
    block.start_at, block.end_at = start, end
    db.flush()
    return _blocks_out(db, access, [block])[0]


def remove_block(db: Session, access: Access, block_id: uuid.UUID) -> None:
    db.delete(_own_block(db, access, block_id))
    db.flush()


# --- LineUp -----------------------------------------------------------------------------------------


def lineup(db: Session, access: Access) -> List[Any]:
    rows = list(db.scalars(
        select(LineupItem).where(LineupItem.workspace_id == access.workspace_id, LineupItem.user_id == access.user_id)
        .order_by(LineupItem.position)
    ))
    if not rows:
        return []
    found = {t.id: t for t in mywork.tasks_among(db, access, select(Task.id).where(Task.id.in_([r.task_id for r in rows])), include_closed=False)}
    # Finished tasks and tasks you can no longer open drop out of your LineUp.
    return [found[r.task_id] for r in rows if r.task_id in found]


def add_to_lineup(db: Session, access: Access, task_id: uuid.UUID) -> None:
    _task_in_workspace(db, access, task_id)
    mine = select(LineupItem).where(LineupItem.workspace_id == access.workspace_id, LineupItem.user_id == access.user_id)
    if db.scalars(mine.where(LineupItem.task_id == task_id)).first():
        return
    if (db.scalar(select(func.count()).select_from(mine.subquery())) or 0) >= MAX_LINEUP:
        raise Invalid(f"Your LineUp holds up to {MAX_LINEUP} tasks")
    top = db.scalar(select(func.max(LineupItem.position)).where(LineupItem.user_id == access.user_id, LineupItem.workspace_id == access.workspace_id))
    db.add(LineupItem(workspace_id=access.workspace_id, user_id=access.user_id, task_id=task_id, position=(top or 0) + 1))
    db.flush()


def remove_from_lineup(db: Session, access: Access, task_id: uuid.UUID) -> None:
    row = db.scalars(select(LineupItem).where(LineupItem.workspace_id == access.workspace_id, LineupItem.user_id == access.user_id,
                                              LineupItem.task_id == task_id)).first()
    if row is not None:
        db.delete(row)
        db.flush()


def reorder_lineup(db: Session, access: Access, task_ids: List[uuid.UUID]) -> None:
    rows = {r.task_id: r for r in db.scalars(
        select(LineupItem).where(LineupItem.workspace_id == access.workspace_id, LineupItem.user_id == access.user_id)
    )}
    if len(set(task_ids)) != len(task_ids) or not set(task_ids) <= set(rows):
        raise Invalid("The order must list tasks in your LineUp, once each")
    # Tasks left out (e.g. ones hidden from you now) keep their place after the ones given.
    order = task_ids + [tid for tid in sorted(rows, key=lambda t: rows[t].position) if tid not in task_ids]
    for i, tid in enumerate(order):
        rows[tid].position = float(i + 1)
    db.flush()


# --- My Tasks home layout ------------------------------------------------------------------------------


def _member(db: Session, access: Access) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (access.workspace_id, access.user_id))
    if member is None:
        raise Forbidden("You are not a member of this workspace")
    return member


def home_layout(db: Session, access: Access) -> p.HomeLayout:
    raw = _member(db, access).home_layout
    return p.HomeLayout(cards=[p.HomeCard.model_validate(c) for c in raw] if raw else None)


def save_home_layout(db: Session, access: Access, layout: p.HomeLayout) -> p.HomeLayout:
    _member(db, access).home_layout = [c.model_dump() for c in layout.cards] if layout.cards is not None else None
    db.flush()
    return home_layout(db, access)


# --- Calendar sync: in --------------------------------------------------------------------------------


def _feeds(db: Session, access: Access) -> List[CalendarFeed]:
    return list(db.scalars(
        select(CalendarFeed).where(CalendarFeed.workspace_id == access.workspace_id, CalendarFeed.user_id == access.user_id)
        .order_by(CalendarFeed.created_at)
    ))


def feed_out(feed: CalendarFeed) -> p.CalendarFeedOut:
    return p.CalendarFeedOut(id=feed.id, name=feed.name, color=feed.color, host=urlsplit(feed.url).hostname or "",
                             event_count=len(feed.events), fetched_at=feed.fetched_at, error=feed.error)


def list_feeds(db: Session, access: Access) -> List[p.CalendarFeedOut]:
    return [feed_out(f) for f in _feeds(db, access)]


def _normalise_url(url: str) -> str:
    url = url.strip()
    if url.lower().startswith("webcal://"):
        url = "https://" + url[len("webcal://"):]
    parts = urlsplit(url)
    if parts.scheme.lower() != "https" or not parts.hostname:
        raise Invalid("Use the calendar's secret https:// (or webcal://) iCal address")
    return url


def _check_public_host(host: str) -> None:
    """Refuse addresses inside our own network, so a feed can't be used to probe it."""
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise Invalid(f"Could not find {host}")
    for info in infos:
        if not ipaddress.ip_address(info[4][0]).is_global:
            raise Invalid("That address isn't on the public internet")


def _download(url: str) -> bytes:
    """Fetch a feed, following up to three redirects, each checked again. Tests replace this."""
    for _ in range(4):
        _check_public_host(urlsplit(url).hostname or "")
        with httpx.Client(timeout=10.0, follow_redirects=False) as client:
            with client.stream("GET", url, headers={"Accept": "text/calendar"}) as resp:
                if resp.is_redirect:
                    url = _normalise_url(urljoin(url, resp.headers.get("location", "")))
                    continue
                if resp.status_code != 200:
                    raise Invalid(f"The calendar answered {resp.status_code}")
                body = b""
                for chunk in resp.iter_bytes():
                    body += chunk
                    if len(body) > MAX_FEED_BYTES:
                        raise Invalid("The calendar is too large (over 5 MB)")
                return body
    raise Invalid("The calendar redirected too many times")


def _as_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.combine(value, time.min, tzinfo=timezone.utc)


def parse_ics(body: bytes, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Events in the feed from a month ago to four months ahead, with repeating meetings expanded."""
    import icalendar
    import recurring_ical_events

    try:
        cal = icalendar.Calendar.from_ical(body)
    except ValueError:
        raise Invalid("That address didn't return a calendar (.ics)")
    now = now or _now()
    out: List[Dict[str, Any]] = []
    for ev in recurring_ical_events.of(cal).between(now + FEED_WINDOW[0], now + FEED_WINDOW[1]):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED" or ev.get("DTSTART") is None:
            continue
        raw_start = ev.get("DTSTART").dt
        all_day = isinstance(raw_start, date) and not isinstance(raw_start, datetime)
        if ev.get("DTEND") is not None:
            raw_end = ev.get("DTEND").dt
        elif ev.get("DURATION") is not None:
            raw_end = raw_start + ev.get("DURATION").dt
        else:
            raw_end = raw_start + (timedelta(days=1) if all_day else timedelta(0))
        start, end = _as_datetime(raw_start), _as_datetime(raw_end)
        if end <= start:
            end = start + timedelta(minutes=30)
        out.append({
            "title": str(ev.get("SUMMARY") or "Busy")[:200],
            "start": start.isoformat() if not all_day else raw_start.isoformat() + "T00:00:00+00:00",
            "end": end.isoformat(),
            "all_day": all_day,
            "location": str(ev.get("LOCATION"))[:200] if ev.get("LOCATION") else None,
        })
        if len(out) >= MAX_EVENTS:
            break
    out.sort(key=lambda e: e["start"])
    return out


def refresh_feed(db: Session, feed: CalendarFeed) -> None:
    try:
        feed.events = parse_ics(_download(feed.url))
        feed.error = None
    except Invalid as e:
        feed.error = str(e)[:300]
    except (httpx.HTTPError, OSError):
        feed.error = "Could not reach the calendar"
    feed.fetched_at = _now()
    db.flush()


def add_feed(db: Session, access: Access, data: p.CalendarFeedIn) -> p.CalendarFeedOut:
    if len(_feeds(db, access)) >= MAX_FEEDS:
        raise Invalid(f"You can connect up to {MAX_FEEDS} calendars")
    url = _normalise_url(data.url)
    # Read it once now, so a wrong address is caught while the person is still here.
    events = parse_ics(_download(url))
    feed = CalendarFeed(workspace_id=access.workspace_id, user_id=access.user_id, name=data.name, url=url,
                        color=data.color, events=events, fetched_at=_now())
    db.add(feed)
    db.flush()
    return feed_out(feed)


def _own_feed(db: Session, access: Access, feed_id: uuid.UUID) -> CalendarFeed:
    feed = db.get(CalendarFeed, feed_id)
    if feed is None or feed.workspace_id != access.workspace_id or feed.user_id != access.user_id:
        raise NotFound("Calendar not found")
    return feed


def sync_feed(db: Session, access: Access, feed_id: uuid.UUID) -> p.CalendarFeedOut:
    feed = _own_feed(db, access, feed_id)
    refresh_feed(db, feed)
    return feed_out(feed)


def remove_feed(db: Session, access: Access, feed_id: uuid.UUID) -> None:
    db.delete(_own_feed(db, access, feed_id))
    db.flush()


# --- Calendar sync: out ---------------------------------------------------------------------------------


def calendar_token(db: Session, access: Access, reset: bool = False) -> str:
    member = _member(db, access)
    if member.ical_token is None or reset:
        member.ical_token = secrets.token_urlsafe(32)
        db.flush()
    return member.ical_token


def stop_calendar_link(db: Session, access: Access) -> None:
    _member(db, access).ical_token = None
    db.flush()


def ics_for_token(db: Session, token: str) -> bytes:
    """The subscribed calendar: open tasks assigned to the person (at their due time) and their time blocks."""
    import icalendar

    member = db.scalars(select(WorkspaceMember).where(WorkspaceMember.ical_token == token)).first() if token else None
    if member is None:
        raise NotFound("Calendar not found")
    access = Access.for_workspace(db, member.user_id, member.workspace_id)
    cal = icalendar.Calendar()
    cal.add("prodid", "-//Verve Workflow//Tasks//EN")
    cal.add("version", "2.0")
    cal.add("x-wr-calname", "Verve Workflow tasks")
    stamp = _now()
    tasks = mywork.my_tasks(db, access, include_closed=False)
    for t in tasks:
        if t.due_date is None:
            continue
        start = t.start_date if t.start_date and t.start_date < t.due_date and t.due_date - t.start_date <= timedelta(hours=24) else t.due_date - timedelta(minutes=30)
        ev = icalendar.Event()
        ev.add("uid", f"task-{t.id}@timetriq")
        ev.add("summary", f"{t.custom_id + ' ' if t.custom_id else ''}{t.name}")
        ev.add("dtstart", start)
        ev.add("dtend", t.due_date)
        ev.add("dtstamp", stamp)
        cal.add_component(ev)
    by_id = {t.id: t for t in tasks}
    horizon = stamp - timedelta(days=30)
    for block in db.scalars(select(TimeBlock).where(TimeBlock.workspace_id == member.workspace_id, TimeBlock.user_id == member.user_id,
                                                    TimeBlock.end_at > horizon)):
        if block.task_id is not None and block.task_id not in by_id:
            continue  # finished, or no longer visible
        ev = icalendar.Event()
        ev.add("uid", f"block-{block.id}@timetriq")
        ev.add("summary", block.title or by_id[block.task_id].name)
        ev.add("dtstart", block.start_at)
        ev.add("dtend", block.end_at)
        ev.add("dtstamp", stamp)
        cal.add_component(ev)
    return cal.to_ical()
