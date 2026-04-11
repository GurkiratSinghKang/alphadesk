# AlphaDesk Performance & Accessibility Audit

**Date:** 2026-04-10
**Auditor:** Automated + Manual Source Code Review
**App:** AlphaDesk Trading Platform (https://tradingalpha.net)
**Pages Audited:** / (Dashboard), /trade, /pipeline, /strategies/pead
**Automation Script:** `/qa-perf-a11y.mjs` (run with `node qa-perf-a11y.mjs`)

---

## Executive Summary

| Area | Score | Verdict |
|------|-------|---------|
| Page Load Performance | 6/10 | Acceptable, but no code splitting |
| Rendering Efficiency | 7/10 | Good use of useMemo; some issues |
| Bundle Optimization | 5/10 | No dynamic imports, no lazy loading |
| Network Efficiency | 7/10 | Parallel fetches, but no caching layer |
| Layout Stability (CLS) | 8/10 | Generally stable, minor shift risk |
| Color Contrast | 3/10 | **FAIL** -- #555 on #0a0a0f fails WCAG AA |
| Keyboard Accessibility | 5/10 | Partial -- trade page has gaps |
| Screen Reader Support | 4/10 | Missing landmarks, heading hierarchy broken |
| Focus Management | 4/10 | Focus indicators only on base UI components |
| Form Accessibility | 5/10 | Labels present on login, missing on trade forms |
| Image Accessibility | 9/10 | No `<img>` tags used; SVGs marked aria-hidden |
| **Overall** | **5.5/10** | Needs accessibility remediation |

---

## PART 1: PERFORMANCE AUDIT

### 1.1 Page Load & Data Fetching -- Score: 6/10

**Findings:**

- **Dashboard (page.tsx):** Fires 8 parallel API calls via `Promise.allSettled` (good pattern) plus a sequential 9th call to `/api/v1/portfolio/performance`. The sequential call adds unnecessary latency.
  - File: `/frontend/src/app/(dashboard)/page.tsx`, lines 74-94, then 202-222
  - The extra `fetch()` at line 204 should be included in the initial `Promise.allSettled` batch.

- **PositionsSummary.tsx:** Fires its own independent `getPositions()` call (line 11) even though position data is already partially available from the portfolio summary. This is a duplicated network request.

- **PnlCalendarMini.tsx:** Fires another independent `getPnlCalendar()` call (line 14). Three child components each making their own API calls means the dashboard issues 11+ network requests on mount.

- **Pipeline page:** Uses `Promise.allSettled` for 3 calls (good), but then issues another sequential call to `getPipelineRun(today)` at line 133.

- **No HTTP caching headers observed in code** -- no SWR, React Query, or stale-while-revalidate patterns. Every page navigation triggers fresh API calls.

**Recommendations:**
1. Include the `/portfolio/performance` fetch in the main `Promise.allSettled` batch on the dashboard.
2. Lift `getPositions()` and `getPnlCalendar()` calls into the parent `CommandCenter` component and pass data as props, or use a shared data store with cache TTL.
3. Adopt `swr` or `@tanstack/react-query` for automatic request deduplication and background revalidation.
4. Add `Cache-Control` headers to backend API responses for market data that doesn't change within a polling interval.

### 1.2 Rendering Efficiency -- Score: 7/10

**Findings:**

- **Good:** `useMemo` is used for sparkline data derivation (page.tsx line 243), equity curve filtering (PortfolioHero.tsx line 117), and treemap layout (SectorTreemap.tsx line 177).

- **Good:** `useCallback` used properly for event handlers in TradePage and PipelinePage.

- **Issue: Unnecessary mounting pattern.** Dashboard uses a `mounted` state guard (page.tsx lines 41-51) that forces a double render -- first the loading placeholder, then the actual `CommandCenter`. This is a common hydration-safety pattern but adds a blank flash.

- **Issue: Strategy sparkline regeneration.** In StrategyGrid.tsx (line 165), `generateSparkData()` is called inline during render for each strategy card. The seed is deterministic so the output is stable, but the computation runs on every render cycle. This should be memoized.

- **Issue: SectorTreemap.tsx** uses a `ResizeObserver` that calls `setMeasuredWidth()` on every resize event. This triggers a full re-render and treemap recalculation (squarify algorithm) on every frame during resize. Should debounce the resize callback.

- **Issue: TradingChart.tsx** recreates the entire chart (lines 179-309) when `chartType` changes. This is necessary for the chart library but the effect cleanup could be more efficient -- it currently orphans overlay series references before cleanup.

- **Issue: Global CSS transition rule.** `globals.css` lines 286-291 apply `transition-property: color, background-color, border-color, box-shadow, opacity` to ALL elements (`*, *::before, *::after`). While `transition-duration: 0ms` is set as default, this still forces the browser to set up transition tracking on every DOM element, which is a paint performance tax on complex pages like the dashboard with 500+ elements.

**Recommendations:**
1. Memoize `generateSparkData` calls in StrategyCard with `useMemo`.
2. Debounce the ResizeObserver callback in SectorTreemap (100ms minimum).
3. Remove the global `*` transition rule. Apply transitions only to elements that need them (buttons, links, cards).
4. Consider `React.memo()` for pure display components like `FeedItemRow`, `StrategyCard`, and `WatchlistRow`.

### 1.3 Bundle Size & Code Splitting -- Score: 5/10

**Findings:**

- **No dynamic imports anywhere.** `next/dynamic` and `React.lazy()` are not used in the codebase (confirmed via grep). This means:
  - The TradingChart component (lightweight-charts library, ~80KB gzipped) is loaded on every page, even pages that don't use it.
  - The OptionsPanel, AnalysisPanel, and TradePanel components are bundled together even though they are only used on `/trade`.
  - The full set of lucide-react icons is likely tree-shaken but individual imports still create module overhead.

- **next.config.ts is minimal** -- no `experimental.optimizePackageImports`, no bundle analyzer, no custom webpack config for chunking.

- **Font loading is optimized** (good) -- `Inter` and `JetBrains_Mono` use `next/font/google` with `display: "swap"` and `subsets: ["latin"]`. This prevents FOIT.

- **No image optimization needed** -- the app uses no `<img>` tags, only SVG-based charts and icons. This is actually a performance win.

**Recommendations:**
1. Use `next/dynamic` for heavy page-specific components:
   ```js
   const TradingChart = dynamic(() => import("@/components/charts/TradingChart"), { ssr: false });
   const OptionsPanel = dynamic(() => import("@/components/panels/OptionsPanel"));
   ```
2. Add `experimental: { optimizePackageImports: ["lucide-react"] }` to next.config.ts.
3. Consider using `@next/bundle-analyzer` to identify the largest chunks.
4. The `lightweight-charts` library should only be loaded on routes that render charts (/trade, /strategies/[id]).

### 1.4 Layout Stability (CLS) -- Score: 8/10

**Findings:**

- **Good:** Loading states are used consistently. Dashboard shows a spinner while data loads (page.tsx lines 253-260), preventing content jumping.

- **Good:** The PortfolioHero has a fixed-height chart strip (`h-[56px]`, line 174), preventing layout shift when the SVG renders.

- **Minor risk:** PnlCalendarMini returns `null` when `days.length === 0` (line 15). This means the grid cell collapses entirely until data loads, then expands. This could cause a visible layout shift if the calendar loads after the positions panel.

- **Minor risk:** PositionsSummary shows a different layout (shorter, no table) when no positions exist vs. when positions load. If positions arrive after initial render, the panel height changes.

**Recommendations:**
1. Add a skeleton/placeholder with fixed height for PnlCalendarMini during loading.
2. Reserve minimum height for PositionsSummary regardless of position count.

### 1.5 Network Efficiency -- Score: 7/10

**Findings:**

- **Good:** Dashboard uses `Promise.allSettled` to fire all API calls in parallel.
- **Good:** WebSocket is used for real-time market data (useWebSocket.ts) rather than polling.
- **Issue:** No request deduplication. If the user navigates away and back to the dashboard, all 11+ API calls fire again from scratch.
- **Issue:** No prefetching. Next.js link prefetching appears to use defaults, but the app uses `router.push()` for navigation rather than `<Link>` components in several places (StrategyGrid onClick, ActivityFeed onNavigate), which bypasses prefetching.

**Recommendations:**
1. Use Next.js `<Link>` for navigable elements instead of `router.push()` to enable automatic prefetching.
2. Implement a data cache layer (React Query / SWR) with a 30-60s TTL for market data.

---

## PART 2: ACCESSIBILITY AUDIT

### 2.1 Color Contrast -- Score: 3/10 -- CRITICAL

**Findings:**

The `text-label` and `text-hint` CSS classes (globals.css lines 258-270) use `color: #555` (effectively `#555555`):

```css
.text-label {
  font-size: 10px;
  color: #555;          /* <-- FAILS WCAG */
}
.text-hint {
  font-size: 11px;
  color: #555;          /* <-- FAILS WCAG */
}
```

Against the background `#0a0a0f`:
- **Calculated contrast ratio: 3.36:1**
- **WCAG AA requires 4.5:1 for normal text, 3:1 for large text**
- **WCAG AAA requires 7:1**
- At 10-11px font size, this text is "small text" and needs 4.5:1 minimum.
- **VERDICT: FAILS WCAG AA**

Additionally, `#555` is used directly in 13+ component files:
- `StatusStrip.tsx` (4 instances) -- status bar labels
- `AnalysisPanel.tsx` (5 instances) -- form labels in trade quick-order
- `ChartPanel.tsx` (1 instance) -- bid/ask spread text
- `pipeline/page.tsx` (1 instance) -- zero-count pipeline stages
- `strategies/[id]/page.tsx` (1 instance) -- empty stat values
- `shortcut-overlay.tsx` (1 instance) -- shortcut footnote
- `ProfileMenu.tsx` (2 instances) -- equity label, trading mode label
- `placeholder.tsx` (1 instance) -- placeholder values

The `muted-foreground` variable (`#71717a`) fares somewhat better:
- Against `#0a0a0f`: contrast ratio = ~4.28:1 -- still marginally below 4.5:1 for AA normal text but passes for large text.

**Recommendations:**
1. **Replace `#555` with `#808080` or brighter** throughout the codebase. `#808080` on `#0a0a0f` gives 4.98:1, passing WCAG AA.
2. Better yet, update the CSS custom properties:
   ```css
   .text-label { color: #8a8a95; }  /* 5.3:1 ratio against #0a0a0f */
   .text-hint { color: #8a8a95; }
   ```
3. Update `--muted-foreground` from `#71717a` to `#7a7a85` (4.63:1 -- passes AA).
4. Use a WCAG contrast checker on every text/background pair in the dark theme.

### 2.2 Missing Alt Text on Images -- Score: 9/10

**Findings:**

- No `<img>` tags are used in the application. All visual elements are SVG-based (charts, sparklines, icons) or CSS-rendered.
- SVGs in PortfolioHero correctly use `aria-hidden="true"` (line 87).
- Lucide icons are decorative and do not need alt text.
- The AllocationDonut SVG (line 34) lacks `aria-hidden` or an accessible label, but it has visible text labels nearby.

**Recommendations:**
1. Add `aria-hidden="true"` to all purely decorative SVGs (sparklines, donut chart).
2. For the AllocationDonut, consider adding `role="img"` and `aria-label="Portfolio allocation: X% cash, Y% invested"`.

### 2.3 Missing ARIA Labels on Interactive Elements -- Score: 5/10

**Findings:**

- **Period toggle buttons** in PortfolioHero (lines 156-169): Buttons have visible text ("1W", "1M", etc.) but no `aria-label` explaining their purpose. A screen reader would announce "1W button" with no context. Should add `aria-label="Show 1 week performance"`.

- **Strategy cards** in StrategyGrid (lines 111-177): Cards use `onClick` for navigation but are rendered as `<Card>` (a div), not `<button>` or `<a>`. They have `cursor-pointer` but no `role="button"`, `tabIndex`, or keyboard handler. **Screen readers and keyboard users cannot interact with these.**

- **Full-screen toggle** in TradePage (line 81): Has a `title` attribute (good) but no `aria-label`.

- **Calendar day cells** in PnlCalendarMini (lines 67-94): Interactive `<div>` elements with `onMouseEnter`/`onMouseLeave` but no keyboard interaction, no `role`, no `aria-label`. **Completely inaccessible to keyboard/screen reader users.**

- **Pipeline history rows** (pipeline/page.tsx): Table rows have `onClick` but no keyboard handler. Not focusable.

- **News links** in MarketContext (line 127): `<a>` tags with proper `target="_blank"` and `rel="noopener noreferrer"` (good), but missing `aria-label` describing the link opens in a new tab.

**Recommendations:**
1. Strategy cards: Add `role="button"`, `tabIndex={0}`, and `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}`.
2. Period buttons: Add `aria-label` and `aria-pressed` for toggle state.
3. Calendar cells: Add `role="button"`, `tabIndex={0}`, keyboard handler, and `aria-label` with the date and P&L.
4. History rows: Make expandable rows keyboard-navigable.
5. External links: Add `aria-label` or visually hidden text indicating "opens in new tab".

### 2.4 Keyboard Navigation -- Score: 5/10

**Findings:**

- **Login page:** Fully keyboard navigable. Tab order is logical (username -> password -> submit). `autoFocus` on username input is good.

- **Dashboard:** Partial. The period toggle buttons are focusable (native `<button>` elements). However:
  - Strategy cards are not focusable (div with onClick only).
  - Calendar cells are not focusable.
  - "Run Pipeline" link in empty activity feed is focusable (good).

- **Trade page:** Has custom keyboard shortcuts (1-8 for timeframes) which is excellent for power users. However:
  - The drag handle for resizing the options panel (line 156) is mouse-only. No keyboard alternative to resize panels.
  - WatchlistPanel rows use `onKeyDown` for keyboard navigation (good).

- **Pipeline page:** History table rows are clickable but not keyboard-focusable. No skip-navigation links.

- **Global:** No skip-to-content link exists. No focus trap management for modals. The CommandPalette (Cmd+K) does handle keyboard (good).

**Recommendations:**
1. Add `tabIndex={0}` and `onKeyDown` handlers to all clickable non-button/non-link elements.
2. Add a skip-to-main-content link at the top of the layout.
3. Provide keyboard alternative for panel resizing (e.g., keyboard shortcut to cycle preset heights).
4. Ensure the shortcut overlay (triggered by `?`) is a proper modal with focus trap.

### 2.5 Screen Reader Compatibility -- Score: 4/10

**Findings:**

**Heading Hierarchy Issues:**

- **Dashboard:** No `<h1>` exists. Section headings are `<h2>` ("Activity Feed", "Strategies", "Open Positions", "April P&L") and `<h3>` ("Market Indices", "Sector Performance", "Headlines"). The jump from no h1 to h2 is a WCAG violation.

- **Pipeline:** Has an `<h1>` ("Trading Pipeline") and properly uses `<h2>` for sections. This is the best-structured page.

- **Strategy detail:** Has an `<h1>` (strategy name), then jumps to `<h3>` for sub-sections ("Strategy Thesis", "Parameters"), skipping `<h2>`. Then uses `<h2>` ("Trade History") later. The hierarchy is inconsistent.

- **Login:** Has an `<h1>` ("AlphaDesk") -- correct.

**Landmark Issues:**
- No `<main>`, `<nav>`, `<aside>`, or `<section>` landmark roles in the dashboard layout.
- The sidebar navigation presumably exists but was not reviewed in detail.
- No `aria-live` regions for dynamic content updates (P&L changes, activity feed updates).

**Other Issues:**
- Numeric values like portfolio value, P&L are not announced with context. A screen reader would hear "$104,523.67" with no indication of what that number represents.
- The equity curve SVG is `aria-hidden` (good), but there is no text alternative describing the trend.

**Recommendations:**
1. Add `<h1>` to the dashboard page (e.g., "AlphaDesk Dashboard" or "Command Center").
2. Fix heading hierarchy on strategy detail page: h1 -> h2 -> h3.
3. Wrap main content in `<main>` with `role="main"`.
4. Add `aria-live="polite"` to the activity feed container for dynamic updates.
5. Add `aria-label` to numeric displays (e.g., `aria-label="Portfolio value: $104,523.67"`).
6. Add visually hidden text as a text alternative for the equity curve trend.

### 2.6 Focus Indicators -- Score: 4/10

**Findings:**

- Base UI components (Button, Input, Tabs) from shadcn/ui include `focus-visible:ring` styles. These provide visible focus rings -- good.

- **Custom interactive elements lack focus indicators entirely:**
  - Strategy cards (StrategyGrid.tsx): No focus styles.
  - Calendar cells (PnlCalendarMini.tsx): No focus styles.
  - Period toggle buttons (PortfolioHero.tsx): No explicit focus styles (rely on browser default, which is invisible on dark backgrounds).
  - Pipeline history rows: No focus styles.
  - Drag handle (TradePage): No focus indicator.

- The global CSS rule at line 146 (`@apply outline-ring/50`) provides a subtle outline via the `ring` variable (#3b82f6 at 50% opacity). This would be visible if elements receive focus, but many custom elements never become focusable.

**Recommendations:**
1. Add `focus-visible:ring-2 focus-visible:ring-primary/50` to all interactive elements.
2. Ensure custom clickable divs receive `tabIndex={0}` so they can be focused.
3. Test by navigating the entire app with Tab key only -- every interactive element must show a visible indicator.

### 2.7 Form Labels -- Score: 5/10

**Findings:**

- **Login page (login/page.tsx):** Labels exist ("Username", "Password") but use `<label>` without `htmlFor`/`for` attribute and without wrapping the input. The labels are visually associated but not programmatically linked. Inputs have `placeholder` which provides a fallback name.

- **Trade page forms:**
  - AnalysisPanel quick-order form (AnalysisPanel.tsx lines 661-718): Labels exist with `<label>` elements and use `text-[#555]` color (contrast issue), but no `htmlFor` linking.
  - TradePanel: No explicit labels on trade builder inputs.
  - WatchlistPanel search input: Has a placeholder but no label.

- **CommandPalette search:** Input has `placeholder="Search stocks, commands..."` but no `<label>`.

**Recommendations:**
1. Add `htmlFor` to all `<label>` elements and matching `id` to inputs.
2. Or wrap each input inside its `<label>` element.
3. For search/filter inputs without visible labels, add `aria-label`.
4. Fix contrast on form labels (replace `#555` -- see section 2.1).

---

## PART 3: SPECIFIC FILE REVIEWS

### 3.1 Dashboard page.tsx -- Performance Review

| Check | Status | Detail |
|-------|--------|--------|
| Unnecessary re-renders | Minor issue | `mounted` state pattern causes double render |
| Memoization | Good | `useMemo` for sparkData (line 243) |
| Data fetching | Issue | Sequential fetch at line 204 should join Promise.allSettled |
| State management | Good | Uses Zustand store for portfolio summary |
| Effect cleanup | Good | Cancellation flag pattern (line 71) |
| Error handling | Good | Promise.allSettled + try/catch |

### 3.2 Dashboard Components -- Heavy Computation Check

| Component | Status | Detail |
|-----------|--------|--------|
| PortfolioHero.tsx | Good | `useMemo` for filtering, SVG is lightweight |
| ActivityFeed.tsx | Good | `buildFeedItems` runs once on data change, not on render |
| StrategyGrid.tsx | Minor issue | `generateSparkData` inline in render (line 165) |
| PositionsSummary.tsx | Issue | Own API call, should receive data as props |
| PnlCalendarMini.tsx | Issue | Own API call + linear search in hover handler (line 86) |
| SectorTreemap.tsx | Minor issue | ResizeObserver not debounced |
| Sparkline.tsx | Good | Lightweight SVG, no heavy computation |
| AllocationDonut.tsx | Good | Simple SVG donut, no heavy math |
| MarketContext.tsx | Good | Pure display component |

### 3.3 TradingChart.tsx -- Chart Rendering Performance

| Check | Status | Detail |
|-------|--------|--------|
| Chart creation | Acceptable | Recreates on `chartType` change (necessary) |
| ResizeObserver | Good | Properly observed and disconnected |
| Indicator computation | Risk | SMA/EMA/Bollinger computed on main thread for full dataset |
| Data mapping | Good | `toChartCandle`, `toLineData` are lightweight |
| Memory cleanup | Good | `chart.remove()` in effect cleanup |
| Series management | Minor issue | `removeSeries` in try/catch suggests timing issues (line 326) |

**Indicator Performance Note:** `computeBollinger` (lines 114-140) has O(n*period) complexity with nested loops. For a dataset of 1000 bars with period 20, this is 20,000 iterations -- acceptable. However, for 10,000+ bars it could cause frame drops. Consider using a Web Worker for large datasets.

---

## PART 4: AUTOMATED TEST SCRIPT

The Playwright audit script has been saved to:
```
/qa-perf-a11y.mjs
```

**To run:**
```bash
cd /Users/GK/Downloads/alphadesk
npx playwright install chromium   # first time only
node qa-perf-a11y.mjs
```

**What it measures per page:**
1. Page load time (navigation to networkidle)
2. DOM element count
3. Time to Interactive (proxy via domInteractive)
4. All loaded JS/CSS resources with byte sizes
5. Total transferred bytes
6. Cumulative Layout Shift (via PerformanceObserver)
7. Total network request count
8. Accessibility checks: missing alt text, unlabeled buttons, unlabeled inputs, heading structure, contrast ratio calculation

**Outputs:**
- Raw JSON: `qa-screenshots/expert-ux/perf-a11y-raw.json`
- Screenshots: `qa-screenshots/expert-ux/perf-*.png`
- Console summary

---

## PART 5: PRIORITY REMEDIATION PLAN

### Critical (Must Fix)

1. **Color contrast: Replace all `#555` with `#8a8a95` or brighter** -- affects readability for all users, not just those with vision impairments. Update `globals.css` `.text-label` and `.text-hint`, then find-and-replace `text-[#555]` across 13 files.

2. **Strategy cards keyboard access** -- add `role="button"`, `tabIndex`, `onKeyDown` to make the 8 strategy cards navigable.

3. **Add `<h1>` to dashboard** -- the most-visited page has no h1.

### High (Should Fix)

4. **Programmatic label linking** -- add `htmlFor`/`id` pairs to all form labels on login and trade panels.

5. **Dynamic import for TradingChart** -- use `next/dynamic` with `ssr: false` to reduce bundle for pages that don't use charts.

6. **Debounce SectorTreemap resize** and memoize strategy sparkline data.

7. **Consolidate dashboard API calls** -- lift PositionsSummary and PnlCalendarMini data fetching into the parent.

### Medium (Nice to Have)

8. Add skip-to-content link in layout.
9. Add `aria-live` to activity feed.
10. Remove global `* { transition-property }` rule.
11. Adopt SWR/React Query for data caching.
12. Add `aria-label` to period toggle buttons with full text.
13. Add focus-visible styles to custom interactive elements.

---

## Score Summary

| Category | Score | Weight | Weighted |
|----------|-------|--------|----------|
| Page Load Performance | 6/10 | 15% | 0.90 |
| Rendering Efficiency | 7/10 | 10% | 0.70 |
| Bundle Optimization | 5/10 | 10% | 0.50 |
| Network Efficiency | 7/10 | 10% | 0.70 |
| Layout Stability | 8/10 | 5% | 0.40 |
| Color Contrast | 3/10 | 15% | 0.45 |
| Keyboard Accessibility | 5/10 | 10% | 0.50 |
| Screen Reader Support | 4/10 | 10% | 0.40 |
| Focus Management | 4/10 | 5% | 0.20 |
| Form Accessibility | 5/10 | 5% | 0.25 |
| Image Accessibility | 9/10 | 5% | 0.45 |
| **Overall Weighted** | | | **5.45/10** |

The app is performant for its target audience (professional traders on desktop) but has significant accessibility gaps that would prevent WCAG 2.1 AA compliance. The color contrast issue (#555 on #0a0a0f) is the single most impactful problem -- it affects every page and every user with less-than-perfect vision.
