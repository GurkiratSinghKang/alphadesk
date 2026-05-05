# Persona Workflow Adversarial Findings (2026-05-05)

**Methodology:** Five persona workflows walked across 8 specs in canonical sweep `qa/runs/2026-05-04T20-31-40Z` (with 14:04Z spot-check). Findings here span 2+ pages — single-page issues already in `qa/reviews/UI-REVIEW-R5.md` are excluded. Each finding is anchored in DOM/network evidence.

## Summary
- **20 findings across 5 personas: 5 P0 / 9 P1 / 6 P2**
- Recurring theme: workflows that work in isolation per page break at the **handoff between** pages — strategies → trade has no link, trade → alerts has no link, pipeline → alerts/audit-log has no link, dashboard → trade requires button-click (not anchor).
- Mode/state signals (paper-vs-live, market hours, kill-switch state) leak between rooms inconsistently.

---

## Persona 1 — NEW_USER_FIRST_TRADE

### F1 — Dashboard is the only authed page that hides "Session mode: Paper trading"
**Severity:** P0
**Workflow step:** Login → /dashboard (the very first authed surface)
**Expected:** A new user landing on the dashboard for the first time should see at-a-glance that they are in paper-trading mode (or live).
**Actual:** Cross-page sweep of `aria-label="Session mode: Paper trading"` shows the chip on every authed page **except the dashboard** (`grep -ic "Session mode\|Paper trading"`: dashboard=0, trade=1, strategies=1, reports=1, analytics=1, pipeline=1, alerts=1). The dashboard's `data-slot="context-bar"` shows VIX, regime, P&L but no mode pill. So the FIRST page a new user sees omits the most important safety signal.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/initial.png` vs `qa/runs/2026-05-04T20-31-40Z/strategies-list/desktop-1440/initial.png`
**File suspect:** `frontend/src/components/composites/TopBar.tsx` (used by dashboard) vs `frontend/src/components/layout/TopBar.tsx` (used by every other authed route — confirmed by R5-NEW-M1 fork). The non-dashboard TopBar renders the `Session mode` pill; the dashboard's composite doesn't.
**Fix:** Render the same `Session mode: Paper trading` pill on the dashboard TopBar, OR consolidate the two TopBar components (closes R5-NEW-M1 too).

### F2 — Strategy detail has zero CTA to start trading the strategy
**Severity:** P0
**Workflow step:** /strategies → /strategies/momentum-quality → (dead end)
**Expected:** From a strategy detail page a user picks they should be able to "Open in trade" / "Trade this signal" or at minimum an outbound link to /trade with the symbol pre-selected.
**Actual:** Full href grep on `strategy-momentum-quality/desktop-1440/initial.dom.html`: only `#main-content`, `/strategies`, `/risk`, plus _next assets. **No `/trade` link, no `/alerts` link, no watchlist primitive.** The "Emergency disable" is the only authoring action, and it's hidden inside a `<details>` and `disabled=""` (no perf data).
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/strategy-momentum-quality/desktop-1440/initial.png` (right rail ends at backtest table; no CTA below or in header)
**File suspect:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` — header section has no trade-handoff. Confirmed via `grep "Trade\|Watchlist\|Open in"` returns 0 matches.
**Fix:** Add a primary `<a href="/trade?symbol=${primary}&strategy=${id}">Open in trade ticket</a>` in the strategy detail header. Same pattern already exists in /strategies catalogue card aria-labels.

### F3 — Earnings-options-play research surface routes only to news, never to trade
**Severity:** P1
**Workflow step:** /strategies/earnings-options-play → user picks PLTR → no path to act
**Expected:** When a user selects an earnings-card candidate (PLTR shown selected with `data-selected="true"`), an "Open in trade ticket" CTA should fire deep-link `/trade?symbol=PLTR&strategy=earnings-options-play&combo=iron-condor`.
**Actual:** All outbound links from this page go to Google News / Benzinga / IBTimes. No `/trade` href in the DOM. User who works the entire research workflow on this page must abandon it, navigate to /trade by hand, and re-enter PLTR.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/strategies-earnings-options-play/desktop-1440/initial.png` — the highlighted PLTR card has no action button beneath it.
**File suspect:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx` — likely missing a per-card secondary CTA.
**Fix:** Add a "Stage trade ticket" button on the selected earnings card that deep-links to `/trade` with strategy+symbol pre-fill (the trade page already supports `?strategy=` from R5-B1 evidence — strategy tag rendered correctly).

### F4 — `<button>` primary CTA on mobile dashboard is not a link — breaks new-tab + middle-click
**Severity:** P2
**Workflow step:** mobile-390 dashboard → user wants to inspect orders without losing dashboard context
**Expected:** Mobile primary CTA should be `<a href="/trade">` (or `/trades/orders`) so users can long-press → open in new tab, screen reader announces "link", and right-click works.
**Actual:** `data-slot="dashboard-mobile-primary-action"` is `<button onClick={actionHandler}>`. No fallback href. `frontend/src/app/(dashboard)/page.tsx:1117-1144` constructs the action with `actionHandler` which is `onTrade | onPipeline | onOpenOrders` — not a link.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/dashboard/mobile-390/initial.png` (dominant brand-tinted CTA card).
**File suspect:** `frontend/src/app/(dashboard)/page.tsx:1117-1144`
**Fix:** When `actionHandler` is a known route, render `<Link href>` or `<a>` instead of `<button>`. Reserve `<button>` for handlers without a destination.

---

## Persona 2 — DAY_TRADER_OPTIONS (4-leg iron condor on AAPL)

### F5 — Multi-leg silent OCC fallback persists in production despite source fix
**Severity:** P0
**Workflow step:** /trade → ?legs=… deep-link with 4-leg structure → leg quotes 404 → trader sees underlying NVDA market dressed as a leg spread
**Expected:** When any leg quote 404s, OrderBar should render `data-slot="order-bar-options-unavailable"` and execution-readiness should go red.
**Actual:** R5-B1 confirms the bug. R6-5 fix shipped to source (`frontend/src/app/(dashboard)/trade/page.tsx:387,449` — `legsUnavailable` state and `setLegsUnavailable(computeMissingLegs(snapshot))`) but **production tradingalpha.net still shows the bug** in the newer 14:04Z sweep. The 14:04Z `multi-leg-prefill.dom.html` still renders `spread $0.05` instead of the unavailable banner; same 3 NVDA leg 404s.
**Evidence:** `qa/runs/2026-05-05T14-04-37Z/trade/desktop-1440/multi-leg-prefill.png` and `network.jsonl` (3× 404 on NVDA260424P00200000, NVDA260424C00220000, NVDA260425C00205000). Single-leg sweep correctly shows `data-slot="order-bar-options-unavailable"`; multi-leg does not.
**File suspect:** Source is fixed in `frontend/src/app/(dashboard)/trade/page.tsx:387-476`. **Deploy/rebuild gap.** The fix is in the repo but the build hasn't shipped.
**Fix:** Trigger a production rebuild + verify the multi-leg branch in next sweep. Add a CI guard test: deep-link with a known-404 OCC and assert `order-bar-options-unavailable` slot renders.

### F6 — Execution-readiness pill is hidden on mobile-390, even when warnings exist
**Severity:** P0
**Workflow step:** /trade ?legs=… on iPhone → trader needs to see "Buying power needs confirmation" amber chip → it never renders
**Expected:** Mobile traders need pre-trade safety signals (paper mode, buying power, leg unavailability) to be at least as visible as on desktop.
**Actual:** `data-slot="trade-execution-readiness"` has the class `hidden gap-3 ... md:grid` — the **`hidden` is unconditional**, only overridden at md+ breakpoint. On mobile-390 the trader gets no warning. Confirmed across `multi-leg-prefill`, `single-leg-prefill`, `ticket-filled` mobile DOMs.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/trade/mobile-390/multi-leg-prefill.png` (no amber readiness card visible) vs `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/multi-leg-prefill.png` (full amber card with "Buying power needs confirmation").
**File suspect:** Likely `frontend/src/app/(dashboard)/trade/page.tsx` or component rendering the readiness section. Search for `md:grid` on the readiness slot.
**Fix:** Replace `hidden ... md:grid` with a layout that renders on mobile too. Mobile is the **most** critical viewport for risk-gating because real-money traders panic-trade from phones during commute.

### F7 — Submit button "Place after review" lacks descriptive aria-label
**Severity:** P1
**Workflow step:** /trade ticket-filled → screen-reader user navigates → button announces only its visible text
**Expected:** Submit button should announce something like "Place AAPL buy 100 limit @ 235.50 in paper account" via aria-label, since the visible label "Place after review" is opaque.
**Actual:** `data-testid="order-bar-submit"` has zero `aria-label` attribute. Screen reader users hear only "Place after review, button" — they cannot know symbol, side, qty, or paper-vs-live without re-tabbing the form.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/ticket-filled.dom.html` — full HTML inspection of submit button shows no aria-label.
**File suspect:** `frontend/src/components/composites/OrderBar.tsx`
**Fix:** Add a computed `aria-label={\`Place ${symbol} ${side} ${qty} ${kind} ${paper ? "in paper account" : "live"}\`}` to the submit button.

### F8 — Trade-page redundant API polling: 3× duplicate GET on every watchlist quote
**Severity:** P2
**Workflow step:** /trade load → 66 individual `/market/quotes/` GETs in 30 seconds, with 3× duplicates per symbol
**Expected:** Watchlist symbols + active leg/contract should be hit once, then a single batched WS or batched fetch refreshes.
**Actual:** Network log shows 3× GET per symbol (AAPL, MSFT, AMZN, GOOGL, NVDA, TSLA, SPY, QQQ, META, AMD) plus 6× depth/NVDA polls. No batched `/quotes?symbols=` endpoint used. Same wasteful pattern flagged in `persona-01-day-trader.md` for orders endpoints; this finding shows it spans the quote subsystem too.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/trade/desktop-1440/network.jsonl` (382 lines).
**File suspect:** `frontend/src/lib/api.ts` `getSnapshot` per-symbol fan-out + multiple consumers triggering it.
**Fix:** Use a single batch endpoint or memoize the snapshot fetch per (cohort, ttl). On a 30-quote watchlist + 4-leg OCC chain this is 100+ requests when 1 should suffice.

---

## Persona 3 — STRATEGY_RESEARCHER

### F9 — Save-to-watchlist round-trip impossible from /strategies/{id}
**Severity:** P1
**Workflow step:** User reads OOS report, decides to track → there is no watchlist UI on the page
**Expected:** Strategy detail should expose a "Add to watchlist" toggle or save action; alternatively a "Tag for later" mechanism.
**Actual:** Across `strategy-momentum-quality/desktop-1440/initial.dom.html`: 0 mentions of "watchlist", 0 of "save", 0 of "alert" CTA. Persona's stated workflow ("save to watchlist → /alerts → create alert") cannot start.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/strategy-momentum-quality/desktop-1440/initial.png` + DOM grep confirming absence.
**File suspect:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` — header should expose watchlist action + alert-create CTA bound to the strategy.
**Fix:** Add header action group: "Add to watchlist" + "Create price alert" + "Open in trade ticket". The /alerts page accepts a `symbol` field; deep-link `/alerts?symbol=${primary}&strategy=${id}` would close the loop.

### F10 — Alerts form has no strategy-binding field, breaking the "save signal-as-alert" workflow
**Severity:** P1
**Workflow step:** Strategy researcher arrives at /alerts wanting "Alert me when momentum-quality fires" → form only accepts symbol + condition + price
**Expected:** A strategy researcher should be able to bind an alert to a strategy ID, not just a price level. Backend strategies emit signals; alerts page should subscribe.
**Actual:** Alerts form fields = symbol, condition (above/below/percent_move_above/percent_move_below), price. No strategy dropdown, no signal-type selector. The persona workflow (research → save signal → create alert) terminates because the alert primitive only models price triggers.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/alerts/desktop-1440/initial.dom.html` — full form inspection above shows only 3 inputs.
**File suspect:** `frontend/src/app/(dashboard)/alerts/page.tsx` — form has no `<select>` for strategy binding.
**Fix:** Add a 4th column "Trigger source" with options [price level | strategy signal | risk gate]. When source=strategy, populate from `/api/v1/strategies/`.

### F11 — Alerts page admits delivery channels are not wired up
**Severity:** P1
**Workflow step:** User creates an alert → expects a notification → in-app feed only
**Expected:** Alerts deliver via at least one out-of-band channel (email/webhook/push) so the user actually sees the trigger when away from the desk.
**Actual:** Page literally says: *"Delivery: in-app. Email and webhook routing are staged as explicit preferences until backend delivery channels are enabled."* So a researcher who creates an alert today gets nothing while away from the app — defeating the purpose of an alert.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/alerts/desktop-1440/initial.dom.html` — copy explicitly admits "until backend delivery channels are enabled".
**File suspect:** Backend; copy on `frontend/src/app/(dashboard)/alerts/page.tsx`.
**Fix:** Either wire one channel (the live-flip readiness blocker per `audit-reports/00-live-flip-readiness.md`), or hide the form until delivery exists — promise/delivery gap is a trust break.

### F12 — Alerts page uses legacy shadcn tokens (`text-foreground`, `border-border`, `bg-background`)
**Severity:** P2
**Workflow step:** /alerts visual scan
**Expected:** All authed pages render through AlphaDesk's `text-fg`, `border-border-hair`, `bg-bg-elev-1` token system per R3 migration.
**Actual:** Alerts page contains 10+ instances of legacy tokens: `<form class="rounded-lg border border-border bg-[var(--surface)] p-4">`, inputs with `text-foreground`, `bg-background`, `placeholder:text-muted-foreground/50`. None of these are wired in the @theme block per R5-B5 logic — they fall back to Tailwind defaults so they survive cosmetically but never theme-switch.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/alerts/desktop-1440/initial.dom.html` — search for `text-foreground` returns 5+ hits in the form alone.
**File suspect:** `frontend/src/app/(dashboard)/alerts/page.tsx` — never received the R3 token migration.
**Fix:** Token migration sweep on alerts page; add it to the R5 ESLint guard scope.

### F13 — `Last trade —` em-dash placeholder on strategy detail (visible to researcher)
**Severity:** P2
**Workflow step:** /strategies/momentum-quality → researcher checking stats sees a bare em-dash
**Expected:** Either show the actual last-trade date or render an explicit "No trades yet" / "Backtest only" affordance.
**Actual:** Confirmed in DOM: `Last trade` followed by em-dash. Already noted in R5 NIT but persists across multiple strategy detail pages — workflow-spanning rather than single-page.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/strategy-momentum-quality/desktop-1440/initial.dom.html`.
**File suspect:** `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:264-318` (`deriveLastTradeDate`).
**Fix:** When `lastTradeDate` is null, render `"None — paper-only / backtest"` instead of `—`.

---

## Persona 4 — MOBILE_RETURNING_USER (390px iPhone)

### F14 — Day P/L vs Day P&L glyph inconsistency on the SAME mobile dashboard
**Severity:** P1
**Workflow step:** Mobile dashboard load → user reads two adjacent labels → confused which is canonical
**Expected:** Single glyph treatment for "Profit/Loss" across the entire surface (project style guide says `P&L`).
**Actual:** Mobile dashboard renders BOTH `Day P&amp;L` (in context-bar) and `Day P/L` (in mobile rail) on the same DOM. Already flagged in R5 P1 but the fact that it persists on the smallest viewport — where mobile users have less mental capacity — escalates impact.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/dashboard/mobile-390/initial.dom.html` — both forms grep-match in the same file.
**File suspect:** Two separate components render different copy. Likely `frontend/src/components/composites/ContextBar.tsx` (P&L) vs `frontend/src/app/(dashboard)/page.tsx` mobile rail (P/L).
**Fix:** Centralize the label as a constant exported from `lib/copy.ts`.

### F15 — Mobile reports missing "overnight P/L" view despite persona expectation
**Severity:** P1
**Workflow step:** Mobile user opens /reports to check overnight performance → no overnight column or filter
**Expected:** /reports mobile should expose an overnight-P&L delta or a session-aware filter.
**Actual:** Mobile reports page section headings = "Portfolio statement", "Strategy performance", "Tax report (simplified)". No overnight, no last-session, no delta-since-yesterday. Persona task ("check overnight P&L") cannot complete on mobile.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/reports/mobile-390/initial.dom.html` — h1/h2 grep returns three sections, none time-windowed.
**File suspect:** `frontend/src/app/(dashboard)/reports/page.tsx` — needs a session-delta module OR mobile pinned summary card.
**Fix:** Add a "Session delta" mobile-priority card at the top of /reports showing yesterday-close-to-current.

### F16 — Mobile dashboard rail truncates copy with no expand affordance ("Working orders need r…")
**Severity:** P2
**Workflow step:** Mobile dashboard rail card → text clips with no tooltip / no tap-to-expand
**Expected:** Truncated text on mobile must offer a way to read the full string (tap, long-press, or larger viewport).
**Actual:** Mobile priority rail tile renders `truncate text-label text-fg-muted` with text "Working orders need r…" / "Orders need review" — and the card itself isn't a button so there's no tap-to-expand. Already a NIT in R5 but the workflow break for a returning user (who specifically wants to act on those orders) makes it a real friction point.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/dashboard/mobile-390/initial.png`.
**File suspect:** `frontend/src/app/(dashboard)/page.tsx` `data-slot="dashboard-mobile-priority-rail"` block uses `truncate` on tiles that aren't expandable.
**Fix:** Replace `truncate` with `line-clamp-2` (allows two lines of subtext to fit in mobile rail tile heights).

### F17 — Mobile sticky tab bar (top-2 z-2) eats vertical space; no scroll-jacking guard
**Severity:** P2
**Workflow step:** Mobile /trade scroll down to inspect chart → sticky workspace tabs occupy ~48px at top
**Expected:** Sticky chrome should auto-hide on scroll-down (like Twitter/Stocks app).
**Actual:** `<nav aria-label="Mobile trade workspace" class="sticky top-2 z-[2] grid grid-cols-4 gap-1 ...">` is sticky-pinned at all times. On a 844-tall iPhone with the system status bar (44pt) + AppTopBar + this sticky tab bar, ~120px is fixed chrome before the chart even renders.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/trade/mobile-390/multi-leg-prefill.dom.html`.
**File suspect:** Sticky nav in `frontend/src/app/(dashboard)/trade/page.tsx` mobile workspace — needs scroll-direction-aware show/hide.
**Fix:** Hide on scroll-down (translateY(-100%)), restore on scroll-up.

---

## Persona 5 — POWER_USER_PIPELINE_OPS

### F18 — Pipeline page has no per-strategy kill-switch; "Emergency disable" lives only on detail page (and is gated)
**Severity:** P0
**Workflow step:** /pipeline → operator identifies a failing strategy → no inline kill-switch → must navigate to /strategies/{id} → which has the button buried in `<details>` and gated by `!reason.trim()`
**Expected:** /pipeline operator view should expose a per-strategy kill-switch with single confirmation prompt. That's the *primary* point of the page.
**Actual:** Full button inventory on `pipeline/desktop-1440/initial.dom.html` shows top-bar nav, regime/VIX pills, theme toggle, daily run heatmap (disabled buttons for past dates), and one "Risk Monitor: ON" pressed-state toggle. **Zero strategy-row kill-switch buttons.** Operator must leave the room to halt a strategy. Worse: kill-switch on `/strategies/{id}` is `<details><summary>Emergency disable</summary>` — collapsed by default. Source: `KillSwitchStatusPanel.tsx:189-217`. The Submit is `disabled={busy || !reason.trim()}`, so operator must type a reason just to enable the button.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/pipeline/desktop-1440/initial.png`; `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:191-216`.
**File suspect:** `frontend/src/app/(dashboard)/pipeline/page.tsx` — should have an inline kill-switch column per strategy row. `KillSwitchStatusPanel.tsx:191` should not gate the affordance behind a `<details>`.
**Fix:** Surface the kill-switch as a prominent destructive-tone button at row level on /pipeline. On detail pages, expand the `<details>` by default when the page loads to ACTIVE state.

### F19 — No /pipeline → /alerts cross-link to verify "kill-switch fired" workflow
**Severity:** P1
**Workflow step:** Operator hits kill-switch → expects to see the alert that fired → /alerts is not linked from /pipeline
**Expected:** After a kill-switch event, /pipeline should show "Alert fired: see audit log →" with a link into /alerts (or audit-trail).
**Actual:** Full href list on `pipeline/desktop-1440/initial.dom.html` (excluding _next assets): `#main-content`, `/strategies`, `https://tradingalpha.net`. **No `/alerts` link, no audit-log link.** Operator has no way to confirm the kill-switch event was logged or fired downstream alerts.
**Evidence:** `qa/runs/2026-05-04T20-31-40Z/pipeline/desktop-1440/initial.dom.html` href grep.
**File suspect:** `frontend/src/app/(dashboard)/pipeline/page.tsx` — needs an "Recent escalations" panel with /alerts and /audit links.
**Fix:** Add an "Escalations" rail at the bottom of /pipeline pulling the last N alert/audit rows with cross-links.

### F20 — No restart / re-enable affordance on /pipeline; only on /strategies/{id}
**Severity:** P1
**Workflow step:** After a kill-switch, operator wants to restart a strategy → must navigate away from pipeline view
**Expected:** Pipeline view shows current state (halted/active) per strategy + an inline re-enable when state=halted.
**Actual:** /pipeline has no re-enable affordance. The "Re-enable" button only appears in `KillSwitchStatusPanel.tsx:178-181` on the strategy detail page. Operator workflow (kill → verify → restart → verify) bounces between three pages.
**Evidence:** `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:178-181` (`{busy ? "Re-enabling…" : "Re-enable"}`); not present on pipeline DOM.
**File suspect:** Same as F18: `frontend/src/app/(dashboard)/pipeline/page.tsx` needs row-level state machine controls.
**Fix:** Pipeline rows should expose Status (Active/Halted/Pending), Last Heartbeat, and an action button (kill | restart | restart with reason) per row.

---

## Cross-cutting workflow themes

1. **Hub-and-spoke navigation gaps** — F2/F3/F9/F10/F19/F20 all describe the same disease: each page is information-rich but doesn't terminate workflows. /strategies has no /trade link. /alerts has no /strategies link. /pipeline has no /alerts link. The product's mental model (research → trade → monitor → alert → halt → restart) requires a six-page tour to complete and breaks the back-button.

2. **Mobile feature parity gaps** — F6/F14/F15/F16/F17 all show that mobile is treated as a render-target rather than a first-class workflow surface. Critical signals (execution-readiness amber chip — F6) are *desktop-only*. Mobile copy clips without affordances (F16). Reports has no mobile-tuned overnight view (F15).

3. **Mode/state signals leak inconsistently** — F1 (no paper-mode chip on dashboard), F11 (alert delivery channels admittedly not wired), F18 (kill-switch buried). The product knows whether you're in paper, but doesn't tell you when you most need to know (the dashboard).

4. **Source ahead of deploy** — F5 documents an R6-5 fix that's in the source tree but not in the deployed bundle. This isn't a UX bug per se, but the workflow-impact is severe (P0) and a CI guard test would prevent reoccurrence.

---

## Suggested fix sequencing

| Priority | Findings | Theme |
|---|---|---|
| P0 first | F1, F2, F5, F6, F18 | Mode visibility + cross-page CTAs + critical safety signals |
| P1 next | F3, F4, F7, F9, F10, F11, F14, F15, F19, F20 | Workflow-completion + a11y + mobile parity |
| P2 third | F8, F12, F13, F16, F17 | Polish + tokens + mobile chrome |

A 2-PR sprint covers F1+F4 (TopBar consolidation), F2+F3+F9 (strategy detail handoff CTA), F5 (deploy + CI guard), F6 (mobile readiness pill). Persona-1/2 workflows then complete cleanly.
