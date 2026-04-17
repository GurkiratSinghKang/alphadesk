"""Command-line entrypoint for the backtest engine.

    python -m backend.backtest --strategy=NAME --start=YYYY-MM-DD --end=YYYY-MM-DD

Flags:

    --strategy       strategy registry key (e.g. "rsi2", "momentum_quality")
    --start / --end  ISO dates (inclusive)
    --cash           starting equity (default 100000)
    --walk-forward   run a 5-fold purged walk-forward instead of a single pass
    --train-end      when set, run a train/test split with this OOS boundary
    --k-folds        K-fold count (default 5, used with --walk-forward)
    --purge-days     purge window (default 60)
    --benchmark      symbol for benchmark comparison (e.g. SPY)
    --output-dir     where to write reports (default ./backtest_reports)
    --params         JSON string of strategy params
    --seed           RNG seed (default 42)

The strategy is resolved through ``backend.strategies.registry.get_strategy``
when that module exists (team F4). Until it lands, the CLI reports a helpful
error and exits.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Optional

from backend.backtest.engine import BacktestEngine, EngineConfig
from backend.backtest.report import ReportWriter
from backend.backtest.walkforward import WalkForwardConfig, WalkForwardRunner


def _parse_date(s: str) -> date:
    return datetime.strptime(s, "%Y-%m-%d").date()


def _resolve_strategy_factory(name: str) -> Callable[[], Any]:
    """Return a callable that returns a fresh strategy instance."""

    try:  # pragma: no cover - optional dependency on team F4
        from backend.strategies.registry import get_strategy  # type: ignore

        def factory() -> Any:
            return get_strategy(name)

        return factory
    except Exception:

        def factory() -> Any:  # pragma: no cover
            raise RuntimeError(
                "Strategy registry not available yet. Team F4 is building "
                "`backend/strategies/registry.py`. Once it exists, the CLI "
                "will resolve strategies via `get_strategy(name)`."
            )

        return factory


def _resolve_bar_provider():
    """Pick the default bar provider from team F2 if available."""

    try:  # pragma: no cover
        from backend.data.providers.alpaca import AlpacaBarProvider  # type: ignore

        return AlpacaBarProvider()
    except Exception:
        return None


def _resolve_extra_providers() -> dict[str, Any]:
    providers: dict[str, Any] = {}
    try:  # pragma: no cover
        from backend.data.providers.polygon import PolygonOptionsProvider  # type: ignore

        providers["options_provider"] = PolygonOptionsProvider()
    except Exception:
        pass
    try:  # pragma: no cover
        from backend.data.providers.fmp import (  # type: ignore
            FmpEarningsProvider,
            FmpFundamentalsProvider,
        )

        providers["earnings_provider"] = FmpEarningsProvider()
        providers["fundamentals_provider"] = FmpFundamentalsProvider()
    except Exception:
        pass
    try:  # pragma: no cover
        from backend.data.calendar import UsMarketCalendar  # type: ignore

        providers["calendar_provider"] = UsMarketCalendar()
    except Exception:
        pass
    return providers


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="backend.backtest", description=__doc__)
    p.add_argument("--strategy", required=True)
    p.add_argument("--start", required=True, type=_parse_date)
    p.add_argument("--end", required=True, type=_parse_date)
    p.add_argument("--cash", type=Decimal, default=Decimal("100000"))
    p.add_argument("--walk-forward", action="store_true")
    p.add_argument("--train-end", type=_parse_date, default=None)
    p.add_argument("--k-folds", type=int, default=5)
    p.add_argument("--purge-days", type=int, default=60)
    p.add_argument("--benchmark", type=str, default=None)
    p.add_argument("--output-dir", type=Path, default=Path("./backtest_reports"))
    p.add_argument("--params", type=str, default="{}", help="JSON dict")
    p.add_argument("--seed", type=int, default=42)
    return p


def main(argv: Optional[list[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    strategy_factory = _resolve_strategy_factory(args.strategy)
    bar_provider = _resolve_bar_provider()
    if bar_provider is None:
        print(
            "error: no bar provider available. Team F2 is building "
            "`backend/data/providers/`. Provide one via the Python API "
            "or wait for the data team to land.",
            file=sys.stderr,
        )
        return 2

    extra = _resolve_extra_providers()
    params = json.loads(args.params) if args.params else {}

    if args.walk_forward or args.train_end is not None:
        wf_cfg = WalkForwardConfig(
            start=args.start,
            end=args.end,
            train_end=args.train_end,
            k_folds=args.k_folds,
            purge_days=args.purge_days,
            starting_cash=args.cash,
            benchmark=args.benchmark,
            seed=args.seed,
        )
        runner = WalkForwardRunner(
            strategy_factory=strategy_factory,
            bar_provider=bar_provider,
            config=wf_cfg,
            strategy_params=params,
            **extra,
        )
        if args.train_end is not None:
            wf = runner.run_train_test()
        else:
            wf = runner.run_k_fold()
        writer = ReportWriter(args.output_dir)
        if wf.out_of_sample_result is not None:
            writer.write(wf.out_of_sample_result, name=f"{args.strategy}_oos")
        if wf.in_sample_result is not None:
            writer.write(wf.in_sample_result, name=f"{args.strategy}_is")
        for fr in wf.folds:
            writer.write(fr.result, name=f"{args.strategy}_fold{fr.fold}")
        print(json.dumps(wf.aggregated_metrics, default=str, indent=2))
        return 0

    engine = BacktestEngine(
        strategy=strategy_factory(),
        bar_provider=bar_provider,
        config=EngineConfig(
            start=args.start,
            end=args.end,
            starting_cash=args.cash,
            benchmark=args.benchmark,
            seed=args.seed,
        ),
        strategy_params=params,
        **extra,
    )
    result = engine.run()
    writer = ReportWriter(args.output_dir)
    writer.write(result, name=args.strategy)
    print(json.dumps(result.metrics, default=str, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
