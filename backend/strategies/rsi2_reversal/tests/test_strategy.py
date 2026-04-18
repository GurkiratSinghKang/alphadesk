"""Unit tests for the RSI(2) Mean-Reversion strategy.

These tests exercise the strategy in isolation against a deterministic fake
bar provider. They verify:

1. The decorator registered the strategy with the expected metadata.
2. ``configure()`` applies defaults + overrides correctly.
3. The RSI(2) trigger + trend filter + volume surge fire the entry gate on a
   hand-constructed oversold setup.
4. The SPY-RSI regime floor blocks entries during broad panic.
5. ``manage()`` emits an exit when RSI(2) > rsi_exit_min.
6. ``manage()`` emits a time-stop exit after ``time_stop_days``.
7. ``manage()`` emits a swing-low stop when close breaches it.

The tests use a tiny custom bar provider (not network-backed) so they run
deterministically and fast.

Import gymnastics: ``backend/strategies/__init__.py`` is legacy code that can
be broken by in-progress concurrent packages. We pre-stub ``backend.strategies``
in ``sys.modules`` before importing our subpackage to sidestep that issue.
"""

from __future__ import annotations

# --- Path + package-stub bootstrap (must run before any backend.strategies.* import)
import os as _os
import sys as _sys
import types as _types
from pathlib import Path as _Path

_ROOT = _Path(__file__).resolve().parents[4]
for _p in (_ROOT, _ROOT / "backend"):
    _ps = str(_p)
    if _ps not in _sys.path:
        _sys.path.insert(0, _ps)

# If the legacy package init hasn't imported yet, install a stub that only
# provides __path__ so the subpackages remain discoverable without running
# the legacy imports. If it *has* already imported successfully in this
# process, we leave the real module alone.
if "backend.strategies" not in _sys.modules:
    _stub = _types.ModuleType("backend.strategies")
    _stub.__path__ = [str(_ROOT / "backend" / "strategies")]
    _sys.modules["backend.strategies"] = _stub

# Now the real imports.
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from backtest.types import Context
from strategies.registry import get_meta, get_strategy
from strategies.signal import OrderType

import strategies.rsi2_reversal  # noqa: F401 - fires registration


# --------------------------------------------------------------------------- #
# Fake bar provider                                                            #
# --------------------------------------------------------------------------- #
class FakeBarProvider:
    """Canned bar generator.

    Each symbol's price path is produced by the ``price_fn`` passed in, which
    receives a pandas bdate_range index and returns an OHLC + volume frame.
    """

    def __init__(self, data: dict[str, pd.DataFrame]) -> None:
        # data: symbol -> DataFrame(index=date, columns=[open, high, low, close, volume])
        self.data = data

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        start = pd.Timestamp(start).tz_localize(None).normalize()
        end = pd.Timestamp(end).tz_localize(None).normalize()
        frames: list[pd.DataFrame] = []
        syms = list(symbols) if not isinstance(symbols, str) else [symbols]
        for sym in syms:
            df = self.data.get(sym.upper())
            if df is None:
                continue
            sub = df.loc[(df.index >= start) & (df.index <= end)]
            if sub.empty:
                continue
            out = sub.copy()
            out["symbol"] = sym.upper()
            out["ts"] = out.index.tz_localize("UTC")
            out = out.reset_index(drop=True)
            frames.append(
                out[["symbol", "ts", "open", "high", "low", "close", "volume"]]
            )
        if not frames:
            return pd.DataFrame(
                columns=["symbol", "ts", "open", "high", "low", "close", "volume"]
            )
        return pd.concat(frames, ignore_index=True)


def _uptrend_path(
    n: int = 400,
    start_price: float = 100.0,
    drift: float = 0.0015,
    vol: float = 0.008,
    seed: int = 1,
) -> pd.DataFrame:
    """Build a long uptrending series that eventually dips to oversold."""
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, vol, n)
    closes = start_price * np.cumprod(1 + rets)
    idx = pd.bdate_range(start="2022-01-03", periods=n)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * (1 + rng.uniform(0, 0.003, size=n))
    lows = np.minimum(opens, closes) * (1 - rng.uniform(0, 0.003, size=n))
    vols = rng.integers(1_000_000, 2_000_000, size=n).astype(float)
    df = pd.DataFrame(
        {
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": vols,
        },
        index=idx,
    )
    df.index.name = "date"
    return df


def _dip_path(base: pd.DataFrame, n_dip: int = 5, dip_pct: float = 0.04) -> pd.DataFrame:
    """Append a sharp multi-day selloff so RSI(2) < 10 triggers. We also bump
    today's volume above the 20d average so the volume surge fires."""
    df = base.copy()
    last_close = float(df["close"].iloc[-1])
    last_idx = df.index[-1]
    new_rows = []
    for i in range(n_dip):
        new_idx = last_idx + pd.offsets.BDay(i + 1)
        new_close = last_close * (1 - dip_pct * (1 if i < n_dip - 1 else 0.4))
        new_open = last_close if i == 0 else float(df["close"].iloc[-1])
        new_high = max(new_open, new_close) * 1.002
        new_low = min(new_open, new_close) * 0.997
        # Last dip bar: inject a volume surge
        new_vol = (
            float(df["volume"].iloc[-20:].mean()) * 2.0
            if i == n_dip - 1
            else float(df["volume"].iloc[-20:].mean()) * 0.95
        )
        new_rows.append(
            {
                "open": new_open,
                "high": new_high,
                "low": new_low,
                "close": new_close,
                "volume": new_vol,
            }
        )
        df = pd.concat(
            [
                df,
                pd.DataFrame(new_rows[-1:], index=[new_idx]),
            ]
        )
        last_close = new_close
    df.index.name = "date"
    return df


def _hand_oversold_series(
    n_trend: int = 400,
    start_price: float = 100.0,
    trend_growth: float = 0.0025,
    dip_pct: float = 0.012,
    n_dip: int = 3,
    seed: int = 1,
) -> pd.DataFrame:
    """Build a deterministic price path: near-monotone uptrend then dip.

    The uptrend is generated with low noise around a positive-drift geometric
    process so the last close sits well above SMA(200). The dip phase then
    pulls RSI(2) below 10 without dropping price under the trend line.
    """
    rng = np.random.default_rng(seed)
    # Uptrend phase.
    rets = rng.normal(trend_growth, 0.004, n_trend)
    closes = start_price * np.cumprod(1 + rets)
    idx = pd.bdate_range(start="2022-01-03", periods=n_trend)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * (1 + rng.uniform(0, 0.002, size=n_trend))
    lows = np.minimum(opens, closes) * (1 - rng.uniform(0, 0.002, size=n_trend))
    vols = rng.integers(1_000_000, 2_000_000, size=n_trend).astype(float)

    trend_df = pd.DataFrame(
        {
            "open": opens,
            "high": highs,
            "low": lows,
            "close": closes,
            "volume": vols,
        },
        index=idx,
    )
    return _dip_path(trend_df, n_dip=n_dip, dip_pct=dip_pct)


def _make_ctx(provider: FakeBarProvider, asof: date, equity: float = 100_000) -> Context:
    ctx = Context(
        asof=asof,
        cash=Decimal(str(equity)),
        equity=Decimal(str(equity)),
        bar_provider=provider,
    )
    return ctx


# --------------------------------------------------------------------------- #
# Tests                                                                        #
# --------------------------------------------------------------------------- #
class TestRegistrationAndConfig:
    def test_strategy_registered(self):
        cls = get_strategy("rsi2_reversal")
        assert cls.__name__ == "RSI2ReversalStrategy"
        meta = get_meta("rsi2_reversal")
        assert meta.name == "rsi2_reversal"
        assert meta.category == "equity"
        assert meta.required_lookback_days >= 250
        assert meta.supports_shorts is False

    def test_configure_applies_defaults(self):
        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure({})
        assert inst.params["rsi_period"] == 2
        assert inst.params["rsi_entry_max"] == 10.0
        assert inst.params["max_positions"] == 5
        assert inst.params["allocation_per_trade"] == 0.20

    def test_configure_applies_overrides(self):
        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure({"rsi_entry_max": 5.0, "max_positions": 3})
        assert inst.params["rsi_entry_max"] == 5.0
        assert inst.params["max_positions"] == 3
        # Unspecified params retain defaults.
        assert inst.params["time_stop_days"] == 6

    def test_search_space_matches_spec(self):
        cls = get_strategy("rsi2_reversal")
        space = cls.search_space()
        expected_keys = {
            "rsi_period",
            "rsi_entry_max",
            "connors_entry_max",
            "trend_sma_period",
            "stop_lookback_bars",
            "time_stop_days",
            "exit_sma_period",
            "rsi_exit_min",
            "max_positions",
            "allocation_per_trade",
            "volume_surge_min",
            "spy_rsi_regime_floor",
        }
        assert set(space.keys()) == expected_keys


class TestEntryGates:
    def test_entry_fires_on_oversold_setup(self):
        """Uptrend then sharp dip => RSI(2) should trigger, CRSI should confirm."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure(
            {
                "max_positions": 5,
                "allocation_per_trade": 0.20,
                "spy_rsi_regime_floor": 5.0,  # let SPY regime pass
                "volume_surge_min": 1.5,  # the dip bar has 2x avg
                "rsi_entry_max": 15.0,  # be generous on the raw gate
            }
        )
        # SPY: mild dip so its RSI(2) stays above the regime floor.
        dipped_spy = _hand_oversold_series(
            n_trend=400, start_price=400.0, trend_growth=0.0025,
            dip_pct=0.004, n_dip=3, seed=1,
        )
        # AAPL: sharper dip (RSI(2) < 10) while still above SMA(200).
        dipped_aapl = _hand_oversold_series(
            n_trend=400, start_price=150.0, trend_growth=0.0025,
            dip_pct=0.014, n_dip=3, seed=2,
        )

        # SPY dipped less, its RSI(2) should still be > 5 (regime pass).
        provider = FakeBarProvider({"SPY": dipped_spy, "AAPL": dipped_aapl})

        asof = dipped_aapl.index[-1].date()
        ctx = _make_ctx(provider, asof)

        # Force the universe to exactly ["SPY", "AAPL"] — bypass the ADV
        # screen for speed and determinism.
        ctx.state["rsi2_reversal.universe"] = ["SPY", "AAPL"]

        sigs = list(inst.generate_signals(asof, ctx))
        # We expect at least one entry on AAPL.
        syms = [s.symbol for s in sigs]
        assert "AAPL" in syms, f"expected AAPL entry; got {syms}"
        aapl_sig = next(s for s in sigs if s.symbol == "AAPL")
        assert aapl_sig.target_weight == pytest.approx(0.20)
        assert aapl_sig.order_type is OrderType.MOO
        assert aapl_sig.stop_price is not None
        # Stop is at the swing low of the dip bars, which is strictly below
        # the final close.
        assert float(aapl_sig.stop_price) < float(dipped_aapl["close"].iloc[-1])

    def test_spy_regime_blocks_entry(self):
        """When SPY's RSI(2) is below the floor, no entries should fire."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure(
            {
                "spy_rsi_regime_floor": 20.0,  # broad — any dip blocks
            }
        )
        base = _uptrend_path(n=300, seed=3)
        dipped = _dip_path(base, n_dip=8, dip_pct=0.03)  # SPY itself oversold

        base2 = _uptrend_path(n=300, seed=4, start_price=200.0)
        dipped_aapl = _dip_path(base2, n_dip=5, dip_pct=0.04)

        provider = FakeBarProvider({"SPY": dipped, "AAPL": dipped_aapl})
        asof = dipped.index[-1].date()
        ctx = _make_ctx(provider, asof)
        ctx.state["rsi2_reversal.universe"] = ["SPY", "AAPL"]

        sigs = list(inst.generate_signals(asof, ctx))
        assert sigs == [], f"regime filter should have blocked; got {sigs}"

    def test_trend_filter_blocks_downtrend(self):
        """Close below SMA_200 must block entry even if RSI(2) is low."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure({"spy_rsi_regime_floor": 5.0})

        # Build a strictly declining series for AAPL so close < SMA_200 always.
        n = 300
        rng = np.random.default_rng(11)
        closes = 200.0 * np.cumprod(1 + rng.normal(-0.002, 0.01, n))
        idx = pd.bdate_range(start="2022-01-03", periods=n)
        opens = np.concatenate(([closes[0]], closes[:-1]))
        highs = np.maximum(opens, closes) * 1.002
        lows = np.minimum(opens, closes) * 0.998
        vols = rng.integers(1_000_000, 2_000_000, size=n).astype(float)
        aapl_df = pd.DataFrame(
            {"open": opens, "high": highs, "low": lows, "close": closes, "volume": vols},
            index=idx,
        )
        aapl_df.index.name = "date"

        spy_base = _uptrend_path(n=300, seed=5)

        provider = FakeBarProvider({"SPY": spy_base, "AAPL": aapl_df})
        asof = aapl_df.index[-1].date()
        ctx = _make_ctx(provider, asof)
        ctx.state["rsi2_reversal.universe"] = ["SPY", "AAPL"]
        sigs = list(inst.generate_signals(asof, ctx))
        assert "AAPL" not in [s.symbol for s in sigs]


class TestManageExits:
    def _setup_open_position(self, inst, provider, asof, symbol, entry_price, stop_price):
        """Build a Context with a single open long position in ``symbol``."""
        from backtest.types import AssetClass, Position

        ctx = _make_ctx(provider, asof)
        ctx.state["rsi2_reversal.universe"] = [symbol, "SPY"]
        opened_at = asof - timedelta(days=2)  # held 2 trading days so far
        pos = Position(
            symbol=symbol,
            quantity=100,
            avg_price=Decimal(str(entry_price)),
            asset_class=AssetClass.EQUITY,
            opened_at=datetime.combine(opened_at, datetime.min.time()),
            last_price=Decimal(str(entry_price)),
            stop_price=Decimal(str(stop_price)),
        )
        ctx.positions = [pos]
        # Also seed the entries cache as the on_fill hook would have.
        entries = ctx.state.setdefault("rsi2_reversal.entries", {})
        entries[symbol] = {
            "queued_on": datetime.combine(opened_at, datetime.min.time()),
            "filled_on": datetime.combine(opened_at, datetime.min.time()),
            "stop_price": stop_price,
            "entry_price": entry_price,
        }
        return ctx

    def test_rsi_profit_take_exit(self):
        """Price has rallied to overbought => RSI(2) > exit threshold => sell."""
        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure({"rsi_exit_min": 70.0, "time_stop_days": 30})  # long time-stop

        base = _uptrend_path(n=300, seed=20)
        # Append a sharp 3-day rally so RSI(2) goes to ~95.
        last = base.iloc[-1]
        extra_rows = []
        last_close = float(last["close"])
        for i in range(3):
            new_close = last_close * 1.03
            extra_rows.append(
                {
                    "open": last_close,
                    "high": new_close * 1.005,
                    "low": last_close * 0.999,
                    "close": new_close,
                    "volume": float(last["volume"]),
                }
            )
            last_close = new_close
        extra_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=3
        )
        rally = pd.concat(
            [
                base,
                pd.DataFrame(extra_rows, index=extra_idx),
            ]
        )
        rally.index.name = "date"
        provider = FakeBarProvider({"AAPL": rally, "SPY": _uptrend_path(n=300, seed=21)})

        asof = rally.index[-1].date()
        ctx = self._setup_open_position(
            inst,
            provider,
            asof,
            symbol="AAPL",
            entry_price=float(rally["close"].iloc[-5]),
            stop_price=float(rally["low"].iloc[-5]) * 0.98,
        )

        sigs = list(inst.manage(asof, ctx))
        assert any(
            s.symbol == "AAPL" and s.target_weight == 0.0 for s in sigs
        ), f"expected AAPL exit; got {sigs}"
        # Tagged as RSI profit take or SMA cross (either exit is legitimate).
        exit_sig = next(s for s in sigs if s.symbol == "AAPL")
        assert "rsi2-exit" in exit_sig.tag
        assert exit_sig.order_type is OrderType.MOC

    def test_swing_low_stop_exit(self):
        """Close below the stored stop_price triggers a swing-stop exit."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure(
            {
                "rsi_exit_min": 99.0,  # rule out RSI exit
                "exit_sma_period": 3,  # keep SMA cross easy to reason about
                "time_stop_days": 30,
            }
        )

        base = _uptrend_path(n=300, seed=30)
        # Drop below the swing-low on the final bar.
        drop_rows = [
            {
                "open": float(base["close"].iloc[-1]) * 0.98,
                "high": float(base["close"].iloc[-1]) * 0.985,
                "low": float(base["close"].iloc[-1]) * 0.90,
                "close": float(base["close"].iloc[-1]) * 0.92,
                "volume": float(base["volume"].iloc[-1]),
            }
        ]
        drop_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=1
        )
        crashed = pd.concat([base, pd.DataFrame(drop_rows, index=drop_idx)])
        crashed.index.name = "date"

        provider = FakeBarProvider(
            {"AAPL": crashed, "SPY": _uptrend_path(n=300, seed=31)}
        )
        asof = crashed.index[-1].date()
        entry_price = float(crashed["close"].iloc[-3])  # higher than final close
        stop_price = entry_price * 0.95  # final close breaches
        ctx = self._setup_open_position(
            inst, provider, asof, "AAPL", entry_price, stop_price
        )
        sigs = list(inst.manage(asof, ctx))
        aapl_sigs = [s for s in sigs if s.symbol == "AAPL"]
        assert aapl_sigs, "expected an exit signal"
        assert aapl_sigs[0].target_weight == 0.0

    def test_time_stop_exit(self):
        """After ``time_stop_days`` trading days the position must exit
        regardless of price."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure(
            {
                "time_stop_days": 3,
                "rsi_exit_min": 99.0,
                "exit_sma_period": 3,
            }
        )

        base = _uptrend_path(n=300, seed=40)
        # Extend flat so neither RSI nor swing-stop fires.
        extra_rows = []
        last = float(base["close"].iloc[-1])
        for _ in range(5):
            extra_rows.append(
                {
                    "open": last,
                    "high": last * 1.001,
                    "low": last * 0.999,
                    "close": last,
                    "volume": float(base["volume"].iloc[-1]),
                }
            )
        extra_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=5
        )
        flat = pd.concat([base, pd.DataFrame(extra_rows, index=extra_idx)])
        flat.index.name = "date"

        provider = FakeBarProvider(
            {"AAPL": flat, "SPY": _uptrend_path(n=300, seed=41)}
        )
        asof = flat.index[-1].date()

        from backtest.types import AssetClass, Position

        ctx = _make_ctx(provider, asof)
        ctx.state["rsi2_reversal.universe"] = ["AAPL", "SPY"]
        opened = asof - timedelta(days=10)  # way past time stop
        pos = Position(
            symbol="AAPL",
            quantity=100,
            avg_price=Decimal(str(last * 0.98)),
            asset_class=AssetClass.EQUITY,
            opened_at=datetime.combine(opened, datetime.min.time()),
            last_price=Decimal(str(last)),
            stop_price=Decimal(str(last * 0.50)),  # way below, can't trigger
        )
        ctx.positions = [pos]
        sigs = list(inst.manage(asof, ctx))
        assert any(
            s.symbol == "AAPL" and s.target_weight == 0.0
            for s in sigs
        ), "expected time-stop exit"


class TestUniverseBuild:
    def test_degrades_to_core_etfs_when_provider_fails(self):
        """If bar provider raises, strategy falls back to core ETFs."""

        cls = get_strategy("rsi2_reversal")
        inst = cls()
        inst.configure({})

        class BrokenProvider:
            def bars(self, *args, **kwargs):
                raise RuntimeError("boom")

        ctx = _make_ctx(BrokenProvider(), date(2024, 3, 15))
        syms = list(inst.universe(date(2024, 3, 15), ctx))
        # Must at least include SPY for the regime filter.
        assert "SPY" in syms
        assert "QQQ" in syms
        assert "IWM" in syms


if __name__ == "__main__":  # pragma: no cover
    pytest.main([__file__, "-v"])
