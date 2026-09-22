import uuid
from typing import List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import PermissionLevel, Team, User, WorkspaceRole
from app.db.session import get_db
from app.schemas import work as s
from app.services.work import accounts, hierarchy, mywork, teams
from app.services.work.access import Access, chain_for_space
from app.services.work.errors import NotFound

router = APIRouter()


@router.get("/workspaces", response_model=List[s.WorkspaceOut])
def list_workspaces(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [
        s.WorkspaceOut(id=ws.id, name=ws.name, role=role)
        for ws, role in accounts.list_workspaces(db, user.id)
    ]


@router.post("/workspaces", response_model=s.WorkspaceOut, status_code=status.HTTP_201_CREATED)
def create_workspace(
    data: s.WorkspaceCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    workspace = accounts.create_workspace(db, user, data.name)
    db.commit()
    return s.WorkspaceOut(id=workspace.id, name=workspace.name, role=WorkspaceRole.owner)


@router.get("/workspaces/{workspace_id}/hierarchy", response_model=s.HierarchyOut)
def get_hierarchy(
    workspace_id: uuid.UUID,
    include_archived: bool = Query(False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    return hierarchy.get_hierarchy(db, access, include_archived=include_archived)


@router.post(
    "/workspaces/{workspace_id}/spaces", response_model=s.SpaceOut, status_code=status.HTTP_201_CREATED
)
def create_space(
    workspace_id: uuid.UUID,
    data: s.SpaceCreate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    space = hierarchy.create_space(db, access, data)
    db.commit()
    level = access.level(chain_for_space(space))
    assert level is not None  # the creator always has full access
    return hierarchy.space_out(space, level)


@router.get("/me", response_model=s.UserOut)
def me(user: User = Depends(current_user)):
    """Who the caller is here. Their id can differ from their sign-in id if an admin added them first."""
    return s.UserOut.model_validate(user)


# --- members -----------------------------------------------------------------


def _member_out(member, member_user) -> s.MemberOut:
    return s.MemberOut(
        user=s.UserOut.model_validate(member_user), role=member.role, joined_at=member.joined_at
    )


@router.get("/workspaces/{workspace_id}/members", response_model=List[s.MemberOut])
def list_members(
    workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    access = Access.for_workspace(db, user.id, workspace_id)
    return [_member_out(m, u) for m, u in accounts.list_members(db, access)]


@router.post(
    "/workspaces/{workspace_id}/members", response_model=s.MemberOut, status_code=status.HTTP_201_CREATED
)
def add_member(
    workspace_id: uuid.UUID,
    data: s.MemberAdd,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    member, member_user = accounts.add_member(db, access, data.email, data.role)
    db.commit()
    return _member_out(member, member_user)


@router.patch("/workspaces/{workspace_id}/members/{user_id}", response_model=s.MemberOut)
def update_member(
    workspace_id: uuid.UUID,
    user_id: str,
    data: s.MemberUpdate,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    member = accounts.update_member_role(db, access, user_id, data.role)
    db.commit()
    member_user = db.get(User, user_id)
    return _member_out(member, member_user)


@router.delete("/workspaces/{workspace_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_member(
    workspace_id: uuid.UUID,
    user_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    accounts.remove_member(db, access, user_id)
    db.commit()


# --- teams -------------------------------------------------------------------


def _open_team(db: Session, user_id: str, team_id: uuid.UUID):
    team = db.get(Team, team_id)
    if team is None:
        raise NotFound("Team not found")
    access = Access.for_workspace(db, user_id, team.workspace_id)
    return team, access


def _team_out(db: Session, team: Team) -> s.TeamOut:
    return teams.team_out(team, teams.members_of(db, [team.id])[team.id], teams.leads_of(db, [team.id])[team.id])


@router.get("/workspaces/{workspace_id}/teams", response_model=List[s.TeamOut])
def list_teams(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return teams.list_teams(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/teams", response_model=s.TeamOut, status_code=status.HTTP_201_CREATED)
def create_team(
    workspace_id: uuid.UUID, data: s.TeamCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    team = teams.create_team(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return _team_out(db, team)


@router.patch("/teams/{team_id}", response_model=s.TeamOut)
def update_team(
    team_id: uuid.UUID, data: s.TeamUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    team, access = _open_team(db, user.id, team_id)
    teams.update_team(db, access, team, data)
    db.commit()
    return _team_out(db, team)


@router.put("/teams/{team_id}/members", response_model=s.TeamOut)
def set_team_members(
    team_id: uuid.UUID, data: s.TeamMembersSet, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    team, access = _open_team(db, user.id, team_id)
    teams.set_members(db, access, team, data.user_ids, data.lead_ids)
    db.commit()
    return _team_out(db, team)


@router.delete("/teams/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(team_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    team, access = _open_team(db, user.id, team_id)
    teams.delete_team(db, access, team)
    db.commit()


# --- Home: My Tasks and the Personal List -----------------------------------


@router.get("/workspaces/{workspace_id}/my-tasks", response_model=s.TaskPage)
def my_tasks(
    workspace_id: uuid.UUID,
    include_closed: bool = Query(False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = Access.for_workspace(db, user.id, workspace_id)
    found = mywork.my_tasks(db, access, include_closed=include_closed)
    return s.TaskPage(tasks=found, total=len(found), limit=len(found), offset=0)


@router.post("/workspaces/{workspace_id}/personal-list", response_model=s.ListOut)
def open_personal_list(
    workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    """The caller's Personal List, created the first time they open it."""
    access = Access.for_workspace(db, user.id, workspace_id)
    lst = mywork.personal_list(db, access, create=True)
    db.commit()
    assert lst is not None
    return hierarchy.list_out(lst, PermissionLevel.full)
