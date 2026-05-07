"""Tests for ``GET /api/v1/strategies/by-symbol/{symbol}``.

Iteration-10 fix-loop: replaces the stub on the symbols ticker page with a
read-only fan-out endpoint that asks "which strategies have this symbol in
their universe / hold it / have an entry signal?".

The MVP scope ships ``current_position`` from the trade ledger only;
``in_universe`` is hardcoded True, and ``has_entry_signal`` / ``score`` /
``side`` are hardcoded falsy until the per-strategy signal-cache integration
lands. These tests pin that contract so the frontend doesn't get caught by a
silent shape regression.
"""

from __future__ import annotations

from typing import Any

import pytest

from api.routes import strategies as strat_mod


def _patch_ledger(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]]) -> None:
    """Stub TradeLedger so the route reads from ``rows`` instead of Postgres."""

    from data.ingestion import trade_ledger as ledger_mod

    class _StubLedger:
        def list(self, filter: dict[str, Any] | None = None) -> list[dict[str, Any]]:
            if not filter:
                return list(rows)
            sym = filter.get("symbol")
            if sym is not None:
                return [r for r in rows if r.get("symbol") == sym]
            return list(rows)

    monkeypatch.setattr(ledger_mod, "TradeLedger", _StubLedger)


def _patch_redis_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the Redis cache helpers so each test recomputes the response."""

    from core import redis as redis_mod

    async def _miss(_key: str) -> None:
        return None

    async def _noop_set(_key: str, _data: Any, ttl_seconds: int = 60) -> None:
        return None

    monkeypatch.setattr(redis_mod, "cache_get", _miss)
    monkeypatch.setattr(redis_mod, "cache_set", _noop_set)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_returns_one_match_per_known_strategy(monkeypatch: pytest.MonkeyPatch) -> None:
    """The endpoint fans out across every catalogue entry, not just a subset."""
    _patch_ledger(monkeypatch, rows=[])
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")

    assert resp.symbol == "NVDA"
    # Catalogue contains all 12 phase-1 strategies plus the fallback / planned
    # entries (claude-alpha, manual-discretionary, etc.). The exact count depends
    # on the catalogue, but we want at least the 12 phase-1 strategies and a
    # superset that includes claude-alpha / manual-discretionary.
    ids = {m.strategy_id for m in resp.matches}
    expected_phase_1 = {
        "momentum-quality", "pead", "vrp-harvesting", "earnings-vol-premium",
        "regime-adaptive", "ts-momentum", "rsi2-reversal", "dual-momentum",
        "pairs-trading", "kama-breakout", "orb", "vwap-strategy",
    }
    assert expected_phase_1.issubset(ids), (
        f"Missing phase-1 strategies in matches: {expected_phase_1 - ids}"
    )
    assert len(resp.matches) == len(strat_mod._STRATEGIES)
    # Stable order — sorted by strategy_id.
    assert [m.strategy_id for m in resp.matches] == sorted(ids)


@pytest.mark.asyncio
async def test_no_open_positions_returns_null_position_for_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """User with no open positions in this symbol → all matches have current_position=None."""
    _patch_ledger(monkeypatch, rows=[])
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")

    for m in resp.matches:
        assert m.current_position is None, f"Expected null position for {m.strategy_id}"
        # MVP defaults
        assert m.in_universe is True
        assert m.has_entry_signal is False
        assert m.score is None
        assert m.side is None
        # last_evaluated is a non-empty ISO string
        assert m.last_evaluated
        assert "T" in m.last_evaluated


@pytest.mark.asyncio
async def test_open_position_in_one_strategy_fills_only_that_strategy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An open NVDA trade under ``momentum_quality`` populates only that strategy's position."""
    rows = [
        {
            "symbol": "NVDA",
            "shares": 50,
            "entry_price": 410.25,
            "pnl": 125.50,
            "status": "open",
            "strategy": "momentum_quality",
        },
    ]
    _patch_ledger(monkeypatch, rows=rows)
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")

    by_id = {m.strategy_id: m for m in resp.matches}
    momentum = by_id["momentum-quality"]
    assert momentum.current_position is not None
    assert momentum.current_position.qty == 50
    assert momentum.current_position.entry_price == pytest.approx(410.25)
    assert momentum.current_position.unrealized_pnl == pytest.approx(125.50)

    # Every OTHER strategy must have a null position — the ledger row is scoped
    # to momentum_quality.
    for sid, m in by_id.items():
        if sid == "momentum-quality":
            continue
        assert m.current_position is None, (
            f"Strategy {sid!r} unexpectedly inherited momentum-quality's position"
        )


@pytest.mark.asyncio
async def test_closed_or_unrelated_trades_are_ignored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Closed trades on the same symbol must NOT fill ``current_position``."""
    rows = [
        {
            "symbol": "NVDA",
            "shares": 100,
            "entry_price": 380.0,
            "pnl": 5000.0,
            "status": "closed",  # closed → must be ignored
            "strategy": "pead",
        },
        {
            "symbol": "AAPL",  # different symbol — ledger.list filter handles this
            "shares": 200,
            "entry_price": 175.0,
            "status": "open",
            "strategy": "momentum_quality",
        },
    ]
    _patch_ledger(monkeypatch, rows=rows)
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")

    for m in resp.matches:
        assert m.current_position is None, (
            f"Closed/unrelated trade leaked into {m.strategy_id}"
        )


@pytest.mark.asyncio
async def test_partial_fill_status_treated_as_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``partial`` and ``partial_fill`` rows should fill ``current_position``."""
    rows = [
        {
            "symbol": "NVDA",
            "shares": 25,
            "entry_price": 410.0,
            "pnl": None,  # nullable on partial fills
            "status": "partial_fill",
            "strategy": "vrp_harvest",
        },
    ]
    _patch_ledger(monkeypatch, rows=rows)
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("NVDA")

    by_id = {m.strategy_id: m for m in resp.matches}
    pos = by_id["vrp-harvesting"].current_position
    assert pos is not None
    assert pos.qty == 25
    assert pos.entry_price == pytest.approx(410.0)
    # Null pnl coerces to 0.0 — never bubble None up to the frontend.
    assert pos.unrealized_pnl == 0.0


@pytest.mark.asyncio
async def test_symbol_is_uppercased(monkeypatch: pytest.MonkeyPatch) -> None:
    """Lower-case input is normalised so cache keys / responses are stable."""
    _patch_ledger(monkeypatch, rows=[])
    _patch_redis_noop(monkeypatch)

    resp = await strat_mod.get_strategies_by_symbol("nvda")
    assert resp.symbol == "NVDA"
