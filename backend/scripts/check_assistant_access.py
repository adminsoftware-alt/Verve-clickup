"""Run every assistant tool as every person in the workspace and look for anything they shouldn't see.

No AI involved: this checks what the tools would hand the model, which is the only way data reaches
an answer. For each active person it checks that

  * people / workload only name people that person may see (people.visible_people),
  * time_logged only reports hours of people whose time they may see (time_visible_people),
  * tasks only returns tasks they could open themselves (best_task_level),
  * asking about someone outside their view is refused, not answered.

    venv\\Scripts\\python.exe scripts\\check_assistant_access.py
"""

import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db.models import Task, User, WorkspaceMember  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.services.work import ai_assistant as ai  # noqa: E402
from app.services.work import people  # noqa: E402
from app.services.work.access import Access, best_task_level  # noqa: E402
from app.services.work.permissions import can_manage_workspace  # noqa: E402
from app.services.work.timetracking import time_visible_people  # noqa: E402


def run(db, access, tool, **args):
    return json.loads(ai.run_tool(db, access, tool, json.dumps(args)))


def main() -> int:
    db = next(get_db())
    members = list(db.execute(select(WorkspaceMember, User).join(User, User.id == WorkspaceMember.user_id)
                              .where(WorkspaceMember.deactivated_at.is_(None))))
    name_of = {u.id: (u.display_name or u.email) for _, u in members}
    # Display names shared by two people can't be told apart in a tool's output; skip those.
    dupes = {n for n, c in Counter(name_of.values()).items() if c > 1}
    problems, checked, roles = [], 0, Counter()
    for m, u in members:
        try:
            access = Access.for_workspace(db, u.id, m.workspace_id)
        except Exception:
            continue  # access switched off or not yet signed in
        admin = can_manage_workspace(access.role)
        seen = people.visible_people(db, access)
        seen_names = None if seen is None else {name_of.get(i) for i in seen}
        time_ok = time_visible_people(db, access)
        time_names = None if time_ok is None else {name_of.get(i) for i in time_ok}
        label = ai._access_label(db, access, people.get_person(db, access, u.id))
        roles[label] += 1
        who = f"{name_of[u.id]} ({label})"

        def leak(what, names, allowed):
            for n in names:
                if allowed is not None and n not in allowed and n not in dupes:
                    problems.append(f"{who}: {what} named {n}")

        out = run(db, access, "people", include_access_off=True)
        leak("people", [p["name"] for p in out["people"]], seen_names)
        out = run(db, access, "workload")
        leak("workload", [r["name"] for r in out["busiest_first"]] + out["with_no_open_tasks"], seen_names)
        out = run(db, access, "time_logged", date_from="2000-01-01", date_to="2100-01-01")
        leak("time_logged", list(out["by_person"]), time_names)
        if not admin and out.get("scope") == "the whole firm":
            problems.append(f"{who}: time_logged claims the whole firm")

        out = run(db, access, "tasks", state="all")
        for r in out["tasks"]:
            task = db.get(Task, r["ref"])
            if task is not None and best_task_level(db, access, task) is None:
                problems.append(f"{who}: tasks returned {r['name']!r}, which they can't open")

        # Someone they can't see: refused, by name and for their hours.
        if seen is not None:
            hidden = next((i for i in name_of if i not in seen and name_of[i] not in dupes), None)
            if hidden:
                for tool, args in (("tasks", {"person": name_of[hidden]}),
                                   ("time_logged", {"person": name_of[hidden], "date_from": "2000-01-01", "date_to": "2100-01-01"})):
                    out = run(db, access, tool, **args)
                    if "error" not in out:
                        problems.append(f"{who}: {tool} about hidden {name_of[hidden]} was answered")
        if time_ok is not None:
            visible_not_time = next((i for i in (seen or set()) if i in name_of and i not in time_ok and name_of[i] not in dupes), None)
            if visible_not_time:
                out = run(db, access, "time_logged", person=name_of[visible_not_time], date_from="2000-01-01", date_to="2100-01-01")
                if "error" not in out:
                    problems.append(f"{who}: hours of {name_of[visible_not_time]} (not theirs to see) were answered")
        checked += 1
        db.rollback()

    print(f"Checked {checked} people: " + ", ".join(f"{n} {r}" for r, n in roles.items()))
    if problems:
        print(f"{len(problems)} PROBLEMS:")
        for p in problems[:100]:
            print("  -", p)
        return 1
    print("No leaks: every tool stayed inside each person's access.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
