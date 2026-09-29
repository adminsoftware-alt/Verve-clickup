"""The statutory compliance calendar: catalogue, clients' obligations, generated tasks and the calendar view."""

from datetime import date

import pytest

from app.db import session as db_session
from app.services.work import compliance
from tests.v2.conftest import ok


@pytest.fixture
def client(api, workspace):
    ws = workspace["id"]
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Clients"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Acme Ltd"}), 201)
    obs = {o["code"]: o for o in ok(api.get(f"/workspaces/{ws}/compliance/obligations", "owner"))}
    return {"ws": ws, "list": lst, "obs": obs}


def test_catalogue_is_seeded_and_editable(api, client):
    obs = client["obs"]
    assert obs["gstr3b"]["due_day"] == 20 and obs["gstr3b"]["frequency"] == "monthly"
    assert obs["tds_return"]["due_months"] == [1, 5, 7, 10]
    ws = client["ws"]
    bad = {**{k: v for k, v in obs["advance_tax"].items() if k != "id"}, "due_months": [6, 9]}
    assert api.put(f"/workspaces/{ws}/compliance/obligations/{obs['advance_tax']['id']}", "owner", bad).status_code == 400
    new = ok(api.post(f"/workspaces/{ws}/compliance/obligations", "owner", {
        "code": "pt_ka", "name": "Professional tax (Karnataka)", "authority": "State", "frequency": "monthly", "due_day": 20}), 201)
    assert new["code"] == "pt_ka"
    assert api.post(f"/workspaces/{ws}/compliance/obligations", "member", {
        "code": "x1", "name": "Xy", "frequency": "monthly", "due_day": 1}).status_code == 403


def test_occurrences_label_the_right_period():
    class Ob:
        frequency, due_day, due_months = "monthly", 20, []

    got = compliance.occurrences(Ob, date(2026, 10, 1), date(2026, 11, 30))
    assert got == [(date(2026, 10, 20), "2026-09", "Sep 2026"), (date(2026, 11, 20), "2026-10", "Oct 2026")]
    Ob.frequency, Ob.due_day, Ob.due_months = "yearly", 31, [9]
    assert compliance.occurrences(Ob, date(2026, 9, 1), date(2026, 9, 30))[0][0] == date(2026, 9, 30)  # no 31 September


def test_client_obligations_make_tasks_once(api, client):
    ws, obs = client["ws"], client["obs"]
    today = date(2026, 10, 1)
    with db_session.new_session() as db:
        from app.db.models import WorkspaceRole
        from app.schemas import outbound as o
        from app.services.work.access import Access
        import uuid as _uuid

        access = Access(db, "owner", _uuid.UUID(ws), WorkspaceRole.owner)
        compliance.add_client(db, access, o.ClientComplianceIn(
            obligation_ids=[obs["gstr3b"]["id"], obs["aoc4"]["id"]], list_id=client["list"]["id"], client_name="Acme Ltd",
            assignee_ids=["member"]), today)
        db.commit()
    tasks = {t["name"]: t for t in ok(api.get(f"/lists/{client['list']['id']}/tasks", "owner"))["tasks"]}
    assert set(tasks) == {"GSTR-3B – Sep 2026 – Acme Ltd", "GSTR-3B – Oct 2026 – Acme Ltd", "AOC-4 (financial statements) – due 30 Oct 2026 – Acme Ltd"}
    t = tasks["GSTR-3B – Sep 2026 – Acme Ltd"]
    assert t["due_date"].startswith("2026-10-20") and [a["id"] for a in t["assignees"]] == ["member"]
    assert {tag["name"] for tag in t["tags"]} == {"compliance", "GST"}
    with db_session.new_session() as db:
        assert compliance.run_due(db, today) == 0  # already made
        assert compliance.run_due(db, date(2026, 11, 1)) == 1  # November's GSTR-3B (for Nov) comes into range
        db.commit()
    cal = ok(api.get(f"/workspaces/{ws}/compliance/calendar", "member", params={"start": "2026-10-01", "end": "2026-10-31"}))
    assert [(i["obligation"], i["period_label"]) for i in cal] == [("GSTR-3B", "Sep 2026"), ("AOC-4 (financial statements)", "due 30 Oct 2026")]
    assert all(i["task_id"] for i in cal)
    assert ok(api.get(f"/workspaces/{ws}/compliance/clients", "member"))[0]["client_name"] == "Acme Ltd"
    assert ok(api.get(f"/workspaces/{ws}/compliance/calendar", "guest", params={"start": "2026-10-01", "end": "2026-10-31"})) == []
