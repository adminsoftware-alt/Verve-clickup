"""Phase D routes: All Spaces and join requests, sidebar sections, duplicating Spaces, ClickApps,
public links, tasks in several Lists, time in status, sprints, Email-to-List, and the content of the
Doc, Whiteboard, Mind map, Chat and Embed views."""

import hmac
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Query, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.api.v2.deps import current_user
from app.core.config import settings
from app.db.models import LocationKind, PermissionLevel, User
from app.db.session import get_db
from app.schemas import spaces as sp
from app.schemas import work as s
from app.services.work import (
    copying,
    email_to_list,
    hierarchy,
    multilist,
    public_links,
    space_admin,
    sprints,
    time_in_status,
    view_content,
)
from app.services.work.access import Access, open_folder, open_list, open_space, open_task
from app.services.work.tasks import task_detail
from app.services.work.views import view_out

router = APIRouter()
VIEW, FULL = PermissionLevel.view, PermissionLevel.full


# --- ClickApps ----------------------------------------------------------------------------------


@router.get("/clickapps")
def clickapp_catalogue():
    return [{"name": k, "label": space_admin.CLICKAPP_LABELS[k], "default": v} for k, v in space_admin.CLICKAPPS.items()]


# --- All Spaces -----------------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/all-spaces", response_model=List[sp.BrowseSpace])
def all_spaces(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return space_admin.browse(db, Access.for_workspace(db, user.id, workspace_id))


@router.put("/workspaces/{workspace_id}/all-spaces/{space_id}/joined", status_code=status.HTTP_204_NO_CONTENT)
def join_space(workspace_id: uuid.UUID, space_id: uuid.UUID, joined: bool = Query(True),
               user: User = Depends(current_user), db: Session = Depends(get_db)):
    space_admin.set_joined(db, Access.for_workspace(db, user.id, workspace_id), space_id, joined)
    db.commit()


@router.post("/workspaces/{workspace_id}/all-spaces/{space_id}/request", status_code=status.HTTP_201_CREATED)
def request_to_join(workspace_id: uuid.UUID, space_id: uuid.UUID, data: sp.JoinIn,
                    user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = space_admin.request_join(db, Access.for_workspace(db, user.id, workspace_id), space_id, data.message)
    db.commit()
    return {"id": str(row.id), "status": row.status}


@router.get("/workspaces/{workspace_id}/join-requests", response_model=List[sp.JoinRequestOut])
def join_requests(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return space_admin.join_requests(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/join-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def decide_join(workspace_id: uuid.UUID, request_id: uuid.UUID, data: sp.JoinDecision,
                user: User = Depends(current_user), db: Session = Depends(get_db)):
    space_admin.decide(db, Access.for_workspace(db, user.id, workspace_id), request_id, data.approve, data.level)
    db.commit()


@router.post("/spaces/{space_id}/duplicate", response_model=s.SpaceOut, status_code=status.HTTP_201_CREATED)
def duplicate_space(space_id: uuid.UUID, data: sp.SpaceDuplicate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_space(db, user.id, space_id, VIEW)
    space = space_admin.duplicate_space(db, opened, data.name, data.include_tasks, data)
    copying.hand_to_people(db, opened, LocationKind.space, space, data.share_with, data.share_level)
    db.commit()
    return hierarchy.space_out(space, FULL)


# --- sidebar sections -----------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/sidebar-sections", response_model=List[s.SidebarSectionOut])
def sidebar_sections(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return space_admin.sections(db, Access.for_workspace(db, user.id, workspace_id))


@router.post("/workspaces/{workspace_id}/sidebar-sections", response_model=s.SidebarSectionOut, status_code=status.HTTP_201_CREATED)
def add_section(workspace_id: uuid.UUID, data: sp.SectionIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = space_admin.create_section(db, Access.for_workspace(db, user.id, workspace_id), data)
    db.commit()
    return space_admin.section_out(row)


@router.patch("/workspaces/{workspace_id}/sidebar-sections/{section_id}", response_model=s.SidebarSectionOut)
def update_section(workspace_id: uuid.UUID, section_id: uuid.UUID, data: sp.SectionUpdate,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    row = space_admin.update_section(db, Access.for_workspace(db, user.id, workspace_id), section_id, data)
    db.commit()
    return space_admin.section_out(row)


@router.delete("/workspaces/{workspace_id}/sidebar-sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_section(workspace_id: uuid.UUID, section_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    space_admin.delete_section(db, Access.for_workspace(db, user.id, workspace_id), section_id)
    db.commit()


# --- public links ---------------------------------------------------------------------------------


@router.post("/public-links", response_model=sp.PublicLinkOut, status_code=status.HTTP_201_CREATED)
def create_public_link(data: sp.PublicLinkIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    link = public_links.create(db, user.id, data)
    db.commit()
    return public_links.link_out(db, link)


@router.get("/public-links", response_model=List[sp.PublicLinkOut])
def target_links(kind: str = Query(..., pattern="^(task|list|view)$"), target_id: uuid.UUID = Query(...),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [public_links.link_out(db, x) for x in public_links.for_target(db, user.id, kind, target_id)]


@router.get("/workspaces/{workspace_id}/public-links", response_model=List[sp.PublicLinkOut])
def workspace_links(workspace_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [public_links.link_out(db, x) for x in public_links.workspace_links(db, Access.for_workspace(db, user.id, workspace_id))]


@router.delete("/public-links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_public_link(link_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    public_links.revoke(db, user.id, link_id)
    db.commit()


@router.get("/public/{token}", response_model=sp.PublicPage)
def public_page(token: str, db: Session = Depends(get_db)):
    """No sign-in: anyone with the link can read it."""
    out = public_links.page(db, token[:64])
    db.commit()
    return out


# --- tasks in several Lists -----------------------------------------------------------------------


@router.get("/tasks/{task_id}/shared-with", response_model=sp.TaskSharedWith)
def task_shared_with(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    return sp.TaskSharedWith(
        lists=multilist.lists_of(db, opened),
        people=multilist.shared_with(db, opened.obj, opened.access.workspace_id),
    )


@router.post("/tasks/{task_id}/shared-with", response_model=sp.TaskSharedWith)
def share_task_with(
    task_id: uuid.UUID, data: sp.ShareTaskWith, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_task(db, user.id, task_id, VIEW)
    multilist.share_with_people(db, opened, data.user_ids, data.assign)
    db.commit()
    return sp.TaskSharedWith(
        lists=multilist.lists_of(db, opened),
        people=multilist.shared_with(db, opened.obj, opened.access.workspace_id),
    )


@router.delete("/tasks/{task_id}/shared-with/{user_id}", response_model=sp.TaskSharedWith)
def unshare_task_with(
    task_id: uuid.UUID, user_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    opened = open_task(db, user.id, task_id, VIEW)
    multilist.unshare_from_person(db, opened, user_id)
    db.commit()
    return sp.TaskSharedWith(
        lists=multilist.lists_of(db, opened),
        people=multilist.shared_with(db, opened.obj, opened.access.workspace_id),
    )


@router.get("/tasks/{task_id}/lists", response_model=List[sp.TaskListRef])
def task_lists(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return multilist.lists_of(db, open_task(db, user.id, task_id, VIEW))


@router.put("/tasks/{task_id}/lists/{list_id}", response_model=List[sp.TaskListRef])
def add_task_to_list(task_id: uuid.UUID, list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    multilist.add(db, opened, open_list(db, user.id, list_id, VIEW))
    db.commit()
    return multilist.lists_of(db, opened)


@router.delete("/tasks/{task_id}/lists/{list_id}", response_model=List[sp.TaskListRef])
def remove_task_from_list(task_id: uuid.UUID, list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_task(db, user.id, task_id, VIEW)
    multilist.remove(db, opened, list_id)
    db.commit()
    return multilist.lists_of(db, opened)


# --- time in status -------------------------------------------------------------------------------


@router.get("/tasks/{task_id}/time-in-status", response_model=sp.TimeInStatus)
def task_time_in_status(task_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return time_in_status.time_in_status(db, open_task(db, user.id, task_id, VIEW))


# --- sprints --------------------------------------------------------------------------------------


@router.put("/folders/{folder_id}/sprints", response_model=s.FolderOut)
def enable_sprints(folder_id: uuid.UUID, data: sp.SprintSettings, user: User = Depends(current_user), db: Session = Depends(get_db)):
    opened = open_folder(db, user.id, folder_id, VIEW)
    folder = sprints.enable(db, opened, data)
    db.commit()
    return hierarchy.folder_out(folder, opened.level)


@router.get("/folders/{folder_id}/sprints", response_model=List[sp.SprintOut])
def list_sprints(folder_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return sprints.sprints(db, open_folder(db, user.id, folder_id, VIEW))


@router.post("/folders/{folder_id}/sprints/next", response_model=s.ListOut, status_code=status.HTTP_201_CREATED)
def next_sprint(folder_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    lst = sprints.create_next(db, open_folder(db, user.id, folder_id, VIEW))
    db.commit()
    return hierarchy.list_out(lst, FULL)


@router.post("/lists/{list_id}/sprint/complete", response_model=sp.SprintCompleteOut)
def complete_sprint(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = sprints.complete(db, open_list(db, user.id, list_id, VIEW))
    db.commit()
    return out


@router.get("/lists/{list_id}/sprint", response_model=sp.SprintReport)
def sprint_report(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return sprints.report(db, open_list(db, user.id, list_id, VIEW))


# --- Email-to-List --------------------------------------------------------------------------------


@router.get("/lists/{list_id}/email", response_model=sp.ListEmailOut)
def list_email(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return email_to_list.info(db, open_list(db, user.id, list_id, VIEW))


@router.post("/lists/{list_id}/email", response_model=sp.ListEmailOut)
def make_list_email(list_id: uuid.UUID, rotate: bool = Query(False), user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = email_to_list.make_address(db, open_list(db, user.id, list_id, VIEW), rotate)
    db.commit()
    return out


@router.delete("/lists/{list_id}/email", status_code=status.HTTP_204_NO_CONTENT)
def remove_list_email(list_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    email_to_list.turn_off(db, open_list(db, user.id, list_id, VIEW))
    db.commit()


@router.post("/inbound-email")
async def inbound_email(request: Request, x_inbound_secret: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """For mail providers' inbound webhooks: the raw message (message/rfc822) in the body."""
    secret = settings.INBOUND_EMAIL_SECRET
    if not secret or not x_inbound_secret or not hmac.compare_digest(secret, x_inbound_secret):
        return JSONResponse(status_code=403, content={"detail": "Not allowed"})
    raw = await request.body()
    if not raw or len(raw) > 30 * 1024 * 1024:
        return JSONResponse(status_code=400, content={"detail": "Send the raw email as the body"})
    outcome = email_to_list.ingest(db, raw)
    db.commit()
    return {"outcome": outcome}


# --- Doc, Whiteboard, Mind map, Chat, Embed -------------------------------------------------------


@router.get("/views/{view_id}/content", response_model=sp.ViewContentOut)
def get_view_content(view_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return view_content.get_content(db, user.id, view_id)


@router.put("/views/{view_id}/content", response_model=sp.ViewContentOut)
def save_view_content(view_id: uuid.UUID, data: sp.ViewContentIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = view_content.save_content(db, user.id, view_id, data)
    db.commit()
    return out


@router.put("/views/{view_id}/embed", response_model=s.ViewOut)
def set_embed(view_id: uuid.UUID, data: sp.EmbedIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    view = view_content.set_embed(db, user.id, view_id, data.url)
    db.commit()
    return view_out(view)


@router.get("/views/{view_id}/chat", response_model=List[sp.ChatOut])
def chat_messages(view_id: uuid.UUID, after: Optional[datetime] = Query(None), user: User = Depends(current_user), db: Session = Depends(get_db)):
    return view_content.messages(db, user.id, view_id, after)


@router.post("/views/{view_id}/chat", response_model=sp.ChatOut, status_code=status.HTTP_201_CREATED)
def post_chat(view_id: uuid.UUID, data: sp.ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = view_content.post(db, user.id, view_id, data)
    db.commit()
    return out


@router.patch("/chat/{message_id}", response_model=sp.ChatOut)
def edit_chat(message_id: uuid.UUID, data: sp.ChatIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    out = view_content.edit(db, user.id, message_id, data)
    db.commit()
    return out


@router.delete("/chat/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(message_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(get_db)):
    view_content.remove(db, user.id, message_id)
    db.commit()


@router.post("/chat/{message_id}/task", response_model=s.TaskDetailOut, status_code=status.HTTP_201_CREATED)
def chat_to_task(message_id: uuid.UUID, data: sp.ChatToTask, user: User = Depends(current_user), db: Session = Depends(get_db)):
    task = view_content.to_task(db, user.id, message_id, data)
    db.commit()
    return task_detail(db, open_task(db, user.id, task.id, VIEW))

