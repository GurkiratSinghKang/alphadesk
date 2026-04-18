"""Tests for momentum indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from indicators.momentum import rsi, connors_rsi, macd, adx, roc


# -----------------------------------------------------------------------------
# RSI — Wilder's own worked example (New Concepts in Technical Trading
# Systems, 1978, p. 66). Closes and expected Wilder RSI(14) for the last
# few bars — these match the numbers that every textbook, TA-Lib,
# TradingView, pandas-ta and stockcharts.com reproduce.
# -----------------------------------------------------------------------------
_WILDER_CLOSES = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278,
    44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
    45.8931, 46.0328, 45.6140, 46.2820, 46.2820,
    46.0028, 46.0328, 46.4116, 46.2222, 45.6439,
    46.2122,
]
# Hand-computed Wilder RSI(14) on the above 21-close series, with
# SMA-seeded Wilder smoothing (the original Wilder 1978 definition used
# by TA-Lib and StockCharts). The last-bar value is reproducible to the
# 4th decimal by doing the arithmetic in a spreadsheet.
_EXPECTED_RSI14_LAST = 62.9296


class TestRSI:
    def test_wilder_known_answer(self):
        closes = pd.Series(_WILDER_CLOSES, dtype="float64")
        val = rsi(closes, period=14, smoothing="wilder").iloc[-1]
        assert abs(val - _EXPECTED_RSI14_LAST) < 1e-3, (
            f"RSI last={val}, expected {_EXPECTED_RSI14_LAST}"
        )

    def test_wilder_intermediate_values(self):
        # Hand-computed intermediate Wilder RSI-14 values on this series
        closes = pd.Series(_WILDER_CLOSES, dtype="float64")
        out = rsi(closes, period=14, smoothing="wilder")
        # First non-NaN is at index 14 — the seed bar
        assert abs(out.iloc[14] - 70.5328) < 1e-3
        assert abs(out.iloc[15] - 66.3186) < 1e-3
        assert abs(out.iloc[19] - 57.9749) < 1e-3

    def test_sma_variant(self):
        closes = pd.Series(_WILDER_CLOSES, dtype="float64")
        # SMA variant should also produce a valid 0-100 value
        val = rsi(closes, period=14, smoothing="sma").iloc[-1]
        assert 0 <= val <= 100

    def test_sma_differs_from_wilder(self):
        closes = pd.Series(_WILDER_CLOSES, dtype="float64")
        w = rsi(closes, period=14, smoothing="wilder").iloc[-1]
        s = rsi(closes, period=14, smoothing="sma").iloc[-1]
        assert abs(w - s) > 1e-6, "Wilder and SMA RSI must differ on real data"

    def test_warmup_nans(self):
        closes = pd.Series(_WILDER_CLOSES, dtype="float64")
        out = rsi(closes, period=14, smoothing="wilder")
        assert out.iloc[:14].isna().all()
        assert not np.isnan(out.iloc[14])

    def test_constant_price(self):
        # Flat series: RSI is conventionally 50 (no moves)
        closes = pd.Series([100.0] * 30, dtype="float64")
        out = rsi(closes, period=14, smoothing="wilder")
        tail = out.iloc[14:]
        assert (tail == 50.0).all()

    def test_monotone_up(self):
        # Strictly rising: RSI should be exactly 100 (all gains, no losses)
        closes = pd.Series(np.arange(1.0, 40.0), dtype="float64")
        out = rsi(closes, period=14, smoothing="wilder")
        assert out.iloc[-1] == 100.0

    def test_invalid_smoothing(self):
        with pytest.raises(ValueError):
            rsi(pd.Series([1.0, 2.0, 3.0]), smoothing="bogus")

    def test_spy_real(self, spy_daily):
        s = spy_daily["close"]
        out = rsi(s, period=14)
        # Sanity: no values outside [0, 100]
        finite = out.dropna()
        assert (finite >= 0).all() and (finite <= 100).all()
        # Warmup
        assert out.iloc[:14].isna().all()


class TestConnorsRSI:
    def test_output_range(self, synthetic_close):
        crsi = connors_rsi(synthetic_close)
        finite = crsi.dropna()
        assert (finite >= 0).all() and (finite <= 100).all()

    def test_warmup(self, synthetic_close):
        crsi = connors_rsi(synthetic_close, rsi_period=3, streak_period=2, pct_rank_period=100)
        # Needs ~pct_rank_period bars before fully populated
        assert crsi.iloc[:100].isna().all() or crsi.iloc[:99].isna().all()
        assert not crsi.iloc[-1] != crsi.iloc[-1]  # not NaN

    def test_spy_real(self, spy_daily):
        crsi = connors_rsi(spy_daily["close"])
        finite = crsi.dropna()
        assert (finite >= 0).all() and (finite <= 100).all()


class TestMACD:
    def test_basic(self, synthetic_close):
        out = macd(synthetic_close, fast=12, slow=26, signal=9)
        assert list(out.columns) == ["macd", "signal", "histogram"]
        assert out.index.equals(synthetic_close.index)
        # Relationship: histogram = macd - signal
        diff = (out["macd"] - out["signal"]) - out["histogram"]
        assert diff.abs().max() < 1e-10

    def test_fast_slow_validation(self):
        with pytest.raises(ValueError):
            macd(pd.Series([1.0, 2.0, 3.0]), fast=26, slow=12)

    def test_spy_real(self, spy_daily):
        out = macd(spy_daily["close"])
        assert not out.isna().all().all()


class TestADX:
    def test_monotone_trend_high_adx(self):
        # Strong steady uptrend should produce high ADX
        n = 100
        idx = pd.date_range("2024-01-01", periods=n, freq="B")
        close = pd.Series(np.linspace(100, 200, n), index=idx)
        high = close + 0.5
        low = close - 0.5
        out = adx(high, low, close, period=14)
        tail = out.dropna()
        assert tail.iloc[-1] > 40  # a near-perfect trend -> ADX well above 25

    def test_range_low_adx(self):
        # Sideways / choppy market -> low ADX
        n = 200
        idx = pd.date_range("2024-01-01", periods=n, freq="B")
        rng = np.random.default_rng(1)
        close = pd.Series(100 + rng.normal(0, 0.1, n).cumsum() * 0.0, index=idx)
        # Force true sideways noise
        close = pd.Series(100 + rng.normal(0, 0.2, n), index=idx)
        high = close + 0.3
        low = close - 0.3
        out = adx(high, low, close, period=14)
        tail = out.dropna().iloc[-20:]
        assert tail.mean() < 40

    def test_spy_real(self, spy_daily):
        out = adx(spy_daily["high"], spy_daily["low"], spy_daily["close"])
        finite = out.dropna()
        assert (finite >= 0).all() and (finite <= 100).all()


class TestROC:
    def test_known_values(self):
        closes = pd.Series([100.0, 105.0, 110.0, 121.0], dtype="float64")
        out = roc(closes, period=1)
        # (105/100 - 1) = 0.05; (110/105 - 1) ~= 0.04762; (121/110 - 1) = 0.1
        assert np.isnan(out.iloc[0])
        assert abs(out.iloc[1] - 0.05) < 1e-9
        assert abs(out.iloc[2] - (110.0 / 105.0 - 1)) < 1e-9
        assert abs(out.iloc[3] - 0.1) < 1e-9

    def test_invalid_period(self):
        with pytest.raises(ValueError):
            roc(pd.Series([1.0, 2.0, 3.0]), period=0)
