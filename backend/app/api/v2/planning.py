"""My Tasks extras (Planner, calendar sync, LineUp, Home layout, My Work tabs) and Automations."""

import uuid
from datetime import datetime
from typing import Callable, List, Optional

from fastapi import APIRouter, Depends, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.schemas import planning as p
from app.schemas import work as s
from app.services.work import automations, mywork, planning
from app.services.work.access import Access, open_folder, open_list, open_space

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


# --- Planner ----------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/planner", response_model=p.PlannerOut)
def planner(
    workspace_id: uuid.UUID, start: datetime = Query(...), end: datetime = Query(...),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    out = planning.planner(db, _access(db, user, workspace_id), start, end)
    db.commit()  # calendars fetched again are cached
    return out


@router.post("/workspaces/{workspace_id}/time-blocks", response_model=p.TimeBlockOut, status_code=status.HTTP_201_CREATED)
def add_block(workspace_id: uuid.UUID, data: p.TimeBlockIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = planning.add_block(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.patch("/workspaces/{workspace_id}/time-blocks/{block_id}", response_model=p.TimeBlockOut)
def update_block(workspace_id: uuid.UUID, block_id: uuid.UUID, data: p.TimeBlockUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = planning.update_block(db, _access(db, user, workspace_id), block_id, data)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/time-blocks/{block_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_block(workspace_id: uuid.UUID, block_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    planning.remove_block(db, _access(db, user, workspace_id), block_id)
    db.commit()


# --- Calendar sync ------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/calendars", response_model=List[p.CalendarFeedOut])
def calendars(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return planning.list_feeds(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/calendars", response_model=p.CalendarFeedOut, status_code=status.HTTP_201_CREATED)
def add_calendar(workspace_id: uuid.UUID, data: p.CalendarFeedIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = planning.add_feed(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.post("/workspaces/{workspace_id}/calendars/{feed_id}/sync", response_model=p.CalendarFeedOut)
def sync_calendar(workspace_id: uuid.UUID, feed_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = planning.sync_feed(db, _access(db, user, workspace_id), feed_id)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/calendars/{feed_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_calendar(workspace_id: uuid.UUID, feed_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    planning.remove_feed(db, _access(db, user, workspace_id), feed_id)
    db.commit()


def _feed_url(request: Request, token: str) -> str:
    return str(request.url_for("tasks_calendar", token=token))


@router.get("/workspaces/{workspace_id}/calendar-link", response_model=p.CalendarLinkOut)
def calendar_link(workspace_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    member_token = planning._member(db, _access(db, user, workspace_id)).ical_token
    return p.CalendarLinkOut(url=_feed_url(request, member_token) if member_token else None)


@router.post("/workspaces/{workspace_id}/calendar-link", response_model=p.CalendarLinkOut)
def make_calendar_link(workspace_id: uuid.UUID, request: Request, reset: bool = Query(False), user: User = Depends(current_user), db: Session = Depends(get_db)):
    token = planning.calendar_token(db, _access(db, user, workspace_id), reset=reset)
    db.commit()
    return p.CalendarLinkOut(url=_feed_url(request, token))


@router.delete("/workspaces/{workspace_id}/calendar-link", status_code=status.HTTP_204_NO_CONTENT)
def stop_calendar_link(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    planning.stop_calendar_link(db, _access(db, user, workspace_id))
    db.commit()


@router.get("/calendar/{token}.ics", name="tasks_calendar", include_in_schema=False)
def tasks_calendar(token: str, db: Session = Depends(get_db)):
    """The secret-address calendar Google or Outlook subscribes to. No sign-in: the address is the key."""
    return Response(planning.ics_for_token(db, token), media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "private, max-age=300"})


# --- LineUp, Home layout, My Work ------------------------------------------------------------------------------


class LineupAdd(BaseModel):
    task_id: uuid.UUID


@router.get("/workspaces/{workspace_id}/lineup", response_model=List[s.TaskOut])
def lineup(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return planning.lineup(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/lineup", response_model=List[s.TaskOut])
def add_to_lineup(workspace_id: uuid.UUID, data: LineupAdd, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    planning.add_to_lineup(db, access, data.task_id)
    db.commit()
    return planning.lineup(db, access)


@router.delete("/workspaces/{workspace_id}/lineup/{task_id}", response_model=List[s.TaskOut])
def remove_from_lineup(workspace_id: uuid.UUID, task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    planning.remove_from_lineup(db, access, task_id)
    db.commit()
    return planning.lineup(db, access)


@router.put("/workspaces/{workspace_id}/lineup/order", response_model=List[s.TaskOut])
def order_lineup(workspace_id: uuid.UUID, data: p.LineupOrder, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    planning.reorder_lineup(db, access, data.task_ids)
    db.commit()
    return planning.lineup(db, access)


@router.get("/workspaces/{workspace_id}/home-layout", response_model=p.HomeLayout)
def home_layout(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return planning.home_layout(db, _access(db, user, workspace_id))


@router.put("/workspaces/{workspace_id}/home-layout", response_model=p.HomeLayout)
def save_home_layout(workspace_id: uuid.UUID, data: p.HomeLayout, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = planning.save_home_layout(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/my-work/done", response_model=List[s.TaskOut])
def done(workspace_id: uuid.UUID, days: int = Query(30, ge=1, le=90), user: User = Depends(current_user), db: Session = Depends(get_db)):
    return mywork.done_recently(db, _access(db, user, workspace_id), days)


@router.get("/workspaces/{workspace_id}/my-work/delegated", response_model=List[s.TaskOut])
def delegated(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return mywork.delegated(db, _access(db, user, workspace_id))


# --- Automations -------------------------------------------------------------------------------------------------


def _automation_routes(path: str, opener: Callable) -> None:
    @router.get(f"{path}/automations", response_model=List[p.AutomationOut])
    def rules(obj_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
        return automations.list_rules(db, opener(db, user.id, obj_id, PermissionLevel.view))

    @router.post(f"{path}/automations", response_model=p.AutomationOut, status_code=status.HTTP_201_CREATED)
    def add_rule(obj_id: uuid.UUID, data: p.AutomationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
        out = automations.add_rule(db, opener(db, user.id, obj_id, PermissionLevel.full), data)
        db.commit()
        return out


_automation_routes("/spaces/{obj_id}", open_space)
_automation_routes("/folders/{obj_id}", open_folder)
_automation_routes("/lists/{obj_id}", open_list)


@router.patch("/automations/{rule_id}", response_model=p.AutomationOut)
def update_rule(rule_id: uuid.UUID, data: p.AutomationUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = automations.update_rule(db, user.id, rule_id, data)
    db.commit()
    return out


@router.delete("/automations/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_rule(rule_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    automations.remove_rule(db, user.id, rule_id)
    db.commit()


# --- two-way calendar sync (Google, Outlook) -------------------------------------------------------


@router.get("/calendar-sync/providers", response_model=p.CalendarProviders)
def calendar_providers():
    from app.services.work import calendar_sync

    return calendar_sync.configured()


@router.get("/workspaces/{workspace_id}/calendar-connections", response_model=List[p.CalendarConnectionOut])
def calendar_connections(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.work import calendar_sync

    return [calendar_sync.connection_out(c) for c in calendar_sync.connections(db, Access.for_workspace(db, user.id, workspace_id))]


@router.post("/workspaces/{workspace_id}/calendar-connections/{provider}/start")
def start_calendar_connection(workspace_id: uuid.UUID, provider: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Where to send the browser to sign in to the calendar; it comes back to the callback below."""
    from app.services.work import calendar_sync

    return {"url": calendar_sync.authorize_url(Access.for_workspace(db, user.id, workspace_id), provider)}


@router.get("/calendar-oauth/{provider}/callback")
def calendar_oauth_callback(provider: str, code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None,
                            db: Session = Depends(get_db)):
    """The calendar sends the browser back here (no sign-in header: the signed `state` says who it is)."""
    from fastapi.responses import RedirectResponse
    from urllib.parse import quote

    from app.core.config import settings
    from app.services.work import calendar_sync
    from app.services.work.errors import WorkError

    back = f"{settings.APP_URL.rstrip('/')}/planner"
    if provider not in calendar_sync.PROVIDERS:
        return RedirectResponse(f"{back}?calendar_error={quote('Unknown calendar')}", status_code=302)
    if error or not code or not state:
        return RedirectResponse(f"{back}?calendar_error={quote(error or 'The calendar sign-in was cancelled')}", status_code=302)
    try:
        conn = calendar_sync.finish_connect(db, provider, code, state)
        calendar_sync.sync(db, conn)
        db.commit()
    except WorkError as e:
        db.rollback()
        return RedirectResponse(f"{back}?calendar_error={quote(e.message)}", status_code=302)
    return RedirectResponse(f"{back}?calendar=connected", status_code=302)


@router.patch("/calendar-connections/{connection_id}", response_model=p.CalendarConnectionOut)
def update_calendar_connection(connection_id: uuid.UUID, data: p.CalendarConnectionUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.work import calendar_sync

    conn = calendar_sync.update(db, user.id, connection_id, data)
    db.commit()
    return calendar_sync.connection_out(conn)


@router.post("/calendar-connections/{connection_id}/sync", response_model=p.SyncResult)
def sync_calendar_connection(connection_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.work import calendar_sync

    conn = calendar_sync.own(db, user.id, connection_id)
    stats = calendar_sync.sync(db, conn)
    db.commit()
    return p.SyncResult(**stats, connection=calendar_sync.connection_out(conn))


@router.delete("/calendar-connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_calendar_connection(connection_id: uuid.UUID, remove_events: bool = Query(True), user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.work import calendar_sync

    calendar_sync.disconnect(db, user.id, connection_id, remove_events)
    db.commit()
