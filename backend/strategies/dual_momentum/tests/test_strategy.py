"""Unit tests for the Dual Momentum (GEM) strategy.

Covers the audit's four non-negotiables plus book-keeping:

1. **Absolute momentum ON + US > ex-US → VOO.**  (canonical)
2. **Absolute momentum ON + ex-US > US → VEU.**  (relative flip)
3. **Absolute momentum OFF → AGG bond fallback.**  (the audit's core fix)
4. **Monthly rebalance trigger.**  (last-of-month only; no intra-month action)

The tests drive the strategy's hooks directly with a hand-built
``Context`` and a synthetic in-memory bar provider so we don't depend on
the backtest engine's full event loop. That keeps the tests fast and
deterministic.

Additional coverage:

- ``search_space()`` exposes the 6 tunable knobs.
- ``DualMomentumConfig.from_params`` rejects unknown keys.
- The stateless ``_composite_return`` helper respects the blend weights.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from backend.backtest.types import Context, Position
from backend.strategies.dual_momentum.config import (
    DEFAULT_PARAMS,
    DualMomentumConfig,
    build_search_space,
)
from backend.strategies.dual_momentum.strategy import (
    DualMomentumStrategy,
    _composite_return,
    _is_last_trading_day_of_month,
)


# --------------------------------------------------------------------------- #
# Synthetic bar provider: lets us script exact 12-month returns                #
# --------------------------------------------------------------------------- #
class _ScriptedBarProvider:
    """Returns a close-price series such that the 252-day return equals ``r``.

    Prices grow linearly from ``start_price`` on day 0 to ``start_price *
    (1 + r)`` on day ``252``. Any additional rows beyond day 252 continue
    the linear extrapolation (this keeps any downstream composite lookback
    well-defined).

    Enough OHLCV columns are populated to pass the strategy's _fetch helper.
    """

    def __init__(self, returns: dict[str, float], n_days: int = 400) -> None:
        self._returns = dict(returns)
        self._n_days = n_days

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
        rows = []
        for sym in symbols:
            r = self._returns.get(sym, 0.0)
            # Linear growth over 252 bdays so day-252 return matches.
            # We anchor the growth to the LAST bar so the 252-day return
            # looking back from `end` is exactly r (if we have 253+ rows).
            if n == 0:
                continue
            closes = np.linspace(1.0, 1.0 + r, num=max(n, 253))[-n:]
            # Scale up to nominal prices so Decimal doesn't complain.
            closes = 100.0 * closes
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
    """Business-day calendar (no holidays). Enough for month-end tests."""

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
) -> Context:
    return Context(
        asof=asof,
        cash=cash,
        equity=cash + sum((p.avg_price * p.quantity for p in (positions or [])), Decimal("0")),
        positions=list(positions or []),
        bar_provider=provider,
        calendar_provider=_FakeCalendar(),
    )


# --------------------------------------------------------------------------- #
# The three canonical GEM scenarios                                            #
# --------------------------------------------------------------------------- #
class TestGEMDecision:
    """Scenarios A, B, C from the design brief."""

    @staticmethod
    def _rebalance_day() -> date:
        # Last business day of January 2024 = Jan 31 (Wednesday).
        return date(2024, 1, 31)

    def test_A_equity_on_and_us_beats_exus_selects_voo(self):
        """Absolute mom gate passes AND r_VOO > r_VEU → hold VOO."""
        provider = _ScriptedBarProvider(
            returns={
                "VOO": 0.20,   # +20% over 252d (strong equity)
                "VEU": 0.10,   # +10% (weaker)
                "AGG": 0.02,   # small positive
                "BIL": 0.05,   # 5% risk-free
            }
        )
        strat = DualMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)

        ctx = _build_ctx(provider, self._rebalance_day())
        exits = list(strat.manage(ctx.asof, ctx))
        # Nothing to close (no positions).
        assert exits == []
        entries = list(strat.generate_signals(ctx.asof, ctx))
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"
        assert entries[0].target_weight == 1.0

    def test_B_equity_on_and_exus_beats_us_selects_veu(self):
        """Absolute mom gate passes AND r_VEU > r_VOO → hold VEU."""
        provider = _ScriptedBarProvider(
            returns={
                "VOO": 0.08,   # +8%, excess of 3% vs BIL (passes gate)
                "VEU": 0.20,   # +20% (wins relative)
                "AGG": 0.01,
                "BIL": 0.05,
            }
        )
        strat = DualMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)

        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        entries = list(strat.generate_signals(ctx.asof, ctx))
        assert len(entries) == 1
        assert entries[0].symbol == "VEU"
        assert entries[0].target_weight == 1.0

    def test_C_equity_off_selects_bond_fallback(self):
        """Absolute mom gate fails → hold AGG (bond fallback), NOT cash."""
        provider = _ScriptedBarProvider(
            returns={
                "VOO": 0.02,   # +2% nominal
                "VEU": 0.04,
                "AGG": 0.03,
                "BIL": 0.05,   # r_rf dominates → r_VOO - r_BIL = -3% < 0
            }
        )
        strat = DualMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)

        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        entries = list(strat.generate_signals(ctx.asof, ctx))
        assert len(entries) == 1
        assert entries[0].symbol == "AGG"
        assert entries[0].target_weight == 1.0

    def test_C_bond_fallback_honours_config_override(self):
        """``bond_fallback=IEF`` should rotate to IEF, not AGG."""
        provider = _ScriptedBarProvider(
            returns={
                "VOO": 0.02, "VEU": 0.04, "AGG": 0.01, "IEF": 0.01, "BIL": 0.05,
            }
        )
        strat = DualMomentumStrategy()
        strat.configure({**DEFAULT_PARAMS, "bond_fallback": "IEF"})

        ctx = _build_ctx(provider, self._rebalance_day())
        list(strat.manage(ctx.asof, ctx))
        entries = list(strat.generate_signals(ctx.asof, ctx))
        assert entries[0].symbol == "IEF"


# --------------------------------------------------------------------------- #
# Rebalance-day trigger                                                        #
# --------------------------------------------------------------------------- #
class TestRebalanceTrigger:
    def test_month_end_fires(self):
        """Jan 31 2024 is the last trading day of the month."""
        cal = _FakeCalendar()
        ctx = Context(asof=date(2024, 1, 31), cash=Decimal("0"), equity=Decimal("0"))
        ctx.calendar_provider = cal
        assert _is_last_trading_day_of_month(date(2024, 1, 31), ctx) is True

    def test_mid_month_does_not_fire(self):
        cal = _FakeCalendar()
        ctx = Context(asof=date(2024, 1, 15), cash=Decimal("0"), equity=Decimal("0"))
        ctx.calendar_provider = cal
        assert _is_last_trading_day_of_month(date(2024, 1, 15), ctx) is False

    def test_mid_month_manage_is_noop(self):
        """On non-rebalance days manage()/generate_signals() must emit nothing."""
        provider = _ScriptedBarProvider(
            returns={"VOO": 0.2, "VEU": 0.1, "AGG": 0.02, "BIL": 0.05}
        )
        strat = DualMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)

        mid_month = date(2024, 1, 15)
        ctx = _build_ctx(provider, mid_month)
        assert list(strat.manage(mid_month, ctx)) == []
        assert list(strat.generate_signals(mid_month, ctx)) == []

    def test_manage_closes_stale_position_on_rebalance_day(self):
        """Rebalance should emit an exit for a held non-target ticker."""
        provider = _ScriptedBarProvider(
            returns={"VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05}
        )
        strat = DualMomentumStrategy()
        strat.configure(DEFAULT_PARAMS)

        rebal = date(2024, 1, 31)
        # Portfolio holds AGG from the prior month (risk-off regime ended).
        pos = Position(symbol="AGG", quantity=1000, avg_price=Decimal("100"))
        ctx = _build_ctx(provider, rebal, positions=[pos])
        exits = list(strat.manage(rebal, ctx))
        assert len(exits) == 1
        assert exits[0].symbol == "AGG"
        assert exits[0].target_weight == 0.0
        # And we enter VOO on the same bar (MOO)
        entries = list(strat.generate_signals(rebal, ctx))
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"

    def test_bimonthly_skips_even_months(self):
        """``rebalance_freq='bimonthly'`` should only fire on odd months."""
        provider = _ScriptedBarProvider(
            returns={"VOO": 0.20, "VEU": 0.10, "AGG": 0.02, "BIL": 0.05}
        )
        feb_end = date(2024, 2, 29)   # last biz day of Feb (even month → skip)
        jan_end = date(2024, 1, 31)   # last biz day of Jan (odd → rebalance)

        # February (even) — expect no-op on both hooks.
        strat_feb = DualMomentumStrategy()
        strat_feb.configure({**DEFAULT_PARAMS, "rebalance_freq": "bimonthly"})
        ctx_feb = _build_ctx(provider, feb_end)
        assert list(strat_feb.manage(feb_end, ctx_feb)) == []
        assert list(strat_feb.generate_signals(feb_end, ctx_feb)) == []

        # January (odd) — manage() first (sets target), then generate_signals.
        strat_jan = DualMomentumStrategy()
        strat_jan.configure({**DEFAULT_PARAMS, "rebalance_freq": "bimonthly"})
        ctx_jan = _build_ctx(provider, jan_end)
        list(strat_jan.manage(jan_end, ctx_jan))
        entries = list(strat_jan.generate_signals(jan_end, ctx_jan))
        assert len(entries) == 1
        assert entries[0].symbol == "VOO"


# --------------------------------------------------------------------------- #
# Config + search space                                                        #
# --------------------------------------------------------------------------- #
class TestConfig:
    def test_search_space_has_expected_knobs(self):
        space = build_search_space()
        assert set(space.keys()) == {
            "lookback_days",
            "bond_fallback",
            "excess_return_floor",
            "rebalance_freq",
            "composite_lookback",
            "relative_universe",
        }

    def test_from_params_rejects_unknown_key(self):
        with pytest.raises(ValueError, match="unknown parameter"):
            DualMomentumConfig.from_params({"bogus": 1})

    def test_from_params_coerces_list_universe_to_tuple(self):
        cfg = DualMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "relative_universe": ["SPY", "EFA", "EEM"]}
        )
        assert cfg.relative_universe == ("SPY", "EFA", "EEM")

    def test_composite_lookback_components(self):
        cfg = DualMomentumConfig.from_params(
            {**DEFAULT_PARAMS, "composite_lookback": "blend_126_252"}
        )
        comps = cfg.lookback_components()
        assert comps == ((126, 0.5), (252, 0.5))
        assert cfg.max_lookback() == 252


# --------------------------------------------------------------------------- #
# Pure helpers                                                                 #
# --------------------------------------------------------------------------- #
class TestHelpers:
    def test_composite_return_single_lookback(self):
        idx = pd.bdate_range("2019-01-01", periods=300)
        prices = pd.Series(np.linspace(100.0, 120.0, num=300), index=idx)
        closes = pd.DataFrame({"VOO": prices})
        # closes at idx[-1] = 120, closes at idx[-253] is 100 + 19.8*...
        r = _composite_return(closes, "VOO", ((252, 1.0),))
        expected = prices.iloc[-1] / prices.iloc[-253] - 1.0
        assert r is not None
        assert r == pytest.approx(float(expected), abs=1e-9)

    def test_composite_return_blend(self):
        idx = pd.bdate_range("2019-01-01", periods=300)
        prices = pd.Series(np.linspace(100.0, 130.0, num=300), index=idx)
        closes = pd.DataFrame({"VOO": prices})
        blend = _composite_return(closes, "VOO", ((126, 0.5), (252, 0.5)))
        r126 = prices.iloc[-1] / prices.iloc[-127] - 1.0
        r252 = prices.iloc[-1] / prices.iloc[-253] - 1.0
        assert blend == pytest.approx(0.5 * r126 + 0.5 * r252, abs=1e-9)

    def test_composite_return_insufficient_history(self):
        idx = pd.bdate_range("2024-01-01", periods=50)
        closes = pd.DataFrame({"VOO": np.arange(50) + 100.0}, index=idx)
        assert _composite_return(closes, "VOO", ((252, 1.0),)) is None

    def test_composite_return_missing_symbol(self):
        closes = pd.DataFrame({"VOO": [1, 2, 3]})
        assert _composite_return(closes, "NOPE", ((126, 1.0),)) is None


# --------------------------------------------------------------------------- #
# Registration smoke                                                           #
# --------------------------------------------------------------------------- #
class TestRegistration:
    def test_strategy_is_registered(self):
        from backend.strategies.registry import get_meta, get_strategy

        cls = get_strategy("dual_momentum")
        assert cls is DualMomentumStrategy or cls.__name__ == "DualMomentumStrategy"
        meta = get_meta("dual_momentum")
        assert meta.name == "dual_momentum"
        assert meta.category == "macro"
        assert "daily" in meta.required_bars
        assert meta.required_lookback_days >= 365  # ~12 months calendar

    def test_search_space_callable_from_class(self):
        assert callable(DualMomentumStrategy.search_space)
        space = DualMomentumStrategy.search_space()
        assert len(space) == 6
