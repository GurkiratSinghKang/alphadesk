# AlphaDesk UI/UX Evaluation - Round 3

**Date:** 2026-04-12  
**Evaluator:** Expert UI/UX Designer  
**App Version:** Production (tradingalpha.net)  
**Screenshots:** 41 captures across all pages, viewports, and states  

---

## Score Summary

| # | Dimension | Score | Weight |
|---|-----------|-------|--------|
| 1 | Visual Hierarchy | 8 | 1.5x |
| 2 | Information Density | 8 | 1.5x |
| 3 | Consistency | 8 | 1.0x |
| 4 | Color Usage | 9 | 1.0x |
| 5 | Typography | 8 | 1.0x |
| 6 | Whitespace | 7 | 1.0x |
| 7 | Empty States | 6 | 0.75x |
| 8 | Responsiveness | 6 | 1.0x |
| 9 | Micro-interactions | 7 | 1.0x |
| 10 | Overall Polish | 7 | 1.25x |

**Weighted Average: 7.38 / 10**

---

## Detailed Evaluation

### 1. Visual Hierarchy -- 8/10

**What works well:**
- The Portfolio Hero section (screenshot `03-dashboard-full.png`) immediately commands attention with the large `$100,000.00` display value at 36px bold weight with the gradient text effect. This is exactly what a trader wants to see first.
- The equity curve sits directly below the headline number, reinforcing the primary data point with visual context.
- The status strip (screenshot `64-topbar.png`) provides a persistent information ticker -- P&L, Regime, VIX, connection status, paper/live mode -- all scannable at 11px in a single row without overwhelming.
- The Strategies panel (right column) uses card-based layout with Active/Paused badges that create visual separation between states.
- The trade page (screenshot `11-trade-viewport.png`) correctly prioritizes the candlestick chart as the dominant element, with the watchlist as secondary left panel and trade entry as secondary right panel.

**What needs improvement:**
- The Activity Feed and Economic Calendar in the left column (dashboard) compete for the same visual priority level. The activity feed items all look identical -- there is no visual distinction between news, pipeline events, and risk alerts.
- On the dashboard bottom section, the Market Indices, Sector Performance, and Headlines panels all appear at the same visual weight, making none of them feel "primary."

---

### 2. Information Density -- 8/10

**What works well:**
- The dashboard (screenshot `03-dashboard-full.png`) packs a substantial amount into a single viewport: portfolio value, equity curve, activity feed, P&L calendar, positions, economic calendar, and 12 strategy cards. This is appropriate for a hedge fund command center.
- The trade page (screenshot `11-trade-viewport.png`) is dense but well-organized: watchlist (10 symbols), full candlestick chart with volume, trade entry with support/resistance levels, options chain, and a technical score gauge. This mirrors professional terminals like Bloomberg/TOS.
- The P&L calendar heatmap (red/green cells) communicates daily performance without any text, a space-efficient encoding.
- Strategy cards are compact -- icon, name, status badge, return %, position count, regime note, and sparkline all in roughly 120x100px.

**What needs improvement:**
- The Pipeline page (screenshot `20-pipeline-full.png`) has significantly lower density than the dashboard or trade page. The Strategy Builder section and Backtesting form have large amounts of whitespace. This page feels unfinished by comparison.
- The options chain at the bottom of the trade page shows a matrix of data but is small and could benefit from more vertical real estate.

---

### 3. Consistency -- 8/10

**What works well:**
- Card pattern is consistent: rounded-xl border, `bg-[var(--panel)]` or `bg-[var(--surface)]`, with the same padding and gap conventions.
- Section headers follow a repeating pattern: icon + bold label left, count/action right, border-b separator below.
- The badge pattern (Active/Paused, Paper/Live) uses consistent border-color + text-color combinations drawn from the same palette.
- Typography scale from globals.css is well-defined: `text-display` (36px), `text-title` (15px), `text-body` (13px), `text-label` (10px uppercase), `text-hint` (11px). These are applied consistently.
- The topbar maintains identical structure across all pages (screenshots `64-topbar.png` across dashboard/trade/pipeline).

**What needs improvement:**
- The Pipeline page (screenshot `21-pipeline-viewport.png`) uses slightly different form styling compared to the trade page trade entry panel. Inputs on Pipeline appear larger and more spaced out than those on the trade page.
- The strategy detail page (screenshot `31-strategy-detail-momentum-alpha-viewport.png`) has a different layout pattern than the rest of the app -- it uses a centered single-column layout rather than the multi-panel grid.

---

### 4. Color Usage -- 9/10

**What works well:**
- The green (#22c55e) / red (#ef4444) P&L convention is industry-standard and immediately readable. Used consistently for profit/loss across: status strip, portfolio hero, P&L calendar, strategy cards, position rows, and sparklines.
- The blue primary (#3b82f6) is reserved for interactive elements and branding -- active nav items, the search bar focus ring, and the command palette trigger. This distinction between "semantic data colors" and "UI chrome colors" is clean.
- Badge color coding: emerald for Active, amber for Paused creates good differentiation without introducing new colors.
- The background gradient (dark navy-black) with panel layers creates depth without being distracting.
- The glow effects (`glow-profit`, `glow-loss`) add subtle emphasis to P&L numbers without being garish.
- The pulsing green dot for LIVE connection status is immediately recognizable.

**What needs improvement:**
- The only weakness is the VIX and Regime values in the status strip -- the amber color for "sideways" regime is very close to the amber used for "Paused" strategy badges. A different encoding might reduce ambiguity, though this is minor.

---

### 5. Typography -- 8/10

**What works well:**
- The system uses Geist Sans (variable) which is an excellent choice for a data-heavy terminal -- clean, modern, and highly legible at small sizes.
- `tabular-nums` (font-variant-numeric: tabular-nums) is applied to all numerical values. This is critical for a trading terminal so that price columns align properly.
- The type scale is well-structured: 36px display, 15px titles, 13px body, 11px secondary, 10px labels, 9px micro-text. Each level has a clear purpose.
- Letter-spacing adjustments (negative for display text, positive for label text) are correct for their contexts.
- The 10px uppercase labels (e.g., "PORTFOLIO", "DAY P&L") follow financial terminal conventions.

**What needs improvement:**
- Some text in the trade page options chain (screenshot `13-trade-bottom.png`) appears quite small -- potentially below comfortable reading size at 1080p. Strike prices and greeks could benefit from slightly larger text.
- The Activity Feed text on dashboard wraps at a point where some entries become hard to scan, particularly the Risk Manager entry which shows raw API response data that appears truncated.

---

### 6. Whitespace -- 7/10

**What works well:**
- The dashboard panels have consistent 4px and 3px padding/gap, creating a tight but readable grid (screenshot `04-dashboard-viewport.png`).
- The portfolio hero has appropriate breathing room between the value, P&L, and period pills.
- Strategy cards use 3.5 unit (14px) padding which is comfortable for the content density.

**What needs improvement:**
- The Pipeline page (screenshot `20-pipeline-full.png`) has notably inconsistent spacing compared to the dashboard. The Strategy Builder section has too much vertical whitespace between elements, while the dashboard is tightly packed. This creates an "unfinished" impression.
- The bottom section of the dashboard (Market Indices, Sector Performance, Headlines) appears to float in a separate zone with significant gap from the main content above it.
- On ultrawide displays (screenshot `70-ultrawide-dashboard.png`), the content does not fill the available space well. There is significant empty space on both sides and the layout doesn't scale up to take advantage of the wider viewport.
- The 2-column strategy grid could become 3 columns on wider screens to use space more efficiently.

---

### 7. Empty States -- 6/10

**What works well:**
- The Open Positions empty state (screenshot `04-dashboard-viewport.png`) shows "No open positions -- the pipeline opens trades during market hours" which is contextual and actionable. The briefcase icon dims to 30% opacity, which is a nice touch.
- Strategy cards with no positions show a dash and "No positions" text cleanly.
- The command palette defaults to "Recent Symbols" when empty (screenshot `40-command-palette.png`), which is useful.
- The trade panel "No legs added" state is informative.

**What needs improvement:**
- The strategy detail page for a non-existent strategy (screenshot `61-404-strategy.png`) renders the slug "nonexistent-id-12345" as a page title with "Not enough data for display curve" in the chart area. This is not a proper 404 -- the user sees a seemingly-valid page with a broken chart rather than a clear "Strategy not found" message.
- The loading state (screenshot `60-loading-state.png`) shows only "Loading command center..." in plain text centered on a blank screen. For a trading terminal, there should be skeleton placeholders that hint at the layout structure, rather than a blank page with a text label.
- The dashboard `loading.tsx` literally returns `<div>Loading...</div>` with no skeleton, shimmer, or structural hint.
- The backtest history on the Pipeline page shows rows of dates with "No activity" -- these could be visually distinguished or collapsed rather than listed individually.
- The Signals tab on the trade page (screenshot `15-trade-signals-tab.png`) shows only 4 items when it could have an empty-state explanation of what signals are and how they are generated.

---

### 8. Responsiveness -- 6/10

**What works well:**
- The mobile login page (screenshot `55-mobile-login.png`) is clean and properly centered.
- The mobile dashboard (screenshot `56-mobile-dashboard.png`) stacks all panels into a single column which is usable, and the P&L calendar scales down.
- The tablet dashboard (screenshot `50-tablet-dashboard.png`) also stacks well with readable text.
- The mobile trade page (screenshot `57-mobile-trade.png`) shows a rearranged layout with watchlist, analysis panel, and trade entry visible -- the chart is hidden which is the right trade-off for the viewport.

**What needs improvement:**
- The mobile trade page (screenshot `57-mobile-trade.png`) hides the candlestick chart entirely on small screens. For a trading app, the chart is arguably the most important element. A collapsed/expandable chart or a smaller chart-first layout would be more useful.
- The mobile pipeline page (screenshot `58-mobile-pipeline.png`) shows a horizontal overflow issue -- the strategy builder template buttons appear to extend beyond the viewport width. This is a layout bug.
- On tablet (768px, screenshot `51-tablet-trade.png`), the trade page is cramped with the watchlist, chart, and right panel all trying to share limited width. The chart is significantly compressed.
- On ultrawide (2560px, screenshot `70-ultrawide-dashboard.png`), the layout maxes out but leaves significant dead space. The content appears centered but small relative to the viewport.
- The topbar navigation on mobile could benefit from a hamburger menu or bottom tab bar rather than showing all items.

---

### 9. Micro-interactions -- 7/10

**What works well:**
- The `card-glow` hover effect on strategy cards provides visual feedback with a subtle blue border glow (defined in globals.css, line 222-228).
- Price flash animations (`flash-green`, `flash-red`) exist for real-time price updates, which is essential for a trading terminal.
- The command palette (screenshot `40-command-palette.png`) opens with proper focus and keyboard navigation. The recent symbols section pre-populates, reducing time-to-action.
- The keyboard shortcuts overlay (screenshot `43-keyboard-shortcuts.png`) is well-organized with categories (Global, Navigation, Backtesting) and proper key badge rendering.
- The LIVE indicator in the status strip has a ping animation on the green dot.
- Smooth 150ms transitions on all interactive elements (button, a, input, etc.) via globals.css line 286-290.
- The profile menu dropdown (screenshot `41-profile-menu-attempt.png`) shows an "Alerts & Notifications" panel, which is appropriate feedback.
- The scrollbar styling is customized to match the dark theme.

**What needs improvement:**
- No visible loading spinner or skeleton when switching between dashboard tabs or loading strategy data.
- The equity curve period pills (1W/1M/3M/YTD) switch instantly with no animation -- a subtle crossfade on the chart would improve perceived quality.
- No toast notifications were observed during testing. Trade actions, pipeline runs, and strategy changes should produce visible feedback toasts.
- The "Run Backtest" button on the pipeline page has no loading state or progress indicator after being clicked.

---

### 10. Overall Polish -- 7/10

**What works well:**
- The overall aesthetic is cohesive -- dark theme, consistent color tokens, professional typography. It genuinely feels like a trading terminal rather than a generic dashboard.
- The design system (globals.css) is well-architected with CSS custom properties for trading-specific colors, proper utility classes, and consistent theming.
- The topbar with glass effect (backdrop-filter: blur(12px)) is a polished touch.
- The command palette (Ctrl+K) is a power-user feature that elevates the UX.
- The background subtle gradient (body gradient from #0a0a0f to #0d0d16) adds depth without being distracting.

**What needs improvement:**
- The strategy detail page (screenshot `30-strategy-detail-momentum-alpha.png`) feels unfinished -- the chart shows "Not enough data for display curve" and the documentation section says "Strategy documentation loading..." which appears to be permanent placeholder text.
- The Pipeline page overall feels less polished than the dashboard and trade pages. It lacks the card-based visual treatment, has form elements that feel generic, and the performance summary cards at the bottom use a different visual style (colored bottom borders) than the rest of the app.
- The "nonexistent-id-12345" strategy rendering as a valid page (screenshot `61-404-strategy.png`) rather than a 404 is a polish gap.
- The trade page options chain section at the bottom is functional but could benefit from more visual refinement -- the row highlighting and data formatting feel basic compared to the rest of the terminal.

---

## Visual Bugs & Issues

### Critical (P0)
1. **Strategy detail 404 handling** -- Navigating to a non-existent strategy ID renders a broken page instead of a proper 404/not-found state. (screenshot `61-404-strategy.png`)

### High (P1)
2. **Mobile pipeline horizontal overflow** -- Strategy builder template buttons overflow the viewport width on mobile (375px). (screenshot `58-mobile-pipeline.png`)
3. **Loading state has no skeleton** -- Dashboard loading shows plain "Loading command center..." text with no structural hint. Creates a jarring flash when content appears. (screenshot `60-loading-state.png`)
4. **Strategy detail "loading..." text appears permanent** -- "Strategy documentation loading..." and "Not enough data for display curve" appear to be persistent states rather than actual loading states. (screenshot `30-strategy-detail-momentum-alpha.png`)

### Medium (P2)
5. **Ultrawide layout does not scale** -- At 2560px width, content is centered but does not expand to use the available space. Dead space on sides. (screenshot `70-ultrawide-dashboard.png`)
6. **Mobile trade page hides chart** -- The most important element for a trading terminal is not visible on mobile. (screenshot `57-mobile-trade.png`)
7. **Pipeline page visual inconsistency** -- Form styling and spacing conventions differ from the rest of the app. Performance summary cards at the bottom use a different design language. (screenshot `20-pipeline-full.png`)
8. **No toast/notification system visible** -- Actions produce no visible feedback confirmations.

### Low (P3)
9. **Activity feed shows raw data** -- The Risk Manager entry in the Activity Feed shows truncated raw API/JSON text rather than a formatted summary. (screenshot `04-dashboard-viewport.png`)
10. **Options chain text size** -- Strike prices and greeks in the options chain are very small at standard viewport sizes. (screenshot `13-trade-bottom.png`)
11. **Equity curve period toggle lacks animation** -- Switching between 1W/1M/3M/YTD causes an abrupt change rather than a smooth transition.
12. **Dashboard bottom section feels disconnected** -- Market Indices, Sector Performance, and Headlines panels have a visual gap separating them from the main dashboard grid.
13. **Tablet trade page is cramped** -- At 768px, the three-panel trade layout (watchlist + chart + trade entry) is too tight. (screenshot `51-tablet-trade.png`)

---

## Weighted Score Calculation

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Visual Hierarchy | 8 | 1.50 | 12.00 |
| Information Density | 8 | 1.50 | 12.00 |
| Consistency | 8 | 1.00 | 8.00 |
| Color Usage | 9 | 1.00 | 9.00 |
| Typography | 8 | 1.00 | 8.00 |
| Whitespace | 7 | 1.00 | 7.00 |
| Empty States | 6 | 0.75 | 4.50 |
| Responsiveness | 6 | 1.00 | 6.00 |
| Micro-interactions | 7 | 1.00 | 7.00 |
| Overall Polish | 7 | 1.25 | 8.75 |
| **Totals** | | **10.00** | **82.25** |

**Weighted Average: 82.25 / 10.00 = 7.38 / 10**

---

## Summary

AlphaDesk presents a solid, professional trading terminal aesthetic that appropriately mirrors the visual language of Bloomberg and ThinkOrSwim. The color system, typography choices, and information density on the dashboard and trade pages are strong. The primary areas for improvement are: (1) the strategy detail and pipeline pages need more polish to match the dashboard/trade standard, (2) empty and error states need proper handling rather than showing permanent "loading" placeholders, (3) responsive layouts need work, especially the mobile trade view and ultrawide support, and (4) skeleton loading states should replace the bare "Loading..." text. The foundation is strong -- the design system is well-architected and the core pages deliver a professional experience.
