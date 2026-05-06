"""Provider-agnostic LLM client surface.

PR-C of the Claude → AI rename series. The implementation lives in
:mod:`backend.agents.claude_client` (which still names the upstream
provider explicitly because the wire protocol, billing, and prompt
format are Anthropic-specific). This module re-exports those symbols
under generic ``LLM*`` names so call sites can migrate to a model-
agnostic API without paying a refactor cost up front.

Usage::

    from agents.llm_client import LLMClient, LLMTimeoutError, LLMBudgetExceeded

The legacy ``Claude*`` aliases continue to work and remain the canonical
import in already-migrated tests + telemetry modules. A future provider
swap (OpenAI, Gemini, on-prem) replaces this re-export with a real
provider-routing client; downstream callers don't change.
"""
from __future__ import annotations

# Re-export the provider implementation under generic names. The
# ``Claude*`` originals stay as aliases for back-compat — the rename
# is additive, not breaking. Module-level "from x import y" gives
# consumers a stable contract regardless of which provider eventually
# backs the import.
from .claude_client import (  # noqa: F401
    ClaudeBudgetExceeded as LLMBudgetExceeded,
    ClaudeClient as LLMClient,
    ClaudeTimeoutError as LLMTimeoutError,
    get_today_claude_spend_usd as get_today_llm_spend_usd,
)

__all__ = [
    "LLMBudgetExceeded",
    "LLMClient",
    "LLMTimeoutError",
    "get_today_llm_spend_usd",
]
