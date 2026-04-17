"""Tests for trend indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.indicators.trend import sma, ema, kama, donchian, ichimoku


class TestSMA:
    def test_known_answer(self):
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
        out = sma(s, 3)
        assert pd.isna(out.iloc[0]) and pd.isna(out.iloc[1])
        assert out.iloc[2] == pytest.approx(2.0)
        assert out.iloc[3] == pytest.approx(3.0)
        assert out.iloc[4] == pytest.approx(4.0)

    def test_invalid_period(self):
        with pytest.raises(ValueError):
            sma(pd.Series([1.0]), 0)

    def test_preserve_index(self, synthetic_close):
        out = sma(synthetic_close, 20)
        assert out.index.equals(synthetic_close.index)


class TestEMA:
    def test_known_answer(self):
        # adjust=False: y_t = alpha*x_t + (1-alpha)*y_{t-1}, y_0=x_0
        s = pd.Series([1.0, 2.0, 3.0])
        out = ema(s, 2, adjust=False)  # alpha = 2/3
        assert out.iloc[0] == pytest.approx(1.0)
        assert out.iloc[1] == pytest.approx(2/3*2 + 1/3*1)  # 1.6667
        assert out.iloc[2] == pytest.approx(2/3*3 + 1/3*(2/3*2 + 1/3))  # 2.5556

    def test_preserve_dtype(self, synthetic_close):
        out = ema(synthetic_close, 10)
        assert out.dtype == np.float64


class TestKAMA:
    # Kaufman's original KAMA worked example (from "New Trading Systems and
    # Methods", 5e, p. 791). The first 10 closes are used as seeds; then
    # KAMA is iterated with er_period=10, fast=2, slow=30. We verify
    # convergence properties rather than his exact numbers (which used 2dp
    # rounding at each step).
    def test_seed_bar(self):
        s = pd.Series([10.0, 11.0, 12.0, 11.5, 12.5, 13.0, 12.5, 13.5, 14.0, 13.5], dtype="float64")
        # KAMA on length=10 should be NaN for indices 0..9 because er_period=10
        out = kama(pd.concat([s, pd.Series([14.5], dtype="float64")]).reset_index(drop=True), er_period=10)
        # First 10 NaN, index 10 is seed = mean of indices 0..9 = 12.35
        assert pd.isna(out.iloc[9])
        assert out.iloc[10] == pytest.approx(np.mean(s), abs=1e-9)

    def test_kama_trending(self):
        # In a strong monotone trend, KAMA should track close to price
        n = 50
        prices = pd.Series(np.linspace(100.0, 200.0, n), dtype="float64")
        out = kama(prices, er_period=10, fast=2, slow=30)
        # After enough iterations, KAMA should be within a few % of price
        # because ER ~= 1 -> SC ~= fastest^2 ~= 0.444
        tail_err = (out.iloc[-1] - prices.iloc[-1]) / prices.iloc[-1]
        assert abs(tail_err) < 0.05

    def test_kama_flat(self):
        # Flat market: ER -> 0 so SC -> slowest^2 ~= 1/15.5^2 ~= 0.0042
        # KAMA should stay essentially constant after the seed
        prices = pd.Series([100.0] * 30, dtype="float64")
        out = kama(prices, er_period=10, fast=2, slow=30)
        tail = out.iloc[10:].dropna()
        assert tail.std() < 1e-6
        assert tail.iloc[0] == pytest.approx(100.0)

    def test_warmup_nans(self, synthetic_close):
        out = kama(synthetic_close, er_period=10)
        assert out.iloc[:10].isna().all()
        assert not pd.isna(out.iloc[10])

    def test_fast_slow_validation(self):
        with pytest.raises(ValueError):
            kama(pd.Series([1.0, 2.0, 3.0]), er_period=10, fast=30, slow=2)

    def test_spy_real(self, spy_daily):
        out = kama(spy_daily["close"], er_period=10)
        # KAMA should be strictly finite after warmup and within the price range
        finite = out.dropna()
        assert finite.min() > spy_daily["low"].min() * 0.9
        assert finite.max() < spy_daily["high"].max() * 1.1


class TestDonchian:
    def test_basic(self):
        h = pd.Series([10, 11, 12, 13, 14, 15], dtype="float64")
        lo = pd.Series([9, 10, 11, 12, 13, 14], dtype="float64")
        out = donchian(h, lo, period=3)
        assert list(out.columns) == ["upper", "middle", "lower"]
        assert pd.isna(out["upper"].iloc[0]) and pd.isna(out["upper"].iloc[1])
        # Index 2 — window is rows 0..2
        assert out["upper"].iloc[2] == pytest.approx(12)
        assert out["lower"].iloc[2] == pytest.approx(9)
        assert out["middle"].iloc[2] == pytest.approx(10.5)

    def test_spy_real(self, spy_daily):
        out = donchian(spy_daily["high"], spy_daily["low"], period=20)
        assert (out["upper"].dropna() >= out["lower"].dropna()).all()
        assert ((out["middle"] - (out["upper"] + out["lower"]) / 2).dropna().abs() < 1e-9).all()


class TestIchimoku:
    def test_shape(self, synthetic_ohlcv):
        out = ichimoku(synthetic_ohlcv["high"], synthetic_ohlcv["low"], synthetic_ohlcv["close"])
        assert set(out.columns) == {"tenkan", "kijun", "senkou_a", "senkou_b", "chikou"}
        assert out.index.equals(synthetic_ohlcv.index)

    def test_tenkan_vs_kijun(self, synthetic_ohlcv):
        out = ichimoku(synthetic_ohlcv["high"], synthetic_ohlcv["low"], synthetic_ohlcv["close"])
        # Tenkan has shorter lookback -> its warmup ends sooner
        assert out["tenkan"].iloc[8:20].notna().any()
        assert out["kijun"].iloc[:25].isna().all()

    def test_chikou_shift(self, synthetic_ohlcv):
        out = ichimoku(synthetic_ohlcv["high"], synthetic_ohlcv["low"], synthetic_ohlcv["close"])
        # Chikou should equal close shifted -26
        expected = synthetic_ohlcv["close"].shift(-26)
        pd.testing.assert_series_equal(
            out["chikou"].rename("close"),
            expected,
            check_names=False,
        )
