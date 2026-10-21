"""The assistant's AI fallback: questions its phrase rules don't understand."""

import uuid
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.services.work import ai_assistant
from app.services.work.access import Access

router = APIRouter()


class Said(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: List[Said] = Field(default_factory=list, max_length=20)


class AskOut(BaseModel):
    answer: str


class StatusOut(BaseModel):
    configured: bool


@router.get("/workspaces/{workspace_id}/assistant", response_model=StatusOut)
def assistant_status(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    Access.for_workspace(db, user.id, workspace_id)
    return StatusOut(configured=ai_assistant.configured())


@router.post("/workspaces/{workspace_id}/assistant/ask", response_model=AskOut)
def ask(workspace_id: uuid.UUID, data: AskIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = Access.for_workspace(db, user.id, workspace_id)
    try:
        answer = ai_assistant.ask(db, access, [h.model_dump() for h in data.history], data.question)
    except ai_assistant.AssistantError as e:
        raise HTTPException(status_code=503, detail=str(e))
    # Read-only: nothing the tools did is kept.
    db.rollback()
    return AskOut(answer=answer)
