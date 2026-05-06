"""Exit-rule evaluation engine for OPEN trades (P2 — position-management automation).

Wave 5A (audit/2026-05-05-position-management). Walks the
``exit_rules`` table on every ``daily_pipeline._check_exits`` tick and
returns the highest-priority rule that fires for a given trade, or
``None`` if no rule matches. The caller (the daily pipeline) is
responsible for actuating the decision — close the combo, fire an
alert, or hand the trade to ``services.position_roller`` for an
auto-roll attempt.

The seed rules (see ``alembic/versions/0016_exit_rules.py``,
``0018_exit_rule_wing_capture.py``, and
``0020_exit_rule_scaled_profit_close.py``):

    1. iron_condor profit-take at 50% of max credit (close, priority 10)
       — DISABLED by 0020 in favour of the scaled ladder; kept as a
       soft-disabled row for back-compat / easy revert.
    2. iron_butterfly profit-take at 25% (close, priority 10)
       — DISABLED by 0020.
    3. wing_capture early-close at 80% of max LOSS, DTE > 1, defined-risk
       credits only (close, priority 15)
    4. time-based exit at 21 DTE for any structure (close, priority 20)
    5. loss alert at 2x max credit lost (alert, priority 5)
    6. scaled_profit_close ladder (M-O P): close 1/3 of original at 25%
       max profit, 1/3 more at 50%, the runner at 75%. Iron condors use
       (0.25, 0.50, 0.75); iron butterflies use the tighter
       (0.15, 0.30, 0.50). Each scale is one ExitRule row;
       ``Trade.partial_close_log`` records which scales have already
       fired so the same rule_id never fires twice on the same trade.

Priority is ascending — the loss alert (priority 5) fires BEFORE any
close action, so an operator gets notified the moment a trade goes
deeply against the position. Rules are scoped by ``strategy`` (NULL =
all strategies) and ``structure_type`` (NULL or ``"*"`` = all
structures).

The ``wing_capture`` rule (priority 15) sits between the take-profit
close (10) and the time-based close (20) by design: when an iron condor
or vertical credit spread breaks through one wing and the loss runs to
near-max, holding to expiration locks in max loss while the protective
long leg still has residual time value. Closing early harvests that
residual — historical AMD-style postmortem (a $200 capture on a $338
max-loss IC) drove the addition.

Composition with siblings:

* OPEN-1 lives in the same ``_check_exits`` and runs FIRST. It uses
  combo-aware mark prices to detect equity-style stop/target breaches
  on multi-leg positions. If OPEN-1 closes a trade, this engine never
  runs against that trade in the same tick — the loop hits ``continue``.
* OPEN-4 will eventually push its own rule engine into this module.
  The schema and evaluator are deliberately small so OPEN-4 can extend
  ``rule_type`` (e.g. ``vega_breach``, ``iv_collapse``) without rewriting
  the dispatch surface — add a new branch in ``_rule_fires`` and a
  matching CHECK-constraint update.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# Structures whose risk is bounded by a long protective wing — these are
# the only ones for which ``wing_capture`` fires. Holding any of these
# to expiration when already capped against the wing locks in max loss;
# closing early captures residual time value on the long leg.
DEFINED_RISK_CREDIT_STRUCTURES: frozenset[str] = frozenset({
    "iron_condor",
    "iron_butterfly",
    "vertical_spread",
    "bull_put_spread",
    "bear_call_spread",
})


# ``adverse_momentum_close`` direction map — for short-vol / directional
# credit structures the rule must know which direction is bad.
#
# Keys: structure_type. Values: one of
#   "any"      — any large move is adverse (short-vol structures)
#   "up"       — upward moves are adverse (bear-side credits/debits)
#   "down"     — downward moves are adverse (bull-side credits/debits)
#   "long_vol" — sentinel; the rule NEVER fires (long-vol structures
#                benefit from a large move in any direction).
ADVERSE_DIRECTION_BY_STRUCTURE: dict[str, str] = {
    # Short-vol / delta-neutral — any large move is adverse.
    "iron_condor": "any",
    "iron_butterfly": "any",
    "short_strangle": "any",
    "short_straddle": "any",
    # Directional credits / debits where +move = bad.
    "bear_call_spread": "up",
    "bear_put_spread": "up",
    # Directional credits / debits where -move = bad.
    "bull_put_spread": "down",
    "bull_call_spread": "down",
    # Long-vol — explicit allow-list so we never fire on these.
    "long_call": "long_vol",
    "long_put": "long_vol",
    "long_straddle": "long_vol",
    "long_strangle": "long_vol",
}


# OCC contract format trailer length: YYMMDD (6) + C/P (1) + strike*1000 (8) = 15.
_OCC_TRAILER_LEN = 15


# ---------------------------------------------------------------------------
# Public API surface
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExitDecision:
    """Outcome of ``evaluate_exit_rules`` — caller dispatches on ``action``.

    Attributes
    ----------
    rule_id:
        Primary key of the firing ``ExitRule`` row. Persisted on the
        close/alert audit event so the post-mortem can pivot back to the
        rule definition.
    rule_type:
        One of ``profit_pct`` | ``time_dte`` | ``loss_pct`` |
        ``delta_breach`` | ``wing_capture``.
    action:
        One of ``close`` | ``alert`` | ``roll``.
    threshold:
        The numeric threshold from the firing rule.
    rationale:
        Human-readable explanation of why the rule fired. Goes into the
        exit reason / alert body and the operator dashboard tooltip.
    metadata:
        Free-form dict of evaluation-time facts (current pnl, dte, net
        delta) so downstream consumers can reconstruct the decision
        without re-deriving them.
    """

    rule_id: int
    rule_type: str
    action: str
    threshold: float
    rationale: str
    metadata: dict[str, Any]


async def evaluate_exit_rules(
    trade: dict[str, Any] | Any,
    current_marks: dict[str, float],
    *,
    rules: Iterable[Any] | None = None,
    today: date | None = None,
) -> ExitDecision | None:
    """Return the highest-priority exit rule firing for this trade, or None.

    Parameters
    ----------
    trade:
        The open trade. Either an ORM ``Trade`` instance or a dict with
        ``strategy``, ``structure_type``, ``legs``, ``entry_price``,
        ``max_profit``, ``expiration``. Dicts come straight from
        ``TradeLedger.get_open_positions()`` which serialises the row
        to plain JSON. ORM rows arrive when the caller is exercising
        the engine directly (tests, the admin UI's dry-run preview).
    current_marks:
        Symbol → mid-mark mapping. For multi-leg combos the keys are
        the OCC-style option symbols on each leg.
    rules:
        Optional pre-fetched iterable of ``ExitRule`` rows. When None,
        we load the active set scoped to this trade from Postgres. Tests
        inject this directly to avoid a DB hop.
    today:
        Override "today" for deterministic time_dte tests. Defaults to
        ``date.today()`` in the system tz.

    Returns
    -------
    ExitDecision or None
        ``None`` when no rule fires. Otherwise the lowest-priority rule
        that matched (priority ASCENDING — 5 runs before 10 runs before
        20). Ties broken by ``id`` so behaviour is deterministic across
        runs.
    """
    today = today or date.today()
    strategy = _trade_attr(trade, "strategy")
    structure_type = _trade_attr(trade, "structure_type")

    if rules is None:
        rules = await _load_active_rules(strategy, structure_type)

    # Idempotency for scaled_profit_close: collect rule_ids that have
    # already fired for this trade so the same scale never re-fires on
    # the next tick. ``partial_close_log`` is shaped:
    #     {"fires": [{"rule_id": int, "threshold": float, ...}, ...]}
    # See ``Trade.partial_close_log`` in ``data.storage.models``.
    already_fired_rule_ids: set[int] = _already_fired_rule_ids(trade)

    # Filter to enabled + matching scope. We accept ``"*"`` as a
    # wildcard for ``structure_type`` to mirror the seed schema.
    candidates: list[Any] = []
    for rule in rules:
        if not getattr(rule, "enabled", True):
            continue
        if not _scope_matches(rule, strategy=strategy, structure_type=structure_type):
            continue
        # Idempotency gate — only applied to scaled_profit_close. Other
        # rule_types are stateless (loss_pct will keep firing while the
        # condition holds; that's intentional — the alert resurfaces the
        # bleed each tick).
        if str(getattr(rule, "rule_type", "")) == "scaled_profit_close":
            rule_id_int = int(getattr(rule, "id", 0) or 0)
            if rule_id_int in already_fired_rule_ids:
                continue
        candidates.append(rule)

    if not candidates:
        return None

    # Priority ASC, id ASC — deterministic.
    candidates.sort(key=lambda r: (getattr(r, "priority", 100), getattr(r, "id", 0)))

    for rule in candidates:
        fires, meta = _rule_fires(rule, trade, current_marks, today=today)
        if fires:
            return ExitDecision(
                rule_id=int(getattr(rule, "id", 0)),
                rule_type=str(getattr(rule, "rule_type", "")),
                action=str(getattr(rule, "action", "alert")),
                threshold=float(getattr(rule, "threshold", 0.0)),
                rationale=_explain_rule_fire(rule, meta),
                metadata=meta,
            )

    return None


# ---------------------------------------------------------------------------
# Helpers — rule firing logic
# ---------------------------------------------------------------------------


def _rule_fires(
    rule: Any,
    trade: dict[str, Any] | Any,
    current_marks: dict[str, float],
    *,
    today: date,
) -> tuple[bool, dict[str, Any]]:
    """Return (does-this-rule-fire, evaluation-metadata).

    Metadata dict is included even when the rule does NOT fire, so the
    caller can log "we evaluated rule X and it scored Y" diagnostics.
    """
    rule_type = str(getattr(rule, "rule_type", ""))
    threshold = float(getattr(rule, "threshold", 0.0))
    meta: dict[str, Any] = {"rule_type": rule_type, "threshold": threshold}

    if rule_type == "profit_pct":
        max_profit = _safe_float(_trade_attr(trade, "max_profit"))
        if max_profit <= 0:
            # Ratio is undefined when the position has no positive max
            # profit (e.g. a debit spread mis-categorised). Don't fire.
            meta["reason"] = "max_profit_unset"
            return False, meta
        current_pnl = _compute_combo_pnl(trade, current_marks)
        meta["current_pnl"] = current_pnl
        meta["max_profit"] = max_profit
        meta["pnl_ratio"] = current_pnl / max_profit
        return current_pnl >= threshold * max_profit, meta

    if rule_type == "scaled_profit_close":
        # M-O P (2026-05-05): scaled profit-take ladder. Fires when
        # current pnl >= threshold * max_profit, exactly like
        # profit_pct, but the dispatcher closes only ``qty_fraction``
        # of the REMAINING quantity (not the full position) so the
        # operator can stagger exits at 25/50/75% of max profit and
        # capture more upside on the runner. Idempotency
        # (don't-fire-twice) is enforced upstream in
        # ``evaluate_exit_rules`` via ``Trade.partial_close_log``.
        max_profit = _safe_float(_trade_attr(trade, "max_profit"))
        if max_profit <= 0:
            meta["reason"] = "max_profit_unset"
            return False, meta
        current_pnl = _compute_combo_pnl(trade, current_marks)
        meta["current_pnl"] = current_pnl
        meta["max_profit"] = max_profit
        meta["pnl_ratio"] = current_pnl / max_profit
        meta["qty_fraction"] = _safe_float(getattr(rule, "qty_fraction", 1.0))
        return current_pnl >= threshold * max_profit, meta

    if rule_type == "time_dte":
        expiration = _trade_attr(trade, "expiration")
        if expiration is None:
            meta["reason"] = "expiration_unset"
            return False, meta
        exp_date = _to_date(expiration)
        if exp_date is None:
            meta["reason"] = "expiration_unparseable"
            return False, meta
        dte = (exp_date - today).days
        meta["dte"] = dte
        return dte <= threshold, meta

    if rule_type == "loss_pct":
        max_profit = _safe_float(_trade_attr(trade, "max_profit"))
        if max_profit <= 0:
            meta["reason"] = "max_profit_unset"
            return False, meta
        current_pnl = _compute_combo_pnl(trade, current_marks)
        meta["current_pnl"] = current_pnl
        meta["max_profit"] = max_profit
        meta["loss_ratio"] = -current_pnl / max_profit if max_profit else 0.0
        return current_pnl <= -threshold * max_profit, meta

    if rule_type == "delta_breach":
        net_delta = _compute_net_delta(trade, current_marks)
        meta["net_delta"] = net_delta
        return abs(net_delta) >= threshold, meta

    if rule_type == "adverse_momentum_close":
        # Cut losing trades fast when momentum confirms direction. Fires when
        # all three conditions hold:
        #
        #   1. Underlying has moved adversely by >= ``threshold`` σ in the
        #      regular session (σ = trade.expected_move_pct snapshotted at
        #      entry — the implied 1-σ move from the ATM straddle).
        #   2. The move's direction is "bad" for this structure (see
        #      ADVERSE_DIRECTION_BY_STRUCTURE). Long-vol structures
        #      (long_call/put, long_straddle/strangle) are explicitly
        #      excluded — any large move is favourable for them.
        #   3. Loss is already >= 30% of max_loss. Don't cut at break-even
        #      or in profit; momentum-and-loss together is the signal.
        #
        # AMD postmortem 2026-05: spot ran +21% overnight; the IC's
        # expected_move_pct snapshot was 8.55%, so σ_move = 21/8.55 ≈
        # 2.46. A 1.5σ-threshold rule would have fired at the open and
        # closed the position before the day's open hammered it further.
        # Sits at priority 12 — between profit_pct (10) and wing_capture
        # (15): adverse-momentum cuts BEFORE the position reaches the
        # 80%-loss zone where wing_capture takes over.
        legs = _trade_attr(trade, "legs") or []
        if not legs:
            meta["reason"] = "no_legs"
            return False, meta
        expiration = _trade_attr(trade, "expiration")
        if expiration is None:
            meta["reason"] = "expiration_unset"
            return False, meta
        underlying_symbol = _trade_underlying(trade)
        meta["underlying"] = underlying_symbol
        if not underlying_symbol:
            meta["reason"] = "underlying_unparseable"
            return False, meta
        # Long-vol structures: never adverse. Exit early so we don't even
        # need the marks dict to short-circuit here.
        structure_type = str(_trade_attr(trade, "structure_type") or "")
        meta["structure_type"] = structure_type
        direction_class = ADVERSE_DIRECTION_BY_STRUCTURE.get(structure_type)
        if direction_class is None:
            meta["reason"] = f"structure_not_classified:{structure_type}"
            return False, meta
        if direction_class == "long_vol":
            meta["reason"] = "structure_is_long_vol"
            return False, meta
        # Pull intraday change pct. The marks dict supports an explicit
        # "<underlying>:change_pct" key (caller-provided) — same shape as
        # the "<symbol>:delta" sidechannel used by ``delta_breach``.
        intraday_pct = _intraday_change_pct(underlying_symbol, current_marks)
        meta["intraday_pct"] = intraday_pct
        if intraday_pct is None:
            meta["reason"] = "intraday_change_unknown"
            return False, meta
        # Expected-move-pct snapshot — set at entry from the recommender's
        # ATM-straddle implied 1-σ move. Without it we cannot scale the
        # raw move into a σ multiple, so the rule abstains.
        expected_move_pct = _safe_float(_trade_attr(trade, "expected_move_pct"))
        meta["expected_move_pct"] = expected_move_pct
        if expected_move_pct <= 0:
            meta["reason"] = "expected_move_pct_unset"
            return False, meta
        # Both inputs are PERCENT (e.g. 21.0 for +21%, 8.55 for 8.55%).
        # The ratio is unit-independent so long as both are in the same
        # unit, so a caller passing fractions (0.21 / 0.0855) also works.
        sigma_move = abs(intraday_pct) / abs(expected_move_pct)
        meta["sigma_move"] = sigma_move
        if sigma_move < threshold:
            meta["reason"] = "sigma_below_threshold"
            return False, meta
        # Adverse direction check.
        is_adverse = _is_move_adverse(direction_class, intraday_pct)
        meta["is_adverse"] = is_adverse
        if not is_adverse:
            meta["reason"] = "move_favourable_for_structure"
            return False, meta
        # Loss floor — must already be in the red by 30% of max_loss.
        max_loss = _safe_float(_trade_attr(trade, "max_loss"))
        meta["max_loss"] = max_loss
        if max_loss <= 0:
            meta["reason"] = "max_loss_unset"
            return False, meta
        current_pnl = _compute_combo_pnl(trade, current_marks)
        meta["current_pnl"] = current_pnl
        loss_pct = (-current_pnl / max_loss) if current_pnl < 0 else 0.0
        meta["loss_pct"] = loss_pct
        if loss_pct < 0.30:
            meta["reason"] = "loss_below_30pct_floor"
            return False, meta
        return True, meta

    if rule_type == "wing_capture":
        # Early-close defined-risk credits when capped against a wing —
        # capture residual time value on the protective long leg before
        # expiration zeros it out. AMD postmortem 2026-05: an iron condor
        # at $338 max loss / $270 unrealized loss (80%) with 3 DTE had
        # ~$200 of long-wing time value the operator captured by closing
        # at the open instead of holding to expiry.
        max_loss = _safe_float(_trade_attr(trade, "max_loss"))
        meta["max_loss"] = max_loss
        if max_loss <= 0:
            meta["reason"] = "max_loss_unset"
            return False, meta
        # Structure gate: only defined-risk credits have a long-wing to
        # harvest. Long calls/puts, equity, futures — skip.
        structure_type = str(_trade_attr(trade, "structure_type") or "")
        meta["structure_type"] = structure_type
        if structure_type not in DEFINED_RISK_CREDIT_STRUCTURES:
            meta["reason"] = f"structure_not_defined_risk_credit:{structure_type}"
            return False, meta
        # DTE gate: too late to harvest meaningful theta on the long
        # wing — let it expire. Threshold is "DTE strictly greater than
        # min_dte". We hard-code min_dte=1 here; the rule_type already
        # encodes the semantics. Keep a single tunable (threshold = loss%)
        # so the rule stays composable with existing scope filters.
        expiration = _trade_attr(trade, "expiration")
        exp_date = _to_date(expiration)
        if exp_date is None:
            meta["reason"] = "expiration_unset"
            return False, meta
        dte = (exp_date - today).days
        meta["dte"] = dte
        if dte <= 1:
            meta["reason"] = "dte_too_low"
            return False, meta
        # Loss-ratio gate.
        current_pnl = _compute_combo_pnl(trade, current_marks)
        meta["current_pnl"] = current_pnl
        loss_pct = (-current_pnl / max_loss) if current_pnl < 0 else 0.0
        meta["loss_pct"] = loss_pct
        return loss_pct >= threshold, meta

    # Unknown rule_type — do not fire. (Schema CHECK-constraint should
    # already have rejected this row at insert time, but defensive.)
    meta["reason"] = f"unknown_rule_type:{rule_type}"
    logger.warning("exit_rules: unknown rule_type %r on rule %s", rule_type, getattr(rule, "id", "?"))
    return False, meta


def _explain_rule_fire(rule: Any, meta: dict[str, Any]) -> str:
    """Render a human-readable rationale for the firing decision."""
    rule_type = str(getattr(rule, "rule_type", ""))
    threshold = float(getattr(rule, "threshold", 0.0))

    if rule_type == "profit_pct":
        ratio = meta.get("pnl_ratio")
        if ratio is not None:
            return (
                f"profit_pct: pnl={meta.get('current_pnl', 0):.2f} "
                f">= {threshold:.2%} of max_profit={meta.get('max_profit', 0):.2f} "
                f"(ratio={ratio:.2%})"
            )
        return f"profit_pct fired at threshold {threshold}"
    if rule_type == "scaled_profit_close":
        ratio = meta.get("pnl_ratio")
        qty_fraction = meta.get("qty_fraction", 1.0)
        if ratio is not None:
            return (
                f"scaled_profit_close: pnl={meta.get('current_pnl', 0):.2f} "
                f">= {threshold:.2%} of max_profit={meta.get('max_profit', 0):.2f} "
                f"(ratio={ratio:.2%}); closing {qty_fraction:.0%} of remaining qty"
            )
        return f"scaled_profit_close fired at threshold {threshold} (qty_fraction={qty_fraction})"
    if rule_type == "time_dte":
        return f"time_dte: dte={meta.get('dte', '?')} <= {threshold:g} days"
    if rule_type == "loss_pct":
        return (
            f"loss_pct: pnl={meta.get('current_pnl', 0):.2f} "
            f"<= -{threshold:.2%} of max_profit={meta.get('max_profit', 0):.2f}"
        )
    if rule_type == "delta_breach":
        return f"delta_breach: |net_delta|={abs(meta.get('net_delta', 0.0)):.4f} >= {threshold}"
    if rule_type == "wing_capture":
        return (
            f"wing_capture: loss_pct={meta.get('loss_pct', 0.0):.2%} "
            f">= {threshold:.2%} of max_loss={meta.get('max_loss', 0):.2f} "
            f"(dte={meta.get('dte', '?')}, structure={meta.get('structure_type', '?')}) "
            f"— close to harvest residual long-wing time value"
        )
    if rule_type == "adverse_momentum_close":
        return (
            f"adverse_momentum_close: σ_move={meta.get('sigma_move', 0.0):.2f} "
            f">= {threshold:.2f} (intraday={meta.get('intraday_pct', 0.0):+.2f}%, "
            f"expected_move={meta.get('expected_move_pct', 0.0):.2f}%) "
            f"AND loss_pct={meta.get('loss_pct', 0.0):.2%} >= 30.00% "
            f"(structure={meta.get('structure_type', '?')}, "
            f"underlying={meta.get('underlying', '?')}) — cut loser before deeper drawdown"
        )
    return f"{rule_type} fired at threshold {threshold}"


# ---------------------------------------------------------------------------
# Helpers — DB load
# ---------------------------------------------------------------------------


async def _load_active_rules(
    strategy: str | None,
    structure_type: str | None,
) -> list[Any]:
    """Load enabled rules for this trade's scope from Postgres.

    SQL filter shape: ``(strategy IS NULL OR strategy = :s)``
    AND ``(structure_type IS NULL OR structure_type = '*' OR
    structure_type = :st)`` AND ``enabled = TRUE``. ORDER BY priority
    ASC, id ASC.

    Returns an empty list on any DB error — the engine fails CLOSED so
    a degraded DB doesn't accidentally close every position via a
    KeyError. The exit pipeline still has its OPEN-1 stop/target check
    and will continue to function without the rule engine.
    """
    try:
        from sqlalchemy import or_, select

        from core.database import _get_session_factory
        from data.storage.models import ExitRule
    except Exception:
        logger.exception("exit_rules: failed to import dependencies — falling back to empty rule set")
        return []

    factory = _get_session_factory()
    try:
        async with factory() as session:
            stmt = select(ExitRule).where(ExitRule.enabled.is_(True))
            if strategy:
                stmt = stmt.where(or_(ExitRule.strategy.is_(None), ExitRule.strategy == strategy))
            else:
                stmt = stmt.where(ExitRule.strategy.is_(None))
            if structure_type:
                stmt = stmt.where(
                    or_(
                        ExitRule.structure_type.is_(None),
                        ExitRule.structure_type == "*",
                        ExitRule.structure_type == structure_type,
                    )
                )
            stmt = stmt.order_by(ExitRule.priority.asc(), ExitRule.id.asc())
            result = await session.execute(stmt)
            return list(result.scalars().all())
    except Exception:
        logger.warning("exit_rules: rule load failed — returning empty set", exc_info=True)
        return []


# ---------------------------------------------------------------------------
# Helpers — scope and trade attribute access
# ---------------------------------------------------------------------------


def _scope_matches(rule: Any, *, strategy: str | None, structure_type: str | None) -> bool:
    """Confirm the rule's scope matches this trade.

    Rule scope semantics:

    * ``strategy`` NULL → matches any strategy.
    * ``strategy`` set → must equal the trade's strategy exactly.
    * ``structure_type`` NULL or ``"*"`` → matches any structure.
    * ``structure_type`` set → must equal the trade's structure_type exactly.
    """
    rule_strategy = getattr(rule, "strategy", None)
    rule_structure = getattr(rule, "structure_type", None)
    if rule_strategy is not None and rule_strategy != strategy:
        return False
    if (
        rule_structure is not None
        and rule_structure != "*"
        and rule_structure != structure_type
    ):
        return False
    return True


def _trade_attr(trade: dict[str, Any] | Any, key: str) -> Any:
    """Read ``key`` from either a dict or an ORM-style object."""
    if isinstance(trade, dict):
        return trade.get(key)
    return getattr(trade, key, None)


def _already_fired_rule_ids(trade: dict[str, Any] | Any) -> set[int]:
    """Return rule_ids that have already fired against this trade.

    Reads ``Trade.partial_close_log`` (a JSONB column with shape
    ``{"fires": [{"rule_id": int, ...}, ...]}``). Used by the evaluator
    to skip ``scaled_profit_close`` rules that have already actuated —
    each scale fires AT MOST ONCE per trade.

    Returns an empty set on every shape error so a malformed log row
    fails OPEN (the rule still fires) — better to over-fire than
    silently skip a take-profit.
    """
    log = _trade_attr(trade, "partial_close_log")
    if not log:
        return set()
    if not isinstance(log, dict):
        return set()
    fires = log.get("fires") or []
    if not isinstance(fires, list):
        return set()
    out: set[int] = set()
    for entry in fires:
        if not isinstance(entry, dict):
            continue
        rid = entry.get("rule_id")
        if rid is None:
            continue
        try:
            out.add(int(rid))
        except (TypeError, ValueError):
            continue
    return out


def compute_scaled_close_qty(
    trade: dict[str, Any] | Any,
    rule: Any,
) -> int:
    """Compute the number of contracts to close when a scaled rule fires.

    Semantics: ``qty_fraction`` is "of REMAINING quantity", not "of
    original". This makes the standard 25/50/75 ladder compose cleanly:

    * threshold 0.25, qty_fraction 0.33 → close 1/3 of remaining
    * threshold 0.50, qty_fraction 0.50 → close 1/2 of remaining
      (= 1/2 × 2/3 = 1/3 of original)
    * threshold 0.75, qty_fraction 1.00 → close all remaining
      (= the runner)

    Reads ``Trade.original_qty`` when available; falls back to the
    largest ``leg.qty`` / ``leg.quantity`` on the trade. Subtracts the
    sum of ``qty_closed`` already recorded in ``partial_close_log`` to
    get the remaining quantity. Returns at minimum 1 (if there's
    anything still open) so a rounding artefact never produces a 0-lot
    close order.
    """
    qty_fraction = _safe_float(getattr(rule, "qty_fraction", 1.0))
    if qty_fraction <= 0:
        return 0
    if qty_fraction > 1.0:
        qty_fraction = 1.0

    # Resolve original_qty.
    original_qty = _trade_attr(trade, "original_qty")
    if original_qty is None:
        legs = _trade_attr(trade, "legs") or []
        max_leg_qty = 0
        for leg in legs:
            if not isinstance(leg, dict):
                continue
            q = leg.get("qty") or leg.get("quantity") or 0
            try:
                q_int = int(q)
            except (TypeError, ValueError):
                q_int = 0
            if q_int > max_leg_qty:
                max_leg_qty = q_int
        original_qty = max_leg_qty
    try:
        original_qty = int(original_qty or 0)
    except (TypeError, ValueError):
        original_qty = 0
    if original_qty <= 0:
        return 0

    # Resolve already-closed quantity from the log.
    closed_so_far = 0
    log = _trade_attr(trade, "partial_close_log") or {}
    if isinstance(log, dict):
        for entry in (log.get("fires") or []):
            if not isinstance(entry, dict):
                continue
            try:
                closed_so_far += int(entry.get("qty_closed") or 0)
            except (TypeError, ValueError):
                continue

    remaining = original_qty - closed_so_far
    if remaining <= 0:
        return 0

    # Final scale (qty_fraction == 1.0) closes whatever is left.
    if qty_fraction >= 0.999:
        return remaining

    # Round to the nearest contract; never close zero when there's at
    # least one remaining and the rule says fire.
    close_qty = int(round(remaining * qty_fraction))
    if close_qty <= 0:
        close_qty = 1
    if close_qty > remaining:
        close_qty = remaining
    return close_qty


def append_partial_close_fire(
    existing_log: dict[str, Any] | None,
    *,
    rule_id: int,
    threshold: float,
    qty_fraction: float,
    qty_closed: int,
    remaining_qty: int,
    fired_at_iso: str,
) -> dict[str, Any]:
    """Return an updated ``partial_close_log`` with one new fire entry.

    Pure helper — does not touch the database. The caller (the
    dispatcher in ``daily_pipeline._dispatch_exit_decision``) writes
    the result to ``Trade.partial_close_log`` after the broker
    confirms the partial close. Idempotent re-fires would have been
    blocked upstream by ``_already_fired_rule_ids``, so this helper
    appends unconditionally.
    """
    log = dict(existing_log) if isinstance(existing_log, dict) else {}
    fires = list(log.get("fires") or [])
    fires.append({
        "rule_id": int(rule_id),
        "threshold": float(threshold),
        "qty_fraction": float(qty_fraction),
        "qty_closed": int(qty_closed),
        "remaining_qty": int(remaining_qty),
        "fired_at": str(fired_at_iso),
    })
    log["fires"] = fires
    return log


def _safe_float(value: Any) -> float:
    """Coerce to float, returning 0.0 when value is None or unparseable."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_date(value: Any) -> date | None:
    """Best-effort coercion of a date-ish value to ``datetime.date``."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            return None
    return None


# ---------------------------------------------------------------------------
# Helpers — adverse_momentum_close inputs
# ---------------------------------------------------------------------------


def _trade_underlying(trade: dict[str, Any] | Any) -> str | None:
    """Return the underlying root ticker for a multi-leg option trade.

    Resolution order — first hit wins:

    1. Trade-level ``symbol`` field. The TradeLedger denormalises the
       underlying onto the row at insert time so we don't have to parse
       OCC trailers on every exit-rule tick.
    2. First leg's ``underlying`` key, if the leg dict carries one.
    3. OCC parse on the first leg's ``symbol`` — strips the trailing
       15-char ``YYMMDD<C|P>NNNNNNNN`` block. Fallback for legacy rows
       that pre-date trade.symbol denorm.

    Returns ``None`` when none of the above produce a non-empty string —
    callers treat None as "abstain, the rule cannot evaluate".
    """
    sym = _trade_attr(trade, "symbol")
    if sym:
        sym_str = str(sym).upper().strip()
        if sym_str:
            return sym_str
    legs = _trade_attr(trade, "legs") or []
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        explicit = leg.get("underlying")
        if explicit:
            explicit_str = str(explicit).upper().strip()
            if explicit_str:
                return explicit_str
        leg_sym = leg.get("symbol")
        if not leg_sym:
            continue
        candidate = str(leg_sym).upper().strip()
        if len(candidate) > _OCC_TRAILER_LEN:
            # Strip the 15-char OCC trailer.
            return candidate[: -_OCC_TRAILER_LEN]
        return candidate
    return None


def _intraday_change_pct(
    underlying: str,
    current_marks: dict[str, float],
) -> float | None:
    """Return today's regular-session % change for ``underlying``, or None.

    The exit-rule engine takes a flat ``dict[str, float]`` for marks, so
    intraday change rides as a sidechannel key — same convention as
    ``"<symbol>:delta"`` for ``delta_breach``. Recognised key shapes
    (first hit wins):

      * ``"<underlying>:change_pct"`` — preferred. % change as a number,
        e.g. ``21.0`` for +21%. Sign matters.
      * ``"<underlying>:intraday_pct"`` — alias.

    Returns ``None`` when no key matches — the rule abstains rather than
    treating "no data" as zero, which would silently never fire.
    """
    if not underlying:
        return None
    for key in (f"{underlying}:change_pct", f"{underlying}:intraday_pct"):
        if key in current_marks:
            return _safe_float(current_marks.get(key))
    return None


def _is_move_adverse(direction_class: str, intraday_pct: float) -> bool:
    """Decide whether ``intraday_pct`` is adverse for ``direction_class``.

    See ``ADVERSE_DIRECTION_BY_STRUCTURE`` for the mapping. The caller
    is expected to have already short-circuited the ``"long_vol"`` case;
    we still return False here defensively if it slips through.
    """
    if direction_class == "any":
        return True
    if direction_class == "up":
        return intraday_pct > 0
    if direction_class == "down":
        return intraday_pct < 0
    # "long_vol" or unknown — never adverse.
    return False


# ---------------------------------------------------------------------------
# P&L and Greek aggregation
# ---------------------------------------------------------------------------
# The exit-rule engine intentionally implements its OWN minimal combo-pnl
# helper rather than reaching across to OPEN-1's combo-mark utility.
# Reasons:
#
#   1. We need to evaluate THIS trade against THESE marks, not the live
#      broker valuation. Tests need a deterministic surface that doesn't
#      hit Alpaca.
#   2. The rule engine should remain operable when OPEN-1 is being
#      reworked. Coupling them at the import surface would make every
#      OPEN-1 refactor a P2 break.
#   3. The math is small: sum (mark - entry) * qty across legs, sign-
#      adjusted for short legs.
#
# When OPEN-1 stabilises, this helper can delegate to the canonical
# combo-mark module — but the public ``compute_combo_pnl`` signature stays
# stable so the tests keep passing.


def _compute_combo_pnl(trade: dict[str, Any] | Any, current_marks: dict[str, float]) -> float:
    """Return current pnl ($) for the combo at the given marks.

    Trade legs schema (consistent with TradeLedger):

    .. code-block:: python

        legs = [
            {
                "symbol": "AMD250620P145",
                "side": "short" | "long",
                "qty": 1,
                "entry_price": 1.25,
            },
            ...
        ]

    For SHORT legs, pnl per contract = (entry_price - mark) * qty * 100.
    For LONG  legs, pnl per contract = (mark - entry_price) * qty * 100.
    Net combo pnl is the sum across legs.

    If the trade has no ``legs`` (e.g. an equity position whose pnl is
    already set on the row), we fall back to the row-level ``pnl`` field
    when present, else 0.
    """
    legs = _trade_attr(trade, "legs") or []
    if not legs:
        # Try the row-level pnl as a last resort.
        return _safe_float(_trade_attr(trade, "pnl"))

    pnl = 0.0
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        sym = str(leg.get("symbol") or "")
        if not sym or sym not in current_marks:
            continue
        side = str(leg.get("side") or "long").lower()
        qty = _safe_float(leg.get("qty") or 1.0)
        entry = _safe_float(leg.get("entry_price"))
        mark = _safe_float(current_marks.get(sym))
        contract_size = _safe_float(leg.get("contract_size") or 100.0)
        if side in {"short", "sell", "s"}:
            pnl += (entry - mark) * qty * contract_size
        else:
            pnl += (mark - entry) * qty * contract_size
    return pnl


def _compute_net_delta(trade: dict[str, Any] | Any, current_marks: dict[str, float]) -> float:
    """Return the signed net delta of the combo (sum of leg deltas).

    Marks dict supports an optional ``"<symbol>:delta"`` key carrying the
    per-leg delta. When unset we fall back to the leg's snapshotted
    delta (legs[i]['delta']). LONG legs add their delta; SHORT legs
    subtract.
    """
    legs = _trade_attr(trade, "legs") or []
    net = 0.0
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        sym = str(leg.get("symbol") or "")
        side = str(leg.get("side") or "long").lower()
        qty = _safe_float(leg.get("qty") or 1.0)
        delta_key = f"{sym}:delta"
        if delta_key in current_marks:
            leg_delta = _safe_float(current_marks.get(delta_key))
        else:
            leg_delta = _safe_float(leg.get("delta"))
        signed = leg_delta * qty
        if side in {"short", "sell", "s"}:
            net -= signed
        else:
            net += signed
    return net


# Public re-exports for callers that want to compute these directly
# (e.g. the dry-run preview in the admin UI).
compute_combo_pnl = _compute_combo_pnl
compute_net_delta = _compute_net_delta


__all__ = [
    "ExitDecision",
    "evaluate_exit_rules",
    "compute_combo_pnl",
    "compute_net_delta",
    "compute_scaled_close_qty",
    "append_partial_close_fire",
]
