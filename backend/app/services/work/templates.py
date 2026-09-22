"""Templates, as in ClickUp's Template Center: save a task, List or Folder, then create new
ones from it anywhere in the workspace.

A template is a snapshot (names, descriptions, priorities, estimates, tags, checklists,
subtasks, statuses, task groups, custom fields and their values), so it keeps working
when the original changes. Dates are stored relative to the day the template was saved
and land relative to the day it's used, like ClickUp's "remap dates". Assignees are kept
only if you ask, and only for people who are still members.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Checklist,
    ChecklistItem,
    CustomField,
    FieldType,
    Folder,
    PermissionLevel,
    Space,
    Status,
    Tag,
    Task,
    TaskAssignee,
    TaskFieldValue,
    TaskGroup,
    TaskList,
    TaskTag,
    Template,
    TemplateKind,
    WorkspaceMember,
)
from app.db.models.enums import StatusGroup
from app.schemas import work as s
from app.services.work import customfields, groups as task_groups, hierarchy, recurrence
from app.services.work import tasks as task_service
from app.services.work.access import Access, Opened, open_folder, open_list, open_space, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.statuses import StatusInput, effective_statuses, set_statuses

VIEW, FULL = PermissionLevel.view, PermissionLevel.full
MAX_TASKS = 1000


def _today() -> datetime:
    return datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)


# --- saving ------------------------------------------------------------------------------------


class _Counter:
    def __init__(self) -> None:
        self.n = 0

    def tick(self) -> None:
        self.n += 1
        if self.n > MAX_TASKS:
            raise Invalid(f"Templates can hold at most {MAX_TASKS} tasks")


def _offset(value: Optional[datetime], base: datetime) -> Optional[float]:
    return None if value is None else (value - base).total_seconds()


def _snap_task(db: Session, task: Task, opts: s.TemplateSave, base: datetime, count: _Counter) -> Dict[str, Any]:
    count.tick()
    status = db.get(Status, task.status_id)
    out: Dict[str, Any] = {
        "name": task.name,
        "description": task.description,
        "priority": task.priority,
        "time_estimate_seconds": task.time_estimate_seconds,
        "status": {"name": status.name, "group": status.group.value} if status else None,
        "tags": list(db.scalars(select(Tag.name).join(TaskTag, TaskTag.tag_id == Tag.id).where(TaskTag.task_id == task.id))),
        "group": None,
        "recurrence": task.recurrence if opts.include_dates else None,
    }
    if task.group_id:
        group = db.get(TaskGroup, task.group_id)
        out["group"] = {"name": group.name, "color": group.color} if group else None
    if opts.include_dates:
        out["start_offset"] = _offset(task.start_date, base)
        out["due_offset"] = _offset(task.due_date, base)
    if opts.include_assignees:
        out["assignees"] = list(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    if opts.include_checklists:
        out["checklists"] = [
            {"name": cl.name, "items": list(db.scalars(
                select(ChecklistItem.name).where(ChecklistItem.checklist_id == cl.id).order_by(ChecklistItem.orderindex)
            ))}
            for cl in db.scalars(select(Checklist).where(Checklist.task_id == task.id).order_by(Checklist.orderindex))
        ]
    if opts.include_fields:
        out["fields"] = {
            str(row.field_id): row.value
            for row in db.scalars(select(TaskFieldValue).where(TaskFieldValue.task_id == task.id))
        }
    if opts.include_subtasks:
        out["subtasks"] = [
            _snap_task(db, child, opts, base, count)
            for child in db.scalars(
                select(Task).where(Task.parent_id == task.id, Task.archived_at.is_(None)).order_by(Task.orderindex)
            )
        ]
    return out


def _own_setup(db: Session, obj, column) -> Dict[str, Any]:
    """Statuses, groups and fields defined on this very location (not inherited)."""
    own_statuses = None
    if getattr(obj, "override_statuses", False):
        own_statuses = [
            {"name": st.name, "color": st.color, "group": st.group.value}
            for st in db.scalars(select(Status).where(getattr(Status, column) == obj.id).order_by(Status.orderindex))
        ]
    return {
        "statuses": own_statuses,
        "groups": [
            {"name": g.name, "color": g.color}
            for g in db.scalars(select(TaskGroup).where(getattr(TaskGroup, column) == obj.id).order_by(TaskGroup.orderindex))
        ],
        "fields": [
            {"id": str(f.id), "name": f.name, "type": f.type.value, "config": f.config}
            for f in db.scalars(select(CustomField).where(getattr(CustomField, column) == obj.id).order_by(CustomField.orderindex))
        ],
    }


def _snap_list(db: Session, lst: TaskList, opts: s.TemplateSave, base: datetime, count: _Counter) -> Dict[str, Any]:
    out = {"name": lst.name, "description": lst.description, "color": lst.color, **_own_setup(db, lst, "list_id")}
    out["tasks"] = [
        _snap_task(db, t, opts, base, count)
        for t in db.scalars(
            select(Task).where(Task.list_id == lst.id, Task.parent_id.is_(None), Task.archived_at.is_(None)).order_by(Task.orderindex)
        )
    ] if opts.include_tasks else []
    return out


def _snap_folder(db: Session, folder: Folder, opts: s.TemplateSave, base: datetime, count: _Counter) -> Dict[str, Any]:
    return {
        "name": folder.name,
        "color": folder.color,
        **_own_setup(db, folder, "folder_id"),
        "lists": [
            _snap_list(db, lst, opts, base, count)
            for lst in db.scalars(
                select(TaskList).where(TaskList.folder_id == folder.id, TaskList.archived_at.is_(None)).order_by(TaskList.orderindex)
            )
        ],
        "folders": [
            _snap_folder(db, sub, opts, base, count)
            for sub in db.scalars(
                select(Folder).where(Folder.parent_folder_id == folder.id, Folder.archived_at.is_(None)).order_by(Folder.orderindex)
            )
        ],
    }


def save(db: Session, user_id: str, kind: TemplateKind, source_id: uuid.UUID, data: s.TemplateSave) -> Template:
    """Anyone who can see something can save it as a template."""
    base = _today()
    count = _Counter()
    if kind == TemplateKind.task:
        opened = open_task(db, user_id, source_id, VIEW)
        snapshot = _snap_task(db, opened.obj, data, base, count)
    elif kind == TemplateKind.list:
        opened = open_list(db, user_id, source_id, VIEW)
        snapshot = _snap_list(db, opened.obj, data, base, count)
    else:
        opened = open_folder(db, user_id, source_id, VIEW)
        snapshot = _snap_folder(db, opened.obj, data, base, count)
    if opened.access.role.value == "guest":
        raise Forbidden("Guests can't create templates")
    template = Template(
        workspace_id=opened.access.workspace_id, kind=kind, name=data.name or snapshot["name"],
        description=data.description, data={"version": 1, "saved_on": base.isoformat(), "root": snapshot},
        is_private=data.is_private, created_by=user_id,
    )
    db.add(template)
    db.flush()
    return template


# --- listing and managing ------------------------------------------------------------------------


def _count_tasks(node: Dict[str, Any]) -> int:
    n = 0
    for t in node.get("tasks", []) + node.get("subtasks", []):
        n += 1 + _count_tasks(t)
    for child in node.get("lists", []) + node.get("folders", []):
        n += _count_tasks(child)
    return n


def template_out(t: Template) -> s.TemplateOut:
    root = t.data.get("root", {})
    tasks = _count_tasks(root) + (1 if t.kind == TemplateKind.task else 0)
    return s.TemplateOut(
        id=t.id, kind=t.kind.value, name=t.name, description=t.description, is_private=t.is_private,
        created_by=t.created_by, created_at=t.created_at, use_count=t.use_count, task_count=tasks,
        list_count=len(root.get("lists", [])) + sum(len(f.get("lists", [])) for f in root.get("folders", [])),
        field_count=len(root.get("fields", [])),
    )


def _visible(t: Template, access: Access) -> bool:
    return not t.is_private or t.created_by == access.user_id


def list_templates(db: Session, user_id: str, workspace_id: uuid.UUID, kind: Optional[TemplateKind]) -> List[Template]:
    access = Access.for_workspace(db, user_id, workspace_id)
    if access.role.value == "guest":
        return []
    q = select(Template).where(Template.workspace_id == workspace_id)
    if kind is not None:
        q = q.where(Template.kind == kind)
    rows = [t for t in db.scalars(q) if _visible(t, access)]
    return sorted(rows, key=lambda t: (-t.use_count, t.name.lower()))


def _open(db: Session, user_id: str, template_id: uuid.UUID) -> "tuple[Template, Access]":
    t = db.get(Template, template_id)
    if t is None:
        raise NotFound("Template not found")
    try:
        access = Access.for_workspace(db, user_id, t.workspace_id)
    except NotFound:
        raise NotFound("Template not found") from None
    if not _visible(t, access) or access.role.value == "guest":
        raise NotFound("Template not found")
    return t, access


def _can_manage(t: Template, access: Access) -> bool:
    return t.created_by == access.user_id or access.role.value in ("owner", "admin")


def update(db: Session, user_id: str, template_id: uuid.UUID, data: s.TemplateUpdate) -> Template:
    t, access = _open(db, user_id, template_id)
    if not _can_manage(t, access):
        raise Forbidden("Only its creator or an admin can change this template")
    fields = data.model_fields_set
    if "name" in fields and data.name:
        t.name = data.name
    if "description" in fields:
        t.description = data.description
    if "is_private" in fields and data.is_private is not None:
        t.is_private = data.is_private
    db.flush()
    return t


def delete(db: Session, user_id: str, template_id: uuid.UUID) -> None:
    t, access = _open(db, user_id, template_id)
    if not _can_manage(t, access):
        raise Forbidden("Only its creator or an admin can delete this template")
    db.delete(t)
    db.flush()


# --- using a template ----------------------------------------------------------------------------


class _Builder:
    """Creates tasks from snapshots inside one List."""

    def __init__(self, db: Session, access: Access, lst: TaskList, opened_list: Opened[TaskList],
                 field_map: Dict[str, uuid.UUID], base: datetime):
        self.db, self.access, self.lst, self.opened = db, access, lst, opened_list
        self.field_map = field_map
        self.base = base
        self.statuses = effective_statuses(db, lst)
        self.groups = {g.name.lower(): g.id for g in task_groups.available(db, lst)}
        self.fields = {f.id: f for f in customfields.available(db, lst)}
        self.members = set(db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == access.workspace_id)))

    def _status_id(self, snap: Optional[Dict[str, Any]]) -> Optional[uuid.UUID]:
        if not snap:
            return None
        for st in self.statuses:
            if st.name.lower() == snap["name"].lower():
                return st.id
        for st in self.statuses:
            if st.group.value == snap.get("group"):
                return st.id
        return None

    def _when(self, offset: Optional[float]) -> Optional[datetime]:
        return None if offset is None else self.base + timedelta(seconds=offset)

    def task(self, snap: Dict[str, Any], parent: Optional[Task], name: Optional[str] = None) -> Task:
        start, due = self._when(snap.get("start_offset")), self._when(snap.get("due_offset"))
        if start and due and due < start:
            start = None
        data = s.TaskCreate(
            name=(name or snap["name"])[:500],
            description=snap.get("description"),
            status_id=self._status_id(snap.get("status")),
            priority=snap.get("priority"),
            time_estimate_seconds=snap.get("time_estimate_seconds"),
            assignees=[u for u in snap.get("assignees", []) if u in self.members],
            tags=snap.get("tags", []),
            parent_id=parent.id if parent else None,
            group_id=self.groups.get((snap.get("group") or {}).get("name", "").lower()),
            start_date=start,
            due_date=due,
        )
        task = task_service.create_task(self.db, self.opened, data)
        if snap.get("recurrence"):
            try:
                recurrence.set_rule(task, s.Recurrence.model_validate(snap["recurrence"]))
            except (ValueError, Invalid):
                pass  # a rule that no longer validates is simply left off
        for i, cl in enumerate(snap.get("checklists", [])):
            checklist = Checklist(task_id=task.id, name=cl["name"][:200], orderindex=float(i + 1))
            self.db.add(checklist)
            self.db.flush()
            for j, item in enumerate(cl.get("items", [])):
                self.db.add(ChecklistItem(checklist_id=checklist.id, name=str(item)[:500], orderindex=float(j + 1)))
        for old_id, value in (snap.get("fields") or {}).items():
            field_id = self.field_map.get(old_id)
            if field_id is None:
                try:
                    field_id = uuid.UUID(old_id)
                except ValueError:
                    continue
            field = self.fields.get(field_id)
            if field is None:
                continue
            try:
                # Copied fields keep their option ids, so values carry over as they are.
                stored = customfields.clean_value(self.db, field, task, value)
            except Invalid:
                continue
            if stored is not None:
                self.db.add(TaskFieldValue(task_id=task.id, field_id=field.id, value=stored, updated_by=self.access.user_id))
        self.db.flush()
        for child in snap.get("subtasks", []):
            self.task(child, task)
        return task


def _setup(db: Session, access: Access, obj, column: str, snap: Dict[str, Any]) -> Dict[str, uuid.UUID]:
    """Recreate a location's own statuses, groups and fields; returns old field id -> new."""
    if snap.get("statuses"):
        set_statuses(db, obj, [StatusInput(name=x["name"], color=x["color"], group=StatusGroup(x["group"])) for x in snap["statuses"]])
    for i, g in enumerate(snap.get("groups", [])):
        db.add(TaskGroup(name=g["name"], color=g["color"], orderindex=float(i + 1), created_by=access.user_id, **{column: obj.id}))
    field_map: Dict[str, uuid.UUID] = {}
    for i, f in enumerate(snap.get("fields", [])):
        new = CustomField(name=f["name"], type=FieldType(f["type"]), config=f.get("config") or {},
                          orderindex=float(i + 1), created_by=access.user_id, **{column: obj.id})
        db.add(new)
        db.flush()
        field_map[f["id"]] = new.id
    db.flush()
    return field_map


def _build_list(db: Session, access: Access, space: Space, folder: Optional[Folder], snap: Dict[str, Any],
                name: Optional[str], field_map: Dict[str, uuid.UUID], base: datetime) -> TaskList:
    lst = hierarchy.create_list(
        db, access, space, s.ListCreate(name=(name or snap["name"])[:100], description=snap.get("description"), color=snap.get("color")),
        folder=folder,
    )
    own_map = _setup(db, access, lst, "list_id", snap)
    builder = _Builder(db, access, lst, Opened(lst, access, FULL), {**field_map, **own_map}, base)
    for t in snap.get("tasks", []):
        builder.task(t, None)
    return lst


def _build_folder(db: Session, access: Access, space: Space, parent: Optional[Folder], snap: Dict[str, Any],
                  name: Optional[str], field_map: Dict[str, uuid.UUID], base: datetime) -> Folder:
    folder = hierarchy.create_folder(db, access, space, s.FolderCreate(name=(name or snap["name"])[:100], color=snap.get("color")), parent)
    if snap.get("lists") or snap.get("folders"):
        # The template brings its own Lists, so drop the empty starter List.
        for starter in db.scalars(select(TaskList).where(TaskList.folder_id == folder.id)):
            db.delete(starter)
        db.flush()
    fmap = {**field_map, **_setup(db, access, folder, "folder_id", snap)}
    for sub in snap.get("folders", []):
        _build_folder(db, access, space, folder, sub, None, fmap, base)
    for lst in snap.get("lists", []):
        _build_list(db, access, space, folder, lst, None, fmap, base)
    return folder


def apply(db: Session, user_id: str, template_id: uuid.UUID, data: s.TemplateApply) -> s.TemplateApplied:
    t, _ = _open(db, user_id, template_id)
    root = t.data.get("root", {})
    base = _today()
    if t.kind == TemplateKind.task:
        if data.list_id is None:
            raise Invalid("Choose a List to create the task in")
        opened = open_list(db, user_id, data.list_id, VIEW)
        if opened.level != FULL:
            raise Forbidden("You need full access to the List to create tasks in it")
        task = _Builder(db, opened.access, opened.obj, opened, {}, base).task(root, None, data.name)
        result = s.TemplateApplied(kind="task", id=task.id, list_id=opened.obj.id)
    elif t.kind == TemplateKind.list:
        if (data.space_id is None) == (data.folder_id is None):
            raise Invalid("Choose a Space or a Folder for the new List")
        if data.folder_id is not None:
            opened_f = open_folder(db, user_id, data.folder_id, VIEW)
            if opened_f.level != FULL:
                raise Forbidden("You need full access to create Lists here")
            space = db.get(Space, opened_f.obj.space_id)
            lst = _build_list(db, opened_f.access, space, opened_f.obj, root, data.name, {}, base)
        else:
            opened_s = open_space(db, user_id, data.space_id, VIEW)
            if opened_s.level != FULL:
                raise Forbidden("You need full access to create Lists here")
            lst = _build_list(db, opened_s.access, opened_s.obj, None, root, data.name, {}, base)
        result = s.TemplateApplied(kind="list", id=lst.id)
    else:
        if data.space_id is None:
            raise Invalid("Choose a Space for the new Folder")
        opened_s = open_space(db, user_id, data.space_id, VIEW)
        if opened_s.level != FULL:
            raise Forbidden("You need full access to create Folders here")
        folder = _build_folder(db, opened_s.access, opened_s.obj, None, root, data.name, {}, base)
        result = s.TemplateApplied(kind="folder", id=folder.id)
    t.use_count += 1
    db.flush()
    return result
