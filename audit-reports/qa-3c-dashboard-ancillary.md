# QA review: analytics / pipeline / reports / alerts / settings
Run: 2026-04-18T15-43-20Z

## Summary
- **/analytics** — Header + layout correct; `§ ANALYTICS` + "Portfolio analytics" render (`analytics/desktop-1440/initial.dom.html` @ 1 hit). The known red/green hex regression is **still present** in the shipped DOM (`rgba(239,68,68,0.15)` + stroke `#ef4444` emitted from DrawdownChart). Hardcoded `$100,000` equity baseline also still in source (`frontend/src/app/(dashboard)/analytics/page.tsx:24, 35, 86`).
- **/pipeline** — Header correct, all four flow cards render, empty-state copy ("Details not available — counts only.") present — iter-2 fix verified. No synthesized stock-N rows in DOM.
- **/reports** — All 3 SectionCards render (`Portfolio Statement`, `Strategy Performance Report`, `Tax Report (Simplified)`); chevrons work (source uses `ChevronDown`/`ChevronRight` toggle). `aria-expanded` is missing on the SectionCard button — confirmed against `reports/page.tsx:64-71`.
- **/alerts** — Header + CreateAlertForm render; empty-state ("No active alerts" + "Create one above to get started") correctly shown. The `hover` step failure is a **harness selector bug**, not a UI bug — see below.
- **/settings** — All 8 panels render (Trading Mode, API Keys, Notifications, Display, Data Refresh, Export, Security, PerformanceMetrics). 7 `role="switch"` buttons present; Live/Paper toggle correct.

## Per-page findings

### /analytics
#### [P1] Hardcoded red/green hex in DrawdownChart — `qa/runs/2026-04-18T15-43-20Z/analytics/desktop-1440/initial.dom.html` @ idx 17328 emits `fill="rgba(239,68,68,0.15)"` and `stroke="#ef4444"` — fix: replace with `var(--down-500)` (frontend source `frontend/src/app/(dashboard)/analytics/page.tsx:194, 196, 277, 306, 307`). ReturnDistribution + MonthlyHeatmap also hardcode `rgba(34,197,94,...)` / `rgba(239,68,68,...)`. iter-1-frontend.md flagged; still un-fixed.
#### [P2] `$100,000` synthetic equity baseline — `frontend/src/app/(dashboard)/analytics/page.tsx:24, 35, 86` use `100000 + cumulative_pnl` for daily return / drawdown / monthly return math. Test plan acknowledges this as "acceptable — same convention as backtests" but it is still a fabricated number surfaced to the user. Fix: derive baseline from first equity-curve point instead.
#### [P3] Charts lack aria descriptions — page-level aria-labels/`<title>` on SVGs absent (source inspection). Low-priority a11y gap noted in test plan §Accessibility.

### /pipeline
#### [OK] Empty state renders as specified — `qa/runs/2026-04-18T15-43-20Z/pipeline/desktop-1440/initial.dom.html` contains "Details not available — counts only." (count=1). No synthetic `stock-N` / `{strat}-{i}` placeholders in DOM. `mapPipelineRun` iter-2 fix verified.
#### [P3] History rows not keyboard-focusable — `frontend/src/app/(dashboard)/pipeline/page.tsx:601-608` uses `onClick` on `<TableRow>` without `role="button" tabIndex={0}`. Test plan calls this out; still unaddressed.
#### [P3] Risk Monitor toggle missing `aria-pressed` — `frontend/src/app/(dashboard)/pipeline/page.tsx:163-176` is a `<button>` with only `title` for state announcement.

### /reports
#### [P2] SectionCard `<button>` missing `aria-expanded` — `frontend/src/app/(dashboard)/reports/page.tsx:64-71`. Three collapsible sections rely on chevron icon alone; SRs can't announce state. Fix: add `aria-expanded={open}` on the button.
#### [OK] All 3 cards render — `qa/runs/2026-04-18T15-43-20Z/reports/desktop-1440/initial.dom.html` contains "Portfolio Statement" (×2 including CSV button), "Strategy Performance Report" (×1), "Tax Report (Simplified)" (×1).
#### [OK] No hex / no synthetic rows — grep for `#[0-9a-fA-F]{3,6}` on `reports/desktop-1440/initial.dom.html` returns 0 hits.

### /alerts
#### [PX-HARNESS] Hover step failure is a harness selector bug, not a UI bug — manifest step `hover: waiting for locator('[data-testid^=alert-row], li')` timed out 10s. The DOM (`alerts/desktop-1440/initial.dom.html`) renders the empty state ("No active alerts", "Create one above to get started") correctly because the test account has zero alerts. There are no `<li>` elements and no `data-testid="alert-row-*"` attribute anywhere in the page (source `frontend/src/app/(dashboard)/alerts/page.tsx:174-246` renders `<div>` rows, not `<li>`, and adds no `data-testid`). Recommendation: either add `data-testid="alert-row"` to AlertRow's root div for deterministic testing, or update harness to gracefully skip hover when zero alerts exist.
#### [OK] CreateAlertForm rendered — `alert-symbol` and `alert-price` IDs each present (×2 each including label htmlFor).
#### [P3] Condition toggle lacks `role="radiogroup"` — `alerts/page.tsx:96-121` uses two `<button>`s, test plan §Accessibility flags gap.

### /settings
#### [OK] All 8 panels render — `settings/desktop-1440/initial.dom.html` contains Trading Mode (×1), API Keys (×1), Notifications (×2), Display toggles, Data Refresh (×1), Export Data (×1), Security (×1), PerformanceMetrics. 7 `role="switch"` buttons.
#### [OK] Live/Paper coral/chartreuse toggle — test-plan-accepted exception; verified in source `frontend/src/app/(dashboard)/settings/page.tsx:336-340` uses `bg-loss/80` (coral) + `bg-profit/60` (chartreuse) not classic red/green.
#### [P3] SegmentPicker + IntervalSlider wrappers missing `role="radiogroup"` — `settings/page.tsx:86, 133`. Test plan §Accessibility.
#### [OK] No raw hex, no fake data — 0 hex hits on settings DOM.

## Cross-cutting
- **Pages with hardcoded hex colors:** only `/analytics` (`rgba(239,68,68,...)`, `rgba(34,197,94,...)`, `#ef4444` — confirmed in DOM and source). Pipeline, reports, alerts, settings DOMs clean.
- **Pages with missing aria-\***: `/reports` (SectionCard lacks `aria-expanded`), `/pipeline` (Risk Monitor lacks `aria-pressed`, history rows lack `role="button"`), `/alerts` (condition toggle lacks `role="radiogroup"`), `/settings` (SegmentPicker + IntervalSlider lack `role="radiogroup"`).
- **Pages with fake-data residue:** `/analytics` hardcodes `$100,000` starting equity. All other pages render live-API-derived values or empty states; no synthesized rows anywhere.
- **Network:** 0 × 4xx/5xx across all five pages (per `network.jsonl` scan). APIs hit as expected: analytics→`/portfolio/performance`+`/trades/history`, pipeline→`/pipeline/*`+`/strategies/admin/risk-monitor`, reports→`/portfolio/summary`+`/trades/*`+`/strategies/`, alerts→`/trades/alerts`, settings→none of its own (PerformanceMetrics only calls shared `/market-overview/regime`).
- **Console:** no `console.jsonl` files produced by this harness run — cannot audit JS errors/warnings for these 5 pages.

## What's good
- `var(--panel)` / `var(--surface)` aliases successfully resolved — no invisible panels in any `initial.png` artifact (confirmed by DOM containing rendered content, not transparent skeleton).
- Pipeline empty state ("Details not available — counts only.", "No closed trades yet…", "No pipeline history available yet") is semantically honest — no fabricated rows.
- Settings Live/Paper toggle uses token-based `bg-loss`/`bg-profit` (chartreuse/coral) not legacy red/green.
- All 5 pages render correct `DashboardPageLayout` eyebrow (`§ X`) + italic-serif title on first paint (each `§` appears ×3 in DOM: eyebrow + TopBar nav ×2).
- Zero network errors across 326 total requests in scope.
