"""ORM models for the v2 work hierarchy. Importing this package registers every table."""

from app.db.models.account import BlockedEmail, User, Workspace, WorkspaceMember
from app.db.models.admin import AuditEvent, PersonTask
from app.db.models.calendar_sync import CalendarConnection, CalendarSyncItem
from app.db.models.collab import (
    CommentReaction,
    Notification,
    NotificationSetting,
    Reminder,
    TaskActivity,
    TaskComment,
    TaskWatcher,
)
from app.db.models.custom_field import CustomField, FieldType, TaskFieldValue
from app.db.models.dashboard import Dashboard, DashboardCard, DashboardComment, DashboardShare, ReportRun, ReportSchedule
from app.db.models.enums import LocationKind, PermissionLevel, StatusGroup, ViewType, WorkspaceRole
from app.db.models.goal import Goal, GoalCheckIn, GoalTarget
from app.db.models.hierarchy import Folder, ListAssignee, Space, TaskList
from app.db.models.notify import AutomationRun, ClientCompliance, ComplianceObligation, ComplianceTask, PushSubscription
from app.db.models.leave import BillingRate, ClientFee, Holiday, ImportedRecord, LeaveRequest, LeaveType
from app.db.models.planning import Automation, CalendarFeed, LineupItem, TimeBlock
from app.db.models.share import Share
from app.db.models.spaces_extra import (
    ChatMessage,
    HiddenSpace,
    InboundEmail,
    PublicLink,
    SidebarSection,
    SpaceJoinRequest,
    TaskListLink,
    ViewContent,
)
from app.db.models.status import Status
from app.db.models.template import Template, TemplateKind
from app.db.models.task_extras import Attachment, Checklist, ChecklistItem, ChecklistTemplate, TaskLink
from app.db.models.task import Favorite, Tag, Task, TaskAssignee, TaskGroup, TaskTag, TaskType
from app.db.models.team import Team, TeamMember
from app.db.models.time_entry import TimeEntry
from app.db.models.timesheet import (
    MemberCapacity,
    TimeEntryTag,
    TimesheetApprover,
    TimesheetComment,
    TimesheetRow,
    TimesheetSettings,
    TimesheetSubmission,
    TimeTag,
)
from app.db.models.view import View

__all__ = [
    "CalendarConnection",
    "CalendarSyncItem",
    "Goal",
    "GoalCheckIn",
    "GoalTarget",
    "ChatMessage",
    "HiddenSpace",
    "InboundEmail",
    "PublicLink",
    "SidebarSection",
    "SpaceJoinRequest",
    "ListAssignee",
    "TaskListLink",
    "ViewContent",
    "AutomationRun",
    "ClientCompliance",
    "ComplianceObligation",
    "ComplianceTask",
    "PushSubscription",
    "BillingRate",
    "ClientFee",
    "Holiday",
    "ImportedRecord",
    "LeaveRequest",
    "LeaveType",
    "AuditEvent",
    "PersonTask",
    "Automation",
    "CalendarFeed",
    "LineupItem",
    "TimeBlock",
    "DashboardComment",
    "TaskLink",
    "Favorite",
    "TaskType",
    "Template",
    "TemplateKind",
    "CustomField",
    "FieldType",
    "TaskFieldValue",
    "Attachment",
    "Checklist",
    "ChecklistItem",
    "CommentReaction",
    "Notification",
    "NotificationSetting",
    "Reminder",
    "TaskActivity",
    "TaskComment",
    "TaskWatcher",
    "Dashboard",
    "DashboardCard",
    "DashboardShare",
    "ReportRun",
    "ReportSchedule",
    "Folder",
    "LocationKind",
    "PermissionLevel",
    "Share",
    "Space",
    "Status",
    "StatusGroup",
    "Tag",
    "Task",
    "TaskAssignee",
    "TaskGroup",
    "TaskList",
    "TaskTag",
    "Team",
    "TeamMember",
    "TimeEntry",
    "TimeEntryTag",
    "TimeTag",
    "MemberCapacity",
    "TimesheetApprover",
    "TimesheetComment",
    "TimesheetRow",
    "TimesheetSettings",
    "TimesheetSubmission",
    "User",
    "View",
    "ViewType",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceRole",
]
