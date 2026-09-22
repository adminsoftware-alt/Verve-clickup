"""Weekly timesheet approvals, following ClickUp's workflow.

    submit            (not submitted | withdrawn | changes_needed) -> pending
    withdraw          pending -> withdrawn               (the submitter)
    approve           pending -> approved                (an approver)
    request changes   pending -> changes_needed          (an approver)
    reopen            approved -> changes_needed         (an approver, with a comment)

Approvers are the people set for the submitter by an admin, or else the leads of the
submitter's Teams; owners and admins can always decide. Every step is recorded as a
comment on the submission, alongside plain comments.
"""

import uuid
from datetime import date, datetime, timezone
from typing import List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import TimesheetApprover, TimesheetComment, TimesheetSubmission, User, WorkspaceMember, WorkspaceRole
from app.schemas import timesheets as t
from app.schemas import work as s
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace
from app.services.work.timesheets import (
    approvers_for,
    can_review,
    current_submission,
    settings_row,
    submission_out,
    timesheet,
    zone,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _comment(db: Session, sub: TimesheetSubmission, user_id: str, event: Optional[str], body: Optional[str]) -> None:
    db.add(TimesheetComment(submission_id=sub.id, user_id=user_id, event=event, body=body or None))


def submit(db: Session, access: Access, data: t.SubmitIn) -> TimesheetSubmission:
    if not settings_row(db, access.workspace_id).approvals_enabled:
        raise Invalid("Timesheet approvals are not turned on for this workspace")
    tz = zone(data.tz)
    sheet = timesheet(db, access, access.user_id, data.start, tz, include_archived=True)
    sub = current_submission(db, access.workspace_id, access.user_id, sheet.period_start)
    if sub is not None and sub.status in ("pending", "approved"):
        raise Invalid("This timesheet has already been submitted")
    if not approvers_for(db, access.workspace_id, access.user_id) and not _has_admins(db, access.workspace_id, access.user_id):
        raise Invalid("No one can approve your timesheet yet. Ask an admin to set approvers")
    if sub is None:
        sub = TimesheetSubmission(workspace_id=access.workspace_id, user_id=access.user_id, period_start=sheet.period_start)
        db.add(sub)
    sub.period_end = sheet.period_end
    sub.timezone = data.tz
    sub.status = "pending"
    sub.submitted_at = _now()
    sub.decided_by = None
    sub.decided_at = None
    sub.tracked_seconds = sheet.total_seconds
    sub.billable_seconds = sum(sheet.billable_per_day)
    sub.capacity_seconds = sum(sheet.capacity_per_day)
    db.flush()
    _comment(db, sub, access.user_id, "submitted", data.comment)
    db.flush()
    return sub


def _has_admins(db: Session, workspace_id: uuid.UUID, other_than: str) -> bool:
    return db.scalar(
        select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.role.in_([WorkspaceRole.owner, WorkspaceRole.admin]),
            WorkspaceMember.user_id != other_than,
        )
    ) is not None


def _open(db: Session, access: Access, submission_id: uuid.UUID) -> TimesheetSubmission:
    sub = db.get(TimesheetSubmission, submission_id)
    if sub is None or sub.workspace_id != access.workspace_id:
        raise NotFound("Timesheet not found")
    if sub.user_id != access.user_id and not can_review(db, access, sub):
        raise NotFound("Timesheet not found")
    return sub


def open_submission(db: Session, user_id: str, submission_id: uuid.UUID) -> Tuple[TimesheetSubmission, Access]:
    sub = db.get(TimesheetSubmission, submission_id)
    if sub is None:
        raise NotFound("Timesheet not found")
    access = Access.for_workspace(db, user_id, sub.workspace_id)
    return _open(db, access, submission_id), access


def withdraw(db: Session, access: Access, sub: TimesheetSubmission) -> None:
    if sub.user_id != access.user_id:
        raise Forbidden("Only the person who submitted a timesheet can withdraw it")
    if sub.status != "pending":
        raise Invalid("Only a timesheet waiting for approval can be withdrawn")
    sub.status = "withdrawn"
    _comment(db, sub, access.user_id, "withdrawn", None)
    db.flush()


def _decide(db: Session, access: Access, sub: TimesheetSubmission, expected: str, status: str, event: str, comment: Optional[str]) -> None:
    if not can_review(db, access, sub):
        raise Forbidden("You are not an approver for this timesheet")
    if sub.status != expected:
        raise Invalid(f"This timesheet is {sub.status.replace('_', ' ')}")
    sub.status = status
    sub.decided_by = access.user_id
    sub.decided_at = _now()
    _comment(db, sub, access.user_id, event, comment)
    db.flush()


def approve(db: Session, access: Access, sub: TimesheetSubmission, data: t.DecisionIn) -> None:
    _decide(db, access, sub, "pending", "approved", "approved", data.comment)


def request_changes(db: Session, access: Access, sub: TimesheetSubmission, data: t.DecisionIn) -> None:
    _decide(db, access, sub, "pending", "changes_needed", "changes_requested", data.comment)


def reopen(db: Session, access: Access, sub: TimesheetSubmission, data: t.DecisionIn) -> None:
    if not data.comment:
        raise Invalid("Say why you are reopening this timesheet")
    _decide(db, access, sub, "approved", "changes_needed", "reopened", data.comment)


def add_comment(db: Session, access: Access, sub: TimesheetSubmission, data: t.CommentIn) -> None:
    _comment(db, sub, access.user_id, None, data.body)
    db.flush()


def comments(db: Session, sub: TimesheetSubmission) -> List[t.CommentOut]:
    rows = db.execute(
        select(TimesheetComment, User).outerjoin(User, User.id == TimesheetComment.user_id)
        .where(TimesheetComment.submission_id == sub.id).order_by(TimesheetComment.created_at)
    ).all()
    return [
        t.CommentOut(id=c.id, user=s.UserOut.model_validate(u) if u else None, event=c.event, body=c.body, created_at=c.created_at)
        for c, u in rows
    ]


def list_submissions(db: Session, access: Access, scope: str, period_start: Optional[date] = None) -> List[t.SubmissionOut]:
    """scope: to_review | changes_requested | approved | all (what you can review), or mine."""
    q = select(TimesheetSubmission).where(TimesheetSubmission.workspace_id == access.workspace_id)
    if period_start is not None:
        q = q.where(TimesheetSubmission.period_start == period_start)
    subs = list(db.scalars(q.order_by(TimesheetSubmission.period_start.desc(), TimesheetSubmission.submitted_at.desc())))
    if scope == "mine":
        subs = [x for x in subs if x.user_id == access.user_id]
    else:
        subs = [x for x in subs if x.status != "withdrawn" and can_review(db, access, x)]
        wanted = {"to_review": "pending", "changes_requested": "changes_needed", "approved": "approved"}.get(scope)
        if wanted:
            subs = [x for x in subs if x.status == wanted]
    return [submission_out(db, access, x) for x in subs]


# --- approvers (owners and admins) ---------------------------------------------------------------


def list_approvers(db: Session, access: Access) -> List[t.ApproversOut]:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can set up approvals")
    members = list(db.scalars(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id)
        .where(WorkspaceMember.workspace_id == access.workspace_id)
    ))
    by_id = {u.id: u for u in members}
    explicit = {}
    for row in db.scalars(select(TimesheetApprover).where(TimesheetApprover.workspace_id == access.workspace_id)):
        explicit.setdefault(row.submitter_id, set()).add(row.approver_id)
    out = []
    for user in sorted(members, key=lambda u: (u.display_name or u.email).lower()):
        ids = approvers_for(db, access.workspace_id, user.id)
        out.append(t.ApproversOut(
            submitter=s.UserOut.model_validate(user),
            approvers=[s.UserOut.model_validate(by_id[i]) for i in sorted(ids) if i in by_id],
            is_custom=user.id in explicit,
        ))
    return out


def set_approvers(db: Session, access: Access, submitter_id: str, data: t.ApproversIn) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can set up approvals")
    if db.get(WorkspaceMember, (access.workspace_id, submitter_id)) is None:
        raise NotFound("That person is not in this workspace")
    wanted = set(data.approver_ids)
    if submitter_id in wanted:
        raise Invalid("People cannot approve their own timesheet")
    for uid in wanted:
        member = db.get(WorkspaceMember, (access.workspace_id, uid))
        if member is None or member.role == WorkspaceRole.guest:
            raise Invalid("Approvers must be members of this workspace (not guests)")
    for row in db.scalars(select(TimesheetApprover).where(
        TimesheetApprover.workspace_id == access.workspace_id, TimesheetApprover.submitter_id == submitter_id)):
        db.delete(row)
    db.flush()
    for uid in wanted:
        db.add(TimesheetApprover(workspace_id=access.workspace_id, submitter_id=submitter_id, approver_id=uid))
    db.flush()
