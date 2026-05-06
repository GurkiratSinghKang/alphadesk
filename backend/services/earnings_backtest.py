"""Event-level backtest helpers for the earnings options play.

This module is deliberately independent from the daily BacktestEngine. The
earnings-options screen works from event rows, option premium, expected move,
and realized post-report move; squeezing that into daily equity bars loses the
thing we need to measure. The functions here accept normalized event dicts so
provider loaders, notebooks, and API routes can all reuse the same payoff
logic.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, Mapping

logger = logging.getLogger(__name__)

# B2.10 / B2.13 — Cap return ratios on directional plays to keep degenerate
# inputs (e.g., a $0.01 ATM premium yield from an illiquid quote) from
# producing 240,000% AVG R. The cap is a synthetic "10x debit" ceiling: a real
# long-call can't more than 10x in a single earnings move under any plausible
# IV / move scenario; wins beyond that are almost always divide-by-near-zero
# artifacts. We log a warning so operators can audit which events hit the cap.
MAX_TRADE_RETURN_RATIO = 10.0
# Floor on premium-yield denominators used for divide-by-zero guards. A 0.1%
# ATM yield (10 bps) is already implausibly thin for an earnings ATM straddle,
# so anything below this is treated as a data-quality flag rather than a
# realistic trade. The original positive-debit guard still raises ValueError
# for zero/missing premium so calls / puts aren't silently fabricated.
MIN_DEBIT_RATIO = 0.001


DEFINED_RISK_SETUPS = {
    "long call",
    "long put",
    "bull put spread",
    "bear call spread",
    "bull call spread",
    "bear put spread",
    "iron condor",
    "iron butterfly",
    "calendar spread",
    "diagonal spread",
    "long straddle",
}


def _clamp_return(
    raw_ratio: float,
    *,
    setup: str,
    symbol: str,
    debit: float | None = None,
) -> float:
    """Clamp the trade return ratio at ±MAX_TRADE_RETURN_RATIO.

    Directional debit plays divide by entry premium, so a $0.01 ATM yield can
    produce 200x returns on a 2% realized move. Real long-call / long-put
    earnings reactions clear ~5x debit at the extreme; anything beyond 10x is
    almost always a data-quality artifact (illiquid mid, stale yield, unit
    confusion). We clamp and log so the comparison ranking stays informative
    even when one cell of the matrix is degenerate.
    """

    if raw_ratio > MAX_TRADE_RETURN_RATIO:
        logger.warning(
            "earnings_backtest: capping %s return %.4f → %.4f for %s "
            "(debit=%s — likely thin/illiquid premium)",
            setup,
            raw_ratio,
            MAX_TRADE_RETURN_RATIO,
            symbol,
            f"{debit:.6f}" if debit is not None else "n/a",
        )
        return MAX_TRADE_RETURN_RATIO
    if raw_ratio < -1.0:
        return -1.0
    return raw_ratio


@dataclass(frozen=True)
class EventTrade:
    symbol: str
    report_date: str
    setup: str
    return_pct: float
    win: bool
    edge_score: float | None
    reason: str


def simulate_event_trade(event: Mapping[str, Any]) -> EventTrade:
    """Simulate one defined-risk earnings trade from an event row.

    Required event keys:
      - symbol
      - report_date
      - setup or top_setup
      - expected_move_pct
      - realized_move_pct
      - premium_yield_call_atm and/or premium_yield_put_atm

    Return is normalized to risk or debit, not portfolio equity. The harness is
    a ranking/research tool; broker fills, slippage, exact wing width, and IV
    crush timing are modeled later by the options execution stack.
    """

    symbol = str(event.get("symbol", "")).upper()
    setup = str(event.get("setup") or event.get("top_setup") or "").lower()
    if setup not in DEFINED_RISK_SETUPS:
        raise ValueError(f"unsupported earnings setup: {setup or '<missing>'}")
    expected = _positive_float(event.get("expected_move_pct"), "expected_move_pct")
    realized = _float(event.get("realized_move_pct"), "realized_move_pct")
    report_date = _date_string(event.get("report_date"))
    edge_score = _optional_float(event.get("edge_score"))
    call_yield = max(_optional_float(event.get("premium_yield_call_atm")) or 0.0, 0.0)
    put_yield = max(_optional_float(event.get("premium_yield_put_atm")) or 0.0, 0.0)

    if setup == "long straddle":
        debit = call_yield + put_yield
        if debit <= 0:
            raise ValueError("long straddle requires call + put premium yield")
        # B2.10: floor the denominator so a $0.01 sum doesn't 200x the return
        safe_debit = max(debit, MIN_DEBIT_RATIO)
        ret = _clamp_return(
            (abs(realized) - safe_debit) / safe_debit,
            setup=setup,
            symbol=symbol,
            debit=debit,
        )
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason="big realized move beat debit" if ret > 0 else "realized move did not clear debit",
        )

    if setup == "long call":
        debit = call_yield
        if debit <= 0:
            raise ValueError("long call requires call premium yield")
        safe_debit = max(debit, MIN_DEBIT_RATIO)
        ret = _clamp_return(
            (realized - safe_debit) / safe_debit,
            setup=setup,
            symbol=symbol,
            debit=debit,
        )
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=(
                "post-report rally cleared debit hurdle"
                if ret > 0
                else "post-report rally did not clear debit hurdle"
            ),
        )

    if setup == "long put":
        debit = put_yield
        if debit <= 0:
            raise ValueError("long put requires put premium yield")
        safe_debit = max(debit, MIN_DEBIT_RATIO)
        ret = _clamp_return(
            (-realized - safe_debit) / safe_debit,
            setup=setup,
            symbol=symbol,
            debit=debit,
        )
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=(
                "post-report selloff cleared debit hurdle"
                if ret > 0
                else "post-report selloff did not clear debit hurdle"
            ),
        )

    if setup in {"iron condor", "iron butterfly", "calendar spread", "diagonal spread"}:
        credit = (call_yield + put_yield) * 0.55
        max_loss = max(expected * 1.25, credit * 2.0, 0.01)
        breach = max(0.0, abs(realized) - expected)
        if breach <= 0:
            ret = credit / max_loss
            reason = "realized move stayed inside expected move"
        else:
            ret = -min(1.0, breach / max_loss)
            reason = "realized move breached expected move"
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=reason,
        )

    if setup == "bull put spread":
        credit = put_yield
        max_loss = max(expected * 0.9, credit * 2.0, 0.01)
        adverse = max(0.0, -realized - expected)
        if adverse <= 0:
            ret = credit / max_loss
            reason = "post-report price stayed above put-side risk band"
        else:
            ret = -min(1.0, adverse / max_loss)
            reason = "post-report selloff breached put-side risk band"
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=reason,
        )

    if setup == "bull call spread":
        debit = call_yield * 0.6
        if debit <= 0:
            raise ValueError("bull call spread requires call premium yield")
        directional_move = realized
        ret = max(-1.0, min(1.0, (directional_move - debit) / debit))
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=(
                "post-report rally cleared debit hurdle"
                if ret > 0
                else "post-report rally did not clear debit hurdle"
            ),
        )

    if setup == "bear put spread":
        debit = put_yield * 0.6
        if debit <= 0:
            raise ValueError("bear put spread requires put premium yield")
        directional_move = -realized
        ret = max(-1.0, min(1.0, (directional_move - debit) / debit))
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason=(
                "post-report selloff cleared debit hurdle"
                if ret > 0
                else "post-report selloff did not clear debit hurdle"
            ),
        )

    # bear call spread
    credit = call_yield
    max_loss = max(expected * 0.9, credit * 2.0, 0.01)
    adverse = max(0.0, realized - expected)
    if adverse <= 0:
        ret = credit / max_loss
        reason = "post-report price stayed below call-side risk band"
    else:
        ret = -min(1.0, adverse / max_loss)
        reason = "post-report rally breached call-side risk band"
    return EventTrade(
        symbol=symbol,
        report_date=report_date,
        setup=setup,
        return_pct=round(ret, 4),
        win=ret > 0,
        edge_score=edge_score,
        reason=reason,
    )


def run_event_backtest(
    events: Iterable[Mapping[str, Any]],
    *,
    min_edge_score: float | None = None,
    max_events: int | None = None,
    risk_fraction: float = 0.01,
) -> dict[str, Any]:
    """Run a deterministic event-level backtest over normalized events."""

    trades: list[EventTrade] = []
    skipped: list[dict[str, str]] = []
    for event in sorted(events, key=lambda e: str(e.get("report_date", ""))):
        edge = _optional_float(event.get("edge_score"))
        if min_edge_score is not None and (edge is None or edge < min_edge_score):
            continue
        try:
            trades.append(simulate_event_trade(event))
        except ValueError as exc:
            skipped.append({"symbol": str(event.get("symbol", "")), "reason": str(exc)})
        if max_events is not None and len(trades) >= max_events:
            break

    equity = 1.0
    peak = 1.0
    max_drawdown = 0.0
    for trade in trades:
        equity *= max(0.0, 1.0 + trade.return_pct * risk_fraction)
        peak = max(peak, equity)
        if peak > 0:
            max_drawdown = max(max_drawdown, (peak - equity) / peak)

    wins = sum(1 for trade in trades if trade.win)
    gross_wins = sum(trade.return_pct for trade in trades if trade.return_pct > 0)
    gross_losses = abs(sum(trade.return_pct for trade in trades if trade.return_pct < 0))
    avg_return = sum((trade.return_pct for trade in trades), 0.0) / len(trades) if trades else 0.0
    return {
        "trades": [trade.__dict__ for trade in trades],
        "skipped": skipped,
        "metrics": {
            "events": len(trades),
            "win_rate": wins / len(trades) if trades else 0.0,
            "avg_trade_return_pct": avg_return,
            "total_return_pct": equity - 1.0,
            "max_drawdown_pct": max_drawdown,
            "profit_factor": (gross_wins / gross_losses) if gross_losses > 0 else None,
        },
    }


def _optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _float(value: Any, field: str) -> float:
    out = _optional_float(value)
    if out is None:
        raise ValueError(f"{field} is required")
    return out


def _positive_float(value: Any, field: str) -> float:
    out = _float(value, field)
    if out <= 0:
        raise ValueError(f"{field} must be positive")
    return out


def _date_string(value: Any) -> str:
    if isinstance(value, date):
        return value.isoformat()
    s = str(value or "")
    if not s:
        raise ValueError("report_date is required")
    return s[:10]
