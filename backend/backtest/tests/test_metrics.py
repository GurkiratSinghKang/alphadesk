"""Tests for backend.backtest.metrics."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from backtest import metrics as M


RNG = np.random.default_rng(42)


def _sample_returns(n=252, mu=0.0005, sigma=0.01) -> pd.Series:
    """Deterministic sample return series."""

    rng = np.random.default_rng(42)
    return pd.Series(rng.normal(mu, sigma, n))


def test_sharpe_of_flat_returns_is_zero():
    r = pd.Series([0.0] * 100)
    assert M.sharpe(r) == 0.0


def test_sharpe_scales_with_reward_over_risk():
    # All positive constant returns -> std is 0, should return 0 (not inf).
    r = pd.Series([0.001] * 100)
    assert M.sharpe(r) == 0.0

    # Sample with positive drift.
    r = _sample_returns(n=1000, mu=0.0010, sigma=0.005)
    s = M.sharpe(r)
    # Theoretical Sharpe ≈ 0.001 / 0.005 * sqrt(252) ≈ 3.17
    assert s > 2.0
    assert s < 5.0


def test_sortino_matches_sharpe_when_no_downside():
    r = pd.Series([0.001] * 100)
    # No downside -> 0.
    assert M.sortino(r) == 0.0


def test_max_drawdown_on_known_curve():
    eq = pd.Series([100, 120, 110, 90, 130])
    # Running max: [100, 120, 120, 120, 130]
    # drawdown at idx 3: 90/120 - 1 = -0.25
    assert math.isclose(M.max_drawdown(eq), 0.25, rel_tol=1e-6)


def test_cagr_flat_line():
    eq = pd.Series([100.0] * 252)
    # ~1 year, no growth.
    assert math.isclose(M.cagr(eq), 0.0, abs_tol=1e-6)


def test_cagr_with_growth():
    # 100 -> 120 over 252 days ≈ 20% CAGR
    eq = pd.Series(np.linspace(100.0, 120.0, 252))
    c = M.cagr(eq)
    assert 0.18 < c < 0.22


def test_hit_rate_and_profit_factor():
    pnls = pd.Series([100, -50, 30, -10, 70])
    assert math.isclose(M.hit_rate(pnls), 0.6)
    # wins=200, losses=60 -> pf ≈ 3.333
    assert math.isclose(M.profit_factor(pnls), 200 / 60)


def test_profit_factor_no_losses_is_inf():
    pnls = pd.Series([1.0, 2.0, 3.0])
    assert M.profit_factor(pnls) == float("inf")


def test_profit_factor_no_wins_is_zero():
    pnls = pd.Series([-1.0, -2.0])
    assert M.profit_factor(pnls) == 0.0


def test_turnover_ratio():
    notional = pd.Series([100, 200, 300])
    eq = pd.Series([1000, 1000, 1000])
    # 600 / 1000 = 0.6
    assert math.isclose(M.turnover(notional, eq), 0.6)


def test_tail_ratio_positive_series():
    r = _sample_returns(n=500)
    t = M.tail_ratio(r)
    # Should be a positive finite number.
    assert t > 0
    assert math.isfinite(t)


def test_alpha_beta_against_self_gives_beta_one():
    b = _sample_returns(n=200, mu=0.0005)
    # Strategy == benchmark -> beta = 1, alpha = 0 exactly.
    a, beta = M.alpha_beta(b, b)
    assert math.isclose(beta, 1.0, rel_tol=1e-6)
    assert math.isclose(a, 0.0, abs_tol=1e-6)


def test_alpha_beta_against_scaled_benchmark():
    b = _sample_returns(n=400, mu=0.0)
    r = 0.5 * b  # half the movement, no alpha
    a, beta = M.alpha_beta(r, b)
    assert math.isclose(beta, 0.5, rel_tol=1e-6)
    assert abs(a) < 1e-6


def test_summary_dict_has_all_keys():
    eq = pd.Series(np.linspace(100, 110, 252))
    returns = eq.pct_change().dropna()
    pnls = pd.Series([10, -5, 20])
    bench = eq.pct_change().dropna()
    notional = pd.Series(np.ones(252) * 100)
    d = M.summary_dict(eq, returns, pnls, bench, notional)
    for k in [
        "sharpe",
        "sortino",
        "calmar",
        "max_drawdown",
        "cagr",
        "turnover",
        "hit_rate",
        "profit_factor",
        "tail_ratio",
        "alpha",
        "beta",
    ]:
        assert k in d
    assert all(isinstance(v, float) for v in d.values())


def test_handles_equity_curve_via_pct_change():
    eq = pd.Series([100.0, 101.0, 99.0, 102.0])
    # If sharpe is called with an equity-like series, it should convert.
    r = eq.pct_change().dropna()
    s1 = M.sharpe(r)
    s2 = M.sharpe(eq)
    assert math.isclose(s1, s2, rel_tol=1e-6)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
