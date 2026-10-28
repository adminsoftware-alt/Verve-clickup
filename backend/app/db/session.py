import time
from typing import Iterator, Optional

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine, event, exc
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None

# Read timestamps back in UTC, whatever the server's timezone, so the API is consistent.
# TCP keepalives stop routers and the Supabase pooler from silently dropping idle pooled connections.
_CONNECT_ARGS = {
    "options": "-c timezone=utc",
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 3,
}

# Every query is a network round trip to the database, and opening a connection costs several
# more, so connections are kept open and reused. No overflow: a request beyond the pool waits a
# moment for a free connection, which is quicker than opening one, and the server never goes
# past its share of the database's connection limit (see DB_POOL_SIZE).
_POOL_ARGS = {"max_overflow": 0, "pool_recycle": 1800}

# Checking a connection before every use would add a round trip to every request
# (pool_pre_ping), so only a connection that sat idle this long is checked first.
_IDLE_CHECK_SECONDS = 60


def _build(url: str) -> Engine:
    engine = create_engine(url, connect_args=_CONNECT_ARGS, pool_size=settings.DB_POOL_SIZE, **_POOL_ARGS)

    @event.listens_for(engine, "checkin")
    def _returned(dbapi_conn, record):
        record.info["idle_since"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _borrowed(dbapi_conn, record, proxy):
        since = record.info.get("idle_since")
        if since is None or time.monotonic() - since < _IDLE_CHECK_SECONDS:
            return
        try:
            cursor = dbapi_conn.cursor()
            cursor.execute("SELECT 1")
            cursor.close()
            dbapi_conn.rollback()
        except Exception:
            # The pool discards this connection and hands out a fresh one.
            raise exc.DisconnectionError()

    return engine


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        if not settings.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        _engine = _build(settings.DATABASE_URL)
        # expire_on_commit=False: responses are serialised from ORM objects after commit.
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def warm_pool() -> None:
    """Open the pool's connections up front, so the first page after a start doesn't pay for them."""
    engine = get_engine()
    conns = []
    try:
        for _ in range(settings.DB_POOL_SIZE):
            conns.append(engine.connect())
    finally:
        for conn in conns:
            conn.close()


def configure_engine(url: str) -> Engine:
    """Point the session factory at a specific database. Used by tests."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = _build(url)
    _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def get_db() -> Iterator[Session]:
    """Request-scoped session. Endpoints commit explicitly; anything unhandled rolls back."""
    try:
        get_engine()
    except RuntimeError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is not configured on this server",
        )
    assert _session_factory is not None
    session = _session_factory()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def new_session() -> Session:
    """A session for background work outside a request."""
    get_engine()
    assert _session_factory is not None
    return _session_factory()
