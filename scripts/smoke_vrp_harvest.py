#!/usr/bin/env python
"""Smoke test for the VRP Harvest strategy — real Polygon options data.

Runs the strategy day-by-day over a short window on real SPY bars
(Alpaca) + real SPY chain snapshots (Polygon Options Developer). The
engine's multi-leg options plumbing is incomplete (see the strategy
module docstring), so we bypass it entirely: the smoke driver calls
``generate_signals`` / ``manage`` directly and uses the synthetic P&L
curve the strategy maintains on ``ctx.state``.

Expects 3-6 strangle cycles over a 3-month window with default params.

Run from repo root::

    PYTHONPATH=. .venv/bin/python scripts/smoke_vrp_harvest.py
"""

from __future__ import annotations

import logging
import sys
import types
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace


def _install_stubs() -> None:
    """Suppress the legacy ``backend/strategies/__init__.py`` eager imports
    so registering vrp_harvest doesn't drag the rest of the package tree
    into the process.
    """

    repo_root = Path(__file__).resolve().parents[1]
    backend = repo_root / "backend"
    sp = str(repo_root)
    if sp not in sys.path:
        sys.path.insert(0, sp)
    if "backend" not in sys.modules:
        b = types.ModuleType("backend")
        b.__path__ = [str(backend)]
        b.__file__ = "(stub)"
        sys.modules["backend"] = b
    if "backend.strategies" not in sys.modules:
        s = types.ModuleType("backend.strategies")
        s.__path__ = [str(backend / "strategies")]
        s.__file__ = "(stub)"
        sys.modules["backend.strategies"] = s
        sys.modules["backend"].strategies = s


_install_stubs()


def main() -> int:
    from backend.data.providers.alpaca import AlpacaBarProvider
    from backend.strategies.registry import get_strategy
    from backend.strategies.vrp_harvest.provider import BoundedPolygonOptionsProvider
    from backend.strategies.vrp_harvest.strategy import (
        VRPHarvestStrategy,
        synthetic_equity_curve,
        summary_from_equity,
        _open_positions,
        _positions_map,
        _synth_trades,
    )

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    log = logging.getLogger("smoke_vrp")

    print("Smoke test: VRP Harvest (real Polygon options)")
    print("=" * 64)

    # Registry round-trip.
    cls = get_strategy("vrp_harvest")
    assert cls is VRPHarvestStrategy, "registry must return our class"
    print(f"Registry lookup OK: {cls.__name__}")

    strat = VRPHarvestStrategy()
    strat.configure({})
    starting_cash = 100_000.0

    # 3-month real-data window: April-June 2024. SPY had VRP >
    # threshold on most days in this window (IV 13-16%, RV 7-12%).
    start = date(2024, 4, 1)
    end = date(2024, 6, 28)

    ctx = SimpleNamespace(
        asof=start,
        cash=Decimal(str(starting_cash)),
        equity=Decimal(str(starting_cash)),
        positions=[],
        bar_provider=None,
        options_provider=None,
        earnings_provider=None,
        fundamentals_provider=None,
        calendar_provider=None,
        params={},
        state={},
    )

    # Session list via business-day calendar.
    import pandas as pd
    sessions = [d.date() for d in pd.bdate_range(start=start, end=end)]

    with AlpacaBarProvider() as bp, BoundedPolygonOptionsProvider() as op:
        ctx.bar_provider = bp
        ctx.options_provider = op

        signals_emitted: list[tuple[date, str, int, float]] = []
        for s in sessions:
            ctx.asof = s
            # Refresh ctx.equity from synthetic curve so theta sizing is real.
            curve = synthetic_equity_curve(strat, ctx, [s], starting_cash)
            if not curve.empty:
                ctx.equity = Decimal(str(float(curve["equity"].iloc[-1])))
                ctx.cash = ctx.equity  # treat all as cash for sizing

            # Manage existing positions first.
            exits = list(strat.manage(s, ctx))
            for sig in exits:
                qty = int(sig.quantity or 0)
                n_legs = len(sig.legs)
                mid = float(sig.limit_price) if sig.limit_price is not None else 0.0
                signals_emitted.append((s, sig.tag, qty, mid))
                log.info(
                    "%s EXIT %s qty=%d legs=%d mid=%.3f",
                    s.isoformat(), sig.tag, qty, n_legs, mid,
                )

            # Emit new entries.
            entries = list(strat.generate_signals(s, ctx))
            for sig in entries:
                qty = int(sig.quantity or 0)
                n_legs = len(sig.legs)
                mid = float(sig.limit_price) if sig.limit_price is not None else 0.0
                signals_emitted.append((s, sig.tag, qty, mid))
                log.info(
                    "%s ENTER %s qty=%d legs=%d mid=%.3f",
                    s.isoformat(), sig.tag, qty, n_legs, mid,
                )

        # Build the full curve.
        curve = synthetic_equity_curve(strat, ctx, sessions, starting_cash)
        summary = summary_from_equity(curve, starting_cash)

    print("\n--- Strategy activity ---")
    print(f"Sessions processed : {len(sessions)}")
    print(f"Signals emitted    : {len(signals_emitted)}")
    positions = list(_positions_map(ctx.state).values())
    opened = sum(1 for p in positions if p.tag.endswith("-strangle"))
    closed = sum(1 for p in positions if p.closed_on is not None)
    print(f"Strangles opened   : {opened}")
    print(f"Positions closed   : {closed}")
    open_now = len(_open_positions(ctx.state))
    print(f"Positions open now : {open_now}")

    print("\n--- Exit reasons ---")
    reasons: dict[str, int] = {}
    for p in positions:
        if p.exit_reason:
            reasons[p.exit_reason] = reasons.get(p.exit_reason, 0) + 1
    for r, c in sorted(reasons.items()):
        print(f"  {r:20s}: {c}")

    print("\n--- Synthetic equity curve ---")
    if not curve.empty:
        print(f"  Start equity     : ${starting_cash:,.2f}")
        print(f"  End equity       : ${summary['final_equity']:,.2f}")
        print(f"  Total return     : {summary['total_return_pct'] * 100:+.2f}%")
        print(f"  Sharpe (ann)     : {summary['sharpe']:.3f}")
        print(f"  CAGR             : {summary['cagr'] * 100:.2f}%")
        print(f"  Max drawdown     : {summary['max_drawdown'] * 100:.2f}%")
        print(f"  Years            : {summary['years']:.2f}")

    # Sanity check: at least one strangle cycle over a 3-month window.
    if opened < 1:
        print("\nFAIL: no strangles opened. Check VRP gate or term-structure gate.")
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
