"""The assistant's AI fallback: a question the phrase rules don't understand goes to a language model.

The model never sees the database. It is given a handful of read-only tools, each one a call into
the same service functions the screens use, made with the asker's own Access -- so an Employee's
assistant knows what that Employee could open, a Manager's knows their team, and an admin's the
firm. Nothing here changes data: making, editing and logging stay with the phrase rules, which
show a card to confirm first.

Any OpenAI-compatible chat API works (OpenRouter, OpenAI, Anthropic's compatible endpoint); which
one is AI_BASE_URL / AI_MODEL / AI_API_KEY in .env.
"""

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import Task, Team, TeamMember, TimeEntry, User
from app.services.work import goals, mywork, people, teams, viewdata
from app.services.work.access import Access
from app.services.work.errors import Invalid
from app.services.work.permissions import can_manage_workspace
from app.services.work.timetracking import time_visible_people

# Rounds of tool calls before the model must answer. A question needs one or two.
MAX_ROUNDS = 5
# Rows a tool hands back. Enough to count and name; more only costs tokens.
MAX_ROWS = 60
TIMEOUT = httpx.Timeout(60.0, connect=10.0)

log = logging.getLogger(__name__)


def configured() -> bool:
    return bool(settings.AI_API_KEY and settings.AI_BASE_URL and settings.AI_MODEL)


# --- what the tools return -----------------------------------------------------------------------


def _name(u: User) -> str:
    return u.display_name or u.email


def _lead_ids(db: Session, access: Access) -> set:
    """Everyone who leads a Team here, in one query: asked person by person, a firm of 75 was 75
    round trips to the database before the model saw a single row."""
    return set(db.scalars(
        select(TeamMember.user_id).join(Team, Team.id == TeamMember.team_id)
        .where(Team.workspace_id == access.workspace_id, TeamMember.is_lead.is_(True))
    ))


def _access_label(p, leads: set) -> str:
    if can_manage_workspace(p.role):
        return "Admin"
    return "Manager" if p.user.id in leads else "Employee"


def _day(d: Optional[datetime]) -> Optional[str]:
    return d.date().isoformat() if d else None


def _task_row(t) -> Dict[str, Any]:
    return {
        "name": t.name, "id": t.custom_id or str(t.id), "ref": str(t.id), "status": t.status.name,
        "assignees": [a.display_name or a.email for a in t.assignees],
        "due": _day(t.due_date), "start": _day(t.start_date), "overdue": t.is_overdue,
        "priority": t.priority, "done": t.date_done is not None or t.date_closed is not None,
        "estimate_hours": round(t.time_estimate_seconds / 3600, 2) if t.time_estimate_seconds else None,
        "tracked_hours": round(t.time_tracked_seconds / 3600, 2),
    }


def _match_person(db: Session, access: Access, said: Optional[str]):
    """The visible person whose name or email best fits what was said; "me" is the asker."""
    if not said:
        return None
    everyone = people.list_people(db, access)
    words = said.strip().lower()
    if words in ("me", "i", "myself", "mine"):
        return next((p for p in everyone if p.user.id == access.user_id), None)
    exact = [p for p in everyone if (p.user.display_name or "").lower() == words or p.user.email.lower() == words]
    if exact:
        return exact[0]
    partial = [p for p in everyone if words in f"{p.user.display_name or ''} {p.user.email}".lower()]
    if len(partial) == 1:
        return partial[0]
    if partial:
        raise Invalid("Several people match '%s': %s" % (said, ", ".join(_name(p.user) for p in partial[:8])))
    raise Invalid(f"Nobody you can see is called '{said}'")


def _scope(access: Access) -> str:
    """Said with every count, so a number from a partial view isn't passed off as the firm's."""
    if can_manage_workspace(access.role):
        return "the whole firm"
    return "only the asker's own teams (they can't see the rest of the firm)"


def tool_who_am_i(db: Session, access: Access) -> Dict[str, Any]:
    me = people.get_person(db, access, access.user_id)
    names = {t.id: t.name for t in teams.list_teams(db, access)}
    boss = db.get(User, me.manager_id) if me.manager_id else None
    return {
        "name": _name(me.user), "email": me.user.email, "access": _access_label(me, _lead_ids(db, access)),
        "designation": me.designation, "department": me.department,
        "teams": [names[t] for t in me.team_ids if t in names], "reports_to": _name(boss) if boss else None,
        "today": date.today().isoformat(),
    }


def tool_people(db: Session, access: Access, search: Optional[str] = None, team: Optional[str] = None,
                include_access_off: bool = False) -> Dict[str, Any]:
    everyone = people.list_people(db, access)
    team_names = {t.id: t.name for t in teams.list_teams(db, access)}
    rows = everyone if include_access_off else [p for p in everyone if not p.deactivated_at]
    if team:
        rows = [p for p in rows if any(team.lower() in team_names.get(t, "").lower() for t in p.team_ids)]
    if search:
        q = search.lower()
        rows = [p for p in rows if q in " ".join(filter(None, [
            p.user.display_name, p.user.email, p.designation, p.department, p.location, p.employee_code])).lower()]
    by_id = {p.user.id: p for p in everyone}
    leads = _lead_ids(db, access)
    return {
        "scope": _scope(access),
        "count": len(rows),
        "access_turned_off": sum(1 for p in everyone if p.deactivated_at),
        "not_signed_in_yet": sum(1 for p in rows if p.pending),
        "people": [{
            "name": _name(p.user), "email": p.user.email, "designation": p.designation, "department": p.department,
            "access": _access_label(p, leads), "teams": [team_names[t] for t in p.team_ids if t in team_names],
            "reports_to": _name(by_id[p.manager_id].user) if p.manager_id in by_id else None,
            "direct_reports": p.direct_reports, "location": p.location,
            "date_of_joining": p.date_of_joining.isoformat() if p.date_of_joining else None,
            "access_off": bool(p.deactivated_at),
        } for p in rows[:MAX_ROWS]],
        "truncated": len(rows) > MAX_ROWS,
    }


def tool_teams(db: Session, access: Access) -> Dict[str, Any]:
    out = teams.list_teams(db, access)
    names = {u.id: _name(u) for t in out for u in t.members}
    parents = {t.id: t.name for t in out}
    return {"count": len(out), "teams": [{
        "name": t.name, "members": len(t.all_member_ids or t.members),
        "leads": [names.get(i, i) for i in t.lead_ids], "part_of": parents.get(t.parent_team_id),
        "description": t.description,
    } for t in out]}


def tool_tasks(db: Session, access: Access, person: Optional[str] = None, state: str = "open",
               search: Optional[str] = None, due_from: Optional[str] = None, due_to: Optional[str] = None) -> Dict[str, Any]:
    include_closed = state in ("done", "all")
    who = _match_person(db, access, person)
    if who:
        found = mywork.tasks_assigned_to(db, access, [who.user.id], include_closed)
    else:
        found = viewdata.all_tasks(db, access, include_closed, limit=5000).tasks
    if state == "overdue":
        found = [t for t in found if t.is_overdue]
    elif state == "done":
        found = [t for t in found if t.date_done or t.date_closed]
    if search:
        q = search.lower()
        found = [t for t in found if q in f"{t.name} {t.description or ''} {t.custom_id or ''}".lower()]
    if due_from:
        found = [t for t in found if t.due_date and t.due_date.date().isoformat() >= due_from]
    if due_to:
        found = [t for t in found if t.due_date and t.due_date.date().isoformat() <= due_to]
    found = sorted(found, key=lambda t: (t.due_date is None, t.due_date or datetime.max.replace(tzinfo=timezone.utc)))
    return {"person": _name(who.user) if who else None, "state": state, "count": len(found),
            "tasks": [_task_row(t) for t in found[:MAX_ROWS]], "truncated": len(found) > MAX_ROWS}


def tool_workload(db: Session, access: Access, team: Optional[str] = None) -> Dict[str, Any]:
    """Open work per person, busiest first: what "who has too much on" is asking."""
    found = viewdata.all_tasks(db, access, False, limit=100000).tasks
    visible = {p.user.id: p for p in people.list_people(db, access) if not p.deactivated_at}
    if team:
        names = {t.id: t.name for t in teams.list_teams(db, access)}
        visible = {k: p for k, p in visible.items() if any(team.lower() in names.get(t, "").lower() for t in p.team_ids)}
    load: Dict[str, Dict[str, Any]] = {}
    for t in found:
        for a in t.assignees:
            if a.id not in visible:
                continue
            row = load.setdefault(a.id, {"name": _name(visible[a.id].user), "open_tasks": 0, "overdue": 0, "estimate_hours": 0.0})
            row["open_tasks"] += 1
            row["overdue"] += 1 if t.is_overdue else 0
            row["estimate_hours"] = round(row["estimate_hours"] + (t.time_estimate_seconds or 0) / 3600, 1)
    rows = sorted(load.values(), key=lambda r: (-r["open_tasks"], -r["overdue"]))
    idle = [_name(p.user) for k, p in visible.items() if k not in load]
    return {"scope": _scope(access), "people_with_work": len(rows), "busiest_first": rows[:MAX_ROWS],
            "with_no_open_tasks": idle[:MAX_ROWS]}


def tool_time_logged(db: Session, access: Access, date_from: str, date_to: str, person: Optional[str] = None) -> Dict[str, Any]:
    try:
        first, last = date.fromisoformat(date_from), date.fromisoformat(date_to)
    except ValueError:
        raise Invalid("Dates must be YYYY-MM-DD")
    allowed = time_visible_people(db, access)  # None: everyone's
    who = _match_person(db, access, person)
    if who and allowed is not None and who.user.id not in allowed:
        return {"error": f"You can't see {_name(who.user)}'s time."}
    start = datetime.combine(first, time.min, tzinfo=timezone.utc)
    end = datetime.combine(last + timedelta(days=1), time.min, tzinfo=timezone.utc)
    q = (select(TimeEntry, Task, User).join(Task, Task.id == TimeEntry.task_id).join(User, User.id == TimeEntry.user_id)
         .where(TimeEntry.started_at >= start, TimeEntry.started_at < end, TimeEntry.ended_at.is_not(None)))
    if who:
        q = q.where(TimeEntry.user_id == who.user.id)
    elif allowed is not None:
        q = q.where(TimeEntry.user_id.in_(allowed))
    # Task names only for tasks the asker could open themselves.
    visible = {t.id for t in viewdata.all_tasks(db, access, True, limit=100000).tasks}
    by_person: Dict[str, float] = {}
    by_task: Dict[str, float] = {}
    for entry, task, user in db.execute(q):
        hours = (entry.duration_seconds or 0) / 3600
        by_person[_name(user)] = by_person.get(_name(user), 0) + hours
        label = task.name if task.id in visible else "(a task you can't open)"
        by_task[label] = by_task.get(label, 0) + hours
    top = sorted(by_task.items(), key=lambda kv: -kv[1])[:20]
    return {"scope": "one person" if who else _scope(access), "from": date_from, "to": date_to, "total_hours": round(sum(by_person.values()), 2),
            "by_person": {k: round(v, 2) for k, v in sorted(by_person.items(), key=lambda kv: -kv[1])},
            "top_tasks": {k: round(v, 2) for k, v in top}}


def tool_goals(db: Session, access: Access) -> Dict[str, Any]:
    rows = goals.goal_summaries(db, access, [g.id for g in goals.list_goals(db, access)])
    return {"count": len(rows), "goals": [{
        "name": g.name, "progress_percent": round(g.progress),
        "on_track": g.on_track, "due": _day(g.due_date), "team": g.team.name if g.team else None,
        "owners": [o.display_name or o.email for o in g.owners],
    } for g in rows[:MAX_ROWS]]}


_STR = {"type": "string"}
TOOLS: Dict[str, Dict[str, Any]] = {
    "who_am_i": {
        "fn": tool_who_am_i,
        "description": "The person asking: name, access level (Admin/Manager/Employee), teams, manager, and today's date.",
        "params": {},
    },
    "people": {
        "fn": tool_people,
        "description": "People in the company the asker can see, with a count. Use for 'how many people', "
                       "'who is in HR', 'who reports to X', designations, departments.",
        "params": {"search": {**_STR, "description": "Words to match in name, email, designation, department, location"},
                   "team": {**_STR, "description": "Only people in a team whose name contains this"},
                   "include_access_off": {"type": "boolean", "description": "Also count people whose access was turned off"}},
    },
    "teams": {"fn": tool_teams, "description": "Teams, their leads and member counts.", "params": {}},
    "tasks": {
        "fn": tool_tasks,
        "description": "Tasks the asker can open, optionally for one person. state: open (default), overdue, done or all.",
        "params": {"person": {**_STR, "description": "Assignee name or email; 'me' for the asker"},
                   "state": {"type": "string", "enum": ["open", "overdue", "done", "all"]},
                   "search": {**_STR, "description": "Words in the task name or description"},
                   "due_from": {**_STR, "description": "YYYY-MM-DD"}, "due_to": {**_STR, "description": "YYYY-MM-DD"}},
    },
    "workload": {
        "fn": tool_workload,
        "description": "Open tasks, overdue tasks and estimated hours per person, busiest first, plus who has nothing open. "
                       "Use for 'who has the most work', 'kiska kaam zyada hai', 'who is free'.",
        "params": {"team": {**_STR, "description": "Only people in a team whose name contains this"}},
    },
    "time_logged": {
        "fn": tool_time_logged,
        "description": "Hours logged between two dates (inclusive), by person and by task. Without a person: everyone the asker may see.",
        "params": {"date_from": {**_STR, "description": "YYYY-MM-DD"}, "date_to": {**_STR, "description": "YYYY-MM-DD"},
                   "person": {**_STR, "description": "Name or email; 'me' for the asker"}},
        "required": ["date_from", "date_to"],
    },
    "goals": {"fn": tool_goals, "description": "Goals the asker can see, with progress and whether they are on track.", "params": {}},
}


def _tool_specs() -> List[Dict[str, Any]]:
    return [{"type": "function", "function": {
        "name": name, "description": t["description"],
        "parameters": {"type": "object", "properties": t["params"], "required": t.get("required", [])},
    }} for name, t in TOOLS.items()]


def run_tool(db: Session, access: Access, name: str, raw_args: str) -> str:
    tool = TOOLS.get(name)
    if tool is None:
        return json.dumps({"error": f"No tool called {name}"})
    try:
        args = json.loads(raw_args or "{}") or {}
        allowed = set(tool["params"])
        result = tool["fn"](db, access, **{k: v for k, v in args.items() if k in allowed and v not in (None, "")})
    except Invalid as e:
        result = {"error": e.message}
    except (TypeError, ValueError) as e:
        result = {"error": f"Bad arguments: {e}"}
    return json.dumps(result, default=str)


# --- the conversation ----------------------------------------------------------------------------

SYSTEM = (
    "You are the Verveflow Assistant inside Verveflow, the firm's task and time-tracking app. "
    "Answer questions about the firm's people, teams, tasks, time and goals using the tools; never guess numbers or names. "
    "The tools only return what the person asking is allowed to see; if something isn't there, say you can't see it. "
    "When a result's scope is not the whole firm, say so with the number (e.g. '24 people in your teams'). "
    "Reply in the language of the person's latest message: English gets English, Hindi or Hinglish gets the same "
    "(in Hindi always the polite aap form). Keep answers short: a sentence or two, then a short list if it helps. "
    "Write plain text only: no **bold**, no backticks, no headings, no tables; a list is lines starting with '- '. "
    "You cannot change anything; if asked to create, edit or log, say they can type it "
    "as a command, e.g. 'create a task to file GST due Friday' or 'log 2h on payroll'. Today is {today}."
)

# Said to the person when the AI service fails. What actually went wrong goes to the server log: a
# provider's own wording ("use this slug instead") means nothing to someone asking about their work.
DOWN = "I can't answer questions right now. Commands still work, like 'log 1h on payroll' or 'mark GST filing done'."


class AssistantError(Exception):
    pass


def _call_model(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    try:
        r = httpx.post(
            settings.AI_BASE_URL.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {settings.AI_API_KEY}", "X-Title": "Verveflow"},
            json={"model": settings.AI_MODEL, "messages": messages, "tools": _tool_specs(), "temperature": 0.2},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as e:
        log.warning("AI service unreachable: %r", e)
        raise AssistantError(DOWN)
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    if r.status_code == 429 or (body.get("error") or {}).get("code") == 429:
        raise AssistantError("The assistant is busy right now. Try again in a minute.")
    if r.status_code >= 400 or "error" in body:
        log.warning("AI service error %s (model %s): %s", r.status_code, settings.AI_MODEL,
                    (body.get("error") or {}).get("message") or r.text[:500])
        raise AssistantError(DOWN)
    return body["choices"][0]["message"]


def ask(db: Session, access: Access, history: List[Dict[str, str]], question: str,
        call: Optional[Callable[[List[Dict[str, Any]]], Dict[str, Any]]] = None) -> str:
    """The model's answer to `question`, after whatever tool calls it needs."""
    call = call or _call_model
    if not configured():
        raise AssistantError("The AI assistant isn't set up: AI_API_KEY is missing from the backend's .env.")
    messages: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM.format(today=date.today().isoformat())}]
    messages += [{"role": h["role"], "content": h["content"]} for h in history[-10:] if h.get("role") in ("user", "assistant")]
    messages.append({"role": "user", "content": question})
    for _ in range(MAX_ROUNDS):
        reply = call(messages)
        calls = reply.get("tool_calls") or []
        if not calls:
            return (reply.get("content") or "").strip() or "I couldn't find an answer to that."
        messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
        for c in calls:
            messages.append({"role": "tool", "tool_call_id": c["id"],
                             "content": run_tool(db, access, c["function"]["name"], c["function"].get("arguments") or "{}")})
    return "That needed more lookups than I'm allowed. Try asking something narrower."
