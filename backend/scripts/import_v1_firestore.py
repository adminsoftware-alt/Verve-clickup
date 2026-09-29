"""Bring tasks, hours and leave from the old Firestore app into the new workspace.

    venv/Scripts/python.exe scripts/import_v1_firestore.py --workspace "Verve Advisory"          # dry run: counts only
    venv/Scripts/python.exe scripts/import_v1_firestore.py --workspace "Verve Advisory" --apply  # really import

Reads the Firestore collections tasks, timeEntries and leaveRequests (read-only; nothing in Firestore changes)
and writes through the service layer as the workspace owner. Safe to run again: records already brought
over are skipped. People are matched by their sign-in id or email; anyone not in the workspace is reported.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.models import Workspace, WorkspaceMember, WorkspaceRole  # noqa: E402
from app.db.session import get_engine  # noqa: E402
from app.services.work import leave, v1_import  # noqa: E402
from app.services.work.access import Access  # noqa: E402


def read_collection(client, name):
    return [{**doc.to_dict(), "id": doc.id} for doc in client.collection(name).stream()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--workspace", default="Verve Advisory")
    parser.add_argument("--apply", action="store_true", help="write the import (otherwise only count)")
    parser.add_argument("--timezone", default="Asia/Kolkata")
    args = parser.parse_args()

    from app.core import firebase

    firebase.init_firebase()
    client = firebase.db
    tasks = read_collection(client, "tasks")
    entries = read_collection(client, "timeEntries")
    leaves = read_collection(client, "leaveRequests")
    print(f"Firestore: {len(tasks)} tasks, {len(entries)} time entries, {len(leaves)} leave requests")

    with Session(get_engine(), expire_on_commit=False) as db:
        workspace = db.scalars(select(Workspace).where(func.lower(Workspace.name) == args.workspace.lower())).first()
        if workspace is None:
            sys.exit(f"No workspace called {args.workspace!r}")
        owner = db.scalars(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace.id,
                                                         WorkspaceMember.role == WorkspaceRole.owner)).first()
        access = Access(db, owner.user_id, workspace.id, WorkspaceRole.owner)
        work = v1_import.import_work(db, access, tasks, entries, args.timezone)
        time_off = leave.import_v1(db, access, leaves)
        print("Tasks and hours:", work)
        print("Leave:", time_off)
        if args.apply:
            db.commit()
            print("Imported.")
        else:
            db.rollback()
            print("Dry run: nothing was written. Run again with --apply to import.")


if __name__ == "__main__":
    main()
