"""The statutory compliance calendar: the catalogue of obligations, clients' obligations, and the calendar."""

import uuid
from datetime import date
from typing import List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import outbound as o
from app.services.work import compliance
from app.services.work.access import Access

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


@router.get("/workspaces/{workspace_id}/compliance/obligations", response_model=List[o.ObligationOut])
def obligations(workspace_id: uuid.UUID, include_archived: bool = Query(False), user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = [compliance.obligation_out(r) for r in compliance.obligations(db, _access(db, user, workspace_id), include_archived)]
    db.commit()  # the default catalogue is made on first use
    return out


@router.post("/workspaces/{workspace_id}/compliance/obligations", response_model=o.ObligationOut, status_code=status.HTTP_201_CREATED)
def add_obligation(workspace_id: uuid.UUID, data: o.ObligationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = compliance.save_obligation(db, _access(db, user, workspace_id), None, data)
    db.commit()
    return compliance.obligation_out(row)


@router.put("/workspaces/{workspace_id}/compliance/obligations/{obligation_id}", response_model=o.ObligationOut)
def update_obligation(workspace_id: uuid.UUID, obligation_id: uuid.UUID, data: o.ObligationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = compliance.save_obligation(db, _access(db, user, workspace_id), obligation_id, data)
    db.commit()
    return compliance.obligation_out(row)


@router.get("/workspaces/{workspace_id}/compliance/clients", response_model=List[o.ClientComplianceOut])
def clients(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return compliance.list_clients(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/compliance/clients", response_model=List[o.ClientComplianceOut], status_code=status.HTTP_201_CREATED)
def add_client(workspace_id: uuid.UUID, data: o.ClientComplianceIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = compliance.add_client(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/compliance/clients/{cc_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_client(workspace_id: uuid.UUID, cc_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    compliance.remove_client(db, _access(db, user, workspace_id), cc_id)
    db.commit()


@router.get("/workspaces/{workspace_id}/compliance/calendar", response_model=List[o.ComplianceItem])
def compliance_calendar(workspace_id: uuid.UUID, start: date = Query(...), end: date = Query(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    return compliance.calendar_items(db, _access(db, user, workspace_id), start, end)
