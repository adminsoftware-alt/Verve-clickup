"""Users, workspaces and workspace membership."""

import uuid
from typing import List, Optional, Tuple

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.db.models import User, Workspace, WorkspaceMember, WorkspaceRole
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace
from app.services.work.teams import remove_from_workspace_teams


def insert_user_if_missing(db: Session, uid: str, email: str, display_name: Optional[str]) -> None:
    """Create the user row unless it exists. Atomic, so concurrent first requests are safe."""
    db.execute(
        pg_insert(User)
        .values(id=uid, auth_uid=uid, email=email, display_name=display_name)
        .on_conflict_do_nothing()
    )


def _claim_added_person(db: Session, uid: str, email: str) -> Optional[User]:
    """Link a first sign-in to someone an admin added before they had signed in."""
    if not email:
        return None
    row = db.scalars(
        select(User).where(func.lower(User.email) == email, User.auth_uid.is_(None)).order_by(User.created_at)
    ).first()
    if row is None:
        return None
    # Only one request may claim the row, even if several arrive at once.
    claimed = db.execute(
        update(User).where(User.id == row.id, User.auth_uid.is_(None)).values(auth_uid=uid)
    ).rowcount
    db.refresh(row)
    return row if claimed or row.auth_uid == uid else None


def ensure_user(
    db: Session, uid: str, email: Optional[str], display_name: Optional[str], email_verified: bool = True
) -> Tuple[User, bool]:
    """Return the user for a verified token, and whether anything was written.

    A person's first requests often arrive together (several tabs, or effects firing in
    parallel), so creation must tolerate another request creating the same row first.
    Someone added by an admin is matched by their (verified) email on first sign-in.
    """
    email = (email or "").strip().lower()
    user = db.scalars(select(User).where(User.auth_uid == uid)).first()
    if user is None:
        claimed = _claim_added_person(db, uid, email) if email_verified else None
        if claimed is not None:
            return claimed, True
        insert_user_if_missing(db, uid, email, display_name)
        user = db.scalars(select(User).where(User.auth_uid == uid)).first()
        assert user is not None
        return user, True
    changed = False
    if email and user.email != email:
        user.email = email
        changed = True
    if display_name and user.display_name != display_name and not user.name_from_profile:
        user.display_name = display_name
        changed = True
    return user, changed


def list_workspaces(db: Session, user_id: str) -> List[Tuple[Workspace, WorkspaceRole]]:
    rows = db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == user_id)
        .order_by(Workspace.created_at)
    )
    return [(ws, role) for ws, role in rows]


def create_workspace(db: Session, user: User, name: str) -> Workspace:
    workspace = Workspace(name=name, created_by=user.id)
    db.add(workspace)
    db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role=WorkspaceRole.owner))
    db.flush()
    return workspace


def list_members(db: Session, access: Access) -> List[Tuple[WorkspaceMember, User]]:
    rows = db.execute(
        select(WorkspaceMember, User)
        .join(User, User.id == WorkspaceMember.user_id)
        .where(WorkspaceMember.workspace_id == access.workspace_id)
        .order_by(User.email)
    )
    return [(member, user) for member, user in rows]


def _check_can_manage(access: Access, target_role: WorkspaceRole) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can manage members")
    if target_role == WorkspaceRole.owner:
        raise Invalid("The owner cannot be changed or removed")
    if target_role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
        raise Forbidden("Only the owner can manage admins")


def _check_role_change(access: Access, target_role: WorkspaceRole, new_role: WorkspaceRole) -> None:
    _check_can_manage(access, target_role)
    if new_role == WorkspaceRole.owner:
        raise Invalid("A workspace has exactly one owner; ownership transfer is not supported yet")
    if new_role == WorkspaceRole.admin and access.role != WorkspaceRole.owner:
        raise Forbidden("Only the owner can grant admin")


def add_member(db: Session, access: Access, email: str, role: WorkspaceRole) -> Tuple[WorkspaceMember, User]:
    _check_role_change(access, WorkspaceRole.guest, role)
    from app.services.work.people import _find_or_create_user  # people imports this module

    # Someone who hasn't signed in yet is added as pending and linked on their first sign-in.
    user = _find_or_create_user(db, email, None)
    if db.get(WorkspaceMember, (access.workspace_id, user.id)) is not None:
        raise Invalid("That person is already a member of this workspace")
    member = WorkspaceMember(workspace_id=access.workspace_id, user_id=user.id, role=role)
    db.add(member)
    db.flush()
    return member, user


def _get_member(db: Session, access: Access, user_id: str) -> WorkspaceMember:
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    if member is None:
        raise NotFound("Member not found")
    return member


def update_member_role(db: Session, access: Access, user_id: str, role: WorkspaceRole) -> WorkspaceMember:
    member = _get_member(db, access, user_id)
    _check_role_change(access, member.role, role)
    member.role = role
    db.flush()
    return member


def remove_member(db: Session, access: Access, user_id: str) -> None:
    member = _get_member(db, access, user_id)
    if member.role == WorkspaceRole.owner:
        raise Invalid("The owner cannot be removed")
    if user_id != access.user_id:  # anyone but the owner may leave on their own
        _check_can_manage(access, member.role)
    remove_from_workspace_teams(db, access.workspace_id, user_id)
    from app.services.work.people import clear_reports_to

    clear_reports_to(db, access.workspace_id, user_id)
    db.delete(member)
    db.flush()


def workspace_or_404(db: Session, workspace_id: uuid.UUID) -> Workspace:
    workspace = db.get(Workspace, workspace_id)
    if workspace is None:
        raise NotFound("Workspace not found")
    return workspace
