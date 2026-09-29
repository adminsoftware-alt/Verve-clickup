"""Request and response shapes for the v2 work hierarchy API."""

import uuid
from datetime import date, datetime, timezone
from typing import Annotated, Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.db.models import LocationKind, PermissionLevel, StatusGroup, ViewType, WorkspaceRole

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
TaskName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
TagName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$")]
Priority = Annotated[int, Field(ge=1, le=4, description="1 urgent, 2 high, 3 normal, 4 low")]
EstimateSeconds = Annotated[int, Field(ge=0, le=100_000_000)]


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class _DatesMixin(BaseModel):
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

    @field_validator("start_date", "due_date")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)

    @model_validator(mode="after")
    def _due_after_start(self):
        if self.start_date and self.due_date and self.due_date < self.start_date:
            raise ValueError("due_date must be on or after start_date")
        return self


# --- people & workspaces -----------------------------------------------------


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: Optional[str] = None
    # Path of the profile photo under /api/v2 (e.g. "avatars/ab12….png"), or None for initials.
    avatar: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _avatar_from_row(cls, value):
        key = getattr(value, "avatar_key", None) if not isinstance(value, dict) else None
        if key:
            return {"id": value.id, "email": value.email, "display_name": value.display_name, "avatar": f"avatars/{key}"}
        return value


class WorkspaceCreate(BaseModel):
    name: Name


class WorkspaceOut(BaseModel):
    id: uuid.UUID
    name: str
    role: WorkspaceRole
    # Set when the caller is a member but can't open it (access turned off, or a sign-in rule).
    access_problem: Optional[str] = None


class MemberAdd(BaseModel):
    email: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320)]
    role: WorkspaceRole = WorkspaceRole.member


class MemberUpdate(BaseModel):
    role: WorkspaceRole


Email = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)]


class PersonCreate(BaseModel):
    """Add someone to the workspace directly, with their profile. They sign in later with this email."""

    email: Email
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]] = None
    role: WorkspaceRole = WorkspaceRole.member
    designation: Optional[ShortText] = None
    department: Optional[ShortText] = None
    manager_id: Optional[str] = None
    phone: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    employee_code: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    date_of_joining: Optional[date] = None
    location: Optional[ShortText] = None
    date_of_birth: Optional[date] = None
    marriage_anniversary: Optional[date] = None
    takes_interviews: bool = False
    team_ids: List[uuid.UUID] = Field(default_factory=list)
    send_invite: bool = False
    # Create the joiner checklist tasks (induction, learning, reviews, HR reminders) straight away.
    start_joiner_checklist: bool = False


class PersonUpdate(BaseModel):
    """Only fields present are changed; null clears a profile field or the manager."""

    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]] = None
    email: Optional[Email] = None
    role: Optional[WorkspaceRole] = None
    designation: Optional[ShortText] = None
    department: Optional[ShortText] = None
    manager_id: Optional[str] = None
    phone: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    employee_code: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    date_of_joining: Optional[date] = None
    location: Optional[ShortText] = None
    date_of_birth: Optional[date] = None
    marriage_anniversary: Optional[date] = None
    takes_interviews: Optional[bool] = None
    team_ids: Optional[List[uuid.UUID]] = None


class PersonOut(BaseModel):
    user: UserOut
    role: WorkspaceRole
    joined_at: datetime
    pending: bool  # added or invited, hasn't signed in yet
    designation: Optional[str] = None
    department: Optional[str] = None
    manager_id: Optional[str] = None
    phone: Optional[str] = None
    employee_code: Optional[str] = None
    date_of_joining: Optional[date] = None
    location: Optional[str] = None
    date_of_birth: Optional[date] = None
    marriage_anniversary: Optional[date] = None
    takes_interviews: bool = False
    team_ids: List[uuid.UUID] = Field(default_factory=list)
    direct_reports: int = 0
    invite_sent_at: Optional[datetime] = None
    deactivated_at: Optional[datetime] = None
    joiner_tasks: int = 0  # tasks the joiner checklist made for them


class PersonAdded(BaseModel):
    person: PersonOut
    emailed: bool = False
    email_problem: Optional[str] = None
    link: str


class InviteIn(BaseModel):
    emails: List[Email] = Field(min_length=1, max_length=50)
    role: WorkspaceRole = WorkspaceRole.member
    team_ids: List[uuid.UUID] = Field(default_factory=list)
    message: Optional[str] = Field(default=None, max_length=2000)


class InviteResult(BaseModel):
    people: List["PersonOut"]
    emailed: bool
    email_problem: Optional[str] = None
    problems: List[str] = Field(default_factory=list)
    link: str


class MemberOut(BaseModel):
    user: UserOut
    role: WorkspaceRole
    joined_at: datetime
    deactivated: bool = False


# --- people administration ------------------------------------------------------------------


class PersonImportRow(BaseModel):
    """One person from a spreadsheet. Manager and teams are given by email and name, as people write them."""

    email: Email
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]] = None
    role: Optional[str] = None
    designation: Optional[ShortText] = None
    department: Optional[ShortText] = None
    manager_email: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=320)]] = None
    teams: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]] = None
    phone: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    employee_code: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    date_of_joining: Optional[date] = None
    date_of_birth: Optional[date] = None
    marriage_anniversary: Optional[date] = None
    location: Optional[ShortText] = None


class PersonImportIn(BaseModel):
    rows: List[PersonImportRow] = Field(min_length=1, max_length=1000)
    dry_run: bool = False
    send_invites: bool = False
    start_joiner_checklist: bool = False
    # Existing people in the file: update their profile, or leave them as they are.
    update_existing: bool = True


class PersonImportRowResult(BaseModel):
    row: int  # 1-based, as in the spreadsheet (after the header)
    email: str
    outcome: Literal["added", "updated", "unchanged", "error"]
    problems: List[str] = Field(default_factory=list)


class PersonImportResult(BaseModel):
    dry_run: bool
    added: int
    updated: int
    errors: int
    rows: List[PersonImportRowResult]
    email_problem: Optional[str] = None


class OffboardPreview(BaseModel):
    person: UserOut
    hand_over_to: Optional[UserOut]  # the default: their reporting manager
    open_tasks: int
    direct_reports: int
    teams: int
    joiner_tasks_kept: List[str]
    joiner_tasks_deleted: List[str]


class OffboardIn(BaseModel):
    hand_over_to: Optional[str] = None  # who gets their open tasks; default their manager; null with keep_tasks
    keep_tasks: bool = False  # leave open tasks assigned (no hand-over)
    apply_leaver_rules: bool = True  # SOP: keep birthday task as "Ex – Name", delete their other joiner tasks


class OffboardResult(BaseModel):
    tasks_handed_over: int
    joiner_tasks_kept: int
    joiner_tasks_deleted: int
    direct_reports_moved: int


class TransferOwnershipIn(BaseModel):
    user_id: str


class SignInRules(BaseModel):
    allowed_email_domains: List[Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^@?[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")]] = Field(default_factory=list, max_length=20)
    allow_outside_guests: bool = True
    require_google_sign_in: bool = False
    require_two_step: bool = False


class EmailStatus(BaseModel):
    configured: bool
    host: Optional[str] = None
    sender: Optional[str] = None


class JoinerStep(BaseModel):
    key: str
    name: str
    outcome: Literal["created", "exists", "would_create", "skipped", "problem"]
    reason: Optional[str] = None
    task_id: Optional[uuid.UUID] = None
    list_name: Optional[str] = None
    due_date: Optional[datetime] = None


class AuditEventOut(BaseModel):
    id: uuid.UUID
    action: str
    verb: str
    actor: Optional[UserOut]
    target_kind: Optional[str]
    target_id: Optional[str]
    target_label: Optional[str]
    data: Dict[str, Any]
    created_at: datetime


# --- locations ---------------------------------------------------------------


class LocationCreate(BaseModel):
    name: Name
    color: Optional[HexColor] = None
    is_private: bool = False


class LocationUpdate(BaseModel):
    name: Optional[Name] = None
    color: Optional[HexColor] = None
    is_private: Optional[bool] = None
    orderindex: Optional[float] = None
    archived: Optional[bool] = None


class SpaceCreate(LocationCreate):
    description: Optional[str] = Field(default=None, max_length=5000)
    icon: Optional[str] = Field(default=None, max_length=64)


TaskPrefix = Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=10, pattern=r"^[A-Za-z0-9]+$")]


ClickAppName = Literal[
    "priorities", "tags", "time_tracking", "time_estimates", "custom_task_ids", "multiple_assignees",
    "sprint_points", "multiple_lists", "email_to_list", "custom_fields",
]


class SpaceUpdate(LocationUpdate):
    description: Optional[str] = Field(default=None, max_length=5000)
    icon: Optional[str] = Field(default=None, max_length=64)
    task_prefix: Optional[TaskPrefix] = None
    clickapps: Optional[Dict[ClickAppName, bool]] = None
    discoverable: Optional[bool] = None


class FolderCreate(LocationCreate):
    pass


class FolderUpdate(LocationUpdate):
    pass


class ListCreate(LocationCreate):
    description: Optional[str] = Field(default=None, max_length=5000)
    # Hand it over as it is made: the assignees get full access, so it appears in their sidebar.
    assignees: List[str] = Field(default_factory=list, max_length=20)
    # Only those people (and whoever assigned it) can see it.
    private: bool = False


class ListUpdate(LocationUpdate):
    description: Optional[str] = Field(default=None, max_length=5000)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None

    @field_validator("start_date", "due_date")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)


class TeamRef(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]


class LocationOut(BaseModel):
    id: uuid.UUID
    # Set when this belongs to a Team: only that Team and the admins see it.
    team: Optional["TeamRef"] = None
    name: str
    color: Optional[str]
    is_private: bool
    orderindex: float
    archived: bool
    created_by: Optional[str]
    created_at: datetime
    permission_level: PermissionLevel


class SpaceOut(LocationOut):
    workspace_id: uuid.UUID
    description: Optional[str]
    icon: Optional[str]
    task_prefix: Optional[str] = None
    clickapps: Dict[str, bool] = Field(default_factory=dict)
    discoverable: bool = False


class FolderOut(LocationOut):
    space_id: uuid.UUID
    parent_folder_id: Optional[uuid.UUID]
    override_statuses: bool
    sprint_settings: Optional[Dict[str, Any]] = None


class ListOut(LocationOut):
    space_id: uuid.UUID
    folder_id: Optional[uuid.UUID]
    description: Optional[str]
    override_statuses: bool
    # The first person it was handed to; `assignees` is everyone it belongs to.
    assignee_id: Optional[str] = None
    assignees: List[UserOut] = Field(default_factory=list)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    sprint_completed_at: Optional[datetime] = None


# --- hierarchy tree ----------------------------------------------------------


class ListNode(BaseModel):
    id: uuid.UUID
    name: str
    team: Optional["TeamRef"] = None
    color: Optional[str]
    is_private: bool
    archived: bool
    orderindex: float
    permission_level: PermissionLevel
    open_task_count: int
    assignee_id: Optional[str] = None
    assignee_ids: List[str] = Field(default_factory=list)
    start_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    description: Optional[str] = None
    sprint_completed_at: Optional[datetime] = None


class FolderNode(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]
    is_private: bool
    archived: bool
    orderindex: float
    permission_level: PermissionLevel
    is_sprint: bool = False
    folders: List["FolderNode"] = []
    lists: List[ListNode] = []


FolderNode.model_rebuild()


class SpaceNode(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]
    icon: Optional[str]
    is_private: bool
    archived: bool
    orderindex: float
    permission_level: PermissionLevel
    hidden: bool = False  # left by the caller: kept out of their sidebar
    clickapps: Dict[str, bool] = Field(default_factory=dict)
    folders: List[FolderNode] = []
    lists: List[ListNode] = []


class SharedTaskRef(BaseModel):
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    permission_level: PermissionLevel


class SharedWithMe(BaseModel):
    """Items reachable only through a share, because an ancestor is closed to the caller."""

    folders: List[FolderNode] = []
    lists: List[ListNode] = []
    tasks: List[SharedTaskRef] = []


class SidebarSectionOut(BaseModel):
    id: uuid.UUID
    name: str
    orderindex: float
    space_ids: List[uuid.UUID]
    collapsed: bool


class HierarchyOut(BaseModel):
    workspace_id: uuid.UUID
    role: WorkspaceRole
    spaces: List[SpaceNode]
    shared_with_me: SharedWithMe
    personal_list: Optional[ListNode] = None
    sections: List[SidebarSectionOut] = []


# --- statuses ----------------------------------------------------------------


class StatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    color: str
    group: StatusGroup
    orderindex: int


class StatusIn(BaseModel):
    id: Optional[uuid.UUID] = None
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    color: HexColor
    group: StatusGroup


class StatusSetUpdate(BaseModel):
    """Either `inherit: true` (Folder/List only), or a full replacement `statuses` list."""

    inherit: bool = False
    statuses: Optional[List[StatusIn]] = None
    mapping: Dict[uuid.UUID, uuid.UUID] = Field(
        default_factory=dict,
        description="Old status id -> new status id, for tasks whose status is removed",
    )

    @model_validator(mode="after")
    def _one_mode(self):
        if self.inherit == (self.statuses is not None):
            raise ValueError("Send either inherit=true or a statuses list, not both")
        return self


class StatusSource(BaseModel):
    kind: LocationKind
    id: uuid.UUID


class StatusSetOut(BaseModel):
    source: StatusSource
    inherited: bool
    statuses: List[StatusOut]


# --- shares ------------------------------------------------------------------


class ShareCreate(BaseModel):
    """Share with one person (user_id) or one Team (team_id)."""

    user_id: Optional[str] = None
    team_id: Optional[uuid.UUID] = None
    level: PermissionLevel

    @model_validator(mode="after")
    def _one_grantee(self):
        if (self.user_id is None) == (self.team_id is None):
            raise ValueError("Send exactly one of user_id or team_id")
        return self


class ShareOut(BaseModel):
    id: uuid.UUID
    user: Optional[UserOut]
    team: Optional[TeamRef]
    level: PermissionLevel
    granted_by: Optional[str]
    created_at: datetime


class SharingOut(BaseModel):
    """Who can reach an item: its privacy, the caller's own level, and explicit shares."""

    is_private: bool
    your_level: PermissionLevel
    shares: List[ShareOut]


# --- teams -------------------------------------------------------------------

TeamName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]


class TeamLocation(BaseModel):
    kind: Literal["space", "folder", "list"]
    id: uuid.UUID


TeamHandle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]*$")]


class TeamCreate(BaseModel):
    name: TeamName
    color: Optional[HexColor] = None
    member_ids: List[str] = Field(default_factory=list)
    lead_ids: List[str] = Field(default_factory=list)
    description: Optional[str] = Field(default=None, max_length=5000)
    handle: Optional[TeamHandle] = None
    icon: Optional[Annotated[str, StringConstraints(max_length=32)]] = None
    parent_team_id: Optional[uuid.UUID] = None


class TeamUpdate(BaseModel):
    name: Optional[TeamName] = None
    color: Optional[HexColor] = None
    description: Optional[str] = Field(default=None, max_length=5000)
    icon: Optional[Annotated[str, StringConstraints(max_length=32)]] = None
    locations: Optional[List[TeamLocation]] = Field(default=None, max_length=50)
    parent_team_id: Optional[uuid.UUID] = None  # null: a top-level Team


class TeamMembersSet(BaseModel):
    user_ids: List[str]
    # Leads must also be members. Leaving it out keeps the current leads who stay members.
    lead_ids: Optional[List[str]] = None


class TeamOut(BaseModel):
    id: uuid.UUID
    name: str
    color: Optional[str]
    members: List[UserOut]
    lead_ids: List[str] = Field(default_factory=list)
    description: Optional[str] = None
    handle: Optional[str] = None
    icon: Optional[str] = None
    locations: List[TeamLocation] = Field(default_factory=list)
    parent_team_id: Optional[uuid.UUID] = None
    # Everyone in its sub-teams too (they count as members of this Team).
    all_member_ids: List[str] = Field(default_factory=list)


# --- tasks -------------------------------------------------------------------


class TagOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    fg_color: str
    bg_color: str


class Recurrence(BaseModel):
    """How a task repeats.

    frequency + interval give "every N days/weeks/months/years"; weekly can pick weekdays
    (0 = Monday), monthly a day of the month (clamped to the month's last day).
    trigger: create the next one when this one is done, or on schedule when it falls due.
    action (on_done only): make a new task, or reopen this one with the next dates.
    Stops after `until` or once `count` more occurrences have been made.
    """

    frequency: Literal["daily", "weekly", "monthly", "yearly"]
    interval: int = Field(default=1, ge=1, le=365)
    weekdays: Optional[List[Annotated[int, Field(ge=0, le=6)]]] = Field(default=None, max_length=7)
    month_day: Optional[int] = Field(default=None, ge=1, le=31)
    trigger: Literal["on_done", "on_schedule"] = "on_done"
    action: Literal["new_task", "reopen"] = "new_task"
    until: Optional[date] = None
    count: Optional[int] = Field(default=None, ge=0, le=1000)
    tz: str = "UTC"

    @model_validator(mode="after")
    def _consistent(self):
        if self.trigger == "on_schedule" and self.action == "reopen":
            raise ValueError("Tasks created on a schedule are always new tasks")
        if self.weekdays is not None:
            self.weekdays = sorted(set(self.weekdays))
            if self.frequency != "weekly" or not self.weekdays:
                raise ValueError("Weekdays only apply to weekly repeats, and need at least one day")
        if self.month_day is not None and self.frequency != "monthly":
            raise ValueError("A day of the month only applies to monthly repeats")
        return self


class TaskGroupRef(BaseModel):
    id: uuid.UUID
    name: str
    color: str


class TaskGroupOut(TaskGroupRef):
    location: LocationKind
    location_id: uuid.UUID
    orderindex: float


class TaskGroupIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
    color: Optional[HexColor] = None
    orderindex: Optional[float] = None


class MoveTarget(BaseModel):
    """Where to move a List or Folder: a Space, or a Folder (for a List) / top-level Folder (for a Folder)."""

    space_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def _one(self):
        if (self.space_id is None) == (self.folder_id is None):
            raise ValueError("Give exactly one of space_id or folder_id")
        return self


class CopyParts(BaseModel):
    """What a duplicated task carries over. Everything on by default, as ClickUp does it.

    Two are off: a checked checklist item is somebody else's finished work, and comments are a
    conversation that happened once -- copying either makes the new task lie about its history.
    """

    assignees: bool = True
    followers: bool = True
    attachments: bool = True
    checklists: bool = True
    keep_checked_items: bool = False
    comments: bool = False
    custom_fields: bool = True
    dates: bool = True
    keep_status: bool = True
    tags: bool = True
    task_type: bool = True
    recurrence: bool = True
    relationships: bool = True
    subtasks: bool = True


class DuplicateIn(BaseModel):
    name: Optional[Name] = None
    include_tasks: bool = True  # Lists and Folders
    include_subtasks: bool = True  # tasks
    list_id: Optional[uuid.UUID] = None  # tasks: copy into another List (default: the same one)
    # Spaces, Folders and Lists: where the copy goes. A List can go into any Space or any Folder,
    # a Folder into any Space. Leaving both out puts it beside the original, as it used to.
    space_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    # Archived tasks are finished work someone chose to put away; a copy meant to be done again
    # should not arrive carrying them.
    include_archived: bool = False
    # The location's own furniture, as against the tasks inside it.
    statuses: bool = True
    views: bool = True
    automations: bool = True
    # Who the copy is for. Empty means what a Space, Folder or List normally means: everyone in
    # the workspace who can reach it. Naming people makes the copy private and hands it to just
    # them, which is the only way to duplicate something for one person without also showing it
    # to the other sixty.
    share_with: List[str] = Field(default_factory=list, max_length=100)
    share_level: PermissionLevel = PermissionLevel.edit
    # Tasks: which pieces come along. Absent means the old behaviour, so existing callers are safe.
    parts: Optional[CopyParts] = None
    # Tasks: a copy each, in these people's Personal Lists. Sharing one task instead is
    # /tasks/{id}/shared-with -- a copy drifts, a share does not.
    user_ids: List[str] = Field(default_factory=list, max_length=100)


class GiveToTeam(BaseModel):
    """Hand a Space, Folder or List to a Team. None gives it back to the whole workspace."""

    team_id: Optional[uuid.UUID] = None


class ListAssign(BaseModel):
    """Hand a List to one or more people. An empty list (or None) takes it back."""

    # One person, the older way of saying it; `user_ids` wins when both are given.
    user_id: Optional[str] = None
    user_ids: Optional[List[str]] = Field(default=None, max_length=20)
    # Make the List private so only those people (and whoever assigned it) can see it.
    private: bool = True


Points = Annotated[float, Field(ge=0, le=1000)]


class PersonLoadRow(BaseModel):
    user_id: str
    planned_per_day: List[int]
    capacity_per_day: List[int]
    planned_total: int
    capacity_total: int


class PeopleLoad(BaseModel):
    """How full some people's days already are, counting only work the viewer can open."""

    days: List[str]
    rows: List[PersonLoadRow]


class TaskDefaults(BaseModel):
    """What a new task in this List should open pre-filled with, worked out from its history."""

    time_estimate_seconds: Optional[int] = None
    estimate_basis: Optional[Literal["similar", "list"]] = None
    estimate_from: int = 0          # how many past tasks the estimate was taken from
    priority: Optional[int] = None
    assignees: List[str] = Field(default_factory=list)
    days_to_due: int = 2


class TaskCreate(_DatesMixin):
    name: TaskName
    description: Optional[str] = Field(default=None, max_length=200_000)
    status_id: Optional[uuid.UUID] = None
    priority: Optional[Priority] = None
    time_estimate_seconds: Optional[EstimateSeconds] = None
    assignees: List[str] = Field(default_factory=list, max_length=100)
    tags: List[TagName] = Field(default_factory=list, max_length=40)
    parent_id: Optional[uuid.UUID] = None
    is_private: bool = False
    group_id: Optional[uuid.UUID] = None
    recurrence: Optional[Recurrence] = None
    type_id: Optional[uuid.UUID] = None
    points: Optional[Points] = None
    # The Space's own fields, by field id. Set with the task rather than after it, so a task is
    # never briefly missing the things this firm actually files work by.
    custom_fields: Dict[uuid.UUID, Any] = Field(default_factory=dict)


class TaskUpdate(_DatesMixin):
    """Only fields present in the request body are changed; an explicit null clears a field."""

    name: Optional[TaskName] = None
    description: Optional[str] = Field(default=None, max_length=200_000)
    status_id: Optional[uuid.UUID] = None
    priority: Optional[Priority] = None
    time_estimate_seconds: Optional[EstimateSeconds] = None
    assignees: Optional[List[str]] = Field(default=None, max_length=100)
    tags: Optional[List[TagName]] = Field(default=None, max_length=40)
    parent_id: Optional[uuid.UUID] = None
    is_private: Optional[bool] = None
    orderindex: Optional[float] = None
    archived: Optional[bool] = None
    group_id: Optional[uuid.UUID] = None
    recurrence: Optional[Recurrence] = None
    type_id: Optional[uuid.UUID] = None
    points: Optional[Points] = None


class TaskMove(BaseModel):
    list_id: uuid.UUID
    status_mapping: Dict[uuid.UUID, uuid.UUID] = Field(default_factory=dict)


FieldTypeName = Literal[
    "text", "long_text", "number", "money", "dropdown", "labels", "date", "checkbox",
    "email", "phone", "url", "rating", "progress", "people", "location",
]


class CustomFieldIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    type: FieldTypeName
    config: Dict[str, Any] = Field(default_factory=dict)


class CustomFieldUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = None
    config: Optional[Dict[str, Any]] = None
    orderindex: Optional[float] = None


class CustomFieldOut(BaseModel):
    id: uuid.UUID
    name: str
    type: FieldTypeName
    config: Dict[str, Any]
    location: LocationKind
    location_id: uuid.UUID
    orderindex: float


class FieldValueIn(BaseModel):
    """null (or an empty value) clears the field."""

    value: Any = None


class FieldValueOut(BaseModel):
    field_id: uuid.UUID
    value: Any


class ImportRow(BaseModel):
    """One spreadsheet row, as text; the server works out the types."""

    name: str = Field(default="", max_length=2000)
    description: Optional[str] = Field(default=None, max_length=200_000)
    status: Optional[str] = Field(default=None, max_length=200)
    priority: Optional[str] = Field(default=None, max_length=50)
    assignees: Optional[str] = Field(default=None, max_length=2000, description="Emails or names, comma-separated")
    start_date: Optional[str] = Field(default=None, max_length=50)
    due_date: Optional[str] = Field(default=None, max_length=50)
    tags: Optional[str] = Field(default=None, max_length=2000)
    time_estimate: Optional[str] = Field(default=None, max_length=50)
    fields: Dict[str, str] = Field(default_factory=dict, description="custom field id -> text")


class ImportIn(BaseModel):
    rows: List[ImportRow] = Field(min_length=1, max_length=5000)
    tz_offset: int = Field(0, description="The browser's getTimezoneOffset(), in minutes")


class ImportIssue(BaseModel):
    row: int
    message: str


class ImportResult(BaseModel):
    created: int
    task_ids: List[uuid.UUID]
    errors: List[ImportIssue]
    warnings: List[ImportIssue]


class TemplateSave(BaseModel):
    """What to keep when saving a task, List or Folder as a template."""

    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = None
    description: Optional[str] = Field(default=None, max_length=5000)
    is_private: bool = False
    include_tasks: bool = True  # Lists and Folders
    include_subtasks: bool = True
    include_checklists: bool = True
    include_fields: bool = True  # custom field values
    include_dates: bool = True  # start/due dates (remapped) and repeat rules
    include_assignees: bool = False


class TemplateUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = None
    description: Optional[str] = Field(default=None, max_length=5000)
    is_private: Optional[bool] = None


class TemplateOut(BaseModel):
    id: uuid.UUID
    kind: Literal["task", "list", "folder", "space"]
    name: str
    description: Optional[str]
    is_private: bool
    created_by: Optional[str]
    created_at: datetime
    use_count: int
    task_count: int
    list_count: int
    field_count: int


class TemplateApply(BaseModel):
    """Where to create from a template: a List for a task, a Space or Folder for a List, a Space for a Folder."""

    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]] = None
    list_id: Optional[uuid.UUID] = None
    space_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None


class TemplateApplied(BaseModel):
    kind: Literal["task", "list", "folder", "space"]
    id: uuid.UUID
    list_id: Optional[uuid.UUID] = None


class BulkEdit(_DatesMixin):
    """One change applied to many tasks. Only fields present are changed; null clears
    priority, dates or group. Status is by name, since Lists can have different statuses."""

    task_ids: List[uuid.UUID] = Field(min_length=1, max_length=500)
    status: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]] = None
    priority: Optional[Priority] = None
    # Estimates are required on new work, so a batch of older tasks often needs sizing in one go.
    time_estimate_seconds: Optional[EstimateSeconds] = None
    group_id: Optional[uuid.UUID] = None
    # The whole point of a type is that a lot of tasks share one, so it is set a lot at a time.
    type_id: Optional[uuid.UUID] = None
    archived: Optional[bool] = None
    add_assignees: List[str] = Field(default_factory=list, max_length=100)
    remove_assignees: List[str] = Field(default_factory=list, max_length=100)
    add_tags: List[TagName] = Field(default_factory=list, max_length=40)
    remove_tags: List[TagName] = Field(default_factory=list, max_length=40)
    list_id: Optional[uuid.UUID] = None  # move
    delete: bool = False


class BulkSkip(BaseModel):
    id: uuid.UUID
    name: str
    reason: str


class BulkResult(BaseModel):
    updated: List[uuid.UUID]
    skipped: List[BulkSkip]


class LocationRef(BaseModel):
    id: uuid.UUID
    name: str


class TaskLocation(BaseModel):
    space: LocationRef
    folder: Optional[LocationRef]
    list: LocationRef


class TaskOut(BaseModel):
    id: uuid.UUID
    list_id: uuid.UUID
    parent_id: Optional[uuid.UUID]
    top_level_parent_id: Optional[uuid.UUID]
    name: str
    description: Optional[str]
    status: StatusOut
    priority: Optional[int]
    start_date: Optional[datetime]
    due_date: Optional[datetime]
    time_estimate_seconds: Optional[int]
    time_tracked_seconds: int
    is_private: bool
    orderindex: float
    created_by: Optional[str]
    created_at: datetime
    updated_at: datetime
    date_done: Optional[datetime]
    date_closed: Optional[datetime]
    archived: bool
    is_overdue: bool
    group: Optional[TaskGroupRef] = None
    recurrence: Optional[Recurrence] = None
    recurs_from_id: Optional[uuid.UUID] = None
    custom_id: Optional[str] = Field(default=None, description='Short ID such as "HR-12"')
    type_id: Optional[uuid.UUID] = None
    waiting_on_open: int = Field(default=0, description="Unfinished tasks this one is waiting on")
    blocking_count: int = 0
    link_count: int = 0
    comment_count: int = 0
    attachment_count: int = 0
    checklist_done: int = 0
    checklist_total: int = 0
    custom_fields: Dict[str, Any] = Field(default_factory=dict, description="field id -> value")
    assignees: List[UserOut]
    tags: List[TagOut]
    subtask_count: int
    permission_level: PermissionLevel
    points: Optional[float] = None
    extra_list_ids: List[uuid.UUID] = Field(default_factory=list, description="Other Lists this task also appears in")


class TaskDetailOut(TaskOut):
    location: TaskLocation
    fields: List["CustomFieldOut"] = Field(default_factory=list, description="Custom fields this task's List can use")


class TaskPage(BaseModel):
    tasks: List[TaskOut]
    total: int
    limit: int
    offset: int


# --- views -------------------------------------------------------------------


class ViewCreate(BaseModel):
    type: ViewType
    name: Optional[Name] = None
    private: bool = False  # only you see it


class ViewUpdate(BaseModel):
    name: Optional[Name] = None
    orderindex: Optional[float] = None
    settings: Optional[Dict[str, Any]] = None
    private: Optional[bool] = None
    protected: Optional[bool] = None
    is_default: Optional[bool] = None


class ViewOut(BaseModel):
    id: uuid.UUID
    type: ViewType
    name: str
    orderindex: float
    is_required: bool
    settings: Dict[str, Any]
    private: bool = False
    protected: bool = False
    is_default: bool = False
    created_by: Optional[str] = None


class DependencyOut(BaseModel):
    blocker_id: uuid.UUID
    waiting_id: uuid.UUID


class LocationActivity(BaseModel):
    id: uuid.UUID
    kind: str
    data: Dict[str, Any]
    created_at: datetime
    user: Optional[UserOut]
    comment: Optional[str]
    task_id: uuid.UUID
    task_name: str
    list_id: uuid.UUID


class FormFieldOut(BaseModel):
    key: str
    label: str
    required: bool
    help: Optional[str] = None
    type: str
    field: Optional["CustomFieldOut"] = None


class FormOut(BaseModel):
    view_id: uuid.UUID
    list_id: uuid.UUID
    list_name: str
    title: str
    description: Optional[str]
    active: bool
    fields: List[FormFieldOut]
    success: str


class FormSubmit(BaseModel):
    answers: Dict[str, Any] = Field(default_factory=dict)


class FormSubmitted(BaseModel):
    task_id: uuid.UUID
    message: str


class LinkIn(BaseModel):
    other_id: uuid.UUID
    kind: Literal["waiting_on", "blocking", "relates"]


class LinkedTask(BaseModel):
    link_id: uuid.UUID
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    status: StatusOut
    due_date: Optional[datetime]
    finished: bool


class TaskLinks(BaseModel):
    waiting_on: List[LinkedTask]
    blocking: List[LinkedTask]
    linked: List[LinkedTask]


class MergeIn(BaseModel):
    source_ids: List[uuid.UUID] = Field(min_length=1, max_length=20)


class TaskTypeIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    name_plural: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    icon: Annotated[str, StringConstraints(max_length=32)] = "circle"
    color: HexColor = "#6366f1"
    description: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None
    is_milestone: bool = False


class TaskTypeUpdate(BaseModel):
    name: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]] = None
    name_plural: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=40)]] = None
    description: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]] = None
    icon: Optional[Annotated[str, StringConstraints(max_length=32)]] = None
    color: Optional[HexColor] = None
    is_milestone: Optional[bool] = None
    orderindex: Optional[float] = None


class TaskTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    name_plural: Optional[str]
    icon: str
    color: str
    description: Optional[str] = None
    is_milestone: bool
    orderindex: float
    # How many tasks wear it. A type nobody uses is one to retire, and a type on 400 tasks is one
    # to think twice about renaming.
    task_count: int = 0


FavoriteKind = Literal["space", "folder", "list", "task", "dashboard", "view", "goal"]


class FavoriteIn(BaseModel):
    kind: FavoriteKind
    target_id: uuid.UUID


class FavoriteOut(BaseModel):
    id: uuid.UUID
    kind: FavoriteKind
    target_id: uuid.UUID
    name: str
    # Where it opens: a location for locations and views, the List for a task.
    list_id: Optional[uuid.UUID] = None
    location_kind: Optional[LocationKind] = None
    location_id: Optional[uuid.UUID] = None
    orderindex: float


class TagIn(BaseModel):
    name: TagName
    bg_color: Optional[HexColor] = None
    fg_color: Optional[HexColor] = None


class TagUpdate(BaseModel):
    name: Optional[TagName] = None
    bg_color: Optional[HexColor] = None
    fg_color: Optional[HexColor] = None


class TagUsage(BaseModel):
    id: uuid.UUID
    name: str
    bg_color: str
    fg_color: str
    task_count: int


# --- dashboard ---------------------------------------------------------------


class TaskSummary(BaseModel):
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    due_date: Optional[datetime]
    status: StatusOut


class TaskBucket(BaseModel):
    """A count plus the first few offending tasks, so every number can be opened."""

    count: int
    tasks: List[TaskSummary]


class StatusCount(BaseModel):
    name: str
    color: str
    group: StatusGroup
    count: int


class AssigneeCount(BaseModel):
    user: Optional[UserOut]  # None = unassigned
    count: int


class DashboardOut(BaseModel):
    total_open: int
    done_today: TaskBucket
    overdue: TaskBucket
    unassigned: TaskBucket
    no_estimate: TaskBucket
    unscheduled: TaskBucket
    by_status: List[StatusCount]
    by_assignee: List[AssigneeCount]


# --- workload ----------------------------------------------------------------


class WorkloadTask(BaseModel):
    id: uuid.UUID
    name: str
    list_id: uuid.UUID
    status: StatusOut
    # Carried so the Workload view can be filtered by it without a second read.
    priority: Optional[int] = None
    seconds_per_day: List[int]  # aligned with WorkloadOut.days


class WorkloadRow(BaseModel):
    user: Optional[UserOut]  # None = unassigned work
    capacity_seconds: List[int]
    scheduled_seconds: List[int]
    tasks: List[WorkloadTask]


class WorkloadOut(BaseModel):
    days: List[str]  # ISO dates, one per column
    rows: List[WorkloadRow]
    unscheduled: List[TaskSummary]  # open tasks with no start or due date
    no_estimate: List[TaskSummary]  # scheduled open tasks without a time estimate


# --- time tracking -----------------------------------------------------------

MAX_ENTRY_SECONDS = 24 * 3600  # a single entry is at most a day, as a sanity bound


class TimeEntryCreate(BaseModel):
    """Log time manually: a duration (ending now, or at started_at + duration), or a start and end."""

    duration_seconds: Optional[Annotated[int, Field(ge=1, le=MAX_ENTRY_SECONDS)]] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    billable: bool = False
    user_id: Optional[str] = Field(default=None, description="Log time for someone else (owners and admins)")
    tag_ids: List[uuid.UUID] = Field(default_factory=list, max_length=20)

    @field_validator("started_at", "ended_at")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)

    @model_validator(mode="after")
    def _shape(self):
        if self.duration_seconds is None and (self.started_at is None or self.ended_at is None):
            raise ValueError("Send duration_seconds, or both started_at and ended_at")
        if self.started_at and self.ended_at:
            if self.ended_at <= self.started_at:
                raise ValueError("ended_at must be after started_at")
            if (self.ended_at - self.started_at).total_seconds() > MAX_ENTRY_SECONDS:
                raise ValueError("A single time entry can be at most 24 hours")
        return self


class TimeEntryUpdate(BaseModel):
    duration_seconds: Optional[Annotated[int, Field(ge=1, le=MAX_ENTRY_SECONDS)]] = None
    # Move the entry: a new start (the duration is kept unless ended_at is also given).
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    description: Optional[str] = Field(default=None, max_length=2000)
    billable: Optional[bool] = None
    task_id: Optional[uuid.UUID] = Field(default=None, description="Move the entry to another task")
    tag_ids: Optional[List[uuid.UUID]] = Field(default=None, max_length=20)

    @field_validator("started_at", "ended_at")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)


class TimeTagRef(BaseModel):
    id: uuid.UUID
    name: str
    bg_color: str
    fg_color: str


class TimeEntryOut(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    user: UserOut
    started_at: datetime
    ended_at: Optional[datetime]
    duration_seconds: Optional[int]
    running: bool
    description: Optional[str]
    billable: bool
    tags: List["TimeTagRef"] = Field(default_factory=list)


class TaskTimeOut(BaseModel):
    total_seconds: int  # finished entries by everyone
    entries: List[TimeEntryOut]  # yours, or everyone's for owners and admins
    shows_everyone: bool


class RunningTimerOut(BaseModel):
    entry: TimeEntryOut
    task_name: str
    list_id: uuid.UUID


TaskDetailOut.model_rebuild()

FormFieldOut.model_rebuild()
