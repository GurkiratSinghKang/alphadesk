"""Unit tests for the cointegration-gated Pairs Trading strategy.

Tests exercise the strategy with a deterministic fake bar provider so they
run fast and hermetically. We verify the audit's non-negotiable invariants
and the core math:

1. Engle-Granger ADF gate filters out non-cointegrated pairs.
2. z-score entry at |z| >= z_entry triggers *two* coincident signals with
   opposite target_weight signs (dollar-neutral).
3. Mean-revert exit at |z| < z_exit closes BOTH legs.
4. Structural-break watchdog force-closes broken pairs.
5. Kalman hedge ratio tracks parameter drift (monotonicity test).

Import gymnastics: the conftest stubs ``backend.strategies`` before importing
the pairs_trading subpackage so the legacy eager-import init doesn't fire.
"""

from __future__ import annotations

import os as _os
import sys as _sys
import types as _types
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path as _Path

_ROOT = _Path(__file__).resolve().parents[4]
for _p in (_ROOT, _ROOT / "backend"):
    _ps = str(_p)
    if _ps not in _sys.path:
        _sys.path.insert(0, _ps)

if "backend" not in _sys.modules:
    _b = _types.ModuleType("backend")
    _b.__path__ = [str(_ROOT / "backend")]
    _b.__file__ = "(stub)"
    _sys.modules["backend"] = _b

if "backend.strategies" not in _sys.modules:
    _s = _types.ModuleType("backend.strategies")
    _s.__path__ = [str(_ROOT / "backend" / "strategies")]
    _s.__file__ = "(stub)"
    _sys.modules["backend.strategies"] = _s

import numpy as np
import pandas as pd
import pytest

import backend.strategies.pairs_trading  # noqa: F401 - decorator side effect

from backend.backtest.types import Context
from backend.strategies.pairs_trading.config import UNIVERSE
from backend.strategies.pairs_trading.strategy import PairsTradingStrategy


# --------------------------------------------------------------------------- #
# Test fixtures                                                               #
# --------------------------------------------------------------------------- #
class SyntheticBarProvider:
    """Return a wide DataFrame of closes for the strategy's fetch helper.

    The strategy pivots the provider's output into a symbol x date matrix,
    so we simply flatten a pre-built DataFrame into long form.
    """

    def __init__(self, closes: pd.DataFrame) -> None:
        # closes: index is date; columns are symbols; values are closes.
        self._closes = closes.sort_index()

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = [s.upper() for s in symbols]
        rows: list[dict] = []
        mask = (self._closes.index >= pd.Timestamp(start)) & (
            self._closes.index <= pd.Timestamp(end) + pd.Timedelta(hours=23, minutes=59)
        )
        sub = self._closes.loc[mask, [s for s in syms if s in self._closes.columns]]
        for ts, row in sub.iterrows():
            for sym in sub.columns:
                px = row[sym]
                if pd.isna(px):
                    continue
                rows.append({
                    "symbol": sym,
                    "timestamp": ts,
                    "open": float(px),
                    "high": float(px),
                    "low": float(px),
                    "close": float(px),
                    "volume": 1_000_000,
                })
        return pd.DataFrame(rows)


def _build_context(
    asof: date,
    bar_provider: SyntheticBarProvider,
    state: dict | None = None,
) -> Context:
    return Context(
        asof=asof,
        cash=Decimal("100000"),
        equity=Decimal("100000"),
        positions=[],
        bar_provider=bar_provider,
        state=state if state is not None else {},
    )


def _make_cointegrated_closes(
    n_bars: int = 500, seed: int = 7, beta: float = 1.2, pv_shock: float = 0.0
) -> pd.DataFrame:
    """Build a 2-ticker closes matrix where y = beta*x + stationary noise.

    x is a random walk; eps is mean-reverting AR(1). This mirrors the
    Engle-Granger data-generating process.
    """

    rng = np.random.default_rng(seed)
    # x as geometric random walk with small drift
    x_ret = rng.normal(0, 0.01, n_bars)
    x = 100.0 * np.exp(np.cumsum(x_ret))
    # eps as AR(1) with rho=0.9 (mean-reverting)
    eps = np.zeros(n_bars)
    shock = rng.normal(0, 1.0, n_bars)
    for t in range(1, n_bars):
        eps[t] = 0.9 * eps[t - 1] + shock[t]
    # Inject an optional late-sample shock to move z far from the mean.
    if pv_shock != 0.0:
        eps[-10:] += pv_shock
    y = beta * x + eps

    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    return pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)


def _make_noncointegrated_closes(
    n_bars: int = 500, seed: int = 11
) -> pd.DataFrame:
    """Two independent random walks — *not* cointegrated."""

    rng = np.random.default_rng(seed)
    a = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.012, n_bars)))
    b = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.013, n_bars)))
    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    return pd.DataFrame({"JNJ": a, "PFE": b}, index=idx)


# --------------------------------------------------------------------------- #
# Metadata                                                                    #
# --------------------------------------------------------------------------- #
def test_registered_with_expected_meta() -> None:
    from backend.strategies.registry import get_meta

    meta = get_meta("pairs_trading")
    assert meta.name == "pairs_trading"
    assert meta.category == "pairs"
    assert meta.supports_shorts is True
    assert meta.required_bars == ("daily",)
    assert meta.required_lookback_days >= 300


def test_configure_applies_defaults_and_overrides() -> None:
    s = PairsTradingStrategy()
    s.configure({"z_entry": 2.5, "max_pairs": 3, "hedge_method": "kalman"})
    assert s.params["z_entry"] == pytest.approx(2.5)
    assert s.params["max_pairs"] == 3
    assert s.params["hedge_method"] == "kalman"
    # Defaults preserved for unspecified keys.
    assert "z_exit" in s.params


# --------------------------------------------------------------------------- #
# (a) Engle-Granger ADF gate filters non-cointegrated pairs
# --------------------------------------------------------------------------- #
def test_eg_adf_gate_rejects_noncointegrated() -> None:
    """Two independent random walks should fail the ADF p-value gate."""

    from backend.indicators.stats import engle_granger_adf

    closes = _make_noncointegrated_closes(n_bars=400, seed=11)
    # Engle-Granger on two random walks usually fails the 0.05 gate
    pv, adf, beta, res = engle_granger_adf(closes["JNJ"], closes["PFE"])
    # We don't assert p>0.05 strictly (random walks sometimes look
    # cointegrated by chance). Instead we check the test returns a finite
    # number and that the strategy screen drops pairs when pv > threshold.
    assert np.isfinite(pv)
    s = PairsTradingStrategy()
    s.configure({"adf_pvalue_max": 0.0001, "hurst_max": 0.49})  # very strict

    # Stuff the synthetic closes into the full universe frame (so the
    # screen's pivot pipeline sees them). Non-listed symbols get NaN.
    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    full["JNJ"] = closes["JNJ"].values
    full["PFE"] = closes["PFE"].values
    provider = SyntheticBarProvider(full)
    ctx = _build_context(closes.index[-1].date(), provider)
    active = s._rescreen(closes.index[-1].date(), ctx)
    assert not any(p.pair_id == "JNJ-PFE" for p in active), (
        "Non-cointegrated pair admitted despite strict adf_pvalue_max"
    )


def test_eg_adf_gate_admits_cointegrated() -> None:
    """A synthetic cointegrated AAPL/MSFT pair should pass the gate."""

    closes = _make_cointegrated_closes(n_bars=400, seed=3)
    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    full["AAPL"] = closes["AAPL"].values
    full["MSFT"] = closes["MSFT"].values
    provider = SyntheticBarProvider(full)

    s = PairsTradingStrategy()
    s.configure({
        "adf_pvalue_max": 0.10,
        "ou_halflife_max_days": 50.0,
        "hurst_max": 0.55,
        "max_pairs": 5,
    })
    ctx = _build_context(closes.index[-1].date(), provider)
    active = s._rescreen(closes.index[-1].date(), ctx)
    assert any(p.pair_id == "AAPL-MSFT" for p in active), (
        f"Synthetic cointegrated pair not admitted. Active: "
        f"{[p.pair_id for p in active]}"
    )


# --------------------------------------------------------------------------- #
# (b) Entry triggers TWO signals with opposite target_weight signs
# --------------------------------------------------------------------------- #
def test_entry_emits_two_legs_with_opposite_signs() -> None:
    """Pre-seed an active cointegrated pair with a known dislocation and
    verify that ``generate_signals`` emits two coincident signals with
    opposite target_weight signs.

    Separating the admission test (covered above) from the entry test lets
    us inject a precise z-score without perturbing the p-value calculation.
    """

    # Build a pure synthetic spread with a known stationary mean and a
    # terminal dislocation of ~3 sigma. We don't need to pass the admission
    # gate here — we skip straight to the trading phase by pre-seeding the
    # active list.
    rng = np.random.default_rng(17)
    n = 300
    x = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    eps = np.zeros(n)
    sh = rng.normal(0, 1.0, n)
    for t in range(1, n):
        eps[t] = 0.9 * eps[t - 1] + sh[t]
    beta_true = 1.2
    y = beta_true * x + eps
    # Terminal dislocation: force the last close to have z ~ +2.5 by
    # pushing y up by 2.5 * stationary-std over the last bar only so the
    # rolling mean (which excludes today) is not affected.
    idx = pd.date_range("2018-01-02", periods=n, freq="B")
    closes = pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)
    spread = closes["AAPL"] - beta_true * closes["MSFT"]
    # Last-bar-only shock so today's z is high but rolling stats on prior
    # bars are unaffected.
    shock = 3.0 * float(spread.tail(90).std())
    closes.iloc[-1, closes.columns.get_loc("AAPL")] += shock

    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    full["AAPL"] = closes["AAPL"].values
    full["MSFT"] = closes["MSFT"].values
    provider = SyntheticBarProvider(full)

    from backend.strategies.pairs_trading.strategy import ActivePair

    s = PairsTradingStrategy()
    s.configure({
        "z_entry": 1.5,
        "z_stop": 10.0,
        "z_window": 45,
        "max_pairs": 3,
        "rescreen_days": 1000,  # disable rescreen during this test
    })
    asof = closes.index[-1].date()
    active = [ActivePair(
        pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
        beta=float(beta_true), screen_pvalue=0.01, screen_halflife=10.0,
        last_screen_date=asof, last_watchdog_date=asof,
    )]
    state = {
        "pairs_trading.active": active,
        "pairs_trading.last_screen": asof,
    }
    ctx = _build_context(asof, provider, state=state)
    signals = list(s.generate_signals(asof, ctx))
    entry_sigs = [sig for sig in signals if sig.tag.startswith("pairs-entry")]
    assert len(entry_sigs) == 2, (
        f"Dollar-neutral entry must emit exactly two signals; got {len(entry_sigs)}"
    )
    weights = [sig.target_weight for sig in entry_sigs]
    assert weights[0] * weights[1] < 0, (
        f"Two legs must have opposite target_weight signs, got {weights}"
    )
    # Rough dollar-neutrality: the short leg should scale with beta ~ 1.2
    ratio = abs(weights[0]) / abs(weights[1])
    assert 0.4 <= ratio <= 2.5, (
        f"Leg notional ratio off for dollar-neutral pair: {ratio:.3f}"
    )
    # Both legs reference the same logical pair in ctx.state.
    assert "AAPL-MSFT" in state["pairs_trading.positions"]
    pos = state["pairs_trading.positions"]["AAPL-MSFT"]
    assert pos.direction in (-1, +1)


# --------------------------------------------------------------------------- #
# (c) Exit at |z| < z_exit closes BOTH legs
# --------------------------------------------------------------------------- #
def test_mean_revert_exit_closes_both_legs() -> None:
    closes = _make_cointegrated_closes(n_bars=500, seed=9, beta=1.1)
    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    full["AAPL"] = closes["AAPL"].values
    full["MSFT"] = closes["MSFT"].values
    provider = SyntheticBarProvider(full)

    s = PairsTradingStrategy()
    s.configure({
        "adf_pvalue_max": 0.20,
        "ou_halflife_max_days": 80.0,
        "hurst_max": 0.55,
        "z_exit": 5.0,  # set very loose so current |z| is below and we exit
        "z_window": 45,
        "z_stop": 100.0,  # disable stop
    })

    # Pre-seed an active pair + open position in ctx.state.
    from backend.strategies.pairs_trading.strategy import (
        ActivePair, OpenPosition,
    )

    asof = closes.index[-1].date()
    ap = ActivePair(
        pair_id="AAPL-MSFT",
        sector="Tech",
        y="AAPL", x="MSFT",
        beta=1.1,
        screen_pvalue=0.01,
        screen_halflife=10.0,
        last_screen_date=asof,
        last_watchdog_date=asof,
    )
    pos = OpenPosition(
        pair_id="AAPL-MSFT",
        y="AAPL", x="MSFT",
        beta=1.1,
        direction=+1,
        entry_z=-2.0,
        entry_date=asof - timedelta(days=5),
        long_sym="AAPL", short_sym="MSFT",
        long_weight=0.1, short_weight=-0.11,
    )
    state = {
        "pairs_trading.active": [ap],
        "pairs_trading.last_screen": asof,
        "pairs_trading.positions": {"AAPL-MSFT": pos},
    }
    ctx = _build_context(asof, provider, state=state)
    signals = list(s.manage(asof, ctx))
    exit_sigs = [sig for sig in signals if sig.tag.startswith("pairs-exit")]
    assert len(exit_sigs) == 2, (
        f"Mean-revert exit must close both legs, got {len(exit_sigs)} signals"
    )
    syms_closed = {sig.symbol for sig in exit_sigs}
    assert syms_closed == {"AAPL", "MSFT"}
    for sig in exit_sigs:
        assert sig.target_weight == 0.0
    # State cleared.
    assert "AAPL-MSFT" not in state["pairs_trading.positions"]


# --------------------------------------------------------------------------- #
# (d) Structural-break watchdog removes broken pairs
# --------------------------------------------------------------------------- #
def test_watchdog_force_closes_broken_pair() -> None:
    closes = _make_noncointegrated_closes(n_bars=400, seed=21)
    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    full["JNJ"] = closes["JNJ"].values
    full["PFE"] = closes["PFE"].values
    provider = SyntheticBarProvider(full)

    s = PairsTradingStrategy()
    s.configure({
        "watchdog_pvalue": 0.001,  # very strict so the non-coint pair fails
        "watchdog_days": 0,  # force watchdog on every call
        "z_exit": 0.0,  # disable mean-revert so only watchdog fires
        "z_stop": 100.0,
    })
    from backend.strategies.pairs_trading.strategy import (
        ActivePair, OpenPosition,
    )
    asof = closes.index[-1].date()
    ap = ActivePair(
        pair_id="JNJ-PFE", sector="Health", y="JNJ", x="PFE",
        beta=1.0, screen_pvalue=0.01, screen_halflife=10.0,
        last_screen_date=asof - timedelta(days=60),
        last_watchdog_date=asof - timedelta(days=60),
    )
    pos = OpenPosition(
        pair_id="JNJ-PFE", y="JNJ", x="PFE", beta=1.0,
        direction=+1, entry_z=-2.0,
        entry_date=asof - timedelta(days=5),
        long_sym="JNJ", short_sym="PFE",
        long_weight=0.1, short_weight=-0.1,
    )
    state = {
        "pairs_trading.active": [ap],
        "pairs_trading.last_screen": asof - timedelta(days=60),
        "pairs_trading.positions": {"JNJ-PFE": pos},
    }
    ctx = _build_context(asof, provider, state=state)
    signals = list(s.manage(asof, ctx))
    exit_sigs = [sig for sig in signals if sig.tag.startswith("pairs-exit-watchdog")]
    assert len(exit_sigs) == 2, (
        f"Watchdog must force-close both legs; got {len(exit_sigs)} signals"
    )
    assert "JNJ-PFE" not in state["pairs_trading.positions"]


# --------------------------------------------------------------------------- #
# (e) Kalman hedge ratio tracks parameter drift
# --------------------------------------------------------------------------- #
def test_kalman_hedge_ratio_tracks_drift() -> None:
    """beta drifts from 1.0 -> 1.5 over 400 bars; Kalman should track."""

    from backend.indicators.stats import kalman_hedge_ratio

    rng = np.random.default_rng(101)
    n = 600
    x = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    # Linearly drift beta from 1.0 to 1.5 over the second half.
    betas = np.concatenate([
        np.ones(n // 2),
        np.linspace(1.0, 1.5, n - n // 2),
    ])
    eps = rng.normal(0, 0.5, n)
    y = betas * x + eps
    y_ser = pd.Series(y, index=pd.date_range("2018-01-02", periods=n, freq="B"))
    x_ser = pd.Series(x, index=y_ser.index)
    beta_kf = kalman_hedge_ratio(y_ser, x_ser, delta=1e-4, r=1e-2)
    # Mid-sample beta should be close to 1.0; late-sample beta should have
    # drifted higher.
    mid = float(beta_kf.iloc[n // 2 - 5])
    late = float(beta_kf.iloc[-5])
    assert late > mid, (
        f"Kalman beta did not increase as true beta drifted: "
        f"mid={mid:.3f} late={late:.3f}"
    )
    assert 0.9 < mid < 1.2, f"Mid-sample beta off: {mid:.3f}"
    assert late > 1.15, f"Late-sample beta should exceed 1.15: {late:.3f}"
