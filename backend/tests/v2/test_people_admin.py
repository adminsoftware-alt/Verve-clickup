"""Bulk import, the joiner checklist, offboarding (leaver SOP), ownership, sign-in rules, photos, audit log."""

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.v2.conftest import ok

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def ws(api, workspace):
    return workspace["id"]


def person(api, ws, uid, as_user="owner"):
    return next(p for p in ok(api.get(f"/workspaces/{ws}/people", as_user)) if p["user"]["id"] == uid)


def by_email(api, ws, email):
    return next(p for p in ok(api.get(f"/workspaces/{ws}/people", "owner")) if p["user"]["email"] == email)


# --- bulk import ----------------------------------------------------------------------------------------


def test_import_adds_people_with_managers_from_the_same_file(api, ws):
    ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR"}), 201)
    rows = [
        {"email": "priya@example.com", "name": "Priya Nair", "designation": "Executive", "manager_email": "ravi@example.com", "teams": "HR"},
        {"email": "ravi@example.com", "name": "Ravi Kumar", "designation": "Manager", "role": "Admin"},
        {"email": "bad@example.com", "role": "Boss"},
        {"email": "priya@example.com", "name": "Twice"},
        {"email": "sam@example.com", "teams": "Nope", "date_of_birth": "1995-04-12"},
    ]
    dry = ok(api.post(f"/workspaces/{ws}/people/import", "owner", {"rows": rows, "dry_run": True}))
    assert (dry["added"], dry["errors"]) == (3, 2)
    assert not any(p["user"]["email"] == "priya@example.com" for p in ok(api.get(f"/workspaces/{ws}/people", "owner")))

    out = ok(api.post(f"/workspaces/{ws}/people/import", "owner", {"rows": rows}))
    assert [r["outcome"] for r in out["rows"]] == ["added", "added", "error", "error", "added"]
    assert "unknown team: Nope" in out["rows"][4]["problems"]
    priya, ravi = by_email(api, ws, "priya@example.com"), by_email(api, ws, "ravi@example.com")
    assert priya["manager_id"] == ravi["user"]["id"] and priya["designation"] == "Executive" and len(priya["team_ids"]) == 1
    assert ravi["role"] == "admin" and priya["pending"] is True
    assert by_email(api, ws, "sam@example.com")["date_of_birth"] == "1995-04-12"

    again = ok(api.post(f"/workspaces/{ws}/people/import", "owner", {"rows": [{"email": "priya@example.com", "designation": "Senior Executive"}]}))
    assert again["updated"] == 1 and by_email(api, ws, "priya@example.com")["designation"] == "Senior Executive"
    assert api.post(f"/workspaces/{ws}/people/import", "member", {"rows": rows}).status_code == 403


# --- joiner checklist --------------------------------------------------------------------------------------


@pytest.fixture
def vapl(api, ws):
    """The SOP's Space: team Lists inside each Folder, plus an HR team."""
    hr = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["admin"]}), 201)
    accounts = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Accounts"}), 201)
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "VAPL Common Operation Tasks"}), 201)
    for folder in ("Attending Special Events", "Learning", "Monthly Review", "Interview & Assessments"):
        f = ok(api.post(f"/spaces/{space['id']}/folders", "owner", {"name": folder}), 201)
        for team in ("HR", "Accounts"):
            ok(api.post(f"/folders/{f['id']}/lists", "owner", {"name": f"{folder.split(' ')[0]} - {team}"}), 201)
    return {"space": space, "hr": hr, "accounts": accounts}


def test_joiner_checklist_follows_the_sop(api, ws, vapl):
    joined = date.today() - timedelta(days=1)
    added = ok(api.post(f"/workspaces/{ws}/people", "owner", {
        "email": "neha@example.com", "name": "Neha Shah", "designation": "Intern", "manager_id": "member",
        "team_ids": [vapl["accounts"]["id"]], "date_of_joining": joined.isoformat(), "date_of_birth": "1999-08-30",
    }), 201)
    uid = added["person"]["user"]["id"]
    preview = {st["key"]: st for st in ok(api.get(f"/workspaces/{ws}/people/{uid}/joiner", "owner"))}
    assert preview["learning"]["outcome"] == "would_create" and preview["learning"]["list_name"] == "Learning - Accounts"
    assert preview["work_anniversary"]["outcome"] == "skipped"  # interns don't get one
    assert preview["marriage_anniversary"]["outcome"] == "skipped" and preview["interview"]["outcome"] == "skipped"
    assert ok(api.get(f"/workspaces/{ws}/people/{uid}/joiner", "owner")) and person(api, ws, uid)["joiner_tasks"] == 0

    steps = {st["key"]: st for st in ok(api.post(f"/workspaces/{ws}/people/{uid}/joiner", "owner"))}
    assert {k for k, st in steps.items() if st["outcome"] == "created"} == {"induction", "special_events", "learning", "monthly_review", "birthday"}
    review = ok(api.get(f"/tasks/{steps['monthly_review']['task_id']}", "owner"))
    assert review["name"] == "Neha Shah's Monthly Review" and review["time_estimate_seconds"] == 165 * 60
    assert {a["id"] for a in review["assignees"]} == {uid, "member", "admin"}  # the person, their manager and HR
    assert review["recurrence"]["frequency"] == "monthly"
    birthday = ok(api.get(f"/tasks/{steps['birthday']['task_id']}", "admin"))
    assert birthday["recurrence"]["frequency"] == "yearly" and birthday["due_date"][5:10] == "08-30"
    assert api.get(f"/tasks/{steps['birthday']['task_id']}", "member").status_code in (403, 404)  # HR-only reminder
    induction = ok(api.get(f"/tasks/{steps['induction']['task_id']}", "owner"))
    assert datetime.fromisoformat(induction["due_date"]).astimezone().weekday() == 1  # a Tuesday
    assert person(api, ws, uid)["joiner_tasks"] == 5
    # Running it again doesn't duplicate anything.
    assert all(st["outcome"] != "created" for st in ok(api.post(f"/workspaces/{ws}/people/{uid}/joiner", "owner")))


def test_joiner_plan_can_be_edited_and_reset(api, ws):
    plan = ok(api.get(f"/workspaces/{ws}/joiner-plan", "owner"))
    assert plan["is_default"] and len(plan["plan"]["rules"]) == 9
    plan["plan"]["rules"] = [r for r in plan["plan"]["rules"] if r["key"] != "interview"]
    saved = ok(api.put(f"/workspaces/{ws}/joiner-plan", "owner", {"plan": plan["plan"]}))
    assert not saved["is_default"] and len(saved["plan"]["rules"]) == 8
    bad = dict(plan["plan"], rules=[dict(plan["plan"]["rules"][0], when="sometimes")])
    assert api.put(f"/workspaces/{ws}/joiner-plan", "owner", {"plan": bad}).status_code == 400
    assert api.put(f"/workspaces/{ws}/joiner-plan", "member", {"plan": None}).status_code == 403
    assert ok(api.put(f"/workspaces/{ws}/joiner-plan", "owner", {"plan": None}))["is_default"]


# --- offboarding ----------------------------------------------------------------------------------------------


def test_offboarding_hands_over_work_and_applies_the_leaver_sop(api, ws, vapl):
    lead = ok(api.post(f"/workspaces/{ws}/people", "owner", {"email": "lead@example.com", "name": "Lead", "team_ids": [vapl["accounts"]["id"]]}), 201)["person"]["user"]["id"]
    leaver = ok(api.post(f"/workspaces/{ws}/people", "owner", {
        "email": "madhuri@example.com", "name": "Madhuri Aghade", "designation": "Executive", "manager_id": lead,
        "team_ids": [vapl["accounts"]["id"]], "date_of_joining": "2024-01-15", "date_of_birth": "1996-05-02",
        "start_joiner_checklist": True,
    }), 201)["person"]["user"]["id"]
    report = ok(api.post(f"/workspaces/{ws}/people", "owner", {"email": "junior@example.com", "manager_id": leaver}), 201)["person"]["user"]["id"]
    lst = ok(api.post(f"/spaces/{vapl['space']['id']}/lists", "owner", {"name": "Client work"}), 201)
    work = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "File GST return", "assignees": [leaver]}), 201)

    preview = ok(api.get(f"/workspaces/{ws}/people/{leaver}/offboard", "owner"))
    assert preview["hand_over_to"]["id"] == lead and preview["open_tasks"] == 1 and preview["direct_reports"] == 1
    assert preview["joiner_tasks_kept"] == ["Birthday – Madhuri Aghade"]
    assert "Work Anniversary – Madhuri Aghade" in preview["joiner_tasks_deleted"]

    birthday_id = next(pt for pt in ok(api.get(f"/workspaces/{ws}/people/{leaver}/joiner", "owner")) if pt["key"] == "birthday")["task_id"]
    out = ok(api.post(f"/workspaces/{ws}/people/{leaver}/offboard", "owner", {}))
    assert out == {"tasks_handed_over": 1, "joiner_tasks_kept": 1, "joiner_tasks_deleted": 6, "direct_reports_moved": 1}  # incl. ClickUp Review (an Executive)
    assert [a["id"] for a in ok(api.get(f"/tasks/{work['id']}", "owner"))["assignees"]] == [lead]
    birthday = ok(api.get(f"/tasks/{birthday_id}", "owner"))
    assert birthday["name"] == "Ex – Madhuri Aghade"
    checklists = ok(api.get(f"/tasks/{birthday_id}/checklists", "owner"))
    assert [i["name"] for i in checklists[0]["items"]] == ["Create the poster or video"]
    assert person(api, ws, report)["manager_id"] == lead
    gone = person(api, ws, leaver)
    assert gone["deactivated_at"] is not None and gone["team_ids"] == []
    members = {m["user"]["id"]: m for m in ok(api.get(f"/workspaces/{ws}/members", "owner"))}
    assert members[leaver]["deactivated"] is True
    ok(api.post(f"/workspaces/{ws}/people/{leaver}/reactivate", "owner"))
    assert person(api, ws, leaver)["deactivated_at"] is None


def test_turned_off_people_cannot_open_the_workspace(api, ws):
    ok(api.post(f"/workspaces/{ws}/people/member/deactivate", "owner"))
    r = api.get(f"/workspaces/{ws}/hierarchy", "member")
    assert r.status_code == 403 and "turned off" in r.json()["detail"]
    listed = ok(api.get("/workspaces", "member"))
    assert listed[0]["access_problem"] and "turned off" in listed[0]["access_problem"]
    assert api.post(f"/workspaces/{ws}/people/owner/deactivate", "admin").status_code == 400
    assert api.post(f"/workspaces/{ws}/people/admin/deactivate", "admin").status_code == 400  # not yourself
    ok(api.post(f"/workspaces/{ws}/people/member/reactivate", "owner"))
    ok(api.get(f"/workspaces/{ws}/hierarchy", "member"))


def test_offboarding_needs_someone_to_take_over(api, ws):
    r = api.post(f"/workspaces/{ws}/people/member/offboard", "owner", {})
    assert r.status_code == 400 and "who takes over" in r.json()["detail"]
    assert api.post(f"/workspaces/{ws}/people/member/offboard", "owner", {"hand_over_to": "member"}).status_code == 400
    ok(api.post(f"/workspaces/{ws}/people/member/offboard", "owner", {"keep_tasks": True}))
    assert api.post(f"/workspaces/{ws}/people/owner/offboard", "admin", {"keep_tasks": True}).status_code == 400


# --- ownership, roles --------------------------------------------------------------------------------------------


def test_ownership_transfer(api, ws):
    assert api.post(f"/workspaces/{ws}/transfer-ownership", "admin", {"user_id": "admin"}).status_code == 403
    assert api.post(f"/workspaces/{ws}/transfer-ownership", "owner", {"user_id": "guest"}).status_code == 400
    ok(api.post(f"/workspaces/{ws}/transfer-ownership", "owner", {"user_id": "admin"}), 204)
    roles = {m["user"]["id"]: m["role"] for m in ok(api.get(f"/workspaces/{ws}/members", "admin"))}
    assert roles["admin"] == "owner" and roles["owner"] == "admin"


def test_limited_members_see_only_what_is_shared(api, ws):
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"role": "limited"}))
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    assert ok(api.get(f"/workspaces/{ws}/hierarchy", "member"))["spaces"] == []
    assert api.post(f"/workspaces/{ws}/spaces", "member", {"name": "Mine"}).status_code == 403
    ok(api.post(f"/lists/{lst['id']}/shares", "owner", {"user_id": "member", "level": "edit"}), 201)
    tree = ok(api.get(f"/workspaces/{ws}/hierarchy", "member"))
    assert "Payroll" in str(tree)
    # Unlike guests, limited members are internal: they see colleagues' contact details.
    ok(api.patch(f"/workspaces/{ws}/people/admin", "owner", {"phone": "+91 98"}))
    assert person(api, ws, "admin", "member")["phone"] == "+91 98"


# --- sign-in rules ------------------------------------------------------------------------------------------------


def test_sign_in_rules(api, ws):
    google = {"X-Test-Provider": "google.com"}
    ok(api.get("/workspaces", "owner", headers=google))  # the owner signs in with Google
    r = api.put(f"/workspaces/{ws}/sign-in-rules", "owner", {"allowed_email_domains": ["verve.in"]})
    assert r.status_code == 400 and "lock you out" in r.json()["detail"]
    out = ok(api.put(f"/workspaces/{ws}/sign-in-rules", "owner", {"allowed_email_domains": ["@Example.com"], "require_google_sign_in": True}))
    assert out["rules"]["allowed_email_domains"] == ["example.com"]
    assert set(out["locked_out"]) == {"Member", "Admin", "Guest"}  # they haven't signed in with Google yet
    assert api.get(f"/workspaces/{ws}/hierarchy", "member").status_code == 403
    ok(api.get(f"/workspaces/{ws}/hierarchy", "member", headers=google))  # signing in with Google fixes it
    assert api.post(f"/workspaces/{ws}/people", "owner", {"email": "x@gmail.com"}).status_code == 400
    ok(api.post(f"/workspaces/{ws}/people", "owner", {"email": "x@gmail.com", "role": "guest"}), 201)  # outside guests allowed
    ok(api.put(f"/workspaces/{ws}/sign-in-rules", "owner", {"require_two_step": False}))


# --- photos, email, audit -----------------------------------------------------------------------------------------


def test_profile_photos(api, ws, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    r = api._call("PUT", f"/workspaces/{ws}/people/member/avatar", "member", files={"file": ("me.png", PNG, "image/png")})
    assert r.status_code == 200
    path = r.json()["avatar"]
    assert path.startswith("avatars/") and api.client.get(f"/api/v2/{path}").content == PNG  # no sign-in needed
    assert person(api, ws, "member")["user"]["avatar"] == path
    fake = api._call("PUT", f"/workspaces/{ws}/people/member/avatar", "member", files={"file": ("x.png", b"not an image", "image/png")})
    assert fake.status_code == 400
    assert api._call("PUT", f"/workspaces/{ws}/people/admin/avatar", "member", files={"file": ("me.png", PNG, "image/png")}).status_code == 403
    assert api.delete(f"/workspaces/{ws}/people/member/avatar", "member").status_code == 204
    assert api.client.get(f"/api/v2/{path}").status_code == 404


def test_email_status_and_test(api, ws):
    assert ok(api.get(f"/workspaces/{ws}/email-status", "owner"))["configured"] is False
    r = api.post(f"/workspaces/{ws}/email-test", "owner")
    assert r.status_code == 400 and "SMTP_HOST" in r.json()["detail"]


def test_audit_log_records_admin_changes(api, ws):
    ok(api.post(f"/workspaces/{ws}/people", "owner", {"email": "new@example.com", "name": "New Joiner"}), 201)
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"role": "limited"}))
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Clients"}), 201)
    ok(api.delete(f"/spaces/{space['id']}", "owner"), 204)
    log = ok(api.get(f"/workspaces/{ws}/audit", "owner"))
    assert [e["action"] for e in log][:4] == ["space.deleted", "space.created", "person.role_changed", "person.added"]
    assert log[2]["data"] == {"from": "member", "to": "limited"} and log[3]["target_label"] == "New Joiner"
    assert log[0]["actor"]["id"] == "owner" and log[0]["verb"] == "deleted the Space"
    assert [e["action"] for e in ok(api.get(f"/workspaces/{ws}/audit", "owner", params={"action": "space."}))] == ["space.deleted", "space.created"]
    assert api.get(f"/workspaces/{ws}/audit", "member").status_code == 403


def test_induction_questionnaire_form(api, ws, vapl):
    assert ok(api.get(f"/workspaces/{ws}/induction-quiz", "owner"))["view_id"] is None
    view_id = ok(api.post(f"/workspaces/{ws}/induction-quiz", "owner"))["view_id"]
    assert ok(api.post(f"/workspaces/{ws}/induction-quiz", "owner"))["view_id"] == view_id  # made once
    form = ok(api.get(f"/forms/{view_id}", "member"))
    assert form["title"] == "ClickUp induction questionnaire" and len(form["fields"]) == 13
    checks = [f for f in form["fields"] if f["type"] == "checkbox"]
    confidence = next(f for f in form["fields"] if f["type"] == "dropdown")
    answers = {"name": "Neha Shah", checks[0]["key"]: True, confidence["key"]: confidence["field"]["config"]["options"][0]["id"]}
    task_id = ok(api.post(f"/forms/{view_id}/submit", "member", {"answers": answers}), 201)["task_id"]
    assert [a["id"] for a in ok(api.get(f"/tasks/{task_id}", "owner"))["assignees"]] == ["admin"]  # the HR team reviews it
    # New joiners' induction task links to it.
    uid = ok(api.post(f"/workspaces/{ws}/people", "owner", {"email": "j@example.com", "name": "J", "start_joiner_checklist": True}), 201)["person"]["user"]["id"]
    induction = next(st for st in ok(api.get(f"/workspaces/{ws}/people/{uid}/joiner", "owner")) if st["key"] == "induction")
    assert f"/forms/{view_id}" in ok(api.get(f"/tasks/{induction['task_id']}", "owner"))["description"]
