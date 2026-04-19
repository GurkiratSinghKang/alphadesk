# Persona 1 — New User First Login

First-impression audit of AlphaDesk at tradingalpha.net, logged in as `admin`
on 2026-04-18. Findings below are things a sophisticated-but-not-professional
retail investor would hit, rank-ordered by severity.

---

### [P0] Max Drawdown and CAGR on strategy pages are off by 100×
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:187-195` (`signedPct`, `negPct`)
**What I observed:** For `momentum-quality` the backend returns `cagr: 0.362`,
`max_drawdown: 0.0801`, `sharpe_ratio: 2.2087`. The page displays:
- "CAGR **+0.36%**" (should be +36.20%)
- "MAX DD **-0.1%**" (should be -8.0%)
Confirmed across every strategy whose perf endpoint returns fractional values
(pead 14.68% CAGR → "+0.15%", rsi2 5.11% CAGR → "+0.05%", etc.).
**What I expected:** Fractional returns multiplied by 100 before formatting,
consistent with how `invested_amount` and `total_return_pct` are already
rendered everywhere else.
**Fix suggestion:** In `signedPct` and `negPct`, multiply `v * 100` before
`toFixed`. Or better: normalize on the API layer so the frontend never has to
guess whether a value is a percent or a fraction.

### [P0] Strategy OOS "TOTAL RETURN" on the equity panel is hard-coded to 0.00%
**File:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:379-386`
**What I observed:** The hero metric plate shows "+36.20%" CAGR-equivalent
but the § 02 Performance summary row says "TOTAL RETURN **+0.00%**". The
backend returns `total_return_pct: 0.0` for all live strategies (because
nothing has closed), but the equity curve is populated (e.g. PEAD has 64
daily points going from $4,894 → $4,895 with sub-$500 drawdowns). The 0% is
technically "no closed trades" but reads as "strategy lost me money" to a
fresh reader since the chart shows a clearly-down trajectory.
**What I expected:** Compute mark-to-market total return from the equity
curve endpoints (first point vs last point) when `total_return_pct === 0` —
or hide the cell entirely until a trade closes.
**Fix suggestion:** Derive TOTAL RETURN from the equity curve when the
API value is exactly 0 and the curve has movement.

### [P0] Strategy rail silently hides 7 of the 20 strategies on the desk
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:87-100` (`REGISTRY_STRATEGY_IDS`)
**What I observed:** Backend `/strategies/` returns 20 strategies. The desk
rail allow-lists 12 and hides `claude-alpha`, `dividend-capture`,
`sector-rotation`, `vcp-breakout`, `mean-reversion`, `gap-fill`,
`manual-discretionary`. `manual-discretionary` is the one the user's own
trades (7 positions, $57k invested!) are attributed to — so the biggest
live strategy is invisible from the main dashboard.
**What I expected:** Either show every backend-returned strategy, or show
the hidden ones with a clear "manual / trader-initiated" affordance.
**Fix suggestion:** Add `manual-discretionary` at minimum. The other 6 are
real registered strategies with content blocks; they should also appear.

### [P0] Landing-page Day P&L always shows $0.00 even when the book is up
**File:** `frontend/src/lib/api.ts:749` (`getPortfolioSummary`)
**What I observed:** Portfolio summary returns `realized_pnl_today: 0.0`,
`unrealized_pnl: 1506.92`, `unrealized_pnl_pct: 2.64`. The ContextBar cell
labeled "Day P&L" is computed from realized-only, so it shows "$0.00" on a
day where the book is +$1,506 mark-to-market. "Unrealized P&L" cell shows
the $1,506 separately, but the Day P&L cell is the most-visible signal and
it's always $0 for any user who hasn't closed a trade today.
**What I expected:** Day P&L = today's Δ equity (unrealized mark change
today + realized today). Bloomberg's convention.
**Fix suggestion:** Add a backend field `day_pnl` that diffs today's equity
mark-to-close from prior-day close; wire ContextBar to it.

### [P0] "Stage order →" default fires an error toast on first click
**File:** `frontend/src/app/(dashboard)/page.tsx:374-386` + `OrderBar.tsx:75-82`
**What I observed:** OrderBar defaults: `quantity: 100`, `type: "limit"`,
`price: ""`. First-time user clicks "Stage order →" to see what happens →
page toasts "Limit orders require a price" and nothing is staged. There's
no inline "tell me where to type the price" nudge, and the button is gold
& emphatic enough to invite accidental clicks.
**What I expected:** Either (a) default to Market, not Limit, so a click
without typing succeeds (or at least goes to a preview), or (b) render an
explicit "Review" step before firing so "Stage" really means "Stage".
**Fix suggestion:** Default `type: "market"` to match what the label
"Stage order" implies. When Limit is chosen, disable the button until Price
is populated (don't rely on validation-toast-after-click).

### [P1] Label says "Stage order" but the button actually submits live
**File:** `frontend/src/app/(dashboard)/page.tsx:277-329`
**What I observed:** Reading the label "Stage order" I expected a review
modal / preview panel → a separate Submit. Clicking with valid inputs
immediately sends `POST /trades/orders` and displays "BUY 100 SPY staged —
submitted". There is no intermediate review step. This is misleading
terminology — in broker UIs, "Stage" = save a draft; "Submit" = send live.
**What I expected:** Either rename to "Submit order →" or actually add a
review/preview step with a visible order-summary card before firing.
**Fix suggestion:** Rename the primary button to "Submit" and keep the
current flow — or add a confirmation dialog (size, notional, stop, risk).

### [P1] Strategy hit rate says "-100%" on the rail
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:115-132`
**What I observed:** Backend returns `win_rate: -1.0` on all strategies.
The rail treats 0 as em-dash (via the `live === 0` check) but -1 is a
distinct, finite number — it flows through as "-1.00%". PositionsList rows
with missing sector show "—" for strategy label though.
Actually re-reading: `returnPct` is derived from `total_return_pct`, which
is 0 for all live strategies, so the rail renders em-dashes correctly. But
`manual-discretionary.total_return_pct = 2.6` (it's excluded from the
rail). So the only strategy that ever shows a real number on the rail is
invisible. See P0 above.

### [P1] Strategy detail page — § 01 Signal and § 05 Limitations vanish
for `pead` and `orb`
**File:** `frontend/src/lib/strategy-content.ts`
**What I observed:** `STRATEGY_CONTENT` has entries for 17 strategies but
missing `pead` and `orb`. Navigating to `/strategies/pead` (the marquee
"Post-Earnings Announcement Drift" strategy that has a real 64-day equity
curve and hit rate of 61%) produces a page with **no** Thesis / Edge /
How-it-works section and **no** Known Limitations. It jumps straight from
the hero to the equity curve. For a strategy this prominent that reads like
a bug.
**What I expected:** Every registered strategy has a content block.
**Fix suggestion:** Author `pead` and `orb` entries or soft-delete them
from the registry until content ships.

### [P1] PositionsList "Orders" and "Journal" tabs don't filter
**File:** `frontend/src/components/composites/PositionsList.tsx:46-193`
**What I observed:** The "Book" tabs Positions / Orders / Journal on the
desk right rail all show the same 7 position rows. The tab state is stored
but never used to switch data sources — the component always renders the
`positions` prop. Clicking "Orders" just changes the active-tab styling;
the list of rows doesn't change.
**What I expected:** Orders tab shows the 12 open orders (stop/limit
working). Journal shows closed trades.
**Fix suggestion:** Either wire the tabs to `getOrders()` and trade-history
via the desk page, or remove Orders/Journal tabs from the rail for now.

### [P1] `claude-alpha`, `dividend-capture`, and other strategies have
all-null metrics despite being "active"
**File:** N/A — backend data shape
**What I observed:** `/strategies/claude-alpha/performance` returns
`sharpe: null, max_drawdown: null, hit_rate: null, cagr: null, profit_factor: null`
and `equity_curve: []` but `status: "active"`. A user navigating to
`/strategies/claude-alpha` sees "This strategy has not traded yet" in the
hero — but the landing page markets "AI-driven opportunistic stock picking
powered by Claude" with no stats to back it. Feels like a dead feature.
**What I expected:** Either seed a baseline (perhaps backtest on
equity_curve) or label the strategy as "Preview / beta" so users don't
assume it's broken.
**Fix suggestion:** Add an "OOS available after first trade" pill rather
than leaving the metric plate at em-dashes.

### [P1] AI memo panel pulses forever with placeholder copy
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:380-388` (`emptyMemo`)
**What I observed:** The right-rail "CLAUDE · PRE-TRADE MEMO" panel has a
gold pulsing dot (animated) and displays "No memo yet — add one or wait
for the AI to summarize." It never updates regardless of which symbol /
strategy the user selects. The pulsing dot reads as "actively processing"
but nothing is.
**What I expected:** Either real Claude output wired to the selected
symbol, or a static (non-pulsing) empty state that reads "Select a symbol
to generate a memo".
**Fix suggestion:** Turn off the pulse when `model === "awaiting"`; wire
a real memo endpoint (or gate the panel behind "Analyze → ⌘K → A").

### [P1] Command palette "Analyze current symbol" and "Focus options chain"
just toast "coming soon"
**File:** `frontend/src/components/layout/CommandPalette.tsx:176-238`
**What I observed:** ⌘K → "Analyze current symbol" (shortcut `A`) fires a
toast "Deep analysis for SPY — coming soon". Same with "Focus options
chain". These are in the Commands group, not marked as disabled or future.
**What I expected:** Either hide incomplete commands from the palette or
mark them with a visible "Soon" chip.
**Fix suggestion:** Filter them out for now or add a grayed-out style.

### [P1] Settings "Trading Mode: Live" is cosmetic — nothing actually changes
**File:** `frontend/src/stores/ui.ts:41,57` + `frontend/src/app/(dashboard)/settings/page.tsx:341-364`
**What I observed:** Settings has a prominent "Paper / Live" segmented
switch with amber warning "Live mode uses real capital." The switch only
sets a Zustand key `tradingMode`; no API call is made. All orders
continue to go through the same Alpaca-paper backend regardless. Also the
API Keys section says "configured on the server — contact admin to
update", which contradicts the implication that I can flip to live on my
own.
**What I expected:** Either the switch actually swaps to a live Alpaca
account, or the toggle is labeled "Display mode" / removed entirely.
**Fix suggestion:** Hide the Live option (or make it read-only with the
current broker mode) until a real live-trading path exists.

### [P1] StatusBar "Alpaca paper · connected" shows even if the user hasn't
loaded portfolio data yet
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:336-342` + `page.tsx:248-255`
**What I observed:** `brokerConnected: !portfolioSummary.is_demo` — the
initial store state before any fetch has `is_demo: false` (hydrated
default), so the pill reads "Alpaca paper · connected" from the instant
the page mounts even if the API is down. Combined with the `getCounts`
effect's graceful "don't overwrite orderCount on error" behavior, a fully
broken backend can still appear green on the status bar.
**What I expected:** Neutral/loading state until the first successful
portfolio fetch, then green.
**Fix suggestion:** Introduce a tri-state (loading / connected / offline)
that starts loading until `usePortfolioSummary` resolves once.

### [P2] "Position" rows display em-dashes for strategy (italic subtitle
is always "—")
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:305-324` (`toPositionRows`)
**What I observed:** Every position row has `strategyName: "—"` because
the positions endpoint doesn't return sector/strategy on each position.
On a fresh account all 7 rows read "AVGO — 15 @ 381.05 / —". The italic
slot is conspicuously empty.
**What I expected:** Either the strategy that opened the position
(resolved via trade_ledger backend) or the sector (AVGO = Semiconductors).
**Fix suggestion:** Join the positions endpoint against the positions-
classification in the trade ledger; fall back to sector when unknown.

### [P2] RegimePill body text is just "bull"
**File:** `frontend/src/app/(dashboard)/_desk/selectors.ts:42-66` (`toRegime`)
**What I observed:** Backend regime: `{regime: "Bull - High Volatility",
label: "bull", description: "Market trending up but with elevated
volatility. Caution on position sizing.", vix_level: 27.9}`. Selector
picks `label` verbatim as "bull" instead of the richer regime string or
the description. The pill LED is correct but the text is thin.
**What I expected:** "bull · high volatility" or the short regime name
from the backend.
**Fix suggestion:** Prefer `raw.regime` (formatted string) over `raw.label`
(short enum) for display.

### [P2] Strategy detail hero on `orb` advertises "Sharpe 8.34, Profit
Factor 22.25" — implausible and untagged
**File:** backend-side `orb.spec.md` / strategy-registry
**What I observed:** ORB strategy returns `sharpe_ratio: 8.3369`,
`profit_factor: 22.2514`, `cagr: 0.5979`. Even a pretty sophisticated
retail investor will read "Sharpe 8.34" and think the metric is broken or
fabricated (realistic equity Sharpes are 0.5–2). Without a "backtest" or
"in-sample" chip, it reads as lying.
**What I expected:** Metrics that pass the laugh test and/or a clear
"OOS backtest · 2019-2023" disclaimer.
**Fix suggestion:** Tag the hero cells with the source period and a
"Backtest / OOS" qualifier. Consider capping displayed Sharpe with
"N/A — sample size too small" if the underlying sample is short.

### [P2] Sparklines on the strategies response are dollar-equity curves
that start at ~$4,500-$62,000 but never reach current_value
**File:** Backend `strategies/router.py` `sparkline` field
**What I observed:** `manual-discretionary.sparkline` ends at 58539.07 but
`invested_amount = 57055.62` and `active_positions_count = 7`. The rail
sparkline is meant to show "strategy health" but it's the raw equity curve
which can include contributions. For PEAD the curve trends from 4,894 →
4,895 with a dip to 4,452 — that's $400 on $4,900 which is meaningful,
but the rail will only show 20-point sparkline cropped.
**What I expected:** Normalized return % curve, not raw dollars.
**Fix suggestion:** Compute sparkline as `(v_i - v_0) / v_0 * 100` on the
backend.

### [P2] Onboarding tour step 5 points to `[data-tour='profile-menu']`
which doesn't exist on the desk
**File:** `frontend/src/components/layout/OnboardingTour.tsx:57-62`
**What I observed:** Step 5 is titled "Command Palette" but its selector
targets `data-tour='profile-menu'` — a ProfileMenu is only rendered by
the non-desk TopBar, not the desk TopBar used at `/`. `updateSpotlight`
falls through to "center fallback" for that step — the spotlight cut-out
vanishes and the tooltip floats in the middle without a highlighted
element.
**What I expected:** Step 5 highlights the ⌘K kbd hint in the StatusBar
or the avatar circle.
**Fix suggestion:** Change the selector to `[data-slot='status-bar']` or
add `data-tour='profile-menu'` to the desk avatar.

### [P2] Onboarding hint "Press B or S for a quick buy/sell at market" is
wrong — there's no such shortcut
**File:** `frontend/src/components/layout/OnboardingTour.tsx:49-55`
**What I observed:** Step 4 (Order Bar) advertises "Press B or S for a
quick buy/sell at market." No such shortcut is registered anywhere in
`useKeyboardShortcuts.ts` or `CommandPalette.tsx`. Pressing B on the desk
does nothing; pressing S does nothing.
**What I expected:** The hint matches a real keybinding.
**Fix suggestion:** Either register the shortcut (sensible for speed-
trading) or correct the copy.

### [P2] TickerTape is hidden on `/` (the page it'd be most useful)
**File:** `frontend/src/app/(dashboard)/layout.tsx:103-127`
**What I observed:** `TickerTape` is only rendered in the non-desk branch
of DashboardLayout. At `/` there is no scrolling ticker. The desk design
spec mentions the TickerTape as part of the chrome but the implementation
puts it only on `/analytics`, `/alerts`, etc. A new user who turns the
ticker tape on via settings sees it appear then vanish when navigating
between `/analytics` and `/`.
**What I expected:** Ticker consistent across all dashboard routes, or
explicitly hidden on `/` by design with no toggle leak.
**Fix suggestion:** Move the TickerTape render into DeskLayout (row
between TopBar and ContextBar) or hide the toggle when on `/`.

### [P2] First-run has no welcome / empty state — the desk just shows
existing admin's $101k book
**File:** N/A — account seeding
**What I observed:** The challenge said "create an account and log in for
the first time" but the only account available is `admin` with a
pre-existing $101k book, 7 open positions, 12 working orders. There's no
new-user empty state ("Let's set up your Alpaca connection"). A genuinely
new user wouldn't have positions to look at.
**What I expected:** A lightweight zero-state that explains the terms
(what's Book equity? Sharpe? Regime?) and a "Connect broker" CTA.
**Fix suggestion:** Real onboarding guide for accounts with 0 positions.

### [P2] No in-app glossary / "What's this?" affordance for jargon
**File:** N/A — navigation / IA
**What I observed:** The ContextBar label "Sharpe · 30d" is now rebranded
to "Unrealized P&L" per selectors. But the strategy pages still throw
"OOS Sharpe", "CAGR", "MAX DD", "Regime fit 0.5", "F-Score" at the user
without inline tooltips. ⌘K → "Go to Documentation" routes to `/docs`
which **does** exist, but the link is buried in the command palette, not
on the relevant pages. There is no "?" icon next to any metric.
**What I expected:** Hover tooltips on metric labels, or a persistent
"help" kbd in the bottom-right.
**Fix suggestion:** Wrap Eyebrow labels in a `<Tooltip>` with one-line
definitions.

### [P2] Settings "Portfolio Refresh Interval" segment says "Default is
60s" but the label says "Lower intervals increase API usage"
**File:** `frontend/src/app/(dashboard)/settings/page.tsx:113-168`
**What I observed:** The `IntervalSlider` label in the component is
"Portfolio Refresh Interval" but the QA spec calls it "Data Refresh" and
there's only one refresh knob that affects… what exactly? Changing the
value doesn't visibly alter anything on the desk (which polls via React
Query with staleTime/refetchInterval hard-coded in `useQueries.ts`).
**What I expected:** Either wire the setting to the React Query
configurations, or remove the knob.
**Fix suggestion:** `useRefreshInterval` hook that feeds the staleTime /
refetchInterval of the useXxx hooks.

### [P2] Build version reads "dev" in the StatusBar
**File:** `frontend/src/app/(dashboard)/page.tsx:65-67` (`BUILD_VERSION`)
**What I observed:** `NEXT_PUBLIC_BUILD_VERSION` isn't set → StatusBar
shows "Build dev" in production at tradingalpha.net. For any user
reporting a bug, knowing the build they're on matters.
**What I expected:** Real build commit / version.
**Fix suggestion:** Inject on container build; fall back to commit SHA.

---

## Summary counts

- P0: 5
- P1: 8
- P2: 12

Total: 25 findings.
