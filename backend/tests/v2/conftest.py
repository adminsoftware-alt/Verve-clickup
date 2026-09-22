"""Fixtures for v2 tests. These run against a real Postgres test database.

The test database is `<DATABASE_URL database>_test` (or TEST_DATABASE_URL). It is
created if missing, built by running the Alembic migrations, and truncated after
every test.
"""

import os
from typing import Any, Dict, Optional

import pytest
from alembic import command
from alembic.config import Config
from fastapi import Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.api.deps import get_current_user
from app.core.config import settings

settings.REPORTS_SCHEDULER_ENABLED = False  # tests call reports.run_due directly
from app.db import session as db_session
from app.db.base import Base
from app.main import app

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _test_database_url() -> Optional[str]:
    explicit = os.getenv("TEST_DATABASE_URL")
    if explicit:
        return explicit
    if not settings.DATABASE_URL:
        return None
    url = make_url(settings.DATABASE_URL)
    return url.set(database=f"{url.database}_test").render_as_string(hide_password=False)


def _ensure_database(url: str) -> None:
    target = make_url(url)
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": target.database})
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{target.database}"'))
    admin.dispose()


@pytest.fixture(scope="session")
def database_url():
    url = _test_database_url()
    if not url:
        pytest.skip("DATABASE_URL is not configured; v2 tests need Postgres")
    name = make_url(url).database or ""
    if not name.endswith("_test"):
        # The schema is dropped below; never let that touch a real database.
        pytest.exit(f"Refusing to run v2 tests against '{name}': the database name must end in _test")
    _ensure_database(url)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(BACKEND_DIR, "alembic"))
    cfg.attributes["skip_logging_config"] = True
    with engine.begin() as conn:
        cfg.attributes["connection"] = conn
        command.upgrade(cfg, "head")
    engine.dispose()
    db_session.configure_engine(url)
    yield url


@pytest.fixture(autouse=True)
def _clean_tables(request):
    yield
    if "database_url" not in request.fixturenames:
        return  # pure unit test; never touched the database
    engine = db_session.get_engine()
    tables = ", ".join(f'"{t.name}"' for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))


class Api:
    """A test client that acts as whichever user a call names."""

    def __init__(self, client: TestClient):
        self.client = client

    def _call(self, method: str, path: str, as_user: str, **kwargs) -> Any:
        headers = {"X-Test-User": as_user}
        return self.client.request(method, f"/api/v2{path}", headers=headers, **kwargs)

    def get(self, path: str, as_user: str, **kw):
        return self._call("GET", path, as_user, **kw)

    def post(self, path: str, as_user: str, json: Optional[Dict] = None, **kw):
        return self._call("POST", path, as_user, json=json or {}, **kw)

    def patch(self, path: str, as_user: str, json: Dict, **kw):
        return self._call("PATCH", path, as_user, json=json, **kw)

    def put(self, path: str, as_user: str, json: Dict, **kw):
        return self._call("PUT", path, as_user, json=json, **kw)

    def delete(self, path: str, as_user: str, **kw):
        return self._call("DELETE", path, as_user, **kw)


def _token_from_header(request: Request) -> dict:
    uid = request.headers.get("X-Test-User", "anonymous")
    return {"uid": uid, "email": f"{uid}@example.com", "name": uid.title()}


@pytest.fixture
def api(database_url):
    previous = app.dependency_overrides.get(get_current_user)
    app.dependency_overrides[get_current_user] = _token_from_header
    try:
        yield Api(TestClient(app))
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_current_user, None)
        else:
            app.dependency_overrides[get_current_user] = previous


def ok(response, code: int = 200) -> Any:
    assert response.status_code == code, f"{response.status_code}: {response.text}"
    return response.json() if response.content else None


@pytest.fixture
def workspace(api):
    """A workspace owned by 'owner', with 'member' and 'guest' already joined."""
    ws = ok(api.post("/workspaces", "owner", {"name": "Verve"}), 201)
    for uid, role in (("member", "member"), ("guest", "guest"), ("admin", "admin")):
        ok(api.get("/workspaces", uid))  # first sight creates the user row
        ok(api.post(f"/workspaces/{ws['id']}/members", "owner", {"email": f"{uid}@example.com", "role": role}), 201)
    ok(api.get("/workspaces", "outsider"))
    return ws


@pytest.fixture
def space(api, workspace):
    return ok(api.post(f"/workspaces/{workspace['id']}/spaces", "owner", {"name": "Operations"}), 201)


@pytest.fixture
def folderless_list(api, space):
    return ok(api.post(f"/spaces/{space['id']}/lists", "owner", {"name": "Backlog"}), 201)
