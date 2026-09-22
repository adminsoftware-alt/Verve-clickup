import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Clients"}), 201)
    onboarding = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Onboarding"}), 201)
    other = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Billing"}), 201)
    task = ok(api.post(f"/lists/{onboarding['id']}/tasks", "owner", {"name": "Acme Ltd", "assignees": ["member"]}), 201)
    return {"ws": ws, "space": space, "list": onboarding, "other": other, "task": task}


def field(api, where, kind, name, ftype, config=None, who="owner", code=201):
    return ok(api.post(f"/{kind}/{where}/fields", who, {"name": name, "type": ftype, "config": config or {}}), code)


def put(api, task, f, value, who="owner", code=200):
    return ok(api.put(f"/tasks/{task['id']}/fields/{f['id']}", who, {"value": value}), code)


def test_fields_are_inherited_down_the_hierarchy(api, org):
    tier = field(api, org["space"]["id"], "spaces", "Tier", "dropdown", {"options": [{"name": "Gold"}, {"name": "Silver"}]})
    fee = field(api, org["list"]["id"], "lists", "Fee", "money", {"currency": "inr"})
    assert tier["location"] == "space" and [o["name"] for o in tier["config"]["options"]] == ["Gold", "Silver"]
    assert fee["config"] == {"currency": "INR"}
    # The List sees the Space field and its own; its sibling only sees the Space field.
    assert [f["name"] for f in ok(api.get(f"/lists/{org['list']['id']}/fields", "owner"))] == ["Tier", "Fee"]
    assert [f["name"] for f in ok(api.get(f"/lists/{org['other']['id']}/fields", "owner"))] == ["Tier"]
    # A Space view can show every field used below it.
    below = ok(api.get(f"/spaces/{org['space']['id']}/fields", "owner", params={"include_below": True}))
    assert [f["name"] for f in below] == ["Tier", "Fee"]
    # Names are unique along the chain.
    field(api, org["list"]["id"], "lists", "tier", "text", code=400)


def test_setting_values_of_every_type(api, org):
    L = org["list"]["id"]
    tier = field(api, L, "lists", "Tier", "dropdown", {"options": [{"name": "Gold"}, {"name": "Silver"}]})
    tags = field(api, L, "lists", "Services", "labels", {"options": [{"name": "GST"}, {"name": "Audit"}, {"name": "Payroll"}]})
    cases = [
        (field(api, L, "lists", "Notes", "text"), "Signed", "Signed"),
        (field(api, L, "lists", "Employees", "number"), 42, 42),
        (field(api, L, "lists", "Fee", "money"), 125000.5, 125000.5),
        (field(api, L, "lists", "Kick-off", "date"), "2026-10-01T09:30:00+05:30", "2026-10-01T04:00:00+00:00"),
        (field(api, L, "lists", "KYC done", "checkbox"), True, True),
        (field(api, L, "lists", "Contact", "email"), "cfo@acme.in", "cfo@acme.in"),
        (field(api, L, "lists", "Phone", "phone"), "+91 98450 12345", "+91 98450 12345"),
        (field(api, L, "lists", "Website", "url"), "acme.in", "https://acme.in"),
        (field(api, L, "lists", "Health", "rating", {"max": 5}), 4, 4),
        (field(api, L, "lists", "Setup", "progress"), 62.4, 62),
        (field(api, L, "lists", "Account team", "people"), ["member", "admin", "member"], ["member", "admin"]),
    ]
    for f, value, stored in cases:
        assert put(api, org["task"], f, value)["value"] == stored, f["name"]
    gold = tier["config"]["options"][0]["id"]
    put(api, org["task"], tier, gold)
    opts = [o["id"] for o in tags["config"]["options"]]
    assert put(api, org["task"], tags, [opts[2], opts[0], opts[2]])["value"] == [opts[0], opts[2]]  # option order

    detail = ok(api.get(f"/tasks/{org['task']['id']}", "owner"))
    assert len(detail["fields"]) == 13
    assert detail["custom_fields"][tier["id"]] == gold
    listed = ok(api.get(f"/lists/{L}/tasks", "owner"))["tasks"][0]
    assert listed["custom_fields"][cases[0][0]["id"]] == "Signed"

    # Wrong values are refused with a reason.
    bad = [(cases[1][0], "lots"), (tier, "not-an-option"), (cases[5][0], "nope"), (cases[8][0], 6),
           (cases[9][0], 101), (cases[10][0], ["outsider"]), (cases[4][0], "yes")]
    for f, value in bad:
        put(api, org["task"], f, value, code=400)
    # Clearing: null, or an unticked checkbox.
    assert put(api, org["task"], cases[4][0], False)["value"] is None
    put(api, org["task"], cases[0][0], None)
    assert cases[0][0]["id"] not in ok(api.get(f"/tasks/{org['task']['id']}", "owner"))["custom_fields"]


def test_fields_only_apply_where_they_are_defined(api, org):
    fee = field(api, org["list"]["id"], "lists", "Fee", "money")
    elsewhere = ok(api.post(f"/lists/{org['other']['id']}/tasks", "owner", {"name": "Invoice"}), 201)
    r = api.put(f"/tasks/{elsewhere['id']}/fields/{fee['id']}", "owner", {"value": 10})
    assert r.status_code == 400 and "isn't available" in r.json()["detail"]


def test_removing_an_option_clears_it_from_tasks(api, org):
    L = org["list"]["id"]
    tier = field(api, L, "lists", "Tier", "dropdown", {"options": [{"name": "Gold"}, {"name": "Silver"}]})
    tags = field(api, L, "lists", "Services", "labels", {"options": [{"name": "GST"}, {"name": "Audit"}]})
    gold, silver = [o["id"] for o in tier["config"]["options"]]
    gst, audit = [o["id"] for o in tags["config"]["options"]]
    put(api, org["task"], tier, gold)
    put(api, org["task"], tags, [gst, audit])
    # Rename Silver, drop Gold; drop Audit.
    renamed = ok(api.patch(f"/fields/{tier['id']}", "owner", {"config": {"options": [{"id": silver, "name": "Silver+"}]}}))
    assert [(o["id"], o["name"]) for o in renamed["config"]["options"]] == [(silver, "Silver+")]
    ok(api.patch(f"/fields/{tags['id']}", "owner", {"config": {"options": [{"id": gst, "name": "GST"}]}}))
    values = ok(api.get(f"/tasks/{org['task']['id']}", "owner"))["custom_fields"]
    assert tier["id"] not in values and values[tags["id"]] == [gst]
    # Deleting the field deletes its values.
    ok(api.delete(f"/fields/{tags['id']}", "owner"), 204)
    assert tags["id"] not in ok(api.get(f"/tasks/{org['task']['id']}", "owner"))["custom_fields"]


def test_permissions(api, org):
    fee = field(api, org["list"]["id"], "lists", "Fee", "money")
    field(api, org["list"]["id"], "lists", "X", "text", who="guest", code=404)
    ok(api.patch(f"/lists/{org['list']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/lists/{org['list']['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    put(api, org["task"], fee, 5, who="member", code=403)
    field(api, org["list"]["id"], "lists", "Y", "text", who="member", code=403)


def test_history_watchers_duplicates_and_table_views(api, org):
    fee = field(api, org["list"]["id"], "lists", "Fee", "money")
    put(api, org["task"], fee, 900)
    history = ok(api.get(f"/tasks/{org['task']['id']}/activity", "owner"))
    assert any(h["kind"] == "custom_field" and h["data"]["field"] == "Fee" for h in history)
    # The assignee watches the task, so hears about it in Other.
    other = ok(api.get(f"/workspaces/{org['ws']}/inbox", "member", params={"tab": "other"}))
    assert "custom_field" in {i["kind"] for i in other}
    copy = ok(api.post(f"/tasks/{org['task']['id']}/duplicate", "owner", {}), 201)
    assert copy["custom_fields"][fee["id"]] == 900
    view = ok(api.post(f"/lists/{org['list']['id']}/views", "owner", {"type": "table"}), 201)
    assert view["type"] == "table" and view["name"] == "Table"
