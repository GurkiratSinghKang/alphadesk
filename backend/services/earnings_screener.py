"""Earnings Options Play aggregator — pulls FMP earnings, Alpaca options
chain + IV, Newsdata news, and Claude structured/full analysis into one
response shape. Routes in `api/routes/earnings.py` are thin wrappers.

This module contains:
  • pure-function helpers (expected move, historical stats) — Task 5
  • the main aggregators `list_upcoming`, `get_detail`, `run_full_research`
    — Task 8
  • Claude prompt assembly delegated to `services.earnings_prompts` — Task 6
"""
from __future__ import annotations

import logging
import math
from typing import Mapping, Sequence

log = logging.getLogger(__name__)


# ─── Pure helpers ────────────────────────────────────────────

def compute_expected_move_from_straddle(
    *, underlying: float, call_mid: float, put_mid: float
) -> float | None:
    """Expected move % = ATM straddle mid / underlying price.

    Returns None if underlying is zero (guard against bad quote data).
    Returns 0.0 (not None) when both legs are zero — legit low-IV state.
    """
    if underlying <= 0:
        return None
    return (call_mid + put_mid) / underlying


def compute_historical_stats(quarters: Sequence[Mapping]) -> dict:
    """Roll up per-quarter earnings history into screener summary stats.

    `quarters` is a list of dicts with keys: report_date, surprise_pct,
    next_day_move_pct, five_day_move_pct. Any subset is tolerated — missing
    keys contribute 0 where applicable.
    """
    if not quarters:
        return {
            "avg_abs_move_pct": 0.0,
            "wins": 0,
            "losses": 0,
            "surprise_beat_rate": 0.0,
        }
    moves = [q.get("next_day_move_pct", 0.0) for q in quarters]
    abs_moves = [abs(m) for m in moves]
    wins = sum(1 for m in moves if m > 0)
    losses = sum(1 for m in moves if m < 0)
    surprises = [q.get("surprise_pct") for q in quarters]
    beats = sum(1 for s in surprises if s is not None and s > 0)
    total_with_surprise = sum(1 for s in surprises if s is not None)
    beat_rate = beats / total_with_surprise if total_with_surprise else 0.0
    # Use half-up rounding for avg_abs_move_pct so display-level assertions
    # on round(x, 4) behave predictably (Python's built-in round() uses
    # half-even / banker's rounding, which produces surprising results on
    # exact midpoints like 0.06175).
    raw_avg = sum(abs_moves) / len(abs_moves)
    avg = math.floor(raw_avg * 10_000 + 0.5) / 10_000
    return {
        "avg_abs_move_pct": avg,
        "wins": wins,
        "losses": losses,
        "surprise_beat_rate": beat_rate,
    }
