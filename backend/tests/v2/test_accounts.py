from sqlalchemy import func, select

from app.db import session as db_session
from app.db.models import User
from app.services.work.accounts import ensure_user
from tests.v2.conftest import ok


def test_first_sign_in_creates_the_user_once(api):
    ok(api.get("/workspaces", "newcomer"))
    ok(api.get("/workspaces", "newcomer"))
    with db_session._session_factory() as db:  # type: ignore[misc]
        assert db.scalar(select(func.count()).select_from(User).where(User.id == "newcomer")) == 1


def test_concurrent_first_requests_do_not_crash(database_url):
    """Two requests for a brand-new user both see no row, then both try to create it."""
    factory = db_session._session_factory
    assert factory is not None
    first, second = factory(), factory()
    try:
        assert first.get(User, "racer") is None
        assert second.get(User, "racer") is None

        user, changed = ensure_user(first, "racer", "racer@example.com", "Racer")
        first.commit()
        assert changed and user.id == "racer"

        # The second request lost the race; it must reuse the row, not fail.
        user, _ = ensure_user(second, "racer", "racer@example.com", "Racer")
        second.commit()
        assert user.id == "racer"
    finally:
        first.close()
        second.close()

    with factory() as db:
        assert db.scalar(select(func.count()).select_from(User).where(User.id == "racer")) == 1


def test_profile_changes_are_saved(api):
    ok(api.get("/workspaces", "renamer"))
    with db_session._session_factory() as db:  # type: ignore[misc]
        user, changed = ensure_user(db, "renamer", "renamer@example.com", "New Name")
        db.commit()
        assert changed and user.display_name == "New Name"
