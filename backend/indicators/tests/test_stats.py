"""Tests for stats indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from indicators.stats import (
    zscore,
    pct_rank,
    ewma,
    ou_half_life,
    hurst,
    engle_granger_adf,
    ols_hedge_ratio,
    kalman_hedge_ratio,
)


class TestZscore:
    def test_known_answer(self):
        # Rolling mean/std of [1,2,3,4,5] over 3: mean=[nan,nan,2,3,4]
        # std = 1.0 each (ddof=1). z = (x - mean)/std
        s = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
        out = zscore(s, 3)
        assert pd.isna(out.iloc[0]) and pd.isna(out.iloc[1])
        assert out.iloc[2] == pytest.approx(1.0)  # (3-2)/1
        assert out.iloc[3] == pytest.approx(1.0)
        assert out.iloc[4] == pytest.approx(1.0)

    def test_zero_std(self):
        # Flat -> std is 0 -> z-score is NaN (not inf)
        out = zscore(pd.Series([5.0, 5.0, 5.0, 5.0]), 3)
        assert out.iloc[-1] != out.iloc[-1]


class TestPctRank:
    def test_known_answer(self):
        # Today tied with one other and above one: 2/3 = 0.6667
        s = pd.Series([1.0, 2.0, 1.5])
        out = pct_rank(s, 3)
        assert out.iloc[2] == pytest.approx(2 / 3, abs=1e-9)

    def test_max_value(self):
        # Most recent is the max -> rank = 1.0
        s = pd.Series([1.0, 2.0, 3.0, 10.0])
        out = pct_rank(s, 4)
        assert out.iloc[-1] == pytest.approx(1.0)


class TestEWMA:
    def test_matches_pandas(self):
        s = pd.Series([1.0, 2.0, 3.0, 4.0])
        expected = s.ewm(span=3, adjust=False).mean()
        got = ewma(s, span=3)
        pd.testing.assert_series_equal(expected.astype("float64"), got, check_names=False)


class TestOUHalfLife:
    def test_synthetic_mean_reverting(self):
        # Simulate OU: x_{t+1} = mu + phi*(x_t - mu) + eps,  phi<1
        # Half-life = -ln(2) / ln(phi)
        rng = np.random.default_rng(12345)
        n = 1000
        phi = 0.9
        mu = 0.0
        x = np.zeros(n)
        for t in range(1, n):
            x[t] = mu + phi * (x[t - 1] - mu) + rng.normal(0, 0.1)
        half = ou_half_life(pd.Series(x))
        # Expected half-life: ln(2) / (-ln(phi)) = 0.693 / 0.1054 = 6.58 bars
        expected = -np.log(2) / np.log(phi)
        assert abs(half - expected) < 1.5  # noisy estimator tolerance

    def test_random_walk_nan(self):
        # RW: Δx has zero drift to prior level -> beta ~0, not negative -> NaN
        rng = np.random.default_rng(7)
        x = np.cumsum(rng.normal(0, 1, 500))
        half = ou_half_life(pd.Series(x))
        assert pd.isna(half) or half > 100  # either flagged or huge


class TestHurst:
    def test_random_walk(self):
        rng = np.random.default_rng(42)
        rw = np.cumsum(rng.normal(0, 1, 5000))
        h = hurst(pd.Series(rw), min_lag=2, max_lag=100)
        # RW should have Hurst ~ 0.5
        assert abs(h - 0.5) < 0.1

    def test_mean_reverting(self):
        # AR(1) with |phi| < 1 (anti-persistent increments) -> H < 0.5
        # (Fama/French mean-reversion signal.)
        rng = np.random.default_rng(42)
        n = 5000
        phi = 0.5  # mean-reverting
        x = np.zeros(n)
        for t in range(1, n):
            x[t] = phi * x[t - 1] + rng.normal(0, 1)
        h = hurst(pd.Series(x), min_lag=2, max_lag=100)
        # Mean-reverting series yields H < 0.5 with this estimator
        assert h < 0.5


class TestEngleGranger:
    def test_cointegrated_pair(self):
        rng = np.random.default_rng(2024)
        n = 500
        x = np.cumsum(rng.normal(0, 1, n))
        # y = 2*x + stationary noise -> cointegrated at beta=2
        y = 2 * x + rng.normal(0, 0.5, n)
        pval, adf_stat, beta, resid = engle_granger_adf(pd.Series(y), pd.Series(x))
        assert pval < 0.05  # reject null of no cointegration
        assert abs(beta - 2.0) < 0.1

    def test_non_cointegrated(self):
        rng = np.random.default_rng(99)
        n = 500
        x = np.cumsum(rng.normal(0, 1, n))
        y = np.cumsum(rng.normal(0, 1, n))  # independent RW
        pval, adf_stat, beta, resid = engle_granger_adf(pd.Series(y), pd.Series(x))
        # Independent RWs should not reject null
        assert pval > 0.01

    def test_too_short(self):
        with pytest.raises(ValueError):
            engle_granger_adf(pd.Series([1.0, 2.0]), pd.Series([1.0, 2.0]))


class TestOLSHedgeRatio:
    def test_known_answer(self):
        # y = 3 + 2*x exactly
        x = pd.Series([1.0, 2.0, 3.0, 4.0, 5.0])
        y = 3 + 2 * x
        assert ols_hedge_ratio(y, x) == pytest.approx(2.0)


class TestKalmanHedgeRatio:
    def test_converges_on_static_relationship(self):
        # Static relationship y = 0.5 + 2*x + tiny noise
        rng = np.random.default_rng(777)
        n = 500
        x = np.cumsum(rng.normal(0, 1, n))
        y = 0.5 + 2.0 * x + rng.normal(0, 0.01, n)
        beta = kalman_hedge_ratio(pd.Series(y), pd.Series(x), delta=1e-4, r=1e-2)
        # Kalman beta should converge toward 2.0 in the tail
        tail = beta.dropna().iloc[-50:]
        assert abs(tail.mean() - 2.0) < 0.2

    def test_tracks_regime_change(self):
        rng = np.random.default_rng(13)
        n = 400
        x = np.cumsum(rng.normal(0, 1, n))
        y = np.empty(n)
        # Regime 1: beta=1 for first 200, Regime 2: beta=3 for next 200
        for t in range(n):
            beta_true = 1.0 if t < 200 else 3.0
            y[t] = beta_true * x[t] + rng.normal(0, 0.1)
        beta_hat = kalman_hedge_ratio(pd.Series(y), pd.Series(x), delta=1e-3, r=1e-2)
        # Tail should be nearer to 3 than to 1
        assert beta_hat.iloc[-1] > 2.0
