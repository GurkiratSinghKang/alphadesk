"""
Continuous Market Monitor

Runs during market hours:
- Every 60 seconds: Check news for held positions
- Every 5 minutes: Check prices against stop/take-profit
- At 11:00 AM: Mid-day scan
- At 2:00 PM: Afternoon scan
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from data.calendar import USMarketCalendar

logger = logging.getLogger("alphadesk.monitor")
ET = ZoneInfo("America/New_York")

# Shared holiday-aware calendar. See edge-cases-audit-r3.md P0 #4 — using
# `datetime.weekday() < 5` misses US holidays that fall on weekdays.
_CAL = USMarketCalendar()

_monitor_task: asyncio.Task | None = None
_should_stop = False


async def _check_news_for_positions() -> list[dict]:
    """Check if any held positions have significant news."""
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    held_symbols = ledger.get_held_symbols()
    if not held_symbols:
        return []

    from api.routes.news import fetch_news_for_symbol

    alerts: list[dict] = []
    for sym in held_symbols:
        try:
            headlines = await fetch_news_for_symbol(sym)
            for h in headlines[:3]:
                h_lower = h.lower()
                # Check for urgent keywords
                urgent_keywords = [
                    "lawsuit", "recall", "downgrade", "sec", "fraud",
                    "miss", "cut", "layoff", "crash", "halt",
                    "warning", "investigation",
                ]
                if any(kw in h_lower for kw in urgent_keywords):
                    alerts.append({"symbol": sym, "headline": h, "severity": "high"})
                    logger.warning("NEWS ALERT [%s]: %s", sym, h[:100])
        except Exception:
            logger.warning("news alert check failed for %s", sym, exc_info=True)

    if alerts:
        # Publish alerts to Redis for frontend
        try:
            from core.redis import publish
            for alert in alerts:
                await publish("alerts", {
                    "type": "news_alert",
                    "symbol": alert["symbol"],
                    "message": f"WARNING {alert['symbol']}: {alert['headline'][:100]}",
                    "severity": alert["severity"],
                })
        except Exception:
            logger.warning("failed to publish news alerts to Redis", exc_info=True)

    return alerts


async def _check_price_alerts() -> list[dict]:
    """Check if any positions are near stop-loss or take-profit."""
    import httpx
    from core.config import settings
    from data.ingestion.trade_ledger import TradeLedger

    ledger = TradeLedger()
    open_positions = ledger.get_open_positions()
    if not open_positions:
        return []

    headers = {
        "APCA-API-KEY-ID": settings.ALPACA_API_KEY.get_secret_value(),
        "APCA-API-SECRET-KEY": settings.ALPACA_SECRET_KEY.get_secret_value(),
    }

    alerts: list[dict] = []
    async with httpx.AsyncClient(timeout=10) as client:
        for trade in open_positions:
            sym = trade["symbol"]
            try:
                resp = await client.get(
                    f"{settings.ALPACA_DATA_BASE_URL}/v2/stocks/{sym}/trades/latest",
                    headers=headers,
                )
                if resp.status_code != 200:
                    continue
                price = resp.json().get("trade", {}).get("p", 0)
                if not price:
                    continue

                entry = trade.get("entry_price", 0)
                stop = trade.get("stop_loss", 0)
                target = trade.get("take_profit", 0)

                # Check proximity to stop (within 2%)
                if stop and price > 0 and abs(price - stop) / price < 0.02:
                    alerts.append({
                        "symbol": sym, "price": price, "stop": stop,
                        "message": f"{sym} at ${price:.2f} -- approaching stop-loss ${stop:.2f}",
                        "severity": "high",
                    })
                    logger.warning("PRICE ALERT: %s at $%.2f near stop $%.2f", sym, price, stop)

                # Check proximity to target (within 2%)
                if target and price > 0 and abs(target - price) / price < 0.02:
                    alerts.append({
                        "symbol": sym, "price": price, "target": target,
                        "message": f"{sym} at ${price:.2f} -- approaching target ${target:.2f}",
                        "severity": "medium",
                    })
            except Exception:
                logger.warning("price alert check failed for %s", sym, exc_info=True)

    # Publish alerts
    if alerts:
        try:
            from core.redis import publish
            for alert in alerts:
                await publish("alerts", {
                    "type": "price_alert",
                    "symbol": alert["symbol"],
                    "message": alert["message"],
                    "severity": alert["severity"],
                })
        except Exception:
            logger.warning("failed to publish price alerts to Redis", exc_info=True)

    return alerts


# tracks last strategy evaluation slot, including the trading date so the
# same clock slot ("9:30") doesn't get suppressed when we cross a date
# boundary (long-session-audit-r4 P2 #13).
_last_eval_slot: str | None = None

async def _run_monitor() -> None:
    """Main monitoring loop -- runs during market hours."""
    global _should_stop, _last_eval_slot

    news_interval = 600  # 10 minutes (avoid newsdata.io rate limiting)
    price_interval = 300  # 5 minutes
    last_news_check = 0.0
    last_price_check = 0.0

    while not _should_stop:
        try:
            now = datetime.now(ET)
            hour = now.hour
            minute = now.minute

            # Skip non-trading days entirely — US holidays that fall on a
            # weekday (Christmas, MLK Day, Good Friday, etc.) would otherwise
            # trigger strategy evaluation against a closed market. Weekend days
            # are also covered by ``is_trading_day``. See edge-cases-audit-r3
            # P0 #4.
            if not _CAL.is_trading_day(now.date()):
                await asyncio.sleep(300)  # 5 min — cheap, no market to watch
                continue

            # Only run during extended market hours (7 AM - 8 PM ET)
            if hour < 7 or hour >= 20:
                await asyncio.sleep(60)
                continue

            current_time = asyncio.get_event_loop().time()

            # News check every 60 seconds
            if current_time - last_news_check >= news_interval:
                await _check_news_for_positions()
                last_news_check = current_time

            # Price check every 5 minutes
            if current_time - last_price_check >= price_interval:
                await _check_price_alerts()
                last_price_check = current_time

            # Strategy evaluation every 30 minutes during regular trading
            # hours. Holiday-aware via USMarketCalendar — on early-close days
            # (day after Thanksgiving, Christmas Eve, July 3rd) the window
            # ends at 13:00 ET rather than 16:00 ET.
            is_market_hours = False
            try:
                if _CAL.is_trading_day(now.date()):
                    open_utc, close_utc = _CAL.session_hours(now.date())
                    open_et = open_utc.astimezone(ET)
                    close_et = close_utc.astimezone(ET)
                    is_market_hours = open_et <= now < close_et
            except Exception:
                # Calendar lookup failure — fall back to the coarse weekday+hour
                # check rather than evaluating strategies against bad data.
                is_market_hours = (hour == 9 and minute >= 30) or (10 <= hour <= 15)
            is_evaluation_time = minute in (0, 30)

            if is_market_hours and is_evaluation_time:
                # Check if we already ran this slot. Key includes the trading
                # date so the same clock slot ("9:30") on Tue isn't skipped
                # because Mon's "9:30" is still cached
                # (long-session-audit-r4 P2 #13).
                slot_key = f"{now.date().isoformat()}:{hour}:{minute:02d}"
                if slot_key != _last_eval_slot:
                    from data.ingestion.daily_pipeline import run_daily_pipeline, _pipeline_lock
                    if _pipeline_lock.locked():
                        logger.info("Pipeline already running — skipping evaluation slot %s", slot_key)
                    else:
                        _last_eval_slot = slot_key
                        logger.info("Strategy evaluation triggered (%s ET)", slot_key)
                        try:
                            # TODO(Audit MB-P0-1): continuous_monitor is a
                            # process-wide background task with no requesting
                            # user; falls back to env credentials. Multi-
                            # user deployments need a service account or
                            # per-user evaluation slots.
                            await run_daily_pipeline(screen_limit=20, analyze_limit=5)
                        except Exception:
                            logger.error("Strategy evaluation failed", exc_info=True)
                    await asyncio.sleep(60)  # skip rest of this minute

            await asyncio.sleep(10)  # check every 10 seconds

        except Exception:
            logger.error("Monitor error", exc_info=True)
            await asyncio.sleep(30)


async def start_continuous_monitor() -> None:
    """Start the continuous market monitor as a background task.

    Round-11 / BB-13: supervised so a silent death surfaces at ERROR.
    """
    from core.supervised_task import create_supervised_task

    global _monitor_task, _should_stop
    _should_stop = False
    _monitor_task = create_supervised_task(
        _run_monitor(), name="continuous_monitor"
    )
    logger.info("Continuous market monitor started")


async def stop_continuous_monitor() -> None:
    """Stop the continuous market monitor."""
    global _should_stop, _monitor_task
    _should_stop = True
    if _monitor_task:
        _monitor_task.cancel()
        try:
            await _monitor_task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.debug("continuous monitor task raised during shutdown", exc_info=True)
    logger.info("Continuous market monitor stopped")
