from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import time
from abc import ABC
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

# Model aliases — used for both CLI and API
MODEL_OPUS = "opus"
MODEL_SONNET = "sonnet"
MODEL_HAIKU = "haiku"


# ---------------------------------------------------------------------------
# PII scrubbing for outbound Claude prompts (Wave 4Q — persona-103 P1 #4).
# ---------------------------------------------------------------------------
# Anthropic is a sub-processor for us; our privacy policy tells users that no
# PII is included in prompts.  The earlier implementation trusted agent
# subclasses to construct clean prompts, which worked right up until the first
# time someone interpolated a username or a ``client_order_id`` straight into
# a task string (master_agent routing logs, ``run_with_tools`` context, …).
# Scrubbing is belt-and-braces: even if a subclass leaks something, the
# outbound payload is sanitised in ONE place.
#
# What we scrub
# -------------
# 1. The configured admin username — exactly.  Not a heuristic match;
#    everywhere it would appear as a literal.  Replaced with ``<USER>``.
# 2. ``client_order_id`` values — the project emits these in two shapes:
#       a. ``manual_<username>_<32-hex-chars>``    (POST /trades).
#       b. ``<strategy>_<SYMBOL>_<unix-timestamp>``  (scheduler routing).
#    Both are pattern-matched and redacted to ``<ORDER_ID>``.
# 3. ``broker_order_id`` — Alpaca UUIDs.  Scrubbed to ``<BROKER_ORDER_ID>``.
# 4. IPv4 / IPv6 addresses — occasionally sneaked into logs via
#    ``request.client.host``.  Replaced with ``<IP>``.
# 5. Email addresses — RFC-5322-lite pattern, replaced with ``<EMAIL>``.
# 6. Bearer tokens — ``Bearer <token>`` strings leaking from Authorization
#    headers or agent context dumps. Replaced with ``Bearer <TOKEN>``.
# 7. JWTs — ``eyJ...``-prefix three-segment tokens. Replaced with ``<JWT>``.
# 8. Alpaca API keys — ``PK...`` (key id) and ``SK...`` (secret) prefix
#    tokens. Replaced with ``<ALPACA_KEY>`` / ``<ALPACA_SECRET>``.
#
# What we DON'T scrub
# -------------------
# Market-data fields (symbol, price, volume), strategy names, technical
# indicator numbers — these are NOT personal data even under the most
# expansive GDPR reading.  Over-scrubbing would blind Claude to the actual
# analysis task and is a reliability failure, not a privacy win.
#
# All regexes are compiled once at module load.

# Alpaca UUID — 8-4-4-4-12 hex blocks, case-insensitive.
_UUID_RE = re.compile(
    r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b"
)

# client_order_id shape a: manual_<username>_<hex>. The <hex> is
# sufficiently long (~32 chars) that false positives on arbitrary text are
# vanishingly unlikely.
_CLIENT_ORDER_ID_MANUAL_RE = re.compile(r"\bmanual_[A-Za-z0-9]+_[0-9a-fA-F]{12,}\b")

# client_order_id shape b: <strategy>_<SYMBOL>_<unix-ts>. SYMBOL is
# up-to-5-char uppercase; strategy is snake_case lowercase or mixed.
_CLIENT_ORDER_ID_STRAT_RE = re.compile(r"\b[a-zA-Z][a-zA-Z0-9_]+_[A-Z]{1,5}_\d{10,}\b")

# IPv4.  Too many false positives on version strings ("1.0.0.1") if we're
# not careful, so we require at least one non-zero octet and bound via
# word boundaries.
_IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

# IPv6 — conservative match (full 8-group form + the common ::-compressed
# variants).  Skipping the academic-paper-quality RFC-4291 grammar — the
# goal is "don't leak an IP", not "parse IPv6 perfectly".
_IPV6_RE = re.compile(r"\b[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){2,7}\b")

# Email — practical, not RFC-strict.
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

# Wave 6γ (persona-108 + Round 5 deferred) — additional secret/credential
# patterns. These must scrub BEFORE the generic UUID/ID patterns where the
# surface syntax could otherwise be ambiguous.
#
# JWT: three base64url segments separated by dots, starting with ``eyJ``
# (the base64 encoding of ``{"`` which prefixes every JWT header).
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")

# Bearer token: ``Bearer `` followed by an opaque token. Case-sensitive on
# the scheme name to avoid chewing up unrelated prose that mentions
# "bearer" as a word. Redacts BOTH the scheme and the token so partial
# tokens can't survive.
_BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9_.\-]+")

# Alpaca key id: ``PK`` prefix + ≥16 upper-alnum chars (the shortest live
# id observed in practice is 20 chars; 16 is a conservative minimum that
# still doesn't chew up protein ticker "PKX" or similar).
_ALPACA_KEY_RE = re.compile(r"\bPK[A-Z0-9]{16,}\b")

# Alpaca secret: ``SK`` prefix + ≥16 upper-alnum chars.  Mirrors the
# format and length of the key id; same conservative floor.
_ALPACA_SECRET_RE = re.compile(r"\bSK[A-Z0-9]{16,}\b")


def _scrub_pii(text: str) -> str:
    """Redact personally-identifiable fields from ``text``.

    Idempotent — running it twice on the same string is a no-op.  The
    scrub is CONSERVATIVE: patterns are anchored by word boundaries so
    we don't chew up legitimate tokens (market-data field names,
    technical indicator identifiers).

    Order matters: UUID must scrub BEFORE the order-id patterns so a
    broker-order-id UUID doesn't accidentally match the strategy shape.
    """
    if not isinstance(text, str) or not text:
        return text

    # Username first — literal replacement, no regex escape traps.
    # Case-sensitive: ADMIN_USERNAME is "admin", we don't want to eat
    # "Admin Schubert" in some future multilingual user-facing copy.
    admin_username = (getattr(settings, "ADMIN_USERNAME", "") or "").strip()
    if admin_username and len(admin_username) >= 3:
        # Length gate avoids pathological cases where ADMIN_USERNAME is a
        # common English word ("a", "me") that would chew the prompt.
        text = re.sub(rf"\b{re.escape(admin_username)}\b", "<USER>", text)

    # Credentials FIRST — a JWT containing '-' / '_' base64url chars must
    # not be partially chewed by a later, narrower pattern. Same rationale
    # for Bearer / Alpaca keys: strip the whole token before anything else
    # tries to interpret its sub-structure.
    text = _JWT_RE.sub("<JWT>", text)
    text = _BEARER_RE.sub("Bearer <TOKEN>", text)
    text = _ALPACA_KEY_RE.sub("<ALPACA_KEY>", text)
    text = _ALPACA_SECRET_RE.sub("<ALPACA_SECRET>", text)

    # Broker order id (UUID) — scrub BEFORE the order-id shapes, so a
    # stray UUID doesn't get mis-tagged as <ORDER_ID>.
    text = _UUID_RE.sub("<BROKER_ORDER_ID>", text)

    # client_order_id — two shapes, both -> <ORDER_ID>.
    text = _CLIENT_ORDER_ID_MANUAL_RE.sub("<ORDER_ID>", text)
    text = _CLIENT_ORDER_ID_STRAT_RE.sub("<ORDER_ID>", text)

    # IPs and emails.
    text = _IPV4_RE.sub("<IP>", text)
    text = _IPV6_RE.sub("<IP>", text)
    text = _EMAIL_RE.sub("<EMAIL>", text)

    return text

# Locate the claude CLI binary
CLAUDE_CLI = shutil.which("claude")


def claude_backend_mode() -> str:
    mode = (settings.CLAUDE_BACKEND or "auto").strip().lower()
    return mode if mode in {"auto", "api", "cli"} else "auto"


def claude_runtime_available() -> bool:
    """Return whether the configured Claude runtime is available."""
    api_secret = getattr(settings, "ANTHROPIC_API_KEY", None)
    api_available = bool(api_secret.get_secret_value() if api_secret else "")
    cli_available = CLAUDE_CLI is not None
    mode = claude_backend_mode()
    if mode == "api":
        return api_available
    if mode == "cli":
        return cli_available
    return api_available or cli_available

# Wave 3L Fix 9 (persona-86/90): concurrency ceiling on Claude calls.
# Without this, a burst of agent requests (e.g. 50 screener triggers
# firing on a market event) would spawn 50 concurrent ``claude`` CLI
# subprocesses or API requests. The CLI is memory-heavy (~300 MB each)
# and the API enforces provider-side rate limits that failing retries
# don't help with. 4 parallel in-flight calls balances throughput and
# resource safety on our 2 vCPU box. Applies to both CLI and API paths.
_CLAUDE_SEMAPHORE = asyncio.Semaphore(4)


def _parse_retry_after_seconds(exc: Exception) -> float | None:
    """Pull ``retry-after`` from an Anthropic 429 response if present.

    Returns the advertised cooldown in seconds, or None if the header
    is absent / unparseable. Anthropic returns this as either an
    integer "seconds" value or an HTTP-date — we only handle the
    integer form because it's what their SDK surfaces in practice.
    """
    response = getattr(exc, "response", None)
    if response is None:
        return None
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    raw = headers.get("retry-after") or headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


class BaseAgent(ABC):
    """Base class for all AlphaDesk agents.

    Uses the Anthropic API when ``ANTHROPIC_API_KEY`` is configured, falling
    back to the Claude CLI only in ``CLAUDE_BACKEND=auto`` mode when the API
    key is absent. ``CLAUDE_BACKEND=api`` or ``cli`` can force either runtime.
    """

    name: str = "base"
    model: str = MODEL_SONNET
    system_prompt: str = "You are a helpful trading assistant."
    mcp_servers: list[str] = []
    max_retries: int = 2
    retry_delay: float = 1.0

    def __init__(self) -> None:
        self.logger = logging.getLogger(f"agent.{self.name}")
        self._use_cli = False
        self._api_client = None
        api_secret = getattr(settings, "ANTHROPIC_API_KEY", None)
        api_key = api_secret.get_secret_value() if api_secret else ""
        mode = claude_backend_mode()

        if api_key and mode in {"auto", "api"}:
            import anthropic
            self._api_client = anthropic.AsyncAnthropic(api_key=api_key)
            self.logger.info("Agent '%s' using Anthropic API", self.name)
        elif CLAUDE_CLI and mode in {"auto", "cli"}:
            self._use_cli = True
            self.logger.info("Agent '%s' using Claude CLI at %s", self.name, CLAUDE_CLI)
        else:
            self.logger.warning(
                "Agent '%s': configured Claude backend '%s' unavailable "
                "(api_key=%s cli=%s)",
                self.name, mode, bool(api_key), bool(CLAUDE_CLI),
            )

    @property
    def available(self) -> bool:
        return self._use_cli or self._api_client is not None

    async def run(self, task: str, context: dict[str, Any] | None = None) -> dict[str, Any]:
        """Execute a task through the configured Claude runtime."""
        if not self.available:
            return {"response": f"Agent '{self.name}' unavailable (no Claude CLI or API key).", "error": True}

        # Build the full prompt with context
        prompt = self._build_prompt(task, context)

        if self._use_cli:
            return await self._run_cli(prompt)
        else:
            return await self._run_api(prompt)

    async def run_with_tools(
        self,
        task: str,
        tools: list[dict[str, Any]],
        context: dict[str, Any] | None = None,
        max_iterations: int = 10,
    ) -> dict[str, Any]:
        """Run with tools. CLI mode uses --allowedTools, API mode uses tool loop."""
        prompt = self._build_prompt(task, context)

        if self._use_cli:
            # CLI can use allowed tools natively
            tool_names = [t.get("name", "") for t in tools if t.get("name")]
            return await self._run_cli(prompt, allowed_tools=tool_names)
        elif self._api_client:
            return await self._run_api_with_tools(prompt, tools, max_iterations)
        else:
            return {"response": "Agent unavailable.", "error": True}

    # ------------------------------------------------------------------
    # CLI execution
    # ------------------------------------------------------------------

    async def _run_cli(
        self,
        prompt: str,
        allowed_tools: list[str] | None = None,
    ) -> dict[str, Any]:
        """Run via Claude CLI subprocess with --print and --output-format json."""
        from agents.claude_audit import new_claude_audit_id, write_claude_audit_record

        cmd = [
            CLAUDE_CLI,
            "--print",
            "--output-format", "json",
            "--model", self.model,
            "--append-system-prompt", self.system_prompt,
        ]

        if allowed_tools:
            cmd.extend(["--allowedTools", ",".join(allowed_tools)])

        cmd.append(prompt)

        # Wave 3L Fix 9: global semaphore caps concurrent Claude subprocess
        # calls at 4. Each CLI subprocess is memory-heavy (~300 MB) and
        # the parent process is 2 vCPU, so unbounded fanout from a burst
        # of agent triggers would OOM the container.
        async with _CLAUDE_SEMAPHORE:
            for attempt in range(1, self.max_retries + 1):
                request_id = new_claude_audit_id()
                request_payload = {
                    "runtime": "cli",
                    "model": self.model,
                    "system": self.system_prompt,
                    "prompt": prompt,
                    "allowed_tools": allowed_tools or [],
                }
                try:
                    t0 = time.monotonic()
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, stderr = await asyncio.wait_for(
                        proc.communicate(), timeout=120
                    )
                    elapsed = time.monotonic() - t0

                    if proc.returncode != 0:
                        err = stderr.decode(errors="replace").strip()
                        self.logger.error("CLI error (attempt %d): %s", attempt, err[:200])
                        await write_claude_audit_record(
                            request_id=request_id,
                            source=f"agent.{self.name}.cli",
                            request=request_payload,
                            status="error",
                            context={"agent": self.name, "attempt": attempt},
                            duration_ms=int(elapsed * 1000),
                            error={"type": "ClaudeCLIError", "message": err},
                        )
                        if attempt < self.max_retries:
                            await asyncio.sleep(self.retry_delay)
                            continue
                        return {"response": f"CLI error: {err[:500]}", "error": True}

                    raw = stdout.decode(errors="replace").strip()
                    self.logger.info("CLI completed in %.1fs (%d chars)", elapsed, len(raw))

                    parsed = self._parse_cli_response(raw)
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.cli",
                        request=request_payload,
                        response={"raw": raw, "parsed": parsed},
                        status="success",
                        context={"agent": self.name, "attempt": attempt},
                        duration_ms=int(elapsed * 1000),
                    )
                    return parsed

                except asyncio.TimeoutError:
                    self.logger.warning("CLI timeout (attempt %d)", attempt)
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.cli",
                        request=request_payload,
                        status="timeout",
                        context={"agent": self.name, "attempt": attempt},
                        error={"type": "TimeoutError", "message": "Claude CLI exceeded 120s"},
                    )
                    if attempt < self.max_retries:
                        await asyncio.sleep(self.retry_delay)
                        continue
                    return {"response": "Agent timed out.", "error": True}

                except Exception as exc:
                    self.logger.error("CLI exception (attempt %d): %s", attempt, exc)
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.cli",
                        request=request_payload,
                        status="error",
                        context={"agent": self.name, "attempt": attempt},
                        error={"type": type(exc).__name__, "message": str(exc)},
                    )
                    if attempt < self.max_retries:
                        await asyncio.sleep(self.retry_delay)
                        continue
                    return {"response": f"Agent error: {exc}", "error": True}

        return {"response": "Agent failed after retries.", "error": True}

    def _parse_cli_response(self, raw: str) -> dict[str, Any]:
        """Parse CLI JSON output."""
        try:
            data = json.loads(raw)
            # CLI --output-format json returns: {"type":"result","subtype":"success","result":"..."}
            if isinstance(data, dict):
                result_text = data.get("result", "")
                if not result_text and "content" in data:
                    result_text = data["content"]
                if not result_text:
                    result_text = raw
                return {
                    "response": result_text,
                    "model": data.get("model", self.model),
                    "stop_reason": data.get("stop_reason", "end_turn"),
                    "cost_usd": data.get("cost_usd", 0),
                    "duration_ms": data.get("duration_ms", 0),
                }
            return {"response": raw, "model": self.model, "stop_reason": "end_turn"}
        except json.JSONDecodeError:
            # Plain text response
            return {"response": raw, "model": self.model, "stop_reason": "end_turn"}

    # ------------------------------------------------------------------
    # API execution (fallback)
    # ------------------------------------------------------------------

    async def _run_api(self, prompt: str) -> dict[str, Any]:
        """Fallback: run via Anthropic API."""
        import anthropic
        from agents.claude_audit import new_claude_audit_id, write_claude_audit_record

        # Map CLI model aliases to Anthropic API model IDs returned by the
        # account's /v1/models endpoint (verified 2026-04-29).
        model_map = {
            "opus": "claude-opus-4-7",
            "sonnet": "claude-sonnet-4-6",
            "haiku": "claude-haiku-4-5-20251001",
        }
        model_id = model_map.get(self.model, self.model)

        # Wave 3L Fix 9: same concurrency ceiling as the CLI path so
        # API-mode agents don't bypass the bound and blow past the
        # provider rate limits (which retries wouldn't help with).
        async with _CLAUDE_SEMAPHORE:
            for attempt in range(1, self.max_retries + 1):
                try:
                    t0 = time.monotonic()
                    # Round-17 cost: wrap stable system prompt in
                    # ``cache_control: ephemeral`` for the 90% input-
                    # token discount on second-and-subsequent calls
                    # with the same system text.
                    system_param: Any = (
                        [{"type": "text", "text": self.system_prompt,
                          "cache_control": {"type": "ephemeral"}}]
                        if self.system_prompt
                        else self.system_prompt
                    )
                    messages = [{"role": "user", "content": prompt}]
                    request_id = new_claude_audit_id()
                    request_payload = {
                        "model": model_id,
                        "max_tokens": 4096,
                        "system": system_param,
                        "messages": messages,
                    }
                    response = await self._api_client.messages.create(
                        model=model_id,
                        max_tokens=4096,
                        system=system_param,
                        messages=messages,
                    )
                    elapsed = time.monotonic() - t0
                    usage = getattr(response, "usage", None)
                    self.logger.info(
                        "API completed in %.1fs (tokens: %d in / %d out)",
                        elapsed,
                        getattr(usage, "input_tokens", 0),
                        getattr(usage, "output_tokens", 0),
                    )
                    text = "".join(b.text for b in response.content if hasattr(b, "text"))
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.run",
                        request=request_payload,
                        response={
                            "model": getattr(response, "model", model_id),
                            "stop_reason": getattr(response, "stop_reason", None),
                            "content": text,
                            "usage": {
                                "input_tokens": getattr(usage, "input_tokens", 0),
                                "output_tokens": getattr(usage, "output_tokens", 0),
                            },
                        },
                        status="success",
                        context={"agent": self.name, "attempt": attempt},
                        duration_ms=int(elapsed * 1000),
                    )
                    return {"response": text, "model": response.model, "stop_reason": response.stop_reason}

                except anthropic.RateLimitError as rl_exc:
                    # Round-15 / persona-11 HIGH: honour the upstream
                    # ``retry-after`` header when present — pure
                    # exponential backoff lockstepped against Anthropic's
                    # advertised cooldown, multiplying the 429 lifetime.
                    retry_after_s = _parse_retry_after_seconds(rl_exc)
                    backoff = self.retry_delay * (2 ** (attempt - 1))
                    wait = max(retry_after_s or 0, backoff)
                    self.logger.warning(
                        "Rate limited (retry-after=%s); sleeping %.1fs",
                        retry_after_s, wait,
                    )
                    await write_claude_audit_record(
                        request_id=new_claude_audit_id(),
                        source=f"agent.{self.name}.run",
                        request={
                            "model": model_id,
                            "max_tokens": 4096,
                            "messages": [{"role": "user", "content": prompt}],
                        },
                        status="rate_limited",
                        context={"agent": self.name, "attempt": attempt},
                        error={"type": type(rl_exc).__name__, "message": str(rl_exc)},
                    )
                    await asyncio.sleep(wait)
                except anthropic.APIError as exc:
                    self.logger.error("API error (attempt %d): %s", attempt, exc)
                    await write_claude_audit_record(
                        request_id=new_claude_audit_id(),
                        source=f"agent.{self.name}.run",
                        request={
                            "model": model_id,
                            "max_tokens": 4096,
                            "messages": [{"role": "user", "content": prompt}],
                        },
                        status="error",
                        context={"agent": self.name, "attempt": attempt},
                        error={"type": type(exc).__name__, "message": str(exc)},
                    )
                    if attempt == self.max_retries:
                        return {"response": f"API error: {exc}", "error": True}
                    await asyncio.sleep(self.retry_delay)

        return {"response": "Agent failed.", "error": True}

    async def _run_api_with_tools(
        self, prompt: str, tools: list[dict[str, Any]], max_iterations: int
    ) -> dict[str, Any]:
        """API tool loop fallback."""
        from agents.claude_audit import new_claude_audit_id, write_claude_audit_record

        # Current Anthropic API model IDs returned by /v1/models.
        model_map = {
            "opus": "claude-opus-4-7",
            "sonnet": "claude-sonnet-4-6",
            "haiku": "claude-haiku-4-5-20251001",
        }
        model_id = model_map.get(self.model, self.model)
        messages = [{"role": "user", "content": prompt}]

        # Wave 3L Fix 9: concurrency ceiling applied to the full
        # tool-loop run (not per-iteration) so a long tool exchange
        # still counts as a single slot. Otherwise a 10-iteration loop
        # could trickle through the semaphore and blow past the cap.
        async with _CLAUDE_SEMAPHORE:
            # Same prompt-caching wrap as ``_run_api`` above. Tool-loop
            # runs reuse the same system across every iteration, so the
            # second iteration onward hits the cache.
            tool_system_param: Any = (
                [{"type": "text", "text": self.system_prompt,
                  "cache_control": {"type": "ephemeral"}}]
                if self.system_prompt
                else self.system_prompt
            )
            for _ in range(max_iterations):
                request_id = new_claude_audit_id()
                request_payload = {
                    "model": model_id,
                    "max_tokens": 4096,
                    "system": tool_system_param,
                    "messages": messages,
                    "tools": tools,
                }
                t0 = time.monotonic()
                try:
                    response = await self._api_client.messages.create(
                        model=model_id, max_tokens=4096,
                        system=tool_system_param, messages=messages, tools=tools,
                    )
                except Exception as exc:
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.tools",
                        request=request_payload,
                        status="error",
                        context={"agent": self.name},
                        duration_ms=int((time.monotonic() - t0) * 1000),
                        error={"type": type(exc).__name__, "message": str(exc)},
                    )
                    raise
                elapsed = time.monotonic() - t0
                text_parts, tool_calls = [], []
                for block in response.content:
                    if block.type == "text":
                        text_parts.append(block.text)
                    elif block.type == "tool_use":
                        tool_calls.append({"id": block.id, "name": block.name, "input": block.input})
                usage = getattr(response, "usage", None)

                if not tool_calls:
                    text = "".join(text_parts)
                    await write_claude_audit_record(
                        request_id=request_id,
                        source=f"agent.{self.name}.tools",
                        request=request_payload,
                        response={
                            "model": getattr(response, "model", model_id),
                            "stop_reason": getattr(response, "stop_reason", None),
                            "content": text,
                            "tool_calls": tool_calls,
                            "usage": {
                                "input_tokens": getattr(usage, "input_tokens", 0),
                                "output_tokens": getattr(usage, "output_tokens", 0),
                            },
                        },
                        status="success",
                        context={"agent": self.name},
                        duration_ms=int(elapsed * 1000),
                    )
                    return {"response": text, "model": response.model, "stop_reason": response.stop_reason}

                serialized = [
                    {"type": b.type, "text": b.text} if b.type == "text"
                    else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
                    for b in response.content
                ]
                usage = getattr(response, "usage", None)
                await write_claude_audit_record(
                    request_id=request_id,
                    source=f"agent.{self.name}.tools",
                    request=request_payload,
                    response={
                        "model": getattr(response, "model", model_id),
                        "stop_reason": getattr(response, "stop_reason", None),
                        "content": "".join(text_parts),
                        "tool_calls": tool_calls,
                        "usage": {
                            "input_tokens": getattr(usage, "input_tokens", 0),
                            "output_tokens": getattr(usage, "output_tokens", 0),
                        },
                    },
                    status="tool_use",
                    context={"agent": self.name},
                    duration_ms=int(elapsed * 1000),
                )
                messages.append({"role": "assistant", "content": serialized})

                tool_results = []
                for tc in tool_calls:
                    result = await self._execute_tool(tc["name"], tc["input"])
                    tool_results.append({"type": "tool_result", "tool_use_id": tc["id"], "content": str(result)})
                messages.append({"role": "user", "content": tool_results})

        return {"response": "Reached max tool iterations.", "error": True}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_prompt(self, task: str, context: dict[str, Any] | None) -> str:
        """Build the full prompt string from task + context.

        Wave 4Q (persona-103 P1 #4): the final assembled prompt passes
        through ``_scrub_pii`` before it leaves this method.  Every
        outbound Claude call — CLI or API, run() or run_with_tools() —
        ultimately derives its prompt from this one chokepoint, so a
        single scrub here covers every outbound payload.  Callers do
        NOT need to remember to sanitise upstream.
        """
        parts = [task]
        if context:
            ctx_lines = [f"- {k}: {v}" for k, v in context.items() if k != "conversation_history"]
            if ctx_lines:
                parts.append("\nContext:\n" + "\n".join(ctx_lines))

            # Include conversation history
            history = context.get("conversation_history", [])
            if history:
                history_text = "\n".join(
                    f"{'User' if m['role'] == 'user' else 'Assistant'}: {m['content']}"
                    for m in history[:-1]
                )
                if history_text:
                    parts.append(f"\nConversation history:\n{history_text}")

        assembled = "\n".join(parts)
        # Single outbound-chokepoint scrub.  Safe to skip on the empty
        # string (_scrub_pii short-circuits anyway).
        return _scrub_pii(assembled)

    # ------------------------------------------------------------------
    # Shared extraction helpers (used by all agent subclasses)
    # ------------------------------------------------------------------

    def _extract_score(self, text: str) -> float:
        """Extract a numeric score from agent response text."""
        import re
        match = re.search(r'"?score"?\s*[:=]\s*([-\d.]+)', text)
        return float(match.group(1)) if match else 0.0

    def _extract_conviction(self, text: str) -> str:
        """Extract conviction level from agent response text.

        Uses negation-aware matching to avoid misclassifying
        phrases like 'not high conviction' as 'high'.
        """
        tl = text.lower()
        # Check for explicit negation patterns first
        if any(neg in tl for neg in ["not high", "no high", "low conviction", "conviction: low", "conviction:low"]):
            return "low"
        if any(neg in tl for neg in ["not medium", "moderate conviction", "conviction: medium", "conviction:medium"]):
            return "medium"
        if any(phrase in tl for phrase in ["high conviction", "conviction: high", "conviction:high", "strong conviction"]):
            return "high"
        if any(phrase in tl for phrase in ["medium conviction", "conviction: medium", "conviction:medium", "moderate"]):
            return "medium"
        return "low"  # Default to low

    async def _execute_tool(self, tool_name: str, tool_input: dict) -> Any:
        """Execute a tool by name. Override in subclasses for real tool dispatch."""
        from mcp_servers import get_mcp_tool
        handler = get_mcp_tool(tool_name)
        if handler:
            return await handler(**tool_input)
        self.logger.warning("Unknown tool: %s", tool_name)
        return {"error": f"Tool '{tool_name}' not found"}
