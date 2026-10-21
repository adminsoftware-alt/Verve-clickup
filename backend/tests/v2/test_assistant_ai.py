"""The assistant's AI fallback answers from the asker's own view of the data.

The model is replaced by a stand-in that calls one tool and repeats what it got back, so these
check what the tools hand the model -- the part that decides who sees what -- with no network.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.db import session as db_session
from app.db.models import TimeEntry
from app.services.work import ai_assistant
from tests.v2.conftest import ok


@pytest.fixture
def model(monkeypatch):
    """A model that calls `tool` with `args`, then answers with the tool's JSON."""
    monkeypatch.setattr(settings, "AI_API_KEY", "test-key")
    monkeypatch.setattr(settings, "AI_MODEL", "test-model")
    plan = {}

    def fake(messages):
        last = messages[-1]
        if last["role"] == "tool":
            return {"content": last["content"]}
        return {"content": "", "tool_calls": [{"id": "c1", "type": "function",
                "function": {"name": plan["tool"], "arguments": json.dumps(plan.get("args", {}))}}]}

    monkeypatch.setattr(ai_assistant, "_call_model", fake)
    return plan


def ask(api, workspace, who, question="how many people?"):
    return json.loads(ok(api.post(f"/workspaces/{workspace['id']}/assistant/ask", who, {"question": question}))["answer"])


def test_without_a_key_it_says_so(api, workspace, monkeypatch):
    monkeypatch.setattr(settings, "AI_API_KEY", None)
    r = api.post(f"/workspaces/{workspace['id']}/assistant/ask", "member", {"question": "how many people?"})
    assert r.status_code == 503 and "AI_API_KEY" in r.json()["detail"]


def test_an_outsider_gets_nothing(api, workspace, model):
    model["tool"] = "people"
    assert api.post(f"/workspaces/{workspace['id']}/assistant/ask", "outsider", {"question": "who works here?"}).status_code == 404


def test_people_are_counted_as_the_asker_sees_them(api, workspace, model):
    ws = workspace["id"]
    for uid in ("lead", "other"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Dev", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))
    model["tool"] = "people"
    everyone = ask(api, workspace, "owner")
    led = ask(api, workspace, "lead")
    assert everyone["count"] > led["count"]
    assert "Other" not in [p["name"] for p in led["people"]]
    me = next(p for p in everyone["people"] if p["email"] == "lead@example.com")
    assert me["access"] == "Manager" and me["teams"] == ["Dev"]


def test_an_employee_only_hears_about_their_own_time(api, workspace, folderless_list, model):
    task = ok(api.post(f"/lists/{folderless_list['id']}/tasks", "owner", {"name": "Payroll", "assignee_ids": ["member"]}), 201)
    start = datetime.now(timezone.utc) - timedelta(hours=3)
    with db_session.get_engine().begin() as conn:
        for uid, hours in (("member", 2), ("admin", 5)):
            conn.execute(TimeEntry.__table__.insert().values(
                task_id=task["id"], user_id=uid, started_at=start, ended_at=start + timedelta(hours=hours),
                duration_seconds=hours * 3600, billable=False))
    day = start.date().isoformat()
    model.update(tool="time_logged", args={"date_from": day, "date_to": day})
    assert ask(api, workspace, "member", "how many hours?")["by_person"] == {"Member": 2.0}
    assert ask(api, workspace, "owner", "how many hours?")["total_hours"] == 7.0
    model["args"] = {"date_from": day, "date_to": day, "person": "admin"}
    # Someone outside their view isn't even found, let alone their hours.
    refused = ask(api, workspace, "member", "admin's hours?")
    assert "total_hours" not in refused and "see" in refused["error"]
