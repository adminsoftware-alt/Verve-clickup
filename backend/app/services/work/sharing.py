"""Explicit shares on Spaces, Folders, Lists and Tasks, to people or to Teams."""

import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import LocationKind, PermissionLevel, Share, Task, Team, TeamMember, User, WorkspaceMember, WorkspaceRole
from app.schemas import work as s
from app.services.work.access import Opened
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.mywork import is_personal
from app.services.work.permissions import can_manage_workspace, is_manager
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


def _check_can_share(opened: Opened, level: PermissionLevel, kind: Optional[LocationKind] = None) -> None:
    access = opened.access
    if not isinstance(opened.obj, Task) and is_personal(access.db, opened.obj):
        raise Invalid("Your Personal List is private to you and cannot be shared")
    if access.role == WorkspaceRole.guest:
        raise Forbidden("Guests cannot share items")
    # Handing out a Space is handing out a part of the firm, so only the people who run it may.
    # A Folder or a List belongs to a team, so its manager may hand it out too. A task is
    # everyday work and anyone who can edit it may share it.
    if kind == LocationKind.space and not can_manage_workspace(access.role):
        raise Forbidden("Only admins can share a Space. Ask an admin, or share a Folder or List instead.")
    if kind in (LocationKind.folder, LocationKind.list) and not is_manager(
        access.db, access.workspace_id, access.user_id, access.role
    ):
        raise Forbidden("Only admins and managers can share a Folder or a List.")
    if not opened.level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to share this")
    if not opened.level.at_least(level):
        raise Forbidden("You can only grant access up to your own level")


def grant_share(db: Session, opened: Opened, kind: LocationKind, data: s.ShareCreate) -> s.ShareOut:
    access = opened.access
    _check_can_share(opened, data.level, kind)
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
    from app.services.work import audit, events

    what = getattr(opened.obj, "name", None)
    audit.record(db, access.workspace_id, access.user_id, "share.granted", kind.value, opened.obj.id, what,
                 {"with": (user.display_name or user.email) if user else (team.name if team else None), "level": data.level.value})
    # Tell whoever it was shared with: a Space or List handed over quietly is one nobody opens.
    if user is not None:
        recipients = [user.id]
    else:
        assert team is not None
        recipients = [m.user_id for m in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id))]
    events.notify(
        db, access.workspace_id, recipients, access.user_id, "shared", "primary",
        task=opened.obj if kind == LocationKind.task else None,
        data={
            "what": kind.value, "name": what, "level": data.level.value,
            "id": str(opened.obj.id), "team": team.name if team else None,
        },
    )
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
    _check_can_share(opened, share.level, kind)  # you cannot remove access higher than your own
    from app.services.work import audit

    who = db.get(User, share.user_id) if share.user_id else None
    team = db.get(Team, share.team_id) if share.team_id else None
    audit.record(db, opened.access.workspace_id, opened.access.user_id, "share.revoked", kind.value, opened.obj.id,
                 getattr(opened.obj, "name", None), {"with": (who.display_name or who.email) if who else (team.name if team else None)})
    db.delete(share)
    db.flush()


def list_shares(db: Session, opened: Opened, kind: LocationKind) -> List[s.ShareOut]:
    return sharing(db, opened, kind).shares
