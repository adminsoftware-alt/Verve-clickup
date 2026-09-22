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
    DashboardCard,
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
        if p.preset == "this_year":
            return t.replace(month=1, day=1), t.replace(month=12, day=31)
        assert p.start and p.end
        return p.start, p.end

    def _window(self, preset: str) -> Tuple[datetime, datetime]:
        """A preset period as [start, end) instants."""
        first, last = self.period(d.Period(preset=preset))
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
                    self._team_people[team_id] = set(
                        self.db.scalars(
                            select(TeamMember.user_id)
                            .join(Team, Team.id == TeamMember.team_id)
                            .where(TeamMember.team_id == team_id, Team.workspace_id == self.access.workspace_id)
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

    def _matches(self, f: Facts, flt: d.Filters) -> bool:
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
            start, end = self._window(flt.done)
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
            if self._matches(f, flt) and self._matches(f, self.dashboard_filters):
                result.append(f)
        return result

    # --- measures and grouping ------------------------------------------------------

    @staticmethod
    def measure(f: Facts, measure: str) -> int:
        if measure == "time_estimate":
            return f.task.time_estimate_seconds or 0
        if measure == "time_tracked":
            return f.tracked
        return 1

    def _list_label(self, loaded: Loaded, list_id: uuid.UUID) -> str:
        for lst, _ in loaded.lists:
            if lst.id == list_id:
                return lst.name
        return "List"

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
        matched = self.matching(config, loaded)
        if config.measure == "tasks":
            return {"value": len(matched), "format": "count", "count": len(matched), "unit": config.unit}
        values = [self.measure(f, config.measure) for f in matched]
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
        return {"value": value, "format": "duration", "count": len(matched), "unit": config.unit}

    def _grouped(self, config: d.CardConfig, loaded: Loaded) -> Dict[str, Any]:
        matched = self.matching(config, loaded)
        fmt = "count" if config.measure == "tasks" else "duration"
        if config.group_by in d.DATE_GROUPS:
            buckets = self._buckets(config)
            totals = {b.isoformat(): 0 for b in buckets}
            for f in matched:
                for key in self.segment_of(f, config, loaded):
                    if key in totals:
                        totals[key] += self.measure(f, config.measure)
            segments = [
                {"key": b.isoformat(), "label": _bucket_label(b, config.interval), "color": "#6366f1", "value": totals[b.isoformat()]}
                for b in buckets
            ]
            return {"segments": segments, "format": fmt, "total": sum(totals.values()), "over_time": True}
        agg: Dict[str, Dict[str, Any]] = {}
        for f in matched:
            for key, label, color in self.keys(f, config.group_by, loaded):
                seg = agg.setdefault(key, {"key": key, "label": label, "color": color, "value": 0})
                seg["value"] += self.measure(f, config.measure)
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
        for _, when in done:
            key = self._local_day(when).isoformat()
            if key in per_day:
                per_day[key] += 1
        return {
            "rows": sorted(rows.values(), key=lambda r: (-r["done"], r["key"] == "none")),
            "total": len(done), "on_time": on_time, "late": len(done) - on_time,
            "start": first.isoformat(), "end": last.isoformat(),
            "per_day": [{"day": k, "count": v} for k, v in per_day.items()],
        }

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
        by_id = {f.task.id: f for f in loaded.facts}
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
        for entry, _ in entries:
            day = self._local_day(entry.started_at)
            if day in index:
                people.setdefault(entry.user_id, [0] * len(days))[index[day]] += entry.duration_seconds or 0
        capacity = [CAPACITY_SECONDS if day.weekday() < 5 else 0 for day in days]
        rows = [
            {"user": self._person(uid), "seconds_per_day": secs, "total": sum(secs)}
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
        if card.type not in ("calculation", "pie", "bar", "line", "task_list", "portfolio", "behind", "completed"):
            raise Invalid("This card has no task drill-down")
        loaded = self.load(config)
        if card.type == "behind":
            matched = self._overdue(config, loaded)
        elif card.type == "completed":
            matched = [f for f, _ in self._completed(config, loaded)[0]]
        else:
            matched = self.matching(config, loaded, force_closed=card.type == "portfolio")
        if segment is not None and card.type in ("behind", "completed"):
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
