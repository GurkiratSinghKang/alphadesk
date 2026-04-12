# AlphaDesk Final Performance & Accessibility Audit

**Date:** 2026-04-10
**Auditor:** Automated Playwright audit (qa-final-perf.mjs)
**Previous Score:** 5.5/10
**Pages Audited:** `/` (Dashboard), `/trade`, `/pipeline`, `/strategies/pead`

---

## PERFORMANCE AUDIT

### Summary Table

| Page | Load (ms) | FCP (ms) | DOM Elements | JS Files | JS Size | CSS Files | CSS Size | Requests | Transferred |
|------|-----------|----------|--------------|----------|---------|-----------|----------|----------|-------------|
| Dashboard (/) | 953 | 76 | 679 | 16 | 939.5 KB | 2 | 105.6 KB | 46 | 1.15 MB |
| Trade (/trade) | 1,579 | 120 | 1,023 | 17 | 1.16 MB | 2 | 105.6 KB | 45 | 1.53 MB |
| Pipeline (/pipeline) | 717 | 84 | 279 | 16 | 933.3 KB | 2 | 105.6 KB | 41 | 1.16 MB |
| Strategy Detail (/strategies/pead) | 743 | 76 | 235 | 16 | 955.6 KB | 2 | 105.6 KB | 40 | 1.16 MB |

### Analysis

**Page Load Times:** All pages load under 2 seconds, which is good for a data-heavy trading application. Dashboard (953ms) and Pipeline (717ms) are notably fast. The Trade page at 1,579ms is the heaviest due to the chart library, options chain, and multiple panels, but still acceptable.

**First Contentful Paint:** Exceptional across all pages. FCP ranges from 76ms to 120ms, well under the 1.8s "good" threshold. This indicates efficient server-side rendering and critical path optimization.

**DOM Complexity:** DOM element counts are well-managed. Dashboard at 679 and Trade at 1,023 are reasonable for their complexity. Pipeline (279) and Strategy Detail (235) are lean. No page exceeds the concerning 1,500+ threshold.

**Resource Loading:**
- JS bundle is well-chunked (16-17 files per page), with the largest chunk at 222.2 KB (likely the charting library). Total JS per page is under 1.2 MB -- reasonable for a feature-rich SPA.
- CSS is efficiently consolidated into 2 files totaling 105.6 KB across all pages, indicating good Tailwind purging.
- Total transfer sizes range from 1.15 MB to 1.53 MB, indicating no bloated assets.

**Top JS Resources (by size):**
1. `07o~osqztxvwt.js` -- 222.2 KB (likely lightweight-charts library)
2. `04mvxko68_ww2.js` -- 140.1 KB (likely React/framework code)
3. `0_8dr~n.kcree.js` -- 113.8 KB (likely component bundle)
4. `03wx2vix62550.js` -- 98.3 KB

### Performance Score: 8/10

Strong performance overall. Sub-2-second load times, excellent FCP, well-managed bundle sizes, and efficient code splitting. The Trade page is the heaviest but justified by its complexity. Minor optimization opportunities exist (lazy-loading non-visible panels).

---

## ACCESSIBILITY AUDIT

### 1. Color Contrast (WCAG AA)

#### #8a8a95 Muted Color -- PASSES

The new `#8a8a95` muted text color was specifically checked against all dark backgrounds:

| Foreground | Background | Ratio | AA Normal (4.5:1) | AA Large (3:1) |
|-----------|-----------|-------|-------|-------|
| #8a8a95 | #0a0a0f (surface) | 5.78:1 | PASS | PASS |
| #8a8a95 | #0e0e16 (panel) | 5.63:1 | PASS | PASS |
| #8a8a95 | #141420 (card) | 5.34:1 | PASS | PASS |

This is a significant improvement from the previous `#555555` which failed contrast checks. The new muted color passes WCAG AA at all text sizes on all backgrounds.

#### Remaining Contrast Issues

| Element | Text Sample | FG Color | Ratio | Threshold | Status |
|---------|------------|----------|-------|-----------|--------|
| Nav buttons (inactive) | "Dashboard", "Trade" | rgb(113,113,122) | 3.86:1 | 4.5:1 | FAIL |
| Command palette trigger | "Search symbols..." | rgb(113,113,122) | 4.09:1 | 4.5:1 | FAIL |
| Red text on dark | "-0.58%", "-$0.45" | rgb(239,68,68) | 4.34:1 | 4.5:1 | FAIL |
| BUY/SELL buttons | "BUY", "SELL" | rgb(0,0,0) on green/red | 1.13:1 | 4.5:1 | FAIL |
| Border separator | pipe chars | rgb(42,42,62) | 1.33:1 | 4.5:1 | FAIL |
| Primary button text | "Run Now", "3M" | white on blue | 3.68:1 | 4.5:1 | FAIL |
| Strategy rule examples | "Buy when RSI..." | rgb(113,113,122) | 3.38:1 | 4.5:1 | FAIL |
| Treemap overlay text | "Industrials-0.1%" | foreground on red/green | 2.92:1 | 4.5:1 | FAIL |
| "No data" placeholder | "No data" | muted | 2.19:1 | 4.5:1 | FAIL |

**Unique failing combinations by page:** Dashboard: 13 | Trade: 8 | Pipeline: 4 | Strategy: 4

**Key issue patterns:**
- **BUY/SELL buttons:** Black text on green/red background yields only 1.13:1 ratio. Using white text instead of black would dramatically improve this.
- **Inactive nav items:** The default zinc-500 (`rgb(113,113,122)`) is close to passing at 3.86:1 but just misses the 4.5:1 AA threshold. Could be bumped to `#9a9aab` (~5.0:1).
- **Primary buttons (Run Now):** White on blue (#3b82f6) yields 3.68:1. A darker blue like #2563eb would pass.
- **Red loss values:** Red (#ef4444) on dark backgrounds yields 4.34:1. Very close to passing. Using a slightly brighter red (#f87171) would fix.

### Contrast Score: 6/10

Major improvement with the #8a8a95 muted color now passing AA everywhere. However, there are still 4-13 failing contrast pairs per page, with the BUY/SELL buttons being the most severe violation. The systematic issues (nav buttons, primary buttons) affect every page.

---

### 2. Interactive Elements - Accessible Names

| Page | Unlabeled Buttons | Details |
|------|-------------------|---------|
| Dashboard | 2 | Profile menu icon button, notification/settings icon button |
| Trade | 25 | Icon-only buttons throughout: watchlist sort/filter, chart controls, options chain up/down/delete buttons, trade leg controls |
| Pipeline | 2 | Same 2 global nav icon buttons |
| Strategy Detail | 3 | Same 2 global + 1 additional icon button |

**Analysis:** The Trade page is the most problematic with 25 unlabeled buttons. These are primarily icon-only buttons (SVG icons without text, aria-label, or title attributes). Common patterns include:
- Watchlist panel sort/filter/remove buttons (5x5 icon buttons)
- Options chain row action buttons
- Chart control dropdown triggers
- Trade leg add/remove buttons

### Accessible Names Score: 5/10

The 2 global unlabeled buttons (profile menu, notification) are minor and appear on every page. But the Trade page has 25 icon-only buttons lacking accessible names -- a significant issue for screen reader users. Most of these are SVG-based utility buttons that need `aria-label` attributes added.

---

### 3. Form Input Labels

**Excellent finding:** Zero unlabeled inputs across all four pages.

Every `<input>`, `<select>`, and `<textarea>` element has at least one of:
- An associated `<label>` element
- An `aria-label` attribute
- A `placeholder` attribute
- A parent or sibling `<label>` element

This includes all the newly added inputs in the Strategy Builder, Backtester, Position Sizer, and Order forms.

### Form Labels Score: 9/10

Nearly perfect. All inputs are labeled. The only minor note is that some labels use `placeholder` as the sole labeling mechanism rather than a proper `<label>` element, which is slightly less robust for screen readers but functionally acceptable.

---

### 4. Keyboard Navigability

**Tested:** Tab through the first 15 focusable elements on each page.

| Page | Tabbable Elements | Focus Indicator | Rate |
|------|-------------------|-----------------|------|
| Dashboard | 24 | 15/15 | 100% |
| Trade | 95 | 15/15 | 100% |
| Pipeline | 22 | 15/15 | 100% |
| Strategy Detail | 24 | 15/15 | 100% |

**Analysis:** All 15 tested elements on every page showed visible focus indicators. The application uses a consistent focus ring/outline system. Key findings:
- Nav buttons (Dashboard, Trade, Pipeline) are all tabbable and show focus
- The command palette trigger is reachable via Tab
- Strategy Builder rule suggestion buttons are tabbable
- Run Now button on Pipeline is keyboard accessible
- Inputs (Strategy Builder name, rule input, Backtester params) are all reachable

### Keyboard Nav Score: 8/10

Strong keyboard navigability. All tested elements show focus indicators. The Trade page has 95 tabbable elements which is high -- a focus trap or skip-link system would improve the experience for keyboard-only users. No obvious keyboard traps were detected.

---

### 5. ARIA Landmarks

| Landmark | Dashboard | Trade | Pipeline | Strategy |
|----------|-----------|-------|----------|----------|
| `<main>` | PRESENT | PRESENT | PRESENT | PRESENT |
| `<nav>` | PRESENT | PRESENT | PRESENT | PRESENT |
| `<header>` (banner) | PRESENT | PRESENT | PRESENT | PRESENT |
| `<aside>` (complementary) | MISSING | MISSING | MISSING | MISSING |
| `<footer>` (contentinfo) | MISSING | MISSING | MISSING | MISSING |
| `[role="search"]` | MISSING | MISSING | MISSING | MISSING |

**Analysis:** The three critical landmarks (`main`, `nav`, `header`) are present on every page -- a good foundation. The application is a single-page trading terminal that intentionally has no footer, so the missing `contentinfo` is expected. The sidebar panels (Watchlist, Analysis) could benefit from `role="complementary"`. The command palette could use `role="search"`.

### ARIA Landmarks Score: 7/10

All essential landmarks are in place. The missing `complementary` and `search` roles are nice-to-haves for a terminal-style app.

---

### 6. Heading Hierarchy

| Page | Headings | Issues |
|------|----------|--------|
| Dashboard | h1: AlphaDesk Dashboard; h2: Activity Feed, Open Positions, April P&L, Economic Calendar, Strategies; h3: Market Indices, Sector Performance, Headlines | None -- clean hierarchy |
| Trade | h3: Technical Score (no h1 or h2) | No h1 found |
| Pipeline | h1: Trading Pipeline; h2: Current Positions, Today's Pipeline Run, Strategy Builder, Backtesting, History, Performance Summary | None -- clean hierarchy |
| Strategy Detail | h1: (present); h3: (jumps from h1 to h3) | Heading skip: h1 -> h3 |

**Analysis:** Dashboard and Pipeline have excellent heading hierarchies. The Trade page is missing an h1 entirely (it has only h3-level headings within sub-panels). The Strategy Detail page skips from h1 to h3, missing h2.

### Heading Hierarchy Score: 6/10

Two of four pages have clean heading hierarchies, two have issues. The Trade page should include an h1 for "Trading" or the symbol name. Strategy Detail needs an h2 level.

---

### 7. Images & Alt Text

Zero images missing alt text across all pages. The application uses SVG icons via Lucide rather than `<img>` tags, so this is structurally clean.

### Alt Text Score: 10/10

---

## NEW FEATURE ACCESSIBILITY AUDITS

### Economic Calendar (Dashboard)

- **Found:** Yes
- **Event Count:** 8 events displayed
- **Impact Indicators:** Color-coded dots (high/medium/low) present
- **Impact Badges:** Text labels ("high", "medium", "low") present
- **Semantic Structure:** Has `<h2>Economic Calendar</h2>` heading
- **Events Accessible:** Yes, each event shows event name, date, time, forecast, and previous values as text content

**Issues:**
- The color-coded impact dots are purely decorative (no aria-label) but the adjacent text badge provides the same information, so the impact level is accessible.
- Events are in a div-based list rather than a semantic `<ul>` or `<table>`, but content is readable.

**Score: 8/10** -- Well-structured, all information is text-accessible.

### Strategy Builder (Pipeline page)

- **Found:** Yes, under the Pipeline page at `/pipeline`
- **Heading:** `<h2>Strategy Builder</h2>` present
- **Inputs:**
  - "Strategy Name" -- has `<label>` element
  - "Add Rule (Natural Language)" -- has `<label>` element
  - Both inputs have proper labels
- **Rule Suggestions:** Example rules are rendered as tabbable buttons with full text content
- **Keyboard Navigation:** Strategy Builder inputs and buttons are reachable via Tab, all show focus indicators
- **AI Badge:** Visual "AI" badge present to indicate AI functionality

**Score: 8/10** -- All inputs properly labeled, keyboard accessible. The rule suggestion buttons have text content. Minor improvement: rule suggestion buttons should have `role="option"` or use a listbox pattern for better semantics.

### Backtester (Pipeline page)

- **Found:** Yes, under the Pipeline page at `/pipeline`
- **Heading:** `<h2>Backtesting</h2>` present
- **Parameter Inputs (from source code review):**
  - "Symbol" -- `<label>` element present
  - "Fast SMA" -- `<label>` element present
  - "Slow SMA" -- `<label>` element present
  - "Capital ($)" -- `<label>` element present
- **Run Button:** "Run Backtest" button has text content + Play icon
- **Results:** Output displays use proper text content with semantic grouping

**Score: 8/10** -- All parameter inputs have proper labels. The equity curve SVG could benefit from an `aria-label="Equity curve chart"` but the data is also presented in text form.

### Position Sizer (Trade page, Analysis panel)

- **Found:** Yes, within the Order tab of the Analysis panel on `/trade`
- **Heading:** "Position Sizer" text present (as `<p>` element, not `<h>`)
- **Risk % Input:** Has `<label>` element -- "Risk %"
- **Stop Loss % Input:** Has `<label>` element -- "Stop Loss %"
- **Calculated Output:** Shares, value, and portfolio percentage displayed as text

**Note:** The Position Sizer was not detected by the automated script because it requires clicking the "Order" tab in the Analysis panel first. Source code review confirms all inputs are properly labeled.

**Score: 7/10** -- Inputs properly labeled. The heading is a `<p>` instead of `<h3>` or `<h4>`, reducing discoverability for screen reader heading navigation. The calculated values lack explicit labels (relies on visual positioning).

### Drawing Toolbar (Trade page)

- **Found:** Yes, in the timeframe bar of the Chart panel
- **Buttons:**
  | Button | Title | Text | Accessible |
  |--------|-------|------|------------|
  | Horizontal Line | "Horizontal Line" | (unicode dash) | YES |
  | Trendline | "Trendline" | (unicode backslash) | YES |
  | Fibonacci | "Fibonacci" | "Fib" | YES |
- **Clear Drawings:** Has `title="Clear all drawings"` -- accessible

**Score: 9/10** -- All drawing tools have `title` attributes providing accessible names. The text content (unicode characters) is a secondary label. Properly keyboard-navigable.

### BUY/SELL Chart Buttons (Trade page)

- **Found:** Yes, overlaid on the right edge of the chart
- **BUY Button:**
  - Text content: "BUY" -- accessible name present
  - Color: black text on green (rgb(0,0,0) on green/90) -- **contrast FAIL** (1.13:1)
  - No aria-label or title (but text content suffices)
- **SELL Button:**
  - Text content: "SELL" -- accessible name present
  - Color: black text on red (rgb(0,0,0) on red/90) -- **contrast FAIL** (1.13:1)
  - No aria-label or title (but text content suffices)

**Score: 5/10** -- Buttons have accessible names via text content, but the black-on-green and black-on-red color combinations have extremely poor contrast (1.13:1). Should use white text instead of black, or add higher-contrast backgrounds. These are safety-critical controls for placing trades.

---

## SCORING SUMMARY

| Category | Score | Notes |
|----------|-------|-------|
| **Performance** | **8/10** | Fast loads, good FCP, efficient bundles |
| **Color Contrast** | **6/10** | #8a8a95 now passes; BUY/SELL buttons, nav items, red text still fail |
| **Interactive Accessible Names** | **5/10** | 25 unlabeled icon buttons on Trade page |
| **Form Input Labels** | **9/10** | All inputs labeled (Strategy Builder, Backtester, Position Sizer) |
| **Keyboard Navigability** | **8/10** | 100% focus indicators; no traps detected |
| **ARIA Landmarks** | **7/10** | main, nav, banner present; missing complementary, search |
| **Heading Hierarchy** | **6/10** | Dashboard and Pipeline clean; Trade missing h1, Strategy has skip |
| **New Feature A11y** | **7/10** | Calendar, Builder, Backtester good; BUY/SELL contrast is critical |

### Overall Score: 7.0/10

**Improvement from previous audit: 5.5 --> 7.0 (+1.5 points)**

---

## KEY IMPROVEMENTS SINCE LAST AUDIT

1. **#8a8a95 muted color** now passes WCAG AA on all backgrounds (5.34:1 to 5.78:1). Previously #555555 failed.
2. **All form inputs labeled** -- Strategy Builder, Backtester, Position Sizer, Order forms all have proper labels.
3. **ARIA landmarks** -- `<main>`, `<nav>`, `<header>` are now present on every page.
4. **Heading hierarchy** -- Dashboard and Pipeline have clean h1 > h2 > h3 hierarchies.
5. **Economic Calendar** -- Fully text-accessible with semantic heading.
6. **Drawing Toolbar** -- All buttons have `title` attributes.
7. **Keyboard navigation** -- 100% of tested elements show focus indicators.
8. **Performance** -- All pages load under 2 seconds with FCP under 120ms.

## REMAINING ISSUES TO ADDRESS

### Critical (affects safety/usability):
1. **BUY/SELL button contrast** -- 1.13:1 ratio is extremely poor. Change text from `text-black` to `text-white` or use a darker background for these trade-critical buttons.

### High Priority:
2. **25 unlabeled icon buttons on Trade page** -- Add `aria-label` attributes to all icon-only buttons in Watchlist, Options Chain, and Trade panels.
3. **Inactive nav button contrast** -- rgb(113,113,122) on dark yields 3.86:1. Bump to `#9a9aab` for 5.0:1.
4. **Primary button contrast** -- White on #3b82f6 yields 3.68:1. Use #2563eb for 4.6:1.

### Medium Priority:
5. **Trade page missing h1** -- Add an h1 heading for the trade workspace.
6. **Strategy Detail heading skip** -- Add h2 between h1 and h3.
7. **Red text contrast** -- #ef4444 on dark yields 4.34:1. Use #f87171 for ~5.3:1.
8. **Position Sizer heading** -- Change from `<p>` to `<h3>` or `<h4>`.
9. **Command palette** -- Add `role="search"` to the search trigger.
10. **Sidebar panels** -- Add `role="complementary"` to Watchlist and Analysis panels.

### Low Priority:
11. **Skip link** -- Add a "Skip to main content" link for keyboard users.
12. **Treemap text contrast** -- Text overlaid on colored backgrounds in sector treemap fails contrast.

---

## RAW DATA

Full audit data saved to: `qa-screenshots/final-eval/final-audit-raw.json`
Screenshots saved to: `qa-screenshots/final-eval/final-*.png`
Audit script: `qa-final-perf.mjs`
