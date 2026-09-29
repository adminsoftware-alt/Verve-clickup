"""Public links, as in ClickUp's "Share publicly": a secret, read-only link to a task, List or view
that anyone can open without signing in. Private tasks never show; links can expire and be revoked."""

import secrets
import uuid
from datetime import datetime, time, timezone
from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    PermissionLevel,
    PublicLink,
    Space,
    Status,
    StatusGroup,
    Task,
    TaskAssignee,
    TaskList,
    User,
    View,
    ViewContent,
    Workspace,
)
from app.schemas import spaces as sp
from app.services.work import extras
from app.services.work.access import Access, open_list, open_task
from app.services.work.errors import Forbidden, NotFound
from app.services.work.permissions import can_manage_workspace


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _target(db: Session, link: PublicLink):
    if link.task_id:
        return "task", link.task_id, db.get(Task, link.task_id)
    if link.list_id:
        return "list", link.list_id, db.get(TaskList, link.list_id)
    return "view", link.view_id, db.get(View, link.view_id)


def link_out(db: Session, link: PublicLink) -> sp.PublicLinkOut:
    kind, target_id, obj = _target(db, link)
    return sp.PublicLinkOut(
        id=link.id, token=link.token, kind=kind, target_id=target_id, target_name=getattr(obj, "name", "") if obj else "",
        show_description=link.show_description, show_assignees=link.show_assignees, expires_at=link.expires_at,
        created_at=link.created_at, created_by=link.created_by, views_count=link.views_count,
    )


def _open_view(db: Session, user_id: str, view_id: uuid.UUID, minimum: PermissionLevel):
    from app.services.work.views import open_view

    return open_view(db, user_id, view_id, minimum)


def create(db: Session, user_id: str, data: sp.PublicLinkIn) -> PublicLink:
    """Anyone who can edit the task, List or view's location can make a public link to it."""
    if data.kind == "task":
        opened = open_task(db, user_id, data.target_id, PermissionLevel.edit)
    elif data.kind == "list":
        opened = open_list(db, user_id, data.target_id, PermissionLevel.edit)
    else:
        opened = _open_view(db, user_id, data.target_id, PermissionLevel.edit)
        if opened.obj.private_to is not None:
            raise Forbidden("Private views can't be shared publicly")
    if opened.access.role.value in ("guest", "limited"):
        raise Forbidden("Guests can't make public links")
    if data.kind == "task" and opened.obj.is_private:
        raise Forbidden("Private tasks can't be shared publicly")
    link = PublicLink(
        token=secrets.token_urlsafe(24), workspace_id=opened.access.workspace_id, created_by=user_id,
        show_description=data.show_description, show_assignees=data.show_assignees,
        expires_at=datetime.combine(data.expires_on, time(23, 59), tzinfo=timezone.utc) if data.expires_on else None,
        **{f"{data.kind}_id": data.target_id},
    )
    db.add(link)
    db.flush()
    return link


def for_target(db: Session, user_id: str, kind: str, target_id: uuid.UUID) -> List[PublicLink]:
    if kind == "task":
        open_task(db, user_id, target_id, PermissionLevel.view)
    elif kind == "list":
        open_list(db, user_id, target_id, PermissionLevel.view)
    else:
        _open_view(db, user_id, target_id, PermissionLevel.view)
    column = {"task": PublicLink.task_id, "list": PublicLink.list_id, "view": PublicLink.view_id}[kind]
    return list(db.scalars(select(PublicLink).where(column == target_id).order_by(PublicLink.created_at)))


def workspace_links(db: Session, access: Access) -> List[PublicLink]:
    """Every public link in the workspace (admins) or the caller's own."""
    q = select(PublicLink).where(PublicLink.workspace_id == access.workspace_id)
    if not can_manage_workspace(access.role):
        q = q.where(PublicLink.created_by == access.user_id)
    return list(db.scalars(q.order_by(PublicLink.created_at.desc())))


def revoke(db: Session, user_id: str, link_id: uuid.UUID) -> None:
    link = db.get(PublicLink, link_id)
    if link is None:
        raise NotFound("Link not found")
    access = Access.for_workspace(db, user_id, link.workspace_id)
    if link.created_by != user_id and not can_manage_workspace(access.role):
        kind, target_id, _ = _target(db, link)
        opener = {"task": open_task, "list": open_list}.get(kind, _open_view)
        opener(db, user_id, target_id, PermissionLevel.full)
    db.delete(link)
    db.flush()


# --- what visitors see ---------------------------------------------------------------------------


def _public_tasks(db: Session, link: PublicLink, tasks: List[Task]) -> List[sp.PublicTask]:
    by_id = {t.id: t for t in tasks}

    def hidden(t: Task) -> bool:
        """Private tasks, and everything under them, stay out of public pages."""
        while t is not None:
            if t.is_private or t.archived_at is not None:
                return True
            t = by_id.get(t.parent_id) if t.parent_id else None
        return False

    tasks = [t for t in tasks if not hidden(t)]
    ids = [t.id for t in tasks]
    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks})))} if tasks else {}
    names = {}
    if link.show_assignees and ids:
        for task_id, user in db.execute(select(TaskAssignee.task_id, User).join(User, User.id == TaskAssignee.user_id).where(TaskAssignee.task_id.in_(ids))):
            names.setdefault(task_id, []).append(user.display_name or user.email.split("@")[0])
    progress = extras.progress(db, ids) if ids else {}
    out = []
    for t in tasks:
        st = statuses[t.status_id]
        done, total = progress.get(t.id, (0, 0))
        out.append(sp.PublicTask(
            id=t.id, name=t.name, status=st.name, status_color=st.color, status_group=st.group.value, priority=t.priority,
            start_date=t.start_date, due_date=t.due_date, description=t.description if link.show_description else None,
            assignees=sorted(names.get(t.id, [])), parent_id=t.parent_id, checklist_done=done, checklist_total=total,
        ))
    return out


def _location_lists(db: Session, view: View) -> List[TaskList]:
    if view.list_id:
        return [db.get(TaskList, view.list_id)]
    if view.folder_id:
        folder_ids = [view.folder_id] + list(db.scalars(select(Folder.id).where(Folder.parent_folder_id == view.folder_id)))
        q = select(TaskList).where(TaskList.folder_id.in_(folder_ids))
    else:
        q = select(TaskList).where(TaskList.space_id == view.space_id)
    lists = list(db.scalars(q.where(TaskList.archived_at.is_(None), TaskList.is_private.is_(False)).order_by(TaskList.orderindex)))

    def folder_open(folder_id) -> bool:
        while folder_id is not None:
            folder = db.get(Folder, folder_id)
            if folder is None or folder.is_private or folder.archived_at is not None:
                return False
            folder_id = folder.parent_folder_id
        return True

    return [lst for lst in lists if folder_open(lst.folder_id)]


def _list_tasks(db: Session, lists: List[TaskList], include_closed: bool) -> List[Task]:
    if not lists:
        return []
    q = (select(Task).join(Status, Status.id == Task.status_id)
         .where(Task.list_id.in_([lst.id for lst in lists]), Task.archived_at.is_(None)))
    if not include_closed:
        q = q.where(Status.group != StatusGroup.closed)
    return list(db.scalars(q.order_by(Task.orderindex, Task.created_at)))


def page(db: Session, token: str) -> sp.PublicPage:
    link = db.scalar(select(PublicLink).where(PublicLink.token == token))
    if link is None or (link.expires_at is not None and link.expires_at < _now()):
        raise NotFound("This link doesn't exist or has expired")
    kind, _, obj = _target(db, link)
    if obj is None:
        raise NotFound("This link doesn't exist or has expired")
    workspace = db.get(Workspace, link.workspace_id)
    link.views_count += 1
    out = sp.PublicPage(kind=kind, title=obj.name, workspace=workspace.name if workspace else "")
    if kind == "task":
        if obj.is_private or obj.archived_at is not None:
            raise NotFound("This link doesn't exist or has expired")
        rows = _public_tasks(db, link, [obj] + list(db.scalars(
            select(Task).where(Task.top_level_parent_id == (obj.top_level_parent_id or obj.id)).order_by(Task.orderindex))))
        out.task = rows[0] if rows and rows[0].id == obj.id else None
        mine = {obj.id}
        for r in rows[1:]:  # only this task's own subtree
            if r.parent_id in mine:
                mine.add(r.id)
                out.subtasks.append(r)
    elif kind == "list":
        out.tasks = _public_tasks(db, link, _list_tasks(db, [obj], include_closed=True))
    else:
        out.view_type = obj.type.value
        if obj.type.value in ("doc", "whiteboard", "mind_map"):
            content = db.get(ViewContent, obj.id)
            out.doc = content.content if content else {}
        if obj.type.value not in ("doc", "whiteboard", "chat", "embed"):
            show_closed = bool((obj.settings or {}).get("showClosed"))
            out.tasks = _public_tasks(db, link, _list_tasks(db, _location_lists(db, obj), include_closed=show_closed))
        if obj.type.value == "embed":
            out.doc = {"url": (obj.settings or {}).get("url")}
        location = db.get(TaskList, obj.list_id) if obj.list_id else db.get(Folder, obj.folder_id) if obj.folder_id else db.get(Space, obj.space_id)
        out.title = f"{location.name} – {obj.name}" if location else obj.name
    db.flush()
    return out

