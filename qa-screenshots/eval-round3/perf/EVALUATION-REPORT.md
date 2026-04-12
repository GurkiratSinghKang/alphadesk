# AlphaDesk Performance & Accessibility Evaluation -- Round 3

**Date:** 2026-04-12
**Evaluator:** Automated (Playwright) + Manual Code Review
**Target:** https://tradingalpha.net

---

## 1. Performance Evaluation

### Page Load Times

| Page | Load Time (ms) | API Calls | Duplicate API Calls | DOM Nodes |
|------|---------------|-----------|--------------------:|-----------|
| `/` (Dashboard) | 752 | 32 | 14 (5 endpoints) | 738 |
| `/trade` | 1,259 | 22 | 2 (1 endpoint) | 989 |
| `/pipeline` | 665 | 20 | 2 (1 endpoint) | 329 |
| `/strategies/pead` | 776 | 19 | 0 | 244 |

**Key findings:**

- **Dashboard duplicate fetches are excessive.** The `/` page calls `sectors`, `news`, `pipeline/status`, and `pipeline/history` 3 times each. This appears caused by the `useEffect` in `CommandCenter` re-running when `regime` and `summary.equity` change, triggering `fetchRemaining()` multiple times as dependencies settle.
- **`/trade` is the slowest page** at ~1.3s. With 989 DOM nodes (options chain table + multi-panel layout), this is acceptable but the highest of all pages.
- All pages load under 1.5s, which is good for a data-heavy trading terminal.

### Bundle Analysis (measured on `/trade`)

| Metric | Value |
|--------|-------|
| Total JS | 1,202.7 KB (17 files) |
| Total CSS | 105.8 KB (2 files) |
| Largest bundle | 267.6 KB |
| Second largest | 222.2 KB |
| Third largest | 140.1 KB |

**Key findings:**

- Total JS of ~1.2 MB across 17 chunks is reasonable for a full trading terminal with charting.
- No single bundle exceeds 300 KB, indicating reasonable code splitting.
- The top 3 bundles likely contain: React + Next.js runtime, charting library, and UI component library.
- CSS total of 105.8 KB in 2 files is well-managed.

### Duplicate/Unnecessary Re-fetches

| Endpoint | Times Called | Page |
|----------|-------------|------|
| `portfolio/summary` | 2x | `/` |
| `market-overview/sectors` | 3x | `/` |
| `news/market` | 3x | `/` |
| `pipeline/status` | 3x | `/` |
| `pipeline/history` | 3x | `/` |
| `trades/positions` | 2x | `/trade`, `/pipeline` |

The Dashboard page fires 14 unnecessary duplicate API calls out of 32 total (44% waste).

---

## 2. Accessibility Evaluation

### Color Contrast (WCAG AA)

**Automated failures found: 2**

| Element Text | Contrast Ratio | Required | FG Color | BG Color |
|-------------|---------------|----------|----------|----------|
| "Search symbols, commands..." | 4.09:1 | 4.5:1 | `rgb(113,113,122)` / `#71717a` | `rgb(10,10,15)` / `#0a0a0f` |
| "Symbol Last Chg%" | 3.86:1 | 4.5:1 | `rgb(113,113,122)` / `#71717a` | `rgb(18,18,26)` / `#12121a` |

**Additional manual review concerns:**

- The `text-label` utility class uses `#8a8a95` on dark backgrounds, which is borderline (estimated ~4.6:1 on `#0a0a0f`, passing, but ~4.1:1 on `#12121a` surface).
- The `text-hint` class (`#8a8a95` at 11px) may fail at that small size.
- The `muted-foreground` token (`#71717a`) is used extensively and consistently fails against `--surface` (`#12121a`) and `--background` (`#0a0a0f`).
- Overall, the dark terminal theme creates a coherent visual hierarchy but sacrifices WCAG AA compliance for some secondary text.

### Keyboard Navigation

| Metric | Count |
|--------|-------|
| Tabbable elements | 89 |
| Interactive elements | 84 |
| Interactive but NOT tabbable | 10 |

**Not tabbable elements:** 5 tab triggers ("Screener", "Signals", "Fund", "Sent", "Chat") use `role="tab"` with proper ARIA, which correctly manages focus via arrow keys rather than Tab. This is actually correct behavior per WAI-ARIA tab pattern.

**Positive findings:**
- WatchlistRow and SignalsTab items use `role="button"` with `tabIndex={0}` and handle Enter/Space keydown events correctly.
- Position rows and order rows also implement proper keyboard interaction.
- Sort buttons in the watchlist header have `aria-label` attributes.

### Screen Reader Support

**Elements without accessible names: 18**

| Category | Count | Examples |
|----------|-------|---------|
| Popover triggers (bell icon) | 1 | Bell notification button wrapping a Button |
| Icon-only buttons (dropdown triggers) | ~10 | `MoreHorizontal` dropdown triggers in watchlist rows |
| Profile/misc buttons | ~3 | Various icon-only controls |
| Tooltip triggers | ~4 | Buttons that show tooltips but lack aria-labels |

**Root cause:** Most icon-only buttons (the `DropdownMenuTrigger` in each watchlist row, chart toolbar icon buttons) render Lucide icons without any text or `aria-label`. The `MoreHorizontal` menu trigger in `WatchlistPanel` is repeated per row and none have accessible names.

### Form Accessibility

**Total form inputs analyzed:** All inputs across all panels.

| Panel | Inputs | With `<label>` | With `aria-label` | Placeholder only | Verdict |
|-------|--------|---------------|-------------------|----|---------|
| Login | 2 | 2 (via `htmlFor`) | 0 | 2 | PASS |
| Backtest | ~6 | 6 (adjacent `<label>`) | 0 | 0 | PARTIAL -- labels not linked via `for`/`id` |
| AnalysisPanel (Position Sizer) | 2 | 2 (adjacent) | 0 | 0 | PARTIAL -- labels not linked |
| AnalysisPanel (Order) | 3 | 3 (adjacent) | 0 | 0 | PARTIAL -- labels not linked |
| ChartPanel (Alert) | 2 | 0 | 0 | 0 | FAIL |
| WatchlistPanel (Add symbol) | 1 | 0 | 0 | 1 (placeholder only) | FAIL |
| WatchlistPanel (Screener select) | 1 | 0 | 0 | 0 | FAIL |
| StrategyBuilder | 2 | 2 (adjacent) | 0 | 1 | PARTIAL |
| TradePanel (Journal note) | 1 | 0 | 0 | 1 (placeholder only) | FAIL |

**Key issue:** Most labels are visually adjacent `<label>` elements but NOT programmatically associated (no `htmlFor`/`for` attribute matching an `id` on the input). Only the Login page does this correctly. Screen readers cannot associate these labels with their inputs.

### Focus Management

| Aspect | Status |
|--------|--------|
| Focusable elements on `/trade` | 89 |
| Custom focus styles in CSS | Not detected in stylesheets (uses Tailwind defaults via `outline-ring/50` base layer) |
| Focus ring visibility | Minimal -- screenshots show no visible focus indicator when tabbing through the trade page |
| Modal focus trapping | CommandPalette uses proper dialog pattern; dropdown menus handle focus via Radix/Base UI |

**Key issue:** The base CSS rule `* { @apply outline-ring/50; }` sets a subtle blue outline on focus, but it is very hard to see against the dark background. The focus-visibility screenshots confirm no clearly visible focus ring when tabbing through interactive elements.

### Heading Hierarchy

| Page | H1 | H2 | H3 | H4 | Issues |
|------|----|----|----|----|--------|
| `/` (Dashboard) | 1 ("AlphaDesk Dashboard") | 4 | 3 | 0 | None -- clean hierarchy |
| `/trade` | **0** | 0 | 1 ("Technical Score") | 2 | **Missing H1**, jumps to H3 |
| `/pipeline` | 1 ("Trading Pipeline") | 5 | 0 | 0 | None -- clean hierarchy |
| `/strategies/pead` | 1 ("Post-Earnings...") | 1 | 2 | 0 | **H1 to H3 skip (skips H2)** |

**Key issues:**
- `/trade` has NO `<h1>` element at all. Screen readers cannot identify the page purpose.
- `/strategies/pead` skips from H1 directly to H3 for "Strategy Thesis" and "Parameters".

---

## 3. Scores

| # | Dimension | Score | Rationale |
|---|-----------|-------|-----------|
| 1 | **Page Load Performance** | **8/10** | All pages load under 1.5s. Dashboard has excessive duplicate API calls (14 redundant out of 32). Otherwise fast. |
| 2 | **Bundle Efficiency** | **8/10** | 1.2 MB total JS across 17 well-split chunks. No massive single bundles. CSS is compact at 106 KB. |
| 3 | **DOM Complexity** | **8/10** | Trade page at 989 nodes is reasonable for a full trading terminal. Pipeline at 329 and strategy at 244 are lean. |
| 4 | **Color Contrast (WCAG AA)** | **5/10** | 2 automated failures. `muted-foreground` (#71717a) widely used on dark surfaces fails AA. Labels using #8a8a95 are borderline. Dark theme prioritizes aesthetics over compliance. |
| 5 | **Keyboard Navigation** | **7/10** | Most interactive elements are tabbable. Watchlist/position rows handle Enter/Space correctly. Tab pattern uses arrow keys (correct per ARIA). Some icon-only buttons lack keyboard discoverability. |
| 6 | **Screen Reader Support** | **4/10** | 18 elements lack accessible names. Every watchlist row's dropdown trigger, the bell notification button, and multiple chart toolbar buttons have no labels. Icon-only buttons are the primary offender. |
| 7 | **Form Accessibility** | **4/10** | Labels exist visually but most are NOT programmatically associated (no `for`/`id` pairing). Only the login page does this correctly. 4+ inputs have no label at all (placeholder-only). |
| 8 | **Focus Management** | **5/10** | Focus ring is nearly invisible against the dark theme. No focus trapping issues in modals (Radix handles this). Trade page heading structure is broken (no H1). |

### Weighted Average

Using weights that reflect user impact:

| Dimension | Weight | Score | Weighted |
|-----------|--------|-------|----------|
| Page Load Performance | 15% | 8 | 1.20 |
| Bundle Efficiency | 10% | 8 | 0.80 |
| DOM Complexity | 10% | 8 | 0.80 |
| Color Contrast | 15% | 5 | 0.75 |
| Keyboard Navigation | 15% | 7 | 1.05 |
| Screen Reader Support | 15% | 4 | 0.60 |
| Form Accessibility | 10% | 4 | 0.40 |
| Focus Management | 10% | 5 | 0.50 |
| **TOTAL** | **100%** | | **6.10 / 10** |

---

## 4. Priority Fixes

### Critical (Blocks accessibility compliance)
1. **Add `aria-label` to all icon-only buttons** -- DropdownMenuTrigger in WatchlistPanel rows, chart toolbar icons, bell notification button
2. **Link labels to inputs with `htmlFor`/`id`** -- BacktestPanel, AnalysisPanel, StrategyBuilder, ChartPanel alert form
3. **Add missing labels** -- Watchlist "Add symbol" input, screener preset select, alert price/condition inputs

### High Priority
4. **Fix duplicate API calls on Dashboard** -- The `useEffect` in CommandCenter refires when `regime` and `summary.equity` change. Use a ref or `useRef`-based fetch guard.
5. **Increase `muted-foreground` contrast** -- Change `#71717a` to at least `#8f8f99` for 4.5:1 ratio against `#0a0a0f`
6. **Add `<h1>` to `/trade` page** -- e.g., visually hidden `<h1>Trade Terminal</h1>`
7. **Make focus ring more visible** -- Add `focus-visible:ring-2 focus-visible:ring-primary` or similar to the global base styles

### Medium Priority
8. **Fix heading skip on `/strategies/pead`** -- Change H3 ("Strategy Thesis", "Parameters") to H2
9. **Add labels to ChartPanel alert form** inputs (condition select, price input)
10. **Add `name` attributes to login form inputs** for better form autofill support

---

## 5. Evidence

All screenshots saved to: `/Users/GK/Downloads/alphadesk/qa-screenshots/eval-round3/perf/`

| File | Description |
|------|-------------|
| `page-load-home.png` | Dashboard full page |
| `page-load-trade.png` | Trade terminal full page |
| `page-load-pipeline.png` | Pipeline page full page |
| `page-load-strategies-pead.png` | PEAD strategy page |
| `login-page.png` | Login form |
| `focus-visibility-1.png` | Focus state after 1 Tab press |
| `focus-visibility-2.png` | Focus state after 6 Tab presses |
| `full-results.json` | Complete raw test data |
