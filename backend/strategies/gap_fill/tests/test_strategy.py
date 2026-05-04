"""Unit tests for Gap-Fill — SOTA shell."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Iterable
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import pytest

from strategies._core.contracts import (
    OrderType,
    Position,
    StrategyInput,
    TimeInForce,
)
from strategies.gap_fill.config import GAP_FILL_UNIVERSE_SEED, GapFillParams
from strategies.gap_fill.strategy import (
    GapFillStrategy,
    _has_imminent_earnings,
    _minutes_since_open,
    _prior_close,
    _screen_gaps,
    _today_open,
)


_ET = ZoneInfo("America/New_York")


# --------------------------------------------------------------------------- #
# Synthetic helpers                                                           #
# --------------------------------------------------------------------------- #
def _build_daily(*, end: date, n_days: int, spec: dict[str, "Iterable[float] | float"]) -> pd.DataFrame:
    """Daily bars panel — (date, symbol) MultiIndex with OHLC columns."""
    dates = pd.date_range(end=pd.Timestamp(end), periods=n_days, freq="D", tz="UTC")
    rows: list[dict] = []
    for sym, recipe in spec.items():
        prices = [float(recipe(i)) for i in range(n_days)] if callable(recipe) else [float(recipe)] * n_days
        for d, p in zip(dates, prices):
            rows.append({
                "date": d, "symbol": sym,
                "open": p, "high": p, "low": p, "close": p,
                "volume": 5_000_000,
            })
    return pd.DataFrame(rows).set_index(["date", "symbol"])


def _build_intraday(*, asof: date, sym_to_open: dict[str, float], minutes_after_open: int = 5) -> pd.DataFrame:
    """1-min intraday bars frame — (ts, symbol) index, ``open`` col.

    Builds bars from 09:30 ET through ``minutes_after_open`` minutes later
    (default = 5, so the test sees 09:30 through 09:34 inclusive).
    """
    open_dt = datetime.combine(asof, time(9, 30), tzinfo=_ET)
    rows: list[dict] = []
    for m in range(minutes_after_open + 1):
        ts = open_dt + timedelta(minutes=m)
        ts_utc = ts.astimezone(timezone.utc)
        for sym, op in sym_to_open.items():
            rows.append({
                "ts": ts_utc, "symbol": sym,
                "open": op, "high": op, "low": op, "close": op, "volume": 100_000,
            })
    return pd.DataFrame(rows).set_index(["ts", "symbol"])


# --------------------------------------------------------------------------- #
# Tests                                                                       #
# --------------------------------------------------------------------------- #
class TestMinutesSinceOpen:
    def test_at_open_returns_zero(self):
        ts = datetime(2024, 5, 1, 9, 30, tzinfo=_ET)
        assert _minutes_since_open(ts) == 0

    def test_after_open_returns_positive(self):
        ts = datetime(2024, 5, 1, 9, 35, tzinfo=_ET)
        assert _minutes_since_open(ts) == 5

    def test_premarket_returns_none(self):
        ts = datetime(2024, 5, 1, 8, 30, tzinfo=_ET)
        assert _minutes_since_open(ts) is None


class TestPriorClose:
    def test_returns_last_close_before_asof(self):
        bars = _build_daily(end=date(2024, 5, 1), n_days=5, spec={"AAPL": 100.0})
        result = _prior_close(bars, "AAPL", date(2024, 5, 2))
        assert result == 100.0

    def test_returns_none_for_unknown_symbol(self):
        bars = _build_daily(end=date(2024, 5, 1), n_days=5, spec={"AAPL": 100.0})
        assert _prior_close(bars, "TSLA", date(2024, 5, 2)) is None


class TestTodayOpen:
    def test_returns_first_today_bar_open(self):
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 99.0, "MSFT": 200.0},
            minutes_after_open=5,
        )
        assert _today_open(intraday, "AAPL", date(2024, 5, 1)) == 99.0

    def test_returns_none_for_missing_symbol(self):
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 99.0},
            minutes_after_open=5,
        )
        assert _today_open(intraday, "TSLA", date(2024, 5, 1)) is None


class TestEarningsSkip:
    def test_no_earnings_returns_false(self):
        assert _has_imminent_earnings(None, "AAPL", date(2024, 5, 1), 2) is False

    def test_imminent_returns_true(self):
        df = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 5, 2)}])
        assert _has_imminent_earnings(df, "AAPL", date(2024, 5, 1), 2) is True


class TestScreenGaps:
    def test_down_gap_in_size_band_admits(self):
        # AAPL gapped down 2% (100 → 98)
        bars = _build_daily(end=date(2024, 4, 30), n_days=5, spec={"AAPL": 100.0})
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 98.0},  # -2% gap
            minutes_after_open=5,
        )
        diag: dict = {"n_universe": 0, "n_with_gap": 0, "n_passed_size": 0, "n_passed_earnings": 0}
        cands = _screen_gaps(
            bars, intraday, earnings=None, held=set(),
            params=GapFillParams(min_gap_pct=0.005, max_gap_pct=0.040),
            asof=date(2024, 5, 1), diagnostics=diag,
        )
        assert any(c["symbol"] == "AAPL" for c in cands)

    def test_gap_too_small_rejects(self):
        bars = _build_daily(end=date(2024, 4, 30), n_days=5, spec={"AAPL": 100.0})
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 99.7},  # -0.3% — below min
            minutes_after_open=5,
        )
        diag: dict = {"n_universe": 0, "n_with_gap": 0, "n_passed_size": 0, "n_passed_earnings": 0}
        cands = _screen_gaps(
            bars, intraday, earnings=None, held=set(),
            params=GapFillParams(min_gap_pct=0.010),
            asof=date(2024, 5, 1), diagnostics=diag,
        )
        assert not any(c["symbol"] == "AAPL" for c in cands)

    def test_gap_too_large_rejects_likely_catalyst(self):
        bars = _build_daily(end=date(2024, 4, 30), n_days=5, spec={"AAPL": 100.0})
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 92.0},  # -8% gap — way above max (4%)
            minutes_after_open=5,
        )
        diag: dict = {"n_universe": 0, "n_with_gap": 0, "n_passed_size": 0, "n_passed_earnings": 0}
        cands = _screen_gaps(
            bars, intraday, earnings=None, held=set(),
            params=GapFillParams(max_gap_pct=0.040),
            asof=date(2024, 5, 1), diagnostics=diag,
        )
        assert not any(c["symbol"] == "AAPL" for c in cands)

    def test_up_gap_rejected_when_fade_down_only(self):
        bars = _build_daily(end=date(2024, 4, 30), n_days=5, spec={"AAPL": 100.0})
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 102.0},  # +2% gap
            minutes_after_open=5,
        )
        diag: dict = {"n_universe": 0, "n_with_gap": 0, "n_passed_size": 0, "n_passed_earnings": 0}
        cands = _screen_gaps(
            bars, intraday, earnings=None, held=set(),
            params=GapFillParams(direction="fade_down_only"),
            asof=date(2024, 5, 1), diagnostics=diag,
        )
        assert not any(c["symbol"] == "AAPL" for c in cands)

    def test_earnings_overlap_filters(self):
        bars = _build_daily(end=date(2024, 4, 30), n_days=5, spec={"AAPL": 100.0})
        intraday = _build_intraday(
            asof=date(2024, 5, 1),
            sym_to_open={"AAPL": 98.0},
            minutes_after_open=5,
        )
        earnings = pd.DataFrame([{"symbol": "AAPL", "date": date(2024, 5, 1)}])
        diag: dict = {"n_universe": 0, "n_with_gap": 0, "n_passed_size": 0, "n_passed_earnings": 0}
        cands = _screen_gaps(
            bars, intraday, earnings=earnings, held=set(),
            params=GapFillParams(),
            asof=date(2024, 5, 1), diagnostics=diag,
        )
        assert not any(c["symbol"] == "AAPL" for c in cands)


class TestStrategyMeta:
    def test_paper_only_flag_is_true(self):
        from strategies.registry import load_all, get_meta
        load_all()
        meta = get_meta("gap_fill")
        assert meta is not None
        assert meta.paper_only is True
        assert "1min" in meta.required_bars
