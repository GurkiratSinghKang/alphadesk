"""6-month smoke backtest on real Alpaca data.

Not a unit test — this is a wall-clock integration run that verifies:

- The strategy configures, emits at least one fill against real bars, and
  the engine's summary metrics come back sensible (trend system -> low
  fill count is fine; zero fills means the ER / SMA200 gates are miscalibrated).
- Warn if ER gate rejects *every* bar (would be a configuration bug).

Run with::

    .venv/bin/python backend/strategies/kama_breakout/tests/smoke_backtest.py \\
        --start 2022-06-01 --end 2022-12-30

Reads ALPACA_API_KEY / ALPACA_SECRET_KEY from ``.env`` (see
:mod:`backend.core.config`).
"""

from __future__ import annotations

import argparse
import importlib
import logging
import sys
import types
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path


def _bootstrap() -> None:
    """Install the same backend.strategies stub as the test conftest."""

    repo = Path(__file__).resolve().parents[4]
    sp = str(repo)
    if sp not in sys.path:
        sys.path.insert(0, sp)

    b = types.ModuleType("backend")
    b.__path__ = [str(repo / "backend")]
    b.__file__ = "(stub)"
    sys.modules["backend"] = b
    s = types.ModuleType("backend.strategies")
    s.__path__ = [str(repo / "backend" / "strategies")]
    s.__file__ = "(stub)"
    sys.modules["backend.strategies"] = s


_bootstrap()


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=_parse_date, default=date(2022, 6, 1))
    parser.add_argument("--end", type=_parse_date, default=date(2022, 12, 30))
    parser.add_argument(
        "--symbols",
        nargs="*",
        default=["SPY", "QQQ", "IWM", "XLE", "XLK", "XLV", "XLI", "XLF"],
        help="Universe override (default is an 8-ETF diversified basket).",
    )
    parser.add_argument("--cash", type=Decimal, default=Decimal("100000"))
    parser.add_argument(
        "--er-min",
        type=float,
        default=None,
        help="Override er_min_trend (default from config).",
    )
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    from backend.backtest.engine import BacktestEngine, EngineConfig
    from backend.data.providers.alpaca import AlpacaBarProvider
    from backend.strategies.kama_breakout.strategy import KamaBreakout

    params: dict = {"universe_symbols": args.symbols}
    if args.er_min is not None:
        params["er_min_trend"] = float(args.er_min)

    strat = KamaBreakout()
    cfg = EngineConfig(
        start=args.start,
        end=args.end,
        starting_cash=args.cash,
        timeframe="1D",
    )
    with AlpacaBarProvider() as provider:
        engine = BacktestEngine(
            strategy=strat,
            bar_provider=provider,
            config=cfg,
            strategy_params=params,
        )
        result = engine.run()

    # Summaries.
    print("=" * 72)
    print(f"KAMA Breakout smoke backtest  {args.start} → {args.end}")
    print("=" * 72)
    print(f"Universe:          {args.symbols}")
    print(f"Starting cash:     ${float(args.cash):,.0f}")
    print(f"Total fills:       {len(result.fills)}")
    print(f"Total trades:      {len(result.trades)}")
    if not result.equity_curve.empty:
        final_equity = float(result.equity_curve['equity'].iloc[-1])
        ret_pct = (final_equity / float(args.cash) - 1.0) * 100
        print(f"Final equity:      ${final_equity:,.0f} ({ret_pct:+.2f}%)")
    for k in (
        "sharpe",
        "cagr",
        "max_drawdown",
        "hit_rate",
        "profit_factor",
        "turnover",
    ):
        v = result.metrics.get(k)
        if v is None:
            continue
        if k == "max_drawdown":
            print(f"Max drawdown:      {float(v) * 100:.2f}%")
        elif k == "hit_rate":
            print(f"Hit rate:          {float(v) * 100:.1f}%")
        elif k == "cagr":
            print(f"CAGR:              {float(v) * 100:.2f}%")
        elif k == "turnover":
            print(f"Turnover:          {float(v):.2f}")
        else:
            print(f"{k.capitalize():<18} {float(v):.3f}")

    # Sample fills to verify tags.
    print("\nFirst 8 fills:")
    for f in result.fills[:8]:
        print(
            f"  {f.ts.date()}  {f.symbol:<6} {f.side.value:<4} {f.quantity:>5} "
            f"@ {float(f.price):>8.2f}  {f.tag}"
        )

    # Sanity: at least one fill on ETF basket in a 6-month trending window is
    # expected. Zero means the gates are way too tight.
    if len(result.fills) == 0:
        print(
            "\nWARNING: zero fills. If this persists, relax er_min_trend or "
            "trend_sma_period, or lengthen the window.",
            file=sys.stderr,
        )
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
