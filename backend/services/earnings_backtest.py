"""Event-level backtest helpers for the earnings options play.

This module is deliberately independent from the daily BacktestEngine. The
earnings-options screen works from event rows, option premium, expected move,
and realized post-report move; squeezing that into daily equity bars loses the
thing we need to measure. The functions here accept normalized event dicts so
provider loaders, notebooks, and API routes can all reuse the same payoff
logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable, Mapping


DEFINED_RISK_SETUPS = {
    "bull put spread",
    "bear call spread",
    "iron condor",
    "iron butterfly",
    "calendar spread",
    "diagonal spread",
    "long straddle",
}


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
        ret = max(-1.0, (abs(realized) - debit) / debit)
        return EventTrade(
            symbol=symbol,
            report_date=report_date,
            setup=setup,
            return_pct=round(ret, 4),
            win=ret > 0,
            edge_score=edge_score,
            reason="big realized move beat debit" if ret > 0 else "realized move did not clear debit",
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
