"""Task comments: threads, @mentions, assigned comments and reactions, as in ClickUp.

  * Commenting needs comment access to the task (view-only people can read, not write).
  * Only the author edits a comment's text; the author or anyone with full access deletes it.
  * An assigned comment is resolved by its assignee, its author, or anyone who can edit.
Notifications (see events.py): mentions and assigned comments are "primary" for the people
concerned, as are replies for others in the thread; everyone watching hears "other". A reaction
tells the comment's author ("other"), folded into one unread item per comment.

A mention is stored in the body as `@[Name](user:<id>)` (or `team:<id>`): the app shows the
person's current name, so a rename does not break it, and `plain()` turns the body back into
`@Name` wherever it is shown as text -- the Inbox, push, the activity views.
"""

import re
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set, Tuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Attachment,
    CommentReaction,
    Notification,
    PermissionLevel,
    Task,
    TaskComment,
    TaskRead,
    Team,
    User,
    WorkspaceMember,
)
from app.schemas import collab as c
from app.schemas import work as s
from app.services.work import events, extras
from app.services.work.access import Opened, open_task
from app.services.work.errors import Forbidden, Invalid, NotFound


def _now() -> datetime:
    return datetime.now(timezone.utc)


MENTION = re.compile(r"@\[([^\]\n]{1,100})\]\((user|team):([\w.@:-]{1,128})\)")


def plain(body: str) -> str:
    """The body as someone reads it: every mention token back to `@Name`."""
    return MENTION.sub(lambda m: "@" + m.group(1), body)


def _tokens(body: str) -> Tuple[Set[str], Set[uuid.UUID]]:
    users: Set[str] = set()
    teams: Set[uuid.UUID] = set()
    for m in MENTION.finditer(body):
        if m.group(2) == "user":
            users.add(m.group(3))
        else:
            try:
                teams.add(uuid.UUID(m.group(3)))
            except ValueError:
                pass
    return users, teams


def _valid_teams(db: Session, workspace_id: uuid.UUID, ids) -> List[str]:
    ids = list(ids)
    if not ids:
        return []
    return sorted(str(t) for t in db.scalars(select(Team.id).where(Team.id.in_(ids), Team.workspace_id == workspace_id)))


def _team_people(db: Session, teams: List[str]) -> Set[str]:
    if not teams:
        return set()
    from app.services.work import team_tree

    return team_tree.people(db, [uuid.UUID(t) for t in teams])


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
    token_users, token_teams = _tokens(data.body)
    mentioned = _members(db, ws, [*data.mention_user_ids, *token_users])
    teams = _valid_teams(db, ws, {*data.mention_team_ids, *token_teams})
    if data.assignee_id and data.assignee_id not in _members(db, ws, [data.assignee_id]):
        raise Invalid("A comment can only be assigned to someone in this workspace")
    comment = TaskComment(
        task_id=task.id, parent_id=parent.id if parent else None, user_id=access.user_id, body=data.body,
        mention_user_ids=sorted(mentioned), mention_team_ids=teams, assignee_id=data.assignee_id,
    )
    db.add(comment)
    db.flush()

    team_people = _team_people(db, teams)
    excerpt = {"excerpt": plain(data.body)[:200]}
    sent: Set[str] = set()
    if data.assignee_id:
        sent |= events.notify(db, ws, [data.assignee_id], access.user_id, "assigned_comment", "primary", task=task, comment_id=comment.id, data=excerpt)
    sent |= events.notify(db, ws, mentioned | team_people, access.user_id, "mentioned", "primary", task=task, comment_id=comment.id, data=excerpt, already=sent)
    if parent is not None:
        in_thread = {parent.user_id} | set(db.scalars(select(TaskComment.user_id).where(TaskComment.parent_id == parent.id)))
        sent |= events.notify(db, ws, in_thread, access.user_id, "reply", "primary", task=task, comment_id=comment.id, data=excerpt, already=sent)
    _tell_watchers(db, opened, comment, excerpt["excerpt"], already=sent)
    events.watch(db, task.id, [access.user_id, data.assignee_id, *mentioned])
    events.record(db, task, access.user_id, "comment", {"comment_id": str(comment.id), "reply": parent is not None})
    return comment


def _tell_watchers(db: Session, opened: Opened[Task], comment: TaskComment, excerpt: str, already: Set[str]) -> None:
    """Watchers hear "other": one unread item per task, however busy the thread gets.

    An item still unread takes the newest comment, its writer and a running count, and goes back
    to the top; once it has been read or cleared, the next comment starts a new one.
    """
    actor = opened.access.user_id
    people = events.watchers(db, opened.obj.id) - already - {actor}
    if not people:
        return
    waiting = {n.user_id: n for n in db.scalars(select(Notification).where(
        Notification.task_id == opened.obj.id, Notification.kind == "comment", Notification.user_id.in_(people),
        Notification.read_at.is_(None), Notification.cleared_at.is_(None),
    ))}
    for n in waiting.values():
        n.data = {**n.data, "excerpt": excerpt, "count": int(n.data.get("count", 1)) + 1}
        n.comment_id, n.actor_id, n.created_at = comment.id, actor, _now()
    events.notify(db, opened.access.workspace_id, people - set(waiting), actor, "comment", "other", task=opened.obj,
                  comment_id=comment.id, data={"excerpt": excerpt, "count": 1})


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
        _mentions_after_edit(db, opened, comment, data)
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


def _mentions_after_edit(db: Session, opened: Opened[Task], comment: TaskComment, data: c.CommentUpdate) -> None:
    """The mentions are whatever the edited text holds; anyone newly mentioned is told."""
    ws = opened.access.workspace_id
    token_users, token_teams = _tokens(comment.body)
    users = _members(db, ws, [*token_users, *(data.mention_user_ids or [])])
    teams = _valid_teams(db, ws, {*token_teams, *(data.mention_team_ids or [])})
    before = set(comment.mention_user_ids) | _team_people(db, list(comment.mention_team_ids))
    comment.mention_user_ids = sorted(users)
    comment.mention_team_ids = teams
    added = (users | _team_people(db, teams)) - before
    if added:
        events.notify(db, ws, added, opened.access.user_id, "mentioned", "primary", task=opened.obj,
                      comment_id=comment.id, data={"excerpt": plain(comment.body)[:200]})
        events.watch(db, opened.obj.id, users)


def delete(db: Session, user_id: str, comment_id: uuid.UUID) -> None:
    comment, opened = _open_comment(db, user_id, comment_id)
    if comment.user_id != user_id and opened.level != PermissionLevel.full:
        raise Forbidden("Only the author or someone with full access can delete a comment")
    # The rows go with the comment (and its replies); the bytes on disk have to be removed by hand.
    thread = select(TaskComment.id).where((TaskComment.id == comment.id) | (TaskComment.parent_id == comment.id))
    files = list(db.scalars(select(Attachment).where(Attachment.comment_id.in_(thread))))
    db.delete(comment)
    db.flush()
    for a in files:
        (extras.upload_dir() / a.storage_key).unlink(missing_ok=True)


def add_file(db: Session, user_id: str, comment_id: uuid.UUID, filename: str, content_type: str, data: bytes) -> Attachment:
    comment, opened = _open_comment(db, user_id, comment_id)
    return extras.add_attachment(db, opened, filename, content_type, data, comment=comment)


def react(db: Session, user_id: str, comment_id: uuid.UUID, emoji: str) -> TaskComment:
    """Toggle your reaction."""
    comment, opened = _open_comment(db, user_id, comment_id)
    _require_comment(opened)
    row = db.get(CommentReaction, (comment.id, user_id, emoji))
    if row is None:
        db.add(CommentReaction(comment_id=comment.id, user_id=user_id, emoji=emoji))
        _tell_author(db, opened, comment, user_id, emoji)
    else:
        db.delete(row)
    db.flush()
    return comment


def _tell_author(db: Session, opened: Opened[Task], comment: TaskComment, user_id: str, emoji: str) -> None:
    """One unread item per comment however many react: the newest reaction and a running count."""
    if not comment.user_id or comment.user_id == user_id:
        return
    waiting = db.scalars(select(Notification).where(
        Notification.user_id == comment.user_id, Notification.comment_id == comment.id, Notification.kind == "reaction",
        Notification.read_at.is_(None), Notification.cleared_at.is_(None),
    )).first()
    if waiting is not None:
        if waiting.actor_id != user_id:
            waiting.data = {**waiting.data, "emoji": emoji, "count": int(waiting.data.get("count", 1)) + 1}
        waiting.actor_id = user_id
        waiting.created_at = _now()  # back to the top of the Inbox
        return
    events.notify(db, opened.access.workspace_id, [comment.user_id], user_id, "reaction", "other", task=opened.obj,
                  comment_id=comment.id, data={"emoji": emoji, "count": 1, "excerpt": plain(comment.body)[:200]})


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
    files: Dict[uuid.UUID, List[c.CommentFileOut]] = {}
    for a in db.scalars(select(Attachment).where(Attachment.comment_id.in_(ids)).order_by(Attachment.created_at)):
        files.setdefault(a.comment_id, []).append(c.CommentFileOut(id=a.id, filename=a.filename, content_type=a.content_type, size=a.size))
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
            attachments=files.get(x.id, []),
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


# --- reading where you left off, and answering from the Inbox -----------------------------------


def seen(db: Session, opened: Opened[Task]) -> Optional[datetime]:
    """Mark the task's comments as seen now; returns when they were last seen, before this."""
    row = db.get(TaskRead, (opened.obj.id, opened.access.user_id))
    previous = row.last_seen_at if row else None
    if row is None:
        db.add(TaskRead(task_id=opened.obj.id, user_id=opened.access.user_id, last_seen_at=_now()))
    else:
        row.last_seen_at = _now()
    db.flush()
    return previous


def reply_to_notification(db: Session, user_id: str, notification_id: uuid.UUID, data: c.ReplyIn) -> Tuple[TaskComment, Opened[Task]]:
    """Reply in the thread an Inbox item is about, and count the item as read."""
    note = db.get(Notification, notification_id)
    if note is None or note.user_id != user_id:
        raise NotFound("Notification not found")
    comment = db.get(TaskComment, note.comment_id) if note.comment_id else None
    if comment is None:
        raise Invalid("This notification is not about a comment")
    opened = open_task(db, user_id, comment.task_id, PermissionLevel.view)
    row = add(db, opened, c.CommentIn(
        body=data.body, parent_id=comment.parent_id or comment.id,
        mention_user_ids=data.mention_user_ids, mention_team_ids=data.mention_team_ids,
    ))
    note.read_at = note.read_at or _now()
    db.flush()
    return row, opened
