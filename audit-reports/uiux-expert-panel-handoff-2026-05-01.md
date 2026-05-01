# AlphaDesk UI/UX Expert Panel Handoff

Date: 2026-05-01
Workspace: `/Users/GK/Downloads/alphadesk`
Scope: Current dirty working tree as-is. No product files were changed during this review.
Primary artifact paths: `frontend/`, `output/playwright/`, `output/playwright/uiux-panel/`

## Executive Summary

AlphaDesk currently rates **7.4 / 10** for UI/UX readiness.

The product has a strong premium trading-workstation identity and a notably mature execution-safety model. Dashboard and Trade are the standout surfaces. The design language is more distinctive than generic SaaS, and the trade page uses strong domain-native controls: quote freshness, buying power, session state, open order collision, position context, paper/live copy, and explicit submit blocking.

The main gaps are not basic polish. They are terminal-grade depth gaps:

- Mobile flows are structurally responsive but dense and very long.
- The workspace is fixed, not user-composable.
- Strategies, analytics, reports, and pipeline feel less rich than Dashboard and Trade.
- Offline/API error states create noisy toast stacks and weaken performance perception.
- Some target sizes and light-mode contrast fall below the quality bar.
- The AI assistant is useful, but not yet trust-grade for financial decision support because provenance, freshness, and execution boundaries need to be more explicit.

Recommended target before broader user exposure: **8.2+ / 10**. The fastest path is to improve mobile ergonomics, normalize error states, deepen chart/trade workflow controls, and make the workstation feel configurable.

## Panel Method

Four specialist reviewers evaluated the app independently:

1. **Visual Craft / Brand Systems**
   - Focus: visual identity, typography, color, density, component consistency, polish.
   - Overall: **7.8 / 10**

2. **Trading Workflow / Product UX**
   - Focus: dashboard awareness, strategy discovery, trade ticket, alerts, pipeline, reports, AI assistant, expert-user speed.
   - Overall: **7.4 / 10**

3. **Accessibility / Responsiveness / Frontend Quality**
   - Focus: WCAG-minded contrast, semantics, keyboard support, mobile behavior, loading/error/empty states, component APIs.
   - Overall: **7.5 / 10**

4. **Market Benchmark / UX Theory**
   - Focus: comparison to Bloomberg Terminal, IBKR TWS/Desktop, thinkorswim, TradingView, Robinhood Legend, and standard UX heuristics.
   - Overall: **7.0 / 10**

The panel used existing screenshots under `output/playwright/`, current source files under `frontend/src`, and fresh local captures under `output/playwright/uiux-panel/`.

## Local Review Context

The local Next dev server was started successfully at `http://127.0.0.1:3000`.

The dashboard routes are protected by `frontend/src/proxy.ts`. For review only, the evaluator used a structurally valid local JWT-shaped cookie to pass the frontend route gate. This did not authenticate against a backend. Because local API endpoints were unavailable, most `/api/v1/...` calls returned `404`. That produced useful degraded-state evidence, but it means the report should separate:

- **Current UI behavior under missing backend**
- **Design intent visible in source and existing screenshots**

Fresh screenshots captured:

- `output/playwright/uiux-panel/desktop-auth-clean-dashboard.png`
- `output/playwright/uiux-panel/desktop-auth-clean-trade.png`
- `output/playwright/uiux-panel/desktop-auth-clean-strategies.png`
- `output/playwright/uiux-panel/desktop-auth-clean-analytics.png`
- `output/playwright/uiux-panel/desktop-auth-clean-alerts.png`
- `output/playwright/uiux-panel/desktop-auth-clean-pipeline.png`
- `output/playwright/uiux-panel/desktop-auth-clean-reports.png`
- `output/playwright/uiux-panel/mobile-auth-clean-dashboard.png`
- `output/playwright/uiux-panel/mobile-auth-clean-trade.png`
- `output/playwright/uiux-panel/mobile-auth-clean-strategies.png`
- `output/playwright/uiux-panel/mobile-auth-clean-analytics.png`
- `output/playwright/uiux-panel/mobile-auth-clean-alerts.png`
- `output/playwright/uiux-panel/mobile-auth-clean-pipeline.png`
- `output/playwright/uiux-panel/mobile-auth-clean-reports.png`

Fresh route metrics are saved at:

- `output/playwright/uiux-panel/auth-metrics.json`

Notable local measurements:

- Desktop `/trade`: 51 interactive elements, page scroll height 2144px.
- Mobile `/trade`: 51 interactive elements, page scroll height 3287px.
- Mobile `/`: page scroll height 4451px.
- No horizontal overflow was detected in the fresh authenticated captures.
- Several touch targets are visually or measured below 44px, especially global chrome, timeframe buttons, and some compact icon controls.
- Console and UI were noisy because missing API routes triggered repeated `API 404: Not Found` notifications.

## Scorecard

### Reviewer Scores

| Reviewer | Visual | IA | Interaction | Trading Fit | A11y | Responsive | Perf Perception | Trust | Overall |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Visual Craft / Brand Systems | 8.0 | 7.5 | 7.5 | 8.5 | 8.0 | 7.0 | 7.5 | 8.5 | 7.8 |
| Trading Workflow / Product UX | 8.0 | 7.0 | 7.5 | 8.0 | 6.5 | 6.5 | 7.5 | 8.0 | 7.4 |
| Accessibility / Frontend Quality | 8.1 | 7.4 | 7.2 | 8.3 | 7.3 | 7.2 | 7.0 | 7.1 | 7.5 |
| Market Benchmark / UX Theory | 8.0 | 6.0 | 7.0 | 7.0 | 7.0 | 7.0 | 6.0 | 8.0 | 7.0 |

### Category Averages

| Category | Average | Interpretation |
|---|---:|---|
| Visual Design | **8.0** | Strong identity, premium terminal feel, mostly coherent palette. |
| Information Architecture | **7.0** | Strong Dashboard and Trade, weaker workstation configurability and secondary surfaces. |
| Interaction Polish | **7.3** | Good controls and confirmations, but uneven error surfaces and dense flows. |
| Trading Domain Fit | **8.0** | Safety gates and execution context are strong; advanced order/workspace depth is still missing. |
| Accessibility / Legibility | **7.2** | Solid semantics and dark-mode contrast; touch target and light-mode issues remain. |
| Responsiveness | **6.9** | No catastrophic overflow, but mobile is long, dense, and sometimes cramped. |
| Performance Perception | **7.0** | Skeletons and memoization exist; visible offline/waiting states weaken confidence. |
| Trust / Safety | **7.9** | One of the strongest areas, especially paper/live separation and submit blockers. |

**Overall panel average: 7.4 / 10**

## Research Benchmarks

### UX Theory Anchors

The evaluation used Nielsen Norman Group heuristics as a baseline:

- Visibility of system status
- Match between system and real-world user language
- User control and freedom
- Consistency and standards
- Error prevention
- Recognition rather than recall
- Flexibility and efficiency of use
- Aesthetic and minimalist design
- Error recovery
- Help and documentation

Official source: https://www.nngroup.com/articles/ten-usability-heuristics/

Relevant findings:

- AlphaDesk is strong on **visibility of system status** in trading safety contexts: blocked/review/pass, paper/live, stale/fresh, broker/data degraded.
- AlphaDesk is good on **match to real-world trading language**: buying power, session state, quote freshness, open orders, spread, pipeline, strategy status.
- AlphaDesk is mixed on **aesthetic and minimalist design**. Dashboard and Trade are dense by design, but mobile repeats too many panels and notifications.
- AlphaDesk is good on **error prevention** in execution flows. The trade ticket is a strong example.
- AlphaDesk is weaker on **help users recover from errors** when the backend is unavailable. Repeated generic `API 404` notifications are not actionable enough.

Accessibility benchmarks:

- WCAG 2.2 contrast minimum: normal text should generally meet 4.5:1, large text 3:1. Source: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 2.2 target size minimum: pointer targets should be at least 24x24 CSS px at minimum, with larger targets preferred for important controls. Source: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html

AlphaDesk dark-mode tokens are mostly designed around AA contrast, but light-mode/global fallbacks and compact target sizes need more work.

### Market Product Benchmarks

Official benchmark sources:

- Bloomberg Terminal: https://professional.bloomberg.com/products/bloomberg-terminal/
- Interactive Brokers platforms: https://www.interactivebrokers.com/en/trading/trading-platforms.php
- thinkorswim desktop: https://www.schwab.com/trading/thinkorswim/desktop
- TradingView features: https://www.tradingview.com/features/
- Robinhood Legend: https://robinhood.com/us/en/legend/

Market expectations for a serious trading workstation:

- Configurable layouts and linked widgets.
- Chart-native trading and order management.
- Advanced chart tools: indicators, drawings, compare, replay, volume/profile overlays.
- Watchlist/scanner/alert depth.
- Paper/live separation and clear account state.
- Advanced order types: TIF, bracket/OCO, stops, trailing stops, route/venue where relevant.
- Portfolio analytics, risk analytics, pre-trade and post-trade review.
- Fast status feedback and graceful degraded-data states.

AlphaDesk aligns well on:

- Safety gates.
- Paper/live distinction.
- Chart plus ticket co-location.
- Strategy framing.
- System readiness and audit/provenance language.

AlphaDesk trails on:

- User-composable workspaces.
- Chart-native order editing and drag management.
- Advanced order controls.
- Scanner/watchlist alert sophistication.
- Secondary-page data richness.
- Mobile compression and task prioritization.

## Evidence By Surface

## 1. Dashboard

Key files:

- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/components/layouts/DashboardLayout.tsx`
- `frontend/src/components/composites/TopBar.tsx`
- `frontend/src/components/layout/StatusStrip.tsx`

Screenshots:

- `output/playwright/dashboard-type-spacing-final.png`
- `output/playwright/uiux-panel/desktop-auth-clean-dashboard.png`
- `output/playwright/uiux-panel/mobile-auth-clean-dashboard.png`

Strengths:

- The "Control room" concept is strong and domain-specific.
- The hierarchy of system readiness, action stack, risk gates, capital canvas, provenance ledger, session telemetry, selected ticker, and live book creates an operating model.
- The dashboard avoids looking like a generic finance SaaS home page.
- The mobile priority brief is a good idea: it surfaces current issue, immediate action, risk gate, exposure, cash buffer, and session state early.
- There is explicit treatment for missing broker/account state.

Issues:

- Mobile dashboard is too long. Fresh capture showed roughly 4451px scroll height at 390px width.
- Some content repeats: action stack appears in priority brief and again in the full dashboard.
- Notification toasts overlap important content in degraded local mode.
- In degraded state, there is too much "Awaiting", "Locked", "Waiting", and "No timestamp" copy visible at once.
- A new user can understand the state, but must read many small labels to know what to do next.

Suggested next-agent work:

1. Make mobile Dashboard a true action-first summary:
   - Top: issue count, broker/data state, one next action.
   - Collapse provenance, telemetry, strategy fault line, and book into accordions.
   - Avoid rendering duplicate action cards above and below the fold.

2. Add a notification strategy for degraded backend:
   - One persistent "Data unavailable" system banner.
   - Group API errors by service.
   - Avoid stacking repeated `API 404` toasts.

3. Add "healthy state" screenshots/tests:
   - Current fresh local review mostly saw degraded state.
   - Keep fixture-driven visual tests for normal portfolio, warning, and blocked states.

## 2. Trade

Key files:

- `frontend/src/app/(dashboard)/trade/page.tsx`
- `frontend/src/components/composites/OrderBar.tsx`
- `frontend/src/components/composites/PriceChartPanel.tsx`
- `frontend/src/components/charts/ChartPane.tsx`
- `frontend/src/components/charts/TradingChart.tsx`

Screenshots:

- `output/playwright/trade-confidence-desktop-final.png`
- `output/playwright/trade-confidence-mobile-final-2.png`
- `output/playwright/trade-confidence-mobile-ticket-final.png`
- `output/playwright/uiux-panel/desktop-auth-clean-trade.png`
- `output/playwright/uiux-panel/mobile-auth-clean-trade.png`

Strengths:

- This is the strongest journey.
- It is domain-native: chart, quote, spread, order ticket, strategy attribution, side, quantity, order type, price, stop, and pre-submit confidence are co-located.
- `buildExecutionReadiness` blocks or reviews submit based on quote freshness, broker degraded state, hard checks, chart limitations, and final review.
- `buildConfidenceChecks` reviews quote freshness, buying power, open orders, session state, and position/contract context.
- Mobile has a sticky quote/chart/ticket/orders anchor nav.
- Paper/live destination copy is explicit.

Issues:

- Missing expert controls:
  - Time in force.
  - Bracket/OCO.
  - Trailing stop.
  - Slippage estimate.
  - Route/venue.
  - Risk-percent sizing.
  - Multi-leg ticket depth beyond current limited visible controls.
- Mobile trade page is very long. Fresh capture showed roughly 3287px scroll height.
- The chart can become a large empty surface when historical bars fail.
- Toast overlays can obscure chart and ticket.
- Some compact buttons and top chrome controls are below ideal touch size.

Suggested next-agent work:

1. Add an "Advanced order" drawer:
   - TIF.
   - Bracket/OCO.
   - Stop/trailing stop.
   - Slippage estimate.
   - Route/venue placeholder if not supported.
   - Risk-percent sizing.

2. Improve mobile trade compression:
   - Put chart and ticket in a segmented single-panel mode.
   - Keep confidence checks collapsible, with only blockers expanded.
   - Keep "Resolve quote first" and primary submit blockers sticky near the ticket.

3. Make chart failure less visually expensive:
   - Keep a compact failed-chart state.
   - Offer "Retry bars", "Use quote-only mode", and "Open execution ticket".

4. Add fixture visual tests:
   - Ready quote.
   - Stale quote.
   - No quote.
   - Broker degraded.
   - Buying power fail.
   - Working order collision.

## 3. Strategies

Key files:

- `frontend/src/app/(dashboard)/strategies/page.tsx`
- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/*`

Screenshots:

- `output/playwright/strategies-type-spacing-final.png`
- `output/playwright/strategies-dark-unified.png`
- `output/playwright/earnings-options-audit/02-desktop-detail-BMY.png`
- `output/playwright/earnings-options-audit/09-mobile-detail-BMY.png`
- `output/playwright/uiux-panel/desktop-auth-clean-strategies.png`

Strengths:

- Active/paused/coming-soon buckets are honest.
- Paper-only and not-ready-for-live labels are important trust cues.
- Earnings/options detail appears rich: calendar, IV rank, expected move, skew, strike ladder, news, and defined-risk setup controls.
- Strategy detail copy communicates thesis and risk.

Issues:

- Strategies page feels more like a SaaS catalogue than a premium terminal.
- Some 3-column card/KPI layouts feel generic relative to the stronger Dashboard and Trade design.
- Many em-dash or missing metrics create an unresolved feeling unless the user already understands why OOS or live data is missing.
- Mobile earnings/options detail is long and cramped.
- Some error or empty copy is desktop-biased, such as references to sidebars on mobile.

Suggested next-agent work:

1. Reframe Strategies as a research and readiness workbench:
   - Use list/table density for power users.
   - Add filters by readiness, asset type, live eligibility, risk, last signal, and evidence freshness.
   - Add a "why not live" explanation per disabled strategy.

2. Replace generic KPI strips with operating summaries:
   - Ready to trade.
   - Needs data.
   - Needs review.
   - Paper-only.
   - Blocked by risk.

3. Normalize missing metrics:
   - Replace bare em dashes with semantic states:
     - "No live trades yet"
     - "Backtest pending"
     - "Needs OOS validation"
     - "Broker data unavailable"

4. Add mobile-first strategy detail sections:
   - Summary.
   - Setup.
   - Risk.
   - Evidence.
   - Trade.

## 4. Analytics and Reports

Key files:

- `frontend/src/app/(dashboard)/analytics/page.tsx`
- `frontend/src/app/(dashboard)/reports/page.tsx`

Screenshots:

- `output/playwright/analytics-type-spacing-final.png`
- `output/playwright/uiux-panel/desktop-auth-clean-analytics.png`
- `output/playwright/uiux-panel/desktop-auth-clean-reports.png`

Strengths:

- Empty states are clear and honest.
- Reports include signs of operational maturity, including sorting, pagination, saved views, disabled empty exports, and CSV hardening according to panel code review.
- Analytics first-trade empty state is understandable.

Issues:

- These surfaces feel sparse compared with Dashboard and Trade.
- Empty pages occupy lots of space while offering few useful alternatives.
- Compared with Bloomberg-style pre/post-trade analytics, this is still narrow.
- Reports do not yet feel like a serious institutional audit surface when empty.

Suggested next-agent work:

1. Make empty analytics useful:
   - Show sample structure without fake performance.
   - Explain what unlocks each section.
   - Offer "Import history", "Run backtest", "View strategies", and "Place first paper trade".

2. Add risk analytics roadmap panels:
   - Drawdown.
   - Exposure by sector/factor.
   - Strategy attribution.
   - Trade expectancy.
   - Calendar P/L.
   - Slippage and execution quality once data exists.

3. For Reports:
   - Separate daily blotter, strategy performance, risk summary, and tax/export.
   - Keep export disabled but explain exactly why and what data is needed.

## 5. Alerts and Pipeline

Key files:

- `frontend/src/app/(dashboard)/alerts/page.tsx`
- `frontend/src/app/(dashboard)/pipeline/page.tsx`

Screenshots:

- `output/playwright/uiux-panel/desktop-auth-clean-alerts.png`
- `output/playwright/uiux-panel/desktop-auth-clean-pipeline.png`

Strengths:

- Alerts include create flow, empty state, and condition choices.
- Pipeline has live-run framing, idle state, run controls, and strategy/backtest handoff.
- Pipeline distinguishes live ops from strategy building.
- Confirmation and cancellation states appear to be represented in source.

Issues:

- Alerts look basic relative to TradingView expectations around alerts on drawings, watchlists, script conditions, multi-condition rules, delivery channels, and webhooks.
- Pipeline has good structure but can feel underpowered when empty.
- Some buttons are compact on mobile.

Suggested next-agent work:

1. Alerts:
   - Add multi-condition rules.
   - Add watchlist/strategy alerts.
   - Add channel routing: in-app, email, webhook placeholder.
   - Add preview copy: "This triggers when..."

2. Pipeline:
   - Add next-run timeline.
   - Add last successful run summary.
   - Add failed step recovery.
   - Add strategy-level run history.

## 6. AI Assistant

Key files:

- `frontend/src/components/layout/AICopilot.tsx`
- `frontend/src/components/layout/CommandPalette.tsx`

Strengths:

- Convenient page-aware assistant.
- Persists context.
- Quick prompts and keyboard access exist.
- Good candidate for expert acceleration.

Issues:

- Not yet trust-grade for trading decisions.
- Needs visible data provenance and freshness.
- Needs clearer boundary between analysis, suggestion, and execution.
- Some controls are too small on mobile.

Suggested next-agent work:

1. Add provenance on every AI response:
   - Data timestamp.
   - Symbols/strategies referenced.
   - Whether data is live, delayed, cached, demo, or unavailable.

2. Add an "advice boundary" banner:
   - AI can summarize and suggest checks.
   - AI cannot send orders.
   - User must confirm ticket inputs.

3. Add response confidence states:
   - Complete data.
   - Partial data.
   - Stale data.
   - No broker data.

## Cross-Cutting Findings

## Visual System

Strengths:

- `frontend/src/styles/design-tokens.css` has a strong warm ink and liquid gold palette.
- The product avoids generic purple/blue AI styling.
- Chartreuse/coral P/L semantics are differentiated from traffic-light defaults.
- The dashboard and trade views feel expensive and domain-specific.

Risks:

- Mixed icon libraries create subtle inconsistency and bundle hygiene concerns. Phosphor and Lucide both appear in dependencies and source.
- A blunt global typography scrub in `frontend/src/app/globals.css` normalizes arbitrary small text sizes, but may flatten intended hierarchy in edge components.
- Light-mode/global fallback contrast needs review.

Next-agent tasks:

1. Pick one icon family for core product UI.
2. Replace the global text-size scrub with tokenized component variants over time.
3. Run contrast checks against both dark and light tokens.

## Accessibility

Strengths:

- Skip links exist on dashboard routes.
- Main landmarks are present.
- Many regions have aria labels.
- Table headers and form labels exist in key components.
- Dark-mode tokens are mostly WCAG-minded.

Issues:

- Some top chrome and compact controls are below preferred touch size.
- Light-mode muted text and brand-on-light combinations need contrast review.
- Some route-local error files use older/generic fallbacks.
- Some mobile empty-state copy references desktop-only patterns.

Next-agent tasks:

1. Define minimum control sizes:
   - Desktop dense controls: at least 30 to 34px when non-critical.
   - Mobile primary/secondary controls: at least 44px.
   - Critical execution controls: 44px or larger on all touch breakpoints.

2. Add a token-level contrast audit script.

3. Fix route-local errors:
   - Replace generic errors with shared `DashboardError` patterns.
   - Include recovery steps.
   - Avoid raw API codes as primary user-facing copy.

## Performance Perception

Strengths:

- React Query defaults and dynamic provider loading are sensible.
- Skeletons and empty states exist.
- Some chart data is memoized.
- Reduced-motion and animation choices appear reasonably controlled.

Issues:

- Local degraded state generated repeated `API 404` UI noise.
- "Waiting for quote", "OFFLINE", and "Connecting" states dominate some views.
- The trade route imports a large chart stack directly.
- Some infinite/shimmer/motion treatments may add noise without improving comprehension.

Next-agent tasks:

1. Group repeated API errors into one service-level state.
2. Lazy-load heavy chart modules where possible.
3. Add performance budgets for route JS and interaction readiness.
4. Add fixture-based "healthy data" screenshots so performance perception is not judged only under failed API conditions.

## Trust and Safety

Strengths:

- Strongest product area besides visual design.
- Paper/live separation is explicit.
- Submit blockers are visible.
- Pre-submit confidence is domain-native.
- Session and quote freshness checks are strong.

Issues:

- AI assistant needs stronger boundaries.
- Advanced order workflows need deeper controls.
- Data provenance should be shown not just implied.
- Raw API errors degrade trust.

Next-agent tasks:

1. Show data provenance wherever decisions are made:
   - Quote timestamp.
   - Broker/account timestamp.
   - Strategy snapshot timestamp.
   - Demo/fallback/cached flags.

2. Add explicit "why blocked" hierarchy:
   - Hard block.
   - Needs review.
   - Advisory warning.
   - Passed.

3. Add audit trail affordances:
   - What data was used.
   - What checks passed.
   - What the user confirmed.
   - What endpoint/broker acknowledged.

## Prioritized Backlog For Next Agent

### P0: Trust, Error Noise, Mobile Blockers

1. **Deduplicate and group API error notifications**
   - Replace repeated `API 404: Not Found` toasts with a single service-level degraded banner.
   - Show affected services: portfolio, quotes, orders, strategies, pipeline.
   - Keep detailed errors inside notification center or debug drawer.

2. **Fix mobile Dashboard duplication and scroll length**
   - Collapse repeated action stack and telemetry.
   - Use an action-first mobile summary.
   - Keep only one primary next action visible above the fold.

3. **Fix mobile Trade compression**
   - Make chart/ticket/confidence checks more compact.
   - Collapse passed confidence checks.
   - Keep blockers expanded.
   - Preserve sticky mobile nav.

4. **Raise touch target sizes for global chrome**
   - Top bar icon buttons.
   - AI assistant controls.
   - Timeframe chips.
   - Compact dismiss buttons where not exempt.

### P1: Terminal-Grade Workflow Depth

5. **Add advanced order controls**
   - TIF.
   - Bracket/OCO.
   - Trailing stop.
   - Slippage estimate.
   - Route/venue placeholder.
   - Risk-percent sizing.

6. **Make Strategies a readiness workbench**
   - Table/list density option.
   - Filters by readiness, live eligibility, risk, strategy type, last signal.
   - Replace bare missing metrics with semantic missing-data states.

7. **Deepen Alerts**
   - Multi-condition alerts.
   - Watchlist and strategy alerts.
   - Channel routing.
   - Preview sentence.

8. **Improve AI assistant trust**
   - Data provenance on responses.
   - Freshness labels.
   - Clear advice/execution boundary.
   - No order execution from AI.

### P2: System Polish and QA Gates

9. **Unify icon system**
   - Prefer one icon library in app chrome and product surfaces.
   - Phosphor is currently more aligned with the product personality.

10. **Replace blunt global typography overrides over time**
    - Move repeated arbitrary text sizes into components/tokens.
    - Keep minimum readable floors without `!important` broad selectors.

11. **Add fixture-driven visual states**
    - Healthy dashboard.
    - Degraded dashboard.
    - Trade ready.
    - Trade blocked by quote.
    - Trade blocked by buying power.
    - Mobile dashboard summary.
    - Mobile trade ticket.

12. **Strengthen QA scripts**
    - Remove hardcoded production assumptions.
    - Include newer earnings/options routes.
    - Fix always-pass loading checks.
    - Add token contrast checks.
    - Add mobile touch-target audit.

## Suggested Acceptance Criteria

Use these as practical gates before calling the UI an 8+ experience:

1. **Mobile Dashboard**
   - At 390px width, the first screen shows system health, primary issue, and one next action.
   - No repeated API toast stack over main content.
   - Scroll height reduced materially from the current roughly 4451px degraded capture.

2. **Mobile Trade**
   - At 390px width, user can reach chart, ticket, blockers, and orders without losing context.
   - Passed checks are collapsed by default.
   - Critical controls are at least 44px tall.

3. **Error State**
   - Missing backend produces one readable degraded-data state, not many raw API toasts.
   - User sees what is unavailable, what remains safe, and what action is possible.

4. **Trade Ticket**
   - TIF and bracket/OCO path exist, even if some controls are paper-only or disabled with explicit rationale.
   - Slippage and risk-percent sizing are visible or planned behind disabled controls.

5. **Strategies**
   - Missing metrics are semantically explained.
   - Strategy readiness can be scanned without opening every card.
   - Mobile strategy detail does not depend on sidebar language.

6. **A11y**
   - Dark and light tokens pass contrast audits for normal text where applicable.
   - Key mobile controls meet 44px target recommendations.
   - Error pages use shared accessible patterns.

7. **Market Benchmark**
   - Product can credibly claim:
     - Chart plus ticket workflow.
     - Paper/live safety gates.
     - Strategy readiness workbench.
     - Alerts beyond single symbol threshold.
     - Portfolio/risk analytics path.

## Files And Artifacts To Inspect First

Source:

- `frontend/src/styles/design-tokens.css`
- `frontend/src/app/globals.css`
- `frontend/src/app/(dashboard)/layout.tsx`
- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/app/(dashboard)/trade/page.tsx`
- `frontend/src/app/(dashboard)/strategies/page.tsx`
- `frontend/src/app/(dashboard)/analytics/page.tsx`
- `frontend/src/app/(dashboard)/alerts/page.tsx`
- `frontend/src/app/(dashboard)/pipeline/page.tsx`
- `frontend/src/app/(dashboard)/reports/page.tsx`
- `frontend/src/components/layout/TopBar.tsx`
- `frontend/src/components/layout/StatusStrip.tsx`
- `frontend/src/components/layout/AICopilot.tsx`
- `frontend/src/components/layout/CommandPalette.tsx`
- `frontend/src/components/composites/OrderBar.tsx`
- `frontend/src/components/composites/PriceChartPanel.tsx`
- `frontend/src/components/charts/ChartPane.tsx`
- `frontend/src/components/charts/TradingChart.tsx`
- `frontend/src/components/error/DashboardError.tsx`

Screenshots:

- `output/playwright/dashboard-type-spacing-final.png`
- `output/playwright/dashboard-type-spacing-final-mobile.png`
- `output/playwright/trade-confidence-desktop-final.png`
- `output/playwright/trade-confidence-mobile-final-2.png`
- `output/playwright/trade-confidence-mobile-ticket-final.png`
- `output/playwright/strategies-type-spacing-final.png`
- `output/playwright/analytics-type-spacing-final.png`
- `output/playwright/earnings-options-audit/02-desktop-detail-BMY.png`
- `output/playwright/earnings-options-audit/09-mobile-detail-BMY.png`
- `output/playwright/uiux-panel/desktop-auth-clean-dashboard.png`
- `output/playwright/uiux-panel/mobile-auth-clean-dashboard.png`
- `output/playwright/uiux-panel/desktop-auth-clean-trade.png`
- `output/playwright/uiux-panel/mobile-auth-clean-trade.png`

Metrics:

- `output/playwright/uiux-panel/auth-metrics.json`
- `output/playwright/earnings-options-audit/trade-mobile-summary.json`

QA scripts to inspect:

- `qa-responsive.mjs`
- `qa-perf-a11y.mjs`
- `qa-lighthouse.mjs`
- `qa-final-sweep.mjs`
- `qa-uiux-eval.mjs`
- `qa-expert-ux.mjs`

## Final Recommendation

Treat AlphaDesk as a strong 7.x product with a real identity and a strong safety model, not as a generic prototype. The next agent should avoid repainting the product from scratch. The most valuable work is targeted:

1. Reduce mobile cognitive load.
2. Normalize degraded API/error behavior.
3. Add terminal-grade order and alert controls.
4. Improve strategy readiness scanning.
5. Make AI and data provenance trust-grade.
6. Add fixture-driven visual/UX QA so the product can be judged in healthy, degraded, and mobile states.

If those are done well, AlphaDesk can plausibly move from **7.4 / 10** to **8.2 to 8.5 / 10** without changing its core visual direction.
