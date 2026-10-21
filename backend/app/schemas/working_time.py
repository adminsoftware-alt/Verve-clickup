"""What the holiday calendar and everyone's working hours look like over the wire."""

import uuid
from datetime import date
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.timesheets import Capacity
from app.schemas.work import UserOut


class HolidayIn(BaseModel):
    day: date
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class HolidayOut(BaseModel):
    id: uuid.UUID
    day: date
    name: str


# --- working hours -------------------------------------------------------------------------------

# Whose week a person is on: their own, a Team's, or the company's.
HoursSource = Literal["person", "team", "company"]


class PersonHoursOut(BaseModel):
    user: UserOut
    designation: Optional[str] = None
    teams: List[str]
    capacity_seconds: List[int]
    source: HoursSource
    # The Team the week comes from, when it comes from a Team.
    team_id: Optional[uuid.UUID] = None
    team_name: Optional[str] = None


class TeamHoursOut(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str] = None
    member_count: int
    # None: the Team follows the company's week.
    capacity_seconds: Optional[List[int]] = None


class WorkingHoursOut(BaseModel):
    company: List[int]
    teams: List[TeamHoursOut]
    people: List[PersonHoursOut]


class HoursIn(BaseModel):
    # None goes back to the next layer down: a Team to the company's week, a person to their Team's.
    capacity_seconds: Optional[Capacity] = None


class PeopleHoursIn(HoursIn):
    user_ids: List[str] = Field(min_length=1, max_length=1000)


class CompanyHoursIn(BaseModel):
    capacity_seconds: Capacity
