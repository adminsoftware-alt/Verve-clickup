from logging.config import fileConfig
from typing import Optional

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings
from app.db.base import Base
import app.db.models  # noqa: F401  (registers every table on Base.metadata)

config = context.config

if config.config_file_name is not None and not config.attributes.get("skip_logging_config"):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    """Resolve the URL without routing it through alembic.ini, so passwords stay in .env.

    Priority: `alembic -x url=...`, then DATABASE_URL from settings.
    """
    url: Optional[str] = context.get_x_argument(as_dictionary=True).get("url") or settings.DATABASE_URL
    if not url:
        raise RuntimeError("Set DATABASE_URL in backend/.env (or pass -x url=...) to run migrations")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Tests pass an open connection so migrations run inside their database.
    connection = config.attributes.get("connection")
    if connection is not None:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()
        return

    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
