"""Request and response shapes for Dashboards, their cards and email reports."""

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.db.models import LocationKind, StatusGroup
from app.schemas.work import Name, ShareOut, TeamRef, UserOut

CardType = Literal["calculation", "pie", "bar", "line", "task_list", "time_report", "timesheet", "portfolio", "behind", "completed", "notes", "discussion", "embed"]
TASK_CARDS = ("calculation", "pie", "bar", "line", "task_list", "portfolio", "behind", "completed")
TIME_CARDS = ("time_report", "timesheet")
Template = Literal["blank", "simple", "vapl_review", "time_tracking"]
DashboardLevel = Literal["view", "edit", "full"]
Relation = Literal["mine", "team", "shared", "my_team", "everyone", "location"]


class Source(BaseModel):
    kind: LocationKind
    id: uuid.UUID

    @field_validator("kind")
    @classmethod
    def _no_tasks(cls, kind: LocationKind) -> LocationKind:
        if kind == LocationKind.task:
            raise ValueError("A card's source is a Space, Folder or List")
        return kind


PeriodPreset = Literal[
    "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "last_7_days", "last_30_days", "this_year", "custom",
]


class Period(BaseModel):
    preset: PeriodPreset = "this_week"
    start: Optional[date] = None  # custom only, inclusive
    end: Optional[date] = None  # custom only, inclusive

    @model_validator(mode="after")
    def _custom_needs_dates(self):
        if self.preset == "custom":
            if not self.start or not self.end:
                raise ValueError("A custom period needs a start and an end date")
            if self.end < self.start:
                raise ValueError("The period must end on or after its start")
            if (self.end - self.start).days > 366:
                raise ValueError("A period can be at most a year long")
        return self


class Filters(BaseModel):
    """Task filters. Every field that is set must match (AND).

    People are given as user ids, or as "me", "team:<id>", or (for assignees) "none".
    """

    assignees: Optional[List[str]] = None
    status_groups: Optional[List[StatusGroup]] = None
    priorities: Optional[List[Annotated[int, Field(ge=0, le=4)]]] = None  # 0 = no priority
    tags: Optional[List[str]] = None
    due: Optional[Literal["overdue", "today", "this_week", "next_7_days", "none", "set"]] = None
    estimate: Optional[Literal["set", "missing"]] = None
    scheduled: Optional[Literal["yes", "no"]] = None
    done: Optional[Literal["today", "this_week", "this_month", "last_7_days", "last_30_days"]] = None

    @field_validator("assignees")
    @classmethod
    def _people_tokens(cls, values: Optional[List[str]]) -> Optional[List[str]]:
        for value in values or []:
            if value.startswith("team:"):
                uuid.UUID(value[5:])  # raises ValueError when malformed
        return values


class CardConfig(BaseModel):
    """Settings for every card type; each type reads the fields it needs."""

    model_config = ConfigDict(extra="forbid")

    # Where the data comes from. Empty means every Space the viewer can see.
    sources: List[Source] = Field(default_factory=list, max_length=50)
    include_subtasks: bool = False
    include_closed: bool = False
    filters: Filters = Field(default_factory=Filters)

    # calculation / pie / bar
    measure: Literal["tasks", "time_estimate", "time_tracked"] = "tasks"
    fn: Literal["count", "sum", "avg", "min", "max"] = "count"
    unit: Optional[Annotated[str, StringConstraints(max_length=12)]] = None
    group_by: Literal[
        "status", "status_group", "assignee", "priority", "tag", "list",
        "done_date", "created_date", "due_date",
    ] = "status"
    interval: Literal["day", "week", "month"] = "day"
    donut: bool = True

    # time-based cards (bar over dates, time_report, timesheet)
    period: Period = Field(default_factory=Period)

    # time_report
    time_group_by: Literal["user", "list", "task"] = "user"
    then_by: Literal["task", "list", "none"] = "task"
    billable: Literal["all", "billable", "non_billable"] = "all"
    show_estimates: bool = False

    # task_list
    sort: Literal["due", "priority", "updated", "name"] = "due"
    limit: int = Field(default=50, ge=1, le=500)

    # notes
    text: Optional[Annotated[str, StringConstraints(max_length=10_000)]] = None

    # embed: a web page, Google Sheet, video… shown inside the card
    url: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]] = None


DATE_GROUPS = ("done_date", "created_date", "due_date")


def check_card(card_type: str, config: CardConfig) -> None:
    """Rules that depend on the card type."""
    if card_type == "calculation":
        if config.measure == "tasks" and config.fn != "count":
            raise ValueError("Tasks can only be counted")
        if config.measure != "tasks" and config.fn == "count":
            raise ValueError("Choose sum, average, minimum or maximum for a time measure")
    if card_type == "pie" and config.group_by in DATE_GROUPS:
        raise ValueError("Pie charts group by a category, not by date")
    if card_type == "line" and config.group_by not in DATE_GROUPS:
        raise ValueError("Line charts show a trend over time: group by date completed, created or due")
    if card_type == "embed" and config.url and not re.match(r"^https://", config.url, re.IGNORECASE):
        raise ValueError("Embeds must be https:// links")


class CardCreate(BaseModel):
    type: CardType
    title: Optional[Name] = None
    config: CardConfig = Field(default_factory=CardConfig)
    width: int = Field(default=6, ge=1, le=12)
    height: int = Field(default=2, ge=1, le=6)

    @model_validator(mode="after")
    def _valid(self):
        check_card(self.type, self.config)
        return self


class CardUpdate(BaseModel):
    title: Optional[Name] = None
    config: Optional[CardConfig] = None
    width: Optional[int] = Field(default=None, ge=1, le=12)
    height: Optional[int] = Field(default=None, ge=1, le=6)


class CardLayout(BaseModel):
    id: uuid.UUID
    width: int = Field(ge=1, le=12)
    height: int = Field(ge=1, le=6)


class LayoutUpdate(BaseModel):
    """The whole layout, in display order."""

    cards: List[CardLayout]


class CardOut(BaseModel):
    id: uuid.UUID
    type: CardType
    title: str
    config: CardConfig
    position: int
    width: int
    height: int


class DashboardCreate(BaseModel):
    name: Name
    team_id: Optional[uuid.UUID] = None
    template: Template = "blank"
    # Where the template's cards read from. Empty means everything the viewer can see.
    sources: List[Source] = Field(default_factory=list, max_length=50)


class DashboardUpdate(BaseModel):
    name: Optional[Name] = None
    filters: Optional[Filters] = None
    auto_refresh: Optional[bool] = None


class DashboardDuplicate(BaseModel):
    name: Optional[Name] = None
    # Give the copy to a Team (you must lead it, or be an admin). None keeps it personal.
    team_id: Optional[uuid.UUID] = None


class Repoint(BaseModel):
    """Point every card at new locations: the SOP's "duplicate, then change locations"."""

    sources: List[Source] = Field(max_length=50)


class DashboardSummary(BaseModel):
    id: uuid.UUID
    name: str
    owner: Optional[UserOut]
    team: Optional[TeamRef]
    your_level: DashboardLevel
    relation: Relation
    is_shared: bool
    card_count: int
    created_at: datetime
    updated_at: datetime


class DashboardOut(DashboardSummary):
    filters: Filters
    auto_refresh: bool
    cards: List[CardOut]


class CardData(BaseModel):
    card_id: uuid.UUID
    type: CardType
    computed_at: datetime
    # Set when the card cannot be shown to this viewer.
    no_access: bool = False
    # Sources the viewer cannot open (they are left out of the numbers).
    hidden_sources: int = 0
    error: Optional[str] = None
    data: Dict[str, Any] = Field(default_factory=dict)


class DashboardShareCreate(BaseModel):
    user_id: Optional[str] = None
    team_id: Optional[uuid.UUID] = None
    level: DashboardLevel = "view"

    @model_validator(mode="after")
    def _one_grantee(self):
        if (self.user_id is None) == (self.team_id is None):
            raise ValueError("Share with exactly one person or one Team")
        return self


class DashboardSharingOut(BaseModel):
    your_level: DashboardLevel
    shares: List[ShareOut]


# --- email reports -------------------------------------------------------------

_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class ScheduleIn(BaseModel):
    recipient_ids: List[str] = Field(min_length=1, max_length=100)
    subject: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None
    frequency: Literal["daily", "weekdays", "weekly", "monthly"] = "weekly"
    weekday: Optional[int] = Field(default=None, ge=0, le=6)  # 0 = Monday
    day_of_month: Optional[int] = Field(default=None, ge=1, le=28)
    send_time: str = "09:00"
    timezone: str = "Asia/Kolkata"
    active: bool = True

    @field_validator("send_time")
    @classmethod
    def _time(cls, value: str) -> str:
        if not _TIME.match(value):
            raise ValueError("Use a 24-hour time like 09:30")
        return value

    @field_validator("timezone")
    @classmethod
    def _tz(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(f"Unknown timezone {value}")
        return value

    @model_validator(mode="after")
    def _day_fields(self):
        if self.frequency == "weekly" and self.weekday is None:
            self.weekday = 0
        if self.frequency == "monthly" and self.day_of_month is None:
            self.day_of_month = 1
        return self


class ScheduleOut(BaseModel):
    id: uuid.UUID
    dashboard_id: uuid.UUID
    created_by: Optional[UserOut]
    recipients: List[UserOut]
    subject: Optional[str]
    frequency: str
    weekday: Optional[int]
    day_of_month: Optional[int]
    send_time: str
    timezone: str
    active: bool
    next_run_at: Optional[datetime]
    last_run_at: Optional[datetime]


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    schedule_id: Optional[uuid.UUID]
    status: str
    recipients: List[str]
    subject: str
    error: Optional[str]
    created_at: datetime


class RunDetail(RunOut):
    html: str



class ReportsOut(BaseModel):
    email_configured: bool
    schedules: List[ScheduleOut]


class PreviewOut(BaseModel):
    html: str


class DiscussionMessage(BaseModel):
    id: uuid.UUID
    body: str
    created_at: datetime
    user: Optional[UserOut]


class DiscussionIn(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
