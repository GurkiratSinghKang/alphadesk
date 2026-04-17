"""Unit tests for the Momentum + Quality strategy.

Covers the audit's four correctness gates plus registration bookkeeping:

1. **Ranking correctness** — top-N is chosen by the composite of 12-1
   momentum rank and Piotroski F-score rank. High-momentum high-quality
   names win.
2. **Exclusion of Financials / Utilities** — ``eligible_universe()`` omits
   names whose sector is in ``EXCLUDED_SECTORS``.
3. **Missing F-score handled** — when the provider returns ``None`` (or
   raises), the name is silently excluded from ranking; the strategy does
   not crash.
4. **Monthly trigger only** — ``manage`` / ``generate_signals`` emit no
   orders on non-rebalance days.

Tests drive the strategy's hooks directly with a hand-built ``Context``
and an in-memory bar / fundamentals / earnings provider, so they run
fast (<1s) and do not depend on the backtest engine's full event loop
or any network.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Iterable, Optional

import numpy as np
import pandas as pd
import pytest

from backend.backtest.types import Context, Position
from backend.strategies.momentum_quality.config import (
    DEFAULTS,
    EXCLUDED_SECTORS,
    SECTOR_MAP,
    eligible_universe,
    search_space,
)
from backend.strategies.momentum_quality.strategy import (
    MomentumQualityStrategy,
    _is_last_trading_day_of_month,
    _rank_01,
)


# --------------------------------------------------------------------------- #
# Synthetic providers                                                          #
# --------------------------------------------------------------------------- #
class _ScriptedBarProvider:
    """Return close-price panels with per-symbol 12-month total returns.

    Prices grow linearly from 100.0 on day 0 to 100 * (1 + r) on day
    ``n_days``. Any additional rows beyond day 252 continue the linear
    extrapolation so the last-252-to-last-21 return is also approximately
    ``r``.
    """

    def __init__(
        self,
        returns: dict[str, float],
        n_days: int = 450,
    ) -> None:
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
        if n == 0:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        rows = []
        for sym in symbols:
            r = self._returns.get(sym, 0.0)
            closes = np.linspace(1.0, 1.0 + r, num=max(n, 360))[-n:]
            closes = 100.0 * closes
            opens = np.concatenate(([closes[0]], closes[:-1]))
            df = pd.DataFrame(
                {
                    "symbol": sym,
                    "ts": pd.to_datetime(idx, utc=True),
                    "open": opens,
                    "high": np.maximum(opens, closes),
                    "low": np.minimum(opens, closes),
                    "close": closes,
                    "volume": 1_000_000,
                }
            )
            rows.append(df)
        return pd.concat(rows, ignore_index=True).sort_values(["symbol", "ts"])


class _ScriptedFundamentals:
    """Return F-scores from a static dict; raises on missing unless `strict=False`."""

    def __init__(self, scores: dict[str, Optional[int]], strict: bool = False) -> None:
        self._scores = dict(scores)
        self._strict = strict
        self.calls = 0

    def piotroski_f(self, symbol: str, asof) -> int:
        self.calls += 1
        v = self._scores.get(symbol.upper())
        if v is None:
            raise ValueError(f"no F-score for {symbol}")
        return int(v)

    def statements(self, symbol, asof):
        return {}


class _ScriptedEarnings:
    """Return an earnings calendar DataFrame from a per-symbol dict of dates."""

    def __init__(self, events: dict[str, list[date]]) -> None:
        self._events = {k.upper(): list(v) for k, v in events.items()}

    def calendar(self, start, end, symbols=None):
        rows = []
        start_d = start if isinstance(start, date) else pd.Timestamp(start).date()
        end_d = end if isinstance(end, date) else pd.Timestamp(end).date()
        wanted = {s.upper() for s in (symbols or self._events)}
        for sym, dates in self._events.items():
            if sym not in wanted:
                continue
            for d in dates:
                if start_d <= d <= end_d:
                    rows.append({"symbol": sym, "date": d})
        return pd.DataFrame(rows, columns=["symbol", "date"])

    def surprises(self, symbol, start, end):
        return pd.DataFrame()

    def consensus(self, symbol, asof):
        return {}


class _FakeCalendar:
    def next_session(self, d):
        t = pd.Timestamp(d) + pd.offsets.BDay(1)
        return t.date()

    def sessions(self, start, end):
        return pd.bdate_range(start=start, end=end)


def _build_ctx(
    asof: date,
    bar_provider,
    fundamentals_provider=None,
    earnings_provider=None,
    positions: list[Position] | None = None,
    cash: Decimal = Decimal("100000"),
) -> Context:
    return Context(
        asof=asof,
        cash=cash,
        equity=cash,
        positions=list(positions or []),
        bar_provider=bar_provider,
        fundamentals_provider=fundamentals_provider,
        earnings_provider=earnings_provider,
        calendar_provider=_FakeCalendar(),
    )


# Last business day of January 2024 is Wed 2024-01-31 → last-of-month.
REBAL_DAY = date(2024, 1, 31)
# Mid-month weekday — not a rebalance day.
NON_REBAL_DAY = date(2024, 1, 15)


# --------------------------------------------------------------------------- #
# Registration / config                                                       #
# --------------------------------------------------------------------------- #
class TestRegistrationAndConfig:
    def test_strategy_registered(self):
        from backend.strategies.registry import get_strategy

        cls = get_strategy("momentum_quality")
        assert cls is MomentumQualityStrategy

    def test_configure_applies_defaults(self):
        s = MomentumQualityStrategy()
        s.configure({})
        assert s.params["momentum_lookback_m"] == 12
        assert s.params["momentum_skip_m"] == 1
        assert s.params["top_n"] == 15
        assert s.params["rebalance_freq"] == "monthly"
        assert s.params["min_f_score"] == 5

    def test_configure_applies_overrides(self):
        s = MomentumQualityStrategy()
        s.configure({
            "momentum_lookback_m": 6,
            "top_n": 10,
            "rebalance_freq": "quarterly",
            "quality_weight": 0.5,
            "min_f_score": 7,
        })
        assert s.params["momentum_lookback_m"] == 6
        assert s.params["top_n"] == 10
        assert s.params["rebalance_freq"] == "quarterly"
        assert s.params["quality_weight"] == 0.5
        assert s.params["min_f_score"] == 7

    def test_configure_rejects_bad_freq(self):
        s = MomentumQualityStrategy()
        with pytest.raises(ValueError):
            s.configure({"rebalance_freq": "weekly"})

    def test_search_space_matches_spec(self):
        space = search_space()
        assert set(space) == {
            "momentum_lookback_m",
            "momentum_skip_m",
            "quality_weight",
            "top_n",
            "rebalance_freq",
            "min_f_score",
            "momentum_filter_min",
        }


# --------------------------------------------------------------------------- #
# Universe / exclusions                                                       #
# --------------------------------------------------------------------------- #
class TestUniverseFilters:
    def test_financials_excluded(self):
        syms = eligible_universe()
        for sym in syms:
            sector = SECTOR_MAP[sym]
            assert sector not in EXCLUDED_SECTORS, (
                f"{sym} ({sector}) should have been excluded"
            )
        # Sanity check — V / MA / JPM / BAC are flagged as Financials in
        # the config, so they must not appear in the eligible universe.
        for fin in ("V", "MA", "JPM", "BAC"):
            assert fin not in syms

    def test_universe_hook_returns_eligible_syms_plus_positions(self):
        s = MomentumQualityStrategy()
        s.configure({})
        provider = _ScriptedBarProvider(returns={})
        pos = Position(symbol="FOO", quantity=100, avg_price=Decimal("50"))
        ctx = _build_ctx(REBAL_DAY, provider, positions=[pos])
        u = list(s.universe(REBAL_DAY, ctx))
        assert "FOO" in u
        for f in ("JPM", "V", "MA", "BAC"):
            assert f not in u


# --------------------------------------------------------------------------- #
# Rebalance trigger                                                           #
# --------------------------------------------------------------------------- #
class TestRebalanceTrigger:
    def test_last_day_of_january_is_rebalance(self):
        ctx = _build_ctx(REBAL_DAY, _ScriptedBarProvider(returns={}))
        assert _is_last_trading_day_of_month(REBAL_DAY, ctx) is True

    def test_mid_month_is_not_rebalance(self):
        ctx = _build_ctx(NON_REBAL_DAY, _ScriptedBarProvider(returns={}))
        assert _is_last_trading_day_of_month(NON_REBAL_DAY, ctx) is False

    def test_non_rebalance_day_emits_nothing(self):
        s = MomentumQualityStrategy()
        s.configure({})
        provider = _ScriptedBarProvider(returns={u: 0.2 for u in eligible_universe()})
        ctx = _build_ctx(NON_REBAL_DAY, provider)
        assert list(s.manage(NON_REBAL_DAY, ctx)) == []
        assert list(s.generate_signals(NON_REBAL_DAY, ctx)) == []

    def test_quarterly_only_in_march_june_sep_dec(self):
        s = MomentumQualityStrategy()
        s.configure({"rebalance_freq": "quarterly"})
        provider = _ScriptedBarProvider(returns={})
        # Last business day of Jan = no rebalance under quarterly cadence.
        ctx = _build_ctx(REBAL_DAY, provider)
        assert list(s.manage(REBAL_DAY, ctx)) == []
        # Last business day of March 2024 = 2024-03-29 → rebalance.
        march_end = date(2024, 3, 29)
        assert _is_last_trading_day_of_month(march_end, ctx) is True


# --------------------------------------------------------------------------- #
# Ranking correctness                                                         #
# --------------------------------------------------------------------------- #
class TestRanking:
    def test_rank_01_ties_monotonic(self):
        out = _rank_01(np.array([1.0, 2.0, 3.0, 4.0, 5.0], dtype=float))
        assert out[0] == pytest.approx(0.0)
        assert out[-1] == pytest.approx(1.0)

    def test_rank_01_handles_ties(self):
        out = _rank_01(np.array([1.0, 2.0, 2.0, 3.0], dtype=float))
        # Two tied values at rank 2 and 3 average to 2.5
        assert out[1] == out[2]

    def test_top_n_picks_highest_composite(self):
        """With 3 momentum winners and F-scores all equal, the top 3
        should be exactly the top-3 by momentum."""

        s = MomentumQualityStrategy()
        # No F-score filter friction
        s.configure({"top_n": 3, "min_f_score": 1})

        # All eligible names with scripted 12-month returns
        syms = eligible_universe()
        returns = {sym: 0.0 for sym in syms}
        returns["AAPL"] = 0.40
        returns["MSFT"] = 0.35
        returns["NVDA"] = 0.30
        # Everyone else: 0.05 so the top-3 are these three
        for sym in syms:
            if sym not in ("AAPL", "MSFT", "NVDA"):
                returns[sym] = 0.05

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals({sym: 9 for sym in syms})
        ctx = _build_ctx(REBAL_DAY, provider, fundamentals_provider=fund)
        # Populate universe cache via the hook
        list(s.universe(REBAL_DAY, ctx))
        target = s._compute_target(REBAL_DAY, ctx)
        assert sorted(target) == sorted(["AAPL", "MSFT", "NVDA"])

    def test_quality_weight_dominates_when_extreme(self):
        """With quality_weight = 1.0 (momentum ignored), the top picks
        should be the F=9 name(s) even if their momentum is weakest."""

        s = MomentumQualityStrategy()
        s.configure({"top_n": 1, "min_f_score": 1, "quality_weight": 1.0})

        syms = eligible_universe()
        # AAPL: low momentum but F=9. Others: high momentum, F=1.
        returns = {sym: 0.30 for sym in syms}
        returns["AAPL"] = 0.05
        fscores: dict[str, Optional[int]] = {sym: 1 for sym in syms}
        fscores["AAPL"] = 9

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals(fscores)
        ctx = _build_ctx(REBAL_DAY, provider, fundamentals_provider=fund)
        list(s.universe(REBAL_DAY, ctx))
        target = s._compute_target(REBAL_DAY, ctx)
        assert target == ["AAPL"]


# --------------------------------------------------------------------------- #
# F-score handling                                                            #
# --------------------------------------------------------------------------- #
class TestFScoreHandling:
    def test_missing_fscore_silently_excluded(self):
        """If F-score provider raises for a name, it drops out of ranking —
        the strategy continues with the remaining names."""

        s = MomentumQualityStrategy()
        s.configure({"top_n": 3, "min_f_score": 1})

        syms = eligible_universe()
        returns = {sym: 0.10 for sym in syms}
        # AAPL has the best momentum but no F-score → must be excluded
        returns["AAPL"] = 0.50
        returns["MSFT"] = 0.40
        returns["NVDA"] = 0.35

        fscores: dict[str, Optional[int]] = {sym: 9 for sym in syms}
        fscores["AAPL"] = None   # → raises → excluded

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals(fscores)
        ctx = _build_ctx(REBAL_DAY, provider, fundamentals_provider=fund)
        list(s.universe(REBAL_DAY, ctx))
        target = s._compute_target(REBAL_DAY, ctx)
        assert "AAPL" not in target
        # Should still fill the remaining 3 slots from the next-best names.
        assert len(target) == 3

    def test_hard_gate_excludes_low_fscore(self):
        s = MomentumQualityStrategy()
        s.configure({"top_n": 3, "min_f_score": 5})

        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.60  # top momentum
        returns["MSFT"] = 0.50

        fscores: dict[str, Optional[int]] = {sym: 9 for sym in syms}
        fscores["AAPL"] = 2   # below min_f_score=5 → excluded by hard gate

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals(fscores)
        ctx = _build_ctx(REBAL_DAY, provider, fundamentals_provider=fund)
        list(s.universe(REBAL_DAY, ctx))
        target = s._compute_target(REBAL_DAY, ctx)
        assert "AAPL" not in target
        assert "MSFT" in target


# --------------------------------------------------------------------------- #
# End-to-end signal emission                                                  #
# --------------------------------------------------------------------------- #
class TestSignalEmission:
    def test_rebalance_emits_entries_and_exits(self):
        s = MomentumQualityStrategy()
        s.configure({"top_n": 3, "min_f_score": 1})

        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.40
        returns["MSFT"] = 0.35
        returns["NVDA"] = 0.30

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals({sym: 8 for sym in syms})

        # Hold a position in a name that won't make top-3.
        stale_pos = Position(
            symbol="ORCL", quantity=10, avg_price=Decimal("100")
        )
        ctx = _build_ctx(
            REBAL_DAY,
            provider,
            fundamentals_provider=fund,
            positions=[stale_pos],
        )
        # Universe hook seeds cache
        list(s.universe(REBAL_DAY, ctx))

        exits = list(s.manage(REBAL_DAY, ctx))
        entries = list(s.generate_signals(REBAL_DAY, ctx))

        # One exit for ORCL (it's not in top-3).
        exit_syms = {sig.symbol for sig in exits}
        assert "ORCL" in exit_syms
        for sig in exits:
            assert sig.target_weight == 0.0
            assert sig.order_type.value == "market_on_open"

        # Three entries summing to 1.0 weight total.
        entry_syms = {sig.symbol for sig in entries}
        assert entry_syms == {"AAPL", "MSFT", "NVDA"}
        total_w = sum(float(sig.target_weight) for sig in entries)
        assert total_w == pytest.approx(1.0, abs=1e-9)
        # Each entry equal-weighted.
        for sig in entries:
            assert sig.target_weight == pytest.approx(1 / 3, abs=1e-9)

    def test_earnings_skip_blocks_name(self):
        s = MomentumQualityStrategy()
        s.configure({"top_n": 3, "min_f_score": 1, "earnings_skip_days": 3})

        syms = eligible_universe()
        returns = {sym: 0.05 for sym in syms}
        returns["AAPL"] = 0.50
        returns["MSFT"] = 0.40
        returns["NVDA"] = 0.35

        provider = _ScriptedBarProvider(returns=returns)
        fund = _ScriptedFundamentals({sym: 8 for sym in syms})

        # AAPL has earnings 2 days after the rebalance → blocked
        earnings = _ScriptedEarnings({"AAPL": [REBAL_DAY + timedelta(days=2)]})
        ctx = _build_ctx(
            REBAL_DAY,
            provider,
            fundamentals_provider=fund,
            earnings_provider=earnings,
        )
        list(s.universe(REBAL_DAY, ctx))
        target = s._compute_target(REBAL_DAY, ctx)
        assert "AAPL" not in target
        assert len(target) == 3
