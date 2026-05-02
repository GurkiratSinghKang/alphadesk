from __future__ import annotations

import logging
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

RISK_MONITOR_REDIS_KEY = "alphadesk:risk_monitor:enabled"


def parse_risk_monitor_enabled(raw: Any, default: bool = True) -> bool:
    if raw is None:
        return default
    value = str(raw).strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


async def read_risk_monitor_enabled(default: bool = True) -> bool:
    try:
        from core.redis import get_redis

        redis = await get_redis()
        raw = await redis.get(RISK_MONITOR_REDIS_KEY)
        return parse_risk_monitor_enabled(raw, default)
    except Exception:
        logger.debug("risk monitor state read failed; using process default", exc_info=True)
        return default


async def write_risk_monitor_enabled(enabled: bool) -> None:
    from core.redis import get_redis

    redis = await get_redis()
    await redis.set(RISK_MONITOR_REDIS_KEY, "1" if enabled else "0")


def read_risk_monitor_enabled_sync(default: bool = True) -> bool:
    try:
        import redis

        client = redis.Redis.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=0.05,
            socket_timeout=0.05,
        )
        try:
            raw = client.get(RISK_MONITOR_REDIS_KEY)
        finally:
            client.close()
        return parse_risk_monitor_enabled(raw, default)
    except Exception:
        logger.debug("sync risk monitor state read failed; using process default", exc_info=True)
        return default
