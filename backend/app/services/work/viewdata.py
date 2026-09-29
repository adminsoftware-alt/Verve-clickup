"""Data behind the extra views: All Tasks, Gantt dependencies, the Activity view, and Forms."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    PermissionLevel,
    Space,
    Task,
    TaskActivity,
    TaskComment,
    TaskFieldValue,
    TaskLink,
    TaskList,
    User,
    View,
    ViewType,
)
from app.schemas import work as s
from app.services.work import customfields
from app.services.work import tasks as task_service
from app.services.work.access import Access, Opened
from app.services.work.errors import Forbidden, Invalid, NotFound

VIEW = PermissionLevel.view


# --- All Tasks (ClickUp's "Everything") ----------------------------------------------------------


def all_tasks(db: Session, access: Access, include_closed: bool, limit: int) -> s.TaskPage:
    """Every task the caller can open, across all Spaces (and Lists shared with them)."""
    lists = []
    for space in db.scalars(
        select(Space).where(Space.workspace_id == access.workspace_id, Space.archived_at.is_(None)).order_by(Space.orderindex)
    ):
        # visible_lists checks each List on its own, so Lists shared out of an unseen Space count too.
        lists.extend(task_service.visible_lists(db, Opened(space, access, VIEW)))
    tasks, levels, _ = task_service.visible_tasks(db, access, lists, task_service.TaskFilter(include_closed=include_closed))
    return s.TaskPage(tasks=task_service.serialise_tasks(db, tasks[:limit], levels), total=len(tasks), limit=limit, offset=0)


def _location_task_ids(db: Session, opened: Opened) -> List[uuid.UUID]:
    tasks, _, _ = task_service.visible_tasks(
        db, opened.access, task_service.visible_lists(db, opened), task_service.TaskFilter(include_closed=True)
    )
    return [t.id for t in tasks]


# --- Gantt: dependency arrows ---------------------------------------------------------------------


def dependencies_in(db: Session, opened: Opened) -> List[s.DependencyOut]:
    ids = set(_location_task_ids(db, opened))
    if not ids:
        return []
    rows = db.scalars(select(TaskLink).where(TaskLink.kind == "blocks", TaskLink.task_id.in_(ids), TaskLink.other_id.in_(ids)))
    return [s.DependencyOut(blocker_id=r.task_id, waiting_id=r.other_id) for r in rows]


# --- Activity view ---------------------------------------------------------------------------------


def activity_in(db: Session, opened: Opened, limit: int, before: Optional[datetime]) -> List[s.LocationActivity]:
    """Recent changes and comments on the tasks here that the caller can see, newest first."""
    ids = _location_task_ids(db, opened)
    if not ids:
        return []
    info = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_(ids)))}
    # Comments come from the comments themselves (with their text), not from the history rows.
    q_act = select(TaskActivity).where(TaskActivity.task_id.in_(ids), TaskActivity.kind != "comment")
    q_com = select(TaskComment).where(TaskComment.task_id.in_(ids))
    if before is not None:
        q_act = q_act.where(TaskActivity.created_at < before)
        q_com = q_com.where(TaskComment.created_at < before)
    acts = list(db.scalars(q_act.order_by(TaskActivity.created_at.desc()).limit(limit)))
    coms = list(db.scalars(q_com.order_by(TaskComment.created_at.desc()).limit(limit)))
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({a.user_id for a in acts} | {c.user_id for c in coms})))}
    items: List[s.LocationActivity] = []
    for a in acts:
        t = info[a.task_id]
        items.append(s.LocationActivity(
            id=a.id, kind=a.kind, data=a.data, created_at=a.created_at, comment=None,
            user=s.UserOut.model_validate(people[a.user_id]) if a.user_id in people else None,
            task_id=t.id, task_name=t.name, list_id=t.list_id,
        ))
    for c in coms:
        t = info[c.task_id]
        items.append(s.LocationActivity(
            id=c.id, kind="comment", data={}, created_at=c.created_at, comment=c.body[:500],
            user=s.UserOut.model_validate(people[c.user_id]) if c.user_id in people else None,
            task_id=t.id, task_name=t.name, list_id=t.list_id,
        ))
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items[:limit]


# --- Forms -----------------------------------------------------------------------------------------

CORE_FIELDS = {
    "name": ("Task name", "text"),
    "description": ("Description", "long_text"),
    "due_date": ("Due date", "date"),
    "start_date": ("Start date", "date"),
    "priority": ("Priority", "priority"),
    "time_estimate": ("Time estimate (hours)", "number"),
}


def _form_view(db: Session, access: Access, view_id: uuid.UUID) -> View:
    view = db.get(View, view_id)
    if view is None or view.type != ViewType.form or view.list_id is None:
        raise NotFound("Form not found")
    lst = db.get(TaskList, view.list_id)
    space = db.get(Space, lst.space_id) if lst else None
    if lst is None or space is None or space.workspace_id != access.workspace_id or lst.archived_at is not None:
        raise NotFound("Form not found")
    if access.role.value == "guest":
        raise NotFound("Form not found")
    return view


def _form_settings(view: View) -> Dict[str, Any]:
    form = (view.settings or {}).get("form") or {}
    fields = form.get("fields") or [{"key": "name", "label": "Task name", "required": True}]
    if not any(f.get("key") == "name" for f in fields):
        fields = [{"key": "name", "label": "Task name", "required": True}, *fields]
    return {**form, "fields": fields}


def form_for(db: Session, access: Access, view_id: uuid.UUID) -> s.FormOut:
    """Anyone in the workspace (not guests) can open an active form, even without access to its List."""
    view = _form_view(db, access, view_id)
    form = _form_settings(view)
    lst = db.get(TaskList, view.list_id)
    assert lst is not None
    available = {str(f.id): f for f in customfields.available(db, lst)}
    fields: List[s.FormFieldOut] = []
    for f in form["fields"]:
        key = str(f.get("key", ""))
        if key in CORE_FIELDS:
            label, kind = CORE_FIELDS[key]
            fields.append(s.FormFieldOut(key=key, label=f.get("label") or label, required=bool(f.get("required")) or key == "name",
                                         help=f.get("help"), type=kind))
        elif key.startswith("cf:") and key[3:] in available:
            cf = available[key[3:]]
            fields.append(s.FormFieldOut(key=key, label=f.get("label") or cf.name, required=bool(f.get("required")), help=f.get("help"),
                                         type=cf.type.value, field=customfields.field_out(cf)))
    return s.FormOut(
        view_id=view.id, list_id=lst.id, list_name=lst.name, title=form.get("title") or view.name,
        description=form.get("description"), active=form.get("active", True) is not False, fields=fields,
        success=form.get("success") or "Thanks! Your request has been received.",
    )


def submit_form(db: Session, access: Access, view_id: uuid.UUID, answers: Dict[str, Any]) -> uuid.UUID:
    """Creates a task in the form's List for whoever fills it in."""
    from app.services.work.importing import parse_date

    form = form_for(db, access, view_id)
    if not form.active:
        raise Forbidden("This form isn't accepting responses right now")
    view = db.get(View, view_id)
    assert view is not None
    settings = _form_settings(view)
    missing = [f.label for f in form.fields if f.required and answers.get(f.key) in (None, "", [])]
    if missing:
        raise Invalid(f"Please fill in: {', '.join(missing)}")
    lst = db.get(TaskList, form.list_id)
    assert lst is not None
    kwargs: Dict[str, Any] = {"name": str(answers["name"]).strip()[:500], "description": (answers.get("description") or None)}
    for key in ("due_date", "start_date"):
        if answers.get(key):
            kwargs[key] = parse_date(str(answers[key]))
    if answers.get("priority") not in (None, ""):
        p = int(answers["priority"])
        if p not in (1, 2, 3, 4):
            raise Invalid("Priority must be 1-4")
        kwargs["priority"] = p
    if answers.get("time_estimate") not in (None, ""):
        kwargs["time_estimate_seconds"] = int(float(answers["time_estimate"]) * 3600)
    kwargs["assignees"] = [str(u) for u in settings.get("assignee_ids") or []]
    if settings.get("status_id"):
        kwargs["status_id"] = uuid.UUID(str(settings["status_id"]))
    # The form itself is the permission: submitters needn't have access to the List, and whoever set the
    # form up already chose who the requests go to, so those assignees aren't re-checked here.
    task = task_service.create_task(
        db, Opened(lst, access, PermissionLevel.full), s.TaskCreate(**kwargs), check_assignee_access=False,
    )
    for f in form.fields:
        if f.key.startswith("cf:") and f.field is not None and answers.get(f.key) not in (None, "", []):
            field = next((x for x in customfields.available(db, lst) if str(x.id) == f.key[3:]), None)
            if field is None:
                continue
            stored = customfields.clean_value(db, field, task, answers[f.key])
            if stored is not None:
                db.add(TaskFieldValue(task_id=task.id, field_id=field.id, value=stored, updated_by=access.user_id))
    db.flush()
    return task.id

