"""Time in Status, as in ClickUp: how long a task has spent in each status, from its activity history."""

from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Status, Task, TaskActivity, TaskList
from app.schemas import spaces as sp
from app.services.work.access import Opened
from app.services.work.statuses import effective_statuses


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def time_in_status(db: Session, opened: Opened[Task], now: Optional[datetime] = None) -> sp.TimeInStatus:
    task = opened.obj
    now = now or datetime.now(timezone.utc)
    current = db.get(Status, task.status_id)
    lst = db.get(TaskList, task.list_id)
    colors: Dict[str, Optional[str]] = {st.name.lower(): st.color for st in effective_statuses(db, lst)} if lst else {}
    changes = list(db.scalars(
        select(TaskActivity).where(TaskActivity.task_id == task.id, TaskActivity.kind == "status").order_by(TaskActivity.created_at)
    ))
    first = (changes[0].data or {}).get("from") if changes else None
    name = first or (current.name if current else "")
    since = _as_utc(task.created_at)
    spells: List[sp.StatusSpell] = []
    for change in changes:
        at = _as_utc(change.created_at)
        spells.append(sp.StatusSpell(status=name, color=colors.get(name.lower()), since=since, until=at,
                                     seconds=max(0, int((at - since).total_seconds()))))
        data = change.data or {}
        name = data.get("to") or name
        if data.get("color") and name.lower() not in colors:
            colors[name.lower()] = data["color"]
        since = at
    spells.append(sp.StatusSpell(status=name, color=colors.get(name.lower()), since=since, until=None,
                                 seconds=max(0, int((now - since).total_seconds()))))
    totals: Dict[str, sp.StatusTotal] = {}
    for spell in spells:
        key = spell.status.lower()
        if key not in totals:
            totals[key] = sp.StatusTotal(status=spell.status, color=spell.color, seconds=0, times=0)
        totals[key].seconds += spell.seconds
        totals[key].times += 1
    return sp.TimeInStatus(current=current.name if current else name, spells=spells, totals=list(totals.values()))
