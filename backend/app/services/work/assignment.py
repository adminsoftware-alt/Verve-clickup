"""Handing a List to one person: "this is Priya's list of work".

Assigning a List:
  * makes it private by default, so only the assignee and the people who already had
    access through a share (and whoever created it) can see it;
  * gives the assignee full access, so they can add tasks, assign themselves, track
    time and complete them;
  * keeps full access for whoever assigned it.
Who may assign: anyone with full access to the List, and, unless they are an owner or
admin, only to themselves or to people in a Team they lead (a manager and their team).
"""

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import LocationKind, PermissionLevel, Share, TaskList, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work.access import Opened
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.hierarchy import _grant_on_privatise
from app.services.work.mywork import ensure_not_personal
from app.services.work.permissions import can_manage_workspace
from app.services.work.teams import people_led_by


def _share(db: Session, lst: TaskList, user_id: str) -> Optional[Share]:
    return db.scalars(select(Share).where(Share.list_id == lst.id, Share.user_id == user_id)).first()


def _grant_full(db: Session, lst: TaskList, user_id: str, by: str) -> None:
    share = _share(db, lst, user_id)
    if share is None:
        db.add(Share(list_id=lst.id, user_id=user_id, level=PermissionLevel.full, granted_by=by))
    else:
        share.level, share.granted_by = PermissionLevel.full, by


def assign_list(db: Session, opened: Opened[TaskList], data: s.ListAssign) -> TaskList:
    lst, access = opened.obj, opened.access
    ensure_not_personal(db, lst, "assigned to someone else")
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to a List to assign it")
    previous = lst.assignee_id

    if data.user_id is None:
        if previous is not None:
            share = _share(db, lst, previous)
            if share is not None and previous != lst.created_by:
                db.delete(share)
        lst.assignee_id = None
        db.flush()
        return lst

    member = db.get(WorkspaceMember, (access.workspace_id, data.user_id))
    if member is None:
        raise NotFound("That person is not in this workspace")
    if member.role == WorkspaceRole.guest:
        raise Invalid("Lists can't be assigned to guests; share it with them instead")
    if not can_manage_workspace(access.role) and data.user_id != access.user_id:
        if data.user_id not in people_led_by(db, access.workspace_id, access.user_id):
            raise Forbidden("You can only assign Lists to people in the Teams you lead")

    if data.private and not lst.is_private:
        _grant_on_privatise(db, access, LocationKind.list, lst)  # the assigner keeps access
        lst.is_private = True
    elif lst.created_by != access.user_id:
        _grant_full(db, lst, access.user_id, access.user_id)
    _grant_full(db, lst, data.user_id, access.user_id)
    if previous is not None and previous != data.user_id:
        old = _share(db, lst, previous)
        if old is not None and previous != lst.created_by and previous != access.user_id:
            db.delete(old)
    lst.assignee_id = data.user_id
    db.flush()
    return lst
