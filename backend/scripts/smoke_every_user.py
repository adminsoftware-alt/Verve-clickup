"""Walk through the app's API as every user, against the running dev server.

See docs/assistant-spec-and-test-plan.md, Part 2, Layer B.

    backend\\venv\\Scripts\\python.exe backend\\scripts\\smoke_every_user.py
    ... --role member        only one role in the life-cycle and cross-role parts
    ... --skip-everyone      skip the read-only pass over every user
    ... --keep               leave the scratch Space behind to look at

Needs DEV_LOGIN=true on the server: each request signs in as `dev:<user id>`. Everything it
writes goes into a scratch Space it creates as the owner and deletes at the end, so other
people's work is never touched. Time logged and comments made go with the tasks.

Exit code 0 when every check passes, 1 otherwise.
"""

from __future__ import annotations

import argparse
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence

import httpx

TZ = "Asia/Kolkata"


# --- plumbing -----------------------------------------------------------------------------


@dataclass
class Result:
    who: str
    check: str
    ok: bool
    detail: str = ""


@dataclass
class Run:
    base: str
    results: List[Result] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.http = httpx.Client(base_url=self.base, timeout=60)

    def call(self, method: str, path: str, as_user: str, json: Any = None, params: Optional[Dict[str, str]] = None) -> httpx.Response:
        return self.http.request(method, path, json=json, params=params, headers={"Authorization": f"Bearer dev:{as_user}"})

    def expect(self, who: str, check: str, resp: httpx.Response, *codes: int) -> Optional[Any]:
        """Records a check. A 5xx is always a failure, whatever was expected."""
        good = resp.status_code in codes and resp.status_code < 500
        detail = "" if good else f"{resp.request.method} {resp.request.url.path} -> {resp.status_code} {resp.text[:200]}"
        self.results.append(Result(who, check, good, detail))
        # Only a success has a body worth handing back; a refusal that was expected is not data.
        if good and resp.status_code < 300 and resp.content and resp.headers.get("content-type", "").startswith("application/json"):
            return resp.json()
        return None

    def note(self, who: str, check: str, ok: bool, detail: str = "") -> None:
        self.results.append(Result(who, check, ok, detail))


def day(offset: int) -> str:
    d = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0) + timedelta(days=offset)
    return d.isoformat()


# --- who is who ----------------------------------------------------------------------------


@dataclass
class Person:
    id: str
    name: str
    role: str  # owner | admin | member | guest
    leads: List[str]

    @property
    def kind(self) -> str:
        if self.role in ("owner", "admin", "guest"):
            return self.role
        return "manager" if self.leads else "member"

    def __str__(self) -> str:
        return f"{self.name} ({self.kind})"


def people(run: Run) -> List[Person]:
    r = run.http.get("/dev/people")
    if r.status_code == 404:
        sys.exit("The server has DEV_LOGIN off; turn it on in backend/.env to sign in as other people.")
    r.raise_for_status()
    return [Person(p["id"], p["name"], p["role"], p.get("leads") or []) for p in r.json()]


# --- 1. every user, read only ----------------------------------------------------------------


def everyone_reads(run: Run, ws: str, all_people: Sequence[Person]) -> None:
    for p in all_people:
        who = str(p)
        run.expect(who, "who am I", run.call("GET", "/me", p.id), 200)
        run.expect(who, "sidebar", run.call("GET", f"/workspaces/{ws}/hierarchy", p.id), 200)
        run.expect(who, "My Tasks", run.call("GET", f"/workspaces/{ws}/my-tasks", p.id), 200)
        run.expect(who, "Dashboards hub", run.call("GET", f"/workspaces/{ws}/dashboards", p.id), 200)
        run.expect(who, "inbox counts", run.call("GET", f"/workspaces/{ws}/inbox/counts", p.id), 200)
        monday = datetime.now().date() - timedelta(days=datetime.now().weekday())
        run.expect(who, "own timesheet", run.call("GET", f"/workspaces/{ws}/timesheet", p.id, params={"start": monday.isoformat()}), 200)
        if p.kind == "guest":
            run.expect(who, "home dashboard (guests have none)", run.call("GET", f"/workspaces/{ws}/dashboards/home", p.id), 403)
            continue
        home = run.expect(who, "home dashboard", run.call("GET", f"/workspaces/{ws}/dashboards/home", p.id), 200)
        if home:
            run.expect(who, "home dashboard cards compute", run.call("GET", f"/dashboards/{home['id']}/data", p.id, params={"tz": TZ}), 200)


# --- 2. the life of a task, one person per role ----------------------------------------------


def statuses(run: Run, list_id: str, as_user: str) -> Dict[str, Dict[str, Any]]:
    body = run.call("GET", f"/lists/{list_id}/statuses", as_user).json()
    out: Dict[str, Dict[str, Any]] = {}
    for st in body["statuses"]:
        out.setdefault(st["group"], st)
    return out


def task_life(run: Run, p: Person, list_a: str, list_b: str) -> None:
    who = str(p)
    task = run.expect(who, "create a task", run.call("POST", f"/lists/{list_a}/tasks", p.id, {
        "name": f"Smoke task by {p.name}", "assignees": [p.id], "priority": 3,
        "start_date": day(0), "due_date": day(2), "time_estimate_seconds": 3600,
    }), 201)
    if not task:
        return
    tid = task["id"]
    run.expect(who, "open the task", run.call("GET", f"/tasks/{tid}", p.id), 200)
    got = run.expect(who, "update name, priority, dates, estimate", run.call("PATCH", f"/tasks/{tid}", p.id, {
        "name": f"Smoke task by {p.name} (edited)", "priority": 2, "due_date": day(3), "time_estimate_seconds": 5400,
    }), 200)
    if got:
        run.note(who, "update is saved", got["name"].endswith("(edited)") and got["priority"] == 2,
                 f"name={got['name']!r} priority={got['priority']}")

    # Through the workflow: to do -> in progress -> done.
    st = statuses(run, list_a, p.id)
    for group in ("active", "done", "closed"):
        if group in st:
            run.expect(who, f"status -> {st[group]['name']}", run.call("PATCH", f"/tasks/{tid}", p.id, {"status_id": st[group]["id"]}), 200)
    if "not_started" in st:
        run.expect(who, "reopen", run.call("PATCH", f"/tasks/{tid}", p.id, {"status_id": st["not_started"]["id"]}), 200)

    run.expect(who, "comment", run.call("POST", f"/tasks/{tid}/comments", p.id, {"body": "Smoke test comment"}), 201)
    run.expect(who, "log time", run.call("POST", f"/tasks/{tid}/time", p.id, {"duration_seconds": 900, "description": "smoke"}), 201)
    sub = run.expect(who, "add a subtask", run.call("POST", f"/lists/{list_a}/tasks", p.id, {
        "name": "Smoke subtask", "parent_id": tid, "assignees": [p.id]}), 201)
    run.expect(who, "move to another List", run.call("POST", f"/tasks/{tid}/move", p.id, {"list_id": list_b}), 200)
    moved = run.call("GET", f"/tasks/{tid}", p.id).json()
    run.note(who, "move is saved", moved.get("list_id") == list_b, f"list_id={moved.get('list_id')}")
    run.expect(who, "delete the task", run.call("DELETE", f"/tasks/{tid}", p.id), 204, 200)
    run.expect(who, "deleted task is gone", run.call("GET", f"/tasks/{tid}", p.id), 404)
    if sub:
        run.expect(who, "its subtask went with it", run.call("GET", f"/tasks/{sub['id']}", p.id), 404)


# --- 3. what each role may and may not do ------------------------------------------------------


def cross_role(run: Run, ws: str, space: str, list_a: str, owner: Person, by_kind: Dict[str, List[Person]]) -> None:
    members = by_kind.get("member", [])
    managers = by_kind.get("manager", [])
    admins = by_kind.get("admin", [])

    # Lists: managers and admins may make them, members may not.
    for p, code in ([(m, 403) for m in members[:1]] + [(m, 201) for m in managers[:1]] + [(a, 201) for a in admins[:1]]):
        made = run.expect(str(p), f"create a List ({'allowed' if code == 201 else 'refused'})",
                          run.call("POST", f"/spaces/{space}/lists", p.id, {"name": f"Smoke list by {p.name}"}), code)
        if made and code == 201:
            # Deleting a List is for admins only.
            want = 204 if p.kind in ("owner", "admin") else 403
            run.expect(str(p), f"delete a List ({'allowed' if want == 204 else 'refused'})",
                       run.call("DELETE", f"/lists/{made['id']}", p.id), want)

    # Somebody else's task: an assignee may move it along, a colleague may only comment.
    if len(members) >= 2:
        doer, other = members[0], members[1]
        task = run.expect(str(owner), "create a task for a member", run.call("POST", f"/lists/{list_a}/tasks", owner.id, {
            "name": "Smoke: someone else's task", "assignees": [doer.id], "start_date": day(0), "due_date": day(1)}), 201)
        if task:
            tid = task["id"]
            st = statuses(run, list_a, owner.id)
            if "active" in st:
                run.expect(str(doer), "assignee changes status", run.call("PATCH", f"/tasks/{tid}", doer.id, {"status_id": st["active"]["id"]}), 200)
            run.expect(str(other), "colleague renames it (refused)", run.call("PATCH", f"/tasks/{tid}", other.id, {"name": "hijacked"}), 403)
            run.expect(str(other), "colleague deletes it (refused)", run.call("DELETE", f"/tasks/{tid}", other.id), 403)
            run.expect(str(other), "colleague may still comment", run.call("POST", f"/tasks/{tid}/comments", other.id, {"body": "smoke"}), 201)
            run.expect(str(owner), "owner deletes it", run.call("DELETE", f"/tasks/{tid}", owner.id), 204, 200)

    # Admin pages.
    for p in members[:1]:
        run.expect(str(p), "audit log (refused)", run.call("GET", f"/workspaces/{ws}/audit", p.id), 403)
    for p in admins[:1]:
        run.expect(str(p), "audit log", run.call("GET", f"/workspaces/{ws}/audit", p.id), 200)

    # Personal dashboards: an admin opens anyone's and sees *that person's* work; a member
    # cannot open a colleague's; nobody but an admin deletes a card.
    if members:
        m = members[0]
        theirs = run.call("GET", f"/workspaces/{ws}/dashboards/home", m.id).json()
        open_card = next((c["id"] for c in theirs.get("cards", []) if c["title"] == "Open tasks"), None)

        def open_count(viewer: str) -> Any:
            rows = run.call("GET", f"/dashboards/{theirs['id']}/data", viewer, params={"tz": TZ}).json()
            return next((r["data"].get("value") for r in rows if r["card_id"] == open_card), None)

        for a in admins[:1]:
            run.expect(str(a), f"open {m.name}'s dashboard", run.call("GET", f"/dashboards/{theirs['id']}", a.id), 200)
            run.expect(str(a), f"{m.name}'s dashboard computes", run.call("GET", f"/dashboards/{theirs['id']}/data", a.id, params={"tz": TZ}), 200)
            if open_card:
                mine, seen = open_count(m.id), open_count(a.id)
                run.note(str(a), f"sees {m.name}'s own work on it, not their own", mine == seen,
                         f"{m.name} sees {mine} open tasks, admin sees {seen}")
        if len(members) >= 2:
            run.expect(str(members[1]), f"open {m.name}'s dashboard (refused)",
                       run.call("GET", f"/dashboards/{theirs['id']}", members[1].id), 403, 404)
        if theirs.get("cards"):
            card = theirs["cards"][0]["id"]
            run.expect(str(m), "delete a card on own dashboard (refused)",
                       run.call("DELETE", f"/dashboards/{theirs['id']}/cards/{card}", m.id), 403)
    for a in admins[:1]:
        dash = run.expect(str(a), "create a dashboard", run.call("POST", f"/workspaces/{ws}/dashboards", a.id,
                                                                  {"name": "Smoke dashboard", "template": "simple"}), 201)
        if dash and dash.get("cards"):
            run.expect(str(a), "delete a card", run.call("DELETE", f"/dashboards/{dash['id']}/cards/{dash['cards'][0]['id']}", a.id), 204)
        if dash:
            run.expect(str(a), "delete the dashboard", run.call("DELETE", f"/dashboards/{dash['id']}", a.id), 204)


# --- main -----------------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://127.0.0.1:8000/api/v2")
    ap.add_argument("--role", choices=["owner", "admin", "manager", "member", "guest"])
    ap.add_argument("--skip-everyone", action="store_true")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args()

    run = Run(args.base)
    everybody = people(run)
    owner = next((p for p in everybody if p.role == "owner"), None)
    if owner is None:
        sys.exit("No owner in the workspace.")
    workspaces = run.call("GET", "/workspaces", owner.id).json()
    ws = workspaces[0]["id"]
    by_kind: Dict[str, List[Person]] = {}
    for p in everybody:
        by_kind.setdefault(p.kind, []).append(p)
    print(f"Workspace {workspaces[0]['name']}: " + ", ".join(f"{len(v)} {k}" for k, v in sorted(by_kind.items())))

    started = time.time()
    if not args.skip_everyone:
        print(f"1/3 Reading as all {len(everybody)} people ...")
        everyone_reads(run, ws, everybody)

    stamp = datetime.now().strftime("%d %b %H:%M")
    space = run.expect(str(owner), "create the scratch Space",
                       run.call("POST", f"/workspaces/{ws}/spaces", owner.id, {"name": f"zz Smoke test {stamp}"}), 201)
    if not space:
        report(run, started)
        return 1
    try:
        list_a = run.call("POST", f"/spaces/{space['id']}/lists", owner.id, {"name": "Smoke A"}).json()["id"]
        list_b = run.call("POST", f"/spaces/{space['id']}/lists", owner.id, {"name": "Smoke B"}).json()["id"]

        kinds = [args.role] if args.role else ["owner", "admin", "manager", "member"]
        print(f"2/3 Task life cycle as one {', one '.join(kinds)} ...")
        for kind in kinds:
            for p in by_kind.get(kind, [])[:1]:
                task_life(run, p, list_a, list_b)
            if not by_kind.get(kind):
                run.note(kind, "life cycle", False, f"nobody in the workspace has the role {kind}")

        print("3/3 What each role may and may not do ...")
        cross_role(run, ws, space["id"], list_a, owner, by_kind)
    finally:
        if args.keep:
            print(f"Kept the scratch Space: {space['name']}")
        else:
            run.expect(str(owner), "delete the scratch Space", run.call("DELETE", f"/spaces/{space['id']}", owner.id), 204, 200)

    return report(run, started)


def report(run: Run, started: float) -> int:
    failed = [r for r in run.results if not r.ok]
    people_seen = len({r.who for r in run.results})
    print()
    print(f"{len(run.results)} checks across {people_seen} people in {time.time() - started:.0f}s: "
          f"{len(run.results) - len(failed)} passed, {len(failed)} failed")
    if failed:
        print()
        width = max(len(r.who) for r in failed)
        for r in failed:
            print(f"  FAIL  {r.who:<{width}}  {r.check}")
            if r.detail:
                print(f"        {'':<{width}}  {r.detail}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
