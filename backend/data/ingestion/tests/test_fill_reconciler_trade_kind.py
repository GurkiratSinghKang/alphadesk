"""Wave 5α — unit tests for ``_compute_trade_kind`` (Wave 4P Fix 3 / P97).

Persona-106 NO-GO verdict flagged this classifier as untested.  The
function is a pure table lookup against the pre-fill position qty + the
broker-side (``buy`` / ``sell``); we exercise every branch so a silent
regression on the mapping table can never reach production.

Branches covered
----------------
pre_fill_qty > 0 (long)     + buy   → ``long_open``
pre_fill_qty > 0 (long)     + sell  → ``long_close``
pre_fill_qty < 0 (short)    + sell  → ``short_open``
pre_fill_qty < 0 (short)    + buy   → ``short_close``
pre_fill_qty == 0 (flat)    + buy   → ``long_open``
pre_fill_qty == 0 (flat)    + sell  → ``short_open``
pre_fill_qty is None (broker lookup failed) → None
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Ensure ``backend/`` is importable (matches the rest of the backend test suite).
BACKEND_ROOT = Path(__file__).resolve().parents[3]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Existing-long position branches
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_long_plus_buy_returns_long_open() -> None:
    """Adding to an existing long via ``buy`` classifies as ``long_open``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="AAPL", side="buy", filled_qty=5.0, pre_fill_qty=10.0,
    )
    assert kind == "long_open"


@pytest.mark.asyncio
async def test_long_plus_sell_returns_long_close() -> None:
    """Trimming an existing long via ``sell`` classifies as ``long_close``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="AAPL", side="sell", filled_qty=5.0, pre_fill_qty=10.0,
    )
    assert kind == "long_close"


# ---------------------------------------------------------------------------
# Existing-short position branches
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_short_plus_sell_returns_short_open() -> None:
    """Adding to an existing short via ``sell`` classifies as ``short_open``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="MSFT", side="sell", filled_qty=3.0, pre_fill_qty=-5.0,
    )
    assert kind == "short_open"


@pytest.mark.asyncio
async def test_short_plus_buy_returns_short_close() -> None:
    """Covering an existing short via ``buy`` classifies as ``short_close``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="MSFT", side="buy", filled_qty=3.0, pre_fill_qty=-5.0,
    )
    assert kind == "short_close"


# ---------------------------------------------------------------------------
# Flat (pre_fill_qty == 0) branches — new position
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flat_plus_buy_returns_long_open() -> None:
    """Opening a new long from flat classifies as ``long_open``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="NVDA", side="buy", filled_qty=7.0, pre_fill_qty=0.0,
    )
    assert kind == "long_open"


@pytest.mark.asyncio
async def test_flat_plus_sell_returns_short_open() -> None:
    """Opening a new short from flat classifies as ``short_open``."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="NVDA", side="sell", filled_qty=7.0, pre_fill_qty=0.0,
    )
    assert kind == "short_open"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_none_pre_fill_qty_returns_none() -> None:
    """Broker lookup failure (``pre_fill_qty=None``) must NOT fabricate a kind."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    kind = await _compute_trade_kind(
        symbol="AAPL", side="buy", filled_qty=5.0, pre_fill_qty=None,
    )
    assert kind is None


@pytest.mark.asyncio
async def test_side_is_case_insensitive() -> None:
    """Upper-case broker sides normalise to the same classification."""
    from data.ingestion.fill_reconciler import _compute_trade_kind

    # ``BUY`` (any case) → same as ``buy``.
    assert (
        await _compute_trade_kind(
            symbol="AAPL", side="BUY", filled_qty=1.0, pre_fill_qty=0.0,
        )
        == "long_open"
    )
    assert (
        await _compute_trade_kind(
            symbol="AAPL", side="Sell", filled_qty=1.0, pre_fill_qty=10.0,
        )
        == "long_close"
    )


@pytest.mark.asyncio
async def test_unknown_side_falls_into_else_branch() -> None:
    """A non-``buy``/``sell`` side still returns a deterministic kind.

    The existing classifier treats anything that isn't ``buy`` as the
    sell branch (this is intentional — callers already normalise via
    ``(side or "").lower()``).  Locking the behaviour so a refactor
    can't quietly change it.
    """
    from data.ingestion.fill_reconciler import _compute_trade_kind

    # Long position + unknown side → long_close (else branch of the ``if long``).
    assert (
        await _compute_trade_kind(
            symbol="AAPL", side="xyz", filled_qty=1.0, pre_fill_qty=10.0,
        )
        == "long_close"
    )
    # Flat + unknown side → short_open (else branch of the ``if flat``).
    assert (
        await _compute_trade_kind(
            symbol="AAPL", side="xyz", filled_qty=1.0, pre_fill_qty=0.0,
        )
        == "short_open"
    )
