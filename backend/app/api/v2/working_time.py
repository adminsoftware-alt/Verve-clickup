"""The holiday calendar: the days nobody is expected to work.

These three sat in the leave router with eighteen leave endpoints and six billing ones. They are
not leave -- what they hold is an input to everybody's capacity -- so when the other twenty-four
went, these moved here.
"""

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import working_time as wt
from app.services.work import working_time
from app.services.work.access import Access

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


@router.get("/workspaces/{workspace_id}/holidays", response_model=List[wt.HolidayOut])
def holidays(workspace_id: uuid.UUID, year: Optional[int] = Query(None, ge=2000, le=2100),
             user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [wt.HolidayOut(id=h.id, day=h.day, name=h.name)
            for h in working_time.holidays(db, _access(db, user, workspace_id), year)]


@router.post("/workspaces/{workspace_id}/holidays", response_model=wt.HolidayOut, status_code=status.HTTP_201_CREATED)
def add_holiday(workspace_id: uuid.UUID, data: wt.HolidayIn,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = working_time.add_holiday(db, _access(db, user, workspace_id), data)
    db.commit()
    return wt.HolidayOut(id=h.id, day=h.day, name=h.name)


@router.delete("/workspaces/{workspace_id}/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_holiday(workspace_id: uuid.UUID, holiday_id: uuid.UUID,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    working_time.remove_holiday(db, _access(db, user, workspace_id), holiday_id)
    db.commit()


# --- working hours: the company's week, each Team's, and each person's (admins) -------------------------


@router.get("/workspaces/{workspace_id}/working-hours", response_model=wt.WorkingHoursOut)
def working_hours(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return working_time.overview(db, _access(db, user, workspace_id))


@router.put("/workspaces/{workspace_id}/working-hours/company", response_model=wt.WorkingHoursOut)
def set_company_hours(workspace_id: uuid.UUID, data: wt.CompanyHoursIn,
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = working_time.set_company_hours(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.put("/workspaces/{workspace_id}/working-hours/teams/{team_id}", response_model=wt.WorkingHoursOut)
def set_team_hours(workspace_id: uuid.UUID, team_id: uuid.UUID, data: wt.HoursIn,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = working_time.set_team_hours(db, _access(db, user, workspace_id), team_id, data)
    db.commit()
    return out


@router.put("/workspaces/{workspace_id}/working-hours/people", response_model=wt.WorkingHoursOut)
def set_people_hours(workspace_id: uuid.UUID, data: wt.PeopleHoursIn,
                     user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = working_time.set_people_hours(db, _access(db, user, workspace_id), data)
    db.commit()
    return out
