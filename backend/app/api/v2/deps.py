from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.models import PermissionLevel, User
from app.db.session import get_db
from app.services.work.access import Opened
from app.services.work.accounts import ensure_user
from app.services.work.errors import Conflict, Forbidden, Invalid, NotFound, WorkError


def current_user(token: dict = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """The Postgres user behind the verified Firebase token, created on first sight."""
    uid = str(token.get("uid") or "")
    if not uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if token.get("dev"):
        # Local testing (DEV_LOGIN): sign in as someone who already exists, and change nothing about them.
        person = db.get(User, uid)
        if person is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No such person to sign in as")
        return person
    # Firebase marks whether the email was verified; tokens without the flag (tests) count as verified.
    firebase = token.get("firebase") or {}
    user, changed = ensure_user(
        db, uid, token.get("email"), token.get("name"), token.get("email_verified") is not False,
        provider=firebase.get("sign_in_provider"), second_factor=bool(firebase.get("sign_in_second_factor")),
    )
    if changed:
        db.commit()
    return user


def require_level(opened: Opened, minimum: PermissionLevel, action: str) -> None:
    if not opened.level.at_least(minimum):
        raise Forbidden(f"You need {minimum.value} access to {action}")


_STATUS_FOR = {NotFound: 404, Forbidden: 403, Invalid: 400, Conflict: 409}


async def work_error_handler(request: Request, exc: WorkError) -> JSONResponse:
    code = next((c for cls, c in _STATUS_FOR.items() if isinstance(exc, cls)), 400)
    return JSONResponse(status_code=code, content={"detail": exc.message})
