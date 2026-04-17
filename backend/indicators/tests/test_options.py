"""Tests for options indicators."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from backend.indicators.options import (
    bs_price,
    bs_greeks,
    iv_from_price,
    iv_rank,
    iv_percentile,
    term_structure_slope,
)


class TestBSPrice:
    def test_canonical_atm_call(self):
        # Spot=100, strike=100, tau=0.25, r=5%, q=0, sigma=20% -> call ~ 4.6149
        # Reference: published BS calculator; Hull textbook problem 13.4.
        price = bs_price(100, 100, 0.25, 0.05, 0.0, 0.20, "call")
        assert price == pytest.approx(4.6149, abs=0.01)

    def test_put_call_parity(self):
        # C - P = S*e^{-qT} - K*e^{-rT}
        S, K, T, r, q, sigma = 100, 95, 0.5, 0.04, 0.02, 0.25
        c = bs_price(S, K, T, r, q, sigma, "call")
        p = bs_price(S, K, T, r, q, sigma, "put")
        parity_lhs = c - p
        parity_rhs = S * np.exp(-q * T) - K * np.exp(-r * T)
        assert parity_lhs == pytest.approx(parity_rhs, abs=1e-6)

    def test_intrinsic_at_expiration(self):
        # At expiry (tau=0), option = intrinsic
        assert bs_price(105, 100, 0, 0.05, 0, 0.2, "call") == pytest.approx(5.0)
        assert bs_price(95, 100, 0, 0.05, 0, 0.2, "put") == pytest.approx(5.0)
        assert bs_price(95, 100, 0, 0.05, 0, 0.2, "call") == pytest.approx(0.0)

    def test_zero_vol(self):
        # sigma=0 -> deterministic payoff discounted back. Our implementation
        # returns intrinsic (common simplification for zero-vol edge case).
        price = bs_price(105, 100, 0.5, 0.0, 0.0, 0.0, "call")
        assert price == pytest.approx(5.0)


class TestBSGreeks:
    def test_atm_call_greeks(self):
        # Spot=100, K=100, T=0.25, r=5%, q=0, sigma=20%
        g = bs_greeks(100, 100, 0.25, 0.05, 0.0, 0.20, "call")
        # For ATM call, delta ~= 0.55; Hull ex. 17.6 gives specific numbers.
        assert 0.45 < g["delta"] < 0.65
        assert g["gamma"] > 0
        assert g["vega"] > 0
        assert g["theta"] < 0  # long call decays

    def test_put_call_delta_relationship(self):
        # For same strike/tau/r/q/sigma: C_delta - P_delta = e^{-qT}
        g_c = bs_greeks(100, 100, 0.25, 0.05, 0.0, 0.20, "call")
        g_p = bs_greeks(100, 100, 0.25, 0.05, 0.0, 0.20, "put")
        assert (g_c["delta"] - g_p["delta"]) == pytest.approx(1.0, abs=1e-6)
        # gamma and vega are identical for calls and puts
        assert g_c["gamma"] == pytest.approx(g_p["gamma"])
        assert g_c["vega"] == pytest.approx(g_p["vega"])

    def test_greeks_with_dividend(self):
        g = bs_greeks(100, 100, 0.25, 0.05, 0.03, 0.20, "call")
        # e^{-qT} ~= 0.9925 -> delta is slightly smaller than zero-div case
        g0 = bs_greeks(100, 100, 0.25, 0.05, 0.0, 0.20, "call")
        assert g["delta"] < g0["delta"]


class TestIVFromPrice:
    def test_round_trip(self):
        # Price a call with sigma=0.30, then recover sigma via iv_from_price
        S, K, T, r, q, sigma = 100, 100, 0.5, 0.03, 0.01, 0.30
        price = bs_price(S, K, T, r, q, sigma, "call")
        iv = iv_from_price(price, S, K, T, r, q, "call")
        assert iv == pytest.approx(sigma, abs=1e-4)

    def test_round_trip_put(self):
        S, K, T, r, q, sigma = 100, 110, 0.25, 0.04, 0.0, 0.40
        price = bs_price(S, K, T, r, q, sigma, "put")
        iv = iv_from_price(price, S, K, T, r, q, "put")
        assert iv == pytest.approx(sigma, abs=1e-4)

    def test_out_of_bounds_price(self):
        # Price above upper bound -> NaN
        iv = iv_from_price(1000.0, 100, 100, 0.25, 0.05, 0, "call")
        assert np.isnan(iv)


class TestIVRank:
    def test_known_answer(self):
        # Vol series with min=0.1, max=0.5, current=0.3 -> rank=0.5
        s = pd.Series([0.1, 0.2, 0.5, 0.4, 0.3])
        out = iv_rank(s, lookback_days=5)
        assert out.iloc[-1] == pytest.approx(0.5, abs=1e-9)

    def test_warmup(self):
        s = pd.Series(np.linspace(0.1, 0.5, 10))
        out = iv_rank(s, lookback_days=5)
        assert out.iloc[:4].isna().all()


class TestIVPercentile:
    def test_known_answer(self):
        # Current IV strictly greater than all 4 prior -> percentile=1.0
        s = pd.Series([0.1, 0.2, 0.15, 0.3, 0.5])
        out = iv_percentile(s, lookback_days=5)
        assert out.iloc[-1] == pytest.approx(1.0)

    def test_mid(self):
        # current=0.3 beats 2 of 4 prior (0.1, 0.2) -> 2/4 = 0.5
        s = pd.Series([0.1, 0.2, 0.4, 0.5, 0.3])
        out = iv_percentile(s, lookback_days=5)
        assert out.iloc[-1] == pytest.approx(0.5)


class TestTermStructureSlope:
    def test_front_minus_back(self):
        df = pd.DataFrame(
            {
                "expiration": ["2024-01-15", "2024-03-15", "2024-06-15"],
                "atm_iv": [0.35, 0.30, 0.28],
            }
        )
        slope = term_structure_slope(df)
        assert slope == pytest.approx(0.07, abs=1e-9)

    def test_single_expiry(self):
        df = pd.DataFrame({"expiration": ["2024-01-15"], "atm_iv": [0.25]})
        assert np.isnan(term_structure_slope(df))

    def test_missing_columns(self):
        df = pd.DataFrame({"expiration": ["2024-01-15"]})
        with pytest.raises(ValueError):
            term_structure_slope(df)
