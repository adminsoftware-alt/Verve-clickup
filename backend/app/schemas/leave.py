"""Leave, holidays, billing rates, client fees and profitability."""

import uuid
from datetime import date, datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.work import UserOut

HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
Currency = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


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
    approve: bool
    note: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]] = None


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


class LeaveBalance(BaseModel):
    type: LeaveTypeOut
    allowance: Optional[float]
    used: float
    pending: float
    remaining: float  # 9999 when there is no limit


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
