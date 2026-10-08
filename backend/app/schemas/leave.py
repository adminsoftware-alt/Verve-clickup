"""Leave, holidays, billing rates, client fees and profitability."""

import uuid
from datetime import date, datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.work import UserOut

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Blackout(BaseModel):
    """Days of the year nobody may book, written month-day so they come round again."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: Annotated[str, StringConstraints(pattern=r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")] = Field(alias="from")
    to: Annotated[str, StringConstraints(pattern=r"^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")]
    reason: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]] = None

    def model_dump(self, **kwargs):  # stored and read back under the name people wrote
        kwargs.setdefault("by_alias", True)
        return super().model_dump(**kwargs)


class LeavePolicyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: 4 = April, the financial year most Indian firms run on. 1 is the calendar year.
    year_start_month: Annotated[int, Field(ge=1, le=12)] = 4
    #: None: nothing carries over. 0 is a different answer, so they cannot share a value.
    carry_forward_days: Optional[Annotated[float, Field(ge=0, le=366)]] = None
    prorate_joiners: bool = True
    min_notice_days: Annotated[int, Field(ge=0, le=180)] = 0
    allow_backdated: bool = True
    count_days_off_inside: bool = False
    escalate_after_days: Optional[Annotated[int, Field(ge=1, le=90)]] = None
    hr_team_id: Optional[uuid.UUID] = None
    blackout: List[Blackout] = Field(default_factory=list, max_length=24)


class LeavePolicyOut(LeavePolicyIn):
    hr_team_name: Optional[str] = None


class LeaveTypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    color: HexColor = "#0ea5e9"
    yearly_days: Optional[Annotated[float, Field(ge=0, le=366)]] = None
    paid: bool = True
    needs_approval: bool = True
    archived: bool = False


class LeaveTypeOut(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    yearly_days: Optional[float]
    paid: bool
    needs_approval: bool
    archived: bool


class HolidayIn(BaseModel):
    day: date
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class HolidayOut(BaseModel):
    id: uuid.UUID
    day: date
    name: str


class LeaveRequestIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type_id: uuid.UUID
    start_date: date
    end_date: date
    part: Literal["full", "first_half", "second_half"] = "full"
    reason: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]] = None
    user_id: Optional[str] = None  # admins can record leave for someone else

    @model_validator(mode="after")
    def _order(self):
        if self.end_date < self.start_date:
            raise ValueError("The leave must end on or after the day it starts")
        if (self.end_date - self.start_date).days > 180:
            raise ValueError("Split leave longer than six months into separate requests")
        return self


class LeaveDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approve: bool
    note: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]] = None
    #: Who holds the work while they are away. The approver's call, not the asker's.
    cover_id: Optional[str] = None


class LeaveRequestOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    type: Optional[LeaveTypeOut]
    start_date: date
    end_date: date
    part: str
    days: float
    reason: Optional[str]  # only for the person, their approver and admins
    status: str
    approver: Optional[UserOut]
    decided_by: Optional[UserOut]
    decided_at: Optional[datetime]
    decision_note: Optional[str]
    created_at: datetime
    can_decide: bool = False
    #: Who is covering the work. Set when the leave is approved.
    cover: Optional[UserOut] = None
    #: When HR was told this had been waiting too long, if it ever was.
    escalated_at: Optional[datetime] = None
    #: How many days it has been waiting for a decision. None once decided.
    waiting_days: Optional[int] = None


class LeaveBalance(BaseModel):
    type: LeaveTypeOut
    #: What they may take in this leave year: earned + carried forward + adjusted. None: no limit.
    allowance: Optional[float]
    used: float
    pending: float
    remaining: float  # 9999 when there is no limit
    #: The three parts of the allowance, so a person can see where the number came from.
    earned: Optional[float] = None
    carried_forward: float = 0
    adjusted: float = 0
    #: The leave year this is about, named by the calendar year it starts in.
    year: Optional[int] = None
    year_start: Optional[date] = None
    year_end: Optional[date] = None


class LeaveAdjustmentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str
    type_id: uuid.UUID
    year: Annotated[int, Field(ge=2000, le=2100)]
    #: Positive grants days, negative takes them back, zero removes the adjustment.
    days: Annotated[float, Field(ge=-366, le=366)]
    reason: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None


class LeaveAdjustmentOut(BaseModel):
    id: uuid.UUID
    type: Optional[LeaveTypeOut]
    year: int
    days: float
    reason: Optional[str]
    created_by: Optional[UserOut]
    created_at: datetime


class ClashTask(BaseModel):
    """Something this person has due in the days they want off."""

    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    due_date: datetime
    priority: Optional[int] = None
    #: A statutory filing, which is the kind of date a firm cannot move.
    compliance: bool = False


class ClashPerson(BaseModel):
    user: UserOut
    start_date: date
    end_date: date
    status: str
    days: float


class LeaveClashes(BaseModel):
    tasks: List[ClashTask]
    also_away: List[ClashPerson]


class LeaveCalendarOut(BaseModel):
    leave: List[LeaveRequestOut]
    holidays: List[HolidayOut]


# --- billing -------------------------------------------------------------------------------------------------


class BillingRateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: Optional[str] = None
    location_kind: Optional[Literal["space", "folder", "list"]] = None
    location_id: Optional[uuid.UUID] = None
    hourly_rate: Annotated[float, Field(ge=0, le=1_000_000)]
    currency: Currency = "INR"

    @model_validator(mode="after")
    def _target(self):
        if (self.location_kind is None) != (self.location_id is None):
            raise ValueError("Give both the location kind and id, or neither")
        if self.user_id is None and self.location_id is None:
            raise ValueError("A rate is for a person, a location, or a person at a location")
        return self


class BillingRateOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    location_kind: Optional[str]
    location_id: Optional[uuid.UUID]
    location_name: Optional[str]
    hourly_rate: float
    currency: str


class ClientFeeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: Annotated[float, Field(ge=0, le=10_000_000_000)]
    period: Literal["monthly", "one_off"] = "monthly"
    currency: Currency = "INR"
    client_name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None


class ClientFeeOut(ClientFeeIn):
    location_kind: str
    location_id: uuid.UUID
    location_name: str


class ProfitPerson(BaseModel):
    user: Optional[UserOut]
    billable_seconds: int
    non_billable_seconds: int
    rate: Optional[float]
    value: float


class ProfitRow(BaseModel):
    location_kind: str
    location_id: uuid.UUID
    name: str
    client_name: Optional[str]
    currency: str
    fee: Optional[float]  # for the period: monthly retainers × months; one-off fees in full
    billable_seconds: int
    non_billable_seconds: int
    value: float  # billable hours at billing rates
    unpriced_seconds: int  # billable time with no rate set
    realisation: Optional[float]  # fee / value, as a percentage
    margin: Optional[float]  # fee − value
    people: List[ProfitPerson]


class ProfitReport(BaseModel):
    start: date
    end: date
    rows: List[ProfitRow]


class InvoiceLine(BaseModel):
    task_id: uuid.UUID
    task_name: str
    custom_id: Optional[str]
    user: Optional[UserOut]
    seconds: int
    rate: Optional[float]
    amount: float


class InvoiceDraft(BaseModel):
    location_kind: str
    location_id: uuid.UUID
    name: str
    client_name: Optional[str]
    currency: str
    start: date
    end: date
    lines: List[InvoiceLine]
    total_seconds: int
    total: float
    fee: Optional[float]
