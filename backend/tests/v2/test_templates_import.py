from datetime import datetime, timedelta, timezone

import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR & Admin"}), 201)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Hiring"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Onboarding"}), 201)
    ok(api.put(f"/lists/{lst['id']}/statuses", "owner", {"statuses": [
        {"name": "to do", "color": "#87909e", "group": "not_started"},
        {"name": "waiting on docs", "color": "#f59e0b", "group": "active"},
        {"name": "done", "color": "#008844", "group": "closed"},
    ]}))
    ok(api.post(f"/lists/{lst['id']}/groups", "owner", {"name": "Paperwork"}), 201)
    tier = ok(api.post(f"/lists/{lst['id']}/fields", "owner", {"name": "Grade", "type": "dropdown",
                                                               "config": {"options": [{"name": "Intern"}, {"name": "Associate"}]}}), 201)
    due = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {
        "name": "New joiner kit", "priority": 2, "tags": ["onboarding"], "assignees": ["member"], "due_date": due,
    }), 201)
    statuses = ok(api.get(f"/lists/{lst['id']}/statuses", "owner"))["statuses"]
    ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": statuses[1]["id"]}))
    ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Laptop", "parent_id": task["id"]}), 201)
    ok(api.post(f"/tasks/{task['id']}/checklists", "owner", {"name": "Documents", "items": ["PAN", "Aadhaar"]}), 201)
    ok(api.put(f"/tasks/{task['id']}/fields/{tier['id']}", "owner", {"value": tier["config"]["options"][1]["id"]}))
    return {"ws": ws, "space": space, "folder": folder, "list": lst, "task": task, "tier": tier}


def test_list_template_round_trip(api, org):
    t = ok(api.post(f"/lists/{org['list']['id']}/save-template", "owner", {"name": "Joiner checklist"}), 201)
    assert (t["kind"], t["task_count"], t["field_count"]) == ("list", 2, 1)
    assert [x["name"] for x in ok(api.get(f"/workspaces/{org['ws']}/templates", "member"))] == ["Joiner checklist"]

    made = ok(api.post(f"/templates/{t['id']}/apply", "owner", {"folder_id": org["folder"]["id"], "name": "Onboarding — Riya"}), 201)
    new_list = made["id"]
    got = ok(api.get(f"/lists/{new_list}", "owner"))
    assert got["name"] == "Onboarding — Riya" and got["folder_id"] == org["folder"]["id"]
    # Its own statuses, groups and fields came along...
    assert [st["name"] for st in ok(api.get(f"/lists/{new_list}/statuses", "owner"))["statuses"]] == ["to do", "waiting on docs", "done"]
    assert [g["name"] for g in ok(api.get(f"/lists/{new_list}/groups", "owner"))] == ["Paperwork"]
    fields = ok(api.get(f"/lists/{new_list}/fields", "owner"))
    assert [f["name"] for f in fields] == ["Grade"] and fields[0]["id"] != org["tier"]["id"]
    # ...and the tasks, with status, subtask, checklist, tags, field value and a remapped due date.
    tasks = ok(api.get(f"/lists/{new_list}/tasks", "owner"))["tasks"]
    parent = next(x for x in tasks if x["name"] == "New joiner kit")
    assert parent["status"]["name"] == "waiting on docs" and parent["priority"] == 2
    assert [tag["name"] for tag in parent["tags"]] == ["onboarding"] and parent["checklist_total"] == 2
    assert parent["assignees"] == []  # assignees aren't kept unless asked
    assert parent["custom_fields"][fields[0]["id"]] == fields[0]["config"]["options"][1]["id"]
    due = datetime.fromisoformat(parent["due_date"])
    assert timedelta(days=2) < due - datetime.now(timezone.utc) < timedelta(days=4)
    assert next(x for x in tasks if x["name"] == "Laptop")["parent_id"] == parent["id"]
    assert ok(api.get(f"/workspaces/{org['ws']}/templates", "owner"))[0]["use_count"] == 1


def test_task_and_folder_templates(api, org):
    t = ok(api.post(f"/tasks/{org['task']['id']}/save-template", "owner", {"include_assignees": True, "include_dates": False}), 201)
    assert t["name"] == "New joiner kit" and t["task_count"] == 2
    made = ok(api.post(f"/templates/{t['id']}/apply", "owner", {"list_id": org["list"]["id"], "name": "Joiner kit — Arjun"}), 201)
    task = ok(api.get(f"/tasks/{made['id']}", "owner"))
    assert task["name"] == "Joiner kit — Arjun" and [a["id"] for a in task["assignees"]] == ["member"] and task["due_date"] is None
    assert task["subtask_count"] == 1

    # A Folder template brings its Lists instead of the empty starter List.
    ok(api.post(f"/folders/{org['folder']['id']}/lists", "owner", {"name": "Offers"}), 201)
    ft = ok(api.post(f"/folders/{org['folder']['id']}/save-template", "owner", {"name": "Hiring pipeline"}), 201)
    made = ok(api.post(f"/templates/{ft['id']}/apply", "owner", {"space_id": org["space"]["id"]}), 201)
    tree = ok(api.get(f"/workspaces/{org['ws']}/hierarchy", "owner"))
    space = next(sp for sp in tree["spaces"] if sp["id"] == org["space"]["id"])
    copy = next(f for f in space["folders"] if f["id"] == made["id"])
    assert copy["name"] == "Hiring" and sorted(lst["name"] for lst in copy["lists"]) == ["List", "Offers"]


def test_template_visibility_and_permissions(api, org):
    private = ok(api.post(f"/lists/{org['list']['id']}/save-template", "member", {"name": "Mine", "is_private": True}), 201)
    shared = ok(api.post(f"/lists/{org['list']['id']}/save-template", "member", {"name": "Ours"}), 201)
    assert [x["name"] for x in ok(api.get(f"/workspaces/{org['ws']}/templates", "owner"))] == ["Ours"]
    assert api.post(f"/templates/{private['id']}/apply", "owner", {"space_id": org["space"]["id"]}).status_code == 404
    # Only the creator or an admin may change or delete a template.
    assert api.patch(f"/templates/{shared['id']}", "admin", {"name": "Team kit"}).status_code == 200
    assert api.delete(f"/templates/{shared['id']}", "guest").status_code == 404
    ok(api.delete(f"/templates/{shared['id']}", "member"), 204)
    # Guests can't see templates; creating needs full access where it lands.
    assert ok(api.get(f"/workspaces/{org['ws']}/templates", "guest")) == []
    ok(api.patch(f"/spaces/{org['space']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/spaces/{org['space']['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    r = api.post(f"/templates/{private['id']}/apply", "member", {"space_id": org["space"]["id"]})
    assert r.status_code == 403


def test_csv_import(api, org):
    L = org["list"]["id"]
    tier = org["tier"]
    rows = [
        {"name": "Priya Sharma", "status": "Waiting on docs", "priority": "High", "assignees": "member@example.com",
         "due_date": "15/10/2026", "tags": "intern, batch-2026", "time_estimate": "1h 30m",
         "fields": {tier["id"]: "Intern"}},
        {"name": "Rahul Verma", "status": "Nope", "assignees": "stranger@x.com", "priority": "", "fields": {tier["id"]: "Director"}},
        {"name": "", "status": "to do"},
        {"name": "Bad date", "due_date": "someday"},
        {"name": "Sneha", "start_date": "2026-10-20", "due_date": "2026-10-10"},
    ]
    out = ok(api.post(f"/lists/{L}/import", "owner", {"rows": rows, "tz_offset": -330}))
    assert out["created"] == 3
    assert [(e["row"], e["message"]) for e in out["errors"]] == [
        (3, "The task name is empty"), (4, "Can't read the date “someday” (use YYYY-MM-DD or DD/MM/YYYY)"),
    ]
    assert {w["row"] for w in out["warnings"]} == {2, 5}
    tasks = {t["name"]: t for t in ok(api.get(f"/lists/{L}/tasks", "owner"))["tasks"]}
    priya = tasks["Priya Sharma"]
    assert priya["status"]["name"] == "waiting on docs" and priya["priority"] == 2
    assert [a["id"] for a in priya["assignees"]] == ["member"] and priya["time_estimate_seconds"] == 5400
    assert sorted(t["name"] for t in priya["tags"]) == ["batch-2026", "intern"]
    # 15 Oct, noon in India.
    assert priya["due_date"].startswith("2026-10-15T06:30:00")
    assert priya["custom_fields"][tier["id"]] == tier["config"]["options"][0]["id"]
    rahul = tasks["Rahul Verma"]
    assert rahul["status"]["name"] == "to do" and rahul["assignees"] == [] and tier["id"] not in rahul["custom_fields"]
    assert tasks["Sneha"]["start_date"] is None
    # Importing needs full access to the List.
    ok(api.patch(f"/lists/{L}", "owner", {"is_private": True}))
    ok(api.post(f"/lists/{L}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    assert api.post(f"/lists/{L}/import", "member", {"rows": [{"name": "x"}]}).status_code == 403
