"""Notification delivery (email, push, WhatsApp), the team digest, review packs and the compliance calendar."""

import uuid
from datetime import date, datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.work import UserOut


class Channels(BaseModel):
    email: bool
    push: bool
    whatsapp: bool


class DeliveryOut(BaseModel):
    email_notifications: Literal["off", "instant", "daily"]
    digest_hour: int
    timezone: str
    weekly_team_digest: bool
    whatsapp_opt_in: bool
    phone: Optional[str]
    devices: int
    channels: Channels


class DeliveryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email_notifications: Optional[Literal["off", "instant", "daily"]] = None
    digest_hour: Optional[Annotated[int, Field(ge=0, le=23)]] = None
    timezone: Optional[Annotated[str, StringConstraints(max_length=64)]] = None
    weekly_team_digest: Optional[bool] = None
    whatsapp_opt_in: Optional[bool] = None


class PushKeys(BaseModel):
    p256dh: Annotated[str, StringConstraints(min_length=10, max_length=200)]
    auth: Annotated[str, StringConstraints(min_length=4, max_length=100)]


class PushSubscriptionIn(BaseModel):
    endpoint: Annotated[str, StringConstraints(pattern=r"^https://", max_length=2000)]
    keys: PushKeys
    device: Optional[Annotated[str, StringConstraints(max_length=200)]] = None


class DigestTask(BaseModel):
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    due_date: Optional[datetime]


class DigestLeave(BaseModel):
    start_date: date
    end_date: date
    type: str
    status: str


class DigestPerson(BaseModel):
    user: UserOut
    overdue: int
    overdue_tasks: List[DigestTask]
    done_last_week: int
    tracked_seconds: int
    capacity_seconds: int
    timesheet_status: Optional[str]
    leave: List[DigestLeave]


class TeamDigest(BaseModel):
    week_start: date
    week_end: date
    people: List[DigestPerson]


# --- review packs --------------------------------------------------------------------------------------------


class ReviewPackIn(BaseModel):
    user_ids: Optional[List[str]] = None  # None: everyone active except guests
    email_monthly: bool = True  # schedule the pack to be emailed on the 1st to the person and their manager


class ReviewPackOut(BaseModel):
    created: int
    existing: int
    dashboards: List[uuid.UUID]


# --- compliance ---------------------------------------------------------------------------------------------


class ObligationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[a-z0-9_]{2,40}$")]
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
    authority: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]] = None
    frequency: Literal["monthly", "quarterly", "half_yearly", "yearly"]
    due_day: Annotated[int, Field(ge=1, le=31)]
    due_months: List[Annotated[int, Field(ge=1, le=12)]] = Field(default_factory=list, max_length=12)
    lead_days: Annotated[int, Field(ge=0, le=60)] = 5
    notes: Optional[Annotated[str, StringConstraints(max_length=2000)]] = None
    archived: bool = False


class ObligationOut(ObligationIn):
    id: uuid.UUID


class ClientComplianceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    obligation_ids: List[uuid.UUID] = Field(min_length=1, max_length=50)
    list_id: uuid.UUID
    client_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    assignee_ids: List[str] = Field(default_factory=list, max_length=20)


class ClientComplianceOut(BaseModel):
    id: uuid.UUID
    obligation: ObligationOut
    list_id: uuid.UUID
    list_name: str
    client_name: str
    assignees: List[UserOut]
    active: bool


class ComplianceItem(BaseModel):
    """One filing on the calendar: which client, which obligation, which period, when it's due and its task."""

    client_compliance_id: uuid.UUID
    client_name: str
    obligation: str
    authority: Optional[str]
    period_label: str
    due_date: date
    task_id: Optional[uuid.UUID]
    list_id: uuid.UUID
    status: Optional[str]
    status_group: Optional[str]
    done: bool
    overdue: bool
