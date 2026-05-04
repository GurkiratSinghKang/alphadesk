# AlphaDesk UI Remediation — 2-Week Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the 24 BLOCKER findings from the GSD 6-pillar audit (`qa/reviews/UI-REVIEW.md`, score 11/24) by sequencing 6 independently-deployable PRs over 2 weeks.

**Architecture:** Production safety first — each PR ships independently against `feature/deployment` and is verified post-deploy before the next PR opens. Quick mechanical fixes ship Day 1 (visible polish gains within hours). Systemic foundations (token wiring, ESLint guards, design reconciliation) ship Week 2 once the easy wins are out and we can monitor regressions in isolation. No PR depends on a later PR's existence; failed PRs roll back without blocking the next.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 (`@theme inline`) + design-tokens.css. Backend: FastAPI/Python (untouched here). Verification: `qa/harness/run-all.mjs` against tradingalpha.net + `npm run typecheck` + `npm test`.

**Reference inputs (already produced this session):**
- `qa/reviews/UI-REVIEW.md` — consolidated bug list, BUG-01 through BUG-21
- Design-system token contract (inline in conversation, summarized in §0 below)
- Frontend-design taste decisions (inline in conversation, summarized in §0 below)
- `qa/reviews/pillars/{01-06}-*.md` — per-pillar evidence

---

## §0 — Reference: Locked-in design decisions

Each task references these. Don't relitigate — implement.

### Token contract (from `design:design-system` skill output)

| Decision | Action |
|---|---|
| **Primary CTA color** | Gold (`--brand` / `--gold-500`) only. Lime (`--up-500`) reserved for data semantics (P&L). Forest `#0f7a5d` retired from CTA use; survives only as the `.alpha-auth-shell` background. |
| **`--amber-500` decomposition** | Split into `--warn-500` (action-required), `--stale-500` (data freshness), `--ai-500` (AI marker; map to `--ice-500`). Time-of-day badges drop color (use `--fg-muted`). |
| **Typography scale** | Wire 11 sizes into Tailwind `@theme` (display-lg, display-md, h1, h2, h3, numeric-hero, numeric-lg, numeric-md, body, body-sm, label). Drop `display-xl`, `display-sm`, `numeric-xl`, `--fs-hint`, `--fs-meta`. |
| **`--fs-display-section` contradiction** | Token says 22px; 15 consumers override to 13px. **Decision: rename token to `--fs-section-cap: 13px`** (i.e. accept that consumers know the truth). |
| **Spacing scale** | Wire `--space-*` into Tailwind `@theme`. Add `--space-0_5: 2px` and `--space-1_5: 6px` (the half-steps developers escape to). |
| **Marketing/auth theme strategy** | **Decision: freeze marketing/auth as light-mode-only surface.** Cream gradient is the brand for that surface. Theme toggle ignores those routes. (Avoids touching 5+ files for theme parity.) |

### Frontend-design taste (from `frontend-design:frontend-design` skill output)

| Bug | Design direction |
|---|---|
| **BUG-03 BUY/SELL** | Segmented control with semantic dots, neutral background. Border-up-500/40 active, border-border-hair inactive. NO saturated filled blocks. |
| **BUG-03 Login** | Gold (`--brand`) button, near-black foreground, hairline `--gold-700` border, inset highlight + 1px shadow for weight on cream card. |
| **BUG-04 Earnings empty pane** | Calendar-week heatmap fills the right pane pre-selection. Each day = day-label + count badge + indented bullet rows (symbol + AMC/BMO + IV-rank + exp move). One row marked HEADLINE. Bottom hint: "↑↓ to navigate". Auto-select first row on load (no empty state ever). |
| **BUG-09 Chrome density** | 48px single-row TopBar collapses TopBar+StatusStrip+ContextBar. Status pills (regime · VIX · session-mode · avatar) live in TopBar right cluster. Hover-reveal popovers for detail. Per-route stats migrate to page hero. **Net +62px content.** |

---

## File Structure (created/modified across all 6 PRs)

PR-1 (Day 1 — Quick Wins):
- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx` (strip `!text-[#…]`)
- Modify: `frontend/src/app/(dashboard)/strategies/page.tsx` (strip `!text-[#…]`)
- Modify: `frontend/src/app/(dashboard)/page.tsx` (demote duplicate BOOK EQUITY)
- Modify: `frontend/src/components/layouts/DashboardLayout.tsx` (conditional book-equity)
- Modify: `frontend/src/app/(dashboard)/alerts/page.tsx` (sr-only h1, plurals)
- Modify: `frontend/src/app/(dashboard)/strategies/page.tsx` (sr-only h1)
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx` (sr-only h1)
- Modify: `frontend/src/components/panels/TradePanel.tsx` (plurals)
- Modify: `frontend/src/app/(dashboard)/error.tsx` (editorial copy)
- Modify: `frontend/src/components/error/DashboardError.tsx` (editorial copy)
- Modify: `frontend/src/components/layout/AICopilot.tsx` (clichés)
- Modify: `frontend/src/app/login/_login/LoginForm.tsx` (error copy + lockout button)
- Modify: `frontend/src/app/request-access/_request/RequestAccessForm.tsx` (success copy)
- Create: `frontend/src/app/(dashboard)/strategies/error.tsx`
- Create: `frontend/src/app/(dashboard)/strategies/[id]/error.tsx`
- Create: `frontend/src/app/(dashboard)/strategies/earnings-options-play/error.tsx`
- Create: `frontend/src/app/(dashboard)/strategies/trading-agents-research/error.tsx`

PR-2 (Day 2 — Earnings empty pane):
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx` (auto-select effect)
- Create: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx`
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx` (empty state replaced)

PR-3 (Day 2-3 — Service-worker /trade fix):
- Modify: `frontend/public/sw.js` (skip SW for `/trade*`)
- Modify: `frontend/public/offline.html` (preserve original pathname)

PR-4 (Day 3-4 — Destructive confirmation + TradePanel sentence-case + section-cap rename):
- Create: `frontend/src/components/destructive/DestructiveConfirmModal.tsx`
- Modify: `frontend/src/components/panels/TradePanel.tsx` (sentence case + adopt modal)
- Modify: `frontend/src/app/(dashboard)/page.tsx` (order cancel via modal)
- Modify: `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` (pause/resume via modal)
- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx` (pipeline cancel via modal)
- Modify: `frontend/src/components/layout/ProfileMenu.tsx` (logout via modal)
- Modify: `frontend/src/styles/design-tokens.css` (`--fs-display-section` → `--fs-section-cap: 13px`)

PR-5 (Day 5-6 — StatusBar elevation + 48px TopBar collapse):
- Modify: `frontend/src/components/composites/StatusBar.tsx` (elevate or collapse to single popover-pill)
- Modify: `frontend/src/components/layout/TopBar.tsx` (add status cluster: regime/VIX/session/avatar)
- Modify: `frontend/src/components/layout/StatusStrip.tsx` (DELETE — info migrates)
- Modify: `frontend/src/app/(dashboard)/layout.tsx` (remove StatusStrip mount)
- Create: `frontend/src/components/layout/StatusPills.tsx` (regime/VIX/session popover-revealed pills)

PR-6 (Week 2 — System foundations):
- Modify: `frontend/src/app/globals.css` (`@theme inline` extension: `--text-*`, `--spacing-*`, `--shadow-*`)
- Modify: `frontend/src/styles/design-tokens.css` (decompose `--amber-500`)
- Modify: 13+ component files (codemod arbitrary `text-[Npx]` → token classes)
- Modify: 21+ component files (codemod arbitrary spacing `[Npx]` → token classes)
- Modify: `frontend/eslint.config.mjs` (no-arbitrary-spacing, no-arbitrary-text-size rules)
- Modify: `frontend/src/app/login/_login/LoginForm.tsx` (gold Sign in button)
- Modify: `frontend/src/components/auth/AuthProductFrame.tsx` (gold CTAs)
- Modify: `frontend/src/components/ui/button.tsx` (BUY variant → segmented control)
- Modify: `frontend/src/components/composites/OrderBar.tsx` (BUY/SELL segmented control)
- Create: `frontend/src/components/primitives/EmptyState.tsx` (shared empty primitive)
- Migrate 5 existing empty states to `<EmptyState>`

---

## PR-1 — Day 1 Quick Wins (8 BLOCKERs + 5 WARNINGs in ~6 hours)

**Goal:** Visible polish gain within one deploy. Pure copy/markup edits — no logic changes, no design reconciliation. Closes BUG-01, BUG-06, BUG-11, BUG-13, BUG-14, BUG-15, BUG-16, BUG-17, BUG-18, BUG-21.

**PR title:** `qa: ui remediation r1 — quick wins (copy + landmarks + error boundaries)`

### Task 1.1: BUG-01 — strip `!text-[#…]` overrides on dark-mode pages

**Files:**
- Modify: `frontend/src/app/(dashboard)/pipeline/page.tsx` lines 896, 897, 1012, 1013, 1078, 1103, 1104, 1314, 1315
- Modify: `frontend/src/app/(dashboard)/strategies/page.tsx` lines 528, 531, 944, 947

- [ ] **Step 1:** Open `pipeline/page.tsx`. For each line above, locate the `!text-[#12281f]` and `!text-[#5d7268]` substrings. Strip ONLY those tokens — leave the rest of the className untouched.

```bash
# Verify what's there first
grep -n '!text-\[#12281f\]\|!text-\[#5d7268\]' frontend/src/app/\(dashboard\)/pipeline/page.tsx
grep -n '!text-\[#12281f\]\|!text-\[#5d7268\]' frontend/src/app/\(dashboard\)/strategies/page.tsx
```

- [ ] **Step 2:** Replace each occurrence with empty string (delete the override). The token-driven defaults (`text-fg`, `text-fg-muted` from the inherited classes) will resolve correctly.

```bash
# Use sed for both files (verify the diff before committing)
sed -i.bak 's/ !text-\[#12281f\]//g; s/ !text-\[#5d7268\]//g' \
  frontend/src/app/\(dashboard\)/pipeline/page.tsx \
  frontend/src/app/\(dashboard\)/strategies/page.tsx
rm frontend/src/app/\(dashboard\)/pipeline/page.tsx.bak \
   frontend/src/app/\(dashboard\)/strategies/page.tsx.bak
```

- [ ] **Step 3:** Verify the strip — no residual `!text-[#12281f]` / `!text-[#5d7268]` should remain anywhere in the codebase.

```bash
grep -rn '!text-\[#12281f\]\|!text-\[#5d7268\]' frontend/src 2>&1 | grep -v node_modules
# Expected: zero results
```

- [ ] **Step 4:** Run typecheck.

```bash
cd frontend && npm run typecheck
# Expected: zero errors
```

### Task 1.2: BUG-13 — DashboardError editorial copy

**Files:**
- Modify: `frontend/src/app/(dashboard)/error.tsx` lines 21-23
- Modify: `frontend/src/components/error/DashboardError.tsx` lines 41-42

- [ ] **Step 1:** Read both files to confirm current copy.

```bash
sed -n '15,30p' frontend/src/app/\(dashboard\)/error.tsx
sed -n '35,50p' frontend/src/components/error/DashboardError.tsx
```

- [ ] **Step 2:** Replace `Something went wrong` with editorial copy that names the surface.

In `frontend/src/app/(dashboard)/error.tsx` (find the headline string):
```diff
- title="Something went wrong"
- description="The dashboard hit an unexpected error. Refresh, or try again."
+ title="The dashboard hit a snag"
+ description="A page-level error stopped the workspace from loading. Refresh, or jump to a different surface from the top nav."
```

In `frontend/src/components/error/DashboardError.tsx`:
```diff
- <h2>Something went wrong</h2>
- <p>An error occurred. Try again.</p>
+ <h2>{props.surface ?? "This surface"} hit a snag</h2>
+ <p>The page failed to render — refresh, or jump to a different surface. The desk has been notified.</p>
```

- [ ] **Step 3:** Verify build still types.

```bash
cd frontend && npm run typecheck
```

### Task 1.3: BUG-14 — AICopilot replace cliché error strings

**Files:**
- Modify: `frontend/src/components/layout/AICopilot.tsx` lines 313, 345

- [ ] **Step 1:** Inspect current strings.

```bash
sed -n '305,350p' frontend/src/components/layout/AICopilot.tsx
```

- [ ] **Step 2:** Replace with named, specific copy.

```diff
# Line ~313:
- "AI assistant is currently unavailable. Please try again."
+ "Claude is offline. Check `/pipeline` for upstream status."

# Line ~345:
- "I'm having trouble connecting. Please try again in a moment."
+ "Lost the connection to Claude. The desk's pipeline retries automatically — check status at `/pipeline`."
```

- [ ] **Step 3:** Typecheck.

```bash
cd frontend && npm run typecheck
```

### Task 1.4: BUG-15 — pluralize destructive toasts (eliminate `(s)`)

**Files:**
- Modify: `frontend/src/app/(dashboard)/alerts/page.tsx` lines 787, 789, 806
- Modify: `frontend/src/components/panels/TradePanel.tsx` lines 699, 725, 734

- [ ] **Step 1:** Inspect current strings + the pluralization pattern already used elsewhere.

```bash
grep -rn 'pluralize\|alert(s)\|position(s)\|order(s)' frontend/src --include='*.tsx' | head -20
# Find the existing pattern in NotificationCenter (per the synthesis report)
grep -rn 'function pluralize\|export.*pluralize' frontend/src --include='*.ts' --include='*.tsx'
```

- [ ] **Step 2:** If a `pluralize` helper exists, import it and use it; otherwise use inline ternary.

Inline pattern (use exactly this):
```tsx
const noun = count === 1 ? "alert" : "alerts";
const message = `Failed to delete ${count} ${noun}`;
```

Apply to all 6 sites. Replace `alert(s)` → `${noun}` and `position(s)` → `${noun}` etc.

- [ ] **Step 3:** Verify zero `(s)` remain in toast strings.

```bash
grep -rn '\\(s\\)' frontend/src/app/\(dashboard\)/alerts/page.tsx \
  frontend/src/components/panels/TradePanel.tsx
# Expected: zero results
```

- [ ] **Step 4:** Typecheck.

```bash
cd frontend && npm run typecheck
```

### Task 1.5: BUG-16 — login error messages

**Files:**
- Modify: `frontend/src/app/login/_login/LoginForm.tsx` lines 164, 207

- [ ] **Step 1:** Inspect current strings.

```bash
sed -n '160,170p' frontend/src/app/login/_login/LoginForm.tsx
sed -n '200,215p' frontend/src/app/login/_login/LoginForm.tsx
```

- [ ] **Step 2:** Replace with declarative copy in AlphaDesk's voice.

```diff
- "Login failed. Try again."
+ "Those credentials didn't match. Confirm the username, the password, and that Caps Lock is off."

- "An error occurred during sign in."
+ "Sign-in failed before the desk could verify you. Refresh and retry; if it persists, email support@tradingalpha.net."
```

- [ ] **Step 3:** Typecheck.

```bash
cd frontend && npm run typecheck
```

### Task 1.6: BUG-17 — request-access success H2 voice break

**Files:**
- Modify: `frontend/src/app/request-access/_request/RequestAccessForm.tsx` lines 154-158

- [ ] **Step 1:** Inspect current H2 + the `"queued"` literal fallback.

```bash
sed -n '150,165p' frontend/src/app/request-access/_request/RequestAccessForm.tsx
```

- [ ] **Step 2:** Replace with declarative success copy.

```diff
- <h2>The desk has your details</h2>
- <p>Status: queued</p>
+ <h2>Request received</h2>
+ <p>The desk reviews requests in batches — typically within one trading session. You'll get an email at the address above when access is provisioned.</p>
```

- [ ] **Step 3:** Typecheck.

```bash
cd frontend && npm run typecheck
```

### Task 1.7: BUG-18 — login lockout button name contradicts message

**Files:**
- Modify: `frontend/src/app/login/_login/LoginForm.tsx` lines 372-380

- [ ] **Step 1:** Inspect.

```bash
sed -n '365,385p' frontend/src/app/login/_login/LoginForm.tsx
```

- [ ] **Step 2:** Rename the button — the message says the lockout will lift in N minutes, but the button used to say "Reset lockout" implying the user could bypass it. They can't — it's a local timer skip only.

```diff
- <button>Reset lockout</button>
+ <button>Clear local timer</button>
```

Adjust adjacent helper text if any to clarify "(server lockout still in effect)".

- [ ] **Step 3:** Typecheck.

```bash
cd frontend && npm run typecheck
```

### Task 1.8: BUG-06 — sr-only `<h1>` to 3 routes

**Files:**
- Modify: `frontend/src/app/(dashboard)/alerts/page.tsx` (find first content section, prepend h1)
- Modify: `frontend/src/app/(dashboard)/strategies/page.tsx`
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`

- [ ] **Step 1:** For each file, locate the outermost JSX return. Add `<h1 className="sr-only">…</h1>` as the first child of `<main>` (or top-level `<div>` if no main).

`alerts/page.tsx` — page title is "Alerts & triggers":
```tsx
<h1 className="sr-only">Alerts &amp; triggers</h1>
```

`strategies/page.tsx` — page title is "Strategies":
```tsx
<h1 className="sr-only">Strategies catalogue</h1>
```

`strategies/earnings-options-play/page.tsx` — page title varies; use:
```tsx
<h1 className="sr-only">Earnings options play</h1>
```

- [ ] **Step 2:** For each route's existing visible heading currently coded as `<h2>`, leave it untouched if it visually serves as the page title (the sr-only h1 satisfies WCAG 1.3.1 without changing the visual hierarchy). If `<h3>` is being used as the visual title (e.g. `alerts/page.tsx:213`), promote to `<h2>` so hierarchy reads h1 (sr-only) → h2 (visible title) → h3 (subsections).

- [ ] **Step 3:** Verify in DOM by inspecting the existing `qa/runs/2026-05-04T02-58-02Z/{alerts,strategies,strategies-earnings-options-play}/desktop-1440/initial.dom.html`.

```bash
grep -c '<h1' qa/runs/2026-05-04T02-58-02Z/alerts/desktop-1440/initial.dom.html
# Note: this is the OLD run; verify locally that source has h1 added
grep -c '<h1' frontend/src/app/\(dashboard\)/alerts/page.tsx
# Expected: at least 1
```

- [ ] **Step 4:** Typecheck.

### Task 1.9: BUG-21 — error.tsx boundaries for `/strategies/*`

**Files (all create):**
- `frontend/src/app/(dashboard)/strategies/error.tsx`
- `frontend/src/app/(dashboard)/strategies/[id]/error.tsx` (already exists per earlier grep — confirm and update if needed)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/error.tsx`
- `frontend/src/app/(dashboard)/strategies/trading-agents-research/error.tsx`

- [ ] **Step 1:** Confirm which already exist.

```bash
ls frontend/src/app/\(dashboard\)/strategies/error.tsx \
   frontend/src/app/\(dashboard\)/strategies/\[id\]/error.tsx \
   frontend/src/app/\(dashboard\)/strategies/earnings-options-play/error.tsx \
   frontend/src/app/\(dashboard\)/strategies/trading-agents-research/error.tsx 2>&1
```

- [ ] **Step 2:** For each missing file, copy the existing template from `frontend/src/app/(dashboard)/error.tsx` and customize the `surface` prop / heading.

Template (Next.js requires `"use client"`):
```tsx
"use client";

import { useEffect } from "react";
import DashboardError from "@/components/error/DashboardError";

export default function StrategiesError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[strategies] route error", error);
  }, [error]);
  return <DashboardError error={error} reset={reset} surface="Strategies catalogue" />;
}
```

For each route, customize:
- `strategies/error.tsx` → `surface="Strategies catalogue"`
- `strategies/[id]/error.tsx` → `surface="Strategy detail"`
- `strategies/earnings-options-play/error.tsx` → `surface="Earnings options play"`
- `strategies/trading-agents-research/error.tsx` → `surface="TradingAgents research"`

- [ ] **Step 3:** Confirm `DashboardError` accepts a `surface` prop. If not, add it as optional in `frontend/src/components/error/DashboardError.tsx` (Task 1.2 should already have introduced it).

- [ ] **Step 4:** Typecheck.

### Task 1.10: BUG-11 — demote dashboard book-equity duplicate

**Files:**
- Modify: `frontend/src/app/(dashboard)/page.tsx:1203` (or `frontend/src/components/layouts/DashboardLayout.tsx:61`, whichever the `BOOK EQUITY` repeat lives in)

- [ ] **Step 1:** Identify the exact 3 sites where `BOOK EQUITY` renders. Use grep:

```bash
grep -rn 'BOOK EQUITY\|Book equity' frontend/src --include='*.tsx' | head -10
```

- [ ] **Step 2:** Three instances expected: persistent strip, Control Room subtitle, Capital Canvas hero. KEEP the Capital Canvas hero (it's the page focal point). DELETE the other two from rendering on the dashboard route specifically.

For the StatusStrip / persistent bar: if the bar is shared across routes, gate the BOOK EQUITY pill on `pathname !== "/"` (the dashboard already shows it as the hero). Use `usePathname()`:

```tsx
const pathname = usePathname();
const showPersistentBookEquity = pathname !== "/";
{showPersistentBookEquity && <BookEquityPill … />}
```

For the Control Room subtitle: simply remove the `BOOK EQUITY $…` substring; keep "Control room" as the subtitle.

- [ ] **Step 3:** Typecheck.

### Task 1.11: PR-1 verification + commit + ship

- [ ] **Step 1:** Full typecheck + tests.

```bash
cd frontend && npm run typecheck && npm test -- --run
# Expected: typecheck zero errors; tests 983+ pass
```

- [ ] **Step 2:** Branch + commit.

```bash
cd /Users/GK/Downloads/alphadesk
git checkout -b qa/ui-remediation-r1-quick-wins feature/deployment
git add frontend/src/app/\(dashboard\)/pipeline/page.tsx \
        frontend/src/app/\(dashboard\)/strategies/page.tsx \
        frontend/src/app/\(dashboard\)/page.tsx \
        frontend/src/components/layouts/DashboardLayout.tsx \
        frontend/src/app/\(dashboard\)/alerts/page.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/page.tsx \
        frontend/src/components/panels/TradePanel.tsx \
        frontend/src/app/\(dashboard\)/error.tsx \
        frontend/src/components/error/DashboardError.tsx \
        frontend/src/components/layout/AICopilot.tsx \
        frontend/src/app/login/_login/LoginForm.tsx \
        frontend/src/app/request-access/_request/RequestAccessForm.tsx \
        frontend/src/app/\(dashboard\)/strategies/error.tsx \
        frontend/src/app/\(dashboard\)/strategies/\[id\]/error.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/error.tsx \
        frontend/src/app/\(dashboard\)/strategies/trading-agents-research/error.tsx
git commit -m "qa(ui): remediation r1 — quick wins (BUG-01,06,11,13-18,21)"
git push -u origin qa/ui-remediation-r1-quick-wins
```

- [ ] **Step 3:** Open PR against `feature/deployment`. Title: `qa(ui): remediation r1 — quick wins (10 BLOCKERs)`. Body lists each BUG-NN closed.

- [ ] **Step 4:** Merge (squash) → trigger deploy (`gh workflow run deploy.yml --ref feature/deployment`) → wait for green.

- [ ] **Step 5:** Post-deploy verification. Re-run the harness against prod, focused on the changed routes:

```bash
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<pass> \
  node qa/harness/run-all.mjs --base=https://tradingalpha.net \
  --filter=alerts,strategies-list,strategies-earnings-options-play,login,request-access-submit,pipeline
```
Expected: all specs pass (no regressions), DOMs now contain `<h1`, no `!text-[#…]` strings, copy strings updated.

- [ ] **Step 6:** Spot-check screenshots: `pipeline/desktop-1440/initial.preview.png` should now have legible h2 text (was 1.4:1 contrast).

---

## PR-2 — Day 2 Earnings empty pane (BUG-04)

**Goal:** Replace the 70% viewport void with the calendar-week heatmap from the frontend-design taste decision. Auto-select first row eliminates empty state entirely.

**PR title:** `qa(ui): remediation r2 — earnings calendar-week heatmap empty state (BUG-04)`

### Task 2.1: Auto-select first earnings row on first paint

**Files:**
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx` lines 197-220 (the `userClearedRef` effect)

- [ ] **Step 1:** Read the existing effect to understand the URL-pin / first-paint logic.

```bash
sed -n '180,230p' frontend/src/app/\(dashboard\)/strategies/earnings-options-play/page.tsx
```

- [ ] **Step 2:** Modify the effect so that on first paint (no symbol in URL), `setSelectedSymbol(rows[0].symbol)` fires unconditionally. The `userClearedRef` exception should only apply AFTER the first user interaction, never on initial load.

Pattern:
```tsx
const isFirstPaintRef = useRef(true);

useEffect(() => {
  if (rows.length === 0) return;
  if (urlSymbol) {
    setSelectedSymbol(urlSymbol);
    isFirstPaintRef.current = false;
    return;
  }
  // First paint with no URL pin → auto-select first row, override userClearedRef
  if (isFirstPaintRef.current) {
    setSelectedSymbol(rows[0].symbol);
    isFirstPaintRef.current = false;
    return;
  }
  // After first paint, respect userClearedRef
  if (userClearedRef.current) return;
  if (!selectedSymbol) setSelectedSymbol(rows[0].symbol);
}, [rows, urlSymbol]);
```

- [ ] **Step 3:** Typecheck.

### Task 2.2: Build `<CalendarWeekHeatmap>` component

**Files:**
- Create: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx`

- [ ] **Step 1:** Define the component. Props: `rows: CalendarRow[]`, `onSelect: (symbol: string) => void`, `headlineSymbol?: string`.

```tsx
"use client";

import { Fragment } from "react";
import Eyebrow from "@/components/typography/Eyebrow";
import Mono from "@/components/typography/Mono";
import { cn } from "@/lib/utils";
import type { CalendarRow } from "@/types";

interface CalendarWeekHeatmapProps {
  rows: CalendarRow[];
  onSelect: (symbol: string) => void;
  headlineSymbol?: string;
}

function groupByDate(rows: CalendarRow[]) {
  const out = new Map<string, CalendarRow[]>();
  for (const row of rows) {
    const key = row.report_date;
    const existing = out.get(key) ?? [];
    existing.push(row);
    out.set(key, existing);
  }
  return Array.from(out.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function formatDayLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  const dow = d.toLocaleDateString("en-US", { weekday: "short" });
  const date = d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  return `${dow} ${date}`;
}

export default function CalendarWeekHeatmap({ rows, onSelect, headlineSymbol }: CalendarWeekHeatmapProps) {
  const grouped = groupByDate(rows);

  // Split into "this week" / "next week" by ISO week of first row
  const firstWeek = grouped[0]?.[0]?.report_date.slice(0, 7) ?? "";
  // Simple split: first 5 day groups = this week, rest = next week (works for 2-week horizon)
  const thisWeek = grouped.slice(0, 5);
  const nextWeek = grouped.slice(5);

  return (
    <section
      data-slot="calendar-week-heatmap"
      aria-label="Earnings calendar week overview"
      className="flex flex-col gap-8 p-6"
    >
      {thisWeek.length > 0 && (
        <div className="flex flex-col gap-4">
          <Eyebrow as="div">§ THIS WEEK · {formatDayLabel(thisWeek[0][0])} — {formatDayLabel(thisWeek[thisWeek.length - 1][0])}</Eyebrow>
          {thisWeek.map(([date, dayRows]) => (
            <DayGroup key={date} date={date} rows={dayRows} onSelect={onSelect} headlineSymbol={headlineSymbol} />
          ))}
        </div>
      )}

      {nextWeek.length > 0 && (
        <div className="flex flex-col gap-4">
          <Eyebrow as="div">§ NEXT WEEK · {formatDayLabel(nextWeek[0][0])} — {formatDayLabel(nextWeek[nextWeek.length - 1][0])}</Eyebrow>
          {nextWeek.map(([date, dayRows]) => (
            <DayGroup key={date} date={date} rows={dayRows} onSelect={onSelect} headlineSymbol={headlineSymbol} />
          ))}
        </div>
      )}

      <p className="border-t border-border-hair pt-3 text-[12px] text-fg-muted">
        Pick any row above — or use ↑↓ — for the full options play.
      </p>
    </section>
  );
}

function DayGroup({
  date,
  rows,
  onSelect,
  headlineSymbol,
}: {
  date: string;
  rows: CalendarRow[];
  onSelect: (symbol: string) => void;
  headlineSymbol?: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex w-32 shrink-0 flex-col gap-1 border-l border-border-hair pl-3">
        <span className="font-mono text-[13px] text-fg">{formatDayLabel(date)}</span>
        <span className="t-label text-fg-muted">
          {rows.length} report{rows.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {rows.map((row) => {
          const isHeadline = row.symbol === headlineSymbol;
          return (
            <button
              key={`${row.symbol}-${row.report_date}`}
              type="button"
              onClick={() => onSelect(row.symbol)}
              className={cn(
                "flex items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors",
                "hover:bg-bg-elev-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              )}
            >
              <span className="w-1.5 self-stretch rounded-full bg-brand/40" aria-hidden />
              <span className="font-mono text-[13px] font-semibold text-fg">{row.symbol}</span>
              <span className="t-label text-fg-muted">{row.report_time ?? "DMT"}</span>
              {row.iv_rank != null && (
                <Mono className="text-[12px] text-fg-muted">IV {row.iv_rank.toFixed(0)}</Mono>
              )}
              {row.expected_move_pct != null && (
                <Mono className="text-[12px] text-fg-muted">±{(row.expected_move_pct * 100).toFixed(1)}%</Mono>
              )}
              {isHeadline && (
                <span className="ml-auto t-label text-brand">◀ HEADLINE</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** Confirm `CalendarRow` type has `symbol`, `report_date`, `report_time`, `iv_rank`, `expected_move_pct` fields. If not, find the actual field names in `frontend/src/types/index.ts` and adjust.

```bash
grep -A 20 'interface CalendarRow' frontend/src/types/index.ts
```

- [ ] **Step 3:** Typecheck.

### Task 2.3: Wire `<CalendarWeekHeatmap>` into `<EarningsDetailPanel>` empty state

**Files:**
- Modify: `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx` lines 188-200

- [ ] **Step 1:** Read the existing empty state.

```bash
sed -n '185,205p' frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx
```

- [ ] **Step 2:** Replace the "Select a symbol from the sidebar." empty branch with `<CalendarWeekHeatmap rows={…} onSelect={…} headlineSymbol={…} />`. The detail panel needs to receive `rows` and `onSelect` as new props (passed from the parent page).

```diff
- {!selectedSymbol && (
-   <div className="flex h-full items-center justify-center">
-     <p className="text-fg-muted">Select a symbol from the sidebar.</p>
-   </div>
- )}
+ {!selectedSymbol && (
+   <CalendarWeekHeatmap
+     rows={rows}
+     onSelect={onSelectSymbol}
+     headlineSymbol={pickHeadlineSymbol(rows)}
+   />
+ )}
```

Add a helper `pickHeadlineSymbol(rows)` — returns the symbol with the highest IV rank, or the first row if no IV ranks.

- [ ] **Step 3:** Update `<EarningsDetailPanel>`'s prop interface to accept `rows` and `onSelectSymbol`. Update the parent call site to pass them through.

- [ ] **Step 4:** Typecheck.

### Task 2.4: Verify in dev server (or locally with playwright)

- [ ] **Step 1:** Run typecheck + tests.

```bash
cd frontend && npm run typecheck && npm test -- --run
```

- [ ] **Step 2:** Branch + PR.

```bash
git checkout -b qa/ui-remediation-r2-earnings-empty-state feature/deployment
git add frontend/src/app/\(dashboard\)/strategies/earnings-options-play/page.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/CalendarWeekHeatmap.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx
git commit -m "qa(ui): remediation r2 — earnings calendar-week heatmap empty state (BUG-04)"
git push -u origin qa/ui-remediation-r2-earnings-empty-state
gh pr create --base feature/deployment …
```

- [ ] **Step 3:** Merge → deploy → verify post-deploy:

```bash
node qa/harness/run-all.mjs --base=https://tradingalpha.net --filter=strategies-earnings-options-play
# Spot-check qa/runs/<latest>/strategies-earnings-options-play/desktop-1440/initial.preview.png
# Expected: heatmap visible OR auto-selected detail (not "Select a symbol from the sidebar.")
```

---

## PR-3 — Day 2-3 Service-worker `/trade` hijack fix (BUG-05)

**Goal:** Stop the offline shell from intercepting `/trade*` deep-links. Preserve the original pathname when the user has to retry.

**PR title:** `qa(ui): remediation r3 — sw skip /trade + preserve pathname (BUG-05)`

### Task 3.1: Skip SW intercept for `/trade*`

**Files:**
- Modify: `frontend/public/sw.js` lines 127-141

- [ ] **Step 1:** Read the current intercept logic.

```bash
sed -n '120,150p' frontend/public/sw.js
```

- [ ] **Step 2:** Add a path-prefix guard — if `event.request.url` matches `/trade`, fall through to network without the offline shell fallback.

```diff
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
+
+ // QA r3 BUG-05: trade route deep-links carry critical query state
+ // (?contract=, ?legs=, ?symbol=, &strategy=). The offline-shell intercept
+ // dropped that state when the SW returned the static fallback. Skip the
+ // intercept for /trade routes — let the browser surface its own offline
+ // dialog if connectivity is truly gone, but never trade-state via SW.
+ if (url.pathname.startsWith("/trade")) {
+   return;  // do not call event.respondWith — browser handles the request
+ }
+
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match("/offline.html"))
    );
  }
});
```

### Task 3.2: Restore original pathname in offline.html "Try again"

**Files:**
- Modify: `frontend/public/offline.html` (the link with `href="/"`)

- [ ] **Step 1:** Replace the static `href="/"` with a JS-rendered link that uses the captured original URL.

```diff
- <a href="/">Try again</a>
+ <a id="retry-link" href="/">Try again</a>
+ <script>
+   // QA r3 BUG-05: preserve the original deep-link the user was trying
+   // to reach. The SW caches the requested URL in IndexedDB before it
+   // serves /offline.html; if not present, fall back to the homepage.
+   try {
+     const original = sessionStorage.getItem("alphadesk:offline:requestedUrl");
+     if (original) {
+       document.getElementById("retry-link").href = original;
+     }
+   } catch (_) { /* gracefully fall through to "/" */ }
+ </script>
```

- [ ] **Step 2:** In `sw.js`, add `sessionStorage.setItem(...)` BEFORE serving the offline shell. (Note: SW can't access sessionStorage directly — use `Client.postMessage` to push the URL into the page-side script.)

Actually simpler: pass the original URL as a query param to the offline shell:

```diff
event.respondWith(
- fetch(event.request).catch(() => caches.match("/offline.html"))
+ fetch(event.request).catch(() => {
+   const target = encodeURIComponent(url.pathname + url.search);
+   return caches.match(`/offline.html?from=${target}`).then(response => {
+     if (response) return response;
+     return caches.match("/offline.html");
+   });
+ })
);
```

And in `offline.html`:
```html
<script>
  const params = new URLSearchParams(location.search);
  const from = params.get("from");
  if (from) document.getElementById("retry-link").href = decodeURIComponent(from);
</script>
```

- [ ] **Step 3:** Verify the SW change doesn't break the harness's `not-found` spec (which exercises offline-shell behavior indirectly).

- [ ] **Step 4:** PR + merge + deploy + verify.

```bash
git checkout -b qa/ui-remediation-r3-sw-trade-fix feature/deployment
git add frontend/public/sw.js frontend/public/offline.html
git commit -m "qa(ui): remediation r3 — sw skip /trade + preserve pathname (BUG-05)"
git push -u origin qa/ui-remediation-r3-sw-trade-fix
gh pr create --base feature/deployment …
```

After deploy, manually verify by:
1. Visiting `https://tradingalpha.net/trade?contract=NVDA260425C00205000` (should always render the trade page, never the offline shell).
2. Force-offline via Chrome devtools → Network → Offline → reload → confirm the offline.html "Try again" button preserves `/trade?contract=…`.

---

## PR-4 — Day 3-4 Destructive consistency + sentence-case + section-cap (BUG-07, BUG-09, BUG-10)

**Goal:** One canonical destructive-confirmation modal pattern for all four in-page destructive actions. Adopt OrderBar's sentence case across TradePanel. Resolve the `--fs-display-section` token contradiction.

**PR title:** `qa(ui): remediation r4 — destructive modal + sentence case + section-cap (BUG-07,09,10)`

### Task 4.1: Build `<DestructiveConfirmModal>` primitive

**Files:**
- Create: `frontend/src/components/destructive/DestructiveConfirmModal.tsx`

- [ ] **Step 1:** Reuse the pattern from `frontend/src/components/layout/CommandPalette.tsx:269-410` (the gold-standard destructive modal). Extract into a standalone component.

```tsx
"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface DestructiveConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;             // "Cancel orders" / "Pause strategy" / "Sign out"
  description: string;       // 1-line context
  consequences: string[];    // bulleted list
  confirmLabel: string;      // primary action label, e.g. "Cancel orders"
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
}

export default function DestructiveConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  consequences,
  confirmLabel,
  onConfirm,
  loading,
}: DestructiveConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="mt-2 text-[13px] text-fg-muted">{description}</p>
        {consequences.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5 text-[13px] text-fg-dim">
            {consequences.map((c) => (
              <li key={c} className="flex gap-2">
                <span aria-hidden className="text-fg-hint">·</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter className="mt-5 flex gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Keep
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2:** Verify imports resolve (`@/components/ui/dialog`, `@/components/ui/button` both exist).

- [ ] **Step 3:** Typecheck.

### Task 4.2: Wire DestructiveConfirmModal into TradePanel order-cancel + page.tsx + strategies + pipeline + ProfileMenu

For each of the 4 in-page destructive actions, replace the immediate-fire pattern with: state hook for pending action → modal → confirm → fire.

**Files (modify):**
- `frontend/src/components/panels/TradePanel.tsx:987-1013`
- `frontend/src/app/(dashboard)/page.tsx:413-431` (order cancel)
- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:716-739` (pause/resume)
- `frontend/src/app/(dashboard)/pipeline/page.tsx:553-595, 793-806` (cancel)
- `frontend/src/components/layout/ProfileMenu.tsx:83-102, 142` (logout)

For each file, the pattern is:

- [ ] **Step 1:** Add state for pending destructive action.

```tsx
const [pendingDestructive, setPendingDestructive] = useState<{
  title: string;
  description: string;
  consequences: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
} | null>(null);
```

- [ ] **Step 2:** Wrap the existing destructive handler. Instead of firing directly, set `pendingDestructive`.

```diff
- const handleCancelOrder = async () => {
-   await api.cancelOrder(orderId);
-   refresh();
- };
+ const handleCancelOrder = () => {
+   setPendingDestructive({
+     title: "Cancel order",
+     description: `Working ${order.side} ${order.qty} ${order.symbol} at ${order.limitPrice}.`,
+     consequences: [
+       "Removes the order from the broker's working queue.",
+       "Any partial fills already executed remain on the book.",
+     ],
+     confirmLabel: "Cancel order",
+     onConfirm: async () => {
+       await api.cancelOrder(orderId);
+       refresh();
+       setPendingDestructive(null);
+     },
+   });
+ };
```

- [ ] **Step 3:** Render the modal at the bottom of the JSX.

```tsx
{pendingDestructive && (
  <DestructiveConfirmModal
    open={true}
    onOpenChange={(open) => !open && setPendingDestructive(null)}
    {...pendingDestructive}
  />
)}
```

- [ ] **Step 4:** Repeat for the 3 other call sites with site-specific copy:
  - **Pause strategy** (`strategies/[id]`): consequences = ["Open positions stay; no new entries.", "Pending signals discarded.", "Resume any time from this page."]
  - **Cancel pipeline run** (`pipeline`): consequences = ["Aborts the current pass mid-step.", "Costs incurred so far are not refunded.", "Next scheduled run starts fresh."]
  - **Sign out** (`ProfileMenu`): consequences = ["Unsaved order tickets and strategy drafts are lost.", "You'll need to sign in again to resume."]

- [ ] **Step 5:** Typecheck.

### Task 4.3: TradePanel sentence-case (BUG-07)

**Files:**
- Modify: `frontend/src/components/panels/TradePanel.tsx` lines 541, 545, 555, 607

- [ ] **Step 1:** Replace ALL-CAPS / Title-Case strings with sentence case.

```diff
- "Submit LIVE Order"  → "Place order"
- "Confirm Order"      → "Confirm order"
- "Submit Order"       → "Place order"
- "Cancel Order"       → "Cancel order"
```

(If the dialog title needs to differentiate live vs paper, use "Confirm live order" / "Confirm paper order" — but do NOT shout in caps.)

- [ ] **Step 2:** Typecheck.

### Task 4.4: Resolve `--fs-display-section` 22px-vs-13px contradiction (BUG-10)

**Files:**
- Modify: `frontend/src/styles/design-tokens.css:191`
- Modify: 15 consumers (per UI-REVIEW.md): `_earnings/HistoricalMoves.tsx:12, 22`, `IVTermSkew.tsx:13, 22, 31`, `NewsFeed.tsx:34, 55`, `HistoricalSetupReplay.tsx:216`, `EarningsCalendarSidebar.tsx:150`, `StrikeLadder.tsx:17, 32`

**Decision (per §0):** rename token to `--fs-section-cap: 13px`.

- [ ] **Step 1:** In `design-tokens.css:191`, rename:

```diff
- --fs-display-section: 22px;  /* Book / Strategies / memo-body headers */
+ --fs-section-cap: 13px;       /* Section caps under page hero */
```

- [ ] **Step 2:** Find every consumer reference (CSS class `t-display-section`). Rename to `t-section-cap`.

```bash
grep -rn 't-display-section' frontend/src --include='*.tsx' --include='*.ts' --include='*.css'
```

- [ ] **Step 3:** In `design-tokens.css` (where `t-display-section` class is defined), rename and remove the `text-[13px]` override (it's now redundant since the token is 13px):

```diff
- .t-display-section {
-   font-size: var(--fs-display-section);
- }
+ .t-section-cap {
+   font-size: var(--fs-section-cap);
+ }
```

- [ ] **Step 4:** In each consumer, replace `t-display-section italic text-[13px]` → `t-section-cap italic`.

- [ ] **Step 5:** Typecheck.

### Task 4.5: PR-4 verification + ship

- [ ] **Step 1:** Full typecheck + tests.
- [ ] **Step 2:** Branch + commit + PR.

```bash
git checkout -b qa/ui-remediation-r4-destructive-and-sentence-case feature/deployment
git add frontend/src/components/destructive/DestructiveConfirmModal.tsx \
        frontend/src/components/panels/TradePanel.tsx \
        frontend/src/app/\(dashboard\)/page.tsx \
        frontend/src/app/\(dashboard\)/strategies/\[id\]/page.tsx \
        frontend/src/app/\(dashboard\)/pipeline/page.tsx \
        frontend/src/components/layout/ProfileMenu.tsx \
        frontend/src/styles/design-tokens.css \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/HistoricalMoves.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/IVTermSkew.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/NewsFeed.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/HistoricalSetupReplay.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx \
        frontend/src/app/\(dashboard\)/strategies/earnings-options-play/_earnings/StrikeLadder.tsx
git commit -m "qa(ui): remediation r4 — destructive modal + sentence case + section-cap (BUG-07,09,10)"
git push -u origin qa/ui-remediation-r4-destructive-and-sentence-case
```

- [ ] **Step 3:** Merge → deploy → re-run trade + dashboard + strategies + pipeline specs.

---

## PR-5 — Day 5-6 Chrome density: 48px TopBar collapse (BUG-02, BUG-09 chrome)

**Goal:** Replace TopBar (44px) + StatusStrip (28px) + ContextBar (38px) — total 110px chrome — with a single 48px TopBar that absorbs the regime/VIX/session pills via popover-revealed clusters. Net +62px content per page.

**PR title:** `qa(ui): remediation r5 — 48px topbar collapses 3-row chrome stack (BUG-02,09)`

### Task 5.1: Build `<StatusPills>` cluster component

**Files:**
- Create: `frontend/src/components/layout/StatusPills.tsx`

- [ ] **Step 1:** Component renders 4 compact pills with hover popovers. Read regime, VIX, session-mode from existing stores (find by grepping for current ContextBar usage).

```tsx
"use client";

import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMarketStore } from "@/stores/market";
import { usePortfolioStore } from "@/stores/portfolio";

export default function StatusPills() {
  const regime = useMarketStore((s) => s.regime);  // adjust to actual selector
  const vix = useMarketStore((s) => s.vix);
  const sessionMode = usePortfolioStore((s) => s.sessionMode);

  return (
    <div className="flex items-center gap-3">
      {/* Regime dot */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-pill px-2 py-1 text-[12px] font-mono hover:bg-bg-elev-1"
            aria-label={`Market regime: ${regime?.label ?? "unknown"}`}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                regime?.tone === "bull" && "bg-up-500",
                regime?.tone === "bear" && "bg-down-500",
                regime?.tone === "chop" && "bg-ice-500",
                !regime?.tone && "bg-fg-muted"
              )}
              aria-hidden
            />
            <span className="text-fg-muted">{regime?.shortLabel ?? "—"}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {regime?.label ?? "Regime unknown"} · since {regime?.sinceLabel ?? "—"} ET
        </TooltipContent>
      </Tooltip>

      {/* VIX */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="font-mono text-[12px] text-fg-muted hover:text-fg" aria-label={`VIX ${vix?.value}`}>
            VIX {vix?.value?.toFixed(1) ?? "—"}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          VIX {vix?.value?.toFixed(1)} · {vix?.changePct >= 0 ? "↗" : "↘"} {(vix?.changePct * 100).toFixed(1)}%
          {vix?.range5d && ` · 5d range ${vix.range5d}`}
        </TooltipContent>
      </Tooltip>

      {/* Session mode */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn(
            "rounded-pill px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
            sessionMode === "live" ? "bg-loss/10 text-loss" : "bg-bg-elev-1 text-fg-muted"
          )}>
            {sessionMode === "live" ? "LIVE" : "PAPER"}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {sessionMode === "live" ? "Live trading via Alpaca" : "Paper trading · Alpaca demo"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
```

- [ ] **Step 2:** Adjust the store selectors to actual field names (grep for `regime`, `vix`, `sessionMode` in existing stores).

- [ ] **Step 3:** Typecheck.

### Task 5.2: Add `<StatusPills>` to TopBar right cluster

**Files:**
- Modify: `frontend/src/components/layout/TopBar.tsx`

- [ ] **Step 1:** Find the current TopBar right cluster (search, theme toggle, bell, avatar).

```bash
grep -n 'avatar\|search\|ThemeToggle\|bell' frontend/src/components/layout/TopBar.tsx | head -10
```

- [ ] **Step 2:** Insert `<StatusPills />` between the search affordance and the theme toggle (left of icons cluster, right of search).

- [ ] **Step 3:** Bump TopBar height to 48px (was 44px).

- [ ] **Step 4:** Typecheck.

### Task 5.3: Remove StatusStrip mount from `(dashboard)/layout.tsx`

**Files:**
- Modify: `frontend/src/app/(dashboard)/layout.tsx`

- [ ] **Step 1:** Find the `<StatusStrip />` import + usage.

```bash
grep -n 'StatusStrip' frontend/src/app/\(dashboard\)/layout.tsx
```

- [ ] **Step 2:** Delete the import + the `<StatusStrip />` JSX line. The chrome row is gone.

- [ ] **Step 3:** Confirm no other route depends on StatusStrip (it should only be mounted from this layout).

```bash
grep -rn 'StatusStrip' frontend/src --include='*.tsx' --include='*.ts' | grep -v node_modules
```

- [ ] **Step 4:** If no other consumer, delete `frontend/src/components/layout/StatusStrip.tsx` entirely.

### Task 5.4: Adjust StatusBar (the bottom mono-pill rail) — collapse or elevate

**Files:**
- Modify: `frontend/src/components/composites/StatusBar.tsx`

- [ ] **Step 1:** Per BUG-02, the bottom rail reads as debug overlay. Two options:
  - **Option A (collapse):** Replace 11 mono pills with one "System OK · build 2.4.1 ↗" pill that opens a popover with the full system breakdown.
  - **Option B (elevate):** Bump to 28px, add `bg-bg-elev-1` background, `SYSTEM` tracked-caps eyebrow, icon-prefixed clusters.

Pick **Option A** (collapse) — simpler, returns more vertical space.

- [ ] **Step 2:** Replace StatusBar's flex-row of mono pills with a single Popover trigger:

```tsx
<Popover>
  <PopoverTrigger className="flex items-center gap-2 px-3 font-mono text-[11px] text-fg-muted hover:text-fg">
    <span className="size-1.5 rounded-full bg-up-500" aria-hidden />
    System OK · build {process.env.NEXT_PUBLIC_BUILD_VERSION}
  </PopoverTrigger>
  <PopoverContent>
    {/* the existing per-service pills, now inside the popover */}
    <SystemDetailGrid />
  </PopoverContent>
</Popover>
```

Extract the per-service pills into `<SystemDetailGrid>` for the popover.

- [ ] **Step 3:** Typecheck.

### Task 5.5: PR-5 verification + ship

- [ ] **Step 1:** Run typecheck + tests.
- [ ] **Step 2:** Branch + commit + PR.

```bash
git checkout -b qa/ui-remediation-r5-topbar-collapse feature/deployment
git add frontend/src/components/layout/TopBar.tsx \
        frontend/src/components/layout/StatusPills.tsx \
        frontend/src/app/\(dashboard\)/layout.tsx \
        frontend/src/components/composites/StatusBar.tsx
# Optionally git rm StatusStrip if no longer mounted anywhere
git commit -m "qa(ui): remediation r5 — 48px topbar collapses 3-row chrome (BUG-02,09)"
git push -u origin qa/ui-remediation-r5-topbar-collapse
```

- [ ] **Step 3:** After merge + deploy, run full harness sweep. Expected: every page now shows `<header>` of ~48px, no StatusStrip, StatusBar collapsed to one pill.

---

## PR-6 — Week 2 System Foundations (Bigger bets)

**Goal:** Wire `--space-*` and `--fs-*` into Tailwind v4 `@theme`. Decompose `--amber-500`. Reconcile lime/forest/gold primary collision. Add ESLint guards. This is the foundation work that prevents the next 50 fragmentation findings.

**Splits into 3 sub-PRs across Week 2** to keep blast radius small.

### Sub-PR 6a: Wire `@theme` extensions (Day 7)

**Files:**
- Modify: `frontend/src/app/globals.css` (extend `@theme inline { … }` with `--text-*`, `--spacing-*`, `--shadow-*`)

- [ ] **Step 1:** Append to the existing `@theme inline { … }` block (after the radius tokens, around line 142):

```css
  /* QA r6a — Typography size scale wired from design-tokens */
  --text-display-lg: var(--fs-display-lg);
  --text-display-md: var(--fs-display-md);
  --text-h1: var(--fs-h1);
  --text-h2: var(--fs-h2);
  --text-h3: var(--fs-h3);
  --text-numeric-hero: var(--fs-numeric-hero);
  --text-numeric-lg: var(--fs-numeric-lg);
  --text-numeric-md: var(--fs-numeric-md);
  --text-body: var(--fs-body);
  --text-body-sm: var(--fs-body-sm);
  --text-label: var(--fs-label);

  /* QA r6a — Spacing scale wired from design-tokens, with half-step extras */
  --spacing-0_5: 2px;
  --spacing-1: var(--space-1);     /* 4px */
  --spacing-1_5: 6px;
  --spacing-2: var(--space-2);     /* 8px */
  --spacing-3: var(--space-3);     /* 12px */
  --spacing-4: var(--space-4);     /* 16px */
  --spacing-5: var(--space-5);     /* 20px */
  --spacing-6: var(--space-6);     /* 24px */
  --spacing-8: var(--space-8);     /* 32px */
  --spacing-10: var(--space-10);   /* 40px */
  --spacing-12: var(--space-12);   /* 48px */
  --spacing-16: var(--space-16);   /* 64px */
  --spacing-24: var(--space-24);   /* 96px */

  /* QA r6a — Shadow tokens */
  --shadow-1: var(--shadow-1);
  --shadow-2: var(--shadow-2);
  --shadow-hair: var(--shadow-hair);
```

- [ ] **Step 2:** Confirm build still compiles.

```bash
cd frontend && npm run build 2>&1 | tail -10
```

- [ ] **Step 3:** Verify `text-h2` / `spacing-3` / `shadow-1` utilities now resolve. Inspect the generated CSS at `frontend/.next/static/css/*.css` after build — search for `.text-h2`, `.gap-3`, `.shadow-1`.

- [ ] **Step 4:** Commit + PR.

```bash
git checkout -b qa/ui-remediation-r6a-theme-wiring feature/deployment
git add frontend/src/app/globals.css
git commit -m "qa(ui): remediation r6a — wire @theme spacing+typography+shadow tokens"
git push -u origin qa/ui-remediation-r6a-theme-wiring
```

This sub-PR is foundational and additive — no codemod yet, no ESLint rule yet. Existing utilities continue working. Verifies the wiring lands cleanly before any consumer migration.

### Sub-PR 6b: Decompose `--amber-500` + reconcile lime/forest/gold (Day 8-10)

**Files:**
- Modify: `frontend/src/styles/design-tokens.css` (add `--warn`, `--stale`, `--ai` tokens)
- Modify: `frontend/src/app/globals.css` `@theme inline` (expose new color tokens)
- Modify: ~50 component sites currently using `text-amber` / `bg-amber/N` (codemod by semantic intent)
- Modify: `frontend/src/app/login/_login/LoginForm.tsx` (Sign in button → gold)
- Modify: `frontend/src/components/auth/AuthProductFrame.tsx` (CTAs → gold)
- Modify: `frontend/src/components/composites/OrderBar.tsx` (BUY/SELL → segmented control)

- [ ] **Step 1:** Add new amber-decomposed tokens.

```css
:root {  /* dark theme */
  --warn-500: #d9a441;        /* keep current amber as warn */
  --stale-500: #bd9551;       /* desaturated for stale-data */
  --ai-500: #8db3c4;          /* alias to existing --ice-500 */
}
.light {
  --warn-500: #9a6f20;
  --stale-500: #876527;
  --ai-500: #436f86;
}
```

Wire into `@theme`:
```css
--color-warn: var(--warn-500);
--color-stale: var(--stale-500);
--color-ai: var(--ai-500);
```

- [ ] **Step 2:** Codemod amber consumers by intent. For each `text-amber` / `bg-amber/N` site, classify:
  - "Stale data" / "Quote freshness" → `text-stale` / `bg-stale/N`
  - "AI-generated content marker" → `text-ai` / `bg-ai/N`
  - "Action-required warning" → keep `text-warn` (rename utility)
  - "Time-of-day badge (BMO/AMC/DMT)" → drop color, use `text-fg-muted`

Use grep + manual triage:
```bash
grep -rn 'text-amber\|bg-amber' frontend/src --include='*.tsx' | head -50
```

- [ ] **Step 3:** Adopt frontend-design taste decision for BUY/SELL: replace OrderBar's saturated buttons with segmented control (per §0). New component or inline:

```tsx
<div role="radiogroup" aria-label="Order side" className="flex border border-border-hair rounded-sm overflow-hidden">
  <button
    type="button"
    role="radio"
    aria-checked={side === "buy"}
    onClick={() => setSide("buy")}
    className={cn(
      "flex items-center gap-2 px-4 py-2 text-[13px]",
      side === "buy"
        ? "bg-bg-elev-2 border border-up-500/40 text-fg"
        : "bg-transparent text-fg-muted hover:text-fg"
    )}
  >
    <span className={cn("size-1.5 rounded-full", side === "buy" ? "bg-up-500" : "bg-transparent border border-fg-muted")} />
    BUY
  </button>
  <button … same pattern for SELL with --down-500 dot … />
</div>
```

- [ ] **Step 4:** Login Sign in button → gold. Replace forest `#0f7a5d` background with `bg-brand` (or `bg-gold-500`):

```diff
- className="bg-[#0f7a5d] hover:bg-[#0d654d] text-white …"
+ className="bg-brand hover:bg-gold-300 text-primary-foreground border border-gold-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_1px_2px_rgba(0,0,0,0.08)] …"
```

- [ ] **Step 5:** Repeat for `AuthProductFrame` CTAs and any other forest-CTA site (grep `#0f7a5d` exhaustively).

- [ ] **Step 6:** Typecheck + tests + visual diff via harness.

### Sub-PR 6c: ESLint guards (Day 11)

**Files:**
- Modify: `frontend/eslint.config.mjs` (or wherever the ESLint config lives)
- Modify: `frontend/package.json` if new plugin needed

- [ ] **Step 1:** Add a custom rule (Tailwind-specific) banning arbitrary spacing + arbitrary text size.

```js
// frontend/eslint.config.mjs
{
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "Literal[value=/\\b(p|m|gap|space|w|h)[xtylbr]?-\\[[0-9]+px\\]/]",
        message: "Use --space-* tokens (gap-3, p-4) instead of arbitrary [Npx] spacing. See qa/reviews/UI-REMEDIATION-PLAN.md §0.",
      },
      {
        selector: "Literal[value=/\\btext-\\[[0-9]+px\\]/]",
        message: "Use --fs-* tokens (text-h2, text-body) instead of arbitrary [Npx] sizes. See qa/reviews/UI-REMEDIATION-PLAN.md §0.",
      },
    ],
  },
}
```

- [ ] **Step 2:** Run ESLint to count current violations.

```bash
cd frontend && npx eslint src/ 2>&1 | tail -20
```

- [ ] **Step 3:** Codemod or manually fix the existing violations. For typography, the wired `--text-*` utilities now resolve (`text-body-sm` instead of `text-[13px]`).

- [ ] **Step 4:** When violations are 0, change the rule from "error" to "warn" → "error" can land in the lint config permanently.

- [ ] **Step 5:** PR + merge + deploy.

### Sub-PR 6d: Shared `<EmptyState>` primitive + 5 site migrations (Day 12-13)

**Files:**
- Create: `frontend/src/components/primitives/EmptyState.tsx`
- Migrate 5 existing empty states.

- [ ] **Step 1:** Build the primitive.

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export default function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-md border border-border-hair bg-bg-elev-1/40 px-6 py-12 text-center",
        className
      )}
    >
      {icon && <div className="text-fg-muted">{icon}</div>}
      <h3 className="text-h3 font-display italic text-fg">{title}</h3>
      {description && (
        <p className="max-w-[42ch] text-body-sm text-fg-muted">{description}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-brand px-3 py-2 text-body-sm font-semibold text-primary-foreground hover:bg-gold-300"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** Migrate 5 sites:
  1. `EarningsCalendarSidebar` empty (no events for window)
  2. `EquityPanel` "Not enough data for equity curve"
  3. `/alerts` empty band
  4. `/pipeline` "Pipeline has not yet run today"
  5. `strategies/momentum-quality` flat dark page (the new visual hierarchy slot from BUG-04 follow-on)

For each, replace the bespoke composition with `<EmptyState title="…" description="…" action={…} />`.

- [ ] **Step 3:** Typecheck + ship.

---

## Verification + Rollback Strategy

After every sub-PR deploy:

```bash
# Re-run the canonical harness sweep against prod
ALPHADESK_TEST_USER=admin ALPHADESK_TEST_PASS=<pass> \
  node qa/harness/run-all.mjs --base=https://tradingalpha.net

# Compare against the audit-canonical run (qa/runs/2026-05-04T02-58-02Z) — diff per route:
diff <(jq -r '.results[].name' qa/runs/2026-05-04T02-58-02Z/manifest.json | sort -u) \
     <(jq -r '.results[].name' qa/runs/<latest>/manifest.json | sort -u)
# Expected: identical route list

# Spot-check changed routes' previews
sips -Z 1800 qa/runs/<latest>/<spec>/<viewport>/initial.png --out /tmp/preview.png
# Visual check: is the change as designed?
```

If a sub-PR causes a regression that the harness catches, roll back via `gh workflow run deploy.yml --ref feature/deployment -f image_sha=<previous-good-SHA>`.

## Self-Review (per skill instructions)

**Spec coverage:** Every BUG-NN from `qa/reviews/UI-REVIEW.md` Top 10 + remaining BLOCKERs has at least one task: BUG-01 (Task 1.1), BUG-02 (Task 5.4), BUG-03 (Sub-PR 6b Step 4-5), BUG-04 (Tasks 2.1-2.3), BUG-05 (Tasks 3.1-3.2), BUG-06 (Task 1.8), BUG-07 (Task 4.3), BUG-08 (Sub-PR 6b — partial; remaining marketing-shell hex sweep deferred per the design-system "freeze as light-mode-only" decision in §0), BUG-09 destructive (Task 4.2), BUG-09 chrome (Tasks 5.1-5.4), BUG-10 (Task 4.4), BUG-11 (Task 1.10), BUG-12 (NOT addressed — `/docs` rewrite is content work; flag as Sprint 2), BUG-13 (Task 1.2), BUG-14 (Task 1.3), BUG-15 (Task 1.4), BUG-16 (Task 1.5), BUG-17 (Task 1.6), BUG-18 (Task 1.7), BUG-19 (Sub-PR 6c), BUG-20 (Sub-PR 6c), BUG-21 (Task 1.9). **Gap acknowledged:** BUG-12 `/docs` rewrite is deferred — content rewrite needs a writing pass, not a UI fix.

**Placeholder scan:** All steps have actual code or commands. Some sub-PR 6b tasks rely on per-site triage which is a manual pass — that's intentional (the codemod can't auto-classify amber semantics without human judgment).

**Type consistency:** `<DestructiveConfirmModal>` props match between Task 4.1 (definition) and Task 4.2 (consumers). `<CalendarWeekHeatmap>` props match between Task 2.2 (definition) and Task 2.3 (consumer).

---

## Execution Handoff

**Plan complete and saved to `qa/reviews/UI-REMEDIATION-PLAN.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for the mechanical PRs (1, 2, 3, 4) where each task is well-bounded.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Best for the systemic PRs (5, 6) where context across tasks matters.

**My recommendation:** PRs 1-4 via subagent-driven (fastest, lowest blast radius per task). PR 5 + 6 via inline (the chrome collapse + theme wiring need cross-file judgment that benefits from full context). Total: ~2 weeks calendar (1 week for PRs 1-5 if dispatched aggressively, 1 week for the 6a-6d sequence with verification gates between each sub-PR).

**Which approach?**
