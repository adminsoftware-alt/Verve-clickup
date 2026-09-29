"""Signing in as someone else while testing locally.

Only alive when DEV_LOGIN is on in the environment. It lists the people in the workspace so a
tester can pick one -- a manager, an admin, an ordinary member -- and the API then accepts
"Bearer dev:<their id>" for them (see app/api/deps.py). Nothing here writes anything, and with
DEV_LOGIN off every route below answers 404, as if it did not exist.
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Team, TeamMember, User, Workspace, WorkspaceMember
from app.db.session import get_db

router = APIRouter()


class DevPerson(BaseModel):
    id: str
    name: Optional[str]
    email: str
    role: str
    designation: Optional[str]
    leads: List[str]
    workspace: str


def _off() -> None:
    if not settings.DEV_LOGIN:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")


@router.get("/dev/people", response_model=List[DevPerson])
def people_to_sign_in_as(db: Session = Depends(get_db)):
    """Everyone in the workspace, so a tester can pick a role to be."""
    _off()
    workspace = db.scalars(select(Workspace).order_by(Workspace.created_at)).first()
    if workspace is None:
        return []
    leads: dict[str, List[str]] = {}
    for team, member in db.execute(
        select(Team, TeamMember).join(TeamMember, TeamMember.team_id == Team.id)
        .where(Team.workspace_id == workspace.id, TeamMember.is_lead.is_(True))
    ):
        leads.setdefault(member.user_id, []).append(team.name)
    rows = db.execute(
        select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.deactivated_at.is_(None))
        .order_by(User.display_name, User.email)
    )
    return [
        DevPerson(
            id=user.id, name=user.display_name, email=user.email, role=member.role.value,
            designation=getattr(member, "designation", None), leads=sorted(leads.get(user.id, [])),
            workspace=workspace.name,
        )
        for member, user in rows
    ]
