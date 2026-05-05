"""Earnings pre-warm pipeline (Batch R).

Problem
-------
When a top-50 ticker reports today (e.g. AMD on 2026-05-05), the very first
user to land on the earnings-options-play page eats a ~30 s wait while the
backend pulls a fresh options chain, computes IV term/skew, fetches 8
quarters of historical reactions, and runs the full Claude Opus thesis.
Subsequent visitors get the warm cache (<500 ms) but every cold day
serves the first viewer a broken UX.

Solution
--------
Each trading day at 07:00 ET the scheduler runs ``prewarm_earnings()`` —
this scans the FMP earnings calendar for the next 2 sessions, filters to
the curated optionable universe (already a top-50 mega/large-cap list at
≥$25B), and for each match warms:

  1. the options chain (``services.options.fetch_chain`` — TTL ~60 s
     short-term, but the prewarm guarantees a hit within the next few
     minutes);
  2. IV analysis (``services.options.fetch_iv_analysis`` — current IV,
     IV rank, IV percentile, HV20/50/100 — TTL ~5–15 min);
  3. historical earnings reactions (8 quarters of FMP surprises +
     adjusted-bar moves — 24 h TTL);
  4. the full Claude Opus thesis (~$0.30 per call — 24 h TTL keyed on
     ``symbol:report_date``).

Cost ceiling
------------
The curated universe has ~140 names; on a typical earnings night ≤8 of
them report. Two-day window doubles that. Worst-case daily cost:

    16 symbols × $0.30 ≈ $4.80 / trading day → $1,210 / year

Operators get a ``ALPHADESK_PREWARM_ENABLED=False`` knob plus per-stage
fallbacks — if the Claude budget kill-switch trips, chain/IV still warm.

Observability
-------------
Three structured log events:
  • ``prewarm.start``  — symbol list + count
  • ``prewarm.symbol`` — per-symbol stage timings + outcomes
  • ``prewarm.end``    — totals + estimated cost
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("alphadesk.earnings_prewarm")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Per-call cost estimate for the full Claude Opus thesis. Sourced from
# ``backend/agents/claude_client._estimate_call_cost`` for the
# claude-opus-4 model with the earnings-prompts payload size; reconciled
# against actual usage in production. Used solely for cost-ceiling logs
# — the actual budget kill-switch lives in ``agents.claude_client``.
CLAUDE_THESIS_COST_USD = 0.30


def _claude_thesis_cost_usd() -> float:
    """Batch U (A-3): per-call cost from settings, env-overridable."""
    from core.config import settings as _settings
    return float(_settings.CLAUDE_OPUS_COST_PER_CALL_USD)

# Per-symbol concurrency cap — same default as the on-demand earnings
# screener (``settings.EARNINGS_HYDRATE_CONCURRENCY``). Each prewarmed
# symbol fans out to Alpaca chain + Alpaca IV + FMP surprises + Anthropic
# Opus, so 4 in parallel is plenty without tripping rate limits.
DEFAULT_CONCURRENCY = 4

# Per-stage soft timeout — clamps a single hung upstream so one bad ticker
# can't stall the whole prewarm. Aborts that stage only; other stages for
# the same symbol still try.
PER_STAGE_TIMEOUT_SECONDS = 90.0


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class StageOutcome:
    """One stage's result for a single symbol — feeds the per-symbol log."""

    stage: str
    ok: bool
    duration_ms: int
    error: str | None = None
    skipped_reason: str | None = None


@dataclass
class PrewarmSymbolResult:
    """Aggregate of all stages for one symbol."""

    symbol: str
    report_date: str
    duration_ms: int
    stages: list[StageOutcome] = field(default_factory=list)
    claude_cost_usd: float = 0.0


@dataclass
class PrewarmRunResult:
    """Top-level summary of one prewarm pass."""

    started_at: datetime
    finished_at: datetime
    duration_ms: int
    symbols_attempted: list[str]
    symbols_succeeded: list[str]
    claude_calls: int
    estimated_cost_usd: float
    skipped_reason: str | None = None
    per_symbol: list[PrewarmSymbolResult] = field(default_factory=list)

    def to_log_payload(self) -> dict[str, Any]:
        """Render a JsonFormatter-friendly summary."""
        return {
            "event": "prewarm.end",
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat(),
            "total_ms": self.duration_ms,
            "symbols_attempted": self.symbols_attempted,
            "symbols_succeeded": self.symbols_succeeded,
            "attempted_count": len(self.symbols_attempted),
            "succeeded_count": len(self.symbols_succeeded),
            "claude_calls": self.claude_calls,
            "estimated_cost_usd": round(self.estimated_cost_usd, 2),
            "skipped_reason": self.skipped_reason,
        }


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def _env_flag_is_falsy(env_var: str) -> bool | None:
    """Batch U: short-circuit settings lookup so live env overrides
    (monkeypatch.setenv) still take effect."""
    raw = os.environ.get(env_var)
    if raw is None:
        return None
    val = raw.strip().lower()
    if val == "":
        return None
    return val in {"0", "false", "no", "off"}


def _is_prewarm_enabled() -> bool:
    """``settings.PREWARM_ENABLED`` — Batch U: settings with env fallback."""
    is_falsy = _env_flag_is_falsy("ALPHADESK_PREWARM_ENABLED")
    if is_falsy is not None:
        return not is_falsy
    from core.config import settings as _settings
    return bool(_settings.PREWARM_ENABLED)


def _is_claude_stage_enabled() -> bool:
    """``settings.PREWARM_CLAUDE_ENABLED`` — same env-then-settings pattern."""
    is_falsy = _env_flag_is_falsy("ALPHADESK_PREWARM_CLAUDE_ENABLED")
    if is_falsy is not None:
        return not is_falsy
    from core.config import settings as _settings
    return bool(_settings.PREWARM_CLAUDE_ENABLED)


# ---------------------------------------------------------------------------
# Per-stage runners
# ---------------------------------------------------------------------------


async def _stage_chain(symbol: str, expiry_iso: str | None) -> StageOutcome:
    """Pull the options chain — warms the Alpaca/Polygon chain cache."""
    from datetime import date

    started = time.monotonic()
    try:
        from services.options import fetch_chain

        expiry = (
            date.fromisoformat(expiry_iso) if expiry_iso else None
        )
        await asyncio.wait_for(
            fetch_chain(symbol, expiry=expiry),
            timeout=PER_STAGE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return StageOutcome(
            stage="chain",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"timeout>{PER_STAGE_TIMEOUT_SECONDS}s",
        )
    except Exception as exc:
        return StageOutcome(
            stage="chain",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )
    return StageOutcome(
        stage="chain",
        ok=True,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


async def _stage_iv(symbol: str) -> StageOutcome:
    """Compute IV term + skew via the standard analysis path. The
    underlying call also populates the IV-rank / percentile fields that
    Batch P relies on, so even when this prewarm runs before P lands the
    cache is in the right shape — once P is deployed those fields begin
    to carry real values without a code change here.
    """
    started = time.monotonic()
    try:
        from services.options import fetch_iv_analysis

        await asyncio.wait_for(
            fetch_iv_analysis(symbol),
            timeout=PER_STAGE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return StageOutcome(
            stage="iv",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"timeout>{PER_STAGE_TIMEOUT_SECONDS}s",
        )
    except Exception as exc:
        return StageOutcome(
            stage="iv",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )
    return StageOutcome(
        stage="iv",
        ok=True,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


async def _stage_historical(symbol: str, report_date_iso: str) -> StageOutcome:
    """Last-8-quarter earnings reactions (24 h TTL inside the screener)."""
    from datetime import date

    started = time.monotonic()
    try:
        from services.earnings_screener import _load_historical_earnings

        report_date = date.fromisoformat(report_date_iso)
        await asyncio.wait_for(
            _load_historical_earnings(symbol, report_date, lookback_quarters=8),
            timeout=PER_STAGE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return StageOutcome(
            stage="historical",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"timeout>{PER_STAGE_TIMEOUT_SECONDS}s",
        )
    except Exception as exc:
        return StageOutcome(
            stage="historical",
            ok=False,
            duration_ms=int((time.monotonic() - started) * 1000),
            error=f"{type(exc).__name__}: {exc}",
        )
    return StageOutcome(
        stage="historical",
        ok=True,
        duration_ms=int((time.monotonic() - started) * 1000),
    )


async def _stage_claude_thesis(
    symbol: str, meta: dict[str, Any]
) -> tuple[StageOutcome, float]:
    """Run / fetch the full Claude Opus thesis. Returns ``(outcome, cost_usd)``.

    Fast paths (no Claude call, ``cost_usd=0``):
      * ``ALPHADESK_PREWARM_CLAUDE_ENABLED=False`` — operator skipped Claude.
      * Cache hit — already warm from a previous run.

    Cold path issues a single Opus call, costed at ``CLAUDE_THESIS_COST_USD``.
    Budget kill-switch failures are captured as a normal stage error so the
    rest of the prewarm continues.
    """
    started = time.monotonic()
    if not _is_claude_stage_enabled():
        return (
            StageOutcome(
                stage="claude_thesis",
                ok=True,
                duration_ms=int((time.monotonic() - started) * 1000),
                skipped_reason="claude_disabled_via_env",
            ),
            0.0,
        )

    # Cache pre-flight to avoid paying the budget for a guaranteed hit.
    try:
        from services.earnings_screener import load_cached_full_research

        cached = await load_cached_full_research(symbol, meta=meta)
    except Exception:
        cached = None
    if cached is not None:
        return (
            StageOutcome(
                stage="claude_thesis",
                ok=True,
                duration_ms=int((time.monotonic() - started) * 1000),
                skipped_reason="cache_hit",
            ),
            0.0,
        )

    try:
        from services.earnings_screener import run_full_research

        await asyncio.wait_for(
            run_full_research(symbol, meta=meta),
            timeout=PER_STAGE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        return (
            StageOutcome(
                stage="claude_thesis",
                ok=False,
                duration_ms=int((time.monotonic() - started) * 1000),
                error=f"timeout>{PER_STAGE_TIMEOUT_SECONDS}s",
            ),
            0.0,
        )
    except Exception as exc:
        # ClaudeBudgetExceeded is the most likely soft-fail here — surface
        # it as a stage error rather than aborting the run, so the next
        # symbol still benefits from chain/IV/history prewarm.
        return (
            StageOutcome(
                stage="claude_thesis",
                ok=False,
                duration_ms=int((time.monotonic() - started) * 1000),
                error=f"{type(exc).__name__}: {exc}",
            ),
            0.0,
        )

    return (
        StageOutcome(
            stage="claude_thesis",
            ok=True,
            duration_ms=int((time.monotonic() - started) * 1000),
        ),
        _claude_thesis_cost_usd(),
    )


# ---------------------------------------------------------------------------
# Per-symbol orchestration
# ---------------------------------------------------------------------------


async def _prewarm_symbol(
    *,
    symbol: str,
    report_date_iso: str,
    report_time: str,
    company: str,
    sector: str,
    next_friday_expiry_iso: str | None,
) -> PrewarmSymbolResult:
    """Run all four warming stages for one symbol and emit a structured log.

    Stages run sequentially because (a) chain → IV is the natural order on
    the cache (chain populates the snapshot the IV pass reads), and (b) the
    overall fan-out is already concurrent across symbols via the outer
    semaphore.
    """
    overall = time.monotonic()
    stages: list[StageOutcome] = []
    claude_cost = 0.0

    # 1. Chain
    stages.append(await _stage_chain(symbol, next_friday_expiry_iso))
    # 2. IV
    stages.append(await _stage_iv(symbol))
    # 3. Historical reactions
    stages.append(await _stage_historical(symbol, report_date_iso))
    # 4. Claude thesis (most expensive — runs last so any earlier stage
    #    failure that signals a broken upstream gives ops a chance to flip
    #    the kill-switch before we burn budget)
    meta = {
        "symbol": symbol,
        "report_date": report_date_iso,
        "report_time": report_time,
        "company": company,
        "sector": sector,
    }
    claude_outcome, claude_cost = await _stage_claude_thesis(symbol, meta)
    stages.append(claude_outcome)

    duration_ms = int((time.monotonic() - overall) * 1000)
    result = PrewarmSymbolResult(
        symbol=symbol,
        report_date=report_date_iso,
        duration_ms=duration_ms,
        stages=stages,
        claude_cost_usd=claude_cost,
    )

    # Per-symbol structured log so ops can grep ``event=prewarm.symbol&symbol=AMD``.
    logger.info(
        "prewarm.symbol",
        extra={
            "event": "prewarm.symbol",
            "symbol": symbol,
            "report_date": report_date_iso,
            "report_time": report_time,
            "ms": duration_ms,
            "stages": [
                {
                    "stage": s.stage,
                    "ok": s.ok,
                    "ms": s.duration_ms,
                    "error": s.error,
                    "skipped_reason": s.skipped_reason,
                }
                for s in stages
            ],
            "claude_cost_usd": round(claude_cost, 4),
        },
    )
    return result


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def _list_today_and_tomorrow_symbols() -> list[dict[str, Any]]:
    """Pull the next 2 sessions of earnings rows from the screener.

    Already curated to top-tier optionable names (≥$25 B; see
    ``services.earnings_screener.CURATED_OPTIONABLE_UNIVERSE``), so this is
    effectively the "top-50 by reporting tonight or tomorrow" filter the
    Batch R spec asks for.
    """
    from services.earnings_screener import list_upcoming

    response = await list_upcoming(window="both")
    rows: list[dict[str, Any]] = []
    for row in response.earnings:
        # Only same-day or next-session reporters — the calendar window
        # may pull a wider slice ("both" is the front-of-week + next-week
        # union); we want symbols that benefit from prewarm now.
        if getattr(row, "days_until", None) is None:
            continue
        if row.days_until > 1:
            continue
        rows.append(
            {
                "symbol": row.symbol,
                "company": row.company,
                "sector": row.sector,
                "report_date": row.report_date.isoformat(),
                "report_time": row.report_time,
                # Best-effort: the calendar row carries no expiry hint, so
                # the chain stage falls through to provider default
                # (nearest weekly). The Claude path will override with the
                # event expiry it picks itself.
                "next_friday_expiry": None,
            }
        )
    return rows


async def prewarm_earnings(
    *,
    concurrency: int = DEFAULT_CONCURRENCY,
) -> PrewarmRunResult:
    """Pre-warm caches for every top-50 ticker reporting today or tomorrow.

    Idempotent — safe to call multiple times in a day; cache hits are free
    (logged with ``skipped_reason=cache_hit``).

    Args:
        concurrency: how many symbols to warm in parallel. Defaults to
            :data:`DEFAULT_CONCURRENCY`. Tests pass ``concurrency=1`` for
            deterministic ordering.
    """
    started_at = datetime.now(timezone.utc)
    started_mono = time.monotonic()

    if not _is_prewarm_enabled():
        finished_at = datetime.now(timezone.utc)
        result = PrewarmRunResult(
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=int((time.monotonic() - started_mono) * 1000),
            symbols_attempted=[],
            symbols_succeeded=[],
            claude_calls=0,
            estimated_cost_usd=0.0,
            skipped_reason="disabled_via_env",
        )
        logger.info(
            "prewarm.skipped",
            extra={
                "event": "prewarm.skipped",
                "reason": "ALPHADESK_PREWARM_ENABLED=false",
            },
        )
        return result

    try:
        rows = await _list_today_and_tomorrow_symbols()
    except Exception as exc:
        logger.warning(
            "prewarm.calendar_unavailable",
            extra={
                "event": "prewarm.calendar_unavailable",
                "error": f"{type(exc).__name__}: {exc}",
            },
        )
        finished_at = datetime.now(timezone.utc)
        return PrewarmRunResult(
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=int((time.monotonic() - started_mono) * 1000),
            symbols_attempted=[],
            symbols_succeeded=[],
            claude_calls=0,
            estimated_cost_usd=0.0,
            skipped_reason="calendar_unavailable",
        )

    symbols_attempted = [r["symbol"] for r in rows]
    logger.info(
        "prewarm.start",
        extra={
            "event": "prewarm.start",
            "symbols": symbols_attempted,
            "count": len(symbols_attempted),
            "claude_enabled": _is_claude_stage_enabled(),
        },
    )

    if not rows:
        finished_at = datetime.now(timezone.utc)
        result = PrewarmRunResult(
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=int((time.monotonic() - started_mono) * 1000),
            symbols_attempted=[],
            symbols_succeeded=[],
            claude_calls=0,
            estimated_cost_usd=0.0,
            skipped_reason="no_symbols_in_window",
        )
        logger.info("prewarm.end", extra=result.to_log_payload())
        return result

    sem = asyncio.Semaphore(max(1, concurrency))

    async def _bounded(row: dict[str, Any]) -> PrewarmSymbolResult:
        async with sem:
            return await _prewarm_symbol(
                symbol=row["symbol"],
                report_date_iso=row["report_date"],
                report_time=row["report_time"],
                company=row.get("company") or row["symbol"],
                sector=row.get("sector") or "Unknown",
                next_friday_expiry_iso=row.get("next_friday_expiry"),
            )

    per_symbol_results = await asyncio.gather(
        *(_bounded(r) for r in rows),
        return_exceptions=True,
    )

    succeeded: list[str] = []
    claude_calls = 0
    estimated_cost_usd = 0.0
    cleaned_per_symbol: list[PrewarmSymbolResult] = []
    for orig, outcome in zip(rows, per_symbol_results):
        if isinstance(outcome, Exception):
            logger.warning(
                "prewarm.symbol_failed",
                extra={
                    "event": "prewarm.symbol_failed",
                    "symbol": orig["symbol"],
                    "error": f"{type(outcome).__name__}: {outcome}",
                },
            )
            continue
        cleaned_per_symbol.append(outcome)
        if outcome.claude_cost_usd > 0:
            claude_calls += 1
            estimated_cost_usd += outcome.claude_cost_usd
        if all(s.ok for s in outcome.stages):
            succeeded.append(outcome.symbol)

    finished_at = datetime.now(timezone.utc)
    result = PrewarmRunResult(
        started_at=started_at,
        finished_at=finished_at,
        duration_ms=int((time.monotonic() - started_mono) * 1000),
        symbols_attempted=symbols_attempted,
        symbols_succeeded=succeeded,
        claude_calls=claude_calls,
        estimated_cost_usd=estimated_cost_usd,
        per_symbol=cleaned_per_symbol,
    )
    logger.info("prewarm.end", extra=result.to_log_payload())
    return result
