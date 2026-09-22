"""Permission resolution for the work hierarchy.

This follows ClickUp's documented resolution order. Evaluated from the most specific
node upwards (task, parent tasks, list, folders, space), the first node that decides wins:

  1. You created this node                  -> full
  2. The node is a Space and you are a guest -> no access (guests never get a Space)
  3. You hold a personal share on it        -> that share's level
  4. One of your Teams holds a share on it  -> the highest such level
  5. The node is private                    -> no access
  6. Otherwise                              -> ask the parent

If nothing decides, owners, admins and members get full access to public items and
guests get nothing. Consequences, all as in ClickUp:
  * most specific wins: a share on a List can open a private List or narrow a public one;
  * a personal share beats a Team share on the same node;
  * a Team share on a more specific node beats a personal share higher up.
"""

import uuid
from dataclasses import dataclass
from typing import Mapping, Optional, Sequence, Tuple

from app.db.models.enums import LocationKind, PermissionLevel, WorkspaceRole


@dataclass(frozen=True)
class Node:
    kind: LocationKind
    id: uuid.UUID
    created_by: Optional[str]
    is_private: bool


ShareKey = Tuple[LocationKind, uuid.UUID]
ShareMap = Mapping[ShareKey, PermissionLevel]


def resolve_level(
    chain: Sequence[Node],
    user_id: str,
    role: Optional[WorkspaceRole],
    shares: ShareMap,
    team_shares: Optional[ShareMap] = None,
) -> Optional[PermissionLevel]:
    """Return the caller's level on chain[0], or None for no access.

    `chain` runs from the item itself up to its Space. `team_shares` holds, per node,
    the highest level granted to any Team the caller belongs to.
    """
    if role is None:  # not a member of this workspace
        return None
    team_shares = team_shares or {}
    for node in chain:
        if node.created_by is not None and node.created_by == user_id:
            return PermissionLevel.full
        if node.kind == LocationKind.space and role == WorkspaceRole.guest:
            return None
        key = (node.kind, node.id)
        personal = shares.get(key)
        if personal is not None:
            return personal
        team = team_shares.get(key)
        if team is not None:
            return team
        if node.is_private:
            return None
    if role == WorkspaceRole.guest:
        return None
    return PermissionLevel.full


def can_manage_workspace(role: Optional[WorkspaceRole]) -> bool:
    return role in (WorkspaceRole.owner, WorkspaceRole.admin)


def can_create_spaces(role: Optional[WorkspaceRole]) -> bool:
    return role in (WorkspaceRole.owner, WorkspaceRole.admin, WorkspaceRole.member)
