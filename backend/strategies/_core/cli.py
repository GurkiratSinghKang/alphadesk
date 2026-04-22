"""Shared CLI scaffolding for per-strategy `__main__.py` dispatchers.

Every strategy's __main__.py is a ~5-line shim:
    from strategies._core.cli import run_cli
    from strategies.<name>.strategy import <Name>Strategy
    if __name__ == "__main__":
        raise SystemExit(run_cli(<Name>Strategy))

This module implements the 7 subcommands (backtest, signal, tune,
analyze-day, schema, validate-params, explain) against any Strategy class.
Subcommand argparse bindings auto-generate from the strategy's Params
model + StrategyMeta.

Exit codes (stable contract):
    0  success
    2  params validation failed
    3  data unavailable
    4  strategy raised during run()
    5  snapshot mismatch during --replay (data drift)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

from pydantic import ValidationError

from strategies._core.contracts import (
    BacktestConfig,
    Signal,
    StrategyInput,
    StrategyParams,
    StrategyResult,
)
from strategies._core.protocol import Strategy


def run_cli(strategy_cls: type[Strategy]) -> int:
    parser = _build_parser(strategy_cls)
    args = parser.parse_args()
    try:
        return args.handler(strategy_cls, args)
    except ValidationError as e:
        print(e.json(indent=2), file=sys.stderr)
        return 2


def _build_parser(strategy_cls: type[Strategy]) -> argparse.ArgumentParser:
    meta = strategy_cls.META
    parser = argparse.ArgumentParser(
        prog=f"python -m strategies.{meta.name}",
        description=f"{meta.name} — {meta.description}",
    )
    sub = parser.add_subparsers(required=True, dest="cmd")

    _add_backtest(sub)
    _add_signal(sub)
    _add_tune(sub)
    _add_analyze_day(sub)
    _add_schema(sub)
    _add_validate(sub)
    _add_explain(sub)
    return parser


def _add_backtest(sub):
    p = sub.add_parser("backtest", help="Run full backtest over a date range")
    p.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    p.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--starting-cash", type=Decimal, default=Decimal("100000"))
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--snapshot-dir", type=Path, default=None)
    p.add_argument("--out", type=Path, default=None)
    p.set_defaults(handler=_handle_backtest)


def _add_signal(sub):
    p = sub.add_parser("signal", help="Run one bar; print signals")
    p.add_argument("--asof", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--replay", type=Path, default=None)
    p.set_defaults(handler=_handle_signal)


def _add_tune(sub):
    p = sub.add_parser("tune", help="Optuna parameter search")
    p.add_argument("--trials", type=int, default=100)
    p.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    p.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    p.add_argument("--study-name", default=None)
    p.add_argument("--walk-forward", action="store_true")
    p.set_defaults(handler=_handle_tune)


def _add_analyze_day(sub):
    p = sub.add_parser("analyze-day", help="One live-pipeline run")
    p.add_argument("--asof", type=date.fromisoformat, default=None)
    p.add_argument("--params", type=Path)
    p.add_argument("--dry-run", action="store_true")
    p.set_defaults(handler=_handle_analyze_day)


def _add_schema(sub):
    p = sub.add_parser("schema", help="Dump Pydantic JSON Schema")
    p.add_argument("target", choices=["params", "input", "result", "signal", "all"], default="params")
    p.add_argument("--pretty", action="store_true")
    p.set_defaults(handler=_handle_schema)


def _add_validate(sub):
    p = sub.add_parser("validate-params", help="Validate a params JSON file")
    p.add_argument("file", type=Path)
    p.set_defaults(handler=_handle_validate)


def _add_explain(sub):
    p = sub.add_parser("explain", help="Verbose signal run with diagnostics")
    p.add_argument("--asof", type=date.fromisoformat, required=True)
    p.add_argument("--params", type=Path)
    p.add_argument("--replay", type=Path, default=None)
    p.add_argument("--format", choices=["text", "json"], default="text")
    p.set_defaults(handler=_handle_explain)


def _load_params(strategy_cls: type[Strategy], path: Path | None) -> StrategyParams:
    if path is None:
        return strategy_cls.PARAMS_MODEL()
    return strategy_cls.PARAMS_MODEL.model_validate_json(path.read_text())


# ─── Handlers ────────────────────────────────────────────────

def _handle_backtest(strategy_cls, args) -> int:
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.backtest_runner import BacktestRunner

    params = _load_params(strategy_cls, args.params)
    providers = default_provider_bundle()
    runner = BacktestRunner(
        strategy=strategy_cls(),
        config=BacktestConfig(
            start=args.start, end=args.end,
            starting_cash=args.starting_cash,
            seed=args.seed, snapshot_dir=args.snapshot_dir,
        ),
        bar_provider=providers.bars,
        earnings_provider=providers.earnings,
        fundamentals_provider=providers.fundamentals,
    )
    result = runner.run(params)
    if args.out:
        _write_result(result, args.out)
    else:
        # Write summary to stdout (metrics + trade count); full result → --out
        summary = {
            "strategy": result.repro.strategy_name,
            "start": result.start.isoformat(),
            "end": result.end.isoformat(),
            "metrics": result.metrics,
            "trade_count": len(result.trades),
            "repro": result.repro.model_dump(mode="json"),
        }
        json.dump(summary, sys.stdout, indent=2, default=str)
    return 0


def _handle_signal(strategy_cls, args) -> int:
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.signal_runner import SignalRunner

    params = _load_params(strategy_cls, args.params)
    runner = SignalRunner(providers=default_provider_bundle() if not args.replay else None)
    result = runner.run_once(strategy_cls(), params, args.asof, replay_from=args.replay)
    json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    return 0


def _handle_tune(strategy_cls, args) -> int:
    from tuner.runner import run as tuner_run
    tuner_run(
        strategy_name=strategy_cls.META.name,
        params_model=strategy_cls.PARAMS_MODEL,
        trials=args.trials, start=args.start, end=args.end,
        study_name=args.study_name or f"{strategy_cls.META.name}_cli",
        walk_forward=args.walk_forward,
    )
    return 0


def _handle_analyze_day(strategy_cls, args) -> int:
    import asyncio
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.pipeline_runner import DailyPipelineRunner, StateStore

    params = _load_params(strategy_cls, args.params)
    runner = DailyPipelineRunner(
        strategy=strategy_cls(),
        providers=default_provider_bundle(),
        state_store=StateStore(),
    )
    result = asyncio.run(runner.run_today(params, asof=args.asof))
    json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    return 0


def _handle_schema(strategy_cls, args) -> int:
    mapping = {
        "params": strategy_cls.PARAMS_MODEL,
        "input":  StrategyInput,
        "result": StrategyResult,
        "signal": Signal,
    }
    if args.target == "all":
        out = {k: v.model_json_schema() for k, v in mapping.items()}
    else:
        out = mapping[args.target].model_json_schema()
    json.dump(out, sys.stdout, indent=2 if args.pretty else None)
    return 0


def _handle_validate(strategy_cls, args) -> int:
    try:
        params = strategy_cls.PARAMS_MODEL.model_validate_json(args.file.read_text())
    except ValidationError as e:
        print(e.json(indent=2), file=sys.stderr)
        return 2
    print(f"OK — {args.file} validates as {strategy_cls.PARAMS_MODEL.__name__}", file=sys.stderr)
    json.dump(params.model_dump(mode="json"), sys.stdout, indent=2)
    return 0


def _handle_explain(strategy_cls, args) -> int:
    """Same as signal, but prints diagnostics + universe + filter decisions."""
    from strategies._core.providers import default_provider_bundle
    from strategies._core.runners.signal_runner import SignalRunner

    params = _load_params(strategy_cls, args.params)
    runner = SignalRunner(providers=default_provider_bundle() if not args.replay else None)
    result = runner.run_once(strategy_cls(), params, args.asof, replay_from=args.replay)

    if args.format == "json":
        json.dump(result.model_dump(mode="json"), sys.stdout, indent=2, default=str)
    else:
        print(f"=== {strategy_cls.META.name} @ {args.asof} ===")
        print(f"\nSignals emitted: {len(result.signals)}")
        for s in result.signals:
            print(f"  * {s.symbol} {s.order_type.value} qty={s.quantity} tag={s.tag!r}")
        print(f"\nDiagnostics:")
        for k, v in result.diagnostics.items():
            print(f"  {k}: {v}")
        if result.warnings:
            print(f"\nWarnings:")
            for w in result.warnings:
                print(f"  ! {w}")
    return 0


def _write_result(result, path: Path) -> None:
    if path.suffix == ".json":
        path.write_text(json.dumps(result.model_dump(mode="json"), indent=2, default=str))
    elif path.suffix == ".parquet":
        # Write the equity_curve as parquet; metadata in a companion JSON
        result.equity_curve.to_parquet(path)
        meta_path = path.with_suffix(".meta.json")
        meta = {
            "trades": [t.model_dump(mode="json") for t in result.trades],
            "metrics": result.metrics,
            "params": result.params,
            "repro": result.repro.model_dump(mode="json"),
        }
        meta_path.write_text(json.dumps(meta, indent=2, default=str))
    else:
        raise ValueError(f"Unsupported output extension: {path.suffix}")
