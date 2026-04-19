"""Unit tests for the Earnings Volatility short-iron-butterfly strategy.

Covers the 6 testable pieces called out in the spec:

1. Implied-move computation from an ATM straddle mid.
2. Historical-move computation from daily bars + past surprise dates.
3. Butterfly leg selection (body = ATM, wings = ±N × implied move).
4. Signal shape: 4 legs, SELL body, BUY wings, correct sign on quantity.
5. Next-open exit emits a 4-leg closing signal after earnings.
6. ``after_close_only`` filter skips non-after-close events.

All tests stub the data providers; no network. We exercise the real
``EarningsVolStrategy`` end-to-end through the protocol.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable, Mapping

import pandas as pd
import pytest

from backtest.types import (
    AssetClass,
    Context,
    OrderType,
    Position,
    Side,
)
from strategies.earnings_vol.config import UNIVERSE
from strategies.earnings_vol.strategy import (
    EarningsVolStrategy,
    _classify_earnings_time,
    _pick_leg_strikes,
    _straddle_mid,
)


# ----------------------------------------------------------------------------
# Fakes
# ----------------------------------------------------------------------------
@dataclass
class FakeBars:
    frames: dict[str, pd.DataFrame]

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = list(symbols) if not isinstance(symbols, str) else [symbols]
        out = []
        start_d = pd.Timestamp(start).normalize()
        end_d = pd.Timestamp(end).normalize() + pd.Timedelta(hours=23, minutes=59)
        for s in syms:
            df = self.frames.get(str(s).upper())
            if df is None:
                continue
            m = (pd.to_datetime(df["ts"]) >= start_d) & (
                pd.to_datetime(df["ts"]) <= end_d
            )
            sub = df.loc[m]
            if not sub.empty:
                out.append(sub)
        if not out:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(out, ignore_index=True)


@dataclass
class FakeEarnings:
    calendar_df: pd.DataFrame
    surprises_df: pd.DataFrame

    def calendar(self, start, end, symbols=None) -> pd.DataFrame:
        df = self.calendar_df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.date
        m = (df["date"] >= pd.Timestamp(start).date()) & (
            df["date"] <= pd.Timestamp(end).date()
        )
        return df[m].reset_index(drop=True)

    def surprises(self, symbol, start, end) -> pd.DataFrame:
        df = self.surprises_df.copy()
        df = df[df["symbol"].astype(str).str.upper() == symbol.upper()]
        df["date"] = pd.to_datetime(df["date"]).dt.date
        m = (df["date"] >= pd.Timestamp(start).date()) & (
            df["date"] <= pd.Timestamp(end).date()
        )
        return df[m].reset_index(drop=True)

    def consensus(self, symbol, asof):  # pragma: no cover
        return {"symbol": symbol.upper()}


@dataclass
class FakeOptions:
    chain: pd.DataFrame

    def chain_snapshot(self, underlying, asof) -> pd.DataFrame:
        df = self.chain.copy()
        df = df[df["underlying"].astype(str).str.upper() == underlying.upper()]
        return df.reset_index(drop=True)

    def contract_bars(self, *a, **kw):  # pragma: no cover
        return pd.DataFrame()

    def historical_iv(self, *a, **kw):  # pragma: no cover
        return pd.DataFrame()


def _mk_daily_bars(symbol: str, days: list[date], closes: list[float]) -> pd.DataFrame:
    assert len(days) == len(closes)
    return pd.DataFrame(
        {
            "symbol": [symbol] * len(days),
            "ts": [pd.Timestamp(d) for d in days],
            "open": closes,
            "high": closes,
            "low": closes,
            "close": closes,
            "volume": [1_000_000] * len(days),
        }
    )


def _mk_chain(
    underlying: str,
    expiration: date,
    strikes: list[float],
    spot: float,
    iv: float,
    asof: date | None = None,
) -> pd.DataFrame:
    """Hand-rolled chain with bid/ask filled from a simple BS model for
    shape; we only need bid+ask+strike+option_type+expiration+contract_ticker
    to exercise the strategy.
    """
    import numpy as np

    anchor = asof or date.today()
    tau = max(1.0 / 365, (expiration - anchor).days / 365.0)
    rows = []
    for k in strikes:
        # Simple BS-like prices without using the shared helper so the
        # test is self-contained. We only need mid prices in the right
        # magnitudes; the strategy inverts IV from these itself.
        d1 = (
            (np.log(spot / k) + 0.5 * iv * iv * tau)
            / (iv * np.sqrt(max(tau, 1e-6)))
        )
        d2 = d1 - iv * np.sqrt(max(tau, 1e-6))
        from scipy.stats import norm

        call = max(spot * norm.cdf(d1) - k * norm.cdf(d2), 0.01)
        put = max(k * norm.cdf(-d2) - spot * norm.cdf(-d1), 0.01)

        for right, mid in (("call", call), ("put", put)):
            rows.append(
                {
                    "contract_ticker": f"O:{underlying}{expiration.strftime('%y%m%d')}"
                    f"{right[0].upper()}{int(round(k * 1000)):08d}",
                    "underlying": underlying,
                    "expiration": expiration,
                    "strike": float(k),
                    "option_type": right,
                    "bid": max(mid - 0.02, 0.01),
                    "ask": mid + 0.02,
                    "last": mid,
                    "volume": 1000,
                    "open_interest": 5000,
                    "iv": iv,
                    "delta": None, "gamma": None, "theta": None,
                    "vega": None, "rho": None, "asof": date.today(),
                }
            )
    return pd.DataFrame(rows)


def _context(
    asof: date,
    bars_frames: dict[str, pd.DataFrame],
    chain: pd.DataFrame,
    calendar_df: pd.DataFrame,
    surprises_df: pd.DataFrame,
    *,
    equity: float = 100_000,
    positions: Iterable[Position] = (),
) -> Context:
    return Context(
        asof=asof,
        cash=Decimal(str(equity)),
        equity=Decimal(str(equity)),
        positions=list(positions),
        bar_provider=FakeBars(bars_frames),
        options_provider=FakeOptions(chain),
        earnings_provider=FakeEarnings(calendar_df, surprises_df),
    )


# ----------------------------------------------------------------------------
# Unit tests
# ----------------------------------------------------------------------------
def test_straddle_mid_from_chain():
    expiration = date(2024, 5, 3)
    chain = _mk_chain("AAPL", expiration, [180, 185, 190], spot=185, iv=0.25)
    mid = _straddle_mid(chain, expiration, 185)
    assert mid is not None
    assert mid > 0  # call + put both positive


def test_leg_strike_selection_atm_and_wings():
    expiration = date(2024, 5, 3)
    chain = _mk_chain(
        "AAPL", expiration, [170, 175, 180, 185, 190, 195, 200], spot=185, iv=0.25
    )
    # First pass: just find ATM.
    picks = _pick_leg_strikes(chain, expiration, underlying=185.0, wing_width_abs=None)
    assert picks is not None
    assert picks["body_strike"] == 185

    # Second pass: wings at ±7.
    picks = _pick_leg_strikes(chain, expiration, underlying=185.0, wing_width_abs=7.0)
    assert picks is not None
    assert picks["body_strike"] == 185
    assert picks["wing_call_strike"] > 185
    assert picks["wing_put_strike"] < 185
    # Strict ordering.
    assert picks["wing_call_strike"] > picks["body_strike"] > picks["wing_put_strike"]


def test_historical_move_computation_from_fake_bars():
    """Build a bar series with 4 known earnings gaps of 2%, 3%, 4%, 5%.
    Median should be 3.5%.

    The strategy classifies forward AMC events as ``after_close`` and
    measures each historical move as close_{D+1} / close_D - 1 (gap from
    the release-day close to the next session's close). We therefore seed
    each event with a (D, D+1) close pair rather than (D-1, D).
    """
    strat = EarningsVolStrategy()
    strat.configure({"historical_moves_lookback_quarters": 4,
                     "min_historical_events": 3})

    # Build bars: for each earnings date D we need close(D) and close(D+1).
    # We use gaps (next/curr - 1) of 0.02, 0.03, 0.04, 0.05.
    asof = date(2024, 5, 1)
    bars_days: list[date] = []
    bars_closes: list[float] = []

    earnings_events = [
        (date(2023, 5, 4), 0.02),
        (date(2023, 8, 3), 0.03),
        (date(2023, 11, 2), 0.04),
        (date(2024, 2, 1), 0.05),
    ]
    # Fill bars around each event: close_D and close_{D+1}.
    for ev_d, gap in earnings_events:
        curr = ev_d
        while curr.weekday() >= 5:
            curr += timedelta(days=1)
        nxt = curr + timedelta(days=1)
        while nxt.weekday() >= 5:
            nxt += timedelta(days=1)
        bars_days.extend([curr, nxt])
        bars_closes.extend([100.0, 100.0 * (1 + gap)])

    bars_df = _mk_daily_bars("AAPL", bars_days, bars_closes)

    surprises = pd.DataFrame(
        {
            "symbol": ["AAPL"] * 4,
            "date": [d for d, _ in earnings_events],
            "eps_actual": [1.0, 1.0, 1.0, 1.0],
            "eps_estimated": [1.0, 1.0, 1.0, 1.0],
            "surprise": [0.0, 0.0, 0.0, 0.0],
            "surprise_pct": [0.0, 0.0, 0.0, 0.0],
            "sue": [0.0, 0.0, 0.0, 0.0],
            "revenue_actual": [1.0] * 4,
            "revenue_estimated": [1.0] * 4,
        }
    )

    ctx = _context(
        asof=asof,
        bars_frames={"AAPL": bars_df},
        chain=pd.DataFrame(),
        calendar_df=pd.DataFrame(),
        surprises_df=surprises,
    )

    median = strat._historical_earnings_move(ctx, "AAPL", asof)
    assert median is not None
    # Gaps were 2,3,4,5 => median = 3.5%.
    assert abs(median - 0.035) < 1e-6


def test_multi_leg_signal_shape_and_sign():
    """End-to-end: a candidate in the universe with a rich event should
    produce one 4-leg Signal with the correct sides and a negative quantity
    (short spreads)."""

    strat = EarningsVolStrategy()
    strat.configure({"implied_vs_historical_min_ratio": 1.0,
                     "max_concurrent_positions": 3,
                     "min_historical_events": 3})

    asof = date(2024, 5, 1)           # T-1 close
    tomorrow = asof + timedelta(days=1)
    expiration = date(2024, 5, 10)    # ~9 DTE
    spot = 185.0

    # Earnings event tomorrow, AMC.
    calendar = pd.DataFrame(
        {
            "symbol": ["AAPL"],
            "date": [tomorrow],
            "eps_actual": [None],
            "eps_estimated": [1.5],
            "revenue_actual": [None],
            "revenue_estimated": [1e9],
            "last_updated": [asof],
            "time": ["amc"],
        }
    )

    # Historical earnings with modest moves so implied looks rich.
    past = [
        date(2023, 5, 4), date(2023, 8, 3),
        date(2023, 11, 2), date(2024, 2, 1),
    ]
    # Each gap = 1% => median 1%; implied (straddle/spot) ~3% => ratio 3 > 1.0
    bars_days, bars_closes = [], []
    for d in past:
        pre = d - timedelta(days=1)
        while pre.weekday() >= 5:
            pre -= timedelta(days=1)
        post = d
        while post.weekday() >= 5:
            post += timedelta(days=1)
        bars_days.extend([pre, post])
        bars_closes.extend([spot, spot * 1.01])
    # Also add the close at asof so _last_close works.
    bars_days.append(asof)
    bars_closes.append(spot)
    bars_df = _mk_daily_bars("AAPL", bars_days, bars_closes)

    surprises = pd.DataFrame(
        {
            "symbol": ["AAPL"] * 4,
            "date": past,
            "eps_actual": [1.0] * 4,
            "eps_estimated": [1.0] * 4,
            "surprise": [0.0] * 4,
            "surprise_pct": [0.0] * 4,
            "sue": [0.0] * 4,
            "revenue_actual": [1.0] * 4,
            "revenue_estimated": [1.0] * 4,
        }
    )

    chain = _mk_chain(
        "AAPL", expiration,
        [170, 175, 180, 185, 190, 195, 200, 205], spot=spot, iv=0.60,
        asof=asof,
    )

    ctx = _context(
        asof=asof,
        bars_frames={"AAPL": bars_df},
        chain=chain,
        calendar_df=calendar,
        surprises_df=surprises,
    )

    # Strategy protocol requires universe() to be called first (which
    # pre-scores candidates) before generate_signals consumes them.
    list(strat.universe(asof, ctx))
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) == 1, f"expected 1 Signal, got {len(sigs)}: {sigs}"
    sig = sigs[0]
    # The Signal is keyed by the real underlying; the engine's multi-leg
    # fill path prices each leg from options_provider.contract_bars.
    assert sig.symbol == "AAPL", sig.symbol
    assert sig.legs and len(sig.legs) == 4
    # Two SELL body + two BUY wing legs.
    body = [l for l in sig.legs if l.side is Side.SELL]
    wings = [l for l in sig.legs if l.side is Side.BUY]
    assert len(body) == 2 and len(wings) == 2
    rights = {l.right for l in sig.legs}
    assert rights == {"C", "P"}
    assert sig.order_type is OrderType.MOC
    assert sig.quantity is not None and sig.quantity < 0, "short spreads = negative qty"

    # Body strikes match across call + put.
    body_strikes = {float(l.strike) for l in body}
    assert len(body_strikes) == 1
    body_k = next(iter(body_strikes))
    # ATM body near spot.
    assert abs(body_k - spot) <= 5

    # Wings: one strike above body, one below.
    wing_strikes = [float(l.strike) for l in wings]
    assert max(wing_strikes) > body_k > min(wing_strikes)


def test_next_open_exit_emits_four_leg_close():
    """After entering, ``manage()`` should emit a 4-leg closing signal on
    the exit session.
    """
    strat = EarningsVolStrategy()
    strat.configure({"implied_vs_historical_min_ratio": 1.0,
                     "min_historical_events": 3})

    asof = date(2024, 5, 1)
    tomorrow = asof + timedelta(days=1)
    expiration = date(2024, 5, 10)
    spot = 185.0

    calendar = pd.DataFrame(
        {
            "symbol": ["AAPL"],
            "date": [tomorrow],
            "eps_actual": [None], "eps_estimated": [1.5],
            "revenue_actual": [None], "revenue_estimated": [1e9],
            "last_updated": [asof], "time": ["amc"],
        }
    )
    past = [date(2023, 5, 4), date(2023, 8, 3),
            date(2023, 11, 2), date(2024, 2, 1)]
    bars_days, bars_closes = [], []
    for d in past:
        pre = d - timedelta(days=1)
        while pre.weekday() >= 5:
            pre -= timedelta(days=1)
        post = d
        while post.weekday() >= 5:
            post += timedelta(days=1)
        bars_days.extend([pre, post])
        bars_closes.extend([spot, spot * 1.01])
    bars_days.append(asof)
    bars_closes.append(spot)
    bars_days.append(tomorrow)
    bars_closes.append(spot * 0.99)     # a small post-event move
    bars_df = _mk_daily_bars("AAPL", bars_days, bars_closes)
    surprises = pd.DataFrame(
        {
            "symbol": ["AAPL"] * 4,
            "date": past,
            "eps_actual": [1.0] * 4,
            "eps_estimated": [1.0] * 4,
            "surprise": [0.0] * 4,
            "surprise_pct": [0.0] * 4,
            "sue": [0.0] * 4,
            "revenue_actual": [1.0] * 4,
            "revenue_estimated": [1.0] * 4,
        }
    )
    chain = _mk_chain(
        "AAPL", expiration,
        [170, 175, 180, 185, 190, 195, 200, 205], spot=spot, iv=0.60,
        asof=asof,
    )

    ctx = _context(
        asof=asof,
        bars_frames={"AAPL": bars_df},
        chain=chain,
        calendar_df=calendar,
        surprises_df=surprises,
    )

    list(strat.universe(asof, ctx))
    entry_sigs = list(strat.generate_signals(asof, ctx))
    assert entry_sigs, "no entry emitted — pre-condition for exit test"

    # Now advance to the exit session. The strategy stashed the pending
    # trade on ctx.state; manage() should emit a closing signal at MOO.
    # Simulate the engine having booked the entry fill: add an OPTION
    # leg Position per leg so manage()'s retirement logic doesn't strip
    # out the pending trade before the exit fires.
    entry_sig = entry_sigs[0]
    leg_positions = [
        Position(
            symbol=leg.contract_id,
            quantity=-abs(entry_sig.quantity) * leg.qty if leg.side is Side.SELL
            else +abs(entry_sig.quantity) * leg.qty,
            avg_price=Decimal("1"),
            asset_class=AssetClass.OPTION,
            multiplier=leg.multiplier,
            underlying=leg.underlying,
            expiry=leg.expiry,
            strike=leg.strike,
            right=leg.right,
        )
        for leg in entry_sig.legs
    ]
    ctx.positions = leg_positions
    ctx.asof = tomorrow
    exit_sigs = list(strat.manage(tomorrow, ctx))
    assert len(exit_sigs) == 1
    esig = exit_sigs[0]
    assert esig.symbol == "AAPL", esig.symbol
    assert len(esig.legs) == 4
    assert esig.order_type is OrderType.MOO
    # Closing legs are flipped vs the entry.
    sides = [l.side for l in esig.legs]
    assert Side.BUY in sides and Side.SELL in sides


def test_after_close_only_filter_skips_before_open_and_unknown():
    """When ``earnings_timing_filter == 'after_close_only'`` the strategy
    ignores events marked BMO or during-hours; unknown defaults to
    after_close per :func:`_classify_earnings_time`.
    """
    assert _classify_earnings_time({"time": "amc"}) == "after_close"
    assert _classify_earnings_time({"time": "bmo"}) == "before_open"
    assert _classify_earnings_time({"time": "dmh"}) == "during_hours"
    # Unknown or missing => defaults to after_close (conservative).
    assert _classify_earnings_time({}) == "after_close"

    strat = EarningsVolStrategy()
    strat.configure({"earnings_timing_filter": "after_close_only",
                     "implied_vs_historical_min_ratio": 1.0,
                     "min_historical_events": 3})

    asof = date(2024, 5, 1)
    tomorrow = asof + timedelta(days=1)
    expiration = date(2024, 5, 10)
    spot = 185.0

    calendar = pd.DataFrame(
        {
            "symbol": ["AAPL"],
            "date": [tomorrow],
            "eps_actual": [None], "eps_estimated": [1.5],
            "revenue_actual": [None], "revenue_estimated": [1e9],
            "last_updated": [asof], "time": ["bmo"],   # <- before-open
        }
    )
    past = [date(2023, 5, 4), date(2023, 8, 3),
            date(2023, 11, 2), date(2024, 2, 1)]
    bars_days, bars_closes = [], []
    for d in past:
        pre = d - timedelta(days=1)
        while pre.weekday() >= 5:
            pre -= timedelta(days=1)
        post = d
        while post.weekday() >= 5:
            post += timedelta(days=1)
        bars_days.extend([pre, post])
        bars_closes.extend([spot, spot * 1.01])
    bars_days.append(asof)
    bars_closes.append(spot)
    bars_df = _mk_daily_bars("AAPL", bars_days, bars_closes)
    surprises = pd.DataFrame(
        {
            "symbol": ["AAPL"] * 4,
            "date": past,
            "eps_actual": [1.0] * 4,
            "eps_estimated": [1.0] * 4,
            "surprise": [0.0] * 4,
            "surprise_pct": [0.0] * 4,
            "sue": [0.0] * 4,
            "revenue_actual": [1.0] * 4,
            "revenue_estimated": [1.0] * 4,
        }
    )
    chain = _mk_chain(
        "AAPL", expiration,
        [170, 175, 180, 185, 190, 195, 200, 205], spot=spot, iv=0.60,
        asof=asof,
    )

    ctx = _context(
        asof=asof,
        bars_frames={"AAPL": bars_df},
        chain=chain,
        calendar_df=calendar,
        surprises_df=surprises,
    )

    list(strat.universe(asof, ctx))
    sigs = list(strat.generate_signals(asof, ctx))
    assert sigs == [], "BMO event must be skipped when after_close_only"

    # Relaxing the filter allows the event through.
    strat.configure({"earnings_timing_filter": "any",
                     "implied_vs_historical_min_ratio": 1.0,
                     "min_historical_events": 3})
    list(strat.universe(asof, ctx))
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) == 1


def test_implied_move_computed_from_atm_straddle():
    """Verify that _score_candidate computes implied_move as
    straddle_mid / underlying."""

    strat = EarningsVolStrategy()
    strat.configure({"implied_vs_historical_min_ratio": 1.0,
                     "min_historical_events": 3})

    asof = date(2024, 5, 1)
    tomorrow = asof + timedelta(days=1)
    expiration = date(2024, 5, 10)
    spot = 100.0  # round numbers to make arithmetic transparent
    iv = 0.60

    past = [date(2023, 5, 4), date(2023, 8, 3),
            date(2023, 11, 2), date(2024, 2, 1)]
    bars_days, bars_closes = [], []
    for d in past:
        pre = d - timedelta(days=1)
        while pre.weekday() >= 5:
            pre -= timedelta(days=1)
        post = d
        while post.weekday() >= 5:
            post += timedelta(days=1)
        bars_days.extend([pre, post])
        bars_closes.extend([spot, spot * 1.005])   # 0.5% moves
    bars_days.append(asof)
    bars_closes.append(spot)
    bars_df = _mk_daily_bars("AAPL", bars_days, bars_closes)

    calendar = pd.DataFrame(
        {"symbol": ["AAPL"], "date": [tomorrow], "eps_estimated": [1.0],
         "eps_actual": [None], "revenue_actual": [None],
         "revenue_estimated": [1e9], "last_updated": [asof], "time": ["amc"]}
    )
    surprises = pd.DataFrame(
        {
            "symbol": ["AAPL"] * 4, "date": past,
            "eps_actual": [1.0] * 4, "eps_estimated": [1.0] * 4,
            "surprise": [0.0] * 4, "surprise_pct": [0.0] * 4,
            "sue": [0.0] * 4, "revenue_actual": [1.0] * 4,
            "revenue_estimated": [1.0] * 4,
        }
    )
    chain = _mk_chain(
        "AAPL", expiration,
        [80, 90, 95, 100, 105, 110, 120], spot=spot, iv=iv,
        asof=asof,
    )

    ctx = _context(
        asof=asof,
        bars_frames={"AAPL": bars_df},
        chain=chain,
        calendar_df=calendar,
        surprises_df=surprises,
    )

    # The scorer returns the richness ratio we can inspect.
    event = {"symbol": "AAPL", "time": "amc", "date": tomorrow}
    plan = strat._score_candidate(ctx, asof, "AAPL", event)
    assert plan is not None
    # Implied move should roughly match the straddle mid / spot.
    straddle = _straddle_mid(chain, expiration, 100.0)
    expected = float(straddle) / spot
    assert abs(plan["implied_move_abs"] / spot - expected) < 1e-6


def test_universe_contains_expected_names():
    assert "AAPL" in UNIVERSE
    assert "NVDA" in UNIVERSE
    assert "META" in UNIVERSE
    assert "UBER" in UNIVERSE
    # ~30 names by design to keep Polygon options-chain bandwidth manageable.
    assert 25 <= len(UNIVERSE) <= 35
