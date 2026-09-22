"""Dashboards, cards, sharing and scheduled email reports."""

import uuid
from typing import List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.core.config import settings
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.schemas import dashboards as d
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.dashboards import reports, service
from app.services.work.dashboards.access import OpenedDashboard, open_dashboard
from app.services.work.dashboards.engine import Engine
from app.services.work.errors import Invalid

router = APIRouter()

Tz = Query("UTC", description="The viewer's IANA timezone, e.g. Asia/Kolkata. Decides what 'today' means.")


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise Invalid(f"Unknown timezone {name}")


def _open(db: Session, user: User, dashboard_id: uuid.UUID, minimum: PermissionLevel = PermissionLevel.view) -> OpenedDashboard:
    return open_dashboard(db, user.id, dashboard_id, minimum)


def _engine(db: Session, opened: OpenedDashboard, tz: str) -> Engine:
    return Engine(db, opened.access, _zone(tz), d.Filters.model_validate(opened.dashboard.filters or {}))


# --- dashboards ----------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/dashboards", response_model=List[d.DashboardSummary])
def list_dashboards(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.list_dashboards(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/dashboards", response_model=d.DashboardOut, status_code=status.HTTP_201_CREATED)
def create_dashboard(
    workspace_id: uuid.UUID, data: d.DashboardCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = service.create_dashboard(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return service.dashboard_out(db, opened)


@router.get("/dashboards/{dashboard_id}", response_model=d.DashboardOut)
def get_dashboard(dashboard_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.dashboard_out(db, _open(db, user, dashboard_id))


@router.patch("/dashboards/{dashboard_id}", response_model=d.DashboardOut)
def update_dashboard(
    dashboard_id: uuid.UUID, data: d.DashboardUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = _open(db, user, dashboard_id)
    service.update_dashboard(db, opened, data)
    db.commit()
    return service.dashboard_out(db, opened)


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dashboard(dashboard_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.delete_dashboard(db, _open(db, user, dashboard_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/dashboards/{dashboard_id}/duplicate", response_model=d.DashboardOut, status_code=status.HTTP_201_CREATED)
def duplicate_dashboard(
    dashboard_id: uuid.UUID, data: d.DashboardDuplicate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    copy = service.duplicate_dashboard(db, _open(db, user, dashboard_id), data)
    db.commit()
    return service.dashboard_out(db, copy)


@router.post("/dashboards/{dashboard_id}/repoint", response_model=d.DashboardOut)
def repoint(dashboard_id: uuid.UUID, data: d.Repoint, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = _open(db, user, dashboard_id)
    service.repoint(db, opened, data)
    db.commit()
    return service.dashboard_out(db, opened)


@router.put("/dashboards/{dashboard_id}/layout", response_model=d.DashboardOut)
def set_layout(dashboard_id: uuid.UUID, data: d.LayoutUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = _open(db, user, dashboard_id)
    service.set_layout(db, opened, data)
    db.commit()
    return service.dashboard_out(db, opened)


@router.get("/dashboards/{dashboard_id}/data", response_model=List[d.CardData])
def dashboard_data(dashboard_id: uuid.UUID, tz: str = Tz, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Every card's data, computed with the caller's own permissions."""
    opened = _open(db, user, dashboard_id)
    engine = _engine(db, opened, tz)
    return [engine.compute(card) for card in service.cards_of(db, dashboard_id)]


# --- cards ------------------------------------------------------------------------------


@router.post("/dashboards/{dashboard_id}/cards", response_model=d.CardOut, status_code=status.HTTP_201_CREATED)
def add_card(dashboard_id: uuid.UUID, data: d.CardCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card = service.add_card(db, _open(db, user, dashboard_id), data)
    db.commit()
    return service.card_out(card)


@router.patch("/dashboards/{dashboard_id}/cards/{card_id}", response_model=d.CardOut)
def update_card(
    dashboard_id: uuid.UUID, card_id: uuid.UUID, data: d.CardUpdate,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    card = service.update_card(db, _open(db, user, dashboard_id), card_id, data)
    db.commit()
    return service.card_out(card)


@router.delete("/dashboards/{dashboard_id}/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_card(dashboard_id: uuid.UUID, card_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.delete_card(db, _open(db, user, dashboard_id), card_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/dashboards/{dashboard_id}/cards/{card_id}/duplicate", response_model=d.CardOut, status_code=status.HTTP_201_CREATED)
def duplicate_card(dashboard_id: uuid.UUID, card_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card = service.duplicate_card(db, _open(db, user, dashboard_id), card_id)
    db.commit()
    return service.card_out(card)


@router.get("/dashboards/{dashboard_id}/cards/{card_id}/data", response_model=d.CardData)
def card_data(
    dashboard_id: uuid.UUID, card_id: uuid.UUID, tz: str = Tz,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    opened = _open(db, user, dashboard_id)
    return _engine(db, opened, tz).compute(service.get_card(db, opened, card_id))


@router.get("/dashboards/{dashboard_id}/cards/{card_id}/tasks", response_model=s.TaskPage)
def card_tasks(
    dashboard_id: uuid.UUID, card_id: uuid.UUID, tz: str = Tz,
    segment: Optional[str] = Query(None, description="A segment key from the card's data; omit for all"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    """Drill-down: the tasks behind a number, a slice or a bar."""
    opened = _open(db, user, dashboard_id)
    return _engine(db, opened, tz).drill(service.get_card(db, opened, card_id), segment)


# --- sharing ------------------------------------------------------------------------------


@router.get("/dashboards/{dashboard_id}/sharing", response_model=d.DashboardSharingOut)
def get_sharing(dashboard_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.sharing(db, _open(db, user, dashboard_id))


@router.post("/dashboards/{dashboard_id}/shares", response_model=s.ShareOut, status_code=status.HTTP_201_CREATED)
def add_share(
    dashboard_id: uuid.UUID, data: d.DashboardShareCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    share = service.grant(db, _open(db, user, dashboard_id), data)
    db.commit()
    return share


@router.delete("/dashboards/{dashboard_id}/shares/{share_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_share(dashboard_id: uuid.UUID, share_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.revoke(db, _open(db, user, dashboard_id), share_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- email reports ---------------------------------------------------------------------------


@router.get("/dashboards/{dashboard_id}/reports", response_model=d.ReportsOut)
def list_reports(dashboard_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = _open(db, user, dashboard_id)
    return d.ReportsOut(email_configured=bool(settings.SMTP_HOST), schedules=reports.list_schedules(db, opened))


@router.post("/dashboards/{dashboard_id}/reports", response_model=d.ScheduleOut, status_code=status.HTTP_201_CREATED)
def create_report(dashboard_id: uuid.UUID, data: d.ScheduleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    schedule = reports.create_schedule(db, _open(db, user, dashboard_id), data)
    db.commit()
    return reports.schedule_out(db, schedule)


@router.put("/reports/{schedule_id}", response_model=d.ScheduleOut)
def update_report(schedule_id: uuid.UUID, data: d.ScheduleIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    schedule = reports.update_schedule(db, user.id, schedule_id, data)
    db.commit()
    return reports.schedule_out(db, schedule)


@router.delete("/reports/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(schedule_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    reports.delete_schedule(db, user.id, schedule_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/reports/{schedule_id}/send", response_model=d.RunOut)
def send_report_now(schedule_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    run = reports.send_now(db, user.id, schedule_id)
    db.commit()
    return run


@router.get("/dashboards/{dashboard_id}/report-runs", response_model=List[d.RunOut])
def list_report_runs(dashboard_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return reports.list_runs(db, _open(db, user, dashboard_id))


@router.get("/report-runs/{run_id}", response_model=d.RunDetail)
def get_report_run(run_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return reports.get_run(db, user.id, run_id)


@router.get("/dashboards/{dashboard_id}/report-preview", response_model=d.PreviewOut)
def preview_report(dashboard_id: uuid.UUID, tz: str = Tz, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The email as it would look if you sent it now."""
    return d.PreviewOut(html=reports.render_report(db, _open(db, user, dashboard_id), _zone(tz)))


# --- Dashboard views and discussion cards --------------------------------------------------------


@router.get("/views/{view_id}/dashboard", response_model=Optional[d.DashboardOut])
def view_dashboard(view_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The customised Dashboard behind a Space/Folder/List Dashboard view, or null while it shows the standard one."""
    opened = service.dashboard_for_view(db, user.id, view_id)
    return service.dashboard_out(db, opened) if opened else None


@router.post("/views/{view_id}/dashboard", response_model=d.DashboardOut, status_code=status.HTTP_201_CREATED)
def customise_view_dashboard(view_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Turns a Dashboard view into a card Dashboard scoped to its location (editors only)."""
    opened = service.dashboard_for_view(db, user.id, view_id, create=True)
    db.commit()
    return service.dashboard_out(db, opened)


@router.get("/dashboards/{dashboard_id}/cards/{card_id}/messages", response_model=List[d.DiscussionMessage])
def discussion(dashboard_id: uuid.UUID, card_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return service.comments(db, open_dashboard(db, user.id, dashboard_id), card_id)


@router.post("/dashboards/{dashboard_id}/cards/{card_id}/messages", response_model=List[d.DiscussionMessage], status_code=status.HTTP_201_CREATED)
def post_message(dashboard_id: uuid.UUID, card_id: uuid.UUID, data: d.DiscussionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_dashboard(db, user.id, dashboard_id)
    service.add_comment(db, opened, card_id, data.body)
    db.commit()
    return service.comments(db, opened, card_id)


@router.delete("/dashboard-messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(message_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    service.delete_comment(db, user.id, message_id)
    db.commit()
