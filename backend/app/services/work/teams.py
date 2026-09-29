"""Teams: named groups of workspace members that items can be shared with."""

import re
import uuid
from typing import Dict, List, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Team, TeamMember, User, WorkspaceMember
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace


def _require_manager(access: Access) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can manage Teams")


def team_or_404(db: Session, access: Access, team_id: uuid.UUID) -> Team:
    team = db.get(Team, team_id)
    if team is None or team.workspace_id != access.workspace_id:
        raise NotFound("Team not found")
    return team


def leads_of(db: Session, team_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, List[str]]:
    result: Dict[uuid.UUID, List[str]] = {tid: [] for tid in team_ids}
    if team_ids:
        for team_id, user_id in db.execute(
            select(TeamMember.team_id, TeamMember.user_id).where(
                TeamMember.team_id.in_(team_ids), TeamMember.is_lead.is_(True)
            )
        ):
            result[team_id].append(user_id)
    return result


def led_team_ids(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[uuid.UUID]:
    """The Teams in this workspace that the person leads."""
    return list(
        db.scalars(
            select(TeamMember.team_id)
            .join(Team, Team.id == TeamMember.team_id)
            .where(Team.workspace_id == workspace_id, TeamMember.user_id == user_id, TeamMember.is_lead.is_(True))
        )
    )


def people_led_by(db: Session, workspace_id: uuid.UUID, user_id: str) -> set:
    """Everyone in the Teams this person leads (including the lead)."""
    teams = led_team_ids(db, workspace_id, user_id)
    if not teams:
        return set()
    from app.services.work import team_tree

    return team_tree.people(db, teams)


def members_of(db: Session, team_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, List[User]]:
    result: Dict[uuid.UUID, List[User]] = {tid: [] for tid in team_ids}
    if not team_ids:
        return result
    rows = db.execute(
        select(TeamMember.team_id, User)
        .join(User, User.id == TeamMember.user_id)
        .where(TeamMember.team_id.in_(team_ids))
        .order_by(User.email)
    )
    for team_id, user in rows:
        result[team_id].append(user)
    return result


def team_out(team: Team, members: List[User], lead_ids: Sequence[str] = (), all_member_ids: Sequence[str] = ()) -> s.TeamOut:
    return s.TeamOut(
        parent_team_id=team.parent_team_id,
        all_member_ids=sorted(set(all_member_ids) | {u.id for u in members}),
        id=team.id,
        name=team.name,
        color=team.color,
        members=[s.UserOut.model_validate(u) for u in members],
        lead_ids=sorted(lead_ids),
        description=team.description,
        handle=team.handle,
        icon=team.icon,
        locations=[s.TeamLocation.model_validate(x) for x in (team.locations or [])],
    )


def list_teams(db: Session, access: Access) -> List[s.TeamOut]:
    teams = list(
        db.scalars(select(Team).where(Team.workspace_id == access.workspace_id).order_by(func.lower(Team.name)))
    )
    ids = [t.id for t in teams]
    members, leads = members_of(db, ids), leads_of(db, ids)
    children: Dict[uuid.UUID, List[uuid.UUID]] = {}
    for t in teams:
        if t.parent_team_id:
            children.setdefault(t.parent_team_id, []).append(t.id)

    def everyone(tid: uuid.UUID, guard: int = 0) -> set:
        out = {u.id for u in members.get(tid, [])}
        for c in children.get(tid, []) if guard < 10 else []:
            out |= everyone(c, guard + 1)
        return out

    return [team_out(t, members[t.id], leads[t.id], everyone(t.id)) for t in teams]


def _check_parent(db: Session, access: Access, team: Optional[Team], parent_id: Optional[uuid.UUID]) -> Optional[uuid.UUID]:
    """A parent must be another Team in this workspace, not one of this Team's own sub-teams, and not too deep."""
    from app.services.work import team_tree

    if parent_id is None:
        return None
    parent = team_or_404(db, access, parent_id)
    if team is not None and parent.id in team_tree.descendants(db, [team.id]):
        raise Invalid("A Team can't sit inside itself or one of its own sub-teams")
    own_height = team_tree.height(db, team.id) if team is not None else 1
    if team_tree.depth(db, parent.id) + own_height > team_tree.MAX_DEPTH:
        raise Invalid(f"Teams can be nested at most {team_tree.MAX_DEPTH} levels deep")
    return parent.id


def _check_unique_name(db: Session, access: Access, name: str, exclude: Optional[uuid.UUID] = None) -> None:
    query = select(Team.id).where(
        Team.workspace_id == access.workspace_id, func.lower(Team.name) == name.strip().lower()
    )
    if exclude is not None:
        query = query.where(Team.id != exclude)
    if db.scalar(query) is not None:
        raise Invalid(f"A Team called {name} already exists")


def _free_handle(db: Session, access: Access, wanted: str, exclude: Optional[uuid.UUID] = None) -> str:
    """A unique @handle for mentioning the team, from the one asked for or the name."""
    base = re.sub(r"[^a-z0-9_-]+", "-", wanted.lower()).strip("-") or "team"
    taken = {
        h for h in db.scalars(select(Team.handle).where(Team.workspace_id == access.workspace_id, Team.id != exclude))
        if h
    }
    handle, n = base[:60], 2
    while handle in taken:
        handle, n = f"{base[:57]}-{n}", n + 1
    return handle


def create_team(db: Session, access: Access, data: s.TeamCreate) -> Team:
    _require_manager(access)
    _check_unique_name(db, access, data.name)
    if data.handle and data.handle in {h for h in db.scalars(select(Team.handle).where(Team.workspace_id == access.workspace_id)) if h}:
        raise Invalid(f"The handle @{data.handle} is taken")
    team = Team(
        workspace_id=access.workspace_id, name=data.name, color=data.color, created_by=access.user_id,
        description=data.description, icon=data.icon, handle=data.handle or _free_handle(db, access, data.name), locations=[],
        parent_team_id=_check_parent(db, access, None, data.parent_team_id),
    )
    db.add(team)
    try:
        db.flush()
    except IntegrityError:  # a concurrent create won the race
        raise Invalid(f"A Team called {data.name} already exists")
    if data.member_ids or data.lead_ids:
        set_members(db, access, team, list(dict.fromkeys([*data.member_ids, *data.lead_ids])), data.lead_ids)
    from app.services.work import audit

    audit.record(db, access.workspace_id, access.user_id, "team.created", "team", team.id, team.name)
    return team


def update_team(db: Session, access: Access, team: Team, data: s.TeamUpdate) -> Team:
    fields = data.model_fields_set
    # Team leads may describe their team and point to where it works; the rest is for admins.
    is_lead = access.user_id in leads_of(db, [team.id])[team.id]
    if not (can_manage_workspace(access.role) or (is_lead and fields <= {"description", "icon", "color", "locations"})):
        raise Forbidden("Only owners and admins can change this Team")
    if "name" in fields:
        if data.name is None:
            raise Invalid("Name cannot be empty")
        _check_unique_name(db, access, data.name, exclude=team.id)
        team.name = data.name
    if "color" in fields:
        team.color = data.color
    if "description" in fields:
        team.description = data.description
    if "icon" in fields:
        team.icon = data.icon
    if "locations" in fields and data.locations is not None:
        team.locations = [{"kind": x.kind, "id": str(x.id)} for x in data.locations]
    if "parent_team_id" in fields:
        team.parent_team_id = _check_parent(db, access, team, data.parent_team_id)
    db.flush()
    return team


def delete_team(db: Session, access: Access, team: Team) -> None:
    _require_manager(access)
    from app.services.work import audit

    audit.record(db, access.workspace_id, access.user_id, "team.deleted", "team", team.id, team.name)
    db.delete(team)  # memberships and the Team's shares cascade
    db.flush()


def set_members(
    db: Session, access: Access, team: Team, user_ids: Sequence[str], lead_ids: Optional[Sequence[str]] = None
) -> None:
    """Replace a Team's membership (and, when given, its leads). Everyone must be in the workspace."""
    _require_manager(access)
    wanted = list(dict.fromkeys(user_ids))
    if lead_ids is not None and set(lead_ids) - set(wanted):
        raise Invalid("Team leads must also be members of the Team")
    if wanted:
        in_workspace = set(
            db.scalars(
                select(WorkspaceMember.user_id).where(
                    WorkspaceMember.workspace_id == access.workspace_id,
                    WorkspaceMember.user_id.in_(wanted),
                )
            )
        )
        missing = [uid for uid in wanted if uid not in in_workspace]
        if missing:
            raise Invalid(f"Team members must be workspace members: {', '.join(missing)}")
    current = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id == team.id)))
    for uid in current - set(wanted):
        db.delete(db.get(TeamMember, (team.id, uid)))
    for uid in set(wanted) - current:
        db.add(TeamMember(team_id=team.id, user_id=uid))
    db.flush()
    if lead_ids is not None:
        for membership in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)):
            membership.is_lead = membership.user_id in set(lead_ids)
        db.flush()


def remove_from_workspace_teams(db: Session, workspace_id: uuid.UUID, user_id: str) -> None:
    """Called when someone leaves a workspace: they leave its Teams too."""
    team_ids = select(Team.id).where(Team.workspace_id == workspace_id)
    for membership in db.scalars(
        select(TeamMember).where(TeamMember.user_id == user_id, TeamMember.team_id.in_(team_ids))
    ):
        db.delete(membership)
