"""What lives inside the Doc, Whiteboard and Mind map views (saved content with an edit version),
the Chat view's messages, and the Embed view's address."""

import json
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ChatMessage, PermissionLevel, Task, User, View, ViewContent, ViewType, WorkspaceMember
from app.schemas import spaces as sp
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Opened, open_list
from app.services.work.errors import Conflict, Forbidden, Invalid, NotFound
from app.services.work.views import open_view

CONTENT_TYPES = (ViewType.doc, ViewType.whiteboard, ViewType.mind_map)
MAX_CONTENT_BYTES = 2_000_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_type(view: View, *types: ViewType) -> None:
    if view.type not in types:
        raise Invalid("This view doesn't hold that kind of content")


def content_out(db: Session, view: View) -> sp.ViewContentOut:
    row = db.get(ViewContent, view.id)
    if row is None:
        return sp.ViewContentOut(content={}, version=0, updated_by=None, updated_at=None)
    user = db.get(User, row.updated_by) if row.updated_by else None
    return sp.ViewContentOut(content=row.content or {}, version=row.version,
                             updated_by=s.UserOut.model_validate(user) if user else None, updated_at=row.updated_at)


def get_content(db: Session, user_id: str, view_id: uuid.UUID) -> sp.ViewContentOut:
    opened = open_view(db, user_id, view_id, PermissionLevel.view)
    _require_type(opened.obj, *CONTENT_TYPES)
    return content_out(db, opened.obj)


def _can_edit(opened: Opened[View], user_id: str) -> bool:
    return opened.level.at_least(PermissionLevel.edit) or opened.obj.private_to == user_id


def save_content(db: Session, user_id: str, view_id: uuid.UUID, data: sp.ViewContentIn) -> sp.ViewContentOut:
    """Save if nobody else saved since `version`; otherwise refuse, so no one's edit is silently lost."""
    opened = open_view(db, user_id, view_id, PermissionLevel.view)
    view = opened.obj
    _require_type(view, *CONTENT_TYPES)
    if not _can_edit(opened, user_id):
        raise Forbidden("You need edit access to change this")
    if len(json.dumps(data.content)) > MAX_CONTENT_BYTES:
        raise Invalid("This is too big to save (2 MB at most)")
    row = db.get(ViewContent, view.id, with_for_update=True)
    if row is None:
        row = ViewContent(view_id=view.id, content={}, version=0)
        db.add(row)
    if row.version != data.version:
        raise Conflict("Someone else saved a newer version; reload to see it")
    row.content = data.content
    row.version += 1
    row.updated_by, row.updated_at = user_id, _now()
    db.flush()
    return content_out(db, view)


# --- Embed ---------------------------------------------------------------------------------------

_YOUTUBE = re.compile(r"^https://(?:www\.)?(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{6,20})")


def embeddable(url: str) -> str:
    """The address to put in the frame: YouTube links become their embed form; everything must be https."""
    url = url.strip()
    if not url.startswith("https://"):
        raise Invalid("Only https:// addresses can be embedded")
    m = _YOUTUBE.match(url)
    if m:
        return f"https://www.youtube.com/embed/{m.group(1)}"
    if url.startswith("https://docs.google.com/") and "/edit" in url:
        return url.split("/edit")[0] + "/preview"
    return url


def set_embed(db: Session, user_id: str, view_id: uuid.UUID, url: str) -> View:
    opened = open_view(db, user_id, view_id, PermissionLevel.view)
    view = opened.obj
    _require_type(view, ViewType.embed)
    if not _can_edit(opened, user_id):
        raise Forbidden("You need edit access to change this")
    view.settings = {**(view.settings or {}), "url": embeddable(url), "source_url": url.strip()}
    db.flush()
    return view


# --- Chat ----------------------------------------------------------------------------------------


def _chat_view(db: Session, user_id: str, view_id: uuid.UUID) -> Opened[View]:
    opened = open_view(db, user_id, view_id, PermissionLevel.view)
    _require_type(opened.obj, ViewType.chat)
    return opened


def _message_out(m: ChatMessage, users: dict, me: str) -> sp.ChatOut:
    user = users.get(m.user_id)
    return sp.ChatOut(id=m.id, user=s.UserOut.model_validate(user) if user else None, body=m.body, task_id=m.task_id,
                      created_at=m.created_at, edited_at=m.edited_at, mine=m.user_id == me)


def messages(db: Session, user_id: str, view_id: uuid.UUID, after: Optional[datetime] = None, limit: int = 200) -> List[sp.ChatOut]:
    _chat_view(db, user_id, view_id)
    q = select(ChatMessage).where(ChatMessage.view_id == view_id)
    if after is not None:
        q = q.where(ChatMessage.created_at > after)
    rows = list(db.scalars(q.order_by(ChatMessage.created_at.desc()).limit(limit)))[::-1]
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({m.user_id for m in rows if m.user_id})))} if rows else {}
    return [_message_out(m, users, user_id) for m in rows]


def post(db: Session, user_id: str, view_id: uuid.UUID, data: sp.ChatIn) -> sp.ChatOut:
    opened = _chat_view(db, user_id, view_id)
    if not opened.level.at_least(PermissionLevel.comment):
        raise Forbidden("You need comment access to chat here")
    msg = ChatMessage(view_id=view_id, user_id=user_id, body=data.body)
    db.add(msg)
    db.flush()
    if data.mention_user_ids:
        view = opened.obj
        members = set(db.scalars(select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == opened.access.workspace_id, WorkspaceMember.user_id.in_(data.mention_user_ids))))
        kind, target = ("list", view.list_id) if view.list_id else ("folder", view.folder_id) if view.folder_id else ("space", view.space_id)
        allowed = set()
        for uid in members:  # only people who can open the chat hear about it
            try:
                open_view(db, uid, view_id, PermissionLevel.view)
                allowed.add(uid)
            except (NotFound, Forbidden):
                continue
        events.notify(db, opened.access.workspace_id, allowed, user_id, "chat_mention", "primary",
                      data={"view": view.name, "view_id": str(view.id), "location_kind": kind, "location_id": str(target),
                            "body": data.body[:200]})
    return _message_out(msg, {user_id: db.get(User, user_id)}, user_id)


def _message(db: Session, user_id: str, message_id: uuid.UUID) -> ChatMessage:
    msg = db.get(ChatMessage, message_id)
    if msg is None:
        raise NotFound("Message not found")
    _chat_view(db, user_id, msg.view_id)
    return msg


def edit(db: Session, user_id: str, message_id: uuid.UUID, data: sp.ChatIn) -> sp.ChatOut:
    msg = _message(db, user_id, message_id)
    if msg.user_id != user_id:
        raise Forbidden("You can only edit your own messages")
    msg.body, msg.edited_at = data.body, _now()
    db.flush()
    return _message_out(msg, {user_id: db.get(User, user_id)}, user_id)


def remove(db: Session, user_id: str, message_id: uuid.UUID) -> None:
    msg = _message(db, user_id, message_id)
    if msg.user_id != user_id:
        opened = open_view(db, user_id, msg.view_id, PermissionLevel.view)
        if opened.level != PermissionLevel.full:
            raise Forbidden("Only its author, or someone with full access here, can delete a message")
    db.delete(msg)
    db.flush()


def to_task(db: Session, user_id: str, message_id: uuid.UUID, data: sp.ChatToTask) -> Task:
    """Turn a message into a task (in the view's List, or a List the caller picks)."""
    from app.services.work import tasks as task_service

    msg = _message(db, user_id, message_id)
    view = db.get(View, msg.view_id)
    list_id = data.list_id or view.list_id
    if list_id is None:
        raise Invalid("Choose a List for the task")
    opened_list = open_list(db, user_id, list_id, PermissionLevel.view)
    first_line = msg.body.strip().splitlines()[0]
    task = task_service.create_task(db, opened_list, s.TaskCreate(name=first_line[:500], description=msg.body))
    msg.task_id = task.id
    db.flush()
    return task
