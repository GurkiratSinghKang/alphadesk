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
"""
from __future__ import annotations

import asyncio
import logging
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
        """
        resolved = _MODEL_MAP.get(model, model)
        t = _DEFAULT_TIMEOUT_S if timeout is None else float(timeout)
        async with _CLAUDE_SEMAPHORE:
            try:
                resp = await asyncio.wait_for(
                    self._client.messages.create(
                        model=resolved,
                        max_tokens=max_tokens,
                        system=system,
                        messages=[{"role": "user", "content": user}],
                    ),
                    timeout=t,
                )
            except asyncio.TimeoutError as exc:
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

        input_tokens = int(getattr(resp.usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(resp.usage, "output_tokens", 0) or 0)
        cost_usd = _estimate_cost_usd(resolved, input_tokens, output_tokens)
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
