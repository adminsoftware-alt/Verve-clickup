"""Loads objects together with the caller's resolved permission on them."""

import uuid
from dataclasses import dataclass
from typing import Dict, Generic, List, Optional, Set, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import (
    Folder,
    LocationKind,
    PermissionLevel,
    Share,
    Space,
    Task,
    TaskList,
    Team,
    TeamMember,
    User,
    Workspace,
    WorkspaceMember,
    WorkspaceRole,
)
from app.services.work.errors import Forbidden, NotFound
from app.services.work.permissions import Node, ShareKey, resolve_level


def email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower()


def sign_in_problem(workspace: Workspace, role: WorkspaceRole, user: User) -> Optional[str]:
    """Why this person may not use the workspace under its sign-in rules, or None."""
    domains = [d.lower().lstrip("@") for d in (workspace.allowed_email_domains or [])]
    if domains and not (role == WorkspaceRole.guest and workspace.allow_outside_guests):
        if email_domain(user.email) not in domains:
            return "This workspace only allows accounts from " + ", ".join("@" + d for d in domains) + "."
    if user.auth_uid is None:
        return None  # not signed in yet; checked on their first sign-in
    if workspace.require_google_sign_in and user.last_sign_in_provider != "google.com":
        return "This workspace requires signing in with Google. Sign out and sign in with your Google account."
    if workspace.require_two_step and not user.last_second_factor:
        return "This workspace requires two-step verification. Sign in again and complete the second step."
    return None


def access_problem(db: Session, member: WorkspaceMember) -> Optional[str]:
    """Why a member can't open the workspace right now (turned off, or breaking a sign-in rule), or None."""
    if member.deactivated_at is not None:
        return "Your access to this workspace has been turned off. Ask an admin if this is a mistake."
    workspace, user = db.get(Workspace, member.workspace_id), db.get(User, member.user_id)
    if workspace is None or user is None:
        return None
    return sign_in_problem(workspace, member.role, user)


class Access:
    """The caller's standing inside one workspace: role plus explicit shares."""

    def __init__(self, db: Session, user_id: str, workspace_id: uuid.UUID, role: WorkspaceRole):
        self.db = db
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.role = role
        self._shares: Optional[Dict[ShareKey, PermissionLevel]] = None
        self._team_shares: Optional[Dict[ShareKey, PermissionLevel]] = None
        self._my_teams: Optional[Set[uuid.UUID]] = None

    @classmethod
    def for_workspace(cls, db: Session, user_id: str, workspace_id: uuid.UUID) -> "Access":
        member = db.get(WorkspaceMember, (workspace_id, user_id))
        if member is None:
            raise NotFound("Workspace not found")
        problem = access_problem(db, member)
        if problem:
            raise Forbidden(problem)
        return cls(db, user_id, workspace_id, member.role)

    @property
    def shares(self) -> Dict[ShareKey, PermissionLevel]:
        """Shares granted to the caller personally."""
        if self._shares is None:
            self._shares = {}
            for share in self.db.scalars(select(Share).where(Share.user_id == self.user_id)):
                self._shares[share_key(share)] = share.level
        return self._shares

    @property
    def team_shares(self) -> Dict[ShareKey, PermissionLevel]:
        """Per item, the highest level granted to any of the caller's Teams in this workspace."""
        if self._team_shares is None:
            self._team_shares = {}
            my_teams = (
                select(TeamMember.team_id)
                .join(Team, Team.id == TeamMember.team_id)
                .where(TeamMember.user_id == self.user_id, Team.workspace_id == self.workspace_id)
            )
            from app.services.work import team_tree

            # Being in a sub-team counts as being in every Team above it.
            teams = team_tree.ancestors(self.db, list(self.db.scalars(my_teams)))
            for share in self.db.scalars(select(Share).where(Share.team_id.in_(teams))):
                key = share_key(share)
                current = self._team_shares.get(key)
                if current is None or share.level.rank > current.rank:
                    self._team_shares[key] = share.level
        return self._team_shares

    @property
    def my_teams(self) -> Set[uuid.UUID]:
        """The Teams this person is in, counting every Team above the ones they are in."""
        if self._my_teams is None:
            from app.services.work import team_tree

            mine = list(
                self.db.scalars(
                    select(TeamMember.team_id).join(Team, Team.id == TeamMember.team_id)
                    .where(TeamMember.user_id == self.user_id, Team.workspace_id == self.workspace_id)
                )
            )
            self._my_teams = set(team_tree.ancestors(self.db, mine)) if mine else set()
        return self._my_teams

    def level(self, chain: List[Node]) -> Optional[PermissionLevel]:
        return resolve_level(chain, self.user_id, self.role, self.shares, self.team_shares, self.my_teams)

    def require(self, chain: List[Node], minimum: PermissionLevel, what: str) -> PermissionLevel:
        level = self.level(chain)
        if level is None:
            raise NotFound(f"{what} not found")
        if not level.at_least(minimum):
            raise Forbidden(f"You need {minimum.value} access to do this")
        return level


def share_key(share: Share) -> ShareKey:
    if share.space_id is not None:
        return (LocationKind.space, share.space_id)
    if share.folder_id is not None:
        return (LocationKind.folder, share.folder_id)
    if share.list_id is not None:
        return (LocationKind.list, share.list_id)
    assert share.task_id is not None
    return (LocationKind.task, share.task_id)


# --- nodes -------------------------------------------------------------------


def space_node(space: Space) -> Node:
    return Node(LocationKind.space, space.id, space.created_by, space.is_private, space.team_id)


def folder_node(folder: Folder) -> Node:
    return Node(LocationKind.folder, folder.id, folder.created_by, folder.is_private, folder.team_id)


def list_node(lst: TaskList) -> Node:
    return Node(LocationKind.list, lst.id, lst.created_by, lst.is_private, lst.team_id)


def task_node(task: Task) -> Node:
    return Node(LocationKind.task, task.id, task.created_by, task.is_private)


# --- ancestor chains, most specific first ------------------------------------


def chain_for_space(space: Space) -> List[Node]:
    return [space_node(space)]


def chain_for_folder(db: Session, folder: Folder) -> List[Node]:
    chain = [folder_node(folder)]
    if folder.parent_folder_id is not None:
        parent = db.get(Folder, folder.parent_folder_id)
        assert parent is not None
        chain.append(folder_node(parent))
    space = db.get(Space, folder.space_id)
    assert space is not None
    return chain + chain_for_space(space)


def chain_for_list(db: Session, lst: TaskList) -> List[Node]:
    chain = [list_node(lst)]
    if lst.folder_id is not None:
        folder = db.get(Folder, lst.folder_id)
        assert folder is not None
        return chain + chain_for_folder(db, folder)
    space = db.get(Space, lst.space_id)
    assert space is not None
    return chain + chain_for_space(space)


def task_ancestry(db: Session, task: Task) -> List[Node]:
    """The task followed by each parent task up to the top of its subtask tree."""
    chain = [task_node(task)]
    parent_id = task.parent_id
    while parent_id is not None:
        parent = db.get(Task, parent_id)
        assert parent is not None
        chain.append(task_node(parent))
        parent_id = parent.parent_id
    return chain


def chain_for_task(db: Session, task: Task) -> List[Node]:
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    return task_ancestry(db, task) + chain_for_list(db, lst)


# --- load-and-authorise ------------------------------------------------------

T = TypeVar("T")


@dataclass
class Opened(Generic[T]):
    obj: T
    access: Access
    level: PermissionLevel


def open_space(db: Session, user_id: str, space_id: uuid.UUID, minimum: PermissionLevel) -> Opened[Space]:
    space = db.get(Space, space_id)
    if space is None:
        raise NotFound("Space not found")
    access = Access.for_workspace(db, user_id, space.workspace_id)
    level = access.require(chain_for_space(space), minimum, "Space")
    return Opened(space, access, level)


def open_folder(db: Session, user_id: str, folder_id: uuid.UUID, minimum: PermissionLevel) -> Opened[Folder]:
    folder = db.get(Folder, folder_id)
    if folder is None:
        raise NotFound("Folder not found")
    space = db.get(Space, folder.space_id)
    assert space is not None
    access = Access.for_workspace(db, user_id, space.workspace_id)
    level = access.require(chain_for_folder(db, folder), minimum, "Folder")
    return Opened(folder, access, level)


def open_list(db: Session, user_id: str, list_id: uuid.UUID, minimum: PermissionLevel) -> Opened[TaskList]:
    lst = db.get(TaskList, list_id)
    if lst is None:
        raise NotFound("List not found")
    space = db.get(Space, lst.space_id)
    assert space is not None
    access = Access.for_workspace(db, user_id, space.workspace_id)
    level = access.require(chain_for_list(db, lst), minimum, "List")
    return Opened(lst, access, level)


def best_task_level(db: Session, access: Access, task: Task) -> Optional[PermissionLevel]:
    """The caller's level on a task through its home List or any other List it was added to."""
    from app.db.models import TaskListLink

    ancestry = task_ancestry(db, task)
    best = access.level(ancestry + chain_for_list(db, db.get(TaskList, task.list_id)))
    root_id = task.top_level_parent_id or task.id
    for list_id in db.scalars(select(TaskListLink.list_id).where(TaskListLink.task_id == root_id)):
        extra = db.get(TaskList, list_id)
        if extra is None or extra.archived_at is not None:
            continue
        level = access.level(ancestry + chain_for_list(db, extra))
        if level is not None and (best is None or level.rank > best.rank):
            best = level
    return best


def open_task(db: Session, user_id: str, task_id: uuid.UUID, minimum: PermissionLevel) -> Opened[Task]:
    task = db.get(Task, task_id)
    if task is None:
        raise NotFound("Task not found")
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    space = db.get(Space, lst.space_id)
    assert space is not None
    access = Access.for_workspace(db, user_id, space.workspace_id)
    level = best_task_level(db, access, task)
    if level is None:
        raise NotFound("Task not found")
    if not level.at_least(minimum):
        raise Forbidden(f"You need {minimum.value} access to do this")
    return Opened(task, access, level)
