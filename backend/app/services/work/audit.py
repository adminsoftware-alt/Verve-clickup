"""The audit log: who changed people, roles, access and structure, and when. Admins read it."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditEvent, User
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.errors import Forbidden
from app.services.work.permissions import can_manage_workspace

# action -> how it reads in the log ("Priya <label> Ravi")
LABELS = {
    "goal.created": "created the goal",
    "goal.deleted": "deleted the goal",
    "space.joined": "let someone into",
    "space.duplicated": "duplicated",
    "person.added": "added",
    "person.invited": "invited",
    "person.imported": "imported",
    "person.updated": "updated the profile of",
    "person.role_changed": "changed the role of",
    "person.removed": "removed",
    "person.deactivated": "turned off access for",
    "person.reactivated": "turned access back on for",
    "person.offboarded": "offboarded",
    "person.joiner_checklist": "started the joiner checklist for",
    "workspace.ownership_transferred": "transferred ownership to",
    "workspace.sign_in_rules": "changed the sign-in rules",
    "workspace.joiner_plan": "changed the joiner checklist",
    "workspace.review_packs": "created monthly review packs",
    "workspace.renamed": "renamed the workspace",
    "space.created": "created the Space",
    "space.deleted": "deleted the Space",
    "space.archived": "archived the Space",
    "space.restored": "restored the Space",
    "folder.deleted": "deleted the Folder",
    "list.deleted": "deleted the List",
    "share.granted": "shared",
    "share.revoked": "stopped sharing",
    "team.created": "created the Team",
    "team.deleted": "deleted the Team",
    "team.members_changed": "changed the members of",
    "automation.created": "added an Automation on",
    "automation.deleted": "deleted an Automation on",
}


def record(
    db: Session, workspace_id: uuid.UUID, actor_id: Optional[str], action: str,
    target_kind: Optional[str] = None, target_id: Optional[Any] = None, target_label: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    db.add(AuditEvent(
        workspace_id=workspace_id, actor_id=actor_id, action=action, target_kind=target_kind,
        target_id=str(target_id) if target_id is not None else None,
        target_label=(target_label or "")[:300] or None, data=data or {},
    ))
    db.flush()


def person_label(db: Session, user_id: str) -> str:
    user = db.get(User, user_id)
    return (user.display_name or user.email) if user else user_id


def events(
    db: Session, access: Access, limit: int = 100, before: Optional[datetime] = None,
    action: Optional[str] = None, actor_id: Optional[str] = None,
) -> List[s.AuditEventOut]:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can see the audit log")
    query = select(AuditEvent).where(AuditEvent.workspace_id == access.workspace_id)
    if before is not None:
        query = query.where(AuditEvent.created_at < before)
    if action:
        query = query.where(AuditEvent.action.startswith(action))
    if actor_id:
        query = query.where(AuditEvent.actor_id == actor_id)
    rows = list(db.scalars(query.order_by(AuditEvent.created_at.desc()).limit(limit)))
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.actor_id for r in rows if r.actor_id})))}
    return [
        s.AuditEventOut(
            id=r.id, action=r.action, verb=LABELS.get(r.action, r.action), target_kind=r.target_kind, target_id=r.target_id,
            target_label=r.target_label, data=r.data, created_at=r.created_at,
            actor=s.UserOut.model_validate(users[r.actor_id]) if r.actor_id in users else None,
        )
        for r in rows
    ]
