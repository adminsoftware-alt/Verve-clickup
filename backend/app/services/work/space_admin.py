"""Spaces beyond the basics: ClickApps, the All Spaces page (join, leave, ask to join a private Space),
personal sidebar sections, and duplicating a whole Space."""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    HiddenSpace,
    PermissionLevel,
    Share,
    SidebarSection,
    Space,
    SpaceJoinRequest,
    TaskList,
    User,
    WorkspaceRole,
)
from app.schemas import spaces as sp
from app.schemas import work as s
from app.services.work import audit, events
from app.services.work.access import Access, Opened, space_node
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import SHARED_ONLY, can_manage_workspace

# ClickApps, as in ClickUp: optional features switched per Space. Missing names mean the default.
CLICKAPPS: Dict[str, bool] = {
    "priorities": True,
    "tags": True,
    "time_tracking": True,
    "time_estimates": True,
    "custom_task_ids": True,
    "multiple_assignees": True,
    "custom_fields": True,
    "multiple_lists": True,
    "email_to_list": True,
    "sprint_points": False,
}
CLICKAPP_LABELS: Dict[str, str] = {
    "priorities": "Priorities",
    "tags": "Tags",
    "time_tracking": "Time tracking",
    "time_estimates": "Time estimates",
    "custom_task_ids": "Custom task IDs",
    "multiple_assignees": "Multiple assignees",
    "custom_fields": "Custom fields",
    "multiple_lists": "Tasks in multiple Lists",
    "email_to_list": "Email to List",
    "sprint_points": "Sprint points",
}


def clickapps(space: Optional[Space]) -> Dict[str, bool]:
    stored = (space.clickapps if space is not None else None) or {}
    return {name: bool(stored.get(name, default)) for name, default in CLICKAPPS.items()}


def enabled(db: Session, space_id: uuid.UUID, name: str) -> bool:
    return clickapps(db.get(Space, space_id))[name]


def require(db: Session, space_id: uuid.UUID, name: str) -> None:
    if not enabled(db, space_id, name):
        raise Invalid(f"{CLICKAPP_LABELS[name]} is turned off for this Space")


def set_clickapps(space: Space, changes: Dict[str, bool]) -> None:
    current = dict(space.clickapps or {})
    current.update({k: bool(v) for k, v in changes.items() if k in CLICKAPPS})
    space.clickapps = current


# --- the All Spaces page -----------------------------------------------------------------------


def _can_approve(access: Access, space: Space) -> bool:
    if can_manage_workspace(access.role) or space.created_by == access.user_id:
        return True
    return access.level([space_node(space)]) == PermissionLevel.full


def browse(db: Session, access: Access) -> List[sp.BrowseSpace]:
    """Every Space the caller can open, plus private Spaces marked "discoverable", which they can ask to join."""
    spaces = list(db.scalars(
        select(Space).where(Space.workspace_id == access.workspace_id, Space.personal_owner_id.is_(None), Space.archived_at.is_(None))
        .order_by(Space.orderindex, Space.name)
    ))
    hidden = set(db.scalars(select(HiddenSpace.space_id).where(HiddenSpace.user_id == access.user_id)))
    mine_pending = set(db.scalars(select(SpaceJoinRequest.space_id).where(
        SpaceJoinRequest.user_id == access.user_id, SpaceJoinRequest.status == "pending")))
    ids = [x.id for x in spaces]
    list_counts = dict(db.execute(
        select(TaskList.space_id, func.count()).where(TaskList.space_id.in_(ids), TaskList.archived_at.is_(None)).group_by(TaskList.space_id)
    ).all()) if ids else {}
    out = []
    for space in spaces:
        level = access.level([space_node(space)])
        if level is None and not (space.is_private and space.discoverable and access.role not in SHARED_ONLY):
            continue
        owner = db.get(User, space.created_by) if space.created_by else None
        out.append(sp.BrowseSpace(
            id=space.id, name=space.name, color=space.color, icon=space.icon, description=space.description,
            is_private=space.is_private, permission_level=level, joined=level is not None and space.id not in hidden,
            requested=space.id in mine_pending, list_count=list_counts.get(space.id, 0),
            owner=s.UserOut.model_validate(owner) if owner else None,
            can_approve=level is not None and _can_approve(access, space),
        ))
    return out


def _space(db: Session, access: Access, space_id: uuid.UUID) -> Space:
    space = db.get(Space, space_id)
    if space is None or space.workspace_id != access.workspace_id or space.personal_owner_id is not None:
        raise NotFound("Space not found")
    return space


def set_joined(db: Session, access: Access, space_id: uuid.UUID, joined: bool) -> None:
    """Join (show in my sidebar) or leave (hide) a Space I can already open."""
    space = _space(db, access, space_id)
    if access.level([space_node(space)]) is None:
        raise Forbidden("This Space is private; ask to join it instead")
    row = db.get(HiddenSpace, (access.user_id, space.id))
    if joined and row is not None:
        db.delete(row)
    elif not joined and row is None:
        db.add(HiddenSpace(user_id=access.user_id, space_id=space.id))
    db.flush()


def request_join(db: Session, access: Access, space_id: uuid.UUID, message: Optional[str]) -> SpaceJoinRequest:
    space = _space(db, access, space_id)
    if access.level([space_node(space)]) is not None:
        raise Invalid("You can already open this Space")
    if not (space.is_private and space.discoverable) or access.role in SHARED_ONLY:
        raise NotFound("Space not found")
    existing = db.scalars(select(SpaceJoinRequest).where(
        SpaceJoinRequest.space_id == space.id, SpaceJoinRequest.user_id == access.user_id, SpaceJoinRequest.status == "pending")).first()
    if existing is not None:
        return existing
    row = SpaceJoinRequest(space_id=space.id, user_id=access.user_id, message=(message or "").strip()[:500] or None)
    db.add(row)
    db.flush()
    approvers = _approvers(db, access, space)
    events.notify(db, access.workspace_id, approvers, access.user_id, "space_join_request", "primary",
                  data={"space_id": str(space.id), "space": space.name, "request_id": str(row.id), "message": row.message})
    return row


def _approvers(db: Session, access: Access, space: Space) -> List[str]:
    from app.db.models import WorkspaceMember

    people = set(db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == access.workspace_id,
        WorkspaceMember.role.in_([WorkspaceRole.owner, WorkspaceRole.admin]),
        WorkspaceMember.deactivated_at.is_(None),
    )))
    if space.created_by:
        people.add(space.created_by)
    people.update(db.scalars(select(Share.user_id).where(Share.space_id == space.id, Share.level == PermissionLevel.full, Share.user_id.isnot(None))))
    return sorted(people)


def join_requests(db: Session, access: Access) -> List[sp.JoinRequestOut]:
    """Pending requests for Spaces the caller can let people into."""
    rows = db.execute(
        select(SpaceJoinRequest, Space, User)
        .join(Space, Space.id == SpaceJoinRequest.space_id)
        .join(User, User.id == SpaceJoinRequest.user_id)
        .where(Space.workspace_id == access.workspace_id, SpaceJoinRequest.status == "pending")
        .order_by(SpaceJoinRequest.created_at)
    ).all()
    return [
        sp.JoinRequestOut(id=r.id, space_id=space.id, space_name=space.name, user=s.UserOut.model_validate(user),
                          message=r.message, created_at=r.created_at)
        for r, space, user in rows if _can_approve(access, space)
    ]


def decide(db: Session, access: Access, request_id: uuid.UUID, approve: bool, level: PermissionLevel) -> SpaceJoinRequest:
    row = db.get(SpaceJoinRequest, request_id)
    if row is None:
        raise NotFound("Request not found")
    space = _space(db, access, row.space_id)
    if not _can_approve(access, space):
        raise Forbidden("Only the Space's owner, someone with full access, or an admin can decide this")
    if row.status != "pending":
        raise Invalid("This request has already been decided")
    row.status = "approved" if approve else "declined"
    row.decided_by, row.decided_at = access.user_id, datetime.now(timezone.utc)
    if approve:
        share = db.scalars(select(Share).where(Share.space_id == space.id, Share.user_id == row.user_id)).first()
        if share is None:
            db.add(Share(space_id=space.id, user_id=row.user_id, level=level, granted_by=access.user_id))
        else:
            share.level = level
        audit.record(db, access.workspace_id, access.user_id, "space.joined", "space", space.id, space.name,
                     {"user_id": row.user_id, "level": level.value})
    db.flush()
    events.notify(db, access.workspace_id, [row.user_id], access.user_id, "space_join_decision", "primary",
                  data={"space_id": str(space.id), "space": space.name, "status": row.status})
    return row


# --- sidebar sections --------------------------------------------------------------------------


def section_out(row: SidebarSection) -> s.SidebarSectionOut:
    ids = []
    for x in row.space_ids or []:
        try:
            ids.append(uuid.UUID(str(x)))
        except ValueError:
            continue
    return s.SidebarSectionOut(id=row.id, name=row.name, orderindex=row.orderindex, space_ids=ids, collapsed=row.collapsed)


def sections(db: Session, access: Access) -> List[s.SidebarSectionOut]:
    rows = db.scalars(select(SidebarSection).where(
        SidebarSection.user_id == access.user_id, SidebarSection.workspace_id == access.workspace_id,
    ).order_by(SidebarSection.orderindex, SidebarSection.name))
    return [section_out(r) for r in rows]


def _own_section(db: Session, access: Access, section_id: uuid.UUID) -> SidebarSection:
    row = db.get(SidebarSection, section_id)
    if row is None or row.user_id != access.user_id or row.workspace_id != access.workspace_id:
        raise NotFound("Section not found")
    return row


def _clean_space_ids(db: Session, access: Access, ids: List[uuid.UUID], keep_out: Optional[uuid.UUID] = None) -> List[str]:
    """A Space sits in at most one section: adding it here takes it out of the others."""
    valid = set(db.scalars(select(Space.id).where(Space.workspace_id == access.workspace_id, Space.id.in_(ids)))) if ids else set()
    wanted = [str(x) for x in dict.fromkeys(ids) if x in valid]
    for other in db.scalars(select(SidebarSection).where(
        SidebarSection.user_id == access.user_id, SidebarSection.workspace_id == access.workspace_id, SidebarSection.id != keep_out,
    )):
        remaining = [x for x in (other.space_ids or []) if x not in wanted]
        if remaining != (other.space_ids or []):
            other.space_ids = remaining
    return wanted


def create_section(db: Session, access: Access, data: sp.SectionIn) -> SidebarSection:
    top = db.scalar(select(func.max(SidebarSection.orderindex)).where(
        SidebarSection.user_id == access.user_id, SidebarSection.workspace_id == access.workspace_id)) or 0.0
    row = SidebarSection(workspace_id=access.workspace_id, user_id=access.user_id, name=data.name, orderindex=top + 1.0,
                         space_ids=_clean_space_ids(db, access, data.space_ids or []))
    db.add(row)
    db.flush()
    return row


def update_section(db: Session, access: Access, section_id: uuid.UUID, data: sp.SectionUpdate) -> SidebarSection:
    row = _own_section(db, access, section_id)
    fields = data.model_fields_set
    if "name" in fields and data.name:
        row.name = data.name
    if "orderindex" in fields and data.orderindex is not None:
        row.orderindex = data.orderindex
    if "collapsed" in fields and data.collapsed is not None:
        row.collapsed = data.collapsed
    if "space_ids" in fields and data.space_ids is not None:
        row.space_ids = _clean_space_ids(db, access, data.space_ids, keep_out=row.id)
    db.flush()
    return row


def delete_section(db: Session, access: Access, section_id: uuid.UUID) -> None:
    db.delete(_own_section(db, access, section_id))
    db.flush()


# --- duplicating a Space -----------------------------------------------------------------------


def duplicate_space(
    db: Session, opened: Opened[Space], name: Optional[str], include_tasks: bool,
    opts: Optional[Any] = None,
) -> Space:
    """A new Space with the same statuses, tags, ClickApps, fields, groups, Folders and Lists (and tasks, if asked).

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


def hidden_ids(db: Session, user_id: str) -> set:
    return set(db.scalars(select(HiddenSpace.space_id).where(HiddenSpace.user_id == user_id)))

