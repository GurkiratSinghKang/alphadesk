"""Pydantic response schemas for /api/v1/earnings/*.

These are the wire contracts — any change here is a breaking change for
the frontend. All leaves are nullable so per-symbol partial responses are
representable when an upstream provider (FMP, Alpaca options, Newsdata,
Claude) fails.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


ReportTime = Literal["BMO", "AMC", "DMT"]
Verdict = Literal["bullish", "neutral-bull", "neutral", "neutral-bear", "bearish"]
OptionSide = Literal["call", "put"]
Bucket = Literal["15Δ", "30Δ", "ATM"]
TopSetup = Literal["short call", "cash-secured put", "short strangle", "iron condor"]


# ─── Calendar row ────────────────────────────────────────────

class CalendarRow(BaseModel):
    symbol: str
    company: str
    sector: str
    report_date: date
    report_time: ReportTime
    days_until: int
    price: float | None = None
    change: float | None = None
    change_pct: float | None = None
    iv_rank: float | None = Field(default=None, ge=0, le=100)
    premium_yield_call_atm: float | None = None  # decimal
    premium_yield_put_atm: float | None = None
    expected_move_pct: float | None = None
    hist_avg_abs_move_pct: float | None = None
    claude_verdict: Verdict | None = None
    claude_confidence: float | None = Field(default=None, ge=0, le=1)
    top_setup: TopSetup | None = None


class CalendarResponse(BaseModel):
    earnings: list[CalendarRow]
    generated_at: datetime
    partial: bool = False
    error: str | None = None


# ─── Detail blocks ───────────────────────────────────────────

class QuoteBlock(BaseModel):
    last: float
    change: float
    change_pct: float


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
    iv_vs_hist_vol_points: float | None


class HistoricalBlock(BaseModel):
    quarters: list[HistQuarter]
    stats: HistoricalStats


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
    historical_earnings: HistoricalBlock | None = None
    iv_term_structure: list[IVTermPoint] | None = None
    skew: SkewBlock | None = None
    news: list[NewsArticle] = Field(default_factory=list)
    partial: bool = False
    generated_at: datetime
