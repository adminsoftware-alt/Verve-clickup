"""Bring every standard Dashboard back to its template, card for card.

Standard Dashboards are generated, not designed by hand -- there is one "My work" per person, one
per Team, and one for the company -- so two people comparing notes should be looking at the same
board. They were not. Across fourteen boards there were seven different layouts, because each was
built by whatever the template said on the day that person first opened it, and the template has
moved since.

What that looked like:

  * The top row drifted three ways at once: four tiles of width 3 on a person's board against three
    of width 4 on a Team's, "Done this week" against "Done this month", and -- on two boards where
    somebody had used the period control -- date tiles rewritten from their own fixed windows to the
    shared one. That last one is why the control read "Today" on two boards and "Period" on twelve.
  * Five "My work" boards still carried "Completed tasks" and "To do", retired from the template
    when the card set was cut back.
  * The hours card sat in three different places at two different heights, and one board's
    estimate-against-actual was half width.

Cards are matched by title first and by kind second, so a card that has only been renamed or
resized is corrected in place and keeps its id. Nothing outside the standard Dashboards is read.

    python scripts/align_standard_dashboards.py            # say what would change
    python scripts/align_standard_dashboards.py --apply    # change it
"""
from __future__ import annotations

import argparse
import sys
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, ".")

from sqlalchemy import select  # noqa: E402

from app.db.models import Dashboard, DashboardCard  # noqa: E402
from app.db.session import new_session  # noqa: E402
from app.schemas import dashboards as d  # noqa: E402
from app.services.work.dashboards import standard  # noqa: E402

WEEK = {"preset": "this_week"}


def role(filters: Optional[Dict[str, Any]]) -> str:
    """What a one-number tile is for, so the same tile is recognised across boards."""
    f = filters or {}
    if f.get("due") == "overdue":
        return "overdue"
    if f.get("done"):
        return "done"
    if f.get("due"):
        return "due"
    return "open"


def norm(filters: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Filters with the empty keys dropped.

    The API stores every key, null where unused, so a stored card looks nothing like the template's
    two-key dict even when the two mean exactly the same thing.
    """
    return {k: v for k, v in (filters or {}).items() if v not in (None, [], {}, "")}


def merged(existing: Optional[Dict[str, Any]], cfg: Dict[str, Any]) -> Dict[str, Any]:
    """The template's config, keeping the stored shape so nothing downstream sees a key vanish."""
    out = dict(existing or {})
    was = out.get("filters")
    wanted = dict(cfg.get("filters") or {})
    if isinstance(was, dict):
        # Every key the card already had, blanked, then the template's on top. A tile coming off the
        # shared period has to come back with done=None as well as due=today.
        out["filters"] = {**{k: None for k in was}, **wanted}
    elif wanted or "filters" in cfg:
        out["filters"] = wanted
    # Only the keys the template actually declares. A stored card carries all fifteen fields of the
    # config model -- fn, limit, donut, billable and the rest -- and an earlier version of this
    # dropped the ones the template was silent about, which would have reset a pie to a bar and
    # taken the row limit off every task list.
    for key, value in cfg.items():
        if key != "filters":
            out[key] = value
    # Except these two, where the template's silence means something rather than nothing.
    #
    # include_closed is set only on the cards about finished work, so absent has to mean False.
    if "include_closed" not in cfg:
        out["include_closed"] = False
    # And a card the template gives no period to should be on the model's default week. Left as
    # found, these were the last thing still differing between boards: one person's priority chart
    # was on this_month and another's status pie on last_week, and -- worse -- two timesheet cards
    # titled "this week" were frozen on a custom 21-27 September range that will never move again.
    if "period" not in cfg:
        out["period"] = dict(WEEK)
    # Through the same model the app writes with, so a card this script adds is stored in exactly
    # the shape a card the generator adds is. Both read back identically either way -- the model
    # fills the missing keys -- but storing one sparse and one full means any later audit of the
    # database reports a difference that is not there, which is a trap for whoever reads it next.
    return d.CardConfig.model_validate(out).model_dump(mode="json")


def template(kind: str) -> List[Tuple[str, str, Dict[str, Any], int, int]]:
    if kind == standard.MY_WORK:
        return standard._my_work_cards()
    return standard._people_cards(kind == standard.COMPANY)


def pick(spare: List[DashboardCard], kind: str, title: str, cfg: Dict[str, Any]) -> Optional[DashboardCard]:
    """The existing card this template entry means, if there is one.

    By title first: a board with three task lists has to match each to the right one. Then by kind,
    which catches a card that was renamed or re-scoped -- and for a one-number tile, by what the
    tile is for, so "Done this month" is recognised as the finished-work tile.
    """
    exact = next((c for c in spare if c.type == kind and c.title == title), None)
    if exact:
        return exact
    if kind == "calculation":
        return next((c for c in spare if c.type == kind and role((c.config or {}).get("filters")) == role(cfg.get("filters"))), None)
    return next((c for c in spare if c.type == kind), None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the changes")
    args = ap.parse_args()

    touched = 0
    report: List[str] = []

    with new_session() as db:
        boards = list(db.scalars(
            select(Dashboard).where(Dashboard.standard.isnot(None)).order_by(Dashboard.standard, Dashboard.name)
        ))
        print(f"{len(boards)} standard Dashboards\n")
        for board in boards:
            wanted = template(board.standard)
            cards = list(db.scalars(
                select(DashboardCard).where(DashboardCard.dashboard_id == board.id).order_by(DashboardCard.position)
            ))
            spare = list(cards)
            notes: List[str] = []

            for position, (kind, title, cfg, width, height) in enumerate(wanted):
                full = dict(cfg)
                if kind == "calculation":
                    full.setdefault("period", dict(WEEK))
                card = pick(spare, kind, title, full)
                if card is None:
                    notes.append(f'added {kind} "{title}"')
                    if args.apply:
                        db.add(DashboardCard(
                            dashboard_id=board.id, type=kind, title=title,
                            config=full, position=position, width=width, height=height,
                        ))
                    continue
                spare.remove(card)
                if card.title != title:
                    notes.append(f'"{card.title}" -> "{title}"')
                    if args.apply:
                        card.title = title
                if norm((card.config or {}).get("filters")) != norm(full.get("filters")):
                    notes.append(f'{title}: {norm((card.config or {}).get("filters")) or "{}"} -> {norm(full.get("filters")) or "{}"}')
                was_period = {k: v for k, v in ((card.config or {}).get("period") or {}).items() if v}
                now_period = {k: v for k, v in (full.get("period") or dict(WEEK)).items() if v}
                if was_period and was_period != now_period:
                    notes.append(f"{title}: period {was_period} -> {now_period}")
                if (card.width, card.height) != (width, height):
                    notes.append(f"{title}: {card.width}x{card.height} -> {width}x{height}")
                if card.position != position:
                    notes.append(f"{title}: moved to slot {position + 1}")
                if args.apply:
                    card.config = merged(card.config, full)
                    card.width, card.height, card.position = width, height, position

            # Whatever the template no longer has. The card types are all still built and still
            # render, so a custom Dashboard that uses one keeps working -- this only takes them off
            # the generated boards, which are meant to be the same for everybody.
            for card in spare:
                notes.append(f'removed {card.type} "{card.title}"')
                if args.apply:
                    db.delete(card)

            if notes:
                touched += 1
                report.append(f"  {board.name} [{board.standard}]")
                report.extend(f"      {n}" for n in notes)

        if args.apply:
            db.commit()

    for line in report:
        print(line)
    print(f"\n{touched} boards {'changed' if args.apply else 'would change'}")
    if not args.apply and touched:
        print("Nothing was written. Re-run with --apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
