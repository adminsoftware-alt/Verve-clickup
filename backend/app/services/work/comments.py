"""Task comments: threads, @mentions, assigned comments and reactions, as in ClickUp.

  * Commenting needs comment access to the task (view-only people can read, not write).
  * Only the author edits a comment's text; the author or anyone with full access deletes it.
  * An assigned comment is resolved by its assignee, its author, or anyone who can edit.
Notifications (see events.py): mentions and assigned comments are "primary" for the people
concerned, as are replies for others in the thread; everyone watching hears "other".
"""

import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    CommentReaction,
    PermissionLevel,
    Space,
    Status,
    Task,
    TaskComment,
    TaskList,
    Team,
    TeamMember,
    User,
    WorkspaceMember,
)
from app.schemas import collab as c
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Access, Opened, chain_for_task, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _members(db: Session, workspace_id: uuid.UUID, ids) -> Set[str]:
    ids = [i for i in ids if i]
    if not ids:
        return set()
    return set(db.scalars(select(WorkspaceMember.user_id).where(
        WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id.in_(ids))))


def _require_comment(opened: Opened[Task]) -> None:
    if not opened.level.at_least(PermissionLevel.comment):
        raise Forbidden("You need comment access to comment on this task")


def add(db: Session, opened: Opened[Task], data: c.CommentIn) -> TaskComment:
    _require_comment(opened)
    task, access = opened.obj, opened.access
    ws = access.workspace_id
    parent: Optional[TaskComment] = None
    if data.parent_id is not None:
        parent = db.get(TaskComment, data.parent_id)
        if parent is None or parent.task_id != task.id:
            raise NotFound("Comment not found")
        if parent.parent_id is not None:
            parent = db.get(TaskComment, parent.parent_id)  # threads are one level deep
    mentioned = _members(db, ws, data.mention_user_ids)
    teams = [str(t) for t in data.mention_team_ids]
    if teams:
        valid = set(db.scalars(select(Team.id).where(Team.id.in_(data.mention_team_ids), Team.workspace_id == ws)))
        teams = [str(t) for t in valid]
    if data.assignee_id and data.assignee_id not in _members(db, ws, [data.assignee_id]):
        raise Invalid("A comment can only be assigned to someone in this workspace")
    comment = TaskComment(
        task_id=task.id, parent_id=parent.id if parent else None, user_id=access.user_id, body=data.body,
        mention_user_ids=sorted(mentioned), mention_team_ids=teams, assignee_id=data.assignee_id,
    )
    db.add(comment)
    db.flush()

    team_people: Set[str] = set()
    if teams:
        team_people = set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id.in_([uuid.UUID(t) for t in teams]))))
    excerpt = {"excerpt": data.body[:200]}
    sent: Set[str] = set()
    if data.assignee_id:
        sent |= events.notify(db, ws, [data.assignee_id], access.user_id, "assigned_comment", "primary", task=task, comment_id=comment.id, data=excerpt)
    sent |= events.notify(db, ws, mentioned | team_people, access.user_id, "mentioned", "primary", task=task, comment_id=comment.id, data=excerpt, already=sent)
    if parent is not None:
        in_thread = {parent.user_id} | set(db.scalars(select(TaskComment.user_id).where(TaskComment.parent_id == parent.id)))
        sent |= events.notify(db, ws, in_thread, access.user_id, "reply", "primary", task=task, comment_id=comment.id, data=excerpt, already=sent)
    events.notify(db, ws, events.watchers(db, task.id), access.user_id, "comment", "other", task=task, comment_id=comment.id, data=excerpt, already=sent)
    events.watch(db, task.id, [access.user_id, data.assignee_id, *mentioned])
    events.record(db, task, access.user_id, "comment", {"comment_id": str(comment.id), "reply": parent is not None})
    return comment


def _open_comment(db: Session, user_id: str, comment_id: uuid.UUID, minimum=PermissionLevel.view):
    comment = db.get(TaskComment, comment_id)
    if comment is None:
        raise NotFound("Comment not found")
    return comment, open_task(db, user_id, comment.task_id, minimum)


def update(db: Session, user_id: str, comment_id: uuid.UUID, data: c.CommentUpdate) -> TaskComment:
    comment, opened = _open_comment(db, user_id, comment_id)
    _require_comment(opened)
    fields = data.model_fields_set
    if "body" in fields and data.body is not None:
        if comment.user_id != user_id:
            raise Forbidden("Only the author can edit a comment")
        comment.body = data.body
        comment.edited_at = _now()
    can_manage = comment.user_id == user_id or opened.level.at_least(PermissionLevel.edit)
    if "assignee_id" in fields:
        if not can_manage:
            raise Forbidden("Only the author or someone who can edit the task can reassign this comment")
        if data.assignee_id and data.assignee_id not in _members(db, opened.access.workspace_id, [data.assignee_id]):
            raise Invalid("A comment can only be assigned to someone in this workspace")
        if data.assignee_id and data.assignee_id != comment.assignee_id:
            events.notify(db, opened.access.workspace_id, [data.assignee_id], user_id, "assigned_comment", "primary",
                          task=opened.obj, comment_id=comment.id, data={"excerpt": comment.body[:200]})
        comment.assignee_id = data.assignee_id
        comment.resolved_at = comment.resolved_by = None
    if "resolved" in fields and data.resolved is not None:
        if not (can_manage or comment.assignee_id == user_id):
            raise Forbidden("Only the assignee, the author or an editor can resolve this")
        comment.resolved_at = _now() if data.resolved else None
        comment.resolved_by = user_id if data.resolved else None
    db.flush()
    return comment


def delete(db: Session, user_id: str, comment_id: uuid.UUID) -> None:
    comment, opened = _open_comment(db, user_id, comment_id)
    if comment.user_id != user_id and opened.level != PermissionLevel.full:
        raise Forbidden("Only the author or someone with full access can delete a comment")
    db.delete(comment)
    db.flush()


def react(db: Session, user_id: str, comment_id: uuid.UUID, emoji: str) -> TaskComment:
    """Toggle your reaction."""
    comment, opened = _open_comment(db, user_id, comment_id)
    _require_comment(opened)
    row = db.get(CommentReaction, (comment.id, user_id, emoji))
    if row is None:
        db.add(CommentReaction(comment_id=comment.id, user_id=user_id, emoji=emoji))
    else:
        db.delete(row)
    db.flush()
    return comment


# --- reading ---------------------------------------------------------------------------------


def serialise(db: Session, comments: List[TaskComment], viewer: str, levels: Optional[Dict[uuid.UUID, PermissionLevel]] = None) -> List[c.CommentOut]:
    if not comments:
        return []
    ids = [x.id for x in comments]
    user_ids = {x.user_id for x in comments} | {x.assignee_id for x in comments} | {u for x in comments for u in x.mention_user_ids}
    reactions: Dict[uuid.UUID, Dict[str, List[str]]] = {}
    for r in db.scalars(select(CommentReaction).where(CommentReaction.comment_id.in_(ids))):
        reactions.setdefault(r.comment_id, {}).setdefault(r.emoji, []).append(r.user_id)
        user_ids.add(r.user_id)
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_({u for u in user_ids if u})))}
    team_ids = {uuid.UUID(t) for x in comments for t in x.mention_team_ids}
    teams = {str(t.id): t for t in db.scalars(select(Team).where(Team.id.in_(team_ids)))} if team_ids else {}
    name = lambda uid: (users[uid].display_name or users[uid].email) if uid in users else "Someone"
    out = []
    for x in comments:
        level = levels.get(x.task_id) if levels else None
        out.append(c.CommentOut(
            id=x.id, task_id=x.task_id, parent_id=x.parent_id,
            user=s.UserOut.model_validate(users[x.user_id]) if x.user_id in users else None,
            body=x.body,
            mentions=[s.UserOut.model_validate(users[u]) for u in x.mention_user_ids if u in users],
            mention_teams=[s.TeamRef(id=teams[t].id, name=teams[t].name, color=teams[t].color) for t in x.mention_team_ids if t in teams],
            assignee=s.UserOut.model_validate(users[x.assignee_id]) if x.assignee_id in users else None,
            resolved_at=x.resolved_at, resolved_by=x.resolved_by, created_at=x.created_at, edited_at=x.edited_at,
            reactions=[c.ReactionOut(emoji=e, count=len(who), mine=viewer in who, users=[name(u) for u in who])
                       for e, who in sorted(reactions.get(x.id, {}).items())],
            can_edit=x.user_id == viewer or (level == PermissionLevel.full if level else False),
        ))
    return out


def list_for_task(db: Session, opened: Opened[Task]) -> List[c.CommentOut]:
    rows = list(db.scalars(select(TaskComment).where(TaskComment.task_id == opened.obj.id).order_by(TaskComment.created_at)))
    return serialise(db, rows, opened.access.user_id, {opened.obj.id: opened.level})


def counts(db: Session, task_ids) -> Dict[uuid.UUID, int]:
    if not task_ids:
        return {}
    return dict(db.execute(
        select(TaskComment.task_id, func.count()).where(TaskComment.task_id.in_(list(task_ids))).group_by(TaskComment.task_id)
    ).all())


def _task_refs(db: Session, access: Access, comments: List[TaskComment]):
    tasks = {t.id: t for t in db.scalars(select(Task).where(Task.id.in_({x.task_id for x in comments})))} if comments else {}
    statuses = {st.id: st for st in db.scalars(select(Status).where(Status.id.in_({t.status_id for t in tasks.values()})))} if tasks else {}
    visible = {}
    for tid, task in tasks.items():
        if access.level(chain_for_task(db, task)) is not None:
            visible[tid] = c.TaskRefOut(id=task.id, name=task.name, list_id=task.list_id,
                                        status=s.StatusOut.model_validate(statuses[task.status_id]))
    return visible


def _in_workspace(access: Access):
    return (
        select(Task.id).join(TaskList, TaskList.id == Task.list_id).join(Space, Space.id == TaskList.space_id)
        .where(Space.workspace_id == access.workspace_id)
    )


def assigned_to_me(db: Session, access: Access, include_resolved: bool) -> List[c.CommentWithTask]:
    q = select(TaskComment).where(TaskComment.assignee_id == access.user_id, TaskComment.task_id.in_(_in_workspace(access)))
    if not include_resolved:
        q = q.where(TaskComment.resolved_at.is_(None))
    rows = list(db.scalars(q.order_by(TaskComment.created_at.desc()).limit(200)))
    refs = _task_refs(db, access, rows)
    rows = [x for x in rows if x.task_id in refs]
    return [c.CommentWithTask(**o.model_dump(), task=refs[o.task_id]) for o in serialise(db, rows, access.user_id)]


def replies_for_me(db: Session, access: Access) -> List[c.CommentWithTask]:
    """Replies by others in threads you started or took part in."""
    mine_threads = select(func.coalesce(TaskComment.parent_id, TaskComment.id)).where(TaskComment.user_id == access.user_id)
    rows = list(db.scalars(
        select(TaskComment).where(
            TaskComment.parent_id.in_(mine_threads), TaskComment.user_id != access.user_id,
            TaskComment.task_id.in_(_in_workspace(access)),
        ).order_by(TaskComment.created_at.desc()).limit(200)
    ))
    refs = _task_refs(db, access, rows)
    rows = [x for x in rows if x.task_id in refs]
    return [c.CommentWithTask(**o.model_dump(), task=refs[o.task_id]) for o in serialise(db, rows, access.user_id)]
