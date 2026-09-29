"""Permission resolution for the work hierarchy.

This follows ClickUp's documented resolution order. Evaluated from the most specific
node upwards (task, parent tasks, list, folders, space), the first node that decides wins:

  1. You created this node                  -> full
  2. The node is a Space and you are a guest -> no access (guests never get a Space)
  3. You hold a personal share on it        -> that share's level
  4. One of your Teams holds a share on it  -> the highest such level
  5. The node is private                    -> no access
  6. The node belongs to a Team you are not in (and you don't run the place) -> no access
  7. Otherwise                              -> ask the parent

If nothing decides, owners, admins and members get full access to public items and
guests get nothing. Consequences, all as in ClickUp:
  * most specific wins: a share on a List can open a private List or narrow a public one;
  * a personal share beats a Team share on the same node;
  * a Team share on a more specific node beats a personal share higher up.
"""

import uuid
from dataclasses import dataclass
from typing import Mapping, Optional, Sequence, Set, Tuple

from app.db.models.enums import LocationKind, PermissionLevel, WorkspaceRole


@dataclass(frozen=True)
class Node:
    kind: LocationKind
    id: uuid.UUID
    created_by: Optional[str]
    is_private: bool
    #: Set when this belongs to a Team: only that Team's people (and admins) see it.
    team_id: Optional[uuid.UUID] = None


ShareKey = Tuple[LocationKind, uuid.UUID]
ShareMap = Mapping[ShareKey, PermissionLevel]


def resolve_level(
    chain: Sequence[Node],
    user_id: str,
    role: Optional[WorkspaceRole],
    shares: ShareMap,
    team_shares: Optional[ShareMap] = None,
    my_teams: Optional[Set[uuid.UUID]] = None,
) -> Optional[PermissionLevel]:
    """Return the caller's level on chain[0], or None for no access.

    `chain` runs from the item itself up to its Space. `team_shares` holds, per node,
    the highest level granted to any Team the caller belongs to, and `my_teams` the Teams
    they are in (sub-teams counted), which is what opens work that belongs to a Team.
    """
    if role is None:  # not a member of this workspace
        return None
    team_shares = team_shares or {}
    for node in chain:
        if node.created_by is not None and node.created_by == user_id:
            return PermissionLevel.full
        if node.kind == LocationKind.space and role in SHARED_ONLY:
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
        # Work given to a Team is that Team's, and the people who run the place.
        if node.team_id is not None and not can_manage_workspace(role) and node.team_id not in (my_teams or set()):
            return None
    if role in SHARED_ONLY:
        return None
    return PermissionLevel.full


def can_manage_workspace(role: Optional[WorkspaceRole]) -> bool:
    return role in (WorkspaceRole.owner, WorkspaceRole.admin)


def is_manager(db, workspace_id, user_id: str, role: Optional[WorkspaceRole]) -> bool:
    """An admin, or someone who leads a Team.

    "Manager" is not a role in its own right here -- it is what leading a Team makes you, which
    is how the rest of the app already decides whose dashboards and whose time you may see.
    """
    if can_manage_workspace(role):
        return True
    from app.services.work.teams import led_team_ids

    return bool(led_team_ids(db, workspace_id, user_id))


# Roles that see only what is shared with them (a Space is never theirs by default).
SHARED_ONLY = (WorkspaceRole.guest, WorkspaceRole.limited)


def can_create_spaces(role: Optional[WorkspaceRole]) -> bool:
    return role in (WorkspaceRole.owner, WorkspaceRole.admin, WorkspaceRole.member)
