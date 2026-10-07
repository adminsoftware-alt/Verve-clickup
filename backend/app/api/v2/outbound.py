"""Notification delivery (email, push, WhatsApp), the weekly team digest, and unsubscribing."""

import html
import uuid

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User, WorkspaceMember
from app.db.session import get_db
from app.schemas import outbound as o
from app.services.work import email_links, outbound
from app.services.work.access import Access

router = APIRouter()


# --- turning email off, from the email itself -----------------------------------------------------

#: What each link does to the setting, and what the page says afterwards.
_CHOICES = {
    "unsubscribe": ("off", "You will not get any more email from Verve Workflow."),
    "digest_off": ("off", "Email is off. You will still see everything in the app."),
    "digest_weekly": ("weekly", "You will now get one email a week instead of one a day."),
}


def _page(title: str, line: str, extra: str = "") -> HTMLResponse:
    esc = html.escape
    return HTMLResponse(
        "<!doctype html><meta charset=utf-8><title>Verve Workflow</title>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<div style=\"font-family:Segoe UI,Arial,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1.5rem;color:#111827\">"
        f"<h1 style='font-size:1.25rem;margin:0 0 .5rem'>{esc(title)}</h1>"
        f"<p style='color:#4b5563;line-height:1.5;margin:0'>{esc(line)}</p>{extra}</div>"
    )


@router.get("/e/{token}", response_class=HTMLResponse, include_in_schema=False)
def email_link(token: str, db: Session = Depends(get_db)) -> HTMLResponse:
    """Act on a signed link from an email. No sign-in, because the people who need it have none.

    Only the settings in `_CHOICES` can be reached this way, and the worst a wrongly-clicked link
    can do is make the app quieter -- which is why this is safe to act on from a GET, where
    approving someone's leave would not be.
    """
    body = email_links.read(token)
    if body is None:
        return _page(
            "That link has expired",
            "Links in our emails stop working after a couple of months. Sign in and change it "
            "under Inbox → Settings, or ask an administrator.",
        )
    setting, said = _CHOICES[body["a"]]
    member = db.get(WorkspaceMember, (uuid.UUID(body["w"]), body["u"]))
    if member is None or member.deactivated_at is not None:
        return _page("Nothing to change", "This account is no longer active, so it gets no email anyway.")
    member.email_notifications = setting
    db.commit()
    # The way back, for whoever decides they would rather have kept it.
    other = (
        f"<p style='margin-top:1rem'><a href='{email_links.url('digest_weekly', body['w'], body['u'])}' "
        "style='color:#4f46e5'>Send me a weekly summary instead</a></p>"
        if setting == "off" else ""
    )
    return _page("Done", said, other)


@router.get("/workspaces/{workspace_id}/delivery", response_model=o.DeliveryOut)
def delivery(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return outbound.delivery(db, Access.for_workspace(db, user.id, workspace_id))


@router.put("/workspaces/{workspace_id}/delivery", response_model=o.DeliveryOut)
def save_delivery(workspace_id: uuid.UUID, data: o.DeliveryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = outbound.save_delivery(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return out


@router.get("/push/public-key")
def push_key():
    """The key browsers need to subscribe to push notifications (not a secret)."""
    return {"key": outbound.vapid_keys()[0]}


@router.post("/workspaces/{workspace_id}/push-subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(workspace_id: uuid.UUID, data: o.PushSubscriptionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    outbound.subscribe(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()


@router.delete("/workspaces/{workspace_id}/push-subscriptions", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(workspace_id: uuid.UUID, endpoint: str = Query(..., max_length=2000), user: User = Depends(current_user), db: Session = Depends(get_db)):
    outbound.unsubscribe(db, Access.for_workspace(db, user.id, workspace_id), endpoint)
    db.commit()


@router.post("/workspaces/{workspace_id}/push-test", status_code=status.HTTP_204_NO_CONTENT)
def push_test(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    Access.for_workspace(db, user.id, workspace_id)
    outbound.push(db, user.id, "Verve Workflow", "Notifications are on for this device.", "/inbox")
    db.commit()


@router.get("/workspaces/{workspace_id}/team-digest", response_model=o.TeamDigest)
def team_digest(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return outbound.team_digest(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/review-packs", response_model=o.ReviewPackOut)
def review_packs(workspace_id: uuid.UUID, data: o.ReviewPackIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.services.work import review_packs as packs

    out = packs.create_packs(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return out
