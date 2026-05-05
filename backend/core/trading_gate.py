"""Centralized trading-gate enforcement (Wave A — bypass-path fix).

Persona-66/67/69 converged on a finding: the live-trading deny-gate created in
Wave 4/6 (``_reject_if_live_forbidden`` in ``backend/api/routes/trades.py``)
is only applied to ``POST /api/v1/trades/orders``. Every OTHER order-submission
path bypasses it:

* ``backend/agents/execution.py::ExecutionAgent.execute_trade``
* ``backend/data/ingestion/daily_pipeline.py::_place_order`` /
  ``_place_bracket_order``
* ``backend/data/ingestion/realtime_scanner.py::_execute_triggered_setup``
* ``backend/mcp_servers/broker/server.py::submit_order`` (zero gates)
* ``backend/api/routes/webhooks.py::_handle_trade_signal``

Plus the brittle ``"paper" in url`` substring check in three files is both
fragile (matches ``api.alpaca.markets/paper-trader-v3``-style hostnames the
attacker might point at) AND over-blocks (refuses live when live is the
INTENDED destination, with no operator override).

This module exposes:

* ``canonical_strategy_name(name)`` — moved from ``trades.py``. Allowlist over
  the strategy registry; raises ``ValueError`` on unknown names.
* ``reject_if_live_forbidden(strategy, *, caller)`` — the canonical gate. Used
  by both HTTP and non-HTTP call sites. In HTTP context it raises
  ``HTTPException``; in pipeline context it raises ``RuntimeError``. Callers
  pass a ``caller`` string for the audit log.
* ``assert_live_enabled_or_paper()`` — boot-time misconfig check. Raises if
  ``LIVE_TRADING_ENABLED=True`` but URL doesn't point at live, or if
  ``LIVE_TRADING_ENABLED=False`` but URL points at live.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Strategy canonicalisation (moved from trades.py)
# ---------------------------------------------------------------------------
#
# The frontend speaks hyphenated ids ("vrp-harvesting"); the registry uses
# underscore canonical names ("vrp_harvest"). ``STRATEGY_LIVE_DISABLED`` /
# ``STRATEGY_PAPER_ONLY`` in ``core.config`` are keyed on the canonical name,
# so we normalise the incoming ``strategy`` via this mapping before checking
# membership.
_STRATEGY_ID_TO_CANONICAL: dict[str, str] = {
    "momentum-quality": "momentum_quality",
    "pead": "pead",
    "vrp-harvesting": "vrp_harvest",
    "earnings-vol-premium": "earnings_vol",
    "regime-adaptive": "regime_adaptive",
    "ts-momentum": "ts_momentum",
    "rsi2-reversal": "rsi2_reversal",
    "dual-momentum": "dual_momentum",
    "pairs-trading": "pairs_trading",
    "pairs-stat-arb": "pairs_trading",
    "kama-breakout": "kama_breakout",
    "orb": "orb",
    "vwap-strategy": "vwap",
    # Round-5 F-1 — earnings-options-play deep-link strategy. The
    # frontend's TradeButtonRow tags every trade-button URL with this id
    # so reports/strategy-performance attributes correctly. Registered
    # here so the live-trading allowlist accepts the value; it lives in
    # STRATEGY_PAPER_ONLY (see core/config.py) as belt-and-suspenders
    # since the page is research-only.
    "earnings-options-play": "earnings_options_play",
    # Discretionary/manual order marker — explicit, gated-allowed.
    # Wave 5β required MCP callers to pass a non-None strategy; "manual"
    # is the canonical label for operator-submitted trades outside any
    # systematic strategy. Never in DENY/PAPER_ONLY sets.
    "manual": "manual",
    # Audit P2-1 (2026-05-05): newer strategies were missing from this
    # allowlist, so any order tagged with their hyphen-id was rejected
    # with a 400 ``unknown strategy`` response from ``canonical_strategy_name``.
    "sector-rotation": "sector_rotation",
    "claude-alpha": "claude_alpha",
    "vcp-breakout": "vcp_breakout",
    "gap-fill": "gap_fill",
    "dividend-capture": "dividend_capture",
    "mean-reversion": "mean_reversion",
}


#: Canonical underscore names that are legitimate strategy identifiers.
#: Derived once from the hyphen-id map so both forms stay in lock-step.
_STRATEGY_CANONICAL_NAMES: frozenset[str] = frozenset(
    _STRATEGY_ID_TO_CANONICAL.values()
)


def canonical_strategy_name(name: str | None) -> str | None:
    """Map any incoming strategy identifier to its canonical registry name.

    This is an **allowlist** (Wave 6 / A1#3 fix). Previously a permissive
    pass-through let a caller spoof ``strategy="orbx"`` past the live-trading
    deny-list. The new semantics:

    * ``None`` / blank → ``None`` (manual/discretionary order — callers
      decide how to treat it; the live-gate intentionally skips ``None``).
    * Hyphen-id in ``_STRATEGY_ID_TO_CANONICAL`` → mapped canonical name.
    * Canonical underscore name already in ``_STRATEGY_CANONICAL_NAMES``
      → returned unchanged.
    * Anything else → ``ValueError`` (translated to 400 at the edge).
    """
    if name is None:
        return None
    key = name.strip().lower().replace(" ", "-")
    if not key:
        return None
    if key in _STRATEGY_ID_TO_CANONICAL:
        return _STRATEGY_ID_TO_CANONICAL[key]
    if key in _STRATEGY_CANONICAL_NAMES:
        return key
    raise ValueError(f"unknown strategy: {key}")


# ---------------------------------------------------------------------------
# Live-gate enforcement
# ---------------------------------------------------------------------------

def _live_gate_blocks(strategy: str | None) -> tuple[bool, str | None, str | None]:
    """Decide whether the gate must reject and why.

    Returns ``(blocked, canonical, reason)``:

    * ``blocked`` — True when the call must be refused.
    * ``canonical`` — the canonical strategy name (or None for manual).
    * ``reason`` — short reason code for the audit log; one of
      ``"live_disabled"``, ``"paper_only"``, ``"unknown_strategy"`` or
      ``None`` when the call is allowed.

    Raises ``ValueError`` if ``canonical_strategy_name`` rejects the input.
    """
    canonical = canonical_strategy_name(strategy)
    if canonical is None:
        return False, None, None

    # Lazy imports keep this module safe to import in test contexts that
    # poke ``core.config.settings`` via monkeypatch.
    from core.config import (
        STRATEGY_LIVE_DISABLED,
        STRATEGY_PAPER_ONLY,
        is_live_alpaca_base_url,
        settings,
    )

    # The gate fires only when both conditions are true: the URL points at
    # the live broker AND the operator has opted into live (LIVE_TRADING_ENABLED).
    # An operator who flips the URL but forgets the env var (or vice versa)
    # falls into ``assert_live_enabled_or_paper`` instead, which raises a clear
    # misconfig error at boot.
    url_is_live = is_live_alpaca_base_url()
    env_allows_live = bool(getattr(settings, "LIVE_TRADING_ENABLED", False))

    # If either the URL or the env says "not live", the gate is inactive —
    # paper is unconditionally permitted for every strategy.
    if not (url_is_live and env_allows_live):
        return False, canonical, None

    if canonical in STRATEGY_LIVE_DISABLED:
        return True, canonical, "live_disabled"
    if canonical in STRATEGY_PAPER_ONLY:
        return True, canonical, "paper_only"
    return False, canonical, None


def _audit_reject(
    *,
    canonical: str | None,
    raw_strategy: str | None,
    caller: str,
    reason: str,
    username: str | None,
) -> None:
    """Emit a structured rejection log line AND persist to ``audit_log``.

    Wave 3K (persona-87 P1 #1): the Wave A "log-only" scope note is now
    obsolete — every rejection is also appended to the durable
    ``audit_log`` table via ``core.audit.write_audit`` so the compliance
    trail survives a container rotation.

    DB persistence is fire-and-forget: if this is called from a sync
    context (no running event loop) we skip the DB write and fall back
    to the log-only behaviour.  That matches the old semantics so
    regression risk is limited to callsites that were already inside
    ``asyncio.run()`` (none in the Wave A surface area — this helper is
    only reached from ``reject_if_live_forbidden``, which is itself
    invoked from inside async request handlers / ingestion tasks).
    """
    # 1. Always emit the structured log record first. ``logger.warning``
    #    is the same signal shape the existing Loki dashboards use, so
    #    we do NOT regress the current alerting.
    logger.warning(
        "live_gate_reject",
        extra={
            "strategy": canonical,
            "raw_strategy": raw_strategy,
            "caller": caller,
            "reason": reason,
            "username": username,
        },
    )

    # 2. Append to audit_log.  The live-gate is reached from async paths
    #    only; schedule the write on the running loop without awaiting
    #    it so the caller is not delayed on a DB round-trip.
    try:
        import asyncio

        from core.audit import write_audit
        from core.logging import REQUEST_ID

        rid = REQUEST_ID.get()
        request_id = rid if rid and rid != "-" else None

        coro = write_audit(
            "live_gate_reject",
            username=username,
            ip=None,
            request_id=request_id,
            details={
                "strategy": canonical,
                "raw_strategy": raw_strategy,
                "caller": caller,
                "reason": reason,
            },
        )

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            # No running loop — caller is in sync context (unusual for
            # this module). Drop the DB write; the structured log line
            # above is still queryable in the aggregator.
            coro.close()
        else:
            # Audit P3-5 (2026-05-05): the previous code did
            # ``loop.create_task(coro)`` and discarded the Task. Python's
            # GC may collect the Task before it completes (per asyncio
            # docs warning), and any exception raised inside the coro
            # is silently absorbed. Retain the Task on the module-level
            # set so the GC keeps it alive, and attach a done-callback
            # that surfaces failures at ERROR level instead of swallowing.
            task = loop.create_task(coro)
            _AUDIT_PENDING_TASKS.add(task)
            task.add_done_callback(_handle_audit_task_done)
    except Exception:
        # Never allow the audit path to mask the real rejection.
        logger.debug("live_gate audit persistence failed", exc_info=True)


# Set of in-flight audit-write tasks. Prevents asyncio.Task GC and lets
# the done-callback surface failures.
_AUDIT_PENDING_TASKS: set[Any] = set()


def _handle_audit_task_done(task: Any) -> None:
    _AUDIT_PENDING_TASKS.discard(task)
    exc = task.exception()
    if exc is not None:
        logger.error(
            "live_gate audit DB write failed silently — "
            "compliance row may be missing",
            exc_info=exc,
        )


def reject_if_live_forbidden(
    strategy: str | None,
    *,
    caller: str,
    username: str | None = None,
    http_context: bool = True,
) -> None:
    """Reject an order whose strategy is on the live deny/paper-only list.

    Behaviour:

    * Manual / discretionary orders (``strategy=None`` or blank) bypass the
      gate but log an INFO line for the audit trail.
    * Unknown strategy names raise 400 (HTTP) / ``RuntimeError`` (non-HTTP) —
      fail-closed. Persona-66 explicitly called out the previous silent
      pass-through as the most exploitable sub-bypass.
    * Strategies on ``STRATEGY_LIVE_DISABLED`` raise 422.
    * Strategies on ``STRATEGY_PAPER_ONLY`` raise 422.

    ``caller`` is a short identifier for the call site (e.g.
    ``"trades.create_order"``, ``"daily_pipeline._place_order"``). It lands
    in the structured audit log so we can correlate rejections to bypass
    paths during a postmortem.

    ``http_context`` defaults to True. Set False for non-HTTP entry points
    (the daily pipeline, scanners, MCP server) so the function raises a
    plain ``RuntimeError`` the caller can trap without dragging FastAPI in.
    """
    try:
        blocked, canonical, reason = _live_gate_blocks(strategy)
    except ValueError as exc:
        _audit_reject(
            canonical=None,
            raw_strategy=strategy,
            caller=caller,
            reason="unknown_strategy",
            username=username,
        )
        if http_context:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail=str(exc)) from exc
        raise RuntimeError(f"live_gate: {exc}") from exc

    if canonical is None and not blocked:
        logger.info(
            "live-gate: skipping strategy allowlist check (strategy=None, "
            "manual/discretionary order, caller=%s)",
            caller,
        )
        return

    if not blocked:
        return

    detail = _format_reject_detail(canonical, reason)
    _audit_reject(
        canonical=canonical,
        raw_strategy=strategy,
        caller=caller,
        reason=reason or "blocked",
        username=username,
    )

    if http_context:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail=detail)
    raise RuntimeError(f"live_gate: {detail}")


def _format_reject_detail(canonical: str | None, reason: str | None) -> str:
    """Turn the (canonical, reason) tuple into the user-visible error detail."""
    if reason == "live_disabled":
        return (
            f"Strategy '{canonical}' is on the live-trading denylist "
            "(NOT-READY for live capital — see "
            "audit-reports/00-strategy-experts-consolidation.md §4). "
            "Route this order to the Alpaca paper endpoint instead."
        )
    if reason == "paper_only":
        return (
            f"Strategy '{canonical}' is on the paper-only denylist until a longer OOS "
            "window confirms statistical significance (see "
            "audit-reports/00-strategy-experts-consolidation.md §4). "
            "Route this order to the Alpaca paper endpoint instead."
        )
    return f"Strategy '{canonical}' is not allowed for live trading."


# ---------------------------------------------------------------------------
# Boot-time misconfig check
# ---------------------------------------------------------------------------

def assert_live_enabled_or_paper() -> None:
    """Refuse to boot when ``LIVE_TRADING_ENABLED`` and ``ALPACA_BASE_URL``
    disagree.

    Two failure modes we want to make impossible:

    1. ``LIVE_TRADING_ENABLED=True`` + URL is paper → operator believes live
       is on but every order flows to paper. False sense of "we shipped".
    2. ``LIVE_TRADING_ENABLED=False`` + URL is live → operator believes the
       killswitch is on but the URL still routes to live. Every order from a
       gated bypass path lands at the live broker.

    Raised at startup so a fresh deploy fails loudly instead of silently
    routing wrong.
    """
    from core.config import is_live_alpaca_base_url, settings

    url_is_live = is_live_alpaca_base_url()
    env_allows_live = bool(getattr(settings, "LIVE_TRADING_ENABLED", False))

    if env_allows_live and not url_is_live:
        raise RuntimeError(
            "Misconfig: LIVE_TRADING_ENABLED=True but ALPACA_BASE_URL "
            f"({settings.ALPACA_BASE_URL!r}) does not point at the live broker. "
            "Either set ALPACA_BASE_URL=https://api.alpaca.markets or unset "
            "LIVE_TRADING_ENABLED."
        )
    if url_is_live and not env_allows_live:
        raise RuntimeError(
            "Misconfig: ALPACA_BASE_URL points at the live Alpaca endpoint "
            f"({settings.ALPACA_BASE_URL!r}) but LIVE_TRADING_ENABLED=False. "
            "Set LIVE_TRADING_ENABLED=true to confirm intent, or switch the URL "
            "back to https://paper-api.alpaca.markets."
        )


__all__ = [
    "canonical_strategy_name",
    "reject_if_live_forbidden",
    "assert_live_enabled_or_paper",
    "_STRATEGY_ID_TO_CANONICAL",
]
