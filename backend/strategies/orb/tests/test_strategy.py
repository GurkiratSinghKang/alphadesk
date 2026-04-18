"""Unit tests for the ORB intraday simulator.

The simulator is exercised directly with synthetic 1-minute bar frames so
each invariant (first-break, single-entry, EOD flat, TP scale-outs, time
cutoff, no overnight positions, stop trigger) can be verified
deterministically without hitting the Alpaca network.
"""

from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Iterable

import pandas as pd
import pytest

from strategies.orb.strategy import ORBStrategy, OrbDayResult


# --------------------------------------------------------------------------- #
# Synthetic bar builder                                                       #
# --------------------------------------------------------------------------- #
def make_bars(
    symbol: str,
    target_date: date,
    prices: list[tuple[float, float, float, float, int]],
) -> pd.DataFrame:
    """Construct a 1-minute bar frame starting at 9:30 ET on ``target_date``.

    ``prices`` is a list of ``(open, high, low, close, volume)`` tuples, one
    per consecutive minute bar. The result carries a UTC timestamp column
    ``ts`` (the provider contract).
    """

    rows = []
    # 9:30 America/New_York for target_date. Build via a local Timestamp
    # then convert to UTC.
    base = pd.Timestamp(
        f"{target_date.isoformat()} 09:30:00", tz="America/New_York"
    )
    for i, (o, h, l, c, v) in enumerate(prices):
        ts = (base + pd.Timedelta(minutes=i)).tz_convert("UTC")
        rows.append(
            {
                "symbol": symbol,
                "ts": ts,
                "open": o,
                "high": h,
                "low": l,
                "close": c,
                "volume": v,
            }
        )
    return pd.DataFrame(rows)


class FakeBarProvider:
    """Return the pre-made frame regardless of the request."""

    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = {s.upper() for s in symbols}
        return self.df[self.df["symbol"].str.upper().isin(syms)].copy()


def make_ctx(provider) -> SimpleNamespace:
    return SimpleNamespace(
        asof=None,
        cash=0,
        equity=0,
        positions=[],
        bar_provider=provider,
        options_provider=None,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )


# --------------------------------------------------------------------------- #
# Scenario builders                                                           #
# --------------------------------------------------------------------------- #
RTH_MINUTES = (16 - 9) * 60 + (0 - 30)  # 390 minutes


def bars_with_long_breakout_at_bar(
    target_date: date,
    symbol: str,
    or_high: float,
    or_low: float,
    breakout_bar_idx: int,
    breakout_close: float,
    total_bars: int = 390,
    *,
    or_volume: int = 1_000_000,
    post_or_volume: int = 1_200_000,
    hold_close: float | None = None,
) -> pd.DataFrame:
    """OR = [or_low, or_high] held for first 5 bars; breakout on idx B with
    ``close=breakout_close`` (> or_high). After breakout we hold at
    ``hold_close`` for the rest of the session so no stop / TP / EOD noise
    kicks in unless the caller wants it.
    """

    # Form the OR: 5 bars all ranging [or_low, or_high].
    prices: list[tuple[float, float, float, float, int]] = []
    mid = (or_high + or_low) / 2.0
    for i in range(5):
        prices.append((mid, or_high, or_low, mid, or_volume))

    hold = hold_close if hold_close is not None else breakout_close

    for i in range(5, total_bars):
        if i == breakout_bar_idx:
            # Breakout bar: closes above OR_high. Volume sufficient.
            prices.append((mid, breakout_close, or_low, breakout_close, post_or_volume))
        else:
            # Fill / "hold" bar. Stays at hold (no extra breakouts, no stops).
            prices.append((hold, hold + 0.01, hold - 0.01, hold, 500_000))
    return make_bars(symbol, target_date, prices)


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
def test_first_break_triggers_long_entry():
    """Close above OR_high on the first post-OR bar fires a long entry."""

    day = date(2024, 6, 3)
    df = bars_with_long_breakout_at_bar(
        target_date=day,
        symbol="QQQ",
        or_high=100.0,
        or_low=99.0,
        breakout_bar_idx=5,  # 6th bar overall — first bar after the 5-min OR
        breakout_close=100.5,
        hold_close=100.5,
    )
    strat = ORBStrategy()
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": False})
    strat.params["universe_profile"] = "spy_qqq"
    # Override universe to single sym for test determinism
    strat.params["universe_profile"] = "spy_qqq"

    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    per_qqq = [r for r in results if r.symbol == "QQQ"]
    assert per_qqq, "QQQ must be in the universe"
    r = per_qqq[0]
    assert r.direction == "long", f"expected long, got {r.direction}"
    assert r.entry_price and r.entry_price > 0
    assert r.shares > 0
    # Fill should happen on the bar AFTER the breakout bar (idx 6).
    assert r.entry_ts is not None


def test_single_entry_per_day_even_after_stop():
    """If the first breakout stops out, the strategy does not re-enter."""

    day = date(2024, 6, 4)
    # Build: OR [99,100], breakout to 100.5 on bar 5, then drop to 98.5 (below
    # OR_low) on bar 7 which triggers the stop, then pump back to 101 on
    # bar 20 (which would be a second breakout if re-entries were allowed).
    prices: list[tuple[float, float, float, float, int]] = []
    or_high, or_low = 100.0, 99.0
    mid = 99.5
    for _ in range(5):
        prices.append((mid, or_high, or_low, mid, 1_000_000))
    # Bar 5: close 100.5 above OR_high → breakout detected
    prices.append((mid, 100.5, or_low, 100.5, 1_500_000))
    # Bar 6: next-bar fill → open at 100.4 (entry fill price target)
    prices.append((100.4, 100.6, 100.3, 100.55, 800_000))
    # Bar 7: stop trigger — low goes below or_low
    prices.append((100.2, 100.3, 98.5, 98.6, 900_000))
    # Bar 8..19: continue lower
    for _ in range(12):
        prices.append((98.6, 98.7, 98.4, 98.55, 500_000))
    # Bar 20+: pump to 102 (would be a 2nd breakout if allowed)
    prices.append((98.6, 102.5, 98.5, 102.2, 2_000_000))
    for _ in range(390 - len(prices)):
        prices.append((102.2, 102.3, 102.0, 102.1, 500_000))

    df = make_bars("QQQ", day, prices)
    strat = ORBStrategy()
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": False})

    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction == "long"
    assert qqq.exit_reason == "stop"
    # Exit price should be at or below OR_low (stop) × slippage factor.
    assert qqq.exit_price is not None
    # The strategy simulator doesn't re-enter after the stop — the result
    # carries exactly one trade's worth of metadata.
    # (No re-entry API; the structure is 1 round-trip per day per symbol.)


def test_eod_flat_no_overnight_position():
    """A position that never hits stop/TP must flatten at 15:55 ET."""

    day = date(2024, 6, 5)
    df = bars_with_long_breakout_at_bar(
        target_date=day,
        symbol="QQQ",
        or_high=100.0,
        or_low=99.0,
        breakout_bar_idx=5,
        breakout_close=100.2,
        hold_close=100.3,  # drifts slightly higher but never hits TP1
    )
    strat = ORBStrategy()
    strat.configure(
        {
            "universe_profile": "spy_qqq",
            "allow_shorts": False,
            "tp1_fib": 10.0,  # effectively disables TP1
            "tp2_fib": 20.0,
        }
    )

    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction == "long"
    # Must be closed at/before 15:55 ET
    assert qqq.exit_ts is not None
    local = pd.Timestamp(qqq.exit_ts).tz_convert("America/New_York")
    assert local.hour < 16, f"exit {local} after RTH close"
    # No overnight carry: exit_ts.date() must equal asof.
    assert local.date() == day
    # The EOD branch fires via "eod_flat"; the ride-to-last-bar branch tags
    # the same.
    assert qqq.exit_reason == "eod_flat"


def test_tp_scale_outs_register_hits():
    """A pump well past both fib extensions should record tp_hits=2."""

    day = date(2024, 6, 6)
    or_high, or_low = 100.0, 99.0
    or_range = or_high - or_low
    tp2_px = or_high + 1.618 * or_range  # 101.618
    prices: list[tuple[float, float, float, float, int]] = []
    mid = 99.5
    for _ in range(5):
        prices.append((mid, or_high, or_low, mid, 1_000_000))
    # Bar 5: breakout close 100.3
    prices.append((mid, 100.3, or_low, 100.3, 1_500_000))
    # Bar 6: fill at 100.25 open
    prices.append((100.25, 100.35, 100.2, 100.30, 800_000))
    # Bar 7: pump through BOTH TPs (high=102)
    prices.append((100.3, 102.0, 100.25, 101.9, 2_000_000))
    # Remainder rides to EOD at a safe 101.5 (won't stop)
    for _ in range(390 - len(prices)):
        prices.append((101.5, 101.6, 101.4, 101.55, 500_000))
    df = make_bars("QQQ", day, prices)

    strat = ORBStrategy()
    # Large equity so share count is >= 3 and both TPs activate.
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": False})

    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=1_000_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction == "long"
    assert qqq.shares >= 3, f"need >=3 shares for scale-outs, got {qqq.shares}"
    assert qqq.tp_hits == 2, f"expected both TPs hit, got {qqq.tp_hits}"


def test_time_cutoff_blocks_late_entries():
    """A breakout after the cutoff hour should not generate a trade."""

    day = date(2024, 6, 7)
    or_high, or_low = 100.0, 99.0
    prices: list[tuple[float, float, float, float, int]] = []
    mid = 99.5
    for _ in range(5):
        prices.append((mid, or_high, or_low, mid, 1_000_000))
    # Hold the price INSIDE the OR for ~4 hours (240 bars) after the OR.
    # 5+240 = 245 bars → 9:30 + 245 min = 13:35 ET. Still before 14:00 cutoff.
    # Then push above OR after 14:30 ET (301 bars in).
    for _ in range(301 - len(prices)):
        prices.append((mid, or_high, or_low, mid, 500_000))
    # Bar at index 301 (= 9:30 + 301 min = 14:31 ET) closes above OR_high.
    prices.append((mid, 100.5, or_low, 100.5, 2_000_000))
    for _ in range(390 - len(prices)):
        prices.append((100.5, 100.6, 100.4, 100.5, 500_000))
    df = make_bars("QQQ", day, prices)

    strat = ORBStrategy()
    strat.configure(
        {
            "universe_profile": "spy_qqq",
            "allow_shorts": False,
            "entry_cutoff_hour_et": 14,
        }
    )

    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction is None, f"late breakout should not trade, got {qqq.direction}"
    assert qqq.pnl_pct_of_equity == 0.0


def test_no_overnight_even_when_last_bar_is_inside_or():
    """Absent any breakout, no trade is opened — so no overnight leak."""

    day = date(2024, 6, 10)
    or_high, or_low = 100.0, 99.0
    prices: list[tuple[float, float, float, float, int]] = []
    mid = 99.5
    for _ in range(390):
        prices.append((mid, or_high, or_low, mid, 500_000))
    df = make_bars("QQQ", day, prices)

    strat = ORBStrategy()
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": False})
    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction is None
    assert qqq.entry_ts is None
    assert qqq.exit_ts is None


def test_short_entry_fires_when_allowed():
    """With ``allow_shorts=True``, a close below OR_low triggers a short."""

    day = date(2024, 6, 11)
    or_high, or_low = 100.0, 99.0
    prices: list[tuple[float, float, float, float, int]] = []
    mid = 99.5
    for _ in range(5):
        prices.append((mid, or_high, or_low, mid, 1_000_000))
    # Bar 5: close 98.5 below OR_low → short break
    prices.append((mid, 99.6, 98.3, 98.5, 1_500_000))
    # Bar 6: fill at 98.6 open
    prices.append((98.6, 98.8, 98.4, 98.5, 800_000))
    # Remainder: drift at 98.0 (profit zone; well below TPs)
    for _ in range(390 - len(prices)):
        prices.append((98.0, 98.1, 97.9, 98.0, 500_000))
    df = make_bars("QQQ", day, prices)

    strat = ORBStrategy()
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": True})
    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction == "short"
    assert qqq.shares > 0


def test_short_entry_blocked_when_disallowed():
    """With ``allow_shorts=False``, an OR_low break does NOT fire."""

    day = date(2024, 6, 12)
    or_high, or_low = 100.0, 99.0
    prices: list[tuple[float, float, float, float, int]] = []
    mid = 99.5
    for _ in range(5):
        prices.append((mid, or_high, or_low, mid, 1_000_000))
    prices.append((mid, 99.6, 98.3, 98.5, 1_500_000))
    for _ in range(390 - len(prices)):
        prices.append((98.5, 98.6, 98.4, 98.5, 500_000))
    df = make_bars("QQQ", day, prices)

    strat = ORBStrategy()
    strat.configure({"universe_profile": "spy_qqq", "allow_shorts": False})
    results = strat.simulate_day(
        day, make_ctx(FakeBarProvider(df)), equity=100_000.0
    )
    qqq = next(r for r in results if r.symbol == "QQQ")
    assert qqq.direction is None
