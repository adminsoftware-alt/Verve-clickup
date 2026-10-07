"""What running this costs, per day, per month, per year and per person.

No billing API is wired up anywhere, so nothing here is discovered: an admin records what the
firm actually pays and how often. What the app adds is the arithmetic nobody enjoys doing --
normalising a yearly domain renewal and a monthly server onto the same scale, multiplying the
per-seat rates by the number of people who are actually active, and dividing the total by the
same number so the figure that decides things ("what does this cost us per person") is on screen
rather than in somebody's head.

Money is held in minor units (paise, cents) as integers throughout. A monthly figure divided by
30 in floating point stops adding up, and a cost page whose rows do not sum to its total is a
cost page nobody trusts.
"""

import uuid
from typing import Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models import Attachment, CostItem, WorkspaceMember
from app.schemas import costs as c
from app.services.work.access import Access
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

# How many of each period there are in a year. A month is a twelfth of a year rather than 30
# days, so twelve monthly bills come to exactly one yearly figure.
PER_YEAR = {"daily": 365, "monthly": 12, "yearly": 1, "once": 0}
PERIODS = tuple(PER_YEAR)
SCALES = ("flat", "per_person", "per_gb")
CATEGORIES = ("hosting", "database", "email", "authentication", "storage", "domain", "licence", "other")


def _require_admin(access: Access) -> None:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can see what this costs")


def usage(db: Session, workspace_id: uuid.UUID) -> c.CostUsage:
    """The measured quantities the per-unit rates are multiplied by."""
    people = db.scalar(
        select(func.count()).select_from(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.deactivated_at.is_(None))
    ) or 0
    stored = db.scalar(select(func.coalesce(func.sum(Attachment.size), 0))) or 0
    return c.CostUsage(active_people=people, stored_bytes=int(stored))


def _yearly_minor(item: CostItem, use: c.CostUsage) -> int:
    """One line's cost over a year, in minor units, with its rate already multiplied out."""
    times = PER_YEAR.get(item.period, 0)
    if item.scales == "per_person":
        unit = item.amount_minor * use.active_people
    elif item.scales == "per_gb":
        # Billed per whole gigabyte, the way storage is sold; nothing stored is nothing billed.
        gigabytes = -(-use.stored_bytes // (1024 ** 3))
        unit = item.amount_minor * gigabytes
    else:
        unit = item.amount_minor
    return unit * times


def _line(item: CostItem, use: c.CostUsage) -> c.CostLine:
    yearly = _yearly_minor(item, use)
    return c.CostLine(
        id=item.id, name=item.name, category=item.category, note=item.note, active=item.active,
        amount_minor=item.amount_minor, currency=item.currency, period=item.period, scales=item.scales,
        # A one-off is shown but never spread across the year: amortising a laptop over twelve
        # months is an accounting choice, and this page is not the place to make it quietly.
        yearly_minor=yearly, monthly_minor=yearly // 12, daily_minor=yearly // 365,
        once_minor=item.amount_minor if item.period == "once" else 0,
    )


def summary(db: Session, access: Access) -> c.CostSummary:
    """Everything the page needs: the lines, the totals, and what it works out to per person."""
    _require_admin(access)
    use = usage(db, access.workspace_id)
    items = list(db.scalars(
        select(CostItem).where(CostItem.workspace_id == access.workspace_id).order_by(CostItem.name)))
    lines = [_line(i, use) for i in items]
    running = [l for l in lines if l.active and l.period != "once"]

    yearly = sum(l.yearly_minor for l in running)
    by_category: Dict[str, int] = {}
    for line in running:
        by_category[line.category] = by_category.get(line.category, 0) + line.yearly_minor

    # Everything is quoted in one currency; mixing them silently would produce a total that is
    # arithmetically fine and factually meaningless.
    currencies = sorted({i.currency for i in items if i.active}) or ["INR"]

    return c.CostSummary(
        currency=currencies[0],
        mixed_currencies=len(currencies) > 1,
        usage=use,
        lines=lines,
        yearly_minor=yearly,
        monthly_minor=yearly // 12,
        daily_minor=yearly // 365,
        per_person_monthly_minor=(yearly // 12) // use.active_people if use.active_people else 0,
        one_off_minor=sum(l.once_minor for l in lines if l.active),
        by_category=[c.CostByCategory(category=k, yearly_minor=v) for k, v in sorted(by_category.items(), key=lambda kv: -kv[1])],
    )


def _check(data: c.CostItemIn) -> None:
    if data.period not in PERIODS:
        raise Invalid(f"A cost is billed daily, monthly, yearly or once — not {data.period!r}")
    if data.scales not in SCALES:
        raise Invalid("A cost is either a flat figure, per person, or per gigabyte")
    if data.category not in CATEGORIES:
        raise Invalid(f"Unknown category {data.category!r}")
    if data.period == "once" and data.scales != "flat":
        raise Invalid("A one-off payment is a flat figure, not a rate")


def add(db: Session, access: Access, data: c.CostItemIn) -> CostItem:
    _require_admin(access)
    _check(data)
    item = CostItem(
        workspace_id=access.workspace_id, name=data.name, category=data.category,
        amount_minor=data.amount_minor, currency=data.currency.upper(), period=data.period,
        scales=data.scales, note=data.note, active=data.active, created_by=access.user_id,
    )
    db.add(item)
    db.flush()
    return item


def _own(db: Session, access: Access, item_id: uuid.UUID) -> CostItem:
    item = db.get(CostItem, item_id)
    if item is None or item.workspace_id != access.workspace_id:
        raise NotFound("That cost is not on the list")
    return item


def update(db: Session, access: Access, item_id: uuid.UUID, data: c.CostItemIn) -> CostItem:
    _require_admin(access)
    _check(data)
    item = _own(db, access, item_id)
    item.name, item.category, item.note = data.name, data.category, data.note
    item.amount_minor, item.currency = data.amount_minor, data.currency.upper()
    item.period, item.scales, item.active = data.period, data.scales, data.active
    db.flush()
    return item


def remove(db: Session, access: Access, item_id: uuid.UUID) -> None:
    _require_admin(access)
    db.delete(_own(db, access, item_id))
    db.flush()


def suggestions() -> List[c.CostSuggestion]:
    """The things this application needs to run, as a starting list to price.

    Not prices -- those differ by provider, region and plan, and a figure invented here would be
    quoted back as fact. These are the lines a deployment of this app actually has.
    """
    return [
        c.CostSuggestion(name="Application server", category="hosting",
                         why="Where the API and the web app run."),
        c.CostSuggestion(name="Postgres database", category="database",
                         why="Every task, timesheet and comment lives here."),
        c.CostSuggestion(name="Database backups", category="database",
                         why="Usually billed separately from the database itself."),
        c.CostSuggestion(name="File storage", category="storage", scales="per_gb",
                         why="Attachments on tasks. Priced per gigabyte, so enter the rate per GB."),
        c.CostSuggestion(name="Email sending", category="email",
                         why="Invitations, reminders, digests and scheduled reports."),
        c.CostSuggestion(name="Firebase authentication", category="authentication",
                         why="Sign-in. Free below a generous monthly limit — record it as zero if you are under it."),
        c.CostSuggestion(name="Domain name", category="domain",
                         why="Usually billed once a year."),
    ]
