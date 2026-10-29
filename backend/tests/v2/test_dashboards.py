import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.db import session as db_session
from app.db.models import ReportSchedule
from app.schemas.dashboards import CardData
from app.services.work.dashboards import reports
from tests.v2.conftest import ok

HOUR = 3600


# --- set-up ------------------------------------------------------------------------


@pytest.fixture
def org(api, workspace):
    """Adds 'lead' and 'member2' as members, and a Team HR = {lead (lead), member}."""
    ws = workspace["id"]
    for uid in ("lead", "member2"):
        ok(api.get("/workspaces", uid))
        ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": f"{uid}@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "HR", "member_ids": ["lead", "member"]}), 201)
    team = ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))
    space = ok(api.post(f"/workspaces/{ws}/spaces", "owner", {"name": "Ops"}), 201)
    lst = ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Payroll"}), 201)
    return {"ws": ws, "team": team, "space": space, "list": lst}


def new_dashboard(api, org, as_user, **body):
    return ok(api.post(f"/workspaces/{org['ws']}/dashboards", as_user, {"name": "Board", **body}), 201)


def listed(api, org, as_user):
    return {x["name"]: x for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", as_user))}


def data(api, dash, as_user, tz="UTC"):
    return ok(api.get(f"/dashboards/{dash['id']}/data", as_user, params={"tz": tz}))


def statuses(api, list_id):
    return {st["group"]: st for st in ok(api.get(f"/lists/{list_id}/statuses", "owner"))["statuses"]}


# --- team leads -----------------------------------------------------------------------


def test_team_leads_are_set_with_members(api, org):
    assert org["team"]["lead_ids"] == ["lead"]
    r = api.put(f"/teams/{org['team']['id']}/members", "owner", {"user_ids": ["member"], "lead_ids": ["lead"]})
    assert r.status_code == 400  # leads must be members
    kept = ok(api.put(f"/teams/{org['team']['id']}/members", "owner", {"user_ids": ["lead", "member", "member2"]}))
    assert kept["lead_ids"] == ["lead"]  # leaving lead_ids out keeps the current leads


# --- who sees which Dashboard ---------------------------------------------------------------


def test_everyone_gets_their_own_work_and_leads_get_their_team(api, org):
    # A member opening the Hub finds their own work waiting, made once.
    first = ok(api.get(f"/workspaces/{org['ws']}/dashboards", "member"))
    assert [(x["name"], x["standard"], x["your_level"]) for x in first] == [("My work", "my_work", "full")]
    again = ok(api.get(f"/workspaces/{org['ws']}/dashboards", "member"))
    assert [x["id"] for x in again] == [x["id"] for x in first]
    mine = ok(api.get(f"/dashboards/{first[0]['id']}", "member"))
    # No filter to start with: whose work it is comes from the board, not from a chip.
    assert mine["filters"]["assignees"] is None and len(mine["cards"]) >= 6

    # The lead of HR also gets HR, person by person; a plain member never sees it.
    for_lead = {x["standard"]: x for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "lead"))}
    team = for_lead["team"]
    assert (team["name"], team["team"]["id"], team["your_level"]) == ("HR – people", org["team"]["id"], "full")
    board = ok(api.get(f"/dashboards/{team['id']}", "lead"))
    assert board["filters"]["assignees"] is None
    # The board is the nine cards a manager reads, not every chart that could be drawn: one
    # chart, by priority. The per-person bars are still built and can be added back from "+ Card".
    assert {c["config"]["group_by"] for c in board["cards"] if c["type"] == "bar"} == {"priority"}
    assert [c["title"] for c in board["cards"] if c["type"] == "task_list"] == [
        "Overdue tasks", "Due today", "Due in the next 7 days"]
    assert "Unassigned" not in {c["title"] for c in board["cards"]}  # an assignee is required now
    assert api.get(f"/dashboards/{team['id']}", "member2").status_code == 404
    assert "team" not in {x["standard"] for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "member2"))}

    # Owners and admins get the whole company, managers included; guests get nothing made for them.
    # They get no personal board of their own -- the Company one is theirs -- though they still
    # see everyone else's.
    for boss in ("owner", "admin"):
        boards = ok(api.get(f"/workspaces/{org['ws']}/dashboards", boss))
        assert "company" in {x["standard"] for x in boards}
        assert not [x for x in boards if x["standard"] == "my_work" and x["owner"]["id"] == boss]
        assert [x for x in boards if x["standard"] == "my_work"]  # other people's, which they oversee
    company = [x for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "owner")) if x["standard"] == "company"]
    assert len(company) == 1  # one for the whole workspace, however many admins open the Hub
    assert ok(api.get(f"/dashboards/{company[0]['id']}", "owner"))["filters"]["assignees"] is None  # everyone
    assert ok(api.get(f"/workspaces/{org['ws']}/dashboards", "guest")) == []


def test_a_personal_board_shows_its_owners_work_whoever_opens_it(api, org):
    """An admin opening somebody's "My work" sees that person's tasks, not their own."""
    lst = org["list"]["id"]
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Member's job", "assignees": ["member"]}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Admin's job", "assignees": ["admin"]}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Lead's job", "assignees": ["lead"]}), 201)
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    for viewer in ("member", "admin"):
        cards = by_title(home, data(api, home, viewer))
        assert cards["Open tasks"]["data"]["value"] == 1, viewer

    # A Team board is the Team's work (lead + member here), and nobody else's.
    team = next(x for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "lead")) if x["standard"] == "team")
    team = ok(api.get(f"/dashboards/{team['id']}", "lead"))
    assert by_title(team, data(api, team, "lead"))["Open tasks"]["data"]["value"] == 2

    # A filter somebody chooses narrows within that, and clearing it goes back to the whole scope.
    ok(api.patch(f"/dashboards/{team['id']}", "lead", {"filters": {"assignees": ["lead"]}}))
    assert by_title(team, data(api, team, "lead"))["Open tasks"]["data"]["value"] == 1
    ok(api.patch(f"/dashboards/{team['id']}", "lead", {"filters": {}}))
    assert by_title(team, data(api, team, "lead"))["Open tasks"]["data"]["value"] == 2


def test_me_on_a_personal_board_still_means_its_owner_for_an_admin(api, org):
    """Older "My work" boards carry `assignees: ["me"]` on their cards and the board. Read by an
    admin, "me" there is still the board's owner -- not the admin, who would see zeros."""
    lst = org["list"]["id"]
    late = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    for n in range(3):
        ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": f"Job {n}", "assignees": ["member"], "due_date": late}), 201)
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    with db_session.new_session() as db:  # as an old board was stored, before the scope existed
        from app.db.models import Dashboard, DashboardCard

        db.get(Dashboard, uuid.UUID(home["id"])).filters = {"assignees": ["me"]}
        for card in db.query(DashboardCard).filter(DashboardCard.dashboard_id == uuid.UUID(home["id"])):
            card.config = {**card.config, "filters": {**(card.config.get("filters") or {}), "assignees": ["me"]}}
        db.commit()
    mine = by_title(home, data(api, home, "member"))
    assert mine["Open tasks"]["data"]["value"] == 3 and mine["Overdue"]["data"]["value"] == 3
    for viewer in ("admin", "owner"):
        theirs = by_title(home, data(api, home, viewer))
        assert theirs["Open tasks"]["data"]["value"] == 3, viewer
        assert theirs["Overdue"]["data"]["value"] == 3, viewer
    insights = ok(api.get(f"/dashboards/{home['id']}/insights", "admin", params={"tz": "UTC"}))
    assert insights["who"] == "person"


def test_workload_card_counts_work_missing_a_due_date_or_an_estimate(api, org):
    lst = org["list"]["id"]
    due = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Sized", "assignees": ["member"], "due_date": due, "time_estimate_seconds": HOUR}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "No date", "assignees": ["member"], "time_estimate_seconds": HOUR}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "No size", "assignees": ["member"], "due_date": due}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Nothing", "assignees": ["member"]}), 201)
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    card = next(row for row in data(api, home, "member") if row["type"] == "capacity")["data"]
    assert (card["tasks"], card["no_due_date_tasks"], card["no_estimate_tasks"]) == (4, 2, 2)


def test_admins_and_leads_open_peoples_own_boards(api, org):
    lst = org["list"]["id"]
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Late", "assignees": ["member"],
                                                 "due_date": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()}), 201)
    # The admin's list: everyone with a board of their own -- not owners or admins -- with figures.
    rows = {r["user"]["id"]: r for r in ok(api.get(f"/workspaces/{org['ws']}/dashboards/people", "admin"))}
    assert {"member", "member2", "lead"} <= set(rows) and "owner" not in rows and "admin" not in rows
    assert (rows["member"]["open"], rows["member"]["overdue"], rows["member"]["teams"]) == (1, 1, ["HR"])
    assert rows["member2"]["dashboard_id"] is None  # never opened the app

    # Opening member2's board makes it, as theirs, and the admin sees it read-only.
    board = ok(api.get(f"/workspaces/{org['ws']}/people/member2/dashboard", "admin"))
    assert (board["owner"]["id"], board["standard"], board["your_level"], board["relation"]) == ("member2", "my_work", "view", "everyone")
    assert ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member2"))["id"] == board["id"]  # the same one they get

    # What the admin sees on it is the member's work, not the admin's.
    member = ok(api.get(f"/workspaces/{org['ws']}/people/member/dashboard", "admin"))
    assert by_title(member, data(api, member, "admin"))["Overdue"]["data"]["value"] == 1

    # A lead: only their Team's people. A member: nobody's.
    assert {r["user"]["id"] for r in ok(api.get(f"/workspaces/{org['ws']}/dashboards/people", "lead"))} == {"member"}
    ok(api.get(f"/workspaces/{org['ws']}/people/member/dashboard", "lead"))
    assert api.get(f"/workspaces/{org['ws']}/people/member2/dashboard", "lead").status_code == 403
    assert api.get(f"/workspaces/{org['ws']}/dashboards/people", "member").status_code == 403
    assert api.get(f"/workspaces/{org['ws']}/people/member2/dashboard", "member").status_code == 403
    # Admins have no personal board to open.
    assert api.get(f"/workspaces/{org['ws']}/people/owner/dashboard", "admin").status_code == 404


def test_a_viewer_filters_someones_board_for_themselves_without_saving(api, org):
    """A lead looking at a member's board narrows it for themselves; the member's board is untouched."""
    lst = org["list"]["id"]
    late = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Urgent late", "assignees": ["member"], "priority": 1, "due_date": late}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Low late", "assignees": ["member"], "priority": 4, "due_date": late}), 201)
    board = ok(api.get(f"/workspaces/{org['ws']}/people/member/dashboard", "lead"))
    assert board["your_level"] == "view"
    overdue = next(c for c in board["cards"] if c["title"] == "Overdue")
    view = lambda lens: by_title(board, ok(api.post(f"/dashboards/{board['id']}/view-data", "lead", lens, params={"tz": "UTC"})))

    # The whole board, then one card, narrowed to urgent work.
    assert view({"filters": {"priorities": [1]}})["Overdue"]["data"]["value"] == 1
    card = {"filters": {"due": "overdue", "priorities": [4]}}
    rows = ok(api.post(f"/dashboards/{board['id']}/view-data", "lead", {"cards": {overdue["id"]: card}, "card_ids": [overdue["id"]]}, params={"tz": "UTC"}))
    assert [(r["card_id"], r["data"]["value"]) for r in rows] == [(overdue["id"], 1)]
    drilled = ok(api.post(f"/dashboards/{board['id']}/cards/{overdue['id']}/view-tasks", "lead", {"cards": {overdue["id"]: card}}, params={"tz": "UTC"}))
    assert [t["name"] for t in drilled["tasks"]] == ["Low late"]

    # Nothing was saved: the member still sees both, and the saved board has no filter.
    assert by_title(board, data(api, board, "member"))["Overdue"]["data"]["value"] == 2
    assert ok(api.get(f"/dashboards/{board['id']}", "member"))["filters"]["priorities"] is None
    # Somebody who may not open the board cannot read it this way either.
    assert api.post(f"/dashboards/{board['id']}/view-data", "member2", {}).status_code in (403, 404)


def test_people_list_says_how_full_each_persons_week_is(api, org):
    """My team's "Who's free": hours someone can work this week against open work planned into it."""
    now = datetime.now(timezone.utc)
    lst = org["list"]["id"]
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Two hours", "assignees": ["member"], "time_estimate_seconds": 7200,
                                                 "start_date": now.isoformat(), "due_date": now.isoformat()}), 201)
    weeks = ok(api.get(f"/workspaces/{org['ws']}/dashboards/people/week", "lead", params={"tz": "UTC"}))
    assert set(weeks) == {r["user"]["id"] for r in ok(api.get(f"/workspaces/{org['ws']}/dashboards/people", "lead"))}
    member = weeks["member"]
    assert {"planned", "capacity", "logged"} <= set(member)
    if now.weekday() < 5:  # a working day, so the estimate lands inside this week's capacity
        assert member["planned"] == 7200 and member["capacity"] > 0
    assert member["logged"] == 0


def test_a_manager_hands_their_peoples_open_work_to_someone_else(api, org):
    """Bulk action on My team: a Manager moves a report's open tasks, but only within their team."""
    lst = org["list"]["id"]
    task = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Cover me", "assignees": ["member"]}), 201)
    ws = org["ws"]
    assert api.post(f"/workspaces/{ws}/people/hand-over", "lead", {"from_ids": ["member2"], "to_id": "lead"}).status_code == 403
    assert api.post(f"/workspaces/{ws}/people/hand-over", "member", {"from_ids": ["member"], "to_id": "lead"}).status_code == 403
    assert api.post(f"/workspaces/{ws}/people/hand-over", "lead", {"from_ids": ["member"], "to_id": "member"}).status_code in (400, 422)

    out = ok(api.post(f"/workspaces/{ws}/people/hand-over", "lead", {"from_ids": ["member"], "to_id": "lead"}))
    assert out["moved"] == 1 and out["skipped"] == []
    assert [u["id"] for u in ok(api.get(f"/tasks/{task['id']}", "owner"))["assignees"]] == ["lead"]


def test_all_teams_page_has_each_teams_figures(api, org):
    """All teams: a task two of a Team are on counts once, late work is counted, and only admins ask."""
    lst = org["list"]["id"]
    late = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Shared and late", "assignees": ["lead", "member"], "due_date": late}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Not theirs", "assignees": ["member2"]}), 201)
    figures = ok(api.get(f"/workspaces/{org['ws']}/teams/figures", "admin", params={"tz": "UTC"}))
    hr = figures[org["team"]["id"]]
    assert (hr["open"], hr["overdue"]) == (1, 1) and {"planned", "capacity"} <= set(hr)
    assert api.get(f"/workspaces/{org['ws']}/teams/figures", "lead").status_code == 403


def test_clear_all_filters_puts_every_card_back_how_it_was_built(api, org):
    lst = org["list"]["id"]
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Late", "assignees": ["member"], "priority": 1,
                                                 "due_date": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Fine", "assignees": ["member"], "priority": 4}), 201)
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    overdue = next(c for c in home["cards"] if c["title"] == "Overdue")
    assert overdue["config"]["base_filters"]["due"] == "overdue"  # remembered when it was made

    # Narrow the board and the card from their headers.
    ok(api.patch(f"/dashboards/{home['id']}", "member", {"filters": {"priorities": [4]}}))
    narrowed = {**overdue["config"], "filters": {"due": "overdue", "priorities": [2]}}
    ok(api.patch(f"/dashboards/{home['id']}/cards/{overdue['id']}", "member", {"config": narrowed}))
    assert by_title(home, data(api, home, "member"))["Overdue"]["data"]["value"] == 0

    # One press: the board's own filter is gone, the card is Overdue again -- not "everything".
    reset = ok(api.post(f"/dashboards/{home['id']}/reset-filters", "member"))
    assert reset["filters"]["priorities"] is None
    card = next(c for c in reset["cards"] if c["id"] == overdue["id"])
    assert card["config"]["filters"]["due"] == "overdue" and card["config"]["filters"]["priorities"] is None
    assert by_title(home, data(api, home, "member"))["Overdue"]["data"]["value"] == 1
    # Someone only viewing the board cannot clear the owner's filters.
    assert api.post(f"/dashboards/{home['id']}/reset-filters", "admin").status_code == 403


def test_insights_say_what_needs_attention(api, org):
    lst = org["list"]["id"]
    now = datetime.now(timezone.utc)
    late = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Late GST", "assignees": ["member"],
                                                        "start_date": (now - timedelta(days=6)).isoformat(),
                                                        "due_date": (now - timedelta(days=4)).isoformat()}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Urgent audit", "assignees": ["member"], "priority": 1,
                                                 "due_date": (now + timedelta(days=1)).isoformat()}), 201)
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Someone else's", "assignees": ["lead"],
                                                 "start_date": (now - timedelta(days=3)).isoformat(),
                                                 "due_date": (now - timedelta(days=1)).isoformat()}), 201)
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    got = ok(api.get(f"/dashboards/{home['id']}/insights", "member", params={"tz": "UTC"}))
    # Only the board's own person: the lead's late start is not on the member's board.
    assert got["late_start"]["count"] == 1 and got["late_start"]["tasks"][0]["id"] == late["id"]
    assert got["late_start"]["tasks"][0]["days_late"] >= 5
    # What a card already says -- due today, overdue, done this week -- is not said again.
    assert not {"overdue", "due_today", "done_this_week", "logged_this_week"} & set(got)
    assert [t["name"] for t in got["urgent_soon"]["tasks"]] == ["Urgent audit"]
    assert got["no_estimate"] == 2 and got["people_behind"] == []  # a board about one person
    # The company board is about everyone, so it says who is furthest behind.
    company = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "owner"))
    everyone = ok(api.get(f"/dashboards/{company['id']}/insights", "owner", params={"tz": "UTC"}))
    assert everyone["late_start"]["count"] == 2
    assert {row["user"]["id"] for row in everyone["people_behind"]} == {"member", "lead"}


def test_home_opens_on_the_company_for_an_admin(api, org):
    """An admin's own open-task count is not the question they open the app with."""
    url = f"/workspaces/{org['ws']}/dashboards/home"
    for boss in ("owner", "admin"):
        home = ok(api.get(url, boss))
        assert home["standard"] == "company"
        assert home["filters"].get("assignees") is None  # everyone, not just them
        assert ok(api.get(url, boss))["id"] == home["id"]  # the same one every time
    # And the two of them land on the one Company board, not one each.
    assert ok(api.get(url, "owner"))["id"] == ok(api.get(url, "admin"))["id"]


def test_home_opens_on_your_own_dashboard(api, org):
    url = f"/workspaces/{org['ws']}/dashboards/home"
    home = ok(api.get(url, "member"))
    assert (home["standard"], home["relation"], home["your_level"]) == ("my_work", "mine", "full")
    assert home["owner"]["id"] == "member" and home["filters"]["assignees"] is None
    assert "timesheet" in {c["type"] for c in home["cards"]}  # their week's hours sit on it
    assert ok(api.get(url, "member"))["id"] == home["id"]  # the same one every time
    # It is the very Dashboard the Hub lists for them, and everyone gets their own.
    assert [x["id"] for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "member"))] == [home["id"]]
    assert ok(api.get(url, "lead"))["id"] != home["id"]
    assert api.get(url, "guest").status_code == 403


def test_workload_card_weighs_planned_work_against_the_hours_people_have(api, org):
    dash = new_dashboard(api, org, "owner", name="Capacity")
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "capacity", "title": "This week", "config": {"period": {"preset": "this_week"}},
    }), 201)
    today = datetime.now(timezone.utc).replace(hour=9, minute=0, second=0, microsecond=0)
    task = ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {
        "name": "Payroll", "assignees": ["owner"], "time_estimate_seconds": 4 * HOUR,
        "start_date": today.isoformat(), "due_date": today.isoformat(),
    }), 201)
    ok(api.post(f"/tasks/{task['id']}/time", "owner", {"duration_seconds": HOUR}), 201)
    got = next(c for c in data(api, dash, "owner") if c["card_id"] == card["id"])["data"]
    assert got["planned_seconds"] == 4 * HOUR and got["logged_seconds"] == HOUR
    assert got["capacity_seconds"] >= 8 * HOUR  # a working week for the one person involved
    assert got["remaining_seconds"] == got["capacity_seconds"] - got["planned_seconds"]
    assert (got["tasks"], got["scheduled_tasks"], got["people"]) == (1, 1, 1)
    # Work with no due date can't be planned into a day, so it doesn't count against the week.
    ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {
        "name": "Someday", "assignees": ["owner"], "time_estimate_seconds": 9 * HOUR,
    }), 201)
    again = next(c for c in data(api, dash, "owner") if c["card_id"] == card["id"])["data"]
    assert (again["planned_seconds"], again["tasks"], again["scheduled_tasks"]) == (4 * HOUR, 2, 1)


def test_cards_can_group_by_and_add_up_a_custom_field(api, org):
    """Defining a field and then not being able to report on it is why nobody fills them in."""
    space = org["space"]["id"]
    review = ok(api.post(f"/spaces/{space}/fields", "owner", {
        "name": "Review month", "type": "dropdown",
        "config": {"options": [{"id": "sep", "name": "September"}, {"id": "oct", "name": "October"}]},
    }), 201)
    fee = ok(api.post(f"/spaces/{space}/fields", "owner", {"name": "Fee", "type": "money"}), 201)

    # Option ids are generated by the server, so read them back rather than assuming.
    options = {o["name"]: o["id"] for o in review["config"]["options"]}
    for month, amount in (("September", 100), ("September", 250), ("October", 400)):
        task = ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {"name": f"Job {amount}"}), 201)
        ok(api.put(f"/tasks/{task['id']}/fields/{review['id']}", "owner", {"value": options[month]}))
        ok(api.put(f"/tasks/{task['id']}/fields/{fee['id']}", "owner", {"value": amount}))

    dash = new_dashboard(api, org, "owner", name="Fields")
    pie = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "pie", "title": "By review month", "config": {"group_by": f"custom:{review['id']}"},
    }), 201)
    total = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "calculation", "title": "Fees", "config": {"measure": f"custom:{fee['id']}", "fn": "sum"},
    }), 201)

    rows = {c["card_id"]: c["data"] for c in data(api, dash, "owner")}
    by_label = {seg["label"]: seg for seg in rows[pie["id"]]["segments"]}
    assert by_label["September"]["value"] == 2
    assert by_label["October"]["value"] == 1

    # Money is a number, not a duration: 750 seconds would be a nonsense reading of 750 rupees.
    assert rows[total["id"]]["value"] == 750 and rows[total["id"]]["format"] == "number"

    # And the segment still opens the tasks behind it.
    page = ok(api.get(f"/dashboards/{dash['id']}/cards/{pie['id']}/tasks?segment={options['September']}", "owner"))
    assert sorted(t["name"] for t in page["tasks"]) == ["Job 100", "Job 250"]


def test_estimate_against_actual_covers_only_work_finished_in_the_period(api, org):
    """Both sides must describe the same tasks, or the card compares two different things.

    Counting every open task's estimate against only the hours logged inside the period used to
    report most of a month's estimates as "unused" after a single day.
    """
    dash = new_dashboard(api, org, "owner", name="Variance")
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "variance", "title": "This week", "config": {"period": {"preset": "this_week"}},
    }), 201)
    shared = ok(api.post(f"/lists/{org['list']['id']}/tasks", "owner", {
        "name": "Shared job", "assignees": ["member", "lead"], "time_estimate_seconds": 4 * HOUR,
    }), 201)
    ok(api.post(f"/tasks/{shared['id']}/time", "member", {"duration_seconds": 3 * HOUR}), 201)

    # Still open: its estimate is not a result yet, so the card stays empty.
    got = next(c for c in data(api, dash, "owner") if c["card_id"] == card["id"])["data"]
    assert got["rows"] == [] and got["expected_seconds"] == 0

    ok(api.patch(f"/tasks/{shared['id']}", "owner",
                 {"status_id": statuses(api, org["list"]["id"])["closed"]["id"]}))
    got = next(c for c in data(api, dash, "owner") if c["card_id"] == card["id"])["data"]
    rows = {r["user"]["id"]: r for r in got["rows"]}
    # The estimate is split between the two people on it; the hours are whoever tracked them.
    assert rows["member"]["expected_seconds"] == 2 * HOUR and rows["member"]["logged_seconds"] == 3 * HOUR
    assert rows["member"]["difference_seconds"] == HOUR
    assert rows["lead"]["expected_seconds"] == 2 * HOUR and rows["lead"]["difference_seconds"] == -2 * HOUR
    assert got["expected_seconds"] == 4 * HOUR and got["logged_seconds"] == 3 * HOUR


def test_the_dashboards_made_for_people_answer_the_old_home_page(api, org):
    """Every question the first Dashboard page answered has a card on the new ones.

    "Completed tasks" is not among them any more: what was finished is answered by the "Done this
    week" figure and, in detail, by the estimate-against-actual card, which lists the same work
    with the hours beside it.
    """
    home = ok(api.get(f"/workspaces/{org['ws']}/dashboards/home", "member"))
    mine = {c["type"] for c in home["cards"]}
    assert {"calculation", "capacity", "bar", "pie", "timesheet", "variance"} <= mine
    assert "completed" not in mine
    # "To do" came off it too: the status pie answers what is still open, and My Tasks is where
    # that list is actually worked from.
    assert "task_list" not in mine
    for_lead = {x["standard"]: x for x in ok(api.get(f"/workspaces/{org['ws']}/dashboards", "lead"))}
    team = ok(api.get(f"/dashboards/{for_lead['team']['id']}", "lead"))
    theirs = {c["type"] for c in team["cards"]}
    assert {"calculation", "capacity", "bar", "timesheet", "task_list"} <= theirs
    # Taken off the standard board, and still built: each one renders, a board that already has
    # one keeps it, and any of them can be added back from "+ Card".
    assert theirs.isdisjoint({"behind", "pie", "variance", "completed", "time_report"})


def test_members_see_only_their_own_dashboards(api, org):
    new_dashboard(api, org, "member", name="Mine")
    assert "Mine" not in listed(api, org, "member2")
    dash_id = listed(api, org, "member")["Mine"]["id"]
    assert api.get(f"/dashboards/{dash_id}", "member2").status_code == 404
    assert api.get(f"/dashboards/{dash_id}", "guest").status_code == 404
    mine = listed(api, org, "member")["Mine"]
    assert (mine["relation"], mine["your_level"]) == ("mine", "full")


def test_team_leads_view_their_team_members_dashboards(api, org):
    dash = new_dashboard(api, org, "member", name="Member's")
    new_dashboard(api, org, "member2", name="Outside the team")
    seen = listed(api, org, "lead")
    assert (seen["Member's"]["relation"], seen["Member's"]["your_level"]) == ("my_team", "view")
    assert "Outside the team" not in seen
    # Viewing, not editing.
    assert api.post(f"/dashboards/{dash['id']}/cards", "lead", {"type": "notes"}).status_code == 403


def test_admins_and_owners_see_every_dashboard(api, org):
    new_dashboard(api, org, "member", name="A")
    new_dashboard(api, org, "member2", name="B")
    for boss in ("admin", "owner"):
        seen = listed(api, org, boss)
        assert {"A", "B"} <= set(seen)
        assert seen["A"]["relation"] == "everyone" and seen["A"]["your_level"] == "view"


def test_sharing_opens_a_dashboard_up_to_the_granted_level(api, org):
    dash = new_dashboard(api, org, "member", name="Shared one")
    ok(api.post(f"/dashboards/{dash['id']}/shares", "admin", {"user_id": "member2", "level": "edit"}), 201)
    seen = listed(api, org, "member2")["Shared one"]
    assert (seen["relation"], seen["your_level"]) == ("shared", "edit")
    ok(api.post(f"/dashboards/{dash['id']}/cards", "member2", {"type": "notes"}), 201)
    assert api.delete(f"/dashboards/{dash['id']}", "member2").status_code == 403  # delete needs full


def test_only_admins_share_dashboards(api, org):
    """Members and managers can't share any board, their own included; admins can share any."""
    mine = new_dashboard(api, org, "member", name="Mine")
    team = new_dashboard(api, org, "lead", name="HR board", team_id=org["team"]["id"])
    for who, dash in (("member", mine), ("lead", team)):
        refused = api.post(f"/dashboards/{dash['id']}/shares", who, {"user_id": "member2", "level": "view"})
        assert refused.status_code == 403 and "admin" in refused.json()["detail"]
    # An admin only views the member's board, and can still share it.
    share = ok(api.post(f"/dashboards/{mine['id']}/shares", "admin", {"user_id": "member2", "level": "view"}), 201)
    assert listed(api, org, "member2")["Mine"]["relation"] == "shared"
    # Taking it back is the admin's too.
    assert api.delete(f"/dashboards/{mine['id']}/shares/{share['id']}", "member").status_code == 403
    ok(api.delete(f"/dashboards/{mine['id']}/shares/{share['id']}", "admin"), 204)
    assert "Mine" not in listed(api, org, "member2")


def test_guests_cannot_create_and_only_get_view(api, org):
    assert api.post(f"/workspaces/{org['ws']}/dashboards", "guest", {"name": "x"}).status_code == 403
    dash = new_dashboard(api, org, "member")
    assert api.post(f"/dashboards/{dash['id']}/shares", "admin", {"user_id": "guest", "level": "edit"}).status_code == 400
    ok(api.post(f"/dashboards/{dash['id']}/shares", "admin", {"user_id": "guest", "level": "view"}), 201)
    assert listed(api, org, "guest")["Board"]["your_level"] == "view"


def test_team_dashboards_belong_to_the_team_leads(api, org):
    team_id = org["team"]["id"]
    assert api.post(f"/workspaces/{org['ws']}/dashboards", "member", {"name": "x", "team_id": team_id}).status_code == 403
    dash = new_dashboard(api, org, "lead", name="HR board", team_id=team_id)
    assert dash["team"]["name"] == "HR" and dash["relation"] == "team"
    # It shows the Team's people, as one view -- by its scope, so the filter bar starts empty.
    assert dash["filters"]["assignees"] is None
    # Admins can make one for any Team; the Team's leads get full access to it.
    by_admin = new_dashboard(api, org, "admin", name="HR by admin", team_id=team_id)
    assert listed(api, org, "lead")["HR by admin"]["your_level"] == "full"
    # Team members do not see it unless it is shared with them (or the Team).
    assert "HR board" not in listed(api, org, "member")
    ok(api.post(f"/dashboards/{dash['id']}/shares", "admin", {"team_id": team_id, "level": "view"}), 201)
    assert listed(api, org, "member")["HR board"]["relation"] == "shared"
    assert by_admin["id"]


# --- card data ----------------------------------------------------------------------------


@pytest.fixture
def seeded(api, org):
    lst = org["list"]["id"]
    groups = statuses(api, lst)
    yesterday = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    a = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "A", "assignees": ["member"], "due_date": yesterday,
                                                    "time_estimate_seconds": HOUR, "priority": 1}), 201)
    b = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "B", "assignees": ["member2"], "time_estimate_seconds": HOUR}), 201)
    c = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "C"}), 201)
    ok(api.patch(f"/tasks/{b['id']}", "owner", {"status_id": groups["closed"]["id"]}))
    return {**org, "tasks": {"A": a, "B": b, "C": c}}


def by_title(dash, rows):
    titles = {c["id"]: c["title"] for c in dash["cards"]}
    out = {}
    for row in rows:
        out.setdefault(titles[row["card_id"]], row)
    return out


def test_vapl_review_template_matches_the_sop(api, seeded):
    dash = new_dashboard(api, seeded, "owner", template="vapl_review",
                         sources=[{"kind": "space", "id": seeded["space"]["id"]}])
    cards = by_title(dash, data(api, dash, "owner"))
    assert cards["Total tasks"]["data"]["value"] == 2  # closed B is left out
    assert cards["Overdue tasks"]["data"]["value"] == 1
    assert cards["Unassigned tasks"]["data"]["value"] == 1
    assert cards["Tasks without estimates"]["data"]["value"] == 1
    assert [t["name"] for t in cards["Work done today"]["data"]["tasks"]] == ["B"]
    pie = cards["Workload by status"]["data"]["segments"]
    assert [(sg["label"], sg["value"]) for sg in pie] == [("To do", 2)]
    portfolio = cards["Actual vs budgeted time by List"]["data"]["rows"]
    assert portfolio[0]["total"] == 3 and portfolio[0]["done"] == 1 and portfolio[0]["progress"] == 33


def test_cards_follow_the_viewers_permissions(api, seeded):
    private = ok(api.post(f"/spaces/{seeded['space']['id']}/lists", "owner", {"name": "Board only", "is_private": True}), 201)
    ok(api.post(f"/lists/{private['id']}/tasks", "owner", {"name": "Secret"}), 201)
    dash = new_dashboard(api, seeded, "owner", name="Mixed")
    everything = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "calculation", "title": "All"}), 201)
    only_private = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "calculation", "title": "Private", "config": {"sources": [{"kind": "list", "id": private["id"]}]}}), 201)
    ok(api.post(f"/dashboards/{dash['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)

    mine = {row["card_id"]: row for row in data(api, dash, "owner")}
    theirs = {row["card_id"]: row for row in data(api, dash, "member")}
    assert mine[everything["id"]]["data"]["value"] == 3  # A, C and Secret
    assert theirs[everything["id"]]["data"]["value"] == 2  # the private List is invisible to them
    assert theirs[only_private["id"]]["no_access"] is True and theirs[only_private["id"]]["data"] == {}


def test_dashboard_filters_apply_to_every_card(api, seeded):
    dash = new_dashboard(api, seeded, "owner", template="simple")
    ok(api.patch(f"/dashboards/{dash['id']}", "owner", {"filters": {"assignees": ["member"]}}))
    cards = by_title(dash, data(api, dash, "owner"))
    assert cards["Open tasks"]["data"]["value"] == 1
    assert [sg["label"] for sg in cards["Open tasks by assignee"]["data"]["segments"]] == ["Member"]


def test_me_filter_means_whoever_is_looking(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "calculation", "config": {"filters": {"assignees": ["me"]}}}), 201)
    ok(api.post(f"/dashboards/{dash['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    value = lambda who: next(r for r in data(api, dash, who) if r["card_id"] == card["id"])["data"]["value"]
    assert value("owner") == 0 and value("member") == 1


def test_drill_down_returns_the_tasks_behind_a_segment(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "bar", "config": {"group_by": "assignee"}}), 201)
    page = ok(api.get(f"/dashboards/{dash['id']}/cards/{card['id']}/tasks", "owner", params={"segment": "none"}))
    assert [t["name"] for t in page["tasks"]] == ["C"]
    page = ok(api.get(f"/dashboards/{dash['id']}/cards/{card['id']}/tasks", "owner", params={"segment": "member"}))
    assert [t["name"] for t in page["tasks"]] == ["A"]


def test_calculation_rules_are_checked(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    bad = api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "calculation", "config": {"measure": "tasks", "fn": "sum"}})
    assert bad.status_code == 422
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {
        "type": "calculation", "config": {"measure": "time_estimate", "fn": "sum"}}), 201)
    row = next(r for r in data(api, dash, "owner") if r["card_id"] == card["id"])
    assert row["data"] == {"value": HOUR, "format": "duration", "count": 2, "unit": None}


# --- time cards and who sees whose time -------------------------------------------------------


def _log(api, task_id, who, hours):
    start = datetime.now(timezone.utc).replace(hour=0, minute=5, second=0, microsecond=0)
    ok(api.post(f"/tasks/{task_id}/time", who, {
        "started_at": start.isoformat(), "ended_at": (start + timedelta(hours=hours)).isoformat()}), 201)


def test_tracked_time_is_visible_to_self_team_leads_and_admins(api, seeded):
    task = seeded["tasks"]["C"]["id"]
    _log(api, task, "member", 1)
    _log(api, task, "member2", 2)
    _log(api, task, "lead", 3)

    def people(who):
        dash = new_dashboard(api, seeded, who, name=f"time-{who}")
        ok(api.post(f"/dashboards/{dash['id']}/cards", who, {
            "type": "time_report", "config": {"period": {"preset": "today"}, "then_by": "none"}}), 201)
        rows = data(api, dash, who)[0]["data"]["rows"]
        return {r["key"]: r["seconds"] // HOUR for r in rows}

    assert people("member") == {"member": 1}
    assert people("lead") == {"lead": 3, "member": 1}  # leads HR = lead + member
    assert people("admin") == {"member": 1, "member2": 2, "lead": 3}

    # The same rule in the task's time panel.
    entries = ok(api.get(f"/tasks/{task}/time", "lead"))["entries"]
    assert sorted(e["user"]["id"] for e in entries) == ["lead", "member"]
    assert ok(api.get(f"/tasks/{task}/time", "member"))["total_seconds"] == 6 * HOUR  # everyone's total


def test_timesheet_has_a_column_per_day_and_capacity(api, seeded):
    _log(api, seeded["tasks"]["A"]["id"], "member", 2)
    dash = new_dashboard(api, seeded, "admin")
    ok(api.post(f"/dashboards/{dash['id']}/cards", "admin", {"type": "timesheet", "config": {"period": {"preset": "this_week"}}}), 201)
    sheet = data(api, dash, "admin")[0]["data"]
    assert len(sheet["days"]) == 7 and sheet["capacity_per_day"] == [8 * HOUR] * 5 + [0, 0]
    row = sheet["rows"][0]
    assert row["user"]["id"] == "member" and row["total"] == 2 * HOUR
    # A row opens up into the tasks the hours went to, so they can be read and opened.
    assert [t["id"] for t in row["tasks"]] == [seeded["tasks"]["A"]["id"]]
    assert row["tasks"][0]["total"] == 2 * HOUR and sum(row["tasks"][0]["seconds_per_day"]) == 2 * HOUR
    assert row["tasks"][0]["name"] == seeded["tasks"]["A"]["name"] and row["tasks"][0]["status"]


def test_the_timesheet_counts_everyone_it_covers_not_only_those_who_logged(api, seeded):
    """A week nobody fills in should look bad, not empty.

    The denominator used to be summed over the rows, and a row only existed for somebody who had
    logged something -- so the people who recorded nothing took their hours out of the total with
    them, and the figure got better the more of them there were.
    """
    lst = seeded["list"]["id"]
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "Theirs", "assignees": ["member2"]}), 201)
    _log(api, seeded["tasks"]["A"]["id"], "member", 2)  # member works; member2 records nothing

    dash = new_dashboard(api, seeded, "admin")
    ok(api.post(f"/dashboards/{dash['id']}/cards", "admin",
                {"type": "timesheet", "config": {"period": {"preset": "this_week"}}}), 201)
    sheet = data(api, dash, "admin")[0]["data"]

    rows = {r["user"]["id"]: r for r in sheet["rows"]}
    assert "member2" in rows, "somebody who logged nothing still has to appear"
    assert rows["member2"]["total"] == 0 and rows["member2"]["tasks"] == []
    assert rows["member"]["total"] == 2 * HOUR
    assert sheet["nobody_logged"] >= 1

    # Whoever logged something comes first; the empty rows are what a manager is looking for,
    # and they are at the bottom rather than scattered alphabetically.
    assert sheet["rows"][0]["total"] > 0 and sheet["rows"][-1]["total"] == 0

    # And the hours they were available for are in the total, so it cannot flatter the team.
    able = sum(sum(r["capacity_per_day"]) for r in sheet["rows"])
    assert able >= sum(rows["member2"]["capacity_per_day"]) + sum(rows["member"]["capacity_per_day"])
    assert sum(rows["member2"]["capacity_per_day"]) > 0


# --- building -----------------------------------------------------------------------------


def test_duplicate_then_change_locations(api, seeded):
    other = ok(api.post(f"/workspaces/{seeded['ws']}/spaces", "owner", {"name": "HR space"}), 201)
    original = new_dashboard(api, seeded, "owner", template="simple", sources=[{"kind": "space", "id": seeded["space"]["id"]}])
    ok(api.post(f"/dashboards/{original['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    copy = ok(api.post(f"/dashboards/{original['id']}/duplicate", "member", {"name": "My copy"}), 201)
    assert copy["owner"]["id"] == "member" and copy["your_level"] == "full" and len(copy["cards"]) == len(original["cards"])
    moved = ok(api.post(f"/dashboards/{copy['id']}/repoint", "member", {"sources": [{"kind": "space", "id": other["id"]}]}))
    assert all(c["config"]["sources"] == [{"kind": "space", "id": other["id"]}] for c in moved["cards"])
    # The original is untouched.
    assert ok(api.get(f"/dashboards/{original['id']}", "owner"))["cards"][0]["config"]["sources"][0]["id"] == seeded["space"]["id"]


def test_layout_is_saved_in_order_and_must_list_every_card(api, seeded):
    dash = new_dashboard(api, seeded, "owner", template="simple")
    ids = [c["id"] for c in dash["cards"]]
    new_order = [{"id": i, "width": 4, "height": 2} for i in reversed(ids)]
    out = ok(api.put(f"/dashboards/{dash['id']}/layout", "owner", {"cards": new_order}))
    assert [c["id"] for c in out["cards"]] == list(reversed(ids)) and {c["width"] for c in out["cards"]} == {4}
    assert api.put(f"/dashboards/{dash['id']}/layout", "owner", {"cards": new_order[1:]}).status_code == 400


# --- email reports ----------------------------------------------------------------------------


def _schedule(**fields):
    return ReportSchedule(frequency="weekly", weekday=0, day_of_month=None, send_time="09:00", timezone="Asia/Kolkata", **fields)


def test_next_run_is_the_next_matching_local_time():
    wed = datetime(2026, 9, 23, 6, 0, tzinfo=timezone.utc)  # Wednesday 11:30 in India
    assert reports.next_run(_schedule(), wed) == datetime(2026, 9, 28, 3, 30, tzinfo=timezone.utc)  # Mon 09:00 IST
    daily = _schedule()
    daily.frequency = "daily"
    assert reports.next_run(daily, wed) == datetime(2026, 9, 24, 3, 30, tzinfo=timezone.utc)
    weekdays = _schedule()
    weekdays.frequency = "weekdays"
    fri_late = datetime(2026, 9, 25, 5, 0, tzinfo=timezone.utc)
    assert reports.next_run(weekdays, fri_late) == datetime(2026, 9, 28, 3, 30, tzinfo=timezone.utc)
    monthly = _schedule()
    monthly.frequency, monthly.day_of_month = "monthly", 1
    assert reports.next_run(monthly, wed) == datetime(2026, 10, 1, 3, 30, tzinfo=timezone.utc)


def test_reports_go_to_members_only_and_need_edit_access(api, seeded):
    dash = new_dashboard(api, seeded, "owner", template="simple")
    url = f"/dashboards/{dash['id']}/reports"
    assert api.post(url, "owner", {"recipient_ids": ["outsider"]}).status_code == 400
    ok(api.post(f"/dashboards/{dash['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    assert api.post(url, "member", {"recipient_ids": ["member"]}).status_code == 403
    assert api.get(f"/dashboards/{dash['id']}/report-runs", "member").status_code == 403
    schedule = ok(api.post(url, "owner", {"recipient_ids": ["member", "admin"], "frequency": "daily", "send_time": "08:30"}), 201)
    assert schedule["next_run_at"] is not None and [r["id"] for r in schedule["recipients"]] == ["member", "admin"]


def test_send_now_without_smtp_keeps_a_preview(api, seeded):
    dash = new_dashboard(api, seeded, "owner", name="Weekly ops", template="simple")
    schedule = ok(api.post(f"/dashboards/{dash['id']}/reports", "owner", {"recipient_ids": ["member"]}), 201)
    run = ok(api.post(f"/reports/{schedule['id']}/send", "owner"))
    assert run["status"] == "not_sent" and "SMTP_HOST" in run["error"]
    detail = ok(api.get(f"/report-runs/{run['id']}", "owner"))
    assert "Weekly ops" in detail["html"] and "Open tasks" in detail["html"]


def test_send_now_emails_the_creators_view(api, seeded, monkeypatch):
    sent = []
    monkeypatch.setattr(reports, "send_email", lambda to, subject, body: sent.append((to, subject, body)))
    dash = new_dashboard(api, seeded, "owner", name="Ops", template="vapl_review")
    schedule = ok(api.post(f"/dashboards/{dash['id']}/reports", "owner", {"recipient_ids": ["member"], "subject": "Daily review"}), 201)
    run = ok(api.post(f"/reports/{schedule['id']}/send", "owner"))
    assert run["status"] == "sent" and run["recipients"] == ["member@example.com"]
    (to, subject, body), = sent
    assert subject == "Daily review" and "Work done today" in body and "&gt;" not in subject


def test_due_reports_are_sent_and_rescheduled(api, seeded, monkeypatch):
    sent = []
    monkeypatch.setattr(reports, "send_email", lambda to, subject, body: sent.append(to))
    dash = new_dashboard(api, seeded, "owner", template="simple")
    schedule = ok(api.post(f"/dashboards/{dash['id']}/reports", "owner", {"recipient_ids": ["admin"], "frequency": "daily"}), 201)
    later = datetime.fromisoformat(schedule["next_run_at"]) + timedelta(minutes=1)
    with db_session.new_session() as db:
        assert reports.run_due(db, later) == 1
        assert reports.run_due(db, later) == 0  # already moved on to tomorrow
    assert sent == [["admin@example.com"]]
    again = ok(api.get(f"/dashboards/{dash['id']}/reports", "owner"))["schedules"][0]
    assert datetime.fromisoformat(again["next_run_at"]) > later


def test_a_report_pauses_when_its_creator_loses_access(api, seeded, monkeypatch):
    monkeypatch.setattr(reports, "send_email", lambda *a: None)
    dash = new_dashboard(api, seeded, "member", template="simple")
    schedule = ok(api.post(f"/dashboards/{dash['id']}/reports", "member", {"recipient_ids": ["member"]}), 201)
    # Turning their access off, rather than deleting the membership: the schedule pauses on any
    # loss of access, and someone holding open tasks cannot be deleted outright anyway.
    ok(api.post(f"/workspaces/{seeded['ws']}/people/member/deactivate", "owner"))
    later = datetime.fromisoformat(schedule["next_run_at"]) + timedelta(minutes=1)
    with db_session.new_session() as db:
        reports.run_due(db, later)
        paused = db.get(ReportSchedule, schedule["id"])
        assert paused.active is False and paused.next_run_at is None


def test_whos_behind_and_completed_cards(api, seeded):
    lst = seeded["list"]["id"]
    groups = statuses(api, lst)
    days_ago = lambda n: (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()  # noqa: E731
    ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "D", "due_date": days_ago(5)}), 201)
    e = ok(api.post(f"/lists/{lst}/tasks", "owner", {"name": "E", "assignees": ["member"], "due_date": days_ago(3)}), 201)
    ok(api.patch(f"/tasks/{e['id']}", "owner", {"status_id": groups["closed"]["id"]}))
    dash = new_dashboard(api, seeded, "owner")
    behind = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "behind"}), 201)
    done = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "completed", "config": {"period": {"preset": "last_7_days"}}}), 201)
    assert (behind["title"], done["title"]) == ("Who's behind", "Completed tasks")
    rows = {r["card_id"]: r["data"] for r in data(api, dash, "owner")}

    b = rows[behind["id"]]
    assert b["total"] == 2
    assert [(r["key"], r["overdue"], r["oldest_days"]) for r in b["rows"]] == [("none", 1, 5), ("member", 1, 2)]
    assert b["rows"][1]["tasks"][0]["name"] == "A"

    c = rows[done["id"]]
    assert (c["total"], c["on_time"], c["late"]) == (2, 1, 1)
    assert {r["key"]: (r["done"], r["late"]) for r in c["rows"]} == {"member": (1, 1), "member2": (1, 0)}
    assert sum(p["count"] for p in c["per_day"]) == 2 and len(c["per_day"]) == 7

    drill = lambda card, seg: [t["name"] for t in ok(api.get(f"/dashboards/{dash['id']}/cards/{card['id']}/tasks", "owner", params={"segment": seg}))["tasks"]]  # noqa: E731
    assert drill(behind, "member") == ["A"] and drill(behind, "none") == ["D"]
    assert drill(done, "member") == ["E"]
    # Both render in emailed reports too.
    as_card = lambda card: SimpleNamespace(type=card["type"])  # noqa: E731
    as_data = lambda card: CardData(card_id=card["id"], type=card["type"], computed_at=datetime.now(timezone.utc), data=rows[card["id"]])  # noqa: E731
    assert "<b>1</b>" in reports.render_card(as_card(behind), as_data(behind)) and "5 days" in reports.render_card(as_card(behind), as_data(behind))
    assert "Total" in reports.render_card(as_card(done), as_data(done))


# --- line, embed and discussion cards; Dashboard views -------------------------------------------


def test_line_cards_need_a_date_grouping(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    bad = api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "line", "config": {"group_by": "status"}})
    assert bad.status_code in (400, 422)
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "line", "config": {"group_by": "created_date"}}), 201)
    row = next(r for r in data(api, dash, "owner") if r["card_id"] == card["id"])
    assert sum(sg["value"] for sg in row["data"]["segments"]) == 2  # A and C (B is closed)


def test_embeds_must_be_https(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    bad = api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "embed", "config": {"url": "http://example.com"}})
    assert bad.status_code in (400, 422)
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "embed", "config": {"url": "https://example.com/sheet"}}), 201)
    row = next(r for r in data(api, dash, "owner") if r["card_id"] == card["id"])
    assert row["data"]["url"] == "https://example.com/sheet"


def test_discussion_cards_take_messages_from_viewers(api, seeded):
    dash = new_dashboard(api, seeded, "owner")
    card = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "discussion", "title": "Chat"}), 201)
    ok(api.post(f"/dashboards/{dash['id']}/shares", "owner", {"user_id": "member", "level": "view"}), 201)
    path = f"/dashboards/{dash['id']}/cards/{card['id']}/messages"
    ok(api.post(path, "owner", {"body": "Numbers look good"}), 201)
    msgs = ok(api.post(path, "member", {"body": "Agreed"}), 201)
    assert [m["body"] for m in msgs] == ["Numbers look good", "Agreed"]
    assert api.get(path, "member2").status_code in (403, 404)
    row = next(r for r in data(api, dash, "owner") if r["card_id"] == card["id"])
    assert row["data"]["count"] == 2
    assert api.delete(f"/dashboard-messages/{msgs[0]['id']}", "member").status_code == 403  # not theirs
    assert api.delete(f"/dashboard-messages/{msgs[1]['id']}", "member").status_code == 204
    assert api.delete(f"/dashboard-messages/{msgs[0]['id']}", "owner").status_code == 204
    assert ok(api.get(path, "owner")) == []
    other = ok(api.post(f"/dashboards/{dash['id']}/cards", "owner", {"type": "calculation"}), 201)
    assert api.post(f"/dashboards/{dash['id']}/cards/{other['id']}/messages", "owner", {"body": "x"}).status_code == 400


def test_dashboard_views_get_a_dashboard_scoped_to_their_location(api, seeded):
    view = ok(api.post(f"/spaces/{seeded['space']['id']}/views", "owner", {"type": "dashboard"}), 201)
    ok(api.post(f"/spaces/{seeded['space']['id']}/members", "owner", {"user_id": "member", "level": "view"}), 201) \
        if False else None
    assert api.get(f"/views/{view['id']}/dashboard", "member2").status_code in (200, 404)
    assert ok(api.get(f"/views/{view['id']}/dashboard", "owner")) is None  # the standard summary until customised
    dash = ok(api.post(f"/views/{view['id']}/dashboard", "owner"), 201)
    assert all(c["config"]["sources"] == [{"kind": "space", "id": seeded["space"]["id"]}] for c in dash["cards"] if "sources" in c["config"])
    again = ok(api.post(f"/views/{view['id']}/dashboard", "owner"), 201)
    assert again["id"] == dash["id"]
    assert dash["name"] not in listed(api, seeded, "owner")  # view dashboards stay out of the Dashboards list
    cards = by_title(dash, data(api, dash, "owner"))
    assert cards["Open tasks"]["data"]["value"] == 2
    # a view isn't a Dashboard view
    table = ok(api.post(f"/spaces/{seeded['space']['id']}/views", "owner", {"type": "table"}), 201)
    assert api.post(f"/views/{table['id']}/dashboard", "owner").status_code == 400


def test_the_top_row_is_the_same_on_every_standard_dashboard():
    """Your own board, your Team's and the company's open with the same four tiles.

    They had drifted apart in three ways at once -- four tiles of width 3 against three of width 4,
    "Done this week" against "Done this month", and so a different layout depending on whose board
    you were looking at. A manager comparing their own figures with their team's was reading two
    rows that only looked alike.

    Pinned here rather than left to the generator, because the drift was invisible: each board is
    built once, when its owner first opens it, so a change to the template only ever showed up on
    the boards made after it.
    """
    from app.services.work.dashboards.standard import _my_work_cards, _people_cards

    def row(cards):
        return [(title, config.get("filters"), width) for kind, title, config, width, height in cards
                if kind == "calculation" and height == 1]

    mine, team, company = row(_my_work_cards()), row(_people_cards(False)), row(_people_cards(True))
    assert mine == team == company, "the standard Dashboards have drifted apart again"
    assert [title for title, _f, _w in mine] == ["Open tasks", "Due today", "Overdue", "Done this week"]
    # Four tiles of width 3 fill the twelve-column row exactly, so it is square on every board.
    assert sum(width for _t, _f, width in mine) == 12
    # The finished-work tile covers the same week as the hours cards underneath it.
    assert mine[3][1] == {"done": "this_week"}
