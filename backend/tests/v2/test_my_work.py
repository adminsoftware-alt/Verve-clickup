from tests.v2.conftest import ok


def new_task(api, list_id, as_user="owner", **fields):
    return ok(api.post(f"/lists/{list_id}/tasks", as_user, {"name": "Task", **fields}), 201)


def names(page):
    return sorted(t["name"] for t in page["tasks"])


def test_my_tasks_lists_only_tasks_assigned_to_me(api, workspace, folderless_list):
    new_task(api, folderless_list["id"], name="mine", assignees=["member"])
    new_task(api, folderless_list["id"], name="shared", assignees=["member", "owner"])
    new_task(api, folderless_list["id"], name="theirs", assignees=["owner"])
    new_task(api, folderless_list["id"], name="nobody")
    assert names(ok(api.get(f"/workspaces/{workspace['id']}/my-tasks", "member"))) == ["mine", "shared"]


def test_my_tasks_spans_spaces_and_skips_closed_unless_asked(api, workspace, folderless_list):
    other = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "HR"}), 201)
    other_list = ok(api.post(f"/spaces/{other['id']}/lists", "owner", {"name": "Hiring"}), 201)
    new_task(api, folderless_list["id"], name="ops", assignees=["member"])
    done = new_task(api, other_list["id"], name="hr", assignees=["member"])
    closed = next(st for st in ok(api.get(f"/lists/{other_list['id']}/statuses", "owner"))["statuses"] if st["group"] == "closed")
    ok(api.patch(f"/tasks/{done['id']}", "owner", {"status_id": closed["id"]}))
    url = f"/workspaces/{workspace['id']}/my-tasks"
    assert names(ok(api.get(url, "member"))) == ["ops"]
    assert names(ok(api.get(url, "member", params={"include_closed": True}))) == ["hr", "ops"]


def test_my_tasks_hides_tasks_i_can_no_longer_open(api, workspace, space):
    private = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Board only", "is_private": True}), 201)
    new_task(api, private["id"], name="secret", assignees=["member"])
    assert names(ok(api.get(f"/workspaces/{workspace['id']}/my-tasks", "member"))) == []


def test_personal_list_is_created_once_and_only_its_owner_sees_it(api, workspace):
    url = f"/workspaces/{workspace['id']}/personal-list"
    first = ok(api.post(url, "member"))
    assert first["name"] == "Personal List" and first["permission_level"] == "full"
    assert ok(api.post(url, "member"))["id"] == first["id"]

    tree = ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", "member"))
    assert tree["personal_list"]["id"] == first["id"]
    assert all(sp["name"] != "Personal" for sp in tree["spaces"])  # never shown as a Space

    # Not even the workspace owner can see or open it.
    owner_tree = ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", "owner"))
    assert owner_tree["personal_list"] is None
    assert all(lst["id"] != first["id"] for lst in owner_tree["shared_with_me"]["lists"])
    assert api.get(f"/lists/{first['id']}/tasks", "owner").status_code == 404


def test_personal_list_holds_tasks_and_counts_in_my_tasks(api, workspace):
    lst = ok(api.post(f"/workspaces/{workspace['id']}/personal-list", "member"))
    new_task(api, lst["id"], as_user="member", name="Call bank", assignees=["member"])
    assert names(ok(api.get(f"/lists/{lst['id']}/tasks", "member"))) == ["Call bank"]
    assert names(ok(api.get(f"/workspaces/{workspace['id']}/my-tasks", "member"))) == ["Call bank"]


def test_personal_list_cannot_be_deleted_shared_published_or_extended(api, workspace):
    lst = ok(api.post(f"/workspaces/{workspace['id']}/personal-list", "member"))
    assert api.delete(f"/lists/{lst['id']}", "member").status_code == 400
    assert api.patch(f"/lists/{lst['id']}", "member", {"is_private": False}).status_code == 400
    assert api.post(f"/lists/{lst['id']}/shares", "member", {"user_id": "owner", "level": "view"}).status_code == 400
    assert api.post(f"/spaces/{lst['space_id']}/lists", "member", {"name": "More"}).status_code == 400
    # Renaming is fine.
    assert ok(api.patch(f"/lists/{lst['id']}", "member", {"name": "My stuff"}))["name"] == "My stuff"
