"""Loads objects together with the caller's resolved permission on them."""

import uuid
from dataclasses import dataclass
from typing import Dict, Generic, List, Optional, Set, Tuple, TypeVar

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
from app.services.work.permissions import SHARED_ONLY, Node, ShareKey, resolve_level


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


def _membership(db: Session, workspace_id: uuid.UUID, user_id: str) -> Optional[Tuple[WorkspaceMember, Optional[Workspace]]]:
    """The membership, with its workspace fetched in the same round trip (access_problem needs both).

    The workspace is handed back too: the session only holds loaded objects weakly, so if nobody
    kept it, access_problem would have to read it again."""
    known = db.identity_map.get(Session.identity_key(WorkspaceMember, (workspace_id, user_id)))
    if known is not None:
        return known, None
    row = db.execute(
        select(WorkspaceMember, Workspace)
        .join(Workspace, Workspace.id == WorkspaceMember.workspace_id)
        .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
    ).first()
    return (row[0], row[1]) if row else None


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
        # The Teams this person is directly in, when a caller has already read them (see my_teams).
        self.direct_teams: Optional[Set[uuid.UUID]] = None
        self._led_people: Optional[Set[str]] = None

    @classmethod
    def for_workspace(cls, db: Session, user_id: str, workspace_id: uuid.UUID) -> "Access":
        found = _membership(db, workspace_id, user_id)
        if found is None:
            raise NotFound("Workspace not found")
        member, _workspace = found  # _workspace stays referenced until access_problem has used it
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
            # Being in a sub-team counts as being in every Team above it (my_teams includes those).
            teams = self.my_teams
            for share in self.db.scalars(select(Share).where(Share.team_id.in_(teams))) if teams else []:
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

            mine = list(self.direct_teams) if self.direct_teams is not None else list(
                self.db.scalars(
                    select(TeamMember.team_id).join(Team, Team.id == TeamMember.team_id)
                    .where(TeamMember.user_id == self.user_id, Team.workspace_id == self.workspace_id)
                )
            )
            self._my_teams = set(team_tree.ancestors(self.db, mine)) if mine else set()
        return self._my_teams

    @property
    def led_people(self) -> Set[str]:
        """Everyone in the Teams this person leads, sub-teams counted (empty unless a Manager)."""
        if self._led_people is None:
            from app.services.work.teams import people_led_by

            self._led_people = set(people_led_by(self.db, self.workspace_id, self.user_id))
        return self._led_people

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
    return Node(LocationKind.space, space.id, space.created_by, space.is_private, space.team_id,
                personal=space.personal_owner_id is not None, default_level=space.default_permission)


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


def _task_owners(db: Session, task: Task) -> Set[str]:
    """The people whose task this is: whoever raised it and whoever it is assigned to."""
    from app.db.models import TaskAssignee

    owners = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    if task.created_by is not None:
        owners.add(task.created_by)
    return owners


def employee_cap(
    access: Access, task: Task, ancestry: List[Node], level: Optional[PermissionLevel], owners: Set[str]
) -> Optional[PermissionLevel]:
    """Apply the employee cap to `level`, the caller's standing on `task` before it.

    Employees are read-and-comment on work that is not theirs. Everyone who can see a public Space
    resolves to full access on everything in it, which meant any of the seventy-five could edit --
    and, because deleting needs full, permanently delete -- a colleague's task.

    So a plain member's level is capped at `comment` on a task unless one of these holds:
      * it is theirs: they raised it or it is assigned to them;
      * they manage it: they lead a Team (sub-teams counted) that its creator or an assignee is in;
      * it was shared with them on the task itself (or a parent task), a deliberate grant about
        this one task.
    A share on a List, Folder or Space does NOT lift the cap. It used to, and the dev data shares
    whole Lists and Spaces at full with Teams, so an employee could delete a colleague's task
    there. Sharing a place is about seeing and working in it, not about rewriting other people's
    tasks in it; an admin who wants someone to change one task shares that task.

    That lands exactly where the task service already draws its lines: editing needs `edit`,
    deleting needs `full`, commenting still works, and an assignee with `comment` may still move
    their own task's status. Owners and admins are untouched; guests and limited members only ever
    have what is shared with them and are not capped further.
    """
    if level is None or access.role != WorkspaceRole.member:
        return level
    if level.rank <= PermissionLevel.comment.rank:
        return level
    if access.user_id in owners:
        return level
    if owners & access.led_people:
        return level
    for node in ancestry:
        key = (node.kind, node.id)
        if key in access.shares or key in access.team_shares:
            return level
    return PermissionLevel.comment


def best_task_level(db: Session, access: Access, task: Task) -> Optional[PermissionLevel]:
    """The caller's level on a task through its home List or any other List it was added to,
    with the employee cap applied (see `employee_cap`)."""
    ancestry = task_ancestry(db, task)
    best = tracking_level(db, access, task, ancestry)
    if best is None or access.role != WorkspaceRole.member:
        return best
    return employee_cap(access, task, ancestry, best, _task_owners(db, task))


def cap_levels(db: Session, access: Access, tasks: List[Task], levels: Dict[uuid.UUID, PermissionLevel]) -> None:
    """Apply the employee cap, in place, to levels resolved for a batch of tasks (a List view,
    search results), loading assignees once rather than per task."""
    if access.role != WorkspaceRole.member or not tasks:
        return
    from app.db.models import TaskAssignee

    ids = [t.id for t in tasks if t.id in levels and levels[t.id].rank > PermissionLevel.comment.rank]
    if not ids:
        return
    owners: Dict[uuid.UUID, Set[str]] = {i: set() for i in ids}
    for task_id, user_id in db.execute(
        select(TaskAssignee.task_id, TaskAssignee.user_id).where(TaskAssignee.task_id.in_(ids))
    ):
        owners[task_id].add(user_id)
    by_id = {t.id: t for t in tasks}
    for task_id in ids:
        task = by_id[task_id]
        if task.created_by is not None:
            owners[task_id].add(task.created_by)
        ancestry = [task_node(task)]
        parent_id = task.parent_id
        while parent_id is not None:
            parent = by_id.get(parent_id) or db.get(Task, parent_id)
            if parent is None:
                break
            ancestry.append(task_node(parent))
            parent_id = parent.parent_id
        capped = employee_cap(access, task, ancestry, levels[task_id], owners[task_id])
        if capped is not None:
            levels[task_id] = capped


def tracking_level(
    db: Session, access: Access, task: Task, ancestry: Optional[List[Node]] = None
) -> Optional[PermissionLevel]:
    """Their standing on a task for the purpose of recording hours against it.

    The employee cap is about changing a colleague's task, not about writing down your own time, so
    this reads the level before that cap is applied. Everything else still decides: an explicit
    share of comment or view means what it says -- somebody deliberately said read-and-comment, and
    tracking time in an area you were let into to read would not be what they agreed to -- and a
    guest, who only ever has what was shared, is unaffected either way.

    Lowering the bar to comment everywhere instead was the first attempt, and it quietly undid that
    distinction: a List shared at comment became a List you could bill against.
    """
    from app.db.models import TaskListLink

    if ancestry is None:
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
    if best is None and _is_assignee(db, task, access.user_id):
        # A task given to you in a List you can't open (a private one) is still yours to open: you
        # got the notification for it. Edit for members, comment for guests, who only ever get
        # what was handed to them; either way the List itself stays closed.
        best = PermissionLevel.comment if access.role in SHARED_ONLY else PermissionLevel.edit
    return best


def _is_assignee(db: Session, task: Task, user_id: str) -> bool:
    from app.db.models import TaskAssignee

    return db.get(TaskAssignee, (task.id, user_id)) is not None


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
