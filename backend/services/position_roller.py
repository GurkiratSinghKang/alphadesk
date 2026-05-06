"""Bounded auto-roll logic for losing short-vol positions (P2).

Wave 5A (audit/2026-05-05-position-management). When the exit-rule
engine returns ``action="roll"``, the daily pipeline hands the trade
here. We compute a proposed roll (close current + open same-delta
strikes one expiry forward) but enforce strict guardrails before
submitting:

    Allowed structures   :  iron_condor, vertical_spread
    DTE                  :  <= 7 days
    Loss state           :  > 50% of max loss but < 100%
    Net debit to roll    :  < remaining max loss

If ANY guardrail fails we DOWNGRADE to ``alert`` and let the operator
decide. Auto-roll is dangerous — locking in realised losses while
adding new exposure is a class of mistake users have lost accounts to.

The actual broker submission is intentionally NOT implemented here —
the function returns a ``RollDecision`` describing what WOULD happen,
and the caller is responsible for placing the multi-leg combo. This
keeps the rolling logic deterministic and unit-testable without a
broker stub. The pipeline integration (PM-3) only fires the alert path
in this wave; live broker submission is gated behind a follow-up.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


_ROLLABLE_STRUCTURES = frozenset({"iron_condor", "vertical_spread"})
_MAX_DTE_FOR_ROLL = 7
_MIN_LOSS_RATIO = 0.50  # > 50% of max loss
_MAX_LOSS_RATIO = 1.0  # < 100% of max loss (don't roll a fully-realised loser)


@dataclass(frozen=True)
class RollDecision:
    """Outcome of an auto-roll evaluation.

    Attributes
    ----------
    action:
        Either ``"roll"`` (all guardrails passed; caller may submit the
        combo order) or ``"alert"`` (guardrails failed — downgrade to a
        notification).
    rationale:
        Human-readable explanation. Used as the alert body when
        downgraded; stamped on the broker submission notes when rolled.
    proposed_legs:
        For ``action="roll"``, the close+open leg list ready to be
        submitted as a multi-leg order. Empty when the action is
        ``alert``.
    estimated_debit:
        Estimated net debit ($) to execute the roll. Negative numbers
        mean the roll is a CREDIT (rare for losing positions, but
        possible). Used for the "debit < remaining max loss" check.
    """

    action: str
    rationale: str
    proposed_legs: list[dict[str, Any]]
    estimated_debit: float


def evaluate_auto_roll(
    trade: dict[str, Any] | Any,
    current_marks: dict[str, float],
    *,
    today: date | None = None,
    current_pnl: float | None = None,
) -> RollDecision:
    """Decide whether this trade is safe to auto-roll.

    Returns a ``RollDecision`` with ``action == "roll"`` if every
    guardrail passes, else ``action == "alert"`` with the failed
    guardrail in the rationale.
    """
    today = today or date.today()
    structure_type = _get(trade, "structure_type")
    strategy = _get(trade, "strategy")
    legs = _get(trade, "legs") or []
    expiration = _get(trade, "expiration")
    max_profit = _safe_float(_get(trade, "max_profit"))
    max_loss = _safe_float(_get(trade, "max_loss"))

    # ── Guardrail 1: structure must be roll-safe ──
    if structure_type not in _ROLLABLE_STRUCTURES:
        return _alert(
            f"auto-roll skipped: structure={structure_type!r} is not in "
            f"{sorted(_ROLLABLE_STRUCTURES)}; auto-roll only enabled for "
            "iron_condor and vertical_spread"
        )

    # ── Guardrail 2: must have leg structure ──
    if not legs:
        return _alert("auto-roll skipped: trade has no legs to roll")

    # ── Guardrail 3: DTE ≤ 7 ──
    exp_date = _to_date(expiration)
    if exp_date is None:
        return _alert("auto-roll skipped: expiration unparseable")
    dte = (exp_date - today).days
    if dte > _MAX_DTE_FOR_ROLL:
        return _alert(
            f"auto-roll skipped: dte={dte} > {_MAX_DTE_FOR_ROLL}; "
            "rolls are only safe in the final week of an expiry"
        )

    # ── Guardrail 4: loss ratio in (50%, 100%) of max loss ──
    # Use max_profit as the magnitude reference when max_loss is unset.
    loss_reference = max_loss if max_loss > 0 else max_profit
    if loss_reference <= 0:
        return _alert("auto-roll skipped: max_loss/max_profit unset — cannot size loss ratio")

    pnl = current_pnl if current_pnl is not None else _compute_combo_pnl(trade, current_marks)
    if pnl >= 0:
        return _alert(
            f"auto-roll skipped: pnl={pnl:.2f} is non-negative — "
            "rolls are only for losing positions"
        )
    loss_ratio = -pnl / loss_reference
    if loss_ratio <= _MIN_LOSS_RATIO:
        return _alert(
            f"auto-roll skipped: loss_ratio={loss_ratio:.2%} <= "
            f"{_MIN_LOSS_RATIO:.0%}; not deep enough to justify a roll"
        )
    if loss_ratio >= _MAX_LOSS_RATIO:
        return _alert(
            f"auto-roll skipped: loss_ratio={loss_ratio:.2%} >= "
            f"{_MAX_LOSS_RATIO:.0%}; trade is already at or beyond max "
            "loss — rolling locks in realised loss while adding new exposure"
        )

    # ── Guardrail 5: net debit to roll < remaining max loss ──
    proposed_legs, estimated_debit = _build_roll_legs(trade, current_marks, exp_date)
    if not proposed_legs:
        return _alert("auto-roll skipped: could not derive replacement legs")

    remaining_max_loss = loss_reference - (-pnl)  # how much further can we lose
    if estimated_debit >= remaining_max_loss:
        return _alert(
            f"auto-roll skipped: estimated_debit={estimated_debit:.2f} "
            f">= remaining_max_loss={remaining_max_loss:.2f}; "
            "the roll cost is not defensible"
        )

    rationale = (
        f"auto-roll: structure={structure_type} strategy={strategy or 'any'} "
        f"dte={dte} loss_ratio={loss_ratio:.2%} debit={estimated_debit:.2f} "
        f"remaining_max_loss={remaining_max_loss:.2f}"
    )
    return RollDecision(
        action="roll",
        rationale=rationale,
        proposed_legs=proposed_legs,
        estimated_debit=estimated_debit,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _alert(rationale: str) -> RollDecision:
    """Build a downgraded ``alert`` decision."""
    logger.info("position_roller: %s", rationale)
    return RollDecision(action="alert", rationale=rationale, proposed_legs=[], estimated_debit=0.0)


def _build_roll_legs(
    trade: dict[str, Any] | Any,
    current_marks: dict[str, float],
    current_expiry: date,
) -> tuple[list[dict[str, Any]], float]:
    """Build a proposed close+open leg list and estimate the net debit.

    Strategy: same structure, next-month expiry (current_expiry + 28
    days; the broker resolves the closest listed expiry from the date
    we stamp on the leg dicts), same strikes per leg's delta. We keep
    the strikes literally identical for v1 because we don't have a
    strike-by-delta lookup wired in. Operators inspecting the rolled
    order will see the same strikes one expiry forward.
    """
    legs = list(_get(trade, "legs") or [])
    if not legs:
        return [], 0.0

    # Target a roll ~28 days forward.
    target_expiry = current_expiry + timedelta(days=28)

    out: list[dict[str, Any]] = []
    debit = 0.0
    for leg in legs:
        if not isinstance(leg, dict):
            continue
        sym = str(leg.get("symbol") or "")
        side = str(leg.get("side") or "long").lower()
        qty = _safe_float(leg.get("qty") or 1.0)
        mark = _safe_float(current_marks.get(sym))
        contract_size = _safe_float(leg.get("contract_size") or 100.0)
        # Closing leg — flip side, mark to current.
        close_side = "buy" if side in {"short", "sell", "s"} else "sell"
        out.append(
            {
                "intent": "close",
                "symbol": sym,
                "side": close_side,
                "qty": qty,
                "estimated_price": mark,
                "expiry": leg.get("expiry") or current_expiry.isoformat(),
            }
        )
        # Closing a SHORT leg costs a debit (we BUY back at mark).
        # Closing a LONG leg yields a credit (we SELL at mark).
        if close_side == "buy":
            debit += mark * qty * contract_size
        else:
            debit -= mark * qty * contract_size

        # Opening leg — same strike, new expiry, same side as original.
        out.append(
            {
                "intent": "open",
                "symbol": _replace_expiry_in_symbol(sym, target_expiry),
                "side": side,
                "qty": qty,
                "estimated_price": mark,  # placeholder; broker resolves on submit
                "strike": leg.get("strike"),
                "right": leg.get("right") or leg.get("call_put"),
                "expiry": target_expiry.isoformat(),
            }
        )
        # Opening a SHORT leg yields a credit; opening a LONG leg costs
        # a debit. Mirrors the close calc above with the opposite sign.
        if side in {"short", "sell", "s"}:
            debit -= mark * qty * contract_size
        else:
            debit += mark * qty * contract_size

    return out, debit


def _replace_expiry_in_symbol(occ_symbol: str, new_expiry: date) -> str:
    """Best-effort OCC symbol patch: replace the YYMMDD slice.

    OCC option symbols look like ``AMD250620P00145000``: 1-6 char root,
    then 6 digits for YYMMDD, then 1 char C/P, then 8-digit strike.
    When we can't parse the symbol we return it unchanged — the
    downstream order builder will catch the mismatch.
    """
    if len(occ_symbol) < 16:
        return occ_symbol
    # Walk from the right: 8-digit strike + 1-char C/P + 6-digit date.
    head = occ_symbol[:-15]
    yymmdd = new_expiry.strftime("%y%m%d")
    return f"{head}{yymmdd}{occ_symbol[-9:]}"


# ---------------------------------------------------------------------------
# Tiny helpers — duplicated from exit_rules.py to keep this module
# importable without circular import risk. Both modules are leaf-level.
# ---------------------------------------------------------------------------


def _get(trade: dict[str, Any] | Any, key: str) -> Any:
    if isinstance(trade, dict):
        return trade.get(key)
    return getattr(trade, key, None)


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _to_date(value: Any) -> date | None:
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


def _compute_combo_pnl(trade: dict[str, Any] | Any, current_marks: dict[str, float]) -> float:
    """Mirror of services.exit_rules._compute_combo_pnl — kept local so
    this module's imports are leaf-level. See that module for the math."""
    legs = _get(trade, "legs") or []
    if not legs:
        return _safe_float(_get(trade, "pnl"))
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


__all__ = ["RollDecision", "evaluate_auto_roll"]
