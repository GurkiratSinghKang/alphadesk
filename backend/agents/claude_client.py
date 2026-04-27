"""Lightweight async Claude client used by services that want a raw
``(system, user)`` → text completion without the full ``BaseAgent`` machinery.

``BaseAgent`` is purpose-built for multi-iteration tool loops with PII
scrubbing, CLI/API fallback, and conversation history. Services that
simply want to issue a single structured-JSON completion (e.g. the
earnings-options-play aggregator's Claude tiers) should use this thinner
client instead — it:

  * Uses the Anthropic API directly (no CLI subprocess).
  * Respects the same concurrency ceiling as ``BaseAgent`` so a burst of
    completions can't blow past provider rate limits.
  * Maps short model aliases (``opus``/``sonnet``/``haiku``) to the
    current (2026) API model IDs.
  * Emits a structured ``claude_call`` log line per completion with
    token counts + USD cost so SRE / finance can trace spend.

# Round-5 Cluster D H-2: daily spend kill-switch
# ----------------------------------------------
# Per-IP rate limits cap individual abuse but do nothing about the
# cross-user case (5 compromised JWTs × 5 IPs each). This module tracks
# total spend in Redis under ``claude:spend:{utc_date}`` and refuses
# new calls once the configured ceiling is breached. Costs are
# estimated up-front (so we can refuse BEFORE paying) and reconciled
# against actual usage afterwards.
#
# To halt all Claude spend immediately without redeploying:
#   SET claude:spend:{date} 999999
# (this sets the day's accumulator above any plausible budget so every
# subsequent call is rejected; entry expires at end-of-day TTL)
#
# Disable via CLAUDE_BUDGET_KILL_SWITCH_ENABLED=False if a misbehaving
# tracker (Redis outage etc.) is causing false positives. The cost
# estimator is intentionally conservative so the gate errs toward
# refusing borderline calls — false positives are an annoying dialog,
# false negatives are an infinite Anthropic invoice.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from agents.base import _CLAUDE_SEMAPHORE
from core.config import settings

logger = logging.getLogger(__name__)


_MODEL_MAP = {
    "opus": "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-7",
    "haiku": "claude-haiku-4-7",
}


# Default per-call timeout in seconds. The anthropic SDK's own default is
# ~600 s which is useless for a user-facing request — a hung Anthropic
# endpoint would hold a _CLAUDE_SEMAPHORE slot for ten minutes and starve
# all other Claude callers. We cap at 60 s so a degraded upstream fails
# fast; callers that genuinely need longer can pass an explicit timeout
# to ``complete()``.
_DEFAULT_TIMEOUT_S = 60.0


class ClaudeTimeoutError(TimeoutError):
    """Raised when a Claude completion exceeds its per-call timeout.

    Subclass of ``TimeoutError`` so existing broad-except handlers keep
    working, while still letting callers distinguish Claude timeouts from
    other upstream timeouts."""


# USD per-1M-token list prices as of 2026-04. Kept here rather than in
# core/config so the pricing change is reviewed as a code change (audit
# trail for finance) rather than an env flip.
_MODEL_PRICING_PER_1M: dict[str, tuple[float, float]] = {
    # (input_usd_per_1m, output_usd_per_1m)
    "claude-opus-4-7":   (15.00, 75.00),
    "claude-sonnet-4-7": ( 3.00, 15.00),
    "claude-haiku-4-7":  ( 0.80,  4.00),
}
_FALLBACK_PRICING = (15.00, 75.00)  # conservative overestimate for unknown models


def _estimate_cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Return USD cost estimate for a single Claude call. Unknown models
    fall back to Opus pricing so a forgotten-to-update table over-reports
    rather than under-reports (safer for budget alerts)."""
    in_rate, out_rate = _MODEL_PRICING_PER_1M.get(model, _FALLBACK_PRICING)
    return round(
        input_tokens * in_rate / 1_000_000
        + output_tokens * out_rate / 1_000_000,
        6,
    )


class ClaudeBudgetExceeded(RuntimeError):
    """Raised when the daily Claude spend kill-switch refuses a call.

    Round-5 Cluster D H-2. Callers catch this distinct from the generic
    Anthropic API errors so they can surface a budget-specific UX
    message ("Claude paused for cost; resumes at UTC midnight") instead
    of a generic outage banner.
    """


def _today_spend_key() -> str:
    """Redis key for today's accumulated Claude spend (UTC date)."""
    return f"claude:spend:{datetime.now(timezone.utc).date().isoformat()}"


async def _record_spend_estimate(estimate: float) -> float:
    """INCRBYFLOAT today's spend by ``estimate`` and return the running total.

    The Redis path is best-effort — a Redis outage shouldn't block real
    Claude calls. On failure we log and return 0.0 so the caller falls
    through to the API (the kill-switch fails open, which is the safer
    behaviour for a paid service: errors should not silently halt
    workflow). The kill-switch is opt-in via
    ``settings.CLAUDE_BUDGET_KILL_SWITCH_ENABLED``.
    """
    try:
        from core.redis import get_redis

        r = await get_redis()
        key = _today_spend_key()
        new_total = await r.incrbyfloat(key, estimate)
        # 26h TTL — covers the day with a 2h grace so a deploy near
        # midnight can't accidentally double-count.
        await r.expire(key, 26 * 3600)
        return float(new_total)
    except Exception as e:
        logger.warning("claude budget tracker unavailable: %s", e)
        # Round-17 / persona-11 P0: pre-fix returned 0.0, which made
        # ``running_total > limit`` always false on Redis-down — i.e.
        # the kill-switch fails OPEN. When kill-switch is enabled, a
        # Redis flap means runaway prompt loops can burn the budget
        # with no in-band stop. Surface a sentinel that fails CLOSED
        # for the kill-switch path: returning ``inf`` makes the gate
        # always trip when the operator has explicitly opted in.
        if settings.CLAUDE_BUDGET_KILL_SWITCH_ENABLED:
            return float("inf")
        return 0.0


async def _reconcile_spend(estimate: float, actual: float) -> None:
    """Subtract the estimate, add the actual cost. Both are best-effort."""
    delta = actual - estimate
    if abs(delta) < 1e-9:
        return
    try:
        from core.redis import get_redis

        r = await get_redis()
        await r.incrbyfloat(_today_spend_key(), delta)
    except Exception as e:
        logger.warning("claude spend reconciliation failed: %s", e)


async def get_today_claude_spend_usd() -> float:
    """Return the running total of today's Claude spend in USD.

    Surfaced via ``/readyz-full`` (Round-5 Cluster D H-2) so operators
    can monitor cost without shelling into Redis.
    """
    try:
        from core.redis import get_redis

        r = await get_redis()
        raw = await r.get(_today_spend_key())
        if raw is None:
            return 0.0
        return float(raw)
    except Exception:
        return 0.0


class ClaudeClient:
    """Minimal async Claude wrapper exposing a single ``complete()`` method."""

    def __init__(self, api_key: str | None = None) -> None:
        key = api_key or settings.ANTHROPIC_API_KEY.get_secret_value()
        if not key:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is not configured; ClaudeClient unavailable"
            )
        import anthropic

        self._client = anthropic.AsyncAnthropic(api_key=key)

    async def complete(
        self,
        *,
        system: str,
        user: str,
        model: str = "claude-opus-4-7",
        max_tokens: int = 4096,
        context: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> str:
        """Issue a single completion; return the assistant's plain text.

        ``context`` is an optional dict of free-form fields (commonly
        ``symbol``, ``endpoint``, ``user_id``) that are included verbatim
        in the structured log emitted per call, so SRE / finance can
        attribute spend and trace which request drove which token burn.

        ``timeout`` defaults to :data:`_DEFAULT_TIMEOUT_S` (60 s). Pass
        a larger value for long prompts that legitimately need more
        server time; pass a smaller one for cheap upstream health probes.
        Exceeding the deadline raises :class:`ClaudeTimeoutError` and
        still emits a ``claude_call`` log event with ``status=timeout``.

        Round-5 Cluster D H-2: when the daily Claude spend (tracked in
        Redis under ``claude:spend:{utc_date}``) exceeds
        ``settings.CLAUDE_DAILY_BUDGET_USD`` AND the kill-switch is
        enabled, this raises :class:`ClaudeBudgetExceeded` BEFORE the
        Anthropic call fires. Conservative pre-call estimate is used
        for the gate; actual cost reconciles afterward.
        """
        resolved = _MODEL_MAP.get(model, model)
        t = _DEFAULT_TIMEOUT_S if timeout is None else float(timeout)

        # Round-5 Cluster D H-2: budget kill-switch BEFORE the API call.
        # The estimate is intentionally conservative (full max_tokens
        # × max output rate) so the gate errs toward refusing borderline
        # calls. Actual cost reconciles in the post-call branch below.
        # Failures of the spend tracker (Redis outage etc.) fall open —
        # ``_record_spend_estimate`` returns 0.0 so the gate doesn't
        # silently halt Claude on transient Redis blips.
        in_rate, out_rate = _MODEL_PRICING_PER_1M.get(resolved, _FALLBACK_PRICING)
        prompt_chars = len(system) + len(user)
        # ~4 chars/token approximation for the input estimate; output uses
        # max_tokens as the worst-case ceiling.
        estimated_input_tokens = max(1, prompt_chars // 4)
        pre_estimate_usd = (
            estimated_input_tokens * in_rate / 1_000_000
            + max_tokens * out_rate / 1_000_000
        )
        running_total = await _record_spend_estimate(pre_estimate_usd)
        if (
            settings.CLAUDE_BUDGET_KILL_SWITCH_ENABLED
            and running_total > settings.CLAUDE_DAILY_BUDGET_USD
        ):
            kill_ctx: dict[str, Any] = {
                "event": "claude_budget_kill_switch",
                "running_total_usd": running_total,
                "limit_usd": settings.CLAUDE_DAILY_BUDGET_USD,
                "model": resolved,
            }
            if context:
                for k, v in context.items():
                    kill_ctx.setdefault(k, v)
            logger.critical(
                "claude.budget_kill_switch.tripped",
                extra=kill_ctx,
            )
            # Reverse the estimate so a sustained refusal storm can't
            # accumulate spurious spend on top of the real number.
            await _reconcile_spend(pre_estimate_usd, 0.0)
            raise ClaudeBudgetExceeded(
                f"Claude daily budget exceeded "
                f"({running_total:.2f} > {settings.CLAUDE_DAILY_BUDGET_USD:.2f} USD)"
            )

        async with _CLAUDE_SEMAPHORE:
            try:
                # Round-17 / persona-11 + Round-21 cost: wrap the system
                # prompt in a ``cache_control: ephemeral`` block so the
                # second-and-subsequent call with the same system text
                # (typical for our structured-prompt builders) gets the
                # 90% input-token discount. ``str``-typed system fallback
                # for backwards compat — the Anthropic SDK accepts both.
                system_param: Any
                if isinstance(system, str) and system:
                    system_param = [
                        {
                            "type": "text",
                            "text": system,
                            "cache_control": {"type": "ephemeral"},
                        }
                    ]
                else:
                    system_param = system
                resp = await asyncio.wait_for(
                    self._client.messages.create(
                        model=resolved,
                        max_tokens=max_tokens,
                        system=system_param,
                        messages=[{"role": "user", "content": user}],
                    ),
                    timeout=t,
                )
            except asyncio.TimeoutError as exc:
                # Round-5 H-2: reverse the pre-call estimate on timeout —
                # we paid for input tokens (maybe) but the bill is
                # unknown, so 0.0 is the safer accounting choice.
                await _reconcile_spend(pre_estimate_usd, 0.0)
                log_ctx: dict[str, Any] = {
                    "event": "claude_call",
                    "model": resolved,
                    "max_tokens": max_tokens,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cost_usd": 0.0,
                    "status": "timeout",
                    "timeout_s": t,
                }
                if context:
                    for k, v in context.items():
                        log_ctx.setdefault(k, v)
                logger.warning(
                    "claude_call model=%s status=timeout timeout_s=%.1f ctx=%s",
                    resolved, t,
                    {k: v for k, v in log_ctx.items()
                     if k not in {"event", "model", "max_tokens", "input_tokens",
                                  "output_tokens", "cost_usd", "status", "timeout_s"}}
                    or "-",
                    extra=log_ctx,
                )
                raise ClaudeTimeoutError(
                    f"Claude completion exceeded {t:.1f}s deadline (model={resolved})"
                ) from exc
            except Exception:
                # Round-5 H-2: any other failure — also reverse the
                # estimate. Anthropic almost certainly didn't bill us
                # for a 4xx/5xx; reversing the estimate keeps the
                # accumulator honest.
                await _reconcile_spend(pre_estimate_usd, 0.0)
                raise

        input_tokens = int(getattr(resp.usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(resp.usage, "output_tokens", 0) or 0)
        cost_usd = _estimate_cost_usd(resolved, input_tokens, output_tokens)
        # Round-5 H-2: reconcile the pre-call estimate against the actual
        # cost. Best-effort — Redis blips don't fail the request.
        await _reconcile_spend(pre_estimate_usd, cost_usd)
        log_ctx: dict[str, Any] = {
            "event": "claude_call",
            "model": resolved,
            "max_tokens": max_tokens,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }
        if context:
            # Caller-provided fields never overwrite the core metrics.
            for k, v in context.items():
                if k not in log_ctx:
                    log_ctx[k] = v
        logger.info(
            "claude_call model=%s in=%d out=%d usd=%.4f ctx=%s",
            resolved, input_tokens, output_tokens, cost_usd,
            {k: v for k, v in log_ctx.items() if k not in {"event", "model", "max_tokens", "input_tokens", "output_tokens", "cost_usd"}} or "-",
            extra=log_ctx,
        )

        return "".join(b.text for b in resp.content if hasattr(b, "text"))


# Round-4 CLUSTER 2 #9: shared async client singleton. Each ClaudeClient
# instance constructs a fresh anthropic.AsyncAnthropic, which carries its
# own httpx connection pool. Constructing one per call wasted a few
# hundred ms on TLS handshake per Claude request and meant we couldn't
# benefit from HTTP/2 connection reuse.
_CLIENT: ClaudeClient | None = None


def get_client() -> ClaudeClient:
    """Return the shared :class:`ClaudeClient`, lazily initialising on
    first use. Safe under concurrent access — Python module globals are
    write-protected by the GIL for simple assignment, and a duplicate
    init in the rare race window does no harm beyond a transient extra
    httpx pool that GC reclaims.
    """
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = ClaudeClient()
    return _CLIENT


def _reset_client_for_tests() -> None:
    """Test-only helper: clear the cached singleton between cases so a
    pytest can patch ``ClaudeClient`` and have :func:`get_client` pick up
    the new mock on the next call. NOT a public API.
    """
    global _CLIENT
    _CLIENT = None
