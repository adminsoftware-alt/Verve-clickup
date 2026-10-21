"""Give every per-team List to its Team, so each Team sees its own work and nobody else's.

The VAPL Common Operation Tasks Space has one List per Team under each activity --
"Attending Special Events - Dev", "PMS - Sales", "Learning - HR". They were created open to the
whole workspace, so a developer saw every Team's events, reviews and appraisals.

A List whose name ends in " - <Team name>" is handed to that Team. While it belongs to a Team,
only that Team's people see it (sub-teams count), plus owners and admins, plus anyone it was shared
with by name -- see permissions.resolve_level. Lists that do not end in a Team's name are left
alone, and so is a List already given to a Team. A copy ("... - Atish (copy)") counts as its
Team's. Run it again after adding Teams or Lists.

    python scripts/give_team_lists_to_teams.py            # say what would change
    python scripts/give_team_lists_to_teams.py --apply    # change it
"""
from __future__ import annotations

import argparse
import re
import sys

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from app.db.models import Space, TaskList, Team  # noqa: E402
from app.db.session import new_session  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--apply", action="store_true", help="write the changes")
    args = ap.parse_args()

    changed = skipped = 0
    with new_session() as db:
        teams = {}
        for team in db.scalars(select(Team)):
            teams.setdefault(team.workspace_id, {})[team.name.strip().lower()] = team
        lists = db.execute(
            select(TaskList, Space).join(Space, Space.id == TaskList.space_id)
            .where(TaskList.archived_at.is_(None))
        ).all()
        for lst, space in lists:
            by_name = teams.get(space.workspace_id, {})
            head, sep, tail = lst.name.rpartition(" - ")
            # A duplicate is "... - Atish (copy)" or "(copy 2)": still Atish's.
            tail = re.sub(r"\s*\(copy(?: \d+)?\)\s*$", "", tail, flags=re.I)
            team = by_name.get(tail.strip().lower()) if sep and head else None
            if team is None:
                continue
            if lst.team_id == team.id:
                skipped += 1
                continue
            print(f"{space.name} / {lst.name}  ->  Team {team.name}")
            if args.apply:
                lst.team = team
                here = {"kind": "list", "id": str(lst.id)}
                if here not in (team.locations or []):
                    team.locations = [*(team.locations or []), here]
            changed += 1
        if args.apply:
            db.commit()
    print(f"\n{changed} List(s) {'given to their Team' if args.apply else 'would be given to their Team'}; {skipped} already were.")
    if changed and not args.apply:
        print("Nothing was written. Re-run with --apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
