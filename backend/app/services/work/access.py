"""Loads objects together with the caller's resolved permission on them."""

import uuid
from dataclasses import dataclass
from typing import Dict, Generic, List, Optional, TypeVar

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
    WorkspaceMember,
    WorkspaceRole,
)
from app.services.work.errors import Forbidden, NotFound
from app.services.work.permissions import Node, ShareKey, resolve_level


class Access:
    """The caller's standing inside one workspace: role plus explicit shares."""

    def __init__(self, db: Session, user_id: str, workspace_id: uuid.UUID, role: WorkspaceRole):
        self.db = db
        self.user_id = user_id
        self.workspace_id = workspace_id
        self.role = role
        self._shares: Optional[Dict[ShareKey, PermissionLevel]] = None
        self._team_shares: Optional[Dict[ShareKey, PermissionLevel]] = None

    @classmethod
    def for_workspace(cls, db: Session, user_id: str, workspace_id: uuid.UUID) -> "Access":
        member = db.get(WorkspaceMember, (workspace_id, user_id))
        if member is None:
            raise NotFound("Workspace not found")
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
            for share in self.db.scalars(select(Share).where(Share.team_id.in_(my_teams))):
                key = share_key(share)
                current = self._team_shares.get(key)
                if current is None or share.level.rank > current.rank:
                    self._team_shares[key] = share.level
        return self._team_shares

    def level(self, chain: List[Node]) -> Optional[PermissionLevel]:
        return resolve_level(chain, self.user_id, self.role, self.shares, self.team_shares)

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
    return Node(LocationKind.space, space.id, space.created_by, space.is_private)


def folder_node(folder: Folder) -> Node:
    return Node(LocationKind.folder, folder.id, folder.created_by, folder.is_private)


def list_node(lst: TaskList) -> Node:
    return Node(LocationKind.list, lst.id, lst.created_by, lst.is_private)


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


def open_task(db: Session, user_id: str, task_id: uuid.UUID, minimum: PermissionLevel) -> Opened[Task]:
    task = db.get(Task, task_id)
    if task is None:
        raise NotFound("Task not found")
    lst = db.get(TaskList, task.list_id)
    assert lst is not None
    space = db.get(Space, lst.space_id)
    assert space is not None
    access = Access.for_workspace(db, user_id, space.workspace_id)
    level = access.require(chain_for_task(db, task), minimum, "Task")
    return Opened(task, access, level)
