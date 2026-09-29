"""People (profiles, adding, inviting) and the Teams Hub team overview."""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import Status, Task, TaskActivity, Team, User
from app.db.session import get_db
from app.schemas import collab as c
from app.schemas import work as s
from app.services.work import mywork, people, teams
from app.services.work.access import Access
from app.services.work.errors import NotFound

router = APIRouter()


class InviteNote(BaseModel):
    message: Optional[str] = Field(default=None, max_length=2000)


class InviteSent(BaseModel):
    emailed: bool
    email_problem: Optional[str] = None
    link: str


class FeedItem(c.ActivityOut):
    task: c.TaskRefOut


class TeamOverview(BaseModel):
    team: s.TeamOut
    tasks: List[s.TaskOut]
    feed: List[FeedItem]


@router.get("/workspaces/{workspace_id}/people", response_model=List[s.PersonOut])
def list_people(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return people.list_people(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/people", response_model=s.PersonAdded, status_code=status.HTTP_201_CREATED)
def add_person(workspace_id: uuid.UUID, data: s.PersonCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    _, added = people.add_person(db, access, data)
    db.flush()
    if data.start_joiner_checklist:
        from app.services.work import onboarding

        onboarding.run_joiner(db, access, added.id)
    emailed, problem = people.send_invite(db, access, added.id) if data.send_invite else (False, None)
    db.commit()
    return s.PersonAdded(person=people.get_person(db, access, added.id), emailed=emailed, email_problem=problem, link=people.invite_link())


@router.post("/workspaces/{workspace_id}/invites", response_model=s.InviteResult, status_code=status.HTTP_201_CREATED)
def invite_people(workspace_id: uuid.UUID, data: s.InviteIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = people.invite(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return result


@router.get("/workspaces/{workspace_id}/people/{user_id}", response_model=s.PersonOut)
def get_person(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return people.get_person(db, Access.for_workspace(db, user.id, workspace_id), user_id)


@router.patch("/workspaces/{workspace_id}/people/{user_id}", response_model=s.PersonOut)
def update_person(workspace_id: uuid.UUID, user_id: str, data: s.PersonUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    people.update_person(db, access, user_id, data)
    db.commit()
    return people.get_person(db, access, user_id)


@router.post("/workspaces/{workspace_id}/people/{user_id}/invite", response_model=InviteSent)
def resend_invite(workspace_id: uuid.UUID, user_id: str, data: InviteNote, user: User = Depends(current_user), db: Session = Depends(get_db)):
    emailed, problem = people.send_invite(db, Access.for_workspace(db, user.id, workspace_id), user_id, data.message)
    db.commit()
    return InviteSent(emailed=emailed, email_problem=problem, link=people.invite_link())


@router.get("/workspaces/{workspace_id}/people/{user_id}/tasks", response_model=List[s.TaskOut])
def person_tasks(
    workspace_id: uuid.UUID, user_id: str, include_closed: bool = Query(False),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    """Someone's assigned work, as far as the viewer can see it."""
    return mywork.tasks_assigned_to(db, Access.for_workspace(db, user.id, workspace_id), [user_id], include_closed)


@router.get("/teams/{team_id}/overview", response_model=TeamOverview)
def team_overview(team_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """ClickUp's team page: the team, its members' work and recent activity — what the viewer can see."""
    team = db.get(Team, team_id)
    if team is None:
        raise NotFound("Team not found")
    access = Access.for_workspace(db, user.id, team.workspace_id)
    member_list = teams.members_of(db, [team.id])[team.id]
    from app.services.work import team_tree

    out = teams.team_out(team, member_list, teams.leads_of(db, [team.id])[team.id], team_tree.people(db, [team.id]))
    tasks = mywork.tasks_assigned_to(db, access, out.all_member_ids, include_closed=True)  # sub-teams' work too
    by_id = {t.id: t for t in tasks}
    rows = list(db.scalars(
        select(TaskActivity).where(TaskActivity.task_id.in_(list(by_id))).order_by(TaskActivity.created_at.desc()).limit(60)
    )) if by_id else []
    actors = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id})))}
    feed = [
        FeedItem(
            id=r.id, kind=r.kind, data=r.data, created_at=r.created_at,
            user=s.UserOut.model_validate(actors[r.user_id]) if r.user_id in actors else None,
            task=c.TaskRefOut(id=by_id[r.task_id].id, name=by_id[r.task_id].name, list_id=by_id[r.task_id].list_id, status=by_id[r.task_id].status),
        )
        for r in rows
    ]
    return TeamOverview(team=out, tasks=tasks, feed=feed)
