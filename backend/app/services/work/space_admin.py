"""Duplicating a whole Space."""

from typing import Any, Optional

from sqlalchemy.orm import Session

from app.db.models import PermissionLevel, Space
from app.schemas import work as s
from app.services.work import audit
from app.services.work.access import Opened
from app.services.work.errors import Forbidden
from app.services.work.permissions import can_manage_workspace


def duplicate_space(
    db: Session, opened: Opened[Space], name: Optional[str], include_tasks: bool,
    opts: Optional[Any] = None,
) -> Space:
    """A new Space with the same statuses, tags, fields, groups, Folders and Lists (and tasks, if asked).

    `opts` is the rest of what the dialog asked for; leaving it out keeps the old behaviour, so
    anything else that duplicates a Space is unaffected.
    """
    from app.services.work import templates

    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to duplicate this Space")
    # A Space is a part of the firm, and a copy of one is another part of it. Same rule as
    # creating and sharing a Space: admins only.
    if not can_manage_workspace(opened.access.role):
        raise Forbidden("Only admins can duplicate a Space.")
    snapshot = templates.snapshot_space(db, opened.obj, s.TemplateSave(
        include_tasks=include_tasks,
        include_subtasks=getattr(opts, "include_subtasks", True),
        include_assignees=getattr(opts, "assignees", True),
        include_dates=getattr(opts, "dates", True),
        include_checklists=getattr(opts, "checklists", True),
        include_fields=getattr(opts, "custom_fields", True),
    ))
    space = templates.build_space(db, opened.access, snapshot, name or f"{opened.obj.name} (copy)")
    audit.record(db, opened.access.workspace_id, opened.access.user_id, "space.duplicated", "space", space.id, space.name,
                 {"from": opened.obj.name})
    return space
