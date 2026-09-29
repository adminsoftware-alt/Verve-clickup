"""Handing a List to the people who own it: "this is Priya's list of work", or Priya and Ankit's.

Assigning a List:
  * makes it private by default, so only the people it was given to (plus whoever already had
    access through a share, and whoever created it) can see it;
  * gives each of them full access, so they can add tasks, assign themselves, track time and
    complete them;
  * keeps full access for whoever assigned it.
Taking someone off the List takes back the access the assignment gave them, unless they created
it or were the one assigning.
Who may assign: anyone with full access to the List, and, unless they are an owner or admin, only
to themselves or to people in a Team they lead (a manager and their team).
"""

import uuid
from typing import List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ListAssignee, LocationKind, PermissionLevel, Share, TaskList, Team, User, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work.access import Opened
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.hierarchy import _grant_on_privatise
from app.services.work.mywork import ensure_not_personal
from app.services.work.permissions import can_manage_workspace
from app.services.work.teams import people_led_by

MAX_ASSIGNEES = 20


def _share(db: Session, lst: TaskList, user_id: str) -> Optional[Share]:
    return db.scalars(select(Share).where(Share.list_id == lst.id, Share.user_id == user_id)).first()


def _grant_full(db: Session, lst: TaskList, user_id: str, by: str) -> None:
    share = _share(db, lst, user_id)
    if share is None:
        db.add(Share(list_id=lst.id, user_id=user_id, level=PermissionLevel.full, granted_by=by))
    else:
        share.level, share.granted_by = PermissionLevel.full, by


def _take_back(db: Session, lst: TaskList, user_id: str, by: str) -> None:
    """Undo what the assignment granted, unless they own the List some other way."""
    share = _share(db, lst, user_id)
    if share is not None and user_id != lst.created_by and user_id != by:
        db.delete(share)


def _wanted(data: s.ListAssign) -> List[str]:
    """The people asked for, in order, without repeats. `user_id` still works for one person."""
    fields = data.model_fields_set
    given: Sequence[Optional[str]] = data.user_ids if "user_ids" in fields and data.user_ids is not None else [data.user_id]
    return list(dict.fromkeys([u for u in given if u]))


def _check_can_give_to(db: Session, opened: Opened[TaskList], user_ids: Sequence[str]) -> None:
    access = opened.access
    for user_id in user_ids:
        member = db.get(WorkspaceMember, (access.workspace_id, user_id))
        if member is None:
            raise NotFound("That person is not in this workspace")
        if member.role == WorkspaceRole.guest:
            raise Invalid("Lists can't be assigned to guests; share it with them instead")
    if can_manage_workspace(access.role):
        return  # owners and admins may hand a List to anyone
    led = people_led_by(db, access.workspace_id, access.user_id)
    outside = [u for u in user_ids if u != access.user_id and u not in led]
    if outside:
        names = [(db.get(User, u).display_name or u) for u in outside]
        raise Forbidden(f"You can only assign Lists to people in the Teams you lead: {', '.join(names)}")


def assign_list(db: Session, opened: Opened[TaskList], data: s.ListAssign) -> TaskList:
    lst, access = opened.obj, opened.access
    ensure_not_personal(db, lst, "assigned to someone else")
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to a List to assign it")
    wanted = _wanted(data)
    if len(wanted) > MAX_ASSIGNEES:
        raise Invalid(f"A List can be given to at most {MAX_ASSIGNEES} people")
    before = lst.assignee_ids

    if not wanted:
        for user_id in before:
            _take_back(db, lst, user_id, access.user_id)
        lst.assignee_rows.clear()
        lst.assignee_id = None
        db.flush()
        return lst

    _check_can_give_to(db, opened, wanted)

    if data.private and not lst.is_private:
        _grant_on_privatise(db, access, LocationKind.list, lst)  # the assigner keeps access
        lst.is_private = True
    elif lst.created_by != access.user_id:
        _grant_full(db, lst, access.user_id, access.user_id)

    for user_id in wanted:
        _grant_full(db, lst, user_id, access.user_id)
    for user_id in before:
        if user_id not in wanted:
            _take_back(db, lst, user_id, access.user_id)

    keep = {row.user_id: row for row in lst.assignee_rows}
    lst.assignee_rows[:] = [
        keep.get(user_id) or ListAssignee(list_id=lst.id, user_id=user_id, assigned_by=access.user_id)
        for user_id in wanted
    ]
    lst.assignee_id = wanted[0]  # the first of them, for anything that reads a single owner
    db.flush()
    return lst


def give_to_team(db: Session, opened: Opened, kind: LocationKind, team_id: Optional[uuid.UUID]) -> None:
    """Hand a Space, Folder or List to a Team -- or take it back to the whole workspace.

    While it belongs to a Team, only that Team's people see it (sub-teams count), plus the
    owners and admins who run the place, plus anyone it was shared with by name. It is not
    the same as making it private: the work is still the firm's, it just has a home.
    """
    from app.services.work.teams import led_team_ids, team_or_404

    node, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden(f"You need full access to give this {kind.value} to a Team")
    ensure_not_personal(db, node, "given to a Team") if isinstance(node, TaskList) else None

    if team_id is None:
        previous = node.team_id
        node.team = None
        if previous is not None:
            team = db.get(Team, previous)
            if team is not None:
                team.locations = [x for x in (team.locations or []) if x.get("id") != str(node.id)]
        db.flush()
        return

    team = team_or_404(db, access, team_id)
    if not can_manage_workspace(access.role) and team.id not in led_team_ids(db, access.workspace_id, access.user_id):
        raise Forbidden("You can only give work to a Team you lead")
    node.team = team  # the object, so what is handed back names the Team straight away
    here = {"kind": kind.value, "id": str(node.id)}
    if here not in (team.locations or []):
        team.locations = [*(team.locations or []), here]
    db.flush()
