"""Links in an email that work without signing in.

Seventy-three of this firm's seventy-four people have never signed in. An email that says "open
the app to change this" is, for them, an email that says nothing -- so the one thing every message
must carry, an unsubscribe, has to work from the link alone.

A link carries who it is for and what it does, signed. The signature is the whole security model:
the token is readable, it is not secret, and it cannot be edited without the key. It expires,
because a link that works forever is a link that works after somebody leaves.

What a link may do is deliberately small. Turning your own email off is safe for a stranger to do
by accident -- the worst case is quiet. Approving leave is not, which is why it is not here.
"""

import base64
import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional

from app.core.config import settings

#: How long a link stays good. Long enough for a digest to sit unread over a holiday, short enough
#: that a forwarded year-old email cannot still change somebody's settings.
VALID_FOR_DAYS = 60

#: The only things a link is allowed to do. Anything that could lose work or money belongs behind
#: a sign-in, however convenient a one-click version would be.
ACTIONS = ("unsubscribe", "digest_off", "digest_weekly")


def _key() -> bytes:
    """The signing key. A dedicated secret if there is one, otherwise derived from what exists.

    Falling back keeps development working without a setup step; the derived key is stable for a
    given deployment, which is all a signature needs. A deployment that sets nothing at all still
    gets a key -- a predictable one -- so this is worth setting in production.
    """
    raw = (
        settings.CALENDAR_TOKEN_KEY
        or settings.INBOUND_EMAIL_SECRET
        or f"{settings.GOOGLE_OAUTH_CLIENT_SECRET or ''}|{settings.SMTP_PASSWORD or ''}|verve-email-links"
    )
    return hashlib.sha256(raw.encode()).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def make(action: str, workspace_id: str, user_id: str, days: int = VALID_FOR_DAYS) -> str:
    """A token for this person to do this one thing."""
    if action not in ACTIONS:
        raise ValueError(f"Unknown email link action: {action}")
    body = {"a": action, "w": str(workspace_id), "u": user_id, "x": int(time.time()) + days * 86400}
    payload = _b64(json.dumps(body, separators=(",", ":"), sort_keys=True).encode())
    return f"{payload}.{_b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())}"


def read(token: str) -> Optional[Dict[str, Any]]:
    """What this token says, or None if it was edited, is the wrong shape, or has run out."""
    try:
        payload, signature = token.split(".", 1)
    except ValueError:
        return None
    expected = _b64(hmac.new(_key(), payload.encode(), hashlib.sha256).digest())
    # compare_digest, not ==: a timing comparison on a signature is a way to guess one.
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        body = json.loads(_unb64(payload))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(body, dict) or body.get("a") not in ACTIONS:
        return None
    if int(body.get("x", 0)) < time.time():
        return None
    return body


def url(action: str, workspace_id: str, user_id: str) -> str:
    """The whole link, ready to put in an email.

    It points at the API, not the app: the page it opens is served by the backend precisely so
    that it needs no sign-in and no JavaScript. OAUTH_REDIRECT_BASE is where the backend answers
    from outside -- the same thing an OAuth provider is sent to -- which is what this needs too.
    """
    base = (settings.OAUTH_REDIRECT_BASE or "").rstrip("/") or settings.APP_URL.rstrip("/")
    return f"{base}/api/v2/e/{make(action, workspace_id, user_id)}"
