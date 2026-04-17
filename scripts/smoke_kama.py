#!/usr/bin/env python
"""Smoke test for the KAMA Breakout strategy.

Runs a 6-month backtest on real Alpaca bars (Jan-Jun 2024) over a
diversified 7-ETF universe. Verifies:

- Strategy loads via the registry.
- At least one fill is produced (ER / SMA200 gates are calibrated).
- Final equity and summary metrics come back sensible.

Run from repo root::

    PYTHONPATH=. .venv/bin/python scripts/smoke_kama.py
"""

from __future__ import annotations

import sys
import types
from datetime import date
from decimal import Decimal
from pathlib import Path


def _install_stubs() -> None:
    """Avoid triggering the legacy ``backend/strategies/__init__.py`` package
    init from importing everything under ``strategies.*`` transitively.
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
    from backend.backtest.engine import BacktestEngine, EngineConfig
    from backend.data.providers.alpaca import AlpacaBarProvider
    from backend.strategies.kama_breakout.strategy import KamaBreakout
    from backend.strategies.registry import get_strategy

    print("Smoke test: KAMA Breakout")
    print("=" * 60)

    # Verify registry lookup works.
    reg_cls = get_strategy("kama_breakout")
    if reg_cls is None:
        print("FAIL: strategy not in registry")
        return 1
    print(f"Registry lookup OK: {reg_cls.__name__}")

    universe = ["SPY", "QQQ", "XLK", "XLF", "XLE", "XLV", "XLI"]
    strat = KamaBreakout()

    start = date(2024, 1, 2)
    end = date(2024, 6, 28)
    cfg = EngineConfig(
        start=start,
        end=end,
        starting_cash=Decimal("100000"),
        timeframe="1D",
        benchmark="SPY",
    )

    params = {"universe_symbols": universe}

    with AlpacaBarProvider() as bp:
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=bp,
            config=cfg,
            strategy_params=params,
        )
        result = engine.run()

    eq = result.equity_curve
    print(f"Universe           : {universe}")
    print(f"Bars run           : {len(eq)}")
    print(f"Fills              : {len(result.fills)}")
    print(f"Trades (round trip): {sum(1 for t in result.trades if t.is_closed)}")
    if not eq.empty:
        final = float(eq["equity"].iloc[-1])
        initial = float(cfg.starting_cash)
        print(f"Start equity       : ${initial:,.2f}")
        print(f"End equity         : ${final:,.2f}")
        print(f"Return             : {(final / initial - 1) * 100:+.2f}%")
    metrics = result.metrics or {}
    sharpe = metrics.get("sharpe")
    mdd = metrics.get("max_drawdown")
    cagr = metrics.get("cagr")
    hit = metrics.get("hit_rate")
    pf = metrics.get("profit_factor")
    turnover = metrics.get("turnover")
    if sharpe is not None:
        print(f"Sharpe             : {float(sharpe):.3f}")
    if cagr is not None:
        print(f"CAGR               : {float(cagr) * 100:.2f}%")
    if mdd is not None:
        print(f"Max drawdown       : {float(mdd) * 100:.2f}%")
    if hit is not None:
        print(f"Hit rate           : {float(hit) * 100:.2f}%")
    if pf is not None:
        print(f"Profit factor      : {float(pf):.3f}")
    if turnover is not None:
        print(f"Turnover (ann)     : {float(turnover):.2f}")

    # Print fills for sanity check
    print("\nFills (showing up to 30):")
    for f in result.fills[:30]:
        print(
            f"  {f.ts.date()} {f.side.value:5} {f.symbol:5} "
            f"qty={f.quantity:5} @ {float(f.price):8.2f} tag={f.tag}"
        )

    # Tickers touched
    touched = sorted({f.symbol for f in result.fills})
    print(f"\nTickers touched    : {touched}")

    n_fills = len(result.fills)
    if n_fills == 0:
        print("FAIL: zero fills — strategy did not emit any signals.")
        print("  Likely causes: ER gate too tight, trend filter reject, or no warmup bars.")
        return 1

    print("\nOK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
