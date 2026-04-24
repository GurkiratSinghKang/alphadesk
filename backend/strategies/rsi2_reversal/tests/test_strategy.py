"""Unit tests for the RSI(2) Mean-Reversion strategy — SOTA shell.

Covers:
1. Registration + defaults.
2. Entry gate fires on hand-constructed oversold setup in uptrend.
3. SPY regime floor blocks entries during broad panic.
4. Trend filter blocks entries for names below their SMA(200).
5. Exits — RSI-profit-take, swing-stop, time-stop.
6. Universe build still returns core ETFs when bar data is minimal.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import Position, StrategyInput
from strategies._core.protocol import get_meta, get_strategy
from strategies._core.contracts import OrderType
from strategies.rsi2_reversal.config import CORE_ETFS, RSI2Params
from strategies.rsi2_reversal.strategy import RSI2ReversalStrategy


# --------------------------------------------------------------------------- #
# Synthetic bar builders                                                      #
# --------------------------------------------------------------------------- #
def _uptrend_path(
    n: int = 400,
    start_price: float = 100.0,
    drift: float = 0.0015,
    vol: float = 0.008,
    seed: int = 1,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(drift, vol, n)
    closes = start_price * np.cumprod(1 + rets)
    idx = pd.bdate_range(start="2022-01-03", periods=n)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * (1 + rng.uniform(0, 0.003, size=n))
    lows = np.minimum(opens, closes) * (1 - rng.uniform(0, 0.003, size=n))
    vols = rng.integers(1_000_000, 2_000_000, size=n).astype(float)
    return pd.DataFrame({
        "open": opens, "high": highs, "low": lows,
        "close": closes, "volume": vols,
    }, index=idx).rename_axis("date")


def _dip_path(base: pd.DataFrame, n_dip: int = 5, dip_pct: float = 0.04) -> pd.DataFrame:
    df = base.copy()
    last_close = float(df["close"].iloc[-1])
    last_idx = df.index[-1]
    for i in range(n_dip):
        new_idx = last_idx + pd.offsets.BDay(i + 1)
        new_close = last_close * (1 - dip_pct * (1 if i < n_dip - 1 else 0.4))
        new_open = last_close if i == 0 else float(df["close"].iloc[-1])
        new_high = max(new_open, new_close) * 1.002
        new_low = min(new_open, new_close) * 0.997
        avg_vol = float(df["volume"].iloc[-20:].mean())
        new_vol = avg_vol * 2.0 if i == n_dip - 1 else avg_vol * 0.95
        df = pd.concat([
            df,
            pd.DataFrame([{
                "open": new_open, "high": new_high, "low": new_low,
                "close": new_close, "volume": new_vol,
            }], index=[new_idx]),
        ])
        last_close = new_close
    return df.rename_axis("date")


def _hand_oversold_series(
    n_trend: int = 400,
    start_price: float = 100.0,
    trend_growth: float = 0.0025,
    dip_pct: float = 0.012,
    n_dip: int = 3,
    seed: int = 1,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rets = rng.normal(trend_growth, 0.004, n_trend)
    closes = start_price * np.cumprod(1 + rets)
    idx = pd.bdate_range(start="2022-01-03", periods=n_trend)
    opens = np.concatenate(([closes[0]], closes[:-1]))
    highs = np.maximum(opens, closes) * (1 + rng.uniform(0, 0.002, size=n_trend))
    lows = np.minimum(opens, closes) * (1 - rng.uniform(0, 0.002, size=n_trend))
    vols = rng.integers(1_000_000, 2_000_000, size=n_trend).astype(float)
    trend_df = pd.DataFrame({
        "open": opens, "high": highs, "low": lows,
        "close": closes, "volume": vols,
    }, index=idx)
    return _dip_path(trend_df, n_dip=n_dip, dip_pct=dip_pct)


def _bars_from_frames(frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Merge per-symbol dataframes into a (date, symbol) multi-index frame."""
    rows: list[pd.DataFrame] = []
    for sym, df in frames.items():
        frame = df.reset_index().rename(columns={"index": "date"})
        if "date" not in frame.columns:
            frame["date"] = df.index
        frame["date"] = pd.to_datetime(frame["date"]).dt.date
        frame["symbol"] = sym.upper()
        rows.append(frame)
    merged = pd.concat(rows, ignore_index=True)
    return merged.set_index(["date", "symbol"]).sort_index()


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    positions: Optional[list[Position]] = None,
    state: Optional[dict] = None,
    earnings: Optional[pd.DataFrame] = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars, earnings=earnings,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=positions or [], state=state or {},
        seed=0, rng=np.random.default_rng(0),
    )


# --------------------------------------------------------------------------- #
# Registration / config                                                       #
# --------------------------------------------------------------------------- #
class TestRegistrationAndConfig:
    def test_strategy_registered(self):
        cls = get_strategy("rsi2_reversal")
        assert cls is RSI2ReversalStrategy
        meta = get_meta("rsi2_reversal")
        assert meta.name == "rsi2_reversal"
        assert meta.category == "equity"
        assert meta.lookback_days >= 250

    def test_defaults(self):
        p = RSI2Params()
        assert p.rsi_period == 2
        assert p.rsi_entry_max == 10.0
        assert p.max_positions == 5
        assert p.allocation_per_trade == 0.20

    def test_overrides(self):
        p = RSI2Params(rsi_entry_max=5.0, max_positions=3)
        assert p.rsi_entry_max == 5.0
        assert p.max_positions == 3
        assert p.time_stop_days == 6

    def test_tune_space_keys(self):
        space = RSI2Params.tune_space()
        expected = {
            "rsi_period", "rsi_entry_max", "connors_entry_max",
            "trend_sma_period", "stop_lookback_bars", "time_stop_days",
            "exit_sma_period", "rsi_exit_min", "max_positions",
            "allocation_per_trade", "volume_surge_min", "spy_rsi_regime_floor",
        }
        assert set(space.keys()) == expected


# --------------------------------------------------------------------------- #
# Entry gates                                                                 #
# --------------------------------------------------------------------------- #
class TestEntryGates:
    def test_entry_fires_on_oversold_setup(self):
        dipped_spy = _hand_oversold_series(
            n_trend=400, start_price=400.0, trend_growth=0.0025,
            dip_pct=0.004, n_dip=3, seed=1,
        )
        dipped_aapl = _hand_oversold_series(
            n_trend=400, start_price=150.0, trend_growth=0.0025,
            dip_pct=0.014, n_dip=3, seed=2,
        )
        bars = _bars_from_frames({"SPY": dipped_spy, "AAPL": dipped_aapl})
        asof = dipped_aapl.index[-1].date()

        params = RSI2Params(
            max_positions=5, allocation_per_trade=0.20,
            spy_rsi_regime_floor=5.0, volume_surge_min=1.5, rsi_entry_max=15.0,
        )
        state = {"rsi2_reversal.universe": ["SPY", "AAPL"]}
        strat = RSI2ReversalStrategy()
        result = strat.run(_build_input(bars, asof, state=state), params)

        entries = [s for s in result.signals if s.tag.startswith("rsi2-entry")]
        syms = [s.symbol for s in entries]
        assert "AAPL" in syms, f"expected AAPL entry; got {syms}"
        aapl_sig = next(s for s in entries if s.symbol == "AAPL")
        assert aapl_sig.target_weight == pytest.approx(0.20)
        assert aapl_sig.order_type is OrderType.MOO
        assert aapl_sig.stop_price is not None
        assert float(aapl_sig.stop_price) < float(dipped_aapl["close"].iloc[-1])

    def test_spy_regime_blocks_entry(self):
        base = _uptrend_path(n=300, seed=3)
        dipped_spy = _dip_path(base, n_dip=8, dip_pct=0.03)
        base2 = _uptrend_path(n=300, seed=4, start_price=200.0)
        dipped_aapl = _dip_path(base2, n_dip=5, dip_pct=0.04)
        bars = _bars_from_frames({"SPY": dipped_spy, "AAPL": dipped_aapl})
        asof = dipped_spy.index[-1].date()

        params = RSI2Params(spy_rsi_regime_floor=20.0)
        state = {"rsi2_reversal.universe": ["SPY", "AAPL"]}
        strat = RSI2ReversalStrategy()
        result = strat.run(_build_input(bars, asof, state=state), params)
        entries = [s for s in result.signals if s.tag.startswith("rsi2-entry")]
        assert entries == [], f"regime filter should have blocked; got {entries}"

    def test_trend_filter_blocks_downtrend(self):
        n = 300
        rng = np.random.default_rng(11)
        closes = 200.0 * np.cumprod(1 + rng.normal(-0.002, 0.01, n))
        idx = pd.bdate_range(start="2022-01-03", periods=n)
        opens = np.concatenate(([closes[0]], closes[:-1]))
        highs = np.maximum(opens, closes) * 1.002
        lows = np.minimum(opens, closes) * 0.998
        vols = rng.integers(1_000_000, 2_000_000, size=n).astype(float)
        aapl_df = pd.DataFrame({
            "open": opens, "high": highs, "low": lows,
            "close": closes, "volume": vols,
        }, index=idx)
        spy_base = _uptrend_path(n=300, seed=5)

        bars = _bars_from_frames({"SPY": spy_base, "AAPL": aapl_df})
        asof = aapl_df.index[-1].date()
        params = RSI2Params(spy_rsi_regime_floor=5.0)
        state = {"rsi2_reversal.universe": ["SPY", "AAPL"]}
        strat = RSI2ReversalStrategy()
        result = strat.run(_build_input(bars, asof, state=state), params)
        entries = [s for s in result.signals if s.tag.startswith("rsi2-entry")]
        assert "AAPL" not in [s.symbol for s in entries]


# --------------------------------------------------------------------------- #
# Exits                                                                       #
# --------------------------------------------------------------------------- #
class TestExits:
    def _build_open_position(
        self, symbol: str, entry_price: float, stop_price: float, opened: date
    ) -> Position:
        return Position(
            symbol=symbol, quantity=100,
            avg_entry_price=Decimal(str(entry_price)),
            entry_date=opened,
        )

    def test_rsi_profit_take_exit(self):
        base = _uptrend_path(n=300, seed=20)
        extra: list[dict] = []
        last_close = float(base["close"].iloc[-1])
        for _ in range(3):
            new_close = last_close * 1.03
            extra.append({
                "open": last_close,
                "high": new_close * 1.005,
                "low": last_close * 0.999,
                "close": new_close,
                "volume": float(base["volume"].iloc[-1]),
            })
            last_close = new_close
        extra_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=3
        )
        rally = pd.concat([base, pd.DataFrame(extra, index=extra_idx)]).rename_axis("date")
        bars = _bars_from_frames({
            "AAPL": rally,
            "SPY": _uptrend_path(n=300, seed=21),
        })
        asof = rally.index[-1].date()

        entry_price = float(rally["close"].iloc[-5])
        stop_price = float(rally["low"].iloc[-5]) * 0.98
        pos = self._build_open_position(
            "AAPL", entry_price, stop_price, asof - timedelta(days=2),
        )
        state = {
            "rsi2_reversal.universe": ["AAPL", "SPY"],
            "rsi2_reversal.entries": {
                "AAPL": {"queued_on": asof - timedelta(days=2),
                         "stop_price": stop_price, "entry_price": entry_price},
            },
        }
        params = RSI2Params(rsi_exit_min=70.0, time_stop_days=30)
        strat = RSI2ReversalStrategy()
        result = strat.run(
            _build_input(bars, asof, positions=[pos], state=state),
            params,
        )
        exits = [s for s in result.signals if s.tag.startswith("rsi2-exit")]
        assert any(s.symbol == "AAPL" and s.target_weight == 0.0 for s in exits)
        sig = next(s for s in exits if s.symbol == "AAPL")
        assert sig.order_type is OrderType.MOC

    def test_swing_low_stop_exit(self):
        base = _uptrend_path(n=300, seed=30)
        drop_row = {
            "open": float(base["close"].iloc[-1]) * 0.98,
            "high": float(base["close"].iloc[-1]) * 0.985,
            "low": float(base["close"].iloc[-1]) * 0.90,
            "close": float(base["close"].iloc[-1]) * 0.92,
            "volume": float(base["volume"].iloc[-1]),
        }
        drop_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=1
        )
        crashed = pd.concat([base, pd.DataFrame([drop_row], index=drop_idx)]).rename_axis("date")
        bars = _bars_from_frames({
            "AAPL": crashed,
            "SPY": _uptrend_path(n=300, seed=31),
        })
        asof = crashed.index[-1].date()

        entry_price = float(crashed["close"].iloc[-3])
        stop_price = entry_price * 0.95
        pos = self._build_open_position(
            "AAPL", entry_price, stop_price, asof - timedelta(days=2),
        )
        state = {
            "rsi2_reversal.universe": ["AAPL", "SPY"],
            "rsi2_reversal.entries": {
                "AAPL": {"queued_on": asof - timedelta(days=2),
                         "stop_price": stop_price, "entry_price": entry_price},
            },
        }
        params = RSI2Params(rsi_exit_min=99.0, exit_sma_period=3, time_stop_days=30)
        strat = RSI2ReversalStrategy()
        result = strat.run(
            _build_input(bars, asof, positions=[pos], state=state),
            params,
        )
        exits = [s for s in result.signals if s.tag.startswith("rsi2-exit")]
        aapl_exits = [s for s in exits if s.symbol == "AAPL"]
        assert aapl_exits
        assert aapl_exits[0].target_weight == 0.0

    def test_time_stop_exit(self):
        base = _uptrend_path(n=300, seed=40)
        last = float(base["close"].iloc[-1])
        extra = [{
            "open": last, "high": last * 1.001, "low": last * 0.999,
            "close": last, "volume": float(base["volume"].iloc[-1]),
        } for _ in range(5)]
        extra_idx = pd.bdate_range(
            start=base.index[-1] + pd.offsets.BDay(1), periods=5
        )
        flat = pd.concat([base, pd.DataFrame(extra, index=extra_idx)]).rename_axis("date")
        bars = _bars_from_frames({
            "AAPL": flat,
            "SPY": _uptrend_path(n=300, seed=41),
        })
        asof = flat.index[-1].date()

        opened = asof - timedelta(days=10)
        pos = Position(
            symbol="AAPL", quantity=100,
            avg_entry_price=Decimal(str(last * 0.98)),
            entry_date=opened,
        )
        state = {
            "rsi2_reversal.universe": ["AAPL", "SPY"],
            "rsi2_reversal.entries": {
                "AAPL": {"queued_on": opened, "stop_price": last * 0.50},
            },
        }
        params = RSI2Params(time_stop_days=3, rsi_exit_min=99.0, exit_sma_period=3)
        strat = RSI2ReversalStrategy()
        result = strat.run(
            _build_input(bars, asof, positions=[pos], state=state),
            params,
        )
        exits = [s for s in result.signals if s.tag.startswith("rsi2-exit")]
        assert any(s.symbol == "AAPL" and s.target_weight == 0.0 for s in exits)


# --------------------------------------------------------------------------- #
# Universe                                                                    #
# --------------------------------------------------------------------------- #
class TestUniverse:
    def test_universe_hook_includes_core_etfs(self):
        strat = RSI2ReversalStrategy()
        syms = strat.universe(date(2024, 3, 15), state={})
        for core in CORE_ETFS:
            assert core in syms
