"""API routes for the automated daily trading pipeline."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger("alphadesk.pipeline.api")

router = APIRouter()

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "pipeline_logs"


# ---- POST /run — manually trigger the pipeline ----

@router.post("/run")
async def trigger_pipeline(
    screen_limit: int = Query(100, ge=1, le=500, description="Number of stocks to screen"),
    analyze_limit: int = Query(15, ge=1, le=200, description="Total analysis budget across all strategies"),
) -> dict[str, Any]:
    """Manually trigger a full multi-strategy pipeline run.

    The response includes per-strategy breakdown plus master agent decisions.
    """
    from data.ingestion.daily_pipeline import run_daily_pipeline

    result = await run_daily_pipeline(screen_limit=screen_limit, analyze_limit=analyze_limit)

    # Build a concise summary for the API response
    strategies_summary = {}
    for strat_name, strat_data in result.get("strategies", {}).items():
        if isinstance(strat_data, dict) and "error" not in strat_data:
            strategies_summary[strat_name] = {
                "screened": strat_data.get("screened", 0),
                "analyzed": strat_data.get("analyzed", 0),
                "trades_requested": strat_data.get("trades_requested", 0),
                "trades_approved": strat_data.get("trades_approved", 0),
            }
        else:
            strategies_summary[strat_name] = strat_data

    return {
        "ok": True,
        "strategies": strategies_summary,
        "master_agent": result.get("master_agent", {}),
        "orders_placed": result.get("orders_placed", []),
        "orders_closed": result.get("orders_closed", []),
        "portfolio_snapshot": result.get("portfolio_snapshot", {}),
        "errors": result.get("errors", []),
    }


# ---- GET /status — current pipeline status ----

@router.get("/status")
async def pipeline_status() -> dict[str, Any]:
    """Get the current status of the pipeline scheduler."""
    from data.ingestion.daily_pipeline import get_pipeline_status

    status = get_pipeline_status()
    return status


# ---- GET /history — last 30 days of pipeline logs ----

@router.get("/history")
async def pipeline_history() -> list[dict[str, Any]]:
    """Return pipeline run summaries for the last 30 days."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entries: list[dict[str, Any]] = []

    today = datetime.now(timezone.utc).date()
    for i in range(30):
        date = today - timedelta(days=i)
        path = LOG_DIR / f"{date.isoformat()}.json"
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                # Support both old format (signals list) and new multi-strategy format
                strategies_data = data.get("strategies", {})
                total_signals = len(data.get("signals", []))
                if not total_signals and strategies_data:
                    total_signals = sum(
                        s.get("trades_approved", 0)
                        for s in strategies_data.values()
                        if isinstance(s, dict)
                    )
                entries.append({
                    "date": data.get("date", str(date)),
                    "orders_placed": len(data.get("orders_placed", [])),
                    "orders_closed": len(data.get("orders_closed", [])),
                    "signals": total_signals,
                    "strategies_run": len(strategies_data) if strategies_data else 0,
                    "master_agent": data.get("master_agent", {}),
                    "errors": len(data.get("errors", [])),
                    "portfolio_snapshot": data.get("portfolio_snapshot", {}),
                })
            except Exception:
                entries.append({"date": str(date), "error": "corrupt_log"})

    return entries


# ---- GET /history/{date} — specific day log ----

@router.get("/history/{date}")
async def pipeline_history_date(date: str) -> dict[str, Any]:
    """Return the full pipeline log for a specific date (YYYY-MM-DD)."""
    import re
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=400, detail="Invalid date format, expected YYYY-MM-DD")
    path = LOG_DIR / f"{date}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No pipeline log for {date}")

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to read log: {e}")
        raise HTTPException(status_code=500, detail="Failed to read pipeline log")


# ---- GET /positions — AI-managed positions with entry/exit levels ----

@router.get("/positions")
async def pipeline_positions() -> dict[str, Any]:
    """Return all open AI-managed positions with stop/target levels."""
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    open_positions = ledger.get_open_positions()
    performance = ledger.get_performance_summary()

    # Enrich open positions with live market prices
    if open_positions:
        import httpx
        from core.config import settings

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for pos in open_positions:
                    symbol = pos.get("symbol", "")
                    if not symbol:
                        continue
                    try:
                        resp = await client.get(
                            f"https://data.alpaca.markets/v2/stocks/{symbol}/trades/latest",
                            headers={
                                "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
                                "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
                            },
                        )
                        if resp.status_code == 200:
                            current_price = resp.json().get("trade", {}).get("p", 0)
                            pos["current_price"] = current_price
                            entry = pos.get("entry_price", 0)
                            shares = pos.get("shares", 0)
                            if entry and shares:
                                pos["pnl"] = round((current_price - entry) * shares, 2)
                                pos["pnl_pct"] = round(((current_price - entry) / entry) * 100, 2)
                    except Exception:
                        logger.debug("Failed to fetch live price for %s", symbol)
        except Exception:
            logger.warning("Failed to enrich pipeline positions with live data")

    return {
        "open_positions": open_positions,
        "performance": performance,
    }
