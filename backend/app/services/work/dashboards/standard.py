"""The Dashboards people get without building them.

Everyone gets "My work": their own tasks and their own hours. Whoever leads a Team gets that
Team as one Dashboard, person by person. Owners and admins get "Company": everyone, managers
included. They are made the first time the Hub is opened and are ordinary Dashboards after
that -- cards can be added, renamed or removed, and deleting one is allowed (it won't come
back unless the row is gone entirely, which is the point of the `standard` marker).

Who may open them is the usual rule (dashboards/access.py): a Team dashboard is for its leads,
"My work" is personal, and admins can view everything.
"""

import uuid
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import Dashboard, DashboardCard, Team
from app.schemas import dashboards as d
from app.services.work.access import Access
from app.services.work.dashboards.access import Standing

MY_WORK = "my_work"
TEAM = "team"
COMPANY = "company"

Card = Tuple[str, str, Dict[str, Any], int, int]

WEEK = {"preset": "this_week"}
MONTH = {"preset": "this_month"}


def _my_work_cards() -> List[Card]:
    """What a person needs from their own Dashboard: how much work, what it adds up to in hours,
    what is finished, what is still to do, and where the hours went against the estimates."""
    return [
        ("calculation", "Open tasks", {}, 3, 1),
        ("calculation", "Due today", {"filters": {"due": "today"}}, 3, 1),
        ("calculation", "Overdue", {"filters": {"due": "overdue"}}, 3, 1),
        ("calculation", "Done this week", {"filters": {"done": "this_week"}, "include_closed": True}, 3, 1),
        # Across the full width: the hours, for whatever period is chosen on the card.
        ("capacity", "My hours: capacity, planned and logged", {"period": WEEK, "include_subtasks": True}, 12, 2),
        ("bar", "My work by priority", {"group_by": "priority"}, 6, 3),
        # Closed work counts here: a split of To do / In progress / Completed is the point.
        ("pie", "My work by status", {"group_by": "status", "include_closed": True}, 6, 3),
        # Taken off the standard Dashboard. The card type is still built and still renders,
        # so an existing board that has one keeps working:
        # ("completed", "Completed tasks", {"period": MONTH}, 6, 3),
        # Taken off the standard Dashboard: the status pie already says what is still to do,
        # and My Tasks is where that list is worked from. The card type is still built.
        # ("task_list", "To do", {"filters": {"status_groups": ["not_started", "active"]}, "sort": "due"}, 6, 3),
        ("timesheet", "My timesheet", {"period": WEEK, "include_subtasks": True}, 12, 3),
        ("variance", "Estimate against actual, on finished work", {"period": MONTH, "include_subtasks": True}, 12, 4),
    ]


def _people_cards(everyone: bool) -> List[Card]:
    """One Dashboard covering a group of people, broken down person by person."""
    whose = "the company" if everyone else "the team"
    return [
        ("calculation", "Open tasks", {}, 3, 1),
        ("calculation", "Overdue", {"filters": {"due": "overdue"}}, 3, 1),
        ("calculation", "Unassigned", {"filters": {"assignees": ["none"]}}, 3, 1),
        ("calculation", "Done this month", {"filters": {"done": "this_month"}, "include_closed": True}, 3, 1),
        ("capacity", f"Hours in {whose}: capacity, planned and logged", {"period": WEEK, "include_subtasks": True}, 12, 2),
        # Per-person charts run the full width: a firm of twenty needs the room, and past ten
        # people the card turns on its side and lists everyone rather than rolling up a tail.
        ("bar", "Open tasks per person", {"group_by": "assignee"}, 12, 4),
        ("bar", "Overdue per person", {"group_by": "assignee", "filters": {"due": "overdue"}}, 12, 4),
        ("behind", f"Who's behind in {whose}", {}, 6, 3),
        # ("completed", "Finished this month: on time or late", {"period": MONTH}, 6, 3),
        # Finished work counts: a status split that leaves out Completed says the team has done
        # nothing, which is the opposite of what it is for.
        ("pie", "Work by status", {"group_by": "status", "include_closed": True}, 6, 3),
        ("bar", "Work by priority", {"group_by": "priority"}, 6, 3),
        ("timesheet", "Hours per day this week", {"period": WEEK, "include_subtasks": True}, 12, 3),
        ("time_report", "Hours this month per person", {"period": MONTH, "time_group_by": "user",
                                                        "then_by": "task", "include_subtasks": True}, 12, 3),
        ("task_list", "Nobody is on these", {"filters": {"assignees": ["none"]}, "sort": "due"}, 6, 3),
        # ("task_list", "To do", {"filters": {"status_groups": ["not_started", "active"]}, "sort": "due"}, 6, 3),
        ("variance", "Estimate against actual, per person", {"period": MONTH, "include_subtasks": True}, 12, 4),
    ]


def _make(db: Session, access: Access, kind: str, name: str, filters: Dict[str, Any],
          cards: List[Card], team_id: Optional[uuid.UUID] = None) -> None:
    dash = Dashboard(
        workspace_id=access.workspace_id, name=name, owner_id=access.user_id,
        team_id=team_id, filters=filters, standard=kind,
    )
    try:
        # The row goes in inside the savepoint: begin_nested() flushes what is already
        # pending, so adding it first would land the clash in the outer transaction.
        with db.begin_nested():
            db.add(dash)
            db.flush()
    except IntegrityError:
        return  # another request of theirs made it first; the unique indexes keep it to one
    for i, (card_type, title, config, width, height) in enumerate(cards):
        db.add(DashboardCard(dashboard_id=dash.id, type=card_type, title=title,
                             config=d.CardConfig.model_validate(config).model_dump(mode="json"),
                             width=width, height=height, position=i))
    db.flush()


def ensure(db: Session, access: Access, standing: Standing) -> None:
    """Makes the standard Dashboards this person should have and doesn't yet."""
    if standing.is_guest:
        return
    have = {
        (row.standard, row.owner_id, row.team_id)
        for row in db.scalars(
            select(Dashboard).where(Dashboard.workspace_id == access.workspace_id, Dashboard.standard.is_not(None))
        )
    }
    if (MY_WORK, access.user_id, None) not in have:
        _make(db, access, MY_WORK, "My work", {"assignees": ["me"]}, _my_work_cards())
    for team_id in sorted(standing.led_teams, key=str):
        if any(kind == TEAM and had == team_id for kind, _, had in have):
            continue
        team = db.get(Team, team_id)
        if team is None:
            continue
        _make(db, access, TEAM, f"{team.name} – people"[:100], {"assignees": [f"team:{team_id}"]},
              _people_cards(everyone=False), team_id=team_id)
    if standing.is_admin and not any(k == COMPANY for k, _, _ in have):
        _make(db, access, COMPANY, "Company", {}, _people_cards(everyone=True))
