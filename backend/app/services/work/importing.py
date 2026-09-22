"""Importing tasks from a spreadsheet (CSV) into a List, like ClickUp's CSV import.

The browser reads the file and maps its columns; each row arrives here as text. Every row
is created on its own, so one bad row doesn't stop the rest: rows that can't be understood
are reported with the reason, and values that can't be matched (an unknown status or
person) are skipped with a warning while the task is still created.
"""

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import CustomField, FieldType, PermissionLevel, TaskFieldValue, User, WorkspaceMember
from app.schemas import work as s
from app.services.work import customfields
from app.services.work import tasks as task_service
from app.services.work.access import Opened
from app.services.work.errors import Forbidden, Invalid, WorkError
from app.services.work.statuses import effective_statuses

PRIORITY_WORDS = {"urgent": 1, "high": 2, "normal": 3, "medium": 3, "low": 4}
DATE_FORMATS = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%Y/%m/%d"]
TRUE_WORDS = {"yes", "y", "true", "1", "x", "✓", "done", "checked"}


def parse_date(text: str, tz_offset_minutes: int = 0) -> datetime:
    """Dates are read day-first (as in India); a bare date lands at noon local time."""
    raw = text.strip()
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if value.tzinfo is not None:
            return value.astimezone(timezone.utc)
        if len(raw) > 10:
            return value.replace(tzinfo=timezone.utc)
    except ValueError:
        value = None
    if value is None:
        for fmt in DATE_FORMATS:
            try:
                value = datetime.strptime(raw, fmt)
                break
            except ValueError:
                continue
    if value is None:
        raise Invalid(f"Can't read the date “{raw}” (use YYYY-MM-DD or DD/MM/YYYY)")
    local_noon = value.replace(hour=12, minute=0, second=0, microsecond=0)
    return (local_noon + timedelta(minutes=tz_offset_minutes)).replace(tzinfo=timezone.utc)


def parse_duration(text: str) -> int:
    raw = text.strip().lower()
    if re.fullmatch(r"\d+", raw):
        return int(raw) * 60  # plain numbers are minutes
    clock = re.fullmatch(r"(\d+):(\d{1,2})", raw)
    if clock:
        return int(clock.group(1)) * 3600 + int(clock.group(2)) * 60
    total, found = 0.0, False
    for amount, unit in re.findall(r"(\d+(?:\.\d+)?)\s*(d|h|m)", raw):
        found = True
        total += float(amount) * {"d": 8 * 3600, "h": 3600, "m": 60}[unit]
    if not found:
        raise Invalid(f"Can't read the time “{text}” (use e.g. 1h 30m)")
    return int(total)


def _priority(text: str) -> Optional[int]:
    raw = text.strip().lower()
    if not raw or raw in ("none", "no priority", "-"):
        return None
    if raw in PRIORITY_WORDS:
        return PRIORITY_WORDS[raw]
    if raw in ("1", "2", "3", "4"):
        return int(raw)
    raise Invalid(f"Unknown priority “{text}” (use Urgent, High, Normal or Low)")


def _split(text: str) -> List[str]:
    return [p.strip() for p in re.split(r"[,;]", text) if p.strip()]


def _people(db: Session, workspace_id: uuid.UUID) -> Dict[str, str]:
    """email / display name (lower-case) -> user id, for workspace members."""
    out: Dict[str, str] = {}
    for user in db.scalars(
        select(User).join(WorkspaceMember, WorkspaceMember.user_id == User.id).where(WorkspaceMember.workspace_id == workspace_id)
    ):
        out[user.email.lower()] = user.id
        if user.display_name:
            out.setdefault(user.display_name.lower(), user.id)
    return out


def _field_value(field: CustomField, raw: str, people: Dict[str, str], tz: int) -> Tuple[Any, Optional[str]]:
    """Text -> the field's value; returns (value, warning)."""
    text = raw.strip()
    if not text:
        return None, None
    t = field.type
    options = {o["name"].lower(): o["id"] for o in field.config.get("options", [])}
    if t in (FieldType.number, FieldType.money):
        cleaned = re.sub(r"[^\d.\-]", "", text.replace(",", ""))
        try:
            return float(cleaned) if "." in cleaned else int(cleaned), None
        except ValueError:
            return None, f"{field.name}: “{text}” isn't a number"
    if t == FieldType.dropdown:
        if text.lower() in options:
            return options[text.lower()], None
        return None, f"{field.name}: no option called “{text}”"
    if t == FieldType.labels:
        names = _split(text)
        found = [options[n.lower()] for n in names if n.lower() in options]
        missing = [n for n in names if n.lower() not in options]
        return found or None, (f"{field.name}: no option called {', '.join(missing)}" if missing else None)
    if t == FieldType.checkbox:
        return text.lower() in TRUE_WORDS, None
    if t == FieldType.date:
        return parse_date(text, tz).isoformat(), None
    if t == FieldType.people:
        names = _split(text)
        found = [people[n.lower()] for n in names if n.lower() in people]
        missing = [n for n in names if n.lower() not in people]
        return found or None, (f"{field.name}: {', '.join(missing)} isn't a member" if missing else None)
    if t == FieldType.rating:
        digits = re.match(r"\d+", text)
        return (int(digits.group()) if digits else None), None
    if t == FieldType.progress:
        digits = re.match(r"\d+(?:\.\d+)?", text)
        return (float(digits.group()) if digits else None), None
    return text, None


def import_rows(db: Session, opened: Opened, data: s.ImportIn) -> s.ImportResult:
    lst, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access to the List to import tasks into it")
    statuses = {st.name.lower(): st.id for st in effective_statuses(db, lst)}
    people = _people(db, access.workspace_id)
    fields = {f.id: f for f in customfields.available(db, lst)}
    created: List[uuid.UUID] = []
    errors: List[s.ImportIssue] = []
    warnings: List[s.ImportIssue] = []
    for number, row in enumerate(data.rows, start=1):
        notes: List[str] = []
        try:
            with db.begin_nested():
                if not row.name or not row.name.strip():
                    raise Invalid("The task name is empty")
                status_id = None
                if row.status and row.status.strip():
                    status_id = statuses.get(row.status.strip().lower())
                    if status_id is None:
                        notes.append(f"unknown status “{row.status.strip()}”, used the List's first status")
                assignees = []
                for who in _split(row.assignees or ""):
                    uid = people.get(who.lower())
                    if uid:
                        assignees.append(uid)
                    else:
                        notes.append(f"{who} isn't a member, left unassigned")
                start = parse_date(row.start_date, data.tz_offset) if row.start_date and row.start_date.strip() else None
                due = parse_date(row.due_date, data.tz_offset) if row.due_date and row.due_date.strip() else None
                if start and due and due < start:
                    notes.append("start date was after the due date, so it was left out")
                    start = None
                create = s.TaskCreate(
                    name=row.name.strip()[:500],
                    description=(row.description or None),
                    status_id=status_id,
                    priority=_priority(row.priority or ""),
                    time_estimate_seconds=parse_duration(row.time_estimate) if row.time_estimate and row.time_estimate.strip() else None,
                    assignees=list(dict.fromkeys(assignees)),
                    tags=[t[:64] for t in _split(row.tags or "")][:40],
                    start_date=start,
                    due_date=due,
                )
                task = task_service.create_task(db, opened, create)
                for key, raw in (row.fields or {}).items():
                    try:
                        field = fields.get(uuid.UUID(key))
                    except ValueError:
                        field = None
                    if field is None:
                        continue
                    try:
                        value, warning = _field_value(field, raw or "", people, data.tz_offset)
                    except Invalid as exc:
                        value, warning = None, f"{field.name}: {exc.message}"
                    if warning:
                        notes.append(warning)
                    if value is None:
                        continue
                    try:
                        stored = customfields.clean_value(db, field, task, value)
                    except Invalid as exc:
                        notes.append(f"{field.name}: {exc.message}")
                        continue
                    if stored is not None:
                        db.add(TaskFieldValue(task_id=task.id, field_id=field.id, value=stored, updated_by=access.user_id))
                db.flush()
                created.append(task.id)
        except WorkError as exc:
            errors.append(s.ImportIssue(row=number, message=exc.message))
            continue
        except ValueError as exc:  # pydantic validation of a row
            errors.append(s.ImportIssue(row=number, message=str(exc).splitlines()[0]))
            continue
        for note in notes:
            warnings.append(s.ImportIssue(row=number, message=note))
    db.flush()
    return s.ImportResult(created=len(created), task_ids=created, errors=errors, warnings=warnings)
