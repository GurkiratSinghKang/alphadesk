"""Admin-controlled runtime configuration.

Persists key/value pairs in the ``app_config`` table (see Alembic
``0017_app_config``) for two use cases:

1. **Backend keys** — ``ANTHROPIC_API_KEY``, ``FMP_API_KEY``,
   ``ALPACA_API_KEY``, ``OPENAI_API_KEY``, etc. Stored encrypted via
   :mod:`core.crypto`. The admin Control Center can rotate keys at
   runtime without an env redeploy.

2. **UI layout configuration** — JSON blob describing which dashboard
   sections are visible and their display order. Read by the frontend
   at mount; mutated only by the admin Control Center.

The store is **admin-only**. Routes that mutate this table sit behind
``require_admin``. A small in-process cache backs the read path so the
hot dashboard render doesn't hit Postgres on every request; the cache
is invalidated whenever a write goes through.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy import text

from core.crypto import encrypt_secret, decrypt_secret

logger = logging.getLogger("alphadesk.services.app_config")

# Cache TTL — 60s is long enough to cushion bursts without making
# rotated keys feel sticky to the operator.
_CACHE_TTL_SEC = 60.0
_cache: dict[str, tuple[float, Any]] = {}
_cache_lock = asyncio.Lock()


# --------------------------------------------------------------------- #
# Layout config — shape contract                                         #
# --------------------------------------------------------------------- #

# IDs of the dashboard sections that the admin can hide / reorder.
# The frontend renders each section iff it's listed in the layout
# config with ``visible: true``, ordered by ``order`` ascending. Adding
# a new toggleable section is a one-line change here + a one-line
# wrapper in the dashboard JSX (see frontend/src/app/(dashboard)/page.tsx).
SUPPORTED_DASHBOARD_SECTIONS: tuple[str, ...] = (
    # IDs map to wrappers in frontend/src/app/(dashboard)/page.tsx —
    # adding a new entry here also requires wrapping the matching JSX
    # block in <ConfigurableSection id="..."> for the toggle to take
    # effect.
    "decision_queue",
    "risk_escalation",
    "portfolio_canvas",
    "risk_panel",
    "audit_trail",
    "session_snapshot",
    "strategy_panel",
)


def _default_layout_config() -> dict[str, Any]:
    """Fresh-install layout: every supported section visible, in
    declaration order."""
    return {
        "dashboard_sections": [
            {"id": sid, "visible": True, "order": idx}
            for idx, sid in enumerate(SUPPORTED_DASHBOARD_SECTIONS)
        ],
        "version": 1,
    }


# --------------------------------------------------------------------- #
# Backend keys — what the admin can rotate                               #
# --------------------------------------------------------------------- #

# These are the keys the Control Center surfaces in the "Backend keys"
# panel. Each entry maps the friendly label the UI shows → the
# canonical config key written to the app_config table. Only this
# allow-list is rotatable from the UI; anything else stays env-only.
SUPPORTED_BACKEND_KEYS: dict[str, str] = {
    "AI provider API key": "ANTHROPIC_API_KEY",
    "FMP API key": "FMP_API_KEY",
    "Alpaca API key": "ALPACA_API_KEY",
    "Alpaca API secret": "ALPACA_API_SECRET",
    "OpenAI API key": "OPENAI_API_KEY",
    "Polygon API key": "POLYGON_API_KEY",
}


def _mask(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return value[:4] + "•" * (len(value) - 8) + value[-4:]


# --------------------------------------------------------------------- #
# Storage primitives                                                     #
# --------------------------------------------------------------------- #


async def _read_raw(key: str) -> tuple[str | None, bool]:
    """Return ``(value_json, encrypted)`` for ``key`` or ``(None, False)``."""
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        result = await session.execute(
            text("SELECT value_json, encrypted FROM app_config WHERE key = :k"),
            {"k": key},
        )
        row = result.first()
        if not row:
            return None, False
        return row[0], bool(row[1])


async def _write_raw(
    key: str, value_json: str, *, encrypted: bool, actor: str | None
) -> None:
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                """
                INSERT INTO app_config (key, value_json, encrypted, updated_by)
                VALUES (:k, :v, :e, :a)
                ON CONFLICT (key) DO UPDATE
                SET value_json = EXCLUDED.value_json,
                    encrypted  = EXCLUDED.encrypted,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                """
            ),
            {"k": key, "v": value_json, "e": encrypted, "a": actor},
        )
        await session.commit()


async def _delete_raw(key: str) -> None:
    from core.database import _get_session_factory

    factory = _get_session_factory()
    async with factory() as session:
        await session.execute(
            text("DELETE FROM app_config WHERE key = :k"),
            {"k": key},
        )
        await session.commit()


# --------------------------------------------------------------------- #
# Backend keys API                                                        #
# --------------------------------------------------------------------- #


async def get_backend_key(key: str) -> str | None:
    """Return the plaintext key value if set, else ``None``.

    The value is decrypted on read. Callers should treat the result as
    sensitive and never log it. Cache hits skip the decrypt round-trip.
    """
    if key not in SUPPORTED_BACKEND_KEYS.values():
        return None
    async with _cache_lock:
        cached = _cache.get(f"key:{key}")
        if cached and cached[0] > time.monotonic():
            return cached[1]
    raw, encrypted = await _read_raw(key)
    if raw is None:
        async with _cache_lock:
            _cache[f"key:{key}"] = (time.monotonic() + _CACHE_TTL_SEC, None)
        return None
    plaintext = decrypt_secret(raw) if encrypted else raw
    async with _cache_lock:
        _cache[f"key:{key}"] = (time.monotonic() + _CACHE_TTL_SEC, plaintext)
    return plaintext


async def set_backend_key(key: str, value: str, *, actor: str | None) -> None:
    if key not in SUPPORTED_BACKEND_KEYS.values():
        raise ValueError(f"unsupported backend key: {key!r}")
    if not isinstance(value, str) or not value.strip():
        raise ValueError("key value must be a non-empty string")
    ciphertext = encrypt_secret(value)
    await _write_raw(key, ciphertext, encrypted=True, actor=actor)
    async with _cache_lock:
        _cache.pop(f"key:{key}", None)
    logger.info(
        "Admin rotated backend key",
        extra={"key": key, "actor": actor, "value_len": len(value)},
    )


async def clear_backend_key(key: str, *, actor: str | None) -> None:
    if key not in SUPPORTED_BACKEND_KEYS.values():
        raise ValueError(f"unsupported backend key: {key!r}")
    await _delete_raw(key)
    async with _cache_lock:
        _cache.pop(f"key:{key}", None)
    logger.info(
        "Admin cleared backend key",
        extra={"key": key, "actor": actor},
    )


async def list_backend_keys() -> list[dict[str, Any]]:
    """Return masked status for every supported backend key.

    The plaintext is NEVER returned over the wire — only ``set: bool``
    and a masked preview ``masked: str`` (first/last 4 chars).
    """
    out: list[dict[str, Any]] = []
    for label, key in SUPPORTED_BACKEND_KEYS.items():
        plaintext = await get_backend_key(key)
        if plaintext:
            out.append(
                {
                    "label": label,
                    "key": key,
                    "set": True,
                    "masked": _mask(plaintext),
                }
            )
        else:
            out.append(
                {"label": label, "key": key, "set": False, "masked": ""}
            )
    return out


# --------------------------------------------------------------------- #
# Layout config API                                                       #
# --------------------------------------------------------------------- #

_LAYOUT_KEY = "layout_config"


def _normalize_layout(raw: dict[str, Any]) -> dict[str, Any]:
    """Coerce a stored layout payload into a clean shape.

    Drops unknown section IDs, fills missing supported sections (visible
    by default at the end), enforces a contiguous ``order`` sequence.
    """
    sections_in = raw.get("dashboard_sections") or []
    by_id: dict[str, dict[str, Any]] = {}
    for entry in sections_in:
        if not isinstance(entry, dict):
            continue
        sid = entry.get("id")
        if sid not in SUPPORTED_DASHBOARD_SECTIONS:
            continue
        by_id[sid] = {
            "id": sid,
            "visible": bool(entry.get("visible", True)),
            "order": int(entry.get("order", 999)),
        }
    next_order = max((e["order"] for e in by_id.values()), default=-1) + 1
    for sid in SUPPORTED_DASHBOARD_SECTIONS:
        if sid not in by_id:
            by_id[sid] = {"id": sid, "visible": True, "order": next_order}
            next_order += 1
    sections = sorted(by_id.values(), key=lambda e: e["order"])
    for idx, entry in enumerate(sections):
        entry["order"] = idx
    return {"dashboard_sections": sections, "version": 1}


async def get_layout_config() -> dict[str, Any]:
    async with _cache_lock:
        cached = _cache.get(_LAYOUT_KEY)
        if cached and cached[0] > time.monotonic():
            return cached[1]
    raw, _ = await _read_raw(_LAYOUT_KEY)
    if raw is None:
        config = _default_layout_config()
    else:
        try:
            config = _normalize_layout(json.loads(raw))
        except (json.JSONDecodeError, TypeError, ValueError):
            logger.warning(
                "app_config.layout_config parse failed — falling back to default",
                exc_info=True,
            )
            config = _default_layout_config()
    async with _cache_lock:
        _cache[_LAYOUT_KEY] = (time.monotonic() + _CACHE_TTL_SEC, config)
    return config


async def set_layout_config(
    config: dict[str, Any], *, actor: str | None
) -> dict[str, Any]:
    normalized = _normalize_layout(config)
    await _write_raw(
        _LAYOUT_KEY,
        json.dumps(normalized),
        encrypted=False,
        actor=actor,
    )
    async with _cache_lock:
        _cache.pop(_LAYOUT_KEY, None)
    logger.info(
        "Admin updated layout config",
        extra={"actor": actor, "sections": len(normalized["dashboard_sections"])},
    )
    return normalized
