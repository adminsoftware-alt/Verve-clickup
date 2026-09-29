"""Custom fields, as in ClickUp: typed task columns defined on a Space, Folder or List.

A field defined somewhere can be used by every task in every List at or below it, like
statuses and task groups. Managing fields needs edit access where they are defined;
filling one in needs edit access to the task. A field's type can't change after creation
(its values would stop making sense); its name and options can.
"""

import math
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Union

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    CustomField,
    FieldType,
    Folder,
    LocationKind,
    PermissionLevel,
    Space,
    Task,
    TaskFieldValue,
    TaskList,
    WorkspaceMember,
)
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Opened, open_folder, open_list, open_space
from app.services.work.errors import Forbidden, Invalid, NotFound

Location = Union[Space, Folder, TaskList]
OPTION_COLORS = ["#7c3aed", "#0ea5e9", "#16a34a", "#ea580c", "#db2777", "#4f46e5", "#0d9488", "#b45309", "#dc2626", "#64748b"]
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE = re.compile(r"^\+?[0-9 ()\-.]{3,30}$")
URL = re.compile(r"^https?://\S+$", re.IGNORECASE)
CURRENCY = re.compile(r"^[A-Z]{3}$")
MAX_OPTIONS = 200


# --- where fields apply ------------------------------------------------------------------------


def _chain_filters(db: Session, obj: Location):
    """Fields defined at this location or above it."""
    conds = []
    if isinstance(obj, TaskList):
        conds.append(CustomField.list_id == obj.id)
        folder = db.get(Folder, obj.folder_id) if obj.folder_id else None
        space_id = obj.space_id
    elif isinstance(obj, Folder):
        folder, space_id = obj, obj.space_id
    else:
        folder, space_id = None, obj.id
    while folder is not None:
        conds.append(CustomField.folder_id == folder.id)
        folder = db.get(Folder, folder.parent_folder_id) if folder.parent_folder_id else None
    conds.append(CustomField.space_id == space_id)
    return or_(*conds)


def _sorted(fields: Iterable[CustomField]) -> List[CustomField]:
    depth = lambda f: 2 if f.space_id else 1 if f.folder_id else 0  # noqa: E731
    return sorted(fields, key=lambda f: (-depth(f), f.orderindex, f.name.lower()))


def available(db: Session, obj: Location) -> List[CustomField]:
    """Fields tasks here can use: defined here or above; Space fields first, as in ClickUp."""
    return _sorted(db.scalars(select(CustomField).where(_chain_filters(db, obj))))


def for_lists(db: Session, lists: Sequence[TaskList]) -> Dict[uuid.UUID, List[CustomField]]:
    return {lst.id: available(db, lst) for lst in lists}


def in_view(db: Session, obj: Location, lists: Sequence[TaskList]) -> List[CustomField]:
    """Everything a view of this location may show: fields above it and in the Lists below."""
    seen: Dict[uuid.UUID, CustomField] = {f.id: f for f in available(db, obj)}
    for lst in lists:
        for f in available(db, lst):
            seen.setdefault(f.id, f)
    return _sorted(seen.values())


def field_out(f: CustomField) -> s.CustomFieldOut:
    kind, loc = (
        (LocationKind.list, f.list_id) if f.list_id
        else (LocationKind.folder, f.folder_id) if f.folder_id
        else (LocationKind.space, f.space_id)
    )
    assert loc is not None
    return s.CustomFieldOut(
        id=f.id, name=f.name, type=f.type.value, config=f.config or {}, location=kind, location_id=loc, orderindex=f.orderindex,
    )


# --- defining fields ---------------------------------------------------------------------------


def _clean_options(raw: Any, old: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    if not isinstance(raw, list):
        raise Invalid("options must be a list")
    if len(raw) > MAX_OPTIONS:
        raise Invalid(f"A field can have at most {MAX_OPTIONS} options")
    known = {o["id"] for o in (old or [])}
    out, names = [], set()
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise Invalid("Each option needs a name")
        name = str(item.get("name", "")).strip()
        if not name or len(name) > 100:
            raise Invalid("Option names must be 1-100 characters")
        if name.lower() in names:
            raise Invalid(f"Duplicate option: {name}")
        names.add(name.lower())
        color = item.get("color") or OPTION_COLORS[i % len(OPTION_COLORS)]
        if not isinstance(color, str) or not re.match(r"^#[0-9a-fA-F]{6}$", color):
            raise Invalid("Option colours must be #rrggbb")
        oid = item.get("id")
        if not (isinstance(oid, str) and oid in known):
            oid = str(uuid.uuid4())
        out.append({"id": oid, "name": name, "color": color})
    return out


def _clean_config(ftype: FieldType, raw: Dict[str, Any], old: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    raw = raw or {}
    if ftype in (FieldType.dropdown, FieldType.labels):
        return {"options": _clean_options(raw.get("options", []), (old or {}).get("options"))}
    if ftype == FieldType.money:
        currency = str(raw.get("currency") or "INR").upper()
        if not CURRENCY.match(currency):
            raise Invalid("currency must be a 3-letter code, e.g. INR")
        return {"currency": currency}
    if ftype == FieldType.number:
        precision = raw.get("precision", 0)
        if not isinstance(precision, int) or not 0 <= precision <= 4:
            raise Invalid("precision must be 0-4")
        return {"precision": precision}
    if ftype == FieldType.rating:
        top = raw.get("max", 5)
        if not isinstance(top, int) or not 1 <= top <= 10:
            raise Invalid("max must be 1-10")
        return {"max": top}
    if ftype == FieldType.date:
        return {"include_time": bool(raw.get("include_time", False))}
    return {}


def create(db: Session, opened: Opened, kind: LocationKind, data: s.CustomFieldIn) -> CustomField:
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access here to create custom fields")
    obj = opened.obj
    from app.services.work import space_admin

    space_admin.require(db, obj.id if kind == LocationKind.space else obj.space_id, "custom_fields")
    if any(f.name.lower() == data.name.lower() for f in available(db, obj)):
        raise Invalid(f"A field called {data.name} already exists here")
    ftype = FieldType(data.type)
    column = {LocationKind.space: "space_id", LocationKind.folder: "folder_id", LocationKind.list: "list_id"}[kind]
    count = db.scalar(select(func.count()).select_from(CustomField).where(getattr(CustomField, column) == obj.id)) or 0
    field = CustomField(
        name=data.name, type=ftype, config=_clean_config(ftype, data.config or {}),
        orderindex=float(count + 1), created_by=opened.access.user_id, **{column: obj.id},
    )
    db.add(field)
    db.flush()
    return field


def open_field(db: Session, user_id: str, field_id: uuid.UUID, minimum: PermissionLevel) -> CustomField:
    field = db.get(CustomField, field_id)
    if field is None:
        raise NotFound("Field not found")
    if field.list_id:
        open_list(db, user_id, field.list_id, minimum)
    elif field.folder_id:
        open_folder(db, user_id, field.folder_id, minimum)
    else:
        assert field.space_id is not None
        open_space(db, user_id, field.space_id, minimum)
    return field


def update(db: Session, user_id: str, field_id: uuid.UUID, data: s.CustomFieldUpdate) -> CustomField:
    field = open_field(db, user_id, field_id, PermissionLevel.edit)
    fields = data.model_fields_set
    if "name" in fields and data.name:
        field.name = data.name
    if "orderindex" in fields and data.orderindex is not None:
        field.orderindex = data.orderindex
    if "config" in fields and data.config is not None:
        new = _clean_config(field.type, data.config, field.config)
        if field.type in (FieldType.dropdown, FieldType.labels):
            _drop_removed_options(db, field, {o["id"] for o in new["options"]})
        field.config = new
    db.flush()
    return field


def _drop_removed_options(db: Session, field: CustomField, keep: Set[str]) -> None:
    """A deleted option disappears from every task that had it."""
    for row in db.scalars(select(TaskFieldValue).where(TaskFieldValue.field_id == field.id)):
        if field.type == FieldType.dropdown and row.value not in keep:
            db.delete(row)
        elif field.type == FieldType.labels:
            left = [v for v in row.value if v in keep]
            if not left:
                db.delete(row)
            elif left != row.value:
                row.value = left


def delete(db: Session, user_id: str, field_id: uuid.UUID) -> None:
    """Deleting a field deletes its values on every task."""
    db.delete(open_field(db, user_id, field_id, PermissionLevel.edit))
    db.flush()


# --- values ------------------------------------------------------------------------------------


def _members(db: Session, task: Task) -> Set[str]:
    ws = events.workspace_of(db, task)
    return set(db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == ws)))


def clean_value(db: Session, field: CustomField, task: Task, value: Any) -> Any:
    """Validate a value for this field's type; returns what to store (None = clear)."""
    if value is None or value == "" or value == []:
        return None
    t = field.type
    if t in (FieldType.text, FieldType.long_text):
        if not isinstance(value, str):
            raise Invalid("Expected text")
        limit = 500 if t == FieldType.text else 20_000
        if len(value) > limit:
            raise Invalid(f"Text is limited to {limit} characters")
        return value
    if t in (FieldType.number, FieldType.money):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise Invalid("Expected a number")
        if abs(value) > 1e15:
            raise Invalid("Number is too large")
        return value
    if t == FieldType.dropdown:
        ids = {o["id"] for o in field.config.get("options", [])}
        if value not in ids:
            raise Invalid("Not one of this field's options")
        return value
    if t == FieldType.labels:
        ids = [o["id"] for o in field.config.get("options", [])]
        if not isinstance(value, list) or any(v not in ids for v in value):
            raise Invalid("Not this field's options")
        return [i for i in ids if i in set(value)]  # option order, no repeats
    if t == FieldType.date:
        if not isinstance(value, str):
            raise Invalid("Expected a date")
        try:
            when = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise Invalid("Expected an ISO date") from exc
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return when.astimezone(timezone.utc).isoformat()
    if t == FieldType.checkbox:
        if not isinstance(value, bool):
            raise Invalid("Expected true or false")
        return value or None  # unticked is empty
    if t == FieldType.email:
        if not isinstance(value, str) or not EMAIL.match(value.strip()):
            raise Invalid("That isn't an email address")
        return value.strip()
    if t == FieldType.phone:
        if not isinstance(value, str) or not PHONE.match(value.strip()):
            raise Invalid("That isn't a phone number")
        return value.strip()
    if t == FieldType.url:
        text = value.strip() if isinstance(value, str) else ""
        if text and "://" not in text:
            text = f"https://{text}"
        if not URL.match(text):
            raise Invalid("That isn't a web address")
        return text
    if t == FieldType.rating:
        top = field.config.get("max", 5)
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= top:
            raise Invalid(f"Rating must be 0-{top}")
        return value or None
    if t == FieldType.progress:
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 100:
            raise Invalid("Progress must be 0-100")
        return round(value)
    if t == FieldType.people:
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise Invalid("Expected a list of people")
        members = _members(db, task)
        if any(v not in members for v in value):
            raise Invalid("Everyone must be a member of the workspace")
        return list(dict.fromkeys(value))
    if t == FieldType.location:
        # {address, lat, lng}: the address is free text; the point is what the Map view shows.
        if not isinstance(value, dict):
            raise Invalid("Expected a place: address, lat and lng")
        address = str(value.get("address") or "").strip()[:300]
        lat, lng = value.get("lat"), value.get("lng")
        for n in (lat, lng):
            if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n):
                raise Invalid("A place needs a latitude and longitude")
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise Invalid("That latitude or longitude is out of range")
        return {"address": address or f"{lat:.5f}, {lng:.5f}", "lat": round(float(lat), 6), "lng": round(float(lng), 6)}
    raise Invalid("Unknown field type")


def set_value(db: Session, opened: Opened[Task], field_id: uuid.UUID, value: Any) -> Any:
    task, access = opened.obj, opened.access
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to change this task")
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    field = next((f for f in available(db, lst) if f.id == field_id), None)
    if field is None:
        raise Invalid("That field isn't available in this task's List")
    stored = clean_value(db, field, task, value)
    row = db.get(TaskFieldValue, (task.id, field.id))
    before = row.value if row else None
    if stored is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(TaskFieldValue(task_id=task.id, field_id=field.id, value=stored, updated_by=access.user_id))
    else:
        row.value, row.updated_by = stored, access.user_id
    db.flush()
    if before != stored:
        events.record(db, task, access.user_id, "custom_field", {"field": field.name, "cleared": stored is None})
    return stored


def values_for(db: Session, task_ids: Sequence[uuid.UUID]) -> Dict[uuid.UUID, Dict[str, Any]]:
    out: Dict[uuid.UUID, Dict[str, Any]] = {}
    if not task_ids:
        return out
    for row in db.scalars(select(TaskFieldValue).where(TaskFieldValue.task_id.in_(task_ids))):
        out.setdefault(row.task_id, {})[str(row.field_id)] = row.value
    return out


def copy_values(db: Session, source: Task, target: Task) -> None:
    for row in db.scalars(select(TaskFieldValue).where(TaskFieldValue.task_id == source.id)):
        db.add(TaskFieldValue(task_id=target.id, field_id=row.field_id, value=row.value, updated_by=row.updated_by))
