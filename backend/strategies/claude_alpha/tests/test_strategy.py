"""Unit tests for Claude Alpha v0 — replay-cache + deterministic fallback."""

from __future__ import annotations

import json
import tempfile
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Iterable
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import (
    OrderType,
    Position,
    StrategyInput,
    TimeInForce,
)
from strategies.claude_alpha.config import (
    CLAUDE_ALPHA_UNIVERSE_SEED,
    ClaudeAlphaParams,
)
from strategies.claude_alpha.strategy import (
    ClaudeAlphaStrategy,
    _build_holding_exits,
    _cache_path,
    _deterministic_fallback_score,
    _input_hash,
    _is_rebalance_day,
    _read_cached_scores,
    _score_universe,
    _write_cached_scores,
)


# --------------------------------------------------------------------------- #
# Synthetic helpers                                                           #
# --------------------------------------------------------------------------- #
def _build_panel(*, end: date, n_days: int, spec: dict[str, "Iterable[float] | float"]) -> pd.DataFrame:
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D", tz="UTC")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        prices = [float(recipe(i)) for i in range(n_days)] if callable(recipe) else [float(recipe)] * n_days
        for d, p in zip(dates, prices):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p, "low": p, "close": p,
                "volume": 5_000_000,
            })
    return pd.DataFrame(rows).set_index(["date", "symbol"])


def _build_input(asof: date, bars: pd.DataFrame) -> StrategyInput:
    return StrategyInput(
        asof=asof,
        mode="backtest",
        bars=bars,
        positions=[],
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        state={},
        seed=0,
        rng=np.random.default_rng(0),
    )


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestRebalanceDay:
    def test_friday_weekly(self):
        assert _is_rebalance_day(date(2024, 5, 3), "weekly") is True  # Fri

    def test_thursday_weekly_false(self):
        assert _is_rebalance_day(date(2024, 5, 2), "weekly") is False

    def test_last_business_day_monthly(self):
        # Apr 30 2024 = Tue, last business day of April
        assert _is_rebalance_day(date(2024, 4, 30), "monthly") is True


class TestInputHash:
    def test_deterministic(self):
        bars = _build_panel(end=date(2024, 5, 1), n_days=10, spec={"AAPL": 100.0})
        inp = _build_input(date(2024, 5, 1), bars)
        h1 = _input_hash(inp, date(2024, 5, 1))
        h2 = _input_hash(inp, date(2024, 5, 1))
        assert h1 == h2

    def test_changes_with_asof(self):
        bars = _build_panel(end=date(2024, 5, 1), n_days=10, spec={"AAPL": 100.0})
        inp = _build_input(date(2024, 5, 1), bars)
        h1 = _input_hash(inp, date(2024, 5, 1))
        h2 = _input_hash(inp, date(2024, 5, 2))
        assert h1 != h2


class TestCacheRoundtrip:
    def test_write_then_read(self, tmp_path):
        path = tmp_path / "test_scores.json"
        scores = {"AAPL": 0.75, "MSFT": 0.92}
        _write_cached_scores(path, scores)
        out = _read_cached_scores(path)
        assert out == {"AAPL": 0.75, "MSFT": 0.92}

    def test_read_missing_returns_none(self, tmp_path):
        path = tmp_path / "nonexistent.json"
        assert _read_cached_scores(path) is None

    def test_read_corrupt_returns_none(self, tmp_path):
        path = tmp_path / "corrupt.json"
        path.write_text("not valid json {{")
        assert _read_cached_scores(path) is None


class TestDeterministicFallback:
    def test_higher_return_higher_score(self):
        # AAPL: +50% over the window, MSFT: flat
        bars = _build_panel(
            end=date(2024, 5, 1),
            n_days=300,
            spec={
                "AAPL": lambda i: 100.0 * (1.0015 ** i),  # ~50% over 300 days
                "MSFT": 100.0,  # flat
            },
        )
        inp = _build_input(date(2024, 5, 1), bars)
        scores = _deterministic_fallback_score(["AAPL", "MSFT"], inp, date(2024, 5, 1))
        assert "AAPL" in scores
        assert "MSFT" in scores
        # Min-max normalized → strongest gets 1.0
        assert scores["AAPL"] == 1.0
        assert scores["MSFT"] == 0.0

    def test_returns_empty_when_bars_missing(self):
        inp = _build_input(
            date(2024, 5, 1),
            pd.DataFrame(index=pd.MultiIndex.from_tuples([], names=["date", "symbol"])),
        )
        scores = _deterministic_fallback_score(["AAPL"], inp, date(2024, 5, 1))
        assert scores == {}


class TestScoreUniverseReplayDeterminism:
    def test_two_runs_produce_identical_scores(self, tmp_path):
        """The whole point of the cache: two runs of same input → same scores."""
        # Patch the cache dir to a tmp path
        with patch("strategies.claude_alpha.strategy._REPLAY_CACHE_DIR", tmp_path):
            bars = _build_panel(
                end=date(2024, 5, 3),
                n_days=300,
                spec={
                    "AAPL": lambda i: 100.0 + i * 0.1,
                    "MSFT": lambda i: 100.0 + i * 0.05,
                },
            )
            inp = _build_input(date(2024, 5, 3), bars)
            params = ClaudeAlphaParams()
            diag1: dict = {}
            diag2: dict = {}
            scores_run1 = _score_universe(["AAPL", "MSFT"], inp, params, date(2024, 5, 3), diagnostics=diag1)
            scores_run2 = _score_universe(["AAPL", "MSFT"], inp, params, date(2024, 5, 3), diagnostics=diag2)
            # First run: deterministic_fallback (cache miss); second: cache_hit
            assert diag1["scoring_path"] == "deterministic_fallback"
            assert diag2["scoring_path"] == "cache_hit"
            # Identical scores
            assert scores_run1 == scores_run2


class TestHoldingExits:
    def test_force_exit_after_max_holding(self):
        params = ClaudeAlphaParams(max_holding_days=21)
        old_entry = (date(2024, 5, 1) - timedelta(days=40)).isoformat()
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 5, 1) - timedelta(days=40),
        )
        signals, state = _build_holding_exits(
            [pos], state={"claude_alpha.entry_dates": {"AAPL": old_entry}},
            asof=date(2024, 5, 1), params=params,
        )
        assert len(signals) == 1
        assert signals[0].order_type == OrderType.MOO
        assert signals[0].target_weight == 0.0
        assert "AAPL" not in state["claude_alpha.entry_dates"]

    def test_no_exit_inside_holding_window(self):
        params = ClaudeAlphaParams(max_holding_days=21)
        recent_entry = (date(2024, 5, 1) - timedelta(days=5)).isoformat()
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal("100"),
            entry_date=date(2024, 5, 1) - timedelta(days=5),
        )
        signals, state = _build_holding_exits(
            [pos], state={"claude_alpha.entry_dates": {"AAPL": recent_entry}},
            asof=date(2024, 5, 1), params=params,
        )
        assert signals == []
        assert "AAPL" in state["claude_alpha.entry_dates"]


class TestStrategyMetaRegistration:
    def test_kind_is_research(self):
        from strategies.registry import load_all, get_meta
        load_all()
        meta = get_meta("claude_alpha")
        assert meta is not None
        assert meta.kind == "research"


class TestRunIntegration:
    def test_run_no_op_when_not_rebalance_day(self, tmp_path):
        with patch("strategies.claude_alpha.strategy._REPLAY_CACHE_DIR", tmp_path):
            asof = date(2024, 5, 1)  # Wed (not Fri)
            bars = _build_panel(end=asof, n_days=300, spec={"AAPL": 100.0})
            strat = ClaudeAlphaStrategy()
            result = strat.run(_build_input(asof, bars), ClaudeAlphaParams())
            assert result.diagnostics["rebalance"] is False
            # No entry signals
            entries = [s for s in result.signals if s.tag and "ca-entry-" in s.tag]
            assert entries == []
