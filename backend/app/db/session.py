from typing import Iterator, Optional

from fastapi import HTTPException, status
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

_engine: Optional[Engine] = None
_session_factory: Optional[sessionmaker] = None

# Read timestamps back in UTC, whatever the server's timezone, so the API is consistent.
_CONNECT_ARGS = {"options": "-c timezone=utc"}


def get_engine() -> Engine:
    global _engine, _session_factory
    if _engine is None:
        if not settings.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not configured")
        _engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, connect_args=_CONNECT_ARGS)
        # expire_on_commit=False: responses are serialised from ORM objects after commit.
        _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def configure_engine(url: str) -> Engine:
    """Point the session factory at a specific database. Used by tests."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(url, pool_pre_ping=True, connect_args=_CONNECT_ARGS)
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
