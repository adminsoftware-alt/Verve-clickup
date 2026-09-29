"""Dashboards: create, list, change, duplicate, share; and their cards."""

import uuid
from typing import Dict, List, Optional

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Dashboard,
    DashboardCard,
    DashboardComment,
    DashboardShare,
    PermissionLevel,
    Team,
    User,
    WorkspaceMember,
    WorkspaceRole,
)
from app.schemas import dashboards as d
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.dashboards.access import (
    OpenedDashboard,
    Standing,
    at_least,
    resolve,
    shares_by_dashboard,
)
from app.services.work.dashboards import standard
from app.services.work.dashboards.templates import template_cards
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.teams import team_or_404

DEFAULT_TITLES = {
    "calculation": "Calculation",
    "pie": "Pie chart",
    "bar": "Bar chart",
    "task_list": "Task list",
    "time_report": "Time reporting",
    "timesheet": "Timesheet",
    "portfolio": "Portfolio",
    "line": "Line chart",
    "discussion": "Discussion",
    "embed": "Embed",
    "behind": "Who's behind",
    "completed": "Completed tasks",
    "notes": "Notes",
    "worked_on": "Worked on",
    "battery": "Battery",
    "goal": "Goals",
    "sprint": "Sprint",
}


def _require(opened: OpenedDashboard, minimum: PermissionLevel, action: str) -> None:
    if not at_least(opened.level, minimum):
        raise Forbidden(f"You need {minimum.value} access to {action}")


# --- reading -------------------------------------------------------------------


def _users(db: Session, ids) -> Dict[str, User]:
    ids = {i for i in ids if i}
    return {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def _teams(db: Session, ids) -> Dict[uuid.UUID, Team]:
    ids = {i for i in ids if i}
    return {t.id: t for t in db.scalars(select(Team).where(Team.id.in_(ids)))} if ids else {}


def _summary_fields(dash: Dashboard, level: PermissionLevel, relation: str, shares, users, teams, card_count: int) -> dict:
    owner = users.get(dash.owner_id) if dash.owner_id else None
    team = teams.get(dash.team_id) if dash.team_id else None
    return dict(
        id=dash.id,
        name=dash.name,
        standard=dash.standard,
        owner=s.UserOut.model_validate(owner) if owner else None,
        team=s.TeamRef(id=team.id, name=team.name, color=team.color) if team else None,
        your_level=level.value,
        relation=relation,
        is_shared=bool(shares),
        card_count=card_count,
        created_at=dash.created_at,
        updated_at=dash.updated_at,
    )


def list_dashboards(db: Session, access: Access) -> List[d.DashboardSummary]:
    standing = Standing.load(db, access)
    standard.ensure(db, access, standing)  # "My work", the Teams they lead, and (for admins) "Company"
    # Dashboards behind a location's Dashboard view live with that location, not in the hub.
    dashboards = list(db.scalars(select(Dashboard).where(Dashboard.workspace_id == access.workspace_id, Dashboard.view_id.is_(None))))
    shares = shares_by_dashboard(db, [x.id for x in dashboards])
    counts = dict(
        db.execute(
            select(DashboardCard.dashboard_id, func.count())
            .where(DashboardCard.dashboard_id.in_([x.id for x in dashboards]))
            .group_by(DashboardCard.dashboard_id)
        ).all()
    ) if dashboards else {}
    users = _users(db, [x.owner_id for x in dashboards])
    teams = _teams(db, [x.team_id for x in dashboards])
    # The ones made for them come first: their own work, then their Teams, then the company.
    rank = {"my_work": 0, "team": 1, "company": 2}
    out = []
    for dash in dashboards:
        level, relation = resolve(standing, dash, shares[dash.id])
        if level is None:
            continue
        summary = d.DashboardSummary(**_summary_fields(dash, level, relation, shares[dash.id], users, teams, counts.get(dash.id, 0)))
        theirs = 0 if dash.owner_id == access.user_id else 1
        out.append(((rank.get(dash.standard or "", 3), theirs, -dash.updated_at.timestamp()), summary))
    return [summary for _, summary in sorted(out, key=lambda pair: pair[0])]


def home_dashboard(db: Session, access: Access) -> OpenedDashboard:
    """The caller's own "My work" Dashboard: what the app opens on. Made now if they haven't got one."""
    standing = Standing.load(db, access)
    if standing.is_guest:
        raise Forbidden("Guests don't have a Dashboard of their own")
    standard.ensure(db, access, standing)
    dash = db.scalars(
        select(Dashboard).where(
            Dashboard.workspace_id == access.workspace_id,
            Dashboard.standard == standard.MY_WORK,
            Dashboard.owner_id == access.user_id,
        )
    ).first()
    if dash is None:
        raise NotFound("Dashboard not found")
    return OpenedDashboard(dash, standing, PermissionLevel.full, "mine")


def cards_of(db: Session, dashboard_id: uuid.UUID) -> List[DashboardCard]:
    return list(
        db.scalars(select(DashboardCard).where(DashboardCard.dashboard_id == dashboard_id).order_by(DashboardCard.position))
    )


def card_out(card: DashboardCard) -> d.CardOut:
    return d.CardOut(
        id=card.id, type=card.type, title=card.title, config=d.CardConfig.model_validate(card.config),
        position=card.position, width=card.width, height=card.height,
    )


def dashboard_out(db: Session, opened: OpenedDashboard) -> d.DashboardOut:
    dash = opened.dashboard
    cards = cards_of(db, dash.id)
    shares = shares_by_dashboard(db, [dash.id])[dash.id]
    fields = _summary_fields(
        dash, opened.level, opened.relation, shares, _users(db, [dash.owner_id]), _teams(db, [dash.team_id]), len(cards)
    )
    return d.DashboardOut(
        **fields,
        filters=d.Filters.model_validate(dash.filters or {}),
        auto_refresh=dash.auto_refresh,
        cards=[card_out(c) for c in cards],
    )


# --- dashboards ------------------------------------------------------------------


def _check_team(db: Session, standing: Standing, team_id: Optional[uuid.UUID]) -> None:
    if team_id is not None:
        team_or_404(db, standing.access, team_id)
    if not standing.can_create_for(team_id):
        if standing.is_guest:
            raise Forbidden("Guests cannot create Dashboards")
        raise Forbidden("Only the Team's leads and admins can create Team dashboards")


def _add_card(db: Session, dash: Dashboard, card_type: str, title: str, config: dict, width: int, height: int, position: int) -> DashboardCard:
    try:
        parsed = d.CardConfig.model_validate(config)
        d.check_card(card_type, parsed)
    except (ValidationError, ValueError) as exc:
        raise Invalid(str(exc))
    card = DashboardCard(
        dashboard_id=dash.id, type=card_type, title=title, config=parsed.model_dump(mode="json"),
        width=width, height=height, position=position,
    )
    db.add(card)
    return card


def create_dashboard(db: Session, access: Access, data: d.DashboardCreate) -> OpenedDashboard:
    standing = Standing.load(db, access)
    _check_team(db, standing, data.team_id)
    dash = Dashboard(
        workspace_id=access.workspace_id,
        name=data.name,
        owner_id=access.user_id,
        team_id=data.team_id,
        # A Team dashboard shows the Team's work: its people, as one view.
        filters={"assignees": [f"team:{data.team_id}"]} if data.team_id else {},
    )
    db.add(dash)
    db.flush()
    sources = [src.model_dump(mode="json") for src in data.sources]
    for i, (card_type, title, config, width, height) in enumerate(template_cards(data.template, sources)):
        _add_card(db, dash, card_type, title, config, width, height, i)
    db.flush()
    return OpenedDashboard(dash, standing, PermissionLevel.full, "team" if dash.team_id else "mine")


def update_dashboard(db: Session, opened: OpenedDashboard, data: d.DashboardUpdate) -> None:
    _require(opened, PermissionLevel.edit, "change this Dashboard")
    dash = opened.dashboard
    fields = data.model_fields_set
    if "name" in fields:
        if data.name is None:
            raise Invalid("Name cannot be empty")
        dash.name = data.name
    if "filters" in fields:
        dash.filters = (data.filters or d.Filters()).model_dump(mode="json", exclude_none=True)
    if "auto_refresh" in fields and data.auto_refresh is not None:
        dash.auto_refresh = data.auto_refresh
    db.flush()


def delete_dashboard(db: Session, opened: OpenedDashboard) -> None:
    _require(opened, PermissionLevel.full, "delete this Dashboard")
    db.delete(opened.dashboard)
    db.flush()


def duplicate_dashboard(db: Session, opened: OpenedDashboard, data: d.DashboardDuplicate) -> OpenedDashboard:
    """A copy you own. Cards and filters are copied; shares and email schedules are not."""
    _check_team(db, opened.standing, data.team_id)
    source = opened.dashboard
    copy = Dashboard(
        workspace_id=source.workspace_id,
        name=data.name or f"{source.name} (copy)",
        owner_id=opened.access.user_id,
        team_id=data.team_id,
        filters=dict(source.filters or {}),
        auto_refresh=source.auto_refresh,
    )
    if data.team_id and data.team_id != source.team_id:
        copy.filters = {**copy.filters, "assignees": [f"team:{data.team_id}"]}
    db.add(copy)
    db.flush()
    for card in cards_of(db, source.id):
        _add_card(db, copy, card.type, card.title, dict(card.config), card.width, card.height, card.position)
    db.flush()
    return OpenedDashboard(copy, opened.standing, PermissionLevel.full, "team" if copy.team_id else "mine")


def repoint(db: Session, opened: OpenedDashboard, data: d.Repoint) -> None:
    """Point every card at the given locations."""
    _require(opened, PermissionLevel.edit, "change this Dashboard")
    sources = [src.model_dump(mode="json") for src in data.sources]
    for card in cards_of(db, opened.dashboard.id):
        if card.type != "notes":
            card.config = {**card.config, "sources": sources}
    db.flush()


# --- cards -------------------------------------------------------------------------


def _card(db: Session, opened: OpenedDashboard, card_id: uuid.UUID) -> DashboardCard:
    card = db.get(DashboardCard, card_id)
    if card is None or card.dashboard_id != opened.dashboard.id:
        raise NotFound("Card not found")
    return card


def get_card(db: Session, opened: OpenedDashboard, card_id: uuid.UUID) -> DashboardCard:
    return _card(db, opened, card_id)


def add_card(db: Session, opened: OpenedDashboard, data: d.CardCreate) -> DashboardCard:
    _require(opened, PermissionLevel.edit, "add cards")
    if len(cards_of(db, opened.dashboard.id)) >= 100:
        raise Invalid("A Dashboard can hold at most 100 cards")
    position = (db.scalar(select(func.max(DashboardCard.position)).where(DashboardCard.dashboard_id == opened.dashboard.id)) or 0) + 1
    card = _add_card(
        db, opened.dashboard, data.type, data.title or DEFAULT_TITLES[data.type],
        data.config.model_dump(mode="json"), data.width, data.height, position,
    )
    db.flush()
    return card


def update_card(db: Session, opened: OpenedDashboard, card_id: uuid.UUID, data: d.CardUpdate) -> DashboardCard:
    _require(opened, PermissionLevel.edit, "change cards")
    card = _card(db, opened, card_id)
    fields = data.model_fields_set
    if "title" in fields and data.title:
        card.title = data.title
    if "config" in fields and data.config is not None:
        try:
            d.check_card(card.type, data.config)
        except ValueError as exc:
            raise Invalid(str(exc))
        card.config = data.config.model_dump(mode="json")
    if "width" in fields and data.width is not None:
        card.width = data.width
    if "height" in fields and data.height is not None:
        card.height = data.height
    db.flush()
    return card


def duplicate_card(db: Session, opened: OpenedDashboard, card_id: uuid.UUID) -> DashboardCard:
    card = _card(db, opened, card_id)
    return add_card(db, opened, d.CardCreate(
        type=card.type, title=f"{card.title} (copy)"[:100], config=d.CardConfig.model_validate(card.config),
        width=card.width, height=card.height,
    ))


def delete_card(db: Session, opened: OpenedDashboard, card_id: uuid.UUID) -> None:
    _require(opened, PermissionLevel.edit, "remove cards")
    db.delete(_card(db, opened, card_id))
    db.flush()


def set_layout(db: Session, opened: OpenedDashboard, data: d.LayoutUpdate) -> None:
    _require(opened, PermissionLevel.edit, "arrange cards")
    cards = {c.id: c for c in cards_of(db, opened.dashboard.id)}
    given = [c.id for c in data.cards]
    if set(given) != set(cards) or len(given) != len(cards):
        raise Invalid("The layout must list every card on the Dashboard exactly once")
    for position, item in enumerate(data.cards):
        card = cards[item.id]
        card.position, card.width, card.height = position, item.width, item.height
    db.flush()


# --- sharing -------------------------------------------------------------------------


def _share_out(share: DashboardShare, user: Optional[User], team: Optional[Team]) -> s.ShareOut:
    return s.ShareOut(
        id=share.id,
        user=s.UserOut.model_validate(user) if user else None,
        team=s.TeamRef(id=team.id, name=team.name, color=team.color) if team else None,
        level=share.level,
        granted_by=share.granted_by,
        created_at=share.created_at,
    )


def sharing(db: Session, opened: OpenedDashboard) -> d.DashboardSharingOut:
    shares = shares_by_dashboard(db, [opened.dashboard.id])[opened.dashboard.id]
    users = _users(db, [x.user_id for x in shares])
    teams = _teams(db, [x.team_id for x in shares])
    out = [_share_out(x, users.get(x.user_id), teams.get(x.team_id)) for x in shares]
    out.sort(key=lambda o: (o.team is None, (o.team.name if o.team else o.user.email if o.user else "").lower()))
    return d.DashboardSharingOut(your_level=opened.level.value, shares=out)


def grant(db: Session, opened: OpenedDashboard, data: d.DashboardShareCreate) -> s.ShareOut:
    _require(opened, PermissionLevel.edit, "share this Dashboard")
    level = PermissionLevel(data.level)
    if not at_least(opened.level, level):
        raise Forbidden("You can only grant access up to your own level")
    access = opened.access
    user: Optional[User] = None
    team: Optional[Team] = None
    if data.user_id is not None:
        member = db.get(WorkspaceMember, (access.workspace_id, data.user_id))
        if member is None:
            raise NotFound("That person is not a member of this workspace")
        if member.role == WorkspaceRole.guest and level != PermissionLevel.view:
            raise Invalid("Guests can only be given view access")
        user = db.get(User, data.user_id)
        existing = db.scalars(select(DashboardShare).where(
            DashboardShare.dashboard_id == opened.dashboard.id, DashboardShare.user_id == data.user_id)).first()
        values = {"user_id": data.user_id}
    else:
        assert data.team_id is not None
        team = team_or_404(db, access, data.team_id)
        existing = db.scalars(select(DashboardShare).where(
            DashboardShare.dashboard_id == opened.dashboard.id, DashboardShare.team_id == team.id)).first()
        values = {"team_id": team.id}
    if existing is None:
        existing = DashboardShare(dashboard_id=opened.dashboard.id, level=level, granted_by=access.user_id, **values)
        db.add(existing)
    else:
        existing.level, existing.granted_by = level, access.user_id
    db.flush()
    return _share_out(existing, user, team)


def revoke(db: Session, opened: OpenedDashboard, share_id: uuid.UUID) -> None:
    _require(opened, PermissionLevel.edit, "change sharing")
    share = db.get(DashboardShare, share_id)
    if share is None or share.dashboard_id != opened.dashboard.id:
        raise NotFound("Share not found")
    if not at_least(opened.level, share.level):
        raise Forbidden("You cannot remove access higher than your own")
    db.delete(share)
    db.flush()


def dashboard_for_view(db: Session, user_id: str, view_id: uuid.UUID, create: bool = False) -> Optional[OpenedDashboard]:
    """The Dashboard behind a Dashboard view; `create` makes it (for editors) when the view is first customised."""
    from app.services.work.views import open_view

    opened_view = open_view(db, user_id, view_id, PermissionLevel.view)
    view = opened_view.obj
    if view.type.value != "dashboard":
        raise Invalid("That isn't a Dashboard view")
    dash = db.scalars(select(Dashboard).where(Dashboard.view_id == view.id)).first()
    if dash is None:
        if not create:
            return None
        if not opened_view.level.at_least(PermissionLevel.edit):
            raise NotFound("This view has no custom Dashboard yet")
        kind, loc_id = ("space", view.space_id) if view.space_id else ("folder", view.folder_id) if view.folder_id else ("list", view.list_id)
        dash = Dashboard(workspace_id=opened_view.access.workspace_id, name=view.name, owner_id=user_id, filters={}, view_id=view.id)
        db.add(dash)
        db.flush()
        sources = [{"kind": kind, "id": str(loc_id)}]
        for i, (card_type, title, config, width, height) in enumerate(template_cards("simple", sources)):
            _add_card(db, dash, card_type, title, config, width, height, i)
        db.flush()
    from app.services.work.dashboards.access import open_dashboard

    return open_dashboard(db, user_id, dash.id)


def comments(db: Session, opened: OpenedDashboard, card_id: uuid.UUID) -> List[d.DiscussionMessage]:
    card = _card(db, opened, card_id)
    rows = list(db.scalars(select(DashboardComment).where(DashboardComment.card_id == card.id).order_by(DashboardComment.created_at)))
    users = _users(db, [r.user_id for r in rows])
    return [
        d.DiscussionMessage(id=r.id, body=r.body, created_at=r.created_at, user=s.UserOut.model_validate(users[r.user_id]) if r.user_id in users else None)
        for r in rows
    ]


def add_comment(db: Session, opened: OpenedDashboard, card_id: uuid.UUID, body: str) -> None:
    """Anyone who can open the Dashboard can take part in its discussion."""
    card = _card(db, opened, card_id)
    if card.type != "discussion":
        raise Invalid("Only discussion cards take messages")
    db.add(DashboardComment(card_id=card.id, user_id=opened.standing.access.user_id, body=body))
    db.flush()


def delete_comment(db: Session, user_id: str, comment_id: uuid.UUID) -> None:
    from app.services.work.dashboards.access import at_least, open_dashboard

    row = db.get(DashboardComment, comment_id)
    if row is None:
        raise NotFound("Message not found")
    card = db.get(DashboardCard, row.card_id)
    opened = open_dashboard(db, user_id, card.dashboard_id)
    if row.user_id != user_id and not at_least(opened.level, PermissionLevel.full):
        raise Forbidden("Only its author or the Dashboard's owner can delete a message")
    db.delete(row)
    db.flush()
