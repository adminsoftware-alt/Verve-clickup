"""Goals and Team goals: targets, check-ins and progress."""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import goals as g
from app.services.work import goals
from app.services.work.access import Access

router = APIRouter()


@router.get("/workspaces/{workspace_id}/goals", response_model=List[g.GoalOut])
def list_goals(workspace_id: uuid.UUID, team_id: Optional[uuid.UUID] = Query(None), include_archived: bool = Query(False),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    return [goals.goal_out(db, access, x) for x in goals.list_goals(db, access, team_id, include_archived)]


@router.post("/workspaces/{workspace_id}/goals", response_model=g.GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(workspace_id: uuid.UUID, data: g.GoalIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    goal = goals.create(db, access, data)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.get("/goals/{goal_id}", response_model=g.GoalOut)
def get_goal(goal_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.open_goal(db, user.id, goal_id)
    return goals.goal_out(db, access, goal)


@router.patch("/goals/{goal_id}", response_model=g.GoalOut)
def update_goal(goal_id: uuid.UUID, data: g.GoalUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.update(db, user.id, goal_id, data)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goals.delete(db, user.id, goal_id)
    db.commit()


@router.post("/goals/{goal_id}/targets", response_model=g.GoalOut, status_code=status.HTTP_201_CREATED)
def add_target(goal_id: uuid.UUID, data: g.TargetIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.add_target(db, user.id, goal_id, data)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.patch("/goal-targets/{target_id}", response_model=g.GoalOut)
def update_target(target_id: uuid.UUID, data: g.TargetUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.update_target(db, user.id, target_id, data)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.delete("/goal-targets/{target_id}", response_model=g.GoalOut)
def delete_target(target_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.delete_target(db, user.id, target_id)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.post("/goal-targets/{target_id}/check-ins", response_model=g.GoalOut, status_code=status.HTTP_201_CREATED)
def check_in(target_id: uuid.UUID, data: g.CheckInIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal, access = goals.check_in(db, user.id, target_id, data)
    db.commit()
    return goals.goal_out(db, access, goal)


@router.get("/goal-targets/{target_id}/check-ins", response_model=List[g.CheckInOut])
def check_ins(target_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return goals.check_ins(db, user.id, target_id)
