"""Tests for volume indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from indicators.volume import vwap_session, vwap_rolling, obv, volume_zscore


class TestVWAPSession:
    def test_single_session(self):
        idx = pd.date_range("2024-01-02 09:30", periods=3, freq="1min")
        df = pd.DataFrame(
            {
                "high": [101.0, 102.0, 103.0],
                "low": [99.0, 100.0, 101.0],
                "close": [100.0, 101.0, 102.0],
                "volume": [1000.0, 2000.0, 3000.0],
            },
            index=idx,
        )
        out = vwap_session(df)
        # Typical prices: 100, 101, 102; PV cum: 100000, 302000, 608000
        # Vol cum: 1000, 3000, 6000 => VWAP: 100, 100.6667, 101.3333
        assert out.iloc[0] == pytest.approx(100.0)
        assert out.iloc[1] == pytest.approx(100.66666667, abs=1e-6)
        assert out.iloc[2] == pytest.approx(101.33333333, abs=1e-6)

    def test_two_sessions_date_grouping(self):
        idx = pd.DatetimeIndex(
            [
                "2024-01-02 09:30", "2024-01-02 09:31",
                "2024-01-03 09:30", "2024-01-03 09:31",
            ]
        )
        df = pd.DataFrame(
            {
                "high": [101, 102, 201, 202],
                "low": [99, 100, 199, 200],
                "close": [100, 101, 200, 201],
                "volume": [1000, 1000, 1000, 1000],
            },
            index=idx,
            dtype="float64",
        )
        out = vwap_session(df)
        # Session 1: typicals 100, 101 -> cum PV 100k, 201k; cum vol 1k, 2k -> 100, 100.5
        # Session 2: typicals 200, 201 -> cum PV 200k, 401k; cum vol 1k, 2k -> 200, 200.5
        assert out.iloc[0] == pytest.approx(100.0)
        assert out.iloc[1] == pytest.approx(100.5)
        assert out.iloc[2] == pytest.approx(200.0)
        assert out.iloc[3] == pytest.approx(200.5)

    def test_two_sessions_flag_column(self):
        df = pd.DataFrame(
            {
                "high": [101, 102, 201, 202],
                "low": [99, 100, 199, 200],
                "close": [100, 101, 200, 201],
                "volume": [1000, 1000, 1000, 1000],
                "session_start": [True, False, True, False],
            }
        )
        out = vwap_session(df)
        assert out.iloc[0] == pytest.approx(100.0)
        assert out.iloc[1] == pytest.approx(100.5)
        assert out.iloc[2] == pytest.approx(200.0)
        assert out.iloc[3] == pytest.approx(200.5)

    def test_missing_columns(self):
        df = pd.DataFrame({"high": [1], "low": [1], "close": [1]})
        with pytest.raises(ValueError):
            vwap_session(df)


class TestVWAPRolling:
    def test_known_answer(self):
        h = pd.Series([101, 102, 103, 104], dtype="float64")
        lo = pd.Series([99, 100, 101, 102], dtype="float64")
        c = pd.Series([100, 101, 102, 103], dtype="float64")
        v = pd.Series([1000, 1000, 1000, 1000], dtype="float64")
        out = vwap_rolling(h, lo, c, v, period=2)
        # Index 1: typicals 100, 101 -> (100+101)/2 = 100.5
        assert pd.isna(out.iloc[0])
        assert out.iloc[1] == pytest.approx(100.5)
        assert out.iloc[2] == pytest.approx(101.5)
        assert out.iloc[3] == pytest.approx(102.5)

    def test_spy_real(self, spy_daily):
        out = vwap_rolling(
            spy_daily["high"], spy_daily["low"], spy_daily["close"],
            spy_daily["volume"], period=20,
        )
        finite = out.dropna()
        # VWAP should sit between min(low) and max(high) for the window
        assert finite.min() > spy_daily["low"].min() * 0.9
        assert finite.max() < spy_daily["high"].max() * 1.1


class TestOBV:
    def test_known_answer(self):
        c = pd.Series([100, 101, 100, 102, 102], dtype="float64")
        v = pd.Series([1000, 2000, 3000, 4000, 5000], dtype="float64")
        out = obv(c, v)
        # delta: NaN, +, -, +, 0
        # OBV: 0, +2000=2000, -3000=-1000, +4000=3000, +0=3000
        assert out.iloc[0] == 0.0
        assert out.iloc[1] == 2000.0
        assert out.iloc[2] == -1000.0
        assert out.iloc[3] == 3000.0
        assert out.iloc[4] == 3000.0

    def test_spy_real(self, spy_daily):
        out = obv(spy_daily["close"], spy_daily["volume"])
        # OBV is finite and has same length
        assert len(out) == len(spy_daily)
        assert out.notna().all()


class TestVolumeZscore:
    def test_basic(self):
        v = pd.Series([100, 100, 100, 100, 200], dtype="float64")
        # Rolling 4 at index 4: mean of [100,100,100,200]=125, std=50
        # z = (200 - 125) / 50 = 1.5
        out = volume_zscore(v, period=4)
        assert out.iloc[4] == pytest.approx(1.5, abs=1e-9)

    def test_spy_real(self, spy_daily):
        out = volume_zscore(spy_daily["volume"], period=20)
        finite = out.dropna()
        # Z-score of volume should have near-zero rolling mean
        assert abs(finite.mean()) < 2.0
