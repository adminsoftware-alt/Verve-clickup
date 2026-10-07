"""People administration: import, offboarding, ownership, sign-in rules, email, photos, audit log, joiner checklist."""

import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import costs as cs
from app.schemas import work as s
from app.services.work import audit, costs, onboarding, people, people_admin
from app.services.work.access import Access
from app.services.work.errors import Invalid, NotFound

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


# --- import --------------------------------------------------------------------------------------------------


@router.post("/workspaces/{workspace_id}/people/import", response_model=s.PersonImportResult)
def import_people(workspace_id: uuid.UUID, data: s.PersonImportIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    result = people_admin.import_people(db, _access(db, user, workspace_id), data)
    if data.dry_run:
        db.rollback()
    else:
        db.commit()
    return result


# --- offboarding and access ----------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/people/{user_id}/offboard", response_model=s.OffboardPreview)
def offboard_preview(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return people_admin.offboard_preview(db, _access(db, user, workspace_id), user_id)


@router.post("/workspaces/{workspace_id}/people/{user_id}/offboard", response_model=s.OffboardResult)
def offboard(workspace_id: uuid.UUID, user_id: str, data: s.OffboardIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = people_admin.offboard(db, _access(db, user, workspace_id), user_id, data)
    db.commit()
    return out


# --- what running this costs ------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/costs", response_model=cs.CostSummary)
def cost_summary(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return costs.summary(db, _access(db, user, workspace_id))


@router.get("/workspaces/{workspace_id}/costs/suggestions", response_model=List[cs.CostSuggestion])
def cost_suggestions(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _access(db, user, workspace_id)
    return costs.suggestions()


@router.post("/workspaces/{workspace_id}/costs", response_model=cs.CostSummary, status_code=status.HTTP_201_CREATED)
def add_cost(workspace_id: uuid.UUID, data: cs.CostItemIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    costs.add(db, access, data)
    db.commit()
    return costs.summary(db, access)


@router.patch("/workspaces/{workspace_id}/costs/{item_id}", response_model=cs.CostSummary)
def update_cost(workspace_id: uuid.UUID, item_id: uuid.UUID, data: cs.CostItemIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    costs.update(db, access, item_id, data)
    db.commit()
    return costs.summary(db, access)


@router.delete("/workspaces/{workspace_id}/costs/{item_id}", response_model=cs.CostSummary)
def delete_cost(workspace_id: uuid.UUID, item_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    costs.remove(db, access, item_id)
    db.commit()
    return costs.summary(db, access)


@router.get("/workspaces/{workspace_id}/blocked-emails", response_model=List[s.BlockedEmailOut])
def list_blocked(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return people_admin.blocked_emails(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/blocked-emails", response_model=List[s.BlockedEmailOut], status_code=status.HTTP_201_CREATED)
def block_email(workspace_id: uuid.UUID, data: s.BlockedEmailIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    people_admin.block_email(db, access, data.email, data.reason)
    people_admin.revoke_sign_in(data.email)
    db.commit()
    return people_admin.blocked_emails(db, access)


@router.delete("/workspaces/{workspace_id}/blocked-emails/{block_id}", response_model=List[s.BlockedEmailOut])
def unblock_email(workspace_id: uuid.UUID, block_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    people_admin.unblock_email(db, access, block_id)
    db.commit()
    return people_admin.blocked_emails(db, access)


@router.post("/workspaces/{workspace_id}/people/{user_id}/deactivate", response_model=s.PersonOut)
def deactivate(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    people_admin.set_active(db, access, user_id, False)
    db.commit()
    return people.get_person(db, access, user_id)


@router.post("/workspaces/{workspace_id}/people/{user_id}/reactivate", response_model=s.PersonOut)
def reactivate(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    people_admin.set_active(db, access, user_id, True)
    db.commit()
    return people.get_person(db, access, user_id)


@router.post("/workspaces/{workspace_id}/transfer-ownership", status_code=status.HTTP_204_NO_CONTENT)
def transfer_ownership(workspace_id: uuid.UUID, data: s.TransferOwnershipIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    people_admin.transfer_ownership(db, _access(db, user, workspace_id), data.user_id)
    db.commit()


# --- sign-in rules and email -------------------------------------------------------------------------------------


class SignInRulesOut(BaseModel):
    rules: s.SignInRules
    locked_out: List[str] = []


@router.get("/workspaces/{workspace_id}/sign-in-rules", response_model=SignInRulesOut)
def get_sign_in_rules(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return SignInRulesOut(rules=people_admin.sign_in_rules(db, _access(db, user, workspace_id)))


@router.put("/workspaces/{workspace_id}/sign-in-rules", response_model=SignInRulesOut)
def save_sign_in_rules(workspace_id: uuid.UUID, data: s.SignInRules, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rules, affected = people_admin.save_sign_in_rules(db, _access(db, user, workspace_id), data)
    db.commit()
    return SignInRulesOut(rules=rules, locked_out=affected)


@router.get("/workspaces/{workspace_id}/email-status", response_model=s.EmailStatus)
def email_status(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _access(db, user, workspace_id)
    return people_admin.email_status()


@router.post("/workspaces/{workspace_id}/email-test", status_code=status.HTTP_204_NO_CONTENT)
def email_test(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    people_admin.send_test_email(db, _access(db, user, workspace_id))


# --- profile photos -----------------------------------------------------------------------------------------------


@router.put("/workspaces/{workspace_id}/people/{user_id}/avatar", response_model=s.UserOut)
async def set_avatar(workspace_id: uuid.UUID, user_id: str, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    content = await file.read(people_admin.MAX_AVATAR + 1)
    out = people_admin.set_avatar(db, _access(db, user, workspace_id), user_id, content, file.content_type or "")
    db.commit()
    return s.UserOut.model_validate(out)


@router.delete("/workspaces/{workspace_id}/people/{user_id}/avatar", status_code=status.HTTP_204_NO_CONTENT)
def remove_avatar(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    people_admin.remove_avatar(db, _access(db, user, workspace_id), user_id)
    db.commit()


@router.get("/avatars/{key}", include_in_schema=False)
def avatar(key: str):
    """Profile photos are served by an unguessable name, so an <img> can show them without signing in."""
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,64}\.(png|jpg|webp)", key):
        raise NotFound("Photo not found")
    path = os.path.join(people_admin.avatar_dir(), key)
    if not os.path.isfile(path):
        raise NotFound("Photo not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=31536000, immutable"})


# --- audit log ---------------------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/audit", response_model=List[s.AuditEventOut])
def audit_log(
    workspace_id: uuid.UUID, limit: int = Query(100, ge=1, le=500), before: Optional[datetime] = Query(None),
    action: Optional[str] = Query(None, max_length=60), actor_id: Optional[str] = Query(None, max_length=128),
    target_id: Optional[str] = Query(None, max_length=128, description="Who it was done to"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return audit.events(db, _access(db, user, workspace_id), limit, before, action, actor_id, target_id)


# --- joiner checklist ---------------------------------------------------------------------------------------------------


class JoinerPlanOut(BaseModel):
    plan: Dict[str, Any]
    is_default: bool


class JoinerPlanIn(BaseModel):
    plan: Optional[Dict[str, Any]] = None  # null: back to Verve's SOP


@router.get("/workspaces/{workspace_id}/joiner-plan", response_model=JoinerPlanOut)
def joiner_plan(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    from app.db.models import Workspace

    _access(db, user, workspace_id)
    return JoinerPlanOut(plan=onboarding.get_plan(db, workspace_id), is_default=db.get(Workspace, workspace_id).joiner_plan is None)


@router.put("/workspaces/{workspace_id}/joiner-plan", response_model=JoinerPlanOut)
def save_joiner_plan(workspace_id: uuid.UUID, data: JoinerPlanIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    plan = onboarding.save_plan(db, _access(db, user, workspace_id), data.plan)
    db.commit()
    return JoinerPlanOut(plan=plan, is_default=data.plan is None)


@router.get("/workspaces/{workspace_id}/people/{user_id}/joiner", response_model=List[s.JoinerStep])
def joiner_preview(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    steps = onboarding.preview(db, _access(db, user, workspace_id), user_id)
    db.rollback()  # the preview never writes
    return steps


@router.post("/workspaces/{workspace_id}/people/{user_id}/joiner", response_model=List[s.JoinerStep])
def run_joiner(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    steps = onboarding.run_joiner(db, _access(db, user, workspace_id), user_id)
    db.commit()
    return steps


class QuizOut(BaseModel):
    view_id: Optional[uuid.UUID]


@router.get("/workspaces/{workspace_id}/induction-quiz", response_model=QuizOut)
def induction_quiz(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return QuizOut(view_id=onboarding.induction_quiz(db, _access(db, user, workspace_id)))


@router.post("/workspaces/{workspace_id}/induction-quiz", response_model=QuizOut)
def create_induction_quiz(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = QuizOut(view_id=onboarding.induction_quiz(db, _access(db, user, workspace_id), create=True))
    db.commit()
    return out
