"""Monthly reviews: marked done by the person, seen by their Manager and by admins, and only for open months."""

from datetime import date

from app.services.work.reviews import open_months
from tests.v2.conftest import ok


def test_a_review_opens_on_the_25th_and_stays_open_into_the_next_month():
    assert open_months(date(2026, 10, 24)) == [date(2026, 9, 1)]
    assert open_months(date(2026, 10, 25)) == [date(2026, 9, 1), date(2026, 10, 1)]
    assert open_months(date(2026, 11, 3)) == [date(2026, 10, 1)]
    assert open_months(date(2027, 1, 2)) == [date(2026, 12, 1)]


def test_people_mark_their_review_and_their_manager_and_admins_see_it(api, workspace):
    ws = workspace["id"]
    ok(api.get("/workspaces", "lead"))
    ok(api.post(f"/workspaces/{ws}/members", "owner", {"email": "lead@example.com", "role": "member"}), 201)
    team = ok(api.post(f"/workspaces/{ws}/teams", "owner", {"name": "Tax", "member_ids": ["lead", "member"]}), 201)
    ok(api.put(f"/teams/{team['id']}/members", "owner", {"user_ids": ["lead", "member"], "lead_ids": ["lead"]}))

    month = sorted(ok(api.get(f"/workspaces/{ws}/reviews/mine", "member"))["months"])[0]
    assert ok(api.get(f"/workspaces/{ws}/reviews/mine", "member"))["months"][month] is None

    # The member marks theirs; the lead sees it, and sees themselves left out (theirs is their own).
    ok(api.post(f"/workspaces/{ws}/reviews", "member", {"month": month}))
    assert ok(api.get(f"/workspaces/{ws}/reviews/mine", "member"))["months"][month] is not None
    seen = {r["user_id"]: r for r in ok(api.get(f"/workspaces/{ws}/reviews", "lead", params={"month": month}))}
    assert set(seen) == {"member"} and seen["member"]["completed_at"] is not None

    # An admin sees everyone and can undo someone's; an Employee sees nobody else's.
    everyone = {r["user_id"]: r for r in ok(api.get(f"/workspaces/{ws}/reviews", "admin", params={"month": month}))}
    assert {"member", "lead"} <= set(everyone) and everyone["lead"]["completed_at"] is None
    ok(api.post(f"/workspaces/{ws}/reviews", "admin", {"month": month, "user_id": "member", "done": False}))
    assert ok(api.get(f"/workspaces/{ws}/reviews/mine", "member"))["months"][month] is None
    assert api.get(f"/workspaces/{ws}/reviews", "member", params={"month": month}).status_code == 403

    # Nobody marks someone else's but an admin, nor a month that has not opened.
    assert api.post(f"/workspaces/{ws}/reviews", "lead", {"month": month, "user_id": "member"}).status_code == 403
    assert api.post(f"/workspaces/{ws}/reviews", "member", {"month": "2099-01"}).status_code in (400, 422)
