"""A Space's own picture as its icon, uploaded by an admin.

The file is stored under UPLOAD_DIR/space-icons/<key>, with a random key so its URL can be public,
and the Space's `icon` holds "img:<key>" -- the same field that otherwise holds an emoji -- so no
other part of the hierarchy has to change to carry it.
"""
import os
import secrets
import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Space
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.people_admin import AVATAR_TYPES, _looks_like
from app.services.work.permissions import can_manage_workspace

MAX_ICON = 1 * 1024 * 1024
PREFIX = "img:"


def icon_dir() -> str:
    path = os.path.join(settings.UPLOAD_DIR, "space-icons")
    os.makedirs(path, exist_ok=True)
    return path


def _space(db: Session, access: Access, space_id: uuid.UUID) -> Space:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can change a Space's picture")
    space = db.get(Space, space_id)
    if space is None or space.workspace_id != access.workspace_id:
        raise NotFound("Space not found")
    return space


def _drop_file(icon: str | None) -> None:
    if icon and icon.startswith(PREFIX):
        try:
            os.remove(os.path.join(icon_dir(), icon[len(PREFIX):]))
        except OSError:
            pass


def set_icon(db: Session, access: Access, space_id: uuid.UUID, content: bytes, content_type: str) -> Space:
    space = _space(db, access, space_id)
    kind = AVATAR_TYPES.get(content_type)
    if kind is None or not _looks_like(content, kind):
        raise Invalid("Use a PNG, JPG or WebP image")
    if len(content) > MAX_ICON:
        raise Invalid("The picture must be 1 MB or smaller")
    key = f"{secrets.token_urlsafe(24)}.{kind}"
    with open(os.path.join(icon_dir(), key), "wb") as fh:
        fh.write(content)
    old = space.icon
    space.icon = PREFIX + key
    db.flush()
    _drop_file(old)
    return space


def remove_icon(db: Session, access: Access, space_id: uuid.UUID) -> None:
    space = _space(db, access, space_id)
    if space.icon and space.icon.startswith(PREFIX):
        _drop_file(space.icon)
        space.icon = None
        db.flush()
