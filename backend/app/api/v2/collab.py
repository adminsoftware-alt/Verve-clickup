"""Comments, activity, watchers, the Inbox, notification settings and reminders."""

import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.db.models import Checklist, PermissionLevel, TaskActivity, User, WorkspaceMember
from app.db.session import get_db
from app.schemas import collab as c
from app.schemas import work as s
from app.services.work import comments, events, extras, inbox
from app.services.work.access import Access, chain_for_task, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound

router = APIRouter()
VIEW = PermissionLevel.view


def _ws(db: Session, user: User, workspace_id: uuid.UUID) -> Access:
    return Access.for_workspace(db, user.id, workspace_id)


# --- comments -------------------------------------------------------------------------


@router.get("/tasks/{task_id}/comments", response_model=List[c.CommentOut])
def list_comments(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return comments.list_for_task(db, open_task(db, user.id, task_id, VIEW))


@router.post("/tasks/{task_id}/comments", response_model=c.CommentOut, status_code=status.HTTP_201_CREATED)
def add_comment(task_id: uuid.UUID, data: c.CommentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    row = comments.add(db, opened, data)
    db.commit()
    return comments.serialise(db, [row], user.id, {opened.obj.id: opened.level})[0]


@router.patch("/comments/{comment_id}", response_model=c.CommentOut)
def update_comment(comment_id: uuid.UUID, data: c.CommentUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = comments.update(db, user.id, comment_id, data)
    db.commit()
    return comments.serialise(db, [row], user.id)[0]


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_comment(comment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    comments.delete(db, user.id, comment_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/comments/{comment_id}/reactions", response_model=c.CommentOut)
def react(comment_id: uuid.UUID, data: c.ReactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = comments.react(db, user.id, comment_id, data.emoji)
    db.commit()
    return comments.serialise(db, [row], user.id)[0]


@router.get("/workspaces/{workspace_id}/assigned-comments", response_model=List[c.CommentWithTask])
def assigned_comments(
    workspace_id: uuid.UUID, include_resolved: bool = Query(False), user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return comments.assigned_to_me(db, _ws(db, user, workspace_id), include_resolved)


@router.get("/workspaces/{workspace_id}/replies", response_model=List[c.CommentWithTask])
def replies(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return comments.replies_for_me(db, _ws(db, user, workspace_id))


# --- activity and watchers ------------------------------------------------------------------


@router.get("/tasks/{task_id}/activity", response_model=List[c.ActivityOut])
def activity(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    rows = list(db.scalars(select(TaskActivity).where(TaskActivity.task_id == opened.obj.id).order_by(TaskActivity.created_at)))
    people = {u.id: u for u in db.scalars(select(User).where(User.id.in_({r.user_id for r in rows if r.user_id})))}
    return [
        c.ActivityOut(id=r.id, user=s.UserOut.model_validate(people[r.user_id]) if r.user_id in people else None,
                      kind=r.kind, data=r.data, created_at=r.created_at)
        for r in rows
    ]


def _watchers_out(db: Session, task_id: uuid.UUID, me: str) -> c.WatchersOut:
    ids = events.watchers(db, task_id)
    people = list(db.scalars(select(User).where(User.id.in_(ids)).order_by(User.email))) if ids else []
    return c.WatchersOut(watchers=[s.UserOut.model_validate(u) for u in people], watching=me in ids)


@router.get("/tasks/{task_id}/watchers", response_model=c.WatchersOut)
def get_watchers(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    return _watchers_out(db, opened.obj.id, user.id)


@router.post("/tasks/{task_id}/watchers", response_model=c.WatchersOut)
def add_watcher(task_id: uuid.UUID, data: c.WatcherIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    target = data.user_id or user.id
    if target != user.id:
        if not opened.level.at_least(PermissionLevel.edit):
            raise Forbidden("You need edit access to add other watchers")
        member = db.get(WorkspaceMember, (opened.access.workspace_id, target))
        if member is None or Access(db, target, opened.access.workspace_id, member.role).level(chain_for_task(db, opened.obj)) is None:
            raise Invalid("That person can't see this task")
    events.watch(db, opened.obj.id, [target])
    db.commit()
    return _watchers_out(db, opened.obj.id, user.id)


@router.delete("/tasks/{task_id}/watchers/{user_id}", response_model=c.WatchersOut)
def remove_watcher(task_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    if user_id != user.id and not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to remove other watchers")
    events.unwatch(db, opened.obj.id, user_id)
    db.commit()
    return _watchers_out(db, opened.obj.id, user.id)


# --- Inbox ----------------------------------------------------------------------------------------


def _csv(value: Optional[str]) -> List[str]:
    """Repeated query parameters would be tidier, but the client's request helper sends scalars."""
    return [part for part in (value or "").split(",") if part]


@router.get("/workspaces/{workspace_id}/inbox", response_model=List[c.InboxItem])
def get_inbox(
    workspace_id: uuid.UUID,
    tab: c.InboxTab = Query("primary"),
    group: Optional[str] = Query(None, description="Comma-separated kind groups, e.g. assigned,comments"),
    unread: bool = Query(False),
    priority: Optional[str] = Query(None, description="Comma-separated, 1 (urgent) to 4 (low)"),
    due: Optional[c.InboxDue] = Query(None),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        wanted = [int(x) for x in _csv(priority)]
    except ValueError:
        raise HTTPException(status_code=422, detail="Priority must be numbers from 1 to 4")
    return inbox.items(db, _ws(db, user, workspace_id), tab, groups=_csv(group), unread=unread, priority=wanted, due=due)


@router.get("/workspaces/{workspace_id}/inbox/counts", response_model=c.InboxCounts)
def inbox_counts(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return inbox.counts(db, _ws(db, user, workspace_id))


@router.patch("/notifications/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def update_notification(notification_id: uuid.UUID, data: c.NotificationUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inbox.update_item(db, user.id, notification_id, data)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/workspaces/{workspace_id}/inbox/{action}", status_code=status.HTTP_204_NO_CONTENT)
def bulk_inbox(
    workspace_id: uuid.UUID, action: Literal["read-all", "clear-all"], data: c.BulkInbox,
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    inbox.bulk(db, _ws(db, user, workspace_id), data.tab, "read" if action == "read-all" else "clear")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/workspaces/{workspace_id}/notification-settings", response_model=List[c.SettingRow])
def get_settings(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return inbox.settings(db, _ws(db, user, workspace_id))


@router.put("/workspaces/{workspace_id}/notification-settings", response_model=List[c.SettingRow])
def put_settings(workspace_id: uuid.UUID, data: c.SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = inbox.save_settings(db, _ws(db, user, workspace_id), data)
    db.commit()
    return out


# --- reminders --------------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/reminders", response_model=List[c.ReminderOut])
def list_reminders(
    workspace_id: uuid.UUID, state: Literal["upcoming", "done", "all"] = Query("upcoming"),
    user: User = Depends(current_user), db: Session = Depends(get_db),
):
    return inbox.list_reminders(db, _ws(db, user, workspace_id), state)


@router.post("/workspaces/{workspace_id}/reminders", response_model=c.ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(workspace_id: uuid.UUID, data: c.ReminderIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = inbox.create_reminder(db, _ws(db, user, workspace_id), data)
    db.commit()
    return out


@router.patch("/workspaces/{workspace_id}/reminders/{reminder_id}", response_model=c.ReminderOut)
def update_reminder(
    workspace_id: uuid.UUID, reminder_id: uuid.UUID, data: c.ReminderUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    out = inbox.update_reminder(db, _ws(db, user, workspace_id), reminder_id, data)
    db.commit()
    return out


@router.delete("/workspaces/{workspace_id}/reminders/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder(workspace_id: uuid.UUID, reminder_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    inbox.delete_reminder(db, _ws(db, user, workspace_id), reminder_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _template_out(tpl) -> c.ChecklistTemplateOut:
    items = list(tpl.items or [])
    return c.ChecklistTemplateOut(id=tpl.id, name=tpl.name, items=items, item_count=len(items), created_at=tpl.created_at)


# --- checklists ------------------------------------------------------------------------------------


@router.get("/tasks/{task_id}/checklists")
def get_checklists(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    return extras.checklists_out(db, opened.obj.id)


@router.post("/tasks/{task_id}/checklists", status_code=status.HTTP_201_CREATED)
def add_checklist(task_id: uuid.UUID, data: c.ChecklistIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    extras.add_checklist(db, opened, data.name, data.items)
    db.commit()
    return extras.checklists_out(db, opened.obj.id)


@router.get("/workspaces/{workspace_id}/checklist-templates", response_model=List[c.ChecklistTemplateOut])
def list_checklist_templates(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [_template_out(t) for t in extras.checklist_templates(db, _ws(db, user, workspace_id))]


@router.post("/workspaces/{workspace_id}/checklist-templates", response_model=c.ChecklistTemplateOut, status_code=status.HTTP_201_CREATED)
def save_checklist_template(workspace_id: uuid.UUID, data: c.ChecklistTemplateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tpl = extras.save_checklist_template(db, _ws(db, user, workspace_id), data.name, data.items)
    db.commit()
    return _template_out(tpl)


@router.patch("/workspaces/{workspace_id}/checklist-templates/{template_id}", response_model=c.ChecklistTemplateOut)
def update_checklist_template(workspace_id: uuid.UUID, template_id: uuid.UUID, data: c.ChecklistTemplateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    tpl = extras.update_checklist_template(db, _ws(db, user, workspace_id), template_id, data.name, data.items)
    db.commit()
    return _template_out(tpl)


@router.delete("/workspaces/{workspace_id}/checklist-templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist_template(workspace_id: uuid.UUID, template_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    extras.delete_checklist_template(db, _ws(db, user, workspace_id), template_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/checklists/{checklist_id}")
def update_checklist(checklist_id: uuid.UUID, data: c.ChecklistUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    cl = extras.update_checklist(db, user.id, checklist_id, data.name, data.orderindex)
    db.commit()
    return extras.checklists_out(db, cl.task_id)


@router.delete("/checklists/{checklist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_checklist(checklist_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    extras.delete_checklist(db, user.id, checklist_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/checklists/{checklist_id}/items", status_code=status.HTTP_201_CREATED)
def add_item(checklist_id: uuid.UUID, data: c.ItemIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    extras.add_item(db, user.id, checklist_id, data.name, data.assignee_id)
    db.commit()
    cl = db.get(Checklist, checklist_id)
    return extras.checklists_out(db, cl.task_id)


@router.patch("/checklist-items/{item_id}")
def update_item(item_id: uuid.UUID, data: c.ItemUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = extras.update_item(db, user.id, item_id, {k: getattr(data, k) for k in data.model_fields_set})
    db.commit()
    cl = db.get(Checklist, item.checklist_id)
    return extras.checklists_out(db, cl.task_id)


@router.delete("/checklist-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(item_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    extras.delete_item(db, user.id, item_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- attachments ------------------------------------------------------------------------------------


@router.get("/tasks/{task_id}/attachments")
def get_attachments(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    return extras.attachments_out(db, opened.obj.id)


@router.post("/tasks/{task_id}/attachments", status_code=status.HTTP_201_CREATED)
async def upload_attachment(task_id: uuid.UUID, file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    data = await file.read()
    a = extras.add_attachment(db, opened, file.filename or "file", file.content_type or "application/octet-stream", data)
    db.commit()
    return extras.attachment_out(db, a)


@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a, _, path = extras.open_attachment(db, user.id, attachment_id)
    if not path.exists():
        raise NotFound("The file is missing from storage")
    return FileResponse(path, media_type=a.content_type, filename=a.filename)


@router.delete("/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_attachment(attachment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    extras.delete_attachment(db, user.id, attachment_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
