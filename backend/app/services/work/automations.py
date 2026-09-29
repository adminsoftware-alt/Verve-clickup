"""A few fixed Automations, as the gap report advised: "when this happens here, do that".

Rules live on a Space, Folder or List and apply to every task inside it. They fire from `events.record`
when a task is created or changes status. Changes a rule makes are recorded as the rule's own activity
(no person), and can set off other rules, but never the same rule twice in one chain, and at most
three rules deep, so rules can't loop.

A rule only acts while the person who made it can still manage the location it's on.
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models import (
    Automation, Folder, PermissionLevel, Space, Task, TaskAssignee, TaskList, User, WorkspaceMember,
)
from app.schemas import planning as p
from app.schemas import work as s
from app.services.work import events
from app.services.work.access import Access, Opened, chain_for_list, chain_for_task
from app.services.work.errors import Forbidden, Invalid, NotFound
from app.services.work.statuses import apply_group_transition, effective_statuses

MAX_DEPTH = 3
MAX_RULES_PER_LOCATION = 50
_CHAIN_KEY = "automation_chain"

Location = Union[Space, Folder, TaskList]


def _kind(obj: Location) -> str:
    return "space" if isinstance(obj, Space) else "folder" if isinstance(obj, Folder) else "list"


def _users(db: Session, ids: List[str]) -> Dict[str, User]:
    return {u.id: u for u in db.scalars(select(User).where(User.id.in_(ids)))} if ids else {}


def _out(rule: Automation, users: Dict[str, User], here: Location) -> p.AutomationOut:
    kind, loc_id = (("space", rule.space_id) if rule.space_id else ("folder", rule.folder_id) if rule.folder_id else ("list", rule.list_id))
    return p.AutomationOut(
        id=rule.id, location_kind=kind, location_id=loc_id, trigger=rule.trigger, trigger_config=rule.trigger_config,
        action=rule.action, action_config=rule.action_config, active=rule.active,
        created_by=s.UserOut.model_validate(users[rule.created_by]) if rule.created_by in users else None,
        created_at=rule.created_at, last_run_at=rule.last_run_at, run_count=rule.run_count,
        inherited=loc_id != here.id,
    )


def _chain_ids(db: Session, obj: Location) -> Dict[str, List[uuid.UUID]]:
    """The location and the ones above it, whose rules apply here."""
    if isinstance(obj, TaskList):
        chain = chain_for_list(db, obj)
    elif isinstance(obj, Folder):
        from app.services.work.access import chain_for_folder

        chain = chain_for_folder(db, obj)
    else:
        from app.services.work.access import chain_for_space

        chain = chain_for_space(obj)
    out: Dict[str, List[uuid.UUID]] = {"space": [], "folder": [], "list": []}
    for node in chain:
        out[node.kind.value].append(node.id)
    return out


def _rules_for(db: Session, obj: Location) -> List[Automation]:
    ids = _chain_ids(db, obj)
    conditions = []
    if ids["space"]:
        conditions.append(Automation.space_id.in_(ids["space"]))
    if ids["folder"]:
        conditions.append(Automation.folder_id.in_(ids["folder"]))
    if ids["list"]:
        conditions.append(Automation.list_id.in_(ids["list"]))
    return list(db.scalars(select(Automation).where(or_(*conditions)).order_by(Automation.created_at)))


def list_rules(db: Session, opened: Opened) -> List[p.AutomationOut]:
    rules = _rules_for(db, opened.obj)
    users = _users(db, [r.created_by for r in rules if r.created_by])
    return [_out(r, users, opened.obj) for r in rules]


def _conditions(db: Session, access: Access, raw: Any) -> Dict[str, Any]:
    """Optional "only if" filters: priorities, tags (any of), assignees (any of)."""
    if not raw:
        return {}
    if not isinstance(raw, dict):
        raise Invalid("Conditions must be a set of filters")
    out: Dict[str, Any] = {}
    pr = raw.get("priorities") or []
    if pr:
        if not all(p in (0, 1, 2, 3, 4) for p in pr):
            raise Invalid("Priorities are 1 (urgent) to 4 (low), or 0 for none")
        out["priorities"] = sorted(set(pr))
    tags = [str(t).strip()[:64] for t in (raw.get("tags") or []) if str(t).strip()]
    if tags:
        out["tags"] = sorted(set(tags), key=str.lower)[:20]
    people = [str(u) for u in (raw.get("assignees") or [])]
    if people:
        known = set(db.scalars(select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.user_id.in_(people))))
        if set(people) - known:
            raise Invalid("Everyone in the conditions must be a member of this workspace")
        out["assignees"] = sorted(set(people))
    return out


def _check(db: Session, access: Access, obj: Location, trigger: str, trigger_config: Dict[str, Any],
           action: str, action_config: Dict[str, Any]) -> tuple:
    """Validate a rule's settings and return them cleaned."""
    tcfg: Dict[str, Any] = {}
    trigger_config = dict(trigger_config or {})
    conditions = _conditions(db, access, trigger_config.pop("conditions", None))
    if trigger == "status_changed":
        name = str(trigger_config.get("status") or "").strip()
        if len(name) > 100:
            raise Invalid("Status name is too long")
        if name:
            tcfg["status"] = name
    elif trigger in ("due_soon", "overdue"):
        key = "days_before" if trigger == "due_soon" else "days_after"
        days = trigger_config.get(key, 1 if trigger == "due_soon" else 0)
        if not isinstance(days, int) or not 0 <= days <= 60:
            raise Invalid("Choose 0 to 60 days")
        tcfg[key] = days
    elif trigger == "priority_changed":
        pr = trigger_config.get("priority")
        if pr is not None:
            if pr not in (1, 2, 3, 4):
                raise Invalid("Pick a priority")
            tcfg["priority"] = pr
    elif trigger_config:
        raise Invalid("This trigger has no settings")
    if conditions:
        tcfg["conditions"] = conditions
    acfg: Dict[str, Any] = {}
    if action in ("assign", "notify"):
        ids = action_config.get("user_ids")
        if not isinstance(ids, list) or not ids or len(ids) > 20 or not all(isinstance(i, str) for i in ids):
            raise Invalid("Pick who to assign or notify")
        members = set(db.scalars(select(WorkspaceMember.user_id).where(
            WorkspaceMember.workspace_id == access.workspace_id, WorkspaceMember.user_id.in_(ids))))
        if set(ids) - members:
            raise Invalid("Everyone picked must be a member of this workspace")
        acfg["user_ids"] = sorted(set(ids))
    elif action == "set_priority":
        pr = action_config.get("priority")
        if pr not in (1, 2, 3, 4):
            raise Invalid("Pick a priority")
        acfg["priority"] = pr
    elif action == "set_status":
        name = str(action_config.get("status_name") or "").strip()
        if not name:
            raise Invalid("Pick a status")
        if isinstance(obj, TaskList) and name.lower() not in {st.name.lower() for st in effective_statuses(db, obj)}:
            raise Invalid(f"This List has no status called \"{name}\"")
        acfg["status_name"] = name
        if trigger == "status_changed" and tcfg.get("status", "").lower() == name.lower():
            raise Invalid("A rule can't set the status that sets it off")
    elif action == "escalate":
        levels = action_config.get("levels", 1)
        if levels not in (1, 2):
            raise Invalid("Escalate to the manager (1) or also the manager above (2)")
        acfg["levels"] = levels
        message = str(action_config.get("message") or "").strip()
        if message:
            acfg["message"] = message[:300]
    elif action == "add_tag":
        tag = str(action_config.get("tag") or "").strip()
        if not tag or len(tag) > 64:
            raise Invalid("Name the tag to add")
        acfg["tag"] = tag
    return tcfg, acfg


def add_rule(db: Session, opened: Opened, data: p.AutomationIn) -> p.AutomationOut:
    obj, access = opened.obj, opened.access
    if opened.level != PermissionLevel.full:
        raise Forbidden("You need full access here to add Automations")
    kind = _kind(obj)
    existing = db.scalars(select(Automation.id).where(getattr(Automation, f"{kind}_id") == obj.id)).all()
    if len(existing) >= MAX_RULES_PER_LOCATION:
        raise Invalid(f"A location can have up to {MAX_RULES_PER_LOCATION} Automations")
    tcfg, acfg = _check(db, access, obj, data.trigger, data.trigger_config, data.action, data.action_config)
    rule = Automation(workspace_id=access.workspace_id, trigger=data.trigger, trigger_config=tcfg, action=data.action,
                      action_config=acfg, active=data.active, created_by=access.user_id, **{f"{kind}_id": obj.id})
    db.add(rule)
    db.flush()
    from app.services.work import audit

    audit.record(db, access.workspace_id, access.user_id, "automation.created", kind, obj.id, obj.name, {"rule": describe(rule)})
    return _out(rule, _users(db, [access.user_id]), obj)


def _location_of(db: Session, rule: Automation) -> Location:
    obj = db.get(Space, rule.space_id) if rule.space_id else db.get(Folder, rule.folder_id) if rule.folder_id else db.get(TaskList, rule.list_id)
    assert obj is not None
    return obj


def open_rule(db: Session, user_id: str, rule_id: uuid.UUID) -> tuple:
    from app.services.work.access import open_folder, open_list, open_space

    rule = db.get(Automation, rule_id)
    if rule is None:
        raise NotFound("Automation not found")
    opener = open_space if rule.space_id else open_folder if rule.folder_id else open_list
    opened = opener(db, user_id, rule.space_id or rule.folder_id or rule.list_id, PermissionLevel.full)
    return rule, opened


def update_rule(db: Session, user_id: str, rule_id: uuid.UUID, data: p.AutomationUpdate) -> p.AutomationOut:
    rule, opened = open_rule(db, user_id, rule_id)
    fields = data.model_fields_set
    tcfg, acfg = _check(
        db, opened.access, opened.obj, rule.trigger,
        data.trigger_config if "trigger_config" in fields and data.trigger_config is not None else rule.trigger_config,
        rule.action,
        data.action_config if "action_config" in fields and data.action_config is not None else rule.action_config,
    )
    rule.trigger_config, rule.action_config = tcfg, acfg
    if data.active is not None:
        rule.active = data.active
    db.flush()
    return _out(rule, _users(db, [rule.created_by] if rule.created_by else []), opened.obj)


def remove_rule(db: Session, user_id: str, rule_id: uuid.UUID) -> None:
    rule, opened = open_rule(db, user_id, rule_id)
    from app.services.work import audit

    audit.record(db, opened.access.workspace_id, user_id, "automation.deleted", _kind(opened.obj), opened.obj.id, opened.obj.name,
                 {"rule": describe(rule)})
    db.delete(rule)
    db.flush()


# --- running rules ---------------------------------------------------------------------------------


def _matches(rule: Automation, kind: str, data: Dict[str, Any]) -> bool:
    if not rule.active:
        return False
    if kind == "created":
        return rule.trigger == "task_created"
    if kind == "status" and rule.trigger == "status_changed":
        wanted = rule.trigger_config.get("status")
        return not wanted or str(data.get("to") or "").lower() == wanted.lower()
    if kind == "priority" and rule.trigger == "priority_changed":
        wanted = rule.trigger_config.get("priority")
        return wanted is None or data.get("to") == wanted
    if kind == "assignees" and rule.trigger == "assignee_added":
        return bool(data.get("added"))
    return False


def _conditions_met(db: Session, rule: Automation, task: Task) -> bool:
    from app.db.models import Tag, TaskTag

    cond = rule.trigger_config.get("conditions") or {}
    if cond.get("priorities") and (task.priority or 0) not in cond["priorities"]:
        return False
    if cond.get("tags"):
        names = {n.lower() for n in db.scalars(select(Tag.name).join(TaskTag, TaskTag.tag_id == Tag.id).where(TaskTag.task_id == task.id))}
        if not names & {t.lower() for t in cond["tags"]}:
            return False
    if cond.get("assignees"):
        people = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
        if not people & set(cond["assignees"]):
            return False
    return True


def _creator_can_manage(db: Session, rule: Automation, workspace_id: uuid.UUID) -> bool:
    if not rule.created_by:
        return False
    member = db.get(WorkspaceMember, (workspace_id, rule.created_by))
    if member is None:
        return False
    obj = _location_of(db, rule)
    access = Access(db, rule.created_by, workspace_id, member.role)
    if isinstance(obj, TaskList):
        chain = chain_for_list(db, obj)
    elif isinstance(obj, Folder):
        from app.services.work.access import chain_for_folder

        chain = chain_for_folder(db, obj)
    else:
        from app.services.work.access import chain_for_space

        chain = chain_for_space(obj)
    return access.level(chain) == PermissionLevel.full


def fire(db: Session, task: Task, kind: str, data: Dict[str, Any]) -> None:
    """Called for every task event; runs the rules that match it."""
    if kind not in ("created", "status", "priority", "assignees"):
        return
    chain: List[uuid.UUID] = db.info.get(_CHAIN_KEY, [])
    if len(chain) >= MAX_DEPTH:
        return
    lst = db.get(TaskList, task.list_id)
    if lst is None:
        return
    rules = [r for r in _rules_for(db, lst) if r.id not in chain and _matches(r, kind, data) and _conditions_met(db, r, task)]
    if not rules:
        return
    workspace_id = db.get(Space, lst.space_id).workspace_id
    for rule in rules:
        if not _creator_can_manage(db, rule, workspace_id):
            continue
        db.info[_CHAIN_KEY] = chain + [rule.id]
        try:
            _run(db, rule, task, lst, workspace_id)
            rule.last_run_at = datetime.now(timezone.utc)
            rule.run_count += 1
        finally:
            db.info[_CHAIN_KEY] = chain
    db.flush()


def _by(rule: Automation) -> Dict[str, Any]:
    return {"automation": str(rule.id)}


def _run(db: Session, rule: Automation, task: Task, lst: TaskList, workspace_id: uuid.UUID) -> None:
    cfg = rule.action_config
    if rule.action == "assign":
        current = set(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
        chain = chain_for_task(db, task)
        added: List[str] = []
        for uid in cfg.get("user_ids", []):
            if uid in current:
                continue
            member = db.get(WorkspaceMember, (workspace_id, uid))
            # Only people who can open the task can be given it.
            if member is None or Access(db, uid, workspace_id, member.role).level(chain) is None:
                continue
            db.add(TaskAssignee(task_id=task.id, user_id=uid))
            added.append(uid)
        if added:
            db.flush()
            events.record(db, task, None, "assignees", {"added": sorted(added), "removed": [], **_by(rule)})
            events.assigned(db, task, None, sorted(added))
    elif rule.action == "notify":
        events.notify(db, workspace_id, cfg.get("user_ids", []), None, "automation", "primary", task=task,
                      data={"rule": describe(rule), **_by(rule)})
    elif rule.action == "set_priority":
        if task.priority != cfg["priority"]:
            old = task.priority
            task.priority = cfg["priority"]
            db.flush()
            events.record(db, task, None, "priority", {"from": old, "to": task.priority, **_by(rule)})
    elif rule.action == "set_status":
        statuses = effective_statuses(db, lst)
        target = next((st for st in statuses if st.name.lower() == str(cfg.get("status_name", "")).lower()), None)
        if target is None or target.id == task.status_id:
            return
        old = next((st for st in statuses if st.id == task.status_id), None)
        task.status_id = target.id
        apply_group_transition(task, old.group if old else None, target.group)
        db.flush()
        events.record(db, task, None, "status", {"from": old.name if old else None, "to": target.name, "color": target.color, **_by(rule)})
    elif rule.action == "escalate":
        _escalate(db, rule, task, workspace_id)
    elif rule.action == "add_tag":
        from app.db.models import Tag, TaskTag

        tag = db.scalars(select(Tag).where(Tag.space_id == lst.space_id, func.lower(Tag.name) == cfg["tag"].lower())).first()
        if tag is None:
            tag = Tag(space_id=lst.space_id, name=cfg["tag"], fg_color="#ffffff", bg_color="#6366f1")
            db.add(tag)
            db.flush()
        if db.get(TaskTag, (task.id, tag.id)) is None:
            db.add(TaskTag(task_id=task.id, tag_id=tag.id))
            db.flush()
            events.record(db, task, None, "tags", {"added": [tag.name], "removed": [], **_by(rule)})


def _escalate(db: Session, rule: Automation, task: Task, workspace_id: uuid.UUID) -> None:
    """Tell the assignees' reporting managers (and, at level 2, their managers too). Unassigned: the rule's owner."""
    assignees = list(db.scalars(select(TaskAssignee.user_id).where(TaskAssignee.task_id == task.id)))
    managers: List[str] = []
    for uid in assignees:
        step = uid
        for _ in range(rule.action_config.get("levels", 1)):
            member = db.get(WorkspaceMember, (workspace_id, step))
            if member is None or not member.manager_id:
                break
            step = member.manager_id
            managers.append(step)
    if not assignees and rule.created_by:
        managers.append(rule.created_by)
    events.notify(db, workspace_id, list(dict.fromkeys(managers)), None, "escalation", "primary", task=task, data={
        "rule": describe(rule), "message": rule.action_config.get("message"), "assignees": assignees, **_by(rule),
    })


# --- scheduled rules: due soon, overdue ------------------------------------------------------------------------


def _lists_of(db: Session, rule: Automation) -> List[uuid.UUID]:
    if rule.list_id:
        return [rule.list_id]
    if rule.space_id:
        return list(db.scalars(select(TaskList.id).where(TaskList.space_id == rule.space_id)))
    folders = [rule.folder_id] + list(db.scalars(select(Folder.id).where(Folder.parent_folder_id == rule.folder_id)))
    return list(db.scalars(select(TaskList.id).where(TaskList.folder_id.in_(folders))))


def run_scheduled(db: Session, now: Optional[datetime] = None) -> int:
    """Fire "due soon" and "overdue" rules for open tasks, once per rule, task and due date."""
    from datetime import timedelta

    from app.db.models import AutomationRun, Status, StatusGroup
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    now = now or datetime.now(timezone.utc)
    fired = 0
    for rule in db.scalars(select(Automation).where(Automation.active.is_(True), Automation.trigger.in_(("due_soon", "overdue")))):
        workspace_id = rule.workspace_id
        if not _creator_can_manage(db, rule, workspace_id):
            continue
        if rule.trigger == "due_soon":
            ahead = timedelta(days=rule.trigger_config.get("days_before", 1))
            window = (Task.due_date > now, Task.due_date <= now + ahead)
        else:
            late = timedelta(days=rule.trigger_config.get("days_after", 0))
            window = (Task.due_date <= now - late,)
        lists = _lists_of(db, rule)
        if not lists:
            continue
        tasks = list(db.scalars(
            select(Task).join(Status, Status.id == Task.status_id)
            .where(Task.list_id.in_(lists), Task.archived_at.is_(None), Task.due_date.is_not(None),
                   Status.group.in_([StatusGroup.not_started, StatusGroup.active]), *window)
            .limit(500)
        ))
        for task in tasks:
            if not _conditions_met(db, rule, task):
                continue
            key = task.due_date.isoformat()[:32]
            # RETURNING tells a fresh insert from a skipped one (rowcount can't be relied on here).
            inserted = db.execute(pg_insert(AutomationRun).values(id=uuid.uuid4(), rule_id=rule.id, task_id=task.id, key=key)
                                  .on_conflict_do_nothing(constraint="uq_automation_runs_once").returning(AutomationRun.id)).scalar()
            if not inserted:
                continue
            lst = db.get(TaskList, task.list_id)
            db.info[_CHAIN_KEY] = [rule.id]
            try:
                _run(db, rule, task, lst, workspace_id)
            finally:
                db.info[_CHAIN_KEY] = []
            rule.last_run_at = now
            rule.run_count += 1
            fired += 1
    db.flush()
    return fired


PRIORITY_NAMES = {1: "Urgent", 2: "High", 3: "Normal", 4: "Low"}


def describe(rule: Automation) -> str:
    t = rule.trigger_config
    if rule.trigger == "task_created":
        when = "When a task is created"
    elif rule.trigger == "status_changed":
        when = f"When status changes to {t['status']}" if t.get("status") else "When status changes"
    elif rule.trigger == "due_soon":
        days = t.get("days_before", 1)
        when = "On the due date" if days == 0 else f"{days} day{'s' if days != 1 else ''} before the due date"
    elif rule.trigger == "overdue":
        days = t.get("days_after", 0)
        when = "When a task becomes overdue" if days == 0 else f"When a task is {days} day{'s' if days != 1 else ''} overdue"
    elif rule.trigger == "priority_changed":
        when = f"When priority changes to {PRIORITY_NAMES.get(t['priority'])}" if t.get("priority") else "When priority changes"
    else:
        when = "When someone is assigned"
    cfg = rule.action_config
    do = {
        "assign": "assign it",
        "notify": "notify people",
        "set_priority": f"set priority to {PRIORITY_NAMES.get(cfg.get('priority'), '')}",
        "set_status": f"move it to {cfg.get('status_name')}",
        "escalate": "tell the assignees' managers" + (" and the managers above them" if cfg.get("levels") == 2 else ""),
        "add_tag": f"add the tag {cfg.get('tag')}",
    }[rule.action]
    return f"{when}, {do}"
