"""Timesheets, time tags, working hours and approvals."""

import uuid
from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import User
from app.db.session import get_db
from app.schemas import timesheets as t
from app.services.work import approvals, timesheets
from app.services.work.access import Access

router = APIRouter()


def _access(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


# --- timesheet grid ---------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/timesheet", response_model=t.TimesheetOut)
def get_timesheet(
    workspace_id: uuid.UUID,
    start: date = Query(..., description="Any day in the week to show"),
    tz: str = Query("UTC"),
    user_id: Optional[str] = Query(None, description="Whose timesheet; yours if left out"),
    billable: Literal["all", "billable", "non_billable"] = Query("all"),
    tag_ids: List[uuid.UUID] = Query(default_factory=list),
    include_archived: bool = Query(False),
    tracked_op: Optional[Literal["gt", "lt"]] = Query(None),
    tracked_seconds: Optional[int] = Query(None, ge=0),
    sort: Literal["date_added", "name"] = Query("date_added"),
    descending: bool = Query(False),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    access = _access(db, user, workspace_id)
    return timesheets.timesheet(
        db, access, user_id or user.id, start, timesheets.zone(tz), billable, tag_ids, include_archived,
        tracked_op, tracked_seconds, sort, descending,
    )


@router.put("/workspaces/{workspace_id}/timesheet/cell", status_code=status.HTTP_204_NO_CONTENT)
def set_cell(workspace_id: uuid.UUID, data: t.CellIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    timesheets.set_cell(db, _access(db, user, workspace_id), data)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/timesheet/rows", status_code=status.HTTP_204_NO_CONTENT)
def add_row(workspace_id: uuid.UUID, data: t.RowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    timesheets.add_row(db, _access(db, user, workspace_id), data)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/timesheet/rows/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(workspace_id: uuid.UUID, data: t.RowIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    timesheets.delete_row(db, _access(db, user, workspace_id), data)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/workspaces/{workspace_id}/timesheet/tasks", response_model=List[t.PickTask])
def pickable_tasks(
    workspace_id: uuid.UUID, q: str = Query(""), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return timesheets.pickable_tasks(db, _access(db, user, workspace_id), q)


@router.get("/workspaces/{workspace_id}/timesheets", response_model=t.AllTimesheetsOut)
def all_timesheets(
    workspace_id: uuid.UUID,
    start: date = Query(...),
    tz: str = Query("UTC"),
    team_id: Optional[uuid.UUID] = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return timesheets.all_timesheets(db, _access(db, user, workspace_id), start, timesheets.zone(tz), team_id)


# --- settings and working hours ------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/timesheet-settings", response_model=t.SettingsOut)
def get_settings(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return timesheets.get_settings(db, _access(db, user, workspace_id))


@router.patch("/workspaces/{workspace_id}/timesheet-settings", response_model=t.SettingsOut)
def update_settings(workspace_id: uuid.UUID, data: t.SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = timesheets.update_settings(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.get("/workspaces/{workspace_id}/members/{user_id}/capacity", response_model=t.CapacityOut)
def get_capacity(workspace_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    _access(db, user, workspace_id)
    seconds, custom = timesheets.capacity_of(db, workspace_id, user_id)
    return t.CapacityOut(capacity_seconds=seconds, is_custom=custom)


@router.put("/workspaces/{workspace_id}/members/{user_id}/capacity", response_model=t.CapacityOut)
def set_capacity(
    workspace_id: uuid.UUID, user_id: str, data: t.CapacityIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    out = timesheets.set_capacity(db, _access(db, user, workspace_id), user_id, data)
    db.commit()
    return out


# --- time tags ------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/time-tags", response_model=List[t.TimeTagOut])
def list_tags(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return timesheets.list_tags(db, _access(db, user, workspace_id))


@router.post("/workspaces/{workspace_id}/time-tags", response_model=t.TimeTagOut, status_code=status.HTTP_201_CREATED)
def create_tag(workspace_id: uuid.UUID, data: t.TimeTagIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = timesheets.create_tag(db, _access(db, user, workspace_id), data)
    db.commit()
    return out


@router.patch("/workspaces/{workspace_id}/time-tags/{tag_id}", response_model=t.TimeTagOut)
def update_tag(
    workspace_id: uuid.UUID, tag_id: uuid.UUID, data: t.TimeTagIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    out = timesheets.update_tag(db, _access(db, user, workspace_id), tag_id, data)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/time-tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(workspace_id: uuid.UUID, tag_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    timesheets.delete_tag(db, _access(db, user, workspace_id), tag_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- approvals ----------------------------------------------------------------------------------------


@router.post("/workspaces/{workspace_id}/timesheet/submit", response_model=t.SubmissionOut)
def submit(workspace_id: uuid.UUID, data: t.SubmitIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    access = _access(db, user, workspace_id)
    sub = approvals.submit(db, access, data)
    db.commit()
    return timesheets.submission_out(db, access, sub)


@router.get("/workspaces/{workspace_id}/timesheet-submissions", response_model=List[t.SubmissionOut])
def list_submissions(
    workspace_id: uuid.UUID,
    scope: Literal["to_review", "changes_requested", "approved", "all", "mine"] = Query("to_review"),
    start: Optional[date] = Query(None, description="Only this period (its first day)"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return approvals.list_submissions(db, _access(db, user, workspace_id), scope, start)


def _decision(action):
    def handler(submission_id: uuid.UUID, data: t.DecisionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
        sub, access = approvals.open_submission(db, user.id, submission_id)
        action(db, access, sub, data)
        db.commit()
        return timesheets.submission_out(db, access, sub)
    return handler


router.add_api_route("/timesheet-submissions/{submission_id}/approve", _decision(approvals.approve), methods=["POST"], response_model=t.SubmissionOut)
router.add_api_route("/timesheet-submissions/{submission_id}/request-changes", _decision(approvals.request_changes), methods=["POST"], response_model=t.SubmissionOut)
router.add_api_route("/timesheet-submissions/{submission_id}/reopen", _decision(approvals.reopen), methods=["POST"], response_model=t.SubmissionOut)


@router.post("/timesheet-submissions/{submission_id}/withdraw", response_model=t.SubmissionOut)
def withdraw(submission_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, access = approvals.open_submission(db, user.id, submission_id)
    approvals.withdraw(db, access, sub)
    db.commit()
    return timesheets.submission_out(db, access, sub)


@router.get("/timesheet-submissions/{submission_id}/comments", response_model=List[t.CommentOut])
def get_comments(submission_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, _ = approvals.open_submission(db, user.id, submission_id)
    return approvals.comments(db, sub)


@router.post("/timesheet-submissions/{submission_id}/comments", response_model=List[t.CommentOut], status_code=status.HTTP_201_CREATED)
def add_comment(submission_id: uuid.UUID, data: t.CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    sub, access = approvals.open_submission(db, user.id, submission_id)
    approvals.add_comment(db, access, sub, data)
    db.commit()
    return approvals.comments(db, sub)


@router.get("/workspaces/{workspace_id}/timesheet-approvers", response_model=List[t.ApproversOut])
def list_approvers(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return approvals.list_approvers(db, _access(db, user, workspace_id))


@router.put("/workspaces/{workspace_id}/timesheet-approvers/{submitter_id}", status_code=status.HTTP_204_NO_CONTENT)
def set_approvers(
    workspace_id: uuid.UUID, submitter_id: str, data: t.ApproversIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    approvals.set_approvers(db, _access(db, user, workspace_id), submitter_id, data)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
