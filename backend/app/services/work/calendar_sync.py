"""Two-way calendar sync with Google Calendar and Outlook (Microsoft 365), as in ClickUp.

Out: the person's open tasks with a due date (assigned to them) and their Planner time blocks become
events in their calendar, and follow changes here. In: the calendar's own events show in the Planner,
and when someone moves one of the events we wrote, the time block (or the task's dates) moves too.
When both sides changed since the last sync, Verve Workflow wins.

Nothing happens until an OAuth app is configured (GOOGLE_OAUTH_* / MICROSOFT_OAUTH_*). Tokens are
stored encrypted. The HTTP calls go through `_http`, which tests replace with a fake calendar.
"""

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time as clock
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import CalendarConnection, CalendarSyncItem, Task, TimeBlock
from app.schemas import planning as p
from app.services.work.access import Access
from app.services.work.errors import Invalid, NotFound

log = logging.getLogger(__name__)

PROVIDERS = ("google", "microsoft")
WINDOW = (timedelta(days=-7), timedelta(days=60))
SYNC_EVERY = timedelta(minutes=5)
STATE_TTL = 15 * 60
MAX_EVENTS = 1000
TAG = "timetriq"  # marks the events we write


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- configuration, secrets ------------------------------------------------------------------------


def configured() -> Dict[str, bool]:
    return {
        "google": bool(settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET),
        "microsoft": bool(settings.MICROSOFT_OAUTH_CLIENT_ID and settings.MICROSOFT_OAUTH_CLIENT_SECRET),
    }


def _key_material() -> bytes:
    raw = settings.CALENDAR_TOKEN_KEY or f"{settings.GOOGLE_OAUTH_CLIENT_SECRET or ''}|{settings.MICROSOFT_OAUTH_CLIENT_SECRET or ''}|timetriq-calendar"
    return hashlib.sha256(raw.encode()).digest()


def _fernet() -> Fernet:
    return Fernet(base64.urlsafe_b64encode(_key_material()))


def seal(value: Optional[str]) -> Optional[str]:
    return _fernet().encrypt(value.encode()).decode() if value else None


def unseal(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    try:
        return _fernet().decrypt(value.encode()).decode()
    except InvalidToken:
        return None


def _sign(payload: str) -> str:
    return hmac.new(_key_material(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def make_state(user_id: str, workspace_id: uuid.UUID, provider: str, now: Optional[float] = None) -> str:
    payload = json.dumps({"u": user_id, "w": str(workspace_id), "p": provider, "t": int(now or clock.time()), "n": secrets.token_hex(6)}, separators=(",", ":"))
    body = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    return f"{body}.{_sign(body)}"


def read_state(state: str, provider: str) -> Tuple[str, uuid.UUID]:
    try:
        body, sig = state.split(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            raise ValueError
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if data["p"] != provider or clock.time() - data["t"] > STATE_TTL:
            raise ValueError
        return data["u"], uuid.UUID(data["w"])
    except (ValueError, KeyError, TypeError):
        raise Invalid("This sign-in link has expired; start connecting the calendar again") from None


def redirect_uri(provider: str) -> str:
    return f"{settings.OAUTH_REDIRECT_BASE.rstrip('/')}/api/v2/calendar-oauth/{provider}/callback"


# --- HTTP (replaced in tests) ----------------------------------------------------------------------


class ProviderError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _http(method: str, url: str, *, token: Optional[str] = None, json_body: Any = None, form: Optional[Dict[str, str]] = None,
          params: Optional[Dict[str, Any]] = None, headers: Optional[Dict[str, str]] = None) -> Any:
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    with httpx.Client(timeout=20.0) as client:
        resp = client.request(method, url, json=json_body, data=form, params=params, headers=h)
    if resp.status_code >= 400:
        raise ProviderError(resp.status_code, resp.text[:300])
    return resp.json() if resp.content else None


# --- providers -------------------------------------------------------------------------------------


GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
GOOGLE_API = "https://www.googleapis.com/calendar/v3"
MS_API = "https://graph.microsoft.com/v1.0"


def _ms_base() -> str:
    return f"https://login.microsoftonline.com/{settings.MICROSOFT_OAUTH_TENANT}/oauth2/v2.0"


def authorize_url(access: Access, provider: str) -> str:
    if provider not in PROVIDERS:
        raise NotFound("Unknown calendar")
    if not configured()[provider]:
        raise Invalid(f"{'Google' if provider == 'google' else 'Outlook'} calendar sync isn't set up on the server yet")
    state = make_state(access.user_id, access.workspace_id, provider)
    if provider == "google":
        return GOOGLE_AUTH + "?" + urlencode({
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID, "redirect_uri": redirect_uri("google"), "response_type": "code",
            "scope": "openid email https://www.googleapis.com/auth/calendar.events", "access_type": "offline", "prompt": "consent",
            "include_granted_scopes": "true", "state": state,
        })
    return _ms_base() + "/authorize?" + urlencode({
        "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID, "redirect_uri": redirect_uri("microsoft"), "response_type": "code",
        "scope": "offline_access openid email User.Read Calendars.ReadWrite", "response_mode": "query", "state": state,
    })


def _exchange(provider: str, form: Dict[str, str]) -> Dict[str, Any]:
    if provider == "google":
        return _http("POST", GOOGLE_TOKEN, form={**form, "client_id": settings.GOOGLE_OAUTH_CLIENT_ID, "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET})
    return _http("POST", _ms_base() + "/token", form={**form, "client_id": settings.MICROSOFT_OAUTH_CLIENT_ID, "client_secret": settings.MICROSOFT_OAUTH_CLIENT_SECRET})


def _email_from_id_token(id_token: Optional[str]) -> Optional[str]:
    """The account's email, from the (already trusted: it came straight from the token endpoint) ID token."""
    try:
        body = id_token.split(".")[1]  # type: ignore[union-attr]
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        return (data.get("email") or data.get("preferred_username") or "")[:320] or None
    except (AttributeError, IndexError, ValueError):
        return None


def finish_connect(db: Session, provider: str, code: str, state: str) -> CalendarConnection:
    """The OAuth callback: swap the code for tokens and store the connection."""
    user_id, workspace_id = read_state(state, provider)
    Access.for_workspace(db, user_id, workspace_id)  # still a member?
    try:
        tokens = _exchange(provider, {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect_uri(provider)})
    except (ProviderError, httpx.HTTPError):
        raise Invalid("The calendar didn't accept the sign-in; please try again") from None
    if not tokens.get("refresh_token"):
        raise Invalid("The calendar didn't grant offline access; please try again and allow it")
    conn = db.scalar(select(CalendarConnection).where(
        CalendarConnection.workspace_id == workspace_id, CalendarConnection.user_id == user_id, CalendarConnection.provider == provider))
    if conn is None:
        conn = CalendarConnection(workspace_id=workspace_id, user_id=user_id, provider=provider,
                                  color="#16a34a" if provider == "google" else "#0078d4")
        db.add(conn)
    conn.access_token = seal(tokens.get("access_token"))
    conn.refresh_token = seal(tokens["refresh_token"])
    conn.expires_at = _now() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
    conn.account_email = _email_from_id_token(tokens.get("id_token")) or conn.account_email
    conn.error = None
    db.flush()
    return conn


def _token(db: Session, conn: CalendarConnection) -> str:
    current = unseal(conn.access_token)
    if current and conn.expires_at and conn.expires_at > _now():
        return current
    refresh = unseal(conn.refresh_token)
    if not refresh:
        raise Invalid("The calendar connection has lapsed; connect it again")
    try:
        tokens = _exchange(conn.provider, {"grant_type": "refresh_token", "refresh_token": refresh})
    except ProviderError as e:
        if e.status in (400, 401):
            raise Invalid("The calendar connection has lapsed; connect it again") from None
        raise
    conn.access_token = seal(tokens["access_token"])
    if tokens.get("refresh_token"):
        conn.refresh_token = seal(tokens["refresh_token"])
    conn.expires_at = _now() + timedelta(seconds=int(tokens.get("expires_in", 3600)) - 60)
    db.flush()
    return tokens["access_token"]


@dataclass
class Remote:
    id: str
    title: str
    start: datetime
    end: datetime
    all_day: bool
    location: Optional[str]
    ours: bool
    tag: Optional[str] = None  # "task:<id>" / "block:<id>" on the events we wrote (Google keeps it; Outlook only marks them)


def _parse_when(value: Dict[str, Any]) -> Tuple[datetime, bool]:
    if value.get("dateTime"):
        raw = value["dateTime"]
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if when.tzinfo is None:  # Microsoft sends UTC without an offset when asked for UTC
            when = when.replace(tzinfo=timezone.utc)
        return when.astimezone(timezone.utc), False
    return datetime.combine(date.fromisoformat(value["date"]), datetime.min.time(), tzinfo=timezone.utc), True


def list_remote(db: Session, conn: CalendarConnection, start: datetime, end: datetime) -> List[Remote]:
    token = _token(db, conn)
    out: List[Remote] = []
    if conn.provider == "google":
        params: Dict[str, Any] = {"timeMin": start.isoformat(), "timeMax": end.isoformat(), "singleEvents": "true", "maxResults": 250, "orderBy": "startTime"}
        while len(out) < MAX_EVENTS:
            data = _http("GET", f"{GOOGLE_API}/calendars/{conn.calendar_id}/events", token=token, params=params)
            for ev in data.get("items", []):
                if ev.get("status") == "cancelled" or "start" not in ev:
                    continue
                s, all_day = _parse_when(ev["start"])
                e, _ = _parse_when(ev["end"])
                private = (ev.get("extendedProperties") or {}).get("private") or {}
                out.append(Remote(ev["id"], (ev.get("summary") or "Busy")[:200], s, e, all_day, (ev.get("location") or None), TAG in private,
                                  private.get(TAG)))
            if not data.get("nextPageToken"):
                break
            params["pageToken"] = data["nextPageToken"]
        return out
    url: Optional[str] = f"{MS_API}/me/calendarView"
    params = {"startDateTime": start.isoformat(), "endDateTime": end.isoformat(), "$top": 200,
              "$select": "id,subject,start,end,isAllDay,location,isCancelled,categories"}
    while url and len(out) < MAX_EVENTS:
        data = _http("GET", url, token=token, params=params, headers={"Prefer": 'outlook.timezone="UTC"'})
        for ev in data.get("value", []):
            if ev.get("isCancelled"):
                continue
            s, _ = _parse_when(ev["start"])
            e, _ = _parse_when(ev["end"])
            out.append(Remote(ev["id"], (ev.get("subject") or "Busy")[:200], s, e, bool(ev.get("isAllDay")),
                              ((ev.get("location") or {}).get("displayName") or None), "Verve Workflow" in (ev.get("categories") or [])))
        url, params = data.get("@odata.nextLink"), None
    return out


def _body(conn: CalendarConnection, title: str, start: datetime, end: datetime, kind: str, local_id: uuid.UUID) -> Dict[str, Any]:
    link = f"{settings.APP_URL.rstrip('/')}/planner"
    if conn.provider == "google":
        return {
            "summary": title, "description": f"From Verve Workflow — {link}",
            "start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()},
            "extendedProperties": {"private": {TAG: f"{kind}:{local_id}"}},
        }
    return {
        "subject": title, "body": {"contentType": "text", "content": f"From Verve Workflow — {link}"},
        "start": {"dateTime": start.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"},
        "end": {"dateTime": end.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "UTC"}, "categories": ["Verve Workflow"],
    }


def create_remote(db: Session, conn: CalendarConnection, body: Dict[str, Any]) -> str:
    token = _token(db, conn)
    url = f"{GOOGLE_API}/calendars/{conn.calendar_id}/events" if conn.provider == "google" else f"{MS_API}/me/events"
    return str(_http("POST", url, token=token, json_body=body)["id"])


def update_remote(db: Session, conn: CalendarConnection, remote_id: str, body: Dict[str, Any]) -> None:
    token = _token(db, conn)
    url = f"{GOOGLE_API}/calendars/{conn.calendar_id}/events/{remote_id}" if conn.provider == "google" else f"{MS_API}/me/events/{remote_id}"
    _http("PATCH", url, token=token, json_body=body)


def delete_remote(db: Session, conn: CalendarConnection, remote_id: str) -> None:
    token = _token(db, conn)
    url = f"{GOOGLE_API}/calendars/{conn.calendar_id}/events/{remote_id}" if conn.provider == "google" else f"{MS_API}/me/events/{remote_id}"
    try:
        _http("DELETE", url, token=token)
    except ProviderError as e:
        if e.status not in (404, 410):
            raise


# --- the sync ---------------------------------------------------------------------------------------


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).replace(second=0, microsecond=0).isoformat()


def _times(sig: str) -> str:
    return "|".join(sig.split("|")[:2])


@dataclass
class Local:
    kind: str
    id: uuid.UUID
    title: str
    start: datetime
    end: datetime

    @property
    def sig(self) -> str:
        return f"{_iso(self.start)}|{_iso(self.end)}|{self.title}"


def _task_window(task: Task) -> Tuple[datetime, datetime]:
    due = task.due_date
    if task.start_date and task.start_date < due and due - task.start_date <= timedelta(hours=24):
        return task.start_date, due
    return due - timedelta(minutes=30), due


def _locals(db: Session, conn: CalendarConnection, lo: datetime, hi: datetime) -> Dict[Tuple[str, uuid.UUID], Local]:
    from app.services.work import mywork

    access = Access.for_workspace(db, conn.user_id, conn.workspace_id)
    out: Dict[Tuple[str, uuid.UUID], Local] = {}
    if conn.push_tasks:
        for t in mywork.my_tasks(db, access, include_closed=False):
            if t.due_date is None or not (lo <= t.due_date < hi):
                continue
            start, end = _task_window(t)
            out[("task", t.id)] = Local("task", t.id, f"{t.custom_id + ' ' if t.custom_id else ''}{t.name}"[:200], start, end)
    if conn.push_blocks:
        tasks = {}
        for b in db.scalars(select(TimeBlock).where(TimeBlock.workspace_id == conn.workspace_id, TimeBlock.user_id == conn.user_id,
                                                    TimeBlock.end_at > lo, TimeBlock.start_at < hi)):
            name = b.title
            if name is None and b.task_id is not None:
                if b.task_id not in tasks:
                    tasks[b.task_id] = db.get(Task, b.task_id)
                name = tasks[b.task_id].name if tasks[b.task_id] else "Focus time"
            out[("block", b.id)] = Local("block", b.id, (name or "Focus time")[:200], b.start_at, b.end_at)
    return out


def _apply_remote(db: Session, conn: CalendarConnection, item: CalendarSyncItem, remote: Remote) -> Optional[Local]:
    """Someone moved one of our events in the calendar: move the time block, or the task's dates."""
    if item.kind == "block":
        block = db.get(TimeBlock, item.local_id)
        if block is None or remote.end <= remote.start:
            return None
        block.start_at, block.end_at = remote.start, remote.end
        db.flush()
        return Local("block", block.id, (block.title or remote.title)[:200], block.start_at, block.end_at)
    from app.db.models import PermissionLevel
    from app.schemas import work as s
    from app.services.work import tasks as task_service
    from app.services.work.access import open_task
    from app.services.work.errors import Forbidden

    try:
        opened = open_task(db, conn.user_id, item.local_id, PermissionLevel.edit)
    except (NotFound, Forbidden):
        return None  # they can't change it; our version wins next time
    task = opened.obj
    keeps_start = task.start_date is not None and task.due_date is not None and task.due_date - task.start_date <= timedelta(hours=24)
    update = s.TaskUpdate(due_date=remote.end, **({"start_date": remote.start} if keeps_start else {}))
    if not keeps_start and task.start_date is not None and task.start_date > remote.end:
        update = s.TaskUpdate(due_date=remote.end, start_date=None)
    task_service.update_task(db, opened, update)
    start, end = _task_window(task)
    return Local("task", task.id, remote.title, start, end)


def sync(db: Session, conn: CalendarConnection, now: Optional[datetime] = None) -> Dict[str, int]:
    """One round of two-way sync. Returns what it did."""
    now = now or _now()
    lo, hi = now + WINDOW[0], now + WINDOW[1]
    stats = {"created": 0, "updated": 0, "deleted": 0, "pulled": 0}
    try:
        remotes = {r.id: r for r in list_remote(db, conn, lo, hi)}
        locals_ = _locals(db, conn, lo, hi)
        items = {(i.kind, i.local_id): i for i in db.scalars(select(CalendarSyncItem).where(CalendarSyncItem.connection_id == conn.id))}
        for key, item in list(items.items()):
            local, remote = locals_.get(key), remotes.get(item.remote_id)
            if local is None:
                # Finished, deleted, unassigned or moved out of the window here: take it off the calendar.
                if remote is not None or item.remote_id:
                    delete_remote(db, conn, item.remote_id)
                    remotes.pop(item.remote_id, None)
                    stats["deleted"] += 1
                db.delete(item)
                items.pop(key)
                continue
            if remote is None:
                # Deleted in the calendar: a time block goes too; a task's event comes back (finish the task to remove it).
                if item.kind == "block":
                    block = db.get(TimeBlock, item.local_id)
                    if block is not None:
                        db.delete(block)
                    locals_.pop(key)
                    stats["pulled"] += 1
                db.delete(item)
                items.pop(key)
                continue
            remote_times = f"{_iso(remote.start)}|{_iso(remote.end)}"
            local_changed = local.sig != item.agreed
            remote_changed = remote_times != _times(item.agreed)
            if remote_changed and not local_changed:
                moved = _apply_remote(db, conn, item, remote)
                if moved is not None:
                    item.agreed = f"{remote_times}|{moved.title if item.kind == 'block' else local.title}"
                    item.updated_at = now
                    stats["pulled"] += 1
                    continue
                local_changed = True  # couldn't take theirs: put ours back
            if local_changed:
                update_remote(db, conn, item.remote_id, _body(conn, local.title, local.start, local.end, local.kind, local.id))
                item.agreed, item.updated_at = local.sig, now
                stats["updated"] += 1
        # Events we wrote but have no record of (a save that didn't finish): adopt one per item, remove copies.
        mapped = {i.remote_id for i in items.values()}
        for r in list(remotes.values()):
            if not r.tag or r.id in mapped:
                continue
            kind, _, raw = r.tag.partition(":")
            try:
                key = (kind, uuid.UUID(raw))
            except ValueError:
                continue
            if key in items or key not in locals_:
                if key in items or kind in ("task", "block") and _owned(db, conn, kind, key[1]):
                    delete_remote(db, conn, r.id)  # a copy, or one for something that's gone
                    remotes.pop(r.id)
                    stats["deleted"] += 1
                continue
            item = CalendarSyncItem(connection_id=conn.id, kind=kind, local_id=key[1], remote_id=r.id, agreed="")
            db.add(item)
            items[key] = item
            mapped.add(r.id)
            local = locals_[key]
            update_remote(db, conn, r.id, _body(conn, local.title, local.start, local.end, local.kind, local.id))
            item.agreed = local.sig
            stats["updated"] += 1
        for key, local in locals_.items():
            if key in items:
                continue
            rid = create_remote(db, conn, _body(conn, local.title, local.start, local.end, local.kind, local.id))
            db.add(CalendarSyncItem(connection_id=conn.id, kind=local.kind, local_id=local.id, remote_id=rid, agreed=local.sig))
            stats["created"] += 1
        mine = {i.remote_id for i in db.scalars(select(CalendarSyncItem).where(CalendarSyncItem.connection_id == conn.id))}
        conn.events = [
            {"title": r.title, "start": r.start.isoformat(), "end": r.end.isoformat(), "all_day": r.all_day, "location": r.location}
            for r in sorted(remotes.values(), key=lambda r: r.start) if r.id not in mine and not r.ours
        ] if conn.pull_events else []
        conn.error = None
    except Invalid as e:
        conn.error = str(e)[:300]
    except ProviderError as e:
        conn.error = f"The calendar answered {e.status}"[:300]
    except httpx.HTTPError:
        conn.error = "Could not reach the calendar"
    conn.synced_at = now
    db.flush()
    return stats


def _owned(db: Session, conn: CalendarConnection, kind: str, local_id: uuid.UUID) -> bool:
    """Is this task or block one of this connection's own (so an event for it is ours to tidy away)?"""
    if kind == "block":
        block = db.get(TimeBlock, local_id)
        return block is None or (block.user_id == conn.user_id and block.workspace_id == conn.workspace_id)
    from app.db.models import TaskAssignee
    from app.services.work.events import workspace_of

    task = db.get(Task, local_id)
    if task is None:
        return False  # can't tell whose it was
    return workspace_of(db, task) == conn.workspace_id and db.get(TaskAssignee, (task.id, conn.user_id)) is not None


def run_due(db: Session, now: Optional[datetime] = None) -> int:
    """Sync every connection that hasn't synced for a while. Called by the scheduler."""
    now = now or _now()
    done = 0
    for conn in db.scalars(select(CalendarConnection)):
        if conn.synced_at is not None and now - conn.synced_at < SYNC_EVERY:
            continue
        try:
            sync(db, conn, now)
            db.commit()
            done += 1
        except Exception:  # one person's broken connection must not stop the others
            db.rollback()
            log.exception("Calendar sync failed for connection %s", conn.id)
    return done


# --- managing connections ---------------------------------------------------------------------------


def connection_out(conn: CalendarConnection) -> p.CalendarConnectionOut:
    return p.CalendarConnectionOut(
        id=conn.id, provider=conn.provider, account_email=conn.account_email, push_tasks=conn.push_tasks, push_blocks=conn.push_blocks,
        pull_events=conn.pull_events, color=conn.color, event_count=len(conn.events or []), synced_at=conn.synced_at, error=conn.error,
    )


def connections(db: Session, access: Access) -> List[CalendarConnection]:
    return list(db.scalars(select(CalendarConnection).where(
        CalendarConnection.workspace_id == access.workspace_id, CalendarConnection.user_id == access.user_id).order_by(CalendarConnection.created_at)))


def own(db: Session, user_id: str, connection_id: uuid.UUID) -> CalendarConnection:
    conn = db.get(CalendarConnection, connection_id)
    if conn is None or conn.user_id != user_id:
        raise NotFound("Calendar connection not found")
    return conn


def update(db: Session, user_id: str, connection_id: uuid.UUID, data: p.CalendarConnectionUpdate) -> CalendarConnection:
    conn = own(db, user_id, connection_id)
    for name in ("push_tasks", "push_blocks", "pull_events", "color"):
        value = getattr(data, name)
        if value is not None:
            setattr(conn, name, value)
    db.flush()
    return conn


def disconnect(db: Session, user_id: str, connection_id: uuid.UUID, remove_events: bool) -> None:
    conn = own(db, user_id, connection_id)
    if remove_events:
        try:
            gone = set()
            for item in db.scalars(select(CalendarSyncItem).where(CalendarSyncItem.connection_id == conn.id)):
                delete_remote(db, conn, item.remote_id)
                gone.add(item.remote_id)
            # And any of our events the records missed.
            now = _now()
            for r in list_remote(db, conn, now + WINDOW[0], now + WINDOW[1]):
                if r.tag and r.id not in gone:
                    kind, _, raw = r.tag.partition(":")
                    try:
                        mine = _owned(db, conn, kind, uuid.UUID(raw))
                    except ValueError:
                        mine = False
                    if mine:
                        delete_remote(db, conn, r.id)
        except (ProviderError, httpx.HTTPError, Invalid) as e:
            # The calendar is unreachable; leave its events rather than fail the disconnect.
            log.warning("Could not remove calendar events while disconnecting %s: %s", conn.id, e)
    db.delete(conn)
    db.flush()


def planner_events(db: Session, access: Access, start: datetime, end: datetime) -> List[p.CalendarEvent]:
    out = []
    for conn in connections(db, access):
        for ev in conn.events or []:
            s, e = datetime.fromisoformat(ev["start"]), datetime.fromisoformat(ev["end"])
            if s < end and e > start:
                out.append(p.CalendarEvent(feed_id=conn.id, title=ev["title"], start=s, end=e, all_day=ev["all_day"],
                                           location=ev.get("location"), color=conn.color))
    return out
