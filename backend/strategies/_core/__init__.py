"""Unified strategy shell — Pydantic-v2 contracts + ABC + runners + CLI.

Every strategy in AlphaDesk implements the Strategy ABC defined in
protocol.py, is driven by one of the runners in runners/, and is invoked
either programmatically or via `python -m strategies.<name>` (cli.py).

RUNNER_VERSION is stamped into every BacktestResult.repro so you can tell
when results came from a different runner release (bar iteration order,
fill model changes, seed-forking scheme, etc).
"""
# Round-11 / AA-1.6 (P1): version bumped from 1.0.0 → 1.1.0 to
# reflect the cumulative behaviour-changing runner releases since
# the original baseline:
#   * Round-6 / I-1   — research-kind strategies blocked from live
#   * Round-6 / I-11  — ReproMeta determinism (run_at moved off repro)
#   * Round-6 / I-13  — positions_provider required in live mode
#   * Round-6 / I-19  — ActivePair frozen for replay determinism
#   * Round-7 / O-1   — strategy_runner positions_provider wiring
#   * Round-8         — paper_only field on StrategyMeta + pipeline gate
#   * Round-11 / AA-1.1 — pairs_trading frozen-Pydantic mutation fix
#   * Round-11 / AA-1.2 — FillSimulator respects order_type + limit_price
#   * Round-11 / AA-1.3 — daily pipeline respects operator strategy-pause
# Bump again on any future runner-semantic change so replay debugging
# can distinguish behaviour drift from parameter changes.
RUNNER_VERSION = "1.1.0"
