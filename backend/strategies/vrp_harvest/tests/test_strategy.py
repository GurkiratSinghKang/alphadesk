"""Unit tests for the VRP Harvest strategy.

Exercises each invariant the audit called out:

a. VRP computation = IV_30 - HV_20  (not just IV, not trailing-HV proxy)
b. Leg selection by target delta (16Δ strangle, 5Δ tail hedge)
c. Single Signal carrying multi-leg strangle
d. TP / SL exits fire at the right P&L levels
e. DTE-based exit fires at target DTE
f. VIX kill switch closes every open position
g. Tail hedge selection (delta, DTE)
h. Theta-target sizing scales with equity

Everything is exercised through synthetic chain + bar providers to keep
the tests deterministic and offline.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import numpy as np
import pandas as pd
import pytest

from backend.indicators.options import bs_price, bs_greeks
from backend.strategies.vrp_harvest.config import DEFAULTS
from backend.strategies.vrp_harvest.strategy import (
    VRPHarvestStrategy,
    _NS,
    _open_positions,
)


# --------------------------------------------------------------------------- #
# Synthetic providers                                                          #
# --------------------------------------------------------------------------- #
def _build_bar_df(
    symbol: str, closes: list[float], start: date = date(2024, 1, 2)
) -> pd.DataFrame:
    rows = []
    d = start
    for c in closes:
        rows.append(
            {
                "symbol": symbol,
                "ts": pd.Timestamp(d, tz="UTC"),
                "open": c, "high": c * 1.002, "low": c * 0.998, "close": c,
                "volume": 10_000_000,
            }
        )
        d = d + timedelta(days=1)
    return pd.DataFrame(rows)


class FakeBarProvider:
    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df

    def bars(self, symbols, start, end, tf: str = "1D") -> pd.DataFrame:
        syms = {s.upper() for s in symbols}
        sub = self.df[self.df["symbol"].str.upper().isin(syms)]
        if isinstance(start, date):
            lo = pd.Timestamp(start, tz="UTC")
        else:
            lo = pd.Timestamp(start)
        if isinstance(end, date):
            hi = pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
        else:
            hi = pd.Timestamp(end)
        return sub[(sub["ts"] >= lo) & (sub["ts"] <= hi)].copy()


def _make_chain(
    *,
    spot: float,
    asof: date,
    front_iv: float,
    back_iv: float,
    front_dte: int = 30,
    back_dte: int = 60,
    r: float = 0.045,
    q: float = 0.013,
) -> pd.DataFrame:
    """Build a realistic option chain with per-strike Greeks computed from BS.

    Strikes are a grid from 0.80 * spot to 1.20 * spot at $5 intervals.
    """

    rows = []
    for dte, iv in ((front_dte, front_iv), (back_dte, back_iv)):
        exp = asof + timedelta(days=dte)
        tau = dte / 365.0
        strikes = np.arange(round(spot * 0.80 / 5) * 5, round(spot * 1.21 / 5) * 5, 5)
        for k in strikes:
            k = float(k)
            for cp, right in (("call", "c"), ("put", "p")):
                greeks = bs_greeks(spot, k, tau, r, q, iv, cp)
                mid = bs_price(spot, k, tau, r, q, iv, cp)
                bid = max(mid * 0.95, 0.01)
                ask = mid * 1.05
                rows.append(
                    {
                        "contract_ticker": f"O:SPY:{exp.isoformat()}:{right.upper()}:{int(k*1000):08d}",
                        "underlying": "SPY",
                        "expiration": exp,
                        "strike": k,
                        "option_type": cp,
                        "bid": bid, "ask": ask, "last": mid,
                        "volume": 1000, "open_interest": 10_000,
                        "iv": iv,
                        "delta": greeks["delta"], "gamma": greeks["gamma"],
                        "theta": greeks["theta"], "vega": greeks["vega"], "rho": greeks["rho"],
                        "asof": asof,
                    }
                )
    return pd.DataFrame(rows)


class FakeChainProvider:
    def __init__(self, chains: dict[tuple[str, date], pd.DataFrame]) -> None:
        self.chains = chains

    def chain_snapshot(self, underlying: str, asof):
        if isinstance(asof, datetime):
            asof = asof.date()
        return self.chains.get((underlying.upper(), asof), pd.DataFrame())


# --------------------------------------------------------------------------- #
# Context factory                                                              #
# --------------------------------------------------------------------------- #
def _make_ctx(
    *,
    asof: date,
    bar_provider,
    chain_provider,
    equity: float = 100_000.0,
) -> SimpleNamespace:
    return SimpleNamespace(
        asof=asof,
        cash=Decimal(str(equity)),
        equity=Decimal(str(equity)),
        positions=[],
        bar_provider=bar_provider,
        options_provider=chain_provider,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )


def _configured_strat(**overrides: Any) -> VRPHarvestStrategy:
    s = VRPHarvestStrategy()
    p = dict(DEFAULTS)
    p.update(overrides)
    s.configure(p)
    return s


# --------------------------------------------------------------------------- #
# Test (a): VRP computation                                                    #
# --------------------------------------------------------------------------- #
def test_vrp_computed_from_iv30_minus_hv20():
    """The strategy computes VRP = IV_30 - HV_20 and gates on it."""

    asof = date(2024, 6, 3)
    # 100 bars of quiet SPY prices (low realized vol).
    closes = [500.0 + 0.2 * np.sin(i * 0.3) for i in range(80)]
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=110))

    # Chain with IV_30 = 20%, IV_60 = 21% (mild contango).
    chain = _make_chain(
        spot=float(closes[-1]), asof=asof, front_iv=0.20, back_iv=0.21
    )
    provider = FakeChainProvider({("SPY", asof): chain})

    strat = _configured_strat(
        vrp_entry_threshold=0.05,  # Very tight gate so we test both sides.
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=provider,
        equity=100_000.0,
    )

    # Warm the spot+HV cache and confirm HV is small and IV big.
    hv_20 = strat._hv_20(ctx, "SPY", asof)
    assert hv_20 is not None
    assert hv_20 < 0.15  # realized vol of low-noise sine is small

    chain_df = strat._chain_snapshot(ctx, "SPY", asof)
    iv_30 = strat._atm_iv(chain_df, spot=float(closes[-1]), target_dte=30, asof=asof)
    assert iv_30 is not None
    assert abs(iv_30 - 0.20) < 0.01  # ≈ 20%

    # VRP ≈ 0.20 - hv_20, should be positive and sizeable.
    vrp = iv_30 - hv_20
    assert vrp > 0.05

    # With threshold 5 % and our VRP > 5 %, we should emit a signal.
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) >= 1, "expected at least a strangle signal"


# --------------------------------------------------------------------------- #
# Test (b): Leg selection by delta                                            #
# --------------------------------------------------------------------------- #
def test_pick_leg_by_delta_targets_16d():
    """Short call + short put legs have |delta| close to the target."""

    asof = date(2024, 6, 3)
    spot = 500.0
    chain = _make_chain(spot=spot, asof=asof, front_iv=0.25, back_iv=0.26)

    strat = _configured_strat(strangle_delta=0.16)

    front_exp = sorted({e for e in chain["expiration"].unique()})[0]
    call_row = strat._pick_leg_by_delta(
        chain[(chain["expiration"] == front_exp) & (chain["option_type"] == "call")],
        spot=spot, asof=asof, exp=front_exp, target_delta=0.16,
        side_side="sell", right="C", tau=30 / 365.0, p=strat.params,
    )
    put_row = strat._pick_leg_by_delta(
        chain[(chain["expiration"] == front_exp) & (chain["option_type"] == "put")],
        spot=spot, asof=asof, exp=front_exp, target_delta=0.16,
        side_side="sell", right="P", tau=30 / 365.0, p=strat.params,
    )
    assert call_row is not None and put_row is not None
    # Compute the *actual* greeks of the chosen strikes.
    from backend.indicators.options import bs_greeks as _g
    gc = _g(spot, call_row.strike, 30 / 365.0, 0.045, 0.013, call_row.iv_entry, "call")
    gp = _g(spot, put_row.strike, 30 / 365.0, 0.045, 0.013, put_row.iv_entry, "put")
    assert abs(abs(gc["delta"]) - 0.16) < 0.07
    assert abs(abs(gp["delta"]) - 0.16) < 0.07
    # Strikes straddle spot.
    assert call_row.strike > spot
    assert put_row.strike < spot


# --------------------------------------------------------------------------- #
# Test (c): Single Signal with multiple legs                                  #
# --------------------------------------------------------------------------- #
def test_entry_emits_single_multileg_signal():
    """One short strangle = one Signal with both legs."""

    asof = date(2024, 6, 3)
    closes = [500.0] * 60
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    # 30% IV + flat realized → VRP very wide.
    chain = _make_chain(spot=500.0, asof=asof, front_iv=0.30, back_iv=0.31)

    strat = _configured_strat(
        vrp_entry_threshold=0.05,
        tail_hedge_ratio=0,  # no hedge = one signal only
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=100_000.0,
    )
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) == 1, f"expected 1 signal got {len(sigs)}"
    s = sigs[0]
    # Two legs: short call + short put.
    assert len(s.legs) == 2
    sides = sorted(leg.side.value for leg in s.legs)
    assert sides == ["sell", "sell"]
    rights = sorted(leg.right for leg in s.legs)
    assert rights == ["C", "P"]
    # Quantity sign encodes the short-premium direction.
    assert s.quantity < 0


# --------------------------------------------------------------------------- #
# Test (c2): Tail hedge emits a second Signal                                 #
# --------------------------------------------------------------------------- #
def test_entry_with_hedge_emits_two_signals():
    asof = date(2024, 6, 3)
    closes = [500.0] * 60
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    chain = _make_chain(spot=500.0, asof=asof, front_iv=0.30, back_iv=0.31)

    strat = _configured_strat(
        vrp_entry_threshold=0.05,
        tail_hedge_ratio=5,
        tail_hedge_delta=0.05,
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=250_000.0,  # big enough to size >=1 hedge
    )
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) >= 2, f"expected 2 signals got {len(sigs)}"
    tags = sorted(s.tag for s in sigs)
    assert any("tailhedge" in t for t in tags)


# --------------------------------------------------------------------------- #
# Test (d): TP / SL exits                                                      #
# --------------------------------------------------------------------------- #
def _open_a_strangle(asof: date, *, iv_entry: float = 0.30, equity: float = 100_000.0):
    """Helper: open a strangle on ``asof`` and return (strat, ctx)."""

    closes = [500.0] * 60
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    chain = _make_chain(spot=500.0, asof=asof, front_iv=iv_entry, back_iv=iv_entry + 0.01)
    strat = _configured_strat(
        vrp_entry_threshold=0.05,
        tail_hedge_ratio=0,
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=equity,
    )
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) == 1
    return strat, ctx


def test_tp_exit_fires_at_profit_target():
    """If legs collapse to ~0 (IV crushes), TP should fire.

    We open a 45-DTE strangle (so TP wins over DTE in the first few
    days) and immediately crush IV on the next bar.
    """

    asof = date(2024, 6, 3)
    closes = [500.0] * 60
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    chain = _make_chain(
        spot=500.0, asof=asof, front_iv=0.30, back_iv=0.31,
        front_dte=45, back_dte=75,
    )
    strat = _configured_strat(
        vrp_entry_threshold=0.05, tail_hedge_ratio=0, target_dte=45,
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=100_000.0,
    )
    sigs = list(strat.generate_signals(asof, ctx))
    assert len(sigs) == 1

    # Advance a few days (still well above exit DTE) with IV crushed.
    asof2 = asof + timedelta(days=3)
    closes2 = [500.0] * 70
    bars2 = _build_bar_df("SPY", closes2, start=asof - timedelta(days=90))
    crushed = _make_chain(
        spot=500.0, asof=asof2, front_iv=0.05, back_iv=0.05,
        front_dte=42, back_dte=72,
    )
    ctx.bar_provider = FakeBarProvider(bars2)
    ctx.options_provider = FakeChainProvider({("SPY", asof2): crushed})
    ctx.asof = asof2
    exits = list(strat.manage(asof2, ctx))
    assert any("tp-profit" in s.tag for s in exits), (
        f"expected tp-profit exit, got tags={[s.tag for s in exits]}"
    )


def test_sl_exit_fires_on_loss():
    """If IV doubles + spot moves, loss multiple hits SL."""

    asof = date(2024, 6, 3)
    strat, ctx = _open_a_strangle(asof, iv_entry=0.20)

    # Advance 5 days with IV blown out (but *below* kill switch) AND
    # spot moved 8% — realized big losses on both legs.
    asof2 = asof + timedelta(days=5)
    closes = [500.0] * 70 + [540.0]
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    blown = _make_chain(spot=540.0, asof=asof2, front_iv=0.32, back_iv=0.32)
    ctx.bar_provider = FakeBarProvider(bars)
    ctx.options_provider = FakeChainProvider({("SPY", asof2): blown})
    ctx.asof = asof2
    exits = list(strat.manage(asof2, ctx))
    assert any("sl-loss" in s.tag for s in exits), (
        f"expected sl-loss exit, got tags={[s.tag for s in exits]}"
    )


# --------------------------------------------------------------------------- #
# Test (e): DTE-based exit                                                    #
# --------------------------------------------------------------------------- #
def test_dte_exit_fires_at_21_dte():
    asof = date(2024, 6, 3)
    strat, ctx = _open_a_strangle(asof, iv_entry=0.30)

    # Advance to 21 DTE (=30-9).
    asof2 = asof + timedelta(days=9)
    closes = [500.0] * 70
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    still = _make_chain(spot=500.0, asof=asof2, front_iv=0.30, back_iv=0.31)
    ctx.bar_provider = FakeBarProvider(bars)
    ctx.options_provider = FakeChainProvider({("SPY", asof2): still})
    ctx.asof = asof2
    exits = list(strat.manage(asof2, ctx))
    assert any("dte-roll" in s.tag for s in exits), (
        f"expected dte-roll exit, got tags={[s.tag for s in exits]}"
    )


# --------------------------------------------------------------------------- #
# Test (f): VIX kill switch                                                   #
# --------------------------------------------------------------------------- #
def test_vix_kill_switch_closes_open_positions():
    asof = date(2024, 6, 3)
    strat, ctx = _open_a_strangle(asof, iv_entry=0.25)

    # Next bar: IV spikes to 0.50 (above default kill switch 0.35).
    asof2 = asof + timedelta(days=1)
    closes = [500.0] * 70
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    crisis = _make_chain(spot=500.0, asof=asof2, front_iv=0.50, back_iv=0.48)
    ctx.bar_provider = FakeBarProvider(bars)
    ctx.options_provider = FakeChainProvider({("SPY", asof2): crisis})
    ctx.asof = asof2
    exits = list(strat.manage(asof2, ctx))
    assert any("vix-kill-switch" in s.tag for s in exits), (
        f"expected kill-switch exit, got tags={[s.tag for s in exits]}"
    )

    # And generate_signals refuses new entries during kill switch.
    sigs = list(strat.generate_signals(asof2, ctx))
    assert sigs == []


# --------------------------------------------------------------------------- #
# Test (g): Tail hedge selection by delta                                     #
# --------------------------------------------------------------------------- #
def test_tail_hedge_picks_5delta_put():
    asof = date(2024, 6, 3)
    chain = _make_chain(spot=500.0, asof=asof, front_iv=0.25, back_iv=0.26)
    strat = _configured_strat(tail_hedge_ratio=5, tail_hedge_delta=0.05)

    hedge = strat._find_tail_hedge(chain, spot=500.0, asof=asof, p=strat.params, iv_30=0.25)
    assert hedge is not None
    assert hedge.right == "P"
    # Confirm the delta is near 5 %.
    g = bs_greeks(500.0, hedge.strike, 30 / 365.0, 0.045, 0.013, hedge.iv_entry, "put")
    assert abs(abs(g["delta"]) - 0.05) < 0.04


# --------------------------------------------------------------------------- #
# Test (h): Theta-target sizing                                               #
# --------------------------------------------------------------------------- #
def test_theta_target_sizing():
    """Doubling equity roughly doubles spread count."""

    s = VRPHarvestStrategy()
    n1 = s._size_by_theta(
        equity=100_000.0,
        per_strangle_theta=30.0,
        max_spreads=500,
        theta_target_pct=0.003,
    )
    n2 = s._size_by_theta(
        equity=200_000.0,
        per_strangle_theta=30.0,
        max_spreads=500,
        theta_target_pct=0.003,
    )
    assert n1 > 0
    assert 1.5 * n1 <= n2 <= 2.5 * n1
    # Zero theta gives zero spreads.
    n0 = s._size_by_theta(
        equity=100_000.0,
        per_strangle_theta=0.0,
        max_spreads=500,
        theta_target_pct=0.003,
    )
    assert n0 == 0
    # Max cap is honored.
    n_cap = s._size_by_theta(
        equity=10_000_000.0,
        per_strangle_theta=0.1,
        max_spreads=5,
        theta_target_pct=0.003,
    )
    assert n_cap == 5


# --------------------------------------------------------------------------- #
# Additional: Term-structure gate                                             #
# --------------------------------------------------------------------------- #
def test_term_structure_gate_blocks_backwardation():
    """When front > back IV (backwardation), no entries."""

    asof = date(2024, 6, 3)
    closes = [500.0] * 60
    bars = _build_bar_df("SPY", closes, start=asof - timedelta(days=90))
    # front > back ⇒ backwardation.
    chain = _make_chain(spot=500.0, asof=asof, front_iv=0.35, back_iv=0.25)

    strat = _configured_strat(
        vrp_entry_threshold=0.05,
        term_structure_gate=True,
        vix_kill_switch=0.50,  # above our 35% front so it doesn't fire
    )
    ctx = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=100_000.0,
    )
    sigs = list(strat.generate_signals(asof, ctx))
    assert sigs == [], "backwardation should block entries"

    # With gate off: at least the strangle should fire.
    strat2 = _configured_strat(
        vrp_entry_threshold=0.05,
        term_structure_gate=False,
        vix_kill_switch=0.50,
        tail_hedge_ratio=0,
    )
    ctx2 = _make_ctx(
        asof=asof,
        bar_provider=FakeBarProvider(bars),
        chain_provider=FakeChainProvider({("SPY", asof): chain}),
        equity=100_000.0,
    )
    sigs2 = list(strat2.generate_signals(asof, ctx2))
    assert len(sigs2) >= 1


# --------------------------------------------------------------------------- #
# Additional: Registry lookup round-trip                                      #
# --------------------------------------------------------------------------- #
def test_registry_lookup():
    from backend.strategies.registry import get_strategy

    cls = get_strategy("vrp_harvest")
    assert cls is VRPHarvestStrategy
