"""Request and response shapes for Timesheets, time tags and approvals."""

import uuid
from datetime import date, datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.work import HexColor, StatusOut, TimeTagRef, UserOut

TagName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
DaySeconds = Annotated[int, Field(ge=0, le=86_400)]
Capacity = Annotated[List[DaySeconds], Field(min_length=7, max_length=7)]
SubmissionStatus = Literal["pending", "approved", "changes_needed", "withdrawn"]


# --- time tags -----------------------------------------------------------------------


class TimeTagIn(BaseModel):
    name: TagName
    bg_color: Optional[HexColor] = None
    fg_color: Optional[HexColor] = None


TimeTagOut = TimeTagRef


# --- the grid ---------------------------------------------------------------------------


class SheetEntry(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    started_at: datetime
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    running: bool
    description: Optional[str]
    billable: bool
    tags: List[TimeTagOut]
    day: int  # index into the period's days
    created_by: Optional[str]


class SheetTask(BaseModel):
    id: uuid.UUID
    name: str  # "Private task" when the viewer cannot open it
    status: Optional[StatusOut]
    location: str
    list_id: Optional[uuid.UUID]
    archived: bool
    can_open: bool


class SheetRow(BaseModel):
    task: SheetTask
    seconds_per_day: List[int]
    total_seconds: int
    added_at: datetime
    running: bool
    entries: List[SheetEntry]


class SubmissionOut(BaseModel):
    id: uuid.UUID
    user: UserOut
    period_start: date
    period_end: date
    status: SubmissionStatus
    submitted_at: datetime
    decided_by: Optional[UserOut]
    decided_at: Optional[datetime]
    tracked_seconds: int
    billable_seconds: int
    capacity_seconds: int
    can_review: bool
    approvers: List[UserOut]


class TimesheetOut(BaseModel):
    user: UserOut
    period_start: date
    period_end: date
    days: List[date]
    capacity_per_day: List[int]
    tracked_per_day: List[int]
    billable_per_day: List[int]
    rows: List[SheetRow]
    total_seconds: int
    week_start: int
    approvals_enabled: bool
    submission: Optional[SubmissionOut]
    locked: bool  # pending or approved: read-only for everyone but owners and admins
    can_edit: bool


class CellIn(BaseModel):
    user_id: Optional[str] = None
    task_id: uuid.UUID
    day: date
    seconds: Annotated[int, Field(ge=0, le=86_400)]
    tz: str = "UTC"


class RowIn(BaseModel):
    user_id: Optional[str] = None
    task_id: uuid.UUID
    start: date
    tz: str = "UTC"


class PickTask(BaseModel):
    id: uuid.UUID
    name: str
    status: StatusOut
    location: str


# --- all timesheets --------------------------------------------------------------------------


class PersonWeek(BaseModel):
    user: UserOut
    capacity_per_day: List[int]
    tracked_per_day: List[int]
    billable_per_day: List[int]
    total_seconds: int
    capacity_seconds: int
    submission_status: Optional[SubmissionStatus]


class AllTimesheetsOut(BaseModel):
    period_start: date
    period_end: date
    days: List[date]
    people: List[PersonWeek]
    approvals_enabled: bool


# --- settings and capacity ---------------------------------------------------------------------


class SettingsOut(BaseModel):
    week_start: int
    approvals_enabled: bool
    capacity_seconds: List[int]
    can_manage: bool


class SettingsIn(BaseModel):
    week_start: Optional[int] = Field(default=None, ge=0, le=6)
    approvals_enabled: Optional[bool] = None
    capacity_seconds: Optional[Capacity] = None


class CapacityIn(BaseModel):
    # None goes back to the workspace's work schedule.
    capacity_seconds: Optional[Capacity] = None


class CapacityOut(BaseModel):
    capacity_seconds: List[int]
    is_custom: bool


class ApproversOut(BaseModel):
    submitter: UserOut
    approvers: List[UserOut]
    is_custom: bool  # False: the submitter's Team leads approve


class ApproversIn(BaseModel):
    approver_ids: List[str] = Field(max_length=20)


# --- approvals ----------------------------------------------------------------------------------


class SubmitIn(BaseModel):
    start: date
    tz: str = "UTC"
    comment: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]] = None


class DecisionIn(BaseModel):
    comment: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]] = None


class CommentIn(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class CommentOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    event: Optional[str]
    body: Optional[str]
    created_at: datetime

