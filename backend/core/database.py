from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Lazy singletons -- populated on first use
_engine: Any = None
_async_session_factory: Any = None
_Base: Any = None


def _get_base() -> Any:
    """Return the declarative Base class, creating it on first call."""
    global _Base
    if _Base is None:
        from sqlalchemy import MetaData
        from sqlalchemy.orm import DeclarativeBase

        class Base(DeclarativeBase):
            metadata = MetaData(naming_convention=NAMING_CONVENTION)

        _Base = Base
    return _Base


def _get_engine() -> Any:
    """Return the async engine, creating it on first call.

    Persona-79 Race 8 (DB pool starvation under retry storm). The previous
    ``pool_size=5, max_overflow=5`` cap (10 concurrent ops total) made every
    endpoint starve under a parallel Idempotency-Key retry storm — a single
    flapping client could exhaust the pool and trigger 30 s checkout hangs
    across the whole API. We bump to 20 + 10 (30 total), enforce a per-
    statement timeout via ``connect_args`` so a stuck query can't hold a
    connection forever, and shorten ``pool_timeout`` so checkout exhaustion
    fails the request fast (5 s) instead of hanging the worker. asyncpg
    accepts ``server_settings`` for session-level GUCs; ``statement_timeout``
    is the standard Postgres knob and applies to every statement on the
    connection.
    """
    global _engine
    if _engine is None:
        from sqlalchemy.ext.asyncio import create_async_engine

        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.DEBUG,
            pool_size=20,
            max_overflow=10,
            pool_pre_ping=True,
            pool_recycle=300,
            pool_timeout=5.0,
            connect_args={
                # asyncpg uses ``server_settings`` to pass through Postgres
                # session GUCs; statement_timeout is in milliseconds. 5 s is
                # well above the slowest p99 we see for legit queries (~120
                # ms) and short enough to stop a runaway query from holding a
                # pooled connection past the checkout timeout.
                "server_settings": {"statement_timeout": "5000"},
            },
        )
    return _engine


def _get_session_factory() -> Any:
    """Return the async session factory, creating it on first call."""
    global _async_session_factory
    if _async_session_factory is None:
        from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

        _async_session_factory = async_sessionmaker(
            _get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _async_session_factory


# Public accessor so that models.py can do ``from core.database import get_base``
# instead of importing Base directly (which would trigger sqlalchemy).
def get_base() -> Any:
    """Public accessor for the Base class (triggers sqlalchemy import)."""
    return _get_base()


async def get_db() -> AsyncGenerator[Any, None]:
    """FastAPI dependency that yields an async database session."""
    factory = _get_session_factory()
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create all tables. Called once at startup for dev convenience."""
    # Force-trigger lazy model definitions so classes register on Base.metadata
    from data.storage.models import _define_models
    _define_models()

    engine = _get_engine()
    base = _get_base()
    async with engine.begin() as conn:
        await conn.run_sync(base.metadata.create_all)
    logger.info("Database tables initialised")

    # Convert ohlcv_bars to a TimescaleDB hypertable (if the extension exists)
    try:
        from sqlalchemy import text

        async with engine.begin() as conn:
            await conn.execute(text(
                "SELECT create_hypertable('ohlcv_bars', 'timestamp', if_not_exists => TRUE)"
            ))
        logger.info("TimescaleDB hypertable ensured for ohlcv_bars")
    except Exception:
        # TimescaleDB may not be installed, or table may not exist yet --
        # either way, non-fatal.
        logger.debug("Hypertable creation skipped", exc_info=True)


async def close_db() -> None:
    global _engine, _async_session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _async_session_factory = None
    logger.info("Database engine disposed")
