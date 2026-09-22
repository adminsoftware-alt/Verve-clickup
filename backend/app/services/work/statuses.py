"""Status sets, their inheritance down the hierarchy, and group side effects."""

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Mapping, Optional, Sequence, Tuple, Union

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Folder, LocationKind, Space, Status, StatusGroup, Task, TaskList
from app.services.work.errors import Invalid

GROUP_ORDER = [StatusGroup.not_started, StatusGroup.active, StatusGroup.done, StatusGroup.closed]
OPEN_GROUPS = (StatusGroup.not_started, StatusGroup.active)

DEFAULT_STATUSES = [
    ("To do", "#87909e", StatusGroup.not_started),
    ("In progress", "#5b9fef", StatusGroup.active),
    ("Complete", "#008844", StatusGroup.closed),
]

MAX_STATUSES = 50
_HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

Owner = Union[Space, Folder, TaskList]


def sort_statuses(statuses: Sequence[Status]) -> List[Status]:
    return sorted(statuses, key=lambda s: (GROUP_ORDER.index(s.group), s.orderindex))


def seed_space_statuses(db: Session, space: Space) -> None:
    for position, (name, color, group) in enumerate(DEFAULT_STATUSES):
        db.add(Status(space_id=space.id, name=name, color=color, group=group, orderindex=position))


def _own(db: Session, owner: Owner) -> List[Status]:
    column = {
        Space: Status.space_id,
        Folder: Status.folder_id,
        TaskList: Status.list_id,
    }[type(owner)]
    return list(db.scalars(select(Status).where(column == owner.id)))


# --- inheritance -------------------------------------------------------------


def status_source(db: Session, owner: Owner) -> Owner:
    """The Space, Folder or List whose status rows `owner` actually uses."""
    if isinstance(owner, Space):
        return owner
    if owner.override_statuses:
        return owner
    if isinstance(owner, Folder):
        if owner.parent_folder_id is not None:
            parent = db.get(Folder, owner.parent_folder_id)
            assert parent is not None
            return status_source(db, parent)
        space = db.get(Space, owner.space_id)
        assert space is not None
        return space
    if owner.folder_id is not None:
        folder = db.get(Folder, owner.folder_id)
        assert folder is not None
        return status_source(db, folder)
    space = db.get(Space, owner.space_id)
    assert space is not None
    return space


def effective_statuses(db: Session, owner: Owner) -> List[Status]:
    return sort_statuses(_own(db, status_source(db, owner)))


def default_status(statuses: Sequence[Status]) -> Status:
    """New tasks start in the first not-started status, else the first active one."""
    ordered = sort_statuses(statuses)
    for group in OPEN_GROUPS:
        for status in ordered:
            if status.group == group:
                return status
    return ordered[0]


def source_kind(owner: Owner) -> LocationKind:
    if isinstance(owner, Space):
        return LocationKind.space
    if isinstance(owner, Folder):
        return LocationKind.folder
    return LocationKind.list


# --- group side effects ------------------------------------------------------


def apply_group_transition(
    task: Task, old: Optional[StatusGroup], new: StatusGroup, now: Optional[datetime] = None
) -> None:
    """Stamp or clear date_done / date_closed when a task changes status group."""
    if old == new:
        return
    now = now or datetime.now(timezone.utc)
    if new == StatusGroup.closed:
        task.date_closed = now
        if task.date_done is None:
            task.date_done = now
    elif new == StatusGroup.done:
        task.date_closed = None
        if old != StatusGroup.closed or task.date_done is None:
            task.date_done = now
    else:
        task.date_done = None
        task.date_closed = None


# --- replacing a status set --------------------------------------------------


@dataclass
class StatusInput:
    name: str
    color: str
    group: StatusGroup
    id: Optional[uuid.UUID] = None


def validate_status_set(inputs: Sequence[StatusInput]) -> None:
    if not inputs:
        raise Invalid("A status set needs at least one status")
    if len(inputs) > MAX_STATUSES:
        raise Invalid(f"A status set can have at most {MAX_STATUSES} statuses")
    seen = set()
    for item in inputs:
        name = item.name.strip()
        if not name or len(name) > 64:
            raise Invalid("Status names must be 1-64 characters")
        if name.lower() in seen:
            raise Invalid(f"Duplicate status name: {name}")
        seen.add(name.lower())
        if not _HEX_COLOR.match(item.color):
            raise Invalid(f"Status colour must be a #rrggbb hex value: {item.color}")
    closed = [i for i in inputs if i.group == StatusGroup.closed]
    if len(closed) != 1:
        raise Invalid("A status set must have exactly one closed status")
    if not any(i.group in OPEN_GROUPS for i in inputs):
        raise Invalid("A status set needs at least one not-started or active status")


def _lists_using(db: Session, owner: Owner) -> List[TaskList]:
    """Every List whose effective statuses could come from `owner`."""
    if isinstance(owner, TaskList):
        return [owner]
    if isinstance(owner, Space):
        return list(db.scalars(select(TaskList).where(TaskList.space_id == owner.id)))
    folder_ids = [owner.id] + list(
        db.scalars(select(Folder.id).where(Folder.parent_folder_id == owner.id))
    )
    return list(db.scalars(select(TaskList).where(TaskList.folder_id.in_(folder_ids))))


def pick_replacement(
    old_id: uuid.UUID,
    old_name: str,
    old_group: StatusGroup,
    candidates: Sequence[Status],
    mapping: Mapping[uuid.UUID, uuid.UUID],
) -> Status:
    """Choose the status a task should move to when its current one is unavailable."""
    by_id = {s.id: s for s in candidates}
    mapped = mapping.get(old_id)
    if mapped is not None and mapped in by_id:
        return by_id[mapped]
    for status in candidates:
        if status.name.lower() == old_name.lower():
            return status
    for status in candidates:
        if status.group == old_group:
            return status
    return default_status(candidates)


def set_statuses(
    db: Session,
    owner: Owner,
    inputs: Optional[Sequence[StatusInput]],
    mapping: Optional[Mapping[uuid.UUID, uuid.UUID]] = None,
) -> None:
    """Give `owner` its own status set, or (inputs=None) make it inherit again.

    Tasks left holding a status their List no longer has are remapped: an explicit
    mapping first, then a status with the same name, then one in the same group.
    """
    mapping = mapping or {}
    if inputs is None:
        if isinstance(owner, Space):
            raise Invalid("A Space always owns its statuses")
    else:
        validate_status_set(inputs)

    affected_lists = _lists_using(db, owner)
    list_ids = [lst.id for lst in affected_lists]
    tasks = (
        list(db.scalars(select(Task).where(Task.list_id.in_(list_ids)))) if list_ids else []
    )
    status_before: Dict[uuid.UUID, Tuple[str, StatusGroup]] = {}
    for status in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks}))):
        status_before[status.id] = (status.name, status.group)

    old_own = {s.id: s for s in _own(db, owner)}
    to_delete: List[Status] = []
    if inputs is None:
        owner.override_statuses = False  # type: ignore[union-attr]
        to_delete = list(old_own.values())
    else:
        if not isinstance(owner, Space):
            owner.override_statuses = True
        kept = set()
        for position, item in enumerate(inputs):
            existing = old_own.get(item.id) if item.id else None
            if existing is not None:
                existing.name, existing.color = item.name.strip(), item.color
                existing.group, existing.orderindex = item.group, position
                kept.add(existing.id)
            else:
                fields = {
                    Space: "space_id",
                    Folder: "folder_id",
                    TaskList: "list_id",
                }[type(owner)]
                db.add(
                    Status(
                        name=item.name.strip(),
                        color=item.color,
                        group=item.group,
                        orderindex=position,
                        **{fields: owner.id},
                    )
                )
        to_delete = [s for sid, s in old_own.items() if sid not in kept]
    db.flush()

    now = datetime.now(timezone.utc)
    effective_by_list = {lst.id: effective_statuses(db, lst) for lst in affected_lists}
    for task in tasks:
        candidates = effective_by_list[task.list_id]
        current = {s.id: s for s in candidates}.get(task.status_id)
        old_name, old_group = status_before[task.status_id]
        if current is None:
            current = pick_replacement(task.status_id, old_name, old_group, candidates, mapping)
            task.status_id = current.id
        apply_group_transition(task, old_group, current.group, now)
    db.flush()

    for status in to_delete:
        db.delete(status)
    db.flush()
