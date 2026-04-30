"""Opt-in Claude request/response audit logging.

This module writes raw Anthropic request and response payloads to a local
JSONL file when ``CLAUDE_AUDIT_LOG_ENABLED`` is true. It is deliberately
best-effort: audit logging must never break trading flows if the filesystem
is unavailable.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

_SECRET_KEY_NAMES = {
    "api_key",
    "anthropic_api_key",
    "authorization",
    "bearer",
    "password",
    "secret",
    "access_token",
    "refresh_token",
    "id_token",
}
_ANTHROPIC_KEY_RE = re.compile(r"sk-ant-[A-Za-z0-9_-]{10,}")
_BEARER_RE = re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.IGNORECASE)


def new_claude_audit_id() -> str:
    """Return a stable id for joining app logs to the JSONL audit trail."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"{stamp}-{uuid.uuid4().hex[:12]}"


def _to_jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        return {str(k): _to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_to_jsonable(v) for v in value]
    if hasattr(value, "model_dump"):
        try:
            return _to_jsonable(value.model_dump())
        except Exception:
            pass
    if hasattr(value, "dict"):
        try:
            return _to_jsonable(value.dict())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        public = {k: v for k, v in vars(value).items() if not k.startswith("_")}
        return _to_jsonable(public)
    return repr(value)


def _redact(value: Any, key_name: str | None = None) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            key_lower = key.lower()
            if (
                key_lower in _SECRET_KEY_NAMES
                or key_lower.endswith("_api_key")
                or key_lower.endswith("_secret")
                or key_lower.endswith("_password")
            ):
                redacted[key] = "<REDACTED>"
            else:
                redacted[key] = _redact(v, key)
        return redacted
    if isinstance(value, list):
        return [_redact(v, key_name) for v in value]
    if isinstance(value, str):
        text = _ANTHROPIC_KEY_RE.sub("<ANTHROPIC_API_KEY>", value)
        return _BEARER_RE.sub("Bearer <TOKEN>", text)
    return value


def _truncate(value: Any, max_chars: int) -> Any:
    if max_chars <= 0:
        return value
    if isinstance(value, dict):
        return {k: _truncate(v, max_chars) for k, v in value.items()}
    if isinstance(value, list):
        return [_truncate(v, max_chars) for v in value]
    if isinstance(value, str) and len(value) > max_chars:
        return f"{value[:max_chars]}...<truncated {len(value) - max_chars} chars>"
    return value


def _append_line(log_dir: str, line: str) -> None:
    path = Path(log_dir)
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass

    day = datetime.now(timezone.utc).date().isoformat()
    file_path = path / f"claude-{day}.jsonl"
    with file_path.open("a", encoding="utf-8") as f:
        f.write(line)
        f.write("\n")
    try:
        os.chmod(file_path, 0o600)
    except OSError:
        pass


async def write_claude_audit_record(
    *,
    request_id: str,
    source: str,
    request: dict[str, Any],
    response: dict[str, Any] | None = None,
    status: str,
    context: dict[str, Any] | None = None,
    duration_ms: int | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    """Write one Claude audit record if enabled.

    The record intentionally excludes HTTP headers and therefore never
    includes the Anthropic API key. Prompt/response content is otherwise
    logged, with best-effort secret-pattern redaction.
    """
    if not settings.CLAUDE_AUDIT_LOG_ENABLED:
        return

    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "request_id": request_id,
        "source": source,
        "status": status,
        "duration_ms": duration_ms,
        "context": context or {},
        "request": request,
        "response": response,
        "error": error,
    }
    try:
        safe = _truncate(
            _redact(_to_jsonable(record)),
            int(settings.CLAUDE_AUDIT_LOG_MAX_CHARS),
        )
        line = json.dumps(safe, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        await asyncio.to_thread(_append_line, settings.CLAUDE_AUDIT_LOG_DIR, line)
    except Exception:
        logger.warning("claude audit log write failed", exc_info=True)
