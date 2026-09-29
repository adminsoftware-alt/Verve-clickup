"""The local testing sign-in is a way past authentication, so it must stay shut unless asked for."""

import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app.api.deps import get_current_user
from app.core.config import Settings, settings
from tests.v2.conftest import ok


def token(value: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=value)


@pytest.fixture
def dev_login():
    """Switches DEV_LOGIN on for one test and back to whatever it was afterwards."""
    before = settings.DEV_LOGIN
    settings.DEV_LOGIN = True
    try:
        yield
    finally:
        settings.DEV_LOGIN = before


@pytest.fixture
def dev_login_off():
    """The shipped state, whatever the machine's own .env says."""
    before = settings.DEV_LOGIN
    settings.DEV_LOGIN = False
    try:
        yield
    finally:
        settings.DEV_LOGIN = before


def test_a_dev_token_is_refused_while_dev_login_is_off(monkeypatch, dev_login_off):
    assert Settings.model_fields["DEV_LOGIN"].default is False  # off unless an .env asks for it
    monkeypatch.setattr("app.api.deps.verify_token", lambda _t: None)
    with pytest.raises(HTTPException) as exc:
        get_current_user(token("dev:owner"))
    assert exc.value.status_code == 401


def test_a_dev_token_names_the_person_while_dev_login_is_on(dev_login):
    assert get_current_user(token("dev:owner")) == {"uid": "owner", "dev": True}
    with pytest.raises(HTTPException) as exc:
        get_current_user(token("dev:"))
    assert exc.value.status_code == 401


def test_the_list_of_people_to_be_is_hidden_unless_dev_login_is_on(api, workspace, dev_login_off):
    assert api.client.get("/api/v2/dev/people").status_code == 404


def test_with_dev_login_on_it_lists_the_workspace_to_choose_from(api, workspace, dev_login):
    people = ok(api.client.get("/api/v2/dev/people"))
    assert {p["id"] for p in people} >= {"owner", "admin", "member"}
    assert {p["role"] for p in people} >= {"owner", "member"}
    assert all(p["workspace"] == workspace["name"] for p in people)
    assert all(p["email"] and "leads" in p for p in people)


def test_signing_in_as_someone_finds_that_very_person_and_invents_nobody(api, workspace, dev_login):
    from fastapi import HTTPException as Fail

    from app.api.v2.deps import current_user
    from app.db import session as db_session

    db = db_session.new_session()
    try:
        assert current_user({"uid": "member", "dev": True}, db).id == "member"
        with pytest.raises(Fail) as exc:
            current_user({"uid": "ghost", "dev": True}, db)
        assert exc.value.status_code == 401
        assert db.get(__import__("app.db.models", fromlist=["User"]).User, "ghost") is None  # nothing was created
    finally:
        db.close()
