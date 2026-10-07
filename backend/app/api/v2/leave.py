"""Leave (types, holidays, requests, approvals, balances, calendar) and billing (rates, fees, profitability, invoices)."""

import uuid
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import leave as lv
from app.services.work import billing, leave
from app.services.work.access import Access

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


# --- the policy ---------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/leave/policy", response_model=lv.LeavePolicyOut)
def get_leave_policy(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Everyone reads it: the request form has to say what the rules are before someone breaks one."""
    access = _access(db, user, workspace_id)
    return leave.policy_out(db, leave.policy(db, access.workspace_id))


@router.put("/workspaces/{workspace_id}/leave/policy", response_model=lv.LeavePolicyOut)
def put_leave_policy(workspace_id: uuid.UUID, data: lv.LeavePolicyIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = leave.save_policy(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


# --- types and holidays -------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/leave/types", response_model=List[lv.LeaveTypeOut])
def leave_types(workspace_id: uuid.UUID, include_archived: bool = Query(False), user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = [leave.type_out(t) for t in leave.types(db, _access(db, user, workspace_id), include_archived)]
    db.commit()  # the default types are made on first use
    return out


@router.post("/workspaces/{workspace_id}/leave/types", response_model=lv.LeaveTypeOut, status_code=status.HTTP_201_CREATED)
def add_leave_type(workspace_id: uuid.UUID, data: lv.LeaveTypeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = leave.save_type(db, _access(db, user, workspace_id), None, data)
    db.commit()
    return leave.type_out(row)


@router.put("/workspaces/{workspace_id}/leave/types/{type_id}", response_model=lv.LeaveTypeOut)
def update_leave_type(workspace_id: uuid.UUID, type_id: uuid.UUID, data: lv.LeaveTypeIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = leave.save_type(db, _access(db, user, workspace_id), type_id, data)
    db.commit()
    return leave.type_out(row)


@router.get("/workspaces/{workspace_id}/holidays", response_model=List[lv.HolidayOut])
def holidays(workspace_id: uuid.UUID, year: Optional[int] = Query(None, ge=2000, le=2100), user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [lv.HolidayOut(id=h.id, day=h.day, name=h.name) for h in leave.holidays(db, _access(db, user, workspace_id), year)]


@router.post("/workspaces/{workspace_id}/holidays", response_model=lv.HolidayOut, status_code=status.HTTP_201_CREATED)
def add_holiday(workspace_id: uuid.UUID, data: lv.HolidayIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    h = leave.add_holiday(db, _access(db, user, workspace_id), data)
    db.commit()
    return lv.HolidayOut(id=h.id, day=h.day, name=h.name)


@router.delete("/workspaces/{workspace_id}/holidays/{holiday_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_holiday(workspace_id: uuid.UUID, holiday_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    leave.remove_holiday(db, _access(db, user, workspace_id), holiday_id)
    db.commit()


# --- requests ---------------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/leave", response_model=List[lv.LeaveRequestOut])
def leave_requests(
    workspace_id: uuid.UUID,
    scope: Literal["mine", "approvals", "all"] = Query("mine"),
    year: Optional[int] = Query(None, ge=2000, le=2100, description="A leave year, named by the year it starts in"),
    status_filter: Optional[Literal["pending", "approved", "rejected", "cancelled"]] = Query(None, alias="status"),
    user_id: Optional[str] = Query(None, description="One person, with scope=all"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    out = leave.list_requests(db, _access(db, user, workspace_id), scope, year, status_filter, user_id)
    db.commit()
    return out


@router.post("/workspaces/{workspace_id}/leave", response_model=lv.LeaveRequestOut, status_code=status.HTTP_201_CREATED)
def request_leave(workspace_id: uuid.UUID, data: lv.LeaveRequestIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = leave.create_request(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.post("/workspaces/{workspace_id}/leave/{leave_id}/decision", response_model=lv.LeaveRequestOut)
def decide_leave(workspace_id: uuid.UUID, leave_id: uuid.UUID, data: lv.LeaveDecision, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = leave.decide(db, _access(db, user, workspace_id), leave_id, data.approve, data.note, data.cover_id)
    db.commit()
    return out


@router.post("/workspaces/{workspace_id}/leave/{leave_id}/cancel", response_model=lv.LeaveRequestOut)
def cancel_leave(workspace_id: uuid.UUID, leave_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = leave.cancel(db, _access(db, user, workspace_id), leave_id)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/leave/calendar", response_model=lv.LeaveCalendarOut)
def leave_calendar(workspace_id: uuid.UUID, start: date = Query(...), end: date = Query(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = leave.calendar(db, _access(db, user, workspace_id), start, end)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/leave/clashes", response_model=lv.LeaveClashes)
def leave_clashes(
    workspace_id: uuid.UUID, start: date = Query(...), end: date = Query(...), user_id: Optional[str] = Query(None),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    """What the person already has due in those days, and who else is away then."""
    access = _access(db, user, workspace_id)
    out = leave.clashes(db, access, user_id or user.id, start, end)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/leave/balances", response_model=List[lv.LeaveBalance])
def leave_balances(
    workspace_id: uuid.UUID, user_id: Optional[str] = Query(None),
    year: Optional[int] = Query(None, ge=2000, le=2100, description="Omit for the leave year we are in"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    out = leave.balances(db, _access(db, user, workspace_id), user_id or user.id, year)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/leave/adjustments", response_model=List[lv.LeaveAdjustmentOut])
def leave_adjustments(
    workspace_id: uuid.UUID, year: int = Query(..., ge=2000, le=2100), user_id: Optional[str] = Query(None),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return leave.adjustments(db, _access(db, user, workspace_id), user_id or user.id, year)


@router.put("/workspaces/{workspace_id}/leave/adjustments", response_model=List[lv.LeaveAdjustmentOut])
def put_leave_adjustment(workspace_id: uuid.UUID, data: lv.LeaveAdjustmentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Grant days, take them back, or (with zero) remove the adjustment."""
    out = leave.set_adjustment(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


# --- billing ---------------------------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/billing/rates", response_model=List[lv.BillingRateOut])
def rates(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return billing.list_rates(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/billing/rates", response_model=lv.BillingRateOut)
def set_rate(workspace_id: uuid.UUID, data: lv.BillingRateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = billing.set_rate(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/billing/rates/{rate_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_rate(workspace_id: uuid.UUID, rate_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    billing.remove_rate(db, _access(db, user, workspace_id), rate_id)
    db.commit()


@router.get("/workspaces/{workspace_id}/billing/fees", response_model=List[lv.ClientFeeOut])
def fees(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return billing.list_fees(db, _access(db, user, workspace_id))


class FeeSet(BaseModel):
    fee: Optional[lv.ClientFeeIn] = None  # null removes it


@router.put("/workspaces/{workspace_id}/billing/fees/{kind}/{location_id}", response_model=Optional[lv.ClientFeeOut])
def set_fee(workspace_id: uuid.UUID, kind: Literal["space", "folder", "list"], location_id: uuid.UUID, data: FeeSet,
            user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = billing.set_fee(db, _access(db, user, workspace_id), kind, location_id, data.fee)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/billing/profitability", response_model=lv.ProfitReport)
def profitability(
    workspace_id: uuid.UUID, start: date = Query(...), end: date = Query(...), tz: str = Query("Asia/Kolkata"),
    kind: Optional[Literal["space", "folder", "list"]] = Query(None), location_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return billing.profitability(db, _access(db, user, workspace_id), start, end, tz, kind, location_id)


@router.get("/workspaces/{workspace_id}/billing/invoice", response_model=lv.InvoiceDraft)
def invoice(
    workspace_id: uuid.UUID, kind: Literal["space", "folder", "list"] = Query(...), location_id: uuid.UUID = Query(...),
    start: date = Query(...), end: date = Query(...), tz: str = Query("Asia/Kolkata"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return billing.invoice(db, _access(db, user, workspace_id), kind, location_id, start, end, tz)
