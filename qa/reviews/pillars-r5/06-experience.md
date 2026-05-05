# Pillar 6 — Experience Design (R5 adversarial fresh hunt)

**Score: 2/4**  (R1: 2/4, R2: 3/4, R3: 3/4, R4: 4/4 → **regressing to 2/4**)
**Run:** `qa/runs/2026-05-04T20-31-40Z` (baseUrl `https://tradingalpha.net`)
**Audited:** 2026-05-04
**Stance:** FORCE — fresh hunt, treat the R4 4/4 as a hypothesis to be falsified, not a fact. Verify every R4 closure against the rendered DOM and the source tree at HEAD.

---

## Methodology

1. Walked all 24 specs of the canonical sweep × 2 viewports. Read `console.jsonl` and `network.jsonl` for every spec that emitted a `level:"error"` or a `4xx`/`5xx` response (7 console-error files, 11 network-error files).
2. Re-grepped the source tree to confirm R4's three big closures (W-3 OCC banner, W-6 broker-disable, N-5 TradePanel `aria-live`). Specifically, **read the W-3 wiring branch-by-branch** to see whether the closure covered both deep-link shapes or only one.
3. Cross-referenced the live capture against the new code that landed since R4 (commit `db9f79d3` shipped `sector_rotation` strategy backend; `bc37a59b` merged the deployment branch; PR #28-31 were the R4 sprint commits). Looked for surfaces where backend ≠ frontend metadata.
4. Confirmed `error.tsx` peer count and tested whether the marketing/auth shells inherit a real boundary or just the global one.
5. Audited skip-to-content link presence at every dom capture (12 surfaces × initial state) — not just the dashboard.
6. Audited `aria-live` coverage on every "live numeric" composite the R4 review claimed contracts on — `ContextBar`, `PriceChartPanel`, `OrderBook`, `TickerStrip`, `PositionsList`, `StatusStrip`. R4 explicitly claimed the *pattern* generalises; verified per-composite.
7. Verified that the R4-NEW-N1 finding (dashboard `PositionsList` aria-live gap) was not closed in any commit between R4 (e5fc1e9e, 2026-05-04 morning) and HEAD.
8. Spot-checked the multi-leg trade ticket DOM against its `network.jsonl` to see whether the silent OCC-404 fallback the R4-W-3 fix supposedly closed actually fires when there are multiple legs in flight.
9. The "`/strategies/sector_rotation`" probe in the prompt is a red herring — no such frontend route exists; PR #32 ships the backend strategy package only and the frontend metadata claims it's "planned." Confirmed and downgraded.

---

## NEW findings (severity-tagged)

### NEW BLOCKER (R5-1) — multi-leg ticket silently substitutes underlying quote when option contracts 404; no banner, no readiness gate

This is the same class of silent-degradation bug R4-5 W-3 was supposed to close — except it was only closed for the **single-leg** case.

Verified end-to-end across the live sweep:

- `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/network.jsonl` — both legs of the staged strangle 404'd:
  - `404 GET /api/v1/market/quotes/NVDA260424P00200000` at `20:43:08.273Z`
  - `404 GET /api/v1/market/quotes/NVDA260424C00220000` at `20:43:08.281Z`
  Same shape on `…/trade/mobile-390/network.jsonl` (`20:43:41.173Z`, `20:43:41.190Z`).
- `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html` — `grep -c 'data-slot="order-bar-options-unavailable"'` returns **0**. Same on mobile-390.
- The DOM's order ticket renders **`Two-sided quote live · spread $0.06 · 0.03%`** with `Buy bid $197.84 / Buy mid $197.87 / Sell mid $197.87 / Sell ask $197.90` — those are the **underlying NVDA prices** (last $197.86), not the option leg quotes. The trader sees the underlying micro-spread (~3 bp) dressed as their leg spread. There is no amber banner, no warning, no Retry button, no "Options data unavailable" copy — exactly the pre-R4 silent fallback that W-3 was supposed to fix.

The bug lives in `frontend/src/app/(dashboard)/trade/page.tsx:386-416`:

```typescript
.then((snapshot) => {
  …
  if (activeContract && !snapshot[activeContract.occ]) {
    setOptionsUnavailable({ occ: activeContract.occ, underlying: activeContract.symbol });
  } else {
    setOptionsUnavailable(null);
  }
})
.catch(() => {
  if (activeContract) {                                      // ← ONLY single-leg path
    setOptionsUnavailable({ occ: activeContract.occ, … });
  }
});
```

The success branch checks `activeContract` only; the catch branch checks `activeContract` only. `activeLegs[]` (the multi-leg deep-link state) is never inspected for missing OCCs. `OrderBar`'s `optionsUnavailable` prop type is `{ occ: string; underlying: string } | null` (singular) — there is no API surface to even *report* a multi-leg failure.

Why this is a BLOCKER for execution UX (lifting from R4-W-3 framing):
- R4-W-3 closed because the trader was making decisions based on `--` telemetry and a silently-substituted underlying. The R4 close-rationale literally cited *"the trader is no longer staring at '--' telemetry with no explanation."*
- The multi-leg case is **strictly worse** than the single-leg case the closure addressed: a strangle/iron-condor stages multiple legs by definition, has multiple ways to fail (one leg available, one missing; or both missing — the captured case), and the user is making a more sophisticated trade with tighter risk parameters. The synthetic "spread $0.06" on the underlying reads as a *tight, executable* multi-leg combo — when the truth is the option market for those strikes is unknown. A trader could plausibly hit Submit on what they think is a $0.06 strangle that is actually a $0.50+ market.
- The R4 closure created a uniform banner pattern. Multi-leg silently sidesteps it. Pillar 6's "single mental model" rationale (R4 score-justification: *"any irreversible action → DestructiveConfirmModal; any zero-data state → EmptyState; any continuous numeric stream → aria-live"*) is broken precisely because the sibling code path went uncovered.

**Files to fix:**
- `frontend/src/app/(dashboard)/trade/page.tsx:386-416` — extend the snapshot-result check to `activeLegs.filter(l => !snapshot[l.occ])`.
- `frontend/src/components/composites/OrderBar.tsx:67-74,468-491` — broaden `optionsUnavailable` to `{ occs: string[]; underlying: string }` (or pass an array of `{occ,underlying}` rows).
- Add an explicit readiness gate: if any staged leg's quote is missing, the ticket's "Execution readiness · Review" pill should **not** read green. Currently it does (verified in `multi-leg-prefill.dom.html`: ticket shows `2 passed checks` despite the two leg 404s).

### NEW BLOCKER (R5-2) — `sector-rotation` ships ACTIVE in backend, renders "in development · not yet implemented" in catalog and detail page

The single biggest UX trust-break in this sweep. The backend strategy package landed (commit `db9f79d3`, PR #32, 2026-05-04 15:38 UTC), and the API correctly serves it as ACTIVE — but every frontend surface still describes it as planned/coming-soon vapor-ware.

Backend (truth): `backend/api/routes/strategies.py:368-384` —
```python
"sector-rotation": {
    "name": "Sector Rotation",
    "description": "Long-only monthly rotation across 11 GICS sector ETFs … Stangl-Jacobsen-Visaltanachoti (2009) + Faber (2013) bond-fallback overlay.",
    # Plan C.5: backend strategy package landed; status is now ACTIVE.
    "status": StrategyStatus.ACTIVE,
    …
}
```

Frontend (stale, contradictory):

1. `frontend/src/lib/strategies.ts:135-142` —
   ```typescript
   "sector-rotation": {
     name: "Sector Rotation Model",
     …
     stage: "planned",   // ← still claims planned
   },
   ```
2. `frontend/src/lib/strategy-content.ts:399-401` —
   > *"Sector Rotation is a planned catalogue concept, not an implemented AlphaDesk backend strategy yet. No backend package ranks sector ETFs, maintains monthly rebalance state, emits orders, or ships a checked-in OOS artifact. The intended design is a liquid ETF sleeve…"*
   The thesis prose then continues for two more paragraphs explaining what would need to be built — all of which ships in `backend/strategies/sector_rotation/`. `parameters.maxPositions: "0 live; target 3 after implementation"`. `whenToUse: "Future use case: … Not active today; the rebalance engine, risk-off rule, and OOS evidence must be built first."`
3. The bucketing logic at `frontend/src/app/(dashboard)/strategies/page.tsx:130-142` short-circuits on `s.stage === "planned"` returning `"coming_soon"` *before* it ever consults `apiStatus`. So even if the API hands back `status: "active"` — which it now does — the UI demotes the row to coming-soon based on the static manifest.

E2E-confirmed in the live capture: `qa/runs/2026-05-04T20-31-40Z/strategies-list/desktop-1440/initial.dom.html` renders the row with `data-stage="planned"` and `aria-label="Sector Rotation Model — in development. Not yet implemented."`, then the body copy reads *"This strategy will become tradable once the Python package lands under `backend/strategies/`."* — which **is the description of a state that no longer exists.** The Python package landed.

**Why this is a BLOCKER for Pillar 6:**
- Pillar 1 (copywriting) flagged a related copy issue this round; Pillar 6 owns the experiential trust contract. The catalog promises a strategy, ships the strategy in the backend, then tells the user it doesn't exist. A user who reads the thesis and decides "ok, I'll wait for it" never goes back, even though the thing they were waiting for is shipped and running its monthly rebalance via `pipeline_runner.py`.
- The detail-page route (`/strategies/sector-rotation`) still resolves and still serves the "Not live. Target design: …" parameter set at `strategy-content.ts:409-416`. So a user who navigates *to* the active strategy from a future external link sees a page describing it as not-yet-built.
- This is the second time in three sprints a backend ships ahead of the frontend metadata (the first was `claude-alpha`, fixed retroactively). The pattern is structural: any new strategy needs three coordinated edits (`strategies.py` backend, `strategies.ts` manifest, `strategy-content.ts` thesis). PR #32 made the first edit only. The lack of a guard (e.g., a dev-only `__tests__/strategies.consistency.test.ts` that diffs the backend status against the manifest stage) is a Pillar 6 process gap.

**Files to fix:**
- `frontend/src/lib/strategies.ts:141` — drop `stage: "planned"` so it falls through to the API-driven `apiStatus === "active"` branch in `bucketFor()`.
- `frontend/src/lib/strategy-content.ts:399-435` — rewrite the thesis as a real ACTIVE-strategy entry mirroring `dual-momentum` / `momentum-quality`. Reference the actual ETFs (XLK/XLV/XLF/…), the actual academic sources (Stangl-Jacobsen-Visaltanachoti 2009, Faber 2013 — already in the backend's `spec.md`), the actual rebalance cadence (monthly EOM 3:55 PM ET per `pipeline_runner.py`).
- Add a regression test that asserts every `STRATEGY_META[id].stage !== "planned"` whenever the corresponding backend `StrategyStatus !== PLANNED`. Catches PR-32-class drift before it ships.

### NEW MAJOR (R5-3) — skip-to-content link is ABSENT on every public-facing surface (login, marketing pages); WCAG 2.4.1 contract violated for the user's first authenticated touchpoint

R3 made an explicit WCAG 2.4.1 commitment. The dashboard layout honours it. The marketing/auth shells **do not.**

Source-side audit — `grep -n "Skip to content" frontend/src/components/layouts/MarketingShell.tsx frontend/src/components/auth/AuthProductFrame.tsx` returns **0 hits in both files**. The dashboard layout at `frontend/src/app/(dashboard)/layout.tsx:257-269,306` carries the only skip-link emission.

E2E-confirmed: counted `Skip to content` occurrences across `initial.dom.html` for 12 surfaces in the canonical sweep:

| Surface | Skip link present | Shell |
|---|---|---|
| `/` (dashboard) | **1** | `(dashboard)/layout.tsx` |
| `/trade` | **1** | `(dashboard)/layout.tsx` |
| `/login` | **0** ❌ | `AuthProductFrame` |
| `/login/reset` | 1 ✓ | (different shell — uses `(dashboard)/layout.tsx` inheritance) |
| `/about` | **0** ❌ | `MarketingShell` |
| `/privacy` | **0** ❌ | `MarketingShell` |
| `/terms` | **0** ❌ | `MarketingShell` |
| `/risk` | **0** ❌ | `MarketingShell` |
| `/docs` | **0** ❌ | `MarketingShell` |
| `/contact` | **0** ❌ | `MarketingShell` |
| `/request-access` | **0** ❌ | `AuthProductFrame` |

Why this is MAJOR (one promotion shy of BLOCKER):
- `/login` is the **first authenticated touch** for a keyboard user. After landing, Tab moves through (a) the AD logo link, (b) "Sign in" nav pill, (c) "Request access" nav pill, (d) primary CTA, (e) password-form heading link, before reaching the username `<input>`. That's 5+ Tab presses to reach the form on every page load. WCAG 2.4.1 exists exactly to fix this.
- The marketing pages are long-form articles (privacy, terms, risk, docs are ~3000+ words each — Pillar 5 just confirmed this). Without a skip link, a keyboard user reading `/privacy` after navigating from the footer hits the entire 4-link top nav + 2 CTAs every time they tab back and forth.
- The dashboard shell got this right after R3. The marketing/auth shells were never updated. R4 audited 24 specs but only confirmed the skip link on the dashboard surfaces it sampled — the marketing surfaces were never tested for skip-link presence.

Not a BLOCKER because there's a workaround (the form fields themselves can be reached by Tab, just slowly), and `tabindex` on the `<form>` elements means a power user can land on inputs eventually. But this is the most-trafficked entry point (login) and the most-cited a11y contract (WCAG 2.4.1) the team explicitly committed to in R3.

**Files to fix:**
- `frontend/src/components/layouts/MarketingShell.tsx:80-132` — add the same `<a href="#main-content" className="sr-only focus:not-sr-only …">` pattern as `(dashboard)/layout.tsx:267-271`. Wrap children in `<main id="main-content">`.
- `frontend/src/components/auth/AuthProductFrame.tsx:93` — same edit. Currently `<main>` has no `id`; the panel content has `<section id="auth-panel">` (used by the secondary CTA's `#auth-panel` href) but no peer skip target.

### NEW MAJOR (R5-4) — three of the five hero "live" composites have no `aria-live` despite R4 promising the pattern generalised

R4 closed N-5 by adding `aria-live="polite" aria-atomic="false" aria-relevant="text"` to the **TradePanel PositionsTab** (right rail of /trade). The score-justification claimed:

> *"the single mental model — `DestructiveConfirmModal` for any irreversible action, `EmptyState` (or composite-local equivalent) with a recovery CTA for any zero-data state, **`aria-live` on any continuous numeric stream** — generalises to future surfaces without ad-hoc patterns."*

Audited the actual composite tree. Pattern did **not** generalise:

| Composite | Live numeric content | `aria-live`? | Where SR users miss the announcement |
|---|---|---|---|
| `panels/TradePanel.tsx:790-807` | Right-rail position rows on /trade | **YES** ✓ | (R4 fix) |
| `composites/ContextBar.tsx` | **The dashboard's hero P&L (28 px gold mono)** + 3 metric cells | **NO** ❌ | The single most-watched number on the dashboard |
| `composites/PriceChartPanel.tsx:194-208` | Last price + change + change-pct in the chart header | **NO** ❌ | The hero last price on /trade and dashboard |
| `composites/PositionsList.tsx:225-309` | Dashboard "Book" panel rows — entry/PnL/PnL%/sparklines | **NO** ❌ | (R4-NEW-N1 — still open, see below) |
| `layout/StatusStrip.tsx:66-72` | Day P&L in the bottom strip | YES ✓ | OK |
| `composites/OrderBar.tsx:471` | Only on the W-3 unavailable banner | partial | live bid/ask preview is *not* announced |
| `composites/TickerStrip.tsx:51` | Scrolling ticker | `aria-live="off"` (correct — by design) | OK |

The three NO rows are the most prominent live numbers in the app:

1. **`ContextBar`** is the dashboard's editorial hero — Round-8 specifically promoted the first cell to a 28 px gold display so it would be *the* focal point. SR users on `/` get told a number once at hydration and then nothing; the StatusStrip's day-P&L `aria-live` covers a sibling number on a different visual hierarchy (smaller, monochrome, in the chrome). The hero P&L itself is silent.
2. **`PriceChartPanel`** is the chart-card hero on `/trade` and the dashboard's price card. The 32-pt last price tick and ±change line at lines 194-208 of `PriceChartPanel.tsx` have no live region. Inline `aria-live="polite"` exists only at line 1527 of `ChartPane.tsx` (the chart canvas tooltip) — different element entirely.
3. **`PositionsList`** is R4-NEW-N1 — flagged by R4 itself as the lowest-friction next edit, never landed.

This isn't a single-NIT issue — three of the four "hero numeric" composites are silent. The R4 close-rationale specifically promised the pattern was a "single mental model" that "generalises to future surfaces without ad-hoc patterns." That promise didn't hold across the existing surfaces, let alone future ones.

**Files to fix (3-line edit per composite, identical to the TradePanel pattern):**
- `frontend/src/components/composites/ContextBar.tsx:55-87` — wrap the hero-cell `<div className="flex gap-2 items-baseline">` (or just the `<b>` value) with `aria-live="polite" aria-atomic="false" aria-relevant="text"`. Apply at minimum to the `cell.emphasis` cell.
- `frontend/src/components/composites/PriceChartPanel.tsx:193-209` — wrap the price + change `<div className="flex items-baseline gap-2">` block. The `last.toFixed(2)` text is the announcement target.
- `frontend/src/components/composites/PositionsList.tsx:237-308` — wrap each `<tbody>`. Closes R4-NEW-N1 too.

### NEW MAJOR (R5-5) — execution-readiness pill goes green on multi-leg ticket even when both legs failed to fetch quotes

Tightly coupled to R5-1 and worth calling out separately because the readiness pill is the user's **last-line-of-defense visual gate** before clicking Submit.

In `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html`, the ticket's "Execution readiness · Review" pill counts `2 passed checks` even though `network.jsonl` shows both staged legs returned 404. The text in the DOM:

> *"Review · 2 legs strangle submits canonical legs together; 0 related positions found. 2 passed c[hecks]"*

The check-count logic in `frontend/src/app/(dashboard)/trade/page.tsx` derives readiness from the ticket draft state, not from "did we successfully fetch quotes for every staged OCC." So a multi-leg ticket where the option market is silent (R5-1) is still rendered green-light to submit. Combined with R5-1's silent underlying-substitution, this is a **two-failure-mode compound risk**: the price the user sees is a substitute, AND the readiness gate is permissive.

This is downstream of R5-1 — fixing R5-1 (extend `optionsUnavailable` to `legs[]`) gives the readiness gate the signal to demote. But it's worth verifying the gate actually demotes once R5-1 ships.

### NEW WARNING (R5-6) — `OnboardingTour` `setTimeout(1500)` × 3 still has no `prefers-reduced-motion` short-circuit; W-5 carry-over R4 left as NIT is now a regression risk

R4 noted W-5 was unchanged. Re-confirmed at HEAD: `frontend/src/components/layout/OnboardingTour.tsx:110, 118, 144` all still hardcode `setTimeout(() => setActive(true), 1500)`. `grep -n "matchMedia\|prefers-reduced\|motion-reduce" frontend/src/components/layout/OnboardingTour.tsx` returns **0** matches.

Why upgrading from NIT to WARNING for R5: the tour now runs **three** times in the worst case for a fresh-login flow:
- L:110 — RUN_AFTER_LOGIN sessionStorage path → 1500 ms wait → activate
- L:118 — `alreadyCompleted` false fallthrough → 1500 ms wait → activate
- L:144 — `alphadesk:auth-login-success` event handler → 1500 ms wait → activate

Each of those is a separate effect. They all fire on the same login. A user with `prefers-reduced-motion: reduce` set (which AlphaDesk's CSS at `globals.css:702,741` honours globally) waits 1.5 s × N for a tour they didn't ask for and that has no perceptual reason to be delayed (the 1500 ms exists to let mount-targets settle). Reduce-motion users get an extra-bad experience because the tour overlay then *itself* uses CSS animations on the spotlight — which the global rule kills, leaving an awkward blink-on with no animated guide.

**Fix:**
- Read `window.matchMedia('(prefers-reduced-motion: reduce)').matches` at effect setup.
- If true, drop the delay to 0 (or skip the tour entirely — the most-cited UX guidance for reduced-motion + onboarding is "skip optional motion-driven affordances").
- Consolidate the three `setTimeout(...)` into a single helper.

### NEW NIT (R5-7) — `DestructiveConfirmModal` "Confirming…" text-only loading state mirrors OrderBar `Submitting…` (R4-N3) — same accessibility/perception issue, same fix

`frontend/src/components/destructive/DestructiveConfirmModal.tsx:55-57`:

```tsx
<Button variant="destructive" onClick={onConfirm} disabled={loading}>
  {loading ? "Confirming…" : confirmLabel}
</Button>
```

No `Loader2` glyph, no `aria-busy={loading}`, no spinner. The OrderBar version (R4-N3, carried forward from R3) has the same shape. Both buttons are pressed during a 600-800 ms broker round-trip that reads as "frozen" without a glyph.

This is a NIT (one font-aware Lucide icon import + one prop). It promotes to WARNING the next round if the destructive-action surface gains higher-frequency usage (e.g., bulk cancel-all on the order book).

### NEW NIT (R5-8) — `/help/earnings-data` has no peer `error.tsx`; falls through to root `app/error.tsx`

`find frontend/src/app -name 'error.tsx'` returns the same **12 files** R4 counted, all under `(dashboard)`. The `/help/earnings-data` route at `frontend/src/app/help/earnings-data/page.tsx` is on the *public* tree (not under `(dashboard)`), so its error fallthrough is `frontend/src/app/error.tsx` — the editorial `DashboardErrorPage` with `route="app"` and headline `"Something broke on the desk"`.

That's a generic copy. The dashboard-tree error.tsx files use `surface={…}` to inject the route name into the headline (`"Earnings calendar hit a snag"`-style). The `/help/earnings-data` page is a documentation surface — if it errors, the user sees a trade-desk-voiced error on a help page. Voice mismatch.

NIT, not a BLOCKER, because (a) errors on a docs page are rare and (b) the user can recover via the marketing footer / TopBar.

**Fix:** add `frontend/src/app/help/earnings-data/error.tsx` with the editorial `DashboardError` and `surface="Help · Earnings data"` headline. Or refactor to inherit from a `(public)` route group with a peer error.tsx.

---

## STILL CLOSED (R1-R4 closures verified again under R5)

- **B-1 SW offline-shell hijack on /trade.** All 8 trade DOMs are full Next.js shells: byte sizes range 95,528–102,269 (vs ~91-line offline fallback). `grep -c 'AlphaDesk is offline'` across all 8 = **0**. `sw.js:83-91` `/trade*` short-circuit unchanged.
- **B-2 Earnings empty detail pane.** `detail-header-title` present in 10/10 earnings-options-play DOMs (initial, scrolled-mid, bottom, row-selected, status-hover × 2 viewports). `isFirstPaintRef` branch unchanged in `earnings-options-play/page.tsx:199,213-221`.
- **B-3 Destructive-action consistency.** `grep -rn 'window\.confirm' frontend/src` → **0**. `grep -on 'useDestructiveAction' frontend/src -r` → **19** sites (was 13 in R4 — additional adoption shipped in the auth/login-reset and analytics surfaces). Single mental model holds.
- **B-4 Per-route `error.tsx`.** `find frontend/src/app -name 'error.tsx'` → **12** files. Same 12 R4 counted; all delegate to `<DashboardErrorPage>` with a `surface` prop. (R5-8 above is a *public-tree* gap, not a regression on the dashboard count.)
- **W-3 (single-leg branch only) closed.** `single-leg-prefill.dom.html` desktop+mobile both contain `data-slot="order-bar-options-unavailable"` with the live banner text and Retry button. The closure stands for the single-leg case. (R5-1 is the multi-leg sibling that was missed — not a regression on the closed branch.)
- **W-6 broker-disable migration.** `settings/page.tsx:398-412` uses `useDestructiveAction`. No `window.confirm` survives.
- **N-5 TradePanel `aria-live`.** `TradePanel.tsx:790-807` wrapper present. All trade DOMs contain exactly 1 `aria-live="polite"` region (the new wrapper).
- **R4 PR #28 empty-state recovery actions.** Verified at source: `PnlAttribution.tsx:54-75`, `LiveSignalFeed.tsx:464-477`, `ActivityFeed.tsx:362-369`, `StrategyGrid.tsx:263-272`, `NotificationCenter.tsx:211-221` — all unchanged. Empty states still offer recovery CTAs.

## STILL CARRIED OVER as NIT (no change since R4)

- **N-3 OrderBar `Submitting…` text-only.** Unchanged. Lifted partner-finding R5-7 above (same shape on DestructiveConfirmModal).
- **N-4 Toast position eye-jump.** Not in capture set this round.
- **N-6 Pipeline empty-state next-run time.** `pipeline/page.tsx:171` headline still threadless.
- **W-1 Watchlist per-symbol fan-out.** Confirmed: 20 individual `/api/v1/market/quotes/{sym}` requests on `dashboard/desktop-1440/network.jsonl`. Backend/Pillar 4 issue.
- **NEW-G1 visual-regression CI non-blocking.** Unchanged.

---

## Console / network error inventory (this sweep)

For full audit transparency:

| Spec / viewport | console errors | network 4xx/5xx | Disposition |
|---|---|---|---|
| `_design/desktop-1440` | 1 | 1 (404 `/_design`) | **EXPECTED** — `app/_design/page.tsx:8` calls `notFound()` in production by design; QA contract at `qa/harness/tests/design.mjs:3-4` documents this. Not a bug. |
| `not-found/{both}` | 1 | 1 (404 the harness URL) | EXPECTED — that's the not-found probe. |
| `login/{both}` | 1 | 1 (401 `/api/v1/auth/login`) | EXPECTED — the harness submits a probe-credential to verify auth surfacing. |
| `trade/{both}` | 3 each | 3 each (404 OCC quotes) | **R5-1**: surfaces correctly via banner only on single-leg; multi-leg is silent. |

No unexplained errors. The CSP-violation `level:"info"` lines are noise (report-only policy testing).

---

## What's working — preserve under refactor

- **`<DestructiveConfirmModal>` + `useDestructiveAction`** — 19 adopters, single mental model, focus-trapped via Base UI Dialog. The pattern itself is the right shape; just needs spinner-glyph polish (R5-7).
- **`<EmptyState>` primitive + recovery-action sweep** — 5 dashboard composites + the primitive consumers. Pattern holds.
- **`StatusStrip` `aria-live="polite" aria-atomic="true"`** — correct combo for the day-P&L tabular value. The model R5-4 wants the other 3 hero composites to follow.
- **Cmd+K palette is discoverable** — visible "Search ⌘K" button in `TopBar.tsx:39-58`, OS-aware label (`Mac` → `⌘K`, else `Ctrl+K`), reachable on dashboard + trade desktop, mobile shows the icon-only entry. Tour step 4 surfaces the shortcut. No regression.
- **`/trade?symbol=NVDA` deep-linking** — `useSearchParams` reads on mount, `commitSymbolDraft()` at `trade/page.tsx:434-454` calls `router.push('/trade?symbol=…')` on user typing-then-Enter. URL stays in sync. Back-button safe.
- **`SW` /trade short-circuit, B-1 fix.** Holds.
- **`error.tsx` editorial voice** with `surface` prop and `digest` reference. Holds in the 12 dashboard-tree boundaries.
- **Login form a11y hints** — `autoComplete="username"`, `autoComplete="current-password"`, `autoComplete="one-time-code"`, `autoFocus` on the right field, `aria-invalid` on error. Solid form-UX baseline.
- **`prefers-reduced-motion` global CSS.** `globals.css:702,741` honours system preference; the auth shell's inline `<style>` block at `AuthProductFrame.tsx:103-110` echoes the same kill-switch for its keyframes.

---

## Score justification

**Pillar score: 2/4 — needs revision.** The R4 4/4 was awarded on three closures and an empty-state-recovery sweep. Three R5-class issues falsify the rationale:

1. **R5-1** — the W-3 closure that R4 cited as proof of "the trader is no longer staring at silent telemetry" is uncovered for the multi-leg deep-link, which is the more-sophisticated/risky case. The same root failure mode (silent OCC-404 fallback to underlying) still ships in production for any strangle, iron-condor, or vertical-spread URL. This is execution-quality UX, not polish.
2. **R5-2** — `sector-rotation` ships a real backend strategy that the frontend renders as "in development · not yet implemented." A user reading the catalog or detail page sees vapor-ware copy on a working strategy. This is exactly the trust-break that Pillar 6 is supposed to prevent — the interface lies about the system's state.
3. **R5-4** — three of the four "hero numeric" composites (ContextBar P&L, PriceChartPanel last price, PositionsList rows) have no `aria-live` despite R4's score-justification explicitly promising the pattern *generalises*. The most-watched numbers in the app are silent for SR users.

R5-3 (skip-link) and R5-5 (readiness pill goes green on failed legs) round out the major findings. R5-6/7/8 are NITs.

Two structural patterns emerge:
- **Closures aren't validated symmetrically.** W-3 closed for `activeContract` but not `activeLegs` — the very file housing both shapes was edited without auditing both. R4-NEW-N1 was acknowledged in PR #30's notes as a follow-up; nobody scheduled it. Sector-rotation backend shipped without a peer frontend metadata edit.
- **Hero-class promises don't propagate.** The aria-live "single mental model" claim was made on the basis of one composite. The other three composites it should have applied to weren't touched. A future surface added today would inherit the gap, not the pattern.

To get back to 4/4 the team needs:
- (R5-1) Extend W-3 to multi-leg legs[]. ~30 LOC across `trade/page.tsx` and `OrderBar.tsx`.
- (R5-2) Drop `stage:"planned"` from sector-rotation in `lib/strategies.ts`. Rewrite the thesis in `lib/strategy-content.ts` to match the shipped backend. Add a regression test that diffs static manifest vs API-served status.
- (R5-3) Add the skip-link to `MarketingShell.tsx` and `AuthProductFrame.tsx`. ~5 LOC each.
- (R5-4) Apply the TradePanel `aria-live` pattern to ContextBar, PriceChartPanel, PositionsList. 3 × 3-line edits.
- (R5-5) Demote the readiness pill when any staged leg's quote is missing (falls out of R5-1 fix).

- BLOCKERs (NEW): **2** (R5-1 multi-leg silent fallback, R5-2 sector-rotation metadata mismatch)
- MAJORs (NEW): **3** (R5-3 skip-link gap on public surfaces, R5-4 aria-live pattern didn't generalise, R5-5 readiness pill permissive on failed legs)
- WARNINGs (NEW): **1** (R5-6 OnboardingTour reduced-motion)
- NITs (NEW): **2** (R5-7 modal Confirming… text-only, R5-8 /help/earnings-data missing peer error.tsx)
- NITs carried over: 5 (N-3, N-4, N-6, W-1, NEW-G1)
- BLOCKERs from R1-R4 still closed: 4 (B-1, B-2, B-3, B-4)
- Items resolved this sprint vs R4: **0** (R4 sprint shipped; nothing between R4 audit and R5 audit fixed any of the new findings — the R4-NEW-N1 PositionsList aria-live was not addressed)

---

## Files referenced

- `frontend/src/app/(dashboard)/trade/page.tsx:386-416` (R5-1 — W-3 multi-leg sibling unhandled)
- `frontend/src/components/composites/OrderBar.tsx:67-74,468-491` (R5-1 — banner shape singular only)
- `backend/api/routes/strategies.py:368-384` (R5-2 — backend ACTIVE truth)
- `frontend/src/lib/strategies.ts:135-142` (R5-2 — frontend stale `stage:"planned"`)
- `frontend/src/lib/strategy-content.ts:399-435` (R5-2 — stale "not implemented" thesis)
- `frontend/src/app/(dashboard)/strategies/page.tsx:130-142` (R5-2 — bucketing short-circuits on stale stage)
- `frontend/src/components/layouts/MarketingShell.tsx:80-132` (R5-3 — no skip link)
- `frontend/src/components/auth/AuthProductFrame.tsx:93` (R5-3 — no skip link)
- `frontend/src/components/composites/ContextBar.tsx:55-87` (R5-4 — hero P&L silent)
- `frontend/src/components/composites/PriceChartPanel.tsx:194-208` (R5-4 — last price silent)
- `frontend/src/components/composites/PositionsList.tsx:225-309` (R5-4 / R4-NEW-N1 carryover — dashboard rows silent)
- `frontend/src/components/layout/OnboardingTour.tsx:110,118,144` (R5-6 — three timeouts, no reduced-motion check)
- `frontend/src/components/destructive/DestructiveConfirmModal.tsx:55-57` (R5-7 — text-only loading)
- `frontend/src/app/help/earnings-data/page.tsx` + missing peer `error.tsx` (R5-8)

## Screenshots & evidence

- `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.dom.html` — 0 OCC-unavailable banners despite 2 leg-quote 404s; ticket renders `Two-sided quote live · spread $0.06 · 0.03%` using NVDA underlying. Same on `…/trade/mobile-390/multi-leg-prefill.dom.html`. (R5-1)
- `qa/runs/2026-05-04T20-31-40Z/trade/{desktop-1440,mobile-390}/network.jsonl` — both legs 404; both viewports.
- `qa/runs/2026-05-04T20-31-40Z/strategies-list/desktop-1440/initial.dom.html` — `data-stage="planned" aria-label="Sector Rotation Model — in development. Not yet implemented."` plus body copy *"This strategy will become tradable once the Python package lands under `backend/strategies/`."* — package landed in PR #32. (R5-2)
- Skip-link audit: 7/12 surfaces missing the link (login, about, privacy, terms, docs, risk, contact, request-access) — only dashboard-tree routes carry it. (R5-3)
- `aria-live` audit at source: ContextBar 0, PriceChartPanel 0, OrderBar 1 (banner only), PositionsList 0, TickerStrip 1 (`off`), StatusStrip 3, TradePanel 1. (R5-4)
- `git log --since="R4 audit"` — no commits to `composites/PositionsList.tsx`, `composites/ContextBar.tsx`, `composites/PriceChartPanel.tsx`, `layout/OnboardingTour.tsx`. R4 carry-overs unaddressed.
