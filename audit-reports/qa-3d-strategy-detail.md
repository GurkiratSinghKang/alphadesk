# QA review: /strategies/momentum-quality
Run: 2026-04-18T15-43-20Z

## Summary
The editorial layout is correct — hero, status row, §01 Signal, §02 Performance, §03 Positions, §04 References, §05 Limitations all render with the right copy, italic-serif voice, and academic citations (Jegadeesh-Titman, Piotroski, Daniel-Moskowitz, Asness-Frazzini-Pedersen are all present in the DOM; see `bottom.dom.html`). **But the entire hero metric plate is fabricated as em-dashes: Sharpe, MDD, CAGR, and Hit rate all render "—" despite the OOS loader being wired up in `strategies.py`.** The performance endpoint returns 200 but hard-codes `sharpe_ratio=0, max_drawdown=0` in its response literal (line 1251-1252), overwriting the OOS values `_reload_oos_metrics` had already merged into `_STRATEGIES`. The frontend then applies `formatOrDash` which converts `0` to "—", so the user sees a page that looks broken even though the data file is on disk. All 3 manifest step failures (hover, click, click) are caused by an unrelated dashboard onboarding dialog (`role="dialog"` "Welcome to AlphaDesk!") that intercepts every pointer event on the site, not by strategy-page specific bugs. Equity curve is correctly empty ("Not enough data") because the ledger has no trades — that's honest.

Artifact references below cite lines from `qa/runs/2026-04-18T15-43-20Z/strategy-momentum-quality/desktop-1440/`. `initial.dom.html` is 0 bytes (harness snapshot race, not a page bug) so I used `bottom.dom.html` (52 KB, captured after full render) for all DOM claims.

## Section-by-section review

### Hero + metric plate
- **Sharpe**: observed "—" vs expected 2.21 — BROKEN (P0).
- **Max DD**: observed "—" vs expected 8.0% — BROKEN (P0).
- **CAGR**: observed "—" vs expected +36.2% — BROKEN (P0).
- **Hit rate**: observed "—" vs expected 77.5% — BROKEN (P0). Frontend derives this from closed trades; with zero trades in the ledger this correctly falls to dash, but OOS hit_rate is also available server-side and unused.
- Name renders correctly as `<h1 class="t-display-lg">Cross-Sectional Momentum + Quality</h1>` (italic Newsreader via `.t-display-lg`, verified in `design-tokens.css:178-186`).
- Eyebrow reads "STRATEGY · FUNDAMENTAL / EVENT-DRIVEN" — correct.
- Description line "Long-only cross-sectional momentum + quality (Jegadeesh-Titman 12-1 momentum + Piotroski F-score). Top-N composite rank, monthly rebalance." — correct.

### Status row (active/paused + actions)
- RegimePill renders "ACTIVE" — correct.
- Last trade: "—" — honest (no ledger entries).
- Pause button is present (`bottom.dom.html` has one `>Pause<` occurrence). Click fails because a full-screen modal dialog intercepts events (not a page bug).
- "View trades →" primary button is present.

### § 01 Signal
Renders correctly. Thesis is the Wave-D rewrite with real references: "Jegadeesh-Titman (1993)", "Piotroski (2000)", "Daniel & Moskowitz (2016)", "Asness, Frazzini & Pedersen (2019)", "Barroso & Santa-Clara 2015". Edge callout present. Numbered "How it works" list (01..05) present. This section is the best part of the page.

### § 02 Performance
Renders the empty state: "Not enough data for equity curve." — honest given no real trades. Range radio-group is not emitted because the equity-panel's empty branch returns a placeholder `<div>` (see `EquityPanel.tsx:53-66`). That matches the test plan's "empty state" expectation. Note: DOM search for `role="radiogroup"` = 0, `role="radio"` = 0, because the early-return skips the group.

### § 03 Positions
Empty state renders correctly: "No positions open. / Positions will appear here when the strategy next enters a trade." Italic-serif, centered in a bordered card — matches `PositionsSection.tsx:37-52`.

### § 04 References
All four expected citations present. Rendered in italic-serif 13.5px as per test plan. Verified in DOM text extraction.

### § 05 Known limitations
Amber-bulleted limitations list is present (22 occurrences of `font-display italic` in bottom.dom.html, confirming editorial styling across all sections).

## Failed manifest steps — root cause
All three failures share one root cause, **not a strategy-page defect**:

- **hover on `[data-testid^=metric-chip], [data-chip=metric], [role=note]`**: no such selector exists. `StrategyHero.tsx` emits a bare `<dl>` / `<dt>` / `<dd>` (lines 66-91); there's no `data-testid`, `data-chip`, or `role=note`. **Verdict: brittle selector / missing testids.** The chips have no hover micro-interaction either, so even with a correct selector the test would be asserting nothing meaningful.
- **click on `button:has-text('1M'), [data-range='1M']`**: 1M button isn't in the DOM because the equity panel is in its empty-state branch (`data.length < 2`). **Verdict: legitimate empty-state gating, but the harness doesn't know that.** Also no `data-range` attribute exists in `EquityPanel.tsx` — brittle selector.
- **click on `button:has-text('Pause'), [data-testid=strategy-pause]`**: the Pause button IS in the DOM and visible, but the onboarding modal (`role="dialog"` "Welcome to AlphaDesk!" with `absolute inset-0 bg-black/60` backdrop) intercepts the click. The Playwright error log explicitly names this intercept. **Verdict: app-wide bug that also blocks clicks on `/`, `/settings`, and every other authenticated page in this run.**

## Findings

### [P0] Hero metric plate always shows em-dashes despite OOS data being loaded
**Where:** `backend/api/routes/strategies.py:1241-1256` (`get_strategy_performance` response), `audit-reports/phase1-momentum_quality-oos.json`, `qa/runs/.../bottom.dom.html`.
**Evidence:** The performance response literal on line 1251-1252 hard-codes `sharpe_ratio=0, max_drawdown=0`. `_reload_oos_metrics()` (line 684-688) correctly populates `_STRATEGIES["momentum-quality"]["sharpe_ratio"] = 2.2087` from the JSON on disk, but the route never reads those back — it just rebuilds the `StrategyPerformance` dataclass fresh. Bottom DOM shows four `<dd><span class="...text-fg-hint">—</span></dd>` — rendered via `formatOrDash`'s `value === 0 → em-dash` branch in `page.tsx:101-104`.
**What:** The entire OOS data pipeline on iter-4 is wasted — the file is loaded, parsed, merged into an in-memory dict, and then discarded. Every Phase 1 strategy page will show the same placeholder.
**Fix:** Change lines 1251-1252 to `sharpe_ratio=data.get("sharpe_ratio"), max_drawdown=data.get("max_drawdown")`. Add `cagr` and `hit_rate` to the `StrategyPerformance` response model. Prefer the OOS CAGR over `_annualized_return(return_pct)` when the ledger has <10 trades.

### [P0] Onboarding modal blocks every click across the authenticated app
**Where:** Not in `_strategy/*.tsx` — parent `(dashboard)` layout or a top-level provider. Manifest errors on dashboard, settings, and this page all name `<div role="dialog" aria-modal="true">` containing "Welcome to AlphaDesk!".
**Evidence:** `bottom.dom.html` contains `<div class="fixed inset-0 z-[100]" aria-modal="true" role="dialog"><div class="absolute inset-0"><div class="absolute inset-0 bg-black/60 transition-all duration-300"></div></div>...`. Three separate spec failures (`dashboard.click`, `strategy.pause-click`, plus `settings.click-every` in the same run) are all caused by this backdrop intercepting pointer events.
**What:** The tour dialog renders unconditionally on every page load (or the "dismiss" flag isn't being persisted). Users who've seen it once still see it every visit.
**Fix:** Investigate the tour-gate boolean (likely localStorage key not checked before render). Until then, every e2e test run will produce spurious interaction failures.

### [P1] No `data-testid` on metric chips, ranges, or Pause
**Where:** `StrategyHero.tsx`, `EquityPanel.tsx`, `page.tsx:338-358`.
**Evidence:** DOM grep for `data-testid` on the page returns nothing for the strategy-specific widgets. Harness falls back to fragile `:has-text()` selectors.
**What:** Brittle tests. Already caused at least 2 of 3 manifest failures to be hard to diagnose.
**Fix:** Add `data-testid="metric-chip"` to each hero `<div>` in the `<dl>`, `data-testid="range-1M"` etc. on range buttons, `data-testid="strategy-pause"` on the Pause button (it's already referenced as a fallback selector in the manifest).

### [P1] Metric chips have no hover affordance
**Where:** `StrategyHero.tsx:70-88` — each cell is a plain `<div>` with no `:hover` styling, no tooltip, no cursor change.
**Evidence:** The manifest "metric-hover" snapshot is byte-identical to initial (same file size 1,584,119).
**What:** Test plan implies metrics are explorable ("hover" step exists), but nothing happens on hover. Acceptable, but inconsistent with the harness' expectation.
**Fix:** Either (a) drop the hover step from the test, or (b) add a tooltip/popover on each metric ("OOS 2023-2024 walk-forward" etc.) per `design-critique` instincts.

### [P1] Range buttons lack `data-range` attribute
**Where:** `EquityPanel.tsx:123-140`.
**Evidence:** Only `<button role="radio">` with text content. Harness selector `[data-range='1M']` never matches.
**Fix:** Add `data-range={r}` to each `<button>` — 1-line change.

### [P1] Empty equity-curve state shows no range group, so "1M" click always fails here
**Where:** `EquityPanel.tsx:53-66`.
**Evidence:** Early return renders just a placeholder div; range group only renders when `data.length >= 2`.
**What:** Correct behavior, but the test plan's `§02 Performance` section enumerates "Range buttons 1M/3M/YTD/1Y/All must be clickable buttons". With no trades there's nothing to filter, so the buttons are legitimately hidden.
**Fix:** Document in the test plan that range-group is gated on data. Alternatively, render disabled range buttons in the empty state for UI continuity.

### [P1] "Last trade" em-dash even though `last_trade_date` could be sourced from OOS `end`
**Where:** `page.tsx:332-334` reads `perf?.last_trade_date` which the API returns as `""` (line 1227 default) → `formatLastTrade` returns "—".
**Evidence:** Bottom DOM shows "Last trade —".
**What:** The OOS file has `"end": "2024-12-30"`; we could at least show a backtested last-trade marker.
**Fix:** When live ledger has zero trades, fall back to the OOS `end` date and label it "Last OOS trade" to avoid implying a real trade happened.

### [P1] `win_rate=-1.0` default is a sentinel leaked to frontend as a number
**Where:** `strategies.py:1214, 1250`.
**Evidence:** When no trades exist, `win_rate` defaults to `-1.0`. The Pydantic model accepts float; the frontend doesn't consume `win_rate` on this page (uses derived `hitRate`), but any consumer that does will mis-render.
**Fix:** Use `win_rate: float | None = None`, not `-1.0`.

### [P2] Hero description duplicated between route-registry `description` and Phase-2 `content.thesis`
**Where:** `strategies.py:135` vs `strategy-content.ts`.
**Evidence:** Same content appears once as the italic-serif subline under the H1, and again as the long paragraph in §01 Signal opening.
**What:** Feels slightly redundant; acceptable for a "tl;dr vs deep-dive" pattern but worth a design review.
**Fix:** Consider shortening the hero description to one sentence (strip the parenthetical) so §01 can own the full thesis.

### [P2] Breadcrumb shows "Dashboard" but routes to `/` desk, which is also labeled "Dashboard"
**Where:** `page.tsx:306-312`. Working as designed, minor UX polish.
**Fix:** Consider "← Strategies" or a distinct back link once a `/strategies` index page exists.

### [P2] `benchmark fetch` runs even in empty equity state, wasting a request
**Where:** `page.tsx:186-204`.
**Evidence:** The `useEffect` has `perf.equity_curve.length < 2` guard, so no waste here — actually safe. Retracted from list but keeping as a "what's good" note below.
**Fix:** N/A.

### [P2] `getBars("SPY", "D", perf.equity_curve.length + 5)` calls backend even when private data missing
**Where:** Same as above; also verified the network log shows no SPY-bars request during this run because equity_curve was empty. Safe.

### [P2] `statusRegime("idle")` falls through to neutral/elevated but label "idle" leaks uppercased
**Where:** `page.tsx:138-142`, `328`.
**Evidence:** If status ever comes back as `"idle"` it renders as `"IDLE"`. Not user-facing today (backend always returns `active`/`paused`), but surface area.
**Fix:** Explicitly map "idle" → "IDLE" or reject unknown states.

### [P2] `@/lib/strategy-content.ts` is the single source for references for only 3 strategies
**Where:** `page.tsx:56-73` hardcodes `ACADEMIC_SOURCES` inline rather than pulling from `strategy-content.ts` or registry metadata.
**Evidence:** Inline dict limited to 3 entries. Other 9 Phase-1 strategies will silently omit §04.
**Fix:** Move to `strategy-content.ts` `references: string[]` per strategy so §04 is co-located with §01 content.

### [P2] Console logs file is missing from the run artifacts
**Where:** `qa/runs/.../strategy-momentum-quality/desktop-1440/`.
**Evidence:** `ls` shows no `*console*` file, though the manifest claims `"console": "console.jsonl"` per snapshot. Cannot assess React warnings or library errors.
**Fix:** Harness bug, out of scope for this page review — flag to test infra.

### [P3] `initial.dom.html` is 0 bytes
**Where:** `qa/runs/.../strategy-momentum-quality/desktop-1440/initial.dom.html`.
**Evidence:** `wc -l` shows 0 lines / 0 bytes, but `initial.png` exists.
**What:** Harness captured the screenshot before the DOM serialized. Not a page bug; later snapshots (bottom, chart-1m, scrolled-mid) are all 52 KB and intact.
**Fix:** Harness infra.

## What's good
- Editorial voice nailed: italic Newsreader H1, tracked-caps eyebrow, §01/§02/§03/§04/§05 section rules all render and match the test plan.
- Academic references are real citations with authors and years — no Lorem Ipsum, no hallucinated Russell 1992.
- Thesis section pulls the Wave-D rewrite cleanly and includes honest calibration language ("treat the achieved OOS number as a regime-specific upside, not a long-run expectation").
- Empty states are honest: no fabricated equity curve, no fake positions.
- Color palette clean — no raw hex, `text-profit`/`text-loss` tokens only.

## Portability note
**The [P0] "hero metric plate em-dashes" finding applies to all 12 Phase-1 strategies, not just momentum-quality.** The route `get_strategy_performance` (`strategies.py:1241-1256`) is shared; every strategy hits the same hard-coded `sharpe_ratio=0, max_drawdown=0` response. I'd expect PEAD, VRP Harvesting, earnings-vol-premium, regime-adaptive, and the other Phase-1 strategies to show identical em-dash hero plates. **One backend fix — read `data["sharpe_ratio"]`/`data["max_drawdown"]`/add `cagr` and `hit_rate` to the response model — lights up all 12 pages.** The [P0] onboarding modal also affects every authenticated page in the app, not just this one. The [P1] missing `data-testid`s also need to be added uniformly if the harness is to meaningfully test the other 11.
