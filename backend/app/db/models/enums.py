import enum


class WorkspaceRole(str, enum.Enum):
    owner = "owner"
    admin = "admin"
    member = "member"
    guest = "guest"


class PermissionLevel(str, enum.Enum):
    """Per-item access. Ordered: view < comment < edit < full."""

    view = "view"
    comment = "comment"
    edit = "edit"
    full = "full"

    @property
    def rank(self) -> int:
        return _PERMISSION_RANK[self]

    def at_least(self, other: "PermissionLevel") -> bool:
        return self.rank >= other.rank


_PERMISSION_RANK = {
    PermissionLevel.view: 1,
    PermissionLevel.comment: 2,
    PermissionLevel.edit: 3,
    PermissionLevel.full: 4,
}


class StatusGroup(str, enum.Enum):
    """Every status belongs to one group; the group, not the name, drives behaviour."""

    not_started = "not_started"
    active = "active"
    done = "done"  # finished but still open: never overdue
    closed = "closed"  # fully finished; exactly one per status set


class ViewType(str, enum.Enum):
    list = "list"
    board = "board"
    calendar = "calendar"
    dashboard = "dashboard"
    workload = "workload"
    overview = "overview"  # the default view of Spaces and Folders
    table = "table"
    team = "team"  # one card per person: in progress, up next, done
    gantt = "gantt"
    timeline = "timeline"
    activity = "activity"
    form = "form"


class LocationKind(str, enum.Enum):
    space = "space"
    folder = "folder"
    list = "list"
    task = "task"
