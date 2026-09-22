"""Who can open a Dashboard, and at what level.

Verve's rules, on top of ClickUp's sharing model:

  * You always have full access to Dashboards you created.
  * A Team's leads have full access to that Team's dashboards.
  * Explicit shares, to you or to a Team you are in, give their level.
  * Team leads can view the personal Dashboards of the people in the Teams they lead.
  * Owners and admins can view every Dashboard in the workspace.
  * Anyone else, other members included, cannot see it.

Guests are capped at view. The highest applicable level wins.
Card *data* is a separate question: it always follows the viewer's own access to
tasks (see engine.py).
"""

import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Dashboard,
    DashboardShare,
    PermissionLevel,
    Team,
    TeamMember,
    WorkspaceRole,
)
from app.services.work.access import Access
from app.services.work.errors import Forbidden, NotFound
from app.services.work.permissions import can_manage_workspace

_RANK = {PermissionLevel.view: 1, PermissionLevel.edit: 2, PermissionLevel.full: 3}


@dataclass
class Standing:
    """What the caller brings to any Dashboard in the workspace, loaded once."""

    access: Access
    my_teams: Set[uuid.UUID] = field(default_factory=set)
    led_teams: Set[uuid.UUID] = field(default_factory=set)
    led_people: Set[str] = field(default_factory=set)

    @classmethod
    def load(cls, db: Session, access: Access) -> "Standing":
        standing = cls(access)
        rows = db.execute(
            select(TeamMember.team_id, TeamMember.is_lead)
            .join(Team, Team.id == TeamMember.team_id)
            .where(Team.workspace_id == access.workspace_id, TeamMember.user_id == access.user_id)
        )
        for team_id, is_lead in rows:
            standing.my_teams.add(team_id)
            if is_lead:
                standing.led_teams.add(team_id)
        if standing.led_teams:
            standing.led_people = set(
                db.scalars(select(TeamMember.user_id).where(TeamMember.team_id.in_(standing.led_teams)))
            )
        return standing

    @property
    def is_admin(self) -> bool:
        return can_manage_workspace(self.access.role)

    @property
    def is_guest(self) -> bool:
        return self.access.role == WorkspaceRole.guest

    def can_create_for(self, team_id: Optional[uuid.UUID]) -> bool:
        if self.is_guest:
            return False
        return team_id is None or self.is_admin or team_id in self.led_teams


def _best(levels: List[PermissionLevel]) -> Optional[PermissionLevel]:
    return max(levels, key=lambda lvl: _RANK[lvl]) if levels else None


def resolve(
    standing: Standing, dash: Dashboard, shares: List[DashboardShare]
) -> Tuple[Optional[PermissionLevel], Optional[str]]:
    """The caller's level on a Dashboard, and how they reach it (for the Hub's pages)."""
    me = standing.access.user_id
    found: List[Tuple[PermissionLevel, str]] = []
    if dash.owner_id == me:
        found.append((PermissionLevel.full, "team" if dash.team_id else "mine"))
    if dash.team_id is not None and dash.team_id in standing.led_teams:
        found.append((PermissionLevel.full, "team"))
    for share in shares:
        if share.user_id == me or (share.team_id is not None and share.team_id in standing.my_teams):
            found.append((share.level, "shared"))
    if dash.team_id is None and dash.owner_id in standing.led_people and dash.owner_id != me:
        found.append((PermissionLevel.view, "my_team"))
    if standing.is_admin:
        found.append((PermissionLevel.view, "everyone"))
    if not found:
        return None, None
    level = _best([lvl for lvl, _ in found])
    assert level is not None
    if standing.is_guest:
        level = PermissionLevel.view
    # The most personal route names the relation: mine/team, then shared, my_team, everyone.
    order = ["mine", "team", "shared", "my_team", "everyone"]
    relation = min((rel for _, rel in found), key=order.index)
    return level, relation


def shares_by_dashboard(db: Session, dashboard_ids: List[uuid.UUID]) -> Dict[uuid.UUID, List[DashboardShare]]:
    result: Dict[uuid.UUID, List[DashboardShare]] = {d: [] for d in dashboard_ids}
    if dashboard_ids:
        for share in db.scalars(select(DashboardShare).where(DashboardShare.dashboard_id.in_(dashboard_ids))):
            result[share.dashboard_id].append(share)
    return result


@dataclass
class OpenedDashboard:
    dashboard: Dashboard
    standing: Standing
    level: PermissionLevel
    relation: str

    @property
    def access(self) -> Access:
        return self.standing.access


def open_dashboard(
    db: Session, user_id: str, dashboard_id: uuid.UUID, minimum: PermissionLevel = PermissionLevel.view
) -> OpenedDashboard:
    dash = db.get(Dashboard, dashboard_id)
    if dash is None:
        raise NotFound("Dashboard not found")
    access = Access.for_workspace(db, user_id, dash.workspace_id)
    standing = Standing.load(db, access)
    if dash.view_id is not None:
        # A Dashboard view's Dashboard follows its Space/Folder/List: see it there, edit it there.
        from app.services.work.views import open_view

        level = open_view(db, user_id, dash.view_id, PermissionLevel.view).level
        if standing.is_guest:
            level = PermissionLevel.view
        if _RANK[level] < _RANK[minimum]:
            raise Forbidden(f"You need {minimum.value} access to this Dashboard")
        return OpenedDashboard(dash, standing, level, "location")
    level, relation = resolve(standing, dash, shares_by_dashboard(db, [dash.id])[dash.id])
    if level is None:
        raise NotFound("Dashboard not found")
    if _RANK[level] < _RANK[minimum]:
        raise Forbidden(f"You need {minimum.value} access to this Dashboard")
    assert relation is not None
    return OpenedDashboard(dash, standing, level, relation)


def at_least(level: PermissionLevel, minimum: PermissionLevel) -> bool:
    return _RANK[level] >= _RANK[minimum]
