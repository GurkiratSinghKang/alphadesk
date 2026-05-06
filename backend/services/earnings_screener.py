"""Earnings Options Play aggregator — pulls FMP earnings, Alpaca options
chain + IV, Newsdata news, and Claude structured/full analysis into one
response shape. Routes in `api/routes/earnings.py` are thin wrappers.

This module contains:
  • pure-function helpers (expected move, historical stats) — Task 5
  • the main aggregators `list_upcoming`, `get_detail`, `run_full_research`
    — Task 8
  • Claude prompt assembly delegated to `services.earnings_prompts` — Task 6
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Mapping, Sequence

from core.time import market_now, market_today

log = logging.getLogger(__name__)

_CLAUDE_PROMPT_CACHE_VERSION = "v2-news-regime-expert"
_MARKET_REGIME_CACHE_TTL_SECONDS = 120
_MARKET_REGIME_ERROR_CACHE_TTL_SECONDS = 30
_market_regime_cache: tuple[float, str] | None = None


# Round-4 CLUSTER 4 #15: scrub FMP API keys out of any error string we log.
# FMP's HTTP client surfaces the URL with `apikey=...` in the message of
# raised httpx errors; that meant every transport failure dumped our
# secret into the structured log stream that ships to Loki. Apply the
# scrub to every `extra={"error": str(e)}` site that pipes from upstream.
_FMP_KEY_PATTERN = re.compile(r"(apikey|apiKey|api_key)=[^&\s\"']+", re.IGNORECASE)


def _scrub_fmp_error(s: str) -> str:
    """Redact ``apikey=...`` / ``apiKey=...`` / ``api_key=...`` query
    params from a string before it lands in a log line. The replacement
    keeps the param name so oncall can still tell what was scrubbed."""
    if not s:
        return s
    return _FMP_KEY_PATTERN.sub(lambda m: f"{m.group(1)}=REDACTED", s)


# Round-4 CLUSTER 1: report_state classification. Used at row build time
# so the frontend can dim AMC reports that have already printed without us
# silently filtering them out (which would make the calendar feel buggy).
_NY_BMO_CUTOFF_HOUR = 9   # 09:30 ET — BMO companies have printed by then
_NY_BMO_CUTOFF_MINUTE = 30
_NY_AMC_CUTOFF_HOUR = 16  # 16:30 ET — AMC reports out shortly after close
_NY_AMC_CUTOFF_MINUTE = 30
_NY_DMT_CUTOFF_HOUR = 16  # Unknown timing: keep visible through the session
_NY_DMT_CUTOFF_MINUTE = 30


def _classify_report_state(report_date: date, report_time: str) -> str:
    """Return one of ``"upcoming" | "today_pre" | "today_done" | "past"``.

    Round-4 CLUSTER 1 #5: post-09:30 ET on report day, BMO companies have
    already printed; post-16:30 ET, AMC reports are out. Today's row stays
    visible — the UI dims it via this state — while rows ≥ 2 days past
    are dropped at the call site. Yesterday's row stays visible for one
    day so a user opening the app at 08:00 ET still sees what reported
    yesterday afternoon (otherwise it'd vanish overnight at midnight UTC,
    which felt buggy).
    """
    today = market_today()
    if report_date > today:
        return "upcoming"
    if report_date == today:
        now = market_now()
        if report_time == "AMC":
            cutoff_h, cutoff_m = _NY_AMC_CUTOFF_HOUR, _NY_AMC_CUTOFF_MINUTE
        elif report_time == "BMO":
            cutoff_h, cutoff_m = _NY_BMO_CUTOFF_HOUR, _NY_BMO_CUTOFF_MINUTE
        else:
            # DMT is the provider's unconfirmed bucket, not a true "during
            # market" guarantee. Keep it visible through the regular session
            # so an unknown-time AMC-style report does not get hidden at
            # 09:30 ET.
            cutoff_h, cutoff_m = _NY_DMT_CUTOFF_HOUR, _NY_DMT_CUTOFF_MINUTE
        if (now.hour, now.minute) < (cutoff_h, cutoff_m):
            return "today_pre"
        return "today_done"
    # report_date < today
    return "past"


def _log_ctx(**kwargs: Any) -> dict[str, Any]:
    """Return an ``extra`` dict for log calls, filtering out ``None`` values.

    Wave B-67: the module previously emitted %-formatted log lines with no
    structured metadata. Log aggregators (Loki, CloudWatch) can't filter on
    free-form text, so oncall couldn't grep for a specific symbol or
    endpoint. This helper builds a JsonFormatter-compatible extras dict
    with a fixed ``event="earnings"`` anchor field plus whatever contextual
    keys the caller passes (``symbol``, ``endpoint``, ``window``, etc.).

    ``None`` values are dropped so an optional field (e.g. ``symbol`` at
    the calendar-level failure site) doesn't emit a noisy ``symbol: null``.
    """
    return {"event": "earnings", **{k: v for k, v in kwargs.items() if v is not None}}


# ─── Pure helpers ────────────────────────────────────────────

def compute_expected_move_from_straddle(
    *, underlying: float, call_mid: float, put_mid: float
) -> float | None:
    """Expected move % = ATM straddle mid / underlying price.

    Returns None if underlying is zero (guard against bad quote data).
    Returns 0.0 (not None) when both legs are zero — legit low-IV state.
    """
    if underlying <= 0:
        return None
    return (call_mid + put_mid) / underlying


def compute_vol_premium_score(
    expected_move_pct: float | None,
    hist_avg_abs_move_pct: float | None,
) -> float | None:
    """How much richer the implied move is vs. the realized history.

    Returns ``(em - hist) / max(hist, 0.005)``. The ``0.005`` floor keeps
    the ratio bounded when history is missing or near-zero — without it,
    a fresh-listing or a quiet name with hist=0.001 would blow up the
    score and flip every consumer's decision threshold.

    >= 0.15 ⇒ IV is at least 15% richer than realized → vol-selling edge.
    0.05–0.15 ⇒ IV is fair — modest edge.
    <  0.05 ⇒ IV ≈ realized — no edge, directional plays unjustified.
    None ⇒ either input was null / non-finite.
    """
    if expected_move_pct is None or hist_avg_abs_move_pct is None:
        return None
    try:
        em = float(expected_move_pct)
        hist = float(hist_avg_abs_move_pct)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(em) or not math.isfinite(hist):
        return None
    denom = max(hist, 0.005)
    return (em - hist) / denom


def compute_historical_stats(quarters: Sequence[Mapping]) -> dict:
    """Roll up per-quarter earnings history into screener summary stats.

    `quarters` is a list of dicts with keys: report_date, surprise_pct,
    next_day_move_pct, five_day_move_pct. Any subset is tolerated — missing
    keys contribute 0 where applicable.
    """
    if not quarters:
        return {
            "avg_abs_move_pct": 0.0,
            "wins": 0,
            "losses": 0,
            "surprise_beat_rate": 0.0,
        }
    moves = [q.get("next_day_move_pct", 0.0) for q in quarters]
    abs_moves = [abs(m) for m in moves]
    wins = sum(1 for m in moves if m > 0)
    losses = sum(1 for m in moves if m < 0)
    surprises = [q.get("surprise_pct") for q in quarters]
    beats = sum(1 for s in surprises if s is not None and s > 0)
    total_with_surprise = sum(1 for s in surprises if s is not None)
    beat_rate = beats / total_with_surprise if total_with_surprise else 0.0
    # Use half-up rounding for avg_abs_move_pct so display-level assertions
    # on round(x, 4) behave predictably (Python's built-in round() uses
    # half-even / banker's rounding, which produces surprising results on
    # exact midpoints like 0.06175).
    raw_avg = sum(abs_moves) / len(abs_moves)
    avg = math.floor(raw_avg * 10_000 + 0.5) / 10_000
    return {
        "avg_abs_move_pct": avg,
        "wins": wins,
        "losses": losses,
        "surprise_beat_rate": beat_rate,
    }


def compute_earnings_edge_score(
    *,
    iv_rank: float | None,
    premium_yield_call_atm: float | None,
    premium_yield_put_atm: float | None,
    expected_move_pct: float | None,
    hist_avg_abs_move_pct: float | None,
    claude_confidence: float | None,
    days_until: int | None,
    top_setup: str | None = None,
) -> dict:
    """Composite 0-100 ranking score for earnings-vol candidates.

    The score is intentionally simple and explainable. It rewards the
    conditions the suggested earnings setup needs. Premium-selling setups want
    elevated IV, rich ATM option premium, and implied move above prior realized
    earnings moves. Debit setups (long calls/puts, debit verticals, straddles)
    want the opposite: a debit that looks cheap versus historical report moves.
    The returned reasons are short enough to show in UI tooltips / cards.
    """

    def clamp(value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, value))

    score = 0.0
    reasons: list[str] = []
    # Wave 4a / Batch Q (Q-8): track each input's contribution to the
    # composite score so the analyst can audit which signals drove it.
    components: dict[str, float] = {}
    evidence_count = 0
    setup = (top_setup or "").strip().lower()
    setup_known = bool(setup)
    directional_debit_side = {
        "long call": "call",
        "bull call spread": "call",
        "long put": "put",
        "bear put spread": "put",
    }.get(setup)
    is_straddle_debit = setup == "long straddle"
    is_debit_setup = is_straddle_debit or directional_debit_side is not None

    if iv_rank is not None:
        # Batch U (A-1, A-2): IV regime breakpoints centralised in settings.
        from core.config import settings as _settings
        iv_rich = _settings.EARNINGS_IV_RICH_THRESHOLD
        iv_cheap = _settings.EARNINGS_IV_CHEAP_THRESHOLD
        iv = clamp(float(iv_rank), 0.0, 100.0)
        if not setup_known:
            iv_contrib = clamp(100.0 - abs(iv - 55.0) * 1.4, 0.0, 100.0) * 0.10
            reasons.append(f"IV rank {iv:.0f}; setup not selected yet")
        elif is_debit_setup:
            iv_contrib = (100.0 - iv) * 0.25
            if iv <= iv_cheap:
                reasons.append(f"IV rank {iv:.0f} keeps debit moderate")
        else:
            iv_contrib = iv * 0.35
            if iv >= iv_rich:
                reasons.append(f"IV rank {iv:.0f} keeps premium rich")
        score += iv_contrib
        components["iv_rank"] = round(iv_contrib, 2)
        evidence_count += 1

    premiums = [
        p for p in (premium_yield_call_atm, premium_yield_put_atm)
        if p is not None and p > 0
    ]
    if premiums:
        premium_evidence = True
        premium_contrib = 0.0
        if not setup_known:
            premium = max(float(p) for p in premiums)
            premium_contrib = clamp(premium / 0.06, 0.0, 1.0) * 10.0
            reasons.append(f"ATM option yield {premium:.1%}; needs setup")
        elif is_straddle_debit:
            debit = sum(float(p) for p in premiums)
            premium_contrib = clamp((0.10 - debit) / 0.08, 0.0, 1.0) * 20.0
            if debit <= 0.06:
                reasons.append(f"ATM straddle debit {debit:.1%}")
        elif directional_debit_side:
            side_premium = (
                premium_yield_call_atm
                if directional_debit_side == "call"
                else premium_yield_put_atm
            )
            if side_premium is not None and side_premium > 0:
                multiplier = 0.6 if "spread" in setup else 1.0
                debit = float(side_premium) * multiplier
                premium_contrib = clamp((0.06 - debit) / 0.05, 0.0, 1.0) * 20.0
                if debit <= 0.035:
                    reasons.append(f"{setup.title()} debit {debit:.1%}")
            else:
                premium_evidence = False
        else:
            premium = max(float(p) for p in premiums)
            premium_contrib = clamp(premium / 0.06, 0.0, 1.0) * 20.0
            reasons.append(f"ATM premium yield {premium:.1%}")
        score += premium_contrib
        components["premium_yield"] = round(premium_contrib, 2)
        if premium_evidence:
            evidence_count += 1

    if (
        expected_move_pct is not None
        and hist_avg_abs_move_pct is not None
        and hist_avg_abs_move_pct > 0
    ):
        expected = float(expected_move_pct)
        hist = float(hist_avg_abs_move_pct)
        implied_vs_hist_contrib = 0.0
        if not setup_known:
            mismatch = abs(expected - hist) / hist
            implied_vs_hist_contrib = clamp(mismatch / 0.5, 0.0, 1.0) * 15.0
            relation = "above" if expected > hist else "below"
            reasons.append(
                f"Implied move {relation} {hist:.1%} historical avg; setup pending"
            )
        elif is_debit_setup:
            underprice_ratio = (hist - expected) / expected if expected > 0 else 0.0
            if underprice_ratio > 0:
                implied_vs_hist_contrib = clamp(underprice_ratio / 0.5, 0.0, 1.0) * 35.0
                reasons.append(
                    f"Historical move {hist:.1%} clears debit {expected:.1%}"
                )
            else:
                overprice_ratio = (expected - hist) / hist
                implied_vs_hist_contrib = -clamp(overprice_ratio / 0.5, 0.0, 1.0) * 25.0
                reasons.append(
                    f"Debit {expected:.1%} above {hist:.1%} historical avg"
                )
        else:
            overprice_ratio = (expected - hist) / hist
            if overprice_ratio > 0:
                implied_vs_hist_contrib = clamp(overprice_ratio / 0.5, 0.0, 1.0) * 25.0
                reasons.append(
                    f"Implied move {expected:.1%} vs {hist:.1%} historical avg"
                )
            else:
                underprice_ratio = (hist - expected) / hist
                implied_vs_hist_contrib = -clamp(underprice_ratio / 0.5, 0.0, 1.0) * 25.0
                reasons.append(
                    f"Implied move {expected:.1%} below {hist:.1%} historical avg"
                )
        score += implied_vs_hist_contrib
        components["implied_vs_historical"] = round(implied_vs_hist_contrib, 2)
        evidence_count += 1

    if claude_confidence is not None:
        confidence = clamp(float(claude_confidence), 0.0, 1.0)
        confidence_contrib = confidence * 15.0
        score += confidence_contrib
        components["confidence"] = round(confidence_contrib, 2)
        evidence_count += 1
        if confidence >= 0.6:
            reasons.append(f"Claude confidence {confidence:.0%}")

    if evidence_count == 0:
        return {
            "edge_score": None,
            "edge_score_reasons": [],
            "edge_score_components": {},
        }

    if days_until is not None:
        days_contrib = 0.0
        if 0 <= days_until <= 3:
            days_contrib = 5.0
            reasons.append("Near-term event window")
        elif days_until < 0:
            days_contrib = -20.0
            reasons.append("Already reported; edge decays")
        if days_contrib != 0.0:
            score += days_contrib
            components["days_until"] = round(days_contrib, 2)

    if setup_known and (
        expected_move_pct is None
        or hist_avg_abs_move_pct is None
        or float(hist_avg_abs_move_pct) <= 0
    ):
        score = min(score, 60.0)
        reasons.insert(0, "Historical earnings move unavailable; edge capped")

    if not setup_known:
        score = min(score, 55.0)

    return {
        "edge_score": round(clamp(score, 0.0, 100.0), 1),
        "edge_score_reasons": reasons[:4],
        "edge_score_components": components,
    }


def _coerce_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return None if math.isnan(f) or math.isinf(f) else f


def _build_historical_quarters(
    surprises_df: Any,
    bars_df: Any,
    *,
    asof: date,
    limit: int = 8,
) -> list[dict]:
    """Join FMP earnings rows to daily bars and compute event moves.

    Without reliable historical BMO/AMC timestamps, use a conservative
    close-to-close event window: previous trading-session close to the
    next trading-session close after the report date.
    """
    if surprises_df is None or bars_df is None:
        return []
    if getattr(surprises_df, "empty", False) or getattr(bars_df, "empty", False):
        return []

    closes: list[tuple[date, float]] = []
    for row in bars_df.to_dict("records"):
        bar_date = _coerce_date(row.get("ts"))
        close = _safe_float(row.get("close"))
        if bar_date is not None and close is not None and close > 0:
            closes.append((bar_date, close))
    closes.sort(key=lambda item: item[0])
    if len(closes) < 2:
        return []

    events: list[dict] = []
    for row in surprises_df.to_dict("records"):
        event_date = _coerce_date(row.get("date"))
        if event_date is None or event_date >= asof:
            continue
        events.append({**row, "date": event_date})
    events.sort(key=lambda row: row["date"], reverse=True)

    quarters: list[dict] = []
    for event in events:
        event_date = event["date"]
        prev = [item for item in closes if item[0] < event_date]
        after = [item for item in closes if item[0] > event_date]
        if not prev or not after:
            continue
        pre_close = prev[-1][1]
        next_close = after[0][1]
        five_close = after[min(4, len(after) - 1)][1]
        if pre_close <= 0:
            continue
        quarters.append(
            {
                "report_date": event_date.isoformat(),
                "surprise_pct": _safe_float(event.get("surprise_pct")),
                "next_day_move_pct": (next_close - pre_close) / pre_close,
                "five_day_move_pct": (five_close - pre_close) / pre_close,
            }
        )
        if len(quarters) >= limit:
            break
    return quarters


async def _load_historical_earnings(
    symbol: str,
    report_date: date,
    *,
    lookback_quarters: int = 8,
) -> dict | None:
    """Load last earnings reactions from FMP surprises + adjusted daily bars."""
    from core.cache import get_cache

    cache_key = f"earnings:historical:{symbol}:{report_date.isoformat()}:{lookback_quarters}"
    cache = get_cache()
    cached = await cache.get(cache_key)
    if isinstance(cached, dict):
        return cached

    def _load_sync() -> dict | None:
        from data.providers.alpaca import AlpacaBarProvider
        from data.providers.fmp_earnings import FMPEarningsProvider

        start = report_date - timedelta(days=365 * 3)
        end = report_date - timedelta(days=1)
        with FMPEarningsProvider(timeout=15.0) as earnings_provider:
            surprises = earnings_provider.surprises(symbol, start, end)
        if getattr(surprises, "empty", True):
            return None

        event_dates = [
            d for d in (_coerce_date(v) for v in surprises["date"].tolist())
            if d is not None and d < report_date
        ]
        if not event_dates:
            return None

        bars_start = min(event_dates) - timedelta(days=10)
        bars_end = max(event_dates) + timedelta(days=10)
        with AlpacaBarProvider(timeout=20.0) as bar_provider:
            bars = bar_provider.bars([symbol], bars_start, bars_end, tf="1D")

        quarters = _build_historical_quarters(
            surprises,
            bars,
            asof=report_date,
            limit=lookback_quarters,
        )
        if not quarters:
            return None
        return {
            "quarters": quarters,
            "stats": compute_historical_stats(quarters),
        }

    try:
        payload = await asyncio.to_thread(_load_sync)
    except Exception as e:
        log.debug(
            "historical earnings load failed for %s: %s",
            symbol,
            _scrub_fmp_error(str(e)),
            extra=_log_ctx(
                endpoint="earnings._load_historical_earnings",
                symbol=symbol,
                error=_scrub_fmp_error(str(e)),
            ),
        )
        return None

    if payload:
        await cache.set(cache_key, payload, ttl_seconds=24 * 3600)
    return payload


def _recent_beats_misses(quarters: Sequence[Mapping]) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for q in quarters[:8]:
        report_date = str(q.get("report_date", ""))
        surprise = _safe_float(q.get("surprise_pct"))
        move = _safe_float(q.get("next_day_move_pct"))
        if surprise is None:
            surprise_text = "surprise n/a"
        else:
            surprise_text = f"{'beat' if surprise > 0 else 'miss' if surprise < 0 else 'inline'} {surprise:+.1%}"
        if move is not None:
            surprise_text = f"{surprise_text}; next-session {move:+.1%}"
        rows.append((report_date, surprise_text))
    return rows


def _ground_full_research_response(
    parsed: Mapping[str, Any],
    historical_quarters: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    """Drop Claude comparable setups that are not in the supplied history."""
    allowed_dates = {
        str(q.get("report_date"))
        for q in historical_quarters
        if q.get("report_date") is not None
    }
    out = dict(parsed)
    if not allowed_dates:
        out["comparable_setups"] = []
        return out

    grounded: list[dict[str, Any]] = []
    for item in parsed.get("comparable_setups", []) or []:
        if not isinstance(item, Mapping):
            continue
        report_date = str(item.get("report_date", ""))
        if report_date not in allowed_dates:
            continue
        row = dict(item)
        try:
            row["iv_rank"] = max(0.0, min(100.0, float(row.get("iv_rank", 0))))
        except (TypeError, ValueError):
            continue
        try:
            row["similarity_score"] = max(
                0.0,
                min(1.0, float(row.get("similarity_score", 0))),
            )
        except (TypeError, ValueError):
            row["similarity_score"] = 0.0
        grounded.append(row)
    out["comparable_setups"] = grounded
    return out


# ─── Schemas (local imports kept at call sites for lighter boot) ──

from api.schemas.earnings import (  # noqa: E402 — after helpers by design
    CalendarResponse,
    CalendarRow,
    ClaudeFullResearch,
    ClaudeStructured,
    EarningsDetail,
    HistoricalBlock,
    IVTermPoint,
    MetricsBlock,
    NewsArticle,
    QuoteBlock,
    SkewBlock,
    StrikeLadder,
)


# Round-4 CLUSTER 1 #3: NY-anchored window resolution. The user-reported
# bug ("only end-of-month dates showing") had its root here: the previous
# implementation used UTC date.today() with naive day-7 offsets, which
# meant a Friday-evening UTC call (Friday 20:00 ET → Saturday 01:00 UTC)
# silently shifted the entire week forward.
def _resolve_window_dates(window: str) -> tuple[date, date]:
    """Return (inclusive_start, inclusive_end) for the requested window.

    Anchors to NY market today and walks back to that week's Monday. On
    weekends, anchors to the upcoming Monday (no reports drop on Sat/Sun
    so showing "this week's" calendar with Mon-Fri of the just-finished
    week is misleading — the user wants what's NEXT). Mon-Fri only:
    options markets are closed Sat/Sun and FMP reports never land then.

    ``window``:
      - ``"current"`` → Mon-Fri of the active week (5 days)
      - ``"next"``    → next week's Mon-Fri (5 days)
      - ``"both"``    → 12 calendar days, two Mon-Fri windows together

    Round-12 / EC-1 (P1): on weekends we now ALSO include Friday of the
    just-finished week so AMC reports that printed Fri 16:30 ET stay
    visible Saturday morning. Pre-fix the weekend ``anchor`` jumped to
    next Monday, which narrowed the FMP fetch window to Mon-Fri of the
    upcoming week — Friday's AMC rows weren't fetched at all and the
    visibility filter never had a chance to keep them. Now ``current``
    / ``both`` start one Friday earlier on weekends; ``next`` is
    unchanged (it explicitly means "the week after today's").
    """
    today = market_today()
    weekday = today.weekday()
    # If we're on the weekend (Sat=5, Sun=6), advance to next week's Monday
    # rather than backing up to the just-finished week.
    if weekday >= 5:
        anchor = today + timedelta(days=(7 - weekday))
    else:
        anchor = today
    monday = anchor - timedelta(days=anchor.weekday())
    weekend = weekday >= 5
    if window == "current":
        # Round-12 / EC-1: include Friday of the prior week on weekends so
        # users see Friday's AMC reports they missed Friday afternoon.
        start = monday - timedelta(days=3) if weekend else monday
        end = monday + timedelta(days=4)  # Friday
    elif window == "next":
        start = monday + timedelta(days=7)
        end = monday + timedelta(days=11)  # next Friday
    else:  # both
        start = monday - timedelta(days=3) if weekend else monday
        end = monday + timedelta(days=11)  # spans this Mon → next Fri
    return start, end


def _format_window_label(start: date, end: date) -> str:
    """Locale-naive "Apr 27 – May 1, 2026"-style label for the response.

    Frontend reformats per-locale; we just hand back something readable in
    English. Same year gets one year suffix; cross-year gets both years.
    Use a regular hyphen rather than en-dash to keep the wire payload
    ASCII-safe (the frontend can swap to en-dash on render).
    """
    if start.year == end.year:
        return f"{start.strftime('%b %-d')} - {end.strftime('%b %-d, %Y')}"
    return f"{start.strftime('%b %-d, %Y')} - {end.strftime('%b %-d, %Y')}"


# Map FMP's announcement_when field (lowercase amc/bmo/unknown) → our
# ReportTime literal (BMO/AMC/DMT). "DMT" ("during market trading") is the
# schema's neutral bucket for anything we can't confidently classify.
_REPORT_TIME_MAP = {"amc": "AMC", "bmo": "BMO", "unknown": "DMT"}


# Curated universe of high-market-cap, deeply-liquid, options-heavy US names.
# Authoritative definition lives in ``backend/data/symbol_lists.py`` (Batch V).
# Re-exported here so existing importers continue to work.
#
# B-66: the filter is now unconditional (formerly gated on a vestigial
# `market_cap` query param that never did anything). If a user wants the
# full FMP feed they can hit the raw provider directly.
from data.symbol_lists import (  # noqa: E402 — re-export for back-compat
    BMO_AMC_FALLBACK_MAP as _CURATED_REPORT_TIME_FALLBACK,
    CURATED_OPTIONABLE_UNIVERSE,
    HEADLINE_EARNINGS_SYMBOLS as _HEADLINE_EARNINGS_SYMBOLS,
)


def _in_curated_universe(symbol: str) -> bool:
    """Case-insensitive membership check for the curated universe."""
    return symbol.upper() in CURATED_OPTIONABLE_UNIVERSE


# The calendar is a decision surface, not a raw feed. FMP's
# /earnings-calendar endpoint can roll same-day AMC reports off the feed
# soon after they print, while /earnings still keeps the event row. Rescue
# a small headline/default-watchlist subset from that per-symbol endpoint
# so crowded mega-cap days don't show as if MSFT/AMZN/GOOG never reported.
_HEADLINE_SYMBOL_RANK: dict[str, int] = {
    symbol: idx for idx, symbol in enumerate(_HEADLINE_EARNINGS_SYMBOLS)
}
_HEADLINE_REPORT_TIME_DEFAULTS: dict[str, str] = {
    symbol: "AMC" for symbol in _HEADLINE_EARNINGS_SYMBOLS
}


def _resolve_report_time(symbol: str, fmp_value: str | None) -> str:
    """Return the BMO/AMC/DMT classification for ``symbol``.

    Trust order:
      1. FMP's ``announcement_when`` when it is BMO or AMC (live signal).
      2. Curated static fallback (Batch P / P-4) for symbols with a
         stable pattern across quarters — used when FMP says "unknown"
         (which we receive as "DMT") or returns null.
      3. "DMT" as a last resort so the schema's ReportTime literal
         remains valid.

    Case-insensitive on inputs; output is uppercase as required by the
    schema's ``ReportTime`` Literal.
    """
    sym = (symbol or "").upper()
    fmp_norm = (fmp_value or "").strip().upper()
    if fmp_norm in {"AMC", "BMO"}:
        return fmp_norm
    fallback = _CURATED_REPORT_TIME_FALLBACK.get(sym)
    if fallback in {"AMC", "BMO"}:
        return fallback
    return "DMT"


# Audit-r5 (B2.34): map the schema's ReportTime literal to a
# human-readable chip label. ``DMT`` is FMP's upstream "unknown" bucket
# and surfaces verbatim in the FE today, which confuses non-options
# users (industry-standard codes are BMO / AMC only). The mapping is
# also used for tooltips so the user sees both the standard code and
# the long-form description.
REPORT_TIME_DISPLAY: dict[str, str] = {
    "BMO": "Before market open",
    "AMC": "After market close",
    "DMT": "Time TBD",
}


def format_report_time_label(report_time: str | None) -> str:
    """Return the human-readable chip label for a report_time code.

    Falls back to "Time TBD" when the input is null/empty/unknown so the
    chip never renders the raw acronym (which the user reported as
    confusing — see audit-r5 B2.34).
    """
    if not report_time:
        return REPORT_TIME_DISPLAY["DMT"]
    return REPORT_TIME_DISPLAY.get(report_time.upper(), REPORT_TIME_DISPLAY["DMT"])


def _symbol_display_priority(symbol: str) -> int:
    """Lower numbers should appear first within the same report day."""
    return _HEADLINE_SYMBOL_RANK.get(symbol.upper(), len(_HEADLINE_SYMBOL_RANK) + 100)


def _coerce_report_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except (TypeError, ValueError):
        return None


def _calendar_candidate_priority(row: Mapping[str, Any], today: date) -> tuple:
    """Rank raw calendar rows before the hydration cap is applied.

    Today's events are the highest-value screen real estate, followed by
    yesterday's retained post-earnings rows, then future rows. Within a
    report date, headline symbols win over lower-priority names so a busy
    earnings day cannot hide the names users most expect to see.
    """
    symbol = str(row.get("symbol") or "").upper()
    report_date = _coerce_report_date(row.get("report_date"))
    if report_date is None:
        return (99, date.max, _symbol_display_priority(symbol), symbol)
    days_until = (report_date - today).days
    if days_until == 0:
        bucket = 0
    elif days_until == -1:
        bucket = 1
    elif days_until > 0:
        bucket = 2
    else:
        bucket = 3
    return (
        bucket,
        abs(days_until),
        report_date,
        _symbol_display_priority(symbol),
        symbol,
    )


def _merge_calendar_rows(primary: Sequence[dict], rescued: Sequence[dict]) -> list[dict]:
    """Append rescued rows that are missing from the primary calendar feed."""
    merged = list(primary)
    seen = {
        (
            str(row.get("symbol") or "").upper(),
            str(row.get("report_date") or ""),
        )
        for row in merged
    }
    for row in rescued:
        key = (
            str(row.get("symbol") or "").upper(),
            str(row.get("report_date") or ""),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(row)
    return merged


# ─── Upstream adapters (thin wrappers; fan-outs call these) ──

# Round-4 CLUSTER 5 #16: per-window cache + thundering-herd guard. The
# upcoming-calendar fetch cost ~2-4 FMP calls per page-load before this;
# with a curated universe of ~150 names and a typical user reload cadence
# of 30s, the FMP rate limit was a real risk. Redis-backed so multiple
# workers hit the same data; the in-process locks prevent N concurrent
# refills on cold-cache.
_FMP_UPCOMING_LOCKS: dict[str, asyncio.Lock] = {}
_FMP_RESCUE_LOCKS: dict[str, asyncio.Lock] = {}


def _fmp_upcoming_ttl_s() -> int:
    """Batch U (A-4): TTL for the FMP upcoming-earnings calendar cache."""
    from core.config import settings as _settings
    return int(_settings.FMP_CALENDAR_CACHE_TTL_SECONDS)


def _fmp_rescue_ttl_s() -> int:
    """Batch U (A-5): TTL for the per-symbol FMP rescue cache."""
    from core.config import settings as _settings
    return int(_settings.FMP_RESCUE_CACHE_TTL_SECONDS)


def _fmp_upcoming_cache_key(window: str, start: date, end: date) -> str:
    """Cache-key includes the resolved date range so a window-boundary
    crossing (e.g. 23:55 ET → 00:05 ET) doesn't serve yesterday's data."""
    return f"earnings:fmp:upcoming:{window}:{start.isoformat()}:{end.isoformat()}"


def _fmp_rescue_cache_key(
    window: str,
    start: date,
    end: date,
    symbols: Sequence[str],
) -> str:
    joined = ",".join(sorted({s.upper() for s in symbols}))
    return f"earnings:fmp:rescue:{window}:{start.isoformat()}:{end.isoformat()}:{joined}"


async def _fmp_upcoming(window: str) -> list[dict]:
    """Return FMP earnings calendar rows for the requested window.

    `window`: 'current' = this week, 'next' = next week, 'both' = union.
    Wraps the existing :class:`data.providers.fmp_earnings.FMPEarningsProvider`.

    Round-4 CLUSTER 1 #3: window dates are NY-anchored Mon-Fri; see
    :func:`_resolve_window_dates`. Round-4 CLUSTER 5 #16: result is
    cached in Redis for 5 minutes with an asyncio.Lock guard against
    thundering-herd refills on cold cache.

    The provider is synchronous (returns a pandas DataFrame) so we offload
    the call to a worker thread with :func:`asyncio.to_thread`. Rows are
    flattened to the shape the aggregator expects
    (``symbol``, ``company``, ``sector``, ``report_date``, ``report_time``).

    ``company`` and ``sector`` are NOT part of FMP's calendar payload — we
    pass ``symbol`` as a placeholder for ``company`` and an empty string
    for ``sector``. Task 25 (smoke-test) will cross-reference these with
    a dedicated profile endpoint if needed; the aggregator already
    tolerates empty/placeholder values.
    """
    from core.cache import get_cache
    from core.config import settings
    from data.providers.fmp_earnings import FMPEarningsProvider

    # QA r2 fix: FMP's `/earnings-calendar?from=…&to=…` endpoint silently
    # truncates wide-range responses around the ~3200-row mark — see the
    # captured bug where window=both (15 days) returned 3233 rows missing
    # AMD/PLTR/etc that the narrower window=current (8 days) had returned
    # cleanly. Union the two narrower queries when "both" is requested so
    # we never lose curated names to upstream truncation.
    if window == "both":
        current_rows = await _fmp_upcoming("current")
        next_rows = await _fmp_upcoming("next")
        merged = _merge_calendar_rows(current_rows, next_rows)
        # Cache the merged result under the "both" key so subsequent
        # requests skip the merge work. Cache TTL matches the upstream
        # (5 min) so a refresh of "current" or "next" propagates here.
        cache = get_cache()
        merged_start, merged_end = _resolve_window_dates("both")
        merged_key = _fmp_upcoming_cache_key("both", merged_start, merged_end)
        if not settings.SKIP_EARNINGS_FMP_CACHE:
            await cache.set(merged_key, merged, ttl_seconds=_fmp_upcoming_ttl_s())
        return merged

    start, end = _resolve_window_dates(window)
    cache = get_cache()
    cache_key = _fmp_upcoming_cache_key(window, start, end)

    # Round-5 Cluster E E-6: settings flag replaces the previous
    # ``PYTEST_CURRENT_TEST`` env-var heuristic. The env-var was risky
    # because anyone sourcing a dev .env into prod would silently
    # leak the cache-skip behaviour; the explicit flag at least surfaces
    # the override on a routine settings audit. Flipped True from
    # backend/tests/conftest.py for the test session.
    in_test = settings.SKIP_EARNINGS_FMP_CACHE
    if not in_test:
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return cached

    # Per-window asyncio.Lock prevents the thundering-herd on cold cache:
    # without it, N concurrent requests would each fire a fresh FMP call,
    # blow through the rate limit, then all write the same value back.
    #
    # Round-7 / SVC-1: previously keyed on ``window`` only, but the
    # cache key includes the resolved ``(start, end)`` dates. Around
    # the ET window-boundary (23:55 → 00:05) two coroutines sharing
    # ``window="current"`` would resolve to DIFFERENT date pairs, hold
    # the same lock, but write to different cache keys — so the second
    # waiter still fired a fresh FMP call, defeating the dedup the
    # comment claims to provide. Key the lock on the resolved cache
    # key so single-flight semantics actually hold across rollover.
    lock = _FMP_UPCOMING_LOCKS.setdefault(cache_key, asyncio.Lock())

    def _load() -> list[dict]:
        # Timeout operator-tunable via ``settings.EARNINGS_FMP_TIMEOUT_S``
        # (B-85). Default 5.0s balances provider flakiness vs UI p95.
        with FMPEarningsProvider(
            timeout=settings.EARNINGS_FMP_TIMEOUT_S
        ) as provider:
            df = provider.calendar(start=start, end=end)
        if df is None or df.empty:
            return []
        out: list[dict] = []
        for _, item in df.iterrows():
            symbol = item.get("symbol")
            if not symbol:
                continue
            symbol_str = str(symbol)
            # FMP returns GLOBAL earnings — foreign exchanges (.L, .TO, .V,
            # .CN, .PA, etc.) and OTC pink sheets that Alpaca can't quote.
            # Filter to plain US-listed tickers: 1-5 uppercase letters,
            # allowing a single-letter share-class suffix after a dot
            # (e.g. BRK.B, BRK.A, RDS.A). Anything longer than 5 chars
            # (typically 5-letter pinks like XTRRF) gets dropped —
            # saves ~400 pointless 404s per calendar fetch. We permit `.`
            # and strip it before checking isalpha() so legit share-class
            # tickers aren't filtered out alongside foreign suffixes, which
            # are caught separately via the curated universe filter.
            if len(symbol_str) > 5 or not symbol_str.replace(".", "").isalpha():
                continue
            report_date_val = item.get("date")
            if report_date_val is None:
                continue
            report_time_raw = (item.get("announcement_when") or "unknown").lower()
            fmp_resolved = _REPORT_TIME_MAP.get(report_time_raw, "DMT")
            # Batch P / P-4: overlay the curated AMC/BMO fallback when
            # FMP returns "unknown" (DMT). Keeps the FE chip honest for
            # symbols whose timing is stable across quarters even when
            # FMP hasn't yet refreshed the row.
            out.append({
                "symbol": symbol_str,
                "company": symbol_str,  # FMP /earnings-calendar has no name
                "sector": "",
                "report_date": (
                    report_date_val.isoformat()
                    if hasattr(report_date_val, "isoformat")
                    else str(report_date_val)
                ),
                "report_time": _resolve_report_time(symbol_str, fmp_resolved),
            })
        # B-45: FMP occasionally returns duplicate rows for the same
        # (symbol, report_date) — once as the preliminary listing and
        # again after an update. Dedup preserving first-seen order so
        # downstream hydration doesn't do redundant Alpaca calls.
        seen: set[tuple[str, str]] = set()
        deduped: list[dict] = []
        for r in out:
            k = (r["symbol"], r["report_date"])
            if k in seen:
                continue
            seen.add(k)
            deduped.append(r)
        return deduped

    async with lock:
        # Re-check after acquiring the lock — a sibling task may have
        # populated the cache while we waited.
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return cached
        try:
            # B-80: cap the worker-thread wait so a stalled FMP call can't
            # starve the asyncio thread pool. 5s is generous vs. the typical
            # <1s response; on timeout we re-raise so the outer catch marks
            # the response partial with an empty calendar.
            rows = await asyncio.wait_for(asyncio.to_thread(_load), timeout=5.0)
        except asyncio.TimeoutError:
            log.warning("FMP upcoming fetch timed out for window=%s", window)
            raise
        except Exception as e:
            log.warning(
                "FMP upcoming fetch failed for window=%s: %s",
                window,
                _scrub_fmp_error(str(e)),
                extra=_log_ctx(
                    endpoint="earnings._fmp_upcoming",
                    window=window,
                    error=_scrub_fmp_error(str(e)),
                ),
            )
            raise
        if not in_test:
            await cache.set(cache_key, rows, ttl_seconds=_fmp_upcoming_ttl_s())
        return rows


async def _fmp_headline_earnings_rescue(
    window: str,
    *,
    extra_symbols: Sequence[str] | None = None,
) -> list[dict]:
    """Rescue high-priority rows missing from /earnings-calendar.

    FMP's calendar endpoint is optimized for upcoming events. On the day
    after a high-profile AMC report, or even the evening it prints, that
    endpoint can omit the row while the per-symbol /earnings endpoint still
    has it. We use this small, cached per-symbol pass only for headline
    names and explicit watchlist symbols, bounded to yesterday/today/tomorrow.
    """
    from core.cache import get_cache
    from core.config import settings
    from data.providers.fmp_earnings import FMPEarningsProvider

    today = market_today()
    window_start, window_end = _resolve_window_dates(window)
    rescue_start = max(window_start, today - timedelta(days=1))
    rescue_end = min(window_end, today + timedelta(days=1))
    if rescue_start > rescue_end:
        return []

    symbols: list[str] = []
    seen: set[str] = set()
    for raw in (*_HEADLINE_EARNINGS_SYMBOLS, *(extra_symbols or ())):
        symbol = str(raw or "").strip().upper()
        if not symbol or symbol in seen or not _in_curated_universe(symbol):
            continue
        seen.add(symbol)
        symbols.append(symbol)
        # Keep the cold-cache worst case bounded. The headline set always
        # fits; only very large explicit watchlists are truncated.
        if len(symbols) >= max(16, len(_HEADLINE_EARNINGS_SYMBOLS)):
            break

    if not symbols:
        return []

    if settings.SKIP_EARNINGS_FMP_CACHE:
        return []

    cache_key = _fmp_rescue_cache_key(window, rescue_start, rescue_end, symbols)
    cache = get_cache()
    cached = await cache.get(cache_key)
    if isinstance(cached, list):
        return cached

    def _load() -> list[dict]:
        rows: list[dict] = []
        with FMPEarningsProvider(timeout=settings.EARNINGS_FMP_TIMEOUT_S) as provider:
            for symbol in symbols:
                try:
                    df = provider.surprises(
                        symbol,
                        start=rescue_start,
                        end=rescue_end,
                    )
                except Exception as e:
                    log.debug(
                        "FMP headline earnings rescue failed for %s: %s",
                        symbol,
                        _scrub_fmp_error(str(e)),
                        extra=_log_ctx(
                            endpoint="earnings._fmp_headline_earnings_rescue",
                            symbol=symbol,
                            error=_scrub_fmp_error(str(e)),
                        ),
                    )
                    continue
                if df is None or df.empty:
                    continue
                for _, item in df.iterrows():
                    report_date_obj = _coerce_report_date(item.get("date"))
                    if (
                        report_date_obj is None
                        or report_date_obj < rescue_start
                        or report_date_obj > rescue_end
                    ):
                        continue
                    # Batch P / P-4: prefer the headline default, fall
                    # through to the curated overlay if not a headline name.
                    headline_default = _HEADLINE_REPORT_TIME_DEFAULTS.get(symbol)
                    rows.append({
                        "symbol": symbol,
                        "company": symbol,
                        "sector": "",
                        "report_date": report_date_obj.isoformat(),
                        "report_time": (
                            headline_default
                            or _resolve_report_time(symbol, None)
                        ),
                    })
        return rows

    lock = _FMP_RESCUE_LOCKS.setdefault(cache_key, asyncio.Lock())
    async with lock:
        cached = await cache.get(cache_key)
        if isinstance(cached, list):
            return cached
        try:
            timeout = max(2.0, settings.EARNINGS_FMP_TIMEOUT_S * 2)
            rows = await asyncio.wait_for(asyncio.to_thread(_load), timeout=timeout)
            await cache.set(cache_key, rows, ttl_seconds=_fmp_rescue_ttl_s())
            return rows
        except asyncio.TimeoutError:
            log.warning(
                "FMP headline earnings rescue timed out for window=%s symbols=%s",
                window,
                symbols,
            )
        except Exception as e:
            log.warning(
                "FMP headline earnings rescue failed for window=%s: %s",
                window,
                _scrub_fmp_error(str(e)),
                extra=_log_ctx(
                    endpoint="earnings._fmp_headline_earnings_rescue",
                    window=window,
                    error=_scrub_fmp_error(str(e)),
                ),
            )
    return []


async def _load_quote(symbol: str) -> dict | None:
    from services.ticker_context import get_ticker_fact

    try:
        fact = await get_ticker_fact(symbol, "quote", on_stale="allow_with_warning")
        q = fact.value
        if not isinstance(q, dict):
            return None
        return {
            "last": float(q.get("last") or 0),
            "change": float(q.get("change") or 0),
            "change_pct": float(q.get("changePct", q.get("change_pct", 0)) or 0),
            "timestamp": q.get("timestamp") or fact.freshness.as_of,
        }
    except Exception as e:
        # B-69: demoted to DEBUG. During an Alpaca outage this was
        # emitting one WARN per symbol (800+ over a 5-min outage); the
        # real alerting signal is the single summary WARN at the end of
        # ``list_upcoming``.
        log.debug(
            "quote load failed for %s: %s",
            symbol,
            e,
            extra=_log_ctx(
                endpoint="earnings._load_quote",
                symbol=symbol,
                error=str(e),
            ),
        )
        return None


def _filter_chain(chain: Any, option_type: str) -> list:
    """Split `OptionChain.contracts` by option_type since the plan
    references ``chain.calls`` / ``chain.puts`` which do not exist on the
    actual :class:`api.routes.options.OptionChain` model.
    """
    return [c for c in chain.contracts if getattr(c.option_type, "value", c.option_type) == option_type]


def _select_event_expiry(
    expirations: Sequence[Any],
    report_date: date | None = None,
    report_time: str | None = None,
) -> date | None:
    """Pick the option expiry that actually captures the earnings event."""
    parsed: list[date] = []
    for exp in expirations:
        if isinstance(exp, date):
            parsed.append(exp)
        elif isinstance(exp, str):
            try:
                parsed.append(date.fromisoformat(exp))
            except ValueError:
                continue
    if not parsed:
        return None
    parsed = sorted(set(parsed))
    if report_date is None:
        return parsed[0]

    # AMC reports print after same-day options expire, so the first usable
    # expiry is strictly after the report date. BMO/DMT events can be captured
    # by same-day expiry if it exists.
    floor = report_date + timedelta(days=1) if (report_time or "").upper() == "AMC" else report_date
    for exp in parsed:
        if exp >= floor:
            return exp
    return None


def _contracts_for_expiry(chain: Any, expiry: date | None) -> list:
    contracts = list(getattr(chain, "contracts", []) or [])
    if expiry is None:
        return contracts
    # Older unit-test doubles predate OptionContract.expiry. Treat those rows
    # as matching the selected expiry so tests can keep minimal stubs, while
    # real chains are filtered strictly.
    return [c for c in contracts if getattr(c, "expiry", expiry) == expiry]


def _option_mid(contract: Any | None) -> float:
    """Return the best usable mid for a single option contract."""
    if contract is None:
        return 0.0
    try:
        bid = float(getattr(contract, "bid", 0) or 0)
        ask = float(getattr(contract, "ask", 0) or 0)
        last = float(getattr(contract, "last", 0) or 0)
    except (TypeError, ValueError):
        return 0.0
    if bid > 0 and ask > 0:
        return (bid + ask) / 2
    if bid > 0:
        return bid
    if ask > 0:
        return ask
    return last if last > 0 else 0.0


def _prior_moves_from_metrics(metrics: Mapping[str, Any] | None) -> list[float] | None:
    """SHR-5: extract historical post-earnings move pcts from metrics.

    The historical-quarters payload (loaded by ``_load_historical_earnings``)
    carries ``next_day_move_pct`` per quarter; that's the post-earnings
    reaction. Convert to a flat ``list[float]`` for the recommender's
    empirical-POP path.
    """
    if not metrics:
        return None
    quarters = metrics.get("historical_quarters") or []
    if not isinstance(quarters, (list, tuple)) or not quarters:
        return None
    out: list[float] = []
    for q in quarters:
        if not isinstance(q, Mapping):
            continue
        m = q.get("next_day_move_pct")
        if m is None:
            continue
        try:
            out.append(float(m))
        except (TypeError, ValueError):
            continue
    return out or None


def _sample_kurtosis(xs: Sequence[float]) -> float | None:
    """Plain-old sample excess-kurtosis estimator. ``None`` if n<4.

    Returns the *non-excess* kurtosis (m4/m2^2). A pure normal sample
    converges to 3. The recommender's threshold (>4) is "fatter than
    that". Avoids importing scipy.stats.kurtosis here to keep this file
    light.
    """
    if not xs or len(xs) < 4:
        return None
    n = len(xs)
    mean = sum(xs) / n
    m2 = sum((x - mean) ** 2 for x in xs) / n
    if m2 <= 0:
        return None
    m4 = sum((x - mean) ** 4 for x in xs) / n
    return float(m4 / (m2 * m2))


def _iv_term_steepness(metrics: Mapping[str, Any] | None) -> float | None:
    """SHR-5: ``IV[front] / IV[back] - 1`` if a 2-point term is available.

    Uses the smallest-DTE expiry as front and the next as back. Only
    interpretable when there are at least 2 expiries; returns None otherwise.
    """
    if not metrics:
        return None
    term = metrics.get("term_structure") if isinstance(metrics, Mapping) else None
    if not isinstance(term, Mapping) or not term:
        return None
    parsed: list[tuple[date, float]] = []
    for k, v in term.items():
        try:
            d = date.fromisoformat(str(k))
            parsed.append((d, float(v)))
        except (TypeError, ValueError):
            continue
    if len(parsed) < 2:
        return None
    parsed.sort(key=lambda p: p[0])
    front_iv = parsed[0][1]
    back_iv = parsed[1][1]
    if back_iv <= 0:
        return None
    return float(front_iv / back_iv - 1.0)


def _build_tail_risk_signals(
    *,
    quote: Mapping[str, Any] | None,
    metrics: Mapping[str, Any] | None,
    prior_moves: Sequence[float] | None,
    sector_cohort_momentum_avg: float | None = None,
    analyst_pt_changes_24h: int = 0,
    news_sentiment: float | None = None,
    underlying_relative_volume: float | None = None,
    options_call_put_volume_skew: float | None = None,
    unusual_options_activity: bool = False,
) -> Any:
    """SHR-5: assemble :class:`TailRiskSignals` from already-loaded data.

    Sources used:
      * ``intraday_momentum_pct`` — derived from ``quote["change_pct"]``
        which is in 0-100 scale (1.45 → 1.45%). We convert to fraction
        (0.0145).
      * ``historical_move_kurtosis`` — sample kurtosis of prior_moves
        when n≥4; ``None`` otherwise.
      * ``iv_term_steepness`` — front/back IV ratio from metrics.
      * ``sector_cohort_momentum_avg`` (TR-2), ``analyst_pt_changes_24h``
        (TR-3), and ``news_sentiment`` (TR-4) — passed in by the async
        wrapper :func:`_build_tail_risk_signals_async` after it fetches
        them upstream. Default to "no signal" when not provided so the
        sync surface stays usable from existing call sites and tests.
      * ``underlying_relative_volume`` (Wave V V3) — quote volume / 20d
        ADV. Provided by the async wrapper after it inspects the quote
        and pulls the rolling baseline; ``None`` means no signal.
      * ``options_call_put_volume_skew`` (Wave V V3) — total chain call
        volume / max(put volume, 1). Provided by the async wrapper.
      * ``unusual_options_activity`` (Wave V V3) — bool flagged when
        today's chain volume > 3× the rolling 20-day average. Provided
        by the async wrapper after the time-series append/read cycle.
    """
    from api.schemas.earnings import TailRiskSignals

    intraday: float | None = None
    if isinstance(quote, Mapping):
        cp = quote.get("change_pct")
        if cp is not None:
            try:
                # Quote.changePct is in 0-100 scale (1.45 = 1.45%); convert.
                intraday = float(cp) / 100.0
            except (TypeError, ValueError):
                intraday = None

    kurt: float | None = None
    if prior_moves and len(prior_moves) >= 4:
        try:
            kurt = _sample_kurtosis([float(m) for m in prior_moves])
        except (TypeError, ValueError):
            kurt = None

    return TailRiskSignals(
        intraday_momentum_pct=intraday,
        sector_cohort_momentum_avg=sector_cohort_momentum_avg,
        analyst_pt_changes_24h=analyst_pt_changes_24h,
        news_sentiment=news_sentiment,
        historical_move_kurtosis=kurt,
        iv_term_steepness=_iv_term_steepness(metrics),
        underlying_relative_volume=underlying_relative_volume,
        options_call_put_volume_skew=options_call_put_volume_skew,
        unusual_options_activity=unusual_options_activity,
    )


# ─── TR-2 .. TR-4: async signal fetchers ─────────────────────
#
# These three feed the sync :func:`_build_tail_risk_signals` so the
# recommender sees a richer ``TailRiskSignals`` payload. Each fetcher is
# best-effort: any upstream failure logs at WARNING and returns the
# "no signal" value (None for floats, 0 for ints) so the screener never
# crashes a calendar entry over a flaky data source.

# Cache TTL for analyst PT lookups (1h per symbol — FMP changes <hourly).
_PT_CHANGES_CACHE_TTL_SECONDS = 3600

# Cache TTL for news sentiment (15min — sentiment can shift fast around
# breaking headlines, but Newsdata cache key is symbol-shared).
_NEWS_SENTIMENT_CACHE_TTL_SECONDS = 900


async def _compute_sector_cohort_momentum(symbol: str) -> float | None:
    """TR-2: average intraday change_pct of related-sector tickers.

    Returns the cohort average as a fraction (0.0145 = 1.45%) so the
    recommender's threshold (>0.02) compares apples to apples with
    intraday_momentum_pct (also a fraction). Returns ``None`` when the
    symbol has no cohort entry or every cohort fetch failed.
    """
    from data.symbol_lists import SECTOR_COHORT

    cohort = SECTOR_COHORT.get(symbol.upper())
    if not cohort:
        return None

    # Fetch each peer's quote in parallel via the existing _load_quote
    # path (pulls from ticker_context cache so this is mostly hits).
    results = await asyncio.gather(
        *[_load_quote(peer) for peer in cohort],
        return_exceptions=True,
    )
    pcts: list[float] = []
    for r in results:
        if isinstance(r, Exception) or not isinstance(r, Mapping):
            continue
        cp = r.get("change_pct")
        if cp is None:
            continue
        try:
            pcts.append(float(cp))
        except (TypeError, ValueError):
            continue
    if not pcts:
        return None
    # change_pct is in 0-100 scale; divide to align with the recommender's
    # fraction-scale threshold (>0.02 = 2%).
    return float(sum(pcts) / len(pcts) / 100.0)


async def _fetch_analyst_pt_changes_24h(symbol: str) -> int:
    """TR-3: net count of analyst PT raises minus cuts in last 24h.

    Hits FMP ``/v4/upgrades-downgrades?symbol=…``. Cached per symbol
    (1h TTL) so a busy calendar render doesn't burn FMP rate budget on
    duplicate lookups across rerenders.

    Returns 0 on any upstream/parsing failure — that maps to the
    recommender's "no signal" threshold (>0).
    """
    import httpx

    from core.config import settings
    from core.redis import cache_get, cache_set

    sym = symbol.upper()
    cache_k = f"earnings:tr:pt_changes:{sym}"
    cached = await cache_get(cache_k)
    if isinstance(cached, int):
        return cached

    api_key = settings.FMP_API_KEY.get_secret_value() if settings.FMP_API_KEY else ""
    if not api_key:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.FMP_BASE_URL}/api/v4/upgrades-downgrades",
                params={"symbol": sym, "apikey": api_key},
            )
            if resp.status_code != 200:
                log.debug(
                    "FMP upgrades-downgrades non-200 for %s: %s",
                    sym, resp.status_code,
                    extra=_log_ctx(
                        endpoint="earnings._fetch_analyst_pt_changes_24h",
                        symbol=sym, status=resp.status_code,
                    ),
                )
                await cache_set(cache_k, 0, ttl_seconds=_PT_CHANGES_CACHE_TTL_SECONDS)
                return 0
            data = resp.json()
    except Exception as e:  # noqa: BLE001
        log.warning(
            "PT changes fetch failed for %s: %s", sym, _scrub_fmp_error(str(e)),
            extra=_log_ctx(
                endpoint="earnings._fetch_analyst_pt_changes_24h",
                symbol=sym, error=_scrub_fmp_error(str(e)),
            ),
        )
        return 0

    if not isinstance(data, list):
        await cache_set(cache_k, 0, ttl_seconds=_PT_CHANGES_CACHE_TTL_SECONDS)
        return 0

    bullish_terms = ("buy", "outperform", "overweight", "upgrade", "positive", "strong buy")
    bearish_terms = ("sell", "underperform", "underweight", "downgrade", "negative")
    net = 0
    for entry in data:
        if not isinstance(entry, Mapping):
            continue
        ts = _parse_pt_publish_ts(entry.get("publishedDate"))
        if ts is None or ts < cutoff:
            continue
        # Prefer ``action`` field when present (some FMP responses use
        # it); fall back to newGrade/previousGrade comparison heuristic.
        action_raw = (entry.get("action") or entry.get("newGrade") or "").lower()
        if any(t in action_raw for t in bullish_terms):
            net += 1
        elif any(t in action_raw for t in bearish_terms):
            net -= 1
    await cache_set(cache_k, net, ttl_seconds=_PT_CHANGES_CACHE_TTL_SECONDS)
    return net


def _parse_pt_publish_ts(value: Any) -> datetime | None:
    """Best-effort parse of FMP's ``publishedDate`` field.

    FMP returns ISO-8601 with a ``Z`` suffix (``2026-05-04T15:32:00.000Z``)
    or ``YYYY-MM-DD HH:MM:SS`` depending on endpoint. Treat naive datetimes
    as UTC so the 24h-cutoff comparison works.
    """
    if not value or not isinstance(value, str):
        return None
    try:
        s = value.strip().replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def _compute_news_sentiment_24h(symbol: str) -> float | None:
    """TR-4: -1 (bearish) to +1 (bullish) news sentiment over last 24h.

    Uses the existing :func:`services.news.fetch_symbol_news` which
    returns articles with a string ``sentiment`` field
    (``"positive"``/``"negative"``/``"neutral"``). Maps each to ±1/0,
    averages over the window. Falls back to keyword polarity if no
    article carries a sentiment field.

    Returns ``None`` when there's no news in the 24h window — the
    recommender treats None as no-signal so a quiet day doesn't
    accidentally read bearish.
    """
    from core.redis import cache_get, cache_set

    sym = symbol.upper()
    cache_k = f"earnings:tr:news_sent:{sym}"
    cached = await cache_get(cache_k)
    if cached is not None:
        # cache_set serialises as float or None; re-cast defensively.
        if isinstance(cached, (int, float)):
            return float(cached)
        if cached == "none":
            return None

    try:
        from services.news import fetch_symbol_news

        resp = await fetch_symbol_news(sym, limit=30)
    except Exception as e:  # noqa: BLE001
        log.warning(
            "News sentiment fetch failed for %s: %s", sym, str(e),
            extra=_log_ctx(
                endpoint="earnings._compute_news_sentiment_24h",
                symbol=sym, error=str(e),
            ),
        )
        return None

    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent: list[Any] = []
    for art in (getattr(resp, "articles", []) or []):
        ts = _parse_pt_publish_ts(getattr(art, "published_at", None))
        if ts is None:
            # Newsdata uses "YYYY-MM-DD HH:MM:SS" — try the other parser.
            ts = _try_parse_news_ts(getattr(art, "published_at", None))
        if ts is None or ts < cutoff:
            continue
        recent.append(art)

    if not recent:
        await cache_set(cache_k, "none", ttl_seconds=_NEWS_SENTIMENT_CACHE_TTL_SECONDS)
        return None

    # Path 1: API-provided sentiment — average of the per-article scores.
    # B2.1: ``services/news.py`` now emits "bullish" / "bearish" /
    # "neutral" (heuristic) instead of the upstream Newsdata
    # "positive" / "negative" / "neutral" labels. Accept either
    # vocabulary so older cached responses + new ones both work.
    string_scores: list[float] = []
    has_directional = False
    for a in recent:
        s = getattr(a, "sentiment", None)
        if isinstance(s, str):
            sl = s.lower()
            if sl in ("positive", "bullish"):
                string_scores.append(1.0)
                has_directional = True
            elif sl in ("negative", "bearish"):
                string_scores.append(-1.0)
                has_directional = True
            elif sl == "neutral":
                string_scores.append(0.0)
    # B2.1: only trust Path 1 when at least one article carried a
    # *directional* signal. If every article is "neutral" we'd return
    # 0.0 — but neutral can also be the heuristic's default for
    # mid-confidence headlines where the keywords-of-titles fallback
    # often disambiguates better. Fall through to Path 2 in that case.
    if string_scores and has_directional:
        avg = float(sum(string_scores) / len(string_scores))
        # Clamp defensively.
        avg = max(-1.0, min(1.0, avg))
        await cache_set(cache_k, avg, ttl_seconds=_NEWS_SENTIMENT_CACHE_TTL_SECONDS)
        return avg

    # Path 2: keyword polarity fallback.
    bullish_words = {"beat", "raise", "outperform", "upgrade", "bullish",
                     "surge", "soar", "growth", "rally", "record"}
    bearish_words = {"miss", "cut", "underperform", "downgrade", "bearish",
                     "plunge", "decline", "loss", "warning", "fraud"}
    raw = 0
    for a in recent:
        text = ((getattr(a, "title", "") or "") + " "
                + (getattr(a, "description", "") or "")).lower()
        raw += sum(1 for w in bullish_words if w in text)
        raw -= sum(1 for w in bearish_words if w in text)
    score = max(-1.0, min(1.0, raw / max(len(recent), 1)))
    await cache_set(cache_k, score, ttl_seconds=_NEWS_SENTIMENT_CACHE_TTL_SECONDS)
    return float(score)


def _try_parse_news_ts(value: Any) -> datetime | None:
    """Newsdata returns ``"YYYY-MM-DD HH:MM:SS"`` as the published_at.

    The ISO parser accepts that as a naive datetime (no T separator); we
    just need to assume UTC if no tz info attached.
    """
    if not value or not isinstance(value, str):
        return None
    try:
        dt = datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


# ─── TR-5 (Wave V V3): volume signals ─────────────────────────
#
# Three signals split between the underlying and the options chain:
#   * underlying_relative_volume — today's underlying volume / 20-day ADV
#   * options_call_put_volume_skew — total call vol / max(total put vol, 1)
#   * unusual_options_activity — total chain volume > 3× rolling 20d avg
#
# The 20-day chain-volume baseline lives in Redis as a per-symbol JSON
# list of ``[date_iso, total_volume]`` pairs (mirrors the IV-history
# pattern from Batch P). Each successful read also appends today's
# observation, trimming to the last 20 trading-day entries. The list
# is persistent (TTL=0) so the rolling average survives restarts.

# Cap the time-series at 20 entries and idempotent-append once per day:
# a second hit on the same UTC date overwrites the prior day's entry
# rather than double-counting. Picked 20 because that's the standard
# "monthly" trading window — enough samples for a stable mean without
# letting stale prints from 2 months ago skew the baseline.
_OPTIONS_VOLUME_HISTORY_MAX_ENTRIES = 20
_OPTIONS_VOLUME_HISTORY_KEY_PREFIX = "earnings:tr:options_vol_hist:"
# Threshold for the recommender's bool: 3× the rolling avg = unusual.
_UNUSUAL_OPTIONS_ACTIVITY_MULTIPLE = 3.0


def _total_chain_volume(chain: Any) -> tuple[int, int, int]:
    """Sum per-contract volumes across calls, puts, and total.

    Returns ``(total, calls, puts)``. Defensive against ``None``
    contracts / missing volume fields — a busted chain row contributes
    0 rather than aborting the whole signal.
    """
    contracts = getattr(chain, "contracts", None) or []
    calls = 0
    puts = 0
    for c in contracts:
        try:
            v = int(getattr(c, "volume", 0) or 0)
        except (TypeError, ValueError):
            continue
        if v <= 0:
            continue
        otype = getattr(c, "option_type", None)
        otype_val = getattr(otype, "value", otype)
        if otype_val == "call":
            calls += v
        elif otype_val == "put":
            puts += v
    return calls + puts, calls, puts


def _underlying_relative_volume_from_quote(
    quote: Mapping[str, Any] | None,
) -> float | None:
    """Pull ``relative_volume`` directly from the quote payload (Wave V V1).

    The Wave V V1 work adds a ``relative_volume`` field to the quote
    shape produced by :func:`_load_quote` (volume / 20-day ADV). Until
    that field lands the lookup returns ``None`` and the signal stays
    silent — graceful degradation, no recomputation here.
    """
    if not isinstance(quote, Mapping):
        return None
    rv = quote.get("relative_volume")
    if rv is None:
        return None
    try:
        rvf = float(rv)
    except (TypeError, ValueError):
        return None
    if rvf <= 0:
        return None
    return rvf


async def _compute_options_volume_signals(
    symbol: str,
    *,
    chain: Any | None,
) -> tuple[float | None, bool]:
    """TR-5: compute options call/put skew and unusual-activity flag.

    Returns ``(skew, unusual)`` where:
      * ``skew`` = total_call_volume / max(total_put_volume, 1) when the
        chain has at least one volume entry; ``None`` otherwise.
      * ``unusual`` = True iff today's total chain volume > 3× the
        rolling 20-day average for ``symbol``. Requires at least 5
        prior entries in the time-series before flagging unusual (so a
        cold cache doesn't trigger spurious flags on day 1).

    Side effect: appends today's ``(YYYY-MM-DD, total_volume)`` pair
    into Redis at ``earnings:tr:options_vol_hist:{SYM}``, trimmed to
    the last 20 entries. The list is persistent (TTL=0) so the rolling
    baseline survives container restarts.
    """
    from core.redis import cache_get, cache_set

    if chain is None:
        return None, False

    total, calls, puts = _total_chain_volume(chain)
    skew: float | None = None
    if total > 0:
        # max(puts, 1) avoids div-zero — when a name is purely calls the
        # ratio is just the call volume itself, which still reads as
        # extreme skew (>2.0) for the recommender.
        skew = float(calls) / float(max(puts, 1))

    if total <= 0:
        # Nothing to record / no signal. Returning skew (which may be
        # None) keeps the no-signal contract intact.
        return skew, False

    sym = symbol.upper()
    cache_k = f"{_OPTIONS_VOLUME_HISTORY_KEY_PREFIX}{sym}"

    history: list[tuple[str, int]] = []
    try:
        raw = await cache_get(cache_k)
    except Exception as e:  # noqa: BLE001 — cache read is best-effort
        log.debug(
            "options-vol history read failed for %s: %s", sym, e,
            extra=_log_ctx(
                endpoint="earnings._compute_options_volume_signals",
                symbol=sym, error=str(e),
            ),
        )
        raw = None
    if isinstance(raw, list):
        for entry in raw:
            # Each entry is a [date_iso, volume] pair; defensively
            # tolerate the wrong shape so a bad cache write doesn't
            # propagate forever (the trim step rewrites the list).
            if (
                isinstance(entry, (list, tuple))
                and len(entry) == 2
                and isinstance(entry[0], str)
            ):
                try:
                    history.append((str(entry[0]), int(entry[1])))
                except (TypeError, ValueError):
                    continue

    today_iso = datetime.now(timezone.utc).date().isoformat()
    # Idempotent append: replace today's entry if already present so
    # multiple calendar renders on the same day don't double-count.
    history = [(d, v) for (d, v) in history if d != today_iso]
    history.append((today_iso, int(total)))
    # Trim to the last N entries (most-recent on the right).
    if len(history) > _OPTIONS_VOLUME_HISTORY_MAX_ENTRIES:
        history = history[-_OPTIONS_VOLUME_HISTORY_MAX_ENTRIES:]

    # Persist (TTL=0 → no expiry; baseline must survive restarts).
    try:
        await cache_set(cache_k, history, ttl_seconds=0)
    except Exception as e:  # noqa: BLE001 — cache write is best-effort
        log.debug(
            "options-vol history write failed for %s: %s", sym, e,
            extra=_log_ctx(
                endpoint="earnings._compute_options_volume_signals",
                symbol=sym, error=str(e),
            ),
        )

    # Flag unusual only when we have enough prior days for a stable
    # baseline (5 prior entries — today's entry isn't its own baseline).
    prior = [v for (d, v) in history if d != today_iso]
    unusual = False
    if len(prior) >= 5:
        avg = sum(prior) / len(prior)
        if avg > 0 and float(total) > _UNUSUAL_OPTIONS_ACTIVITY_MULTIPLE * avg:
            unusual = True
    return skew, unusual


async def _build_tail_risk_signals_async(
    symbol: str,
    *,
    quote: Mapping[str, Any] | None,
    metrics: Mapping[str, Any] | None,
    prior_moves: Sequence[float] | None,
    chain: Any | None = None,
) -> Any:
    """TR-1: async wrapper that fans out to TR-2/TR-3/TR-4/TR-5 fetchers,
    then delegates to the sync :func:`_build_tail_risk_signals` for
    assembly.

    Each fetcher is exception-safe — a single failed source becomes a
    "no signal" value rather than killing the whole calendar entry.

    ``chain`` (Wave V V3) is the already-loaded options chain. When not
    provided the volume signals stay silent (graceful degradation for
    older call sites and tests).
    """
    cohort_t = asyncio.create_task(_compute_sector_cohort_momentum(symbol))
    pt_t = asyncio.create_task(_fetch_analyst_pt_changes_24h(symbol))
    sent_t = asyncio.create_task(_compute_news_sentiment_24h(symbol))
    # TR-5: options volume signals — only fan out when a chain is
    # available; otherwise hand back the no-signal default tuple.
    vol_t = asyncio.create_task(
        _compute_options_volume_signals(symbol, chain=chain)
    )

    cohort_r, pt_r, sent_r, vol_r = await asyncio.gather(
        cohort_t, pt_t, sent_t, vol_t, return_exceptions=True,
    )

    cohort_avg = cohort_r if isinstance(cohort_r, (int, float)) else None
    pt_changes = int(pt_r) if isinstance(pt_r, (int, float)) else 0
    sentiment = sent_r if isinstance(sent_r, (int, float)) else None
    if isinstance(vol_r, tuple) and len(vol_r) == 2:
        skew_r, unusual_r = vol_r
        skew = float(skew_r) if isinstance(skew_r, (int, float)) else None
        unusual = bool(unusual_r)
    else:
        skew = None
        unusual = False

    return _build_tail_risk_signals(
        quote=quote,
        metrics=metrics,
        prior_moves=prior_moves,
        sector_cohort_momentum_avg=cohort_avg,
        analyst_pt_changes_24h=pt_changes,
        news_sentiment=sentiment,
        underlying_relative_volume=_underlying_relative_volume_from_quote(quote),
        options_call_put_volume_skew=skew,
        unusual_options_activity=unusual,
    )


async def _load_metrics(
    symbol: str,
    report_date: date | None = None,
    report_time: str | None = None,
    expiry: date | None = None,
    client_host: str | None = None,  # B-33 — accepted for API parity; unused today
) -> dict | None:
    from services.ticker_context import LoadedFact, get_custom_ticker_fact

    report_key = report_date.isoformat() if report_date else "unknown"
    expiry_key = expiry.isoformat() if expiry else "auto"
    time_key = (report_time or "DMT").upper()
    fact_key = f"earnings_options:{report_key}:{time_key}:{expiry_key}"

    async def _loader() -> LoadedFact:
        value = await _compute_metrics_uncached(
            symbol,
            report_date=report_date,
            report_time=report_time,
            expiry=expiry,
            client_host=client_host,
        )
        if value is None:
            raise ValueError(f"earnings options metrics unavailable for {symbol}")
        as_of = (
            datetime(report_date.year, report_date.month, report_date.day, tzinfo=timezone.utc)
            if report_date
            else datetime.now(timezone.utc)
        )
        return LoadedFact(
            value=value,
            as_of=as_of,
            source="demo" if value.get("chain_is_demo") or value.get("iv_is_demo") else "earnings_options_metrics",
            stale_after_seconds=300,
            is_demo=bool(value.get("chain_is_demo") or value.get("iv_is_demo")),
        )

    try:
        fact = await get_custom_ticker_fact(
            symbol,
            namespace="earnings",
            key=fact_key,
            source="earnings_options_metrics",
            stale_after_seconds=300,
            loader=_loader,
            on_stale="allow_with_warning",
        )
        if not isinstance(fact.value, dict):
            return None
        value = dict(fact.value)
        if isinstance(value.get("option_expiry"), str):
            try:
                value["option_expiry"] = date.fromisoformat(value["option_expiry"])
            except ValueError:
                pass
        return value
    except Exception:
        log.debug("ticker-context metrics path failed for %s; falling back", symbol, exc_info=True)
        return await _compute_metrics_uncached(
            symbol,
            report_date=report_date,
            report_time=report_time,
            expiry=expiry,
            client_host=client_host,
        )


async def _compute_metrics_uncached(
    symbol: str,
    report_date: date | None = None,
    report_time: str | None = None,
    expiry: date | None = None,
    client_host: str | None = None,  # B-33 — accepted for API parity; unused today
) -> dict | None:
    from services.options import fetch_chain, fetch_iv_analysis

    try:
        iv = await fetch_iv_analysis(symbol)
        chain = await fetch_chain(symbol, expiry=expiry)
        chain_expirations = getattr(chain, "expirations", []) or []
        selected_expiry = expiry or _select_event_expiry(
            chain_expirations,
            report_date=report_date,
            report_time=report_time,
        )
        if expiry is None and selected_expiry is not None:
            try:
                chain = await fetch_chain(symbol, expiry=selected_expiry)
            except Exception:
                # The unfiltered chain already has the contracts. If the
                # provider rejects the narrower request, filter locally rather
                # than falling back to mixed-expiry math.
                log.debug("event-expiry chain refetch failed for %s", symbol, exc_info=True)
        underlying = chain.spot_price
        no_valid_event_expiry = (
            report_date is not None
            and selected_expiry is None
            and bool(chain_expirations)
        )
        event_contracts = [] if no_valid_event_expiry else _contracts_for_expiry(chain, selected_expiry)
        event_chain = type("_EventChain", (), {"contracts": event_contracts})()
        calls = _filter_chain(event_chain, "call")
        puts = _filter_chain(event_chain, "put")
        atm_call = min(calls, key=lambda c: abs(c.strike - underlying), default=None)
        atm_put = min(puts, key=lambda p: abs(p.strike - underlying), default=None)

        # Batch P / P-2 + P-3: when an event-spanning expiry cannot be
        # selected (e.g. the report falls on a non-listed expiry, or the
        # chain truncates earlier), fall back to the FRONT-MONTH expiry
        # for the expected-move and yield calculations. The values are
        # less precise (they capture move risk over a wider window than
        # just the event), but a correctly-flagged front-month estimate
        # is far more useful to the user than a null. We still leave
        # ``selected_expiry`` / ``option_expiry`` pointing at the
        # event-spanning value so trade-link routing isn't fooled into
        # using the wrong contracts. Calendar consumers display the
        # ``expected_move_pct`` independently of the deep-link expiry.
        if (atm_call is None or atm_put is None) and chain_expirations:
            front_expiry = chain_expirations[0] if isinstance(
                chain_expirations[0], date
            ) else None
            try:
                if isinstance(chain_expirations[0], str):
                    front_expiry = date.fromisoformat(chain_expirations[0])
            except (ValueError, TypeError):
                front_expiry = None
            if front_expiry is not None:
                front_contracts = _contracts_for_expiry(chain, front_expiry)
                front_chain = type("_FrontChain", (), {"contracts": front_contracts})()
                front_calls = _filter_chain(front_chain, "call")
                front_puts = _filter_chain(front_chain, "put")
                if atm_call is None:
                    atm_call = min(
                        front_calls,
                        key=lambda c: abs(c.strike - underlying),
                        default=None,
                    )
                if atm_put is None:
                    atm_put = min(
                        front_puts,
                        key=lambda p: abs(p.strike - underlying),
                        default=None,
                    )

        em_pct = None
        call_mid = _option_mid(atm_call)
        put_mid = _option_mid(atm_put)
        premium_yield_call_atm = None
        premium_yield_put_atm = None
        if atm_call and atm_put and underlying > 0:
            em_pct = compute_expected_move_from_straddle(
                underlying=underlying,
                call_mid=call_mid,
                put_mid=put_mid,
            )
        if atm_call and underlying > 0:
            premium_yield_call_atm = call_mid / underlying
        if atm_put and underlying > 0:
            premium_yield_put_atm = put_mid / underlying
        today = market_today()
        days_to_earnings = (report_date - today).days if report_date else None
        days_to_expiry = (selected_expiry - today).days if selected_expiry else None
        # Round-4 CLUSTER 3 #11: hv_iv_ratio is None whenever either input
        # is missing. Real-data IV now returns hv_20=None until the
        # historical-vol pipeline lands; making the ratio None is more
        # honest than dividing whatever-we-have by current_iv.
        if iv.hv_20 is not None and iv.current_iv:
            hv_iv_ratio = iv.hv_20 / iv.current_iv
        else:
            hv_iv_ratio = None
        historical = None
        if report_date is not None:
            historical = await _load_historical_earnings(symbol, report_date)
        historical_stats = historical.get("stats") if historical else {}
        if not isinstance(historical_stats, dict):
            historical_stats = {}
        hist_avg = historical_stats.get("avg_abs_move_pct")
        return {
            "iv_rank": iv.iv_rank,
            "iv_percentile": iv.iv_percentile,
            "current_iv": iv.current_iv,
            "hv_20": iv.hv_20,
            "hv_50": iv.hv_50,
            "hv_100": iv.hv_100,
            "hv_iv_ratio": hv_iv_ratio,
            "expected_move_pct": em_pct,
            "expected_move_dollars": em_pct * underlying if em_pct is not None else None,
            "premium_yield_call_atm": premium_yield_call_atm,
            "premium_yield_put_atm": premium_yield_put_atm,
            # SHR-5: surface IV term so the recommender can compute
            # `iv_term_steepness` for the tail-risk overlay.
            "term_structure": dict(iv.term_structure or {}),
            "hist_avg_abs_move_pct": hist_avg,
            "vol_premium_score": compute_vol_premium_score(em_pct, hist_avg),
            "beat_rate": historical_stats.get("surprise_beat_rate"),
            "historical_stats": historical_stats,
            "historical_quarters": historical.get("quarters", []) if historical else [],
            "days_to_earnings": days_to_earnings,
            "days_to_expiry": days_to_expiry,
            "option_expiry": selected_expiry,
            "chain_is_demo": bool(getattr(chain, "is_demo", False)),
            "iv_is_demo": bool(getattr(iv, "is_demo", False)),
        }
    except Exception as e:
        # B-69: demoted to DEBUG — a provider outage would otherwise emit
        # one WARN per symbol in the hydrate loop. The single aggregated
        # WARN at the end of ``list_upcoming`` is the real oncall signal.
        log.debug(
            "metrics load failed for %s: %s",
            symbol,
            _scrub_fmp_error(str(e)),
            extra=_log_ctx(
                endpoint="earnings._load_metrics",
                symbol=symbol,
                error=_scrub_fmp_error(str(e)),
            ),
        )
        return None


def _historical_block_from_metrics(metrics: Mapping[str, Any] | None) -> HistoricalBlock | None:
    """Build a ``HistoricalBlock`` from either the metrics-cache shape or
    the dedicated ``_load_historical_earnings`` shape.

    Batch P / P-6: previously this only recognised the metrics-cache shape
    (``historical_quarters`` / ``historical_stats`` flat keys). The
    dedicated historical-earnings fetch returns ``{"quarters": [...],
    "stats": {...}}`` instead, which silently produced ``None`` and
    blanked ``prior_moves`` on the detail page. Both shapes are accepted
    now so the get_detail fallback path actually populates the block.
    """
    if not isinstance(metrics, Mapping):
        return None
    # Prefer the flat metrics-cache key, fall back to the nested key.
    quarters = metrics.get("historical_quarters")
    if not isinstance(quarters, list):
        nested = metrics.get("quarters")
        if isinstance(nested, list):
            quarters = nested
    if not isinstance(quarters, list) or not quarters:
        return None
    stats = metrics.get("historical_stats")
    if not isinstance(stats, Mapping):
        nested_stats = metrics.get("stats")
        if isinstance(nested_stats, Mapping):
            stats = nested_stats
    if not isinstance(stats, Mapping):
        stats = compute_historical_stats(quarters)
    payload = {
        "quarters": quarters,
        "stats": {
            "avg_abs_move_pct": stats.get("avg_abs_move_pct", 0.0),
            "wins": stats.get("wins", 0),
            "losses": stats.get("losses", 0),
            "surprise_beat_rate": stats.get("surprise_beat_rate", 0.0),
            "iv_vs_hist_vol_points": stats.get("iv_vs_hist_vol_points"),
        },
    }
    return HistoricalBlock(**payload)


async def _load_strike_ladder(
    symbol: str,
    expiry: date | None,
    report_date: date | None = None,
    report_time: str | None = None,
) -> dict | None:
    """Pull ATM / 30Δ / 15Δ rows (both sides) from the OPRA chain."""
    from services.options import fetch_chain

    try:
        chain = await fetch_chain(symbol, expiry=expiry)
        chain_expirations = getattr(chain, "expirations", []) or []
        resolved_expiry = expiry or _select_event_expiry(
            chain_expirations,
            report_date=report_date,
            report_time=report_time,
        )
        if expiry is None and resolved_expiry is not None:
            try:
                chain = await fetch_chain(symbol, expiry=resolved_expiry)
            except Exception:
                log.debug("event-expiry ladder refetch failed for %s", symbol, exc_info=True)
        underlying = chain.spot_price
        if report_date is not None and resolved_expiry is None and chain_expirations:
            return None
        event_contracts = _contracts_for_expiry(chain, resolved_expiry)
        event_chain = type("_EventChain", (), {"contracts": event_contracts})()
        calls = _filter_chain(event_chain, "call")
        puts = _filter_chain(event_chain, "put")
        rows: list[dict] = []
        # Round-8 visual-bug SL1: previously every bucket selected by
        # ``abs(c.delta or 0.5) - target_delta``. Two problems:
        # 1. ``c.delta or 0.5`` collapses a legitimate ``delta == 0``
        #    (deep-OTM contract or chain whose delta column is missing /
        #    unpopulated) into 0.5, making that contract the BEST match
        #    for ATM (target=0.5). On COP this picked a strike-60 call
        #    on a $121 underlying — far from ATM.
        # 2. The 30Δ / 15Δ buckets had the same false-positive on
        #    delta=0 contracts.
        # Fix:
        #   * ATM is now nearest-strike-to-spot — robust when delta is
        #     unreliable (this is also the textbook ATM definition).
        #   * 30Δ / 15Δ exclude contracts whose delta is missing or
        #     exactly zero before the min() so we never anchor on a
        #     mis-quoted leg.
        def _has_delta(c) -> bool:
            return c.delta is not None and abs(c.delta) > 1e-6

        def _pick_atm(side_contracts):
            return min(
                side_contracts,
                key=lambda c: abs(c.strike - underlying),
                default=None,
            )

        def _pick_by_delta(side_contracts, target):
            usable = [c for c in side_contracts if _has_delta(c)]
            return min(
                usable,
                key=lambda c: abs(abs(c.delta) - target),
                default=None,
            )

        for bucket, target_delta in [("ATM", 0.5), ("30Δ", 0.3), ("15Δ", 0.15)]:
            if bucket == "ATM":
                call_match = _pick_atm(calls)
                put_match = _pick_atm(puts)
            else:
                call_match = _pick_by_delta(calls, target_delta)
                put_match = _pick_by_delta(puts, target_delta)
            for side, contract in [("call", call_match), ("put", put_match)]:
                if contract is None:
                    continue
                # Round-7 / SVC-3: a one-sided 0 quote is legitimate on
                # illiquid wings (no bid OR no ask, the other side is
                # real). The previous form fell through to ``last or 0``
                # the moment EITHER side was 0, dropping a real-but-
                # one-sided quote down to ``mid=0`` and then surfacing
                # the contract as "zero premium" in the strike ladder
                # sort. Treat exactly-zero on one side as a quote
                # absence and fall back to the live side; if both are
                # absent, last is the next best.
                bid = float(contract.bid or 0)
                ask = float(contract.ask or 0)
                if bid > 0 and ask > 0:
                    mid = (bid + ask) / 2
                elif bid > 0:
                    mid = bid
                elif ask > 0:
                    mid = ask
                else:
                    mid = float(contract.last or 0)
                yield_pct = mid / underlying if underlying > 0 else 0.0
                pop = max(0.0, min(1.0, 1 - abs(contract.delta or 0.5)))
                # Wave V V1-3: forward the contract's volume_oi_ratio
                # if the chain populated it; otherwise compute on the fly
                # from the row's volume + OI so older code paths that
                # build OptionContract dicts directly still emit the
                # field. ``None`` only when both volume and OI are zero.
                row_vol = int(contract.volume or 0)
                row_oi = int(contract.open_interest or 0)
                row_vol_oi = getattr(contract, "volume_oi_ratio", None)
                if row_vol_oi is None and (row_vol > 0 or row_oi > 0):
                    row_vol_oi = round(float(row_vol) / max(float(row_oi), 1.0), 4)
                rows.append({
                    "strike": contract.strike,
                    "expiry": getattr(contract, "expiry", resolved_expiry),
                    "side": side,
                    "bucket": bucket,
                    "delta": contract.delta or 0,
                    "bid": contract.bid or 0,
                    "ask": contract.ask or 0,
                    "mid": mid,
                    "iv": contract.iv or 0,
                    "yield_pct": yield_pct,
                    "pop": pop,
                    "theta": contract.theta or 0,
                    "gamma": contract.gamma or 0,
                    "vega": contract.vega or 0,
                    "oi": row_oi,
                    "volume": row_vol,
                    "volume_oi_ratio": row_vol_oi,
                })
        resolved_expiry = resolved_expiry or (
            chain.expirations[0] if chain.expirations else market_today()
        )
        # Round-5 Cluster A E-1: thread the underlying chain's demo flag
        # through to the wire schema. ``getattr`` defends against test
        # mocks that don't set the attribute — old fixtures pre-dating
        # the OptionChain.is_demo addition shouldn't 500 the route just
        # because they passed a stub object.
        return {
            "expiry": resolved_expiry,
            "underlying_price": underlying,
            "rows": rows,
            "fetched_at": getattr(chain, "fetched_at", None),
            "is_demo": bool(getattr(chain, "is_demo", False)),
        }
    except Exception as e:
        log.warning("strike ladder load failed for %s: %s", symbol, e)
        return None


# Round-4 CLUSTER 2 #7: in-flight task de-dup. Without this, every
# concurrent /detail request for the same symbol on a cold cache fires
# a fresh structured-Claude call. At ~$0.05/call and a curated universe
# of ~150 names, that's a real burn on a cache reset. The dict maps
# `f"{symbol}:{report_date}"` -> the in-flight Task; subsequent callers
# `await` the same Task instead of creating a new one.
#
# Round-5 Cluster B G-11/E-4: the dedup map below is now guarded by an
# asyncio.Lock for the get-or-create sequence, and the done-callback
# identity-compares the dict's current value against the completing
# task before popping. Without the lock, two coroutines could both see
# ``existing is None`` and both create tasks; without the identity
# check, a successor task could be wiped from the dict by its
# predecessor's cleanup callback.
_inflight_structured: dict[str, asyncio.Task[dict | None]] = {}
# Round-7 / BE-2: same single-flight pattern for the *Opus* full-
# research path. Two concurrent ``POST /full-research`` requests for
# the same symbol previously each spawned a paid Opus call on cold
# cache, doubling the spend without any speed-up. We dedup keyed on
# ``f"{symbol}:{report_date}"`` mirroring the structured-call dict.
_inflight_full_research: dict[str, "asyncio.Task[ClaudeFullResearch]"] = {}
_INFLIGHT_LOCK: asyncio.Lock | None = None
# Round-7 / SVC-2: track the loop the lock was built against so we
# can rebuild on a loop swap. Production runs a single persistent
# loop so this stays a no-op there; pytest-asyncio (function scope)
# spins up a fresh loop per test and the previous singleton would
# surface a stale-loop lock that raised on first acquire.
_INFLIGHT_LOCK_LOOP: asyncio.AbstractEventLoop | None = None


def _get_inflight_lock() -> asyncio.Lock:
    """Return the module-level lock, creating it lazily.

    asyncio.Lock binds its internal waiter queue to the running event
    loop on first acquire, so we can't safely instantiate at module-
    import time (test runners spin up fresh loops per session). Lazy
    creation keeps the first construction inside the running loop.

    Round-7 / SVC-2: also rebuild when the loop changes since last
    construction. The lock instance is the same across calls within
    one loop's lifetime — preserving the existing test contract that
    repeated calls return the same object.
    """
    global _INFLIGHT_LOCK, _INFLIGHT_LOCK_LOOP
    try:
        running_loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None
    if (
        _INFLIGHT_LOCK is None
        or (running_loop is not None and _INFLIGHT_LOCK_LOOP is not running_loop)
    ):
        _INFLIGHT_LOCK = asyncio.Lock()
        _INFLIGHT_LOCK_LOOP = running_loop
    return _INFLIGHT_LOCK


async def _load_claude_structured(symbol: str, context: dict) -> dict | None:
    """Read from cache; on miss, run-and-await the Claude call (de-duped
    across concurrent requests) so the user sees data on first load.

    Round-4 CLUSTER 2 #7: previously this fired the call as a background
    task and returned ``None`` — meaning the user got no Claude content
    on the first detail load and had to refresh. The fire-and-forget was
    also a cost vector: N concurrent requests for the same symbol on a
    cold cache each spawned an independent task. Now we de-dup via
    :data:`_inflight_structured` and await the result.

    Round-5 Cluster B G-11/E-4: the get-or-create sequence is gated by
    ``_INFLIGHT_LOCK`` so two coroutines racing on a cold cache can't
    both observe ``existing is None`` and both spawn a paid Claude call.
    The done-callback also identity-compares ``_inflight_structured[k]``
    against the completing task before popping — covers the case where
    a successor task replaces ours in the dict and our done-callback
    would otherwise wipe it on cleanup.
    """
    from core.cache import get_cache

    cache = get_cache()
    key = (
        f"earnings:claude-structured:{_CLAUDE_PROMPT_CACHE_VERSION}:"
        f"{symbol}:{context['report_date']}"
    )
    cached = await cache.get(key)
    if cached:
        return cached

    inflight_key = f"{symbol}:{context['report_date']}"
    lock = _get_inflight_lock()
    async with lock:
        task = _inflight_structured.get(inflight_key)
        if task is None or task.done():
            task = asyncio.create_task(
                _run_structured_and_cache(symbol, context, cache, key)
            )
            _inflight_structured[inflight_key] = task

            def _done(t: asyncio.Task, k: str = inflight_key) -> None:
                # Identity-compare so we never wipe a successor task
                # that replaced us in the dict (Round-5 G-11/E-4).
                if _inflight_structured.get(k) is t:
                    _inflight_structured.pop(k, None)

            task.add_done_callback(_done)
    try:
        return await task
    except Exception:
        # The task already logged at DEBUG; surface None to the caller so
        # the detail panel still renders without the Claude block.
        return None


async def _load_claude_structured_cached(symbol: str, report_date: date | str) -> dict | None:
    """Read calendar-safe Claude structured data without creating a paid call."""
    from core.cache import get_cache

    report_key = report_date.isoformat() if hasattr(report_date, "isoformat") else str(report_date)
    cache = get_cache()
    cached = await cache.get(
        f"earnings:claude-structured:{_CLAUDE_PROMPT_CACHE_VERSION}:"
        f"{symbol}:{report_key}"
    )
    return cached if isinstance(cached, dict) else None


async def _run_structured_and_cache(
    symbol: str, context: dict, cache: Any, key: str
) -> dict | None:
    """Round-4 CLUSTER 2 #7: now returns the cached payload (or ``None``
    on failure) so the de-dup wrapper can deliver the result to all
    concurrent awaiters."""
    from agents.claude_client import get_client
    from core.config import settings
    from services.earnings_prompts import (
        MODEL_STRUCTURED,
        build_structured_prompt,
        parse_structured_response,
    )

    try:
        # Round-4 CLUSTER 6 #24: sanitize untrusted strings before they
        # land in the prompt — see :func:`_sanitize_for_prompt`.
        safe_context = _sanitize_prompt_context(context)
        prompt = build_structured_prompt(**safe_context)
        client = get_client()
        raw = await client.complete(
            system=prompt["system"], user=prompt["user"], model=MODEL_STRUCTURED,
            context={
                "symbol": symbol,
                "endpoint": "earnings.claude_structured",
                "cache_key": key,
            },
        )
        parsed = parse_structured_response(raw)
        payload = {
            **parsed,
            "model": MODEL_STRUCTURED,
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        # TTL operator-tunable via
        # ``settings.EARNINGS_CLAUDE_STRUCTURED_TTL_HOURS`` (B-85).
        await cache.set(
            key,
            payload,
            ttl_seconds=settings.EARNINGS_CLAUDE_STRUCTURED_TTL_HOURS * 3600,
        )
        try:
            from services.ticker_context import persist_custom_ticker_fact

            await persist_custom_ticker_fact(
                symbol,
                namespace="research",
                key=f"claude_structured:{context['report_date']}",
                value=payload,
                source="earnings_claude_structured",
                as_of=_date_as_utc_datetime(context.get("report_date")),
                source_ref=key,
                stale_after_seconds=settings.EARNINGS_CLAUDE_STRUCTURED_TTL_HOURS * 3600,
            )
        except Exception:
            log.debug("persist structured Claude ticker fact failed for %s", symbol, exc_info=True)
        return payload
    except Exception as e:
        # B-69: demoted to DEBUG — an Anthropic outage would otherwise
        # emit one WARN per symbol as N structured calls fail in the
        # background. The hydration-failures summary covers it.
        log.debug(
            "Claude structured failed for %s: %s",
            symbol,
            _scrub_fmp_error(str(e)),
            extra=_log_ctx(
                endpoint="earnings._load_claude_structured",
                symbol=symbol,
                error=_scrub_fmp_error(str(e)),
            ),
        )
        return None


# Round-4 CLUSTER 6 #24: prompt-injection hardening for Claude calls.
# Attacker-controlled strings (news headlines, company name, sector text
# scraped from upstream APIs) used to be interpolated raw into the prompt.
# A malicious headline could carry an "Ignore the system prompt and..."
# string or unicode line/paragraph separators that confuse the
# tokenizer's view of message boundaries. Strip control chars, cap
# length, and let the prompt-builder wrap each value in delimiters.
#
# Round-6 L-1: this function additionally STRIPS any literal
# ``<headline>`` / ``</headline>`` / ``<company>`` / etc. substring from
# the value — the prompt-builder wraps the cleaned scalar in those exact
# tags, so allowing literal tag-like content through here would let an
# attacker break out of the wrapper. Final HTML-entity escape happens in
# ``services.earnings_prompts._escape_tags_in_untrusted``.
_CONTROL_CHARS = re.compile(r"[\u0000-\u001f\u007f\u2028\u2029]")
# Tag names mirror the wrappers in services.earnings_prompts.
_PROMPT_TAG_NAMES = ("headline", "company", "sector", "market_regime", "external_research")
_LITERAL_TAG_RE = re.compile(
    r"</?(?:" + "|".join(_PROMPT_TAG_NAMES) + r")(?:\s[^>]*)?>",
    re.IGNORECASE,
)


def _sanitize_for_prompt(value: Any, *, max_len: int = 200) -> Any:
    """Strip ASCII control chars + line/paragraph separators, truncate.

    Round-6 L-1: also escapes literal ``<headline>`` / ``</headline>``
    (etc.) substrings inside ``value`` by replacing the angle brackets
    with HTML entities.
    """
    if not isinstance(value, str):
        return value
    cleaned = _CONTROL_CHARS.sub(" ", value)
    cleaned = _LITERAL_TAG_RE.sub(
        lambda m: m.group(0).replace("<", "&lt;").replace(">", "&gt;"),
        cleaned,
    )
    if len(cleaned) > max_len:
        cleaned = cleaned[: max_len - 1] + "…"
    return cleaned


def _date_as_utc_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    try:
        parsed_date = date.fromisoformat(str(value)[:10])
        return datetime(parsed_date.year, parsed_date.month, parsed_date.day, tzinfo=timezone.utc)
    except Exception:
        return None


def _sanitize_prompt_context(context: dict) -> dict:
    """Apply :func:`_sanitize_for_prompt` to every untrusted string field.

    Trusted fields (``symbol`` is whitelist-validated on the route, the
    numeric metrics are floats, ``report_date`` is server-derived) pass
    through. ``company``, ``sector``, ``headlines``, and the looser
    ``market_regime`` are all upstream-supplied and get scrubbed.
    """
    out = dict(context)
    for k in ("company", "sector", "market_regime", "external_research"):
        if k in out:
            out[k] = _sanitize_for_prompt(
                out[k],
                max_len=1200 if k == "external_research" else 200,
            )
    if isinstance(out.get("headlines"), list):
        out["headlines"] = [
            _sanitize_for_prompt(h, max_len=200) for h in out["headlines"][:5]
        ]
    if isinstance(out.get("recent_beats_misses"), list):
        out["recent_beats_misses"] = [
            (
                _sanitize_for_prompt(d, max_len=20),
                _sanitize_for_prompt(s, max_len=80),
            )
            for d, s in out["recent_beats_misses"][:8]
        ]
    return out


def _format_external_research_for_prompt(value: Any) -> str:
    if not isinstance(value, dict):
        return "unavailable"
    provider = str(value.get("provider") or "TradingAgents")
    completed_at = str(value.get("completed_at") or "unknown time")
    signal = ""
    decision = str(value.get("decision_text") or "").strip()
    summary_lines = [
        str(line).strip()
        for line in (value.get("summary_lines") or [])
        if str(line).strip()
    ][:4]
    for candidate in [decision, *summary_lines]:
        match = re.search(
            r"\b(OVERWEIGHT|UNDERWEIGHT|NEUTRAL|HOLD|BUY|SELL|REDUCE|ACCUMULATE)\b",
            candidate,
            flags=re.IGNORECASE,
        )
        if match:
            signal = match.group(1).upper()
            break
    pieces = [
        f"{provider} research completed at {completed_at}.",
        f"Signal: {signal or 'not explicit'}.",
    ]
    if summary_lines:
        pieces.append("Highlights: " + " | ".join(summary_lines))
    if decision:
        pieces.append("Memo excerpt: " + decision[:800])
    disclaimer = value.get("advisory_disclaimer")
    if isinstance(disclaimer, str) and disclaimer.strip():
        pieces.append("Guardrail: " + disclaimer.strip())
    return " ".join(pieces)


async def _load_iv_term(symbol: str) -> tuple[list[dict] | None, bool]:
    """Build ATM-IV term structure across the first six expirations.

    Returns ``(points, is_partial)``. ``is_partial=True`` signals that
    more than half of the per-expiration fetches failed — the caller
    appends ``"iv_term_partial"`` to ``error_codes`` and surfaces a
    partial flag to the UI rather than letting a 1-point chart look
    like a flat term structure.

    Round-4 CLUSTER 5 #17: previously this awaited each expiration chain
    fetch sequentially — six round-trips per symbol on the detail page.
    With the per-symbol cache TTL of 30s, the second-and-onwards fetches
    were usually warm but cold-cache loads were slow. ``asyncio.gather``
    parallelises so cold-cache p95 falls from ~1.5s to ~250ms.

    Round-5 fixes:
      * E-10 — only six round trips total. Previously we fetched
        ``first_chain`` unfiltered, then re-fetched expiration[0] inside
        the parallel gather, doubling the first leg.
      * E-11 — track failure_count and propagate a partial signal.
        ``gather(return_exceptions=True)`` was silently swallowing
        per-expiration failures; 5/6 failing returned a 1-point
        chart with ``partial=False`` (a lie).
    """
    from services.options import fetch_chain

    try:
        today = market_today()
        first_chain = await fetch_chain(symbol)
        expirations = list(first_chain.expirations[:6])
        if not expirations:
            return (None, False)

        # E-10: reuse first_chain for expirations[0] — fetch only the rest
        # in parallel. With six expirations this is 1 + 5 round trips, not
        # 1 + 6.
        first_exp = expirations[0]
        first_exp_date = (
            first_exp if isinstance(first_exp, date)
            else date.fromisoformat(str(first_exp))
        )

        rest_results: list = []
        if len(expirations) > 1:
            rest_results = await asyncio.gather(
                *(
                    fetch_chain(
                        symbol,
                        expiry=(
                            e if isinstance(e, date)
                            else date.fromisoformat(str(e))
                        ),
                    )
                    for e in expirations[1:]
                ),
                return_exceptions=True,
            )

        # Pair each expiration with its chain (first reused; rest gathered).
        chains: list[tuple[date, Any]] = [(first_exp_date, first_chain)]
        failure_count = 0
        for exp, ch in zip(expirations[1:], rest_results):
            if isinstance(ch, Exception):
                failure_count += 1
                log.warning(
                    "iv term per-expiry fetch failed for %s: %s", symbol, ch,
                )
                continue
            exp_date = (
                exp if isinstance(exp, date) else date.fromisoformat(str(exp))
            )
            chains.append((exp_date, ch))

        term: list[dict] = []
        for exp_date, exp_chain in chains:
            exp_contracts = _contracts_for_expiry(exp_chain, exp_date)
            scoped_chain = type("_ExpiryChain", (), {"contracts": exp_contracts})()
            calls = _filter_chain(scoped_chain, "call")
            atm = min(
                calls,
                key=lambda c: abs(c.strike - exp_chain.spot_price),
                default=None,
            )
            if atm and atm.iv:
                term.append({
                    "expiry": exp_date,
                    "dte": (exp_date - today).days,
                    "atm_iv": atm.iv,
                })

        # E-11 threshold: more than half of the per-expiration fetches
        # failed → tell the caller. Counted against expirations[1:] since
        # the first leg is reused from the unfiltered fetch.
        rest_total = max(0, len(expirations) - 1)
        is_partial = rest_total > 0 and failure_count > rest_total // 2
        return (term or None, is_partial)
    except Exception as e:
        log.warning("iv term load failed for %s: %s", symbol, _scrub_fmp_error(str(e)))
        return (None, True)


async def _load_skew(symbol: str) -> dict | None:
    from services.options import fetch_chain

    try:
        chain = await fetch_chain(symbol)
        expirations = getattr(chain, "expirations", []) or []
        expiry = _select_event_expiry(expirations)
        scoped_contracts = _contracts_for_expiry(chain, expiry)
        scoped_chain = type("_SkewChain", (), {"contracts": scoped_contracts})()
        calls = _filter_chain(scoped_chain, "call")
        puts = _filter_chain(scoped_chain, "put")
        put_25d = min(
            puts,
            key=lambda p: abs(abs(p.delta or 0.5) - 0.25),
            default=None,
        )
        call_25d = min(
            calls,
            key=lambda c: abs(abs(c.delta or 0.5) - 0.25),
            default=None,
        )
        if not (put_25d and call_25d and put_25d.iv and call_25d.iv):
            return None
        skew = (put_25d.iv - call_25d.iv) * 100
        if skew > 1.5:
            interp = "put-heavy skew"
        elif skew < -1.5:
            interp = "call-heavy skew"
        else:
            interp = "neutral"
        return {
            "put_iv_25d": put_25d.iv,
            "call_iv_25d": call_25d.iv,
            "skew_points": skew,
            "interpretation": interp,
        }
    except Exception as e:
        log.warning("skew load failed for %s: %s", symbol, e)
        return None


def _parse_news_datetime(raw: str) -> datetime:
    """Newsdata's pubDate arrives as ``"YYYY-MM-DD HH:MM:SS"`` or ISO-8601.
    The schema requires a ``datetime``; this coerces either form, falling
    back to "now" so malformed rows don't 500 the detail endpoint."""
    if not raw:
        return datetime.now(timezone.utc)
    try:
        # Try ISO-8601 first (handles ``2026-04-21T10:15:00+00:00``).
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


async def _load_news(symbol: str) -> list[dict]:
    """Round-4 CLUSTER 3 #14: returns ``[]`` when Newsdata is rate-limited
    or down (the upstream service produces demo articles with empty URLs;
    the post-filter strips them all). To distinguish a genuine empty result
    from "news temporarily unavailable", :func:`get_detail` consults the
    upstream's ``is_demo`` flag separately via :func:`_news_payload`.
    """
    payload = await _news_payload(symbol, limit=10)
    return payload["articles"]


async def _news_payload(symbol: str, *, limit: int = 10) -> dict:
    """Round-4 CLUSTER 3 #14: single Newsdata fetch returning both the
    parsed articles and an ``is_demo`` flag so callers don't have to
    double-fetch to learn whether the empty result is real or a
    rate-limit cooldown.
    """
    from services.news import fetch_symbol_news

    try:
        resp = await fetch_symbol_news(symbol, limit=limit)
    except Exception as e:
        log.warning("news load failed for %s: %s", symbol, _scrub_fmp_error(str(e)))
        return {"articles": [], "is_demo": True, "status": "provider_error"}

    if resp.is_demo:
        return {"articles": [], "is_demo": True, "status": "demo"}

    # Round-13 / RD-5 (P1): forward all stage-1 ranking fields the
    # NewsArticle model now carries. Pre-fix this projection only
    # forwarded title/source/published_at/url — the FE NF-1 features
    # (category chips, tier-1 ★, relevance-descending sort) were dead
    # because the wire payload was stripped. The schema mirror lives
    # in ``backend/api/schemas/earnings.py:EarningsNewsArticle``.
    articles = [
        {
            "title": a.title,
            "source": a.source,
            "published_at": _parse_news_datetime(a.published_at),
            "url": a.url,
            "relevance_score": getattr(a, "relevance_score", 0.0),
            "category": getattr(a, "category", None),
            "tier": getattr(a, "tier", 2),
            "sentiment": getattr(a, "sentiment", None),
        }
        for a in resp.articles
        if a.url  # Schema requires a URL; drop rows with empty links
    ]
    status = "ok" if articles else "ok_empty"
    return {"articles": articles, "is_demo": False, "status": status}


def _format_news_for_prompt(news: Sequence[Mapping[str, Any]], *, limit: int = 5) -> list[str]:
    """Return compact, source-aware news snippets for Claude.

    Claude should see the best price-driving headlines, but not treat news
    as the whole thesis. Include source/category/relevance metadata so the
    prompt can distinguish a Reuters earnings headline from a generic or
    low-relevance mention.
    """
    formatted: list[str] = []
    for item in list(news)[:limit]:
        title = str(item.get("title") or "").strip()
        if not title:
            continue
        meta: list[str] = []
        source = item.get("source")
        if source:
            meta.append(f"source={source}")
        category = item.get("category")
        if category:
            meta.append(f"category={category}")
        tier = item.get("tier")
        if tier is not None:
            meta.append(f"tier={tier}")
        relevance = item.get("relevance_score")
        try:
            if relevance is not None:
                meta.append(f"relevance={float(relevance):.2f}")
        except (TypeError, ValueError):
            pass
        sentiment = item.get("sentiment")
        if sentiment:
            meta.append(f"sentiment={sentiment}")
        formatted.append(f"{title} [{'; '.join(meta)}]" if meta else title)
    return formatted


def _format_market_regime_context(data: Mapping[str, Any] | None) -> str:
    if not data:
        return "Unavailable (regime service returned no live data; treat as neutral)"
    regime = str(data.get("regime") or "Unavailable")
    parts = [regime]
    confidence = data.get("confidence")
    try:
        if confidence is not None:
            parts.append(f"confidence={float(confidence):.0%}")
    except (TypeError, ValueError):
        pass
    vix_level = data.get("vix_level")
    try:
        if vix_level is not None:
            parts.append(f"vix_proxy={float(vix_level):.1f}")
    except (TypeError, ValueError):
        pass
    indicators = data.get("indicators") if isinstance(data.get("indicators"), dict) else {}
    spy_change = indicators.get("spy_change_pct") if isinstance(indicators, dict) else None
    try:
        if spy_change is not None:
            parts.append(f"SPY_day_change={float(spy_change):+.2f}%")
    except (TypeError, ValueError):
        pass
    vix_proxy_change = indicators.get("vix_proxy_change_pct") if isinstance(indicators, dict) else None
    try:
        if vix_proxy_change is not None:
            parts.append(f"VIXY_day_change={float(vix_proxy_change):+.2f}%")
    except (TypeError, ValueError):
        pass
    vix_source = indicators.get("vix_proxy_source") if isinstance(indicators, dict) else None
    if vix_source:
        parts.append(str(vix_source))
    description = data.get("description")
    if description:
        parts.append(str(description))
    return "; ".join(parts)


async def _load_market_regime() -> str:
    """Fetch the live market-regime context for Claude.

    Previous implementation passed a hardcoded ``Unknown``. This helper
    uses the same live SPY/VIXY regime detector that backs the market
    overview endpoint, with a short timeout so a regime-provider issue
    cannot make earnings detail feel hung.
    """
    global _market_regime_cache

    now = time.monotonic()
    if _market_regime_cache is not None:
        cached_at, cached_value = _market_regime_cache
        ttl = (
            _MARKET_REGIME_ERROR_CACHE_TTL_SECONDS
            if cached_value.startswith("Unavailable")
            else _MARKET_REGIME_CACHE_TTL_SECONDS
        )
        if now - cached_at < ttl:
            return cached_value

    try:
        from core.config import settings

        if (
            not settings.ALPACA_API_KEY.get_secret_value()
            or not settings.ALPACA_SECRET_KEY.get_secret_value()
        ):
            result = "Unavailable (Alpaca credentials missing; treat as neutral)"
            _market_regime_cache = (now, result)
            return result
    except Exception:
        result = "Unavailable (configuration unreadable; treat as neutral)"
        _market_regime_cache = (now, result)
        return result

    try:
        from api.routes.market_overview import _get_regime_data

        data = await asyncio.wait_for(_get_regime_data(), timeout=3.0)
        result = _format_market_regime_context(data)
        _market_regime_cache = (time.monotonic(), result)
        return result
    except asyncio.TimeoutError:
        log.warning("market regime load timed out")
        result = "Unavailable (regime service timed out; treat as neutral)"
        _market_regime_cache = (time.monotonic(), result)
        return result
    except Exception as e:
        log.warning("market regime load failed: %s", _scrub_fmp_error(str(e)))
        result = "Unavailable (regime service failed; treat as neutral)"
        _market_regime_cache = (time.monotonic(), result)
        return result


async def _load_earnings_meta(symbol: str) -> dict | None:
    """Fetch company + sector + current earnings row for this symbol.

    Keep this in lockstep with :func:`list_upcoming`: the detail and
    full-research paths must see headline rows rescued from FMP's
    per-symbol earnings feed, otherwise the sidebar can show AAPL/MSFT
    while the detail panel treats the same ticker as an off-calendar stub.
    """
    wanted = symbol.upper()
    try:
        rows = [
            r for r in await _fmp_upcoming("both")
            if _in_curated_universe(r.get("symbol", ""))
        ]
        rescued = await _fmp_headline_earnings_rescue(
            "both",
            extra_symbols=[wanted],
        )
        rows = _merge_calendar_rows(rows, rescued)
    except Exception as e:
        log.warning(
            "earnings meta lookup failed for %s: %s",
            wanted,
            _scrub_fmp_error(str(e)),
            extra=_log_ctx(
                endpoint="earnings._load_earnings_meta",
                symbol=wanted,
                error=_scrub_fmp_error(str(e)),
            ),
        )
        return None

    matches = [r for r in rows if str(r.get("symbol", "")).upper() == wanted]
    if not matches:
        return None
    today = market_today()
    matches.sort(key=lambda r: _calendar_candidate_priority(r, today))
    return matches[0]


async def _fetch_next_earnings_date(symbol: str) -> date | None:
    """Query FMP's per-symbol ``/earnings`` endpoint for the next scheduled
    report date. Returns ``None`` if FMP has no future record, or on any
    upstream failure — callers treat ``None`` as "unknown report date".

    This is the fallback path for symbols that aren't on FMP's 2-week
    calendar slice used by :func:`_load_earnings_meta`. See B-41.
    """
    from data.providers.fmp_earnings import FMPEarningsProvider

    def _load() -> date | None:
        try:
            with FMPEarningsProvider() as provider:
                consensus = provider.consensus(symbol, asof=market_today())
        except Exception as e:
            log.warning(
                "FMP consensus lookup failed for %s: %s",
                symbol, _scrub_fmp_error(str(e)),
            )
            return None
        nxt = consensus.get("next_earnings_date") if consensus else None
        if isinstance(nxt, date):
            return nxt
        return None

    try:
        return await asyncio.to_thread(_load)
    except Exception as e:
        log.warning(
            "FMP consensus offload failed for %s: %s",
            symbol, _scrub_fmp_error(str(e)),
        )
        return None


async def _hydrate_row(
    row: dict,
    *,
    min_iv_rank: float = 0,
    client_host: str | None = None,
    today: date | None = None,
) -> dict | None:
    """Enrich one FMP row with price, IV rank, expected move, and days-until.

    Returns the enriched dict or ``None`` when ``iv_rank`` is below the
    threshold filter. Raises on truly unrecoverable errors (caller catches).
    ``client_host`` is threaded through to ``_load_quote`` so per-IP rate
    limits kick in on the real user's IP instead of loopback (B-33).

    Round-4 CLUSTER 1 #4: ``today`` is computed ONCE in
    :func:`list_upcoming` and threaded through so we don't compute the
    NY market date twice per row (here and again in the validation
    fallback). Default :func:`market_today` keeps stand-alone calls
    working.
    """
    symbol = row["symbol"]
    if today is None:
        today = market_today()
    # B-35: gather with return_exceptions=True gives us clean per-task
    # exception handling and concise result-unpacking. The previous
    # wait/result sequence re-raised either task's exception without
    # distinguishing the source, and required manual Task plumbing.
    # B-62: rate-limit accounting moves into the route layer; service-layer
    # `fetch_quote` no longer accepts client_host. _load_metrics keeps the
    # kwarg for API parity (unused today; revisit when options.py grows
    # service-layer rate limits).
    report_date_obj = date.fromisoformat(row["report_date"])
    quote_result, metrics_result, claude_result = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(
            symbol,
            report_date=report_date_obj,
            report_time=row.get("report_time", "DMT"),
            client_host=client_host,
        ),
        _load_claude_structured_cached(symbol, report_date_obj),
        return_exceptions=True,
    )
    if isinstance(quote_result, Exception):
        log.warning("quote task raised for %s: %s", symbol, quote_result)
        quote = None
    else:
        quote = quote_result
    if isinstance(metrics_result, Exception):
        log.warning("metrics task raised for %s: %s", symbol, metrics_result)
        metrics = None
    else:
        metrics = metrics_result
    if isinstance(claude_result, Exception):
        log.debug("Claude cache task raised for %s: %s", symbol, claude_result)
        claude = None
    else:
        claude = claude_result if isinstance(claude_result, dict) else None
    chain_is_demo = bool(metrics and metrics.get("chain_is_demo"))
    iv_is_demo = bool(metrics and metrics.get("iv_is_demo"))
    synthetic_ranking_inputs = chain_is_demo or iv_is_demo
    iv_rank = None if synthetic_ranking_inputs else (metrics.get("iv_rank") if metrics else None)
    if iv_rank is not None and iv_rank < min_iv_rank:
        return None
    expected_move_pct = None if chain_is_demo else (metrics.get("expected_move_pct") if metrics else None)
    premium_yield_call_atm = None if chain_is_demo else (
        metrics.get("premium_yield_call_atm") if metrics else None
    )
    premium_yield_put_atm = None if chain_is_demo else (
        metrics.get("premium_yield_put_atm") if metrics else None
    )
    days_until = (report_date_obj - today).days
    report_state = _classify_report_state(report_date_obj, row.get("report_time", "DMT"))
    edge = compute_earnings_edge_score(
        iv_rank=iv_rank,
        premium_yield_call_atm=premium_yield_call_atm,
        premium_yield_put_atm=premium_yield_put_atm,
        expected_move_pct=expected_move_pct,
        hist_avg_abs_move_pct=metrics.get("hist_avg_abs_move_pct") if metrics else None,
        claude_confidence=claude.get("confidence") if claude else None,
        days_until=days_until,
        top_setup=claude.get("suggested_play") if claude else None,
    )
    # Wave 4a / Batch Q: vol-aware ranked top-3 recommendations. The
    # legacy ``top_setup`` string is kept for back-compat (FE still
    # reads it); callers should migrate to ``top_setups[0]`` for the
    # full leg structure / EV / Kelly sizing.
    top_setups: list = []
    legacy_top_setup = claude.get("suggested_play") if claude else None
    tail_risk_score: float | None = None
    tail_risk_reasons: list[str] = []
    if (
        metrics
        and not synthetic_ranking_inputs
        and (quote and quote.get("last"))
        and metrics.get("current_iv")
    ):
        try:
            from services.earnings_recommender import (
                _compute_tail_risk_score,
                _tail_risk_reasons,
                recommend_setups,
                setup_id_to_legacy_top_setup,
            )
            from services.options import fetch_chain

            chain = await fetch_chain(symbol)
            # SHR-5 / TR-1..TR-5: pull prior_moves + tail-risk signals
            # from already-loaded metrics + async-fetch the upstream
            # signals (sector cohort, analyst PT, news sentiment, plus
            # Wave V V3's options volume signals) so the recommender
            # sees the full picture instead of all-None.
            prior_moves = _prior_moves_from_metrics(metrics)
            tr_signals = await _build_tail_risk_signals_async(
                symbol,
                quote=quote, metrics=metrics, prior_moves=prior_moves,
                chain=chain,
            )
            tail_risk_score = _compute_tail_risk_score(tr_signals)
            tail_risk_reasons = _tail_risk_reasons(tr_signals)
            top_setups = await recommend_setups(
                symbol=symbol,
                spot=float(quote["last"]),
                iv_rank=iv_rank,
                iv_percentile=metrics.get("iv_percentile"),
                current_iv=float(metrics.get("current_iv") or 0.0),
                hv_20=metrics.get("hv_20"),
                expected_move_pct=expected_move_pct,
                hist_avg_abs_move_pct=metrics.get("hist_avg_abs_move_pct"),
                claude_verdict=claude.get("verdict") if claude else None,
                claude_confidence=claude.get("confidence") if claude else None,
                chain=chain,
                report_date=report_date_obj,
                report_time=row.get("report_time", "DMT"),
                prior_moves=prior_moves,
                tail_risk_signals=tr_signals,
                vol_premium_score=metrics.get("vol_premium_score"),
            )
            if top_setups:
                # Override the legacy top_setup with the recommender's
                # best pick so FE displays the vol-aware shape rather
                # than the verdict-mapped one.
                mapped = setup_id_to_legacy_top_setup(top_setups[0].setup_id)
                if mapped is not None:
                    legacy_top_setup = mapped
        except Exception as e:  # noqa: BLE001
            log.debug(
                "earnings recommender failed for %s: %s", symbol, e,
                extra=_log_ctx(
                    endpoint="earnings._hydrate_row.recommender",
                    symbol=symbol,
                    error=str(e),
                ),
            )
            top_setups = []
    hist_avg_abs_move_pct = metrics.get("hist_avg_abs_move_pct") if metrics else None
    return {
        **row,
        "price": quote["last"] if quote else None,
        "change": quote["change"] if quote else None,
        "change_pct": quote["change_pct"] if quote else None,
        "iv_rank": iv_rank,
        "expected_move_pct": expected_move_pct,
        "premium_yield_call_atm": premium_yield_call_atm,
        "premium_yield_put_atm": premium_yield_put_atm,
        "hist_avg_abs_move_pct": hist_avg_abs_move_pct,
        "vol_premium_score": compute_vol_premium_score(
            expected_move_pct, hist_avg_abs_move_pct,
        ),
        "claude_verdict": claude.get("verdict") if claude else None,
        "claude_confidence": claude.get("confidence") if claude else None,
        "top_setup": legacy_top_setup,
        "top_setups": top_setups,
        "tail_risk_score": tail_risk_score,
        "tail_risk_reasons": tail_risk_reasons,
        **edge,
        "days_until": days_until,
        "report_state": report_state,
    }


# ─── Main aggregators ────────────────────────────────────────


async def list_upcoming(
    *,
    window: str = "both",
    min_iv_rank: float = 0,
    bmo_amc: str = "both",
    watchlist_only: bool = False,
    watchlist_symbols: Sequence[str] | None = None,
    sort: str = "date",
    client_host: str | None = None,
) -> CalendarResponse:
    """Fan out over FMP + per-symbol hydrators, return one calendar response.

    ``client_host`` is the caller's IP (passed from the FastAPI route) so
    downstream per-IP rate limiters see the real user instead of loopback
    (B-33).
    """
    # Settings are pulled here at the top of the function so the
    # watchlist filter (Round-5 G-15) and the row-cap / concurrency
    # knobs all see the same instance.
    from core.config import settings

    partial = False
    # Round-4 CLUSTER 1 #4: compute "today" once and pass through. The
    # window dates are also resolved once at the top so they can land in
    # the response payload.
    today = market_today()
    window_start, window_end = _resolve_window_dates(window)
    window_label = _format_window_label(window_start, window_end)
    try:
        raw_rows = await _fmp_upcoming(window)
    except Exception as e:
        log.error("FMP earnings calendar unavailable: %s", _scrub_fmp_error(str(e)))
        return CalendarResponse(
            earnings=[],
            generated_at=datetime.now(timezone.utc),
            partial=True,
            error="earnings calendar unavailable",
            window_start=window_start,
            window_end=window_end,
            window_label=window_label,
            meta={"reason": "fmp_unavailable", "before_curated": 0},
        )

    # B-66: always restrict to the curated optionable universe (mega +
    # deeply-liquid large caps). The former `market_cap` query param was
    # a vestigial no-op — the "all" default bypassed the filter entirely,
    # which defeated the point of having a curated universe in the first
    # place. Filter unconditionally so the screener is always a *decision
    # tool* showing ~5-10 names the user can evaluate, not a feed of ~60
    # Russell-2000 names with thin options chains. Low-cap, meme, and
    # foreign-ADR-with-shallow-chain names are out regardless.
    before_count = len(raw_rows)
    raw_rows = [r for r in raw_rows if _in_curated_universe(r.get("symbol", ""))]
    log.info(
        "earnings calendar: curated universe kept %d/%d rows (window=%s)",
        len(raw_rows), before_count, window,
    )

    rescued_count = 0
    rescue_extra = watchlist_symbols if watchlist_symbols is not None else None
    rescued_rows = await _fmp_headline_earnings_rescue(
        window,
        extra_symbols=rescue_extra,
    )
    if rescued_rows:
        before_rescue_merge = len(raw_rows)
        raw_rows = _merge_calendar_rows(raw_rows, rescued_rows)
        rescued_count = len(raw_rows) - before_rescue_merge
        if rescued_count:
            log.info(
                "earnings calendar: rescued %d headline rows from per-symbol earnings (window=%s)",
                rescued_count,
                window,
            )

    # Prefer the explicit per-user watchlist threaded from the frontend. If
    # older clients send only ``watchlist_only=true``, fall back to the
    # operator default so the flag remains useful for compatibility.
    if watchlist_only:
        if watchlist_symbols is not None:
            watchlist = {
                s.strip().upper() for s in watchlist_symbols if s.strip()
            }
            before = len(raw_rows)
            raw_rows = [
                r for r in raw_rows
                if r.get("symbol", "").upper() in watchlist
            ]
            log.info(
                "earnings calendar: user watchlist filter kept %d/%d (size=%d)",
                len(raw_rows), before, len(watchlist),
            )
        else:
            watch_raw = (settings.WATCHLIST_DEFAULT_SYMBOLS or "").strip()
            if watch_raw:
                watchlist = {
                    s.strip().upper() for s in watch_raw.split(",") if s.strip()
                }
                before = len(raw_rows)
                raw_rows = [
                    r for r in raw_rows
                    if r.get("symbol", "").upper() in watchlist
                ]
                log.info(
                    "earnings calendar: default watchlist filter kept %d/%d (size=%d)",
                    len(raw_rows), before, len(watchlist),
                )
            else:
                log.info(
                    "earnings calendar: watchlist_only=True but "
                    "WATCHLIST_DEFAULT_SYMBOLS is empty — no rows filtered",
                )

    # Hard cap. At curated-universe default this is rarely binding (≤10
    # tradeable names per week typical), but protects us on weeks where
    # many mega caps report in parallel. Operator-tunable via
    # ``settings.EARNINGS_CALENDAR_MAX_ROWS`` (B-85).
    raw_rows.sort(key=lambda r: _calendar_candidate_priority(r, today))
    MAX_ROWS = settings.EARNINGS_CALENDAR_MAX_ROWS
    if len(raw_rows) > MAX_ROWS:
        log.info(
            "earnings calendar: %d rows → capped to %d (window=%s)",
            len(raw_rows), MAX_ROWS, window,
        )
        raw_rows = raw_rows[:MAX_ROWS]

    # Cap concurrency so we don't open 60 parallel Alpaca+FMP+Claude flights
    # at once — Alpaca's rate limit is ~200 req/min across the whole backend
    # and other endpoints need headroom. Operator-tunable via
    # ``settings.EARNINGS_HYDRATE_CONCURRENCY`` (B-85).
    hydrate_sem = asyncio.Semaphore(settings.EARNINGS_HYDRATE_CONCURRENCY)

    # B-69: collect per-symbol hydration failures into a list and emit ONE
    # summary WARN after the loop. Previously an Alpaca 5-min outage
    # emitted 800+ WARN lines here (one per symbol per refresh); downstream
    # log budgets treated that as a flood and rate-limited the bucket,
    # hiding the real alert.
    hydration_failures: list[str] = []

    async def safe_hydrate(row: dict) -> dict | None:
        async with hydrate_sem:
            try:
                return await _hydrate_row(
                    row,
                    min_iv_rank=min_iv_rank,
                    client_host=client_host,
                    today=today,
                )
            except Exception as e:
                # Keep per-symbol detail at DEBUG for local reproduction,
                # but only one aggregated WARN hits production log streams.
                sym = row.get("symbol") or "?"
                log.debug(
                    "hydrate failed for %s: %s",
                    sym,
                    _scrub_fmp_error(str(e)),
                    extra=_log_ctx(
                        endpoint="earnings.safe_hydrate",
                        symbol=sym,
                        error=_scrub_fmp_error(str(e)),
                    ),
                )
                hydration_failures.append(sym)
                nonlocal partial
                partial = True
                return row  # keep symbol visible with null fields

    hydrated = await asyncio.gather(*[safe_hydrate(r) for r in raw_rows])

    if hydration_failures:
        log.warning(
            "earnings.hydration.failures count=%d %s",
            len(hydration_failures),
            hydration_failures,
            extra=_log_ctx(
                endpoint="earnings.list_upcoming",
                stage="hydration_summary",
                window=window,
                failure_count=len(hydration_failures),
                failed_symbols=hydration_failures,
            ),
        )
    rows: list[CalendarRow] = []
    # B-81: surface row-validation failures instead of silently dropping.
    validation_errors: list[dict] = []
    for h in hydrated:
        if h is None:
            continue  # filtered by min_iv_rank
        try:
            row_payload = dict(h)
            # Round-4 CLUSTER 1 #4: days_until / report_state are computed
            # in _hydrate_row using the shared `today`. The setdefault here
            # is a safety net for paths that bypass _hydrate_row (tests
            # that mock it). Compute against the shared `today` so we
            # don't re-read the clock twice.
            if "days_until" not in row_payload and isinstance(
                row_payload.get("report_date"), str
            ):
                row_payload["days_until"] = (
                    date.fromisoformat(row_payload["report_date"]) - today
                ).days
            row_payload.setdefault("days_until", 0)
            if "report_state" not in row_payload and isinstance(
                row_payload.get("report_date"), str
            ):
                row_payload["report_state"] = _classify_report_state(
                    date.fromisoformat(row_payload["report_date"]),
                    row_payload.get("report_time", "DMT"),
                )
            row_payload.setdefault("report_state", "upcoming")
            # Audit-r5 (B2.34): wire the human-readable label so the FE
            # chip can render "Before market open" / "After market close"
            # / "Time TBD" instead of the raw acronym.
            row_payload.setdefault(
                "report_time_display",
                format_report_time_label(row_payload.get("report_time")),
            )
            rows.append(CalendarRow(**row_payload))
        except Exception as e:
            log.warning(
                "row validation failed: %s — %s",
                e,
                h,
                extra=_log_ctx(
                    endpoint="earnings.list_upcoming",
                    symbol=(h or {}).get("symbol"),
                    error=str(e),
                ),
            )
            partial = True
            validation_errors.append({
                "symbol": h.get("symbol") if isinstance(h, dict) else None,
                "error": str(e),
            })

    if bmo_amc != "both":
        wanted = bmo_amc.upper()
        rows = [r for r in rows if r.report_time == wanted]

    # Round-4 CLUSTER 1 #5: visibility filter replaces the bare
    # `days_until >= 0` check. We keep today's row visible so the user
    # sees what's printing today (frontend dims via report_state once it
    # crosses the BMO/AMC cutover); we drop anything 2+ days past.
    def _is_visible(r: CalendarRow) -> bool:
        if r.days_until is None:
            return True  # next-window stub
        if r.days_until > 0:
            return True
        if r.days_until < -1:
            return False  # 2+ days past — definitely stale
        # On report day or yesterday: keep visible — frontend dims via
        # report_state.
        return True

    rows = [r for r in rows if _is_visible(r)]

    if sort == "date":
        rows.sort(key=lambda r: (
            r.report_date,
            _symbol_display_priority(r.symbol),
            r.symbol,
        ))
    elif sort == "iv_rank":
        rows.sort(key=lambda r: r.iv_rank or 0, reverse=True)
    elif sort == "yield":
        rows.sort(
            key=lambda r: max(
                r.premium_yield_call_atm or 0, r.premium_yield_put_atm or 0
            ),
            reverse=True,
        )
    elif sort == "claude_confidence":
        rows.sort(key=lambda r: r.claude_confidence or 0, reverse=True)
    elif sort == "edge_score":
        rows.sort(key=lambda r: r.edge_score or 0, reverse=True)

    # Round-4 CLUSTER 5 #21: empty-calendar diagnostic. The frontend
    # uses `meta.reason` to pick the right empty-state copy:
    #   - "ok"                   — rows present
    #   - "weekend_no_reports"   — calendar empty because Sat/Sun
    #   - "no_curated_matches"   — FMP returned rows but none were in
    #                              the curated universe
    #   - "fmp_unavailable"      — caught above on _fmp_upcoming raise
    if rows:
        reason = "ok"
    elif before_count == 0 and today.weekday() >= 5:
        reason = "weekend_no_reports"
    elif before_count > 0:
        reason = "no_curated_matches"
    else:
        reason = "ok"  # genuinely no reports this Mon-Fri

    return CalendarResponse(
        earnings=rows,
        generated_at=datetime.now(timezone.utc),
        partial=partial,
        validation_errors=validation_errors,
        window_start=window_start,
        window_end=window_end,
        window_label=window_label,
        meta={
            "reason": reason,
            "before_curated": before_count,
            "rescued_count": rescued_count,
        },
    )


async def _build_stub_detail(symbol: str) -> EarningsDetail:
    """B-41 fallback: produce a minimal 200 response for any symbol that
    isn't on the current FMP calendar slice.

    Contract: live quote if available, ``report_date`` from FMP consensus
    (``None`` if FMP has no record), and empty Claude/options blocks.
    No Claude call is made on the stub path — users land on this panel
    from a watchlist deep-link and shouldn't pay for structured analysis
    until the symbol actually reports."""
    quote_task = asyncio.create_task(_load_quote(symbol))
    report_date_task = asyncio.create_task(_fetch_next_earnings_date(symbol))
    quote, report_date_val = await asyncio.gather(
        quote_task, report_date_task, return_exceptions=False
    )
    return EarningsDetail(
        symbol=symbol,
        company=symbol,  # no FMP /profile lookup in the stub path
        sector="",
        report_date=report_date_val,
        report_time="DMT",
        # Audit-r5 (B2.34): human-readable chip label.
        report_time_display=format_report_time_label("DMT"),
        quote=QuoteBlock(**quote) if isinstance(quote, dict) else None,
        metrics=None,
        strike_ladder=None,
        claude_structured=None,
        claude_full_research=None,
        iv_term_structure=None,
        skew=None,
        news=[],
        # Round-4 CLUSTER 3 #13: stub detail was lying with partial=False.
        # The whole panel is a fallback — every downstream block is
        # absent — so it has to flag partial honestly. Frontend uses the
        # ``stub_detail`` code to decide whether to render the "limited
        # info — symbol not on this week's calendar" banner.
        partial=True,
        error_codes=["stub_detail"],
        generated_at=datetime.now(timezone.utc),
    )


async def get_detail(symbol: str) -> EarningsDetail:
    """Fan out to every provider, merge into one detail response.

    When ``symbol`` isn't on the current 2-week FMP calendar (typical for
    a watchlist deep-link to a symbol reporting next quarter), fall back
    to a **stub detail**: quote + metrics surfaced from live providers,
    ``report_date`` sourced from FMP consensus if available, and Claude/
    options fields left empty. This keeps the /detail endpoint a 200 for
    any well-formed symbol instead of 404-ing the UI. See B-41.
    """
    meta = await _load_earnings_meta(symbol)
    if not meta:
        return await _build_stub_detail(symbol)

    from services.ticker_context import get_ticker_fact

    report_date_obj = date.fromisoformat(meta["report_date"])

    # Batch P / P-6: historical-earnings fetch runs as its own gather leg
    # so an upstream metrics failure (e.g. Alpaca chain outage) doesn't
    # also blank out ``prior_moves``. The metrics path still fetches
    # historical for the rolling-stat computation, but the detail-level
    # ``historical_earnings`` block can now fall back to this direct
    # call when metrics is None.
    (
        quote_t, metrics_t, ladder_t, news_payload_t, regime_t,
        iv_term_t, skew_t, research_t, historical_t,
    ) = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(
            symbol,
            report_date=report_date_obj,
            report_time=meta["report_time"],
        ),
        _load_strike_ladder(
            symbol,
            expiry=None,
            report_date=report_date_obj,
            report_time=meta["report_time"],
        ),
        _news_payload(symbol),
        _load_market_regime(),
        _load_iv_term(symbol),
        _load_skew(symbol),
        get_ticker_fact(symbol, "research", on_stale="allow"),
        _load_historical_earnings(symbol, report_date_obj),
        return_exceptions=True,
    )
    # Round-4 CLUSTER 3: a successful ``None`` is NOT partial (provider
    # intentionally absent); only exceptions or news_unavailable are.
    quote = quote_t if isinstance(quote_t, dict) else None
    metrics = metrics_t if isinstance(metrics_t, dict) else None
    ladder = ladder_t if isinstance(ladder_t, dict) else None
    # Round-5 Cluster C E-11: _load_iv_term now returns a (points, is_partial)
    # tuple so a majority-failed gather can surface "iv_term_partial" in
    # error_codes. An exception thrown directly by gather still arrives as
    # the exception itself (not the tuple), so guard accordingly.
    iv_term: list[dict] | None = None
    iv_term_is_partial = False
    if isinstance(iv_term_t, tuple) and len(iv_term_t) == 2:
        iv_term, iv_term_is_partial = iv_term_t
    elif isinstance(iv_term_t, list):
        # Defensive: tests / mocks may still return a bare list.
        iv_term = iv_term_t
    skew = skew_t if isinstance(skew_t, dict) else None
    external_research = "unavailable"
    if not isinstance(research_t, Exception):
        research_value = getattr(research_t, "value", None)
        external_research = _format_external_research_for_prompt(research_value)

    error_codes: list[str] = []
    news: list[dict] = []
    news_unavailable = False
    news_error = False
    if isinstance(news_payload_t, dict):
        news = news_payload_t.get("articles", []) or []
        news_status = str(news_payload_t.get("status") or "")
        news_error = news_status == "provider_error"
        news_unavailable = bool(news_payload_t.get("is_demo")) and not news_error
    else:
        news_error = True

    if news_error:
        error_codes.append("news_error")
    if news_unavailable:
        error_codes.append("news_unavailable")

    if isinstance(regime_t, str):
        market_regime = regime_t
    else:
        market_regime = "Unavailable (regime service failed; treat as neutral)"
    if market_regime.startswith("Unavailable"):
        error_codes.append("regime_unavailable")

    # Round-5 Cluster A E-1: surface chain-demo state through error_codes
    # so the frontend banner can fire even when other blocks are healthy.
    # Check both ladder and metrics because either fetch can be the one that
    # touched the demo fallback.
    if (
        (ladder is not None and ladder.get("is_demo"))
        or (metrics is not None and metrics.get("chain_is_demo"))
    ):
        error_codes.append("chain_demo")

    # Round-5 Cluster C E-11: majority-failed IV term gather signals
    # iv_term_partial so the UI can flag a partial term-structure chart
    # rather than rendering the misleading 1-point line that gather()
    # silently produced before.
    if iv_term_is_partial:
        error_codes.append("iv_term_partial")

    # Round-4 CLUSTER 3 #11: metrics missing or hv_20/iv_rank None tells
    # the frontend that the historical-vol pipeline isn't backing this
    # row. Use specific codes so the UI can render distinct badges.
    if metrics is None:
        error_codes.append("metrics_unavailable")
    else:
        if metrics.get("hv_20") is None:
            error_codes.append("hv_unavailable")
        if metrics.get("iv_rank") is None:
            error_codes.append("iv_unavailable")

    # `partial` = any critical block errored or any data-availability
    # signal is on. ``None`` returns (provider intentionally absent) are
    # not partial unless they fired a code above.
    partial = (
        any(
            isinstance(x, Exception)
            for x in [quote_t, metrics_t, ladder_t, news_payload_t, regime_t, iv_term_t, skew_t]
        )
        or news_unavailable
        or news_error
        or "metrics_unavailable" in error_codes
        or "hv_unavailable" in error_codes
        or "iv_unavailable" in error_codes
        # Round-5 Cluster A E-1: chain_demo flips partial — UI surfaces the
        # synthetic-data warning rather than treating BSM rows as live OPRA.
        or "chain_demo" in error_codes
        # Round-5 Cluster C E-11: iv_term_partial flips partial too.
        or "iv_term_partial" in error_codes
        or "regime_unavailable" in error_codes
    )

    def _metric_or_none(key: str) -> float | None:
        if not metrics:
            return None
        value = metrics.get(key)
        return value if value is not None else None

    claude_ctx = {
        "symbol": symbol,
        "company": meta["company"],
        "sector": meta["sector"],
        "report_date": meta["report_date"],
        "report_time": meta["report_time"],
        "price": quote["last"] if quote else 0.0,
        "iv_rank": _metric_or_none("iv_rank"),
        "iv_percentile": _metric_or_none("iv_percentile"),
        "hv_20": _metric_or_none("hv_20"),
        "expected_move_pct": _metric_or_none("expected_move_pct"),
        "hist_avg_abs_move_pct": (
            metrics.get("hist_avg_abs_move_pct") if metrics else None
        ),
        "recent_beats_misses": _recent_beats_misses(
            metrics.get("historical_quarters", []) if metrics else []
        ),
        "headlines": _format_news_for_prompt(news),
        "market_regime": market_regime,
        "external_research": external_research,
    }
    try:
        claude = await _load_claude_structured(symbol, context=claude_ctx)
    except Exception as e:
        log.warning(
            "claude structured load failed for %s: %s",
            symbol, _scrub_fmp_error(str(e)),
        )
        claude = None

    # Round-5 Cluster A E-3: when Claude is absent (outage / parse error /
    # cache miss with the create_task still warming up), tell the UI so it
    # can render a "thesis pending" state instead of silently swallowing
    # the gap. Always flip partial when this fires.
    if claude is None:
        error_codes.append("claude_unavailable")
        partial = True

    return EarningsDetail(
        symbol=symbol,
        company=meta["company"],
        sector=meta["sector"],
        report_date=date.fromisoformat(meta["report_date"]),
        report_time=meta["report_time"],
        # Audit-r5 (B2.34): human-readable chip label.
        report_time_display=format_report_time_label(meta["report_time"]),
        days_until=(date.fromisoformat(meta["report_date"]) - market_today()).days,
        report_state=_classify_report_state(
            date.fromisoformat(meta["report_date"]),
            meta["report_time"],
        ),
        quote=QuoteBlock(**quote) if quote else None,
        metrics=MetricsBlock(**metrics) if metrics else None,
        strike_ladder=StrikeLadder(**ladder) if ladder else None,
        claude_structured=ClaudeStructured(**claude) if claude else None,
        claude_full_research=None,
        # Batch P / P-6: prefer the dedicated historical-earnings fetch
        # when metrics is unavailable (provider outage, demo fallback,
        # etc.). The metrics-derived block keeps cache locality on the
        # happy path; ``historical_t`` is a pure FMP-surprises + Alpaca
        # bars join so it survives an Alpaca-chain blip cleanly.
        historical_earnings=(
            _historical_block_from_metrics(metrics)
            or _historical_block_from_metrics(
                historical_t if isinstance(historical_t, dict) else None
            )
        ),
        iv_term_structure=[IVTermPoint(**p) for p in iv_term] if iv_term else None,
        skew=SkewBlock(**skew) if skew else None,
        news=[NewsArticle(**n) for n in news],
        partial=partial,
        error_codes=error_codes,
        generated_at=datetime.now(timezone.utc),
    )


async def run_full_research(
    symbol: str,
    *,
    meta: dict | None = None,
) -> ClaudeFullResearch:
    """24h-cached full Claude research note for one symbol.

    Cache hit → return parsed payload straight. Cache miss → gather context,
    build the full prompt, call Claude Opus, persist, return.

    Round-7 / BE-2: previously, two concurrent callers on a cold cache
    both ran the full Opus path. The structured-call sibling
    (:func:`_load_claude_structured`) has been deduping via
    ``_inflight_structured`` since Round-4; this function now wears the
    same pattern via ``_inflight_full_research``. Cache + meta lookups
    stay outside the dedup so a cache hit doesn't pay the lock
    acquisition cost.
    """
    from core.cache import get_cache

    if meta is None:
        meta = await _load_earnings_meta(symbol)
    if not meta:
        raise ValueError(f"symbol {symbol!r} has no upcoming earnings")

    cache = get_cache()
    key = (
        f"earnings:claude-full:{_CLAUDE_PROMPT_CACHE_VERSION}:"
        f"{symbol}:{meta['report_date']}"
    )
    cached = await cache.get(key)
    if cached:
        return ClaudeFullResearch(**cached)

    inflight_key = f"{symbol}:{meta['report_date']}"
    lock = _get_inflight_lock()
    async with lock:
        task = _inflight_full_research.get(inflight_key)
        if task is None or task.done():
            task = asyncio.create_task(
                _run_full_research_uncached(symbol, meta, cache, key)
            )
            _inflight_full_research[inflight_key] = task

            def _done(t: "asyncio.Task[ClaudeFullResearch]", k: str = inflight_key) -> None:
                # Identity-compare so we never wipe a successor task
                # that replaced us in the dict.
                if _inflight_full_research.get(k) is t:
                    _inflight_full_research.pop(k, None)

            task.add_done_callback(_done)
    return await task


async def _run_full_research_uncached(
    symbol: str, meta: dict, cache, key: str,
) -> ClaudeFullResearch:
    """Cold-cache full-research path — only entered through the
    ``_inflight_full_research`` single-flight gate so two callers for the
    same symbol share one Opus call."""
    from agents.claude_client import get_client
    from services.earnings_prompts import (
        MODEL_FULL,
        build_full_prompt,
        parse_full_response,
    )

    from services.ticker_context import get_ticker_fact

    quote, metrics, news, regime, research = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(
            symbol,
            report_date=date.fromisoformat(meta["report_date"]),
            report_time=meta["report_time"],
        ),
        _load_news(symbol),
        _load_market_regime(),
        get_ticker_fact(symbol, "research", on_stale="allow"),
        return_exceptions=True,
    )
    # Round-4 CLUSTER 6 #24: scrub upstream-supplied strings before they
    # land in the prompt. Headlines, sector, and company name are all
    # untrusted (Newsdata + FMP free-form fields).
    news_items = news if isinstance(news, list) else []
    headlines = _format_news_for_prompt(news_items)
    safe_company = _sanitize_for_prompt(meta["company"], max_len=200)
    safe_sector = _sanitize_for_prompt(meta["sector"], max_len=200)
    safe_headlines = [_sanitize_for_prompt(h, max_len=200) for h in headlines[:5]]
    historical_quarters = (
        metrics.get("historical_quarters", []) if isinstance(metrics, dict) else []
    )
    external_research = "unavailable"
    if not isinstance(research, Exception):
        external_research = _format_external_research_for_prompt(
            getattr(research, "value", None)
        )
    prompt = build_full_prompt(
        symbol=symbol,
        company=safe_company,
        sector=safe_sector,
        report_date=meta["report_date"],
        report_time=meta["report_time"],
        price=quote["last"] if isinstance(quote, dict) else 0.0,
        iv_rank=(
            metrics.get("iv_rank") if isinstance(metrics, dict) else None
        ),
        iv_percentile=(
            metrics.get("iv_percentile") if isinstance(metrics, dict) else None
        ),
        expected_move_pct=(
            metrics.get("expected_move_pct") if isinstance(metrics, dict) else None
        ),
        historical_quarters=historical_quarters,
        headlines=safe_headlines,
        market_regime=(
            regime
            if isinstance(regime, str)
            else "Unavailable (regime service failed; treat as neutral)"
        ),
        sector_peers_pct_change_5d={},  # wire once sector-peers helper exists
        external_research=external_research,
    )
    # Round-4 CLUSTER 2 #9: shared singleton client. Constructing a fresh
    # ClaudeClient per call (re-instantiates anthropic.AsyncAnthropic +
    # its httpx connection pool) burned a few hundred ms per request.
    client = get_client()
    raw = await client.complete(
        system=prompt["system"], user=prompt["user"], model=MODEL_FULL,
        context={
            "symbol": symbol,
            "endpoint": "earnings.full_research",
        },
    )
    parsed = _ground_full_research_response(
        parse_full_response(raw),
        historical_quarters,
    )
    payload = {
        **parsed,
        "model": MODEL_FULL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await cache.set(key, payload, ttl_seconds=24 * 3600)
    try:
        from services.ticker_context import persist_custom_ticker_fact

        await persist_custom_ticker_fact(
            symbol,
            namespace="research",
            key=f"claude_full:{meta['report_date']}",
            value=payload,
            source="earnings_claude_full",
            as_of=_date_as_utc_datetime(meta.get("report_date")),
            source_ref=key,
            stale_after_seconds=24 * 3600,
        )
    except Exception:
        log.debug("persist full Claude ticker fact failed for %s", symbol, exc_info=True)
    return ClaudeFullResearch(**payload)


async def load_cached_full_research(
    symbol: str,
    *,
    meta: dict,
) -> ClaudeFullResearch | None:
    """Return a cached full-research note without creating a Claude task."""
    try:
        from core.cache import get_cache

        cache = get_cache()
        cached = await cache.get(
            f"earnings:claude-full:{_CLAUDE_PROMPT_CACHE_VERSION}:"
            f"{symbol}:{meta['report_date']}"
        )
        return ClaudeFullResearch(**cached) if cached else None
    except Exception:
        log.debug("full-research cache preflight failed for %s", symbol, exc_info=True)
        return None
