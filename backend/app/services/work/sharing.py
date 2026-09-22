"""Explicit shares on Spaces, Folders, Lists and Tasks, to people or to Teams."""

import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import LocationKind, PermissionLevel, Share, Task, Team, User, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work.access import Opened
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.mywork import is_personal
from app.services.work.teams import team_or_404

_COLUMN = {
    LocationKind.space: Share.space_id,
    LocationKind.folder: Share.folder_id,
    LocationKind.list: Share.list_id,
    LocationKind.task: Share.task_id,
}


def _share_out(share: Share, user: Optional[User], team: Optional[Team]) -> s.ShareOut:
    return s.ShareOut(
        id=share.id,
        user=s.UserOut.model_validate(user) if user else None,
        team=s.TeamRef(id=team.id, name=team.name, color=team.color) if team else None,
        level=share.level,
        granted_by=share.granted_by,
        created_at=share.created_at,
    )


def sharing(db: Session, opened: Opened, kind: LocationKind) -> s.SharingOut:
    rows = db.execute(
        select(Share, User, Team)
        .outerjoin(User, User.id == Share.user_id)
        .outerjoin(Team, Team.id == Share.team_id)
        .where(_COLUMN[kind] == opened.obj.id)
    ).all()
    # Teams first, then people, each alphabetically.
    rows.sort(key=lambda r: (r[2] is None, (r[2].name if r[2] else r[1].email).lower()))
    return s.SharingOut(
        is_private=opened.obj.is_private,
        your_level=opened.level,
        shares=[_share_out(share, user, team) for share, user, team in rows],
    )


def _check_can_share(opened: Opened, level: PermissionLevel) -> None:
    if not isinstance(opened.obj, Task) and is_personal(opened.access.db, opened.obj):
        raise Invalid("Your Personal List is private to you and cannot be shared")
    if opened.access.role == WorkspaceRole.guest:
        raise Forbidden("Guests cannot share items")
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to share this")
    if not opened.level.at_least(level):
        raise Forbidden("You can only grant access up to your own level")


def grant_share(db: Session, opened: Opened, kind: LocationKind, data: s.ShareCreate) -> s.ShareOut:
    access = opened.access
    _check_can_share(opened, data.level)
    column = _COLUMN[kind]
    user: Optional[User] = None
    team: Optional[Team] = None

    if data.user_id is not None:
        member = db.get(WorkspaceMember, (access.workspace_id, data.user_id))
        if member is None:
            raise NotFound("That person is not a member of this workspace")
        if kind == LocationKind.space and member.role == WorkspaceRole.guest:
            raise Invalid("Spaces cannot be shared with guests; share a Folder, List or task instead")
        user = db.get(User, data.user_id)
        grantee = Share.user_id == data.user_id
        values = {"user_id": data.user_id}
    else:
        assert data.team_id is not None
        team = team_or_404(db, access, data.team_id)
        grantee = Share.team_id == team.id
        values = {"team_id": team.id}

    share = db.scalars(select(Share).where(grantee, column == opened.obj.id)).first()
    if share is None:
        share = Share(level=data.level, granted_by=access.user_id, **values, **{column.key: opened.obj.id})
        db.add(share)
    else:
        share.level = data.level
        share.granted_by = access.user_id
    db.flush()
    return _share_out(share, user, team)


def revoke_share(
    db: Session,
    opened: Opened,
    kind: LocationKind,
    user_id: Optional[str] = None,
    team_id: Optional[uuid.UUID] = None,
) -> None:
    grantee = Share.user_id == user_id if user_id is not None else Share.team_id == team_id
    share = db.scalars(select(Share).where(grantee, _COLUMN[kind] == opened.obj.id)).first()
    if share is None:
        raise NotFound("Share not found")
    _check_can_share(opened, share.level)  # you cannot remove access higher than your own
    db.delete(share)
    db.flush()


def list_shares(db: Session, opened: Opened, kind: LocationKind) -> List[s.ShareOut]:
    return sharing(db, opened, kind).shares
