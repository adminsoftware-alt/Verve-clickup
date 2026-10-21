"""The Company Dashboard asks the database the same number of questions for 5 people as for 20.

On Supabase every round trip costs tens of milliseconds, so a board that asked a few questions
per person, per task or per card took 24 seconds to open. This counts the statements a full load
sends -- every card's data and the Highlights -- and holds it flat as the firm grows.
"""

import collections
import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from app.db import session as db_session
from tests.v2.conftest import ok

HOUR = 3600


class Counter:
    def __init__(self):
        self.statements = []

    def __enter__(self):
        event.listen(db_session.get_engine(), "before_cursor_execute", self._hit)
        return self

    def __exit__(self, *exc):
        event.remove(db_session.get_engine(), "before_cursor_execute", self._hit)

    def _hit(self, conn, cursor, statement, params, context, executemany):
        self.statements.append(statement)

    @property
    def count(self):
        return len(self.statements)

    def top(self, n=12):
        shape = collections.Counter(re.sub(r"\s+", " ", s)[:160] for s in self.statements)
        return shape.most_common(n)


def add_people(api, ws, spaces, team_ids, start, stop):
    late = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    soon = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    for i in range(start, stop):
        uid = f"p{i}"
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
        team = list(team_ids)[i % len(team_ids)]
        team_ids[team].append(uid)
        ids = team_ids[team]
        ok(api.put(f"/teams/{team}/members", "owner", {"user_ids": ids, "lead_ids": [ids[0]]}))
        # A List of their own in one of a few Spaces, so Lists grow with people as they do in a firm.
        folder = ok(api.post(f"/spaces/{spaces[i % len(spaces)]}/folders", "owner", {"name": f"{uid}'s clients"}), 201)["id"]
        lst = ok(api.post(f"/folders/{folder}/lists", "owner", {"name": "Returns"}), 201)["id"]
        for n, due in enumerate((late, soon, None)):
            body = {"name": f"{uid} job {n}", "assignees": [uid], "time_estimate_seconds": 2 * HOUR}
            if due:
                body["due_date"] = due
            task = ok(api.post(f"/lists/{lst}/tasks", "owner", body), 201)
            start_at = yesterday.replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(hours=n)
            ok(api.post(f"/tasks/{task['id']}/time", "owner", {
                "user_id": uid, "started_at": start_at.isoformat(), "ended_at": (start_at + timedelta(minutes=45)).isoformat()}), 201)


def load_company(api, ws):
    boards = ok(api.get(f"/workspaces/{ws}/dashboards", "owner"))
    company = next(b for b in boards if b["standard"] == "company")
    counters = {}
    for name, path in (("board", ""), ("data", "/data"), ("insights", "/insights")):
        with Counter() as c:
            ok(api.get(f"/dashboards/{company['id']}{path}", "owner", params={"tz": "Asia/Kolkata"}))
        counters[name] = c
    return counters


def test_company_dashboard_queries_do_not_grow_with_people(api, workspace):
    ws = workspace["id"]
    spaces = [ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": name}), 201)["id"] for name in ("Audit", "Tax", "Ops")]
    teams = {ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": f"T{t}"}), 201)["id"]: [] for t in range(4)}

    add_people(api, ws, spaces, teams, 0, 5)
    small = load_company(api, ws)
    add_people(api, ws, spaces, teams, 5, 20)
    large = load_company(api, ws)
    if os.getenv("SHOW_QUERIES"):
        for name in large:
            print(f"\n{name}: 5 people {small[name].count} statements; 20 people {large[name].count}")
            for shape, n in large[name].top(int(os.getenv("SHOW_QUERIES"))):
                print(f"{n:5}  {shape}")
    for name in large:
        assert large[name].count == small[name].count, (name, small[name].count, large[name].count, large[name].top())
