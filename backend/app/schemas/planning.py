"""My Tasks extras: Planner time blocks, LineUp, calendar feeds, the Home layout, and Automations."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.work import TaskOut, UserOut

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


# --- Planner ------------------------------------------------------------------------------------


class TimeBlockIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: Optional[uuid.UUID] = None
    title: Optional[Name] = None
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def _check(self):
        if self.task_id is None and not self.title:
            raise ValueError("A time block needs a task or a title")
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("Times must include a timezone")
        if self.end_at <= self.start_at:
            raise ValueError("A time block must end after it starts")
        if (self.end_at - self.start_at).total_seconds() > 24 * 3600:
            raise ValueError("A time block can be at most 24 hours long")
        return self


class TimeBlockUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Optional[Name] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None


class TimeBlockOut(BaseModel):
    id: uuid.UUID
    task_id: Optional[uuid.UUID]
    title: Optional[str]
    start_at: datetime
    end_at: datetime
    task: Optional[TaskOut] = None


class CalendarEvent(BaseModel):
    feed_id: uuid.UUID
    title: str
    start: datetime
    end: datetime
    all_day: bool
    location: Optional[str] = None
    color: str


class DayOff(BaseModel):
    day: date
    label: str  # e.g. "Casual leave", "Diwali"
    part: str = "full"  # full | first_half | second_half
    kind: str  # leave | holiday
    pending: bool = False


class PlannerOut(BaseModel):
    blocks: List[TimeBlockOut]
    events: List[CalendarEvent]
    days_off: List[DayOff] = Field(default_factory=list)
    # Feeds that could not be read the last time they were fetched.
    feed_errors: Dict[str, str] = Field(default_factory=dict)


# --- Calendar sync ---------------------------------------------------------------------------------


class CalendarFeedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    url: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=2000)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")] = "#0ea5e9"


class CalendarFeedOut(BaseModel):
    id: uuid.UUID
    name: str
    color: str
    # The address is secret, so only its host is shown back.
    host: str
    event_count: int
    fetched_at: Optional[datetime]
    error: Optional[str]


class CalendarLinkOut(BaseModel):
    url: Optional[str]


# --- LineUp and Home --------------------------------------------------------------------------------


class LineupOrder(BaseModel):
    task_ids: List[uuid.UUID] = Field(max_length=50)


HomeCardKey = Literal["recents", "agenda", "lineup", "priorities", "planner", "delegated", "done"]


class HomeCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: HomeCardKey
    hidden: bool = False
    size: Literal["half", "full"] = "half"


class HomeLayout(BaseModel):
    cards: Optional[List[HomeCard]] = Field(default=None, max_length=20)

    @model_validator(mode="after")
    def _unique(self):
        if self.cards is not None and len({c.key for c in self.cards}) != len(self.cards):
            raise ValueError("Each card can appear once")
        return self


# --- Automations ------------------------------------------------------------------------------------

Trigger = Literal["task_created", "status_changed", "due_soon", "overdue", "priority_changed", "assignee_added"]
Action = Literal["assign", "notify", "set_priority", "set_status", "escalate", "add_tag"]


class AutomationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trigger: Trigger
    # status_changed: {"status": "<status name>"} (empty: any change)
    trigger_config: Dict[str, Any] = Field(default_factory=dict)
    action: Action
    # assign / notify: {"user_ids": [...]}; set_priority: {"priority": 1-4}; set_status: {"status_name": "..."}
    action_config: Dict[str, Any] = Field(default_factory=dict)
    active: bool = True


class AutomationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    trigger_config: Optional[Dict[str, Any]] = None
    action_config: Optional[Dict[str, Any]] = None
    active: Optional[bool] = None


class AutomationOut(BaseModel):
    id: uuid.UUID
    location_kind: Literal["space", "folder", "list"]
    location_id: uuid.UUID
    trigger: Trigger
    trigger_config: Dict[str, Any]
    action: Action
    action_config: Dict[str, Any]
    active: bool
    created_by: Optional[UserOut]
    created_at: datetime
    last_run_at: Optional[datetime]
    run_count: int
    # Set on rules defined higher up (e.g. a Space's rule shown on one of its Lists).
    inherited: bool = False


# --- two-way calendar sync ---------------------------------------------------------------------------


class CalendarConnectionOut(BaseModel):
    id: uuid.UUID
    provider: Literal["google", "microsoft"]
    account_email: Optional[str]
    push_tasks: bool
    push_blocks: bool
    pull_events: bool
    color: str
    event_count: int
    synced_at: Optional[datetime]
    error: Optional[str]


class CalendarConnectionUpdate(BaseModel):
    push_tasks: Optional[bool] = None
    push_blocks: Optional[bool] = None
    pull_events: Optional[bool] = None
    color: Optional[Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]] = None


class CalendarProviders(BaseModel):
    google: bool
    microsoft: bool


class SyncResult(BaseModel):
    created: int
    updated: int
    deleted: int
    pulled: int
    connection: CalendarConnectionOut
