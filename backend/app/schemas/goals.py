"""Goals and their targets (ClickUp Goals), including Team goals."""

import uuid
from datetime import datetime
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.schemas.work import HexColor, TeamRef, UserOut

GoalName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
TargetKind = Literal["number", "currency", "true_false", "tasks"]


class TargetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GoalName
    kind: TargetKind
    start_value: float = 0
    target_value: float = 1
    unit: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]] = None
    task_ids: List[uuid.UUID] = Field(default_factory=list, max_length=500)
    list_ids: List[uuid.UUID] = Field(default_factory=list, max_length=50)
    owner_id: Optional[str] = None

    @model_validator(mode="after")
    def _sane(self):
        if self.kind in ("number", "currency") and self.target_value == self.start_value:
            raise ValueError("The target must differ from the starting value")
        if self.kind == "tasks" and not (self.task_ids or self.list_ids):
            raise ValueError("Pick the tasks or Lists this target tracks")
        return self


class TargetUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[GoalName] = None
    start_value: Optional[float] = None
    target_value: Optional[float] = None
    unit: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=20)]] = None
    task_ids: Optional[List[uuid.UUID]] = Field(default=None, max_length=500)
    list_ids: Optional[List[uuid.UUID]] = Field(default=None, max_length=50)
    owner_id: Optional[str] = None


class CheckInIn(BaseModel):
    value: float
    note: Optional[Annotated[str, StringConstraints(max_length=1000)]] = None


class CheckInOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    value: float
    note: Optional[str]
    created_at: datetime


class TargetOut(BaseModel):
    id: uuid.UUID
    name: str
    kind: TargetKind
    start_value: float
    target_value: float
    current_value: float
    unit: Optional[str]
    task_ids: List[uuid.UUID]
    list_ids: List[uuid.UUID]
    owner: Optional[UserOut]
    progress: float  # 0-100
    done_tasks: int = 0
    total_tasks: int = 0


class GoalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: GoalName
    description: Optional[Annotated[str, StringConstraints(max_length=5000)]] = None
    color: HexColor = "#6366f1"
    folder: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]] = None
    team_id: Optional[uuid.UUID] = None
    owner_ids: List[str] = Field(default_factory=list, max_length=20)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    is_private: bool = False
    targets: List[TargetIn] = Field(default_factory=list, max_length=30)


class GoalUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[GoalName] = None
    description: Optional[Annotated[str, StringConstraints(max_length=5000)]] = None
    color: Optional[HexColor] = None
    folder: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=80)]] = None
    team_id: Optional[uuid.UUID] = None
    owner_ids: Optional[List[str]] = Field(default=None, max_length=20)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    is_private: Optional[bool] = None
    archived: Optional[bool] = None


class GoalOut(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    color: str
    folder: Optional[str]
    team: Optional[TeamRef]
    owners: List[UserOut]
    start_date: Optional[datetime]
    due_date: Optional[datetime]
    is_private: bool
    archived: bool
    progress: float
    on_track: Optional[bool]  # None when there's no due date to judge by
    targets: List[TargetOut]
    can_edit: bool
    created_by: Optional[str]
    updated_at: datetime
