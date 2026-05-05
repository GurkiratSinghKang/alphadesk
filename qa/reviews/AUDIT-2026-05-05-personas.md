# Persona Audit — 2026-05-05

**Run:** `qa/runs/2026-05-04T20-31-40Z/` (post R1-R4 + sector_rotation + audit-artifacts deploys)
**Base:** `https://tradingalpha.net`
**Scope:** Six fresh persona walkthroughs against the latest canonical sweep.
Excludes the seven addressed R5 BLOCKERS and the four R6-3/-4/-7/-9 follow-ups
already on the remediation queue. Findings below were verified against actual
PNGs and DOMs in this run, not against the 60+ prior persona reports.

Severity legend: **P0** = blocks or maims the flow / risks money or trust;
**P1** = degraded UX or correctness gap; **P2** = friction / polish; **P3** = nit.

---

## Persona 1 — First-time Visitor (cold prospect)

**Workflow:** Lands on `https://tradingalpha.net/login` (the only public entry)
→ scans the marketing column on the left → wonders "is this safe / serious /
for me" → decides between *Sign in* and *Request access* → clicks *Request
access* → fills the form → submits.

**Screenshots:** `login/desktop-1440/initial.png`, `login/mobile-390/initial.png`,
`request-access/desktop-1440/initial.png`,
`request-access/desktop-1440/bottom.png`.

### F1.1 [P1] Login *is* the marketing site — there is no `/` for unauth visitors
**Evidence:** `login/desktop-1440/initial.png` shows the entire pitch is
crammed beside a pre-rendered sign-in card. There is no separate landing page
at `/`; root redirects authenticated users to the desk and unauthenticated to
`/login`. **Impact:** A cold prospect from a press link lands on a screen that
asks for credentials before they have any reason to give them. Two of the four
trust signals ("12 strategy workflows", "1.43 average OOS Sharpe", "paper
first") are pushed below the fold; the form dominates. **Fix:** Either move
the form behind a dedicated CTA on `/` or give `/login` a clear
"about / pricing / docs" anchor row above the sign-in card.

### F1.2 [P1] "Sign in" form doesn't tell the prospect they're already invite-only
**Evidence:** `login/desktop-1440/after-submit-invalid.png` — rejecting an
unknown email returns a one-line toast `"Those credentials didn't match. Try
again or request access."` The form itself is identical to a public-signup
form. **Impact:** A cold visitor enters their email, gets the rejection, and
only then realises this is invite-only. **Fix:** Add a static line under the
*Username* label: "Invite-only — no public sign-ups. Use Request access if
you don't have credentials."

### F1.3 [P1] Marketing copy says "AI buyer" but never names the AI provider
**Evidence:** `login/desktop-1440/initial.png` — pitch says
"AlphaDesk gives active traders a private AI desk for the whole loop" and the
footer pillar reads "Built on Claude". `about/desktop-1440/initial.png` § 01
mentions "Claude (Anthropic)" but a cold prospect doesn't visit /about before
deciding. **Impact:** "AI" alone is undifferentiating; naming Anthropic on the
marketing column would meaningfully improve trust signal density. **Fix:**
Replace one line of pitch copy with "Powered by Anthropic Claude — your
strategy logic and broker keys never leave your workspace."

### F1.4 [P0] No visible "data sources / not financial advice" trust strip on
**login marketing column. Evidence:** `login/desktop-1440/initial.png`. The
pitch column ends with "12 strategy workflows" / "paper first" — no risk
disclosure, no provider attribution, no "we don't custody funds." `/risk`
disclosure exists (`risk/desktop-1440/initial.png`) but is two clicks away.
**Impact:** A first-time visitor cannot answer the central trust question
("can I lose money") without leaving the page. **Fix:** Add a thin trust
strip — "Not a broker · Paper-first · Read the Risk Disclosure" — between the
hero and the bento.

### F1.5 [P2] Mobile login crops "Open your workspace" card under the fold
**Evidence:** `login/mobile-390/initial.png` — the entire sign-in/request
column rasterizes below the marketing copy, and the pitch column itself
exceeds one screen. The visible area on first paint is the headline only.
**Impact:** A mobile prospect arrives, sees no form, sees no CTA above the
fold. **Fix:** Re-order on `< md`: collapse the marketing column behind a
disclosure, or float the *Sign in* / *Request access* CTA pair into a sticky
pill at the top.

### F1.6 [P2] Request-access form has no inline progress / step affordance
**Evidence:** `request-access/desktop-1440/initial.png` shows ~12 fields in a
single panel. The right-hand "Onboarding path" sidebar lists 5 stages but
they're a static read-only list — not anchored to where the user is.
**Impact:** A 12-field form with no progress signal feels like a sales lead
form, not an onboarding step. Submission rate suffers. **Fix:** Group fields
into 3 steps ("You" / "Your trading" / "What you need") with a thin progress
bar; or surface "step 1 of 3" copy.

### F1.7 [P3] Bento screenshot in marketing column references obsolete copy
**Evidence:** `login/desktop-1440/initial.png` — bento mockup shows
"Decision raid" and an indistinct "Risk rocks" card. Both read as marketing-
mockup placeholder labels rather than real product surfaces. **Impact:** Eye
catches them as typos and undermines polish. **Fix:** Reshoot the bento with
real strings (`Risk gates`, `Decision stack`).

---

## Persona 2 — Active Trader (post-login, intra-day)

**Workflow:** Logs in → arrives at `/` (Control Room) → glances at Day P&L,
working orders, kill-switch state → clicks `Trade` on the rail or top bar →
loads `/trade?symbol=AAPL` → confirms ticket prefill → adjusts qty/price →
clicks the primary submit → expects fill confirmation → returns to dashboard.

**Screenshots:** `dashboard/desktop-1440/initial.png`, `trade/desktop-1440/
initial-prefill.png`, `trade/desktop-1440/single-leg-prefill.png`,
`trade/desktop-1440/multi-leg-prefill.png`, `trade/mobile-390/*.png`.

### F2.1 [P0] Primary execution button reads "Place after review" — but there is no separate "Place" step
**Evidence:** `trade/desktop-1440/single-leg-prefill.dom.html` →
`<button data-testid="order-bar-submit" ...>Place after review</button>`.
`single-leg-prefill.png` shows the same button gold and prominent. The same
DOM is also produced for the multi-leg combo (`multi-leg-prefill.dom.html`).
There is no second-stage modal — the click commits the order via
`POST /trades/orders`. **Impact:** "Place after review" implies a preview
gate that does not exist. Persona-1 already flagged that the original "Stage
order" was misleading; "Place after review" inherits the same problem with
fresh wording. **Fix:** Either insert a true confirmation drawer (size,
notional, stop, contract, broker mode) before the POST, or rename to
"Submit order" and surface the readiness card as the implicit review.

### F2.2 [P0] Execution-readiness card is `hidden md:grid` — invisible on mobile
**Evidence:** `trade/mobile-390/initial-prefill.dom.html` →
`<section aria-label="Execution readiness" class="hidden gap-3 ... md:grid
md:grid-cols-[auto_minmax(0,1fr)_auto] ...">`. The card that on desktop tells
the trader "Buying power needs confirmation / Off-session / Contract checks"
disappears entirely below the `md` breakpoint. The mobile screenshot
`trade/mobile-390/initial-prefill.png` confirms the empty space where the
card sits on desktop. **Impact:** A mobile-only trader never sees the
readiness state and submits blind to it. Combined with F2.1 the entire
"safety story" of the trade ticket is desktop-only. **Fix:** Replace
`hidden md:grid` with a stack layout for `< md`; the four readiness pills
fit fine in a single column.

### F2.3 [P1] Stale option contracts return 404 on every load
**Evidence:** `trade/desktop-1440/console.jsonl` shows
`Failed to load resource ... /api/v1/market/quotes/NVDA260425C00205000 (404)`
plus two more for `NVDA260424P00200000` and `NVDA260424C00220000`. These are
prefilled OCC tickers that have already expired. **Impact:** Trader stares
at an empty quote panel; the readiness card may flash green with `--` quote
behind. The 404s are the same class as the R5 BLOCKER fix — recurring on
hard-coded prefill paths. **Fix:** When the prefill OCC's expiry is
in-the-past or strikes are detected stale, drop the leg before issuing the
quote or substitute with a sensible front-month default.

### F2.4 [P1] "Buying power needs confirmation" copy is the only readiness
state ever shown post-load
**Evidence:** `trade/desktop-1440/single-leg-prefill.dom.html` —
`<h2>Buying power needs confirmation</h2><p>Short option margin. Broker
margin validation still decides final capacity. You may continue in paper
mode after confirming the ticket inputs.</p>`. **Impact:** Reads as a
warning that never resolves. There's no "ready to submit" success copy
because the readiness check never returns "ready." **Fix:** Wire a real
buying-power sufficiency check ; if pass, surface "Buying power confirmed —
$X available." If unknown, say "We couldn't reach the broker — review and
proceed at your own risk."

### F2.5 [P1] No cancel affordance on the in-page recent-orders table
**Evidence:** `trade/desktop-1440/initial-prefill.png` lower section
("Execution activity / No orders yet today.") shows only a Working/All/
Filled/Rejected filter row. The table has no row actions column. Persona-3
already documented this and the DOM still shows the columns Time/Symbol/
Side/Qty/Type/Status with no cancel button. **Impact:** A fat-finger limit
placed from /trade requires navigating to /dashboard to cancel.
**Fix:** Add a row-level X cancel for `Working`/`Pending` rows wired to
`cancelOrder(id)`.

### F2.6 [P1] "DATA UNAVAILABLE" status pill at top-left becomes the dominant
glance signal on /trade
**Evidence:** `trade/desktop-1440/single-leg-prefill.png`, top-left header
shows `DATA UNAVAILABLE · Market data: paused · prepped 2 second(s) ago` in
yellow. **Impact:** A trader's eye locks on the warning. Off-session market
data is the expected state for a Saturday capture, but the copy doesn't say
that — it reads like a system outage. **Fix:** Differentiate "off-session"
(green/neutral) from "data unavailable" (warning). Today both render as the
same amber pill.

### F2.7 [P2] Mobile trade ticket has no Up/Down arrows for qty/price
**Evidence:** `trade/mobile-390/initial-prefill.png` — qty and price are bare
inputs with iOS numeric keypad. **Impact:** Adjusting qty by one share on a
phone is fiddly. **Fix:** Add `+`/`−` step buttons on `< md` (44×44 hit
targets) bound to qty and price.

### F2.8 [P3] Multi-leg combo still uses term "combo" inconsistently with "strangle"
**Evidence:** `trade/desktop-1440/multi-leg-prefill.dom.html` describes the
ticket as "Combo strangle" in the strategy chip and "2 legs" elsewhere; the
submit button is generic "Place after review" — same as single-leg. **Impact:**
A trader skimming the chrome can't tell whether the combo will be sent as a
single multi-leg order or two staggered legs. **Fix:** Surface the order
intent ("Send as 1 multi-leg / Send as 2 staggered legs") explicitly above
the submit.

---

## Persona 3 — Strategy Researcher

**Workflow:** Logs in → clicks `Strategies` in the top bar → arrives at
`/strategies` catalogue → filters by *Ready* → clicks a card to drill into
detail → reads the thesis, parameters, OOS metrics → checks "When to deploy"
guidance → either toggles strategy active or backs out to compare.

**Screenshots:** `strategies-list/desktop-1440/initial.png`,
`strategies-list/desktop-1440/scrolled-mid.png`,
`strategy-momentum-quality/desktop-1440/initial.png`,
`strategy-momentum-quality/desktop-1440/scrolled-mid.png`.

### F3.1 [P0] Catalogue chip "READY" count = 10, "BLOCKED" count = 8 — no explanation visible
**Evidence:** `strategies-list/desktop-1440/initial.png` header strip shows
`READY 0 · NEEDS DATA 0 · REVIEW 0 · PAPER 3 · BLOCKED 6` (counts inferred
from chips). DOM count of `BLOCKED` text = 8 occurrences total but the chip
column above shows much smaller numbers. **Impact:** A researcher cannot
reconcile the readiness chip with the 12-active list below — what is
"BLOCKED" hiding? **Fix:** Make each chip filterable, and surface a single
reason on each blocked card.

### F3.2 [P0] Six "Coming soon" cards (Claude Alpha, Dividend Capture, Sector
Rotation, Mean Reversion, VCP Breakout, Overnight Gap Fill) are still gated
behind "in development" copy
**Evidence:** `strategies-list/desktop-1440/bottom.png` "Coming soon"
section + DOM grep yields six cards with `data-stage="planned"` and
`aria-label="... — in development. Not yet implemented."`. Note: The recent
commit `db9f79d3 feat(strategies): add sector_rotation` added the strategy
on backend but the listing UI still treats it as `planned`. (R5 BLOCKER
follow-up acknowledged for sector_rotation specifically.) **Impact:** A
researcher sees 6 "in development" placeholders that look like a marketing
funnel. Either ship them or hide them. **Fix:** The five non-sector_rotation
placeholders should either be deleted from the catalogue or moved into a
roadmap subpage.

### F3.3 [P1] Strategy detail "Methodology" + "Walk-forward" sections are
empty placeholders — not explanatory copy
**Evidence:** `strategy-momentum-quality/desktop-1440/scrolled-mid.png`
shows two sections rendering "no playbook yet" and "the methodology hasn't
loaded yet" placeholders. **Impact:** A researcher trying to understand
*how* the strategy makes money sees a blank panel. **Fix:** Either ship
the markdown content or hide the empty sections; never display "the
methodology hasn't loaded yet" in production.

### F3.4 [P1] Strategy detail metric plate doesn't show units consistently
**Evidence:** `strategy-momentum-quality/desktop-1440/initial.png` hero
plate `2.21 · -8.0% · +36.20% · 78%`. The first cell has no label visible
without hover; the third cell number is correctly formatted (R5 follow-up
landed) but the `78%` is tagged as HIT RATE — the percent sign sits in the
data cell with no decimal. **Impact:** A scanning researcher can't tell
what 2.21 is without scrolling. **Fix:** Always render the unit row in the
plate ("OOS SHARPE / MAX DD / CAGR / HIT RATE") even on tight viewports.

### F3.5 [P1] Strategy detail equity panel has no historical content for
"Time-Series Momentum", "VWAP", "Statistical Arbitrage Pairs"
**Evidence:** harness skipped `range-1M` for `strategy-momentum-quality` (per
LATEST.md "empty equity chart"). The same skip applies to several
backtest-only strategies. **Impact:** Researcher can't tell whether the
chart is broken or the strategy has no live history. **Fix:** Render an
explicit "Backtest only — no live ledger yet" empty state with a CTA back
to the OOS curve.

### F3.6 [P2] No "Compare strategies" affordance on the catalogue
**Evidence:** `strategies-list/desktop-1440/initial.png` — cards are
isolated; no selection/checkbox to compare two side-by-side. **Impact:** A
researcher considering whether to pair PEAD with VRP must mentally compare
across pages. **Fix:** Add a compare drawer (max 3 strategies) accessible
from card overflow menu.

### F3.7 [P2] Catalogue header "Worst -10.5%" claim is not contextualized
**Evidence:** `strategies-list/desktop-1440/initial.png` top metric row:
`INVESTED $19,167 · BEST OOS SHARPE 4.78 · WORST -10.5%`. The "-10.5%" has
no label — is it worst CAGR? worst MaxDD? worst recent month? **Impact:**
Number without unit is misleading. **Fix:** Label the cell explicitly
("WORST OOS MAX DD" or whatever it is).

---

## Persona 4 — Risk Manager / Compliance

**Workflow:** Logs in as admin → navigates to `/settings` to verify halt
controls, kill-switch state, position limits, audit log → cross-checks
`/dashboard` for live exposure pills → opens `/pipeline` to verify Risk
Monitor toggle and circuit breaker state → reviews `/reports` for closed-
trade audit trail.

**Screenshots:** `settings/desktop-1440/initial.png`,
`pipeline/desktop-1440/initial.png`, `dashboard/desktop-1440/initial.png`,
`reports/desktop-1440/initial.png`, `contact/desktop-1440/initial.png`.

### F4.1 [P0] Public `/contact` page tells operators "halt trading via the kill switch in /settings" — but the kill switch is on `/pipeline`
**Evidence:** `contact/desktop-1440/initial.png` § 05 reads:
*"For account or trading emergencies, please also halt trading via the kill
switch in /settings. Email is slower than the switch, and the switch is the
authoritative off-ramp."* DOM grep on `settings/desktop-1440/initial.dom.html`
returns **zero** matches for `halt|kill|risk monitor`. DOM grep on
`pipeline/desktop-1440/initial.dom.html` returns one match:
`aria-label="Risk Monitor enabled — click to toggle"`. **Impact:** In an
actual emergency the operator follows the on-site instructions to /settings
and finds nothing. The genuine off-ramp is buried on /pipeline. This is a
documented-feature mismatch and a P0 governance hazard. **Fix:** Either
(a) move the Risk Monitor / halt toggle to the top of /settings (ideal —
it's the canonical safety surface), or (b) update /contact and any other
docs to point at /pipeline.

### F4.2 [P0] No visible "Halt all trading" / kill-switch on `/dashboard`
control room
**Evidence:** `dashboard/desktop-1440/initial.png` — the action stack has
"Review 2 working orders" and "WMT is the largest exposure" tiles, plus a
"Risk gate requires review before live capital" banner. There is no halt /
kill / panic button anywhere on the desk. DOM grep on
`dashboard/desktop-1440/initial.dom.html` for `halt|kill|risk monitor` =
**0 matches**. **Impact:** When the market goes wrong, the most-visible
surface (Control Room) has no off-ramp. The trader must navigate to
/pipeline. **Fix:** Mirror the Risk Monitor toggle into the dashboard
TopBar status group, near the PAPER pill. A persistent kill-switch is the
single most important risk control.

### F4.3 [P0] `/settings` has no audit log, no rate-limits, no position
limits, no per-strategy caps
**Evidence:** `settings/desktop-1440/initial.png` shows Trading mode (paper/
live) toggle, Brokerage form (Alpaca/IBKR/E\*TRADE/Schwab), Notifications
(3 toggles), Display, Data refresh, Export data, Security, Performance
monitor, and a "Reset preferences" footer. There are no controls for: max
loss per day, max notional per trade, max positions, sector caps, VaR
budget, drawdown halts, or audit-log access. **Impact:** A risk manager
cannot configure the platform to enforce policy from the UI — all caps are
constants in code (`master_agent.py`). **Fix:** Add a Risk section above
Notifications: max-daily-loss, max-trade-notional, max-positions, sector
cap, VaR budget — each with edit + audit-trail.

### F4.4 [P0] No "audit log" / "history of administrative actions" anywhere in the product
**Evidence:** None of `settings/`, `pipeline/`, `reports/`, `analytics/`,
`alerts/` DOMs contain `audit log`, `audit trail`, `system events`, or
`action history`. `reports/desktop-1440/initial.png` has Portfolio
Statement / Strategy Performance / Tax report — but no governance log.
**Impact:** A compliance reviewer cannot verify who toggled risk monitor,
who placed which manual order, or who flipped paper→live. **Fix:** Add a
"Governance log" section under /settings showing the last N admin actions
with timestamps; backend already has structured logs to source from.

### F4.5 [P1] "PAPER" pill on the TopBar reads as static decoration
**Evidence:** `dashboard/desktop-1440/initial.png` TopBar far-right shows
`● PAPER`. There is no click affordance, no aria-label tooltip explaining
what `PAPER` means or what to do to flip it. **Impact:** A risk manager
doesn't know whether the dot is a status indicator or a button. **Fix:**
Make the pill `aria-label="Currently PAPER trading mode — change in
Settings → Trading mode"`, and on click navigate to /settings#trading-mode.

### F4.6 [P1] Reports page strategy table shows "ACTIVE" for strategies the
backend considers paused / blocked / planned
**Evidence:** `reports/desktop-1440/initial.png` shows e.g. `Mean Reversion ·
PLANNED · 0.0%` rows mixed with `Mean Reversion · ACTIVE` and
`Manual / Discretionary · ACTIVE +1.5%`. The status column has 18 rows but
the labels don't match the strategies-list page (where "Mean Reversion" is
`planned`). **Impact:** A risk manager sees inconsistent status across
two surfaces. **Fix:** Single source-of-truth. Use the strategies-list
status taxonomy (planned/ready/needs-data/review/paper/active) on /reports.

### F4.7 [P1] No visible position-size warning on dashboard exposure tiles
**Evidence:** `dashboard/desktop-1440/initial.png` shows
`WMT is the largest exposure / $19,076.92 market value` and
`Largest market value $20K / +138% of equity / Beta-weighted delta 0.00`. The
"+138%" is the largest-position fraction relative to something — but the
label says "of equity" while WMT itself is $19k of $100k equity (=19%, not
138%). **Impact:** Risk manager cannot trust the headline number. **Fix:**
Recompute as `position_market_value / portfolio_equity`. The current 138%
appears to be `position / largest_strategy_allocation` or similar — wrong
unit.

---

## Persona 5 — Mobile-Only User (390×844)

**Workflow:** Opens AlphaDesk on iPhone → sign in → arrives at `/` →
glances at Day P&L / open positions → navigates to `/trade` → places a
ticket → checks `/strategies` → reviews `/analytics`.

**Screenshots:** `login/mobile-390/initial.png`,
`dashboard/mobile-390/initial.png`, `trade/mobile-390/initial-prefill.png`,
`trade/mobile-390/multi-leg-prefill.png`,
`strategies-list/mobile-390/initial.png`,
`analytics/mobile-390/initial.png`, `reports/mobile-390/initial.png`,
`settings/mobile-390/initial.png`.

### F5.1 [P0] No bottom-tab nav — mobile users navigate via the hamburger only
**Evidence:** `dashboard/mobile-390/initial.png` top bar shows hamburger /
logo / theme / bell / avatar. Nothing fixed at the bottom. The dashboard
hamburger Sheet (per persona-28 prior) lists 5 routes. **Impact:** Switching
between Dashboard ↔ Trade ↔ Alerts on a phone requires hamburger → tap →
target — three actions per route change. **Fix:** Add a 4-tab bottom nav
(Desk / Trade / Strategies / Alerts) on `< md` with safe-area-inset
respected.

### F5.2 [P0] Execution-readiness card hidden on mobile (cross-references F2.2)
**Evidence:** `trade/mobile-390/initial-prefill.dom.html` —
`section aria-label="Execution readiness" class="hidden ... md:grid"`.
The single most important pre-trade safety surface is invisible on phone.
**Impact:** Mobile traders submit orders without seeing the readiness
state. **Fix:** Stack-layout the readiness card on `< md`.

### F5.3 [P1] Settings "Performance Monitor" table is unreadable on mobile
**Evidence:** `settings/mobile-390/initial.png` bottom — "Recent API
Response Times" + "Last 10 Requests" tables compress to ~6px column
widths and the gradient bar is obscured. **Impact:** A mobile user
debugging slow responses sees noise. **Fix:** Either hide the perf monitor
on `< md` or stack it as a vertical list of "endpoint · status · ms" rows.

### F5.4 [P1] Reports page strategy performance table truncates the strategy name column
**Evidence:** `reports/mobile-390/initial.png` mid-section: rows like
"Manual / Discreti…", "Earnings Vol Harv…", "Time-Series Momen…" all
truncate. The percentage column is right-edge clipped. **Impact:** Mobile
user cannot read the strategy name *and* its return on the same line.
**Fix:** Use 2-line cells: name on top, return chip below. Or convert the
table to a mobile card list.

### F5.5 [P1] Analytics monthly-returns table renders one column on mobile
with all months overlapping
**Evidence:** `analytics/mobile-390/initial.png` bottom — the month
header row reads `JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC YTD` but
the data row below collides at <8px characters. **Impact:** A core
analytics surface is unreadable. **Fix:** Convert to a horizontal scroll
strip or 12-row vertical list on `< md`.

### F5.6 [P1] Strategy catalogue cards collapse all metrics on mobile
**Evidence:** `strategies-list/mobile-390/initial.png` — each card shows
the title and "Ready" chip, but OOS Sharpe / CAGR / MaxDD / positions
metrics are absent on `< md`. **Impact:** A mobile researcher cannot
compare strategies without tapping into each detail page. **Fix:** Show at
least one metric (OOS Sharpe) per card in mobile; hide MaxDD/CAGR if space
is tight.

### F5.7 [P1] Top bar on `< md` does not include a "Strategies" link
(persona-28 #3 — still partially true)
**Evidence:** `dashboard/mobile-390/initial.png` — the visible top bar has
no horizontal nav; the hamburger Sheet (DOM verified) lists 5 routes.
Persona-28 flagged this in 2026-04 — partially fixed but Strategies still
the only critical route requiring a sub-menu. **Impact:** Strategy access
on mobile is one extra tap vs other surfaces. **Fix:** Promote Strategies
to a top-level slot.

### F5.8 [P2] Dashboard Day P&L "+138%" tile is truncated as "+138%…"
**Evidence:** `dashboard/mobile-390/initial.png` "BUYING POWER · POSITIONS
OPEN OR…" header row truncates at the right edge. **Impact:** Last column
unreadable on first glance. **Fix:** Reduce label length or wrap to a
two-row layout below `< sm`.

---

## Persona 6 — Adversarial / Accessibility User

**Workflow:** Lands on `/login` → tabs through the form → uses screen
reader to read the marketing column → logs in → tabs through dashboard →
opens command palette via `Ctrl+K` → tabs through trade ticket → activates
the kill switch via keyboard → reviews critical numeric data via screen
reader.

**Screenshots:** `dashboard/desktop-1440/initial.png` (DOM grep evidence),
`trade/desktop-1440/single-leg-prefill.dom.html`,
`pipeline/desktop-1440/initial.dom.html`,
`alerts/desktop-1440/initial.png`.

### F6.1 [P0] PAPER/LIVE pill, regime pill, and Day P&L number have no `aria-label` describing what they mean
**Evidence:** `dashboard/desktop-1440/initial.dom.html` aria-label list
contains "Notifications", "Open command palette", "Selected ticker
controls", "User menu" — but **no** label on the PAPER pill, the
sideways/VIX pills, or the Day P&L `<b>` element. The Day P&L value is
rendered as `<b class="font-mono ...">−$429.37</b>` with no surrounding
label-for/aria-describedby. **Impact:** A screen-reader user lands on the
desk and hears "minus four hundred twenty-nine dollars" with no indication
that this is *today's P&L* vs total / unrealized / realized. **Fix:** Wrap
each ContextBar value in `<dl><dt>Day P&L</dt><dd aria-label="Day P&L
minus 429 dollars 37 cents">...</dd></dl>` or apply
`aria-labelledby` referencing the visible `Day P&L` label.

### F6.2 [P0] Risk Monitor toggle is a `<button>` but lives only on /pipeline — no global keyboard shortcut
**Evidence:** `pipeline/desktop-1440/initial.dom.html` →
`<button aria-label="Risk Monitor enabled — click to toggle" ...>Risk
Monitor: ON</button>`. No matching shortcut definition; not in the command
palette either (DOM grep on `dashboard/desktop-1440/initial.dom.html`
shows no `kbd` for halt). **Impact:** A keyboard-only operator in an
emergency must navigate `/pipeline` then tab into the button — easily 6
keystrokes. **Fix:** Add a global `Ctrl+H` (or similar) shortcut that
fires the toggle, register it in the command palette, and surface a
visible kbd hint on the dashboard.

### F6.3 [P0] Notification center is mute for screen readers (persona-49 F2 unchanged)
**Evidence:** `dashboard/desktop-1440/initial.dom.html` — the bell trigger
`<button aria-label="Notifications">` opens a Popover with no
`role="log"` and no `aria-live` region. Toaster has `aria-live="polite"`
but only `alphadesk:api-error` and `:system-notify` reach it; trade fills
do not. **Impact:** A blind trader gets no announcement on order fills.
This was prior-flagged — verifying still true in this run. **Fix:** Pipe
fill / alert-trigger pushes through the toast channel or add a labelled
`role="log" aria-live="polite"` mirror in NotificationCenter.

### F6.4 [P1] Trade ticket submit button has no `aria-describedby` pointing to the readiness state
**Evidence:** `trade/desktop-1440/single-leg-prefill.dom.html` — the submit
button has `aria-label` only ("Place after review"); the readiness section
has `aria-label="Execution readiness"` but no link via
`aria-describedby` from the submit. **Impact:** A screen-reader user
focuses the submit and hears the button label only — they do not hear
"Buying power needs confirmation". **Fix:** Add
`aria-describedby="trade-execution-readiness-summary"` on the submit and
mark the visible readiness `<h2>` with that `id`.

### F6.5 [P1] Tables across `/reports`, `/analytics`, `/trade` still missing
`scope="col"` on `<th>` (persona-49 F4 unchanged)
**Evidence:** spot-check on `reports/desktop-1440/initial.dom.html` and
`analytics/desktop-1440/initial.dom.html` shows `<th>` cells with no
`scope` attribute. NVDA has 24 visible numeric data tables; persona-49
documented seven affected files in 2026-04. **Impact:** NVDA / NVDA
table-navigation cannot anchor cell values to column headers — blind
trader can't tell P&L from Avg Cost. **Fix:** Add `scope="col"` to every
`<th>` on tables enumerated in persona-49 F4.

### F6.6 [P1] CSP "report-only" violations every page load
**Evidence:** `dashboard/desktop-1440/console.jsonl` has 50+
`Content Security Policy directive 'script-src 'self' https:'` violations
per page load (CSP is in report-only mode). **Impact:** When CSP is
moved to enforcing, every dashboard page will break. **Fix:** Either add
nonces to inline scripts (Next.js supports this), use SHA hashes for
all known inline scripts, or relax CSP to allow self-hashed inline. Do
this *before* enforcing.

### F6.7 [P1] Color-only signals on Reports strategy table
**Evidence:** `reports/desktop-1440/initial.png` — strategy status column
uses only color-coded chips (green ACTIVE, yellow PAUSED, etc). The label
text inside the chip helps but the differentiation between "ACTIVE",
"PLANNED", "RESEARCH" is also encoded only via background tint.
**Impact:** A color-blind user sees three near-identical chips. **Fix:**
Add a glyph or shape prefix per status — `●` for active, `○` for paused,
`◇` for planned, `△` for research.

### F6.8 [P2] Skip-link missing on public pages (persona-49 F1 still true)
**Evidence:** `login/desktop-1440/initial.dom.html`,
`request-access/desktop-1440/initial.dom.html`,
`risk/desktop-1440/initial.dom.html`,
`docs/desktop-1440/initial.dom.html` — none contain `Skip to main`.
**Impact:** Keyboard users must tab through the marketing nav before
reaching the form / content on every public page. **Fix:** Add the same
skip-link the dashboard layout uses to MarketingShell.

---

## Cross-Persona Patterns

### CP1 [P0] **The kill switch is the single most important control and it
is the most-hidden surface in the product**
Persona-1 (cold prospect — risk disclosure two clicks deep, no kill-switch
mention on landing); Persona-4 (risk manager — /contact page points to a
non-existent /settings kill switch); Persona-6 (a11y — no keyboard
shortcut, no aria-label that survives navigation). The Risk Monitor
toggle exists but lives only on /pipeline, with mismatched
documentation pointing to /settings. **Recommendation:** Make the kill
switch a persistent TopBar element on every authenticated page (or at
minimum on /dashboard, /trade, /pipeline) with `Ctrl+H` shortcut, screen-
reader description, and consistent `/settings#risk` deep link. Update
/contact copy to match.

### CP2 [P0] **Mobile is missing the safety story**
Persona-2 (active trader — execution-readiness card `hidden md:grid`);
Persona-5 (mobile-only — no bottom nav, settings perf monitor unreadable,
strategy cards collapsed); Persona-6 (a11y — readiness card invisible on
mobile means screen-reader users on phones never reach it). The pattern is
"on `< md`, hide the diagnostics" — but that's exactly the audience that
needs them most (one-handed traders, mobile compliance reviewers).
**Recommendation:** Sweep every `hidden md:` class on safety/readiness/
risk surfaces and replace with a stacked variant. Add a mobile-only
`SafetySheet` drawer.

### CP3 [P1] **Status taxonomy is inconsistent across surfaces**
Persona-3 (researcher — strategies-list "READY/NEEDS DATA/REVIEW/PAPER/
BLOCKED" chips don't reconcile to the active count); Persona-4 (risk
manager — Reports table shows "ACTIVE/PAUSED/PLANNED" while the catalogue
says "READY/PAPER/PLANNED"). Two different taxonomies for the same
underlying field. **Recommendation:** Pick the catalogue taxonomy
(planned / ready / paper / paused / active) as canonical; map the Reports
table to it.

### CP4 [P1] **"Coming soon" placeholders look like a marketing funnel**
Six placeholder strategy cards on /strategies and at least three "the
methodology hasn't loaded yet" panels on strategy-detail pages.
Persona-1 (cold prospect — undermines trust on first browse), Persona-3
(researcher — wastes their time clicking placeholders). **Recommendation:**
Either ship the content or hide the placeholders. Don't show "coming
soon" production-side without a date.

### CP5 [P1] **Trust signals are buried two clicks below where they're
needed**
Persona-1 (no trust strip on /login — Risk Disclosure is at /risk),
Persona-2 (no Anthropic / paper-only attribution near the trade submit),
Persona-4 (no governance log anywhere). **Recommendation:** Promote a
single trust strip to the public marketing column AND mirror a one-line
"Built on Anthropic Claude · Paper-first · Read the Risk Disclosure" in
the dashboard footer.

### CP6 [P1] **Day P&L vs unrealized vs realized vs Δ-equity attribution
is opaque**
Persona-2 (Day P&L = -$429.37 visible but unrealized = +$857.19 — both
"today" but different sign and with no tooltip distinguishing them),
Persona-4 (Reports page realized / unrealized / total split is one-dim),
Persona-6 (no aria-label on Day P&L number — screen reader hears the
number with no semantics). **Recommendation:** Define a single Day P&L
formula (Alpaca's `equity - last_equity`), document it in a hover/tap
tooltip on every surface, and use the same number on /, /reports, and
/analytics.

---

## Status of prior-flagged P0 issues that are now fixed (do not re-flag)

Verified by DOM grep against this run:

- **Strategy hero plate CAGR / MaxDD / HitRate** — `momentum-quality`
  shows `2.21 / -8.0% / +36.20% / 78%` correctly (persona-1, persona-2 P0).
- **Day P&L** — dashboard now renders `−$429.37` (real, non-zero) — was
  hard-zero in persona-1 / persona-3 audits.
- **Strategies catalogue page exists at `/strategies`** — persona-2 P0
  closed.
- **Trade ticket submit label is no longer "Stage order"** — now
  "Place after review" (still has issues per F2.1 but no longer the
  staged/submit confusion of persona-1).
- **Strategies rail `manual-discretionary` visible** — `Manual /
  Discretionary` card present in catalogue with `data-stage="other"`.

---

## Top-priority backlog (from this audit, P0 only)

1. **F4.1** — /contact references kill-switch in /settings; switch is on
   /pipeline. Fix copy or move switch.
2. **F4.2** — Add Risk Monitor / kill-switch to dashboard TopBar.
3. **F4.3** — /settings has no risk caps, no audit log, no governance
   surface.
4. **F2.1** — "Place after review" submit button has no review step.
5. **F2.2 / F5.2** — Execution-readiness card `hidden md:grid` —
   invisible on mobile.
6. **F1.4** — No trust strip on /login marketing.
7. **F3.1** — Catalogue chip counts don't reconcile.
8. **F6.1 / F6.3** — Day P&L and notifications mute for screen readers.
