"""Per-strategy entry-signal cache.

Daily strategy runner writes the latest signals it emits via
``set_signals_for_strategy``; the symbols-page reverse-lookup endpoint
reads them via ``get_signal`` to surface the 3rd chip state ("Active
signal . long . score 0.87") on /symbols/[ticker].

Layering decision (iter 16): strategy classes do NOT learn about Redis.
The cache lookup happens in the API route layer (which is already async),
keeping ``strategies/_core/protocol.py`` and every concrete strategy pure
and synchronous. The route falls through to the ``BaseStrategy`` no-op
defaults when the cache misses, so a Redis hiccup degrades gracefully
to the iter-11 contract (``has_entry_signal=False`` / score / side
``None``) without taking the symbols page down.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Literal, TypedDict

from core.redis import cache_get, cache_set

logger = logging.getLogger(__name__)

# Strategies run on daily cadence -- anything stale beyond 24h is a stale
# signal we'd rather suppress than show. The runner refreshes on each run,
# so steady-state TTL pressure is well under 24h. The ``v1`` suffix on the
# key lets us roll the schema without a flush if the payload shape ever
# evolves (e.g. adding ``stop_price`` or ``rationale``).
SIGNAL_CACHE_TTL = 24 * 60 * 60


class CachedSignal(TypedDict):
    """Wire shape of a cached entry signal for one (strategy, symbol)."""

    score: float | None
    side: Literal["long", "short"] | None
    evaluated_at: str  # ISO 8601 UTC
    conviction: int | None


def _key(strategy_id: str, symbol: str) -> str:
    """Canonical Redis key. Lowercase strategy id + uppercase symbol so
    callers don't have to remember which side of the cross-walk they're on
    (route ids are hyphenated lowercase, ledger names are snake_case lowercase,
    symbols are always uppercased on the wire).
    """
    return f"signal_cache:{strategy_id.lower()}:{symbol.upper()}:v1"


async def get_signal(strategy_id: str, symbol: str) -> CachedSignal | None:
    """Return cached signal for (strategy_id, symbol) or ``None`` on miss / decode error.

    Defensive on the read side: a malformed payload (non-dict, bad ``side``,
    non-numeric ``score``, missing ``evaluated_at``) is treated as a miss
    rather than raising. The route falls through to the no-op defaults
    so a poisoned key never 500s the symbols page -- ``cache_get`` already
    logs + deletes corrupt JSON in :mod:`core.redis`; this layer guards
    against schema drift on top of that.
    """
    raw = await cache_get(_key(strategy_id, symbol))
    if not raw:
        return None
    if not isinstance(raw, dict):
        return None
    side = raw.get("side")
    if side not in (None, "long", "short"):
        return None
    score = raw.get("score")
    if score is not None:
        try:
            score = float(score)
        except (TypeError, ValueError):
            return None
    evaluated_at = raw.get("evaluated_at")
    if not isinstance(evaluated_at, str):
        return None
    conviction = raw.get("conviction")
    if conviction is not None:
        try:
            conviction = int(conviction)
        except (TypeError, ValueError):
            conviction = None
    return CachedSignal(
        score=score,
        side=side,
        evaluated_at=evaluated_at,
        conviction=conviction,
    )


async def set_signals_for_strategy(
    strategy_id: str,
    signals_by_symbol: dict[str, dict[str, Any]],
    *,
    ttl: int = SIGNAL_CACHE_TTL,
) -> None:
    """Bulk-write the latest signals for a strategy.

    ``signals_by_symbol`` maps SYMBOL -> ``{score, side, conviction}``.
    ``evaluated_at`` is auto-stamped here so callers don't have to
    clock-source it (and so all symbols in one run share an exact timestamp,
    which makes "is this run's worth of signals stale yet?" trivial to
    compute downstream).

    Per-symbol writes are isolated in their own try/except so a single
    bad payload (e.g. a string conviction that won't coerce to int) doesn't
    drop the rest of the run's signals. Best-effort by design -- the daily
    runner cannot afford to crash on a Redis blip.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    for sym, payload in signals_by_symbol.items():
        try:
            entry: CachedSignal = {
                "score": float(payload.get("score")) if payload.get("score") is not None else None,
                "side": payload.get("side") if payload.get("side") in ("long", "short") else None,
                "evaluated_at": now_iso,
                "conviction": int(payload["conviction"]) if payload.get("conviction") is not None else None,
            }
            await cache_set(_key(strategy_id, sym), dict(entry), ttl)
        except Exception:
            logger.warning("signal_cache write failed for %s/%s", strategy_id, sym, exc_info=True)
