"""Run the earnings-options-play event harness from a JSON event file.

Input format is a JSON array of event rows. Each row should include:
symbol, report_date, setup/top_setup, expected_move_pct, realized_move_pct,
premium_yield_call_atm and/or premium_yield_put_atm, and optionally edge_score.

Usage:
    .venv/bin/python scripts/backtest_earnings_options_play.py events.json
    .venv/bin/python scripts/backtest_earnings_options_play.py events.json --min-edge 70
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
for path in (ROOT, ROOT / "backend"):
    s = str(path)
    if s not in sys.path:
        sys.path.insert(0, s)

from services.earnings_backtest import run_event_backtest  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("events_json", type=Path)
    parser.add_argument("--min-edge", type=float, default=None)
    parser.add_argument("--max-events", type=int, default=None)
    parser.add_argument("--risk-fraction", type=float, default=0.01)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    events = json.loads(args.events_json.read_text())
    if not isinstance(events, list):
        raise SystemExit("events_json must contain a JSON array")
    result = run_event_backtest(
        events,
        min_edge_score=args.min_edge,
        max_events=args.max_events,
        risk_fraction=args.risk_fraction,
    )
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
