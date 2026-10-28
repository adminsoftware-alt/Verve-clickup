"""What needs attention on a Dashboard, said in a few lines rather than read off eight cards.

The cards answer "how much"; this answers "so what". So it does not repeat a card: what is due
today, what is overdue, the hours logged this week and what was finished all have a card of their
own on every standard board, and saying them again here only made the panel longer. What it says
instead is what no card can:

  * your day -- what starts today or should have, a task past its estimate, a timer left
    running, unread @mentions and reminders, recurring work this week, next week (on Fridays);
  * your Team -- who is overloaded this week, who logged nothing yesterday, timesheets waiting
    for a decision or not sent, work held up by a late task, who has the most overdue work;
  * the firm -- birthdays and work anniversaries, holidays this week, goals behind target.

It is worked out from the same tasks the cards are -- the board's own scope and filters, the
viewer's permissions -- so a highlight never mentions work the cards beneath it do not count.
"""

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlalchemy import select

from app.db.models import (
    DashboardCard,
    Goal,
    GoalTarget,
    Holiday,
    Notification,
    Reminder,
    Status,
    StatusGroup,
    Task,
    TaskLink,
    TeamMember,
    TimeEntry,
    WorkspaceMember,
)
from app.schemas import dashboards as d
from app.services.work.dashboards.engine import FINISHED, Engine, Facts
from app.services.work.permissions import can_manage_workspace

#: Tasks shown under each heading; the count says how many there are in all.
SAMPLE = 5
#: In progress and untouched for this long reads as stuck rather than slow.
STALE_DAYS = 7
#: Urgent or high priority, not started, and due within this many days.
URGENT_WITHIN_DAYS = 3
#: A goal this far behind where the calendar says it should be is "behind".
GOAL_SLACK = 0.10
MENTION_KINDS = ("mentioned", "chat_mention", "mentions")


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


def _who(engine: Engine) -> Tuple[Optional[Set[str]], str]:
    """Whose board this is, as people the viewer may see the time of, and how to say it.

    Its owner on a personal board, its Team on a Team board, nobody in particular (None) on a
    company board."""
    people: Optional[Set[str]] = None
    if engine.scope.assignees:
        people, _ = engine._people(engine.scope.assignees)
    visible = engine.time_people()
    if people is not None and visible is not None:
        people &= visible
    me = engine.access.user_id
    who = (
        "everyone" if people is None
        else "me" if people == {me}
        else "person" if len(people) == 1
        else "team"
    )
    return people, who


def compute(engine: Engine, cards: List[DashboardCard]) -> Dict[str, Any]:
    config = d.CardConfig(sources=_sources(cards))
    loaded = engine.load(config)
    open_facts = [f for f in engine.matching(config, loaded) if f.group not in FINISHED]
    today = engine.today
    start_of_today = engine._at(today)
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    yesterday = today - timedelta(days=1)
    people, who = _who(engine)

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

    def day(value: Optional[datetime]) -> Optional[date]:
        return engine._local_day(value) if value is not None else None

    # --- your day ---------------------------------------------------------------------------
    not_started = [f for f in open_facts if f.group == StatusGroup.not_started]
    starts_today = [f for f in not_started if day(f.task.start_date) == today]
    late_start = sorted(
        (f for f in not_started if f.task.start_date is not None and day(f.task.start_date) < today),
        key=lambda f: f.task.start_date,
    )
    over_estimate = sorted(
        (f for f in open_facts if f.task.time_estimate_seconds and f.tracked > f.task.time_estimate_seconds),
        key=lambda f: -f.tracked / f.task.time_estimate_seconds,
    )
    recurring = sorted(
        (f for f in open_facts
         if f.task.recurrence and f.task.due_date is not None and today <= day(f.task.due_date) <= week_end),
        key=lambda f: f.task.due_date,
    )
    stale_before = engine.now - timedelta(days=STALE_DAYS)
    stuck = sorted(
        (f for f in open_facts if f.group == StatusGroup.active and f.task.updated_at < stale_before),
        key=lambda f: f.task.updated_at,
    )
    soon = today + timedelta(days=URGENT_WITHIN_DAYS)
    urgent = sorted(
        (f for f in not_started
         if f.task.priority in (1, 2) and f.task.due_date is not None and today <= day(f.task.due_date) <= soon),
        key=lambda f: (f.task.due_date, f.task.priority),
    )
    next_week = None
    if today.weekday() >= 4:  # Friday, or the weekend: the week ahead is the question now
        nxt = [f for f in open_facts if f.task.due_date is not None
               and week_end < day(f.task.due_date) <= week_end + timedelta(days=7)]
        next_week = {"count": len(nxt), "estimate": sum(f.task.time_estimate_seconds or 0 for f in nxt)}

    # Who furthest behind on overdue work, only where the board is about more than one person.
    overdue = [f for f in open_facts if f.task.due_date is not None and f.task.due_date < start_of_today]
    behind: Dict[str, int] = {}
    for f in overdue:
        for uid in f.assignees:
            behind[uid] = behind.get(uid, 0) + 1
    several = who in ("team", "everyone") and len({uid for f in open_facts for uid in f.assignees}) > 1
    people_behind = (
        [{"user": engine._person(uid), "overdue": n} for uid, n in sorted(behind.items(), key=lambda x: -x[1])[:SAMPLE]]
        if several else []
    )

    out: Dict[str, Any] = {
        "who": who,
        "who_name": engine._person(next(iter(people))).get("display_name") if who == "person" and people else None,
        "open": len(open_facts),
        "starts_today": section([row(f) for f in starts_today]),
        "late_start": section([row(f, days_late=(today - day(f.task.start_date)).days) for f in late_start]),
        "over_estimate": section([row(f, tracked=f.tracked, estimate=f.task.time_estimate_seconds) for f in over_estimate]),
        "recurring_this_week": section([row(f) for f in recurring]),
        "stuck": section([row(f, days_idle=(engine.now - f.task.updated_at).days) for f in stuck]),
        "urgent_soon": section([row(f) for f in urgent]),
        "next_week": next_week,
        "no_due_date": sum(1 for f in open_facts if f.task.due_date is None),
        "no_estimate": sum(1 for f in open_facts if f.task.time_estimate_seconds is None),
        "unassigned": sum(1 for f in open_facts if not f.assignees),
        "people_behind": people_behind,
        **_timers(engine, people, start_of_today),
        **_inbox(engine, who, today),
        **_blocked(engine, open_facts, start_of_today, row),
        # Birthdays, holidays and goals are the whole firm's news: the Company board's alone. A
        # personal or Team board keeps to its own people.
        **(_firm(engine, today, week_end) if who == "everyone"
           else {"birthdays": [], "anniversaries": [], "holidays_this_week": [], "goals_behind": []}),
    }
    if several:
        out.update(_team(engine, open_facts, people, today, yesterday, week_start, week_end))
    elif who == "me" and _led(engine):
        # A Manager's own board still tells them about their people: who logged nothing, whose
        # timesheet waits. Planned hours need the people's own tasks, so overload is left to
        # the Team board.
        out.update(_team(engine, [], _led(engine), today, yesterday, week_start, week_end))
        out["overloaded"] = []
    else:
        out.update({"overloaded": [], "no_time_yesterday": [], "timesheets_waiting": [], "timesheets_missing": []})
    out.update(_yesterday(engine, config, loaded, people, yesterday))
    return out


def _led(engine: Engine) -> Set[str]:
    """The people a Manager may see the time of, without themselves. Empty for an Employee, and
    for an Admin, who sees everyone and has the Company board for that."""
    visible = engine.time_people()
    if visible is None:
        return set()
    return visible - {engine.access.user_id}


# --- your day ---------------------------------------------------------------------------------


def _timers(engine: Engine, people: Optional[Set[str]], start_of_today: datetime) -> Dict[str, Any]:
    """Timers still running from before today: almost always someone forgot to stop one."""
    visible = engine.time_people()
    query = (
        select(TimeEntry, Task)
        .join(Task, Task.id == TimeEntry.task_id)
        .join(WorkspaceMember, (WorkspaceMember.user_id == TimeEntry.user_id) & (WorkspaceMember.workspace_id == engine.access.workspace_id))
        .where(TimeEntry.ended_at.is_(None), TimeEntry.started_at < start_of_today)
    )
    wanted = people if people is not None else visible
    if wanted is not None:
        query = query.where(TimeEntry.user_id.in_(wanted))
    rows = engine.db.execute(query.order_by(TimeEntry.started_at)).all()
    return {"running_timers": [
        {"user": engine._person(e.user_id), "task_id": str(t.id), "task_name": t.name, "list_id": str(t.list_id),
         "since": e.started_at.isoformat()}
        for e, t in rows[:SAMPLE]
    ]}


def _inbox(engine: Engine, who: str, today: date) -> Dict[str, Any]:
    """Unread @mentions and today's reminders -- only on your own board; they are yours alone."""
    if who != "me":
        return {"mentions_unread": 0, "reminders_today": []}
    me, ws = engine.access.user_id, engine.access.workspace_id
    mentions = engine.db.scalars(
        select(Notification.id).where(
            Notification.workspace_id == ws, Notification.user_id == me, Notification.kind.in_(MENTION_KINDS),
            Notification.read_at.is_(None), Notification.cleared_at.is_(None),
        )
    ).all()
    start, end = engine._at(today), engine._at(today + timedelta(days=1))
    reminders = engine.db.scalars(
        select(Reminder).where(
            Reminder.workspace_id == ws, Reminder.user_id == me, Reminder.done_at.is_(None),
            Reminder.remind_at >= start, Reminder.remind_at < end,
        ).order_by(Reminder.remind_at)
    ).all()
    return {
        "mentions_unread": len(mentions),
        "reminders_today": [{"title": r.title, "at": r.remind_at.isoformat(), "task_id": str(r.task_id) if r.task_id else None}
                            for r in reminders[:SAMPLE]],
    }


def _blocked(engine: Engine, open_facts: List[Facts], start_of_today: datetime, row) -> Dict[str, Any]:
    """Work on this board that is waiting on a task that is itself late."""
    waiting = {f.task.id: f for f in open_facts}
    if not waiting:
        return {"blocked_by_late": {"count": 0, "tasks": []}}
    links = engine.db.execute(
        select(TaskLink.other_id, Task, Status)
        .join(Task, Task.id == TaskLink.task_id)
        .join(Status, Status.id == Task.status_id)
        .where(TaskLink.kind == "blocks", TaskLink.other_id.in_(list(waiting)))
    ).all()
    found: Dict[Any, Dict[str, Any]] = {}
    for other_id, blocker, status in links:
        late = blocker.due_date is not None and blocker.due_date < start_of_today and status.group not in FINISHED
        if late and other_id not in found:
            found[other_id] = row(waiting[other_id], waiting_on=blocker.name)
    items = list(found.values())
    return {"blocked_by_late": {"count": len(items), "tasks": items[:SAMPLE]}}


# --- your Team --------------------------------------------------------------------------------


def _team(engine: Engine, open_facts: List[Facts], people: Optional[Set[str]], today: date, yesterday: date,
          week_start: date, week_end: date) -> Dict[str, Any]:
    from app.db.models import TimesheetSubmission
    from app.services.work.workload import spread
    visible = engine.time_people()
    crew = set(people) if people is not None else {uid for f in open_facts for uid in f.assignees}
    if visible is not None:
        crew &= visible
    if not crew:
        return {"overloaded": [], "no_time_yesterday": [], "timesheets_waiting": [], "timesheets_missing": []}
    db, ws = engine.db, engine.access.workspace_id
    week = [week_start + timedelta(days=i) for i in range(7)]
    last_week = [week_start - timedelta(days=7 - i) for i in range(7)]
    found = engine.daily_capacity(sorted(crew), week + last_week + [yesterday])
    capacity = {uid: found.get(uid) or [0] * 15 for uid in crew}

    # This week's planned hours per person, spread over their working days as Workload does.
    weekdays = engine.working_weekdays(sorted(crew))
    planned: Dict[str, int] = {uid: 0 for uid in crew}
    for f in open_facts:
        begins = f.task.start_date or f.task.due_date
        ends = f.task.due_date or f.task.start_date
        if not f.task.time_estimate_seconds or begins is None or ends is None:
            continue
        for uid in f.assignees:
            if uid not in planned:
                continue
            per_day = spread(f.task.time_estimate_seconds, engine._local_day(begins), engine._local_day(ends), weekdays.get(uid))
            planned[uid] += sum(v for dd, v in per_day.items() if week_start <= dd <= week_end)
    overloaded = sorted(
        ({"user": engine._person(uid), "planned": planned[uid], "capacity": sum(capacity[uid][:7])}
         for uid in crew if sum(capacity[uid][:7]) and planned[uid] > sum(capacity[uid][:7])),
        key=lambda x: x["capacity"] - x["planned"],
    )

    # Nothing logged yesterday, by people who were meant to be working.
    start, end = engine._at(yesterday), engine._at(today)
    logged = set(db.scalars(select(TimeEntry.user_id).where(
        TimeEntry.user_id.in_(crew), TimeEntry.started_at >= start, TimeEntry.started_at < end)))
    idle = sorted((uid for uid in crew if capacity[uid][14] and uid not in logged),
                  key=lambda uid: (engine._person(uid).get("display_name") or ""))

    # Timesheets: waiting for a decision, and -- once the firm uses them at all -- last week not sent.
    waiting = db.scalars(select(TimesheetSubmission).where(
        TimesheetSubmission.workspace_id == ws, TimesheetSubmission.user_id.in_(crew), TimesheetSubmission.status == "pending",
    ).order_by(TimesheetSubmission.period_start)).all()
    missing: List[str] = []
    in_use = db.scalar(select(TimesheetSubmission.id).where(TimesheetSubmission.workspace_id == ws).limit(1)) is not None
    if in_use:
        sent = set(db.scalars(select(TimesheetSubmission.user_id).where(
            TimesheetSubmission.workspace_id == ws, TimesheetSubmission.user_id.in_(crew),
            TimesheetSubmission.status != "withdrawn",
            TimesheetSubmission.period_start <= last_week[-1], TimesheetSubmission.period_end >= last_week[0],
        )))
        missing = [uid for uid in crew if uid not in sent and sum(capacity[uid][7:14])]
    return {
        "overloaded": overloaded[:SAMPLE],
        "no_time_yesterday": [engine._person(uid) for uid in idle][:8],
        "no_time_yesterday_count": len(idle),
        "timesheets_waiting": [{"user": engine._person(s.user_id), "period_start": s.period_start.isoformat(),
                                "period_end": s.period_end.isoformat()} for s in waiting[:SAMPLE]],
        "timesheets_missing": [engine._person(uid) for uid in missing][:8],
        "timesheets_missing_count": len(missing),
    }


def _yesterday(engine: Engine, config: d.CardConfig, loaded: Any, people: Optional[Set[str]], yesterday: date) -> Dict[str, Any]:
    """Hours logged yesterday against the hours there were. No card says "yesterday"; the time
    cards cover the board's period. Only hours the viewer may see are counted."""
    window = config.model_copy(update={"period": d.Period(preset="custom", start=yesterday, end=yesterday)})
    entries, _, _ = engine._entries(window, loaded)
    out: Dict[str, Any] = {"logged_yesterday": sum(e.duration_seconds or 0 for e, _ in entries), "capacity_yesterday": None}
    if people:
        per = engine.daily_capacity(sorted(people), [yesterday])
        out["capacity_yesterday"] = sum(v[0] for v in per.values())
    return out


# --- the firm ---------------------------------------------------------------------------------


def _firm(engine: Engine, today: date, week_end: date) -> Dict[str, Any]:
    db, ws = engine.db, engine.access.workspace_id
    birthdays: List[Dict[str, Any]] = []
    anniversaries: List[Dict[str, Any]] = []
    for m in db.scalars(select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == ws, WorkspaceMember.deactivated_at.is_(None))):
        if m.date_of_birth and (m.date_of_birth.month, m.date_of_birth.day) == (today.month, today.day):
            birthdays.append(engine._person(m.user_id))
        joined = m.date_of_joining
        if joined and (joined.month, joined.day) == (today.month, today.day) and joined.year < today.year:
            anniversaries.append({"user": engine._person(m.user_id), "years": today.year - joined.year})
    holidays = db.scalars(select(Holiday).where(
        Holiday.workspace_id == ws, Holiday.day >= today, Holiday.day <= week_end).order_by(Holiday.day)).all()
    return {
        "birthdays": birthdays,
        "anniversaries": anniversaries,
        "holidays_this_week": [{"name": h.name, "day": h.day.isoformat()} for h in holidays],
        "goals_behind": _goals_behind(engine),
    }


def _goals_behind(engine: Engine) -> List[Dict[str, Any]]:
    """Goals the viewer can see that are further behind than the calendar says they should be."""
    db, access = engine.db, engine.access
    my_teams = set(db.scalars(select(TeamMember.team_id).where(TeamMember.user_id == access.user_id)))
    admin = can_manage_workspace(access.role)
    out = []
    for g in db.scalars(select(Goal).where(Goal.workspace_id == access.workspace_id, Goal.archived_at.is_(None))):
        mine = access.user_id in (g.owner_ids or []) or (g.team_id is not None and g.team_id in my_teams)
        if (g.is_private and not mine) or (not admin and not mine and g.team_id is not None):
            continue
        if g.start_date is None or g.due_date is None or g.due_date <= g.start_date or engine.now < g.start_date:
            continue
        targets = db.scalars(select(GoalTarget).where(GoalTarget.goal_id == g.id)).all()
        if not targets:
            continue
        shares = []
        for t in targets:
            span = (t.target_value - t.start_value) or 1
            shares.append(max(0.0, min(1.0, (t.current_value - t.start_value) / span)))
        progress = sum(shares) / len(shares)
        expected = min(1.0, (engine.now - g.start_date) / (g.due_date - g.start_date))
        if progress + GOAL_SLACK < expected:
            out.append({"id": str(g.id), "name": g.name, "progress": round(progress, 2), "expected": round(expected, 2)})
    return sorted(out, key=lambda x: x["progress"] - x["expected"])[:SAMPLE]


# --- the same, as plain sentences, for the morning email ------------------------------------------


def _n(count: int, one: str, many: Optional[str] = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


def _hours(seconds: int) -> str:
    h, m = divmod(int(seconds) // 60, 60)
    return f"{h}h {m}m" if h and m else f"{h}h" if h else f"{m}m"


def _name(person: Dict[str, Any]) -> str:
    return person.get("display_name") or person.get("email") or "Someone"


def sentences(x: Dict[str, Any]) -> List[str]:
    """Highlights as lines of text, in the order the panel shows them."""
    you = x.get("who") == "me"
    out: List[str] = []
    if x["starts_today"]["count"]:
        out.append(f"{_n(x['starts_today']['count'], 'task')} start{'s' if x['starts_today']['count'] == 1 else ''} today.")
    if x["late_start"]["count"]:
        out.append(f"{_n(x['late_start']['count'], 'task')} should have started and {'hasn' if x['late_start']['count'] == 1 else 'haven'}'t.")
    if x["urgent_soon"]["count"]:
        out.append(f"{_n(x['urgent_soon']['count'], 'urgent task')} due in the next 3 days {'is' if x['urgent_soon']['count'] == 1 else 'are'} not started yet.")
    for t in x["over_estimate"]["tasks"][:3]:
        out.append(f"{t['name']}: {_hours(t['tracked'])} logged of a {_hours(t['estimate'])} estimate.")
    for timer in x["running_timers"][:3]:
        out.append(f"{'Your' if you else _name(timer['user']) + chr(39) + 's'} timer on {timer['task_name']} has been running since before today.")
    if x.get("mentions_unread"):
        out.append(f"You have {_n(x['mentions_unread'], 'unread @mention')}.")
    for r in x.get("reminders_today", [])[:3]:
        out.append(f"Reminder today: {r['title']}.")
    if x["recurring_this_week"]["count"]:
        out.append(f"{_n(x['recurring_this_week']['count'], 'recurring task')} come{'s' if x['recurring_this_week']['count'] == 1 else ''} up this week.")
    if x["stuck"]["count"]:
        out.append(f"{_n(x['stuck']['count'], 'task')} in progress {'has' if x['stuck']['count'] == 1 else 'have'} had no update for over a week.")
    if x.get("next_week") and x["next_week"]["count"]:
        out.append(f"Next week: {_n(x['next_week']['count'], 'task')} due, about {_hours(x['next_week']['estimate'])} of work.")
    if x.get("capacity_yesterday") and not x.get("logged_yesterday") and you:
        out.append("You logged no time yesterday. Fill in your timesheet while the day is fresh.")
    for p in x.get("overloaded", [])[:3]:
        out.append(f"{_name(p['user'])} has {_hours(p['planned'])} planned this week, against {_hours(p['capacity'])}.")
    if x.get("no_time_yesterday"):
        out.append("Logged nothing yesterday: " + ", ".join(_name(p) for p in x["no_time_yesterday"][:5]) + ".")
    if x.get("timesheets_waiting"):
        out.append(f"{_n(len(x['timesheets_waiting']), 'timesheet')} waiting for approval.")
    if x.get("timesheets_missing"):
        out.append("Last week's timesheet not sent: " + ", ".join(_name(p) for p in x["timesheets_missing"][:5]) + ".")
    if x["blocked_by_late"]["count"]:
        out.append(f"{_n(x['blocked_by_late']['count'], 'task')} {'is' if x['blocked_by_late']['count'] == 1 else 'are'} waiting on a task that is late.")
    for p in x.get("birthdays", []):
        out.append(f"It's {_name(p)}'s birthday today.")
    for a in x.get("anniversaries", []):
        out.append(f"{_name(a['user'])} joined {_n(a['years'], 'year')} ago today.")
    for h in x.get("holidays_this_week", []):
        out.append(f"Holiday: {h['name']} on {date.fromisoformat(h['day']).strftime('%A %d %b')}.")
    for g in x.get("goals_behind", [])[:3]:
        out.append(f"Goal behind: {g['name']} is {round(g['progress'] * 100)}% done, {round(g['expected'] * 100)}% of the time gone.")
    return out
