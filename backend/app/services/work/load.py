"""How full someone's days already are, for the moment before you hand them more work.

Assigning is where overload is created, and it is the one moment nobody can see it: the person
doing the assigning is looking at a task, not at the other person's week. This answers that
question in the picker itself.

It reads the same way everything else does -- only work the *viewer* can open is counted -- so it
never leaks a task someone is not allowed to see. That also means the numbers can understate a
person's real load, which the caller should say out loud rather than pretend otherwise.
"""

import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PermissionLevel, Space, TaskAssignee, TaskList
from app.services.work.access import Access, Opened, chain_for_space
from app.services.work.permissions import Node
from app.services.work.tasks import TaskFilter, visible_lists, visible_tasks
from app.services.work.workload import spread

MAX_DAYS = 31
CAPACITY_SECONDS = 8 * 3600  # per working day, as everywhere else


def _all_lists(db: Session, access: Access) -> List[Tuple[TaskList, List[Node]]]:
    """Every List the viewer can open, across the workspace."""
    lists: List[Tuple[TaskList, List[Node]]] = []
    seen: set = set()
    spaces = db.scalars(
        select(Space).where(
            Space.workspace_id == access.workspace_id,
            Space.personal_owner_id.is_(None),
            Space.archived_at.is_(None),
        )
    )
    for space in spaces:
        level = access.level(chain_for_space(space))
        if level is None:
            continue
        for lst, chain in visible_lists(db, Opened(space, access, level)):
            if lst.id not in seen:
                seen.add(lst.id)
                lists.append((lst, chain))
    return lists


def people_load(
    db: Session, access: Access, user_ids: Sequence[str], start: date, days: int,
) -> Dict[str, Any]:
    """Planned hours per day for these people, against the hours they have."""
    days = max(1, min(days, MAX_DAYS))
    window = [start + timedelta(days=i) for i in range(days)]
    wanted = list(dict.fromkeys(user_ids))[:20]
    planned: Dict[str, List[int]] = {uid: [0] * days for uid in wanted}
    if not wanted:
        return {"days": [d.isoformat() for d in window], "rows": []}

    lists = _all_lists(db, access)
    tasks, _, groups = visible_tasks(db, access, lists, TaskFilter())
    from app.db.models import StatusGroup

    open_now = [t for t in tasks if groups.get(t.id) in (StatusGroup.not_started, StatusGroup.active)]
    if open_now:
        by_task: Dict[uuid.UUID, List[str]] = {}
        for task_id, user_id in db.execute(
            select(TaskAssignee.task_id, TaskAssignee.user_id).where(
                TaskAssignee.task_id.in_([t.id for t in open_now]),
                TaskAssignee.user_id.in_(wanted),
            )
        ):
            by_task.setdefault(task_id, []).append(user_id)

        inside = set(window)
        for task in open_now:
            who = by_task.get(task.id)
            estimate = task.time_estimate_seconds or 0
            if not who or not estimate or task.due_date is None:
                continue  # work nobody sized or dated cannot be placed in a day
            end = task.due_date.date()
            begin = task.start_date.date() if task.start_date else end
            by_day = spread(estimate, begin, end)
            share = len(who)
            for uid in who:
                row = planned[uid]
                for i, day in enumerate(window):
                    if day in inside:
                        row[i] += by_day.get(day, 0) // share

    from app.services.work.leave import daily_capacity

    capacity = daily_capacity(db, access.workspace_id, wanted, window)
    fallback = [CAPACITY_SECONDS if d.weekday() < 5 else 0 for d in window]
    rows = [
        {
            "user_id": uid,
            "planned_per_day": planned[uid],
            "capacity_per_day": capacity.get(uid) or fallback,
            "planned_total": sum(planned[uid]),
            "capacity_total": sum(capacity.get(uid) or fallback),
        }
        for uid in wanted
    ]
    return {"days": [d.isoformat() for d in window], "rows": rows}
