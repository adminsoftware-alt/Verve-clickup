"""Phase D: All Spaces and join requests, sidebar sections, public links, sprints, time in status,
Email-to-List, tasks in several Lists, and the Doc, Whiteboard, Mind map, Chat and Embed views."""

import uuid
from datetime import date, datetime
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.db.models.enums import PermissionLevel
from app.schemas.work import UserOut

Short = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


# --- All Spaces -------------------------------------------------------------------------------


class BrowseSpace(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]
    icon: Optional[str]
    description: Optional[str]
    is_private: bool
    permission_level: Optional[PermissionLevel]  # None: private, you can ask to join
    joined: bool  # in your sidebar
    requested: bool  # you asked to join and are waiting
    list_count: int
    owner: Optional[UserOut]
    can_approve: bool


class JoinIn(BaseModel):
    message: Optional[Annotated[str, StringConstraints(max_length=500)]] = None


class JoinRequestOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID
    space_name: str
    user: UserOut
    message: Optional[str]
    created_at: datetime


class JoinDecision(BaseModel):
    approve: bool
    level: PermissionLevel = PermissionLevel.edit


class SpaceDuplicate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = None
    include_tasks: bool = True
    # The same questions a Folder or a List is asked, so the three dialogs can be one dialog.
    share_with: List[str] = Field(default_factory=list, max_length=100)
    share_level: PermissionLevel = PermissionLevel.edit
    include_subtasks: bool = True
    assignees: bool = True
    dates: bool = True
    checklists: bool = True
    custom_fields: bool = True


# --- sidebar sections ---------------------------------------------------------------------------


class SectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Short
    space_ids: List[uuid.UUID] = Field(default_factory=list, max_length=500)


class SectionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[Short] = None
    orderindex: Optional[float] = None
    collapsed: Optional[bool] = None
    space_ids: Optional[List[uuid.UUID]] = Field(default=None, max_length=500)


# --- public links -------------------------------------------------------------------------------


class PublicLinkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["task", "list", "view"]
    target_id: uuid.UUID
    show_description: bool = True
    show_assignees: bool = False
    expires_on: Optional[date] = None


class PublicLinkOut(BaseModel):
    id: uuid.UUID
    token: str
    kind: Literal["task", "list", "view"]
    target_id: uuid.UUID
    target_name: str
    show_description: bool
    show_assignees: bool
    expires_at: Optional[datetime]
    created_at: datetime
    created_by: Optional[str]
    views_count: int


class PublicTask(BaseModel):
    id: uuid.UUID
    name: str
    status: str
    status_color: str
    status_group: str
    priority: Optional[int]
    start_date: Optional[datetime]
    due_date: Optional[datetime]
    description: Optional[str] = None
    assignees: List[str] = Field(default_factory=list)
    parent_id: Optional[uuid.UUID] = None
    checklist_done: int = 0
    checklist_total: int = 0


class PublicPage(BaseModel):
    kind: Literal["task", "list", "view"]
    title: str
    workspace: str
    view_type: Optional[str] = None
    task: Optional[PublicTask] = None
    subtasks: List[PublicTask] = Field(default_factory=list)
    tasks: List[PublicTask] = Field(default_factory=list)
    doc: Optional[Dict[str, Any]] = None


# --- tasks in several Lists ---------------------------------------------------------------------


class TaskListRef(BaseModel):
    id: uuid.UUID
    name: str
    path: str
    home: bool


class ShareTaskWith(BaseModel):
    """Share one task with people: the same task, in each of their Personal Lists."""

    user_ids: List[str] = Field(default_factory=list, max_length=100)
    # Work in someone's List with nobody's name on it is work nobody has been asked to do.
    assign: bool = True


class TaskSharedWith(BaseModel):
    """Who the task sits with personally, alongside the Lists it is in."""

    lists: List[TaskListRef]
    people: List[str]


# --- time in status -----------------------------------------------------------------------------


class StatusSpell(BaseModel):
    status: str
    color: Optional[str]
    since: datetime
    until: Optional[datetime]  # None: still in it
    seconds: int


class StatusTotal(BaseModel):
    status: str
    color: Optional[str]
    seconds: int
    times: int


class TimeInStatus(BaseModel):
    current: str
    spells: List[StatusSpell]
    totals: List[StatusTotal]


# --- sprints ------------------------------------------------------------------------------------


class SprintSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weeks: Annotated[int, Field(ge=1, le=8)] = 2
    start_weekday: Annotated[int, Field(ge=0, le=6)] = 0  # 0 = Monday
    rollover: bool = True  # unfinished tasks move to the next sprint when one is completed
    auto_complete: bool = False  # complete each sprint (and start the next) when its end date passes
    first_start: Optional[date] = None


class SprintOut(BaseModel):
    id: uuid.UUID
    name: str
    start_date: Optional[datetime]
    due_date: Optional[datetime]
    completed_at: Optional[datetime]
    current: bool
    total_points: float
    done_points: float
    task_count: int
    done_count: int


class BurndownDay(BaseModel):
    day: date
    remaining: Optional[float]  # None for days still to come
    ideal: float


class SprintReport(BaseModel):
    sprint: SprintOut
    folder_id: uuid.UUID
    burndown: List[BurndownDay]
    velocity: List[Dict[str, Any]]  # past sprints: {name, done_points, total_points}
    average_velocity: float
    unit: Literal["points", "tasks"] = "points"  # tasks when no task in the sprint has points


class SprintCompleteOut(BaseModel):
    completed: SprintOut
    moved: int
    next_list_id: Optional[uuid.UUID]


# --- Email-to-List ------------------------------------------------------------------------------


class ListEmailOut(BaseModel):
    address: Optional[str]
    configured: bool  # the server has an inbox to read from
    enabled: bool  # the Email-to-List ClickApp is on in this Space


# --- Doc, Whiteboard, Mind map, Chat, Embed -----------------------------------------------------


class ViewContentOut(BaseModel):
    content: Dict[str, Any]
    version: int
    updated_by: Optional[UserOut]
    updated_at: Optional[datetime]


class ViewContentIn(BaseModel):
    content: Dict[str, Any]
    version: int = Field(ge=0, description="The version you started editing; a newer one on the server means someone else saved first")


class ChatIn(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]
    mention_user_ids: List[str] = Field(default_factory=list, max_length=50)


class ChatOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    body: str
    task_id: Optional[uuid.UUID]
    created_at: datetime
    edited_at: Optional[datetime]
    mine: bool


class ChatToTask(BaseModel):
    list_id: Optional[uuid.UUID] = None  # defaults to the view's List


class EmbedIn(BaseModel):
    url: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^https://", max_length=2000)]
