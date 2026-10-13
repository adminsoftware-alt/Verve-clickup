"""What needs attention on a Dashboard, said in a few lines rather than read off eight cards.

The cards answer "how much"; this answers "so what". It is worked out from the same tasks the
cards are -- the board's own scope and filters, the viewer's permissions -- so a highlight can
never mention work the cards beneath it do not count.

Each heading is one question a person opening their board in the morning actually has:
what is late, what is due today, what has stalled, what urgent thing is about to be late, what
is missing the details that would let it be planned, and -- on a board about several people --
who is furthest behind.
"""

from datetime import timedelta
from typing import Any, Dict, List

from app.db.models import DashboardCard, StatusGroup
from app.schemas import dashboards as d
from app.services.work.dashboards.engine import FINISHED, Engine, Facts

#: Tasks shown under each heading; the count says how many there are in all.
SAMPLE = 5
#: In progress and untouched for this long reads as stuck rather than slow.
STALE_DAYS = 7
#: Urgent or high priority, not started, and due within this many days.
URGENT_WITHIN_DAYS = 3


def _sources(cards: List[DashboardCard]) -> List[d.Source]:
    """Where the board's cards read from. One card reading everywhere means everywhere."""
    found: Dict[tuple, d.Source] = {}
    for card in cards:
        config = d.CardConfig.model_validate(card.config)
        if not config.sources:
            return []
        for src in config.sources:
            found[(src.kind.value, str(src.id))] = src
    return list(found.values())


def compute(engine: Engine, cards: List[DashboardCard]) -> Dict[str, Any]:
    config = d.CardConfig(sources=_sources(cards))
    loaded = engine.load(config)
    open_facts = [f for f in engine.matching(config, loaded) if f.group not in FINISHED]
    today = engine.today
    start_of_today = engine._at(today)

    def row(f: Facts, **extra: Any) -> Dict[str, Any]:
        return {
            "id": str(f.task.id), "name": f.task.name, "list_id": str(f.task.list_id),
            "priority": f.task.priority,
            "due_date": f.task.due_date.isoformat() if f.task.due_date else None,
            "assignees": [engine._person(uid) for uid in f.assignees],
            **extra,
        }

    def section(items: List[Dict[str, Any]]) -> Dict[str, Any]:
        return {"count": len(items), "tasks": items[:SAMPLE]}

    overdue = sorted(
        (f for f in open_facts if f.task.due_date is not None and f.task.due_date < start_of_today),
        key=lambda f: f.task.due_date,
    )
    due_today = [f for f in open_facts if f.task.due_date is not None and engine._local_day(f.task.due_date) == today]
    stale_before = engine.now - timedelta(days=STALE_DAYS)
    stuck = sorted(
        (f for f in open_facts if f.group == StatusGroup.active and f.task.updated_at < stale_before),
        key=lambda f: f.task.updated_at,
    )
    soon = today + timedelta(days=URGENT_WITHIN_DAYS)
    urgent = sorted(
        (f for f in open_facts
         if f.task.priority in (1, 2) and f.group == StatusGroup.not_started
         and f.task.due_date is not None and today <= engine._local_day(f.task.due_date) <= soon),
        key=lambda f: (f.task.due_date, f.task.priority),
    )

    # Who is furthest behind, only where the board is about more than one person.
    behind: Dict[str, int] = {}
    for f in overdue:
        for uid in f.assignees:
            behind[uid] = behind.get(uid, 0) + 1
    people_behind = (
        [{"user": engine._person(uid), "overdue": n} for uid, n in sorted(behind.items(), key=lambda x: -x[1])[:SAMPLE]]
        if len({uid for f in open_facts for uid in f.assignees}) > 1 else []
    )

    week_start = today - timedelta(days=today.weekday())
    done_this_week = sum(
        1 for f in engine.matching(config, loaded, force_closed=True)
        if f.group in FINISHED and (f.task.date_done or f.task.date_closed) is not None
        and engine._local_day(f.task.date_done or f.task.date_closed) >= week_start
    )

    return {
        "open": len(open_facts),
        "overdue": section([row(f, days_late=(today - engine._local_day(f.task.due_date)).days) for f in overdue]),
        "due_today": section([row(f) for f in due_today]),
        "stuck": section([row(f, days_idle=(engine.now - f.task.updated_at).days) for f in stuck]),
        "urgent_soon": section([row(f) for f in urgent]),
        "no_due_date": sum(1 for f in open_facts if f.task.due_date is None),
        "no_estimate": sum(1 for f in open_facts if f.task.time_estimate_seconds is None),
        "unassigned": sum(1 for f in open_facts if not f.assignees),
        "people_behind": people_behind,
        "done_this_week": done_this_week,
    }
