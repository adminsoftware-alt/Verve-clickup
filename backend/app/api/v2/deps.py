from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.services.work.access import Opened
from app.services.work.accounts import ensure_user
from app.services.work.errors import Forbidden, Invalid, NotFound, WorkError


def current_user(token: dict = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """The Postgres user behind the verified Firebase token, created on first sight."""
    uid = str(token.get("uid") or "")
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Firebase marks whether the email was verified; tokens without the flag (tests) count as verified.
    user, changed = ensure_user(db, uid, token.get("email"), token.get("name"), token.get("email_verified") is not False)
    if changed:
        db.commit()
    return user


def require_level(opened: Opened, minimum: PermissionLevel, action: str) -> None:
    if not opened.level.at_least(minimum):
        raise Forbidden(f"You need {minimum.value} access to {action}")


_STATUS_FOR = {NotFound: 404, Forbidden: 403, Invalid: 400}


async def work_error_handler(request: Request, exc: WorkError) -> JSONResponse:
    code = next((c for cls, c in _STATUS_FOR.items() if isinstance(exc, cls)), 400)
    return JSONResponse(status_code=code, content={"detail": exc.message})
