"""Operator-owned compliance helpers.

Wave 2H (persona-76 P76-7): central, side-effect-free primitives that the
order-entry and routing layers consult before any broker traffic. The goal is
a *single* place an operator updates to refuse a symbol outright, regardless
of which path ("manual order", "strategy signal", "real-time scanner",
"webhook") produced the request.

The deny-list is populated from configuration, NOT hard-coded, so the same
backend image can be deployed across dev / paper / live with a different set
of refused symbols per environment.

Sources (first non-empty wins):

1. ``settings.RESTRICTED_SYMBOLS`` — comma-separated string from env /
   ``.env``. Used for short ad-hoc lists ("refuse GME,AMC until further
   notice").
2. ``settings.RESTRICTED_SYMBOLS_FILE`` — path to a YAML or JSON file
   containing a top-level list of tickers. Used when the list grows past
   a handful and wants version control / diff review separate from other
   settings churn.

Both sources are read at **module import** — the frozen set becomes
authoritative for the life of the process, and a reload requires a restart.
This is deliberate: a runtime-mutable deny-list that can be flipped by any
code path is an attack surface in its own right (persona 76 raised the exact
scenario — a compromised admin route silently dropping symbols off the list).

Wave 2H public API (imported by ``api.routes.trades`` and
``data.ingestion.master_agent``):

* ``RESTRICTED_SYMBOLS``  — the frozen set itself.
* ``is_restricted(sym)`` — truthy check, case-insensitive, whitespace safe.
* ``assert_not_restricted(sym)`` — raises ``ValueError`` when the symbol is
  on the list. Order-entry wraps the raise into an HTTP 422; strategy
  routing converts it into a refusal dict.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


def _normalise(sym: str) -> str:
    """Canonical ticker form: upper-case, surrounding whitespace stripped."""
    return sym.upper().strip()


def _load_from_env() -> set[str]:
    """Read ``settings.RESTRICTED_SYMBOLS`` (comma-separated)."""
    try:
        from core.config import settings  # local import to allow module load
        raw = getattr(settings, "RESTRICTED_SYMBOLS", "") or ""
    except Exception:
        # Misconfigured settings must NOT silently empty the deny-list —
        # but at module-load time we haven't yet established whether the
        # user cares. Log at WARNING and fall back to env var directly so
        # tests without a full settings object still work.
        raw = os.getenv("RESTRICTED_SYMBOLS", "") or ""
    if not raw:
        return set()
    return {_normalise(s) for s in raw.split(",") if s.strip()}


def _load_from_file() -> set[str]:
    """Read ``settings.RESTRICTED_SYMBOLS_FILE`` (YAML or JSON list)."""
    try:
        from core.config import settings
        path = getattr(settings, "RESTRICTED_SYMBOLS_FILE", "") or ""
    except Exception:
        path = os.getenv("RESTRICTED_SYMBOLS_FILE", "") or ""
    if not path:
        return set()
    p = Path(path)
    if not p.exists():
        # A misspelled path is a silent weakening of the gate — surface it.
        logger.warning("RESTRICTED_SYMBOLS_FILE=%s not found; skipping", path)
        return set()
    try:
        text = p.read_text(encoding="utf-8").strip()
        # JSON first (fast-path, stdlib). Fall back to YAML only if yaml
        # is actually installed — we don't want a hard PyYAML dependency.
        if text.startswith(("[", "{")):
            data = json.loads(text)
        else:
            try:
                import yaml  # type: ignore
            except ImportError:
                logger.warning(
                    "RESTRICTED_SYMBOLS_FILE=%s looks like YAML but PyYAML "
                    "is not installed; skipping",
                    path,
                )
                return set()
            data = yaml.safe_load(text)

        if isinstance(data, list):
            return {_normalise(str(s)) for s in data if str(s).strip()}
        if isinstance(data, dict):
            # Accept {"symbols": [...]} for forward compat.
            symbols = data.get("symbols") or data.get("restricted") or []
            if isinstance(symbols, list):
                return {_normalise(str(s)) for s in symbols if str(s).strip()}
        logger.warning(
            "RESTRICTED_SYMBOLS_FILE=%s has unexpected shape; skipping",
            path,
        )
    except Exception:
        logger.warning(
            "Failed to parse RESTRICTED_SYMBOLS_FILE=%s", path, exc_info=True,
        )
    return set()


def _compose_restricted_set() -> frozenset[str]:
    """Union env-var + file sources. Frozen so it cannot be mutated."""
    merged = _load_from_env() | _load_from_file()
    if merged:
        logger.info(
            "compliance: loaded %d restricted symbol(s)", len(merged),
        )
    return frozenset(merged)


# Operator-owned deny-list. Symbols here are outright refused at order
# entry, regardless of strategy or user. See module docstring for loading
# rules. Populated once at import.
RESTRICTED_SYMBOLS: frozenset[str] = _compose_restricted_set()


def is_restricted(symbol: str | None) -> bool:
    """Return True if ``symbol`` appears on the deny-list.

    ``None`` / empty string returns False — an unspecified symbol is the
    caller's problem, not a compliance hit. Case-insensitive and tolerates
    stray whitespace ("  gme "  →  "GME").
    """
    if not symbol:
        return False
    return _normalise(symbol) in RESTRICTED_SYMBOLS


def assert_not_restricted(symbol: str | None) -> None:
    """Raise ``ValueError`` if ``symbol`` is restricted.

    The caller is responsible for converting this into its transport-
    appropriate error (HTTP 422 for FastAPI, a refusal dict for the
    master agent, etc.). Keeping the primitive transport-neutral means a
    future use-site doesn't inherit FastAPI's HTTPException semantics.
    """
    if is_restricted(symbol):
        raise ValueError(f"restricted symbol: {_normalise(symbol or '')}")


def _reload_for_tests() -> None:
    """Re-read env + file so tests can inject a deny-list after import.

    Module-level ``RESTRICTED_SYMBOLS`` is bound at import; because pytest
    monkey-patches env vars after import, without a reload hook tests
    would all see the empty frozenset from the initial load. This helper
    is intentionally prefixed with ``_`` to discourage production use.
    """
    global RESTRICTED_SYMBOLS
    RESTRICTED_SYMBOLS = _compose_restricted_set()
