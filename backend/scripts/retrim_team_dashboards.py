"""Bring the standard Team and Company Dashboards in line with the nine cards they are made with now.

A standard Dashboard becomes an ordinary editable one the moment it is created, so changing the
template leaves the boards people already have untouched -- which is right, because somebody may
have added a card they rely on. This brings the old ones forward without throwing that away:

  * cards that were taken off the standard board are removed, but only where nobody has edited
    them, so a renamed or re-configured card is left exactly where it is;
  * the three task lists and the wider tiles are added if they are missing;
  * anything a person added themselves is never touched.

Run it to see what it would do:          python scripts/retrim_team_dashboards.py
Run it for real once you are happy:      python scripts/retrim_team_dashboards.py --apply
"""

import argparse
import sys
from pathlib import Path
from typing import Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db.models import Dashboard, DashboardCard  # noqa: E402
from app.db.session import new_session  # noqa: E402
from app.schemas import dashboards as d  # noqa: E402
from app.services.work.dashboards.standard import _people_cards  # noqa: E402

#: Titles the standard board used to carry and no longer does. A card is only removed when its
#: title still matches one of these exactly -- rename it and it is yours, and it stays.
RETIRED = {
    "Unassigned",
    "Open tasks per person",
    "Overdue per person",
    "Who's behind in the team",
    "Who's behind in the company",
    "Work by status",
    "Hours this month per person",
    "Nobody is on these",
    # Titles from older versions of the template. The current source has them commented out, so
    # they could only be found by reading what the boards actually carry -- which is why the run
    # now reports anything left over rather than leaving a gap like this to be noticed later.
    "Finished this month: on time or late",
    "To do",
    "Expected against logged, per person",
    "Estimate against actual, per person",
}


def wanted(everyone: bool) -> List[Tuple[str, str, Dict, int, int]]:
    return _people_cards(everyone)


def plan(db, dash: Dashboard) -> Tuple[List[DashboardCard], List[Tuple], List[DashboardCard]]:
    """(cards to drop, cards to add, cards to widen) for one Dashboard."""
    cards = list(db.scalars(select(DashboardCard).where(DashboardCard.dashboard_id == dash.id)))
    by_title = {c.title: c for c in cards}
    drop = [c for c in cards if c.title in RETIRED]
    target = wanted(dash.standard == "company")
    add = [row for row in target if row[1] not in by_title]
    # Widths changed when cards came off: the three tiles went from a third of the row to a
    # quarter, and "Work by priority" took the full width the status pie used to share. Every
    # card the template names is brought to its width -- a card it does not name is untouched,
    # so somebody's own layout survives.
    widen = [
        by_title[title] for _, title, _, width, _ in target
        if title in by_title and by_title[title].width != width
    ]
    return drop, add, widen


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true", help="make the changes; without it, only says what it would do")
    args = ap.parse_args()

    db = new_session()
    boards = list(db.scalars(select(Dashboard).where(Dashboard.standard.in_(("team", "company")))))
    if not boards:
        print("No standard Team or Company Dashboards here.")
        return 0

    touched = 0
    for dash in sorted(boards, key=lambda x: x.name):
        drop, add, widen = plan(db, dash)
        if not (drop or add or widen):
            print(f"{dash.name!r}: already up to date")
            continue
        touched += 1
        print(f"\n{dash.name!r} ({dash.standard})")
        for c in drop:
            print(f"   remove  [{c.type}] {c.title}")
        for card_type, title, _, _, _ in add:
            print(f"   add     [{card_type}] {title}")
        for c in widen:
            print(f"   widen   [{c.type}] {c.title}")

        if not args.apply:
            continue
        for c in drop:
            db.delete(c)
        position = max((c.position for c in db.scalars(
            select(DashboardCard).where(DashboardCard.dashboard_id == dash.id))), default=-1)
        for card_type, title, config, width, height in add:
            position += 1
            db.add(DashboardCard(
                dashboard_id=dash.id, type=card_type, title=title,
                config=d.CardConfig.model_validate(config).model_dump(mode="json"),
                width=width, height=height, position=position,
            ))
        target = {title: width for _, title, _, width, _ in wanted(dash.standard == "company")}
        for c in widen:
            c.width = target[c.title]

    # Anything still on a standard board that the template does not ask for. Usually somebody's
    # own card, which is why it is reported rather than removed -- but a title from a template
    # older than this script shows up here too, instead of quietly surviving the run.
    want = {title for _, title, _, _, _ in wanted(False)} | {title for _, title, _, _, _ in wanted(True)}
    leftovers: Dict[str, List[str]] = {}
    for dash in boards:
        for c in db.scalars(select(DashboardCard).where(DashboardCard.dashboard_id == dash.id)):
            if c.title not in want:
                leftovers.setdefault(c.title, []).append(dash.name)
    if leftovers:
        print("\nLeft alone, because the template never named them (rename a card and it is yours):")
        for title, names in sorted(leftovers.items()):
            print(f"   {title!r} on {len(names)} board(s)")

    if args.apply:
        db.commit()
        print(f"\nDone: {touched} dashboard(s) changed.")
    elif touched:
        print(f"\nNothing changed. Run again with --apply to change {touched} dashboard(s).")
    db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
