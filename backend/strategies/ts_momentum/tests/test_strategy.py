"""Unit tests for the TSMOM multi-asset strategy.

Covers the five audit-mandated properties:

1. Sign-of-return correctness — +20% -> long, -20% -> short (if enabled).
2. Inverse-vol weights sum to the gross target when no cap is binding.
3. Monthly trigger — mid-month bars emit no signals.
4. Shorts generate negative target_weight when shorts_enabled=True,
   and zero out the leg when shorts_enabled=False.
5. Drawdown de-lever halves gross notional past the threshold.

Tests drive the strategy's hooks directly with a synthetic scripted bar
provider; no network. Pattern is borrowed from ``dual_momentum/tests``.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from backend.backtest.types import Context, Position
from backend.strategies.ts_momentum.config import (
    DEFAULT_PARAMS,
    TSMomentumConfig,
    build_search_space,
)
from backend.strategies.ts_momentum.strategy import (
    TSMomentumStrategy,
    _is_last_trading_day_of_month,
)


# --------------------------------------------------------------------------- #
# Synthetic bar provider                                                      #
# --------------------------------------------------------------------------- #
class _ScriptedBarProvider:
    """Returns a close-price series with a known 252-day return + vol.

    ``returns`` maps symbol -> (final_return, daily_vol). Prices are
    generated as a geometric Brownian series seeded per-symbol so the
    realized 60-day vol is close to the target.
    """

    def __init__(
        self,
        returns: dict[str, tuple[float, float]],
        n_days: int = 400,
        seed: int = 12345,
    ) -> None:
        self._returns = dict(returns)
        self._n_days = n_days
        self._seed = seed

    def bars(
        self,
        symbols: Iterable[str],
        start,
        end,
        tf: str = "1D",
    ) -> pd.DataFrame:
        start = pd.Timestamp(start).tz_localize(None).normalize()
        end = pd.Timestamp(end).tz_localize(None).normalize()
        idx = pd.bdate_range(start=start, end=end)
        n = len(idx)
        if n == 0:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )

        # Make sure we have enough rows to compute a 252d return back from
        # the rebalance date: if the caller gave a short window, generate
        # ``max(n, 400)`` rows and slice.
        target_n = max(n, 400)
        full_idx = pd.bdate_range(end=end, periods=target_n)

        rows = []
        for sym_i, sym in enumerate(symbols):
            r_final, daily_sigma = self._returns.get(sym, (0.0, 0.01))
            rng = np.random.default_rng(self._seed + sym_i)
            # Generate daily log-returns with the target sigma, add drift
            # so the cumulative return over 252 days is r_final.
            n_full = len(full_idx)
            # Use log-returns with drift such that the return over the
            # last 252 bars is r_final.
            drift_per_day = np.log(1.0 + r_final) / 252.0
            noise = rng.normal(0.0, daily_sigma, size=n_full)
            log_ret = drift_per_day + noise
            # Anchor the last 253 bars: force the cumulative log-return
            # over the last 252 bars to equal log(1+r_final). We do this
            # by subtracting the mean of that window and re-adding the
            # target drift.
            tail = log_ret[-252:]
            adj = (np.log(1.0 + r_final) - tail.sum()) / 252.0
            log_ret[-252:] = tail + adj
            price = 100.0 * np.exp(np.cumsum(log_ret))
            # Clip to the requested window.
            closes = price[-n:]
            opens = np.concatenate(([closes[0]], closes[:-1]))
            highs = np.maximum(opens, closes)
            lows = np.minimum(opens, closes)
            df = pd.DataFrame(
                {
                    "symbol": sym,
                    "ts": pd.to_datetime(idx, utc=True),
                    "open": opens,
                    "high": highs,
                    "low": lows,
                    "close": closes,
                    "volume": 1_000_000,
                }
            )
            rows.append(df)
        if not rows:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(rows, ignore_index=True).sort_values(["symbol", "ts"])


class _FakeCalendar:
    def next_session(self, d):
        t = pd.Timestamp(d) + pd.offsets.BDay(1)
        return t.date()

    def sessions(self, start, end):
        return pd.bdate_range(start=start, end=end)


def _build_ctx(
    provider: _ScriptedBarProvider,
    asof: date,
    positions: list[Position] | None = None,
    cash: Decimal = Decimal("100000"),
    equity: Decimal | None = None,
) -> Context:
    eq = equity if equity is not None else cash
    return Context(
        asof=asof,
        cash=cash,
        equity=eq,
        positions=list(positions or []),
        bar_provider=provider,
        calendar_provider=_FakeCalendar(),
    )


# --------------------------------------------------------------------------- #
# Test 1 — sign of return correctness                                         #
# --------------------------------------------------------------------------- #
class TestSignOfReturn:
    """The core Moskowitz signal: direction == sign of 12m return."""

    @staticmethod
    def _rebalance_day() -> date:
        # Jan 31, 2024 is the last business day of January.
        return date(2024, 1, 31)

    def test_positive_12m_return_emits_positive_weight(self):
        # SPY +20%, all others flat. Expect a positive weight on SPY.
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (0.20, 0.01), "EFA": (0.01, 0.012),
                "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
                "GLD": (0.01, 0.008), "DBC": (0.01, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({**DEFAULT_PARAMS, "shorts_enabled": False})
        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        spy_sigs = [s for s in signals if s.symbol == "SPY"]
        assert spy_sigs, "SPY should be in the output"
        assert spy_sigs[0].target_weight > 0

    def test_negative_12m_return_with_shorts_enabled_emits_negative_weight(self):
        # SPY -20%. With shorts_enabled=True we expect negative weight.
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (-0.20, 0.01), "EFA": (0.01, 0.012),
                "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
                "GLD": (0.01, 0.008), "DBC": (0.01, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({**DEFAULT_PARAMS, "shorts_enabled": True})
        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        spy_sigs = [s for s in signals if s.symbol == "SPY"]
        assert spy_sigs, "SPY should be in the output"
        assert spy_sigs[0].target_weight < 0

    def test_negative_12m_return_with_shorts_disabled_drops_leg(self):
        # SPY -20%. shorts_enabled=False: SPY is dropped entirely.
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (-0.20, 0.01), "EFA": (0.10, 0.012),
                "IEF": (0.01, 0.004), "TLT": (0.01, 0.009),
                "GLD": (0.05, 0.008), "DBC": (0.03, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({**DEFAULT_PARAMS, "shorts_enabled": False})
        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        syms = [s.symbol for s in signals]
        assert "SPY" not in syms


# --------------------------------------------------------------------------- #
# Test 2 — inverse-vol weights sum to gross                                   #
# --------------------------------------------------------------------------- #
class TestInverseVolWeights:
    @staticmethod
    def _rebalance_day() -> date:
        return date(2024, 1, 31)

    def test_weights_sum_to_gross_mul(self):
        # All legs +10% return, all legs different vols.
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (0.10, 0.010),
                "EFA": (0.10, 0.012),
                "IEF": (0.10, 0.004),
                "TLT": (0.10, 0.009),
                "GLD": (0.10, 0.008),
                "DBC": (0.10, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        # Use a per-asset cap high enough to avoid binding (0.30 is
        # greater than 1/6 = 0.167).
        strat.configure({
            **DEFAULT_PARAMS,
            "max_weight_per_asset": 0.30,
            "drawdown_delever_threshold": 5.0,  # effectively disabled
        })
        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        total_gross = sum(abs(s.target_weight) for s in signals)
        # target_vol_gross_mul defaults to 1.0
        assert total_gross == pytest.approx(1.0, abs=1e-6)

    def test_low_vol_leg_gets_higher_weight(self):
        # IEF (very low vol) and SPY (higher vol), same +10% return.
        # After inverse-vol, IEF should get a higher weight than SPY,
        # subject to the cap.
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (0.10, 0.010),
                "EFA": (0.10, 0.010),
                "IEF": (0.10, 0.002),   # ultra low vol
                "TLT": (0.10, 0.010),
                "GLD": (0.10, 0.010),
                "DBC": (0.10, 0.010),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({
            **DEFAULT_PARAMS,
            "max_weight_per_asset": 0.50,
            "drawdown_delever_threshold": 5.0,
            "vol_floor": 0.01,  # allow IEF's very low vol to shine
        })
        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        w = {s.symbol: abs(s.target_weight) for s in signals}
        assert w.get("IEF", 0) > w.get("SPY", 0)


# --------------------------------------------------------------------------- #
# Test 3 — monthly trigger                                                    #
# --------------------------------------------------------------------------- #
class TestMonthlyTrigger:
    def test_rebalance_day_fires(self):
        cal = _FakeCalendar()
        ctx = Context(asof=date(2024, 1, 31), cash=Decimal("0"), equity=Decimal("0"))
        ctx.calendar_provider = cal
        assert _is_last_trading_day_of_month(date(2024, 1, 31), ctx) is True

    def test_mid_month_does_not_fire(self):
        cal = _FakeCalendar()
        ctx = Context(asof=date(2024, 1, 15), cash=Decimal("0"), equity=Decimal("0"))
        ctx.calendar_provider = cal
        assert _is_last_trading_day_of_month(date(2024, 1, 15), ctx) is False

    def test_mid_month_hooks_are_noop(self):
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (0.20, 0.01), "EFA": (0.10, 0.01),
                "IEF": (0.04, 0.004), "TLT": (0.08, 0.009),
                "GLD": (0.12, 0.008), "DBC": (0.05, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)
        mid = date(2024, 1, 15)
        ctx = _build_ctx(provider, mid)
        assert list(strat.manage(mid, ctx)) == []
        assert list(strat.generate_signals(mid, ctx)) == []


# --------------------------------------------------------------------------- #
# Test 4 — shorts generate negative target_weight                             #
# --------------------------------------------------------------------------- #
class TestShorts:
    def test_multiple_negative_legs_produce_negative_weights(self):
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (-0.15, 0.010),
                "EFA": (-0.12, 0.012),
                "IEF": (0.04, 0.004),
                "TLT": (0.08, 0.009),
                "GLD": (0.10, 0.008),
                "DBC": (-0.05, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({
            **DEFAULT_PARAMS,
            "shorts_enabled": True,
            "drawdown_delever_threshold": 5.0,
        })
        ctx = _build_ctx(provider, date(2024, 1, 31))
        list(strat.manage(ctx.asof, ctx))
        signals = list(strat.generate_signals(ctx.asof, ctx))
        neg_syms = {s.symbol for s in signals if s.target_weight < 0}
        pos_syms = {s.symbol for s in signals if s.target_weight > 0}
        assert "SPY" in neg_syms
        assert "EFA" in neg_syms
        assert "DBC" in neg_syms
        assert "IEF" in pos_syms
        assert "TLT" in pos_syms


# --------------------------------------------------------------------------- #
# Test 5 — drawdown de-lever                                                  #
# --------------------------------------------------------------------------- #
class TestDrawdownDelever:
    def test_delever_halves_gross_when_drawdown_exceeds_threshold(self):
        provider = _ScriptedBarProvider(
            returns={
                "SPY": (0.10, 0.010),
                "EFA": (0.10, 0.012),
                "IEF": (0.10, 0.004),
                "TLT": (0.10, 0.009),
                "GLD": (0.10, 0.008),
                "DBC": (0.10, 0.013),
            }
        )
        strat = TSMomentumStrategy()
        strat.configure({
            **DEFAULT_PARAMS,
            "max_weight_per_asset": 0.30,
            "drawdown_delever_threshold": 0.10,
        })

        # First rebalance: equity at 100k, peak stored.
        ctx1 = _build_ctx(
            provider, date(2023, 11, 30),
            cash=Decimal("100000"), equity=Decimal("100000"),
        )
        list(strat.manage(ctx1.asof, ctx1))
        base_signals = list(strat.generate_signals(ctx1.asof, ctx1))
        base_gross = sum(abs(s.target_weight) for s in base_signals)
        assert base_gross == pytest.approx(1.0, abs=1e-6)

        # Second rebalance: equity drops 12% from peak -> trigger de-lever.
        # Use the SAME ctx.state (same cache) so peak carries over.
        ctx2 = Context(
            asof=date(2023, 12, 29),
            cash=Decimal("88000"),
            equity=Decimal("88000"),
            positions=[],
            bar_provider=provider,
            calendar_provider=_FakeCalendar(),
            state=ctx1.state,  # preserve peak
        )
        list(strat.manage(ctx2.asof, ctx2))
        delev_signals = list(strat.generate_signals(ctx2.asof, ctx2))
        delev_gross = sum(abs(s.target_weight) for s in delev_signals)
        # Should be halved (0.5 +/- small slippage from cap renormalization).
        assert delev_gross == pytest.approx(0.5, abs=1e-6)


# --------------------------------------------------------------------------- #
# Config and registration                                                     #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_search_space_has_expected_knobs(self):
        space = build_search_space()
        assert set(space.keys()) == {
            "lookback_months",
            "signal_ensemble",
            "target_vol",
            "rebalance_freq",
            "realized_vol_window",
            "max_weight_per_asset",
            "drawdown_delever_threshold",
            "shorts_enabled",
            "universe_size",
        }

    def test_from_params_rejects_unknown_key(self):
        with pytest.raises(ValueError, match="unknown parameter"):
            TSMomentumConfig.from_params({"bogus": 1})

    def test_universe_size_minimal_6(self):
        cfg = TSMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "universe_size": "minimal_6"}
        )
        assert len(cfg.universe_tickers()) == 6
        assert "SPY" in cfg.universe_tickers()

    def test_universe_size_full_11(self):
        cfg = TSMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "universe_size": "full_11"}
        )
        assert len(cfg.universe_tickers()) == 11
        assert "VNQ" in cfg.universe_tickers()
        assert "EEM" in cfg.universe_tickers()

    def test_ensemble_lookbacks(self):
        cfg = TSMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "signal_ensemble": "ensemble_1_3_6_12"}
        )
        assert cfg.signal_lookback_days() == (21, 63, 126, 252)
        assert cfg.max_lookback_days() == 252

    def test_single_12m_respects_lookback_months(self):
        cfg = TSMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "signal_ensemble": "single_12m",
             "lookback_months": 9}
        )
        assert cfg.signal_lookback_days() == (189,)


class TestRegistration:
    def test_strategy_is_registered(self):
        from backend.strategies.registry import get_meta, get_strategy

        cls = get_strategy("ts_momentum")
        assert cls is TSMomentumStrategy or cls.__name__ == "TSMomentumStrategy"
        meta = get_meta("ts_momentum")
        assert meta.name == "ts_momentum"
        assert meta.category == "macro"
        assert meta.supports_shorts is True
        assert meta.min_universe_size >= 3

    def test_search_space_callable_from_class(self):
        assert callable(TSMomentumStrategy.search_space)
        space = TSMomentumStrategy.search_space()
        assert len(space) == 9
