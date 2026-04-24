"""Unit tests for the KAMA Breakout strategy — SOTA shell.

Covers:
- Registration metadata, including paper_only flag.
- Params defaults + validation.
- Entry gate passes on a deterministic uptrend, rejects on chop.
- Chandelier trailing stop fires.
- Efficiency-ratio helper returns expected values.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import Position, StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies.kama_breakout.config import DEFAULT_UNIVERSE, KamaBreakoutParams
from strategies.kama_breakout.strategy import (
    KamaBreakoutStrategy,
    _efficiency_ratio,
)


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
def _build_uptrend_bars(
    symbol: str,
    asof: date,
    n_days: int = 300,
    drift: float = 0.005,
    vol: float = 0.005,
    seed: int = 41,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, vol, n_days)
    closes = 100.0 * np.cumprod(1 + rets)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * 1.002
    lows = np.minimum(opens, closes) * 0.998
    idx = pd.bdate_range(end=pd.Timestamp(asof), periods=n_days)
    return pd.DataFrame({
        "symbol": symbol,
        "date": [d.date() for d in idx],
        "open": opens, "high": highs, "low": lows,
        "close": closes, "volume": 1_000_000.0,
    }).set_index(["date", "symbol"]).sort_index()


def _merge_bars(*frames: pd.DataFrame) -> pd.DataFrame:
    return pd.concat(frames).sort_index()


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    positions: list[Position] | None = None,
    state: dict | None = None,
    equity: Decimal = Decimal("100000"),
    earnings: pd.DataFrame | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars, earnings=earnings,
        cash=equity, equity=equity,
        positions=positions or [], state=state or {},
        seed=0, rng=np.random.default_rng(0),
    )


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_registered(self):
        cls = get_strategy("kama_breakout")
        assert cls is KamaBreakoutStrategy
        meta = get_meta("kama_breakout")
        assert meta.name == "kama_breakout"
        assert meta.category == "equity"
        assert meta.paper_only is True

    def test_params_defaults(self):
        p = KamaBreakoutParams()
        assert p.kama_er_period == 10
        assert p.kama_fast == 2
        assert p.kama_slow == 30
        assert p.donchian_period == 20
        assert p.atr_period == 22

    def test_tune_space_keys(self):
        space = KamaBreakoutParams.tune_space()
        assert "kama_er_period" in space
        assert "er_min_trend" in space
        assert "risk_per_trade" in space


# --------------------------------------------------------------------------- #
# Efficiency ratio                                                            #
# --------------------------------------------------------------------------- #
class TestEfficiencyRatio:
    def test_perfect_trend_gives_one(self):
        prices = pd.Series(np.arange(1, 30, dtype=float))
        er = _efficiency_ratio(prices, period=10)
        assert er == pytest.approx(1.0, abs=1e-9)

    def test_pure_noise_below_one(self):
        rng = np.random.default_rng(11)
        prices = pd.Series(100 + rng.normal(0, 1, 50).cumsum())
        er = _efficiency_ratio(prices, period=10)
        assert 0.0 <= er < 1.0


# --------------------------------------------------------------------------- #
# Entry gate                                                                  #
# --------------------------------------------------------------------------- #
class TestEntryGate:
    def test_entry_fires_on_uptrend(self):
        bars = _merge_bars(
            *(
                _build_uptrend_bars(sym, date(2024, 4, 30), seed=1 + i)
                for i, sym in enumerate(DEFAULT_UNIVERSE)
            )
        )
        strat = KamaBreakoutStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), KamaBreakoutParams())
        entry_sigs = [s for s in result.signals if s.tag.startswith("kama-entry")]
        # At least some symbols should qualify given the uniform uptrend.
        assert len(entry_sigs) > 0

    def test_entry_rejects_downtrend(self):
        # Deliberately falling prices — trend-SMA filter must reject.
        rng = np.random.default_rng(7)
        rets = rng.normal(-0.003, 0.01, 300)
        closes = 100.0 * np.cumprod(1 + rets)
        opens = np.concatenate(([closes[0]], closes[:-1]))
        highs = np.maximum(opens, closes)
        lows = np.minimum(opens, closes)
        idx = pd.bdate_range(end=pd.Timestamp(date(2024, 4, 30)), periods=300)
        bars = pd.DataFrame({
            "symbol": "SPY",
            "date": [d.date() for d in idx],
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": 1_000_000.0,
        }).set_index(["date", "symbol"]).sort_index()
        strat = KamaBreakoutStrategy()
        result = strat.run(_build_input(bars, date(2024, 4, 30)), KamaBreakoutParams())
        assert not any(s.tag.startswith("kama-entry") for s in result.signals)


# --------------------------------------------------------------------------- #
# Exits                                                                       #
# --------------------------------------------------------------------------- #
class TestExits:
    def test_chandelier_stop_fires(self):
        """After a sharp drop, chandelier trailing stop should fire."""
        # Build uptrend, then drop sharply on the last bar.
        rng = np.random.default_rng(31)
        rets = rng.normal(0.005, 0.005, 299)
        closes = 100.0 * np.cumprod(1 + rets)
        # Drop 15% on the last bar.
        closes = np.append(closes, closes[-1] * 0.85)
        opens = np.concatenate(([closes[0]], closes[:-1]))
        highs = np.maximum(opens, closes) * 1.002
        lows = np.minimum(opens, closes) * 0.998
        idx = pd.bdate_range(end=pd.Timestamp(date(2024, 4, 30)), periods=300)
        bars = pd.DataFrame({
            "symbol": "SPY",
            "date": [d.date() for d in idx],
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": 1_000_000.0,
        }).set_index(["date", "symbol"]).sort_index()

        pos = Position(
            symbol="SPY", quantity=100,
            avg_entry_price=Decimal(str(float(closes[-2]))),
            entry_date=date(2024, 4, 1),
        )
        state = {
            "kama_breakout.positions": {
                "SPY": {
                    "entry_date": date(2024, 4, 1),
                    "entry_price": float(closes[-2]),
                    "atr_at_entry": 1.0,
                    "highest_high": float(max(highs[:-1])),
                    "pyramid_count": 0,
                    "shares_initial": 100,
                }
            }
        }
        strat = KamaBreakoutStrategy()
        result = strat.run(
            _build_input(bars, date(2024, 4, 30), positions=[pos], state=state),
            KamaBreakoutParams(),
        )
        exit_sigs = [s for s in result.signals if s.tag.startswith("kama-exit")]
        assert exit_sigs
        assert exit_sigs[0].target_weight == 0.0


# --------------------------------------------------------------------------- #
# Paper-only pipeline gate                                                    #
# --------------------------------------------------------------------------- #
class TestPipelineGate:
    def test_daily_runner_blocks_live_emission(self):
        """DailyPipelineRunner should return empty signals for paper_only strategies."""
        import asyncio

        from strategies._core.runners.pipeline_runner import (
            DailyPipelineRunner,
            StateStore,
        )

        class _NullProviders:
            bars = None
            earnings = None
            fundamentals = None

        strat = KamaBreakoutStrategy()
        runner = DailyPipelineRunner(strat, _NullProviders(), StateStore())

        result = asyncio.run(
            runner.run_today(KamaBreakoutParams(), asof=date(2024, 4, 30))
        )
        assert result.signals == []
        assert result.diagnostics.get("paper_only_blocked") is True
