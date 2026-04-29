"""Unit tests for the cointegration-gated Pairs Trading strategy — SOTA shell.

Covers:
1. Engle-Granger ADF gate filters out non-cointegrated pairs.
2. Entry emits two coincident signals with opposite target_weight signs.
3. Mean-revert exit at |z| < z_exit closes BOTH legs.
4. Structural-break watchdog force-closes broken pairs.
5. Kalman hedge ratio tracks parameter drift.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import numpy as np
import orjson
import pandas as pd
import pytest

from strategies._core.contracts import StrategyInput
from strategies._core.protocol import get_meta
from strategies.pairs_trading.config import PairsTradingParams, UNIVERSE
from strategies.pairs_trading.strategy import (
    ActivePair,
    OpenPosition,
    PairsTradingStrategy,
    _rescreen,
    _close_matrix,
)


# --------------------------------------------------------------------------- #
# Fixtures                                                                    #
# --------------------------------------------------------------------------- #
def _closes_to_bars(closes: pd.DataFrame) -> pd.DataFrame:
    """Flatten a wide (date × symbol) closes frame into multi-index bars."""
    rows: list[pd.DataFrame] = []
    for sym in closes.columns:
        series = closes[sym].dropna()
        frame = pd.DataFrame({
            "symbol": sym,
            "date": [d.date() if hasattr(d, "date") else d for d in series.index],
            "open": series.values,
            "high": series.values,
            "low": series.values,
            "close": series.values,
            "volume": 1_000_000,
        })
        rows.append(frame)
    merged = pd.concat(rows, ignore_index=True)
    return merged.set_index(["date", "symbol"]).sort_index()


def _full_universe_closes(closes: pd.DataFrame) -> pd.DataFrame:
    """Expand a 2-symbol close frame to include the full universe (NaN-filled)."""
    full = pd.DataFrame(index=closes.index, columns=list(UNIVERSE), dtype=float)
    for sym in closes.columns:
        if sym in full.columns:
            full[sym] = closes[sym].values
    return full


def _build_input(
    bars: pd.DataFrame,
    asof: date,
    state: dict | None = None,
) -> StrategyInput:
    return StrategyInput(
        asof=asof, mode="backtest", bars=bars,
        cash=Decimal("100000"), equity=Decimal("100000"),
        positions=[], state=state or {},
        seed=0, rng=np.random.default_rng(0),
    )


def _make_cointegrated_closes(
    n_bars: int = 500, seed: int = 7, beta: float = 1.2, pv_shock: float = 0.0,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    x_ret = rng.normal(0, 0.01, n_bars)
    x = 100.0 * np.exp(np.cumsum(x_ret))
    eps = np.zeros(n_bars)
    shock = rng.normal(0, 1.0, n_bars)
    for t in range(1, n_bars):
        eps[t] = 0.9 * eps[t - 1] + shock[t]
    if pv_shock != 0.0:
        eps[-10:] += pv_shock
    y = beta * x + eps
    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    return pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)


def _make_noncointegrated_closes(
    n_bars: int = 500, seed: int = 11,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    a = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.012, n_bars)))
    b = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.013, n_bars)))
    idx = pd.date_range("2018-01-02", periods=n_bars, freq="B")
    return pd.DataFrame({"JNJ": a, "PFE": b}, index=idx)


# --------------------------------------------------------------------------- #
# Metadata                                                                    #
# --------------------------------------------------------------------------- #
def test_registered_with_expected_meta() -> None:
    meta = get_meta("pairs_trading")
    assert meta.name == "pairs_trading"
    assert meta.category == "pairs"
    assert meta.required_bars == ("daily",)
    assert meta.lookback_days >= 300


def test_params_defaults_and_overrides() -> None:
    p = PairsTradingParams()
    assert p.z_entry == 2.0
    assert p.max_pairs == 5
    assert p.hedge_method == "ols"

    p2 = PairsTradingParams(z_entry=2.5, max_pairs=3, hedge_method="kalman")
    assert p2.z_entry == pytest.approx(2.5)
    assert p2.max_pairs == 3
    assert p2.hedge_method == "kalman"
    assert p2.z_exit == 0.5  # default preserved


# --------------------------------------------------------------------------- #
# Engle-Granger gate                                                          #
# --------------------------------------------------------------------------- #
def test_eg_adf_gate_rejects_noncointegrated() -> None:
    closes = _make_noncointegrated_closes(n_bars=400, seed=11)
    full = _full_universe_closes(closes)
    bars = _closes_to_bars(full)

    params = PairsTradingParams(adf_pvalue_max=0.0001, hurst_max=0.49)
    matrix = _close_matrix(bars, closes.index[-1].date(), params.formation_days)
    active = _rescreen(matrix, params, closes.index[-1].date())
    assert not any(p.pair_id == "JNJ-PFE" for p in active), (
        "Non-cointegrated pair admitted despite strict adf_pvalue_max"
    )


def test_eg_adf_gate_admits_cointegrated() -> None:
    closes = _make_cointegrated_closes(n_bars=400, seed=3)
    full = _full_universe_closes(closes)
    bars = _closes_to_bars(full)

    params = PairsTradingParams(
        adf_pvalue_max=0.10, ou_halflife_max_days=50.0,
        hurst_max=0.55, max_pairs=5,
    )
    matrix = _close_matrix(bars, closes.index[-1].date(), params.formation_days)
    active = _rescreen(matrix, params, closes.index[-1].date())
    assert any(p.pair_id == "AAPL-MSFT" for p in active), (
        f"Synthetic cointegrated pair not admitted. Active: {[p.pair_id for p in active]}"
    )


# --------------------------------------------------------------------------- #
# Entry: two legs with opposite signs                                         #
# --------------------------------------------------------------------------- #
def test_entry_emits_two_legs_with_opposite_signs() -> None:
    rng = np.random.default_rng(17)
    n = 300
    x = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    eps = np.zeros(n)
    sh = rng.normal(0, 1.0, n)
    for t in range(1, n):
        eps[t] = 0.9 * eps[t - 1] + sh[t]
    beta_true = 1.2
    y = beta_true * x + eps
    idx = pd.date_range("2018-01-02", periods=n, freq="B")
    closes = pd.DataFrame({"AAPL": y, "MSFT": x}, index=idx)
    spread = closes["AAPL"] - beta_true * closes["MSFT"]
    shock = 3.0 * float(spread.tail(90).std())
    closes.iloc[-1, closes.columns.get_loc("AAPL")] += shock

    full = _full_universe_closes(closes)
    bars = _closes_to_bars(full)
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
    params = PairsTradingParams(
        z_entry=1.5, z_stop=10.0, z_window=45, max_pairs=3,
        rescreen_days=1000,
    )
    strat = PairsTradingStrategy()
    result = strat.run(_build_input(bars, asof, state=state), params)
    entry_sigs = [sig for sig in result.signals if sig.tag.startswith("pairs-entry")]
    assert len(entry_sigs) == 2
    weights = [sig.target_weight for sig in entry_sigs]
    assert weights[0] * weights[1] < 0
    # Round-6 / I-4: entries are intent-only on emission — they live in
    # state.pending until on_fill confirms both legs landed. The confirmed
    # positions ledger (state.positions) is empty at this point.
    assert result.state_update["pairs_trading.pending"].get("AAPL-MSFT") is not None
    assert result.state_update["pairs_trading.positions"] == {}
    persisted_state = {
        **state,
        **orjson.loads(orjson.dumps(result.state_update)),
    }
    replay = strat.run(_build_input(bars, asof, state=persisted_state), params)
    assert [sig for sig in replay.signals if sig.tag.startswith("pairs-entry")] == []


# --------------------------------------------------------------------------- #
# Exit: mean-revert closes both legs                                          #
# --------------------------------------------------------------------------- #
def test_mean_revert_exit_closes_both_legs() -> None:
    closes = _make_cointegrated_closes(n_bars=500, seed=9, beta=1.1)
    full = _full_universe_closes(closes)
    bars = _closes_to_bars(full)
    asof = closes.index[-1].date()

    ap = ActivePair(
        pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
        beta=1.1, screen_pvalue=0.01, screen_halflife=10.0,
        last_screen_date=asof, last_watchdog_date=asof,
    )
    pos = OpenPosition(
        pair_id="AAPL-MSFT", y="AAPL", x="MSFT", beta=1.1,
        direction=+1, entry_z=-2.0,
        entry_date=asof - timedelta(days=5),
        long_sym="AAPL", short_sym="MSFT",
        long_weight=0.1, short_weight=-0.11,
    )
    state = {
        "pairs_trading.active": [ap],
        "pairs_trading.last_screen": asof,
        "pairs_trading.positions": {"AAPL-MSFT": pos},
    }
    params = PairsTradingParams(
        adf_pvalue_max=0.20, ou_halflife_max_days=80.0, hurst_max=0.55,
        z_exit=5.0,  # deliberately loose so today's |z| is below and we exit
        z_window=45, z_stop=100.0,
        rescreen_days=1000,  # don't rescreen — preserve seeded active
    )
    strat = PairsTradingStrategy()
    result = strat.run(_build_input(bars, asof, state=state), params)
    exit_sigs = [sig for sig in result.signals if sig.tag.startswith("pairs-exit")]
    assert len(exit_sigs) == 2
    assert {sig.symbol for sig in exit_sigs} == {"AAPL", "MSFT"}
    for sig in exit_sigs:
        assert sig.target_weight == 0.0
    assert "AAPL-MSFT" not in result.state_update["pairs_trading.positions"]


# --------------------------------------------------------------------------- #
# Watchdog                                                                    #
# --------------------------------------------------------------------------- #
def test_watchdog_force_closes_broken_pair() -> None:
    closes = _make_noncointegrated_closes(n_bars=400, seed=21)
    full = _full_universe_closes(closes)
    bars = _closes_to_bars(full)
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
    params = PairsTradingParams(
        watchdog_pvalue=0.001, watchdog_days=0,
        z_exit=0.0, z_stop=100.0,
        rescreen_days=1000,
    )
    strat = PairsTradingStrategy()
    result = strat.run(_build_input(bars, asof, state=state), params)
    exit_sigs = [sig for sig in result.signals if sig.tag.startswith("pairs-exit-watchdog")]
    assert len(exit_sigs) == 2
    assert "JNJ-PFE" not in result.state_update["pairs_trading.positions"]


# --------------------------------------------------------------------------- #
# Kalman drift                                                                #
# --------------------------------------------------------------------------- #
def test_kalman_hedge_ratio_tracks_drift() -> None:
    from indicators.stats import kalman_hedge_ratio

    rng = np.random.default_rng(101)
    n = 600
    x = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.01, n)))
    betas = np.concatenate([
        np.ones(n // 2),
        np.linspace(1.0, 1.5, n - n // 2),
    ])
    eps = rng.normal(0, 0.5, n)
    y = betas * x + eps
    y_ser = pd.Series(y, index=pd.date_range("2018-01-02", periods=n, freq="B"))
    x_ser = pd.Series(x, index=y_ser.index)
    beta_kf = kalman_hedge_ratio(y_ser, x_ser, delta=1e-4, r=1e-2)
    mid = float(beta_kf.iloc[n // 2 - 5])
    late = float(beta_kf.iloc[-5])
    assert late > mid
    assert 0.9 < mid < 1.2
    assert late > 1.15


# --------------------------------------------------------------------------- #
# on_fill — pending → confirmed promotion (Round-6 / I-4)                     #
# --------------------------------------------------------------------------- #
def test_on_fill_promotes_pending_to_positions_after_both_legs() -> None:
    """``on_fill`` must move an intent from state.pending to state.positions
    only after BOTH legs of the pair fill — partials wait."""
    from decimal import Decimal as _Decimal

    from strategies._core.contracts import Fill
    from strategies.pairs_trading.strategy import OpenPosition, PairsTradingStrategy

    asof = date(2025, 6, 1)
    intent = OpenPosition(
        pair_id="AAPL-MSFT", y="AAPL", x="MSFT", beta=1.1,
        direction=+1, entry_z=-2.5, entry_date=asof,
        long_sym="AAPL", short_sym="MSFT",
        long_weight=0.1, short_weight=-0.11,
    )
    state = {
        "pairs_trading.positions": {},
        "pairs_trading.pending": {"AAPL-MSFT": intent},
    }
    strat = PairsTradingStrategy()

    # Fill leg 1 (y) — still pending.
    fill_y = Fill(
        symbol="AAPL", asof=asof, quantity=10, price=_Decimal("150"),
        signal_tag="pairs-entry-AAPL-MSFT-dir+1-y",
    )
    update = strat.on_fill(fill_y, state)
    assert update["pairs_trading.positions"] == {}
    assert "AAPL-MSFT" in update["pairs_trading.pending"]
    assert update["pairs_trading.pending_partials"]["AAPL-MSFT"] == ["y"]
    orjson.dumps(update)
    state.update(update)

    # Fill leg 2 (x) — now confirmed.
    fill_x = Fill(
        symbol="MSFT", asof=asof, quantity=-9, price=_Decimal("330"),
        signal_tag="pairs-entry-AAPL-MSFT-dir+1-x",
    )
    update = strat.on_fill(fill_x, state)
    assert "AAPL-MSFT" in update["pairs_trading.positions"]
    assert update["pairs_trading.pending"] == {}
    assert update["pairs_trading.held_symbols"] == ["AAPL", "MSFT"]
    orjson.dumps(update)


def test_on_fill_exit_drops_position() -> None:
    """Exit fills clear the pair only after both legs confirm."""
    from decimal import Decimal as _Decimal

    from strategies._core.contracts import Fill
    from strategies.pairs_trading.strategy import OpenPosition, PairsTradingStrategy

    asof = date(2025, 6, 1)
    pos = OpenPosition(
        pair_id="AAPL-MSFT", y="AAPL", x="MSFT", beta=1.1,
        direction=+1, entry_z=-2.5, entry_date=asof - timedelta(days=10),
        long_sym="AAPL", short_sym="MSFT",
        long_weight=0.1, short_weight=-0.11,
    )
    state = {
        "pairs_trading.positions": {"AAPL-MSFT": pos},
        "pairs_trading.pending": {},
    }
    strat = PairsTradingStrategy()
    fill_y = Fill(
        symbol="AAPL", asof=asof, quantity=-10, price=_Decimal("160"),
        signal_tag="pairs-exit-mean-revert-AAPL-MSFT-y",
    )
    update = strat.on_fill(fill_y, state)
    assert "AAPL-MSFT" in update["pairs_trading.positions"]
    assert update["pairs_trading.exit_partials"]["AAPL-MSFT"] == ["y"]
    assert update["pairs_trading.held_symbols"] == ["AAPL", "MSFT"]
    orjson.dumps(update)
    state.update(update)

    fill_x = Fill(
        symbol="MSFT", asof=asof, quantity=9, price=_Decimal("330"),
        signal_tag="pairs-exit-mean-revert-AAPL-MSFT-x",
    )
    update = strat.on_fill(fill_x, state)
    assert update["pairs_trading.positions"] == {}
    assert update["pairs_trading.exit_partials"] == {}
    assert update["pairs_trading.held_symbols"] == []
    orjson.dumps(update)


def test_active_pair_frozen_model_rejects_mutation() -> None:
    """ActivePair / OpenPosition must be frozen Pydantic models (Round-6 / I-19)."""
    from pydantic import ValidationError as _ValidationError

    ap = ActivePair(
        pair_id="AAPL-MSFT", sector="Tech", y="AAPL", x="MSFT",
        beta=1.0, screen_pvalue=0.01, screen_halflife=10.0,
        last_screen_date=date(2025, 1, 1), last_watchdog_date=date(2025, 1, 1),
    )
    with pytest.raises((_ValidationError, ValueError, AttributeError, TypeError)):
        ap.last_watchdog_date = date(2025, 6, 1)  # type: ignore[misc]
    bumped = ap.model_copy(update={"last_watchdog_date": date(2025, 6, 1)})
    assert bumped.last_watchdog_date == date(2025, 6, 1)
    assert ap.last_watchdog_date == date(2025, 1, 1)  # original unchanged
