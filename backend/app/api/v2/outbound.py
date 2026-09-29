"""Notification delivery (email, push, WhatsApp) and the weekly team digest."""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import outbound as o
from app.services.work import outbound
from app.services.work.access import Access

router = APIRouter()


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
