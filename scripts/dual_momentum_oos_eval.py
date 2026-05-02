#!/usr/bin/env python
"""Evaluate dual_momentum (GEM) DEFAULT parameters on OOS 2023-2024.

Mirrors ``scripts/momentum_quality_oos_eval.py``. Writes a machine-readable
summary to

- ``backend/data/oos/phase1-dual_momentum-oos.json`` (canonical artefact)
- ``audit-reports/phase1-dual_momentum-oos.json`` (human review)

Uses the in-memory bar provider for speed. Schema mirrors the sibling
phase1-*-oos.json files: ``{strategy, params, start, end, metrics,
round_trip_trades, fills, equity_start, equity_end, total_return}``.

Per the Wave 3 brief (and the expert report's explicit warning), we
evaluate ``DEFAULT_PARAMS`` -- NOT the tuned ``SPY/EFA/EEM`` + ``blend_126_252``
variant, which is flagged as a curve-fit in
``audit-reports/expert-dual-momentum.md``.

Resilience: if bar-fetch fails (no Alpaca key, rate limit, …) we emit a
minimal stub artefact with ``status: "stub"`` and ``reason`` set and
return exit 2 (non-fatal) so a CI run doesn't crash.
"""

from __future__ import annotations

import json
import logging
import sys
import types
from datetime import date
from decimal import Decimal
from pathlib import Path


_ROOT = Path(__file__).resolve().parent.parent


def _install_stubs() -> None:
    """Avoid triggering the broken legacy ``backend/strategies/__init__.py``."""

    backend = _ROOT / "backend"
    sp = str(_ROOT)
    if sp not in sys.path:
        sys.path.insert(0, sp)
    for _p in (_ROOT, backend):
        ps = str(_p)
        if ps not in sys.path:
            sys.path.insert(0, ps)
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

log = logging.getLogger("dual_momentum_oos_eval")


import backend.strategies.dual_momentum  # noqa: F401,E402 - registers the strategy

from backend.strategies.dual_momentum.config import DEFAULT_PARAMS  # noqa: E402
from backend.strategies.dual_momentum.strategy import DualMomentumStrategy  # noqa: E402
from scripts.oos_bootstrap import attach_bootstrap_ci, bootstrap_ci_from_equity_frame  # noqa: E402


# Same two-year OOS window as the other Phase-1 strategies.
OOS_START = date(2023, 1, 2)
OOS_END = date(2024, 12, 30)

# Prefetch window — warmup for the 12-month lookback (~400 cal days).
PREFETCH_START = date(2021, 1, 4)
PREFETCH_END = date(2024, 12, 31)


def _emit_stub(reason: str) -> int:
    out = {
        "strategy": "dual_momentum",
        "status": "stub",
        "reason": reason,
        "params": DEFAULT_PARAMS,
        "start": OOS_START.isoformat(),
        "end": OOS_END.isoformat(),
    }
    out_paths = [
        _ROOT / "backend" / "data" / "oos" / "phase1-dual_momentum-oos.json",
        _ROOT / "audit-reports" / "phase1-dual_momentum-oos.json",
    ]
    for p in out_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, indent=2, default=str))
        log.warning("wrote stub artefact to %s: %s", p, reason)
    return 2


def _prefetch_bars():
    """Pull the small GEM universe once via Alpaca, serve from memory."""

    from backend.data.providers.alpaca import AlpacaBarProvider

    # DEFAULT universe for GEM defaults: VOO + VEU + AGG + BIL + SPY (bench)
    symbols = sorted(
        {
            "VOO",
            "VEU",
            "AGG",
            "BIL",
            "SPY",
        }
    )
    log.info(
        "Prefetching %d symbols %s → %s …",
        len(symbols),
        PREFETCH_START,
        PREFETCH_END,
    )
    try:
        with AlpacaBarProvider() as p:
            df = p.bars(symbols, PREFETCH_START, PREFETCH_END, tf="1D")
    except Exception as exc:  # noqa: BLE001
        log.warning("Alpaca prefetch failed: %s", exc)
        return None
    return df


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    # ----- Bar provider prefetch (graceful degradation on failure) ------ #
    df = _prefetch_bars()
    if df is None or df.empty:
        return _emit_stub(
            "alpaca_prefetch_failed_or_empty"
        )

    # In-memory bar provider — reuse momentum_quality's implementation so
    # we stay consistent with how the other phase1 eval scripts serve.
    from scripts.tune_momentum_quality import InMemoryBarProvider

    bar_provider = InMemoryBarProvider(df)

    # ----- Run the backtest with DEFAULT params (NOT tuned) ------------- #
    from backend.backtest.engine import BacktestEngine, EngineConfig

    strat = DualMomentumStrategy()
    strat.configure(DEFAULT_PARAMS)

    cfg = EngineConfig(
        start=OOS_START,
        end=OOS_END,
        starting_cash=Decimal("100000"),
        timeframe="1D",
        benchmark="SPY",
    )
    try:
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=bar_provider,
            config=cfg,
        )
        result = engine.run()
    except Exception as exc:  # noqa: BLE001
        log.warning("dual_momentum OOS backtest failed: %s", exc)
        return _emit_stub(f"backtest_raised: {exc!r}")

    # ----- Assemble the artefact --------------------------------------- #
    metrics = {
        k: float(v)
        for k, v in (result.metrics or {}).items()
        if isinstance(v, (int, float))
    }
    round_trips = sum(1 for t in result.trades if t.is_closed)
    fills = len(result.fills)

    out = {
        "strategy": "dual_momentum",
        "params": DEFAULT_PARAMS,
        "start": OOS_START.isoformat(),
        "end": OOS_END.isoformat(),
        "metrics": metrics,
        "round_trip_trades": round_trips,
        "fills": fills,
    }

    eq = result.equity_curve
    if eq is not None and not eq.empty:
        eq_start = float(eq["equity"].iloc[0])
        eq_end = float(eq["equity"].iloc[-1])
        out["equity_start"] = eq_start
        out["equity_end"] = eq_end
        out["total_return"] = (eq_end / eq_start) - 1.0 if eq_start else 0.0
    attach_bootstrap_ci(out, bootstrap_ci_from_equity_frame(eq))

    # ----- Console summary --------------------------------------------- #
    print("=" * 70)
    print("Dual Momentum (GEM) — OOS Evaluation (DEFAULTS, 2023-01-02 → 2024-12-30)")
    print("=" * 70)
    print(f"Fills:             {fills}")
    print(f"Round-trip trades: {round_trips}")
    if "equity_start" in out:
        print(
            f"Equity: {out['equity_start']:,.2f} -> {out['equity_end']:,.2f}  "
            f"({out['total_return'] * 100:+.2f}%)"
        )
    print()
    print("Metrics:")
    for k in sorted(metrics):
        v = metrics[k]
        print(f"  {k:22s} = {v:.4f}")

    # ----- Write the artefact JSON (both locations) -------------------- #
    out_paths = [
        _ROOT / "backend" / "data" / "oos" / "phase1-dual_momentum-oos.json",
        _ROOT / "audit-reports" / "phase1-dual_momentum-oos.json",
    ]
    for p in out_paths:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, indent=2, default=str))
        print(f"Wrote {p}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
