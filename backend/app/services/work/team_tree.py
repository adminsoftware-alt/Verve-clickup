"""Sub-teams: a Team can sit inside another. Its people count as members of every Team above it,
so a share, @mention, dashboard or workload for the parent reaches them too."""

import uuid
from typing import Dict, Iterable, Optional, Set

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Team, TeamMember

MAX_DEPTH = 4


def _parents(db: Session, workspace_id: Optional[uuid.UUID] = None) -> Dict[uuid.UUID, Optional[uuid.UUID]]:
    q = select(Team.id, Team.parent_team_id)
    if workspace_id is not None:
        q = q.where(Team.workspace_id == workspace_id)
    return dict(db.execute(q).all())


def descendants(db: Session, team_ids: Iterable[uuid.UUID]) -> Set[uuid.UUID]:
    """These Teams and every Team inside them."""
    out = set(team_ids)
    if not out:
        return out
    parents = _parents(db)
    grew = True
    while grew:
        grew = False
        for tid, parent in parents.items():
            if parent in out and tid not in out:
                out.add(tid)
                grew = True
    return out


def ancestors(db: Session, team_ids: Iterable[uuid.UUID]) -> Set[uuid.UUID]:
    """These Teams and every Team they sit inside."""
    out = set(team_ids)
    if not out:
        return out
    parents = _parents(db)
    for tid in list(out):
        seen = 0
        parent = parents.get(tid)
        while parent is not None and parent not in out and seen < 50:
            out.add(parent)
            parent = parents.get(parent)
            seen += 1
    return out


def people(db: Session, team_ids: Iterable[uuid.UUID]) -> Set[str]:
    """Everyone in these Teams or their sub-teams."""
    ids = descendants(db, team_ids)
    return set(db.scalars(select(TeamMember.user_id).where(TeamMember.team_id.in_(ids)))) if ids else set()


def depth(db: Session, team_id: uuid.UUID) -> int:
    parents = _parents(db)
    n, parent = 1, parents.get(team_id)
    while parent is not None and n < 50:
        n += 1
        parent = parents.get(parent)
    return n


def height(db: Session, team_id: uuid.UUID) -> int:
    """How many levels of sub-teams hang under this Team (1 = none)."""
    parents = _parents(db)
    children: Dict[uuid.UUID, list] = {}
    for tid, parent in parents.items():
        if parent is not None:
            children.setdefault(parent, []).append(tid)

    def h(t: uuid.UUID, guard: int = 0) -> int:
        return 1 + max((h(c, guard + 1) for c in children.get(t, []) if guard < 50), default=0)

    return h(team_id)
