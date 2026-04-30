"""Pydantic response schemas for /api/v1/earnings/*.

These are the wire contracts — any change here is a breaking change for
the frontend. All leaves are nullable so per-symbol partial responses are
representable when an upstream provider (FMP, Alpaca options, Newsdata,
Claude) fails.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


ReportTime = Literal["BMO", "AMC", "DMT"]
Verdict = Literal["bullish", "neutral-bull", "neutral", "neutral-bear", "bearish"]
OptionSide = Literal["call", "put"]
Bucket = Literal["15Δ", "30Δ", "ATM"]
# Round-13 / RD-1 (P0): the wire-contract vocabulary for ``suggested_play``
# / ``top_setup`` used to be ``"short call" | "cash-secured put" | "short
# strangle" | "iron condor"``. Round-12 / DR-1 expanded the prompt-side
# ``_VALID_SETUPS`` set to 13 DEFINED-RISK shapes, but the Pydantic
# response schema was left on the legacy 4-value Literal. Result: every
# Claude response that used the new vocabulary tripped a ``ValidationError``
# inside ``ClaudeStructured(**claude)`` and the FE rendered the generic
# 502 "Claude analysis failed unexpectedly" — the entire feature was
# broken on every full-research call. Widen the literal to match the
# prompt vocab + retain the legacy values for backward-compat with cached
# rows; the prompt gate at ``parse_structured_response`` enforces the
# defined-risk subset on fresh runs.
TopSetup = Literal[
    # Defined-risk vocabulary (Round-12 / DR-1):
    "long call",
    "long put",
    "bull put spread",
    "bear call spread",
    "bull call spread",
    "bear put spread",
    "iron condor",
    "iron butterfly",
    "calendar spread",
    "diagonal spread",
    "cash-secured put",
    "covered call",
    "married put",
    "long straddle",  # FE alias used by the bull-vol button (defined-risk: max loss = debit)
    # Legacy values retained ONLY so cached pre-Round-12 rows still
    # deserialise — fresh prompts forbid them via ``_VALID_SETUPS``.
    "short call",
    "short strangle",
]
# Round-4 CLUSTER 1 #5: a row's display state for the day-of report.
# The frontend dims rows based on this; backend never filters >= today_done
# silently — it surfaces the state so the user sees what we know.
ReportState = Literal["upcoming", "today_pre", "today_done", "past"]


# ─── Calendar row ────────────────────────────────────────────

class CalendarRow(BaseModel):
    symbol: str
    company: str
    sector: str
    report_date: date
    report_time: ReportTime
    days_until: int
    # Round-4 CLUSTER 1 #5: report_state lets the frontend dim "already
    # printed today" rows without us filtering them out (which would make
    # the calendar feel buggy on report day).
    report_state: ReportState = "upcoming"
    price: float | None = None
    change: float | None = None
    change_pct: float | None = None
    # Round-4 CLUSTER 3 #10: iv_rank is now nullable. The within-chain-smile
    # value computed in `services.options._fetch_real_iv` was never a real
    # IV rank — it was the spread of IVs across a single snapshot. Until
    # the historical-vol pipeline lands, real-data calls return None and the
    # frontend renders "—". Demo data still produces a synthetic value but
    # the IVData.is_demo flag tells the UI to label it accordingly.
    iv_rank: float | None = Field(default=None, ge=0, le=100)
    premium_yield_call_atm: float | None = None  # decimal
    premium_yield_put_atm: float | None = None
    expected_move_pct: float | None = None
    hist_avg_abs_move_pct: float | None = None
    claude_verdict: Verdict | None = None
    claude_confidence: float | None = Field(default=None, ge=0, le=1)
    top_setup: TopSetup | None = None
    edge_score: float | None = Field(default=None, ge=0, le=100)
    edge_score_reasons: list[str] = Field(default_factory=list)


class CalendarResponse(BaseModel):
    earnings: list[CalendarRow]
    generated_at: datetime
    partial: bool = False
    error: str | None = None
    # B-81: Each entry describes a single row that failed Pydantic
    # validation during hydration. Keeping them surfaced in the response
    # (instead of silently swallowing the exception and toggling
    # `partial`) lets the frontend show a "N symbols had schema issues"
    # debug badge without re-fetching.
    validation_errors: list[dict] = Field(default_factory=list)
    # ── Round-4 CLUSTER 1: window semantics ──
    # The user-reported "only end-of-month dates showing" bug had two roots:
    # (1) the server picked windows in UTC, not NY market time, so a Friday
    # evening call could land on Saturday in UTC and silently shift the
    # entire week forward, and (2) the response never told the frontend
    # which window it was looking at, so the UI couldn't surface a "showing
    # Apr 27 - May 1" header. These three fields fix both: window_start /
    # window_end are inclusive Mon-Fri NY-anchored dates, and window_label
    # is a locale-naive string the frontend reformats. Defaults are filled
    # in at the service layer; tests that build CalendarResponse directly
    # can omit them.
    window_start: date | None = None
    window_end: date | None = None
    window_label: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    # ``meta`` keys (when populated):
    #   reason: "ok" | "no_curated_matches" | "fmp_unavailable"
    #           | "weekend_no_reports"
    #   before_curated: int  (count of FMP rows before universe filter)


# ─── Detail blocks ───────────────────────────────────────────

class QuoteBlock(BaseModel):
    last: float
    change: float
    change_pct: float
    # Provider quote timestamp. Distinct from EarningsDetail.generated_at,
    # which is when the backend assembled the full detail payload.
    timestamp: datetime | None = None


class MetricsBlock(BaseModel):
    iv_rank: float | None = None
    iv_percentile: float | None = None
    current_iv: float | None = None
    hv_20: float | None = None
    hv_50: float | None = None
    hv_100: float | None = None
    hv_iv_ratio: float | None = None
    expected_move_pct: float | None = None
    expected_move_dollars: float | None = None
    hist_avg_abs_move_pct: float | None = None
    beat_rate: float | None = None
    days_to_earnings: int | None = None
    days_to_expiry: int | None = None


class LadderRow(BaseModel):
    strike: float
    side: OptionSide
    bucket: Bucket
    delta: float
    bid: float
    ask: float
    mid: float
    iv: float
    yield_pct: float
    pop: float
    theta: float
    gamma: float
    vega: float
    oi: int
    volume: int


class StrikeLadder(BaseModel):
    expiry: date
    underlying_price: float
    rows: list[LadderRow]
    # Timestamp of the option-chain snapshot used to derive row mids.
    # Trade deep-links forward this as quote_at_fill_ts so the order risk
    # gate evaluates freshness against the actual ladder data.
    fetched_at: datetime | None = None
    # Round-5 Cluster A E-1: surface the underlying chain's demo flag so
    # the frontend can render its DEMO DATA badge. Defaults False so
    # real-chain responses don't change shape; the screener fills this in
    # from ``OptionChain.is_demo`` whenever the demo fallback fired.
    is_demo: bool = False


class ClaudeStructured(BaseModel):
    verdict: Verdict
    direction_magnitude: dict[str, float]
    thesis: str
    catalysts: list[str]
    risks: list[str]
    suggested_play: TopSetup
    suggested_play_reason: str
    confidence: float = Field(ge=0, le=1)
    model: str
    generated_at: datetime


class ComparableSetup(BaseModel):
    report_date: date
    iv_rank: float
    setup: str
    outcome: str
    similarity_score: float


class ClaudeFullResearch(BaseModel):
    thesis_paragraph: str
    comparable_setups: list[ComparableSetup]
    post_earnings_drift_playbook: str
    sector_backdrop: str
    analyst_consensus_delta: str
    what_would_change_my_mind: str
    confidence: float = Field(ge=0, le=1)
    model: str
    generated_at: datetime


class HistQuarter(BaseModel):
    report_date: date
    surprise_pct: float | None
    next_day_move_pct: float
    five_day_move_pct: float


class HistoricalStats(BaseModel):
    avg_abs_move_pct: float
    wins: int
    losses: int
    surprise_beat_rate: float
    iv_vs_hist_vol_points: float | None = None


class HistoricalBlock(BaseModel):
    quarters: list[HistQuarter]
    stats: HistoricalStats


class EarningsBacktestEvent(BaseModel):
    symbol: str
    report_date: date
    top_setup: TopSetup
    expected_move_pct: float = Field(gt=0, allow_inf_nan=False)
    realized_move_pct: float = Field(allow_inf_nan=False)
    premium_yield_call_atm: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    premium_yield_put_atm: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    edge_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)


class EarningsBacktestRequest(BaseModel):
    events: list[EarningsBacktestEvent] = Field(min_length=1, max_length=64)
    min_edge_score: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    max_events: int | None = Field(default=None, ge=1, le=500)
    risk_fraction: float = Field(default=0.01, gt=0, le=0.25, allow_inf_nan=False)


class EarningsBacktestTrade(BaseModel):
    symbol: str
    report_date: date
    setup: str
    return_pct: float
    win: bool
    edge_score: float | None = None
    reason: str


class EarningsBacktestSkipped(BaseModel):
    symbol: str
    reason: str


class EarningsBacktestMetrics(BaseModel):
    events: int
    win_rate: float
    avg_trade_return_pct: float
    total_return_pct: float
    max_drawdown_pct: float
    profit_factor: float | None = None


class EarningsBacktestResponse(BaseModel):
    trades: list[EarningsBacktestTrade]
    skipped: list[EarningsBacktestSkipped]
    metrics: EarningsBacktestMetrics


class IVTermPoint(BaseModel):
    expiry: date
    dte: int
    atm_iv: float


class SkewBlock(BaseModel):
    put_iv_25d: float | None
    call_iv_25d: float | None
    skew_points: float | None
    interpretation: Literal["put-heavy skew", "call-heavy skew", "neutral"] | None


class NewsArticle(BaseModel):
    title: str
    source: str
    published_at: datetime
    url: str
    # Round-13 / RD-5: stage-1 ranking signals computed by
    # ``backend/services/news.py:_score_relevance``. Optional with
    # safe defaults so older serialised cache entries still parse.
    relevance_score: float = 0.0
    category: str | None = None
    tier: int = 2
    sentiment: str | None = None


class EarningsDetail(BaseModel):
    symbol: str
    company: str
    sector: str
    # ``report_date`` is nullable to support stub-detail responses for
    # symbols that aren't on FMP's current calendar (e.g. a watchlist
    # deep-link for a symbol reporting next quarter). See B-41.
    report_date: date | None = None
    report_time: ReportTime
    quote: QuoteBlock | None = None
    metrics: MetricsBlock | None = None
    strike_ladder: StrikeLadder | None = None
    claude_structured: ClaudeStructured | None = None
    claude_full_research: ClaudeFullResearch | None = None
    # Historical per-quarter earnings moves. Nullable because upstream
    # surprise/price joins may be unavailable for a symbol.
    historical_earnings: HistoricalBlock | None = None
    iv_term_structure: list[IVTermPoint] | None = None
    skew: SkewBlock | None = None
    news: list[NewsArticle] = Field(default_factory=list)
    partial: bool = False
    # Round-4 CLUSTER 3 #13: structured codes the frontend uses to render
    # honest "data unavailable" badges. Codes:
    #   "stub_detail"          — fallback panel for off-calendar symbols
    #   "news_unavailable"     — Newsdata rate-limited or upstream down
    #   "chain_demo"           — Alpaca chain unreachable, demo served
    #   "iv_unavailable"       — historical IV pipeline not wired
    #   "metrics_unavailable"  — IV/HV both null
    #   "hv_unavailable"       — historical-vol time series missing
    error_codes: list[str] = Field(default_factory=list)
    generated_at: datetime
