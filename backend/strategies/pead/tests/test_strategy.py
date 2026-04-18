"""Unit tests for the PEAD strategy.

Covers the audit's four defining defects and the spec's correctness gates:

1. **SUE computation** — synthetic 8-quarter surprise history, trailing σ
   known, expected SUE computed by hand.
2. **Directional gating** — positive SUE > threshold → long; negative SUE
   < -threshold → short (only when `allow_shorts=True`); |SUE| below
   threshold → no signal.
3. **Time-stop exit** — a position opened on D_entry exits at
   D_entry + holding_days via MOC.
4. **Overlapping earnings filter** — a name with another earnings date
   inside the holding window is skipped.
5. **Provider integration smoke** — a fake EarningsProvider returning a
   hand-built calendar + surprises produces the expected signals
   end-to-end.

Tests drive the strategy's hooks directly with a hand-built ``Context``
and in-memory providers, so they run fast (<1s) and do not depend on
the engine or any network.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable, Optional

import numpy as np
import pandas as pd
import pytest

from backtest.types import Context, Position, Side
from strategies.pead.config import DEFAULTS, UNIVERSE_SEED, search_space
from strategies.pead.helpers import (
    compute_sue,
    has_overlapping_earnings,
    passes_liquidity,
    trading_days_between,
)
from strategies.pead.strategy import PEADStrategy


# --------------------------------------------------------------------------- #
# Fake providers                                                              #
# --------------------------------------------------------------------------- #
class _FakeBarProvider:
    """Returns a hand-built OHLCV panel with linear prices + constant vol."""

    def __init__(
        self,
        symbols: Iterable[str],
        start: date,
        end: date,
        price: float = 100.0,
        volume: float = 5_000_000.0,
    ) -> None:
        self.symbols = [s.upper() for s in symbols]
        rows = []
        idx = pd.bdate_range(start=start, end=end)
        for sym in self.symbols:
            for ts in idx:
                rows.append(
                    {
                        "symbol": sym,
                        "ts": pd.Timestamp(ts).tz_localize("UTC"),
                        "open": price,
                        "high": price * 1.01,
                        "low": price * 0.99,
                        "close": price,
                        "volume": volume,
                    }
                )
        self._df = pd.DataFrame(rows)

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        if isinstance(symbols, str):
            symbols = [symbols]
        syms = [s.upper() for s in symbols]
        start_ts = pd.Timestamp(start)
        if start_ts.tzinfo is None:
            start_ts = start_ts.tz_localize("UTC")
        end_ts = pd.Timestamp(end)
        if end_ts.tzinfo is None:
            end_ts = end_ts.tz_localize("UTC")
        start_ts = start_ts.normalize()
        end_ts = end_ts.normalize() + pd.Timedelta(hours=23, minutes=59)

        m = (self._df["symbol"].isin(syms)
             & (self._df["ts"] >= start_ts)
             & (self._df["ts"] <= end_ts))
        return self._df.loc[m].reset_index(drop=True)


class _FakeEarnings:
    """Returns hand-built calendar + surprises frames."""

    def __init__(
        self,
        calendar: list[dict],
        surprise_history: dict[str, list[dict]],
    ) -> None:
        self._calendar = pd.DataFrame(calendar) if calendar else pd.DataFrame(
            columns=[
                "symbol", "date", "eps_actual", "eps_estimated",
                "revenue_actual", "revenue_estimated",
            ]
        )
        if not self._calendar.empty:
            self._calendar["symbol"] = self._calendar["symbol"].astype(str).str.upper()
        self._surprises = {k.upper(): list(v) for k, v in surprise_history.items()}

    def calendar(self, start, end, symbols=None):
        start_d = start if isinstance(start, date) else pd.Timestamp(start).date()
        end_d = end if isinstance(end, date) else pd.Timestamp(end).date()
        out = self._calendar.copy()
        if out.empty:
            return out
        out_filter_dates = out["date"].apply(
            lambda x: (x.date() if isinstance(x, datetime) else x)
        )
        mask = (out_filter_dates >= start_d) & (out_filter_dates <= end_d)
        out = out.loc[mask].reset_index(drop=True)
        if symbols is not None:
            wanted = {s.upper() for s in symbols}
            out = out[out["symbol"].isin(wanted)].reset_index(drop=True)
        return out

    def surprises(self, symbol, start, end):
        rows = self._surprises.get(symbol.upper(), [])
        if not rows:
            return pd.DataFrame(
                columns=[
                    "symbol", "date", "eps_actual", "eps_estimated",
                    "surprise", "surprise_pct", "sue",
                    "revenue_actual", "revenue_estimated",
                ]
            )
        df = pd.DataFrame(rows).copy()
        df["symbol"] = symbol.upper()
        # Compute surprise column mimicking the FMP adapter.
        df["surprise"] = df["eps_actual"] - df["eps_estimated"]
        df["surprise_pct"] = np.where(
            df["eps_estimated"].abs() > 1e-9,
            df["surprise"] / df["eps_estimated"].abs(),
            np.nan,
        )
        df["sue"] = np.nan  # computed inside the strategy, not here
        df["revenue_actual"] = df.get("revenue_actual", pd.NA)
        df["revenue_estimated"] = df.get("revenue_estimated", pd.NA)
        return df.sort_values("date", ignore_index=True)

    def consensus(self, symbol, asof):
        return {}


def _ctx(
    asof: date,
    bar_provider,
    earnings_provider,
    positions: list[Position] | None = None,
    cash: Decimal = Decimal("100000"),
) -> Context:
    return Context(
        asof=asof,
        cash=cash,
        equity=cash,
        positions=list(positions or []),
        bar_provider=bar_provider,
        earnings_provider=earnings_provider,
    )


def _synthetic_history(
    symbol: str,
    n: int = 12,
    base_date: date = date(2022, 1, 1),
    surprise_sigma: float = 0.05,
) -> list[dict]:
    """Generate ``n`` quarterly surprise rows with known trailing σ.

    Surprises alternate ±surprise_sigma so that the last-8 std is
    approximately ``surprise_sigma``. Returns rows with keys
    ``date``, ``eps_actual``, ``eps_estimated``.
    """

    rows = []
    for i in range(n):
        d = base_date + timedelta(days=90 * i)
        est = 1.00
        delta = surprise_sigma * (1 if i % 2 == 0 else -1)
        actual = est + delta
        rows.append(
            {
                "date": d,
                "eps_actual": actual,
                "eps_estimated": est,
            }
        )
    return rows


# --------------------------------------------------------------------------- #
# Registration / config                                                       #
# --------------------------------------------------------------------------- #
class TestRegistrationAndConfig:
    def test_strategy_registered(self):
        from strategies.registry import get_strategy

        cls = get_strategy("pead")
        assert cls is PEADStrategy

    def test_configure_applies_defaults(self):
        s = PEADStrategy()
        s.configure({})
        assert s.params["sue_threshold"] == 1.5
        assert s.params["holding_days"] == 40
        assert s.params["sue_lookback_quarters"] == 8
        assert s.params["allow_shorts"] is True

    def test_configure_applies_overrides(self):
        s = PEADStrategy()
        s.configure({
            "sue_threshold": 2.0,
            "holding_days": 30,
            "allow_shorts": False,
            "max_concurrent_positions": 15,
        })
        assert s.params["sue_threshold"] == 2.0
        assert s.params["holding_days"] == 30
        assert s.params["allow_shorts"] is False
        assert s.params["max_concurrent_positions"] == 15

    def test_configure_rejects_bad_threshold(self):
        s = PEADStrategy()
        with pytest.raises(ValueError):
            s.configure({"sue_threshold": -1.0})

    def test_configure_rejects_bad_holding_days(self):
        s = PEADStrategy()
        with pytest.raises(ValueError):
            s.configure({"holding_days": 0})

    def test_search_space_matches_spec(self):
        space = search_space()
        assert set(space) == {
            "sue_threshold",
            "holding_days",
            "sue_lookback_quarters",
            "max_concurrent_positions",
            "allocation_per_position",
            "allow_shorts",
            "universe_min_mcap_bn",
            "sue_universe_rank_top_pct",
        }


# --------------------------------------------------------------------------- #
# SUE computation                                                             #
# --------------------------------------------------------------------------- #
class TestSUEMath:
    def test_sue_computation_matches_hand_calc(self):
        """Given 8 historical surprises ±0.05 alternating, trailing σ should
        equal the sample std of those surprises. A current +0.10 surprise
        (twice the typical magnitude) should yield SUE ≈ 0.10 / σ."""

        history_rows = _synthetic_history(
            "AAPL",
            n=8,
            base_date=date(2020, 1, 1),
            surprise_sigma=0.05,
        )
        history = pd.DataFrame(history_rows).assign(symbol="AAPL")
        history["surprise"] = history["eps_actual"] - history["eps_estimated"]

        # Expected trailing σ of the 8 historical surprises.
        expected_sigma = float(history["surprise"].std(ddof=1))
        assert expected_sigma > 0

        # Now compute SUE for a new announcement with +0.10 surprise.
        current_actual = 1.10
        current_est = 1.00
        asof = date(2022, 1, 1)

        sue = compute_sue(
            current_actual,
            current_est,
            history,
            asof,
            lookback_quarters=8,
            min_quarters=4,
        )
        assert sue is not None
        expected_sue = 0.10 / expected_sigma
        assert sue == pytest.approx(expected_sue, rel=1e-6)

    def test_sue_requires_min_quarters(self):
        """With only 2 historical quarters and min_quarters=4, SUE is None."""

        history = pd.DataFrame(
            [
                {"date": date(2021, 1, 1), "eps_actual": 1.0,
                 "eps_estimated": 1.0, "surprise": 0.0},
                {"date": date(2021, 4, 1), "eps_actual": 1.05,
                 "eps_estimated": 1.0, "surprise": 0.05},
            ]
        )
        sue = compute_sue(
            1.1, 1.0, history, date(2022, 1, 1),
            lookback_quarters=8, min_quarters=4,
        )
        assert sue is None

    def test_sue_returns_none_on_zero_sigma(self):
        """All-equal past surprises → σ == 0 → SUE undefined."""

        history = pd.DataFrame(
            [
                {"date": date(2020, 1, 1) + timedelta(days=90 * i),
                 "eps_actual": 1.0, "eps_estimated": 1.0, "surprise": 0.0}
                for i in range(8)
            ]
        )
        sue = compute_sue(
            1.1, 1.0, history, date(2022, 1, 1),
            lookback_quarters=8, min_quarters=4,
        )
        assert sue is None

    def test_sue_returns_none_when_actual_or_estimated_missing(self):
        hist = pd.DataFrame(_synthetic_history("X", n=8, surprise_sigma=0.05))
        hist["surprise"] = hist["eps_actual"] - hist["eps_estimated"]
        assert compute_sue(None, 1.0, hist, date(2022, 1, 1), 8, 4) is None
        assert compute_sue(1.1, None, hist, date(2022, 1, 1), 8, 4) is None


# --------------------------------------------------------------------------- #
# Direction gating                                                            #
# --------------------------------------------------------------------------- #
class TestDirectionGating:
    @staticmethod
    def _fixture(sue_delta: float, allow_shorts: bool):
        """Build an earnings calendar with AAPL reporting yesterday with a
        known positive or negative SUE.

        ``sue_delta`` is the surprise magnitude; typical σ is 0.05 so a
        delta of ±0.10 gives SUE ≈ ±2.0 (well above the 1.5 threshold).
        """

        asof = date(2022, 4, 15)
        announce_day = asof - timedelta(days=1)
        # 8 historical quarters of ±0.05 surprises → σ ≈ 0.0535 (computed).
        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2020, 1, 1), surprise_sigma=0.05
        )
        est = 1.00
        actual = est + sue_delta
        cal = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": actual,
                "eps_estimated": est,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            }
        ]
        bar_start = asof - timedelta(days=200)
        bar_end = asof + timedelta(days=60)
        bars = _FakeBarProvider(
            ["AAPL"], bar_start, bar_end, price=100.0, volume=5_000_000.0
        )
        earnings = _FakeEarnings(cal, {"AAPL": hist})

        strat = PEADStrategy()
        strat.configure({
            "sue_threshold": 1.5,
            "allow_shorts": allow_shorts,
            "holding_days": 40,
            "max_concurrent_positions": 10,
            "allocation_per_position": 0.05,
            "sue_lookback_quarters": 8,
            "min_quarters_for_sue": 4,
            "sue_universe_rank_top_pct": 1.0,
        })
        ctx = _ctx(asof, bars, earnings)
        # Warm the universe cache (the hook caches UNIVERSE_SEED).
        list(strat.universe(asof, ctx))
        return strat, ctx, asof

    def test_positive_sue_emits_long(self):
        strat, ctx, asof = self._fixture(sue_delta=+0.10, allow_shorts=True)
        sigs = list(strat.generate_signals(asof, ctx))
        assert len(sigs) == 1
        assert sigs[0].symbol == "AAPL"
        assert sigs[0].target_weight > 0
        assert sigs[0].target_weight == pytest.approx(0.05)
        assert "long" in sigs[0].tag

    def test_negative_sue_emits_short_when_allowed(self):
        strat, ctx, asof = self._fixture(sue_delta=-0.10, allow_shorts=True)
        sigs = list(strat.generate_signals(asof, ctx))
        assert len(sigs) == 1
        assert sigs[0].symbol == "AAPL"
        assert sigs[0].target_weight < 0
        assert sigs[0].target_weight == pytest.approx(-0.05)
        assert "short" in sigs[0].tag

    def test_negative_sue_skipped_when_shorts_disabled(self):
        strat, ctx, asof = self._fixture(sue_delta=-0.10, allow_shorts=False)
        sigs = list(strat.generate_signals(asof, ctx))
        assert sigs == []

    def test_small_sue_does_not_emit(self):
        # 8 historical quarters of ±0.05 → σ ≈ 0.0535. A +0.02 surprise
        # yields SUE ≈ 0.37, well below the 1.5 threshold → no signal.
        strat, ctx, asof = self._fixture(sue_delta=+0.02, allow_shorts=True)
        sigs = list(strat.generate_signals(asof, ctx))
        assert sigs == []


# --------------------------------------------------------------------------- #
# Time-stop exit                                                              #
# --------------------------------------------------------------------------- #
class TestTimeStopExit:
    def test_40_day_time_stop_emits_moc_exit(self):
        """A position with opened_at = 40 business days ago should be
        exited today via MOC."""

        holding_days = 40
        today = date(2023, 5, 15)
        entry = pd.bdate_range(end=pd.Timestamp(today), periods=holding_days + 1)[0].date()

        pos = Position(
            symbol="AAPL",
            quantity=100,
            avg_price=Decimal("150"),
            opened_at=datetime.combine(entry, datetime.min.time()),
        )
        strat = PEADStrategy()
        strat.configure({"holding_days": holding_days})
        bars = _FakeBarProvider(["AAPL"], entry - timedelta(days=60), today, price=150.0)
        earnings = _FakeEarnings([], {"AAPL": []})
        ctx = _ctx(today, bars, earnings, positions=[pos])

        exits = list(strat.manage(today, ctx))
        assert len(exits) == 1
        assert exits[0].symbol == "AAPL"
        assert exits[0].target_weight == 0.0
        assert exits[0].order_type.value == "market_on_close"
        assert "time" in exits[0].tag

    def test_short_holding_period_no_exit(self):
        """Position just opened; 1-day hold well under holding_days=40."""

        today = date(2023, 5, 15)
        entry = today - timedelta(days=1)

        pos = Position(
            symbol="AAPL",
            quantity=100,
            avg_price=Decimal("150"),
            opened_at=datetime.combine(entry, datetime.min.time()),
        )
        strat = PEADStrategy()
        strat.configure({"holding_days": 40})
        bars = _FakeBarProvider(["AAPL"], entry - timedelta(days=5), today, price=150.0)
        earnings = _FakeEarnings([], {"AAPL": []})
        ctx = _ctx(today, bars, earnings, positions=[pos])

        exits = list(strat.manage(today, ctx))
        assert exits == []


# --------------------------------------------------------------------------- #
# Overlapping-earnings filter                                                 #
# --------------------------------------------------------------------------- #
class TestOverlappingEarnings:
    def test_has_overlapping_earnings_inside_horizon(self):
        cal = pd.DataFrame(
            [
                {"symbol": "AAPL", "date": date(2023, 6, 1)},
                {"symbol": "AAPL", "date": date(2023, 7, 15)},  # inside 40-day horizon
            ]
        )
        # Check: entry today=2023-06-01, horizon=40 business days.
        # 40 BDays from 2023-06-01 is well past 2023-07-15 → overlap.
        assert has_overlapping_earnings(cal, "AAPL", date(2023, 6, 1), 40) is True

    def test_has_overlapping_earnings_outside_horizon(self):
        cal = pd.DataFrame(
            [
                {"symbol": "AAPL", "date": date(2023, 6, 1)},
                {"symbol": "AAPL", "date": date(2024, 1, 1)},  # well outside 40-day
            ]
        )
        assert has_overlapping_earnings(cal, "AAPL", date(2023, 6, 1), 40) is False

    def test_signal_skipped_when_earnings_overlap(self):
        """A name with another earnings inside the holding window is
        silently dropped from entries."""

        asof = date(2023, 6, 15)
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05
        )
        # AAPL's current announcement (will produce a large positive SUE)
        # + an overlapping announcement 20 days out → should be skipped.
        cal = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.10,
                "eps_estimated": 1.00,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
            {
                "symbol": "AAPL",
                "date": asof + timedelta(days=20),
                "eps_actual": None,  # future announcement
                "eps_estimated": None,
                "revenue_actual": None,
                "revenue_estimated": None,
            },
        ]
        bars = _FakeBarProvider(
            ["AAPL"], asof - timedelta(days=200), asof + timedelta(days=60),
            price=100.0, volume=5_000_000.0,
        )
        earnings = _FakeEarnings(cal, {"AAPL": hist})

        strat = PEADStrategy()
        strat.configure({
            "sue_threshold": 1.5,
            "holding_days": 40,
            "allow_shorts": False,
            "sue_lookback_quarters": 8,
            "sue_universe_rank_top_pct": 1.0,
        })
        ctx = _ctx(asof, bars, earnings)
        list(strat.universe(asof, ctx))

        sigs = list(strat.generate_signals(asof, ctx))
        # Overlap → no signal emitted.
        assert sigs == []


# --------------------------------------------------------------------------- #
# Provider integration smoke                                                  #
# --------------------------------------------------------------------------- #
class TestProviderIntegrationSmoke:
    def test_end_to_end_with_fake_earnings(self):
        """Full hook cycle: universe → calendar → SUE → entry signal."""

        asof = date(2023, 4, 15)
        announce_day = asof - timedelta(days=1)

        # Two names reporting yesterday. AAPL has a large positive SUE,
        # MSFT has a small surprise (below threshold).
        aapl_hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05
        )
        msft_hist = _synthetic_history(
            "MSFT", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05
        )
        cal = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.10,  # +0.10 surprise → SUE ~= 1.87
                "eps_estimated": 1.00,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
            {
                "symbol": "MSFT",
                "date": announce_day,
                "eps_actual": 1.01,  # +0.01 surprise → SUE ~= 0.19 (below)
                "eps_estimated": 1.00,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
        ]
        bars = _FakeBarProvider(
            ["AAPL", "MSFT"],
            asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=100.0,
            volume=5_000_000.0,
        )
        earnings = _FakeEarnings(
            cal, {"AAPL": aapl_hist, "MSFT": msft_hist}
        )

        strat = PEADStrategy()
        strat.configure({
            "sue_threshold": 1.5,
            "holding_days": 40,
            "allow_shorts": True,
            "max_concurrent_positions": 10,
            "allocation_per_position": 0.05,
            "sue_lookback_quarters": 8,
            "min_quarters_for_sue": 4,
            "sue_universe_rank_top_pct": 1.0,
        })
        ctx = _ctx(asof, bars, earnings)
        list(strat.universe(asof, ctx))

        sigs = list(strat.generate_signals(asof, ctx))
        # Only AAPL passes the 1.5 threshold.
        syms = [s.symbol for s in sigs]
        assert "AAPL" in syms
        assert "MSFT" not in syms
        assert len(sigs) == 1
        assert sigs[0].order_type.value == "market_on_open"

    def test_liquidity_filter_blocks_illiquid_names(self):
        """A stock with low dollar volume (below the 20M ADV floor) is
        skipped at the entry stage even with a large SUE."""

        asof = date(2023, 4, 15)
        announce_day = asof - timedelta(days=1)

        hist = _synthetic_history(
            "AAPL", n=8, base_date=date(2021, 1, 1), surprise_sigma=0.05
        )
        cal = [
            {
                "symbol": "AAPL",
                "date": announce_day,
                "eps_actual": 1.20,  # very large surprise
                "eps_estimated": 1.00,
                "revenue_actual": 100.0,
                "revenue_estimated": 100.0,
            },
        ]
        # Low volume: 10 * 10_000 = $100k dollar-vol → below 20M floor.
        bars = _FakeBarProvider(
            ["AAPL"],
            asof - timedelta(days=200),
            asof + timedelta(days=60),
            price=10.0,
            volume=10_000.0,
        )
        earnings = _FakeEarnings(cal, {"AAPL": hist})

        strat = PEADStrategy()
        strat.configure({
            "sue_threshold": 1.5,
            "holding_days": 40,
            "allow_shorts": True,
            "adv_usd_min": 20_000_000.0,
            "price_min": 10.0,
            "sue_universe_rank_top_pct": 1.0,
        })
        ctx = _ctx(asof, bars, earnings)
        list(strat.universe(asof, ctx))

        sigs = list(strat.generate_signals(asof, ctx))
        assert sigs == []


# --------------------------------------------------------------------------- #
# Trading-days helper                                                         #
# --------------------------------------------------------------------------- #
class TestTradingDaysBetween:
    def test_forty_business_days(self):
        today = date(2023, 5, 15)
        entry = pd.bdate_range(end=pd.Timestamp(today), periods=41)[0].date()
        assert trading_days_between(entry, today) == 40

    def test_same_day_returns_zero(self):
        d = date(2023, 1, 2)
        assert trading_days_between(d, d) == 0

    def test_accepts_datetime(self):
        dt = datetime(2023, 1, 2)
        end = date(2023, 1, 4)
        assert trading_days_between(dt, end) == 2
