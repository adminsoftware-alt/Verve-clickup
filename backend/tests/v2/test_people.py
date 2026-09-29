from app.db import session as db_session
from app.services.work import accounts
from app.services.work.dashboards import reports
from tests.v2.conftest import ok


def people(api, ws, who="owner"):
    return {p["user"]["email"]: p for p in ok(api.get(f"/workspaces/{ws}/people", who))}


def add(api, ws, who="owner", code=201, **body):
    return ok(api.post(f"/workspaces/{ws}/people", who, body), code)


def test_admins_add_people_with_a_profile_before_they_sign_in(api, workspace):
    ws = workspace["id"]
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR"}), 201)
    out = add(api, ws, email="Priya@Example.com", name="Priya Sharma", designation="HR Business Partner",
              department="HR", manager_id="member", team_ids=[team["id"]], employee_code="VA-042",
              date_of_joining="2026-10-01", phone="+91 98450 12345", location="Bengaluru")
    p = out["person"]
    assert p["pending"] and p["user"]["id"].startswith("pending-") and p["user"]["email"] == "priya@example.com"
    assert (p["user"]["display_name"], p["designation"], p["manager_id"], p["team_ids"]) == ("Priya Sharma", "HR Business Partner", "member", [team["id"]])
    assert out["emailed"] is False and out["link"].endswith("/login")
    assert people(api, ws)["member@example.com"]["direct_reports"] == 1
    # Work can be given to them straight away.
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Onboarding"}), 201)
    task = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Submit documents", "assignees": [p["user"]["id"]]}), 201)
    assert [t["name"] for t in ok(api.get(f"/workspaces/{ws}/people/{p['user']['id']}/tasks", "owner"))] == ["Submit documents"]

    # First sign-in with that email links them: same person, their work is waiting.
    assert [w["id"] for w in ok(api.get("/workspaces", "priya"))] == [ws]
    me = people(api, ws, "priya")["priya@example.com"]
    assert not me["pending"] and me["user"]["id"] == p["user"]["id"]
    assert me["user"]["display_name"] == "Priya Sharma"  # the name the admin gave is kept
    assert [t["id"] for t in ok(api.get(f"/workspaces/{ws}/my-tasks", "priya"))["tasks"]] == [task["id"]]
    # Adding the same email again is refused.
    add(api, ws, email="priya@example.com", name="Again", code=400)


def test_an_unverified_email_does_not_take_over_an_added_person(api, workspace):
    add(api, workspace["id"], email="ravi@example.com", name="Ravi")
    with db_session._session_factory() as db:  # type: ignore[misc]
        user, _ = accounts.ensure_user(db, "impostor-uid", "ravi@example.com", "Mallory", email_verified=False)
        db.commit()
        assert user.id == "impostor-uid"
    assert people(api, workspace["id"])["ravi@example.com"]["pending"] is True


def test_reporting_lines_cannot_loop(api, workspace):
    ws = workspace["id"]
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"manager_id": "admin"}))
    assert api.patch(f"/workspaces/{ws}/people/admin", "owner", {"manager_id": "member"}).status_code == 400
    assert api.patch(f"/workspaces/{ws}/people/admin", "owner", {"manager_id": "admin"}).status_code == 400
    assert api.patch(f"/workspaces/{ws}/people/admin", "owner", {"manager_id": "outsider"}).status_code == 400
    # When a manager leaves, their reports have no manager.
    ok(api.delete(f"/workspaces/{ws}/members/admin", "owner"), 204)
    assert people(api, ws)["member@example.com"]["manager_id"] is None


def test_who_may_change_what(api, workspace):
    ws = workspace["id"]
    add(api, ws, "member", code=403, email="x@example.com", name="X")
    ok(api.patch(f"/workspaces/{ws}/people/member", "member", {"phone": "12345", "location": "Pune", "name": "Mem Ber"}))
    assert api.patch(f"/workspaces/{ws}/people/member", "member", {"designation": "CEO"}).status_code == 403
    assert api.patch(f"/workspaces/{ws}/people/admin", "member", {"phone": "1"}).status_code == 403
    ok(api.patch(f"/workspaces/{ws}/people/member", "owner", {"designation": "Associate", "role": "admin"}))
    assert api.patch(f"/workspaces/{ws}/people/owner", "admin", {"role": "member"}).status_code == 400
    # Guests don't see others' phone numbers.
    assert people(api, ws, "guest")["member@example.com"]["phone"] is None
    assert people(api, ws, "owner")["member@example.com"]["phone"] == "12345"
    # Only admins make admins... and only the owner.
    add(api, ws, "admin", code=403, email="boss@example.com", name="Boss", role="admin")


def test_email_invitations(api, workspace, monkeypatch):
    ws = workspace["id"]
    out = ok(api.post(f"/workspaces/{ws}/invites", "owner", {"emails": ["a1@example.com", "member@example.com"], "message": "Welcome!"}), 201)
    assert [p["user"]["email"] for p in out["people"]] == ["a1@example.com"]
    assert out["emailed"] is False and "isn't set up" in out["email_problem"]
    assert out["problems"] == ["member@example.com: member@example.com is already in this workspace"]

    sent = []
    monkeypatch.setattr(reports, "send_email", lambda to, subject, body: sent.append((to, subject, body)))
    resend = ok(api.post(f"/workspaces/{ws}/people/{out['people'][0]['user']['id']}/invite", "owner", {"message": "Joining Monday"}))
    assert resend["emailed"] is True and sent[0][0] == ["a1@example.com"] and "Joining Monday" in sent[0][2]
    assert people(api, ws)["a1@example.com"]["invite_sent_at"] is not None
    added = add(api, ws, email="new@example.com", name="New Joiner", designation="Intern", send_invite=True)
    assert added["emailed"] is True and "as <b>Intern</b>" in sent[1][2]
    assert api.post(f"/workspaces/{ws}/invites", "member", {"emails": ["z@example.com"]}).status_code == 403


def test_teams_hub_details_and_overview(api, workspace):
    ws = workspace["id"]
    hr = ok(api.post(f"/workspaces/{ws}/teams", "owner", {
        "name": "HR Team", "description": "People ops", "member_ids": ["member"], "lead_ids": ["admin"], "icon": "users",
    }), 201)
    assert (hr["handle"], hr["description"], hr["lead_ids"], sorted(u["id"] for u in hr["members"])) == ("hr-team", "People ops", ["admin"], ["admin", "member"])
    assert api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Other", "handle": "hr-team"}).status_code == 400
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "HR"}), 201)
    # A lead can describe the team and pin where it works, but not rename it.
    ok(api.patch(f"/teams/{hr['id']}", "admin", {"description": "Hiring and onboarding", "locations": [{"kind": "space", "id": space["id"]}]}))
    assert api.patch(f"/teams/{hr['id']}", "member", {"description": "x"}).status_code == 403
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Hiring"}), 201)
    secret = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Salaries", "is_private": True}), 201)
    t = ok(api.post(f"/lists/{lst['id']}/tasks", "owner", {"name": "Screen CVs", "assignees": ["member"]}), 201)
    ok(api.post(f"/lists/{secret['id']}/shares", "owner", {"user_id": "admin", "level": "full"}), 201)
    ok(api.post(f"/lists/{secret['id']}/tasks", "owner", {"name": "Revise pay bands", "assignees": ["admin"]}), 201)
    ok(api.patch(f"/tasks/{t['id']}", "owner", {"priority": 1}))
    view = ok(api.get(f"/teams/{hr['id']}/overview", "member"))
    assert view["team"]["locations"] == [{"kind": "space", "id": space["id"]}]
    assert [x["name"] for x in view["tasks"]] == ["Screen CVs"]  # the private List stays private
    assert {f["kind"] for f in view["feed"]} >= {"created", "priority"} and all(f["task"]["name"] == "Screen CVs" for f in view["feed"])
