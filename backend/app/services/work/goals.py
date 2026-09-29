"""Goals, as in ClickUp: a goal has targets (a number, an amount of money, a yes/no, or tasks to finish);
its progress is the average of theirs. A Team goal belongs to a Team and is shared with its people.

Who sees a goal: everyone but guests, unless it's private; a private goal only its creator, owners,
its Team's people and admins. Who changes it: its creator, owners, the Team's leads, and admins.
"""

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Goal, GoalCheckIn, GoalTarget, Status, StatusGroup, Task, Team, User, WorkspaceMember
from app.schemas import goals as g
from app.schemas import work as s
from app.services.work import audit, team_tree
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import SHARED_ONLY, can_manage_workspace

DONE = (StatusGroup.done, StatusGroup.closed)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- access -------------------------------------------------------------------------------------


def _team_people(db: Session, goal: Goal) -> set:
    return team_tree.people(db, [goal.team_id]) if goal.team_id else set()


def can_see(db: Session, access: Access, goal: Goal) -> bool:
    if goal.workspace_id != access.workspace_id:
        return False
    me = access.user_id
    if can_manage_workspace(access.role) or goal.created_by == me or me in (goal.owner_ids or []):
        return True
    if goal.team_id and me in _team_people(db, goal):
        return True
    return not goal.is_private and access.role not in SHARED_ONLY


def can_edit(db: Session, access: Access, goal: Goal) -> bool:
    me = access.user_id
    if can_manage_workspace(access.role) or goal.created_by == me or me in (goal.owner_ids or []):
        return True
    if goal.team_id:
        from app.services.work.teams import leads_of

        # Leads of the goal's Team, or of any Team it sits inside.
        return any(me in ids for ids in leads_of(db, list(team_tree.ancestors(db, [goal.team_id]))).values())
    return False


def open_goal(db: Session, user_id: str, goal_id: uuid.UUID, edit: bool = False) -> tuple:
    goal = db.get(Goal, goal_id)
    if goal is None:
        raise NotFound("Goal not found")
    try:
        access = Access.for_workspace(db, user_id, goal.workspace_id)
    except NotFound:
        raise NotFound("Goal not found") from None
    if not can_see(db, access, goal):
        raise NotFound("Goal not found")
    if edit and not can_edit(db, access, goal):
        raise Forbidden("Only the goal's owners, its Team's leads or an admin can change it")
    return goal, access


# --- progress -----------------------------------------------------------------------------------


def _task_counts(db: Session, target: GoalTarget) -> tuple:
    ids = {uuid.UUID(x) for x in target.task_ids or []}
    list_ids = [uuid.UUID(x) for x in target.list_ids or []]
    rows = []
    if ids:
        rows += list(db.execute(select(Task.id, Status.group).join(Status, Status.id == Task.status_id)
                                .where(Task.id.in_(ids), Task.archived_at.is_(None))).all())
    if list_ids:
        rows += list(db.execute(select(Task.id, Status.group).join(Status, Status.id == Task.status_id)
                                .where(Task.list_id.in_(list_ids), Task.parent_id.is_(None), Task.archived_at.is_(None))).all())
    groups = dict(rows)  # a task picked both ways counts once
    return sum(1 for grp in groups.values() if grp in DONE), len(groups)


def target_progress(db: Session, t: GoalTarget) -> tuple:
    """(percent 0-100, done tasks, total tasks)"""
    if t.kind == "tasks":
        done, total = _task_counts(db, t)
        return (round(100 * done / total, 1) if total else 0.0), done, total
    if t.kind == "true_false":
        return (100.0 if t.current_value >= 1 else 0.0), 0, 0
    span = t.target_value - t.start_value
    frac = (t.current_value - t.start_value) / span if span else 0.0
    return round(100 * max(0.0, min(1.0, frac)), 1), 0, 0


def _users(db: Session, ids: Sequence[str]) -> Dict[str, User]:
    ids = [i for i in ids if i]
    return {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def goal_out(db: Session, access: Access, goal: Goal) -> g.GoalOut:
    targets = list(db.scalars(select(GoalTarget).where(GoalTarget.goal_id == goal.id).order_by(GoalTarget.orderindex, GoalTarget.created_at)))
    users = _users(db, list(goal.owner_ids or []) + [t.owner_id for t in targets if t.owner_id])
    outs = []
    for t in targets:
        pct, done, total = target_progress(db, t)
        owner = users.get(t.owner_id) if t.owner_id else None
        outs.append(g.TargetOut(
            id=t.id, name=t.name, kind=t.kind, start_value=t.start_value, target_value=t.target_value, current_value=t.current_value,
            unit=t.unit, task_ids=[uuid.UUID(x) for x in t.task_ids or []], list_ids=[uuid.UUID(x) for x in t.list_ids or []],
            owner=s.UserOut.model_validate(owner) if owner else None, progress=pct, done_tasks=done, total_tasks=total,
        ))
    progress = round(sum(t.progress for t in outs) / len(outs), 1) if outs else 0.0
    on_track = None
    if goal.due_date:
        start = goal.start_date or goal.created_at
        whole = (goal.due_date - start).total_seconds()
        elapsed = (_now() - start).total_seconds()
        expected = 100.0 if whole <= 0 else max(0.0, min(100.0, 100 * elapsed / whole))
        on_track = progress >= 100 or progress + 10 >= expected
    team = db.get(Team, goal.team_id) if goal.team_id else None
    return g.GoalOut(
        id=goal.id, name=goal.name, description=goal.description, color=goal.color, folder=goal.folder,
        team=s.TeamRef(id=team.id, name=team.name, color=team.color) if team else None,
        owners=[s.UserOut.model_validate(users[u]) for u in goal.owner_ids or [] if u in users],
        start_date=goal.start_date, due_date=goal.due_date, is_private=goal.is_private, archived=goal.archived_at is not None,
        progress=progress, on_track=on_track, targets=outs, can_edit=can_edit(db, access, goal), created_by=goal.created_by,
        updated_at=goal.updated_at,
    )


# --- managing -----------------------------------------------------------------------------------


def _members(db: Session, access: Access, ids: Sequence[str]) -> List[str]:
    ids = list(dict.fromkeys(i for i in ids if i))
    if not ids:
        return []
    found = set(db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.user_id.in_(ids))))
    missing = [i for i in ids if i not in found]
    if missing:
        raise Invalid(f"Not members of this workspace: {', '.join(missing)}")
    return ids


def _check_team(db: Session, access: Access, team_id: Optional[uuid.UUID]) -> Optional[uuid.UUID]:
    if team_id is None:
        return None
    team = db.get(Team, team_id)
    if team is None or team.workspace_id != access.workspace_id:
        raise NotFound("Team not found")
    return team.id


def _check_lists(db: Session, access: Access, list_ids: Sequence[uuid.UUID], task_ids: Sequence[uuid.UUID]) -> None:
    from app.services.work.access import open_list, open_task
    from app.db.models import PermissionLevel

    for lid in list_ids:
        opened = open_list(db, access.user_id, lid, PermissionLevel.view)
        if opened.access.workspace_id != access.workspace_id:
            raise NotFound("List not found")
    for tid in task_ids:
        opened = open_task(db, access.user_id, tid, PermissionLevel.view)
        if opened.access.workspace_id != access.workspace_id:
            raise NotFound("Task not found")


def _new_target(db: Session, access: Access, goal: Goal, data: g.TargetIn, position: float) -> GoalTarget:
    _check_lists(db, access, data.list_ids, data.task_ids)
    t = GoalTarget(
        goal_id=goal.id, name=data.name, kind=data.kind,
        start_value=0 if data.kind == "true_false" else data.start_value,
        target_value=1 if data.kind == "true_false" else data.target_value,
        current_value=0 if data.kind == "true_false" else data.start_value,
        unit=data.unit, task_ids=[str(x) for x in data.task_ids], list_ids=[str(x) for x in data.list_ids],
        owner_id=_members(db, access, [data.owner_id])[0] if data.owner_id else None, orderindex=position,
    )
    db.add(t)
    db.flush()
    return t


def create(db: Session, access: Access, data: g.GoalIn) -> Goal:
    if access.role in SHARED_ONLY:
        raise Forbidden("Guests can't create goals")
    if data.start_date and data.due_date and data.due_date < data.start_date:
        raise Invalid("The due date must be on or after the start date")
    goal = Goal(
        workspace_id=access.workspace_id, name=data.name, description=data.description, color=data.color, folder=data.folder,
        team_id=_check_team(db, access, data.team_id), owner_ids=_members(db, access, data.owner_ids or [access.user_id]),
        start_date=data.start_date, due_date=data.due_date, is_private=data.is_private, created_by=access.user_id,
    )
    db.add(goal)
    db.flush()
    for i, t in enumerate(data.targets):
        _new_target(db, access, goal, t, float(i + 1))
    audit.record(db, access.workspace_id, access.user_id, "goal.created", "goal", goal.id, goal.name)
    return goal


def list_goals(db: Session, access: Access, team_id: Optional[uuid.UUID] = None, include_archived: bool = False) -> List[Goal]:
    q = select(Goal).where(Goal.workspace_id == access.workspace_id)
    if team_id is not None:
        q = q.where(Goal.team_id.in_(team_tree.descendants(db, [team_id])))
    if not include_archived:
        q = q.where(Goal.archived_at.is_(None))
    goals = [x for x in db.scalars(q.order_by(Goal.folder.nullsfirst(), Goal.name)) if can_see(db, access, x)]
    return goals


def update(db: Session, user_id: str, goal_id: uuid.UUID, data: g.GoalUpdate) -> tuple:
    goal, access = open_goal(db, user_id, goal_id, edit=True)
    fields = data.model_fields_set
    for name in ("name", "description", "color", "folder", "start_date", "due_date"):
        if name in fields:
            value = getattr(data, name)
            if name in ("name", "color") and value is None:
                raise Invalid(f"{name} can't be empty")
            setattr(goal, name, value)
    if goal.start_date and goal.due_date and goal.due_date < goal.start_date:
        raise Invalid("The due date must be on or after the start date")
    if "team_id" in fields:
        goal.team_id = _check_team(db, access, data.team_id)
    if "owner_ids" in fields and data.owner_ids is not None:
        goal.owner_ids = _members(db, access, data.owner_ids)
    if "is_private" in fields and data.is_private is not None:
        goal.is_private = data.is_private
    if "archived" in fields and data.archived is not None:
        goal.archived_at = _now() if data.archived else None
    db.flush()
    return goal, access


def delete(db: Session, user_id: str, goal_id: uuid.UUID) -> None:
    goal, access = open_goal(db, user_id, goal_id)
    if not (can_manage_workspace(access.role) or goal.created_by == user_id):
        raise Forbidden("Only the goal's creator or an admin can delete it")
    audit.record(db, access.workspace_id, user_id, "goal.deleted", "goal", goal.id, goal.name)
    db.delete(goal)
    db.flush()


def add_target(db: Session, user_id: str, goal_id: uuid.UUID, data: g.TargetIn) -> tuple:
    goal, access = open_goal(db, user_id, goal_id, edit=True)
    top = max([t.orderindex for t in db.scalars(select(GoalTarget).where(GoalTarget.goal_id == goal.id))], default=0.0)
    _new_target(db, access, goal, data, top + 1)
    return goal, access


def _open_target(db: Session, user_id: str, target_id: uuid.UUID, edit: bool) -> tuple:
    t = db.get(GoalTarget, target_id)
    if t is None:
        raise NotFound("Target not found")
    goal, access = open_goal(db, user_id, t.goal_id)
    # A target's own owner may check in on it even if they don't own the goal.
    if edit and not (can_edit(db, access, goal) or t.owner_id == user_id):
        raise Forbidden("Only the goal's owners, the target's owner or an admin can change it")
    return t, goal, access


def update_target(db: Session, user_id: str, target_id: uuid.UUID, data: g.TargetUpdate) -> tuple:
    t, goal, access = _open_target(db, user_id, target_id, edit=True)
    fields = data.model_fields_set
    if "name" in fields and data.name:
        t.name = data.name
    if t.kind in ("number", "currency"):
        if "start_value" in fields and data.start_value is not None:
            t.start_value = data.start_value
        if "target_value" in fields and data.target_value is not None:
            t.target_value = data.target_value
        if t.start_value == t.target_value:
            raise Invalid("The target must differ from the starting value")
    if "unit" in fields:
        t.unit = data.unit
    if t.kind == "tasks":
        if "task_ids" in fields and data.task_ids is not None:
            _check_lists(db, access, [], data.task_ids)
            t.task_ids = [str(x) for x in data.task_ids]
        if "list_ids" in fields and data.list_ids is not None:
            _check_lists(db, access, data.list_ids, [])
            t.list_ids = [str(x) for x in data.list_ids]
        if not (t.task_ids or t.list_ids):
            raise Invalid("Pick the tasks or Lists this target tracks")
    if "owner_id" in fields:
        t.owner_id = _members(db, access, [data.owner_id])[0] if data.owner_id else None
    db.flush()
    return goal, access


def delete_target(db: Session, user_id: str, target_id: uuid.UUID) -> tuple:
    t = db.get(GoalTarget, target_id)
    if t is None:
        raise NotFound("Target not found")
    goal, access = open_goal(db, user_id, t.goal_id, edit=True)
    db.delete(t)
    db.flush()
    return goal, access


def check_in(db: Session, user_id: str, target_id: uuid.UUID, data: g.CheckInIn) -> tuple:
    t, goal, access = _open_target(db, user_id, target_id, edit=True)
    if t.kind == "tasks":
        raise Invalid("A tasks target moves on its own as its tasks are finished")
    value = (1.0 if data.value >= 1 else 0.0) if t.kind == "true_false" else data.value
    t.current_value = value
    db.add(GoalCheckIn(target_id=t.id, user_id=user_id, value=value, note=data.note))
    goal.updated_at = _now()
    db.flush()
    return goal, access


def check_ins(db: Session, user_id: str, target_id: uuid.UUID) -> List[g.CheckInOut]:
    t, _, _ = _open_target(db, user_id, target_id, edit=False)
    rows = list(db.scalars(select(GoalCheckIn).where(GoalCheckIn.target_id == t.id).order_by(GoalCheckIn.created_at.desc()).limit(200)))
    users = _users(db, [r.user_id for r in rows if r.user_id])
    return [g.CheckInOut(id=r.id, user=s.UserOut.model_validate(users[r.user_id]) if r.user_id in users else None,
                         value=r.value, note=r.note, created_at=r.created_at) for r in rows]


def goal_summaries(db: Session, access: Access, goal_ids: Sequence[uuid.UUID]) -> List[g.GoalOut]:
    """For the Goals dashboard card: the goals the viewer may see, in the order asked."""
    out = []
    for gid in goal_ids:
        goal = db.get(Goal, gid)
        if goal is not None and goal.archived_at is None and can_see(db, access, goal):
            out.append(goal_out(db, access, goal))
    return out

