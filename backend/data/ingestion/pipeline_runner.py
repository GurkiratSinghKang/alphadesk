"""Pipeline scheduler — runs the daily trading pipeline on a schedule.

- 9:35 AM ET  — full pipeline (screen, analyse, trade)
- 3:30 PM ET  — position check (stop-loss / take-profit exits)

Started/stopped from the FastAPI lifespan in main.py.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time as dt_time, timedelta
from zoneinfo import ZoneInfo

from data.ingestion.daily_pipeline import (
    run_daily_pipeline,
    run_position_check,
    get_pipeline_status,
)

logger = logging.getLogger("alphadesk.pipeline.scheduler")

ET = ZoneInfo("America/New_York")

# Schedule times (Eastern)
MORNING_RUN = dt_time(9, 35)   # 5 min after open
AFTERNOON_CHECK = dt_time(15, 30)  # 30 min before close

_scheduler_task: asyncio.Task | None = None
_should_stop = False


def _seconds_until(target: dt_time) -> float:
    """Seconds from now until the next occurrence of *target* (ET)."""
    now = datetime.now(ET)
    target_dt = now.replace(
        hour=target.hour, minute=target.minute, second=0, microsecond=0,
    )
    if target_dt <= now:
        target_dt += timedelta(days=1)
    return (target_dt - now).total_seconds()


def _is_weekday() -> bool:
    return datetime.now(ET).weekday() < 5  # Mon-Fri


async def _scheduler_loop() -> None:
    """Main loop — wakes up every 30 s to check whether a scheduled run is due."""
    global _should_stop

    logger.info("Pipeline scheduler started")
    last_morning: str | None = None
    last_afternoon: str | None = None

    while not _should_stop:
        try:
            now = datetime.now(ET)
            today = now.strftime("%Y-%m-%d")
            cur = now.time()

            if _is_weekday():
                # Morning run (within a 5-min window of MORNING_RUN)
                if (
                    last_morning != today
                    and MORNING_RUN <= cur <= dt_time(MORNING_RUN.hour, MORNING_RUN.minute + 5)
                ):
                    logger.info("Triggering morning pipeline run")
                    last_morning = today
                    try:
                        await run_daily_pipeline()
                    except Exception as e:
                        logger.exception("Morning pipeline failed: %s", e)

                # Afternoon position check
                if (
                    last_afternoon != today
                    and AFTERNOON_CHECK <= cur <= dt_time(AFTERNOON_CHECK.hour, AFTERNOON_CHECK.minute + 5)
                ):
                    logger.info("Triggering afternoon position check")
                    last_afternoon = today
                    try:
                        await run_position_check()
                    except Exception as e:
                        logger.exception("Afternoon check failed: %s", e)

            await asyncio.sleep(30)

        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.exception("Scheduler loop error: %s", e)
            await asyncio.sleep(60)

    logger.info("Pipeline scheduler stopped")


async def start_pipeline_scheduler() -> None:
    """Start the daily pipeline scheduler as a background task."""
    global _scheduler_task, _should_stop
    _should_stop = False
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("Pipeline scheduler background task created")


async def stop_pipeline_scheduler() -> None:
    """Stop the scheduler gracefully."""
    global _should_stop, _scheduler_task
    _should_stop = True
    if _scheduler_task:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except (asyncio.CancelledError, Exception):
            pass
        _scheduler_task = None
    logger.info("Pipeline scheduler stopped")
