"""Fill the demo workspace with a month of believable work, so the Dashboards have something to show.

Run it after scripts/seed_demo_team.py:

    venv/Scripts/python.exe scripts/seed_demo_work.py --owner <your-sign-in-email>

What it makes, per person and to suit their designation:
  * interns and articles get small, hands-on jobs; executives get client deliverables;
    managers get reviews and approvals; partners get oversight and client meetings;
  * work spread over the last three weeks and the next two, so some is done, some is running,
    some is late, and some hasn't started;
  * hours logged against it on working days, which is what fills the timesheet, the time
    reports and the "capacity, planned and logged" card;
  * one person (by default Harish Kandi) gets a full load of 30 tasks, so a personal Dashboard
    can be read properly.

Run it again and it tops up to the same amount instead of duplicating. Nothing here touches
Firestore or any live data: it writes to DATABASE_URL only.
"""

import argparse
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select  # noqa: E402

from app.db import session as db_session  # noqa: E402
from app.db.models import (  # noqa: E402
    Status,
    StatusGroup,
    Task,
    TaskAssignee,
    TaskList,
    TimeEntry,
    User,
    Workspace,
    WorkspaceMember,
)
from app.db.models.enums import PermissionLevel  # noqa: E402
from app.db.models.hierarchy import Space  # noqa: E402
from app.schemas import work as s  # noqa: E402
from app.services.work import tasks as task_service  # noqa: E402
from app.services.work.access import Access, Opened  # noqa: E402
from app.services.work.statuses import effective_statuses  # noqa: E402

WORKSPACE = "Verve Advisory"
HOUR = 3600

# What each kind of person actually spends their week on.
WORK: dict[str, list[tuple[str, int]]] = {  # designation -> (title, estimate in minutes)
    "Intern": [
        ("Collect {client} bank statements", 60),
        ("Enter {client} purchase invoices in Tally", 120),
        ("Chase missing bills from {client}", 45),
        ("Scan and file {client} vouchers", 90),
        ("Update the {team} tracker for this week", 30),
        ("Prepare {client} TDS working", 120),
        ("Sit in on the {client} call and take notes", 60),
    ],
    "Article": [
        ("Vouching of {client} expenses", 180),
        ("{client} bank reconciliation", 120),
        ("Draft {client} GST computation", 150),
        ("Prepare {client} stock summary", 120),
        ("Follow up on {client} balance confirmations", 60),
    ],
    "Executive": [
        ("File {client} GSTR-3B", 120),
        ("Prepare {client} monthly MIS", 240),
        ("{client} payroll run", 180),
        ("Reconcile {client} vendor ledgers", 150),
        ("Draft reply to {client} notice", 180),
        ("Close {client} books for the month", 240),
        ("Raise {client} invoices", 60),
    ],
    "Senior Executive": [
        ("Review {client} GST workings", 120),
        ("{client} advance tax computation", 180),
        ("Prepare {client} board pack", 240),
        ("Walk the intern through {client} filing", 60),
        ("{client} audit schedules", 300),
        ("Client call: {client} month-end queries", 60),
    ],
    "Manager": [
        ("Review {client} monthly deliverable", 90),
        ("Sign off {client} filings", 60),
        ("{team} team plan for next month", 120),
        ("One-to-one with the {team} team", 60),
        ("Client meeting: {client} scope and fees", 90),
        ("Check the {team} timesheets", 45),
        ("Escalation: {client} pending information", 60),
    ],
    "Partner": [
        ("Monthly review with the {team} team", 90),
        ("{client} engagement letter", 60),
        ("Practice review: utilisation and write-offs", 120),
        ("Client relationship call: {client}", 60),
        ("Approve {team} hiring plan", 60),
    ],
}
DEFAULT = WORK["Executive"]

CLIENTS = [
    "Unimed", "Infrabeat", "Krutanjali", "Cognivion", "Acme Retail", "Bluepeak", "Shreeji Traders",
    "Nova Foods", "Prism Logistics", "Vertex Labs",
]
TAGS_BY_TEAM = {"HR": "people", "Accounts": "compliance", "Sales": "clients"}


def working_day(moment: datetime) -> datetime:
    """Nudge a date off the weekend, so the week reads the way a real one does."""
    while moment.weekday() >= 5:
        moment += timedelta(days=1)
    return moment


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, help="the email you sign in with")
    parser.add_argument("--workspace", default=WORKSPACE)
    parser.add_argument("--focus", default="Harish Kandi", help="who gets a full load of work")
    parser.add_argument("--focus-tasks", type=int, default=30)
    parser.add_argument("--per-person", type=int, default=6, help="tasks for everyone else")
    parser.add_argument("--reset", action="store_true", help="clear the work this script made and start again")
    args = parser.parse_args()
    random.seed(7)  # the same demo every time

    with db_session.new_session() as db:
        workspace = db.scalar(select(Workspace).where(func.lower(Workspace.name) == args.workspace.lower()))
        if workspace is None:
            raise SystemExit(f"No workspace called “{args.workspace}”. Run seed_demo_team.py first.")
        owner = db.scalar(select(User).where(func.lower(User.email) == args.owner.lower()))
        if owner is None:
            raise SystemExit(f"No account with {args.owner}.")

        access = Access.for_workspace(db, owner.id, workspace.id)
        people = [
            (member, user)
            for member, user in db.execute(
                select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
                .where(WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.deactivated_at.is_(None))
                .order_by(User.display_name)
            )
        ]
        lists = {
            lst.name: lst
            for lst in db.scalars(
                select(TaskList).join(Space, Space.id == TaskList.space_id)
                .where(Space.workspace_id == workspace.id, TaskList.name.like("PMS - %"))
            )
        }
        if not lists:
            raise SystemExit("No “PMS - …” Lists found. Run seed_demo_team.py first.")

        statuses_for: dict[str, list[Status]] = {}

        def pick_status(lst: TaskList, which: str) -> Status:
            if lst.name not in statuses_for:
                statuses_for[lst.name] = effective_statuses(db, lst)
            rows = statuses_for[lst.name]
            wanted = {
                "todo": StatusGroup.not_started, "doing": StatusGroup.active,
                "done": StatusGroup.done, "closed": StatusGroup.closed,
            }[which]
            return next((st for st in rows if st.group == wanted), rows[0])

        if args.reset:
            gone = db.execute(
                Task.__table__.delete().where(Task.created_by == owner.id)
            ).rowcount
            db.flush()
            print(f"Cleared {gone} seeded tasks (anything you made yourself is untouched).")

        now = datetime.now(timezone.utc)
        today = now.replace(hour=10, minute=0, second=0, microsecond=0)
        made = tracked = 0

        # How a real week looks: most work is in hand, a little is late, some is done, some is next.
        SHAPE = ["doing", "doing", "todo", "closed", "doing", "late", "done", "todo", "doing", "closed"]

        for member, user in people:
            if user.id == owner.id and (user.display_name or "").lower() == "workspace owner":
                continue
            designation = member.designation or "Executive"
            team = member.department or "HR"
            lst = lists.get(f"PMS - {team}") or next(iter(lists.values()))
            existing = db.scalar(
                select(func.count()).select_from(Task).join(TaskAssignee, TaskAssignee.task_id == Task.id)
                .where(TaskAssignee.user_id == user.id, Task.list_id == lst.id)
            ) or 0
            wanted = args.focus_tasks if (user.display_name or "") == args.focus else args.per_person
            if existing >= wanted:
                continue

            menu = WORK.get(designation, DEFAULT)
            for i in range(existing, wanted):
                title, minutes = menu[i % len(menu)]
                client = CLIENTS[(i + len(user.id)) % len(CLIENTS)]
                name = title.format(client=client, team=team)
                if i >= len(menu):
                    name = f"{name} ({client})"
                # Where this one sits: finished, in hand, late, or still to start.
                shape = SHAPE[i % len(SHAPE)]
                # Roughly one job in twenty is still waiting for someone; never on the focus person,
                # whose Dashboard is meant to be full.
                nobody_on_it = made % 19 == 18 and (user.display_name or "") != args.focus
                if shape in ("done", "closed"):
                    due = working_day(today - timedelta(days=3 + (i % 12)))
                elif shape == "late":
                    due = working_day(today - timedelta(days=1 + (i % 6)))
                elif shape == "doing":
                    due = working_day(today + timedelta(days=i % 6))
                else:
                    due = working_day(today + timedelta(days=3 + (i % 10)))
                started = due - timedelta(days=1 + (i % 3))
                state = "doing" if shape == "late" else shape
                status = pick_status(lst, state)
                estimate = minutes * 60
                task = task_service.create_task(
                    db,
                    Opened(lst, access, PermissionLevel.full),
                    s.TaskCreate(
                        name=name,
                        status_id=status.id,
                        # A few jobs nobody has picked up: that is what the "Unassigned" cards are for.
                        assignees=[] if nobody_on_it else [user.id],
                        priority=(i % 4) + 1,  # every task carries one: priority is mandatory now
                        start_date=started,
                        due_date=due.replace(hour=18),
                        time_estimate_seconds=estimate,
                        tags=[TAGS_BY_TEAM.get(team, "client work")],
                    ),
                    check_assignee_access=False,  # seeded people are all in the same Space
                )
                if shape in ("done", "closed"):
                    # Most finished on time; some a few days after they were due.
                    slip = random.choice([0, 0, 0, 0, 0, 0, 1, 2, 4])
                    task.date_done = due + timedelta(days=slip, hours=(i % 5) - 2)
                    if state == "closed":
                        task.date_closed = task.date_done
                # Hours against it, on the day it was worked.
                if shape != "todo" and not nobody_on_it:
                    spent = int(estimate * random.uniform(0.4, 1.3))
                    while spent > 0:
                        chunk = min(spent, random.choice([1800, 3600, 5400, 7200]))
                        day = working_day(started + timedelta(days=random.randint(0, 3)))
                        if day > now:
                            day = now - timedelta(hours=2)
                        db.add(TimeEntry(
                            task_id=task.id, user_id=user.id, started_at=day,
                            ended_at=day + timedelta(seconds=chunk), duration_seconds=chunk,
                            description=None, billable=bool(i % 2), created_by=user.id,
                        ))
                        tracked += chunk
                        spent -= chunk
                made += 1
            db.flush()

        db.commit()
        print(f"Added {made} tasks and {round(tracked / HOUR)}h of logged time across {len(people)} people.")
        print(f"“{args.focus}” now has a full load, so their own Dashboard reads properly.")


if __name__ == "__main__":
    main()
