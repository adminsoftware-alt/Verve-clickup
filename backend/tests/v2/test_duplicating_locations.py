"""Duplicating a Space, a Folder or a List: where it goes, and what goes with it."""
from tests.v2.conftest import ok


def tree_of(api, workspace, who="owner"):
    return ok(api.get(f"/workspaces/{workspace['id']}/hierarchy", who))


def space_in(tree, space_id):
    return next(sp for sp in tree["spaces"] if sp["id"] == space_id)


def folder_named(tree, space_id, name):
    return next(f for f in space_in(tree, space_id)["folders"] if f["name"] == name)


def _stocked(api, space_id):
    """A Folder with a List in it and two tasks in that, so a copy has something to carry."""
    folder = ok(api.post(f"/spaces/{space_id}/folders", "owner", {"name": "Attending Special Events"}), 201)
    lst = ok(api.post(f"/folders/{folder['id']}/lists", "owner", {"name": "Special Events - HR"}), 201)
    for name in ("Book the hall", "Order the catering"):
        ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": name, "assignees": ["member"]}), 201)
    return folder, lst


def test_a_duplicated_folder_brings_its_lists_and_their_tasks(api, workspace, space):
    """"It just made another folder" is the bug this guards: the copy has to hold the work."""
    folder, _ = _stocked(api, space["id"])

    copy = ok(api.post(f"/folders/{folder['id']}/duplicate", "owner", {"name": "Special Events (copy)"}), 201)
    assert copy["id"] != folder["id"] and copy["name"] == "Special Events (copy)"

    tree = tree_of(api, workspace)
    source = folder_named(tree, space["id"], "Attending Special Events")
    made = folder_named(tree, space["id"], "Special Events (copy)")
    # Every List the original holds, the copy holds -- including the empty one a new Folder starts with.
    assert [l["name"] for l in made["lists"]] == [l["name"] for l in source["lists"]]

    theirs = next(l for l in made["lists"] if l["name"] == "Special Events - HR")
    mine = next(l for l in source["lists"] if l["name"] == "Special Events - HR")
    assert theirs["id"] != mine["id"]

    tasks = ok(api.get(f"/lists/{theirs['id']}/tasks", "owner"))["tasks"]
    assert sorted(t["name"] for t in tasks) == ["Book the hall", "Order the catering"]
    # Its own work, not a second view of the original's: same names, different rows.
    originals = {t["id"] for t in ok(api.get(f"/lists/{mine['id']}/tasks", "owner"))["tasks"]}
    assert originals.isdisjoint({t["id"] for t in tasks})


def test_a_list_lands_where_it_was_told_to_land(api, workspace, space):
    """It used to take a destination and then copy beside the original anyway.

    Asking where something should go and then not going there is worse than never asking.
    """
    _, lst = _stocked(api, space["id"])
    elsewhere = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Archive"}), 201)
    into = ok(api.post(f"/spaces/{elsewhere['id']}/folders", "owner", {"name": "Last year"}), 201)

    copy = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner",
                       {"name": "Special Events - HR (copy)", "folder_id": into["id"]}), 201)

    tree = tree_of(api, workspace)
    landed = folder_named(tree, elsewhere["id"], "Last year")
    assert "Special Events - HR (copy)" in [l["name"] for l in landed["lists"]]
    assert ok(api.get(f"/lists/{copy['id']}/tasks", "owner"))["total"] == 2

    # And it did not also land beside the original.
    home = space_in(tree, space["id"])
    everywhere_else = [l["name"] for f in home["folders"] for l in f["lists"]] + [l["name"] for l in home["lists"]]
    assert "Special Events - HR (copy)" not in everywhere_else


def test_a_folder_can_be_copied_into_another_space(api, workspace, space):
    folder, _ = _stocked(api, space["id"])
    elsewhere = ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Next year"}), 201)

    copy = ok(api.post(f"/folders/{folder['id']}/duplicate", "owner",
                       {"name": "Special Events 2027", "space_id": elsewhere["id"]}), 201)

    there = space_in(tree_of(api, workspace), elsewhere["id"])
    assert [f["name"] for f in there["folders"]] == ["Special Events 2027"]
    assert there["folders"][0]["id"] == copy["id"]
    # Its List came too, into the new Space rather than pointing back at the old one.
    landed = next(l for l in there["folders"][0]["lists"] if l["name"] == "Special Events - HR")
    assert ok(api.get(f"/lists/{landed['id']}/tasks", "owner"))["total"] == 2


def test_the_structure_can_be_copied_without_the_work_in_it(api, workspace, space):
    """Next quarter's Folder, same shape, none of last quarter's tasks."""
    folder, _ = _stocked(api, space["id"])
    ok(api.post(f"/folders/{folder['id']}/duplicate", "owner", {"name": "Empty shell", "include_tasks": False}), 201)

    made = folder_named(tree_of(api, workspace), space["id"], "Empty shell")
    shell = next(l for l in made["lists"] if l["name"] == "Special Events - HR")
    assert ok(api.get(f"/lists/{shell['id']}/tasks", "owner"))["total"] == 0


def test_unticking_a_part_leaves_it_behind_here_too(api, space):
    """The same Customize the task dialog has, applied to every task in the copy."""
    _, lst = _stocked(api, space["id"])
    copy = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner",
                       {"name": "No names on it", "parts": {"assignees": False}}), 201)
    tasks = ok(api.get(f"/lists/{copy['id']}/tasks", "owner"))["tasks"]
    assert len(tasks) == 2 and all(t["assignees"] == [] for t in tasks)


def test_archived_tasks_stay_behind_unless_asked_for(api, space):
    _, lst = _stocked(api, space["id"])
    tasks = ok(api.get(f"/lists/{lst['id']}/tasks", "owner"))["tasks"]
    ok(api.patch(f"/tasks/{tasks[0]['id']}", "owner", {"archived": True}))

    plain = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner", {"name": "Live work only"}), 201)
    assert ok(api.get(f"/lists/{plain['id']}/tasks", "owner"))["total"] == 1

    everything = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner",
                             {"name": "The lot", "include_archived": True}), 201)
    assert ok(api.get(f"/lists/{everything['id']}/tasks?include_closed=true&include_archived=true", "owner"))["total"] == 2


def test_a_copy_can_be_made_for_named_people_only(api, workspace, space):
    """"Duplicate this for Harish" should not mean duplicating it for the other sixty as well."""
    _, lst = _stocked(api, space["id"])

    copy = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner",
                       {"name": "Harish's copy", "share_with": ["member"]}), 201)

    # It is private, so it is not simply sitting in the Space for everyone.
    assert ok(api.get(f"/lists/{copy['id']}", "owner"))["is_private"] is True
    assert [s["user"]["id"] for s in ok(api.get(f"/lists/{copy['id']}/shares", "owner"))] == ["member"]

    # The person named can open it and finds the work inside.
    assert ok(api.get(f"/lists/{copy['id']}/tasks", "member"))["total"] == 2
    # Somebody else cannot, even though they can see the Space it lives in.
    assert api.get(f"/lists/{copy['id']}", "admin").status_code == 404


def test_naming_nobody_leaves_the_copy_as_open_as_the_original(api, space):
    """The default stays what it was: a Folder or List everyone who can reach it can see."""
    _, lst = _stocked(api, space["id"])
    copy = ok(api.post(f"/lists/{lst['id']}/duplicate", "owner", {"name": "For everyone"}), 201)
    assert ok(api.get(f"/lists/{copy['id']}", "owner"))["is_private"] is False
    assert ok(api.get(f"/lists/{copy['id']}/tasks", "admin"))["total"] == 2


def test_handing_a_copy_out_obeys_the_sharing_rules(api, workspace, space):
    """This is not a side door: a Folder still needs a manager, a Space still needs an admin."""
    folder, _ = _stocked(api, space["id"])
    refused = api.post(f"/folders/{folder['id']}/duplicate", "member",
                       {"name": "Not mine to hand out", "share_with": ["admin"]})
    assert refused.status_code == 403 and "managers" in refused.json()["detail"]


def test_who_may_duplicate_what(api, workspace, space):
    """The same ladder as creating and sharing: a task is anyone's, a Space is an admin's.

    Access is not the test. Everyone who can see a public Space resolves to full access on
    everything in it, so without a role check any intern could copy a Folder of 141 tasks and
    leave the sidebar holding two of everything.
    """
    folder, lst = _stocked(api, space["id"])
    task = ok(api.get(f"/lists/{lst['id']}/tasks", "owner"))["tasks"][0]

    # A member who leads no Team: one task, and nothing above it.
    ok(api.post(f"/tasks/{task['id']}/duplicate", "member", {}), 201)
    for path, word in ((f"/lists/{lst['id']}", "managers"), (f"/folders/{folder['id']}", "managers"),
                       (f"/spaces/{space['id']}", "admins")):
        refused = api.post(f"{path}/duplicate", "member", {"name": "Not mine to copy"})
        assert refused.status_code == 403, path
        assert word in refused.json()["detail"], path

    # Leading a Team makes them a manager: Folders and Lists, but still not a Space.
    team = ok(api.post(f"/workspaces/{workspace['id']}/teams", "owner", {"name": "Accounts", "member_ids": ["member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["member"], "lead_ids": ["member"]}))
    ok(api.post(f"/lists/{lst['id']}/duplicate", "member", {"name": "A manager may"}), 201)
    ok(api.post(f"/folders/{folder['id']}/duplicate", "member", {"name": "So may this"}), 201)
    still = api.post(f"/spaces/{space['id']}/duplicate", "member", {"name": "But not a Space"})
    assert still.status_code == 403 and "admins" in still.json()["detail"]

    # An admin: all four.
    ok(api.post(f"/spaces/{space['id']}/duplicate", "admin", {"name": "An admin may"}), 201)
