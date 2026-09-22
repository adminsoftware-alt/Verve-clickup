from tests.v2.conftest import ok


def hierarchy(api, workspace, as_user, **params):
    return ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", as_user, params=params))


# --- workspaces & members ----------------------------------------------------


def test_creator_owns_the_workspace(api, workspace):
    mine = ok(api.get("/workspaces", "owner"))
    assert [(w["name"], w["role"]) for w in mine] == [("Verve", "owner")]


def test_outsiders_cannot_see_a_workspace(api, workspace):
    assert api.get(f"/workspaces/{workspace['id']}/hierarchy", "outsider").status_code == 404


def test_people_who_have_not_signed_in_are_added_as_pending(api, workspace):
    r = api.post(f"/workspaces/{workspace['id']}/members", "owner", {"email": "nobody@example.com"})
    assert r.status_code == 201 and r.json()["user"]["id"].startswith("pending-")


def test_only_the_owner_can_grant_admin(api, workspace):
    ok(api.get("/workspaces", "newbie"))
    r = api.post(
        f"/workspaces/{workspace['id']}/members", "admin", {"email": "newbie@example.com", "role": "admin"}
    )
    assert r.status_code == 403


def test_members_cannot_manage_members(api, workspace):
    assert api.delete(f"/workspaces/{workspace['id']}/members/guest", "member").status_code == 403


def test_the_owner_cannot_be_removed(api, workspace):
    assert api.delete(f"/workspaces/{workspace['id']}/members/owner", "admin").status_code == 400


def test_anyone_can_leave_a_workspace(api, workspace):
    ok(api.delete(f"/workspaces/{workspace['id']}/members/member", "member"), 204)
    assert api.get(f"/workspaces/{workspace['id']}/hierarchy", "member").status_code == 404


# --- structure ---------------------------------------------------------------


def test_new_space_gets_the_default_statuses(api, space):
    statuses = ok(api.get(f"/spaces/{space['id']}/statuses", "owner"))
    assert [(st["name"], st["group"]) for st in statuses["statuses"]] == [
        ("To do", "not_started"),
        ("In progress", "active"),
        ("Complete", "closed"),
    ]
    assert statuses["inherited"] is False


def test_guests_cannot_create_spaces(api, workspace):
    r = api.post(f"/workspaces/{workspace['id']}/spaces", "guest", {"name": "Nope"})
    assert r.status_code == 403


def test_a_new_folder_starts_with_one_list(api, workspace, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Learning"}), 201)
    tree = hierarchy(api, workspace, "owner")
    folder_node = tree["spaces"][0]["folders"][0]
    assert folder_node["id"] == folder["id"]
    assert [lst["name"] for lst in folder_node["lists"]] == ["List"]


def test_subfolders_nest_only_one_level(api, space):
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "HR"}), 201)
    sub = ok(api.post(f"/folders/{folder['id']}/folders", "owner", {"name": "HRBP_Anjali"}), 201)
    assert sub["parent_folder_id"] == folder["id"]
    r = api.post(f"/folders/{sub['id']}/folders", "owner", {"name": "Too deep"})
    assert r.status_code == 400


def test_folderless_list_sits_directly_under_the_space(api, workspace, space, folderless_list):
    tree = hierarchy(api, workspace, "owner")
    assert [lst["name"] for lst in tree["spaces"][0]["lists"]] == ["Backlog"]
    assert tree["spaces"][0]["folders"] == []


def test_tree_is_in_manual_order(api, workspace, space):
    for name in ("Charlie", "Alpha", "Bravo"):
        ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": name}), 201)
    lists = hierarchy(api, workspace, "owner")["spaces"][0]["lists"]
    assert [lst["name"] for lst in lists] == ["Charlie", "Alpha", "Bravo"]


def test_open_task_count_excludes_closed_and_archived(api, workspace, space, folderless_list):
    list_id = folderless_list["id"]
    statuses = {s["name"]: s["id"] for s in ok(api.get(f"/lists/{list_id}/statuses", "owner"))["statuses"]}
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "open"}), 201)
    ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "done", "status_id": statuses["Complete"]}), 201)
    archived = ok(api.post(f"/lists/{list_id}/tasks", "owner", {"name": "old"}), 201)
    ok(api.patch(f"/tasks/{archived['id']}", "owner", {"archived": True}))
    assert hierarchy(api, workspace, "owner")["spaces"][0]["lists"][0]["open_task_count"] == 1


def test_archived_items_are_hidden_unless_requested(api, workspace, space, folderless_list):
    ok(api.patch(f"/lists/{folderless_list['id']}", "owner", {"archived": True}))
    assert hierarchy(api, workspace, "owner")["spaces"][0]["lists"] == []
    shown = hierarchy(api, workspace, "owner", include_archived="true")["spaces"][0]["lists"]
    assert shown[0]["archived"] is True


def test_deleting_a_space_removes_everything_in_it(api, workspace, space, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "t"}), 201)
    ok(api.delete(f"/spaces/{space['id']}", "owner"), 204)
    assert hierarchy(api, workspace, "owner")["spaces"] == []
    assert api.get(f"/lists/{folderless_list['id']}", "owner").status_code == 404


# --- permissions -------------------------------------------------------------


def test_members_see_public_spaces_with_full_access(api, workspace, space):
    tree = hierarchy(api, workspace, "member")
    assert tree["spaces"][0]["permission_level"] == "full"


def test_private_spaces_are_hidden_from_other_members(api, workspace):
    ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "HR & Admin", "is_private": True}), 201)
    assert hierarchy(api, workspace, "member")["spaces"] == []
    assert hierarchy(api, workspace, "admin")["spaces"] == []


def test_guests_see_nothing_until_shared(api, workspace, space, folderless_list):
    assert hierarchy(api, workspace, "guest")["spaces"] == []
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "guest", "level": "view"}), 201)
    tree = hierarchy(api, workspace, "guest")
    assert tree["spaces"] == []
    assert [lst["name"] for lst in tree["shared_with_me"]["lists"]] == ["Backlog"]


def test_spaces_cannot_be_shared_with_guests(api, space):
    r = api.post(f"/spaces/{space['id']}/shares", "owner", {"user_id": "guest", "level": "view"})
    assert r.status_code == 400


def test_a_list_shared_from_a_private_space_appears_in_shared_with_me(api, workspace):
    hr = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "HR", "is_private": True}), 201)
    lst = ok(api.post(f"/spaces/{hr['id']}/lists", "owner", {"name": "Accurest Task"}), 201)
    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    tree = hierarchy(api, workspace, "member")
    assert tree["spaces"] == []
    shared = tree["shared_with_me"]["lists"]
    assert [(x["name"], x["permission_level"]) for x in shared] == [("Accurest Task", "edit")]


def test_view_access_can_read_but_not_edit(api, space, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    assert ok(api.get(f"/lists/{folderless_list['id']}", "member"))["permission_level"] == "view"
    assert api.patch(f"/lists/{folderless_list['id']}", "member", {"name": "Renamed"}).status_code == 403


def test_edit_access_cannot_archive_or_delete(api, space, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    ok(api.patch(f"/lists/{folderless_list['id']}", "member", {"name": "Renamed"}))
    assert api.patch(f"/lists/{folderless_list['id']}", "member", {"archived": True}).status_code == 403
    assert api.delete(f"/lists/{folderless_list['id']}", "member").status_code == 403


def test_sharing_cannot_escalate_beyond_your_own_level(api, space, folderless_list):
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    r = api.post(f"/lists/{folderless_list['id']}/shares", "member", {"user_id": "guest", "level": "full"})
    assert r.status_code == 403
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "member", {"user_id": "guest", "level": "edit"}), 201)


def test_making_something_private_keeps_the_person_who_did_it(api, workspace, space):
    ok(api.patch(f"/spaces/{space['id']}", "member", {"is_private": True}))
    assert hierarchy(api, workspace, "member")["spaces"][0]["name"] == "Operations"
    assert hierarchy(api, workspace, "admin")["spaces"] == []
    assert hierarchy(api, workspace, "owner")["spaces"][0]["name"] == "Operations"  # creator
