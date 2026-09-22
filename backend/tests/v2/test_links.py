import pytest

from tests.v2.conftest import ok


@pytest.fixture
def org(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Finance"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Month end"}), 201)
    other = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Audit"}), 201)
    st = {x["group"]: x for x in ok(api.get(f"/lists/{lst['id']}/statuses", "owner"))["statuses"]}
    t = lambda name, where=lst, **kw: ok(api.post(f"/lists/{where['id']}/tasks", "owner", {"name": name, **kw}), 201)  # noqa: E731
    return {"ws": ws, "lst": lst, "other": other, "st": st, "t": t}


def test_dependencies_and_counts(api, org):
    close, recon, report = org["t"]("Close books"), org["t"]("Reconcile bank"), org["t"]("Board report")
    # Close books waits on Reconcile; Board report waits on Close books.
    out = ok(api.post(f"/tasks/{close['id']}/links", "owner", {"other_id": recon["id"], "kind": "waiting_on"}), 201)
    assert [x["name"] for x in out["waiting_on"]] == ["Reconcile bank"]
    ok(api.post(f"/tasks/{close['id']}/links", "owner", {"other_id": report["id"], "kind": "blocking"}), 201)
    got = ok(api.get(f"/tasks/{close['id']}", "owner"))
    assert (got["waiting_on_open"], got["blocking_count"]) == (1, 1)
    assert [x["name"] for x in ok(api.get(f"/tasks/{recon['id']}/links", "owner"))["blocking"]] == ["Close books"]
    # No loops.
    r = api.post(f"/tasks/{report['id']}/links", "owner", {"other_id": recon["id"], "kind": "blocking"})
    assert r.status_code == 400 and "loop" in r.json()["detail"]
    assert api.post(f"/tasks/{close['id']}/links", "owner", {"other_id": close["id"], "kind": "relates"}).status_code == 400
    # Finishing the blocker clears the warning.
    ok(api.patch(f"/tasks/{recon['id']}", "owner", {"status_id": org["st"]["closed"]["id"]}))
    assert ok(api.get(f"/tasks/{close['id']}", "owner"))["waiting_on_open"] == 0
    history = ok(api.get(f"/tasks/{close['id']}/activity", "owner"))
    assert [h["data"]["kind"] for h in history if h["kind"] == "dependency"] == ["waiting_on", "blocking"]


def test_links_are_symmetric_and_respect_privacy(api, org):
    a, b = org["t"]("Policy draft"), org["t"]("Policy review", where=org["other"])
    ok(api.post(f"/tasks/{a['id']}/links", "owner", {"other_id": b["id"], "kind": "relates"}), 201)
    ok(api.post(f"/tasks/{b['id']}/links", "owner", {"other_id": a["id"], "kind": "relates"}), 201)  # no duplicate
    links_a = ok(api.get(f"/tasks/{a['id']}/links", "owner"))["linked"]
    assert [x["name"] for x in links_a] == ["Policy review"]
    assert ok(api.get(f"/tasks/{b['id']}", "owner"))["link_count"] == 1
    # The member can't see the Audit List once it's private, so the link is hidden for them.
    ok(api.patch(f"/lists/{org['other']['id']}", "owner", {"is_private": True}))
    assert ok(api.get(f"/tasks/{a['id']}/links", "member"))["linked"] == []
    assert api.post(f"/tasks/{a['id']}/links", "member", {"other_id": b["id"], "kind": "relates"}).status_code == 404
    ok(api.delete(f"/links/{links_a[0]['link_id']}", "owner"), 204)
    assert ok(api.get(f"/tasks/{a['id']}/links", "owner"))["linked"] == []


def test_merging_duplicates(api, org):
    keep = org["t"]("Pay GST", assignees=["member"], tags=["tax"], description="Monthly return")
    dup = org["t"]("Pay GST (dup)", assignees=["admin"], tags=["urgent"], description="Also due 20th")
    far = org["t"]("GST payment", where=org["other"])
    sub = ok(api.post(f"/lists/{org['lst']['id']}/tasks", "owner", {"name": "Download challan", "parent_id": dup["id"]}), 201)
    ok(api.post(f"/tasks/{dup['id']}/comments", "owner", {"body": "Amount is 1.2L"}), 201)
    ok(api.post(f"/tasks/{dup['id']}/checklists", "owner", {"name": "Steps", "items": ["Login", "Pay"]}), 201)
    blocker = org["t"]("Get approval")
    ok(api.post(f"/tasks/{dup['id']}/links", "owner", {"other_id": blocker["id"], "kind": "waiting_on"}), 201)

    merged = ok(api.post(f"/tasks/{keep['id']}/merge", "owner", {"source_ids": [dup["id"], far["id"]]}))
    assert sorted(a["id"] for a in merged["assignees"]) == ["admin", "member"]
    assert sorted(t["name"] for t in merged["tags"]) == ["tax", "urgent"]
    assert "Also due 20th" in merged["description"] and merged["subtask_count"] == 1
    assert merged["checklist_total"] == 2 and merged["comment_count"] == 1 and merged["waiting_on_open"] == 1
    assert ok(api.get(f"/tasks/{sub['id']}", "owner"))["parent_id"] == keep["id"]
    assert api.get(f"/tasks/{dup['id']}", "owner").status_code == 404
    assert api.get(f"/tasks/{far['id']}", "owner").status_code == 404
    history = ok(api.get(f"/tasks/{keep['id']}/activity", "owner"))
    assert history[-1]["kind"] == "merged" and history[-1]["data"]["names"] == ["Pay GST (dup)", "GST payment"]
    # Can't merge into your own subtask, and you need full access to what disappears.
    child = ok(api.post(f"/lists/{org['lst']['id']}/tasks", "owner", {"name": "Child", "parent_id": keep["id"]}), 201)
    assert api.post(f"/tasks/{child['id']}/merge", "owner", {"source_ids": [keep["id"]]}).status_code == 400
    ok(api.patch(f"/lists/{org['lst']['id']}", "owner", {"is_private": True}))
    ok(api.post(f"/lists/{org['lst']['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    other = org["t"]("Another")
    assert api.post(f"/tasks/{keep['id']}/merge", "member", {"source_ids": [other["id"]]}).status_code == 403
