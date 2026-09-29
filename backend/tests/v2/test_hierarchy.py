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


def test_who_may_add_spaces_folders_and_lists(api, workspace, space):
    """Spaces are the admins'; Folders and Lists are the managers'; tasks are everyone's.

    The shape of the work is decided by the people who run the place and the people who lead a
    Team. Everyone else works inside it -- which is what tasks, comments and time are for.
    """
    ws = workspace["id"]
    assert api.post(f"/workspaces/{ws}/spaces", "guest", {"name": "Nope"}).status_code == 403
    refused = api.post(f"/workspaces/{ws}/spaces", "member", {"name": "Mine"})
    assert refused.status_code == 403 and "Only admins" in refused.json()["detail"]
    ok(api.post(f"/workspaces/{ws}/spaces", "admin", {"name": "Admin's"}), 201)

    # An ordinary member adds neither a Folder nor a List -- but works inside both.
    no_folder = api.post(f"/spaces/{space['id']}/folders", "member", {"name": "Mine"})
    assert no_folder.status_code == 403 and "managers" in no_folder.json()["detail"]
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Monthly Review"}), 201)
    no_list = api.post(f"/folders/{folder['id']}/lists", "member", {"name": "Mine to run"})
    assert no_list.status_code == 403 and "managers" in no_list.json()["detail"]
    lst = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Monthly"}), 201)
    ok(api.post(f"/lists/{lst['id']}/tasks", "member", {"name": "A job"}), 201)

    # Leading a Team makes someone a manager: Folders and Lists become theirs, Spaces do not.
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "member_ids": ["member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["member"], "lead_ids": ["member"]}))
    ok(api.post(f"/spaces/{space['id']}/folders", "member", {"name": "Audit work"}), 201)
    ok(api.post(f"/spaces/{space['id']}/lists", "member", {"name": "Audit list"}), 201)
    assert api.post(f"/workspaces/{ws}/spaces", "member", {"name": "Audit space"}).status_code == 403


def test_work_given_to_a_team_is_only_that_team_s(api, workspace, space):
    ws = workspace["id"]
    dev = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Dev", "member_ids": ["member"]}), 201)
    hr = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["admin"]}), 201)
    folder = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": "Monthly Review"}), 201)
    dev_list = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "PMS - Dev"}), 201)
    hr_list = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "PMS - HR"}), 201)

    # Before anyone is given it, both Lists are the whole workspace's.
    assert {"PMS - Dev", "PMS - HR"} <= {l["name"] for l in hierarchy(api, workspace, "member")["spaces"][0]["folders"][0]["lists"]}

    out = ok(api.put(f"/lists/{dev_list['id']}/team", "owner", {"team_id": dev["id"]}))
    assert out["team"]["name"] == "Dev"
    ok(api.put(f"/lists/{hr_list['id']}/team", "owner", {"team_id": hr["id"]}))

    # The Dev person sees their own List and not HR's; the HR person the other way round.
    mine = hierarchy(api, workspace, "member")["spaces"][0]["folders"][0]["lists"]
    names = [l["name"] for l in mine]
    assert "PMS - Dev" in names and "PMS - HR" not in names
    assert next(l for l in mine if l["name"] == "PMS - Dev")["team"]["name"] == "Dev"
    assert api.get(f"/lists/{hr_list['id']}/tasks", "member").status_code == 404
    ok(api.get(f"/lists/{dev_list['id']}/tasks", "member"))

    # Owners and admins run the place, so they still see everything.
    for boss in ("owner", "admin"):
        seen = {l["name"] for l in hierarchy(api, workspace, boss)["spaces"][0]["folders"][0]["lists"]}
        assert {"PMS - Dev", "PMS - HR"} <= seen

    # A whole Space can belong to a Team too, and then nothing inside it shows to others.
    theirs = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Dev Space"}), 201)
    ok(api.post(f"/spaces/{theirs['id']}/lists", "owner", {"name": "Sprint"}), 201)
    ok(api.put(f"/spaces/{theirs['id']}/team", "owner", {"team_id": dev["id"]}))
    assert "Dev Space" in {sp["name"] for sp in hierarchy(api, workspace, "member")["spaces"]}
    ok(api.get("/workspaces", "outsider2"))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": "outsider2@example.com", "role": "member"}), 201)
    assert "Dev Space" not in {sp["name"] for sp in hierarchy(api, workspace, "outsider2")["spaces"]}

    # Giving it back opens it up again.
    ok(api.put(f"/lists/{hr_list['id']}/team", "owner", {"team_id": None}))
    assert "PMS - HR" in {l["name"] for l in hierarchy(api, workspace, "member")["spaces"][0]["folders"][0]["lists"]}
    # A member can't hand work to a Team they don't lead.
    assert api.put(f"/lists/{dev_list['id']}/team", "member", {"team_id": hr["id"]}).status_code in (403, 404)


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
    """Edit access shapes the work inside a List; it does not dispose of the List."""
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    ok(api.patch(f"/lists/{folderless_list['id']}", "member", {"description": "GST filings for October"}))
    # The name is what everyone else navigates by, so it went to admins with Delete.
    assert api.patch(f"/lists/{folderless_list['id']}", "member", {"name": "Renamed"}).status_code == 403
    assert api.patch(f"/lists/{folderless_list['id']}", "member", {"archived": True}).status_code == 403
    assert api.delete(f"/lists/{folderless_list['id']}", "member").status_code == 403


def test_sharing_cannot_escalate_beyond_your_own_level(api, workspace, space, folderless_list):
    """Nobody hands out more than they hold -- and only managers hand out a List at all."""
    ws = workspace["id"]
    # An ordinary member shares nothing above a task, whatever access they were given.
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    refused = api.post(f"/lists/{folderless_list['id']}/shares", "member", {"user_id": "guest", "level": "view"})
    assert refused.status_code == 403 and "managers" in refused.json()["detail"]

    # Leading a Team makes them a manager, and then their own level is the ceiling.
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Audit", "member_ids": ["member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["member"], "lead_ids": ["member"]}))
    r = api.post(f"/lists/{folderless_list['id']}/shares", "member", {"user_id": "guest", "level": "full"})
    assert r.status_code == 403
    ok(api.post(f"/lists/{folderless_list['id']}/shares", "member", {"user_id": "guest", "level": "edit"}), 201)


def test_only_admins_share_a_space(api, space):
    """A Space is a part of the firm, so handing one out is an admin's to do."""
    refused = api.post(f"/spaces/{space['id']}/shares", "member", {"user_id": "guest", "level": "view"})
    assert refused.status_code == 403 and "admins" in refused.json()["detail"]
    ok(api.post(f"/spaces/{space['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)


def test_renaming_and_deleting_are_an_admins_to_do(api, space, folderless_list):
    """Everyone who can see a public Space resolves to full access on it.

    That is ClickUp's model and we keep it -- it is what makes shared work shared. But it means
    the Delete on a Space menu was live for every intern, and a Space takes its Folders, its Lists
    and every task with it when it goes. So the two that cannot be undone by the next person to
    look -- the name everybody navigates by, and the deletion -- are admin work. Everything else
    an employee could already do, they still can.
    """
    assert api.get(f"/spaces/{space['id']}", "member").json()["permission_level"] == "full"

    for path in (f"/spaces/{space['id']}", f"/lists/{folderless_list['id']}"):
        refused = api.patch(path, "member", {"name": "Renamed by an employee"})
        assert refused.status_code == 403 and "admins" in refused.json()["detail"]
        gone = api.delete(path, "member")
        assert gone.status_code == 403 and "admins" in gone.json()["detail"]

    # The rest of the same call is still theirs: a colour or a description costs nothing if wrong.
    ok(api.patch(f"/spaces/{space['id']}", "member", {"color": "#0ea5e9"}))

    ok(api.patch(f"/spaces/{space['id']}", "owner", {"name": "Renamed by an admin"}))
    assert api.get(f"/spaces/{space['id']}", "owner").json()["name"] == "Renamed by an admin"
    assert api.delete(f"/lists/{folderless_list['id']}", "owner").status_code == 204


def test_making_something_private_keeps_the_person_who_did_it(api, workspace, space):
    ok(api.patch(f"/spaces/{space['id']}", "member", {"is_private": True}))
    assert hierarchy(api, workspace, "member")["spaces"][0]["name"] == "Operations"
    assert hierarchy(api, workspace, "admin")["spaces"] == []
    assert hierarchy(api, workspace, "owner")["spaces"][0]["name"] == "Operations"  # creator
