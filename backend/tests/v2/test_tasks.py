from datetime import datetime, timedelta, timezone

from tests.v2.conftest import ok


def status_ids(api, list_id):
    return {st["name"]: st["id"] for st in ok(api.get(f"/lists/{list_id}/statuses", "owner"))["statuses"]}


def new_task(api, list_id, as_user="owner", **fields):
    return ok(api.post(f"/lists/{list_id}/tasks", as_user, {"name": "Task", **fields}), 201)


def task_names(api, list_id, as_user="owner", **params):
    page = ok(api.get(f"/lists/{list_id}/tasks", as_user, params=params))
    return [t["name"] for t in page["tasks"]]


def iso(dt):
    return dt.isoformat()


# --- creation & fields -------------------------------------------------------


def test_new_task_starts_in_the_first_not_started_status(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    assert task["status"]["name"] == "To do"
    assert task["location"]["list"]["name"] == "Backlog"
    assert task["location"]["folder"] is None
    assert task["permission_level"] == "full"


def test_priority_must_be_one_to_four(api, folderless_list):
    r = api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "x", "priority": 5})
    assert r.status_code == 422


def test_due_date_cannot_precede_start_date(api, folderless_list):
    now = datetime.now(timezone.utc)
    body = {"name": "x", "start_date": iso(now), "due_date": iso(now - timedelta(days=1))}
    assert api.post(f"/lists/{folderless_list['id']}/tasks", "owner", body).status_code == 422
    task = new_task(api, folderless_list["id"], start_date=iso(now))
    r = api.patch(f"/tasks/{task['id']}", "owner", {"due_date": iso(now - timedelta(days=1))})
    assert r.status_code == 400


def test_status_must_belong_to_the_list(api, workspace, folderless_list):
    other_space = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Other"}), 201)
    foreign = ok(api.get(f"/spaces/{other_space['id']}/statuses", "owner"))["statuses"][0]["id"]
    r = api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "x", "status_id": foreign})
    assert r.status_code == 400


def test_assignees_must_be_workspace_members(api, folderless_list):
    task = new_task(api, folderless_list["id"], assignees=["member", "guest"])
    assert sorted(a["id"] for a in task["assignees"]) == ["guest", "member"]
    r = api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "x", "assignees": ["outsider"]})
    assert r.status_code == 400


def test_tags_are_created_per_space_and_reused_ignoring_case(api, folderless_list):
    first = new_task(api, folderless_list["id"], tags=["monthly"])
    second = new_task(api, folderless_list["id"], tags=["Monthly", "routine work"])
    assert first["tags"][0]["id"] in {t["id"] for t in second["tags"]}
    assert sorted(t["name"] for t in second["tags"]) == ["monthly", "routine work"]


def test_guests_cannot_invent_tags(api, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "guest", "level": "full"}), 201)
    r = api.post(f"/lists/{folderless_list['id']}/tasks", "guest", {"name": "x", "tags": ["brand-new"]})
    assert r.status_code == 403


def test_patch_only_changes_fields_that_were_sent(api, folderless_list):
    task = new_task(api, folderless_list["id"], priority=1, description="keep me")
    updated = ok(api.patch(f"/tasks/{task['id']}", "owner", {"name": "Renamed"}))
    assert (updated["name"], updated["priority"], updated["description"]) == ("Renamed", 1, "keep me")
    cleared = ok(api.patch(f"/tasks/{task['id']}", "owner", {"priority": None}))
    assert cleared["priority"] is None


# --- status groups -----------------------------------------------------------


def test_status_groups_drive_dates_and_overdue(api, folderless_list):
    list_id = folderless_list["id"]
    ids = status_ids(api, list_id)
    yesterday = iso(datetime.now(timezone.utc) - timedelta(days=1))
    task = new_task(api, list_id, due_date=yesterday)
    assert task["is_overdue"] is True

    own = [
        {"name": "To do", "color": "#87909e", "group": "not_started"},
        {"name": "Ready for review", "color": "#46a758", "group": "done"},
        {"name": "Complete", "color": "#008844", "group": "closed"},
    ]
    # The List now owns copies of these statuses, with new ids.
    ids = {s["name"]: s["id"] for s in ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": own}))["statuses"]}
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["status"]["name"] == "To do"  # remapped by name

    done = ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": ids["Ready for review"]}))
    assert done["date_done"] is not None and done["date_closed"] is None
    assert done["is_overdue"] is False  # done tasks are never overdue

    closed = ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": ids["Complete"]}))
    assert closed["date_closed"] is not None and closed["date_done"] == done["date_done"]

    reopened = ok(api.patch(f"/tasks/{task['id']}", "owner", {"status_id": ids["To do"]}))
    assert reopened["date_done"] is None and reopened["date_closed"] is None


def test_closed_tasks_are_hidden_by_default(api, folderless_list):
    list_id = folderless_list["id"]
    new_task(api, list_id, name="open")
    new_task(api, list_id, name="finished", status_id=status_ids(api, list_id)["Complete"])
    assert task_names(api, list_id) == ["open"]
    assert task_names(api, list_id, include_closed="true") == ["open", "finished"]


# --- subtasks ----------------------------------------------------------------


def test_subtasks_track_parent_and_root(api, folderless_list):
    list_id = folderless_list["id"]
    parent = new_task(api, list_id, name="parent")
    child = new_task(api, list_id, name="child", parent_id=parent["id"])
    grandchild = new_task(api, list_id, name="grandchild", parent_id=child["id"])
    assert grandchild["parent_id"] == child["id"]
    assert grandchild["top_level_parent_id"] == parent["id"]
    assert ok(api.get(f"/tasks/{parent['id']}", "owner"))["subtask_count"] == 1
    assert task_names(api, list_id, include_subtasks="false") == ["parent"]


def test_subtasks_must_live_in_their_parents_list(api, space, folderless_list):
    other = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Other"}), 201)
    parent = new_task(api, folderless_list["id"])
    r = api.post(f"/lists/{other['id']}/tasks", "owner", {"name": "x", "parent_id": parent["id"]})
    assert r.status_code == 400


def test_nesting_stops_at_seven_levels(api, folderless_list):
    list_id = folderless_list["id"]
    current = new_task(api, list_id, name="level 0")
    for level in range(1, 8):
        current = new_task(api, list_id, name=f"level {level}", parent_id=current["id"])
    r = api.post(f"/lists/{list_id}/tasks", "owner", {"name": "level 8", "parent_id": current["id"]})
    assert r.status_code == 400


def test_a_task_cannot_become_its_own_descendant(api, folderless_list):
    list_id = folderless_list["id"]
    parent = new_task(api, list_id, name="parent")
    child = new_task(api, list_id, name="child", parent_id=parent["id"])
    assert api.patch(f"/tasks/{parent['id']}", "owner", {"parent_id": child["id"]}).status_code == 400
    assert api.patch(f"/tasks/{parent['id']}", "owner", {"parent_id": parent["id"]}).status_code == 400


def test_reparenting_updates_the_whole_subtree(api, folderless_list):
    list_id = folderless_list["id"]
    a = new_task(api, list_id, name="a")
    b = new_task(api, list_id, name="b")
    b_child = new_task(api, list_id, name="b child", parent_id=b["id"])
    ok(api.patch(f"/tasks/{b['id']}", "owner", {"parent_id": a["id"]}))
    assert ok(api.get(f"/tasks/{b_child['id']}", "owner"))["top_level_parent_id"] == a["id"]
    detached = ok(api.patch(f"/tasks/{b['id']}", "owner", {"parent_id": None}))
    assert detached["parent_id"] is None and detached["top_level_parent_id"] is None
    assert ok(api.get(f"/tasks/{b_child['id']}", "owner"))["top_level_parent_id"] == b["id"]


def test_archiving_a_task_archives_its_subtasks(api, folderless_list):
    list_id = folderless_list["id"]
    parent = new_task(api, list_id, name="parent")
    new_task(api, list_id, name="child", parent_id=parent["id"])
    ok(api.patch(f"/tasks/{parent['id']}", "owner", {"archived": True}))
    assert task_names(api, list_id) == []
    assert sorted(task_names(api, list_id, include_archived="true")) == ["child", "parent"]


def test_deleting_a_task_deletes_its_subtasks(api, folderless_list):
    list_id = folderless_list["id"]
    parent = new_task(api, list_id, name="parent")
    child = new_task(api, list_id, name="child", parent_id=parent["id"])
    ok(api.delete(f"/tasks/{parent['id']}", "owner"), 204)
    assert api.get(f"/tasks/{child['id']}", "owner").status_code == 404


# --- moving ------------------------------------------------------------------


def test_moving_carries_subtasks_statuses_and_tags(api, workspace, folderless_list):
    other_space = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Sales"}), 201)
    target = ok(api.post(f"/spaces/{other_space['id']}/lists", "owner", {"name": "Pipeline"}), 201)
    custom = [
        {"name": "Lead", "color": "#87909e", "group": "not_started"},
        {"name": "Won", "color": "#46a758", "group": "closed"},
    ]
    ok(api.put(f"/lists/{target['id']}/statuses", "owner", {"statuses": custom}))

    parent = new_task(api, folderless_list["id"], name="parent", tags=["monthly"])
    child = new_task(api, folderless_list["id"], name="child", parent_id=parent["id"])
    moved = ok(api.post(f"/tasks/{parent['id']}/move", "owner", {"list_id": target["id"]}))

    assert moved["location"]["space"]["name"] == "Sales"
    assert moved["status"]["name"] == "Lead"
    assert moved["tags"][0]["name"] == "monthly"
    moved_child = ok(api.get(f"/tasks/{child['id']}", "owner"))
    assert moved_child["list_id"] == target["id"] and moved_child["status"]["name"] == "Lead"
    assert task_names(api, folderless_list["id"]) == []


def test_subtasks_cannot_be_moved_on_their_own(api, space, folderless_list):
    other = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Other"}), 201)
    parent = new_task(api, folderless_list["id"])
    child = new_task(api, folderless_list["id"], parent_id=parent["id"])
    assert api.post(f"/tasks/{child['id']}/move", "owner", {"list_id": other["id"]}).status_code == 400


def test_moving_into_a_private_list_drops_assignees_who_lose_access(api, space, folderless_list):
    private = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Private", "is_private": True}), 201)
    task = new_task(api, folderless_list["id"], assignees=["member", "admin"])
    ok(api.post(f"/lists/{private['id']}/shares", "owner", {"user_id": "admin", "level": "edit"}), 201)
    moved = ok(api.post(f"/tasks/{task['id']}/move", "owner", {"list_id": private["id"]}))
    assert [a["id"] for a in moved["assignees"]] == ["admin"]


# --- per-task permissions ----------------------------------------------------


def test_private_tasks_are_hidden_from_other_members(api, folderless_list):
    list_id = folderless_list["id"]
    new_task(api, list_id, name="public")
    secret = new_task(api, list_id, as_user="member", name="secret", is_private=True)
    assert task_names(api, list_id, as_user="member") == ["public", "secret"]  # creator
    assert task_names(api, list_id, as_user="admin") == ["public"]
    assert api.get(f"/tasks/{secret['id']}", "admin").status_code == 404
    ok(api.post(f"/tasks/{secret['id']}/shares", "member", {"user_id": "admin", "level": "view"}), 201)
    assert task_names(api, list_id, as_user="admin") == ["public", "secret"]


def test_subtasks_of_a_private_task_are_hidden_too(api, folderless_list):
    list_id = folderless_list["id"]
    secret = new_task(api, list_id, as_user="member", name="secret", is_private=True)
    new_task(api, list_id, as_user="member", name="secret child", parent_id=secret["id"])
    assert task_names(api, list_id, as_user="admin") == []


def test_a_task_shared_alone_appears_in_shared_with_me(api, workspace, space):
    hr = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "HR", "is_private": True}), 201)
    lst = ok(api.post(f"/spaces/{hr['id']}/lists", "owner", {"name": "Reviews"}), 201)
    task = new_task(api, lst["id"], name="PMS Report")
    ok(api.post(f"/tasks/{task['id']}/shares", "owner", {"user_id": "guest", "level": "comment"}), 201)
    shared = ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", "guest"))["shared_with_me"]
    assert [(t["name"], t["permission_level"]) for t in shared["tasks"]] == [("PMS Report", "comment")]
    assert ok(api.get(f"/tasks/{task['id']}", "guest"))["name"] == "PMS Report"


def test_edit_access_can_update_but_not_create_or_delete(api, folderless_list):
    list_id = folderless_list["id"]
    task = new_task(api, list_id)
    ok(api.post(f"/lists/{list_id}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    ok(api.patch(f"/tasks/{task['id']}", "member", {"name": "edited"}))
    assert api.post(f"/lists/{list_id}/tasks", "member", {"name": "new"}).status_code == 403
    assert api.delete(f"/tasks/{task['id']}", "member").status_code == 403
    assert api.patch(f"/tasks/{task['id']}", "member", {"is_private": True}).status_code == 403


def test_view_access_cannot_edit(api, folderless_list):
    task = new_task(api, folderless_list["id"])
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    assert ok(api.get(f"/tasks/{task['id']}", "member"))["permission_level"] == "view"
    assert api.patch(f"/tasks/{task['id']}", "member", {"name": "nope"}).status_code == 403


# --- listing -----------------------------------------------------------------


def test_listing_is_paginated_in_manual_order(api, folderless_list):
    list_id = folderless_list["id"]
    for i in range(5):
        new_task(api, list_id, name=f"t{i}")
    page = ok(api.get(f"/lists/{list_id}/tasks", "owner", params={"limit": 2, "offset": 2}))
    assert page["total"] == 5
    assert [t["name"] for t in page["tasks"]] == ["t2", "t3"]
