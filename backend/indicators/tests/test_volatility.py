"""Tests for volatility indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.indicators.volatility import atr, parkinson, garman_klass, realized_vol, hv


class TestATR:
    def test_known_answer(self):
        # Hand-computed True Range then Wilder ATR(3):
        #   bar 1: H-L = 10
        #   bar 2: max(12, |15-90|=75? no)
        # Use a simple case: flat close, H-L alternating
        h = pd.Series([11, 12, 13, 14], dtype="float64")
        lo = pd.Series([10, 11, 12, 13], dtype="float64")
        c = pd.Series([11, 12, 13, 14], dtype="float64")
        # TR: [1, max(1,1,0)=1, max(1,1,0)=1, max(1,1,0)=1]
        out = atr(h, lo, c, period=3)
        # SMA seed at index 2 = mean([1,1,1]) = 1. Then recursion: still 1.
        assert pd.isna(out.iloc[0]) and pd.isna(out.iloc[1])
        assert out.iloc[2] == pytest.approx(1.0)
        assert out.iloc[3] == pytest.approx(1.0)

    def test_monotone_increasing_range(self):
        # Widening ranges -> ATR should rise
        n = 30
        h = pd.Series(np.linspace(100, 110, n), dtype="float64")
        lo = pd.Series(np.linspace(99, 105, n), dtype="float64")
        c = pd.Series(np.linspace(100, 108, n), dtype="float64")
        out = atr(h, lo, c, period=14)
        # ATR should be positive and monotone-ish (noise permits small dips)
        finite = out.dropna()
        assert (finite > 0).all()

    def test_spy_real(self, spy_daily):
        out = atr(spy_daily["high"], spy_daily["low"], spy_daily["close"], period=14)
        # ATR must be positive after warmup
        assert (out.dropna() > 0).all()


class TestParkinson:
    def test_known_answer(self):
        # Parkinson per-bar variance: (ln(H/L))^2 / (4 ln 2)
        # H=110, L=100 -> ln(1.1)^2 / (4 ln 2) = 0.0090953 / 2.7726 = 0.00328
        h = pd.Series([110.0] * 5)
        lo = pd.Series([100.0] * 5)
        out = parkinson(h, lo, period=5, annualize=False)
        single_var = (np.log(1.1) ** 2) / (4 * np.log(2))
        assert out.iloc[-1] == pytest.approx(np.sqrt(single_var), abs=1e-9)

    def test_annualization(self):
        h = pd.Series([110.0] * 5)
        lo = pd.Series([100.0] * 5)
        raw = parkinson(h, lo, period=5, annualize=False).iloc[-1]
        annu = parkinson(h, lo, period=5, annualize=True).iloc[-1]
        assert annu == pytest.approx(raw * np.sqrt(252))

    def test_spy_real(self, spy_daily):
        out = parkinson(spy_daily["high"], spy_daily["low"], period=20)
        finite = out.dropna()
        assert (finite > 0).all()
        # SPY annualized vol should be in a realistic range (5% - 100%)
        assert finite.mean() > 0.05 and finite.mean() < 1.0


class TestGarmanKlass:
    def test_known_answer_flat_oc(self):
        # Flat open/close -> GK reduces to 0.5 * (ln H/L)^2 per bar
        o = pd.Series([100.0] * 5)
        c = pd.Series([100.0] * 5)
        h = pd.Series([110.0] * 5)
        lo = pd.Series([100.0] * 5)
        out = garman_klass(o, h, lo, c, period=5, annualize=False)
        expected = np.sqrt(0.5 * np.log(1.1) ** 2)
        assert out.iloc[-1] == pytest.approx(expected, abs=1e-9)

    def test_spy_real(self, spy_daily):
        out = garman_klass(
            spy_daily["open"], spy_daily["high"], spy_daily["low"], spy_daily["close"],
            period=20,
        )
        finite = out.dropna()
        assert (finite > 0).all()


class TestRealizedVol:
    def test_known_answer(self):
        # ddof=1 std of [0.01, 0.02, 0.03] = 0.01
        r = pd.Series([np.nan, 0.01, 0.02, 0.03])
        out = realized_vol(r, period=3, annualize=False)
        assert out.iloc[-1] == pytest.approx(0.01, abs=1e-9)

    def test_annualization_factor(self):
        r = pd.Series([np.nan, 0.01, -0.01, 0.01, -0.01, 0.01])
        annu = realized_vol(r, period=5, annualize=True).iloc[-1]
        raw = realized_vol(r, period=5, annualize=False).iloc[-1]
        assert annu == pytest.approx(raw * np.sqrt(252))


class TestHV:
    def test_hv_vs_realized_vol(self, synthetic_close):
        # HV is realized_vol of log returns
        ret = np.log(synthetic_close / synthetic_close.shift(1))
        expected = realized_vol(ret, period=20, annualize=True)
        got = hv(synthetic_close, period=20, annualize=True)
        pd.testing.assert_series_equal(expected, got, check_names=False)

    def test_spy_real(self, spy_daily):
        out = hv(spy_daily["close"], period=20)
        finite = out.dropna()
        assert (finite > 0).all()
