"""Computes Dashboard cards, always as the viewer sees the work.

Every card starts from the Lists in its sources that the *viewer* can open (sources the
viewer cannot open are counted in `hidden_sources` and left out), then the tasks in
them the viewer can see. Time cards also only include time tracked by people whose
time the viewer may see: their own, their Teams' if they lead one, everyone's for
owners and admins.

Filters apply to a task's current state, as in ClickUp: a task moved to someone else
leaves that person's charts entirely, past included.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CustomField,
    DashboardCard,
    FieldType,
    TaskFieldValue,
    Folder,
    LocationKind,
    PermissionLevel,
    Space,
    Status,
    StatusGroup,
    Tag,
    Task,
    TaskAssignee,
    TaskList,
    TaskTag,
    Team,
    TeamMember,
    TimeEntry,
    User,
)
from app.schemas import dashboards as d
from app.schemas import work as s
from app.services.work.access import Access, Opened, chain_for_folder, chain_for_list, chain_for_space
from app.services.work.errors import Invalid
from app.services.work.permissions import Node
from app.services.work.tasks import TaskFilter, serialise_tasks, visible_lists, visible_tasks
from app.services.work.timetracking import time_visible_people, tracked_totals

OPEN = (StatusGroup.not_started, StatusGroup.active)
FINISHED = (StatusGroup.done, StatusGroup.closed)
GROUP_LABELS = {
    StatusGroup.not_started: ("Not started", "#9ca3af"),
    StatusGroup.active: ("Active", "#3b82f6"),
    StatusGroup.done: ("Done", "#22c55e"),
    StatusGroup.closed: ("Closed", "#15803d"),
}
PRIORITY_LABELS = {1: ("Urgent", "#dc2626"), 2: ("High", "#f59e0b"), 3: ("Normal", "#3b82f6"), 4: ("Low", "#9ca3af")}
PALETTE = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#84cc16", "#f97316"]
CAPACITY_SECONDS = 8 * 3600  # per working day, as in Workload
DRILL_LIMIT = 500
MAX_VARIANCE_TASKS = 200  # enough to read a month of finished work without sending a year of it
MAX_DAY_BUCKETS = 92


def _color(key: str) -> str:
    return PALETTE[int(hashlib.md5(key.encode()).hexdigest(), 16) % len(PALETTE)]


@dataclass
class Facts:
    """One visible task, with what the cards need about it."""

    task: Task
    status: Status
    level: PermissionLevel
    assignees: List[str]
    tags: List[Tuple[str, str]]  # (name, background colour)
    tracked: int

    @property
    def group(self) -> StatusGroup:
        return self.status.group


@dataclass
class Loaded:
    lists: List[Tuple[TaskList, List[Node]]]
    hidden: int
    facts: List[Facts] = field(default_factory=list)
    # task id -> {field id -> value}. Empty unless a card asked for a custom field.
    field_values: Dict[uuid.UUID, Dict[uuid.UUID, Any]] = field(default_factory=dict)


class Engine:
    def __init__(
        self,
        db: Session,
        access: Access,
        tz: ZoneInfo,
        dashboard_filters: Optional[d.Filters] = None,
        now: Optional[datetime] = None,
    ):
        self.db = db
        self.access = access
        self.tz = tz
        self.dashboard_filters = dashboard_filters or d.Filters()
        self.now = now or datetime.now(timezone.utc)
        self.today = self.now.astimezone(tz).date()
        self._loaded: Dict[Tuple, Loaded] = {}
        self._users: Dict[str, User] = {}
        self._team_people: Dict[uuid.UUID, Set[str]] = {}
        self._time_people: Optional[Set[str]] = None
        self._time_people_loaded = False
        self._fields: Dict[uuid.UUID, CustomField] = {}

    # --- dates -----------------------------------------------------------------

    def _at(self, day: date) -> datetime:
        """Local midnight at the start of `day`, in UTC."""
        return datetime.combine(day, time(), self.tz).astimezone(timezone.utc)

    def _local_day(self, moment: datetime) -> date:
        return moment.astimezone(self.tz).date()

    def period(self, p: d.Period) -> Tuple[date, date]:
        """First and last day (inclusive) of a period, in the viewer's timezone."""
        t = self.today
        monday = t - timedelta(days=t.weekday())
        first_of_month = t.replace(day=1)
        next_month = (first_of_month + timedelta(days=32)).replace(day=1)
        if p.preset == "today":
            return t, t
        if p.preset == "yesterday":
            return t - timedelta(days=1), t - timedelta(days=1)
        if p.preset == "this_week":
            return monday, monday + timedelta(days=6)
        if p.preset == "last_week":
            return monday - timedelta(days=7), monday - timedelta(days=1)
        if p.preset == "this_month":
            return first_of_month, next_month - timedelta(days=1)
        if p.preset == "last_month":
            last_day = first_of_month - timedelta(days=1)
            return last_day.replace(day=1), last_day
        if p.preset == "last_7_days":
            return t - timedelta(days=6), t
        if p.preset == "last_30_days":
            return t - timedelta(days=29), t
        if p.preset in ("this_quarter", "last_quarter"):
            first = t.replace(month=(t.month - 1) // 3 * 3 + 1, day=1)
            if p.preset == "last_quarter":
                last_day = first - timedelta(days=1)
                first = last_day.replace(month=(last_day.month - 1) // 3 * 3 + 1, day=1)
                return first, last_day
            after = (first.replace(day=28) + timedelta(days=4)).replace(day=1)  # start of next month
            for _ in range(2):
                after = (after.replace(day=28) + timedelta(days=4)).replace(day=1)
            return first, after - timedelta(days=1)
        if p.preset == "this_year":
            return t.replace(month=1, day=1), t.replace(month=12, day=31)
        assert p.start and p.end
        return p.start, p.end

    def _window(self, preset: str) -> Tuple[datetime, datetime]:
        """A preset period as [start, end) instants."""
        first, last = self.period(d.Period(preset=preset))
        return self._at(first), self._at(last + timedelta(days=1))

    def _card_window(self, period: Optional[d.Period]) -> Tuple[datetime, datetime]:
        """The card's own period as [start, end) instants, for the "period" filter token.

        A card that asks to be scoped to its period but has none set reads as this week, which is
        what every standard card is created with.
        """
        first, last = self.period(period or d.Period(preset="this_week"))
        return self._at(first), self._at(last + timedelta(days=1))

    # --- people ----------------------------------------------------------------

    def user(self, user_id: str) -> Optional[User]:
        if user_id not in self._users:
            user = self.db.get(User, user_id)
            if user is None:
                return None
            self._users[user_id] = user
        return self._users[user_id]

    def _people(self, tokens: Iterable[str]) -> Tuple[Set[str], bool]:
        """Resolve "me", "team:<id>" and user ids. Also says whether "none" was asked for."""
        people: Set[str] = set()
        none = False
        for token in tokens:
            if token == "none":
                none = True
            elif token == "me":
                people.add(self.access.user_id)
            elif token.startswith("team:"):
                team_id = uuid.UUID(token[5:])
                if team_id not in self._team_people:
                    from app.services.work import team_tree

                    inside = team_tree.descendants(self.db, [team_id])  # sub-teams count too
                    self._team_people[team_id] = set(
                        self.db.scalars(
                            select(TeamMember.user_id)
                            .join(Team, Team.id == TeamMember.team_id)
                            .where(TeamMember.team_id.in_(inside), Team.workspace_id == self.access.workspace_id)
                        )
                    )
                people |= self._team_people[team_id]
            else:
                people.add(token)
        return people, none

    def time_people(self) -> Optional[Set[str]]:
        """Whose tracked time the viewer may see; None means everyone's."""
        if not self._time_people_loaded:
            self._time_people = time_visible_people(self.db, self.access)
            self._time_people_loaded = True
        return self._time_people

    # --- sources and tasks -------------------------------------------------------

    def _source_objects(self, sources: Sequence[d.Source]) -> Tuple[List[Tuple[Any, PermissionLevel]], int]:
        found: List[Tuple[Any, PermissionLevel]] = []
        hidden = 0
        if not sources:
            spaces = self.db.scalars(
                select(Space).where(
                    Space.workspace_id == self.access.workspace_id,
                    Space.personal_owner_id.is_(None),
                    Space.archived_at.is_(None),
                )
            )
            for space in spaces:
                level = self.access.level(chain_for_space(space))
                if level is not None:
                    found.append((space, level))
            return found, 0
        for source in sources:
            obj: Any = {
                LocationKind.space: Space,
                LocationKind.folder: Folder,
                LocationKind.list: TaskList,
            }[source.kind]
            item = self.db.get(obj, source.id)
            space = item if isinstance(item, Space) else (self.db.get(Space, item.space_id) if item else None)
            if item is None or space is None or space.workspace_id != self.access.workspace_id:
                hidden += 1
                continue
            chain = (
                chain_for_space(item) if isinstance(item, Space)
                else chain_for_folder(self.db, item) if isinstance(item, Folder)
                else chain_for_list(self.db, item)
            )
            level = self.access.level(chain)
            if level is None:
                hidden += 1
            else:
                found.append((item, level))
        return found, hidden

    def load(self, config: d.CardConfig) -> Loaded:
        key = (tuple(sorted((src.kind.value, str(src.id)) for src in config.sources)), config.include_subtasks)
        if key in self._loaded:
            return self._loaded[key]
        objects, hidden = self._source_objects(config.sources)
        lists: List[Tuple[TaskList, List[Node]]] = []
        seen: Set[uuid.UUID] = set()
        for obj, level in objects:
            for lst, chain in visible_lists(self.db, Opened(obj, self.access, level)):
                if lst.id not in seen:
                    seen.add(lst.id)
                    lists.append((lst, chain))
        loaded = Loaded(lists=lists, hidden=hidden)
        tasks, levels, _ = visible_tasks(
            self.db, self.access, lists, TaskFilter(include_closed=True, include_subtasks=config.include_subtasks)
        )
        if tasks:
            ids = [t.id for t in tasks]
            statuses = {
                st.id: st for st in self.db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks})))
            }
            assignees: Dict[uuid.UUID, List[str]] = {}
            for task_id, user_id in self.db.execute(
                select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(ids))
            ):
                assignees.setdefault(task_id, []).append(user_id)
            tags: Dict[uuid.UUID, List[Tuple[str, str]]] = {}
            for task_id, name, bg in self.db.execute(
                select(TaskTag.task_id, Tag.name, Tag.bg_color).join(Tag, Tag.id == TaskTag.tag_id).where(TaskTag.task_id.in_(ids))
            ):
                tags.setdefault(task_id, []).append((name, bg))
            tracked = tracked_totals(self.db, ids)
            loaded.facts = [
                Facts(t, statuses[t.status_id], levels[t.id], assignees.get(t.id, []), tags.get(t.id, []), tracked.get(t.id, 0))
                for t in tasks
            ]
        self._loaded[key] = loaded
        return loaded

    # --- filters -----------------------------------------------------------------

    def _matches(self, f: Facts, flt: d.Filters, period: Optional[d.Period] = None) -> bool:
        task = f.task
        if flt.assignees is not None:
            people, none = self._people(flt.assignees)
            if not ((none and not f.assignees) or people.intersection(f.assignees)):
                return False
        if flt.status_groups is not None and f.group not in flt.status_groups:
            return False
        if flt.priorities is not None and (task.priority or 0) not in flt.priorities:
            return False
        if flt.tags is not None:
            wanted = {t.lower() for t in flt.tags}
            if not wanted.intersection(name.lower() for name, _ in f.tags):
                return False
        today = self._at(self.today)
        tomorrow = self._at(self.today + timedelta(days=1))
        if flt.due is not None:
            due = task.due_date
            if flt.due == "none" and due is not None:
                return False
            if flt.due == "set" and due is None:
                return False
            if flt.due == "overdue" and not (due is not None and due < today and f.group in OPEN):
                return False
            if flt.due == "today" and not (due is not None and today <= due < tomorrow):
                return False
            if flt.due == "next_7_days" and not (due is not None and today <= due < self._at(self.today + timedelta(days=7))):
                return False
            if flt.due == "this_week":
                start, end = self._window("this_week")
                if not (due is not None and start <= due < end):
                    return False
            if flt.due == "period":
                start, end = self._card_window(period)
                if not (due is not None and start <= due < end):
                    return False
        if flt.estimate == "set" and task.time_estimate_seconds is None:
            return False
        if flt.estimate == "missing" and task.time_estimate_seconds is not None:
            return False
        scheduled = task.start_date is not None or task.due_date is not None
        if flt.scheduled == "yes" and not scheduled:
            return False
        if flt.scheduled == "no" and scheduled:
            return False
        if flt.done is not None:
            finished_at = task.date_done or task.date_closed
            if f.group not in FINISHED or finished_at is None:
                return False
            start, end = self._card_window(period) if flt.done == "period" else self._window(flt.done)
            if not (start <= finished_at < end):
                return False
        return True

    def matching(self, card: d.CardConfig, loaded: Loaded, force_closed: bool = False) -> List[Facts]:
        flt = card.filters
        wants_closed = (
            force_closed or card.include_closed or flt.done is not None
            or (flt.status_groups is not None and StatusGroup.closed in flt.status_groups)
        )
        result = []
        for f in loaded.facts:
            if not wants_closed and f.group == StatusGroup.closed:
                continue
            if self._matches(f, flt, card.period) and self._matches(f, self.dashboard_filters, card.period):
                result.append(f)
        return result

    # --- measures and grouping ------------------------------------------------------

    def measure(self, f: Facts, measure: str, loaded: Optional[Loaded] = None) -> float:
        if measure == "time_estimate":
            return f.task.time_estimate_seconds or 0
        if measure == "time_tracked":
            return f.tracked
        field_id = d.field_id(measure)
        if field_id is not None and loaded is not None:
            return self.field_number(f, field_id, loaded)
        return 1

    def measure_format(self, measure: str) -> str:
        """How the numbers this measure produces should be read."""
        if measure in ("time_estimate", "time_tracked"):
            return "duration"
        return "count" if measure == "tasks" else "number"

    def prepare(self, config: d.CardConfig, loaded: Loaded) -> None:
        """Fetch any custom field the card is about to group by or add up."""
        for reference in (config.group_by, config.measure):
            field_id = d.field_id(reference)
            if field_id is not None:
                self.load_field_values(loaded, field_id)

    def _list_label(self, loaded: Loaded, list_id: uuid.UUID) -> str:
        for lst, _ in loaded.lists:
            if lst.id == list_id:
                return lst.name
        return "List"

    def field(self, field_id: uuid.UUID) -> Optional[CustomField]:
        """The definition of a custom field, cached for the life of this request."""
        if field_id not in self._fields:
            found = self.db.get(CustomField, field_id)
            if found is None:
                return None
            self._fields[field_id] = found
        return self._fields[field_id]

    def load_field_values(self, loaded: Loaded, field_id: uuid.UUID) -> None:
        """Pull one field's values for the tasks already loaded. Missing rows mean empty."""
        if not loaded.facts or any(field_id in v for v in loaded.field_values.values()):
            return
        ids = [f.task.id for f in loaded.facts]
        for task_id, value in self.db.execute(
            select(TaskFieldValue.task_id, TaskFieldValue.value)
            .where(TaskFieldValue.field_id == field_id, TaskFieldValue.task_id.in_(ids))
        ):
            loaded.field_values.setdefault(task_id, {})[field_id] = value

    def _field_keys(self, f: Facts, field_id: uuid.UUID, loaded: Loaded) -> List[Tuple[str, str, str]]:
        """The segments a task falls in for a custom field."""
        definition = self.field(field_id)
        if definition is None:
            raise Invalid("That custom field no longer exists")
        raw = loaded.field_values.get(f.task.id, {}).get(field_id)
        empty = [("none", f"No {definition.name}", "#d1d5db")]
        if raw is None or raw == "" or raw == []:
            return empty

        options = {str(o.get("id")): o for o in (definition.config or {}).get("options", [])}

        def option(value: Any) -> Tuple[str, str, str]:
            found = options.get(str(value))
            if found:
                return (str(value), str(found.get("name", value)), str(found.get("color") or _color(str(value))))
            return (str(value), str(value), _color(str(value)))

        if definition.type in (FieldType.dropdown,):
            return [option(raw)]
        if definition.type in (FieldType.labels,):
            values = raw if isinstance(raw, list) else [raw]
            return [option(v) for v in values] or empty
        if definition.type == FieldType.checkbox:
            return [("yes", "Yes", "#22c55e")] if raw else [("no", "No", "#9ca3af")]
        if definition.type == FieldType.people:
            values = raw if isinstance(raw, list) else [raw]
            out = []
            for uid in values:
                user = self.user(str(uid))
                out.append((str(uid), (user.display_name or user.email) if user else str(uid), _color(str(uid))))
            return out or empty
        # Anything else groups by the value as written, which is right for text and dates.
        return [(str(raw), str(raw), _color(str(raw)))]

    def field_number(self, f: Facts, field_id: uuid.UUID, loaded: Loaded) -> float:
        """A custom field's value as a number, for cards that add it up."""
        raw = loaded.field_values.get(f.task.id, {}).get(field_id)
        if isinstance(raw, bool):
            return 1.0 if raw else 0.0
        if isinstance(raw, (int, float)):
            return float(raw)
        try:
            return float(str(raw))
        except (TypeError, ValueError):
            return 0.0

    def keys(self, f: Facts, group_by: str, loaded: Loaded) -> List[Tuple[str, str, str]]:
        """The segments a task falls in: (key, label, colour)."""
        if group_by == "status":
            return [(f.status.name.lower(), f.status.name, f.status.color)]
        if group_by == "status_group":
            label, color = GROUP_LABELS[f.group]
            return [(f.group.value, label, color)]
        if group_by == "priority":
            if f.task.priority is None:
                return [("0", "No priority", "#d1d5db")]
            label, color = PRIORITY_LABELS[f.task.priority]
            return [(str(f.task.priority), label, color)]
        if group_by == "assignee":
            if not f.assignees:
                return [("none", "Unassigned", "#d1d5db")]
            out = []
            for uid in f.assignees:
                user = self.user(uid)
                out.append((uid, (user.display_name or user.email) if user else uid, _color(uid)))
            return out
        if group_by == "tag":
            if not f.tags:
                return [("none", "No tag", "#d1d5db")]
            return [(name.lower(), name, bg) for name, bg in f.tags]
        if group_by == "list":
            key = str(f.task.list_id)
            return [(key, self._list_label(loaded, f.task.list_id), _color(key))]
        field_id = d.field_id(group_by)
        if field_id is not None:
            return self._field_keys(f, field_id, loaded)
        raise Invalid(f"Cannot group by {group_by}")

    def _bucket_start(self, day: date, interval: str) -> date:
        if interval == "week":
            return day - timedelta(days=day.weekday())
        if interval == "month":
            return day.replace(day=1)
        return day

    def _date_of(self, f: Facts, group_by: str) -> Optional[datetime]:
        if group_by == "done_date":
            return (f.task.date_done or f.task.date_closed) if f.group in FINISHED else None
        if group_by == "created_date":
            return f.task.created_at
        return f.task.due_date

    def _buckets(self, config: d.CardConfig) -> List[date]:
        first, last = self.period(config.period)
        if config.interval == "day" and (last - first).days + 1 > MAX_DAY_BUCKETS:
            raise Invalid("Group by week or month for periods longer than three months")
        out, day = [], self._bucket_start(first, config.interval)
        while day <= last:
            out.append(day)
            day = (
                day + timedelta(days=1) if config.interval == "day"
                else day + timedelta(days=7) if config.interval == "week"
                else (day + timedelta(days=32)).replace(day=1)
            )
        return out

    def segment_of(self, f: Facts, config: d.CardConfig, loaded: Loaded) -> List[str]:
        """Keys a task contributes to, for drill-down."""
        if config.group_by in d.DATE_GROUPS:
            moment = self._date_of(f, config.group_by)
            if moment is None:
                return []
            first, last = self.period(config.period)
            day = self._local_day(moment)
            if not (first <= day <= last):
                return []
            return [self._bucket_start(day, config.interval).isoformat()]
        return [k for k, _, _ in self.keys(f, config.group_by, loaded)]

    # --- cards --------------------------------------------------------------------

    def compute(self, card: DashboardCard) -> d.CardData:
        config = d.CardConfig.model_validate(card.config)
        base = dict(card_id=card.id, type=card.type, computed_at=self.now)
        if card.type == "notes":
            return d.CardData(**base, data={"text": config.text or ""})
        if card.type == "embed":
            return d.CardData(**base, data={"url": config.url or ""})
        if card.type == "goal":
            from app.services.work import goals

            return d.CardData(**base, data={"goals": [x.model_dump(mode="json") for x in goals.goal_summaries(self.db, self.access, config.goal_ids)]})
        if card.type == "sprint":
            return self._card_sprint(base, config)
        if card.type == "discussion":
            from app.db.models import DashboardComment  # local: only this card needs it

            count = self.db.scalar(select(func.count()).select_from(DashboardComment).where(DashboardComment.card_id == card.id)) or 0
            return d.CardData(**base, data={"count": count})
        try:
            loaded = self.load(config)
            if config.sources and loaded.hidden == len(config.sources):
                return d.CardData(**base, no_access=True, hidden_sources=loaded.hidden)
            handler: Callable[[d.CardConfig, Loaded], Dict[str, Any]] = getattr(self, f"_card_{card.type}")
            return d.CardData(**base, hidden_sources=loaded.hidden, data=handler(config, loaded))
        except Invalid as exc:
            return d.CardData(**base, error=str(exc))

    def _card_calculation(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        self.prepare(config, loaded)
        matched = self.matching(config, loaded)
        fmt = self.measure_format(config.measure)
        if config.measure == "tasks":
            return {"value": len(matched), "format": "count", "count": len(matched), "unit": config.unit}
        values = [self.measure(f, config.measure, loaded) for f in matched]
        present = [v for v in values if v > 0]  # tasks with no estimate / no time are left out of avg, min and max
        if config.fn == "sum":
            value: Optional[float] = sum(values)
        elif not present:
            value = None
        elif config.fn == "avg":
            value = round(sum(present) / len(present))
        elif config.fn == "min":
            value = min(present)
        else:
            value = max(present)
        # A money or rating field is a plain number; only the time measures are durations, and
        # rounding a rating to whole seconds would be nonsense.
        if value is not None and fmt == "duration":
            value = int(value)
        elif value is not None:
            value = round(value, 2)
        return {"value": value, "format": fmt, "count": len(matched), "unit": config.unit}

    def _grouped(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        self.prepare(config, loaded)
        matched = self.matching(config, loaded)
        fmt = self.measure_format(config.measure)
        if config.group_by in d.DATE_GROUPS:
            buckets = self._buckets(config)
            totals = {b.isoformat(): 0 for b in buckets}
            for f in matched:
                for key in self.segment_of(f, config, loaded):
                    if key in totals:
                        totals[key] += self.measure(f, config.measure, loaded)
            segments = [
                {"key": b.isoformat(), "label": _bucket_label(b, config.interval), "color": "#6366f1", "value": totals[b.isoformat()]}
                for b in buckets
            ]
            return {"segments": segments, "format": fmt, "total": sum(totals.values()), "over_time": True}
        agg: Dict[str, Dict[str, Any]] = {}
        for f in matched:
            for key, label, color in self.keys(f, config.group_by, loaded):
                seg = agg.setdefault(key, {"key": key, "label": label, "color": color, "value": 0})
                seg["value"] += self.measure(f, config.measure, loaded)
        segments = [seg for seg in agg.values() if seg["value"] > 0 or config.measure == "tasks"]
        if config.group_by == "status_group":
            order = [g.value for g in StatusGroup]
            segments.sort(key=lambda seg: order.index(seg["key"]))
        elif config.group_by == "priority":
            segments.sort(key=lambda seg: int(seg["key"]) or 9)
        else:
            segments.sort(key=lambda seg: (-seg["value"], seg["label"].lower()))
        return {"segments": segments, "format": fmt, "total": sum(seg["value"] for seg in segments), "over_time": False}

    _card_pie = _grouped
    _card_bar = _grouped
    _card_line = _grouped

    def _sorted(self, facts: List[Facts], sort: str) -> List[Facts]:
        far = datetime.max.replace(tzinfo=timezone.utc)
        if sort == "priority":
            return sorted(facts, key=lambda f: (f.task.priority or 9, f.task.due_date or far, f.task.name.lower()))
        if sort == "updated":
            return sorted(facts, key=lambda f: f.task.updated_at, reverse=True)
        if sort == "name":
            return sorted(facts, key=lambda f: f.task.name.lower())
        return sorted(facts, key=lambda f: (f.task.due_date or far, f.task.name.lower()))

    def _card_task_list(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        matched = self._sorted(self.matching(config, loaded), config.sort)
        shown = matched[: config.limit]
        tasks = serialise_tasks(self.db, [f.task for f in shown], {f.task.id: f.level for f in shown})
        return {"tasks": [t.model_dump(mode="json") for t in tasks], "total": len(matched)}

    def _card_portfolio(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        matched = self.matching(config, loaded, force_closed=True)
        today = self._at(self.today)
        rows: Dict[uuid.UUID, Dict[str, Any]] = {}
        for lst, _ in loaded.lists:
            rows[lst.id] = {
                "list_id": str(lst.id), "name": lst.name, "path": self._path(lst),
                "total": 0, "open": 0, "done": 0, "overdue": 0, "estimate_seconds": 0, "tracked_seconds": 0,
            }
        for f in matched:
            row = rows.get(f.task.list_id)
            if row is None:
                continue
            row["total"] += 1
            row["estimate_seconds"] += f.task.time_estimate_seconds or 0
            row["tracked_seconds"] += f.tracked
            if f.group in FINISHED:
                row["done"] += 1
            else:
                row["open"] += 1
                if f.task.due_date is not None and f.task.due_date < today:
                    row["overdue"] += 1
        out = list(rows.values())
        for row in out:
            row["progress"] = round(100 * row["done"] / row["total"]) if row["total"] else 0
        out.sort(key=lambda r: r["path"].lower())
        return {"rows": out}

    def _overdue(self, config: d.CardConfig, loaded: Loaded) -> List[Facts]:
        today = self._at(self.today)
        return [
            f for f in self.matching(config, loaded)
            if f.group not in FINISHED and f.task.due_date is not None and f.task.due_date < today
        ]

    def _card_behind(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """ClickUp's "Who's behind": open tasks past their due date, per assignee."""
        rows: Dict[str, Dict[str, Any]] = {}
        matched = self._overdue(config, loaded)
        for f in matched:
            days = (self.today - self._local_day(f.task.due_date)).days
            for uid in f.assignees or [""]:
                row = rows.setdefault(uid or "none", {
                    "key": uid or "none", "user": self._person(uid) if uid else None,
                    "overdue": 0, "oldest_days": 0, "tasks": [],
                })
                row["overdue"] += 1
                row["oldest_days"] = max(row["oldest_days"], days)
                row["tasks"].append({"id": str(f.task.id), "name": f.task.name, "days": days, "list_id": str(f.task.list_id)})
        out = sorted(rows.values(), key=lambda r: (-r["overdue"], -r["oldest_days"], r["key"] == "none"))
        for row in out:
            row["tasks"] = sorted(row["tasks"], key=lambda t: -t["days"])[:5]
        return {"rows": out, "total": len(matched)}

    def _completed(self, config: d.CardConfig, loaded: Loaded) -> Tuple[List[Tuple[Facts, datetime]], date, date]:
        first, last = self.period(config.period)
        lo, hi = self._at(first), self._at(last + timedelta(days=1))
        out = []
        for f in self.matching(config, loaded, force_closed=True):
            done = f.task.date_done or f.task.date_closed
            if f.group in FINISHED and done is not None and lo <= done < hi:
                out.append((f, done))
        return out, first, last

    def _card_completed(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """Tasks finished in the period, per assignee, and how many were on time."""
        done, first, last = self._completed(config, loaded)
        rows: Dict[str, Dict[str, Any]] = {}
        on_time = 0
        for f, when in done:
            late = f.task.due_date is not None and self._local_day(when) > self._local_day(f.task.due_date)
            on_time += 0 if late else 1
            for uid in f.assignees or [""]:
                row = rows.setdefault(uid or "none", {
                    "key": uid or "none", "user": self._person(uid) if uid else None, "done": 0, "late": 0,
                })
                row["done"] += 1
                row["late"] += 1 if late else 0
        days = (last - first).days + 1
        per_day = {(first + timedelta(days=i)).isoformat(): 0 for i in range(min(days, MAX_DAY_BUCKETS))}
        late_per_day = dict.fromkeys(per_day, 0)
        for f, when in done:
            key = self._local_day(when).isoformat()
            if key in per_day:
                per_day[key] += 1
                if f.task.due_date is not None and self._local_day(when) > self._local_day(f.task.due_date):
                    late_per_day[key] += 1

        # The finished work itself. At a personal scale a handful of names says more than any
        # chart of the same handful of numbers, so the card can list what was actually shipped.
        newest = sorted(done, key=lambda pair: pair[1], reverse=True)[:25]
        tasks = []
        for f, when in newest:
            due = f.task.due_date
            days_late = (self._local_day(when) - self._local_day(due)).days if due is not None else 0
            tasks.append({
                "id": str(f.task.id),
                "name": f.task.name,
                "done_at": when.isoformat(),
                "due_date": due.isoformat() if due is not None else None,
                "days_late": max(0, days_late),
            })

        return {
            "rows": sorted(rows.values(), key=lambda r: (-r["done"], r["key"] == "none")),
            "total": len(done), "on_time": on_time, "late": len(done) - on_time,
            "start": first.isoformat(), "end": last.isoformat(),
            "tasks": tasks,
            "per_day": [{"day": k, "count": v, "late": late_per_day[k]} for k, v in per_day.items()],
        }

    def _card_battery(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """ClickUp's Battery card: how much of the work is done, by status group."""
        matched = self.matching(config, loaded, force_closed=True)
        counts = {grp: 0 for grp in StatusGroup}
        for f in matched:
            counts[f.group] += 1
        total = len(matched)
        finished = counts[StatusGroup.done] + counts[StatusGroup.closed]
        return {
            "total": total, "done": finished, "percent": round(100 * finished / total) if total else 0,
            "segments": [
                {"key": grp.value, "label": GROUP_LABELS[grp][0], "color": GROUP_LABELS[grp][1], "value": counts[grp]}
                for grp in (StatusGroup.closed, StatusGroup.done, StatusGroup.active, StatusGroup.not_started)
            ],
        }

    def _card_capacity(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """Workload for a period: what these people can do, what is planned for them, what they logged.

        Planned effort is an estimate spread over the task's own start..due days, the way the
        Workload view spreads it, and only the part that lands inside the period counts.
        """
        from app.services.work.leave import daily_capacity
        from app.services.work.workload import spread

        entries, first, last = self._entries(config, loaded)
        if (last - first).days + 1 > 100:
            raise Invalid("A workload card covers at most a quarter")
        days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
        window = set(days)
        matched = self.matching(config, loaded)

        planned = 0
        scheduled = 0
        people: Set[str] = {entry.user_id for entry, _ in entries}
        for f in matched:
            people.update(f.assignees)
            estimate = f.task.time_estimate_seconds or 0
            due = f.task.due_date
            if not estimate or due is None:
                continue  # unscheduled work, or work nobody sized: it can't be planned into days
            end = self._local_day(due)
            start = self._local_day(f.task.start_date) if f.task.start_date else end
            share = sum(seconds for day, seconds in spread(estimate, start, end).items() if day in window)
            if share:
                planned += share
                scheduled += 1

        seen = self.time_people()
        if seen is not None:
            people &= seen  # someone who may not see another's time doesn't get their capacity either
        per_person = daily_capacity(self.db, self.access.workspace_id, sorted(people), days)
        fallback = sum(CAPACITY_SECONDS for day in days if day.weekday() < 5)
        capacity = sum(sum(v) for v in per_person.values()) if per_person else (fallback if people else 0)
        logged = sum(entry.duration_seconds or 0 for entry, _ in entries)
        # How the capacity was arrived at, so the card can say "5 working days at 8h" rather than
        # dropping a total on the reader and leaving them to trust it.
        if per_person:
            working_days = sum(1 for i in range(len(days)) if any(v[i] for v in per_person.values()))
        else:
            working_days = sum(1 for day in days if day.weekday() < 5)
        return {
            "capacity_seconds": capacity,
            "planned_seconds": planned,
            "logged_seconds": logged,
            # Whichever is larger commits the hours: work already logged is gone even if it
            # was never planned, so "remaining" can never offer time that has been spent.
            "remaining_seconds": max(capacity - max(planned, logged), 0),
            "working_days": working_days,
            "seconds_per_day": round(capacity / len(people) / working_days) if people and working_days else 0,
            "people": len(people),
            "tasks": len(matched),
            "scheduled_tasks": scheduled,
            "period": {"start": first.isoformat(), "end": last.isoformat()},
            "sees_everyone": seen is None,
        }

    def _card_plan(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """What the viewer could do today, and what they have already picked.

        Picking is the LineUp they already have on My Tasks, so a task chosen here is chosen
        everywhere rather than being a second, private idea of "today". The card is always about
        the person reading it -- a manager looking at someone else's Dashboard sees their own
        LineUp, because you cannot plan another person's day for them.
        """
        from app.services.work.leave import daily_capacity
        from app.db.models import LineupItem

        today = self.today
        picked_ids = list(self.db.scalars(
            select(LineupItem.task_id).where(
                LineupItem.workspace_id == self.access.workspace_id,
                LineupItem.user_id == self.access.user_id,
            ).order_by(LineupItem.position)
        ))
        picked_order = {tid: i for i, tid in enumerate(picked_ids)}

        # Candidates: the viewer's own open work that has started or is due soon. Anything already
        # picked stays on the list whatever its dates, or ticking it would make it disappear.
        soon = self._at(today + timedelta(days=7))
        mine = []
        for f in self.matching(config, loaded):
            if f.group in FINISHED or self.access.user_id not in f.assignees:
                continue
            due = f.task.due_date
            started = f.task.start_date is None or f.task.start_date <= self._at(today + timedelta(days=1))
            if f.task.id in picked_order or (started and (due is None or due < soon)):
                mine.append(f)

        def sort_key(f: Facts):
            due = f.task.due_date
            return (picked_order.get(f.task.id, len(picked_ids)), due is None, due or self._at(today), f.task.name)

        mine.sort(key=sort_key)
        shown = mine[:20]
        rows = serialise_tasks(self.db, [f.task for f in shown], {f.task.id: f.level for f in shown})
        now = self._at(today)
        tasks = []
        for f, row in zip(shown, rows):
            body = row.model_dump(mode="json")
            body["picked"] = f.task.id in picked_order
            body["overdue"] = f.task.due_date is not None and f.task.due_date < now
            tasks.append(body)

        per_person = daily_capacity(self.db, self.access.workspace_id, [self.access.user_id], [today])
        capacity = sum(per_person.get(self.access.user_id) or []) or (
            CAPACITY_SECONDS if today.weekday() < 5 else 0
        )
        return {
            "capacity_seconds": capacity,
            "planned_seconds": sum(t["time_estimate_seconds"] or 0 for t in tasks if t["picked"]),
            "tasks": tasks,
            "day": today.isoformat(),
        }

    def _card_variance(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """Per person, on the work they finished in the period: estimate against what it took.

        Both sides describe the same tasks. Counting every open task's estimate against only the
        hours logged inside the period compared two different things, and on a short period it
        reported most of a month's estimates as "unused" after a single day.

        Expected counts a task's estimate once, split evenly between the people on it. Logged is
        every hour anyone put on those tasks, whenever it was tracked -- work finished on Monday
        is usually work that started before it.
        """
        done, first, last = self._completed(config, loaded)

        rows: Dict[str, Dict[str, Any]] = {}

        def row(user_id: str) -> Dict[str, Any]:
            if user_id not in rows:
                rows[user_id] = {
                    "key": user_id, "user": self._person(user_id),
                    "expected_seconds": 0, "logged_seconds": 0, "tasks": 0,
                }
            return rows[user_id]

        task_ids = []
        # The tasks themselves. This is the body of the card now, not a footnote to it: estimate,
        # actual and the difference for every task that was finished, with enough about each one
        # (who, where, how urgent) for the card to be filtered and sorted without another read.
        tasks: List[Dict[str, Any]] = []
        for f, when in done:
            estimate = f.task.time_estimate_seconds or 0
            if f.assignees:
                # Only assigned work feeds the per-person rows: time logged on a task nobody
                # owns has no estimate to sit against, and would read as pure overrun.
                task_ids.append(f.task.id)
                share = estimate // len(f.assignees) if estimate else 0
                for user_id in f.assignees:
                    item = row(user_id)
                    item["expected_seconds"] += share
                    item["tasks"] += 1
            due = f.task.due_date
            tasks.append({
                "id": str(f.task.id),
                "name": f.task.name,
                "list": self._list_label(loaded, f.task.list_id),
                "status": f.status.name,
                "status_group": f.group.value,
                "priority": f.task.priority,
                "assignees": [self._person(uid) for uid in f.assignees],
                "due_date": due.isoformat() if due is not None else None,
                "done_at": when.isoformat(),
                "late": due is not None and self._local_day(when) > self._local_day(due),
                # No estimate is its own answer -- you cannot say the work ran over, only that
                # nobody said what it should take -- so it is carried rather than dropped.
                "expected_seconds": estimate or None,
                "logged_seconds": f.tracked,
                "difference_seconds": (f.tracked - estimate) if estimate else None,
            })
        # Worst misjudgements first: those are the ones worth looking at. Anything with no
        # estimate has no misjudgement to measure, so it sits at the end.
        tasks.sort(key=lambda t: -abs(t["difference_seconds"]) if t["difference_seconds"] is not None else 1)
        if task_ids:
            query = (
                select(TimeEntry.user_id, func.sum(TimeEntry.duration_seconds))
                .where(TimeEntry.task_id.in_(task_ids), TimeEntry.ended_at.is_not(None))
                .group_by(TimeEntry.user_id)
            )
            allowed = self.time_people()
            if allowed is not None:
                query = query.where(TimeEntry.user_id.in_(allowed))
            for user_id, seconds in self.db.execute(query):
                row(user_id)["logged_seconds"] += seconds or 0

        seen = self.time_people()
        out = [r for r in rows.values() if seen is None or r["key"] in seen]
        for item in out:
            item["difference_seconds"] = item["logged_seconds"] - item["expected_seconds"]
        out.sort(key=lambda r: -abs(r["difference_seconds"]))
        return {
            "rows": out,
            "tasks": tasks[:MAX_VARIANCE_TASKS],
            "more_tasks": max(0, len(tasks) - MAX_VARIANCE_TASKS),
            "expected_seconds": sum(r["expected_seconds"] for r in out),
            "logged_seconds": sum(r["logged_seconds"] for r in out),
            "period": {"start": first.isoformat(), "end": last.isoformat()},
            "sees_everyone": seen is None,
        }

    def _card_worked_on(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        """ClickUp's "Worked on": per person, the tasks they tracked time on, changed, commented on or finished."""
        from app.db.models import TaskActivity, TaskComment

        first, last = self.period(config.period)
        lo, hi = self._at(first), self._at(last + timedelta(days=1))
        facts = {f.task.id: f for f in self.matching(config, loaded, force_closed=True)}
        wanted: Optional[Set[str]] = None
        for tokens in (config.filters.assignees, self.dashboard_filters.assignees):
            if tokens is not None:
                people, _ = self._people(tokens)
                wanted = people if wanted is None else wanted & people
        rows: Dict[str, Dict[str, Any]] = {}

        def note(uid: Optional[str], task_id: uuid.UUID, what: str, seconds: int = 0) -> None:
            if not uid or task_id not in facts or (wanted is not None and uid not in wanted):
                return
            row = rows.setdefault(uid, {"key": uid, "user": self._person(uid), "tracked_seconds": 0, "tasks": {}})
            task = facts[task_id].task
            item = row["tasks"].setdefault(str(task_id), {"id": str(task_id), "name": task.name, "list_id": str(task.list_id),
                                                           "tracked_seconds": 0, "changes": 0, "comments": 0, "completed": False})
            if what == "tracked":
                item["tracked_seconds"] += seconds
                row["tracked_seconds"] += seconds
            elif what == "changed":
                item["changes"] += 1
            elif what == "commented":
                item["comments"] += 1
            elif what == "completed":
                item["completed"] = True

        if facts:
            ids = list(facts)
            q = select(TimeEntry).where(TimeEntry.task_id.in_(ids), TimeEntry.ended_at.is_not(None), TimeEntry.started_at >= lo, TimeEntry.started_at < hi)
            allowed = self.time_people()
            if allowed is not None:
                q = q.where(TimeEntry.user_id.in_(allowed))
            for e in self.db.scalars(q):
                note(e.user_id, e.task_id, "tracked", e.duration_seconds or 0)
            for a in self.db.scalars(select(TaskActivity).where(
                    TaskActivity.task_id.in_(ids), TaskActivity.created_at >= lo, TaskActivity.created_at < hi, TaskActivity.kind != "created")):
                note(a.user_id, a.task_id, "changed")
            for c in self.db.scalars(select(TaskComment).where(TaskComment.task_id.in_(ids), TaskComment.created_at >= lo, TaskComment.created_at < hi)):
                note(c.user_id, c.task_id, "commented")
            for f in facts.values():
                done = f.task.date_done or f.task.date_closed
                if f.group in FINISHED and done is not None and lo <= done < hi:
                    for uid in f.assignees:
                        note(uid, f.task.id, "completed")
        out = []
        for row in rows.values():
            tasks = sorted(row.pop("tasks").values(), key=lambda t: (-t["tracked_seconds"], -t["changes"], t["name"].lower()))
            out.append({**row, "task_count": len(tasks), "tasks": tasks[: config.limit]})
        out.sort(key=lambda r: (-r["task_count"], -r["tracked_seconds"]))
        return {"rows": out, "start": first.isoformat(), "end": last.isoformat()}

    def _card_sprint(self, base: Dict[str, Any], config: d.CardConfig) -> d.CardData:
        from app.services.work import sprints
        from app.services.work.access import open_folder
        from app.services.work.errors import Forbidden, NotFound

        try:
            opened = open_folder(self.db, self.access.user_id, config.folder_id, PermissionLevel.view)
        except (NotFound, Forbidden):
            return d.CardData(**base, no_access=True)
        if opened.obj.sprint_settings is None:
            return d.CardData(**base, error="That Folder isn't a Sprint Folder any more")
        all_sprints = sprints.sprints(self.db, opened)
        pick = next((x for x in all_sprints if x.current), None) or next((x for x in all_sprints if x.completed_at is None), None) \
            or (all_sprints[-1] if all_sprints else None)
        if pick is None:
            return d.CardData(**base, data={"folder": opened.obj.name, "report": None})
        lst = self.db.get(TaskList, pick.id)
        report = sprints.report(self.db, Opened(lst, self.access, PermissionLevel.view), today=self.today)
        return d.CardData(**base, data={"folder": opened.obj.name, "report": report.model_dump(mode="json")})

    def _path(self, lst: TaskList) -> str:
        parts = [lst.name]
        if lst.folder_id:
            folder = self.db.get(Folder, lst.folder_id)
            if folder is not None:
                parts.insert(0, folder.name)
        space = self.db.get(Space, lst.space_id)
        if space is not None and space.personal_owner_id is None:
            parts.insert(0, space.name)
        return " / ".join(parts)

    # --- time cards ---------------------------------------------------------------------

    def _entries(self, config: d.CardConfig, loaded: Loaded) -> Tuple[List[Tuple[TimeEntry, Facts]], date, date]:
        first, last = self.period(config.period)
        start, end = self._at(first), self._at(last + timedelta(days=1))
        # The card's task filters narrow the hours too, so both halves of a card describe the same
        # work. Without this, filtering a workload card to "urgent only" dropped Planned to an
        # hour while Logged still reported the whole week, and the card read as a huge overrun
        # that was really just the filter.
        #
        # Closed work is kept whatever the card's usual rule: hours were tracked on tasks that
        # have since been finished, and a timesheet that quietly lost them would be wrong.
        by_id = {f.task.id: f for f in self.matching(config, loaded, force_closed=True)}
        if not by_id:
            return [], first, last
        query = select(TimeEntry).where(
            TimeEntry.task_id.in_(list(by_id)),
            TimeEntry.ended_at.is_not(None),
            TimeEntry.started_at >= start,
            TimeEntry.started_at < end,
        )
        allowed = self.time_people()
        if allowed is not None:
            query = query.where(TimeEntry.user_id.in_(allowed))
        for tokens in (config.filters.assignees, self.dashboard_filters.assignees):
            if tokens is not None:
                people, _ = self._people(tokens)
                query = query.where(TimeEntry.user_id.in_(people))
        if config.billable == "billable":
            query = query.where(TimeEntry.billable.is_(True))
        elif config.billable == "non_billable":
            query = query.where(TimeEntry.billable.is_(False))
        entries = [(e, by_id[e.task_id]) for e in self.db.scalars(query.order_by(TimeEntry.started_at))]
        return entries, first, last

    def _person(self, user_id: str) -> Dict[str, Any]:
        user = self.user(user_id)
        return (
            s.UserOut.model_validate(user).model_dump(mode="json") if user
            else {"id": user_id, "email": user_id, "display_name": None}
        )

    def _time_key(self, entry: TimeEntry, f: Facts, by: str, loaded: Loaded) -> Tuple[str, str]:
        if by == "user":
            user = self.user(entry.user_id)
            return entry.user_id, (user.display_name or user.email) if user else entry.user_id
        if by == "list":
            return str(f.task.list_id), self._list_label(loaded, f.task.list_id)
        return str(f.task.id), f.task.name

    def _card_time_report(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        entries, first, last = self._entries(config, loaded)
        rows: Dict[str, Dict[str, Any]] = {}
        estimates: Dict[str, Set[uuid.UUID]] = {}
        for entry, f in entries:
            key, label = self._time_key(entry, f, config.time_group_by, loaded)
            row = rows.setdefault(key, {"key": key, "label": label, "seconds": 0, "children": {}})
            row["seconds"] += entry.duration_seconds or 0
            estimates.setdefault(key, set()).add(f.task.id)
            if config.then_by != "none" and config.then_by != config.time_group_by:
                ckey, clabel = self._time_key(entry, f, config.then_by, loaded)
                child = row["children"].setdefault(ckey, {"key": ckey, "label": clabel, "seconds": 0})
                child["seconds"] += entry.duration_seconds or 0
        facts = {f.task.id: f for f in loaded.facts}
        out = []
        for key, row in rows.items():
            children = sorted(row.pop("children").values(), key=lambda c: -c["seconds"])
            item = {**row, "children": children}
            if config.show_estimates:
                item["estimate_seconds"] = sum(facts[t].task.time_estimate_seconds or 0 for t in estimates[key])
            out.append(item)
        out.sort(key=lambda r: -r["seconds"])
        # Hours mean nothing without the hours each person had. Grouped by person, every row is
        # measured against that person's own working week -- their real capacity, less holidays
        # and approved leave -- so "12h" reads as comfortable or as a problem rather than as a
        # number. Grouped by task or List there is no such thing, and the bars stay relative.
        if config.time_group_by == "user" and out:
            from app.services.work.leave import daily_capacity

            days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
            per_person = daily_capacity(self.db, self.access.workspace_id, [r["key"] for r in out], days)
            for row in out:
                row["capacity_seconds"] = sum(per_person.get(row["key"], []))
        return {
            "rows": out,
            "total_seconds": sum(r["seconds"] for r in out),
            "period": {"start": first.isoformat(), "end": last.isoformat()},
            "sees_everyone": self.time_people() is None,
        }

    def _card_timesheet(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        entries, first, last = self._entries(config, loaded)
        if (last - first).days + 1 > 31:
            raise Invalid("A timesheet covers at most 31 days")
        days = [first + timedelta(days=i) for i in range((last - first).days + 1)]
        index = {day: i for i, day in enumerate(days)}
        people: Dict[str, List[int]] = {}
        billable: Dict[str, List[int]] = {}
        # What each person put the hours into, so a row can be opened up task by task.
        per_task: Dict[str, Dict[uuid.UUID, Dict[str, Any]]] = {}
        # The individual stretches of time, so one day can be read in the order it happened.
        # Only worth carrying for a short period; a month of these would be most of the payload.
        detail = len(days) <= 8
        per_entry: Dict[str, List[Dict[str, Any]]] = {}
        for entry, facts in entries:
            day = self._local_day(entry.started_at)
            if day not in index:
                continue
            seconds = entry.duration_seconds or 0
            people.setdefault(entry.user_id, [0] * len(days))[index[day]] += seconds
            if entry.billable:
                billable.setdefault(entry.user_id, [0] * len(days))[index[day]] += seconds
            task = per_task.setdefault(entry.user_id, {}).setdefault(
                facts.task.id,
                {"id": str(facts.task.id), "name": facts.task.name, "list_id": str(facts.task.list_id),
                 "status": facts.status.name, "color": facts.status.color, "seconds_per_day": [0] * len(days), "total": 0},
            )
            task["seconds_per_day"][index[day]] += seconds
            task["total"] += seconds
            if detail:
                per_entry.setdefault(entry.user_id, []).append({
                    "id": str(entry.id),
                    "task_id": str(facts.task.id),
                    "task_name": facts.task.name,
                    "color": facts.status.color,
                    "day": day.isoformat(),
                    "started_at": entry.started_at.isoformat(),
                    "ended_at": entry.ended_at.isoformat() if entry.ended_at else None,
                    "seconds": seconds,
                    "billable": bool(entry.billable),
                })
        from app.services.work.leave import daily_capacity

        # Each person's working hours less holidays and approved leave; the header uses the usual week.
        own = daily_capacity(self.db, self.access.workspace_id, list(people), days)
        capacity = [CAPACITY_SECONDS if day.weekday() < 5 else 0 for day in days]
        rows = [
            {
                "user": self._person(uid),
                "seconds_per_day": secs,
                "total": sum(secs),
                "capacity_per_day": own.get(uid, capacity),
                "billable_per_day": billable.get(uid, [0] * len(days)),
                "tasks": sorted(per_task.get(uid, {}).values(), key=lambda t: -t["total"]),
                "entries": sorted(per_entry.get(uid, []), key=lambda e: e["started_at"]),
            }
            for uid, secs in people.items()
        ]
        rows.sort(key=lambda r: (r["user"]["display_name"] or r["user"]["email"]).lower())
        return {
            "days": [day.isoformat() for day in days],
            "capacity_per_day": capacity,
            "rows": rows,
            "sees_everyone": self.time_people() is None,
        }

    # --- drill-down --------------------------------------------------------------------

    def drill(self, card: DashboardCard, segment: Optional[str]) -> s.TaskPage:
        config = d.CardConfig.model_validate(card.config)
        if card.type not in ("calculation", "pie", "bar", "line", "task_list", "portfolio", "behind",
                             "completed", "capacity", "variance", "plan"):
            raise Invalid("This card has no task drill-down")
        loaded = self.load(config)
        self.prepare(config, loaded)  # a custom-field segment needs its values to match against
        if card.type == "behind":
            matched = self._overdue(config, loaded)
        elif card.type == "completed":
            matched = [f for f, _ in self._completed(config, loaded)[0]]
        else:
            matched = self.matching(config, loaded, force_closed=card.type == "portfolio")
        if segment is not None and card.type in ("behind", "completed", "variance"):
            matched = [f for f in matched if (segment == "none" and not f.assignees) or segment in f.assignees]
        elif segment is not None:
            if card.type == "portfolio":
                matched = [f for f in matched if str(f.task.list_id) == segment]
            elif card.type in ("pie", "bar", "line"):
                matched = [f for f in matched if segment in self.segment_of(f, config, loaded)]
        matched = self._sorted(matched, config.sort)
        shown = matched[:DRILL_LIMIT]
        tasks = serialise_tasks(self.db, [f.task for f in shown], {f.task.id: f.level for f in shown})
        return s.TaskPage(tasks=tasks, total=len(matched), limit=DRILL_LIMIT, offset=0)


def _bucket_label(day: date, interval: str) -> str:
    if interval == "month":
        return day.strftime("%b %Y")
    if interval == "week":
        return "Wk of " + day.strftime("%d %b")
    return day.strftime("%d %b")
