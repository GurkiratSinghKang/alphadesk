"""Unified strategy shell — Pydantic-v2 contracts + ABC + runners + CLI.

Every strategy in AlphaDesk implements the Strategy ABC defined in
protocol.py, is driven by one of the runners in runners/, and is invoked
either programmatically or via `python -m strategies.<name>` (cli.py).

RUNNER_VERSION is stamped into every BacktestResult.repro so you can tell
when results came from a different runner release (bar iteration order,
fill model changes, seed-forking scheme, etc).
"""
RUNNER_VERSION = "1.0.0"
