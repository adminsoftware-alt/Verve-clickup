"""What a new task should already be filled in with.

Every typed-in task has to carry an assignee, dates, an estimate and a priority. That is what
makes the Dashboards trustworthy, but it also means five decisions before anyone can write down
"chase the Unimed bills". This works the answers out from what the List has done before, so the
create dialog opens with them and the person only corrects what is wrong.

Nothing here writes anything: it is a suggestion, and the caller is free to ignore it.
"""

import re
from statistics import median
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Status, StatusGroup, Task, TaskList
from app.services.work.access import Access

# How many past tasks are enough to trust a median. Below this we would be guessing from noise.
MIN_SAMPLE = 2
LOOKBACK = 400


def _words(name: str) -> List[str]:
    """The meaningful words of a task name, lowercased.

    Client names change every month ("File Bluepeak GSTR-3B" / "File Unimed GSTR-3B") but the
    work does not, so matching on the shared words finds the right history.
    """
    return [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) > 2]


def _looks_like(a: List[str], b: List[str]) -> bool:
    """True when two task names describe the same kind of work.

    Two thirds of the shorter name's words in common: enough to tie this month's GST filing to
    last month's, and not enough to tie it to a payroll run.
    """
    if not a or not b:
        return False
    shared = len(set(a) & set(b))
    return shared >= max(2, int(0.66 * min(len(a), len(b))))


def suggest(
    db: Session, access: Access, lst: TaskList, name: Optional[str] = None,
) -> Dict[str, Any]:
    """Defaults for a new task in this List, from what has been done in it before."""
    rows = list(db.execute(
        select(Task, Status.group)
        .join(Status, Status.id == Task.status_id)
        .where(Task.list_id == lst.id, Task.time_estimate_seconds.is_not(None), Task.archived_at.is_(None))
        .order_by(Task.created_at.desc())
        .limit(LOOKBACK)
    ).all())

    estimates = [t.time_estimate_seconds for t, _ in rows if t.time_estimate_seconds]
    priorities = [t.priority for t, _ in rows if t.priority]

    # A name match beats the List average: "File Bluepeak GSTR-3B" has been done eight times, and
    # what it took those times is a far better guess than what the List averages.
    basis = "list"
    if name and name.strip():
        wanted = _words(name)
        alike = [t.time_estimate_seconds for t, _ in rows
                 if t.time_estimate_seconds and _looks_like(wanted, _words(t.name))]
        if len(alike) >= MIN_SAMPLE:
            estimates = alike
            basis = "similar"

    estimate = int(median(estimates)) if len(estimates) >= MIN_SAMPLE else None
    # Round to the nearest quarter hour: a suggestion of 1h 52m 30s is false precision.
    if estimate:
        estimate = max(900, round(estimate / 900) * 900)

    # Days rather than dates: the caller knows the viewer's timezone, so it sets start = today
    # and due = today + days_to_due itself.
    return {
        "time_estimate_seconds": estimate,
        "estimate_basis": basis if estimate else None,
        "estimate_from": len(estimates) if estimate else 0,
        "priority": int(median(sorted(priorities))) if len(priorities) >= MIN_SAMPLE else 3,
        "assignees": [access.user_id],
        "days_to_due": _typical_span(rows),
    }


def _typical_span(rows) -> int:
    """How many days this List usually gives itself between starting and being due."""
    spans = [
        (t.due_date - t.start_date).days
        for t, _ in rows
        if t.start_date is not None and t.due_date is not None and t.due_date >= t.start_date
    ]
    if len(spans) < MIN_SAMPLE:
        return 2
    return max(0, min(30, int(median(spans))))
