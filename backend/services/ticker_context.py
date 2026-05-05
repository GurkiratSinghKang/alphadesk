"""Central ticker context and stale-aware fact reuse.

The first version is deliberately incremental: existing provider services
remain the source of raw data, while this module gives routes and strategies
one typed place to ask for ticker-scoped facts with explicit freshness
metadata. Postgres stores durable facts when available; Redis is only a hot
cache and dedupe layer.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from collections.abc import Awaitable, Callable
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from core.config import settings

logger = logging.getLogger(__name__)

FreshnessQuality = Literal["fresh", "stale", "expired", "unavailable", "demo"]
OnStale = Literal["allow", "refresh", "reject", "allow_with_warning"]

_SCHEMA_VERSION = 1
_CACHE_SCHEMA_VERSION = 1
_REFRESH_LOCK_SECONDS = 30

# Audit B-F9 / R-F8 (2026-05-05): the per-symbol lock dict grew
# unboundedly — one entry per ``(symbol, namespace, key)`` tuple,
# never evicted. Over months of operation that's tens of thousands
# of stale ``asyncio.Lock`` instances. Bound it with a simple LRU
# eviction: when the dict crosses ``_LOCAL_FACT_LOCKS_MAX``, drop
# the oldest 25% of entries. A lock that was just evicted will
# simply be re-created on next access; correctness is unaffected
# (the lock only serialises within a single coroutine event-loop
# tick anyway, so a fresh lock is fine even if there's a pending
# acquirer somewhere).
_LOCAL_FACT_LOCKS: dict[str, asyncio.Lock] = {}
_LOCAL_FACT_LOCKS_MAX = 4096
_LOCAL_FACT_LOCKS_EVICT_PCT = 0.25


def _maybe_evict_local_fact_locks() -> None:
    """Evict ~25% of the oldest entries when the dict exceeds the cap."""
    if len(_LOCAL_FACT_LOCKS) <= _LOCAL_FACT_LOCKS_MAX:
        return
    # Python 3.7+ dict preserves insertion order — drop the oldest by
    # taking the first N keys. setdefault re-inserts on miss so
    # in-flight coroutines holding a reference to an evicted lock keep
    # working; only NEW callers see the fresh lock.
    n_to_drop = max(1, int(_LOCAL_FACT_LOCKS_MAX * _LOCAL_FACT_LOCKS_EVICT_PCT))
    for key in list(_LOCAL_FACT_LOCKS.keys())[:n_to_drop]:
        _LOCAL_FACT_LOCKS.pop(key, None)


class FreshnessMeta(BaseModel):
    observed_at: datetime
    as_of: datetime | None = None
    source_updated_at: datetime | None = None
    expires_at: datetime | None = None
    stale_after_seconds: int | None = None
    quality: FreshnessQuality = "fresh"
    source: str
    schema_version: int = _SCHEMA_VERSION
    is_demo: bool = False


class FactEnvelope(BaseModel):
    value: Any | None = None
    freshness: FreshnessMeta


class TickerContextWarning(BaseModel):
    need: str
    code: str
    message: str


class TickerContext(BaseModel):
    symbol: str
    quote: FactEnvelope | None = None
    options_summary: FactEnvelope | None = None
    earnings: FactEnvelope | None = None
    research: FactEnvelope | None = None
    news: FactEnvelope | None = None
    market_regime: FactEnvelope | None = None
    warnings: list[TickerContextWarning] = Field(default_factory=list)


class TickerContextResponse(BaseModel):
    symbols: dict[str, TickerContext]
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TickerContextRequest(BaseModel):
    symbols: list[str]
    needs: list[str] = Field(default_factory=lambda: ["quote", "options_summary", "earnings", "research"])
    max_age_seconds: int | None = Field(default=None, ge=1)
    on_stale: OnStale = "allow_with_warning"

    @field_validator("symbols", mode="before")
    @classmethod
    def _split_symbols(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("symbols")
    @classmethod
    def _normalize_symbols(cls, value: list[str]) -> list[str]:
        symbols = [_normalize_symbol(item) for item in value]
        deduped = list(dict.fromkeys(symbols))
        if not deduped:
            raise ValueError("at least one symbol is required")
        if len(deduped) > 50:
            raise ValueError("ticker context requests are limited to 50 symbols")
        return deduped

    @field_validator("needs", mode="before")
    @classmethod
    def _split_needs(cls, value: Any) -> Any:
        if isinstance(value, str):
            return [part.strip() for part in value.split(",") if part.strip()]
        return value

    @field_validator("needs")
    @classmethod
    def _normalize_needs(cls, value: list[str]) -> list[str]:
        needs = [_normalize_need(item) for item in value]
        return list(dict.fromkeys(needs))


@dataclass(frozen=True)
class FactSpec:
    field: str
    namespace: str
    key: str
    source: str
    stale_after_seconds: int | None


@dataclass(frozen=True)
class LoadedFact:
    value: Any
    as_of: datetime | None = None
    source_updated_at: datetime | None = None
    source: str | None = None
    source_ref: str | None = None
    stale_after_seconds: int | None = None
    is_demo: bool = False


_FACT_SPECS: dict[str, FactSpec] = {
    "quote": FactSpec("quote", "market", "quote", "market_waterfall", 15),
    "options_summary": FactSpec("options_summary", "options", "summary", "options_waterfall", 300),
    "earnings": FactSpec("earnings", "earnings", "meta", "fmp_earnings", 900),
    "research": FactSpec("research", "research", "tradingagents_latest", "tradingagents", None),
    "news": FactSpec("news", "news", "latest", "newsdata", 1800),
    "market_regime": FactSpec("market_regime", "market", "regime", "alphadesk", 300),
}

_NEED_ALIASES = {
    "options": "options_summary",
    "option_summary": "options_summary",
    "iv": "options_summary",
    "tradingagents": "research",
    "trading_agents": "research",
    "regime": "market_regime",
}


def _normalize_symbol(value: str) -> str:
    symbol = (value or "").strip().upper()
    if not symbol or len(symbol) > 20:
        raise ValueError("symbol must be 1-20 characters")
    return symbol


def _normalize_need(value: str) -> str:
    need = (value or "").strip().lower().replace("-", "_")
    need = _NEED_ALIASES.get(need, need)
    if need not in _FACT_SPECS:
        raise ValueError(f"unknown ticker context need {value!r}")
    return need


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _jsonable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def _lineage_hash(value: Any, *, as_of: datetime | None, source: str) -> str:
    payload = {
        "source": source,
        "as_of": as_of.isoformat() if as_of else None,
        "value": _jsonable(value),
    }
    encoded = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def classify_freshness(
    freshness: FreshnessMeta,
    *,
    now: datetime | None = None,
    max_age_seconds: int | None = None,
) -> FreshnessQuality:
    """Classify a fact's current freshness from durable metadata."""
    if freshness.quality == "unavailable" or freshness.source == "unavailable":
        return "unavailable"
    if freshness.is_demo:
        return "demo"
    current = now or _now()
    if freshness.expires_at is not None and current >= freshness.expires_at:
        return "expired"
    stale_after = max_age_seconds if max_age_seconds is not None else freshness.stale_after_seconds
    if stale_after is not None and current >= freshness.observed_at + timedelta(seconds=stale_after):
        return "stale"
    return "fresh"


def _envelope(
    value: Any | None,
    *,
    spec: FactSpec,
    observed_at: datetime | None = None,
    as_of: datetime | None = None,
    source_updated_at: datetime | None = None,
    expires_at: datetime | None = None,
    stale_after_seconds: int | None = None,
    source: str | None = None,
    is_demo: bool = False,
    quality: FreshnessQuality | None = None,
) -> FactEnvelope:
    observed = observed_at or _now()
    stale_after = stale_after_seconds if stale_after_seconds is not None else spec.stale_after_seconds
    meta = FreshnessMeta(
        observed_at=observed,
        as_of=as_of,
        source_updated_at=source_updated_at,
        expires_at=expires_at,
        stale_after_seconds=stale_after,
        quality=quality or ("demo" if is_demo else "fresh"),
        source=source or spec.source,
        schema_version=_SCHEMA_VERSION,
        is_demo=is_demo,
    )
    meta.quality = classify_freshness(meta)
    return FactEnvelope(value=_jsonable(value), freshness=meta)


def _unavailable(spec: FactSpec, message_source: str = "unavailable") -> FactEnvelope:
    return _envelope(
        None,
        spec=spec,
        observed_at=_now(),
        source=message_source,
        expires_at=_now(),
        quality="unavailable",
    )


@asynccontextmanager
async def _distributed_refresh_slot(lock_key: str):
    """Best-effort Redis single-flight slot.

    Redis outages fail open. The local asyncio lock still dedupes within this
    process; the distributed slot only prevents multi-worker stampedes.
    """
    token = uuid.uuid4().hex
    redis_key = f"ticker_context:refresh_lock:{lock_key}"
    acquired = True
    redis = None
    try:
        from core.redis import get_redis

        redis = await get_redis()
        acquired = bool(await redis.set(redis_key, token, nx=True, ex=_REFRESH_LOCK_SECONDS))
    except Exception:
        logger.debug("ticker context Redis refresh lock unavailable", exc_info=True)
        acquired = True
    try:
        yield acquired
    finally:
        if acquired and redis is not None:
            try:
                current = await redis.get(redis_key)
                if current == token:
                    await redis.delete(redis_key)
            except Exception:
                logger.debug("ticker context Redis refresh lock release failed", exc_info=True)


class TickerContextService:
    def __init__(self, db: Any | None = None):
        self._db = db

    async def get_many(
        self,
        symbols: list[str],
        *,
        needs: list[str] | None = None,
        max_age_seconds: int | None = None,
        on_stale: OnStale = "allow_with_warning",
    ) -> TickerContextResponse:
        # Audit B-F8 (2026-05-05): the prior loop awaited each symbol's
        # ``self.get(...)`` serially. At 50 symbols × 4 needs = 200
        # provider lookups, the wall-clock latency was 200 × per-call
        # latency rather than max(per-call). asyncio.gather() runs them
        # concurrently — each ``get`` is already async-safe (per-symbol
        # locks live in ``_LOCAL_FACT_LOCKS``) so concurrent calls for
        # different symbols don't contend.
        normalized_needs = [_normalize_need(n) for n in (needs or ["quote", "options_summary", "earnings", "research"])]
        unique_symbols = list(dict.fromkeys(_normalize_symbol(s) for s in symbols))
        results = await asyncio.gather(
            *(
                self.get(
                    symbol,
                    needs=normalized_needs,
                    max_age_seconds=max_age_seconds,
                    on_stale=on_stale,
                )
                for symbol in unique_symbols
            ),
            return_exceptions=False,
        )
        contexts: dict[str, TickerContext] = {
            sym: ctx for sym, ctx in zip(unique_symbols, results)
        }
        return TickerContextResponse(symbols=contexts)

    async def get(
        self,
        symbol: str,
        *,
        needs: list[str] | None = None,
        max_age_seconds: int | None = None,
        on_stale: OnStale = "allow_with_warning",
    ) -> TickerContext:
        symbol = _normalize_symbol(symbol)
        context = TickerContext(symbol=symbol)
        for need in [_normalize_need(n) for n in (needs or ["quote", "options_summary", "earnings", "research"])]:
            spec = _FACT_SPECS[need]
            envelope, warnings = await self._get_or_refresh_fact(
                symbol,
                spec,
                max_age_seconds=max_age_seconds,
                on_stale=on_stale,
            )
            setattr(context, spec.field, envelope)
            context.warnings.extend(warnings)
        return context

    async def _get_or_refresh_fact(
        self,
        symbol: str,
        spec: FactSpec,
        *,
        max_age_seconds: int | None,
        on_stale: OnStale,
    ) -> tuple[FactEnvelope, list[TickerContextWarning]]:
        warnings: list[TickerContextWarning] = []
        existing = await self._load_cached_or_persisted(symbol, spec, max_age_seconds=max_age_seconds)
        if existing is not None:
            quality = existing.freshness.quality
            if quality in {"fresh", "demo"} or on_stale == "allow":
                if quality in {"stale", "expired"}:
                    warnings.append(self._warning(spec, "stale_allowed", f"{spec.field} is {quality}; returning cached fact."))
                return existing, warnings
            if quality in {"stale", "expired"} and on_stale == "reject":
                warnings.append(self._warning(spec, "stale_rejected", f"{spec.field} is {quality}; refresh required."))
                return _unavailable(spec), warnings

        lock_key = f"{symbol}:{spec.namespace}:{spec.key}"
        _maybe_evict_local_fact_locks()
        lock = _LOCAL_FACT_LOCKS.setdefault(lock_key, asyncio.Lock())
        async with lock:
            reread = await self._load_cached_or_persisted(symbol, spec, max_age_seconds=max_age_seconds)
            if reread is not None and reread.freshness.quality in {"fresh", "demo"}:
                return reread, warnings
            async with _distributed_refresh_slot(lock_key) as acquired:
                if not acquired:
                    for _ in range(6):
                        await asyncio.sleep(0.25)
                        reread = await self._load_cached_or_persisted(
                            symbol,
                            spec,
                            max_age_seconds=max_age_seconds,
                        )
                        if reread is not None and reread.freshness.quality in {"fresh", "demo"}:
                            return reread, warnings
                try:
                    refreshed = await self._refresh_fact(symbol, spec)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("ticker context refresh failed for %s/%s: %s", symbol, spec.field, exc, exc_info=True)
                    if existing is not None and on_stale == "allow_with_warning":
                        warnings.append(self._warning(spec, "refresh_failed_stale_returned", f"Could not refresh {spec.field}; returning cached {existing.freshness.quality} fact."))
                        return existing, warnings
                    warnings.append(self._warning(spec, "refresh_failed", f"Could not load {spec.field}: {exc}"))
                    return _unavailable(spec), warnings
                await self._persist_fact(symbol, spec, refreshed)
                await self._store_hot_cache(symbol, spec, refreshed)
                return refreshed, warnings

    async def get_or_refresh_custom_fact(
        self,
        symbol: str,
        spec: FactSpec,
        loader: Callable[[], Awaitable[LoadedFact | Any]],
        *,
        max_age_seconds: int | None = None,
        on_stale: OnStale = "allow_with_warning",
    ) -> tuple[FactEnvelope, list[TickerContextWarning]]:
        """Use the same stale-aware storage path for parameterized facts."""
        symbol = _normalize_symbol(symbol)
        warnings: list[TickerContextWarning] = []
        existing = await self._load_cached_or_persisted(symbol, spec, max_age_seconds=max_age_seconds)
        if existing is not None:
            quality = existing.freshness.quality
            if quality in {"fresh", "demo"} or on_stale == "allow":
                if quality in {"stale", "expired"}:
                    warnings.append(self._warning(spec, "stale_allowed", f"{spec.field} is {quality}; returning cached fact."))
                return existing, warnings
            if quality in {"stale", "expired"} and on_stale == "reject":
                warnings.append(self._warning(spec, "stale_rejected", f"{spec.field} is {quality}; refresh required."))
                return _unavailable(spec), warnings

        lock_key = f"{symbol}:{spec.namespace}:{spec.key}"
        _maybe_evict_local_fact_locks()
        lock = _LOCAL_FACT_LOCKS.setdefault(lock_key, asyncio.Lock())
        async with lock:
            reread = await self._load_cached_or_persisted(symbol, spec, max_age_seconds=max_age_seconds)
            if reread is not None and reread.freshness.quality in {"fresh", "demo"}:
                return reread, warnings
            async with _distributed_refresh_slot(lock_key) as acquired:
                if not acquired:
                    for _ in range(6):
                        await asyncio.sleep(0.25)
                        reread = await self._load_cached_or_persisted(
                            symbol,
                            spec,
                            max_age_seconds=max_age_seconds,
                        )
                        if reread is not None and reread.freshness.quality in {"fresh", "demo"}:
                            return reread, warnings
                try:
                    loaded = await loader()
                    if isinstance(loaded, LoadedFact):
                        refreshed = _envelope(
                            loaded.value,
                            spec=spec,
                            as_of=loaded.as_of,
                            source_updated_at=loaded.source_updated_at,
                            source=loaded.source or spec.source,
                            stale_after_seconds=loaded.stale_after_seconds,
                            is_demo=loaded.is_demo,
                        )
                    else:
                        refreshed = _envelope(loaded, spec=spec)
                except Exception as exc:  # noqa: BLE001
                    logger.debug("custom ticker fact refresh failed for %s/%s: %s", symbol, spec.key, exc, exc_info=True)
                    if existing is not None and on_stale == "allow_with_warning":
                        warnings.append(self._warning(spec, "refresh_failed_stale_returned", f"Could not refresh {spec.field}; returning cached {existing.freshness.quality} fact."))
                        return existing, warnings
                    warnings.append(self._warning(spec, "refresh_failed", f"Could not load {spec.field}: {exc}"))
                    return _unavailable(spec), warnings
                await self._persist_fact(symbol, spec, refreshed)
                await self._store_hot_cache(symbol, spec, refreshed)
                return refreshed, warnings

    def _warning(self, spec: FactSpec, code: str, message: str) -> TickerContextWarning:
        return TickerContextWarning(need=spec.field, code=code, message=message)

    async def _load_cached_or_persisted(
        self,
        symbol: str,
        spec: FactSpec,
        *,
        max_age_seconds: int | None,
    ) -> FactEnvelope | None:
        cached = await self._load_hot_cache(symbol, spec, max_age_seconds=max_age_seconds)
        if cached is not None:
            return cached
        persisted = await self._load_latest_persisted_fact(symbol, spec, max_age_seconds=max_age_seconds)
        if persisted is not None:
            await self._store_hot_cache(symbol, spec, persisted)
        return persisted

    async def _load_hot_cache(
        self,
        symbol: str,
        spec: FactSpec,
        *,
        max_age_seconds: int | None,
    ) -> FactEnvelope | None:
        try:
            from core.cache import get_cache

            raw = await get_cache().get(self._cache_key(symbol, spec), schema_version=_CACHE_SCHEMA_VERSION)
            if not raw:
                return None
            envelope = FactEnvelope.model_validate(raw)
            envelope.freshness.quality = classify_freshness(envelope.freshness, max_age_seconds=max_age_seconds)
            return envelope
        except Exception:
            logger.debug("ticker context hot-cache read failed", exc_info=True)
            return None

    async def _store_hot_cache(self, symbol: str, spec: FactSpec, envelope: FactEnvelope) -> None:
        try:
            from core.cache import get_cache

            ttl = envelope.freshness.stale_after_seconds
            ttl_seconds = max(int(ttl or 3600) * 4, 60)
            await get_cache().set(
                self._cache_key(symbol, spec),
                envelope.model_dump(mode="json"),
                ttl_seconds=min(ttl_seconds, 24 * 3600),
                schema_version=_CACHE_SCHEMA_VERSION,
            )
        except Exception:
            logger.debug("ticker context hot-cache write failed", exc_info=True)

    def _cache_key(self, symbol: str, spec: FactSpec) -> str:
        return f"ticker_context:{symbol}:{spec.namespace}:{spec.key}"

    async def _load_latest_persisted_fact(
        self,
        symbol: str,
        spec: FactSpec,
        *,
        max_age_seconds: int | None,
    ) -> FactEnvelope | None:
        if settings.SKIP_DB_INIT:
            return None
        try:
            from sqlalchemy import desc, select
            from data.storage.models import TickerFact

            async def _query(session: Any) -> FactEnvelope | None:
                stmt = (
                    select(TickerFact)
                    .where(
                        TickerFact.symbol == symbol,
                        TickerFact.namespace == spec.namespace,
                        TickerFact.key == spec.key,
                    )
                    .order_by(desc(TickerFact.observed_at), desc(TickerFact.id))
                    .limit(1)
                )
                row = (await session.execute(stmt)).scalar_one_or_none()
                if row is None:
                    return None
                envelope = _envelope(
                    row.value,
                    spec=spec,
                    observed_at=_coerce_datetime(row.observed_at),
                    as_of=_coerce_datetime(row.as_of),
                    source_updated_at=_coerce_datetime(row.source_updated_at),
                    expires_at=_coerce_datetime(row.expires_at),
                    stale_after_seconds=row.stale_after_seconds,
                    source=row.source,
                    is_demo=bool(row.is_demo),
                    quality=str(row.quality or "fresh"),  # type: ignore[arg-type]
                )
                envelope.freshness.quality = classify_freshness(envelope.freshness, max_age_seconds=max_age_seconds)
                return envelope

            if self._db is not None:
                return await _query(self._db)

            from core.database import _get_session_factory

            factory = _get_session_factory()
            async with factory() as session:
                return await _query(session)
        except Exception:
            logger.debug("ticker context persisted read failed", exc_info=True)
            return None

    async def _persist_fact(self, symbol: str, spec: FactSpec, envelope: FactEnvelope) -> None:
        if (
            settings.SKIP_DB_INIT
            or envelope.freshness.quality == "unavailable"
            or envelope.freshness.is_demo
        ):
            return
        try:
            from data.storage.models import TickerFact

            fact = TickerFact(
                symbol=symbol,
                namespace=spec.namespace,
                key=spec.key,
                value=_jsonable(envelope.value),
                source=envelope.freshness.source,
                source_ref=None,
                as_of=envelope.freshness.as_of,
                observed_at=envelope.freshness.observed_at,
                source_updated_at=envelope.freshness.source_updated_at,
                expires_at=envelope.freshness.expires_at,
                stale_after_seconds=envelope.freshness.stale_after_seconds,
                quality=envelope.freshness.quality,
                is_demo=envelope.freshness.is_demo,
                schema_version=envelope.freshness.schema_version,
                lineage_hash=_lineage_hash(envelope.value, as_of=envelope.freshness.as_of, source=envelope.freshness.source),
            )
            if self._db is not None:
                self._db.add(fact)
                await self._db.flush()
                return

            from core.database import _get_session_factory

            factory = _get_session_factory()
            async with factory() as session:
                session.add(fact)
                await session.commit()
        except Exception:
            logger.debug("ticker context persisted write failed", exc_info=True)

    async def _refresh_fact(self, symbol: str, spec: FactSpec) -> FactEnvelope:
        if spec.field == "quote":
            loaded = await self._load_quote(symbol, spec)
        elif spec.field == "options_summary":
            loaded = await self._load_options_summary(symbol, spec)
        elif spec.field == "earnings":
            loaded = await self._load_earnings(symbol, spec)
        elif spec.field == "research":
            loaded = await self._load_research(symbol, spec)
        elif spec.field == "news":
            loaded = await self._load_news(symbol, spec)
        elif spec.field == "market_regime":
            loaded = await self._load_market_regime(symbol, spec)
        else:  # pragma: no cover - normalized needs prevent this branch
            raise ValueError(f"unsupported ticker context need {spec.field}")
        return _envelope(
            loaded.value,
            spec=spec,
            as_of=loaded.as_of,
            source_updated_at=loaded.source_updated_at,
            source=loaded.source or spec.source,
            stale_after_seconds=loaded.stale_after_seconds,
            is_demo=loaded.is_demo,
        )

    async def _load_quote(self, symbol: str, spec: FactSpec) -> LoadedFact:
        from services.market import fetch_quote

        quote = await fetch_quote(symbol)
        return LoadedFact(
            value=quote,
            as_of=_coerce_datetime(quote.timestamp),
            source="demo" if quote.is_demo else spec.source,
            is_demo=bool(quote.is_demo),
        )

    async def _load_options_summary(self, symbol: str, spec: FactSpec) -> LoadedFact:
        from services.options import fetch_chain, fetch_iv_analysis

        iv, chain = await asyncio.gather(
            fetch_iv_analysis(symbol),
            fetch_chain(symbol),
        )
        fetched_at = max(
            [dt for dt in [_coerce_datetime(iv.fetched_at), _coerce_datetime(chain.fetched_at)] if dt],
            default=_now(),
        )
        value = {
            "symbol": symbol,
            "spot_price": chain.spot_price,
            "expirations": [exp.isoformat() for exp in chain.expirations],
            "contract_count": len(chain.contracts),
            "current_iv": iv.current_iv,
            "iv_rank": iv.iv_rank,
            "iv_percentile": iv.iv_percentile,
            "hv_20": iv.hv_20,
            "hv_50": iv.hv_50,
            "hv_100": iv.hv_100,
            "iv_skew": iv.iv_skew,
            "term_structure": iv.term_structure,
            "chain_is_demo": bool(chain.is_demo),
            "iv_is_demo": bool(iv.is_demo),
        }
        return LoadedFact(
            value=value,
            as_of=fetched_at,
            source="demo" if chain.is_demo or iv.is_demo else spec.source,
            is_demo=bool(chain.is_demo or iv.is_demo),
        )

    async def _load_earnings(self, symbol: str, spec: FactSpec) -> LoadedFact:
        from services import earnings_screener

        meta = await earnings_screener._load_earnings_meta(symbol)
        if not meta:
            raise ValueError(f"no current earnings metadata for {symbol}")
        await self._persist_profile_from_earnings_meta(symbol, meta)
        as_of = _coerce_datetime(meta.get("report_date"))
        return LoadedFact(value=meta, as_of=as_of, source=spec.source)

    async def _persist_profile_from_earnings_meta(self, symbol: str, meta: dict[str, Any]) -> None:
        if settings.SKIP_DB_INIT:
            return
        try:
            from sqlalchemy import select
            from data.storage.models import TickerProfile

            async def _write(session: Any) -> None:
                profile = (
                    await session.execute(
                        select(TickerProfile).where(TickerProfile.symbol == symbol)
                    )
                ).scalar_one_or_none()
                fields = {
                    "name": meta.get("company"),
                    "sector": meta.get("sector"),
                    "observed_at": _now(),
                }
                if profile is None:
                    session.add(TickerProfile(symbol=symbol, **fields))
                else:
                    for key, val in fields.items():
                        if val is not None:
                            setattr(profile, key, val)

            if self._db is not None:
                await _write(self._db)
                await self._db.flush()
                return

            from core.database import _get_session_factory

            factory = _get_session_factory()
            async with factory() as session:
                await _write(session)
                await session.commit()
        except Exception:
            logger.debug("ticker profile persistence failed for %s", symbol, exc_info=True)

    async def _load_research(self, symbol: str, spec: FactSpec) -> LoadedFact:
        persisted = await self._load_latest_research_fact(symbol, spec)
        if persisted is None:
            raise ValueError(f"no reusable research fact for {symbol}")
        return LoadedFact(
            value=persisted.value,
            as_of=persisted.freshness.as_of,
            source_updated_at=persisted.freshness.source_updated_at,
            source=persisted.freshness.source,
            stale_after_seconds=None,
            is_demo=persisted.freshness.is_demo,
        )

    async def _load_latest_research_fact(self, symbol: str, spec: FactSpec) -> FactEnvelope | None:
        if settings.SKIP_DB_INIT:
            return None
        try:
            from sqlalchemy import desc, select
            from data.storage.models import TickerFact

            async def _query(session: Any) -> FactEnvelope | None:
                stmt = (
                    select(TickerFact)
                    .where(
                        TickerFact.symbol == symbol,
                        TickerFact.namespace == "research",
                        TickerFact.key == "tradingagents_latest",
                    )
                    .order_by(desc(TickerFact.as_of), desc(TickerFact.observed_at), desc(TickerFact.id))
                    .limit(1)
                )
                row = (await session.execute(stmt)).scalar_one_or_none()
                if row is None:
                    return None
                return _envelope(
                    row.value,
                    spec=spec,
                    observed_at=_coerce_datetime(row.observed_at),
                    as_of=_coerce_datetime(row.as_of),
                    source_updated_at=_coerce_datetime(row.source_updated_at),
                    expires_at=None,
                    stale_after_seconds=None,
                    source=row.source,
                    is_demo=bool(row.is_demo),
                    quality=str(row.quality or "fresh"),  # type: ignore[arg-type]
                )

            if self._db is not None:
                return await _query(self._db)
            from core.database import _get_session_factory

            factory = _get_session_factory()
            async with factory() as session:
                return await _query(session)
        except Exception:
            logger.debug("latest research fact read failed", exc_info=True)
            return None

    async def _load_news(self, symbol: str, spec: FactSpec) -> LoadedFact:
        from services.news import fetch_symbol_news

        news = await fetch_symbol_news(symbol, limit=5)
        return LoadedFact(
            value=news,
            as_of=_now(),
            source="demo" if news.is_demo else spec.source,
            is_demo=bool(news.is_demo),
        )

    async def _load_market_regime(self, symbol: str, spec: FactSpec) -> LoadedFact:
        _ = symbol
        from services import earnings_screener

        regime = await earnings_screener._load_market_regime()
        return LoadedFact(value={"summary": regime}, as_of=_now(), source=spec.source)


async def get_ticker_context(
    symbols: list[str],
    *,
    needs: list[str] | None = None,
    max_age_seconds: int | None = None,
    on_stale: OnStale = "allow_with_warning",
) -> TickerContextResponse:
    return await TickerContextService().get_many(
        symbols,
        needs=needs,
        max_age_seconds=max_age_seconds,
        on_stale=on_stale,
    )


async def get_ticker_fact(
    symbol: str,
    need: str,
    *,
    max_age_seconds: int | None = None,
    on_stale: OnStale = "allow_with_warning",
) -> FactEnvelope:
    service = TickerContextService()
    context = await service.get(
        symbol,
        needs=[need],
        max_age_seconds=max_age_seconds,
        on_stale=on_stale,
    )
    envelope = getattr(context, _FACT_SPECS[_normalize_need(need)].field)
    if envelope is None:
        return _unavailable(_FACT_SPECS[_normalize_need(need)])
    return envelope


async def get_custom_ticker_fact(
    symbol: str,
    *,
    namespace: str,
    key: str,
    source: str,
    stale_after_seconds: int | None,
    loader: Callable[[], Awaitable[LoadedFact | Any]],
    max_age_seconds: int | None = None,
    on_stale: OnStale = "allow_with_warning",
) -> FactEnvelope:
    spec = FactSpec(
        field=f"{namespace}.{key}",
        namespace=namespace,
        key=key,
        source=source,
        stale_after_seconds=stale_after_seconds,
    )
    envelope, _ = await TickerContextService().get_or_refresh_custom_fact(
        symbol,
        spec,
        loader,
        max_age_seconds=max_age_seconds,
        on_stale=on_stale,
    )
    return envelope


async def persist_custom_ticker_fact(
    symbol: str,
    *,
    namespace: str,
    key: str,
    value: Any,
    source: str,
    as_of: datetime | None = None,
    source_ref: str | None = None,
    stale_after_seconds: int | None = None,
    is_demo: bool = False,
) -> None:
    """Best-effort direct write for facts produced outside TickerContextService."""
    if settings.SKIP_DB_INIT or is_demo:
        return
    try:
        from data.storage.models import TickerFact

        symbol = _normalize_symbol(symbol)
        observed_at = _now()
        fact = TickerFact(
            symbol=symbol,
            namespace=namespace,
            key=key,
            value=_jsonable(value),
            source=source,
            source_ref=source_ref,
            as_of=as_of,
            observed_at=observed_at,
            source_updated_at=observed_at,
            expires_at=None,
            stale_after_seconds=stale_after_seconds,
            quality="fresh",
            is_demo=False,
            schema_version=_SCHEMA_VERSION,
            lineage_hash=_lineage_hash(value, as_of=as_of, source=source),
        )
        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as session:
            session.add(fact)
            await session.commit()
    except Exception:
        logger.debug("custom ticker fact persistence failed", exc_info=True)


async def persist_tradingagents_research(username: str, record: dict[str, Any]) -> None:
    """Persist a completed TradingAgents run as reusable ticker research.

    This helper is best-effort by design. The TradingAgents UI should not fail
    because the central fact store is temporarily unavailable.
    """
    if settings.SKIP_DB_INIT or record.get("status") != "succeeded":
        return
    try:
        from sqlalchemy import select
        from data.storage.models import TickerFact, TickerResearchRun
        from services.tradingagents_research import ADVISORY_DISCLAIMER

        symbol = _normalize_symbol(str(record.get("symbol") or ""))
        completed_at = _coerce_datetime(record.get("completed_at")) or _now()
        value = {
            "run_id": record.get("run_id"),
            "symbol": symbol,
            "trade_date": record.get("trade_date"),
            "provider": record.get("provider"),
            "deep_model": record.get("deep_model"),
            "quick_model": record.get("quick_model"),
            "analysts": record.get("analysts") or [],
            "research_depth": record.get("research_depth"),
            "summary_lines": record.get("summary_lines") or [],
            "decision_text": record.get("decision_text"),
            "artifact_files": record.get("artifact_files") or [],
            "completed_at": completed_at.isoformat(),
            "advisory_disclaimer": ADVISORY_DISCLAIMER,
        }

        async def _write(session: Any) -> None:
            existing = (
                await session.execute(
                    select(TickerResearchRun).where(TickerResearchRun.run_id == str(record.get("run_id")))
                )
            ).scalar_one_or_none()
            fields = {
                "symbol": symbol,
                "username": username,
                "status": "succeeded",
                "provider": record.get("provider"),
                "deep_model": record.get("deep_model"),
                "quick_model": record.get("quick_model"),
                "analysts": _jsonable(record.get("analysts") or []),
                "research_depth": record.get("research_depth"),
                "trade_date": date.fromisoformat(str(record["trade_date"])) if record.get("trade_date") else None,
                "summary_lines": _jsonable(record.get("summary_lines") or []),
                "decision_text": record.get("decision_text"),
                "artifact_files": _jsonable(record.get("artifact_files") or []),
                "request_payload": _jsonable(record),
                "error": _jsonable(record.get("error")),
                "created_at": _coerce_datetime(record.get("created_at")),
                "started_at": _coerce_datetime(record.get("started_at")),
                "completed_at": completed_at,
                "updated_at": _coerce_datetime(record.get("updated_at")),
            }
            if existing is None:
                session.add(TickerResearchRun(run_id=str(record.get("run_id")), **fields))
            else:
                for key, val in fields.items():
                    setattr(existing, key, val)

            fact_ref = str(record.get("run_id"))
            fact = (
                await session.execute(
                    select(TickerFact).where(
                        TickerFact.source == "tradingagents",
                        TickerFact.source_ref == fact_ref,
                        TickerFact.namespace == "research",
                        TickerFact.key == "tradingagents_latest",
                    )
                )
            ).scalar_one_or_none()
            fact_fields = {
                "symbol": symbol,
                "namespace": "research",
                "key": "tradingagents_latest",
                "value": _jsonable(value),
                "source": "tradingagents",
                "source_ref": fact_ref,
                "as_of": completed_at,
                "observed_at": completed_at,
                "source_updated_at": completed_at,
                "expires_at": None,
                "stale_after_seconds": None,
                "quality": "fresh",
                "is_demo": False,
                "schema_version": _SCHEMA_VERSION,
                "lineage_hash": _lineage_hash(value, as_of=completed_at, source="tradingagents"),
            }
            if fact is None:
                session.add(TickerFact(**fact_fields))
            else:
                for key, val in fact_fields.items():
                    setattr(fact, key, val)

        from core.database import _get_session_factory

        factory = _get_session_factory()
        async with factory() as session:
            await _write(session)
            await session.commit()
    except Exception:
        logger.debug("TradingAgents research persistence failed", exc_info=True)
