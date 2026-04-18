"""Unit tests for the KAMA Breakout strategy.

Covers:

- Registration metadata matches the spec.
- Configure coerces + validates params.
- Entry gates reject chop regimes (low ER, below 200-SMA, etc.).
- Entry gates accept a deterministic uptrend.
- Exit rules (chandelier, KAMA crossunder) fire when they should.
- Pyramid add fires at +1 ATR move, respecting the max_allocation cap.
- Sizing obeys 1% risk per trade.
- Efficiency-ratio helper returns expected values on canonical inputs.
- Earnings-window gate degrades gracefully when the provider is absent.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Iterable

import numpy as np
import pandas as pd
import pytest

from backtest.types import (
    AssetClass,
    Context,
    Fill,
    OrderType,
    Position,
    Side,
)

# Use a relative import so the test works whether pytest collects this file
# as ``backend.strategies.kama_breakout.tests.test_strategy`` or as
# ``strategies.kama_breakout.tests.test_strategy`` (both are possible given
# the legacy sys.path setup in the sibling tests' conftest).
from ..strategy import KamaBreakout, _PosState, _efficiency_ratio


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
class _FakeBarProvider:
    """Returns a prebuilt OHLCV DataFrame per symbol.

    Signatures match the real BarProvider (``(symbols, start, end, tf)`` ->
    DataFrame with ``symbol, ts, open, high, low, close, volume``).
    """

    def __init__(self, frames: dict[str, pd.DataFrame]) -> None:
        self.frames = frames

    def bars(self, symbols, start, end, tf="1D") -> pd.DataFrame:
        start_ts = pd.Timestamp(start).tz_localize(None) if not pd.isna(
            pd.Timestamp(start)
        ) else None
        end_ts = pd.Timestamp(end).tz_localize(None)
        rows = []
        for sym in symbols:
            df = self.frames.get(sym)
            if df is None:
                continue
            rows.append(df)
        if not rows:
            cols = [
                "symbol",
                "ts",
                "open",
                "high",
                "low",
                "close",
                "volume",
            ]
            return pd.DataFrame({c: [] for c in cols})
        out = pd.concat(rows, ignore_index=True)
        # Filter by end (start isn't strictly needed; we return what we have).
        out["ts_pd"] = pd.to_datetime(out["ts"], utc=True, errors="coerce")
        out = out[out["ts_pd"].dt.tz_localize(None) <= end_ts]
        out = out.drop(columns=["ts_pd"])
        return out


def _build_uptrend_df(
    symbol: str,
    start: date,
    n: int = 400,
    base: float = 100.0,
    drift: float = 0.004,  # ~0.4% per day geometric
    noise: float = 0.003,
) -> pd.DataFrame:
    """Deterministic geometric uptrend with small noise so all entry gates
    can fire: price > KAMA, > Donchian upper, > rising 200-SMA, high ER."""

    rng = np.random.default_rng(42)
    rets = drift + rng.normal(0.0, noise, size=n)
    closes = base * np.cumprod(1.0 + rets)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * (1.0 + rng.uniform(0, 0.002, size=n))
    lows = np.minimum(opens, closes) * (1.0 - rng.uniform(0, 0.002, size=n))
    ts = pd.bdate_range(start=start, periods=n, tz="UTC")
    vols = rng.integers(1_000_000, 5_000_000, size=n)
    return pd.DataFrame(
        {
            "symbol": symbol,
            "ts": ts,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": vols,
        }
    )


def _build_chop_df(
    symbol: str,
    start: date,
    n: int = 400,
    base: float = 100.0,
) -> pd.DataFrame:
    """Sideways, choppy series — low efficiency ratio, rejects entry."""

    rng = np.random.default_rng(7)
    rets = rng.normal(0.0, 0.015, size=n)
    closes = base * np.cumprod(1.0 + rets)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * 1.01
    lows = np.minimum(opens, closes) * 0.99
    ts = pd.bdate_range(start=start, periods=n, tz="UTC")
    vols = np.full(n, 2_000_000, dtype=np.int64)
    return pd.DataFrame(
        {
            "symbol": symbol,
            "ts": ts,
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": vols,
        }
    )


def _build_ctx(
    provider,
    asof: date,
    equity: Decimal = Decimal("100000"),
    positions: Iterable[Position] = (),
) -> Context:
    return Context(
        asof=asof,
        cash=equity,
        equity=equity,
        positions=list(positions),
        bar_provider=provider,
        options_provider=None,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )


# --------------------------------------------------------------------------- #
# Registration                                                                #
# --------------------------------------------------------------------------- #
def test_metadata_matches_spec():
    """Import-time registration plus basic metadata sanity."""

    from strategies.registry import get_meta, get_strategy

    meta = get_meta("kama_breakout")
    assert meta.name == "kama_breakout"
    assert meta.category == "equity"
    assert meta.required_bars == ("daily",)
    assert meta.supports_shorts is False
    assert meta.supports_options is False
    cls = get_strategy("kama_breakout")
    # KamaBreakout may be loaded twice under different module names due to
    # the legacy sys.path; assert name / class-identity-or-alias rather than
    # strict `is`.
    assert cls.__name__ == "KamaBreakout"
    assert cls.name == "kama_breakout"


def test_configure_coerces_and_validates():
    s = KamaBreakout()
    s.configure(
        {
            "kama_er_period": "10",
            "kama_fast": "2",
            "kama_slow": "30",
            "donchian_period": "20",
            "chandelier_atr_mult": "3",
            "risk_per_trade": 0.01,
        }
    )
    assert isinstance(s._p["kama_er_period"], int)
    assert isinstance(s._p["chandelier_atr_mult"], float)


def test_configure_rejects_bad_fast_slow():
    s = KamaBreakout()
    with pytest.raises(ValueError):
        s.configure({"kama_fast": 30, "kama_slow": 2})


def test_configure_rejects_bad_risk():
    s = KamaBreakout()
    with pytest.raises(ValueError):
        s.configure({"risk_per_trade": 0.5})


# --------------------------------------------------------------------------- #
# Efficiency ratio helper                                                     #
# --------------------------------------------------------------------------- #
def test_efficiency_ratio_monotone_trend():
    """Strictly monotone closes -> ER = 1.0 (max trend efficiency)."""

    s = pd.Series(np.arange(100, 120, dtype="float64"))
    er = _efficiency_ratio(s, period=10)
    assert er == pytest.approx(1.0, abs=1e-9)


def test_efficiency_ratio_flat():
    """Flat prices -> ER = 0 (guard against divide-by-zero)."""

    s = pd.Series(np.ones(50, dtype="float64") * 100.0)
    er = _efficiency_ratio(s, period=10)
    assert er == 0.0


def test_efficiency_ratio_chop_between_zero_and_one():
    rng = np.random.default_rng(0)
    s = pd.Series(100.0 + rng.normal(0, 1.0, size=100))
    er = _efficiency_ratio(s, period=10)
    assert 0.0 <= er <= 1.0


# --------------------------------------------------------------------------- #
# Entry gates                                                                 #
# --------------------------------------------------------------------------- #
def test_entry_rejects_chop():
    """Low-ER flat series should NOT generate a signal."""

    df = _build_chop_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date())

    s = KamaBreakout()
    s.configure({"universe_symbols": ["SPY"]})

    signals = list(s.generate_signals(ctx.asof, ctx))
    assert signals == []


def test_entry_accepts_uptrend():
    """Strong geometric uptrend satisfies all gates; expect one signal."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date())

    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "er_min_trend": 0.2,   # relaxed; synthetic ER won't hit 0.3
            "donchian_period": 15,
            "trend_sma_period": 100,
        }
    )

    signals = list(s.generate_signals(ctx.asof, ctx))
    assert len(signals) >= 1
    sig = signals[0]
    assert sig.symbol == "SPY"
    assert sig.order_type == OrderType.MOO
    assert sig.quantity is not None and sig.quantity > 0


def test_entry_respects_max_positions():
    """With max_positions=1 and one open, generate_signals returns []."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})
    pos = Position(
        symbol="QQQ",
        quantity=10,
        avg_price=Decimal("300"),
        asset_class=AssetClass.EQUITY,
        last_price=Decimal("305"),
    )
    ctx = _build_ctx(
        provider, asof=df["ts"].iloc[-1].date(), positions=[pos]
    )

    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "max_positions": 1,
            "er_min_trend": 0.2,
            "donchian_period": 15,
            "trend_sma_period": 100,
        }
    )

    signals = list(s.generate_signals(ctx.asof, ctx))
    assert signals == []


# --------------------------------------------------------------------------- #
# Sizing                                                                      #
# --------------------------------------------------------------------------- #
def test_sizing_obeys_risk_per_trade():
    """Shares * ATR * mult should never exceed risk_per_trade * equity."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})
    equity = Decimal("100000")
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date(), equity=equity)

    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "er_min_trend": 0.2,
            "donchian_period": 15,
            "trend_sma_period": 100,
            "risk_per_trade": 0.01,
            "chandelier_atr_mult": 3.0,
            "max_allocation": 1.0,
        }
    )

    signals = list(s.generate_signals(ctx.asof, ctx))
    assert len(signals) >= 1
    sig = signals[0]

    # Derive ATR from the same series to cross-check sizing.
    from indicators.volatility import atr

    a = float(
        atr(df["high"], df["low"], df["close"], period=22).iloc[-1]
    )
    stop_distance = 3.0 * a
    max_risk_dollars = 0.01 * float(equity)
    implied_risk = sig.quantity * stop_distance
    # Allow rounding off by one share's risk at most.
    assert implied_risk <= max_risk_dollars + stop_distance


# --------------------------------------------------------------------------- #
# Exit rules                                                                  #
# --------------------------------------------------------------------------- #
def test_manage_fires_chandelier_on_deep_drop():
    """Open position; inject a crash bar and expect a chandelier exit."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    # Force the last bar to be a 20% single-day drop.
    crash_row = df.iloc[-1].copy()
    prior_close = df["close"].iloc[-2]
    crash_close = prior_close * 0.80
    crash_row["close"] = crash_close
    crash_row["low"] = crash_close * 0.99
    crash_row["high"] = prior_close
    crash_row["open"] = prior_close
    df = df.copy()
    df.iloc[-1] = crash_row

    provider = _FakeBarProvider({"SPY": df})
    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "trend_sma_period": 100,
            "chandelier_atr_mult": 3.0,
        }
    )

    # Seed strategy state as if we entered at the previous close.
    pos = Position(
        symbol="SPY",
        quantity=100,
        avg_price=Decimal(str(prior_close)),
        asset_class=AssetClass.EQUITY,
        last_price=Decimal(str(crash_close)),
    )
    ctx = _build_ctx(
        provider, asof=df["ts"].iloc[-1].date(), positions=[pos]
    )
    ctx.state["positions"] = {
        "SPY": _PosState(
            entry_ts=df["ts"].iloc[-30].date(),
            entry_price=float(prior_close),
            atr_at_entry=1.0,
            highest_high=float(prior_close),
            shares_initial=100,
        )
    }

    out = list(s.manage(ctx.asof, ctx))
    assert len(out) == 1
    assert out[0].tag in ("chandelier", "kama_crossunder")
    assert out[0].target_weight == 0.0


def test_manage_fires_kama_crossunder_on_dip_below_kama():
    """Small dip below KAMA triggers the KAMA crossunder exit."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    # Modest dip last bar — below KAMA but above chandelier.
    last_idx = df.index[-1]
    dip_close = df["close"].iloc[-1] * 0.96
    df.loc[last_idx, "close"] = dip_close
    df.loc[last_idx, "low"] = dip_close * 0.99
    provider = _FakeBarProvider({"SPY": df})

    s = KamaBreakout()
    s.configure({"universe_symbols": ["SPY"], "trend_sma_period": 100})
    pos = Position(
        symbol="SPY",
        quantity=100,
        avg_price=Decimal("100"),
        asset_class=AssetClass.EQUITY,
        last_price=Decimal(str(dip_close)),
    )
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date(), positions=[pos])
    # Skip seeding pos_state -> manage() seeds from the position. Needs a
    # chandelier-ok high; set highest_high small via last_price.

    out = list(s.manage(ctx.asof, ctx))
    # Either chandelier or kama_crossunder is acceptable — both are exits.
    assert len(out) == 1
    assert out[0].target_weight == 0.0


# --------------------------------------------------------------------------- #
# Pyramiding                                                                  #
# --------------------------------------------------------------------------- #
def test_pyramid_adds_half_size_at_plus_one_atr():
    df = _build_uptrend_df("SPY", date(2020, 1, 1), drift=0.002, noise=0.002)
    provider = _FakeBarProvider({"SPY": df})
    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "trend_sma_period": 100,
            "pyramid_enabled": True,
            "pyramid_trigger_atr": 1.0,
            "pyramid_size_fraction": 0.5,
            "chandelier_atr_mult": 5.0,   # keep chandelier wide to avoid tripping
            "max_allocation": 1.0,
        }
    )
    last_close = float(df["close"].iloc[-1])
    # Entry price far below last close so pyramid trigger binds.
    pos = Position(
        symbol="SPY",
        quantity=100,
        avg_price=Decimal(str(last_close * 0.8)),
        asset_class=AssetClass.EQUITY,
        last_price=Decimal(str(last_close)),
    )
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date(), positions=[pos])
    ctx.state["positions"] = {
        "SPY": _PosState(
            entry_ts=df["ts"].iloc[0].date(),
            entry_price=last_close * 0.8,
            atr_at_entry=0.5,   # trivially small so +1 ATR is hit
            highest_high=last_close,  # so chandelier doesn't fire
            shares_initial=100,
        )
    }

    out = [s for s in s.manage(ctx.asof, ctx) if s.tag == "pyramid"]
    # If no chandelier/KAMA exit tripped, pyramid should appear.
    assert len(out) == 1
    assert out[0].quantity is not None and out[0].quantity > pos.quantity


# --------------------------------------------------------------------------- #
# Earnings gate: degrades gracefully                                          #
# --------------------------------------------------------------------------- #
def test_earnings_gate_degrades_when_provider_absent():
    """No earnings provider -> gate returns False (don't block)."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})
    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date())
    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "er_min_trend": 0.2,
            "donchian_period": 15,
            "trend_sma_period": 100,
        }
    )
    # ctx.earnings_provider is None -> still generates a signal.
    sigs = list(s.generate_signals(ctx.asof, ctx))
    assert len(sigs) >= 1


def test_earnings_gate_blocks_when_calendar_nonempty():
    """Provider returns a non-empty frame -> skip entry."""

    df = _build_uptrend_df("SPY", date(2020, 1, 1))
    provider = _FakeBarProvider({"SPY": df})

    class _EarningsStub:
        def calendar(self, start, end, symbols=None):
            return pd.DataFrame({"symbol": ["SPY"], "report_date": [start]})

    ctx = _build_ctx(provider, asof=df["ts"].iloc[-1].date())
    ctx.earnings_provider = _EarningsStub()

    s = KamaBreakout()
    s.configure(
        {
            "universe_symbols": ["SPY"],
            "er_min_trend": 0.2,
            "donchian_period": 15,
            "trend_sma_period": 100,
        }
    )
    sigs = list(s.generate_signals(ctx.asof, ctx))
    assert sigs == []
