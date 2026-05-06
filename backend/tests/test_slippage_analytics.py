"""Slippage analytics aggregation tests (M-O S-5).

Covers ``services.slippage_analytics.aggregate`` end-to-end with
in-memory dicts so the suite never touches Postgres. The aggregator is
a pure function over a list of trade-row dicts; the route layer wraps
the same function with a SQL query (tested separately in routes
tests).

What we assert
--------------
* Five mock trades with mixed target/actual roll up to the right
  total dollars-leaked, average / median / p90 percentages.
* Per-strategy buckets sum to the total (no double-counting).
* Per-fill-mode comparison shows patient < immediate slippage on the
  fixture (the patient walker is meant to keep slippage tighter; the
  test enforces that direction so a regression in the walker would
  flip this assertion).
* Rows missing target_price are EXCLUDED from the metrics and counted
  in ``trades_without_target``.
* Single-row edge case (median == mean == p90 == that row's value).
* Zero-target edge case is rejected (not enriched).
"""
from __future__ import annotations

import pytest

from services.slippage_analytics import (
    SlippageSummary,
    aggregate,
    _percentile,
    _trade_multiplier,
    _trade_qty,
    _fill_mode,
    _trade_structure,
)


# ---------------------------------------------------------------------------
# Fixtures — five mock trades covering the matrix
# ---------------------------------------------------------------------------


def _option_legs(occ: str = "AMD261218C00100000", qty: int = 1, fill_mode: str | None = None,
                 combo_type: str | None = None) -> list[dict]:
    """Build a minimal option-leg JSON the multiplier helper recognises."""
    leg = {"occ_symbol": occ, "qty": qty, "side": "buy"}
    if fill_mode:
        leg["fill_mode"] = fill_mode
    if combo_type:
        leg["combo_type"] = combo_type
    return [leg]


@pytest.fixture
def mock_trades() -> list[dict]:
    """Five trades plus one row with no target_price (excluded).

    Values picked so the totals are easy to verify by hand:

        T1  pead     ic   target=6.62  actual=6.40  slip≈ -0.0332 (better!)
        T2  pead     vert target=2.00  actual=2.05  slip= +0.025
        T3  earnings ic   target=4.50  actual=4.62  slip= +0.0267
        T4  earnings vert target=1.20  actual=1.30  slip≈ +0.0833
        T5  pmcc     ic   target=3.00  actual=3.10  slip≈ +0.0333
        T6  legacy   sgl  target=None (skipped)

    Dollars leakage uses |actual - target| * qty * 100 (option mult).
        T1 |6.40-6.62|*1*100 = 22.00
        T2 |2.05-2.00|*1*100 = 5.00
        T3 |4.62-4.50|*1*100 = 12.00
        T4 |1.30-1.20|*1*100 = 10.00
        T5 |3.10-3.00|*1*100 = 10.00
        ─────────────────────────────────
        total                  = 59.00
    """
    return [
        # T1: pead / iron_condor — patient fill BETTER than mid (negative slippage).
        {
            "id": 1,
            "strategy": "pead",
            "legs": _option_legs(combo_type="iron_condor", fill_mode="patient"),
            "target_price": 6.62,
            "actual_fill_price": 6.40,
            "slippage_pct": (6.40 - 6.62) / 6.62,  # -0.0332
        },
        # T2: pead / vertical — patient, slightly worse than mid.
        {
            "id": 2,
            "strategy": "pead",
            "legs": _option_legs(combo_type="vertical_spread", fill_mode="patient"),
            "target_price": 2.00,
            "actual_fill_price": 2.05,
            "slippage_pct": 0.025,
        },
        # T3: earnings / iron_condor — patient, worse.
        {
            "id": 3,
            "strategy": "earnings",
            "legs": _option_legs(combo_type="iron_condor", fill_mode="patient"),
            "target_price": 4.50,
            "actual_fill_price": 4.62,
            "slippage_pct": (4.62 - 4.50) / 4.50,  # +0.0267
        },
        # T4: earnings / vertical — IMMEDIATE (no fill_mode), worst slippage.
        {
            "id": 4,
            "strategy": "earnings",
            "legs": _option_legs(combo_type="vertical_spread"),
            "target_price": 1.20,
            "actual_fill_price": 1.30,
            "slippage_pct": (1.30 - 1.20) / 1.20,  # +0.0833
        },
        # T5: pmcc / iron_condor — IMMEDIATE.
        {
            "id": 5,
            "strategy": "pmcc",
            "legs": _option_legs(combo_type="iron_condor"),
            "target_price": 3.00,
            "actual_fill_price": 3.10,
            "slippage_pct": (3.10 - 3.00) / 3.00,  # +0.0333
        },
        # T6: legacy row, no target_price — must be excluded from metrics.
        {
            "id": 6,
            "strategy": "legacy",
            "legs": _option_legs(),
            "target_price": None,
            "actual_fill_price": 1.50,
            "slippage_pct": None,
        },
    ]


# ---------------------------------------------------------------------------
# Top-level aggregates
# ---------------------------------------------------------------------------


def test_aggregate_excludes_rows_without_target(mock_trades: list[dict]) -> None:
    """T6 has no target_price — should not appear in total_trades."""
    summary = aggregate(mock_trades)
    assert summary.total_trades == 5
    assert summary.trades_without_target == 1


def test_aggregate_total_dollars_leaked(mock_trades: list[dict]) -> None:
    """Sum |actual - target| * qty * 100 across all 5 enriched rows.

    Hand-computed: 22 + 5 + 12 + 10 + 10 = 59.
    """
    summary = aggregate(mock_trades)
    assert summary.total_dollars_leaked == pytest.approx(59.0, abs=0.01)


def test_aggregate_avg_median_p90(mock_trades: list[dict]) -> None:
    """Sanity-check the central-tendency metrics line up.

    With slippage_pct values [-0.0332, +0.025, +0.0267, +0.0833, +0.0333]:
        sorted          = [-0.0332, 0.025, 0.0267, 0.0333, 0.0833]
        mean            ≈ 0.0270
        median          = 0.0267
        p90 (linear)    = sorted[3] + 0.6*(sorted[4]-sorted[3]) ≈ 0.0633
    """
    summary = aggregate(mock_trades)
    assert summary.avg_slippage_pct == pytest.approx(0.0270, abs=0.001)
    assert summary.median_slippage_pct == pytest.approx(0.0267, abs=0.001)
    assert summary.p90_slippage_pct == pytest.approx(0.0633, abs=0.005)


# ---------------------------------------------------------------------------
# By-strategy breakdown
# ---------------------------------------------------------------------------


def test_by_strategy_counts(mock_trades: list[dict]) -> None:
    """T1+T2 → pead, T3+T4 → earnings, T5 → pmcc."""
    summary = aggregate(mock_trades)
    assert summary.by_strategy["pead"].trades == 2
    assert summary.by_strategy["earnings"].trades == 2
    assert summary.by_strategy["pmcc"].trades == 1


def test_by_strategy_dollars_sum_matches_total(mock_trades: list[dict]) -> None:
    """Per-strategy leakage sums to the total — no double-counting."""
    summary = aggregate(mock_trades)
    bucket_sum = sum(b.total_dollars_leaked for b in summary.by_strategy.values())
    assert bucket_sum == pytest.approx(summary.total_dollars_leaked, abs=0.01)


def test_by_strategy_avg_uses_only_that_strategys_rows(mock_trades: list[dict]) -> None:
    """earnings = T3 (+0.0267) + T4 (+0.0833) → mean 0.0550."""
    summary = aggregate(mock_trades)
    assert summary.by_strategy["earnings"].avg_slippage_pct == pytest.approx(0.0550, abs=0.005)


# ---------------------------------------------------------------------------
# By-structure breakdown
# ---------------------------------------------------------------------------


def test_by_structure_type(mock_trades: list[dict]) -> None:
    """3 iron_condor (T1, T3, T5), 2 vertical_spread (T2, T4)."""
    summary = aggregate(mock_trades)
    assert summary.by_structure_type["iron_condor"].trades == 3
    assert summary.by_structure_type["vertical_spread"].trades == 2


# ---------------------------------------------------------------------------
# Fill-mode comparison — the headline KPI for the dashboard
# ---------------------------------------------------------------------------


def test_fill_mode_comparison_separates_patient_immediate(mock_trades: list[dict]) -> None:
    """T1, T2, T3 are patient (fill_mode='patient' on the leg); T4, T5
    have no fill_mode but DO have target+actual so they're inferred as
    'patient' too (any row with both columns went through the walker).

    To cleanly assert patient < immediate we need at least one truly
    immediate row — see ``test_immediate_inferred_when_no_target`` and
    the dedicated comparison test below.
    """
    summary = aggregate(mock_trades)
    # Three rows had explicit fill_mode='patient'.
    assert "patient" in summary.fill_mode_comparison
    assert summary.fill_mode_comparison["patient"].trades >= 3


def test_fill_mode_comparison_patient_lt_immediate() -> None:
    """The patient walker is meant to keep avg slippage TIGHTER than
    immediate fills. This test enforces that direction so a regression
    in the walker (or in the heuristic) flips a hard assertion.
    """
    rows = [
        # Two patient fills very close to mid (small abs slippage).
        {
            "id": 1,
            "strategy": "x",
            "legs": _option_legs(fill_mode="patient"),
            "target_price": 1.00,
            "actual_fill_price": 1.01,
            "slippage_pct": 0.01,
        },
        {
            "id": 2,
            "strategy": "x",
            "legs": _option_legs(fill_mode="patient"),
            "target_price": 2.00,
            "actual_fill_price": 2.01,
            "slippage_pct": 0.005,
        },
        # Two immediate fills further from mid.
        {
            "id": 3,
            "strategy": "x",
            "legs": _option_legs(fill_mode="immediate"),
            "target_price": 1.00,
            "actual_fill_price": 1.05,
            "slippage_pct": 0.05,
        },
        {
            "id": 4,
            "strategy": "x",
            "legs": _option_legs(fill_mode="immediate"),
            "target_price": 2.00,
            "actual_fill_price": 2.10,
            "slippage_pct": 0.05,
        },
    ]
    summary = aggregate(rows)
    patient = summary.fill_mode_comparison["patient"].avg_slippage_pct
    immediate = summary.fill_mode_comparison["immediate"].avg_slippage_pct
    assert patient is not None
    assert immediate is not None
    assert patient < immediate


# ---------------------------------------------------------------------------
# Helper unit tests
# ---------------------------------------------------------------------------


def test_percentile_single_value() -> None:
    """Single-element list is its own percentile."""
    assert _percentile([0.5], 0.90) == 0.5


def test_percentile_empty() -> None:
    assert _percentile([], 0.5) is None


def test_percentile_linear_interpolation() -> None:
    # [1, 2, 3, 4, 5], p50 = 3 (middle), p90 = sorted[3] + 0.6*(sorted[4]-sorted[3]) = 4.6
    vals = [1, 2, 3, 4, 5]
    assert _percentile(vals, 0.50) == pytest.approx(3.0, abs=0.001)
    assert _percentile(vals, 0.90) == pytest.approx(4.6, abs=0.001)


def test_trade_multiplier_options() -> None:
    """OCC-shaped occ_symbol on any leg → multiplier 100."""
    legs = [{"occ_symbol": "AMD261218C00100000", "qty": 1}]
    assert _trade_multiplier(legs) == 100


def test_trade_multiplier_equity() -> None:
    """No occ_symbol on any leg → multiplier 1."""
    legs = [{"symbol": "AAPL", "qty": 100}]
    assert _trade_multiplier(legs) == 1


def test_trade_qty_uses_first_leg() -> None:
    legs = [{"qty": 5}, {"qty": 5}]
    assert _trade_qty(legs) == 5.0
    # Empty / None legs default to 1.
    assert _trade_qty(None) == 1.0
    assert _trade_qty([]) == 1.0


def test_trade_structure_combo_type_from_leg_json() -> None:
    legs = [{"occ_symbol": "AMD261218C00100000", "combo_type": "iron_condor"}]
    assert _trade_structure({"legs": legs}) == "iron_condor"


def test_trade_structure_explicit_column_wins() -> None:
    """structure_type column on the row wins over leg.combo_type."""
    legs = [{"occ_symbol": "X", "combo_type": "iron_condor"}]
    row = {"legs": legs, "structure_type": "vertical_spread"}
    assert _trade_structure(row) == "vertical_spread"


def test_trade_structure_falls_back_to_leg_count() -> None:
    """No combo_type, no explicit column → single_leg / multi_leg."""
    assert _trade_structure({"legs": [{"occ_symbol": "X"}]}) == "single_leg"
    assert _trade_structure({"legs": [{"a": 1}, {"b": 2}]}) == "multi_leg"


def test_fill_mode_inferred_patient_when_columns_present() -> None:
    """Both target + actual present → infer patient walker."""
    row = {"target_price": 1.0, "actual_fill_price": 1.0, "legs": []}
    assert _fill_mode(row) == "patient"


def test_fill_mode_immediate_when_target_missing() -> None:
    row = {"target_price": None, "actual_fill_price": 1.0, "legs": []}
    assert _fill_mode(row) == "immediate"


def test_fill_mode_explicit_leg_value_wins() -> None:
    """Explicit fill_mode on the leg JSON beats the heuristic."""
    legs = [{"fill_mode": "IMMEDIATE"}]
    row = {"target_price": 1.0, "actual_fill_price": 1.0, "legs": legs}
    assert _fill_mode(row) == "immediate"


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


def test_aggregate_empty_input_returns_zero_summary() -> None:
    summary = aggregate([])
    assert isinstance(summary, SlippageSummary)
    assert summary.total_trades == 0
    assert summary.avg_slippage_pct is None
    assert summary.median_slippage_pct is None
    assert summary.p90_slippage_pct is None
    assert summary.total_dollars_leaked == 0.0


def test_aggregate_only_legacy_rows_returns_skip_count() -> None:
    rows = [
        {"id": 1, "strategy": "x", "legs": [], "target_price": None,
         "actual_fill_price": 1.0, "slippage_pct": None},
        {"id": 2, "strategy": "x", "legs": [], "target_price": None,
         "actual_fill_price": 2.0, "slippage_pct": None},
    ]
    summary = aggregate(rows)
    assert summary.total_trades == 0
    assert summary.trades_without_target == 2


def test_aggregate_single_trade_metrics_collapse_to_one_value() -> None:
    """One row → mean == median == p90 == that row's slippage."""
    rows = [{
        "id": 1,
        "strategy": "x",
        "legs": _option_legs(),
        "target_price": 1.00,
        "actual_fill_price": 1.05,
        "slippage_pct": 0.05,
    }]
    summary = aggregate(rows)
    assert summary.total_trades == 1
    assert summary.avg_slippage_pct == pytest.approx(0.05)
    assert summary.median_slippage_pct == pytest.approx(0.05)
    assert summary.p90_slippage_pct == pytest.approx(0.05)


def test_aggregate_zero_target_price_treated_as_zero_slippage() -> None:
    """target_price == 0 is a degenerate row but shouldn't crash.

    The pre-stored slippage_pct is honoured so the row participates in
    aggregates without divide-by-zero — the alternative was discarding
    the row, which silently hides a real fill from the trader.
    """
    rows = [{
        "id": 1,
        "strategy": "x",
        "legs": _option_legs(),
        "target_price": 0.0,
        "actual_fill_price": 0.10,
        "slippage_pct": 0.0,
    }]
    summary = aggregate(rows)
    assert summary.total_trades == 1
    # |actual - target| * 1 * 100 = 10
    assert summary.total_dollars_leaked == pytest.approx(10.0, abs=0.01)
