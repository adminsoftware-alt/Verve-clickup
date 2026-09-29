"""The joiner checklist and the leaver steps, as in Verve's "Common Operational Tasks" and "ClickUp Induction" SOPs.

When someone joins, the ClickUp team creates their standard tasks: Attending Special Events, Learning,
Monthly Review, Interview & Assessments and ClickUp Review in the List for their team, plus the HR
reminder tasks (Birthday, Work Anniversary, Marriage Anniversary) and the induction. `run_joiner` does
that from the workspace's joiner plan (Verve's SOP unless an admin changed it).

When someone leaves, the SOP keeps only the Birthday task, renamed "Ex – Name" with just the poster
checklist item, and deletes the rest. `apply_leaver_rules` does that for the tasks the joiner checklist
recorded in `person_tasks`.
"""

import calendar
import copy
import re
import uuid
from datetime import date, datetime, time, timedelta
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.db.models import (
    Checklist, ChecklistItem, Folder, PermissionLevel, PersonTask, Space, Task, TaskList, Team, TeamMember, User,
    Workspace, WorkspaceMember,
)
from app.schemas import work as s
from app.services.work import audit
from app.services.work.access import Access, Opened, chain_for_list, chain_for_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.permissions import can_manage_workspace

INDUCTION_STEPS = [
    "Send the member / guest invite to their official email",
    "Introduce the Verve Advisory workspace",
    "Explain the hierarchy: Workspace → Space → Folder → List",
    "Explain the basic features and views",
    "Explain the basic features of a task",
    "They accept the invite and sign in",
    "Show how to find any task",
    "Show how to share a task, Folder and List",
    "Show time tracking: the timer, and manual entries",
    "Induction questionnaire (practical check)",
]
EVENT_STEPS = ["Create the poster or video", "Post in the Verve Family WhatsApp group", "Post on LinkedIn", "Post on Instagram"]

# Verve's SOP. `where`: a Folder holding one List per team, or a single List (created if missing).
# `when`: all | not_intern | takes_interviews | reviewers | has_birthday | has_joining | married.
# `schedule`: monthly | twice_monthly | yearly_birthday | yearly_joining | yearly_marriage | induction.
# `leaver`: retain_birthday (rename "Ex – …", keep the poster item) | delete.
DEFAULT_PLAN: Dict[str, Any] = {
    "space_name": "VAPL Common Operation Tasks",
    "hr_team_name": "HR",
    "hr_user_ids": [],
    "timezone": "Asia/Kolkata",
    "due_hour": 18,
    "reviewer_designations": ["Executive", "Senior Executive", "Manager"],
    "rules": [
        {"key": "induction", "enabled": True, "name": "ClickUp induction – {name}", "where": {"list": "Induction"},
         "when": "all", "assignees": ["person", "manager", "hr"], "schedule": "induction", "estimate_minutes": 60,
         "checklist": INDUCTION_STEPS, "private": False, "leaver": "delete"},
        {"key": "special_events", "enabled": True, "name": "Attending Special Events – {name}", "where": {"folder": "Attending Special Events"},
         "when": "all", "assignees": ["person"], "schedule": "monthly", "estimate_minutes": 180, "private": False, "leaver": "delete"},
        {"key": "learning", "enabled": True, "name": "Learning – {name}", "where": {"folder": "Learning"},
         "when": "all", "assignees": ["person"], "schedule": "monthly", "estimate_minutes": 1200, "private": False, "leaver": "delete"},
        {"key": "monthly_review", "enabled": True, "name": "{name}'s Monthly Review", "where": {"folder": "Monthly Review"},
         "when": "all", "assignees": ["person", "manager", "hr"], "schedule": "monthly", "estimate_minutes": 165, "private": False, "leaver": "delete"},
        {"key": "interview", "enabled": True, "name": "Interview & Assessments – {name}", "where": {"folder": "Interview & Assessments"},
         "when": "takes_interviews", "assignees": ["person"], "schedule": "monthly", "estimate_minutes": 180, "private": False, "leaver": "delete"},
        {"key": "clickup_review", "enabled": True, "name": "ClickUp Review – {name}", "where": {"list": "Senior Executives Bi-Weekly Review"},
         "when": "reviewers", "assignees": ["person"], "schedule": "twice_monthly", "estimate_minutes": 60, "private": False, "leaver": "delete"},
        {"key": "birthday", "enabled": True, "name": "Birthday – {name}", "where": {"list": "Event Management"},
         "when": "has_birthday", "assignees": ["hr"], "schedule": "yearly_birthday", "estimate_minutes": 1,
         "checklist": EVENT_STEPS, "private": True, "leaver": "retain_birthday"},
        {"key": "work_anniversary", "enabled": True, "name": "Work Anniversary – {name}", "where": {"list": "Event Management"},
         "when": "not_intern", "assignees": ["hr"], "schedule": "yearly_joining", "estimate_minutes": 1,
         "checklist": EVENT_STEPS, "private": True, "leaver": "delete"},
        {"key": "marriage_anniversary", "enabled": True, "name": "Marriage Anniversary – {name}", "where": {"list": "Event Management"},
         "when": "married", "assignees": ["hr"], "schedule": "yearly_marriage", "estimate_minutes": 1,
         "checklist": EVENT_STEPS[:2], "private": True, "leaver": "delete"},
    ],
}

WHEN = {"all", "not_intern", "takes_interviews", "reviewers", "has_birthday", "married"}
SCHEDULES = {"monthly", "twice_monthly", "yearly_birthday", "yearly_joining", "yearly_marriage", "induction", "once"}
LEAVER = {"retain_birthday", "delete", "keep"}


# --- the plan ---------------------------------------------------------------------------------------------


def get_plan(db: Session, workspace_id: uuid.UUID) -> Dict[str, Any]:
    ws = db.get(Workspace, workspace_id)
    # Always the normalised shape (every rule has every field), whether saved or the SOP default.
    return check_plan(copy.deepcopy(ws.joiner_plan) if ws and ws.joiner_plan else copy.deepcopy(DEFAULT_PLAN))


def check_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Validate an admin's edited plan and keep only the known settings."""
    try:
        ZoneInfo(str(plan.get("timezone") or "UTC"))
    except (ZoneInfoNotFoundError, ValueError):
        raise Invalid("Unknown timezone")
    rules = plan.get("rules")
    if not isinstance(rules, list) or len(rules) > 40:
        raise Invalid("The plan needs a list of up to 40 rules")
    keys = set()
    clean_rules = []
    for r in rules:
        key = str(r.get("key") or "").strip()
        if not re.fullmatch(r"[a-z0-9_]{1,60}", key) or key in keys:
            raise Invalid("Each rule needs a unique key (lowercase letters, digits, _)")
        keys.add(key)
        where = r.get("where") or {}
        if not (isinstance(where, dict) and (bool(where.get("folder")) ^ bool(where.get("list")))):
            raise Invalid(f"Rule {key}: choose a Folder (one List per team) or a single List")
        if r.get("when") not in WHEN or r.get("schedule") not in SCHEDULES or r.get("leaver", "delete") not in LEAVER:
            raise Invalid(f"Rule {key}: unknown condition, schedule or leaver step")
        name = str(r.get("name") or "").strip()
        if not name or len(name) > 200:
            raise Invalid(f"Rule {key}: give the task a name, e.g. \"Learning – {{name}}\"")
        assignees = [a for a in (r.get("assignees") or []) if isinstance(a, str)][:20]
        checklist = [str(i).strip()[:300] for i in (r.get("checklist") or []) if str(i).strip()][:30]
        est = r.get("estimate_minutes")
        clean_rules.append({
            "key": key, "enabled": bool(r.get("enabled", True)), "name": name,
            "where": {"folder": str(where["folder"]).strip()[:100]} if where.get("folder") else {"list": str(where["list"]).strip()[:100]},
            "when": r["when"], "assignees": assignees, "schedule": r["schedule"],
            "estimate_minutes": int(est) if isinstance(est, (int, float)) and 0 < est <= 10000 else None,
            "checklist": checklist, "private": bool(r.get("private", False)), "leaver": r.get("leaver", "delete"),
        })
    return {
        "space_name": str(plan.get("space_name") or DEFAULT_PLAN["space_name"]).strip()[:100],
        "hr_team_name": str(plan.get("hr_team_name") or "").strip()[:100],
        "hr_user_ids": [u for u in (plan.get("hr_user_ids") or []) if isinstance(u, str)][:50],
        "timezone": str(plan.get("timezone") or "UTC"),
        "due_hour": max(0, min(23, int(plan.get("due_hour", 18)))),
        "reviewer_designations": [str(d).strip()[:100] for d in (plan.get("reviewer_designations") or []) if str(d).strip()][:20],
        "rules": clean_rules,
    }


def save_plan(db: Session, access: Access, plan: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can change the joiner checklist")
    ws = db.get(Workspace, access.workspace_id)
    ws.joiner_plan = check_plan(plan) if plan is not None else None
    audit.record(db, access.workspace_id, access.user_id, "workspace.joiner_plan", "workspace", access.workspace_id)
    db.flush()
    return get_plan(db, access.workspace_id)


# --- running it -------------------------------------------------------------------------------------------


def _applies(rule: Dict[str, Any], member: WorkspaceMember, plan: Dict[str, Any]) -> bool:
    designation = (member.designation or "").lower()
    when = rule["when"]
    if when == "all":
        return True
    if when == "not_intern":  # SOP: no work anniversary for interns (until converted)
        return "intern" not in designation and member.date_of_joining is not None
    if when == "takes_interviews":
        return member.takes_interviews
    if when == "reviewers":
        return designation in {d.lower() for d in plan.get("reviewer_designations", [])}
    if when == "has_birthday":
        return member.date_of_birth is not None
    if when == "married":
        return member.marriage_anniversary is not None
    return False


def _next_on(d: date, today: date) -> date:
    """The next time this day-and-month comes round, from today (29 Feb → 28 Feb in other years)."""
    for year in (today.year, today.year + 1):
        try:
            candidate = d.replace(year=year)
        except ValueError:
            candidate = date(year, 2, 28)
        if candidate >= today:
            return candidate
    return d.replace(year=today.year + 1)


def _dates(rule: Dict[str, Any], member: WorkspaceMember, plan: Dict[str, Any], today: date) -> Tuple[Optional[datetime], Optional[s.Recurrence]]:
    tz = ZoneInfo(plan.get("timezone") or "UTC")
    at = lambda d: datetime.combine(d, time(hour=plan.get("due_hour", 18)), tzinfo=tz)  # noqa: E731
    schedule = rule["schedule"]
    start = max(today, member.date_of_joining or today)
    if schedule == "monthly":
        last = date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
        return at(last), s.Recurrence(frequency="monthly", month_day=31, tz=plan.get("timezone") or "UTC")
    if schedule == "twice_monthly":
        return at(start + timedelta(days=14)), s.Recurrence(frequency="weekly", interval=2, tz=plan.get("timezone") or "UTC")
    if schedule == "induction":
        # SOP: within the first week, preferably the Tuesday after a Monday start.
        tuesday = start + timedelta(days=((1 - start.weekday()) % 7) or 7)  # the next Tuesday after they start
        return at(tuesday), None
    if schedule == "once":
        return at(start + timedelta(days=7)), None
    source = {"yearly_birthday": member.date_of_birth, "yearly_joining": member.date_of_joining,
              "yearly_marriage": member.marriage_anniversary}[schedule]
    if source is None:
        return None, None
    return at(_next_on(source, today)), s.Recurrence(frequency="yearly", tz=plan.get("timezone") or "UTC")


def _find_space(db: Session, workspace_id: uuid.UUID, name: str) -> Optional[Space]:
    return db.scalars(select(Space).where(Space.workspace_id == workspace_id, func.lower(Space.name) == name.lower(),
                                          Space.archived_at.is_(None))).first()


def _team_names(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[str]:
    return list(db.scalars(select(Team.name).join(TeamMember, TeamMember.team_id == Team.id)
                           .where(Team.workspace_id == workspace_id, TeamMember.user_id == user_id)))


def _list_for(db: Session, access: Access, space: Space, where: Dict[str, str], teams: List[str], create: bool) -> Tuple[Optional[TaskList], Optional[str]]:
    from app.services.work import hierarchy

    if where.get("list"):
        lst = db.scalars(select(TaskList).where(TaskList.space_id == space.id, func.lower(TaskList.name) == where["list"].lower(),
                                                TaskList.archived_at.is_(None))).first()
        if lst is None and create:
            lst = hierarchy.create_list(db, access, space, s.ListCreate(name=where["list"]))
        return lst, None if lst else f"there is no List called \"{where['list']}\""
    folder = db.scalars(select(Folder).where(Folder.space_id == space.id, func.lower(Folder.name) == where["folder"].lower(),
                                             Folder.archived_at.is_(None))).first()
    if folder is None:
        return None, f"there is no Folder called \"{where['folder']}\""
    lists = list(db.scalars(select(TaskList).where(TaskList.folder_id == folder.id, TaskList.archived_at.is_(None))))
    for team in teams:
        # e.g. "Learning - HR" or "Team HR" for the HR team
        for lst in lists:
            if re.search(rf"(^|[\s\-–]){re.escape(team.lower())}($|[\s\-–])", lst.name.lower()):
                return lst, None
    if not teams:
        return None, "they are not in a Team yet, so there is no team List to use"
    return None, f"\"{where['folder']}\" has no List for {', '.join(teams)}"


def _hr_ids(db: Session, workspace_id: uuid.UUID, plan: Dict[str, Any]) -> List[str]:
    ids = list(plan.get("hr_user_ids") or [])
    if not ids and plan.get("hr_team_name"):
        ids = list(db.scalars(select(TeamMember.user_id).join(Team, Team.id == TeamMember.team_id)
                              .where(Team.workspace_id == workspace_id, func.lower(Team.name) == plan["hr_team_name"].lower())))
    return ids


def preview(db: Session, access: Access, user_id: str) -> List[s.JoinerStep]:
    return run_joiner(db, access, user_id, dry_run=True)


def run_joiner(db: Session, access: Access, user_id: str, dry_run: bool = False) -> List[s.JoinerStep]:
    """Create this person's joiner tasks. Safe to run again: rules already done are skipped."""
    from app.services.work import extras, tasks

    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can run the joiner checklist")
    member = db.get(WorkspaceMember, (access.workspace_id, user_id))
    user = db.get(User, user_id)
    if member is None or user is None:
        raise NotFound("Person not found")
    plan = get_plan(db, access.workspace_id)
    space = _find_space(db, access.workspace_id, plan["space_name"])
    teams = _team_names(db, access.workspace_id, user_id)
    hr = _hr_ids(db, access.workspace_id, plan)
    done = {p.rule_key: p for p in db.scalars(select(PersonTask).where(PersonTask.workspace_id == access.workspace_id, PersonTask.user_id == user_id))}
    today = datetime.now(ZoneInfo(plan.get("timezone") or "UTC")).date()
    name = user.display_name or user.email
    steps: List[s.JoinerStep] = []
    for rule in plan["rules"]:
        title = rule["name"].replace("{name}", name)[:500]
        step = s.JoinerStep(key=rule["key"], name=title, outcome="skipped")
        steps.append(step)
        if not rule.get("enabled", True):
            step.reason = "turned off in the joiner checklist"
            continue
        if not _applies(rule, member, plan):
            step.reason = {"not_intern": "not for interns, or no joining date", "takes_interviews": "only for people who take interviews",
                           "reviewers": "only for Executives, Senior Executives and Managers", "has_birthday": "no date of birth",
                           "married": "no marriage anniversary"}.get(rule["when"], "doesn't apply")
            continue
        if rule["key"] in done and db.get(Task, done[rule["key"]].task_id) is not None:
            step.outcome, step.reason, step.task_id = "exists", "already created", done[rule["key"]].task_id
            continue
        if space is None:
            step.outcome, step.reason = "problem", f"there is no Space called \"{plan['space_name']}\""
            continue
        lst, why = _list_for(db, access, space, rule["where"], teams, create=not dry_run)
        if lst is None and not (dry_run and rule["where"].get("list")):
            step.outcome, step.reason = "problem", why
            continue
        due, repeat = _dates(rule, member, plan, today)
        step.due_date = due
        step.list_name = lst.name if lst else rule["where"].get("list")
        assignees: List[str] = []
        for a in rule.get("assignees", []):
            if a == "person":
                assignees.append(user_id)
            elif a == "manager" and member.manager_id:
                assignees.append(member.manager_id)
            elif a == "hr":
                assignees.extend(hr)
            elif a not in ("person", "manager", "hr"):
                assignees.append(a)
        assignees = [a for a in dict.fromkeys(assignees) if db.get(WorkspaceMember, (access.workspace_id, a))]
        if dry_run:
            step.outcome = "would_create"
            continue
        level = access.level(chain_for_list(db, lst))
        if level != PermissionLevel.full:
            step.outcome, step.reason = "problem", f"you don't have full access to the List \"{lst.name}\""
            continue
        try:
            description = None
            if rule["schedule"] == "induction":
                quiz = induction_quiz(db, access)
                if quiz:
                    from app.core.config import settings as app_settings

                    description = f"At the end, the joiner fills in the questionnaire: {app_settings.APP_URL.rstrip('/')}/forms/{quiz}"
            with db.begin_nested():
                task = tasks.create_task(db, Opened(lst, access, level), s.TaskCreate(
                    name=title, assignees=assignees, due_date=due, recurrence=repeat, is_private=rule.get("private", False),
                    description=description,
                    time_estimate_seconds=rule["estimate_minutes"] * 60 if rule.get("estimate_minutes") else None,
                ), check_assignee_access=False)
                if rule.get("checklist"):
                    extras.add_checklist(db, Opened(task, access, PermissionLevel.full), "Checklist", rule["checklist"])
                if rule.get("private"):
                    # Private reminders (HR's event tasks) are shared with the people doing them, and nobody else.
                    from app.db.models import LocationKind
                    from app.services.work import sharing

                    for uid in assignees:
                        if uid != access.user_id:
                            sharing.grant_share(db, Opened(task, access, PermissionLevel.full), LocationKind.task,
                                                s.ShareCreate(user_id=uid, level=PermissionLevel.edit))
                if rule["key"] in done:
                    done[rule["key"]].task_id = task.id
                else:
                    db.add(PersonTask(workspace_id=access.workspace_id, user_id=user_id, task_id=task.id, rule_key=rule["key"]))
                db.flush()
        except (Invalid, Forbidden) as exc:
            step.outcome, step.reason = "problem", exc.message
            continue
        step.outcome, step.task_id, step.reason = "created", task.id, None
    if not dry_run and any(st.outcome == "created" for st in steps):
        audit.record(db, access.workspace_id, access.user_id, "person.joiner_checklist", "person", user_id, name,
                     {"created": [st.key for st in steps if st.outcome == "created"]})
    return steps


def joiner_task_count(db: Session, workspace_id: uuid.UUID, user_id: str) -> int:
    return db.scalar(select(func.count()).select_from(PersonTask).where(PersonTask.workspace_id == workspace_id, PersonTask.user_id == user_id)) or 0


# --- leaving ----------------------------------------------------------------------------------------------


def leaver_plan(db: Session, workspace_id: uuid.UUID, user_id: str) -> Tuple[List[Tuple[PersonTask, Task, str]], Dict[str, str]]:
    """Each recorded joiner task with what the leaver rules do to it: retain_birthday, delete or keep."""
    rules = {r["key"]: r.get("leaver", "delete") for r in get_plan(db, workspace_id)["rules"]}
    out = []
    for pt in db.scalars(select(PersonTask).where(PersonTask.workspace_id == workspace_id, PersonTask.user_id == user_id)):
        task = db.get(Task, pt.task_id)
        if task is not None:
            out.append((pt, task, rules.get(pt.rule_key, "delete")))
    return out, rules


def apply_leaver_rules(db: Session, workspace_id: uuid.UUID, user_id: str) -> Tuple[int, int]:
    """SOP §6: keep the Birthday task as "Ex – Name" with only the poster item; delete the other joiner tasks."""
    from app.services.work import events

    user = db.get(User, user_id)
    name = (user.display_name or user.email) if user else ""
    kept = deleted = 0
    items, _ = leaver_plan(db, workspace_id, user_id)
    for pt, task, action in items:
        if action == "keep":
            kept += 1
            continue
        if action == "retain_birthday":
            old = task.name
            task.name = f"Ex – {name}"[:500]
            task.description = None  # SOP: cake-delivery details are removed for ex-employees
            for cl in db.scalars(select(Checklist).where(Checklist.task_id == task.id)):
                rows = list(db.scalars(select(ChecklistItem).where(ChecklistItem.checklist_id == cl.id).order_by(ChecklistItem.orderindex)))
                keep = next((r for r in rows if "poster" in r.name.lower()), rows[0] if rows else None)
                for r in rows:
                    if r is not keep:
                        db.delete(r)
            db.flush()
            events.record(db, task, None, "name", {"from": old, "to": task.name, "leaver": True})
            kept += 1
            continue
        db.delete(task)
        deleted += 1
    db.execute(delete(PersonTask).where(PersonTask.workspace_id == workspace_id, PersonTask.user_id == user_id,
                                        PersonTask.task_id.not_in(select(Task.id))))
    db.flush()
    return kept, deleted


def open_task_ids(db: Session, workspace_id: uuid.UUID, user_id: str) -> List[uuid.UUID]:
    """Open tasks assigned to someone (for the hand-over), leaving out their own joiner tasks."""
    from app.db.models import Status, StatusGroup, TaskAssignee

    joiner = select(PersonTask.task_id).where(PersonTask.workspace_id == workspace_id, PersonTask.user_id == user_id)
    return list(db.scalars(
        select(Task.id)
        .join(TaskAssignee, TaskAssignee.task_id == Task.id)
        .join(Status, Status.id == Task.status_id)
        .join(TaskList, TaskList.id == Task.list_id)
        .join(Space, Space.id == TaskList.space_id)
        .where(TaskAssignee.user_id == user_id, Space.workspace_id == workspace_id,
               Status.group.in_([StatusGroup.not_started, StatusGroup.active]), Task.id.not_in(joiner))
    ))


# --- the induction questionnaire (SOP: "a short practical session at the end") ------------------------------

QUIZ_NAME = "ClickUp induction questionnaire"
QUIZ_CHECKS = [
    "I can explain the hierarchy: Workspace, Space, Folder, List",
    "I can find any task (search, or its List)",
    "I can set a task's assignee, due date, priority and time estimate",
    "I can add subtasks and checklist items",
    "I can comment and @mention a colleague",
    "I can share a task, Folder or List",
    "I can start and stop the timer on a task",
    "I can log time by hand and delete a wrong entry",
    "I can switch between List, Board and Calendar views",
    "I know where to find my notifications (Inbox)",
]


def induction_quiz(db: Session, access: Access, create: bool = False) -> Optional[uuid.UUID]:
    """The questionnaire Form in the Induction List, made on request. Answers become a task for HR to review."""
    from app.db.models import LocationKind, View, ViewType
    from app.services.work import customfields, views

    plan = get_plan(db, access.workspace_id)
    space = _find_space(db, access.workspace_id, plan["space_name"])
    if space is None:
        if create:
            raise Invalid(f"Create the \"{plan['space_name']}\" Space first")
        return None
    lst, _ = _list_for(db, access, space, {"list": "Induction"}, [], create=create)
    if lst is None:
        return None
    existing = db.scalars(select(View).where(View.list_id == lst.id, View.type == ViewType.form, View.name == QUIZ_NAME)).first()
    if existing is not None or not create:
        return existing.id if existing else None
    if not can_manage_workspace(access.role):
        raise Forbidden("Only owners and admins can set up the questionnaire")
    level = access.level(chain_for_list(db, lst))
    if level is None or not level.at_least(PermissionLevel.edit):
        raise Forbidden("You need edit access to the Induction List")
    opened = Opened(lst, access, level)
    have = {f.name.lower(): f for f in customfields.available(db, lst)}
    fields = [{"key": "name", "label": "Your name", "required": True}]
    for text in QUIZ_CHECKS:
        name = text[:100]
        f = have.get(name.lower()) or customfields.create(db, opened, LocationKind.list, s.CustomFieldIn(name=name, type="checkbox"))
        fields.append({"key": f"cf:{f.id}", "required": False})
    confidence = have.get("how confident do you feel?") or customfields.create(db, opened, LocationKind.list, s.CustomFieldIn(
        name="How confident do you feel?", type="dropdown",
        config={"options": [{"name": "Ready to go"}, {"name": "Mostly, a few questions"}, {"name": "I need another session"}]}))
    fields.append({"key": f"cf:{confidence.id}", "required": True})
    fields.append({"key": "description", "label": "Questions or anything unclear", "required": False})
    view = views.create_view(db, opened, s.ViewCreate(type=ViewType.form, name=QUIZ_NAME))
    view.settings = {"form": {
        "title": QUIZ_NAME, "active": True, "fields": fields, "assignee_ids": _hr_ids(db, access.workspace_id, plan),
        "description": "Tick what you can do after your ClickUp induction. The ClickUp team reviews your answers.",
        "success": "Thanks! The ClickUp team will go through your answers with you.",
    }}
    db.flush()
    return view.id
