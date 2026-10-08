"""Recurring tasks, following ClickUp's model.

A task carries its repeat rule (schemas.work.Recurrence). The next occurrence is made:
  * on_done:     when the task moves into a done or closed status, or
  * on_schedule: when the task falls due, whatever its status (a background job).
It is either a new copy of the task (name, description, assignees, tags, priority,
estimate, group) with dates moved forward, or, for "reopen", the same task moved forward
and set back to its List's first status.

Dates move in the rule's timezone, so "the 1st of each month" stays the 1st locally.
Occurrences that would already be in the past are skipped, so finishing a daily task a
week late creates one task for today, not seven. That skipping is what sync_to_due means:
the series keeps its original rhythm. Turn it off, or use the days_after frequency, and
each occurrence is measured from the day the one before it was actually finished instead.
"""

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Checklist, ChecklistItem, Status, StatusGroup, Task, TaskAssignee, TaskList, TaskTag
from app.services.work import customfields, extras
from app.schemas import work as s
from app.services.work.errors import Invalid
from app.services.work.statuses import OPEN_GROUPS, apply_group_transition, default_status, effective_statuses

log = logging.getLogger(__name__)
FINISHED = (StatusGroup.done, StatusGroup.closed)
MAX_STEPS = 2000


def _next_seq(db: Session, task: Task) -> int:
    from app.services.work.tasks import next_seq  # tasks imports this module

    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    return next_seq(db, lst.space_id)


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise Invalid(f"Unknown timezone {name}")


def _add_months(d: date, months: int, day: Optional[int]) -> date:
    total = d.year * 12 + (d.month - 1) + months
    year, month = divmod(total, 12)
    month += 1
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day or d.day, last))


def _step(rule: s.Recurrence, d: date, anchor: date) -> date:
    """The next date after `d` that the rule allows."""
    if rule.frequency == "daily":
        return d + timedelta(days=rule.interval)
    if rule.frequency == "weekly":
        if not rule.weekdays:
            return d + timedelta(weeks=rule.interval)
        anchor_week = anchor - timedelta(days=anchor.weekday())
        day = d + timedelta(days=1)
        for _ in range(7 * rule.interval + 7):
            week = day - timedelta(days=day.weekday())
            if day.weekday() in rule.weekdays and ((week - anchor_week).days // 7) % rule.interval == 0:
                return day
            day += timedelta(days=1)
        raise Invalid("This repeat rule never matches a day")  # unreachable with validated input
    if rule.frequency == "monthly":
        return _add_months(d, rule.interval, rule.month_day)
    try:
        return d.replace(year=d.year + rule.interval)
    except ValueError:  # 29 February
        return d.replace(year=d.year + rule.interval, day=28)


def next_dates(task: Task, rule: s.Recurrence, now: datetime) -> Optional[Tuple[Optional[datetime], Optional[datetime]]]:
    """(start, due) of the next occurrence, or None when the rule has run out."""
    if rule.count is not None and rule.count <= 0:
        return None
    tz = _zone(rule.tz)
    base = task.due_date or task.start_date or now
    local = base.astimezone(tz)
    anchor = local.date()
    today = now.astimezone(tz).date()
    if rule.frequency == "days_after":
        day = today + timedelta(days=rule.interval)  # counted from the day it was finished
    elif not rule.sync_to_due:
        day = _step(rule, today, today)  # the rhythm restarts from today, not from the old due date
    else:
        day = _step(rule, anchor, anchor)
        for _ in range(MAX_STEPS):
            if day >= today:
                break
            day = _step(rule, day, anchor)  # skip occurrences already in the past
    if rule.until is not None and day > rule.until:
        return None
    moved = datetime.combine(day, local.timetz()).astimezone(timezone.utc)
    shift = moved - base
    start = task.start_date + shift if task.start_date else None
    due = task.due_date + shift if task.due_date else (None if task.start_date else moved)
    return start, due


def set_rule(task: Task, rule: Optional[s.Recurrence]) -> None:
    """Attach, change or remove a task's repeat rule."""
    if rule is None:
        task.recurrence = None
        task.recurrence_next_at = None
        return
    _zone(rule.tz)
    if rule.trigger == "on_schedule" and task.due_date is None:
        raise Invalid("Give the task a due date to repeat it on a schedule")
    task.recurrence = rule.model_dump(mode="json")
    task.recurrence_next_at = task.due_date if rule.trigger == "on_schedule" else None


def refresh_schedule(task: Task) -> None:
    """Keep the on-schedule trigger in step when the due date changes."""
    if task.recurrence and task.recurrence.get("trigger") == "on_schedule":
        task.recurrence_next_at = task.due_date


def _next_rule(rule: s.Recurrence) -> s.Recurrence:
    return rule.model_copy(update={"count": rule.count - 1}) if rule.count is not None else rule


def advance(db: Session, task: Task, actor_id: Optional[str], now: Optional[datetime] = None) -> Optional[Task]:
    """Make the next occurrence. Returns the task that now carries the rule, if any."""
    if not task.recurrence:
        return None
    now = now or datetime.now(timezone.utc)
    rule = s.Recurrence.model_validate(task.recurrence)
    dates = next_dates(task, rule, now)
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    statuses = effective_statuses(db, lst)
    # The status the repeat opens in: the one the rule names, or the List's first.
    first = next((st for st in statuses if st.id == rule.reset_status_id), None) or default_status(statuses)
    if dates is None:
        task.recurrence = None  # the series has ended
        task.recurrence_next_at = None
        db.flush()
        return None
    start, due = dates
    following = _next_rule(rule)

    if rule.action == "reopen" and rule.trigger == "on_done":
        for item in db.scalars(select(ChecklistItem).join(Checklist, Checklist.id == ChecklistItem.checklist_id).where(Checklist.task_id == task.id)):
            item.resolved = False
        apply_group_transition(task, _group(db, task), first.group)
        task.status_id = first.id
        task.start_date, task.due_date = start, due
        task.recurrence = following.model_dump(mode="json")
        db.flush()
        return task

    copy = Task(
        list_id=task.list_id,
        parent_id=task.parent_id,
        top_level_parent_id=task.top_level_parent_id,
        name=task.name,
        description=task.description,
        status_id=first.id,
        priority=task.priority,
        start_date=start,
        due_date=due,
        time_estimate_seconds=task.time_estimate_seconds,
        is_private=task.is_private,
        group_id=task.group_id,
        type_id=task.type_id,
        seq=_next_seq(db, task),
        created_by=actor_id or task.created_by,
        recurrence=following.model_dump(mode="json"),
        recurrence_next_at=due if rule.trigger == "on_schedule" else None,
        recurs_from_id=task.id,
        orderindex=(db.scalar(select(func.max(Task.orderindex)).where(Task.list_id == task.list_id)) or 0.0) + 1.0,
    )
    apply_group_transition(copy, None, first.group)
    db.add(copy)
    db.flush()
    for user_id in db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)):
        db.add(TaskAssignee(task_id=copy.id, user_id=user_id))
    for tag_id in db.scalars(select(TaskTag.tag_id).where(TaskTag.task_id == task.id)):
        db.add(TaskTag(task_id=copy.id, tag_id=tag_id))
    extras.copy_task_extras(db, task, copy, reset=True)
    customfields.copy_values(db, task, copy)
    # The rule moves on to the new occurrence.
    task.recurrence = None
    task.recurrence_next_at = None
    db.flush()
    return copy


def _group(db: Session, task: Task) -> StatusGroup:
    status = db.get(Status, task.status_id)
    assert status is not None
    return status.group


def on_status_change(db: Session, task: Task, old: StatusGroup, new: StatusGroup, actor_id: str) -> Optional[Task]:
    """Called by task updates: finishing a task that repeats "on done" makes the next one."""
    if not task.recurrence or task.recurrence.get("trigger", "on_done") != "on_done":
        return None
    if old in OPEN_GROUPS and new in FINISHED:
        return advance(db, task, actor_id)
    return None


def run_due(db: Session, now: Optional[datetime] = None) -> int:
    """Create occurrences for tasks that repeat on a schedule and have fallen due."""
    now = now or datetime.now(timezone.utc)
    due = list(
        db.scalars(
            select(Task)
            .where(Task.recurrence_next_at.is_not(None), Task.recurrence_next_at <= now, Task.archived_at.is_(None))
            .order_by(Task.recurrence_next_at)
            .limit(100)
            .with_for_update(skip_locked=True)
        )
    )
    for task in due:
        try:
            advance(db, task, None, now)
        except Exception:  # one bad rule must not stop the rest
            log.exception("Could not create the next occurrence of task %s", task.id)
            task.recurrence_next_at = None
    db.commit()
    return len(due)
