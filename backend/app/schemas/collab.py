"""Shapes for comments, watchers, activity, the Inbox and reminders."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.schemas.work import StatusOut, TeamRef, UserOut, _as_utc

Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20_000)]


class CommentIn(BaseModel):
    body: Body
    parent_id: Optional[uuid.UUID] = None  # reply in this comment's thread
    mention_user_ids: List[str] = Field(default_factory=list, max_length=50)
    mention_team_ids: List[uuid.UUID] = Field(default_factory=list, max_length=20)
    assignee_id: Optional[str] = None  # turn the comment into a to-do for someone


class CommentUpdate(BaseModel):
    body: Optional[Body] = None
    assignee_id: Optional[str] = None
    resolved: Optional[bool] = None


class ReactionIn(BaseModel):
    emoji: Annotated[str, StringConstraints(min_length=1, max_length=16)]


class ReactionOut(BaseModel):
    emoji: str
    count: int
    mine: bool
    users: List[str]


class CommentOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    user: Optional[UserOut]
    body: str
    mentions: List[UserOut]
    mention_teams: List[TeamRef]
    assignee: Optional[UserOut]
    resolved_at: Optional[datetime]
    resolved_by: Optional[str]
    created_at: datetime
    edited_at: Optional[datetime]
    reactions: List[ReactionOut]
    can_edit: bool


class TaskRefOut(BaseModel):
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    status: Optional[StatusOut] = None


class CommentWithTask(CommentOut):
    task: TaskRefOut


class ActivityOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    kind: str
    data: Dict[str, Any]
    created_at: datetime


class WatchersOut(BaseModel):
    watchers: List[UserOut]
    watching: bool


class WatcherIn(BaseModel):
    user_id: Optional[str] = None  # yourself if left out


class ChecklistIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] = "Checklist"
    items: List[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]] = Field(default_factory=list, max_length=200)


class ChecklistTemplateIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    items: List[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]] = Field(default_factory=list, max_length=200)


class ChecklistTemplateOut(BaseModel):
    id: uuid.UUID
    name: str
    items: List[str]
    item_count: int
    created_at: datetime


class ChecklistUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = None
    orderindex: Optional[float] = None


class ItemIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    assignee_id: Optional[str] = None


class ItemUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]] = None
    resolved: Optional[bool] = None
    assignee_id: Optional[str] = None
    orderindex: Optional[float] = None


# --- Inbox ----------------------------------------------------------------------------------

InboxTab = Literal["primary", "other", "later", "cleared", "all"]


class InboxItem(BaseModel):
    id: uuid.UUID
    kind: str
    category: str
    actor: Optional[UserOut]
    task: Optional[TaskRefOut]
    comment: Optional[Dict[str, Any]]
    reminder: Optional[Dict[str, Any]]
    data: Dict[str, Any]
    read: bool
    cleared: bool
    saved: bool
    snoozed_until: Optional[datetime]
    created_at: datetime


class InboxCounts(BaseModel):
    primary: int
    other: int
    later: int


class NotificationUpdate(BaseModel):
    read: Optional[bool] = None
    cleared: Optional[bool] = None
    saved: Optional[bool] = None
    snoozed_until: Optional[datetime] = None  # send null with "unsnooze": true to wake it
    unsnooze: bool = False

    @field_validator("snoozed_until")
    @classmethod
    def _utc(cls, v):
        return _as_utc(v)


class BulkInbox(BaseModel):
    tab: InboxTab = "primary"


class SettingRow(BaseModel):
    kind: str
    label: str
    enabled: bool


class SettingsIn(BaseModel):
    enabled: Dict[str, bool]


# --- reminders ----------------------------------------------------------------------------------


class ReminderIn(BaseModel):
    title: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]] = None
    task_id: Optional[uuid.UUID] = None
    remind_at: datetime
    user_id: Optional[str] = None  # remind someone else (delegate)

    @field_validator("remind_at")
    @classmethod
    def _utc(cls, v):
        return _as_utc(v)


class ReminderUpdate(BaseModel):
    title: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]] = None
    remind_at: Optional[datetime] = None
    done: Optional[bool] = None

    @field_validator("remind_at")
    @classmethod
    def _utc(cls, v):
        return _as_utc(v)


class ReminderOut(BaseModel):
    id: uuid.UUID
    title: str
    task: Optional[TaskRefOut]
    remind_at: datetime
    done: bool
    notified: bool
    user: UserOut
    created_by: Optional[str]
