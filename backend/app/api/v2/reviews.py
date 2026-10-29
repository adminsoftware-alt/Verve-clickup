"""Monthly reviews: mark your own done, and see who has finished (Managers for their people, admins for all)."""

import uuid
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.services.work import reviews
from app.services.work.access import Access

router = APIRouter()


class ReviewMark(BaseModel):
    month: str  # "2026-10"
    done: bool = True
    # An admin marking someone else's; omitted for your own.
    user_id: Optional[str] = None


@router.get("/workspaces/{workspace_id}/reviews/mine", response_model=Dict[str, Any])
def my_reviews(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """The months open for marking, oldest first, each with when you marked it done (or null)."""
    access = Access.for_workspace(db, user.id, workspace_id)
    months = reviews.open_months(date.today())
    return {"months": reviews.mine(db, access, months)}


@router.post("/workspaces/{workspace_id}/reviews", response_model=Dict[str, Any])
def mark_review(workspace_id: uuid.UUID, data: ReviewMark, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    row = reviews.mark(db, access, data.user_id or user.id, reviews.month_of(data.month), data.done)
    db.commit()
    return {"month": data.month, "completed_at": row.completed_at if row else None}


@router.get("/workspaces/{workspace_id}/reviews", response_model=List[Dict[str, Any]])
def team_reviews(workspace_id: uuid.UUID, month: str = Query(..., description="YYYY-MM"),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Who has finished one month's review: a Manager's people, or everyone for an admin."""
    return reviews.team(db, Access.for_workspace(db, user.id, workspace_id), reviews.month_of(month))
