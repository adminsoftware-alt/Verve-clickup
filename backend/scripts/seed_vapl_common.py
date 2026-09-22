"""Create Verve's common operational structure in a v2 workspace.

    venv/Scripts/python.exe scripts/seed_vapl_common.py --workspace "Verve Advisory"

Builds the "VAPL Common Operation Tasks" Space: one Folder per common activity, one List
per team inside each (e.g. "Learning - HR"), and the org's Teams. Goes through the
service layer so statuses, views and permissions are set up exactly as in the app.
Safe to run again: anything that already exists is left alone.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select  # noqa: E402

from app.db.models import Folder, Space, TaskList, Team, Workspace, WorkspaceMember, WorkspaceRole  # noqa: E402
from app.db.session import get_engine  # noqa: E402
from app.schemas import work as s  # noqa: E402
from app.services.work import hierarchy, teams  # noqa: E402
from app.services.work.access import Access  # noqa: E402

SPACE_NAME = "VAPL Common Operation Tasks"

TEAMS = ["HR", "Infrabeat", "Accounts", "Dev", "Unimed", "Atish", "Krutanjali"]

# Folder name -> guidance from "SOP - VAPL Common Operational Tasks", shown on each List.
FOLDERS = {
    "Attending Special Events": (
        "Birthdays, festivals, farewells, foundation day and other events. Monthly recurring. "
        "One task per employee, created by the ClickUp team and tracked by the employee. "
        "Default estimate 3h. Closed on the last day of the month or the 1st of the next."
    ),
    "Learning": (
        "Continuous skill development. Monthly recurring. One task per employee, e.g. "
        "'Learning – Debarima Paul'. Estimate 20h (more during onboarding). "
        "Closed on the last day of the month or the 1st of the next."
    ),
    "Monthly Review": (
        "Assign the employee, their reporting manager and the concerned HR; all track time. "
        "Monthly recurring. Estimate 2h 45m: 45m for the PMS form, 1h reviewee, 1h reviewer. "
        "Closed once the review is done."
    ),
    "Interview & Assessments": (
        "Time spent conducting interviews. Only for employees who interview. Monthly recurring. "
        "Default estimate 3h, varying with the number of interviews."
    ),
    "Quarterly Revisit of Yearly KRA": None,
}


def find_by_name(db, model, name, **where):
    query = select(model).where(func.lower(model.name) == name.lower())
    for column, value in where.items():
        query = query.where(getattr(model, column) == value)
    return db.scalars(query).first()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", default="Verve Advisory")
    args = parser.parse_args()

    from sqlalchemy.orm import Session

    with Session(get_engine(), expire_on_commit=False) as db:
        workspace = find_by_name(db, Workspace, args.workspace)
        if workspace is None:
            sys.exit(f"No workspace called {args.workspace!r}. Create it in the app first.")
        owner = db.scalars(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace.id, WorkspaceMember.role == WorkspaceRole.owner
            )
        ).first()
        assert owner is not None, "every workspace has an owner"
        access = Access(db, owner.user_id, workspace.id, WorkspaceRole.owner)
        created = []

        for name in TEAMS:
            if find_by_name(db, Team, name, workspace_id=workspace.id) is None:
                teams.create_team(db, access, s.TeamCreate(name=name))
                created.append(f"Team {name}")

        space = find_by_name(db, Space, SPACE_NAME, workspace_id=workspace.id)
        if space is None:
            space = hierarchy.create_space(db, access, s.SpaceCreate(name=SPACE_NAME))
            created.append(f"Space {SPACE_NAME}")

        for folder_name, guidance in FOLDERS.items():
            folder = find_by_name(db, Folder, folder_name, space_id=space.id, parent_folder_id=None)
            if folder is None:
                folder = hierarchy.create_folder(db, access, space, s.FolderCreate(name=folder_name))
                created.append(f"Folder {folder_name}")
                # A new Folder starts with a List called "List"; use it for the first team.
                starter = find_by_name(db, TaskList, "List", folder_id=folder.id)
                if starter is not None:
                    starter.name = f"{folder_name} - {TEAMS[0]}"
                    starter.description = guidance
                    created.append(f"List {starter.name}")
            for team_name in TEAMS:
                list_name = f"{folder_name} - {team_name}"
                if find_by_name(db, TaskList, list_name, folder_id=folder.id) is None:
                    hierarchy.create_list(
                        db, access, space, s.ListCreate(name=list_name, description=guidance), folder=folder
                    )
                    created.append(f"List {list_name}")

        db.commit()
        print(f"Workspace {workspace.name!r}: created {len(created)} item(s).")
        for item in created:
            print(f"  + {item}")


if __name__ == "__main__":
    main()
