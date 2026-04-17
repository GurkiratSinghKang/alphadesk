# Frontend Audit — AlphaDesk (tradingalpha.net)
Auditor: Senior Frontend Engineer (25 yrs)
Date: 2026-04-17

## Executive Summary

AlphaDesk looks surprisingly polished for a solo / small-team build: the dark palette is coherent, the dashboard layout is dense in a Bloomberg-adjacent way, keyboard shortcuts and a command palette are real, and there are genuinely thoughtful touches (skeleton loaders, reduced-motion support, tabular-nums, flash-on-tick animations). But the moment you read the source, trust evaporates. Core "trading" surfaces fabricate numbers when real data is missing — strategy pages invent a Sharpe ratio from `total_return_pct / max_drawdown`, the Analysis panel derives RSI/MACD/ADX from a single opaque `technicalScore`, the Options chain silently falls through to a seeded-RNG chain with fake Greeks, and the Signals tab ships literal hardcoded "NVDA Golden Cross 1h ago" strings in prod with `opacity-40` to look "dim" instead of labeling as empty. None of these fabrications is clearly disclosed at the pixel; a professional trader will spot one within 30 seconds and assume the whole terminal is vapor.

**Top 3 risks:**
1. **Fabricated/synthesized data shown as real** across Analysis, Strategy metrics, Options chain, and Signals tab — regulatory, reputational, and legal exposure for a "trading" app handling real money.
2. **ChartPanel carries 1,114 lines with `BUG #10/#11/#12/#25` markers still in source, demo-OHLCV generator still the fallback, and hardcoded ticker prices (`SPY 590, AAPL 230`)** — commit history says "ChartPanel stability" was fixed but the code says otherwise.
3. **Login/auth UX is 1998-era**: mailto "forgot password" and "request access", no password show/hide, no account lockout UX, no 2FA, no session timeout communication, no CAPTCHA — not good enough for anything adjacent to brokerage credentials.

## Severity Legend
P0 = ship-blocker, P1 = fix this week, P2 = fix this month, P3 = nice-to-have

## Findings

### [P0] Strategy detail metrics are fabricated when real data is missing
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/page.tsx:378-397`
**What:** When the backend returns 0/missing values, the UI silently substitutes synthesized numbers derived from other fields:
- Sharpe: `(total_return_pct / (Math.abs(max_drawdown) || 5))` when real sharpe is 0
- Max Drawdown: `(-Math.abs(total_return_pct) * 0.4)` when real is 0
- Win Rate: `Math.min(65, 50 + total_return_pct * 2)` when real is negative
Only one of three is tagged `(est.)` via the `MetricCard.estimated` prop, and even that prop isn't actually passed on these three.
**Why it matters:** A trader looking at "Sharpe 1.47" will assume it's measured from returns. It isn't — it's a ratio involving a made-up drawdown. This is the single biggest trust-killer in the app and is arguably misleading-disclosure territory.
**Fix:** Show "—" or "Insufficient data" when the underlying field is 0/null. Never derive one metric from another. If you must estimate, label it as "estimated" in the cell and in a tooltip explaining the formula.

### [P0] Analysis panel invents technical indicators from a scalar score
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/AnalysisPanel.tsx:202-212`
**What:** RSI/MACD/EMA/ADX/OBV indicators are not computed from price data. They're a function of the AI-returned `technicalScore`:
```
{ name: "RSI (14)", value: (40 + score * 0.3).toFixed(1), ... }
{ name: "ADX", value: (20 + score * 0.15).toFixed(1), ... }
```
So a stock with score 70 will always display "RSI 61, ADX 30.5" regardless of actual price action.
**Why it matters:** These are named, precise-looking technical indicators. Showing invented values under those labels is the defining anti-pattern of "fake trading terminal." Any quant who glances at RSI on five tickers and sees it perfectly correlated with another panel's "Score" will close the tab and never return.
**Fix:** Either compute these from the OHLCV bar data you already fetch (you do so in `TradingChart.tsx`; reuse `computeEMA`, add real RSI/MACD/ADX computations) or remove the panel entirely. The fake data is worse than no data.

### [P0] Watchlist Signals tab renders hardcoded demo signals in production
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx:766-804`
**What:** The Signals tab is a literal static array shipped to prod:
```
{ symbol: "NVDA", signal: "Golden Cross", type: "bullish", ago: "1h ago" },
{ symbol: "AAPL", signal: "RSI Oversold", ago: "2h ago" },
{ symbol: "TSLA", signal: "Death Cross", ago: "4h ago" },
...
```
and the row uses `opacity-40` to make it look "dim/less important" instead of marked as demo. Clicking the row still calls `setSelectedSymbol(s.symbol)`, so the interaction is fully wired — it just fires off a fake signal.
**Why it matters:** Users will read "NVDA Golden Cross 1h ago" and believe it's a real system-detected signal happening right now. The `opacity-40` actively hides the fact from visual inspection.
**Fix:** Wire the tab to the same `LiveSignalFeed` / pipeline data the dashboard uses, or make the tab empty with "Signals coming soon." Never ship static demo data in a trading surface.

### [P0] Options chain fabricates IV, volume, OI, and Greeks on fallback
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/OptionsPanel.tsx:37-104, 243`
**What:** When the real chain API returns empty, the panel falls through to `generateChain(spotPrice, expiry)`, a seeded RNG that produces plausible-looking IV (`0.22 + Math.abs(moneyness)*0.3 + rng()*0.05`), volume (`100 + rng()*5000`), OI, bid/ask, and delta. There is a `usingGeneratedChain` flag but I can find no prominent banner/watermark analogous to the chart's "DEMO" overlay on the options panel itself.
**Why it matters:** Traders make real position-sizing decisions from IV and OI. Fake OI of 17,000 for an otherwise illiquid strike will fill you at a price you can't exit.
**Fix:** When chain data is unavailable, show an empty state, not a seeded-RNG chain. If you must keep the fallback for dev/demo, put a prominent "SIMULATED OPTIONS DATA — DO NOT TRADE" overlay with the same visual weight as the chart DEMO watermark (`ChartPanel.tsx:776-790`).

### [P0] Hardcoded option Greeks on the trade builder
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/TradePanel.tsx:124-141`
**What:** When options are added as legs, gamma/theta/vega are hard-coded constants regardless of the actual option:
```
gamma: 0.01, theta: -0.02, vega: 0.08,
```
**Why it matters:** The Greeks aggregate view at the top of TradePanel claims to show "net delta/gamma/theta/vega" — but those are nonsense because three of four are constants. A trader sizing a net-theta-positive portfolio would get the wrong answer.
**Fix:** Use the per-strike greek values from the options chain. If missing, label as "—" instead of filling constants.

### [P0] Economic Calendar ships fabricated forecast/previous values with "Demo Data" badge
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/EconomicCalendar.tsx:57-127, 168-170`
**What:** Forecasts like "155K" for NFP, "2.4%" for CPI, "1.38M" for Housing Starts are literal strings hardcoded in the `templates` array. The component does render a small "Demo Data" amber badge and a footer line about connecting an API — but the forecast numbers themselves are visually indistinguishable from real data.
**Why it matters:** Users who don't notice the pill-sized amber tag will anchor their trading on fake macro consensus. Hardcoded numbers also go stale (a 2.4% CPI forecast in April 2026 is a specific economic claim).
**Fix:** Delete the hardcoded forecasts. Show date/event name only, with a clear "forecast unavailable — connect economic-calendar API" per row. Or gate the entire component until a provider is wired.

### [P0] ChartPanel still carries "BUG #10 / #11 / #12 / #25" markers in source
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx:44, 239, 409, 714`
**What:** Comments like `// BUG #10: chartData depends on timeframe` and `// BUG #25: Listen for timeframe change events dispatched by keyboard shortcuts` are still in production source. `generateDemoOHLCV()` hard-codes `SPY === 590, AAPL === 230, fallback 150 + Math.random()*300` on line 48.
**Why it matters:** Commit `5f57ada` claims "ChartPanel stability"; these bug-trail comments suggest the team is tracking work via inline comments instead of an issue tracker, and the fallback demo price ladder gives the false impression that the chart has "data" when the API fails. A new engineer reading this file cannot distinguish resolved from open bugs.
**Fix:** Strip the `BUG #nn` comments. Remove hardcoded per-symbol demo prices — emit an explicit "no data available" state instead of generating a plausible SPY candle series.

### [P0] Login forgot-password and request-access are mailto links
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/login/page.tsx:164-169, 224-228`
**What:** "Forgot password?" opens `mailto:support@tradingalpha.net`. "Request Access" opens `mailto:legal@tradingalpha.net`. There is no in-app recovery or onboarding flow.
**Why it matters:** For a platform that claims "institutional-grade" and handles brokerage API keys, mailto is unacceptable. Half of users click and get a confusing mail compose window; the other half bounce. Password recovery with no verification is also a security hole — an attacker emailing support@ can impersonate a real user by guessing details.
**Fix:** Build a proper password-reset flow (token-signed link). Build a proper access-request form (reCAPTCHA + DB entry + admin approval). Until those exist, at minimum, put the mailto inside a `<dialog>` that explains what will happen and pre-fills a structured subject.

### [P0] No password show/hide, no caps-lock warning, no lockout UX on login
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/login/page.tsx:231-239, 253-257`
**What:** The password input is a plain `type="password"`. There's a `failCount >= 3` warning ("Too many attempts may result in temporary lockout") but no actual cooldown timer, no progressive delay, no captcha-after-N-failures, no "account locked — wait X minutes" state. No `aria-invalid` wiring either.
**Why it matters:** Basic credential-entry affordances that every bank login has had since ~2010.
**Fix:** Add an eye-icon toggle for show/hide, surface caps-lock-detected hint, implement real rate limiting on the backend with a structured 429 response the UI can display as "Locked until HH:MM."

### [P1] Default Button variant has NO hover state
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/button.tsx:11`
**What:** `default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80"` — the hover rule is scoped with `[a]:` which only applies when the button is rendered as an anchor (link-style). A regular `<button>` has zero hover feedback in the primary variant.
**Why it matters:** Buttons are everywhere (Submit, Sign In, Place Order, Save Preset…). "Hover does nothing" on the single most important CTA style reads as broken. In a trading app where a Buy button not acknowledging a hover could make a user double-click, it's worse than cosmetic.
**Fix:** Change to `hover:bg-primary/90` (drop the `[a]:` prefix). Add `active:bg-primary/80` for press.

### [P1] StrategyCard `Card` has `role="button"` but also nested interactive children
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/StrategyGrid.tsx:46-53`
**What:** The outer `<Card>` carries `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space), and `onClick`. Most cards also contain a nested `<Badge>` that is non-interactive, which is fine, but the pattern is fragile — any future nested `<button>` inside a `role="button"` ancestor is a WCAG violation and will break keyboard focus order.
**Why it matters:** Keyboard users will receive double tab stops if anyone adds an action button into the card footer. Screen readers announce "button, Active, +4.7%, 3 positions, …" as one long string.
**Fix:** Use a proper `<button>` wrapping semantic content OR make only the card title the interactive element, leave the container decorative.

### [P1] Strategy page: "Rolling Beta" tab shows "Beta chart available with more historical data." as a permanent empty state
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/page.tsx:779`
**What:** The correlation tab has a card titled "Rolling Beta to SPY" that, when data is present (length > 0), still only renders a placeholder paragraph — there is no chart rendering code for rolling beta at all.
**Why it matters:** The section implies functionality that doesn't exist. At minimum the section title is a lie.
**Fix:** Either implement the rolling-beta chart (`analytics.rolling_beta` already has `{date, beta}[]` — trivial to render with the existing `EquityCurve` SVG pattern) or delete the section.

### [P1] "S M T W T F S" weekday headers in PnlCalendarMini have duplicate keys with no disambiguation
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/PnlCalendarMini.tsx:76-78`
**What:** `["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)` — a screen reader reading the grid hears "S, M, T, W, T, F, S" with no context that Tuesday/Thursday or Sunday/Saturday are distinct.
**Why it matters:** Calendar is unusable for SR users. Also fails WCAG 1.3.1 (Info and Relationships).
**Fix:** Use `Sun/Mon/Tue/Wed/Thu/Fri/Sat` for the visual label, or keep the single letters but add `aria-label="Monday"` etc. on each column cell.

### [P1] White text on low-alpha colored P&L tiles is below WCAG contrast threshold
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/PnlCalendarMini.tsx:96, 113-118`
**What:** Cells render with `style={{ opacity: 0.3 + intensity * 0.7 }}` but the text is `text-white` unconditionally. At intensity ≈ 0.1–0.2 on a dark bg, the effective text alpha is ~0.37 — well under 4.5:1 contrast for normal text and 3:1 for large text per WCAG 2.1 AA.
**Why it matters:** Small-intensity days will have barely-legible dollar figures. Accessibility + scannability both hurt.
**Fix:** Either keep the cell background fully opaque and use border alpha for intensity, or use `text-foreground` for low-intensity cells.

### [P1] `role="marquee"` is not a valid ARIA role
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TickerTape.tsx:30`
**What:** `<div role="marquee" aria-label="Live market ticker">` — `marquee` is an obsolete HTML element but not a valid ARIA role. Screen readers will either ignore the role or get confused. Also, the ticker animation is never paused when the user is navigating via keyboard and can be a focus trap / reading nightmare.
**Why it matters:** Fails WCAG 4.1.2 Name/Role/Value. Also WCAG 2.2.2 (Pause/Stop/Hide) is violated — the marquee auto-plays with no user control for stopping.
**Fix:** Use `role="region"` or remove the role; add a pause/stop button per WCAG 2.2.2; use `aria-live="off"` to prevent runaway announcements.

### [P1] Market store overwrites cumulative `volume` with a single-tick value
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/stores/market.ts:40-79`
**What:** The WebSocket `updateQuote` spreads incoming `quote` over existing state with `{ ...existing, ...quote }`. For `volume`, `quote.volume` overwrites `existing.volume`. The code correctly preserves `close/open/high/low` with explicit merge logic, but volume merging is wrong: if the WS emits a tick's trade size (`100`) it replaces the cumulative day volume (`12.5M`).
**Why it matters:** The volume field on watchlist and header is a daily cumulative. Replacing it with a tick volume makes the watchlist volume column bounce from millions to tens on every tick. Commit `5f57ada` says "preserve snapshot fields" — volume is one of them and was missed.
**Fix:** Do the same `Math.max(existing.volume, quote.volume)` or simply `quote.volume > existing.volume ? quote.volume : existing.volume`, since cumulative day volume is monotonically non-decreasing.

### [P1] `Math.max(existing.high, quote.high)` and `Math.min` on `low` logic is broken when values are 0 or undefined
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/stores/market.ts:55-56`
**What:** `high: Math.max(existing.high || 0, quote.high || 0) || existing.high` — when both are 0 this falls back to `existing.high` which might be `undefined`, yielding a literal `undefined` stored in the quote. `low` uses a different, more convoluted pattern. This inconsistency is a bug magnet.
**Why it matters:** Missing `high/low` will render `—` in the header, but the UI code uses `(quote.high ?? 0).toFixed(2)` which prints `0.00` instead of `—`, reinforcing the false impression of "we have data but it's zero."
**Fix:** Track quote field provenance explicitly (snapshot vs stream) or use sentinel `null` and update all display sites to treat `null` as "—".

### [P1] Analytics page uses hardcoded $100,000 baseline for all drawdown/return calculations
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx:23, 35`
**What:** `computeDailyReturns` and `computeDrawdown` both use `const base = 100000 + curve[i-1].cumulative_pnl;` — the starting equity is assumed to be $100k.
**Why it matters:** For any user with a different account size (paper defaults to 100k but that's not guaranteed, and live accounts vary from $2k to $2M+), every percentage return, every drawdown, and every rolling Sharpe is wrong. For a $10k account, a $1k gain is 10% — it'll render as 1%.
**Fix:** Fetch the actual starting balance from the portfolio summary or backend. Thread it through as a prop.

### [P1] Username in the profile menu is literally the hardcoded string "admin"
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/ProfileMenu.tsx:42, 37`
**What:** `<p className="text-xs font-medium text-foreground">admin</p>` and `<DropdownMenuTrigger …>A</DropdownMenuTrigger>`. The avatar letter and the username are not wired to any user object.
**Why it matters:** Small detail but it reads as "this app has no concept of users yet" — which is true from the login flow as well. For a multi-tenant SaaS you'd expect the user's name and initials.
**Fix:** Expose a `useAuthUser()` hook that pulls the logged-in user's name + email + initial from the session, render those here.

### [P1] Dashboard has no mobile layout — only the Trade page has a mobile tab bar
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` and `trade/page.tsx:122-145`
**What:** The Trade page has a proper `lg:hidden` tab bar (chart/watchlist/analysis/order). The dashboard `page.tsx` does not — it relies entirely on Tailwind `lg:grid-cols-5` etc., which collapses to a single-column stack on mobile. MorningBrief, PortfolioHero, StrategyGrid, MarketContext, Movers all stack vertically creating a ~7000px-long scroll.
**Why it matters:** On a phone this is basically unusable. Professional traders do check portfolios on mobile — an endless stack is worse than showing a focused subset.
**Fix:** Add mobile-specific workspace config that hides below-the-fold sections (StressTest, StrategyCorrelation, EconomicCalendar) on `< lg`, introduces section anchors, or uses a bottom-tab nav analogous to Trade.

### [P1] `ProfileMenu` avatar letter is hardcoded "A", not computed from the user
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/ProfileMenu.tsx:37`
**What:** The circle says "A" unconditionally. See finding above — combined with the "admin" username, strongly suggests this was built and tested with a single seed account.
**Fix:** `user.displayName.charAt(0).toUpperCase()`.

### [P1] Trade page imperative layout uses `position: absolute` + pixel constants, breaks at non-standard viewport heights
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx:21-25, 93-96, 152-167`
**What:** `TOPBAR_H = 72, WATCHLIST_W = 240, ANALYSIS_W = 300, TRADE_PANEL_W = 420` are hardcoded and layout uses `calc(100vh - ${TOPBAR_H}px - ${optionsPanelHeight}px - 6px)`. If TopBar height ever shifts (e.g. when ticker tape appears), the chart area overlaps or leaves a gap. No resize observer is watching header.
**Why it matters:** The ticker tape above StatusStrip conditionally shows, which changes total header height. The trade page doesn't react to that — I can't verify from screenshot alone, but the math guarantees either overlap or blank stripe.
**Fix:** Use a flex/grid layout or measure header with ResizeObserver and publish via context.

### [P1] Onboarding tour has no focus trap, no focus restoration, skip button cannot be reached without tab-trap logic
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/OnboardingTour.tsx:207`
**What:** `<div className="fixed inset-0 z-[100]" aria-modal="true" role="dialog">` sets the ARIA dialog role but does not trap focus within the tooltip, does not call `.focus()` on mount, and does not restore focus to the previously active element on dismiss. Also, the spotlight cutout is drawn with `boxShadow` which does not actually mask the underlying content from pointer events.
**Why it matters:** Fails WCAG 2.4.3 (Focus Order) and 2.1.2 (No Keyboard Trap). Screen-reader users cannot reach the Skip button reliably.
**Fix:** Use a real focus-trap (`react-focus-lock` or manual) and `document.activeElement` save/restore.

### [P2] Swallowed errors hide real failures (36 occurrences across 19 files; 8 use `catch { /* ignore */ }`)
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts`, `components/panels/ChartPanel.tsx` (3), `components/panels/WatchlistPanel.tsx` (4), multiple others
**What:** Common pattern: `try { ... } catch { /* ignore */ }`. ChartPanel has three such blocks. The Options price-alert delete handler (`ChartPanel.tsx:544`) fires off `deletePriceAlert` and swallows any error — the UI never tells the user the delete failed.
**Why it matters:** Silent failures make bugs undiscoverable in production. For a money app, the user should always see "Failed to delete alert" rather than stare at a list that didn't change.
**Fix:** Replace `/* ignore */` with `toast({ type: "error", message: "..." })` or at minimum `console.warn` routed to Sentry/logging.

### [P2] Strategy detail page re-fetches benchmark SPY bars on every equity_curve identity change, not length change
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/[id]/page.tsx:256-267`
**What:** `useEffect(() => {...}, [perf?.equity_curve])` — the dependency is the array reference, which changes every `fetchData()` call, even when values are identical. Each dependency change re-calls `getBars("SPY", "D", ...)`.
**Why it matters:** Unnecessary network calls on every page revisit plus wasted render cycles.
**Fix:** Depend on `perf?.equity_curve?.length` or memoize with `JSON.stringify`.

### [P2] Chart annotations stored per-symbol in `localStorage` with no quota/cleanup, unbounded key growth
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx:151-171`
**What:** Annotations are stored at `alphadesk-annotations-${selectedSymbol}`. Users who cycle through many symbols will accumulate one localStorage key per symbol forever. Same pattern with `MorningBrief.tsx:55-65` — that one does clean up old dismiss keys, but annotations does not.
**Why it matters:** localStorage has ~5MB limit, users will hit it eventually; also slow `Object.keys(localStorage)` on every read.
**Fix:** Store all annotations under one key as `{[symbol]: Annotation[]}`, with an optional per-user cap.

### [P2] Flash-on-tick colors by daily direction not tick direction, so a +$0.05 tick on a -3% day flashes red
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx:204-221`
**What:** Comment says this is intentional: "A stock that's up +1.5% for the day should always flash green, even when an individual tick is slightly lower." That's backwards from every major terminal convention (Bloomberg, TWS, ThinkOrSwim all flash by tick direction, not daily direction).
**Why it matters:** Traders scan watchlists for momentary upticks/downticks. Flashing by daily makes the animation meaningless — it's constant green on an up day regardless of tick. Violates the Principle of Least Surprise.
**Fix:** Flash by tick direction. Keep a separate daily-direction affordance (the percent cell already has a green/red bg class).

### [P2] Chart demo data is generated from `Math.random()` (line 48) but also `rng()` with a seed (line 67) — inconsistent
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx:48, 67-70`
**What:** The initial price is `150 + Math.random() * 300` (non-seeded, different every render), but the per-bar OHLC movement uses a seeded RNG. So the demo chart starts at a new base every remount but produces deterministic bars from there.
**Why it matters:** Hydration mismatch potential on SSR + visible "chart jumps" when the component remounts (e.g., after resize layout change).
**Fix:** Fully seed the generator or — better — remove the demo generator entirely. If the API fails, show the empty state.

### [P2] Risk dashboard uses a 60-row hardcoded beta lookup table
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/RiskDashboard.tsx:25-37`
**What:** `NVDA: 1.7, TSLA: 2.0, AAPL: 1.2, …` — static betas. Positions outside the list return null, and even for listed tickers the betas are frozen in time.
**Why it matters:** Tesla's beta has swung between 1.5 and 2.5 in the last five years. A risk dashboard using stale betas is an illusion of risk measurement.
**Fix:** Compute rolling beta server-side from daily returns vs SPY, cached. Fall back to "Beta N/A" when untrained, not to a hard-coded guess.

### [P2] `role="button"` without `aria-pressed` on the watchlist row which can be in a "selected" state
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/WatchlistPanel.tsx:252-262`
**What:** The row has `role="button"`, `tabIndex={0}`, is a toggle ("selected" renders with `bg-primary/10 border-l-primary`), but doesn't expose the selection state via `aria-pressed` or `aria-selected`.
**Why it matters:** A screen reader user cannot tell which symbol is currently selected.
**Fix:** Add `aria-pressed={isSelected}` or change to role="option" with `aria-selected`.

### [P2] Chart DEMO overlay is hidden behind annotations and other z-[3..7] layers — only visible if no annotations/lines exist
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx:778, vs. 972, 994, 1038`
**What:** The "DEMO" watermark has `z-[4]`. Annotation labels are `z-[7]`, trendline SVGs are `z-[3]`. If a user adds annotations on a symbol whose real API fails, the annotation labels can visually cover the DEMO watermark area, reducing its prominence.
**Why it matters:** Less prominent demo indicator = more chance a user trusts the chart prices.
**Fix:** Bump the demo watermark z-index and the badge z-index above any drawing overlay.

### [P2] `PriceAlert delete` click handler inside alert popover uses `onClick={async () => { try { await deletePriceAlert… } catch { /* */ } }}` with no optimistic update and no feedback
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx:542-547`
**What:** Silently deletes, silently refetches. No spinner on the delete button, no optimistic row removal, no error toast.
**Why it matters:** Feels unresponsive. User may tap-tap-tap and delete additional alerts.
**Fix:** Optimistic local removal + rollback on failure + toast confirmation.

### [P2] No skeleton for Options panel, ChartPanel inside Trade page — shows `animate-pulse bg-[var(--panel)]` block but no shape hint
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/trade/page.tsx:14, 18`
**What:** `loading: () => <div className="animate-pulse bg-[var(--panel)] rounded-lg h-full w-full" />`
**Why it matters:** On a slow connection users see a giant pulsing block with no structure — compare to the dashboard page which has column/row-shaped skeletons. Inconsistent UX.
**Fix:** Add shaped skeletons for ChartPanel (toolbar strip + big rect) and OptionsPanel (table header + rows).

### [P2] `suppressHydrationWarning` on both `<html>` and `<body>` masks real hydration bugs
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/layout.tsx:47-49`
**What:** Both root elements have `suppressHydrationWarning`. This was likely added during the "hydration crash" firefight (commit `4eb4e89`). But silencing is not fixing — any future hydration mismatch introduced anywhere under `<html>` will be silenced.
**Why it matters:** The whole app is now blind to SSR/CSR drift. The current workaround is `mounted` flags in every client tree (`DashboardLayout.tsx:19-22, 39-47`, `PnlCalendarMini:20-22`, `StatusStrip:12-13`, etc.) — that's an architectural smell.
**Fix:** Remove the suppressions, diagnose remaining mismatches (most are `localStorage`-driven persisted state; move rehydration into the Providers boundary as already done in `providers.tsx:64-87`, and render a stable skeleton instead of dual code paths).

### [P2] `useEffect` with `[regime]` re-runs the pipeline fetch every time regime changes — causes extra network calls on busy days
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:251-311`
**What:** Pipeline fetch depends on `regime`. `regime` comes from `useRegime()` which refetches periodically; each refetch with a changed reference restarts the pipeline polling interval.
**Why it matters:** You get duplicate 60-second intervals every time regime refetches. The `clearInterval` runs too late on unmount, but effect flush + re-run will still spam the API.
**Fix:** Move `regime` out of the effect dependencies; use a ref to always read the latest value.

### [P3] Text-size hierarchy drifts between `text-sm`, `text-xs`, `text-[11px]`, `text-[10px]`, `text-[9px]` in the same component
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ChartPanel.tsx` (15+ sites), `WatchlistPanel.tsx` (23+ sites)
**What:** Same component mixes `text-xs / text-[11px] / text-[10px]` for "sub-labels." Typography scale (`.text-label, .text-body, .text-hint` defined in `globals.css:251-283`) exists but is barely used.
**Why it matters:** Weakens brand/identity; makes future redesign painful; screen-reader zoom behavior is unpredictable.
**Fix:** Enforce `text-label / text-hint` utility classes; lint `text-[Npx]` as a code-smell.

### [P3] Focus ring on `:focus-visible` is 2px solid primary with 2px offset — good — but many bespoke buttons override with their own outline-none, skipping the ring
**Where:** `globals.css:147-150` vs. many ad-hoc `<button className="... outline-none">` throughout
**What:** Search reveals dozens of button/link elements with `hover:*` but no explicit `focus-visible:ring-*` classes, relying on the global `:focus-visible` which is overridden by Tailwind's `outline-none`.
**Why it matters:** Keyboard users tabbing through get inconsistent focus indication.
**Fix:** Define a shared `btn-focus` class and apply it. Or remove stray `outline-none`.

### [P3] Flash keyframes use `background-color` transitions — not composited on the GPU
**Where:** `globals.css:181-188`
**What:** Animating `background-color` triggers paint each frame. On lists of 100 watchlist rows flashing, this can be jank.
**Why it matters:** Chromatic flash is lower priority than general layout perf, but on mobile/Safari it's noticeable.
**Fix:** Animate via `box-shadow: 0 0 0 2px rgba(34,197,94,…)` which is compositor-friendly, or an `::after` overlay.

### [P3] Too-many-to-count `(value ?? 0).toFixed(2)` chains hide NaN rather than revealing bad data
**Where:** grep for `\(\w*\s*\?\?\s*0\)\.toFixed` — hundreds of occurrences app-wide
**What:** Every numeric render collapses `null | undefined | NaN` to `0.00`. When a real bug ships NaN into a quote, the UI silently renders `$0.00` instead of signaling the data issue.
**Why it matters:** Hides bugs. A trader sees a position with a fair value of `$0.00` and assumes it's worthless, when actually the API returned null.
**Fix:** Use explicit `Number.isFinite(v) ? v.toFixed(2) : "—"` in display helpers.

### [P3] `ProfileMenu` Logout flow fires `fetch` with no await-on-error, hard-redirects on any failure
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/ProfileMenu.tsx:61`
**What:** `await fetch("/api/v1/auth/logout", ...).catch(() => {})` then unconditional `window.location.href = "/login"` — network down means the client-side cookie is cleared but the server session remains valid.
**Why it matters:** Session remains alive on server if logout failed. Minor, but trivially fixable.
**Fix:** Retry once, show a toast on failure, only redirect on 2xx.

### [P3] Dashboard "Welcome" banner disappears forever after first dismiss (localStorage key `alphadesk-welcomed`) — no "show again" option
**Where:** `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx:115-123`
**What:** Once `localStorage.setItem('alphadesk-welcomed', '1')`, the banner cannot be shown again even if the user wants to replay.
**Why it matters:** New features added later ("press ? for shortcuts") require re-education; users clearing localStorage is not a user action.
**Fix:** Version the key (`alphadesk-welcomed-v2`) and bump on major UX changes, or surface a "replay tour" in settings (already there for OnboardingTour? — I didn't see one).

## What's actually good

- **Dark theme discipline.** `globals.css` is well-organized, uses CSS custom properties consistently, and tokens like `--profit/--loss/--panel/--surface` are plumbed through. Baseline palette is coherent.
- **Command palette exists and works.** Real debounced search, keyboard shortcut (Cmd+K), recent actions — the infrastructure is there and mostly well-built.
- **Reduced-motion respect.** `@media (prefers-reduced-motion: reduce)` clause is present (`globals.css:407-414`) and `AnimatedNumber` honors it.
- **Skeleton loaders with shape.** Dashboard page `page.tsx:66-87` draws the actual card shapes in the skeleton, which gives premium perceived perf.
- **tabular-nums, mono-spacing for prices.** Small thing, huge for readability. Most price cells use `tabular-nums`, which is rare even in commercial terminals.
- **WebSocket with exponential backoff + visibility re-connect.** `useWebSocket.ts` is solid — better than many commercial trading apps I've audited.
- **Actual typography scale defined** (`.text-display/.text-title/.text-body/.text-label/.text-hint`) — just under-used; teach the team to reach for it.

## Overall Frontend Score: 58/100

- **Look /25 → 18.** Dark palette, density, icons, and overall visual language are in the top quartile of trading UIs I've audited. Deductions for typography drift (too many ad-hoc text sizes), occasional contrast issues on low-intensity calendar cells, Profile avatar being a literal "A," and a "DEMO" watermark that's too muted on charts.
- **Feel /25 → 13.** Command palette + keyboard shortcuts + reduced-motion + toast system are real. Hover state missing on primary button (P1), onboarding tour no focus trap, pause/stop missing on ticker, swallowed errors kill feedback loops. Dashboard mobile is a 7000px scroll.
- **Code Quality /25 → 12.** Lots of defensive fallbacks, solid WS code, good use of React Query. But: BUG #nn comments in prod, 8 `catch { /* ignore */ }` blocks, 36+ `as any` / similar type escapes, `suppressHydrationWarning` on root, one-god-file ChartPanel at 1,114 lines with demo OHLCV generator still embedded. Analytics math uses a hardcoded $100k baseline.
- **Trust /25 → 15.** This is the single biggest lever for improvement. Live stream + flash-on-tick + a real chart engine project trust, but fake Sharpe, fake RSI, fake options Greeks, hardcoded "NVDA Golden Cross" signals, and a mailto password reset torpedo it. Every P0 in this list is a trust issue.

A 3-day push cleaning up the P0 findings (kill fabricated metrics; make empty states honest; wire up real password reset flow) would move this from ~58 to ~75 with no visual changes.
