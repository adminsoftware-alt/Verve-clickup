"""Email-to-List, as in ClickUp: every List can have its own address; mail sent there becomes a task.

The subject is the task name, the body its description, and attachments are attached. Only members of
the workspace who can add tasks to the List can email it (anything else is dropped and recorded).
Mail arrives by polling an IMAP mailbox, or from a provider's inbound webhook posting the raw message.
"""

import hashlib
import html
import imaplib
import logging
import re
import secrets
import uuid
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr
from typing import List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import InboundEmail, PermissionLevel, TaskList, User
from app.schemas import spaces as sp
from app.schemas import work as s
from app.services.work import extras, space_admin
from app.services.work import tasks as task_service
from app.services.work.access import Opened, open_list
from app.services.work.errors import Forbidden, Invalid, NotFound

log = logging.getLogger(__name__)
TOKEN = re.compile(r"\+([a-z0-9]{12,32})@", re.I)


def configured() -> bool:
    return bool(settings.INBOUND_EMAIL_ADDRESS and "@" in settings.INBOUND_EMAIL_ADDRESS)


def address_for(token: str) -> Optional[str]:
    if not configured():
        return None
    local, domain = settings.INBOUND_EMAIL_ADDRESS.split("@", 1)
    return f"{local.split('+')[0]}+{token}@{domain}"


def info(db: Session, opened: Opened[TaskList]) -> sp.ListEmailOut:
    lst = opened.obj
    return sp.ListEmailOut(
        address=address_for(lst.email_token) if lst.email_token and opened.level == PermissionLevel.full else None,
        configured=configured(), enabled=space_admin.enabled(db, lst.space_id, "email_to_list"),
    )


def make_address(db: Session, opened: Opened[TaskList], rotate: bool = False) -> sp.ListEmailOut:
    """Give the List an address (or a new one, which stops the old one working)."""
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the List to get its email address")
    space_admin.require(db, opened.obj.space_id, "email_to_list")
    if opened.obj.email_token is None or rotate:
        opened.obj.email_token = secrets.token_hex(8)
        db.flush()
    return info(db, opened)


def turn_off(db: Session, opened: Opened[TaskList]) -> None:
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the List")
    opened.obj.email_token = None
    db.flush()


# --- receiving -----------------------------------------------------------------------------------


def _body(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    text = part.get_content()
    if part.get_content_type() == "text/html":
        text = re.sub(r"<(br|/p|/div|/li)[^>]*>", "\n", text, flags=re.I)
        text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n{3,}", "\n\n", text.replace("\r\n", "\n")).strip()


def _attachments(msg: EmailMessage) -> List[Tuple[str, str, bytes]]:
    out = []
    for part in msg.iter_attachments():
        data = part.get_payload(decode=True)
        if data:
            out.append((part.get_filename() or "attachment", part.get_content_type(), data))
    return out


def _tokens(msg: EmailMessage) -> List[str]:
    headers = []
    for name in ("To", "Cc", "Delivered-To", "X-Original-To", "Envelope-To"):
        headers.extend(str(v) for v in (msg.get_all(name) or []))
    found = []
    for _, addr in getaddresses(headers):
        m = TOKEN.search(addr)
        if m and m.group(1).lower() not in found:
            found.append(m.group(1).lower())
    return found


def _record(db: Session, message_id: str, outcome: str, sender: Optional[str], list_id=None, task_id=None) -> bool:
    """Remember the message; False if it was already handled."""
    row_id = db.execute(
        pg_insert(InboundEmail).values(id=uuid.uuid4(), message_id=message_id[:300], outcome=outcome, sender=(sender or "")[:320] or None,
                                       list_id=list_id, task_id=task_id)
        .on_conflict_do_nothing(constraint="uq_inbound_emails_message_id").returning(InboundEmail.id)
    ).scalar()
    return row_id is not None


def ingest(db: Session, raw: bytes) -> str:
    """Turn one raw email into a task. Returns what happened (created, duplicate, unknown_list, ...)."""
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    message_id = (msg.get("Message-ID") or "").strip() or "sha256:" + hashlib.sha256(raw).hexdigest()
    sender = parseaddr(str(msg.get("From") or ""))[1].lower()
    if db.scalar(select(InboundEmail.id).where(InboundEmail.message_id == message_id[:300])):
        return "duplicate"
    lists = [db.scalar(select(TaskList).where(TaskList.email_token == t)) for t in _tokens(msg)]
    lst = next((x for x in lists if x is not None), None)
    if lst is None:
        _record(db, message_id, "unknown_list", sender)
        return "unknown_list"
    if not space_admin.enabled(db, lst.space_id, "email_to_list"):
        _record(db, message_id, "turned_off", sender, lst.id)
        return "turned_off"
    user = db.scalar(select(User).where(func.lower(User.email) == sender)) if sender else None
    try:
        if user is None:
            raise NotFound("unknown sender")
        opened = open_list(db, user.id, lst.id, PermissionLevel.view)
        if opened.level != PermissionLevel.full:
            raise Forbidden("no access")
    except (NotFound, Forbidden):
        _record(db, message_id, "sender_not_allowed", sender, lst.id)
        return "sender_not_allowed"
    subject = re.sub(r"\s+", " ", str(msg.get("Subject") or "")).strip() or "(no subject)"
    body = _body(msg)
    if not _record(db, message_id, "created", sender, lst.id):
        return "duplicate"
    task = task_service.create_task(db, opened, s.TaskCreate(name=subject[:500], description=body[:200_000] or None))
    db.execute(InboundEmail.__table__.update().where(InboundEmail.message_id == message_id[:300]).values(task_id=task.id))
    task_opened = Opened(task, opened.access, PermissionLevel.full)
    for filename, content_type, data in _attachments(msg):
        try:
            extras.add_attachment(db, task_opened, filename, content_type, data)
        except Invalid as e:
            log.info("Skipped an emailed attachment: %s", e)
    db.flush()
    return "created"


def poll(db: Session, limit: int = 50) -> int:
    """Read unseen mail from the IMAP mailbox and turn it into tasks. Does nothing unless configured."""
    if not (settings.IMAP_HOST and settings.IMAP_USER and settings.IMAP_PASSWORD and configured()):
        return 0
    handled = 0
    with imaplib.IMAP4_SSL(settings.IMAP_HOST, settings.IMAP_PORT) as box:
        box.login(settings.IMAP_USER, settings.IMAP_PASSWORD)
        box.select(settings.IMAP_FOLDER)
        _, data = box.search(None, "UNSEEN")
        for num in (data[0].split() if data and data[0] else [])[:limit]:
            _, parts = box.fetch(num, "(RFC822)")
            raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
            if raw is None:
                continue
            try:
                ingest(db, raw)
                db.commit()
            except Exception:
                db.rollback()
                log.exception("Could not turn an email into a task")
            box.store(num, "+FLAGS", "\\Seen")
            handled += 1
    return handled
