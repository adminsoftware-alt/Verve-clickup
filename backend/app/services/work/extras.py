"""Checklists and attachments on tasks.

Checklists: editing needs edit access to the task; an item's assignee can tick their own
item with comment access, as in ClickUp's assigned checklist items.
Attachments: anyone who can comment can attach; the uploader or someone with full access
can delete. Files are stored under UPLOAD_DIR and only served to people who can see the task.
"""

import os
import secrets
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Attachment, Checklist, ChecklistItem, PermissionLevel, Task, User, WorkspaceMember
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Opened, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound

BACKEND_DIR = Path(__file__).resolve().parents[3]


def upload_dir() -> Path:
    path = Path(settings.UPLOAD_DIR)
    path = path if path.is_absolute() else BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def _require(opened: Opened[Task], level: PermissionLevel, what: str) -> None:
    if not opened.level.at_least(level):
        raise Forbidden(f"You need {level.value} access to {what}")


# --- checklists ----------------------------------------------------------------------------


def checklists_out(db: Session, task_id: uuid.UUID) -> List[dict]:
    lists = list(db.scalars(select(Checklist).where(Checklist.task_id == task_id).order_by(Checklist.orderindex, Checklist.created_at)))
    items = list(db.scalars(select(ChecklistItem).where(ChecklistItem.checklist_id.in_([c.id for c in lists])).order_by(ChecklistItem.orderindex))) if lists else []
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({i.assignee_id for i in items if i.assignee_id})))}
    by_list: Dict[uuid.UUID, List[dict]] = {}
    for i in items:
        by_list.setdefault(i.checklist_id, []).append({
            "id": str(i.id), "name": i.name, "resolved": i.resolved, "orderindex": i.orderindex,
            "assignee": s.UserOut.model_validate(users[i.assignee_id]).model_dump() if i.assignee_id in users else None,
        })
    return [{"id": str(c.id), "name": c.name, "orderindex": c.orderindex, "items": by_list.get(c.id, [])} for c in lists]


def progress(db: Session, task_ids) -> Dict[uuid.UUID, Tuple[int, int]]:
    """(resolved, total) checklist items per task."""
    if not task_ids:
        return {}
    rows = db.execute(
        select(Checklist.task_id, func.count(ChecklistItem.id), func.count(ChecklistItem.id).filter(ChecklistItem.resolved.is_(True)))
        .join(ChecklistItem, ChecklistItem.checklist_id == Checklist.id)
        .where(Checklist.task_id.in_(list(task_ids))).group_by(Checklist.task_id)
    ).all()
    return {tid: (done, total) for tid, total, done in rows}


def add_checklist(db: Session, opened: Opened[Task], name: str, items: List[str]) -> Checklist:
    _require(opened, PermissionLevel.edit, "add checklists")
    count = db.scalar(select(func.count()).select_from(Checklist).where(Checklist.task_id == opened.obj.id)) or 0
    cl = Checklist(task_id=opened.obj.id, name=name, orderindex=float(count + 1))
    db.add(cl)
    db.flush()
    for i, text in enumerate(items):
        db.add(ChecklistItem(checklist_id=cl.id, name=text, orderindex=float(i + 1)))
    events.record(db, opened.obj, opened.access.user_id, "checklist", {"name": name})
    db.flush()
    return cl


def _open_checklist(db: Session, user_id: str, checklist_id: uuid.UUID) -> Tuple[Checklist, Opened[Task]]:
    cl = db.get(Checklist, checklist_id)
    if cl is None:
        raise NotFound("Checklist not found")
    return cl, open_task(db, user_id, cl.task_id, PermissionLevel.view)


def update_checklist(db: Session, user_id: str, checklist_id: uuid.UUID, name: Optional[str], orderindex: Optional[float]) -> Checklist:
    cl, opened = _open_checklist(db, user_id, checklist_id)
    _require(opened, PermissionLevel.edit, "change checklists")
    if name:
        cl.name = name
    if orderindex is not None:
        cl.orderindex = orderindex
    db.flush()
    return cl


def delete_checklist(db: Session, user_id: str, checklist_id: uuid.UUID) -> None:
    cl, opened = _open_checklist(db, user_id, checklist_id)
    _require(opened, PermissionLevel.edit, "delete checklists")
    db.delete(cl)
    db.flush()


def _check_assignee(db: Session, opened: Opened[Task], assignee_id: Optional[str]) -> None:
    if assignee_id and db.get(WorkspaceMember, (opened.access.workspace_id, assignee_id)) is None:
        raise Invalid("Checklist items can only be assigned to people in this workspace")


def add_item(db: Session, user_id: str, checklist_id: uuid.UUID, name: str, assignee_id: Optional[str]) -> ChecklistItem:
    cl, opened = _open_checklist(db, user_id, checklist_id)
    _require(opened, PermissionLevel.edit, "add checklist items")
    _check_assignee(db, opened, assignee_id)
    count = db.scalar(select(func.count()).select_from(ChecklistItem).where(ChecklistItem.checklist_id == cl.id)) or 0
    item = ChecklistItem(checklist_id=cl.id, name=name, assignee_id=assignee_id, orderindex=float(count + 1))
    db.add(item)
    db.flush()
    if assignee_id:
        events.watch(db, opened.obj.id, [assignee_id])
        events.notify(db, opened.access.workspace_id, [assignee_id], user_id, "checklist_item", "primary",
                      task=opened.obj, data={"item": name})
    return item


def update_item(db: Session, user_id: str, item_id: uuid.UUID, fields: dict) -> ChecklistItem:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise NotFound("Checklist item not found")
    cl, opened = _open_checklist(db, user_id, item.checklist_id)
    only_ticking = set(fields) <= {"resolved"}
    if not (opened.level.at_least(PermissionLevel.edit) or (only_ticking and item.assignee_id == user_id and opened.level.at_least(PermissionLevel.comment))):
        raise Forbidden("You need edit access to change checklist items")
    if "name" in fields and fields["name"]:
        item.name = fields["name"]
    if "resolved" in fields and fields["resolved"] is not None:
        item.resolved = fields["resolved"]
    if "orderindex" in fields and fields["orderindex"] is not None:
        item.orderindex = fields["orderindex"]
    if "assignee_id" in fields:
        _check_assignee(db, opened, fields["assignee_id"])
        if fields["assignee_id"] and fields["assignee_id"] != item.assignee_id:
            events.watch(db, opened.obj.id, [fields["assignee_id"]])
            events.notify(db, opened.access.workspace_id, [fields["assignee_id"]], user_id, "checklist_item", "primary",
                          task=opened.obj, data={"item": item.name})
        item.assignee_id = fields["assignee_id"]
    db.flush()
    return item


def delete_item(db: Session, user_id: str, item_id: uuid.UUID) -> None:
    item = db.get(ChecklistItem, item_id)
    if item is None:
        raise NotFound("Checklist item not found")
    _, opened = _open_checklist(db, user_id, item.checklist_id)
    _require(opened, PermissionLevel.edit, "delete checklist items")
    db.delete(item)
    db.flush()


# --- attachments ------------------------------------------------------------------------------


def attachment_out(db: Session, a: Attachment) -> dict:
    user = db.get(User, a.user_id) if a.user_id else None
    return {
        "id": str(a.id), "filename": a.filename, "content_type": a.content_type, "size": a.size,
        "user": s.UserOut.model_validate(user).model_dump() if user else None, "created_at": a.created_at.isoformat(),
    }


def attachments_out(db: Session, task_id: uuid.UUID) -> List[dict]:
    rows = db.scalars(select(Attachment).where(Attachment.task_id == task_id).order_by(Attachment.created_at))
    return [attachment_out(db, a) for a in rows]


def add_attachment(db: Session, opened: Opened[Task], filename: str, content_type: str, data: bytes) -> Attachment:
    _require(opened, PermissionLevel.comment, "attach files")
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(data) > limit:
        raise Invalid(f"Files can be at most {settings.MAX_UPLOAD_MB} MB")
    if not data:
        raise Invalid("The file is empty")
    key = secrets.token_hex(16)
    (upload_dir() / key).write_bytes(data)
    safe_name = os.path.basename(filename or "file")[:255] or "file"
    a = Attachment(task_id=opened.obj.id, user_id=opened.access.user_id, filename=safe_name,
                   content_type=(content_type or "application/octet-stream")[:127], size=len(data), storage_key=key)
    db.add(a)
    db.flush()
    events.record(db, opened.obj, opened.access.user_id, "attachment", {"filename": safe_name})
    return a


def open_attachment(db: Session, user_id: str, attachment_id: uuid.UUID) -> Tuple[Attachment, Opened[Task], Path]:
    a = db.get(Attachment, attachment_id)
    if a is None:
        raise NotFound("Attachment not found")
    opened = open_task(db, user_id, a.task_id, PermissionLevel.view)
    return a, opened, upload_dir() / a.storage_key


def delete_attachment(db: Session, user_id: str, attachment_id: uuid.UUID) -> None:
    a, opened, path = open_attachment(db, user_id, attachment_id)
    if a.user_id != user_id and opened.level != PermissionLevel.full:
        raise Forbidden("Only the uploader or someone with full access can delete this file")
    db.delete(a)
    db.flush()
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def counts(db: Session, task_ids) -> Dict[uuid.UUID, int]:
    if not task_ids:
        return {}
    return dict(db.execute(select(Attachment.task_id, func.count()).where(Attachment.task_id.in_(list(task_ids))).group_by(Attachment.task_id)).all())


# --- copying -------------------------------------------------------------------------------------


def copy_task_extras(db: Session, source: Task, target: Task, reset: bool = False) -> None:
    """Checklists travel with a duplicate (and with a repeat, unticked)."""
    for cl in db.scalars(select(Checklist).where(Checklist.task_id == source.id).order_by(Checklist.orderindex)):
        new = Checklist(task_id=target.id, name=cl.name, orderindex=cl.orderindex)
        db.add(new)
        db.flush()
        for item in db.scalars(select(ChecklistItem).where(ChecklistItem.checklist_id == cl.id).order_by(ChecklistItem.orderindex)):
            db.add(ChecklistItem(checklist_id=new.id, name=item.name, resolved=False if reset else item.resolved,
                                 assignee_id=item.assignee_id, orderindex=item.orderindex))
    db.flush()
