"""Fill a workspace with the Verve Advisory team, so assignment and permissions can be tried by hand.

It creates the people (with designations and reporting managers), the Teams, the
"VAPL Common Operation Tasks" Space with its Monthly Review Lists, the Review Month,
Designations and Manager fields, and one monthly review task per person.

    venv/Scripts/python.exe scripts/seed_demo_team.py --owner <your-sign-in-email>

`--owner` is the account you sign in with; it becomes the workspace owner so you see
everything. Run it again and it tops up what's missing instead of duplicating.
Nothing here touches Firestore or any live data; it writes to DATABASE_URL only.
"""

import argparse
import os
import sys
import uuid
from datetime import date, datetime, time, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select  # noqa: E402

from app.db import session as db_session  # noqa: E402
from app.db.models import (  # noqa: E402
    CustomField,
    FieldType,
    Folder,
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
from app.schemas import work as s  # noqa: E402
from app.services.work import customfields, hierarchy, tasks as task_service  # noqa: E402
from app.services.work.access import Access, Opened  # noqa: E402
from app.db.models.enums import LocationKind, PermissionLevel  # noqa: E402

WORKSPACE = "Verve Advisory"
SPACE = "VAPL Common Operation Tasks"
FOLDER = "Monthly Review"
DOMAIN = "verveadvisory.com"

# name, designation, list, reporting manager (by name)
PEOPLE: list[tuple[str, str, str, str | None]] = [
    # HR
    ("Aarti Yadav", "Partner", "PMS - HR", None),
    ("Aditi Jain", "Executive", "PMS - HR", "Aarti Yadav"),
    ("Anjali Sharma", "Executive", "PMS - HR", "Aarti Yadav"),
    ("Daksh Jain", "Intern", "PMS - HR", "Aditi Jain"),
    ("Debarima Paul", "Senior Executive", "PMS - HR", "Aarti Yadav"),
    ("Dev Chavan", "Executive", "PMS - HR", "Debarima Paul"),
    ("Fiza Rizvi", "Intern", "PMS - HR", "Debarima Paul"),
    ("Harshita Rajput", "Executive", "PMS - HR", "Aarti Yadav"),
    ("Prashant Joshi", "Manager", "PMS - HR", "Aarti Yadav"),
    ("Reena Kulkarni", "Executive", "PMS - HR", "Prashant Joshi"),
    ("Sakshi Jadhav", "Intern", "PMS - HR", "Prashant Joshi"),
    ("Sayli Rane", "Executive", "PMS - HR", "Prashant Joshi"),
    ("Vaishali Malasi", "Senior Executive", "PMS - HR", "Aarti Yadav"),
    # Infrabeat
    ("Ganesh Shinde", "Manager", "PMS - Infrabeat", "Aarti Yadav"),
    ("Kajal Kale", "Executive", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Balaji Shinde", "Senior Executive", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Aditya Agarwal", "Executive", "PMS - Infrabeat", "Kajal Kale"),
    ("Ritesh Chaudhari", "Intern", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Shubham Dhanawade", "Executive", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Akshay Deshmukh", "Intern", "PMS - Infrabeat", "Shubham Dhanawade"),
    ("Asmita Kadam", "Executive", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Sayam Doshi", "Article", "PMS - Infrabeat", "Ganesh Shinde"),
    ("Shubham Kale", "Executive", "PMS - Infrabeat", "Ganesh Shinde"),
    # Sales
    ("Pooja Agarwal", "Manager", "PMS - Sales", "Aarti Yadav"),
    ("Ronit Jain", "Executive", "PMS - Sales", "Pooja Agarwal"),
    ("Sakshi Ghodke", "Executive", "PMS - Sales", "Pooja Agarwal"),
    ("Vidhi Kothari", "Intern", "PMS - Sales", "Pooja Agarwal"),
    ("Meenal Mehta", "Senior Executive", "PMS - Sales", "Pooja Agarwal"),
    # Dev
    ("Devendra Mandhana", "Partner", "PMS - Dev", None),
    ("Harsh Jain", "Manager", "PMS - Dev", "Devendra Mandhana"),
    ("Prem Deshpande", "Senior Executive", "PMS - Dev", "Devendra Mandhana"),
    ("Satyam Rathi", "Senior Executive", "PMS - Dev", "Harsh Jain"),
    ("Palash Sharma", "Senior Executive", "PMS - Dev", "Devendra Mandhana"),
    ("Pratik Nair", "Senior Executive", "PMS - Dev", "Harsh Jain"),
    ("Shruti Kasliwal", "Intern", "PMS - Dev", "Prem Deshpande"),
    ("Vidya Sharma", "Executive", "PMS - Dev", "Satyam Rathi"),
    ("Preet Khandelwal", "Intern", "PMS - Dev", "Harsh Jain"),
    ("Harshvardhan Patil", "Intern", "PMS - Dev", "Prem Deshpande"),
    ("Gagandeep Singh", "Executive", "PMS - Dev", "Pratik Nair"),
    ("Manasvi More", "Article", "PMS - Dev", "Pratik Nair"),
    ("Mahadev Thawani", "Intern", "PMS - Dev", "Harsh Jain"),
    ("Tushar Kale", "Executive", "PMS - Dev", "Prem Deshpande"),
    ("Shashank Channawar", "Executive", "PMS - Dev", "Satyam Rathi"),
    ("Harish Kandi", "Intern", "PMS - Dev", "Harsh Jain"),
    ("Atharv Kale", "Intern", "PMS - Dev", "Satyam Rathi"),
    ("Tarun Ghumnani", "Article", "PMS - Dev", "Satyam Rathi"),
    ("Rukaiya Shaikh", "Senior Executive", "PMS - Dev", "Harsh Jain"),
    # Unimed
    ("Sagar Gupta", "Manager", "PMS - Unimed", "Aarti Yadav"),
    ("Om Bhosale", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Shailesh Chavan", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Shubhangi More", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Shweta Deshmukh", "Manager", "PMS - Unimed", "Devendra Mandhana"),
    ("Aman Paul", "Executive", "PMS - Unimed", "Shweta Deshmukh"),
    ("Kajal Yadav", "Executive", "PMS - Unimed", "Shweta Deshmukh"),
    ("Shrikar Menon", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Aastha Chandwani", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Rajat Sonkar", "Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Vikram Singh Bisht", "Senior Executive", "PMS - Unimed", "Sagar Gupta"),
    ("Priyanka Sawant", "Senior Executive", "PMS - Unimed", "Sagar Gupta"),
    # Accounts
    ("Laxmi Kadam", "Manager", "PMS - Accounts", "Aarti Yadav"),
    ("Abhishek Sonar", "Executive", "PMS - Accounts", "Laxmi Kadam"),
    ("Amol Bibwe", "Executive", "PMS - Accounts", "Mayank Panchal"),
    ("Mayank Panchal", "Senior Executive", "PMS - Accounts", "Laxmi Kadam"),
    ("Akashata Kolekar", "Intern", "PMS - Accounts", "Laxmi Kadam"),
    # Krutanjali
    ("Krutanjali Apte", "Manager", "PMS - Krutanjali", "Aarti Yadav"),
    ("Ansari Matiullah", "Executive", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Pushpadevi Mishra", "Executive", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Komal Kere", "Intern", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Sumair Sadiq", "Executive", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Tanvi Agrawal", "Article", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Ayush Budhia", "Intern", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Muskan Dhole", "Intern", "PMS - Krutanjali", "Krutanjali Apte"),
    ("Aman Jalan", "Executive", "PMS - Krutanjali", "Krutanjali Apte"),
]
LISTS = ["PMS - HR", "PMS - Infrabeat", "PMS - Sales", "PMS - Dev", "PMS - Unimed", "PMS - Accounts", "PMS - Krutanjali"]
TEAMS = {
    "HR": "PMS - HR",
    "Infrabeat": "PMS - Infrabeat",
    "Sales": "PMS - Sales",
    "Dev": "PMS - Dev",
    "Unimed": "PMS - Unimed",
    "Accounts": "PMS - Accounts",
    "Krutanjali": "PMS - Krutanjali",
}
# Designations that manage others get the Manager workspace role; partners are admins.
ADMIN_TITLES = {"Partner"}
MANAGER_TITLES = {"Manager"}
DESIGNATION_COLORS = {
    "Partner": "#7c3aed", "Manager": "#3b82f6", "Senior Executive": "#f43f5e",
    "Executive": "#f59e0b", "Intern": "#9ca3af", "Article": "#10b981",
}
MONTHS = ["August 2026", "September 2026", "October 2026"]


def user_id(name: str) -> str:
    return "demo-" + name.lower().replace(" ", ".")


def email(name: str) -> str:
    return f"{name.lower().replace(' ', '.')}@{DOMAIN}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True, help="the email you sign in with")
    parser.add_argument("--workspace", default=WORKSPACE)
    args = parser.parse_args()

    with db_session.new_session() as db:
        owner = db.scalar(select(User).where(func.lower(User.email) == args.owner.lower()))
        if owner is None:
            owner = User(id=f"demo-owner-{uuid.uuid4().hex[:8]}", email=args.owner.lower(), display_name="Workspace owner")
            db.add(owner)
            db.flush()
            print(f"No account with {args.owner} yet: created a placeholder. Sign in with that email and it becomes yours.")

        workspace = db.scalar(select(Workspace).where(func.lower(Workspace.name) == args.workspace.lower()))
        if workspace is None:
            workspace = Workspace(name=args.workspace, created_by=owner.id)
            db.add(workspace)
            db.flush()
        if db.get(WorkspaceMember, (workspace.id, owner.id)) is None:
            db.add(WorkspaceMember(workspace_id=workspace.id, user_id=owner.id, role=WorkspaceRole.owner))
        db.flush()
        access = Access.for_workspace(db, owner.id, workspace.id)

        # --- people ---------------------------------------------------------------------------
        made = 0
        for name, designation, _list, _manager in PEOPLE:
            uid = user_id(name)
            person = db.get(User, uid)
            if person is None:
                person = User(id=uid, email=email(name), display_name=name)
                db.add(person)
                made += 1
            else:
                person.display_name = name
            db.flush()
            role = (WorkspaceRole.admin if designation in ADMIN_TITLES
                    else WorkspaceRole.member)
            member = db.get(WorkspaceMember, (workspace.id, uid))
            if member is None:
                member = WorkspaceMember(workspace_id=workspace.id, user_id=uid, role=role, added_by=owner.id)
                db.add(member)
            member.role = role
            member.designation = designation
            member.department = _list.replace("PMS - ", "")
        db.flush()
        for name, _designation, _list, manager in PEOPLE:
            if manager:
                db.get(WorkspaceMember, (workspace.id, user_id(name))).manager_id = user_id(manager)
        db.flush()

        # --- teams ----------------------------------------------------------------------------
        for team_name, list_name in TEAMS.items():
            team = db.scalar(select(Team).where(Team.workspace_id == workspace.id, func.lower(Team.name) == team_name.lower()))
            if team is None:
                team = Team(workspace_id=workspace.id, name=team_name, created_by=owner.id, handle=team_name.lower(), locations=[])
                db.add(team)
                db.flush()
            for name, designation, lst, _m in PEOPLE:
                if lst != list_name:
                    continue
                if db.get(TeamMember, (team.id, user_id(name))) is None:
                    db.add(TeamMember(team_id=team.id, user_id=user_id(name), is_lead=designation in MANAGER_TITLES | ADMIN_TITLES))
        db.flush()

        # --- the Space, its Folder and Lists ----------------------------------------------------
        space = db.scalar(select(Space).where(Space.workspace_id == workspace.id, Space.name == SPACE))
        if space is None:
            space = hierarchy.create_space(db, access, s.SpaceCreate(name=SPACE, icon="V", color="#0F766E"))
        folder = db.scalar(select(Folder).where(Folder.space_id == space.id, Folder.name == FOLDER))
        if folder is None:
            folder = hierarchy.create_folder(db, access, space, s.FolderCreate(name=FOLDER))
            starter = db.scalar(select(TaskList).where(TaskList.folder_id == folder.id))
            if starter is not None:
                starter.name = LISTS[0]
        for other in ("Attending Special event(festival)", "Learning", "Interview & Assessments", "Quaterly Revisit of yealy KRA"):
            if db.scalar(select(Folder).where(Folder.space_id == space.id, Folder.name == other)) is None:
                hierarchy.create_folder(db, access, space, s.FolderCreate(name=other))
        lists: dict[str, TaskList] = {}
        for list_name in LISTS:
            lst = db.scalar(select(TaskList).where(TaskList.folder_id == folder.id, TaskList.name == list_name))
            if lst is None:
                lst = hierarchy.create_list(db, access, space, s.ListCreate(name=list_name), folder=folder)
            lists[list_name] = lst
        db.flush()

        # --- the three columns from ClickUp -----------------------------------------------------
        def field(name: str, kind: str, options: list[str] | None = None) -> CustomField:
            existing = db.scalar(select(CustomField).where(CustomField.folder_id == folder.id, CustomField.name == name))
            if existing is not None:
                return existing
            config = {"options": [{"name": o, "color": DESIGNATION_COLORS.get(o, "#6366f1")} for o in options]} if options else {}
            return customfields.create(db, Opened(folder, access, PermissionLevel.full), LocationKind.folder,
                                       s.CustomFieldIn(name=name, type=kind, config=config))

        month_field = field("Review Month", "dropdown", MONTHS)
        designation_field = field("Designations", "dropdown", list(DESIGNATION_COLORS))
        manager_field = field("Manager", "people")
        db.flush()

        # --- one monthly review task per person -------------------------------------------------
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        created = 0
        for i, (name, designation, list_name, manager) in enumerate(PEOPLE):
            lst = lists[list_name]
            title = f"{name} Monthly Review"
            if db.scalar(select(Task.id).where(Task.list_id == lst.id, Task.name == title)):
                continue
            due = today + timedelta(days=(i % 12) - 2)
            opened = Opened(lst, access, PermissionLevel.full)
            task = task_service.create_task(db, opened, s.TaskCreate(
                name=title,
                assignees=[user_id(name)] + ([user_id(manager)] if manager else []),
                tags=["monthly"],
                priority=3,
                time_estimate_seconds=9900,
                start_date=due - timedelta(hours=1),
                due_date=due.replace(hour=17),
                recurrence=s.Recurrence(frequency="monthly", interval=1, trigger="on_schedule", action="new_task", tz="Asia/Kolkata"),
            ))
            opened_task = Opened(task, access, PermissionLevel.full)
            months = {o["name"]: o["id"] for o in month_field.config.get("options", [])}
            titles = {o["name"]: o["id"] for o in designation_field.config.get("options", [])}
            customfields.set_value(db, opened_task, month_field.id, months[MONTHS[i % 2]])
            if designation in titles:
                customfields.set_value(db, opened_task, designation_field.id, titles[designation])
            if manager:
                customfields.set_value(db, opened_task, manager_field.id, [user_id(manager)])
            created += 1
        db.commit()
        print(f"Workspace “{workspace.name}”: {len(PEOPLE)} people ({made} new), {len(TEAMS)} teams, "
              f"{len(LISTS)} Lists, {created} monthly review tasks.")
        print("Sign in as", args.owner, "to see it.")


if __name__ == "__main__":
    main()
