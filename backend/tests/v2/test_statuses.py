from tests.v2.conftest import ok

CUSTOM = [
    {"name": "Open", "color": "#87909e", "group": "not_started"},
    {"name": "Review", "color": "#5b9fef", "group": "active"},
    {"name": "Done", "color": "#46a758", "group": "closed"},
]


def statuses_of(api, path):
    return ok(api.get(f"{path}/statuses", "owner"))


def by_name(status_set):
    return {st["name"]: st for st in status_set["statuses"]}


def test_a_list_inherits_its_spaces_statuses(api, space, folderless_list):
    result = statuses_of(api, f"/lists/{folderless_list['id']}")
    assert result["inherited"] is True
    assert result["source"] == {"kind": "space", "id": space["id"]}


def test_a_list_inherits_a_folder_override(api, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Reviews"}), 201)
    ok(api.put(f"/folders/{folder['id']}/statuses", "owner", {"statuses": CUSTOM}))
    lst = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Team HR"}), 201)
    result = statuses_of(api, f"/lists/{lst['id']}")
    assert result["source"] == {"kind": "folder", "id": folder["id"]}
    assert list(by_name(result)) == ["Open", "Review", "Done"]


def test_a_subfolder_inherits_its_parent_folder(api, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "HR"}), 201)
    ok(api.put(f"/folders/{folder['id']}/statuses", "owner", {"statuses": CUSTOM}))
    sub = ok(api.post(f"/folders/{folder['id']}/folders", "owner", {"name": "HRBP"}), 201)
    assert statuses_of(api, f"/folders/{sub['id']}")["source"]["id"] == folder["id"]


def test_status_set_needs_exactly_one_closed_status(api, folderless_list):
    two_closed = CUSTOM + [{"name": "Cancelled", "color": "#e5484d", "group": "closed"}]
    r = api.put(f"/lists/{folderless_list['id']}/statuses", "owner", {"statuses": two_closed})
    assert r.status_code == 400


def test_status_set_needs_an_open_status(api, folderless_list):
    only_closed = [{"name": "Done", "color": "#46a758", "group": "closed"}]
    r = api.put(f"/lists/{folderless_list['id']}/statuses", "owner", {"statuses": only_closed})
    assert r.status_code == 400


def test_status_names_are_unique_ignoring_case(api, folderless_list):
    dupes = CUSTOM + [{"name": "open", "color": "#87909e", "group": "active"}]
    r = api.put(f"/lists/{folderless_list['id']}/statuses", "owner", {"statuses": dupes})
    assert r.status_code == 400


def test_overriding_statuses_remaps_tasks_by_group(api, folderless_list):
    list_id = folderless_list["id"]
    task = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "t"}), 201)
    assert task["status"]["name"] == "To do"
    ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": CUSTOM}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["status"]["name"] == "Open"


def test_explicit_mapping_beats_the_automatic_choice(api, space, folderless_list):
    list_id = folderless_list["id"]
    own = ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": CUSTOM}))
    task = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "t"}), 201)
    assert task["status"]["name"] == "Open"

    # Reverting to the Space's set would put an "Open" (not started) task in "To do".
    space_in_progress = by_name(statuses_of(api, f"/spaces/{space['id']}"))["In progress"]["id"]
    mapping = {by_name(own)["Open"]["id"]: space_in_progress}
    ok(api.put(f"/lists/{list_id}/statuses", "owner", {"inherit": True, "mapping": mapping}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["status"]["name"] == "In progress"


def test_matching_names_survive_a_replacement(api, folderless_list):
    list_id = folderless_list["id"]
    in_progress = by_name(statuses_of(api, f"/lists/{list_id}"))["In progress"]["id"]
    task = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "t", "status_id": in_progress}), 201)
    renamed = [
        {"name": "Backlog", "color": "#87909e", "group": "not_started"},
        {"name": "In Progress", "color": "#5b9fef", "group": "active"},
        {"name": "Shipped", "color": "#46a758", "group": "closed"},
    ]
    ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": renamed}))
    assert ok(api.get(f"/tasks/{task['id']}", "owner"))["status"]["name"] == "In Progress"


def test_a_space_cannot_inherit(api, space):
    assert api.put(f"/spaces/{space['id']}/statuses", "owner", {"inherit": True}).status_code == 400


def test_moving_a_status_into_done_stamps_its_tasks(api, folderless_list):
    list_id = folderless_list["id"]
    own = ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": CUSTOM}))
    review = by_name(own)["Review"]
    task = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "t", "status_id": review["id"]}), 201)
    assert task["date_done"] is None
    changed = [dict(st, id=own_st["id"]) for st, own_st in zip(CUSTOM, own["statuses"])]
    changed[1]["group"] = "done"
    ok(api.put(f"/lists/{list_id}/statuses", "owner", {"statuses": changed}))
    task = ok(api.get(f"/tasks/{task['id']}", "owner"))
    assert task["status"]["group"] == "done" and task["date_done"] is not None


def test_only_full_access_can_change_statuses(api, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    r = api.put(f"/lists/{folderless_list['id']}/statuses", "member", {"statuses": CUSTOM})
    assert r.status_code == 403
