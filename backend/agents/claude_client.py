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
"""
from __future__ import annotations

import logging

from agents.base import _CLAUDE_SEMAPHORE
from core.config import settings

logger = logging.getLogger(__name__)


_MODEL_MAP = {
    "opus": "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-7",
    "haiku": "claude-haiku-4-7",
}


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
    ) -> str:
        """Issue a single completion; return the assistant's plain text."""
        resolved = _MODEL_MAP.get(model, model)
        async with _CLAUDE_SEMAPHORE:
            resp = await self._client.messages.create(
                model=resolved,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
        return "".join(b.text for b in resp.content if hasattr(b, "text"))
