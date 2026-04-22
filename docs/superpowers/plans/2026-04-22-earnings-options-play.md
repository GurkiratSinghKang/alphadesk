# Earnings Options Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a research-dashboard "strategy" at `/strategies/earnings-options-play` that lists this-week + next-week earnings with a calendar sidebar, persistent detail panel, full options lab (strike ladder, IV rank/pctl, HV, expected move, skew, term structure), Claude Opus analysis (structured eager + full on-demand), news, and deep-link trade buttons into `/trade`.

**Architecture:** New Next.js route under `(dashboard)/strategies/earnings-options-play/` with state-driven page + 11 sub-components. Backend adds one new router (`earnings.py`) backed by a single aggregator service (`earnings_screener.py`) that fans out over already-wired providers (FMP earnings, Alpaca OPRA options/IV, Newsdata, Claude agent). Strategy registry gains a `kind: "autonomous" | "research"` flag so `/strategies` can render research cards distinctly. `/trade` query-param pre-population is in-scope last-mile work.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4, FastAPI + Pydantic + httpx, Alpaca OPRA, FMP earnings, Newsdata, Claude Opus 4.7 via SupervisorAgent, Redis cache.

**Spec:** `docs/superpowers/specs/2026-04-22-earnings-options-play-design.md`

---

## File Structure

### New files

**Backend:**
- `backend/api/routes/earnings.py` — router with 3 endpoints
- `backend/services/earnings_screener.py` — aggregator service
- `backend/services/earnings_prompts.py` — Claude prompt builders
- `backend/api/schemas/earnings.py` — Pydantic response schemas
- `backend/tests/test_earnings_screener.py`
- `backend/tests/test_earnings_routes.py`

**Frontend:**
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/DetailHeader.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/MetricsStrip.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/StrikeLadder.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow.tsx`
- `frontend/src/components/strategies/ResearchStrategyCard.tsx`
- `frontend/src/__tests__/earnings/` (one test per component + page test)

### Modified files

**Backend:**
- `backend/strategies/base.py` — add `kind: Literal["autonomous","research"] = "autonomous"` to `StrategyMeta`
- `backend/strategies/registry.py` — add placeholder registration for `earnings-options-play` (research kind)
- `backend/api/routes/__init__.py` — mount earnings router
- `backend/core/config.py` — add cache TTL constants

**Frontend:**
- `frontend/src/lib/strategies.ts` — add `kind?: "autonomous" | "research"` to `StrategyMetaEntry`; add `earnings-options-play` entry; export `metaKind()` helper
- `frontend/src/lib/api.ts` — add `getEarningsCalendar`, `getEarningsDetail`, `postEarningsFullResearch`
- `frontend/src/app/(dashboard)/strategies/page.tsx` — group by kind, add "Research" section header
- `frontend/src/app/(dashboard)/trade/page.tsx` — query-param pre-fill (symbol, contract, side, qty, legs)
- `frontend/src/styles/design-tokens.css` — add `.t-ladder-row` utility
- `frontend/src/__tests__/setup-mocks.ts` — mock the three new API functions
- `frontend/src/types/index.ts` — add TypeScript types matching backend schemas

---

## Phase A — Foundation: Strategy-kind flag (Tasks 1-3)

### Task 1: Backend `kind` field on `StrategyMeta` + registry entry

**Files:**
- Modify: `backend/strategies/base.py` (lines ~126-200, the `StrategyMeta` dataclass)
- Modify: `backend/strategies/registry.py` (add placeholder registration)
- Test: `backend/tests/test_strategy_kind.py` (new)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_strategy_kind.py`:

```python
"""Strategy metadata gains a `kind` flag distinguishing autonomous
strategies (run by the engine) from research tools (decision-support UI only).
"""
from strategies.base import StrategyMeta
from strategies.registry import get_meta, list_strategies, load_all


def test_strategy_meta_defaults_to_autonomous():
    """Existing strategies that don't set `kind` must default to autonomous
    so the engine keeps picking them up unchanged."""
    meta = StrategyMeta(name="test_default")
    assert meta.kind == "autonomous"


def test_strategy_meta_accepts_research_kind():
    """New research-only entries declare kind='research' and must round-trip."""
    meta = StrategyMeta(name="test_research", kind="research")
    assert meta.kind == "research"


def test_earnings_options_play_registered_as_research():
    """The earnings-options-play screener is registered as research-kind so
    the /strategies list groups it under the Research section."""
    load_all()
    meta = get_meta("earnings-options-play")
    assert meta is not None, "earnings-options-play must be registered"
    assert meta.kind == "research"


def test_existing_autonomous_strategies_unchanged():
    """Registered autonomous strategies keep kind='autonomous'."""
    load_all()
    pead = get_meta("pead")
    assert pead is not None
    assert pead.kind == "autonomous"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest tests/test_strategy_kind.py -v
```
Expected: `test_strategy_meta_defaults_to_autonomous` FAILS with `AttributeError` on `.kind` (field not yet added).

- [ ] **Step 3: Add `kind` field to `StrategyMeta`**

In `backend/strategies/base.py`, inside the `@dataclass(frozen=True) class StrategyMeta:` block, after the existing `description: str = ""` (or wherever the last field is — search for the last field in that dataclass), add:

```python
    kind: str = "autonomous"
    """Strategy kind — 'autonomous' strategies are run by the engine; 'research'
    entries are decision-support UIs (e.g. earnings-options-play screener) that
    the engine never calls `generate_signals` on. The /strategies list page
    uses this to group cards under Active/Research/Coming soon."""
```

Use `str` (not `Literal`) to keep Python 3.10-compat. Runtime validation lives in the registry decorator (step 4).

Also add a validator in the decorator in `backend/strategies/registry.py` — find the `register_strategy` function and add near its top:

```python
    # (inside register_strategy)
    if meta.kind not in ("autonomous", "research"):
        raise ValueError(
            f"Invalid strategy kind {meta.kind!r} for {meta.name!r}. "
            "Must be 'autonomous' or 'research'."
        )
```

- [ ] **Step 4: Register the earnings-options-play placeholder**

Create `backend/strategies/earnings_options_play/__init__.py`:

```python
"""Earnings Options Play — research-kind registration.

This strategy is a UI-only decision-support screener — the engine never
calls `generate_signals`. Registered only so /strategies surfaces it in the
Research section, and so the backend earnings router can resolve
`earnings-options-play` as a known strategy id.
"""
from . import strategy  # noqa: F401 — decorator side-effect
```

Create `backend/strategies/earnings_options_play/strategy.py`:

```python
"""Earnings Options Play — research screener (no engine logic).

Research-kind strategies are stubs that exist purely so the registry knows
about them. `generate_signals` and friends return empty; the engine excludes
research-kind strategies from its run loop.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

from strategies.base import Context, Signal, Strategy, StrategyMeta
from strategies.registry import register_strategy


@register_strategy(
    StrategyMeta(
        name="earnings-options-play",
        category="options",
        description=(
            "Research screener: upcoming earnings + full options lab + Claude "
            "Opus analysis. Manual trade only (deep-links into /trade)."
        ),
        kind="research",
    )
)
class EarningsOptionsPlay(Strategy):
    """Stub — engine never invokes these."""

    def configure(self, params: dict) -> None:  # noqa: D401
        pass

    def universe(self, asof: date, ctx: Context) -> Iterable[str]:
        return ()

    def generate_signals(self, asof: date, ctx: Context) -> Iterable[Signal]:
        return ()

    def manage(self, asof: date, ctx: Context) -> Iterable[Signal]:
        return ()
```

Also: make sure the engine loop skips `kind == "research"`. In `backend/engine/run.py` (or wherever the engine iterates `list_strategies()` — search for it), add a filter. If the engine already only runs strategies whose `generate_signals` returns non-empty, no change needed. If not, add an explicit `if meta.kind != "autonomous": continue`.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest tests/test_strategy_kind.py -v
```
Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/strategies/base.py backend/strategies/registry.py \
        backend/strategies/earnings_options_play/ \
        backend/tests/test_strategy_kind.py
git commit -m "feat(strategies): add kind flag + register earnings-options-play as research"
```

---

### Task 2: Frontend `kind` field + STRATEGY_META entry

**Files:**
- Modify: `frontend/src/lib/strategies.ts`
- Test: `frontend/src/__tests__/lib/strategies-kind.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/__tests__/lib/strategies-kind.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { STRATEGY_META, metaKind } from "@/lib/strategies";

describe("STRATEGY_META kind flag", () => {
  it("defaults autonomous strategies to 'autonomous'", () => {
    expect(metaKind("pead")).toBe("autonomous");
    expect(metaKind("momentum-quality")).toBe("autonomous");
  });

  it("registers earnings-options-play with kind='research'", () => {
    expect(STRATEGY_META["earnings-options-play"]).toBeDefined();
    expect(metaKind("earnings-options-play")).toBe("research");
  });

  it("surfaces research name + subtitle for the list card", () => {
    const entry = STRATEGY_META["earnings-options-play"];
    expect(entry.name).toMatch(/Earnings Options Play/i);
    expect(entry.regimeNote).toMatch(/research|screener|decision/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && pnpm test -- strategies-kind
```
Expected: FAIL with "cannot read properties of undefined" on `STRATEGY_META["earnings-options-play"]`.

- [ ] **Step 3: Add `kind` field + earnings-options-play entry**

In `frontend/src/lib/strategies.ts`:

(1) Add `StrategyKind` type near `StrategyStage`:

```typescript
/** Kind — autonomous strategies run in the engine; research entries are
 *  decision-support screeners (no auto-trading). Drives /strategies section
 *  grouping (Active / Research / Coming soon). */
export type StrategyKind = "autonomous" | "research";
```

(2) Extend `StrategyMetaEntry`:

```typescript
export interface StrategyMetaEntry {
  name: string;
  shortName: string;
  icon: typeof Activity;
  regimeNote: string;
  group: StrategyGroup;
  stage?: StrategyStage;
  /** Strategy kind — defaults to "autonomous" when omitted. */
  kind?: StrategyKind;
}
```

(3) Add a `metaKind()` helper near the existing `metaStage()`:

```typescript
export function metaKind(id: string): StrategyKind {
  return STRATEGY_META[id]?.kind ?? "autonomous";
}
```

(4) Register the entry inside `STRATEGY_META`:

```typescript
  "earnings-options-play": {
    name: "Earnings Options Play",
    shortName: "Earnings Options",
    icon: CandlestickChart,
    regimeNote: "Research screener · pick your own trade",
    group: "fundamental",
    kind: "research",
  },
```

(5) Ensure `STRATEGY_ORDER` (or wherever the registry ordering list lives) includes `"earnings-options-play"` — append it after the existing options-related strategies.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && pnpm test -- strategies-kind
```
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/strategies.ts frontend/src/__tests__/lib/strategies-kind.test.ts
git commit -m "feat(strategies): add kind flag + earnings-options-play meta entry"
```

---

### Task 3: `ResearchStrategyCard` + `/strategies` kind grouping

**Files:**
- Create: `frontend/src/components/strategies/ResearchStrategyCard.tsx`
- Modify: `frontend/src/app/(dashboard)/strategies/page.tsx`
- Test: `frontend/src/__tests__/components/ResearchStrategyCard.test.tsx` (new)
- Test: `frontend/src/__tests__/strategies-page-grouping.test.tsx` (new)

- [ ] **Step 1: Write the failing component test**

Create `frontend/src/__tests__/components/ResearchStrategyCard.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import ResearchStrategyCard from "@/components/strategies/ResearchStrategyCard";

describe("ResearchStrategyCard", () => {
  it("renders honest research metrics (not Sharpe/CAGR/MaxDD)", () => {
    const { container } = render(
      <ResearchStrategyCard
        id="earnings-options-play"
        name="Earnings Options Play"
        subtitle="Research screener · pick your own trade"
        metrics={{
          thisWeekCount: 12,
          avgIvRank: 68,
          topSetup: "NVDA",
        }}
      />,
    );
    expect(container.textContent).toContain("Earnings Options Play");
    expect(container.textContent).toContain("THIS WEEK");
    expect(container.textContent).toContain("12");
    expect(container.textContent).toContain("AVG IV RANK");
    expect(container.textContent).toContain("68");
    expect(container.textContent).toContain("TOP SETUP");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toMatch(/RESEARCH/i);
    // Must NOT leak autonomous metrics
    expect(container.textContent).not.toMatch(/SHARPE|CAGR|MAX DD/i);
  });

  it("links to /strategies/earnings-options-play", () => {
    const { container } = render(
      <ResearchStrategyCard
        id="earnings-options-play"
        name="Earnings Options Play"
        subtitle=""
        metrics={{ thisWeekCount: 0, avgIvRank: 0, topSetup: null }}
      />,
    );
    const link = container.querySelector('a[href="/strategies/earnings-options-play"]');
    expect(link).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && pnpm test -- ResearchStrategyCard
```
Expected: FAIL — `ResearchStrategyCard` module doesn't exist.

- [ ] **Step 3: Implement `ResearchStrategyCard`**

Create `frontend/src/components/strategies/ResearchStrategyCard.tsx`:

```typescript
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export interface ResearchCardMetrics {
  thisWeekCount: number;
  avgIvRank: number;
  topSetup: string | null;
}

export interface ResearchStrategyCardProps {
  id: string;
  name: string;
  subtitle: string;
  metrics: ResearchCardMetrics;
}

/**
 * Research-kind strategy card for /strategies.
 *
 * Mirrors the autonomous-strategy card's shape (page must stay visually
 * coherent), but swaps the Sharpe/CAGR/MaxDD metric row for honest
 * research metrics — count of upcoming earnings, average IV rank across
 * those earnings, and the current top-setup symbol.
 *
 * Pill reads "RESEARCH" (vs "ACTIVE") so users immediately see this is a
 * decision-support tool, not an autonomous strategy.
 */
export default function ResearchStrategyCard({
  id,
  name,
  subtitle,
  metrics,
}: ResearchStrategyCardProps) {
  return (
    <Link
      href={`/strategies/${id}`}
      className="group relative block rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-5 transition-colors hover:border-[color:var(--fg-accent)]"
      data-slot="research-strategy-card"
      data-strategy-id={id}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="t-display-section italic">{name}</h3>
          <p className="mt-1 font-mono text-[13px] text-[color:var(--fg-muted)]">
            {subtitle}
          </p>
        </div>
        <span className="t-label shrink-0 rounded border border-[color:var(--fg-border)] px-2 py-0.5 text-[color:var(--fg-accent)]">
          RESEARCH
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-4 border-t border-[color:var(--fg-border)] pt-4">
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">THIS WEEK</dt>
          <dd className="t-num-lg">{metrics.thisWeekCount}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">earnings</dd>
        </div>
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">AVG IV RANK</dt>
          <dd className="t-num-lg">{metrics.avgIvRank || "—"}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">across set</dd>
        </div>
        <div>
          <dt className="t-label text-[color:var(--fg-muted)]">TOP SETUP</dt>
          <dd className="t-num-lg">{metrics.topSetup ?? "—"}</dd>
          <dd className="t-label mt-0.5 text-[color:var(--fg-muted)]">recommended</dd>
        </div>
      </dl>

      <ArrowRight
        className="absolute bottom-4 right-4 h-4 w-4 text-[color:var(--fg-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
    </Link>
  );
}
```

- [ ] **Step 4: Run component test to verify it passes**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && pnpm test -- ResearchStrategyCard
```
Expected: both tests PASS.

- [ ] **Step 5: Write the failing grouping test**

Create `frontend/src/__tests__/strategies-page-grouping.test.tsx`:

```typescript
import "./setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import StrategiesPage from "@/app/(dashboard)/strategies/page";
import * as api from "@/lib/api";

describe("/strategies kind grouping", () => {
  it("renders an Active section (autonomous) and a Research section", async () => {
    vi.mocked(api.getStrategies).mockResolvedValue([
      { id: "pead", name: "PEAD", status: "active", invested_amount: 0, total_return_pct: 0, win_rate: 0.5, active_positions_count: 0, sparkline: [] },
      { id: "earnings-options-play", name: "Earnings Options Play", status: "active", invested_amount: 0, total_return_pct: 0, win_rate: -1, active_positions_count: 0, sparkline: [] },
    ] as any);
    vi.mocked(api.getStrategyCatalog).mockResolvedValue({ strategies: [] } as any);

    const { container } = render(<StrategiesPage />);
    await waitFor(() => {
      expect(container.textContent).toMatch(/Active/i);
      expect(container.textContent).toMatch(/Research/i);
      // Earnings Options Play must appear under Research
      const researchHeader = container.querySelector('[data-section="research"]');
      expect(researchHeader?.textContent).toContain("Earnings Options Play");
      // PEAD must appear under Active
      const activeHeader = container.querySelector('[data-section="active"]');
      expect(activeHeader?.textContent).toContain("PEAD");
    });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

```bash
pnpm test -- strategies-page-grouping
```
Expected: FAIL — no `data-section` attributes, both strategies render together.

- [ ] **Step 7: Update `/strategies/page.tsx` to group by kind**

In `frontend/src/app/(dashboard)/strategies/page.tsx`:

Import the new helper:

```typescript
import { STRATEGY_META, STRATEGY_ORDER, metaStage, metaKind, type StrategyStage } from "@/lib/strategies";
import ResearchStrategyCard from "@/components/strategies/ResearchStrategyCard";
```

After the existing bucket classification (look for `type Bucket = "active" | "paused" | "coming_soon"`), add a `kind` pre-split BEFORE the stage bucketing. Pseudocode (adapt to what's there):

```typescript
// Split research-kind off first — they never enter the active/paused/coming
// buckets since they're not autonomous strategies.
const researchEntries: ListingStrategy[] = strategies.filter(s => metaKind(s.id) === "research");
const autonomousEntries: ListingStrategy[] = strategies.filter(s => metaKind(s.id) === "autonomous");

// Existing stage bucketing applies only to autonomous strategies:
const activeBucket = autonomousEntries.filter(s => s.stage === "live" && s.apiStatus === "active");
const pausedBucket = autonomousEntries.filter(s => s.stage === "live" && s.apiStatus === "paused");
const comingSoonBucket = autonomousEntries.filter(s => s.stage === "planned");
```

Render three `<section data-section="...">` blocks. Inject the Research section between Active (or Paused) and Coming Soon:

```tsx
{activeBucket.length > 0 && (
  <section data-section="active" className="...">
    <h2 className="t-display-section italic">Active <span className="t-label text-[color:var(--fg-muted)]">{activeBucket.length}</span></h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {activeBucket.map(s => <StrategyCard key={s.id} {...s} />)}
    </div>
  </section>
)}

{researchEntries.length > 0 && (
  <section data-section="research" className="...">
    <h2 className="t-display-section italic">Research <span className="t-label text-[color:var(--fg-muted)]">{researchEntries.length}</span></h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {researchEntries.map(s => (
        <ResearchStrategyCard
          key={s.id}
          id={s.id}
          name={s.displayName}
          subtitle={STRATEGY_META[s.id]?.regimeNote ?? ""}
          metrics={{
            // Placeholder zeros for now — Task 10 wires real values from a
            // preview API. Leave at 0 and topSetup=null for now; the card
            // renders em-dash for empty metrics.
            thisWeekCount: 0,
            avgIvRank: 0,
            topSetup: null,
          }}
        />
      ))}
    </div>
  </section>
)}

{comingSoonBucket.length > 0 && (
  <section data-section="coming-soon" className="...">
    {/* existing coming-soon rendering */}
  </section>
)}
```

- [ ] **Step 8: Run grouping test + full test suite**

```bash
pnpm test -- strategies-page-grouping
pnpm test
```
Expected: grouping test PASSES, full suite still green (735+ tests).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/strategies/ResearchStrategyCard.tsx \
        frontend/src/app/\(dashboard\)/strategies/page.tsx \
        frontend/src/__tests__/components/ResearchStrategyCard.test.tsx \
        frontend/src/__tests__/strategies-page-grouping.test.tsx
git commit -m "feat(strategies): ResearchStrategyCard + kind-based section grouping"
```

---

## Phase B — Backend: Data models + aggregator + endpoints (Tasks 4-9)

### Task 4: Pydantic response schemas (`api/schemas/earnings.py`)

**Files:**
- Create: `backend/api/schemas/earnings.py`
- Test: `backend/tests/test_earnings_schemas.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_earnings_schemas.py`:

```python
"""Contract tests for earnings-screener response schemas.

These lock the wire format so the frontend can depend on it. Any breaking
change here should either bump a version or land with a coordinated
frontend change in the same commit.
"""
from datetime import date, datetime, timezone
import pytest
from pydantic import ValidationError

from api.schemas.earnings import (
    CalendarRow,
    CalendarResponse,
    EarningsDetail,
    LadderRow,
    StrikeLadder,
    ClaudeStructured,
    ClaudeFullResearch,
    HistoricalBlock,
    HistQuarter,
    IVTermPoint,
    SkewBlock,
    MetricsBlock,
    QuoteBlock,
    NewsArticle,
)


def test_calendar_row_minimal():
    row = CalendarRow(
        symbol="NVDA", company="Nvidia", sector="Semiconductors",
        report_date=date(2026, 4, 23), report_time="AMC", days_until=1,
    )
    assert row.symbol == "NVDA"
    # All optional fields default to None
    assert row.iv_rank is None
    assert row.claude_verdict is None


def test_calendar_row_rejects_bad_report_time():
    with pytest.raises(ValidationError):
        CalendarRow(
            symbol="X", company="X", sector="X",
            report_date=date.today(), report_time="NOPE", days_until=0,
        )


def test_ladder_row_roundtrip():
    row = LadderRow(
        strike=205.0, side="call", bucket="ATM",
        delta=0.5, bid=6.1, ask=6.3, mid=6.2, iv=0.78,
        yield_pct=0.031, pop=0.5,
        theta=-0.22, gamma=0.018, vega=0.31, oi=1000, volume=500,
    )
    dumped = row.model_dump()
    reloaded = LadderRow(**dumped)
    assert reloaded == row


def test_earnings_detail_all_optional():
    """Every leaf must be nullable so partial provider failures don't 500."""
    detail = EarningsDetail(
        symbol="NVDA", company="Nvidia", sector="Semiconductors",
        report_date=date(2026, 4, 23), report_time="AMC",
        news=[],
        partial=False,
        generated_at=datetime.now(timezone.utc),
    )
    assert detail.quote is None
    assert detail.metrics is None
    assert detail.claude_structured is None
    assert detail.claude_full_research is None


def test_claude_structured_verdict_vocabulary():
    with pytest.raises(ValidationError):
        ClaudeStructured(
            verdict="manic",  # invalid
            direction_magnitude={"bull_case_pct": 0.04, "bear_case_pct": -0.05},
            thesis="x", catalysts=[], risks=[],
            suggested_play="short strangle",
            suggested_play_reason="x",
            confidence=0.5, model="claude-opus-4-7",
            generated_at=datetime.now(timezone.utc),
        )


def test_calendar_response_shape():
    resp = CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)
    assert resp.earnings == []
    assert resp.partial is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest tests/test_earnings_schemas.py -v
```
Expected: FAIL — module `api.schemas.earnings` not importable.

- [ ] **Step 3: Implement the schemas**

Create `backend/api/schemas/__init__.py` (empty) if it doesn't exist.

Create `backend/api/schemas/earnings.py`:

```python
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
    report_date: date
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
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest tests/test_earnings_schemas.py -v
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/api/schemas/
git commit -m "feat(earnings): pydantic schemas for /api/v1/earnings/*"
```

---

### Task 5: `earnings_screener` helpers — expected move + historical stats

**Files:**
- Create: `backend/services/__init__.py` (empty if not present)
- Create: `backend/services/earnings_screener.py` (helpers first; aggregator in Task 8)
- Test: `backend/tests/test_earnings_screener.py`

- [ ] **Step 1: Write failing tests for the pure helpers**

Create `backend/tests/test_earnings_screener.py`:

```python
"""Pure-function tests for earnings_screener. Provider mocking comes in
Task 8 when we test the aggregator; these tests cover the math."""
from datetime import date

from services.earnings_screener import (
    compute_expected_move_from_straddle,
    compute_historical_stats,
)


def test_expected_move_from_atm_straddle():
    """Straddle mid / underlying = expected move %. E.g. NVDA @ 200, ATM
    call mid 6.2 + put mid 6.4 → 12.6 / 200 = 6.3%."""
    em = compute_expected_move_from_straddle(underlying=200.0, call_mid=6.2, put_mid=6.4)
    assert round(em, 4) == 0.063


def test_expected_move_zero_when_no_prices():
    assert compute_expected_move_from_straddle(underlying=200.0, call_mid=0.0, put_mid=0.0) == 0.0


def test_expected_move_handles_zero_underlying():
    """Guard rail — never divides by zero."""
    assert compute_expected_move_from_straddle(underlying=0.0, call_mid=5.0, put_mid=5.0) is None


def test_historical_stats_basic():
    """avg |move|, wins/losses (using next-day), and beat rate."""
    quarters = [
        {"report_date": date(2025, 1, 22), "surprise_pct": 0.08, "next_day_move_pct": 0.042, "five_day_move_pct": 0.053},
        {"report_date": date(2024, 10, 22), "surprise_pct": -0.02, "next_day_move_pct": -0.081, "five_day_move_pct": -0.023},
        {"report_date": date(2024, 7, 22), "surprise_pct": 0.05, "next_day_move_pct": 0.034, "five_day_move_pct": 0.041},
        {"report_date": date(2024, 4, 22), "surprise_pct": 0.12, "next_day_move_pct": 0.090, "five_day_move_pct": 0.110},
    ]
    stats = compute_historical_stats(quarters)
    # avg |move| = (4.2 + 8.1 + 3.4 + 9.0) / 4 = 6.175%
    assert round(stats["avg_abs_move_pct"], 4) == 0.0618
    # wins / losses by next-day sign
    assert stats["wins"] == 3
    assert stats["losses"] == 1
    # beat rate = surprise_pct > 0 fraction = 3/4
    assert stats["surprise_beat_rate"] == 0.75


def test_historical_stats_empty():
    stats = compute_historical_stats([])
    assert stats["avg_abs_move_pct"] == 0.0
    assert stats["wins"] == 0
    assert stats["losses"] == 0
    assert stats["surprise_beat_rate"] == 0.0
```

- [ ] **Step 2: Run to verify fails**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest tests/test_earnings_screener.py -v
```
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the helpers**

Create `backend/services/earnings_screener.py`:

```python
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

import logging
from typing import Mapping, Sequence

log = logging.getLogger(__name__)


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
    return {
        "avg_abs_move_pct": sum(abs_moves) / len(abs_moves),
        "wins": wins,
        "losses": losses,
        "surprise_beat_rate": beat_rate,
    }
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_earnings_screener.py -v
```
Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/__init__.py backend/services/earnings_screener.py \
        backend/tests/test_earnings_screener.py
git commit -m "feat(earnings): expected-move + historical-stats helpers"
```

---

### Task 6: Claude structured prompt + runner

**Files:**
- Create: `backend/services/earnings_prompts.py`
- Test: expand `backend/tests/test_earnings_screener.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_earnings_screener.py`:

```python
from services.earnings_prompts import (
    build_structured_prompt,
    parse_structured_response,
)


def test_structured_prompt_includes_all_context_keys():
    """Prompt must surface IV rank, expected move, hist avg, news headlines,
    and regime — the geeky-user-level context the model needs to produce a
    decent thesis."""
    prompt = build_structured_prompt(
        symbol="NVDA",
        company="Nvidia",
        sector="Semiconductors",
        report_date="2026-04-23",
        report_time="AMC",
        price=201.7,
        iv_rank=78,
        iv_percentile=82,
        hv_20=0.42,
        expected_move_pct=0.064,
        hist_avg_abs_move_pct=0.052,
        recent_beats_misses=[("2026-01-22", "+8%"), ("2025-10-22", "-2%")],
        headlines=["Blackwell ramp on track", "China export pivot"],
        market_regime="Bear-HighVol",
    )
    text = prompt["user"]
    for key in ["NVDA", "Semiconductors", "IV rank: 78", "expected move", "±5.2", "Blackwell", "Bear-HighVol"]:
        assert key in text, f"missing {key!r} in prompt"
    assert "JSON" in prompt["system"]


def test_parse_structured_response_happy_path():
    raw = '''{
      "verdict": "neutral-bull",
      "direction_magnitude": {"bull_case_pct": 0.04, "bear_case_pct": -0.05},
      "thesis": "IV is overpricing vs realized.",
      "catalysts": ["data-center guide"],
      "risks": ["guide miss"],
      "suggested_play": "short strangle",
      "suggested_play_reason": "IVR > 75 bucket",
      "confidence": 0.62
    }'''
    parsed = parse_structured_response(raw)
    assert parsed["verdict"] == "neutral-bull"
    assert parsed["confidence"] == 0.62
    assert parsed["suggested_play"] == "short strangle"


def test_parse_structured_response_rejects_invalid_verdict():
    import pytest
    raw = '{"verdict": "moonshot", "direction_magnitude": {"bull_case_pct": 0, "bear_case_pct": 0}, "thesis": "x", "catalysts": [], "risks": [], "suggested_play": "short call", "suggested_play_reason": "x", "confidence": 0.5}'
    with pytest.raises(ValueError, match="verdict"):
        parse_structured_response(raw)


def test_parse_structured_response_rejects_malformed_json():
    import pytest
    with pytest.raises(ValueError, match="JSON"):
        parse_structured_response("not json {")
```

- [ ] **Step 2: Run to verify fails**

```bash
pytest tests/test_earnings_screener.py::test_structured_prompt_includes_all_context_keys -v
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement prompt builders**

Create `backend/services/earnings_prompts.py`:

```python
"""Claude prompt assembly for earnings-options-play.

Two tiers:
  • `build_structured_prompt` + `parse_structured_response` — eager,
    cached for 4h, ~200 words out. Runs for every upcoming earning.
  • `build_full_prompt` + `parse_full_response` — on-demand, cached for
    24h, ~500 words out. Fires when the user clicks 'Run full research'.

Model defaults to claude-opus-4-7 per spec; structured can be demoted to
Sonnet by flipping MODEL_STRUCTURED here.
"""
from __future__ import annotations

import json
from typing import Sequence

MODEL_STRUCTURED = "claude-opus-4-7"
MODEL_FULL = "claude-opus-4-7"

_VALID_VERDICTS = {"bullish", "neutral-bull", "neutral", "neutral-bear", "bearish"}
_VALID_SETUPS = {"short call", "cash-secured put", "short strangle", "iron condor"}


def build_structured_prompt(
    *,
    symbol: str,
    company: str,
    sector: str,
    report_date: str,
    report_time: str,
    price: float,
    iv_rank: float,
    iv_percentile: float,
    hv_20: float,
    expected_move_pct: float,
    hist_avg_abs_move_pct: float,
    recent_beats_misses: Sequence[tuple[str, str]],
    headlines: Sequence[str],
    market_regime: str,
) -> dict:
    """Return a {'system': str, 'user': str} prompt dict."""
    beats_block = "\n".join(f"  · {d}: {s}" for d, s in recent_beats_misses[:4])
    news_block = "\n".join(f"  · {h}" for h in headlines[:5])
    system = (
        "You are an editorial options-research assistant specializing in "
        "earnings premium-selling. Output a single JSON object matching "
        "this schema exactly and nothing else:\n"
        '{"verdict": "bullish|neutral-bull|neutral|neutral-bear|bearish",\n'
        ' "direction_magnitude": {"bull_case_pct": float, "bear_case_pct": float},\n'
        ' "thesis": "3 sentences",\n'
        ' "catalysts": ["..."], "risks": ["..."],\n'
        ' "suggested_play": "short call|cash-secured put|short strangle|iron condor",\n'
        ' "suggested_play_reason": "one sentence",\n'
        ' "confidence": float 0-1}\n'
        "No markdown. No prose outside the JSON."
    )
    user = (
        f"Earnings setup — {company} ({symbol}), {sector}.\n"
        f"Reports: {report_date} {report_time}.\n"
        f"Price: {price:.2f}. IV rank: {iv_rank:.0f} · IV pctl: {iv_percentile:.0f}.\n"
        f"HV 20d: {hv_20:.2%}. IV-implied expected move (straddle): ±{expected_move_pct:.2%}. "
        f"Historical avg |move| last 8q: ±{hist_avg_abs_move_pct:.2%}.\n"
        f"Recent earnings:\n{beats_block}\n"
        f"Top news:\n{news_block}\n"
        f"Market regime: {market_regime}.\n\n"
        "Based on this, return the JSON described in the system prompt. "
        "Favor premium-selling setups when IV rank is elevated relative to "
        "historical realized; favor directional plays when there's a clear "
        "catalyst + low IV. Suggested play must come from the fixed vocab."
    )
    return {"system": system, "user": user}


def parse_structured_response(raw: str) -> dict:
    """Parse Claude's structured JSON. Validates verdict + suggested_play vs
    vocab and raises ValueError on any deviation so the route can retry once."""
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON from Claude: {e}") from e

    verdict = obj.get("verdict")
    if verdict not in _VALID_VERDICTS:
        raise ValueError(f"invalid verdict {verdict!r}, expected one of {_VALID_VERDICTS}")
    setup = obj.get("suggested_play")
    if setup not in _VALID_SETUPS:
        raise ValueError(f"invalid suggested_play {setup!r}")
    for required in ("direction_magnitude", "thesis", "catalysts", "risks", "confidence", "suggested_play_reason"):
        if required not in obj:
            raise ValueError(f"missing key {required!r}")
    conf = float(obj["confidence"])
    if not 0 <= conf <= 1:
        raise ValueError(f"confidence {conf} not in 0..1")
    return obj


def build_full_prompt(
    *,
    symbol: str,
    company: str,
    sector: str,
    report_date: str,
    report_time: str,
    price: float,
    iv_rank: float,
    iv_percentile: float,
    expected_move_pct: float,
    historical_quarters: Sequence[dict],
    headlines: Sequence[str],
    market_regime: str,
    sector_peers_pct_change_5d: dict[str, float],
) -> dict:
    """Richer prompt for on-demand full research (~500 words out)."""
    quarters_block = "\n".join(
        f"  · {q['report_date']}: surprise {q.get('surprise_pct', 0):+.1%}, "
        f"next-day {q['next_day_move_pct']:+.1%}, 5-day {q['five_day_move_pct']:+.1%}"
        for q in historical_quarters[:8]
    )
    peers_block = ", ".join(f"{s} {p:+.1%}" for s, p in sector_peers_pct_change_5d.items())
    system = (
        "You are a senior options-research analyst. Produce a full research "
        "note as a SINGLE JSON object with these keys:\n"
        '{"thesis_paragraph": str,\n'
        ' "comparable_setups": [{"report_date": "YYYY-MM-DD", "iv_rank": float, '
        '"setup": str, "outcome": str, "similarity_score": float}],\n'
        ' "post_earnings_drift_playbook": str,\n'
        ' "sector_backdrop": str,\n'
        ' "analyst_consensus_delta": str,\n'
        ' "what_would_change_my_mind": str,\n'
        ' "confidence": float}\n'
        "No markdown. No prose outside the JSON."
    )
    user = (
        f"{company} ({symbol}) · {sector} · reports {report_date} {report_time}.\n"
        f"Price {price:.2f}. IV rank {iv_rank:.0f}, IV pctl {iv_percentile:.0f}. "
        f"Implied move ±{expected_move_pct:.2%}.\n"
        f"Last 8 earnings:\n{quarters_block}\n"
        f"Sector peers 5d: {peers_block}\n"
        f"Top news: {'; '.join(headlines[:5])}\n"
        f"Market regime: {market_regime}\n\n"
        "Produce the JSON described. Comparable setups must draw from the "
        "provided history — find 2-3 past quarters with similar IV rank + "
        "setup and describe the outcome."
    )
    return {"system": system, "user": user}


def parse_full_response(raw: str) -> dict:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"invalid JSON from Claude full research: {e}") from e
    for required in (
        "thesis_paragraph", "comparable_setups", "post_earnings_drift_playbook",
        "sector_backdrop", "analyst_consensus_delta", "what_would_change_my_mind",
        "confidence",
    ):
        if required not in obj:
            raise ValueError(f"missing key {required!r}")
    conf = float(obj["confidence"])
    if not 0 <= conf <= 1:
        raise ValueError(f"confidence {conf} not in 0..1")
    return obj
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_earnings_screener.py -v
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/earnings_prompts.py backend/tests/test_earnings_screener.py
git commit -m "feat(earnings): Claude structured + full prompts with schema validation"
```

---

### Task 7: Aggregator — `list_upcoming` + `get_detail`

**Files:**
- Modify: `backend/services/earnings_screener.py`
- Modify: `backend/tests/test_earnings_screener.py`

- [ ] **Step 1: Write failing tests with mocked providers**

Append to `backend/tests/test_earnings_screener.py`:

```python
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_list_upcoming_happy_path():
    """FMP returns 2 upcoming earnings; each symbol resolves quote/IV/Claude-cached.
    Result shape matches CalendarResponse."""
    from services import earnings_screener as svc

    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis",
         "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto",
         "report_date": "2026-04-24", "report_time": "AMC"},
    ]
    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=lambda row, **_: {**row, "price": 200.0, "iv_rank": 70.0})):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)

    assert len(resp.earnings) == 2
    assert resp.earnings[0].symbol == "NVDA"
    assert resp.earnings[0].price == 200.0
    assert resp.partial is False


@pytest.mark.asyncio
async def test_list_upcoming_filters_by_iv_rank():
    """min_iv_rank excludes rows under the threshold."""
    from services import earnings_screener as svc

    fake_earnings = [
        {"symbol": "A", "company": "A", "sector": "x", "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "B", "company": "B", "sector": "x", "report_date": "2026-04-23", "report_time": "AMC"},
    ]
    hydrated = {"A": {"iv_rank": 80}, "B": {"iv_rank": 30}}
    async def hydrate(row, **_):
        return {**row, "price": 100.0, **hydrated[row["symbol"]]}
    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=50)
    symbols = [r.symbol for r in resp.earnings]
    assert symbols == ["A"]


@pytest.mark.asyncio
async def test_list_upcoming_partial_on_hydrate_failure():
    """If one symbol's hydrate raises, the row comes back with partial=True
    and the response itself marks partial=True but does not 500."""
    from services import earnings_screener as svc

    fake_earnings = [
        {"symbol": "NVDA", "company": "Nvidia", "sector": "Semis", "report_date": "2026-04-23", "report_time": "AMC"},
        {"symbol": "TSLA", "company": "Tesla", "sector": "Auto", "report_date": "2026-04-24", "report_time": "AMC"},
    ]
    async def hydrate(row, **_):
        if row["symbol"] == "TSLA":
            raise RuntimeError("options provider down")
        return {**row, "price": 200.0, "iv_rank": 70.0}
    with patch.object(svc, "_fmp_upcoming", AsyncMock(return_value=fake_earnings)), \
         patch.object(svc, "_hydrate_row", AsyncMock(side_effect=hydrate)):
        resp = await svc.list_upcoming(window="both", min_iv_rank=0)
    assert resp.partial is True
    symbols_with_price = [r.symbol for r in resp.earnings if r.price is not None]
    assert "NVDA" in symbols_with_price
    assert "TSLA" in [r.symbol for r in resp.earnings]  # still present, fields null


@pytest.mark.asyncio
async def test_get_detail_merges_all_blocks():
    """get_detail pulls quote, options-chain, news, claude-structured and
    returns a populated EarningsDetail. Missing blocks become None; partial=True
    only when at least one block failed."""
    from services import earnings_screener as svc

    with patch.object(svc, "_load_quote", AsyncMock(return_value={"last": 200.0, "change": -1.0, "change_pct": -0.5})), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={"iv_rank": 78, "iv_percentile": 82, "current_iv": 0.79, "hv_20": 0.42, "hv_50": 0.38, "hv_100": 0.35, "hv_iv_ratio": 0.71, "expected_move_pct": 0.064, "expected_move_dollars": 12.8, "hist_avg_abs_move_pct": 0.052, "beat_rate": 0.87, "days_to_earnings": 1, "days_to_expiry": 3})), \
         patch.object(svc, "_load_strike_ladder", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_claude_structured", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_historical", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_iv_term", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_skew", AsyncMock(return_value=None)), \
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch.object(svc, "_load_earnings_meta", AsyncMock(return_value={"company": "Nvidia", "sector": "Semis", "report_date": "2026-04-23", "report_time": "AMC"})):
        detail = await svc.get_detail("NVDA")

    assert detail.symbol == "NVDA"
    assert detail.quote.last == 200.0
    assert detail.metrics.iv_rank == 78
    # Blocks that returned None must stay None
    assert detail.strike_ladder is None
    assert detail.claude_structured is None
```

Add `pytest-asyncio` to requirements-dev.txt if not already present. Verify:

```bash
cd /Users/GK/Downloads/alphadesk/backend && grep -q pytest-asyncio requirements-dev.txt || echo "pytest-asyncio>=0.23" >> requirements-dev.txt
```

- [ ] **Step 2: Run to verify fails**

```bash
pytest tests/test_earnings_screener.py::test_list_upcoming_happy_path -v
```
Expected: FAIL — functions don't exist.

- [ ] **Step 3: Implement the aggregators**

Append to `backend/services/earnings_screener.py`:

```python
import asyncio
from datetime import date, datetime, timezone
from typing import Any

from api.schemas.earnings import (
    CalendarResponse, CalendarRow, EarningsDetail, QuoteBlock, MetricsBlock,
    StrikeLadder, ClaudeStructured, ClaudeFullResearch, HistoricalBlock,
    HistoricalStats, HistQuarter, IVTermPoint, SkewBlock, NewsArticle,
)


# ─── Upstream adapters (thin wrappers; fan-outs call these) ──

async def _fmp_upcoming(window: str) -> list[dict]:
    """Return FMP earnings calendar rows for the requested window.

    `window`: 'current' = this week, 'next' = next week, 'both' = union.
    Wraps the existing `data.providers.fmp_earnings.FMPEarningsProvider`.
    """
    from data.providers.fmp_earnings import FMPEarningsProvider
    from datetime import timedelta

    provider = FMPEarningsProvider()
    today = date.today()
    # ISO week starts Monday; use simple 7/14-day windows keyed off today.
    if window == "current":
        start, end = today, today + timedelta(days=7)
    elif window == "next":
        start, end = today + timedelta(days=7), today + timedelta(days=14)
    else:  # both
        start, end = today, today + timedelta(days=14)
    rows = await provider.calendar(start=start, end=end)
    return rows


async def _load_quote(symbol: str) -> dict | None:
    from api.routes.market import get_quote  # existing helper
    try:
        q = await get_quote(symbol)
        return {"last": q.last, "change": q.change, "change_pct": q.changePct}
    except Exception as e:
        log.warning("quote load failed for %s: %s", symbol, e)
        return None


async def _load_metrics(symbol: str, report_date: date | None = None, expiry: date | None = None) -> dict | None:
    from api.routes.options import get_iv_data, get_options_chain
    try:
        iv = await get_iv_data(symbol)
        chain = await get_options_chain(symbol, expiration=expiry)
        # expected move from ATM straddle of first expiry >= earnings
        atm_call = min((c for c in chain.calls if abs(c.strike - chain.underlying) < 999), key=lambda c: abs(c.strike - chain.underlying), default=None)
        atm_put = min((p for p in chain.puts if abs(p.strike - chain.underlying) < 999), key=lambda p: abs(p.strike - chain.underlying), default=None)
        em_pct = None
        if atm_call and atm_put and chain.underlying > 0:
            em_pct = compute_expected_move_from_straddle(underlying=chain.underlying, call_mid=(atm_call.bid + atm_call.ask) / 2, put_mid=(atm_put.bid + atm_put.ask) / 2)
        days_to_earnings = (report_date - date.today()).days if report_date else None
        days_to_expiry = (expiry - date.today()).days if expiry else None
        return {
            "iv_rank": iv.ivRank,
            "iv_percentile": iv.ivPctl,
            "current_iv": iv.currentIV,
            "hv_20": iv.hv20 if hasattr(iv, "hv20") else None,
            "hv_50": iv.hv50 if hasattr(iv, "hv50") else None,
            "hv_100": iv.hv100 if hasattr(iv, "hv100") else None,
            "hv_iv_ratio": iv.hvRatio,
            "expected_move_pct": em_pct,
            "expected_move_dollars": em_pct * chain.underlying if em_pct else None,
            "hist_avg_abs_move_pct": None,  # filled by _load_historical
            "beat_rate": None,
            "days_to_earnings": days_to_earnings,
            "days_to_expiry": days_to_expiry,
        }
    except Exception as e:
        log.warning("metrics load failed for %s: %s", symbol, e)
        return None


async def _load_strike_ladder(symbol: str, expiry: date | None) -> dict | None:
    """Pull ATM / 30Δ / 15Δ rows (both sides) from Alpaca OPRA chain."""
    from api.routes.options import get_options_chain
    try:
        chain = await get_options_chain(symbol, expiration=expiry)
        rows = []
        for bucket, target_delta in [("ATM", 0.5), ("30Δ", 0.3), ("15Δ", 0.15)]:
            # For each bucket pick closest call + closest put by |delta|.
            call_match = min((c for c in chain.calls), key=lambda c: abs(abs(c.delta or 0.5) - target_delta), default=None)
            put_match = min((p for p in chain.puts), key=lambda p: abs(abs(p.delta or 0.5) - target_delta), default=None)
            for side, contract in [("call", call_match), ("put", put_match)]:
                if contract is None:
                    continue
                mid = (contract.bid + contract.ask) / 2 if contract.bid and contract.ask else contract.lastPrice or 0
                yield_pct = mid / chain.underlying if chain.underlying > 0 else 0
                # POP: rough approximation for short side = 1 - |delta|.
                pop = max(0, min(1, 1 - abs(contract.delta or 0.5)))
                rows.append({
                    "strike": contract.strike, "side": side, "bucket": bucket,
                    "delta": contract.delta or 0, "bid": contract.bid or 0,
                    "ask": contract.ask or 0, "mid": mid, "iv": contract.iv or 0,
                    "yield_pct": yield_pct, "pop": pop,
                    "theta": contract.theta or 0, "gamma": contract.gamma or 0,
                    "vega": contract.vega or 0, "oi": contract.openInterest or 0,
                    "volume": contract.volume or 0,
                })
        return {"expiry": chain.expirations[0] if chain.expirations else str(date.today()), "underlying_price": chain.underlying, "rows": rows}
    except Exception as e:
        log.warning("strike ladder load failed for %s: %s", symbol, e)
        return None


async def _load_claude_structured(symbol: str, context: dict) -> dict | None:
    """Read from cache; if missing, queue background job but don't block."""
    from core.cache import get_cache
    cache = get_cache()
    key = f"earnings:claude-structured:{symbol}:{context['report_date']}"
    cached = await cache.get(key)
    if cached:
        return cached
    # Cache miss — enqueue + return None so the row fills in on next refresh.
    asyncio.create_task(_run_structured_and_cache(symbol, context, cache, key))
    return None


async def _run_structured_and_cache(symbol: str, context: dict, cache, key: str) -> None:
    from services.earnings_prompts import build_structured_prompt, parse_structured_response, MODEL_STRUCTURED
    from agents.claude_client import ClaudeClient  # existing
    try:
        prompt = build_structured_prompt(**context)
        client = ClaudeClient()
        raw = await client.complete(system=prompt["system"], user=prompt["user"], model=MODEL_STRUCTURED)
        parsed = parse_structured_response(raw)
        payload = {**parsed, "model": MODEL_STRUCTURED, "generated_at": datetime.now(timezone.utc).isoformat()}
        await cache.set(key, payload, ttl_seconds=4 * 3600)
    except Exception as e:
        log.warning("Claude structured failed for %s: %s", symbol, e)


async def _load_historical(symbol: str) -> dict | None:
    """Pull last 8 earnings dates + post-earnings moves from FMP + bars."""
    # Implementation note: the FMP provider already has a history endpoint,
    # and daily bars come from the existing market router. Join them here.
    # Details are provider-specific — the engineer should mirror the
    # existing pattern in strategies/pead/data.py::EarningsHistoryLoader
    # which does the same join. Return None if either side errors.
    log.info("historical load for %s not yet implemented — returning None", symbol)
    return None  # TODO: Task 7.5 below


async def _load_iv_term(symbol: str) -> list[dict] | None:
    from api.routes.options import get_options_chain
    try:
        term = []
        today = date.today()
        chain = await get_options_chain(symbol)
        for exp in chain.expirations[:6]:  # first 6 expiries
            exp_date = date.fromisoformat(exp)
            # ATM call IV at this expiry
            exp_chain = await get_options_chain(symbol, expiration=exp_date)
            atm = min((c for c in exp_chain.calls), key=lambda c: abs(c.strike - exp_chain.underlying), default=None)
            if atm and atm.iv:
                term.append({"expiry": exp, "dte": (exp_date - today).days, "atm_iv": atm.iv})
        return term or None
    except Exception as e:
        log.warning("iv term load failed for %s: %s", symbol, e)
        return None


async def _load_skew(symbol: str) -> dict | None:
    from api.routes.options import get_options_chain
    try:
        chain = await get_options_chain(symbol)
        put_25d = min((p for p in chain.puts), key=lambda p: abs(abs(p.delta or 0.5) - 0.25), default=None)
        call_25d = min((c for c in chain.calls), key=lambda c: abs(abs(c.delta or 0.5) - 0.25), default=None)
        if put_25d and call_25d:
            skew = (put_25d.iv - call_25d.iv) * 100 if put_25d.iv and call_25d.iv else None
            interp = "neutral"
            if skew is not None:
                if skew > 1.5:
                    interp = "put-heavy skew"
                elif skew < -1.5:
                    interp = "call-heavy skew"
            return {
                "put_iv_25d": put_25d.iv, "call_iv_25d": call_25d.iv,
                "skew_points": skew, "interpretation": interp,
            }
        return None
    except Exception as e:
        log.warning("skew load failed for %s: %s", symbol, e)
        return None


async def _load_news(symbol: str) -> list[dict]:
    from api.routes.news import get_symbol_news  # existing
    try:
        articles = await get_symbol_news(symbol, limit=10)
        return [{"title": a.title, "source": a.source, "published_at": a.published_at, "url": a.url} for a in articles]
    except Exception as e:
        log.warning("news load failed for %s: %s", symbol, e)
        return []


async def _load_earnings_meta(symbol: str) -> dict | None:
    """Fetch company + sector + upcoming earnings row for this symbol from FMP."""
    rows = await _fmp_upcoming("both")
    match = next((r for r in rows if r["symbol"] == symbol), None)
    return match


async def _hydrate_row(row: dict, *, min_iv_rank: float = 0) -> dict | None:
    """Enrich one FMP row with price, IV rank, premium yields, expected move,
    hist avg, top_setup, and Claude-structured-cached fields. Returns enriched
    dict or raises on unrecoverable error (caller catches)."""
    symbol = row["symbol"]
    quote_task = asyncio.create_task(_load_quote(symbol))
    metrics_task = asyncio.create_task(_load_metrics(symbol, report_date=date.fromisoformat(row["report_date"])))
    # Lightweight IV-only fetch for the sidebar; full chain is reserved for detail.
    await asyncio.wait([quote_task, metrics_task], return_when=asyncio.ALL_COMPLETED)
    quote, metrics = quote_task.result(), metrics_task.result()
    iv_rank = metrics.get("iv_rank") if metrics else None
    # Bail if iv_rank below filter
    if iv_rank is not None and iv_rank < min_iv_rank:
        return None
    return {
        **row,
        "price": quote["last"] if quote else None,
        "change": quote["change"] if quote else None,
        "change_pct": quote["change_pct"] if quote else None,
        "iv_rank": iv_rank,
        "expected_move_pct": metrics.get("expected_move_pct") if metrics else None,
        "premium_yield_call_atm": None,  # Task 8 wiring; left null for Phase B
        "premium_yield_put_atm": None,
        "hist_avg_abs_move_pct": None,
        "claude_verdict": None,
        "claude_confidence": None,
        "top_setup": None,
        "days_until": (date.fromisoformat(row["report_date"]) - date.today()).days,
    }


# ─── Main aggregators ────────────────────────────────────────

async def list_upcoming(
    *,
    window: str = "both",
    min_iv_rank: float = 0,
    market_cap: str = "all",
    bmo_amc: str = "both",
    watchlist_only: bool = False,
    sort: str = "date",
) -> CalendarResponse:
    partial = False
    try:
        raw_rows = await _fmp_upcoming(window)
    except Exception as e:
        log.error("FMP earnings calendar unavailable: %s", e)
        return CalendarResponse(
            earnings=[], generated_at=datetime.now(timezone.utc),
            partial=True, error="earnings calendar unavailable",
        )

    # Fan-out hydration
    async def safe_hydrate(row):
        try:
            return await _hydrate_row(row, min_iv_rank=min_iv_rank)
        except Exception as e:
            log.warning("hydrate failed for %s: %s", row.get("symbol"), e)
            return row  # keep symbol visible with null fields

    hydrated = await asyncio.gather(*[safe_hydrate(r) for r in raw_rows])
    rows = []
    for h in hydrated:
        if h is None:
            continue  # filtered by min_iv_rank
        try:
            rows.append(CalendarRow(**h))
        except Exception as e:
            log.warning("row validation failed: %s — %s", e, h)
            partial = True

    # Sort
    if sort == "date":
        rows.sort(key=lambda r: (r.report_date, r.symbol))
    elif sort == "iv_rank":
        rows.sort(key=lambda r: r.iv_rank or 0, reverse=True)
    elif sort == "yield":
        rows.sort(key=lambda r: max(r.premium_yield_call_atm or 0, r.premium_yield_put_atm or 0), reverse=True)
    elif sort == "claude_confidence":
        rows.sort(key=lambda r: r.claude_confidence or 0, reverse=True)

    return CalendarResponse(
        earnings=rows, generated_at=datetime.now(timezone.utc), partial=partial,
    )


async def get_detail(symbol: str) -> EarningsDetail:
    meta = await _load_earnings_meta(symbol)
    if not meta:
        raise ValueError(f"symbol {symbol!r} has no upcoming earnings")

    # Parallel fan-out
    quote_t, metrics_t, ladder_t, news_t, iv_term_t, skew_t, hist_t = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(symbol, report_date=date.fromisoformat(meta["report_date"])),
        _load_strike_ladder(symbol, expiry=None),
        _load_news(symbol),
        _load_iv_term(symbol),
        _load_skew(symbol),
        _load_historical(symbol),
        return_exceptions=True,
    )
    partial = any(isinstance(x, Exception) for x in [quote_t, metrics_t, ladder_t, iv_term_t, skew_t, hist_t])

    # Claude structured — read cache only, don't block on a model call
    claude = await _load_claude_structured(symbol, context={
        "symbol": symbol, "company": meta["company"], "sector": meta["sector"],
        "report_date": meta["report_date"], "report_time": meta["report_time"],
        "price": quote_t["last"] if isinstance(quote_t, dict) else 0,
        "iv_rank": metrics_t.get("iv_rank", 0) if isinstance(metrics_t, dict) else 0,
        "iv_percentile": metrics_t.get("iv_percentile", 0) if isinstance(metrics_t, dict) else 0,
        "hv_20": metrics_t.get("hv_20", 0) if isinstance(metrics_t, dict) else 0,
        "expected_move_pct": metrics_t.get("expected_move_pct", 0) if isinstance(metrics_t, dict) else 0,
        "hist_avg_abs_move_pct": 0,  # TODO wire from hist_t
        "recent_beats_misses": [],
        "headlines": [n["title"] for n in news_t] if isinstance(news_t, list) else [],
        "market_regime": "Unknown",  # TODO wire from getMarketRegime
    })

    return EarningsDetail(
        symbol=symbol, company=meta["company"], sector=meta["sector"],
        report_date=date.fromisoformat(meta["report_date"]),
        report_time=meta["report_time"],
        quote=QuoteBlock(**quote_t) if isinstance(quote_t, dict) else None,
        metrics=MetricsBlock(**metrics_t) if isinstance(metrics_t, dict) else None,
        strike_ladder=StrikeLadder(**ladder_t) if isinstance(ladder_t, dict) else None,
        claude_structured=ClaudeStructured(**claude) if claude else None,
        claude_full_research=None,
        historical_earnings=HistoricalBlock(**hist_t) if isinstance(hist_t, dict) else None,
        iv_term_structure=[IVTermPoint(**p) for p in iv_term_t] if isinstance(iv_term_t, list) else None,
        skew=SkewBlock(**skew_t) if isinstance(skew_t, dict) else None,
        news=[NewsArticle(**n) for n in (news_t if isinstance(news_t, list) else [])],
        partial=partial,
        generated_at=datetime.now(timezone.utc),
    )
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pytest tests/test_earnings_screener.py -v
```
Expected: all PASS (including the mocked async tests).

- [ ] **Step 5: Commit**

```bash
git add backend/services/earnings_screener.py backend/tests/test_earnings_screener.py
git commit -m "feat(earnings): list_upcoming + get_detail aggregators with fan-out"
```

---

### Task 8: Aggregator — `run_full_research`

**Files:**
- Modify: `backend/services/earnings_screener.py`
- Modify: `backend/tests/test_earnings_screener.py`

- [ ] **Step 1: Write failing test**

Append:

```python
@pytest.mark.asyncio
async def test_run_full_research_calls_opus_and_caches():
    """run_full_research builds the richer prompt, calls Claude Opus, parses
    response, and caches 24h. Also verifies the parsed shape is a valid
    ClaudeFullResearch."""
    from services import earnings_screener as svc
    from api.schemas.earnings import ClaudeFullResearch

    fake_claude_raw = '{"thesis_paragraph": "...", "comparable_setups": [], "post_earnings_drift_playbook": "...", "sector_backdrop": "...", "analyst_consensus_delta": "...", "what_would_change_my_mind": "...", "confidence": 0.72}'
    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value=None)
    fake_cache.set = AsyncMock()
    fake_client = AsyncMock()
    fake_client.complete = AsyncMock(return_value=fake_claude_raw)

    with patch.object(svc, "_load_earnings_meta", AsyncMock(return_value={"company": "Nvidia", "sector": "Semis", "report_date": "2026-04-23", "report_time": "AMC"})), \
         patch.object(svc, "_load_quote", AsyncMock(return_value={"last": 200.0, "change": -1, "change_pct": -0.5})), \
         patch.object(svc, "_load_metrics", AsyncMock(return_value={"iv_rank": 78, "iv_percentile": 82, "expected_move_pct": 0.064})), \
         patch.object(svc, "_load_historical", AsyncMock(return_value={"quarters": [], "stats": {"avg_abs_move_pct": 0.05, "wins": 4, "losses": 4, "surprise_beat_rate": 0.5, "iv_vs_hist_vol_points": 1.2}})), \
         patch.object(svc, "_load_news", AsyncMock(return_value=[])), \
         patch("core.cache.get_cache", return_value=fake_cache), \
         patch("agents.claude_client.ClaudeClient", return_value=fake_client):
        result = await svc.run_full_research("NVDA")

    assert isinstance(result, ClaudeFullResearch)
    assert result.confidence == 0.72
    fake_cache.set.assert_called_once()
    args, kwargs = fake_cache.set.call_args
    assert "earnings:claude-full:NVDA" in args[0]
    assert kwargs.get("ttl_seconds") == 24 * 3600


@pytest.mark.asyncio
async def test_run_full_research_returns_cached_when_present():
    from services import earnings_screener as svc
    cached_payload = {
        "thesis_paragraph": "cached", "comparable_setups": [],
        "post_earnings_drift_playbook": "p", "sector_backdrop": "s",
        "analyst_consensus_delta": "a", "what_would_change_my_mind": "w",
        "confidence": 0.5, "model": "claude-opus-4-7",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    fake_cache = AsyncMock()
    fake_cache.get = AsyncMock(return_value=cached_payload)
    with patch("core.cache.get_cache", return_value=fake_cache), \
         patch.object(svc, "_load_earnings_meta", AsyncMock(return_value={"company": "N", "sector": "S", "report_date": "2026-04-23", "report_time": "AMC"})):
        result = await svc.run_full_research("NVDA")
    assert result.thesis_paragraph == "cached"
    fake_cache.set.assert_not_called()
```

- [ ] **Step 2: Verify fails** — `pytest tests/test_earnings_screener.py::test_run_full_research_calls_opus_and_caches -v`

- [ ] **Step 3: Implement**

Append to `backend/services/earnings_screener.py`:

```python
async def run_full_research(symbol: str) -> ClaudeFullResearch:
    from core.cache import get_cache
    from agents.claude_client import ClaudeClient
    from services.earnings_prompts import build_full_prompt, parse_full_response, MODEL_FULL

    meta = await _load_earnings_meta(symbol)
    if not meta:
        raise ValueError(f"{symbol!r} has no upcoming earnings")

    cache = get_cache()
    key = f"earnings:claude-full:{symbol}:{meta['report_date']}"
    cached = await cache.get(key)
    if cached:
        return ClaudeFullResearch(**cached)

    # Gather context
    quote, metrics, hist, news = await asyncio.gather(
        _load_quote(symbol),
        _load_metrics(symbol, report_date=date.fromisoformat(meta["report_date"])),
        _load_historical(symbol),
        _load_news(symbol),
        return_exceptions=True,
    )
    prompt = build_full_prompt(
        symbol=symbol, company=meta["company"], sector=meta["sector"],
        report_date=meta["report_date"], report_time=meta["report_time"],
        price=quote["last"] if isinstance(quote, dict) else 0.0,
        iv_rank=metrics.get("iv_rank", 0) if isinstance(metrics, dict) else 0,
        iv_percentile=metrics.get("iv_percentile", 0) if isinstance(metrics, dict) else 0,
        expected_move_pct=metrics.get("expected_move_pct", 0) if isinstance(metrics, dict) else 0,
        historical_quarters=hist.get("quarters", []) if isinstance(hist, dict) else [],
        headlines=[n["title"] for n in news] if isinstance(news, list) else [],
        market_regime="Unknown",  # TODO wire
        sector_peers_pct_change_5d={},  # TODO wire
    )
    client = ClaudeClient()
    raw = await client.complete(system=prompt["system"], user=prompt["user"], model=MODEL_FULL)
    parsed = parse_full_response(raw)
    payload = {**parsed, "model": MODEL_FULL, "generated_at": datetime.now(timezone.utc).isoformat()}
    await cache.set(key, payload, ttl_seconds=24 * 3600)
    return ClaudeFullResearch(**payload)
```

- [ ] **Step 4: Verify passes** — `pytest tests/test_earnings_screener.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/services/earnings_screener.py backend/tests/test_earnings_screener.py
git commit -m "feat(earnings): run_full_research with 24h cache"
```

---

### Task 9: Routes + mount

**Files:**
- Create: `backend/api/routes/earnings.py`
- Modify: `backend/api/routes/__init__.py`
- Test: `backend/tests/test_earnings_routes.py`

- [ ] **Step 1: Write failing route contract tests**

Create `backend/tests/test_earnings_routes.py`:

```python
"""Route contract tests — these check request → response shape and wiring.
The aggregator is mocked; pure HTTP plumbing is what we're verifying here."""
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app import app  # FastAPI app factory/instance

client = TestClient(app)


def test_calendar_route_returns_empty_list_gracefully():
    from api.schemas.earnings import CalendarResponse
    empty = CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)
    with patch("services.earnings_screener.list_upcoming", AsyncMock(return_value=empty)):
        r = client.get("/api/v1/earnings/calendar?window=both&min_iv_rank=50")
    assert r.status_code == 200
    assert r.json()["earnings"] == []


def test_detail_route_404s_on_unknown_symbol():
    from services.earnings_screener import list_upcoming
    with patch("services.earnings_screener.get_detail", AsyncMock(side_effect=ValueError("unknown"))):
        r = client.get("/api/v1/earnings/XYZZY/detail")
    assert r.status_code == 404


def test_full_research_route_requires_valid_symbol():
    with patch("services.earnings_screener.run_full_research", AsyncMock(side_effect=ValueError("unknown"))):
        r = client.post("/api/v1/earnings/XYZZY/full-research")
    assert r.status_code == 404


def test_calendar_route_passes_filters_through():
    from api.schemas.earnings import CalendarResponse
    called = {}
    async def fake_list(**kwargs):
        called.update(kwargs)
        return CalendarResponse(earnings=[], generated_at=datetime.now(timezone.utc), partial=False)
    with patch("services.earnings_screener.list_upcoming", fake_list):
        r = client.get("/api/v1/earnings/calendar?window=current&min_iv_rank=70&sort=iv_rank")
    assert r.status_code == 200
    assert called["window"] == "current"
    assert called["min_iv_rank"] == 70.0
    assert called["sort"] == "iv_rank"
```

- [ ] **Step 2: Verify fails** — `pytest tests/test_earnings_routes.py -v`
Expected: routes don't exist → 404 on all.

- [ ] **Step 3: Implement router**

Create `backend/api/routes/earnings.py`:

```python
"""/api/v1/earnings/* routes — thin wrappers over services.earnings_screener."""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from api.schemas.earnings import CalendarResponse, EarningsDetail, ClaudeFullResearch
from services import earnings_screener

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.get("/calendar", response_model=CalendarResponse)
async def get_calendar(
    window: str = Query("both", pattern="^(current|next|both)$"),
    min_iv_rank: float = Query(0, ge=0, le=100),
    market_cap: str = Query("all", pattern="^(mega|large|mid|small|all)$"),
    bmo_amc: str = Query("both", pattern="^(bmo|amc|both)$"),
    watchlist_only: bool = False,
    sort: str = Query("date", pattern="^(date|iv_rank|yield|claude_confidence)$"),
) -> CalendarResponse:
    return await earnings_screener.list_upcoming(
        window=window, min_iv_rank=min_iv_rank, market_cap=market_cap,
        bmo_amc=bmo_amc, watchlist_only=watchlist_only, sort=sort,
    )


@router.get("/{symbol}/detail", response_model=EarningsDetail)
async def get_detail(symbol: str) -> EarningsDetail:
    try:
        return await earnings_screener.get_detail(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/{symbol}/full-research", response_model=ClaudeFullResearch)
async def post_full_research(symbol: str) -> ClaudeFullResearch:
    # Rate limit via existing middleware decorator on this route path if
    # a reusable decorator exists in auth.py — search for rate_limit_per_user
    # and apply it here. Falls through to the Claude client's own limiter
    # otherwise.
    try:
        return await earnings_screener.run_full_research(symbol.upper())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
```

Mount in `backend/api/routes/__init__.py` — find where other routers are included (`app.include_router(market_router, prefix="/api/v1")` etc.) and add:

```python
from api.routes import earnings
app.include_router(earnings.router, prefix="/api/v1")
```

- [ ] **Step 4: Verify passes** — `pytest tests/test_earnings_routes.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/api/routes/earnings.py backend/api/routes/__init__.py \
        backend/tests/test_earnings_routes.py
git commit -m "feat(earnings): 3 routes (calendar/detail/full-research) mounted"
```

---

## Phase C — Frontend API client + mocks (Task 10)

### Task 10: Add 3 client functions + mocks

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/__tests__/setup-mocks.ts`

- [ ] **Step 1: Add TypeScript types matching backend schemas**

In `frontend/src/types/index.ts`, append:

```typescript
// ─── Earnings Options Play ───────────────────────────────────

export type EarningsReportTime = "BMO" | "AMC" | "DMT";
export type EarningsVerdict = "bullish" | "neutral-bull" | "neutral" | "neutral-bear" | "bearish";
export type EarningsTopSetup = "short call" | "cash-secured put" | "short strangle" | "iron condor";
export type EarningsOptionSide = "call" | "put";
export type EarningsBucket = "15Δ" | "30Δ" | "ATM";

export interface CalendarRow {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  days_until: number;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  iv_rank: number | null;
  premium_yield_call_atm: number | null;
  premium_yield_put_atm: number | null;
  expected_move_pct: number | null;
  hist_avg_abs_move_pct: number | null;
  claude_verdict: EarningsVerdict | null;
  claude_confidence: number | null;
  top_setup: EarningsTopSetup | null;
}

export interface CalendarResponse {
  earnings: CalendarRow[];
  generated_at: string;
  partial: boolean;
  error?: string | null;
}

export interface LadderRow {
  strike: number;
  side: EarningsOptionSide;
  bucket: EarningsBucket;
  delta: number;
  bid: number;
  ask: number;
  mid: number;
  iv: number;
  yield_pct: number;
  pop: number;
  theta: number;
  gamma: number;
  vega: number;
  oi: number;
  volume: number;
}

export interface StrikeLadder {
  expiry: string;
  underlying_price: number;
  rows: LadderRow[];
}

export interface ClaudeStructured {
  verdict: EarningsVerdict;
  direction_magnitude: { bull_case_pct: number; bear_case_pct: number };
  thesis: string;
  catalysts: string[];
  risks: string[];
  suggested_play: EarningsTopSetup;
  suggested_play_reason: string;
  confidence: number;
  model: string;
  generated_at: string;
}

export interface ComparableSetup {
  report_date: string;
  iv_rank: number;
  setup: string;
  outcome: string;
  similarity_score: number;
}

export interface ClaudeFullResearch {
  thesis_paragraph: string;
  comparable_setups: ComparableSetup[];
  post_earnings_drift_playbook: string;
  sector_backdrop: string;
  analyst_consensus_delta: string;
  what_would_change_my_mind: string;
  confidence: number;
  model: string;
  generated_at: string;
}

export interface HistQuarter {
  report_date: string;
  surprise_pct: number | null;
  next_day_move_pct: number;
  five_day_move_pct: number;
}

export interface HistoricalStats {
  avg_abs_move_pct: number;
  wins: number;
  losses: number;
  surprise_beat_rate: number;
  iv_vs_hist_vol_points: number | null;
}

export interface HistoricalBlock {
  quarters: HistQuarter[];
  stats: HistoricalStats;
}

export interface IVTermPoint {
  expiry: string;
  dte: number;
  atm_iv: number;
}

export interface SkewBlock {
  put_iv_25d: number | null;
  call_iv_25d: number | null;
  skew_points: number | null;
  interpretation: "put-heavy skew" | "call-heavy skew" | "neutral" | null;
}

export interface EarningsMetricsBlock {
  iv_rank: number | null;
  iv_percentile: number | null;
  current_iv: number | null;
  hv_20: number | null;
  hv_50: number | null;
  hv_100: number | null;
  hv_iv_ratio: number | null;
  expected_move_pct: number | null;
  expected_move_dollars: number | null;
  hist_avg_abs_move_pct: number | null;
  beat_rate: number | null;
  days_to_earnings: number | null;
  days_to_expiry: number | null;
}

export interface EarningsNewsArticle {
  title: string;
  source: string;
  published_at: string;
  url: string;
}

export interface EarningsDetail {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  quote: { last: number; change: number; change_pct: number } | null;
  metrics: EarningsMetricsBlock | null;
  strike_ladder: StrikeLadder | null;
  claude_structured: ClaudeStructured | null;
  claude_full_research: ClaudeFullResearch | null;
  historical_earnings: HistoricalBlock | null;
  iv_term_structure: IVTermPoint[] | null;
  skew: SkewBlock | null;
  news: EarningsNewsArticle[];
  partial: boolean;
  generated_at: string;
}

export interface EarningsCalendarFilters {
  window?: "current" | "next" | "both";
  min_iv_rank?: number;
  market_cap?: "mega" | "large" | "mid" | "small" | "all";
  bmo_amc?: "bmo" | "amc" | "both";
  watchlist_only?: boolean;
  sort?: "date" | "iv_rank" | "yield" | "claude_confidence";
}
```

- [ ] **Step 2: Add API client functions**

In `frontend/src/lib/api.ts`, append near the bottom (before closing statements):

```typescript
import type {
  CalendarResponse,
  EarningsDetail,
  EarningsCalendarFilters,
  ClaudeFullResearch,
} from "@/types";

/**
 * Fetch the earnings-options-play calendar for the screener.
 * Backend: GET /api/v1/earnings/calendar
 */
export async function getEarningsCalendar(
  filters: EarningsCalendarFilters = {},
): Promise<CalendarResponse> {
  const params = new URLSearchParams();
  if (filters.window) params.set("window", filters.window);
  if (filters.min_iv_rank !== undefined) params.set("min_iv_rank", String(filters.min_iv_rank));
  if (filters.market_cap) params.set("market_cap", filters.market_cap);
  if (filters.bmo_amc) params.set("bmo_amc", filters.bmo_amc);
  if (filters.watchlist_only) params.set("watchlist_only", "true");
  if (filters.sort) params.set("sort", filters.sort);
  const query = params.toString();
  return apiFetch<CalendarResponse>(`/api/v1/earnings/calendar${query ? `?${query}` : ""}`);
}

/**
 * Fetch the detail panel payload for one symbol's earnings.
 * Backend: GET /api/v1/earnings/{symbol}/detail
 */
export async function getEarningsDetail(symbol: string): Promise<EarningsDetail> {
  return apiFetch<EarningsDetail>(`/api/v1/earnings/${encodeURIComponent(symbol)}/detail`);
}

/**
 * Trigger the on-demand Claude Opus full research note.
 * Backend: POST /api/v1/earnings/{symbol}/full-research
 * Rate-limited per user (~30/5min via backend middleware).
 */
export async function postEarningsFullResearch(symbol: string): Promise<ClaudeFullResearch> {
  return apiFetch<ClaudeFullResearch>(
    `/api/v1/earnings/${encodeURIComponent(symbol)}/full-research`,
    { method: "POST", timeoutMs: 60_000 },
  );
}
```

- [ ] **Step 3: Add mocks to `setup-mocks.ts`**

In `frontend/src/__tests__/setup-mocks.ts`, inside the existing `vi.mock('@/lib/api', ...)` block's returned object, append:

```typescript
    getEarningsCalendar: vi.fn().mockResolvedValue({
      earnings: [],
      generated_at: new Date().toISOString(),
      partial: false,
    }),
    getEarningsDetail: vi.fn().mockResolvedValue({
      symbol: "NVDA", company: "Nvidia", sector: "Semis",
      report_date: "2026-04-23", report_time: "AMC",
      quote: null, metrics: null, strike_ladder: null,
      claude_structured: null, claude_full_research: null,
      historical_earnings: null, iv_term_structure: null, skew: null,
      news: [], partial: false,
      generated_at: new Date().toISOString(),
    }),
    postEarningsFullResearch: vi.fn().mockResolvedValue({
      thesis_paragraph: "mock research",
      comparable_setups: [],
      post_earnings_drift_playbook: "",
      sector_backdrop: "",
      analyst_consensus_delta: "",
      what_would_change_my_mind: "",
      confidence: 0.5,
      model: "claude-opus-4-7",
      generated_at: new Date().toISOString(),
    }),
```

- [ ] **Step 4: Verify build + types pass**

```bash
cd /Users/GK/Downloads/alphadesk/frontend && pnpm run type-check
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/lib/api.ts \
        frontend/src/__tests__/setup-mocks.ts
git commit -m "feat(earnings): frontend types + API client + test mocks"
```

---

## Phase D — Page shell, filters, sidebar (Tasks 11-13)

### Task 11: `page.tsx` shell + URL-synced state

**Files:**
- Create: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`
- Test: `frontend/src/__tests__/earnings/page.test.tsx`

- [ ] **Step 1: Write failing integration test**

Create `frontend/src/__tests__/earnings/page.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import EarningsOptionsPlayPage from "@/app/(dashboard)/strategies/earnings-options-play/page";
import * as api from "@/lib/api";

describe("Earnings Options Play page", () => {
  it("fetches calendar on mount and auto-selects first symbol", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis",
          report_date: "2026-04-23", report_time: "AMC", days_until: 1,
          price: 201.7, change: -1.4, change_pct: -0.007, iv_rank: 78,
          premium_yield_call_atm: 0.031, premium_yield_put_atm: 0.028,
          expected_move_pct: 0.064, hist_avg_abs_move_pct: 0.052,
          claude_verdict: "neutral-bull", claude_confidence: 0.62,
          top_setup: "short strangle" },
        { symbol: "TSLA", company: "Tesla", sector: "Auto",
          report_date: "2026-04-23", report_time: "AMC", days_until: 1,
          price: 392, change: -8.2, change_pct: -0.02, iv_rank: 84,
          premium_yield_call_atm: 0.042, premium_yield_put_atm: 0.039,
          expected_move_pct: 0.081, hist_avg_abs_move_pct: 0.078,
          claude_verdict: "neutral", claude_confidence: 0.55, top_setup: "iron condor" },
      ],
      generated_at: new Date().toISOString(), partial: false,
    });

    const { container } = render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(api.getEarningsCalendar).toHaveBeenCalled();
      expect(api.getEarningsDetail).toHaveBeenCalledWith("NVDA");
      expect(container.textContent).toContain("NVDA");
      expect(container.textContent).toContain("TSLA");
    });
  });

  it("reads ?symbol= from URL on mount to restore selection", async () => {
    // Mock window.location to simulate ?symbol=TSLA
    const original = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...original, search: "?symbol=TSLA", pathname: "/strategies/earnings-options-play" },
    });
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [
        { symbol: "NVDA", company: "Nvidia", sector: "Semis", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: null, change: null, change_pct: null, iv_rank: null, premium_yield_call_atm: null, premium_yield_put_atm: null, expected_move_pct: null, hist_avg_abs_move_pct: null, claude_verdict: null, claude_confidence: null, top_setup: null },
        { symbol: "TSLA", company: "Tesla", sector: "Auto", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: null, change: null, change_pct: null, iv_rank: null, premium_yield_call_atm: null, premium_yield_put_atm: null, expected_move_pct: null, hist_avg_abs_move_pct: null, claude_verdict: null, claude_confidence: null, top_setup: null },
      ],
      generated_at: new Date().toISOString(), partial: false,
    });
    render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(api.getEarningsDetail).toHaveBeenCalledWith("TSLA");
    });
    Object.defineProperty(window, "location", { writable: true, value: original });
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- earnings/page.test`

- [ ] **Step 3: Implement the page shell**

Create `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DashboardPageLayout from "@/components/layouts/DashboardPageLayout";
import Display from "@/components/typography/Display";
import {
  getEarningsCalendar,
  getEarningsDetail,
  postEarningsFullResearch,
} from "@/lib/api";
import type {
  CalendarResponse,
  CalendarRow,
  EarningsDetail,
  EarningsCalendarFilters,
  ClaudeFullResearch,
} from "@/types";

import EarningsCalendarSidebar from "./_earnings/EarningsCalendarSidebar";
import FiltersBar from "./_earnings/FiltersBar";
import EarningsDetailPanel from "./_earnings/EarningsDetailPanel";

/**
 * /strategies/earnings-options-play — research screener.
 *
 * Layout C (Bloomberg): left calendar sidebar + right persistent detail panel.
 * URL state: ?symbol=NVDA&window=both&min_iv_rank=50&sort=date — refresh
 * preserves selection and filters.
 */
export default function EarningsOptionsPlayPage() {
  const [calendar, setCalendar] = useState<CalendarResponse | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadingCalendar, setLoadingCalendar] = useState(true);

  const [detail, setDetail] = useState<EarningsDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [filters, setFilters] = useState<EarningsCalendarFilters>(() =>
    readFiltersFromURL(),
  );
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("symbol");
  });

  const [runningFull, setRunningFull] = useState(false);

  // ── Fetch calendar whenever filters change ───────────────
  useEffect(() => {
    let cancelled = false;
    setLoadingCalendar(true);
    setCalendarError(null);
    getEarningsCalendar(filters)
      .then((resp) => {
        if (cancelled) return;
        setCalendar(resp);
        // Auto-select first symbol if none selected, or selected no longer in list
        if (resp.earnings.length > 0) {
          const stillValid = selectedSymbol && resp.earnings.some((r) => r.symbol === selectedSymbol);
          if (!stillValid) {
            setSelectedSymbol(resp.earnings[0].symbol);
          }
        } else {
          setSelectedSymbol(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setCalendarError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingCalendar(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  // ── Fetch detail when selectedSymbol changes ─────────────
  useEffect(() => {
    if (!selectedSymbol) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    getEarningsDetail(selectedSymbol)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setDetailError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

  // ── Sync state to URL ────────────────────────────────────
  useEffect(() => {
    syncURL({ symbol: selectedSymbol, ...filters });
  }, [selectedSymbol, filters]);

  // ── Full research mutation ───────────────────────────────
  const runFull = useCallback(async () => {
    if (!selectedSymbol) return;
    setRunningFull(true);
    try {
      const full = await postEarningsFullResearch(selectedSymbol);
      setDetail((prev) =>
        prev ? { ...prev, claude_full_research: full } : prev,
      );
    } finally {
      setRunningFull(false);
    }
  }, [selectedSymbol]);

  return (
    <DashboardPageLayout>
      <header className="mb-6">
        <p className="t-label">§ EARNINGS · OPTIONS PLAY</p>
        <Display as="h1" size="xl">
          This week · next week
        </Display>
        <p className="mt-1 font-mono text-[color:var(--fg-muted)]">
          {calendar
            ? `${calendar.earnings.length} earnings · sorted by ${filters.sort ?? "date"}`
            : "Loading…"}
        </p>
      </header>

      <FiltersBar filters={filters} onChange={setFilters} />

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <EarningsCalendarSidebar
          rows={calendar?.earnings ?? []}
          loading={loadingCalendar}
          error={calendarError}
          selected={selectedSymbol}
          onSelect={setSelectedSymbol}
        />
        <EarningsDetailPanel
          detail={detail}
          loading={loadingDetail}
          error={detailError}
          runningFull={runningFull}
          onRunFullResearch={runFull}
        />
      </div>
    </DashboardPageLayout>
  );
}

// ─── URL sync helpers ────────────────────────────────────────

function readFiltersFromURL(): EarningsCalendarFilters {
  if (typeof window === "undefined") return { window: "both", min_iv_rank: 50, sort: "date" };
  const p = new URLSearchParams(window.location.search);
  const out: EarningsCalendarFilters = {};
  const win = p.get("window");
  if (win === "current" || win === "next" || win === "both") out.window = win;
  const minIvRank = p.get("min_iv_rank");
  if (minIvRank !== null) out.min_iv_rank = Number(minIvRank);
  const mc = p.get("market_cap");
  if (mc && ["mega", "large", "mid", "small", "all"].includes(mc)) out.market_cap = mc as any;
  const ba = p.get("bmo_amc");
  if (ba && ["bmo", "amc", "both"].includes(ba)) out.bmo_amc = ba as any;
  if (p.get("watchlist_only") === "true") out.watchlist_only = true;
  const sort = p.get("sort");
  if (sort && ["date", "iv_rank", "yield", "claude_confidence"].includes(sort)) out.sort = sort as any;
  return { window: "both", min_iv_rank: 50, sort: "date", ...out };
}

function syncURL(state: { symbol: string | null } & EarningsCalendarFilters) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (state.symbol) p.set("symbol", state.symbol);
  if (state.window) p.set("window", state.window);
  if (state.min_iv_rank !== undefined) p.set("min_iv_rank", String(state.min_iv_rank));
  if (state.market_cap && state.market_cap !== "all") p.set("market_cap", state.market_cap);
  if (state.bmo_amc && state.bmo_amc !== "both") p.set("bmo_amc", state.bmo_amc);
  if (state.watchlist_only) p.set("watchlist_only", "true");
  if (state.sort && state.sort !== "date") p.set("sort", state.sort);
  const newUrl = `${window.location.pathname}?${p.toString()}`;
  window.history.replaceState({}, "", newUrl);
}
```

For the sub-components to compile, stub them now (fleshed out in subsequent tasks):

Create stubs at `_earnings/FiltersBar.tsx`, `_earnings/EarningsCalendarSidebar.tsx`, `_earnings/EarningsDetailPanel.tsx`:

```typescript
// _earnings/FiltersBar.tsx — stub; real impl in Task 12
import type { EarningsCalendarFilters } from "@/types";
export default function FiltersBar(_props: { filters: EarningsCalendarFilters; onChange: (f: EarningsCalendarFilters) => void }) {
  return <div data-slot="filters-bar" className="t-label">Filters</div>;
}
```

```typescript
// _earnings/EarningsCalendarSidebar.tsx — stub; real impl in Task 13
import type { CalendarRow } from "@/types";
export default function EarningsCalendarSidebar(props: {
  rows: CalendarRow[]; loading: boolean; error: string | null;
  selected: string | null; onSelect: (symbol: string) => void;
}) {
  return (
    <aside data-slot="earnings-calendar-sidebar">
      {props.rows.map(r => (
        <button key={r.symbol} onClick={() => props.onSelect(r.symbol)}>{r.symbol}</button>
      ))}
    </aside>
  );
}
```

```typescript
// _earnings/EarningsDetailPanel.tsx — stub; real impl in Task 21
import type { EarningsDetail } from "@/types";
export default function EarningsDetailPanel(props: {
  detail: EarningsDetail | null; loading: boolean; error: string | null;
  runningFull: boolean; onRunFullResearch: () => void;
}) {
  return (
    <section data-slot="earnings-detail-panel">
      {props.detail ? props.detail.symbol : props.loading ? "Loading" : "Select a symbol"}
    </section>
  );
}
```

- [ ] **Step 4: Verify passes** — `pnpm test -- earnings/page`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/ \
        frontend/src/__tests__/earnings/
git commit -m "feat(earnings): page shell with URL-synced state + stub components"
```

---

### Task 12: FiltersBar

**Files:**
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar.tsx`
- Test: `frontend/src/__tests__/earnings/FiltersBar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/earnings/FiltersBar.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar";

describe("FiltersBar", () => {
  it("renders window / IV-rank / market-cap / BMO-AMC / sort controls", () => {
    const { container } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={() => {}} />,
    );
    const slot = container.querySelector('[data-slot="filters-bar"]');
    expect(slot).not.toBeNull();
    expect(container.textContent).toMatch(/this week|next week|both/i);
    expect(container.textContent).toMatch(/IV rank/i);
    expect(container.textContent).toMatch(/sort/i);
  });

  it("calls onChange with new filters when window toggle is clicked", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={onChange} />,
    );
    fireEvent.click(getByRole("button", { name: /current week/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ window: "current" }));
  });

  it("updates min_iv_rank on slider change", () => {
    const onChange = vi.fn();
    const { container } = render(
      <FiltersBar filters={{ window: "both", min_iv_rank: 50, sort: "date" }} onChange={onChange} />,
    );
    const slider = container.querySelector('input[type="range"][name="min_iv_rank"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    fireEvent.change(slider, { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ min_iv_rank: 70 }));
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- FiltersBar`

- [ ] **Step 3: Implement**

Replace the stub at `_earnings/FiltersBar.tsx`:

```typescript
"use client";

import type { EarningsCalendarFilters } from "@/types";
import { cn } from "@/lib/utils";

export interface FiltersBarProps {
  filters: EarningsCalendarFilters;
  onChange: (next: EarningsCalendarFilters) => void;
}

type WindowOption = { key: "current" | "next" | "both"; label: string };
const WINDOW_OPTIONS: WindowOption[] = [
  { key: "current", label: "Current week" },
  { key: "next", label: "Next week" },
  { key: "both", label: "Both" },
];

type SortOption = { key: "date" | "iv_rank" | "yield" | "claude_confidence"; label: string };
const SORT_OPTIONS: SortOption[] = [
  { key: "date", label: "Earnings date" },
  { key: "iv_rank", label: "IV rank" },
  { key: "yield", label: "Premium yield" },
  { key: "claude_confidence", label: "Claude confidence" },
];

export default function FiltersBar({ filters, onChange }: FiltersBarProps) {
  const ivRank = filters.min_iv_rank ?? 50;

  return (
    <div
      data-slot="filters-bar"
      className="flex flex-wrap items-center gap-4 rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      {/* Window toggles */}
      <div className="flex items-center gap-1">
        <span className="t-label mr-2 text-[color:var(--fg-muted)]">WINDOW</span>
        {WINDOW_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange({ ...filters, window: opt.key })}
            className={cn(
              "rounded border px-2 py-1 font-mono text-[12px]",
              (filters.window ?? "both") === opt.key
                ? "border-[color:var(--fg-accent)] text-[color:var(--fg-accent)]"
                : "border-[color:var(--fg-border)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* IV rank slider */}
      <label className="flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">IV RANK ≥</span>
        <input
          type="range"
          name="min_iv_rank"
          min={0}
          max={100}
          step={5}
          value={ivRank}
          onChange={(e) => onChange({ ...filters, min_iv_rank: Number(e.target.value) })}
          className="w-32"
        />
        <span className="font-mono text-[13px] tabular-nums">{ivRank}</span>
      </label>

      {/* BMO/AMC */}
      <label className="flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">TIME</span>
        <select
          value={filters.bmo_amc ?? "both"}
          onChange={(e) => onChange({ ...filters, bmo_amc: e.target.value as any })}
          className="rounded border border-[color:var(--fg-border)] bg-transparent px-1 py-0.5 font-mono text-[12px]"
        >
          <option value="both">Both</option>
          <option value="bmo">BMO</option>
          <option value="amc">AMC</option>
        </select>
      </label>

      {/* Watchlist only */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.watchlist_only ?? false}
          onChange={(e) => onChange({ ...filters, watchlist_only: e.target.checked })}
        />
        <span className="t-label text-[color:var(--fg-muted)]">WATCHLIST ONLY</span>
      </label>

      {/* Sort */}
      <label className="ml-auto flex items-center gap-2">
        <span className="t-label text-[color:var(--fg-muted)]">SORT</span>
        <select
          value={filters.sort ?? "date"}
          onChange={(e) => onChange({ ...filters, sort: e.target.value as any })}
          className="rounded border border-[color:var(--fg-border)] bg-transparent px-1 py-0.5 font-mono text-[12px]"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
```

- [ ] **Step 4: Verify passes** — `pnpm test -- FiltersBar`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/FiltersBar.tsx \
        frontend/src/__tests__/earnings/FiltersBar.test.tsx
git commit -m "feat(earnings): FiltersBar with window/IVR/time/watchlist/sort"
```

---

### Task 13: EarningsCalendarSidebar

**Files:**
- Modify: `_earnings/EarningsCalendarSidebar.tsx`
- Test: `frontend/src/__tests__/earnings/EarningsCalendarSidebar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/earnings/EarningsCalendarSidebar.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EarningsCalendarSidebar from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar";
import type { CalendarRow } from "@/types";

const rows: CalendarRow[] = [
  { symbol: "NVDA", company: "Nvidia", sector: "Semis", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: 201.7, change: -1.4, change_pct: -0.007, iv_rank: 78, premium_yield_call_atm: 0.031, premium_yield_put_atm: 0.028, expected_move_pct: 0.064, hist_avg_abs_move_pct: 0.052, claude_verdict: "neutral-bull", claude_confidence: 0.62, top_setup: "short strangle" },
  { symbol: "TSLA", company: "Tesla", sector: "Auto", report_date: "2026-04-23", report_time: "AMC", days_until: 1, price: 392, change: -8.2, change_pct: -0.02, iv_rank: 84, premium_yield_call_atm: 0.042, premium_yield_put_atm: 0.039, expected_move_pct: 0.081, hist_avg_abs_move_pct: 0.078, claude_verdict: "neutral", claude_confidence: 0.55, top_setup: "iron condor" },
  { symbol: "META", company: "Meta", sector: "Tech", report_date: "2026-04-24", report_time: "AMC", days_until: 2, price: 672, change: -16, change_pct: -0.023, iv_rank: 71, premium_yield_call_atm: 0.026, premium_yield_put_atm: 0.024, expected_move_pct: 0.058, hist_avg_abs_move_pct: 0.049, claude_verdict: "bullish", claude_confidence: 0.71, top_setup: "cash-secured put" },
];

describe("EarningsCalendarSidebar", () => {
  it("groups rows by report_date with day headers", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="NVDA" onSelect={() => {}} />,
    );
    const groups = container.querySelectorAll('[data-slot="day-group"]');
    expect(groups.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toMatch(/04-23|Apr 23/i);
    expect(container.textContent).toMatch(/04-24|Apr 24/i);
  });

  it("calls onSelect when a symbol row is clicked", () => {
    const onSelect = vi.fn();
    const { getByText } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected={null} onSelect={onSelect} />,
    );
    fireEvent.click(getByText("TSLA"));
    expect(onSelect).toHaveBeenCalledWith("TSLA");
  });

  it("marks the selected symbol as active", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="META" onSelect={() => {}} />,
    );
    const active = container.querySelector('[data-selected="true"]');
    expect(active?.textContent).toContain("META");
  });

  it("shows IV rank chip on each row", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={rows} loading={false} error={null} selected="NVDA" onSelect={() => {}} />,
    );
    expect(container.textContent).toContain("78");
    expect(container.textContent).toContain("84");
  });

  it("shows empty state when no rows and not loading", () => {
    const { container } = render(
      <EarningsCalendarSidebar rows={[]} loading={false} error={null} selected={null} onSelect={() => {}} />,
    );
    expect(container.textContent).toMatch(/no earnings|empty/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- EarningsCalendarSidebar`

- [ ] **Step 3: Implement**

Replace `_earnings/EarningsCalendarSidebar.tsx`:

```typescript
"use client";

import { useMemo } from "react";
import type { CalendarRow } from "@/types";
import { cn } from "@/lib/utils";

export interface EarningsCalendarSidebarProps {
  rows: CalendarRow[];
  loading: boolean;
  error: string | null;
  selected: string | null;
  onSelect: (symbol: string) => void;
}

export default function EarningsCalendarSidebar({
  rows, loading, error, selected, onSelect,
}: EarningsCalendarSidebarProps) {
  const grouped = useMemo(() => groupByDate(rows), [rows]);

  if (error) {
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="t-label text-[color:var(--fg-neg)]">Error · {error}</p>
      </aside>
    );
  }

  if (loading && rows.length === 0) {
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading earnings…</p>
      </aside>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <aside data-slot="earnings-calendar-sidebar" className="rounded border border-[color:var(--fg-border)] p-3">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">No earnings match — loosen filters.</p>
      </aside>
    );
  }

  return (
    <aside
      data-slot="earnings-calendar-sidebar"
      className="self-start rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-3"
    >
      <p className="t-label mb-2 text-[color:var(--fg-muted)]">§ CALENDAR</p>
      {grouped.map(({ date, label, rows }) => (
        <div key={date} data-slot="day-group" className="mb-3">
          <h3 className="t-display-section italic text-[13px] pb-1 border-b border-[color:var(--fg-border)]">
            {label} <span className="t-label text-[color:var(--fg-muted)]">· {rows.length} reporting</span>
          </h3>
          <ul className="mt-1 space-y-0.5">
            {rows.map((r) => (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onSelect(r.symbol)}
                  data-selected={r.symbol === selected}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1 font-mono text-[12.5px] text-left transition-colors",
                    r.symbol === selected
                      ? "bg-[color:var(--bg-accent-subtle)] border-l-2 border-[color:var(--fg-accent)] text-[color:var(--fg-base)]"
                      : "hover:bg-[color:var(--bg-elevated)] text-[color:var(--fg-muted)] hover:text-[color:var(--fg-base)]",
                  )}
                >
                  <span>
                    <span className="font-semibold text-[color:var(--fg-base)]">{r.symbol}</span>
                    <span className="ml-1 text-[10px] text-[color:var(--fg-muted)]">{r.report_time}</span>
                  </span>
                  {r.iv_rank != null && (
                    <span className="text-[11px] tabular-nums text-[color:var(--fg-pos)]">
                      {Math.round(r.iv_rank)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}

function groupByDate(rows: CalendarRow[]): { date: string; label: string; rows: CalendarRow[] }[] {
  const map = new Map<string, CalendarRow[]>();
  for (const r of rows) {
    if (!map.has(r.report_date)) map.set(r.report_date, []);
    map.get(r.report_date)!.push(r);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({ date, label: formatDateLabel(date), rows }));
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const mmdd = iso.slice(5); // MM-DD
  return `${day} ${mmdd}`;
}
```

- [ ] **Step 4: Verify passes** — `pnpm test -- EarningsCalendarSidebar`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx \
        frontend/src/__tests__/earnings/EarningsCalendarSidebar.test.tsx
git commit -m "feat(earnings): calendar sidebar with day grouping + IV chips"
```

---

## Phase E — Detail-panel sub-components (Tasks 14-20)

### Task 14: DetailHeader + MetricsStrip (bundled — both small)

**Files:**
- Modify: `_earnings/DetailHeader.tsx`, `_earnings/MetricsStrip.tsx`
- Test: `frontend/src/__tests__/earnings/DetailHeader.test.tsx`, `frontend/src/__tests__/earnings/MetricsStrip.test.tsx`

- [ ] **Step 1: Write failing tests**

`DetailHeader.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import DetailHeader from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/DetailHeader";

describe("DetailHeader", () => {
  it("renders symbol, company, sector, report date/time, and price block", () => {
    const { container } = render(
      <DetailHeader
        symbol="NVDA" company="Nvidia" sector="Semiconductors"
        report_date="2026-04-23" report_time="AMC"
        quote={{ last: 201.7, change: -1.42, change_pct: -0.007 }}
      />,
    );
    expect(container.textContent).toContain("Nvidia");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent).toContain("Semiconductors");
    expect(container.textContent).toContain("201.70");
    expect(container.textContent).toMatch(/AMC/);
    expect(container.textContent).toMatch(/-1\.42|\-0\.70%|-0.7%/);
  });

  it("shows em-dash for missing quote", () => {
    const { container } = render(
      <DetailHeader symbol="NVDA" company="Nvidia" sector="Semis" report_date="2026-04-23" report_time="AMC" quote={null} />,
    );
    expect(container.textContent).toContain("—");
  });
});
```

`MetricsStrip.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MetricsStrip from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/MetricsStrip";

describe("MetricsStrip", () => {
  it("renders IV rank, IV %ile, HV/IV, expected move, hist |move|, beat rate, DTE", () => {
    const { container } = render(
      <MetricsStrip metrics={{
        iv_rank: 78, iv_percentile: 82, current_iv: 0.79,
        hv_20: 0.42, hv_50: null, hv_100: null, hv_iv_ratio: 0.71,
        expected_move_pct: 0.064, expected_move_dollars: 12.8,
        hist_avg_abs_move_pct: 0.052, beat_rate: 0.87,
        days_to_earnings: 1, days_to_expiry: 3,
      }} />,
    );
    expect(container.textContent).toContain("78");
    expect(container.textContent).toContain("82");
    expect(container.textContent).toContain("0.71");
    expect(container.textContent).toMatch(/±6\.4%|6\.40%/);
    expect(container.textContent).toMatch(/±5\.2%|5\.20%/);
    expect(container.textContent).toMatch(/87/);
    expect(container.textContent).toContain("3"); // DTE
  });

  it("renders em-dash for missing metrics", () => {
    const { container } = render(<MetricsStrip metrics={null} />);
    expect(container.textContent).toContain("—");
  });
});
```

- [ ] **Step 2: Verify both fail** — `pnpm test -- DetailHeader MetricsStrip`

- [ ] **Step 3: Implement DetailHeader**

Create `_earnings/DetailHeader.tsx`:

```typescript
import type { EarningsReportTime } from "@/types";

export interface DetailHeaderProps {
  symbol: string;
  company: string;
  sector: string;
  report_date: string;
  report_time: EarningsReportTime;
  quote: { last: number; change: number; change_pct: number } | null;
}

export default function DetailHeader({
  symbol, company, sector, report_date, report_time, quote,
}: DetailHeaderProps) {
  const change = quote?.change ?? null;
  const changePct = quote?.change_pct ?? null;
  const isNeg = (change ?? 0) < 0;

  return (
    <header
      data-slot="detail-header"
      className="flex items-baseline justify-between gap-6 border-b border-[color:var(--fg-border)] pb-3"
    >
      <div>
        <p className="t-label text-[color:var(--fg-muted)]">§ EARNINGS · OPTIONS PLAY</p>
        <h2 className="t-display-lg italic mt-1">
          {company} <span className="text-[color:var(--fg-muted)]">· {symbol}</span>
        </h2>
        <p className="t-meta mt-1">{sector} · Reports {formatReportDate(report_date)} · {report_time}</p>
      </div>
      <div className="text-right">
        <div className="t-num-hero">
          {quote ? quote.last.toFixed(2) : "—"}
        </div>
        <div className={"font-mono text-[13px] " + (isNeg ? "text-[color:var(--fg-neg)]" : "text-[color:var(--fg-pos)]")}>
          {change == null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)} · ${(changePct! * 100).toFixed(2)}%`}
        </div>
      </div>
    </header>
  );
}

function formatReportDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
```

- [ ] **Step 4: Implement MetricsStrip**

Create `_earnings/MetricsStrip.tsx`:

```typescript
import type { EarningsMetricsBlock } from "@/types";

export interface MetricsStripProps {
  metrics: EarningsMetricsBlock | null;
}

const DASH = "—";

export default function MetricsStrip({ metrics }: MetricsStripProps) {
  if (!metrics) {
    return (
      <div data-slot="metrics-strip" className="flex gap-6 border-b border-[color:var(--fg-border)] py-2">
        <span className="t-label text-[color:var(--fg-muted)]">{DASH} no metrics available</span>
      </div>
    );
  }
  return (
    <div
      data-slot="metrics-strip"
      className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-[color:var(--fg-border)] py-2"
    >
      <Cell label="IV RANK" value={fmtInt(metrics.iv_rank)} accent={metrics.iv_rank && metrics.iv_rank > 70} />
      <Cell label="IV %ILE" value={fmtInt(metrics.iv_percentile)} />
      <Cell label="HV 20" value={fmtPct(metrics.hv_20)} />
      <Cell label="HV / IV" value={fmtRatio(metrics.hv_iv_ratio)} />
      <Cell label="EXP MOVE" value={fmtPctSigned(metrics.expected_move_pct, true)} accent />
      <Cell label="HIST |MV|" value={fmtPctSigned(metrics.hist_avg_abs_move_pct, true)} />
      <Cell label="BEAT %" value={fmtInt(metrics.beat_rate != null ? metrics.beat_rate * 100 : null)} />
      <Cell label="DTE" value={metrics.days_to_expiry == null ? DASH : String(metrics.days_to_expiry)} />
    </div>
  );
}

function Cell({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="t-label text-[color:var(--fg-muted)]">{label}</span>
      <span className={"font-mono text-[14px] tabular-nums " + (accent ? "text-[color:var(--fg-accent)]" : "")}>
        {value}
      </span>
    </div>
  );
}

function fmtInt(n: number | null): string { return n == null ? DASH : String(Math.round(n)); }
function fmtPct(n: number | null): string { return n == null ? DASH : `${(n * 100).toFixed(1)}%`; }
function fmtPctSigned(n: number | null, leadPlusMinus: boolean): string {
  if (n == null) return DASH;
  const abs = (n * 100).toFixed(1);
  return leadPlusMinus ? `±${abs}%` : `${abs}%`;
}
function fmtRatio(n: number | null): string { return n == null ? DASH : n.toFixed(2); }
```

- [ ] **Step 5: Verify passes** — `pnpm test -- DetailHeader MetricsStrip`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/DetailHeader.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/MetricsStrip.tsx \
        frontend/src/__tests__/earnings/DetailHeader.test.tsx \
        frontend/src/__tests__/earnings/MetricsStrip.test.tsx
git commit -m "feat(earnings): DetailHeader + MetricsStrip"
```

---

### Task 15: StrikeLadder + `.t-ladder-row` design token

**Files:**
- Modify: `frontend/src/styles/design-tokens.css`
- Create: `_earnings/StrikeLadder.tsx`
- Test: `frontend/src/__tests__/earnings/StrikeLadder.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/__tests__/earnings/StrikeLadder.test.tsx`:

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import StrikeLadder from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/StrikeLadder";
import type { StrikeLadder as LadderShape } from "@/types";

const ladder: LadderShape = {
  expiry: "2026-04-25",
  underlying_price: 201.7,
  rows: [
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yield_pct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yield_pct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yield_pct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yield_pct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
  ],
};

describe("StrikeLadder", () => {
  it("renders header row with strike/delta/mid/IV/yield/POP columns", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toMatch(/STRIKE/);
    expect(container.textContent).toMatch(/Δ|DELTA/);
    expect(container.textContent).toMatch(/MID/);
    expect(container.textContent).toMatch(/IV/);
    expect(container.textContent).toMatch(/YIELD|YLD/);
    expect(container.textContent).toMatch(/POP/);
  });

  it("renders each row with strike + bucket label", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toContain("195");
    expect(container.textContent).toContain("200");
    expect(container.textContent).toContain("205");
    expect(container.textContent).toContain("210");
    expect(container.textContent).toMatch(/put 30|30Δ put/i);
    expect(container.textContent).toMatch(/call 30|30Δ call/i);
  });

  it("shows expiry + underlying in the header", () => {
    const { container } = render(<StrikeLadder ladder={ladder} />);
    expect(container.textContent).toContain("2026-04-25");
    expect(container.textContent).toContain("201.70");
  });

  it("renders empty state when ladder is null", () => {
    const { container } = render(<StrikeLadder ladder={null} />);
    expect(container.textContent).toMatch(/no|unavailable|—/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- StrikeLadder`

- [ ] **Step 3: Add `.t-ladder-row` design token**

Append to `frontend/src/styles/design-tokens.css` (inside the main `@layer components` or the existing token layer):

```css
  /* Strike ladder — aligned mono columns for options tables.
     Column widths are fixed so call/put rows align even at different values. */
  .t-ladder-row {
    display: grid;
    grid-template-columns:
      minmax(52px, auto)   /* strike */
      minmax(40px, auto)   /* delta */
      minmax(50px, auto)   /* mid */
      minmax(44px, auto)   /* iv */
      minmax(46px, auto)   /* yield */
      minmax(40px, auto)   /* pop */
      1fr;                 /* side label */
    column-gap: 0.75rem;
    align-items: center;
    padding: 0.25rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .t-ladder-row--head {
    color: var(--fg-muted);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-bottom: 1px solid var(--fg-border);
  }
  .t-ladder-row--data {
    border-bottom: 1px solid color-mix(in oklab, var(--fg-border) 50%, transparent);
  }
```

- [ ] **Step 4: Implement StrikeLadder**

Create `_earnings/StrikeLadder.tsx`:

```typescript
import type { StrikeLadder as LadderShape, LadderRow } from "@/types";

export interface StrikeLadderProps {
  ladder: LadderShape | null;
}

export default function StrikeLadder({ ladder }: StrikeLadderProps) {
  if (!ladder || ladder.rows.length === 0) {
    return (
      <section data-slot="strike-ladder">
        <h3 className="t-display-section italic text-[13px] mt-4">Strike ladder</h3>
        <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">
          — options chain unavailable.
        </p>
      </section>
    );
  }
  return (
    <section data-slot="strike-ladder">
      <h3 className="t-display-section italic text-[13px] mt-4">
        Strike ladder <span className="t-label text-[color:var(--fg-muted)]">· expiry {ladder.expiry} · underlying {ladder.underlying_price.toFixed(2)}</span>
      </h3>
      <div className="mt-1">
        <div className="t-ladder-row t-ladder-row--head">
          <span>STRIKE</span>
          <span>Δ</span>
          <span>MID</span>
          <span>IV</span>
          <span>YLD</span>
          <span>POP</span>
          <span className="text-right">SIDE</span>
        </div>
        {ladder.rows.map((r) => (
          <LadderDataRow key={`${r.side}-${r.bucket}-${r.strike}`} row={r} />
        ))}
      </div>
    </section>
  );
}

function LadderDataRow({ row }: { row: LadderRow }) {
  const sideLabel = `${row.side} ${row.bucket}`;
  const yieldStr = `${(row.yield_pct * 100).toFixed(1)}%`;
  return (
    <div className="t-ladder-row t-ladder-row--data">
      <span className="text-[color:var(--fg-base)]">{row.strike.toFixed(0)}</span>
      <span>{row.delta >= 0 ? `+${row.delta.toFixed(2)}` : row.delta.toFixed(2)}</span>
      <span>{row.mid.toFixed(2)}</span>
      <span>{(row.iv * 100).toFixed(0)}%</span>
      <span className="text-[color:var(--fg-pos)]">{yieldStr}</span>
      <span>{(row.pop * 100).toFixed(0)}%</span>
      <span className="text-right text-[color:var(--fg-muted)]">{sideLabel}</span>
    </div>
  );
}
```

- [ ] **Step 5: Verify passes** — `pnpm test -- StrikeLadder`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles/design-tokens.css \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/StrikeLadder.tsx \
        frontend/src/__tests__/earnings/StrikeLadder.test.tsx
git commit -m "feat(earnings): StrikeLadder + .t-ladder-row token"
```

---

### Task 16: ClaudeThesisCard with "Run full research"

**Files:**
- Create: `_earnings/ClaudeThesisCard.tsx`
- Test: `frontend/src/__tests__/earnings/ClaudeThesisCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create test:

```typescript
import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import ClaudeThesisCard from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard";
import type { ClaudeStructured, ClaudeFullResearch } from "@/types";

const structured: ClaudeStructured = {
  verdict: "neutral-bull",
  direction_magnitude: { bull_case_pct: 0.04, bear_case_pct: -0.05 },
  thesis: "IV rank is elevated but historical moves average ±5.2% — IV is over-pricing.",
  catalysts: ["Blackwell ramp", "data-center guide"],
  risks: ["CN export pivot", "guide miss"],
  suggested_play: "short strangle",
  suggested_play_reason: "IVR > 75 favors premium selling",
  confidence: 0.62,
  model: "claude-opus-4-7",
  generated_at: new Date().toISOString(),
};

describe("ClaudeThesisCard", () => {
  it("renders verdict, confidence, thesis, catalysts, risks, suggested play", () => {
    const { container } = render(
      <ClaudeThesisCard structured={structured} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/NEUTRAL-BULL/i);
    expect(container.textContent).toMatch(/62/);
    expect(container.textContent).toContain("IV rank is elevated");
    expect(container.textContent).toContain("Blackwell ramp");
    expect(container.textContent).toContain("CN export pivot");
    expect(container.textContent).toMatch(/short strangle/i);
  });

  it("calls onRunFull when 'Run full research' clicked", () => {
    const onRunFull = vi.fn();
    const { getByRole } = render(
      <ClaudeThesisCard structured={structured} full={null} running={false} onRunFull={onRunFull} />,
    );
    fireEvent.click(getByRole("button", { name: /run full research/i }));
    expect(onRunFull).toHaveBeenCalled();
  });

  it("shows spinner/disabled state when running", () => {
    const { getByRole } = render(
      <ClaudeThesisCard structured={structured} full={null} running={true} onRunFull={() => {}} />,
    );
    const btn = getByRole("button", { name: /generating|running|loading/i });
    expect(btn).toHaveProperty("disabled", true);
  });

  it("renders full-research sections when available", () => {
    const full: ClaudeFullResearch = {
      thesis_paragraph: "Full paragraph content.",
      comparable_setups: [
        { report_date: "2025-02-21", iv_rank: 76, setup: "short strangle", outcome: "+$120", similarity_score: 0.89 },
      ],
      post_earnings_drift_playbook: "Drift expectations…",
      sector_backdrop: "Semis weak…",
      analyst_consensus_delta: "PT hikes…",
      what_would_change_my_mind: "A guide miss…",
      confidence: 0.68,
      model: "claude-opus-4-7",
      generated_at: new Date().toISOString(),
    };
    const { container } = render(
      <ClaudeThesisCard structured={structured} full={full} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toContain("Full paragraph content");
    expect(container.textContent).toContain("+$120");
    expect(container.textContent).toContain("Drift expectations");
  });

  it("renders null state when no structured analysis", () => {
    const { container } = render(
      <ClaudeThesisCard structured={null} full={null} running={false} onRunFull={() => {}} />,
    );
    expect(container.textContent).toMatch(/analysis pending|not yet|unavailable/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- ClaudeThesisCard`

- [ ] **Step 3: Implement**

Create `_earnings/ClaudeThesisCard.tsx`:

```typescript
"use client";

import type { ClaudeStructured, ClaudeFullResearch } from "@/types";

export interface ClaudeThesisCardProps {
  structured: ClaudeStructured | null;
  full: ClaudeFullResearch | null;
  running: boolean;
  onRunFull: () => void;
}

export default function ClaudeThesisCard({ structured, full, running, onRunFull }: ClaudeThesisCardProps) {
  if (!structured) {
    return (
      <section data-slot="claude-thesis" className="rounded border-l-2 border-[color:var(--fg-accent)] bg-[color:var(--bg-accent-subtle)] p-3">
        <p className="t-label text-[color:var(--fg-accent)]">◇ CLAUDE · STRUCTURED</p>
        <p className="mt-2 font-mono text-[13px] text-[color:var(--fg-muted)]">
          Analysis pending — come back in a moment, or retry.
        </p>
      </section>
    );
  }

  return (
    <section data-slot="claude-thesis" className="rounded border-l-2 border-[color:var(--fg-accent)] bg-[color:var(--bg-accent-subtle)] p-3">
      <div className="flex items-center justify-between">
        <p className="t-label text-[color:var(--fg-accent)]">◇ CLAUDE · STRUCTURED</p>
        <span className="font-mono text-[11px] text-[color:var(--fg-muted)]">
          {structured.model}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="font-mono text-[14px] font-semibold text-[color:var(--fg-accent)]">
          {structured.verdict.toUpperCase()}
        </span>
        <span className="font-mono text-[12px] text-[color:var(--fg-muted)]">
          conf {Math.round(structured.confidence * 100)}%
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-[color:var(--fg-muted)]">
        est. move: +{(structured.direction_magnitude.bull_case_pct * 100).toFixed(1)}%
        &nbsp;/&nbsp;
        {(structured.direction_magnitude.bear_case_pct * 100).toFixed(1)}%
      </p>
      <p className="mt-2 font-mono text-[13px] leading-relaxed text-[color:var(--fg-base)]">
        {structured.thesis}
      </p>
      {structured.catalysts.length > 0 && (
        <p className="mt-2 font-mono text-[11.5px] text-[color:var(--fg-muted)]">
          <span className="text-[color:var(--fg-pos)]">Catalysts:</span> {structured.catalysts.join(" · ")}
        </p>
      )}
      {structured.risks.length > 0 && (
        <p className="font-mono text-[11.5px] text-[color:var(--fg-muted)]">
          <span className="text-[color:var(--fg-neg)]">Risks:</span> {structured.risks.join(" · ")}
        </p>
      )}
      <p className="mt-1 font-mono text-[11.5px]">
        <span className="text-[color:var(--fg-muted)]">Play:</span> <span className="text-[color:var(--fg-accent)]">{structured.suggested_play}</span>
        <span className="text-[color:var(--fg-muted)]"> — {structured.suggested_play_reason}</span>
      </p>

      <div className="mt-3 border-t border-[color:var(--fg-border)] pt-3">
        {full ? (
          <FullResearchBlock full={full} />
        ) : (
          <button
            type="button"
            onClick={onRunFull}
            disabled={running}
            aria-label={running ? "Generating full research" : "Run full research"}
            className="rounded border border-[color:var(--fg-border)] bg-transparent px-3 py-1 font-mono text-[11px] text-[color:var(--fg-accent)] transition-colors hover:border-[color:var(--fg-accent)] disabled:opacity-50"
          >
            {running ? "▸ Generating full research…" : "▸ Run full research"}
          </button>
        )}
      </div>
    </section>
  );
}

function FullResearchBlock({ full }: { full: ClaudeFullResearch }) {
  return (
    <div data-slot="claude-full-research" className="space-y-3">
      <p className="t-label text-[color:var(--fg-accent)]">◈ FULL RESEARCH NOTE</p>
      <p className="font-mono text-[13px] leading-relaxed">{full.thesis_paragraph}</p>
      {full.comparable_setups.length > 0 && (
        <div>
          <p className="t-label text-[color:var(--fg-muted)]">COMPARABLE SETUPS</p>
          <ul className="mt-1 space-y-1 font-mono text-[11.5px]">
            {full.comparable_setups.map((c, i) => (
              <li key={i} className="text-[color:var(--fg-muted)]">
                <span className="text-[color:var(--fg-base)]">{c.report_date}</span> · IVR {c.iv_rank.toFixed(0)} · {c.setup} → <span className="text-[color:var(--fg-accent)]">{c.outcome}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <BlockField label="POST-EARNINGS DRIFT PLAYBOOK" text={full.post_earnings_drift_playbook} />
      <BlockField label="SECTOR BACKDROP" text={full.sector_backdrop} />
      <BlockField label="ANALYST CONSENSUS DELTA" text={full.analyst_consensus_delta} />
      <BlockField label="WHAT WOULD CHANGE MY MIND" text={full.what_would_change_my_mind} />
    </div>
  );
}

function BlockField({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div>
      <p className="t-label text-[color:var(--fg-muted)]">{label}</p>
      <p className="mt-0.5 font-mono text-[12px] leading-relaxed">{text}</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify passes** — `pnpm test -- ClaudeThesisCard`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx \
        frontend/src/__tests__/earnings/ClaudeThesisCard.test.tsx
git commit -m "feat(earnings): ClaudeThesisCard with structured + full-research block"
```

---

### Task 17: HistoricalMoves

**Files:**
- Create: `_earnings/HistoricalMoves.tsx`
- Test: `frontend/src/__tests__/earnings/HistoricalMoves.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HistoricalMoves from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/HistoricalMoves";

describe("HistoricalMoves", () => {
  const historical = {
    quarters: [
      { report_date: "2025-01-22", surprise_pct: 0.08, next_day_move_pct: 0.042, five_day_move_pct: 0.053 },
      { report_date: "2024-10-22", surprise_pct: -0.02, next_day_move_pct: -0.081, five_day_move_pct: -0.023 },
      { report_date: "2024-07-22", surprise_pct: 0.05, next_day_move_pct: 0.034, five_day_move_pct: 0.041 },
      { report_date: "2024-04-22", surprise_pct: 0.12, next_day_move_pct: 0.090, five_day_move_pct: 0.110 },
    ],
    stats: { avg_abs_move_pct: 0.062, wins: 3, losses: 1, surprise_beat_rate: 1.0, iv_vs_hist_vol_points: 1.2 },
  };

  it("renders one bar per quarter + stats block", () => {
    const { container } = render(<HistoricalMoves historical={historical} />);
    const bars = container.querySelectorAll('[data-slot="hist-bar"]');
    expect(bars.length).toBe(4);
    expect(container.textContent).toMatch(/±6\.2%|6\.20%/);
    expect(container.textContent).toMatch(/3W \/ 1L|3 wins/i);
  });

  it("shows empty state when no historical", () => {
    const { container } = render(<HistoricalMoves historical={null} />);
    expect(container.textContent).toMatch(/unavailable|no history|—/i);
  });

  it("color-codes wins (pos) vs losses (neg) bars", () => {
    const { container } = render(<HistoricalMoves historical={historical} />);
    const positive = container.querySelectorAll('[data-sign="pos"]');
    const negative = container.querySelectorAll('[data-sign="neg"]');
    expect(positive.length).toBe(3);
    expect(negative.length).toBe(1);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- HistoricalMoves`

- [ ] **Step 3: Implement**

```typescript
import type { HistoricalBlock } from "@/types";

export interface HistoricalMovesProps {
  historical: HistoricalBlock | null;
}

export default function HistoricalMoves({ historical }: HistoricalMovesProps) {
  if (!historical || historical.quarters.length === 0) {
    return (
      <section data-slot="historical-moves" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">Historical earnings</h3>
        <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">
          — no quarterly data available.
        </p>
      </section>
    );
  }
  const maxAbs = Math.max(...historical.quarters.map((q) => Math.abs(q.next_day_move_pct)), 0.01);
  return (
    <section data-slot="historical-moves" className="mt-4">
      <h3 className="t-display-section italic text-[13px]">
        Historical earnings <span className="t-label text-[color:var(--fg-muted)]">· last {historical.quarters.length}q</span>
      </h3>
      <div className="mt-2 flex items-end gap-3">
        <div className="flex h-[48px] items-end gap-1">
          {historical.quarters.map((q) => {
            const pct = q.next_day_move_pct;
            const h = Math.max(6, (Math.abs(pct) / maxAbs) * 44);
            const sign = pct >= 0 ? "pos" : "neg";
            return (
              <div
                key={q.report_date}
                data-slot="hist-bar"
                data-sign={sign}
                title={`${q.report_date}: ${(pct * 100).toFixed(1)}%`}
                className={"w-4 rounded-sm " + (sign === "pos" ? "bg-[color:var(--fg-pos)]" : "bg-[color:var(--fg-neg)]")}
                style={{ height: `${h}px`, opacity: 0.7 }}
              />
            );
          })}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11.5px]">
          <dt className="t-label text-[color:var(--fg-muted)]">AVG |MV|</dt>
          <dd className="text-[color:var(--fg-accent)]">±{(historical.stats.avg_abs_move_pct * 100).toFixed(1)}%</dd>
          <dt className="t-label text-[color:var(--fg-muted)]">W / L</dt>
          <dd className="text-[color:var(--fg-pos)]">{historical.stats.wins}W / {historical.stats.losses}L</dd>
          <dt className="t-label text-[color:var(--fg-muted)]">BEAT RATE</dt>
          <dd>{(historical.stats.surprise_beat_rate * 100).toFixed(0)}%</dd>
          {historical.stats.iv_vs_hist_vol_points != null && (
            <>
              <dt className="t-label text-[color:var(--fg-muted)]">IV vs HV</dt>
              <dd className="text-[color:var(--fg-muted)]">
                {historical.stats.iv_vs_hist_vol_points > 0 ? "over" : "under"}-pricing {Math.abs(historical.stats.iv_vs_hist_vol_points).toFixed(1)} vol pts
              </dd>
            </>
          )}
        </dl>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test -- HistoricalMoves
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/HistoricalMoves.tsx \
        frontend/src/__tests__/earnings/HistoricalMoves.test.tsx
git commit -m "feat(earnings): HistoricalMoves 8q bars + stats"
```

---

### Task 18: IVTermSkew

**Files:**
- Create: `_earnings/IVTermSkew.tsx`
- Test: `frontend/src/__tests__/earnings/IVTermSkew.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import IVTermSkew from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/IVTermSkew";

describe("IVTermSkew", () => {
  const term = [
    { expiry: "2026-04-25", dte: 3, atm_iv: 0.79 },
    { expiry: "2026-05-02", dte: 10, atm_iv: 0.58 },
    { expiry: "2026-05-16", dte: 24, atm_iv: 0.48 },
  ];
  const skew = {
    put_iv_25d: 0.82, call_iv_25d: 0.77, skew_points: 3.2,
    interpretation: "put-heavy skew" as const,
  };

  it("renders term structure plot points + labels", () => {
    const { container } = render(<IVTermSkew term={term} skew={skew} />);
    expect(container.textContent).toMatch(/IV term/i);
    expect(container.textContent).toMatch(/79|78|0\.79/);
    expect(container.textContent).toMatch(/skew/i);
    expect(container.textContent).toMatch(/put-heavy|put heavy/i);
  });

  it("renders empty state when both missing", () => {
    const { container } = render(<IVTermSkew term={null} skew={null} />);
    expect(container.textContent).toMatch(/unavailable|—/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- IVTermSkew`

- [ ] **Step 3: Implement (bars-based minimal visualization; no d3/Chart.js)**

```typescript
import type { IVTermPoint, SkewBlock } from "@/types";

export interface IVTermSkewProps {
  term: IVTermPoint[] | null;
  skew: SkewBlock | null;
}

export default function IVTermSkew({ term, skew }: IVTermSkewProps) {
  if (!term && !skew) {
    return (
      <section data-slot="iv-term-skew" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">IV term · skew</h3>
        <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">— unavailable</p>
      </section>
    );
  }
  return (
    <section data-slot="iv-term-skew" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
      {/* Term structure */}
      <div>
        <h3 className="t-display-section italic text-[13px]">IV term structure</h3>
        {term && term.length > 0 ? (
          <TermStrip points={term} />
        ) : (
          <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">— unavailable</p>
        )}
      </div>
      {/* Skew */}
      <div>
        <h3 className="t-display-section italic text-[13px]">Put/call skew</h3>
        {skew ? (
          <div className="mt-1 font-mono text-[12px] space-y-0.5">
            <div>25Δ put IV: <span className="tabular-nums">{skew.put_iv_25d ? (skew.put_iv_25d * 100).toFixed(1) + "%" : "—"}</span></div>
            <div>25Δ call IV: <span className="tabular-nums">{skew.call_iv_25d ? (skew.call_iv_25d * 100).toFixed(1) + "%" : "—"}</span></div>
            <div className="text-[color:var(--fg-accent)]">
              Skew: {skew.skew_points != null ? `${skew.skew_points >= 0 ? "+" : ""}${skew.skew_points.toFixed(1)}pts` : "—"}
            </div>
            <div className="text-[color:var(--fg-muted)]">{skew.interpretation ?? ""}</div>
          </div>
        ) : (
          <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">— unavailable</p>
        )}
      </div>
    </section>
  );
}

function TermStrip({ points }: { points: IVTermPoint[] }) {
  const max = Math.max(...points.map((p) => p.atm_iv));
  const min = Math.min(...points.map((p) => p.atm_iv));
  const range = max - min || 1;
  return (
    <div className="mt-1">
      <div className="flex h-10 items-end gap-1">
        {points.map((p) => {
          const h = ((p.atm_iv - min) / range) * 30 + 8;
          return (
            <div key={p.expiry} title={`${p.expiry}: ${(p.atm_iv * 100).toFixed(1)}%`} className="flex flex-col items-center gap-0.5">
              <div className="w-5 bg-[color:var(--fg-accent)] rounded-sm" style={{ height: `${h}px`, opacity: 0.7 }} />
              <span className="font-mono text-[10px] text-[color:var(--fg-muted)]">{p.dte}d</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 font-mono text-[11px] text-[color:var(--fg-muted)]">
        front {(points[0].atm_iv * 100).toFixed(0)}% → back {(points[points.length - 1].atm_iv * 100).toFixed(0)}%
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test -- IVTermSkew
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/IVTermSkew.tsx \
        frontend/src/__tests__/earnings/IVTermSkew.test.tsx
git commit -m "feat(earnings): IVTermSkew mini-chart + skew readout"
```

---

### Task 19: NewsFeed

**Files:**
- Create: `_earnings/NewsFeed.tsx`
- Test: `frontend/src/__tests__/earnings/NewsFeed.test.tsx`

- [ ] **Step 1: Test**

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import NewsFeed from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed";

describe("NewsFeed", () => {
  it("renders article titles, sources, and published time", () => {
    const { container } = render(
      <NewsFeed news={[
        { title: "Blackwell ramp on track", source: "Reuters", published_at: new Date().toISOString(), url: "https://example.com/a" },
        { title: "China export pivot", source: "Bloomberg", published_at: new Date(Date.now() - 5 * 3600_000).toISOString(), url: "https://example.com/b" },
      ]} />,
    );
    expect(container.textContent).toContain("Blackwell ramp on track");
    expect(container.textContent).toContain("Reuters");
    expect(container.textContent).toContain("China export pivot");
    expect(container.textContent).toContain("Bloomberg");
    const linkA = container.querySelector('a[href="https://example.com/a"]');
    expect(linkA).not.toBeNull();
  });

  it("renders empty state when no news", () => {
    const { container } = render(<NewsFeed news={[]} />);
    expect(container.textContent).toMatch(/no news|—/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- NewsFeed`

- [ ] **Step 3: Implement**

```typescript
import type { EarningsNewsArticle } from "@/types";

export interface NewsFeedProps {
  news: EarningsNewsArticle[];
}

export default function NewsFeed({ news }: NewsFeedProps) {
  if (!news || news.length === 0) {
    return (
      <section data-slot="news-feed" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">News</h3>
        <p className="mt-1 font-mono text-[12px] text-[color:var(--fg-muted)]">— no recent news</p>
      </section>
    );
  }
  return (
    <section data-slot="news-feed" className="mt-4">
      <h3 className="t-display-section italic text-[13px]">
        News <span className="t-label text-[color:var(--fg-muted)]">· filtered</span>
      </h3>
      <ul className="mt-1 space-y-0.5">
        {news.slice(0, 10).map((a, i) => (
          <li key={a.url ?? i} className="border-b border-dotted border-[color:var(--fg-border)] py-1">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12.5px] hover:text-[color:var(--fg-accent)]"
            >
              {a.title}
            </a>
            <span className="ml-2 font-mono text-[11px] text-[color:var(--fg-muted)]">
              — {a.source} · {relativeTime(a.published_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 60 * 60) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 60 * 60 * 24) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test -- NewsFeed
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/NewsFeed.tsx \
        frontend/src/__tests__/earnings/NewsFeed.test.tsx
git commit -m "feat(earnings): NewsFeed with source + relative time"
```

---

### Task 20: TradeButtonRow (deep-links to /trade)

**Files:**
- Create: `_earnings/TradeButtonRow.tsx`
- Test: `frontend/src/__tests__/earnings/TradeButtonRow.test.tsx`

- [ ] **Step 1: Test**

```typescript
import "../setup-mocks";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TradeButtonRow from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow";
import type { StrikeLadder } from "@/types";

const ladder: StrikeLadder = {
  expiry: "2026-04-25",
  underlying_price: 201.7,
  rows: [
    { strike: 195, side: "put", bucket: "30Δ", delta: -0.30, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yield_pct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
    { strike: 200, side: "put", bucket: "ATM", delta: -0.50, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yield_pct: 0.028, pop: 0.50, theta: -0.30, gamma: 0.022, vega: 0.40, oi: 2000, volume: 900 },
    { strike: 205, side: "call", bucket: "ATM", delta: 0.50, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yield_pct: 0.031, pop: 0.50, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
    { strike: 210, side: "call", bucket: "30Δ", delta: 0.30, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.80, yield_pct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
  ],
};

describe("TradeButtonRow", () => {
  it("renders three deep-link buttons: short call, short put, strangle", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    expect(container.textContent).toMatch(/short call/i);
    expect(container.textContent).toMatch(/short put/i);
    expect(container.textContent).toMatch(/strangle/i);
  });

  it("short call button links to /trade with ATM call contract", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-short-call"]') as HTMLAnchorElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("href")).toMatch(/\/trade\?/);
    expect(btn.getAttribute("href")).toContain("symbol=NVDA");
    expect(btn.getAttribute("href")).toMatch(/side=sell/);
    expect(btn.getAttribute("href")).toContain("205"); // ATM call strike
  });

  it("short put button links to ATM put", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-short-put"]') as HTMLAnchorElement;
    expect(btn.getAttribute("href")).toContain("200"); // ATM put strike
  });

  it("strangle button encodes two legs via ?legs= param", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={ladder} />);
    const btn = container.querySelector('a[data-slot="trade-button-strangle"]') as HTMLAnchorElement;
    expect(btn.getAttribute("href")).toContain("legs=");
    // 30Δ put + 30Δ call strikes = 195 + 210
    expect(btn.getAttribute("href")).toMatch(/195.*sell/);
    expect(btn.getAttribute("href")).toMatch(/210.*sell/);
  });

  it("renders disabled state when ladder is null", () => {
    const { container } = render(<TradeButtonRow symbol="NVDA" ladder={null} />);
    expect(container.textContent).toMatch(/unavailable|no chain/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- TradeButtonRow`

- [ ] **Step 3: Implement**

```typescript
import Link from "next/link";
import type { StrikeLadder, LadderRow } from "@/types";

export interface TradeButtonRowProps {
  symbol: string;
  ladder: StrikeLadder | null;
}

export default function TradeButtonRow({ symbol, ladder }: TradeButtonRowProps) {
  if (!ladder || ladder.rows.length === 0) {
    return (
      <div data-slot="trade-button-row" className="mt-4 border-t border-[color:var(--fg-border)] pt-3">
        <p className="font-mono text-[12px] text-[color:var(--fg-muted)]">
          — options chain unavailable, trade buttons disabled.
        </p>
      </div>
    );
  }
  const atmCall = pickRow(ladder.rows, "call", "ATM");
  const atmPut = pickRow(ladder.rows, "put", "ATM");
  const farCall = pickRow(ladder.rows, "call", "30Δ");
  const farPut = pickRow(ladder.rows, "put", "30Δ");

  return (
    <div data-slot="trade-button-row" className="mt-4 grid grid-cols-1 gap-2 border-t border-[color:var(--fg-border)] pt-3 md:grid-cols-3">
      {atmCall && (
        <Link
          data-slot="trade-button-short-call"
          href={buildSingleLegURL({ symbol, row: atmCall, expiry: ladder.expiry })}
          className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-elevated)] px-3 py-2 text-center font-mono text-[12px] text-[color:var(--fg-accent)] hover:border-[color:var(--fg-accent)]"
        >
          ▸ Short call {Math.round(atmCall.strike)}c
        </Link>
      )}
      {atmPut && (
        <Link
          data-slot="trade-button-short-put"
          href={buildSingleLegURL({ symbol, row: atmPut, expiry: ladder.expiry })}
          className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-elevated)] px-3 py-2 text-center font-mono text-[12px] text-[color:var(--fg-accent)] hover:border-[color:var(--fg-accent)]"
        >
          ▸ Short put {Math.round(atmPut.strike)}p
        </Link>
      )}
      {farPut && farCall && (
        <Link
          data-slot="trade-button-strangle"
          href={buildStrangleURL({ symbol, put: farPut, call: farCall, expiry: ladder.expiry })}
          className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-elevated)] px-3 py-2 text-center font-mono text-[12px] text-[color:var(--fg-accent)] hover:border-[color:var(--fg-accent)]"
        >
          ▸ Sell strangle {Math.round(farPut.strike)}/{Math.round(farCall.strike)}
        </Link>
      )}
    </div>
  );
}

function pickRow(rows: LadderRow[], side: "call" | "put", bucket: "ATM" | "30Δ" | "15Δ"): LadderRow | null {
  return rows.find((r) => r.side === side && r.bucket === bucket) ?? null;
}

/**
 * OCC contract symbol: SYMBOL + YYMMDD + C|P + strike*1000 padded 8 digits.
 * E.g. NVDA 2026-04-25 $205 call = NVDA260425C00205000.
 */
function occSymbol(symbol: string, expiry: string, side: "call" | "put", strike: number): string {
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  const side_char = side === "call" ? "C" : "P";
  const strike_padded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `${symbol}${yymmdd}${side_char}${strike_padded}`;
}

function buildSingleLegURL(opts: { symbol: string; row: LadderRow; expiry: string }): string {
  const contract = occSymbol(opts.symbol, opts.expiry, opts.row.side, opts.row.strike);
  const params = new URLSearchParams({
    symbol: opts.symbol, contract, side: "sell", qty: "1",
  });
  return `/trade?${params.toString()}`;
}

function buildStrangleURL(opts: { symbol: string; put: LadderRow; call: LadderRow; expiry: string }): string {
  const putContract = occSymbol(opts.symbol, opts.expiry, "put", opts.put.strike);
  const callContract = occSymbol(opts.symbol, opts.expiry, "call", opts.call.strike);
  const legs = `${putContract}:sell:1,${callContract}:sell:1`;
  const params = new URLSearchParams({ symbol: opts.symbol, legs });
  return `/trade?${params.toString()}`;
}
```

- [ ] **Step 4: Verify + commit**

```bash
pnpm test -- TradeButtonRow
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/TradeButtonRow.tsx \
        frontend/src/__tests__/earnings/TradeButtonRow.test.tsx
git commit -m "feat(earnings): TradeButtonRow with single-leg + strangle deep-links"
```

---

## Phase F — Detail panel assembly (Task 21)

### Task 21: EarningsDetailPanel — V2 shell with responsive collapse

**Files:**
- Modify: `_earnings/EarningsDetailPanel.tsx`
- Test: `frontend/src/__tests__/earnings/EarningsDetailPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import EarningsDetailPanel from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel";
import type { EarningsDetail } from "@/types";

const detail: EarningsDetail = {
  symbol: "NVDA", company: "Nvidia", sector: "Semis",
  report_date: "2026-04-23", report_time: "AMC",
  quote: { last: 201.7, change: -1.4, change_pct: -0.007 },
  metrics: { iv_rank: 78, iv_percentile: 82, current_iv: 0.79, hv_20: 0.42, hv_50: null, hv_100: null, hv_iv_ratio: 0.71, expected_move_pct: 0.064, expected_move_dollars: 12.8, hist_avg_abs_move_pct: 0.052, beat_rate: 0.87, days_to_earnings: 1, days_to_expiry: 3 },
  strike_ladder: null, claude_structured: null, claude_full_research: null,
  historical_earnings: null, iv_term_structure: null, skew: null,
  news: [], partial: false, generated_at: new Date().toISOString(),
};

describe("EarningsDetailPanel", () => {
  it("renders header, metrics, and all sub-panels when detail present", () => {
    const { container } = render(
      <EarningsDetailPanel detail={detail} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.querySelector('[data-slot="detail-header"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="metrics-strip"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="claude-thesis"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="strike-ladder"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="historical-moves"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="news-feed"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="trade-button-row"]')).not.toBeNull();
  });

  it("renders empty state when detail is null and not loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/select|choose/i);
  });

  it("renders skeleton when loading", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={true} error={null} runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/loading/i);
  });

  it("renders error message when error", () => {
    const { container } = render(
      <EarningsDetailPanel detail={null} loading={false} error="provider down" runningFull={false} onRunFullResearch={() => {}} />,
    );
    expect(container.textContent).toMatch(/provider down|error/i);
  });
});
```

- [ ] **Step 2: Verify fails** — `pnpm test -- EarningsDetailPanel`

- [ ] **Step 3: Implement**

Replace `_earnings/EarningsDetailPanel.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import type { EarningsDetail } from "@/types";

import DetailHeader from "./DetailHeader";
import MetricsStrip from "./MetricsStrip";
import ClaudeThesisCard from "./ClaudeThesisCard";
import StrikeLadder from "./StrikeLadder";
import HistoricalMoves from "./HistoricalMoves";
import IVTermSkew from "./IVTermSkew";
import NewsFeed from "./NewsFeed";
import TradeButtonRow from "./TradeButtonRow";

export interface EarningsDetailPanelProps {
  detail: EarningsDetail | null;
  loading: boolean;
  error: string | null;
  runningFull: boolean;
  onRunFullResearch: () => void;
}

/**
 * V2 layout — two columns at ≥1200px panel width, collapses to V1 stacked
 * below. Sub-panels slot into consistent vertical rhythm via the editorial
 * tokens.
 */
export default function EarningsDetailPanel({
  detail, loading, error, runningFull, onRunFullResearch,
}: EarningsDetailPanelProps) {
  const isWide = useIsWide(1200);

  if (error) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <p className="font-mono text-[13px] text-[color:var(--fg-neg)]">Error · {error}</p>
      </section>
    );
  }
  if (loading && !detail) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Loading detail…</p>
      </section>
    );
  }
  if (!detail) {
    return (
      <section data-slot="earnings-detail-panel" className="rounded border border-[color:var(--fg-border)] p-4">
        <p className="font-mono text-[13px] text-[color:var(--fg-muted)]">Select a symbol from the sidebar.</p>
      </section>
    );
  }

  return (
    <section
      data-slot="earnings-detail-panel"
      className="rounded border border-[color:var(--fg-border)] bg-[color:var(--bg-card)] p-4"
    >
      <DetailHeader
        symbol={detail.symbol} company={detail.company} sector={detail.sector}
        report_date={detail.report_date} report_time={detail.report_time}
        quote={detail.quote}
      />
      <MetricsStrip metrics={detail.metrics} />

      {isWide ? (
        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* Left column: thesis + news */}
          <div className="min-w-0 space-y-3">
            <ClaudeThesisCard
              structured={detail.claude_structured} full={detail.claude_full_research}
              running={runningFull} onRunFull={onRunFullResearch}
            />
            <NewsFeed news={detail.news} />
          </div>
          {/* Right column: ladder + historical + term/skew */}
          <div className="min-w-0 space-y-3">
            <StrikeLadder ladder={detail.strike_ladder} />
            <HistoricalMoves historical={detail.historical_earnings} />
            <IVTermSkew term={detail.iv_term_structure} skew={detail.skew} />
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <ClaudeThesisCard
            structured={detail.claude_structured} full={detail.claude_full_research}
            running={runningFull} onRunFull={onRunFullResearch}
          />
          <StrikeLadder ladder={detail.strike_ladder} />
          <HistoricalMoves historical={detail.historical_earnings} />
          <IVTermSkew term={detail.iv_term_structure} skew={detail.skew} />
          <NewsFeed news={detail.news} />
        </div>
      )}

      <TradeButtonRow symbol={detail.symbol} ladder={detail.strike_ladder} />

      {detail.partial && (
        <p className="mt-3 font-mono text-[11px] text-[color:var(--fg-muted)]">
          Some fields partial — one or more providers were unavailable.
        </p>
      )}
    </section>
  );
}

/** Track whether the viewport (or the panel's container ideally — but
 *  without a ResizeObserver setup we use window width as a proxy) is wider
 *  than `px`. Panel-width comes out close to viewport-width minus 280px
 *  sidebar, so viewport >= 1480 ≈ panel >= 1200. */
function useIsWide(panelThresholdPx: number): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const viewportThreshold = panelThresholdPx + 300; // +sidebar+gutters
    const check = () => setWide(window.innerWidth >= viewportThreshold);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [panelThresholdPx]);
  return wide;
}
```

- [ ] **Step 4: Verify passes** — `pnpm test -- EarningsDetailPanel`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx \
        frontend/src/__tests__/earnings/EarningsDetailPanel.test.tsx
git commit -m "feat(earnings): EarningsDetailPanel V2 responsive shell"
```

---

## Phase G — `/trade` query-param pre-population (Tasks 22-23)

### Task 22: Single-leg pre-fill in `/trade`

**Files:**
- Modify: `frontend/src/app/(dashboard)/trade/page.tsx`
- Test: `frontend/src/__tests__/trade-deeplink.test.tsx`

- [x] **Step 1: Write failing test**

Create `frontend/src/__tests__/trade-deeplink.test.tsx`:

```typescript
import "./setup-mocks";
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import TradePage from "@/app/(dashboard)/trade/page";

function stubLocation(search: string) {
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, search, pathname: "/trade" },
  });
}

describe("/trade deep-link pre-fill", () => {
  beforeEach(() => stubLocation(""));

  it("reads ?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1 into ticket", async () => {
    stubLocation("?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1");
    const { container } = render(<TradePage />);
    await waitFor(() => {
      // The order ticket should show the symbol
      expect(container.textContent).toContain("NVDA");
      // The ticket should indicate sell side
      const sellIndicator = container.querySelector('[data-order-side="sell"]');
      expect(sellIndicator).not.toBeNull();
      // The contract should be rendered as the active contract
      const contractDisplay = container.querySelector('[data-slot="active-contract"]');
      expect(contractDisplay?.textContent).toContain("205");
    });
  });

  it("leaves ticket empty when no query params", async () => {
    const { container } = render(<TradePage />);
    // Default state — no active contract
    const active = container.querySelector('[data-slot="active-contract"]');
    expect(active).toBeNull();
  });
});
```

- [x] **Step 2: Verify fails** — `pnpm test -- trade-deeplink`

- [x] **Step 3: Inspect current trade page + implement pre-fill**

Open `frontend/src/app/(dashboard)/trade/page.tsx` and find where the order ticket state is managed. Add a `useEffect` that runs on mount (before any user interaction) to read URL params and dispatch the equivalent of a "contract selected" event.

Pseudocode (adapt to the actual state model in `/trade` — the page already has state for `symbol`, `side`, `qty`, etc.):

```typescript
useEffect(() => {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  const symbol = p.get("symbol");
  const contract = p.get("contract");
  const legsParam = p.get("legs");
  const side = p.get("side") as "buy" | "sell" | null;
  const qty = p.get("qty") ? Number(p.get("qty")) : null;

  // Multi-leg takes precedence (Task 23)
  if (legsParam) {
    // handled in Task 23
    return;
  }

  // Single-leg pre-fill
  if (symbol) setSymbol(symbol);
  if (contract) setActiveContract(parseOccSymbol(contract));
  if (side) setOrderSide(side);
  if (qty && qty > 0) setOrderQty(qty);
}, []);

/**
 * Parse OCC contract symbol into its parts.
 * Format: SSSSSS YYMMDD C|P NNNNNNNN  (strike is 8 digits, price * 1000)
 * E.g. NVDA260425C00205000 → { symbol: "NVDA", expiry: "2026-04-25", side: "call", strike: 205 }
 */
export function parseOccSymbol(occ: string): {
  symbol: string; expiry: string; side: "call" | "put"; strike: number;
} | null {
  // OCC option symbols are typically 21 chars but the underlying can be up to 6
  // characters. We parse from the back: last 8 = strike*1000, preceded by
  // 1 char side, preceded by 6 YYMMDD, and whatever's left is the symbol.
  const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(occ);
  if (!m) return null;
  const [, sym, yymmdd, sideChar, strikeStr] = m;
  const expiry = "20" + yymmdd.slice(0, 2) + "-" + yymmdd.slice(2, 4) + "-" + yymmdd.slice(4, 6);
  return {
    symbol: sym,
    expiry,
    side: sideChar === "C" ? "call" : "put",
    strike: parseInt(strikeStr, 10) / 1000,
  };
}
```

Also add `data-order-side="<side>"` and `data-slot="active-contract"` attributes to wherever the ticket renders these values so the test can assert. If the trade page doesn't currently render a visible "active contract" row (because it doesn't support options-first workflow), add one inside the existing ticket component:

```tsx
{activeContract && (
  <div data-slot="active-contract" className="mt-2 font-mono text-[13px]">
    {activeContract.symbol} {activeContract.expiry} {activeContract.strike.toFixed(0)}{activeContract.side === "call" ? "c" : "p"}
  </div>
)}
```

- [x] **Step 4: Verify passes** — `pnpm test -- trade-deeplink`

- [x] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/trade/page.tsx frontend/src/__tests__/trade-deeplink.test.tsx
git commit -m "feat(trade): single-leg query-param pre-fill (symbol/contract/side/qty)"
```

---

### Task 23: Multi-leg strangle pre-staging in `/trade`

**Files:**
- Modify: `frontend/src/app/(dashboard)/trade/page.tsx` (and whichever order-ticket component it uses)
- Modify: `frontend/src/__tests__/trade-deeplink.test.tsx` (add test)

- [x] **Step 1: Write failing test**

Append to `frontend/src/__tests__/trade-deeplink.test.tsx`:

```typescript
describe("/trade multi-leg pre-staging", () => {
  it("parses ?legs=A:sell:1,B:sell:1 into two legs on the ticket", async () => {
    stubLocation("?symbol=NVDA&legs=NVDA260425P00195000:sell:1,NVDA260425C00210000:sell:1");
    const { container } = render(<TradePage />);
    await waitFor(() => {
      const legs = container.querySelectorAll('[data-slot="active-leg"]');
      expect(legs.length).toBe(2);
      const texts = Array.from(legs).map(l => l.textContent ?? "");
      expect(texts.some(t => t.includes("195") && /put/i.test(t))).toBe(true);
      expect(texts.some(t => t.includes("210") && /call/i.test(t))).toBe(true);
    });
  });
});
```

- [x] **Step 2: Verify fails** — `pnpm test -- trade-deeplink`

- [x] **Step 3: Add multi-leg parsing + rendering**

In the same useEffect from Task 22, replace the "handled in Task 23" comment with:

```typescript
  if (legsParam) {
    const legStrings = legsParam.split(",");
    const parsedLegs = legStrings
      .map(s => {
        const [contract, side, qtyStr] = s.split(":");
        const parsed = parseOccSymbol(contract);
        if (!parsed) return null;
        return { ...parsed, side_action: side as "buy" | "sell", qty: Number(qtyStr) };
      })
      .filter((l): l is NonNullable<typeof l> => l != null);
    if (parsedLegs.length > 0) {
      if (symbol) setSymbol(symbol);
      setActiveLegs(parsedLegs);
      return;
    }
  }
```

Add state + rendering:

```tsx
const [activeLegs, setActiveLegs] = useState<Leg[] | null>(null);

// Render below the single-contract block:
{activeLegs && activeLegs.length > 0 && (
  <div data-slot="active-legs" className="mt-3 space-y-1">
    {activeLegs.map((l, i) => (
      <div key={i} data-slot="active-leg" className="font-mono text-[12px]">
        {l.side_action.toUpperCase()} · {l.symbol} {l.expiry} {l.strike.toFixed(0)}{l.side === "call" ? "c" : "p"} · {l.qty}
      </div>
    ))}
  </div>
)}
```

Where `Leg` type:

```typescript
type Leg = {
  symbol: string; expiry: string; side: "call" | "put"; strike: number;
  side_action: "buy" | "sell"; qty: number;
};
```

**If the existing order ticket does not support multi-leg orders**: this task must add a minimal "Combo" mode that accepts N legs, collects them visually, and on submit sends them as a single order to `placeOrder` (or a new `placeComboOrder` backed by the broker's multi-leg endpoint). If that's a bigger lift than expected, scope it into a separate sub-task and surface a warning banner for now: "Multi-leg orders are preview — review each leg on /trade and submit legs individually." The deep-link still works; the execution path is what gets scoped.

- [x] **Step 4: Verify passes** — `pnpm test -- trade-deeplink`

- [x] **Step 5: Commit**

```bash
git add frontend/src/app/\(dashboard\)/trade/page.tsx frontend/src/__tests__/trade-deeplink.test.tsx
git commit -m "feat(trade): multi-leg pre-staging via ?legs= param"
```

---

## Phase H — Integration + deploy (Tasks 24-25)

### Task 24: End-to-end integration test

**Files:**
- Modify: `frontend/src/__tests__/earnings/page.test.tsx` (extend)

- [ ] **Step 1: Add integration assertions for the full flow**

Append to `frontend/src/__tests__/earnings/page.test.tsx`:

```typescript
describe("Earnings Options Play — full flow", () => {
  it("end-to-end: calendar → select → detail renders → run full research → trade deep-link", async () => {
    vi.mocked(api.getEarningsCalendar).mockResolvedValueOnce({
      earnings: [{
        symbol: "NVDA", company: "Nvidia", sector: "Semis",
        report_date: "2026-04-23", report_time: "AMC", days_until: 1,
        price: 201.7, change: -1.4, change_pct: -0.007, iv_rank: 78,
        premium_yield_call_atm: 0.031, premium_yield_put_atm: 0.028,
        expected_move_pct: 0.064, hist_avg_abs_move_pct: 0.052,
        claude_verdict: "neutral-bull", claude_confidence: 0.62,
        top_setup: "short strangle",
      }], generated_at: new Date().toISOString(), partial: false,
    });
    vi.mocked(api.getEarningsDetail).mockResolvedValueOnce({
      symbol: "NVDA", company: "Nvidia", sector: "Semis",
      report_date: "2026-04-23", report_time: "AMC",
      quote: { last: 201.7, change: -1.4, change_pct: -0.007 },
      metrics: null, strike_ladder: {
        expiry: "2026-04-25", underlying_price: 201.7,
        rows: [
          { strike: 205, side: "call", bucket: "ATM", delta: 0.5, bid: 6.1, ask: 6.3, mid: 6.2, iv: 0.78, yield_pct: 0.031, pop: 0.5, theta: -0.29, gamma: 0.021, vega: 0.41, oi: 1800, volume: 700 },
          { strike: 200, side: "put", bucket: "ATM", delta: -0.5, bid: 5.5, ask: 5.7, mid: 5.6, iv: 0.79, yield_pct: 0.028, pop: 0.5, theta: -0.3, gamma: 0.022, vega: 0.4, oi: 2000, volume: 900 },
          { strike: 210, side: "call", bucket: "30Δ", delta: 0.3, bid: 3.7, ask: 3.9, mid: 3.8, iv: 0.8, yield_pct: 0.019, pop: 0.68, theta: -0.23, gamma: 0.017, vega: 0.32, oi: 1200, volume: 400 },
          { strike: 195, side: "put", bucket: "30Δ", delta: -0.3, bid: 3.3, ask: 3.5, mid: 3.4, iv: 0.81, yield_pct: 0.017, pop: 0.68, theta: -0.22, gamma: 0.018, vega: 0.31, oi: 1000, volume: 500 },
        ],
      },
      claude_structured: {
        verdict: "neutral-bull", direction_magnitude: { bull_case_pct: 0.04, bear_case_pct: -0.05 },
        thesis: "IV overpriced.", catalysts: ["Blackwell"], risks: ["Guide miss"],
        suggested_play: "short strangle", suggested_play_reason: "IVR>75", confidence: 0.62,
        model: "claude-opus-4-7", generated_at: new Date().toISOString(),
      },
      claude_full_research: null, historical_earnings: null,
      iv_term_structure: null, skew: null, news: [], partial: false,
      generated_at: new Date().toISOString(),
    });

    const { container } = render(<EarningsOptionsPlayPage />);
    await waitFor(() => {
      expect(container.querySelector('[data-slot="claude-thesis"]')?.textContent).toMatch(/NEUTRAL-BULL/);
      expect(container.querySelector('[data-slot="strike-ladder"]')).not.toBeNull();
      expect(container.querySelector('[data-slot="trade-button-short-call"]')?.getAttribute("href")).toContain("205");
      expect(container.querySelector('[data-slot="trade-button-strangle"]')?.getAttribute("href")).toContain("legs=");
    });

    // Fire the "Run full research" flow
    vi.mocked(api.postEarningsFullResearch).mockResolvedValueOnce({
      thesis_paragraph: "Full paragraph.", comparable_setups: [],
      post_earnings_drift_playbook: "", sector_backdrop: "",
      analyst_consensus_delta: "", what_would_change_my_mind: "",
      confidence: 0.7, model: "claude-opus-4-7", generated_at: new Date().toISOString(),
    });
    const btn = container.querySelector('[data-slot="claude-thesis"] button');
    await act(async () => { btn?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitFor(() => {
      expect(api.postEarningsFullResearch).toHaveBeenCalledWith("NVDA");
      expect(container.querySelector('[data-slot="claude-full-research"]')).not.toBeNull();
    });
  });
});
```

- [ ] **Step 2: Verify + commit**

```bash
pnpm test -- earnings/page
git add frontend/src/__tests__/earnings/page.test.tsx
git commit -m "test(earnings): end-to-end flow — calendar→select→ladder→trade→full-research"
```

---

### Task 25: Deploy + smoke test

**Files:**
- None (operational only)

- [ ] **Step 1: Run full test suites — backend + frontend**

```bash
cd /Users/GK/Downloads/alphadesk/backend && pytest -x
cd /Users/GK/Downloads/alphadesk/frontend && pnpm test && pnpm run type-check && pnpm run build
```
Expected: backend tests all PASS, frontend tests all PASS, type-check clean, production build clean.

- [ ] **Step 2: Push + trigger deploy**

```bash
cd /Users/GK/Downloads/alphadesk
git push origin feature/deployment
gh workflow run deploy.yml --ref feature/deployment
```

- [ ] **Step 3: Monitor deploy**

```bash
gh run list --branch feature/deployment --limit 1
# Once queued, wait for completion:
run_id=$(gh run list --branch feature/deployment --limit 1 --json databaseId --jq '.[0].databaseId')
until gh run view "$run_id" --json status --jq '.status' | grep -q completed; do sleep 30; done
gh run view "$run_id" --json conclusion
```
Expected: `"conclusion": "success"`.

- [ ] **Step 4: Verify prod container tag**

```bash
ssh -i ~/.ssh/alphadesk root@178.156.145.213 \
  "docker ps --format '{{.Names}}\t{{.Image}}' | grep alphadesk-frontend"
```
Expected: frontend tag matches HEAD commit SHA.

- [ ] **Step 5: Smoke test every new surface on prod**

Using Chrome MCP (or manual browser), walk through:

1. `https://tradingalpha.net/strategies` — verify "Research" section exists with "Earnings Options Play" card; card shows "RESEARCH" pill; click routes to the screener.
2. `https://tradingalpha.net/strategies/earnings-options-play` — verify calendar sidebar renders with day groups; detail panel populates for the first selected symbol; Claude structured card renders with verdict/thesis/play; strike ladder shows at least ATM rows; news list has items; trade buttons deep-link to `/trade?…`.
3. Click "Run full research" — full-research block appears with thesis paragraph + comparable setups.
4. Click "Short call X" — lands on `/trade` with symbol + contract pre-filled, order side = sell, qty = 1.
5. Click "Sell strangle …" — lands on `/trade` with two legs rendered; each leg shows side/strike/expiry correctly.
6. Adjust a filter (IV rank slider to 70) — calendar refetches; selected symbol preserved if still in results.
7. Refresh the page while a symbol is selected — selection preserved via URL param.

- [ ] **Step 6: Commit smoke-test artifacts (optional)**

If screenshots are captured during smoke, commit them into `docs/superpowers/artifacts/2026-04-22-earnings-options-play/` for the PR reviewer. Otherwise done.

```bash
# Only if artifacts exist:
git add docs/superpowers/artifacts/2026-04-22-earnings-options-play/
git commit -m "chore(docs): smoke-test screenshots for earnings-options-play"
git push
```

---

## Self-Review

Run through the spec file (`docs/superpowers/specs/2026-04-22-earnings-options-play-design.md`) and the plan above. Check:

**Spec coverage** — every section in the spec maps to at least one task:
- Problem / Goals / Non-goals → Tasks 1-25 (the feature itself is the goals)
- Architecture · new file tree → Task 11 (page shell + stubs) + Task 4 (schemas) + Task 9 (routes) + Task 5-8 (aggregator)
- Strategy-kind flag → Task 1 (backend) + Task 2 (frontend)
- Backend · `GET /api/v1/earnings/calendar` → Task 9
- Backend · `GET /api/v1/earnings/{symbol}/detail` → Task 9
- Backend · `POST /api/v1/earnings/{symbol}/full-research` → Task 9
- Aggregator · list_upcoming / get_detail → Task 7
- Aggregator · run_full_research → Task 8
- Cache TTLs → Tasks 7, 8 (applied in the `_load_*` + `_run_structured_and_cache` + `run_full_research` code)
- Model selection · Opus both tiers → Task 6 (`MODEL_STRUCTURED`, `MODEL_FULL` constants)
- Prompt shapes → Task 6
- Frontend · route + components → Task 11 (shell) + Tasks 12-21 (one per component)
- Page state + URL sync → Task 11
- Responsive V2↔V1 → Task 21
- Deep-link contract → Tasks 20 (outgoing URL) + 22-23 (incoming pre-fill)
- Styling · editorial tokens → reused throughout; `.t-ladder-row` added in Task 15
- Data flow (9 steps) → Task 24 integration test covers all 9 steps
- Error handling per failure mode → Tasks 11, 13, 21 (error state rendering) + Task 7 (partial: true propagation)
- Testing plan → every task has test-first discipline; Task 24 is the integration cap
- File inventory → matches the File Structure section at top of plan
- Rollout strategy → Task 25
- `/strategies/page.tsx` research grouping → Task 3
- `ResearchStrategyCard` → Task 3
- `/trade` pre-population → Tasks 22-23

No spec item is unmapped.

**Placeholder scan** — the plan has two places where it says "the engineer should mirror the existing pattern in strategies/pead/data.py::EarningsHistoryLoader" and "if a reusable decorator exists in auth.py — search for rate_limit_per_user and apply it here". These are legitimate directions (pointing at concrete existing code) rather than placeholders. One place says "TODO: Task 7.5 below" which is a stub — if historical stats turn out to be needed at calendar-fetch time (e.g. for the `top_setup` heuristic), add a follow-up task; otherwise `_load_historical` returning None is acceptable for v1 and the detail panel shows "—" for the stats block gracefully.

**Type consistency** — `CalendarRow`, `EarningsDetail`, `LadderRow`, `StrikeLadder`, `ClaudeStructured`, `ClaudeFullResearch` are used identically across backend Pydantic (Task 4), frontend types (Task 10), API client (Task 10), and every component (Tasks 12-21). `StrategyKind = "autonomous" | "research"` matches between `backend/strategies/base.py` (string field with validator) and `frontend/src/lib/strategies.ts`. `ReportTime = "BMO" | "AMC" | "DMT"` is consistent. Function names `metaKind`, `getEarningsCalendar`, `getEarningsDetail`, `postEarningsFullResearch`, `list_upcoming`, `get_detail`, `run_full_research` are used consistently across tasks.

**Method signatures** — `ResearchStrategyCardProps.metrics` has the same `{ thisWeekCount, avgIvRank, topSetup }` shape in Task 3 (component) and Task 3 (page rendering) — matches. `parseOccSymbol(occ)` declared in Task 22 and used by `TradeButtonRow` in Task 20 via `occSymbol()` (the inverse). Shapes align.

All good. Ready for execution.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-22-earnings-options-play.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task with the spec + plan as context, review each task's output between tasks, fast iteration, zero context pollution in this thread.

**2. Inline Execution** — Execute tasks in this session using executing-plans; batch execution with checkpoints for review.

Which approach?
