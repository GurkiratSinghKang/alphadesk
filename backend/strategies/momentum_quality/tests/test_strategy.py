"""Unit tests for the Momentum + Quality strategy — SOTA shell.

Covers the audit's four correctness gates plus registration bookkeeping:

1. Ranking correctness — top-N is picked by momentum + F-score composite.
2. Exclusion of Financials / Utilities — ``eligible_universe()`` omits them.
3. Missing F-score handled — symbols without an F-score are excluded.
4. Monthly trigger only — non-rebalance bars emit no orders.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

import numpy as np
import orjson
import pandas as pd
import pytest

from strategies._core.contracts import Fill, Position, StrategyInput
from strategies.momentum_quality.config import (
    MomentumQualityParams,
    EXCLUDED_SECTORS,
    SECTOR_MAP,
    eligible_universe,
)
from strategies.momentum_quality.helpers import (
    is_last_trading_day_of_month,
    is_rebalance_day,
    rank_01,
)
from strategies.momentum_quality.strategy import (
    MomentumQualityStrategy,
    _compute_target,
    _compute_target_with_diagnostics,
)


# --------------------------------------------------------------------------- #
# Synthetic data builders                                                     #
# --------------------------------------------------------------------------- #
def _build_bars(
    returns: dict[str, float],
    asof: date,
    n_days: int = 450,
) -> pd.DataFrame:
    end = pd.Timestamp(asof).tz_localize(None).normalize()
    idx = pd.bdate_range(end=end, periods=n_days)
    rows: list[pd.DataFrame] = []
    for sym, r in returns.items():
        closes = np.linspace(1.0, 1.0 + r, num=max(n_days, 360))[-n_days:] * 100.0
        opens = np.concatenate(([closes[0]], closes[:-1]))
        rows.append(pd.DataFrame({
            "symbol": sym,
            "date": [d.date() for d in idx],
            "open": opens,
            "high": np.maximum(opens, closes),
            "low": np.minimum(opens, closes),
            "close": closes,
            "volume": 1_000_000,
        }))
    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True).set_index(["date", "symbol"]).sort_index()


def _build_fundamentals(
    fscores: dict[str, Optional[int]],
    asof: date,
) -> pd.DataFrame:
    rows = []
    for sym, score in fscores.items():
        rows.append({"symbol": sym, "date": asof, "f_score": score})
    return pd.DataFrame(rows)


def _build_earnings(events: dict[str, list[date]]) -> pd.DataFrame:
    rows = []
    for sym, dates in events.items():
        for d in dates:
            rows.append({"symbol": sym, "date": d})
    return pd.DataFrame(rows)


def _build_input(
    asof: date,
    bars: pd.DataFrame,
    fundamentals: Optional[pd.DataFrame] = None,
    earnings: Optional[pd.DataFrame] = None,
    positions: Optional[list[Position]] = None,
    cash: Decimal = Decimal("100000"),
    state: Optional[dict] = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        fundamentals=fundamentals, earnings=earnings,
        cash=cash, equity=cash, positions=positions or [],
        state=state or {}, seed=0, rng=np.random.default_rng(0),
    )


REBAL_DAY = date(2024, 1, 31)
NON_REBAL_DAY = date(2024, 1, 15)


# --------------------------------------------------------------------------- #
# Registration / config                                                       #
# --------------------------------------------------------------------------- #
class TestRegistrationAndConfig:
    def test_strategy_registered(self):
        from strategies._core.protocol import get_strategy

        cls = get_strategy("momentum_quality")
        assert cls is MomentumQualityStrategy

    def test_defaults(self):
        p = MomentumQualityParams()
        assert p.momentum_lookback_m == 12
        assert p.momentum_skip_m == 1
        assert p.top_n == 15
        assert p.rebalance_freq == "monthly"
        assert p.min_f_score == 5

    def test_overrides(self):
        p = MomentumQualityParams(
            momentum_lookback_m=6,
            top_n=10,
            rebalance_freq="quarterly",
            quality_weight=0.5,
            min_f_score=7,
        )
        assert p.momentum_lookback_m == 6
        assert p.top_n == 10
        assert p.rebalance_freq == "quarterly"
        assert p.quality_weight == 0.5
        assert p.min_f_score == 7

    def test_bad_freq_rejected(self):
        with pytest.raises(Exception):
            MomentumQualityParams(rebalance_freq="weekly")

    def test_tune_space_knobs(self):
        space = MomentumQualityParams.tune_space()
        assert set(space) == {
            "momentum_lookback_m", "momentum_skip_m", "quality_weight",
            "top_n", "rebalance_freq", "min_f_score", "momentum_filter_min",
        }


# --------------------------------------------------------------------------- #
# Universe / exclusions                                                       #
# --------------------------------------------------------------------------- #
class TestUniverseFilters:
    def test_financials_excluded(self):
        syms = eligible_universe()
        for sym in syms:
            sector = SECTOR_MAP[sym]
            assert sector not in EXCLUDED_SECTORS
        for fin in ("V", "MA", "JPM", "BAC"):
            assert fin not in syms

    def test_universe_hook_returns_eligible_syms_plus_positions(self):
        s = MomentumQualityStrategy()
        state = {f"momentum_quality.held_symbols": ["FOO"]}
        u = s.universe(REBAL_DAY, state)
        assert "FOO" in u
        for f in ("JPM", "V", "MA", "BAC"):
            assert f not in u


# --------------------------------------------------------------------------- #
# Rebalance trigger                                                           #
# --------------------------------------------------------------------------- #
class TestRebalanceTrigger:
    def test_last_day_of_january_is_rebalance(self):
        assert is_last_trading_day_of_month(REBAL_DAY) is True

    def test_mid_month_is_not_rebalance(self):
        assert is_last_trading_day_of_month(NON_REBAL_DAY) is False

    def test_non_rebalance_day_emits_nothing(self):
        s = MomentumQualityStrategy()
        bars = _build_bars({u: 0.2 for u in eligible_universe()}, NON_REBAL_DAY)
        result = s.run(_build_input(NON_REBAL_DAY, bars), MomentumQualityParams())
        assert result.signals == []

    def test_quarterly_only_in_march_june_sep_dec(self):
        # Last business day of Jan 2024 — should not rebalance under quarterly
        assert is_rebalance_day(REBAL_DAY, "quarterly") is False
        # Round-21 / persona-C: switched from Mar 29 → Mar 28, 2024.
        # Good Friday 2024 fell on Mar 29, so the actual last TRADING
        # day of March was Mar 28 (Thursday). The previous Mon-Fri-only
        # heuristic incorrectly accepted Mar 29; the calendar-aware
        # implementation correctly rejects it.
        march_end = date(2024, 3, 28)
        assert is_last_trading_day_of_month(march_end) is True
        assert is_rebalance_day(march_end, "quarterly") is True


# --------------------------------------------------------------------------- #
# Ranking correctness                                                         #
# --------------------------------------------------------------------------- #
class TestRanking:
    def test_rank_01_monotonic(self):
        out = rank_01(np.array([1.0, 2.0, 3.0, 4.0, 5.0], dtype=float))
        assert out[0] == pytest.approx(0.0)
        assert out[-1] == pytest.approx(1.0)

    def test_rank_01_handles_ties(self):
        out = rank_01(np.array([1.0, 2.0, 2.0, 3.0], dtype=float))
        assert out[1] == out[2]

    def test_top_n_picks_highest_composite(self):
        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.40
        returns["MSFT"] = 0.35
        returns["NVDA"] = 0.30

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals({sym: 9 for sym in syms}, REBAL_DAY)
        params = MomentumQualityParams(top_n=3, min_f_score=1)
        target = _compute_target(params, bars, fund, None, syms, REBAL_DAY)
        assert sorted(target) == sorted(["AAPL", "MSFT", "NVDA"])

    def test_quality_weight_dominates_when_extreme(self):
        syms = eligible_universe()
        returns = {sym: 0.30 for sym in syms}
        returns["AAPL"] = 0.05
        fscores: dict[str, Optional[int]] = {sym: 1 for sym in syms}
        fscores["AAPL"] = 9

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals(fscores, REBAL_DAY)
        params = MomentumQualityParams(top_n=1, min_f_score=1, quality_weight=1.0)
        target = _compute_target(params, bars, fund, None, syms, REBAL_DAY)
        assert target == ["AAPL"]


# --------------------------------------------------------------------------- #
# F-score handling                                                            #
# --------------------------------------------------------------------------- #
class TestFScoreHandling:
    def test_missing_fscore_silently_excluded(self):
        syms = eligible_universe()
        returns = {sym: 0.10 for sym in syms}
        returns["AAPL"] = 0.50
        returns["MSFT"] = 0.40
        returns["NVDA"] = 0.35

        fscores: dict[str, Optional[int]] = {sym: 9 for sym in syms}
        fscores["AAPL"] = None

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals(fscores, REBAL_DAY)
        params = MomentumQualityParams(top_n=3, min_f_score=1)
        target = _compute_target(params, bars, fund, None, syms, REBAL_DAY)
        assert "AAPL" not in target
        assert len(target) == 3

    def test_hard_gate_excludes_low_fscore(self):
        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.60
        returns["MSFT"] = 0.50

        fscores: dict[str, Optional[int]] = {sym: 9 for sym in syms}
        fscores["AAPL"] = 2

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals(fscores, REBAL_DAY)
        params = MomentumQualityParams(top_n=3, min_f_score=5)
        target = _compute_target(params, bars, fund, None, syms, REBAL_DAY)
        assert "AAPL" not in target
        assert "MSFT" in target

    def test_candidate_funnel_counts_filter_reasons(self):
        syms = ["AAPL", "MSFT", "NVDA", "META"]
        returns = {"AAPL": 0.60, "MSFT": 0.50, "NVDA": -0.20}
        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals(
            {"AAPL": 9, "MSFT": None, "NVDA": 9},
            REBAL_DAY,
        )
        params = MomentumQualityParams(
            top_n=2,
            min_f_score=5,
            momentum_filter_min=0.0,
            earnings_skip_days=0,
        )

        target, diagnostics = _compute_target_with_diagnostics(
            params, bars, fund, None, syms, REBAL_DAY
        )

        assert target == ["AAPL"]
        assert diagnostics["universe_size"] == 4
        assert diagnostics["momentum_available"] == 3
        assert diagnostics["filtered_below_momentum_floor"] == 1
        assert diagnostics["filtered_missing_fscore"] == 1
        assert diagnostics["ranked_candidates"] == 1
        assert diagnostics["selected"][0]["symbol"] == "AAPL"
        assert diagnostics["drop_reasons"] == {
            "missing_momentum": 1,
            "below_momentum_floor": 1,
            "missing_fscore": 1,
        }


# --------------------------------------------------------------------------- #
# End-to-end signal emission                                                  #
# --------------------------------------------------------------------------- #
class TestSignalEmission:
    def test_rebalance_emits_entries_and_exits(self):
        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.40
        returns["MSFT"] = 0.35
        returns["NVDA"] = 0.30

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals({sym: 8 for sym in syms}, REBAL_DAY)
        stale_pos = Position(
            symbol="ORCL", quantity=10,
            avg_entry_price=Decimal("100"), entry_date=date(2023, 12, 29),
        )

        s = MomentumQualityStrategy()
        result = s.run(
            _build_input(REBAL_DAY, bars, fundamentals=fund, positions=[stale_pos]),
            MomentumQualityParams(top_n=3, min_f_score=1),
        )
        exits = [sig for sig in result.signals if sig.tag == "mq-exit"]
        entries = [sig for sig in result.signals if sig.tag == "mq-entry"]

        exit_syms = {sig.symbol for sig in exits}
        assert "ORCL" in exit_syms
        for sig in exits:
            assert sig.target_weight == 0.0
            assert sig.order_type.value == "MOO"

        entry_syms = {sig.symbol for sig in entries}
        assert entry_syms == {"AAPL", "MSFT", "NVDA"}
        total_w = sum(float(sig.target_weight) for sig in entries)
        assert total_w == pytest.approx(1.0, abs=1e-9)
        for sig in entries:
            assert sig.target_weight == pytest.approx(1 / 3, abs=1e-9)

        held = result.state_update["momentum_quality.held_symbols"]
        assert isinstance(held, list)
        assert {"AAPL", "MSFT", "NVDA"}.issubset(set(held))
        assert "ORCL" in held
        orjson.dumps(result.state_update)

    def test_on_fill_removes_exited_symbols_from_universe_state(self):
        s = MomentumQualityStrategy()
        state = {"momentum_quality.held_symbols": ["AAPL", "ORCL"]}

        update = s.on_fill(
            Fill(
                symbol="ORCL",
                asof=REBAL_DAY,
                quantity=-10,
                price=Decimal("100"),
                signal_tag="mq-exit",
            ),
            state,
        )

        assert update["momentum_quality.held_symbols"] == ["AAPL"]

    def test_on_fill_keeps_trimmed_target_symbols(self):
        s = MomentumQualityStrategy()
        state = {"momentum_quality.held_symbols": ["AAPL", "MSFT"]}

        update = s.on_fill(
            Fill(
                symbol="MSFT",
                asof=REBAL_DAY,
                quantity=-2,
                price=Decimal("400"),
                signal_tag="mq-entry",
            ),
            state,
        )

        assert update["momentum_quality.held_symbols"] == ["AAPL", "MSFT"]

    def test_earnings_skip_blocks_name(self):
        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.50
        returns["MSFT"] = 0.40
        returns["NVDA"] = 0.35

        bars = _build_bars(returns, REBAL_DAY)
        fund = _build_fundamentals({sym: 8 for sym in syms}, REBAL_DAY)
        earnings = _build_earnings({"AAPL": [REBAL_DAY + timedelta(days=2)]})
        params = MomentumQualityParams(
            top_n=3, min_f_score=1, earnings_skip_days=3,
        )
        target = _compute_target(params, bars, fund, earnings, syms, REBAL_DAY)
        assert "AAPL" not in target
        assert len(target) == 3
