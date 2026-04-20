from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
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


# ---------------------------------------------------------------------------
# Wave 4R Fix 6 — long-query timeout override
# ---------------------------------------------------------------------------
# The engine-wide ``statement_timeout=5000`` (5 s) is deliberately tight so
# one runaway query can't pin a pooled connection through the 5-s checkout
# timeout. Long analytic / report queries (quarterly P&L rollups, per-
# symbol 52-week OHLCV aggregates) legitimately run longer than that and
# would otherwise fail with ``canceling statement due to statement
# timeout``. This context manager bumps the Postgres session-level
# ``statement_timeout`` for the duration of the ``async with`` block and
# restores it on exit, regardless of whether the block raised.
#
# Usage:
#
#     from core.database import long_query_timeout, get_db
#
#     @router.get("/reports/pnl")
#     async def pnl_report(db: AsyncSession = Depends(get_db)):
#         async with long_query_timeout(db, timeout_ms=30_000):
#             rows = (await db.execute(text("SELECT ..."))).fetchall()
#         return rows
#
# Notes:
# * The override is scoped to the current session / connection. Because the
#   pool reuses connections across requests, we MUST reset the GUC on exit
#   — otherwise the next request that checks out the same connection
#   inherits the loosened timeout and loses the tight default. We do the
#   reset in a ``finally`` so it runs on happy path AND on exceptions.
# * ``LOCAL`` cannot be used outside a transaction; SQLAlchemy's async
#   session may or may not have one open. We use ``SET`` (session-level)
#   with an explicit reset — safe in both cases.


async def _set_statement_timeout(session: Any, timeout_ms: int) -> None:
    """Issue ``SET statement_timeout = '<N>ms'`` on the given session."""
    from sqlalchemy import text

    await session.execute(text(f"SET statement_timeout = '{int(timeout_ms)}ms'"))


@asynccontextmanager
async def long_query_timeout(
    session: Any, timeout_ms: int = 30_000
) -> AsyncIterator[Any]:
    """Temporarily bump ``statement_timeout`` on the given session.

    Yields the same ``session`` so the caller can ``async with
    long_query_timeout(db) as s:`` if they prefer to read the value back;
    the no-argument form ``async with long_query_timeout(db): ...`` also
    works.

    Parameters
    ----------
    session:
        An ``AsyncSession`` bound to the asyncpg-backed engine. The
        session must already be checked out (i.e. usable); we issue the
        ``SET`` against it directly.
    timeout_ms:
        New statement_timeout in milliseconds.  Default 30_000 (30 s) —
        well above the slowest legitimate analytic query (~12 s at p99)
        and short enough that a truly stuck query doesn't hoard the
        connection forever.

    Behaviour on exit
    -----------------
    The session-level ``statement_timeout`` is reset to the engine default
    (``5000ms``, matching ``_get_engine``'s ``connect_args`` setting) so
    the next request that re-uses this pooled connection sees the tight
    default. Reset runs even if the inner block raised.
    """
    default_ms = 5000  # Must mirror _get_engine connect_args.
    try:
        await _set_statement_timeout(session, timeout_ms)
        yield session
    finally:
        # Always restore, even on exception, so pooled connection reuse is
        # safe. Swallow reset failures so a DB blip inside the block
        # doesn't mask the original error.
        try:
            await _set_statement_timeout(session, default_ms)
        except Exception:
            logger.warning(
                "long_query_timeout: failed to reset statement_timeout",
                exc_info=True,
            )
