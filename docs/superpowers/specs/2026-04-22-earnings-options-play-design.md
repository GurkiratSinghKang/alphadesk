# Earnings Options Play — Design Spec

- **Date:** 2026-04-22
- **Author:** Claude (brainstorming session with GK)
- **Stage:** Design approved; pending writing-plans handoff.

## Problem

Options traders want a focused, editorial-quality screener of this-week and next-week earnings with enough context to pick a premium-selling setup on the spot. The existing `/strategies` page is built around *autonomous* strategies (backtested, self-trading) — there's no decision-support surface where a human scans earnings, reads an LLM's thesis, inspects the options chain, and manually places a trade. This spec adds that surface and slots it into `/strategies` alongside the autonomous strategies, honestly labeled as a research tool.

## Goals

1. A new entry on `/strategies` named "Earnings Options Play" under a new **Research** section.
2. Its detail page is a calendar-sidebar + persistent detail-panel screener showing all earnings reporting this week and next week.
3. For each symbol, surface the full options lab: IV rank/pctl, HV, IV/HV ratio, expected move, historical avg |move|, multi-strike ladder (ATM / 30Δ / 15Δ, both sides) with greeks + premium yield % + POP, IV term structure, put/call skew, news feed, and a structured Claude Opus analysis (verdict + bull/bear magnitude + thesis + catalysts + risks + suggested play + confidence).
4. A "Run full research" button triggers a deeper on-demand Opus note (~500 words: comparable historical setups, post-earnings drift playbook, sector backdrop, consensus delta, "what would change my mind").
5. Trade buttons deep-link into `/trade` with the contract(s) pre-staged for manual review/submit — zero auto-execution.

## Non-goals (YAGNI)

- **No autonomous trading.** Not an auto-strategy; no backtesting, position sizing, or entry/exit automation.
- **No new alerts or notifications.** Alerts live under `/alerts` already.
- **No multi-user features.** No shared watchlists, no journaling, no per-trade post-mortems.
- **No mobile-first design.** Page is desktop-first; narrow (<1200px panel width) collapses the two-column detail to stacked, but iPhone-sized viewports are not the target.
- **No new option-strategy types invented.** Suggested-play is picked from {short call, cash-secured put, short strangle, iron condor} by IV-rank bucket only.

## Architecture

One new frontend route, one new backend router, one new aggregator service. All upstream integrations (FMP earnings, Alpaca OPRA options + IV, Newsdata, Claude agent) are already wired — we're *aggregating*, not integrating.

```
frontend/
  src/app/(dashboard)/strategies/
    earnings-options-play/
      page.tsx                    ← "use client", shadows the [id] dynamic route
      _earnings/*.tsx             ← section-local components
    page.tsx                      ← existing list; add kind grouping
  src/components/strategies/
    ResearchStrategyCard.tsx      ← new variant renderer for kind:"research"
  src/lib/
    api.ts                        ← +3 client fns
    strategies.ts                 ← STRATEGY_META gets `kind` field
  src/styles/design-tokens.css    ← +`.t-ladder-row` utility

backend/
  api/routes/earnings.py          ← new router
  services/earnings_screener.py   ← new aggregator
  strategies/registry.py          ← add "earnings-options-play", kind="research"
```

**Strategy-kind flag (new)**: both the backend `@register_strategy` decorator and the frontend `STRATEGY_META` dict gain a `kind: "autonomous" | "research"` field. The `/strategies` list page uses it to group cards under "Active" / "Research" / "Coming soon" section headers. `ResearchStrategyCard.tsx` replaces the autonomous KPIs (OOS Sharpe / CAGR / Max DD) with honest metrics (`THIS WEEK · n earnings`, `AVG IV RANK · n`, `TOP SETUP · symbol`). "RESEARCH" pill replaces "ACTIVE" pill.

## Backend

### Endpoints

**`GET /api/v1/earnings/calendar`** — sidebar list.
Query params: `window=current|next|both` (default `both`), `min_iv_rank` (default 50), `market_cap=mega|large|mid|small|all`, `bmo_amc=bmo|amc|both`, `watchlist_only=bool`, `sort=date|iv_rank|yield|claude_confidence`.
Response: `{ earnings: CalendarRow[], generated_at, partial: bool }`.

```python
class CalendarRow(BaseModel):
    symbol: str
    company: str
    sector: str
    report_date: date          # ISO
    report_time: Literal["BMO", "AMC", "DMT"]
    days_until: int
    price: float | None
    change: float | None
    change_pct: float | None
    iv_rank: float | None      # 0-100
    premium_yield_call_atm: float | None   # decimal, e.g. 0.031 = 3.1%
    premium_yield_put_atm: float | None
    expected_move_pct: float | None        # from straddle
    hist_avg_abs_move_pct: float | None    # avg |move| last 8 qtrs
    claude_verdict: Literal["bullish", "neutral-bull", "neutral", "neutral-bear", "bearish"] | None
    claude_confidence: float | None         # 0-1
    top_setup: str | None                   # one of {"short call","cash-secured put","short strangle","iron condor"}
```

**`GET /api/v1/earnings/{symbol}/detail`** — everything for the right panel.
Response:

```python
class EarningsDetail(BaseModel):
    symbol: str
    company: str
    sector: str
    report_date: date
    report_time: Literal["BMO", "AMC", "DMT"]
    quote: QuoteBlock | None
    metrics: MetricsBlock | None            # iv_rank, iv_pctl, current_iv, hv_20, hv_50, hv_100, hv_iv_ratio, expected_move_pct, expected_move_dollars, hist_avg_abs_move_pct, beat_rate, days_to_earnings, days_to_expiry
    strike_ladder: StrikeLadder | None      # {expiry, underlying_price, rows: LadderRow[]}
    claude_structured: ClaudeStructured | None
    claude_full_research: ClaudeFullResearch | None  # null until POST .../full-research
    historical_earnings: HistoricalBlock | None      # {quarters: HistQuarter[], stats: {...}}
    iv_term_structure: list[IVTermPoint] | None      # [{expiry, dte, atm_iv}, ...]
    skew: SkewBlock | None                  # {put_iv_25d, call_iv_25d, skew_points, interpretation}
    news: list[NewsArticle]                 # up to 10
    partial: bool                           # true if any provider failed
    generated_at: datetime

class LadderRow(BaseModel):
    strike: float
    side: Literal["call", "put"]
    bucket: Literal["15Δ", "30Δ", "ATM"]
    delta: float
    bid: float; ask: float; mid: float
    iv: float
    yield_pct: float               # premium / underlying_price, decimal
    pop: float                     # probability of profit, 0-1
    theta: float; gamma: float; vega: float
    oi: int; volume: int

class ClaudeStructured(BaseModel):
    verdict: Literal[...]
    direction_magnitude: dict      # {"bull_case_pct": 0.04, "bear_case_pct": -0.05}
    thesis: str                    # 3 sentences
    catalysts: list[str]           # 2-4 bullets
    risks: list[str]               # 2-4 bullets
    suggested_play: str
    suggested_play_reason: str
    confidence: float
    model: str                     # "claude-opus-4-7"
    generated_at: datetime
```

**`POST /api/v1/earnings/{symbol}/full-research`** — triggers Opus deep note.
No request body; symbol in path. Rate-limited per user (reuse existing Claude rate limiter at 30/5min).
Response: `{ claude_full_research: ClaudeFullResearch }` — a single block containing `thesis_paragraph`, `comparable_setups[]` (last ~3 quarters where IVR/setup were similar with outcomes), `post_earnings_drift_playbook`, `sector_backdrop`, `analyst_consensus_delta`, `what_would_change_my_mind`, `confidence`, `model`, `generated_at`. Cached 24h.

### Aggregator service

`services/earnings_screener.py`:

- `list_upcoming(filters) -> list[CalendarRow]` — queries FMP for the date window, filters, then for each symbol parallel-fetches the lightweight fields (quote, IV rank, ATM premium yield, expected move, hist avg, claude_structured-cache-only) via `asyncio.gather`. Does NOT trigger Claude if cache miss — calendar returns `claude_*` as null and a background job is enqueued.
- `get_detail(symbol) -> EarningsDetail` — parallel-fetches all blocks. Cache-hits return immediately; cache misses trigger upstream calls. If `claude_structured` is absent, runs it synchronously inline (first-read penalty ~2-4s).
- `run_full_research(symbol) -> ClaudeFullResearch` — builds an extended prompt (adds historical quarters + comparable setups lookup + sector data) and calls Claude Opus.
- `_compute_expected_move(symbol, expiry)` — from ATM straddle: `(call_mid + put_mid) / underlying_price`.
- `_compute_historical_stats(symbol)` — pulls last 8 earnings dates from FMP, joins with daily bars, computes next-day move, 5-day move, surprise %, beat rate, avg |move|.

### Cache TTLs (existing Redis layer)

| Key | TTL | Rationale |
|---|---|---|
| `earnings:calendar:{window}:{filters_hash}` | 1h | Earnings schedule rarely changes intraday. |
| `earnings:detail:{symbol}:{report_date}` | 15min market-hours, 1h off-hours | Options chain is the volatile leaf. |
| `earnings:news:{symbol}` | 30min | News refreshes reasonably often. |
| `earnings:claude-structured:{symbol}:{report_date}` | 4h | Thesis stable over a few hours unless tape moves. |
| `earnings:claude-full:{symbol}:{report_date}` | 24h | Expensive; user explicitly re-triggers for refresh. |

All keys include `report_date` so a new quarter's earnings naturally expires old cache without manual invalidation.

### Model selection

Opus-4-7 on both structured and full, per the user's request. Cost estimate at 20 symbols × 2 eager refreshes/day × 4h TTL + 20% full-research trigger rate: ~$90/month. If that ever becomes uncomfortable, the structured tier can downgrade to Sonnet-4-7 by flipping one constant in `services/earnings_screener.py:MODEL_STRUCTURED`.

### Prompt shape (structured)

System: editorial options-research assistant specialized in earnings premium-selling.
User context: earnings date/time, price, IV rank, IV percentile, HV 20/50/100, expected move, hist avg |move|, last 4 earnings beat/miss outcomes, top 5 news headlines with sentiment, current market regime (from existing `getMarketRegime`).
Output: JSON matching `ClaudeStructured` schema. Validate server-side; reject and retry once if invalid.

## Frontend

### Route

`/strategies/earnings-options-play` — bypasses the `[id]` dynamic route because Next's static segment wins over dynamic. Clicking the strategy card on `/strategies` routes here; the existing `/strategies/[id]` detail page is untouched.

### Component tree + LOC targets

```
page.tsx                          ~120 LOC  — orchestrates state, URL sync, fetches
_earnings/
  EarningsCalendarSidebar.tsx     ~150 LOC
  FiltersBar.tsx                   ~80 LOC
  EarningsDetailPanel.tsx         ~100 LOC  — V2 shell, collapses to V1 <1200px panel width
  DetailHeader.tsx                 ~60 LOC
  MetricsStrip.tsx                 ~50 LOC
  ClaudeThesisCard.tsx            ~120 LOC
  StrikeLadder.tsx                ~110 LOC
  HistoricalMoves.tsx              ~80 LOC
  IVTermSkew.tsx                   ~90 LOC
  NewsFeed.tsx                     ~60 LOC
  TradeButtonRow.tsx               ~50 LOC
```

Why this decomposition: each component has one responsibility, a stable set of props (typed off the backend schemas), and can be tested with mock data independently. LOC targets are guidelines — if any single file creeps past ~200 LOC we subdivide.

### Page state + data flow

`page.tsx`:

- `selectedSymbol: string | null` — synced to `?symbol=NVDA` URL param. Refresh preserves.
- `filters: FiltersState` — synced to remaining query params.
- Calendar fetch: reuses the existing API client pattern in `src/lib/api.ts` (`useSWR`/`useEffect` — match whatever the rest of `/strategies` uses; verify during implementation).
- Detail fetch: triggered when `selectedSymbol` changes.
- `runFullResearch` mutation: POSTs, on success replaces `claude_full_research` in the detail cache.
- First calendar row auto-selected on mount.

**Responsive**: `useMediaQuery("(min-width: 1200px)")` inside `EarningsDetailPanel.tsx` toggles V2 two-column ↔ V1 stacked. The sidebar itself stays fixed width (~280px) at `lg+`; at `md` it collapses into a dropdown above the panel.

### Deep-link to `/trade`

Clicking `Short call 205c` navigates to `/trade?symbol=NVDA&contract=NVDA250425C00205000&side=sell&qty=1`. `/trade/page.tsx` reads those params on mount and pre-selects strategy, symbol, contract, side, qty in its order ticket. Nothing auto-submits; user reviews and clicks Place Order. For multi-leg (strangle), the URL carries two legs: `?legs=NVDA250425P00195000:sell:1,NVDA250425C00210000:sell:1` and `/trade` pre-stages both.

**Implementation note**: `/trade/page.tsx` currently does not read any query-param pre-population. Wiring the param parser + order-ticket pre-fill is in-scope for this feature and must ship together — otherwise the trade buttons go to an empty order ticket. Multi-leg pre-staging may require a new "Combo" mode in the existing order ticket if it only supports single legs today; the implementation plan should check this and scope the order-ticket work accordingly.

### Styling

Reuses existing editorial tokens — `.t-display-section` for `§ EARNINGS · OPTIONS PLAY`, `.t-label` for section labels, `.t-num-hero` for the price header, `.t-num-lg` for metric cells, `.t-mono` for the ladder. One new utility `.t-ladder-row` in `design-tokens.css` aligns mono columns at consistent widths for the strike table.

## Data flow (end-to-end)

1. User opens `/strategies` → sees new "Research" section with "Earnings Options Play" card (distinct from "Active").
2. Clicks → routes to `/strategies/earnings-options-play`.
3. Page mounts → fires `GET /api/v1/earnings/calendar?window=both&min_iv_rank=50` (default filters).
4. Sidebar populates grouped by date. First symbol auto-selected; URL updates to `?symbol=<first>`.
5. Simultaneously, `GET /api/v1/earnings/<first>/detail` fires; detail panel shows skeleton until response lands.
6. User clicks a different symbol → URL updates, detail fetch fires.
7. User adjusts a filter → calendar refetches with new filter key; selected symbol preserved if still in results, else first result.
8. User clicks "Run full research" → `POST /api/v1/earnings/<sym>/full-research`, button shows spinner, thesis card swaps to full on success.
9. User clicks "Short call 205c" → `/trade?symbol=…&contract=…&side=sell` pre-stages; user reviews and submits manually.

## Error handling

- **Any single provider fails for a symbol**: that symbol's row returns with affected fields `null` and `partial: true`. Sidebar row shows a muted warning dot; detail panel renders the sections it has and marks missing ones with an em-dash placeholder.
- **FMP earnings provider down entirely**: calendar endpoint returns `{ earnings: [], generated_at, partial: true, error: "earnings calendar unavailable" }`. Frontend shows a banner ("Earnings data temporarily unavailable — refreshing in 60s") and sets up a retry loop. Cached data from any prior successful fetch stays rendered.
- **Claude times out or hits rate limit**: endpoint returns the `claude_*` blocks as `null` with an `error` sibling. Thesis card shows "Analysis unavailable · Retry" button that re-triggers structured or full.
- **Network error on detail fetch**: panel shows a retry button; sidebar remains interactive.

## Testing

Unit tests (backend, pytest):
- `test_earnings_screener.py` — `_compute_expected_move` against known straddle prices; `_compute_historical_stats` against fixture quarters; partial-data merging behavior when one fan-out call raises.
- `test_earnings_routes.py` — route contract tests (status codes, cache-hit vs miss, filter coverage).

Component tests (frontend, Vitest + Testing Library), co-located in `src/__tests__/earnings/`:
- One file per sub-component, rendered against mock `EarningsDetail` / `CalendarRow[]` fixtures.
- `page.test.tsx` — filter change triggers refetch; symbol click swaps detail; URL sync.
- Mocks added to `src/__tests__/setup-mocks.ts`: `getEarningsCalendar`, `getEarningsDetail`, `postEarningsFullResearch`.

## File inventory

**New:**
- `backend/api/routes/earnings.py`
- `backend/services/earnings_screener.py`
- `backend/tests/test_earnings_screener.py`
- `backend/tests/test_earnings_routes.py`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/*.tsx` (11 files per tree above)
- `frontend/src/components/strategies/ResearchStrategyCard.tsx`
- `frontend/src/__tests__/earnings/` (one test per component + `page.test.tsx`)

**Changed:**
- `backend/strategies/registry.py` — register `earnings-options-play` with `kind="research"`; add `kind` field to registry metadata dataclass.
- `backend/api/routes/__init__.py` — mount the new router.
- `frontend/src/lib/api.ts` — three new client fns.
- `frontend/src/lib/strategies.ts` — add `kind` field to `STRATEGY_META`; add entry for `earnings-options-play`.
- `frontend/src/app/(dashboard)/strategies/page.tsx` — group cards by `kind`.
- `frontend/src/styles/design-tokens.css` — add `.t-ladder-row`.
- `frontend/src/__tests__/setup-mocks.ts` — add three new API mocks.

## Rollout

Single PR, no feature flag. Manual smoke test on staging-equivalent (tradingalpha.net's paper-trading is effectively staging) before tagging. Rollback = revert the PR; the new route is additive, no data migrations.

## Open questions

None remaining from the brainstorm. Two items flagged for the implementation plan to resolve early:

1. **Data-fetching client**: confirm which pattern `/strategies` uses today (SWR / TanStack Query / bare `useEffect`) so the new page matches. Mentioned inline above.
2. **`/trade` pre-population + multi-leg order ticket**: the implementation plan must inspect the current `/trade` order ticket and scope whatever's needed to accept query-param contracts (single leg) and combo legs (strangle). Without that work the trade buttons are dead ends.

Ready for writing-plans.
