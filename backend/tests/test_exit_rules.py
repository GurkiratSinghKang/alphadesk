"""Tests for the exit-rules engine (PM-6 / Wave 5A).

Covers ``services.exit_rules.evaluate_exit_rules``,
``services.position_roller.evaluate_auto_roll``, and the seed-rule
contract from ``alembic/versions/0016_exit_rules.py``.

We use stub rule objects (``_StubRule``) instead of mapped ``ExitRule``
ORM rows so the suite runs without a Postgres engine — same pattern
used by ``backend/data/storage/tests/test_audit_log.py``. The
evaluator's contract is "given these rules + this trade + these marks,
return the highest-priority firing decision (or None)" — that contract
is fully exercised against in-process Python objects.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

# Make ``backend/`` importable — mirrors the other test modules.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


# ---------------------------------------------------------------------------
# Stubs — minimal duck-typed ExitRule objects
# ---------------------------------------------------------------------------


class _StubRule(SimpleNamespace):
    """Subset of ``ExitRule`` with only the fields the evaluator reads."""

    id: int
    strategy: str | None
    structure_type: str | None
    rule_type: str
    threshold: float
    action: str
    enabled: bool
    priority: int


def _rule(
    *,
    id: int = 1,
    strategy: str | None = None,
    structure_type: str | None = None,
    rule_type: str = "profit_pct",
    threshold: float = 0.50,
    action: str = "close",
    enabled: bool = True,
    priority: int = 100,
) -> _StubRule:
    return _StubRule(
        id=id,
        strategy=strategy,
        structure_type=structure_type,
        rule_type=rule_type,
        threshold=threshold,
        action=action,
        enabled=enabled,
        priority=priority,
    )


def _iron_condor_trade(
    *,
    max_profit: float = 100.0,
    expiration: date | str | None = None,
    legs: list | None = None,
) -> dict:
    """Build a deterministic short iron-condor ledger row for tests."""
    if expiration is None:
        expiration = date.today() + timedelta(days=30)
    if legs is None:
        # Standard short IC: short put + long put, short call + long call.
        # Each short leg sold for $0.65, each long leg bought for $0.15.
        # Net credit per spread = $0.50 → max profit = $50 / contract.
        # We use $1.00 short / $0.50 long for tidy math: net credit $0.50.
        legs = [
            {"symbol": "AMD250620P145", "side": "short", "qty": 1, "entry_price": 1.00, "delta": -0.18},
            {"symbol": "AMD250620P140", "side": "long", "qty": 1, "entry_price": 0.50, "delta": -0.10},
            {"symbol": "AMD250620C175", "side": "short", "qty": 1, "entry_price": 1.00, "delta": 0.18},
            {"symbol": "AMD250620C180", "side": "long", "qty": 1, "entry_price": 0.50, "delta": 0.10},
        ]
    return {
        "id": 42,
        "strategy": "iron_condor_strategy",
        "structure_type": "iron_condor",
        "symbol": "AMD",
        "side": "short",
        "legs": legs,
        "max_profit": max_profit,
        "max_loss": 400.0,
        "expiration": expiration,
        "entry_price": 0.50,
    }


# ---------------------------------------------------------------------------
# profit_pct rule
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_profit_pct_fires_at_50pct_gain_on_iron_condor() -> None:
    """A short iron condor at 50% of max credit should trigger a close."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    # Each short leg has decayed from $1.00 → $0.50; each long leg from
    # $0.50 → $0.30. Net pnl per leg:
    #   short put : (1.00 - 0.50) * 1 * 100 = $50
    #   long put  : (0.30 - 0.50) * 1 * 100 = -$20
    #   short call: (1.00 - 0.50) * 1 * 100 = $50
    #   long call : (0.30 - 0.50) * 1 * 100 = -$20
    # Net combo pnl = $60 — that's 60% of max_profit = $100, so a
    # 50% threshold rule MUST fire.
    marks = {
        "AMD250620P145": 0.50, "AMD250620P140": 0.30,
        "AMD250620C175": 0.50, "AMD250620C180": 0.30,
    }
    rule = _rule(structure_type="iron_condor", rule_type="profit_pct", threshold=0.50, action="close")
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is not None, "profit_pct rule should fire when pnl >= 50% of max_profit"
    assert decision.rule_type == "profit_pct"
    assert decision.action == "close"
    assert decision.metadata["current_pnl"] == pytest.approx(60.0, abs=0.001)
    assert decision.metadata["pnl_ratio"] == pytest.approx(0.60, abs=0.001)


@pytest.mark.asyncio
async def test_profit_pct_does_not_fire_below_threshold() -> None:
    """At 30% of max profit, the 50%-threshold rule does NOT fire."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    # Only 30% decay — pnl = $30 = 30% of max profit; below the 50% threshold.
    marks = {
        "AMD250620P145": 0.70, "AMD250620P140": 0.40,
        "AMD250620C175": 0.70, "AMD250620C180": 0.40,
    }
    rule = _rule(structure_type="iron_condor", rule_type="profit_pct", threshold=0.50)
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is None


# ---------------------------------------------------------------------------
# time_dte rule
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_time_dte_fires_at_21_days() -> None:
    """A trade with 21 DTE must fire the 21-day time exit."""
    from services.exit_rules import evaluate_exit_rules

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=21))
    rule = _rule(structure_type="*", rule_type="time_dte", threshold=21.0, action="close", priority=20)
    decision = await evaluate_exit_rules(trade, {}, rules=[rule], today=today)
    assert decision is not None
    assert decision.rule_type == "time_dte"
    assert decision.action == "close"
    assert decision.metadata["dte"] == 21


@pytest.mark.asyncio
async def test_time_dte_does_not_fire_at_22_days() -> None:
    """22 DTE is above the 21-day threshold — rule must NOT fire."""
    from services.exit_rules import evaluate_exit_rules

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=22))
    rule = _rule(structure_type="*", rule_type="time_dte", threshold=21.0, action="close")
    decision = await evaluate_exit_rules(trade, {}, rules=[rule], today=today)
    assert decision is None


# ---------------------------------------------------------------------------
# loss_pct rule
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_loss_pct_triggers_alert_not_close() -> None:
    """Loss alert at 200% of max profit fires with action=alert."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    # Disastrous moves — short legs blew out 5x. pnl per leg:
    #   short put : (1.00 - 6.00) * 1 * 100 = -$500
    #   long put  : (4.50 - 0.50) * 1 * 100 =  $400
    #   short call: (1.00 - 1.00) * 1 * 100 =     $0
    #   long call : (0.50 - 0.50) * 1 * 100 =     $0
    # Net = -$100. With max_profit=$100, threshold=2.0 means rule fires
    # when pnl <= -200. We're at -100 here so rule does NOT fire. Push
    # short put to $7.00 instead → -600 + 500 + 0 + 0 = -100. We need
    # bigger blow-out. Use $10:
    #   short put : (1.00 - 10.00) * 1 * 100 = -$900
    #   long put  : (8.00 - 0.50)  * 1 * 100 =  $750
    #   net so far = -$150 + 0 + 0 = -$150 (still not -$200)
    # Use shorts at 12 longs at 9.50:
    #   short put : (1.00 - 12.00) * 100 = -$1100
    #   long put  : (9.50 - 0.50)  * 100 =  $900
    #   net = -$200 — exactly the threshold.
    marks = {
        "AMD250620P145": 12.00, "AMD250620P140": 9.50,
        "AMD250620C175": 1.00, "AMD250620C180": 0.50,
    }
    rule = _rule(
        structure_type="*",
        rule_type="loss_pct",
        threshold=2.0,
        action="alert",
        priority=5,
    )
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is not None
    assert decision.action == "alert", "loss_pct rule must fire as ALERT, not close"
    assert decision.rule_type == "loss_pct"
    assert decision.metadata["current_pnl"] == pytest.approx(-200.0, abs=0.001)


# ---------------------------------------------------------------------------
# Priority ordering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_priority_ordering_first_match_wins() -> None:
    """Lower priority runs first; first match wins.

    Two rules both fire on this trade. The priority=5 alert MUST be
    returned — even though the priority=10 close also matches.
    """
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    # Marks chosen so BOTH rules fire — pnl = $60 (>=50% of max profit
    # for the close rule) AND we'll set up a contrived alert rule at
    # priority=5 with a low threshold so it fires too.
    marks = {
        "AMD250620P145": 0.50, "AMD250620P140": 0.30,
        "AMD250620C175": 0.50, "AMD250620C180": 0.30,
    }
    high_priority_alert = _rule(
        id=1, structure_type="iron_condor", rule_type="profit_pct",
        threshold=0.40, action="alert", priority=5,
    )
    low_priority_close = _rule(
        id=2, structure_type="iron_condor", rule_type="profit_pct",
        threshold=0.50, action="close", priority=10,
    )
    decision = await evaluate_exit_rules(
        trade, marks, rules=[low_priority_close, high_priority_alert],
    )
    assert decision is not None
    assert decision.rule_id == 1, "priority=5 alert must win over priority=10 close"
    assert decision.action == "alert"


@pytest.mark.asyncio
async def test_priority_tie_broken_by_id_asc() -> None:
    """Two rules with identical priority — lower id wins."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    marks = {
        "AMD250620P145": 0.50, "AMD250620P140": 0.30,
        "AMD250620C175": 0.50, "AMD250620C180": 0.30,
    }
    rule_a = _rule(id=2, structure_type="iron_condor", rule_type="profit_pct", threshold=0.50, action="close", priority=10)
    rule_b = _rule(id=5, structure_type="iron_condor", rule_type="profit_pct", threshold=0.50, action="close", priority=10)
    decision = await evaluate_exit_rules(trade, marks, rules=[rule_b, rule_a])
    assert decision is not None
    assert decision.rule_id == 2


# ---------------------------------------------------------------------------
# Rule disable
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_disabled_rule_never_fires() -> None:
    """``enabled=False`` makes the engine skip the rule entirely."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    marks = {
        "AMD250620P145": 0.50, "AMD250620P140": 0.30,
        "AMD250620C175": 0.50, "AMD250620C180": 0.30,
    }
    rule = _rule(
        structure_type="iron_condor",
        rule_type="profit_pct",
        threshold=0.50,
        action="close",
        enabled=False,
    )
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is None


# ---------------------------------------------------------------------------
# Scope filtering
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strategy_scope_filters_correctly() -> None:
    """A rule scoped to a specific strategy must NOT fire on a different one."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade(max_profit=100.0)
    trade["strategy"] = "earnings_options_play"  # different strategy
    marks = {
        "AMD250620P145": 0.50, "AMD250620P140": 0.30,
        "AMD250620C175": 0.50, "AMD250620C180": 0.30,
    }
    rule = _rule(
        strategy="iron_condor_strategy",  # rule wants this strategy
        structure_type="iron_condor",
        rule_type="profit_pct",
        threshold=0.50,
    )
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is None


@pytest.mark.asyncio
async def test_structure_wildcard_matches_any_structure() -> None:
    """``structure_type='*'`` should match every structure type."""
    from services.exit_rules import evaluate_exit_rules

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=10))
    rule = _rule(
        structure_type="*",
        rule_type="time_dte",
        threshold=21.0,
        action="close",
    )
    decision = await evaluate_exit_rules(trade, {}, rules=[rule], today=today)
    assert decision is not None
    assert decision.rule_type == "time_dte"


# ---------------------------------------------------------------------------
# Seed rules — alembic migration contract
# ---------------------------------------------------------------------------


def test_seed_rules_load_on_alembic_upgrade() -> None:
    """The 0016 migration must INSERT four seed rules with the agreed shape.

    Asserts the migration file contains the exact rule descriptors so a
    refactor that drops a seed rule fails CI rather than shipping a
    silently-degraded ruleset to prod.
    """
    migration = (
        BACKEND_ROOT / "alembic" / "versions" / "0016_exit_rules.py"
    ).read_text(encoding="utf-8")
    # iron_condor 50% take-profit
    assert "'iron_condor'" in migration
    assert "0.50" in migration
    assert "'profit_pct'" in migration
    # iron_butterfly 25% take-profit
    assert "'iron_butterfly'" in migration
    assert "0.25" in migration
    # 21 DTE time exit
    assert "'time_dte'" in migration
    assert "21.0" in migration
    # 200% loss alert
    assert "'loss_pct'" in migration
    assert "'alert'" in migration


# ---------------------------------------------------------------------------
# Auto-roll — guardrail downgrades
# ---------------------------------------------------------------------------


def test_auto_roll_downgrades_when_structure_not_rollable() -> None:
    """A non-rollable structure type must downgrade roll → alert."""
    from services.position_roller import evaluate_auto_roll

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=5))
    trade["structure_type"] = "iron_butterfly"  # NOT in the rollable set
    decision = evaluate_auto_roll(trade, {}, today=today)
    assert decision.action == "alert"
    assert "iron_butterfly" in decision.rationale


def test_auto_roll_downgrades_when_dte_too_high() -> None:
    """DTE > 7 → downgrade. Prevents premature rolls."""
    from services.position_roller import evaluate_auto_roll

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=10))
    decision = evaluate_auto_roll(trade, {}, today=today)
    assert decision.action == "alert"
    assert "dte=10" in decision.rationale


def test_auto_roll_downgrades_when_loss_too_shallow() -> None:
    """A trade only 25% under water cannot justify a roll."""
    from services.position_roller import evaluate_auto_roll

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=5))
    # Loss ratio 25% — below the 50% floor.
    decision = evaluate_auto_roll(
        trade, {}, today=today, current_pnl=-100.0,
    )
    assert decision.action == "alert"
    assert "loss_ratio" in decision.rationale


def test_auto_roll_downgrades_when_loss_at_max() -> None:
    """A trade already at 100%+ of max loss cannot be rolled.

    Rolling locks in realised loss + adds new exposure — the WORST
    possible time to roll. Engine MUST downgrade.
    """
    from services.position_roller import evaluate_auto_roll

    today = date(2026, 5, 5)
    trade = _iron_condor_trade(expiration=today + timedelta(days=5))
    # Loss ratio 100% — at max loss exactly.
    decision = evaluate_auto_roll(
        trade, {}, today=today, current_pnl=-trade["max_loss"],
    )
    assert decision.action == "alert"
    assert "100%" in decision.rationale or "1.00" in decision.rationale or "100.00%" in decision.rationale


def test_auto_roll_passes_when_all_guardrails_satisfied() -> None:
    """Happy-path: vertical_spread, dte=5, 60% loss, debit < remaining max loss."""
    from services.position_roller import evaluate_auto_roll

    today = date(2026, 5, 5)
    legs = [
        # Long put / short put — vertical credit spread.
        {"symbol": "AMD250515P145", "side": "long", "qty": 1, "entry_price": 0.50},
        {"symbol": "AMD250515P150", "side": "short", "qty": 1, "entry_price": 1.00},
    ]
    trade = {
        "id": 1,
        "symbol": "AMD",
        "strategy": "vertical_spread_strategy",
        "structure_type": "vertical_spread",
        "legs": legs,
        "max_profit": 50.0,
        "max_loss": 450.0,
        "expiration": today + timedelta(days=5),
    }
    # Loss = -$300 (66.7% of max loss=$450), within (50%, 100%).
    # Marks are tight so estimated debit stays small.
    marks = {"AMD250515P145": 0.20, "AMD250515P150": 0.30}
    decision = evaluate_auto_roll(trade, marks, today=today, current_pnl=-300.0)
    assert decision.action == "roll", decision.rationale
    # Two close + two open legs
    assert len(decision.proposed_legs) == 4
    closes = [leg for leg in decision.proposed_legs if leg["intent"] == "close"]
    opens = [leg for leg in decision.proposed_legs if leg["intent"] == "open"]
    assert len(closes) == 2 and len(opens) == 2


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_profit_pct_skipped_when_max_profit_unset() -> None:
    """Without max_profit the ratio is undefined — engine must NOT fire."""
    from services.exit_rules import evaluate_exit_rules

    trade = _iron_condor_trade()
    trade["max_profit"] = 0  # missing
    marks = {
        "AMD250620P145": 0.10, "AMD250620P140": 0.05,
        "AMD250620C175": 0.10, "AMD250620C180": 0.05,
    }
    rule = _rule(structure_type="iron_condor", rule_type="profit_pct", threshold=0.50)
    decision = await evaluate_exit_rules(trade, marks, rules=[rule])
    assert decision is None
