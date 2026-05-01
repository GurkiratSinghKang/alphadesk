from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import signal
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from core.config import settings
from core.supervised_task import create_supervised_task

logger = logging.getLogger(__name__)

ADVISORY_DISCLAIMER = (
    "TradingAgents output is external research only. AlphaDesk does not use "
    "this report as an order instruction, risk approval, or canonical market-data source."
)

SUPPORTED_PROVIDERS = {
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "ollama": "",
    "deepseek": "DEEPSEEK_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "glm": "ZHIPU_API_KEY",
    "azure": "AZURE_OPENAI_API_KEY",
}
SUPPORTED_ANALYSTS = ("market", "social", "news", "fundamentals")
_PROVIDER_SETTINGS = {
    "openai": "OPENAI_API_KEY",
    "google": "GOOGLE_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "xai": "XAI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "qwen": "DASHSCOPE_API_KEY",
    "glm": "ZHIPU_API_KEY",
    "azure": "AZURE_OPENAI_API_KEY",
}

_SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,11}$")
_RUN_ID_RE = re.compile(r"^[a-f0-9]{24}$")
_RUN_TTL_SECONDS = 7 * 24 * 60 * 60
_INMEM_RUNS: dict[str, dict[str, Any]] = {}
_INMEM_USER_RUNS: dict[str, list[str]] = {}
_DEFAULT_SKILL_HOME = Path("~/.cache/tradingagents-skill").expanduser()
_MIN_SUBPROCESS_TIMEOUT_S = 30
_FULL_GRAPH_TIMEOUT_FLOOR_S = 1_800
_MAX_RUN_TIMEOUT_S = 7_200


class TradingAgentsRunError(RuntimeError):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_symbol(value: str) -> str:
    symbol = (value or "").strip().upper()
    if not _SYMBOL_RE.fullmatch(symbol):
        raise ValueError("symbol must be 1-12 chars: A-Z, 0-9, dot, or dash")
    return symbol


def normalize_trade_date(value: str | date | None) -> str:
    if value is None or value == "":
        return date.today().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise ValueError("trade_date must use YYYY-MM-DD") from exc


def normalize_provider(value: str | None) -> str:
    provider = (value or settings.TRADINGAGENTS_PROVIDER or "openai").strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        allowed = ", ".join(sorted(SUPPORTED_PROVIDERS))
        raise ValueError(f"provider must be one of: {allowed}")
    return provider


def normalize_analysts(value: Any) -> list[str]:
    if value is None or value == "":
        return list(SUPPORTED_ANALYSTS)
    if isinstance(value, str):
        raw_items = value.split(",")
    elif isinstance(value, list):
        raw_items = value
    else:
        raise ValueError("analysts must be a list or comma-separated string")

    analysts = [str(item).strip().lower() for item in raw_items if str(item).strip()]
    if not analysts:
        raise ValueError("analysts must include at least one analyst")
    unknown = sorted(set(analysts) - set(SUPPORTED_ANALYSTS))
    if unknown:
        allowed = ", ".join(SUPPORTED_ANALYSTS)
        raise ValueError(f"analysts must be a subset of: {allowed}")
    return list(dict.fromkeys(analysts))


def _secret_value(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "get_secret_value"):
        try:
            return str(value.get_secret_value())
        except Exception:
            return ""
    return str(value)


def _provider_key(provider: str) -> tuple[str, str]:
    env_name = SUPPORTED_PROVIDERS[provider]
    if not env_name:
        return "", ""
    value = os.environ.get(env_name, "")
    if not value:
        setting_name = _PROVIDER_SETTINGS.get(provider)
        if setting_name:
            value = _secret_value(getattr(settings, setting_name, None))
    return env_name, value


def _model_defaults(provider: str) -> tuple[str, str]:
    deep = settings.TRADINGAGENTS_DEEP_MODEL
    quick = settings.TRADINGAGENTS_QUICK_MODEL
    if provider == "anthropic":
        if deep == "gpt-5.4":
            deep = "claude-sonnet-4-6"
        if quick == "gpt-5.4-mini":
            quick = "claude-haiku-4-5"
    elif provider == "openai":
        if deep.startswith("claude-"):
            deep = "gpt-5.4"
        if quick.startswith("claude-"):
            quick = "gpt-5.4-mini"
    return deep, quick


def _script_path() -> Path:
    configured = (settings.TRADINGAGENTS_SCRIPT_PATH or "").strip()
    if configured:
        return Path(configured).expanduser()

    candidates = [
        Path(__file__).resolve().parents[1] / "tools" / "tradingagents" / "scripts" / "run_tradingagents.sh",
        Path("~/.codex/skills/TradingAgents/scripts/run_tradingagents.sh").expanduser(),
    ]
    for candidate in candidates:
        if candidate is not None and candidate.exists():
            return candidate
    return next(candidate for candidate in candidates if candidate is not None)


def _skill_home_path() -> Path:
    configured = (settings.TRADINGAGENTS_SKILL_HOME or os.environ.get("TRADINGAGENTS_SKILL_HOME") or "").strip()
    if configured:
        return Path(configured).expanduser()
    return _DEFAULT_SKILL_HOME


def get_tradingagents_runtime_status() -> dict[str, Any]:
    provider = normalize_provider(None)
    default_deep, default_quick = _model_defaults(provider)
    script = _script_path()
    script_exists = script.exists() and script.is_file()
    script_runnable = script_exists and (script.suffix == ".sh" or os.access(script, os.X_OK))

    skill_home = _skill_home_path()
    runtime_python = skill_home / "venv" / "bin" / "python"
    upstream_checkout = skill_home / "upstream" / "TradingAgents" / ".git"
    installed_ref_path = skill_home / ".installed-ref"
    installed_ref: str | None = None
    if installed_ref_path.exists() and installed_ref_path.is_file():
        try:
            installed_ref = installed_ref_path.read_text(encoding="utf-8", errors="replace").strip() or None
        except OSError:
            installed_ref = None

    env_name, key_value = _provider_key(provider)
    provider_key_configured = bool(key_value or not env_name)
    runtime_python_exists = runtime_python.exists() and runtime_python.is_file()
    upstream_checkout_exists = upstream_checkout.exists()
    bootstrap_required = not (runtime_python_exists and upstream_checkout_exists and installed_ref)

    warnings: list[str] = []
    if not settings.TRADINGAGENTS_ENABLED:
        warnings.append("TradingAgents research is disabled.")
    if not script_exists:
        warnings.append(f"TradingAgents wrapper was not found at {script}.")
    elif not script_runnable:
        warnings.append(f"TradingAgents wrapper is not runnable at {script}.")
    if env_name and not provider_key_configured:
        warnings.append(f"{env_name} is required for the {provider} provider.")
    if bootstrap_required:
        warnings.append("TradingAgents runtime is not fully bootstrapped; the first run will install or refresh it.")

    return {
        "enabled": bool(settings.TRADINGAGENTS_ENABLED),
        "ready": bool(settings.TRADINGAGENTS_ENABLED and script_runnable and provider_key_configured),
        "script_path": str(script),
        "script_exists": script_exists,
        "script_runnable": script_runnable,
        "skill_home": str(skill_home),
        "runtime_python_exists": runtime_python_exists,
        "upstream_checkout_exists": upstream_checkout_exists,
        "installed_ref": installed_ref,
        "bootstrap_required": bootstrap_required,
        "provider": provider,
        "provider_env": env_name or None,
        "provider_key_configured": provider_key_configured,
        "deep_model": default_deep,
        "quick_model": default_quick,
        "supported_analysts": list(SUPPORTED_ANALYSTS),
        "output_language": settings.TRADINGAGENTS_OUTPUT_LANGUAGE or "English",
        "timeout_s": _effective_timeout_s(
            {
                "provider": provider,
                "analysts": list(SUPPORTED_ANALYSTS),
                "research_depth": 1,
            }
        ),
        "runs_per_hour": settings.TRADINGAGENTS_RUNS_PER_HOUR,
        "history_limit": settings.TRADINGAGENTS_HISTORY_LIMIT,
        "warnings": warnings,
    }


def _safe_filename(path_value: Any) -> str | None:
    if not isinstance(path_value, str) or not path_value:
        return None
    name = Path(path_value).name
    return name or None


def _safe_read_text(path_value: Any, *, max_chars: int) -> str:
    if not isinstance(path_value, str) or not path_value:
        return ""
    try:
        path = Path(path_value)
        if not path.exists() or not path.is_file():
            return ""
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    if len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n\n[truncated]"
    return text


def extract_json_payload(stdout: str) -> dict[str, Any]:
    """Parse wrapper JSON even when bootstrap text is printed first."""
    start = stdout.find("{")
    end = stdout.rfind("}")
    if start < 0 or end < start:
        raise TradingAgentsRunError("parse_error", "TradingAgents did not return JSON")
    try:
        payload = json.loads(stdout[start : end + 1])
    except json.JSONDecodeError as exc:
        raise TradingAgentsRunError("parse_error", "TradingAgents returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise TradingAgentsRunError("parse_error", "TradingAgents JSON payload was not an object")
    return payload


def _redact(text: str) -> str:
    redacted = text
    for env_name in SUPPORTED_PROVIDERS.values():
        if not env_name:
            continue
        value = os.environ.get(env_name, "")
        if not value:
            value = _secret_value(getattr(settings, env_name, None))
        if value:
            redacted = redacted.replace(value, "[redacted]")
    anthropic_key = _secret_value(settings.ANTHROPIC_API_KEY)
    if anthropic_key:
        redacted = redacted.replace(anthropic_key, "[redacted]")
    redacted = re.sub(r"sk-ant-[A-Za-z0-9_\-]{12,}", "sk-ant-[redacted]", redacted)
    redacted = re.sub(r"sk-[A-Za-z0-9_\-]{16,}", "sk-[redacted]", redacted)
    return redacted


def _request_record(username: str, request: dict[str, Any]) -> dict[str, Any]:
    provider = normalize_provider(request.get("provider"))
    default_deep, default_quick = _model_defaults(provider)
    research_depth = int(request.get("research_depth") or 1)
    research_depth = min(max(research_depth, 1), 3)

    record = {
        "symbol": normalize_symbol(str(request.get("symbol") or "")),
        "trade_date": normalize_trade_date(request.get("trade_date")),
        "provider": provider,
        "deep_model": str(request.get("deep_model") or default_deep).strip(),
        "quick_model": str(request.get("quick_model") or default_quick).strip(),
        "analysts": normalize_analysts(request.get("analysts")),
        "research_depth": research_depth,
        "reason": str(request.get("reason") or "").strip()[:500],
        "requested_by": username,
    }
    fingerprint = json.dumps(record, sort_keys=True, separators=(",", ":"))
    record["run_id"] = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:24]
    return record


def build_command(record: dict[str, Any]) -> list[str]:
    script = _script_path()
    prefix = ["/bin/bash", str(script)] if script.suffix == ".sh" else [str(script)]
    return [
        *prefix,
        record["symbol"],
        record["trade_date"],
        "--provider",
        record["provider"],
        "--deep-model",
        record["deep_model"],
        "--quick-model",
        record["quick_model"],
        "--analysts",
        ",".join(record.get("analysts") or SUPPORTED_ANALYSTS),
        "--output-language",
        settings.TRADINGAGENTS_OUTPUT_LANGUAGE or "English",
        "--research-depth",
        str(record["research_depth"]),
        "--summary-lines",
        "8",
        "--json",
    ]


def _effective_timeout_s(record: dict[str, Any] | None = None) -> int:
    configured = max(int(settings.TRADINGAGENTS_TIMEOUT_S or 0), _MIN_SUBPROCESS_TIMEOUT_S)
    if record is None:
        return configured

    analysts = record.get("analysts") or SUPPORTED_ANALYSTS
    analyst_count = len(analysts) if isinstance(analysts, list) else len(SUPPORTED_ANALYSTS)
    research_depth = int(record.get("research_depth") or 1)

    estimated = 600
    estimated += max(analyst_count - 1, 0) * 240
    estimated += max(research_depth - 1, 0) * 600
    if record.get("provider") == "anthropic":
        estimated += 300
    if analyst_count >= len(SUPPORTED_ANALYSTS):
        estimated = max(estimated, _FULL_GRAPH_TIMEOUT_FLOOR_S)

    return min(max(configured, estimated), _MAX_RUN_TIMEOUT_S)


def _public_record(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": record["run_id"],
        "symbol": record["symbol"],
        "trade_date": record["trade_date"],
        "status": record["status"],
        "provider": record["provider"],
        "deep_model": record["deep_model"],
        "quick_model": record["quick_model"],
        "analysts": record.get("analysts", list(SUPPORTED_ANALYSTS)),
        "research_depth": record["research_depth"],
        "progress_message": record.get("progress_message"),
        "timeout_s": int(record.get("timeout_s") or _effective_timeout_s(record)),
        "summary_lines": record.get("summary_lines", []),
        "decision_text": record.get("decision_text"),
        "artifact_files": record.get("artifact_files", []),
        "error": record.get("error"),
        "created_at": record["created_at"],
        "updated_at": record["updated_at"],
        "started_at": record.get("started_at"),
        "completed_at": record.get("completed_at"),
        "advisory_disclaimer": ADVISORY_DISCLAIMER,
    }


def _normalize_public_record(record: dict[str, Any] | None) -> dict[str, Any] | None:
    if record is None:
        return None
    normalized = {**record}
    normalized.setdefault("analysts", list(SUPPORTED_ANALYSTS))
    normalized.setdefault("progress_message", None)
    normalized.setdefault("timeout_s", _effective_timeout_s(normalized))
    normalized.setdefault("advisory_disclaimer", ADVISORY_DISCLAIMER)
    return normalized


def _run_key(username: str, run_id: str) -> str:
    return f"tradingagents:runs:{username}:{run_id}"


def _user_runs_key(username: str) -> str:
    return f"tradingagents:user_runs:{username}"


async def _store_record(username: str, record: dict[str, Any]) -> None:
    public = _public_record(record)
    try:
        from core.redis import get_redis

        redis = await get_redis()
        key = _run_key(username, record["run_id"])
        list_key = _user_runs_key(username)
        pipe = redis.pipeline()
        pipe.set(key, json.dumps(public), ex=_RUN_TTL_SECONDS)
        pipe.lrem(list_key, 0, record["run_id"])
        pipe.lpush(list_key, record["run_id"])
        pipe.ltrim(list_key, 0, max(settings.TRADINGAGENTS_HISTORY_LIMIT, 1) - 1)
        pipe.expire(list_key, _RUN_TTL_SECONDS)
        await pipe.execute()
        return
    except Exception:
        logger.debug("TradingAgents Redis store failed; using in-memory cache", exc_info=True)

    key = _run_key(username, record["run_id"])
    _INMEM_RUNS[key] = public
    ids = _INMEM_USER_RUNS.setdefault(username, [])
    if record["run_id"] in ids:
        ids.remove(record["run_id"])
    ids.insert(0, record["run_id"])
    del ids[max(settings.TRADINGAGENTS_HISTORY_LIMIT, 1) :]


async def _load_record(username: str, run_id: str) -> dict[str, Any] | None:
    if not _RUN_ID_RE.fullmatch(run_id):
        return None
    try:
        from core.redis import get_redis

        redis = await get_redis()
        raw = await redis.get(_run_key(username, run_id))
        if raw:
            payload = json.loads(raw)
            return _normalize_public_record(payload) if isinstance(payload, dict) else None
    except Exception:
        logger.debug("TradingAgents Redis load failed; using in-memory cache", exc_info=True)
    return _normalize_public_record(_INMEM_RUNS.get(_run_key(username, run_id)))


async def _list_records(username: str, limit: int) -> list[dict[str, Any]]:
    limit = max(min(limit, settings.TRADINGAGENTS_HISTORY_LIMIT), 1)
    try:
        from core.redis import get_redis

        redis = await get_redis()
        run_ids = await redis.lrange(_user_runs_key(username), 0, limit - 1)
        records: list[dict[str, Any]] = []
        for run_id in run_ids:
            record = await _load_record(username, str(run_id))
            if record is not None:
                records.append(record)
        return records
    except Exception:
        logger.debug("TradingAgents Redis list failed; using in-memory cache", exc_info=True)

    ids = _INMEM_USER_RUNS.get(username, [])[:limit]
    return [
        _INMEM_RUNS[_run_key(username, run_id)]
        for run_id in ids
        if _run_key(username, run_id) in _INMEM_RUNS
    ]


async def start_tradingagents_run(username: str, request: dict[str, Any]) -> dict[str, Any]:
    if not settings.TRADINGAGENTS_ENABLED:
        raise TradingAgentsRunError("disabled", "TradingAgents research is disabled")

    base = _request_record(username, request)
    existing = await _load_record(username, base["run_id"])
    if existing and existing.get("status") in {"queued", "running", "succeeded"}:
        return existing

    now = utc_now_iso()
    record = {
        **base,
        "status": "queued",
        "timeout_s": _effective_timeout_s(base),
        "progress_message": "Queued for TradingAgents research.",
        "summary_lines": [],
        "decision_text": None,
        "artifact_files": [],
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    await _store_record(username, record)
    create_supervised_task(
        _execute_tradingagents_run(username, record["run_id"]),
        name=f"tradingagents:{record['run_id']}",
    )
    return _public_record(record)


async def get_tradingagents_run(username: str, run_id: str) -> dict[str, Any] | None:
    return await _load_record(username, run_id)


async def list_tradingagents_runs(username: str, limit: int | None = None) -> list[dict[str, Any]]:
    return await _list_records(username, limit or settings.TRADINGAGENTS_HISTORY_LIMIT)


async def _execute_tradingagents_run(username: str, run_id: str) -> None:
    record = await _load_record(username, run_id)
    if record is None:
        return
    started = utc_now_iso()
    record.update(
        {
            "status": "running",
            "started_at": started,
            "updated_at": started,
            "progress_message": (
                "TradingAgents graph is running. Upstream emits report output only after completion."
            ),
        }
    )
    await _store_record(username, record)

    heartbeat_stop = asyncio.Event()
    heartbeat_task = asyncio.create_task(_heartbeat_tradingagents_run(username, run_id, heartbeat_stop))
    try:
        result = await _run_subprocess(record)
        heartbeat_stop.set()
        await heartbeat_task
        completed = utc_now_iso()
        record.update(
            {
                "status": "succeeded",
                "progress_message": "TradingAgents report complete.",
                "summary_lines": result["summary_lines"],
                "decision_text": result["decision_text"],
                "artifact_files": result["artifact_files"],
                "completed_at": completed,
                "updated_at": completed,
                "error": None,
            }
        )
    except TradingAgentsRunError as exc:
        heartbeat_stop.set()
        await heartbeat_task
        completed = utc_now_iso()
        record.update(
            {
                "status": "failed",
                "progress_message": "TradingAgents report failed.",
                "completed_at": completed,
                "updated_at": completed,
                "error": {"code": exc.status, "message": exc.message},
            }
        )
    except Exception as exc:  # pragma: no cover - defensive guard
        heartbeat_stop.set()
        await heartbeat_task
        completed = utc_now_iso()
        logger.exception("TradingAgents run failed unexpectedly")
        record.update(
            {
                "status": "failed",
                "progress_message": "TradingAgents report failed unexpectedly.",
                "completed_at": completed,
                "updated_at": completed,
                "error": {"code": "internal_error", "message": str(exc)},
            }
        )
    await _store_record(username, record)


async def _heartbeat_tradingagents_run(username: str, run_id: str, stop: asyncio.Event) -> None:
    while True:
        try:
            await asyncio.wait_for(stop.wait(), timeout=30)
            return
        except asyncio.TimeoutError:
            record = await _load_record(username, run_id)
            if record is None or record.get("status") != "running":
                return
            record.update(
                {
                    "updated_at": utc_now_iso(),
                    "progress_message": (
                        "Still running TradingAgents. The wrapper will store the memo when upstream completes."
                    ),
                }
            )
            await _store_record(username, record)


async def _run_subprocess(record: dict[str, Any]) -> dict[str, Any]:
    script = _script_path()
    if not script.exists() or not script.is_file():
        raise TradingAgentsRunError("unavailable", f"TradingAgents wrapper not found at {script}")
    if script.suffix != ".sh" and not os.access(script, os.X_OK):
        raise TradingAgentsRunError("unavailable", f"TradingAgents wrapper is not executable at {script}")

    env_name, key_value = _provider_key(record["provider"])
    if env_name and not key_value:
        raise TradingAgentsRunError("missing_key", f"{env_name} is required for {record['provider']}")

    env = os.environ.copy()
    if env_name and key_value:
        env[env_name] = key_value
    if settings.TRADINGAGENTS_SKILL_HOME:
        env["TRADINGAGENTS_SKILL_HOME"] = settings.TRADINGAGENTS_SKILL_HOME
    env.setdefault("TRADINGAGENTS_BOOTSTRAP_PYTHON", sys.executable)

    command = build_command(record)
    timeout_s = int(record.get("timeout_s") or _effective_timeout_s(record))
    started = time.monotonic()
    proc = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        start_new_session=True,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(),
            timeout=max(timeout_s, _MIN_SUBPROCESS_TIMEOUT_S),
        )
    except asyncio.TimeoutError as exc:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            await asyncio.wait_for(proc.communicate(), timeout=10)
        except Exception:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            await proc.communicate()
        raise TradingAgentsRunError(
            "timeout",
            f"TradingAgents exceeded {timeout_s}s timeout",
        ) from exc

    stdout = _redact(stdout_b.decode("utf-8", errors="replace"))
    stderr = _redact(stderr_b.decode("utf-8", errors="replace"))
    elapsed_ms = int((time.monotonic() - started) * 1000)
    if proc.returncode != 0:
        message = stderr.strip() or stdout.strip() or "TradingAgents exited with an error"
        raise TradingAgentsRunError("runner_error", message[:1000])

    payload = extract_json_payload(stdout)
    summary_lines = payload.get("summary_lines")
    if not isinstance(summary_lines, list):
        summary_lines = []
    summary_lines = [str(line).strip() for line in summary_lines if str(line).strip()][:8]

    decision_text = _safe_read_text(
        payload.get("decision_path"),
        max_chars=settings.TRADINGAGENTS_MAX_DECISION_CHARS,
    ).strip()
    if not decision_text and summary_lines:
        decision_text = "\n".join(f"- {line}" for line in summary_lines)

    artifact_files = [
        name
        for name in (
            _safe_filename(payload.get("summary_path")),
            _safe_filename(payload.get("decision_path")),
            _safe_filename(payload.get("run_config_path")),
            _safe_filename(payload.get("final_state_path")),
        )
        if name
    ]

    logger.info(
        "TradingAgents run succeeded",
        extra={
            "symbol": record["symbol"],
            "trade_date": record["trade_date"],
            "provider": record["provider"],
            "elapsed_ms": elapsed_ms,
        },
    )
    return {
        "summary_lines": summary_lines,
        "decision_text": decision_text,
        "artifact_files": artifact_files,
    }
