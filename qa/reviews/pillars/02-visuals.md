# Pillar 2 — Visuals

**Run:** `qa/runs/2026-05-04T02-58-02Z`
**Audited:** 2026-05-03
**Stance:** Adversarial. Visuals fail until proven otherwise.
**Score:** **2 / 4** — Needs work. Strong moments (login marketing pane, /not-found, /strategies-list cards, /strategies-trading-agents-research detail) sit alongside two genuinely brand-damaging defects (the unstyled mono pill rail at the bottom of every authed page; a saturated lime accent that does not belong in the palette) and a flat hierarchy on most authed routes.

This review extends `qa/reviews/ux-design.md`. I confirm or extend its findings with file:line evidence and add new defects it did not call out. I do not duplicate copy/typography/color analysis owned by the other pillars.

---

## What I sampled

Read 14 `.preview.png` captures total over two turns (5 in this report's plan, plus prior-batch reads for grounding):
- `dashboard/desktop-1440/initial.preview.png`
- `dashboard/mobile-390/initial.preview.png`
- `login/desktop-1440/initial.preview.png`
- `strategy-momentum-quality/desktop-1440/initial.preview.png`
- `trade/desktop-1440/initial-prefill.preview.png`
- `trade/mobile-390/initial-prefill.preview.png`
- `strategies-list/desktop-1440/initial.preview.png`
- `strategies-list/mobile-390/initial.preview.png`
- `strategies-trading-agents-research/desktop-1440/initial.preview.png`
- `strategies-earnings-options-play/desktop-1440/initial.preview.png`
- `analytics/desktop-1440/initial.preview.png`
- `pipeline/desktop-1440/initial.preview.png`
- `reports/desktop-1440/initial.preview.png`
- `settings/desktop-1440/initial.preview.png`
- `alerts/desktop-1440/initial.preview.png`
- `not-found/desktop-1440/initial.preview.png`
- `about/desktop-1440/initial.preview.png`

DOMs scanned with a Python pass to count icon-only `<button>` instances (1,177 total `<button>` tags across desktop DOMs).

---

## Score rationale

**Why not 1:** Several routes are genuinely good and reward the eye. The 404 page (`not-found/desktop-1440/initial.preview.png`) is a complete focal-point composition. `/strategies-list/desktop-1440/initial.preview.png` and `/strategies-trading-agents-research/desktop-1440/initial.preview.png` show that the team can compose dense terminal information with hierarchy.

**Why not 3:** The persistent bottom mono-pill rail on every authed route reads as developer chrome (raw "Alpaca paper · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · Claude · healthy · order route closed · ..." string of text-fg-muted pills with tiny dots) — confirmed in source at `frontend/src/components/composites/StatusBar.tsx:42-65`. It actively damages the first impression of every authed surface in the run. Combine with the lime-green CTA token leaking into the trade ticket and dashboard hero number being repeated three times above the fold and the visuals pillar cannot honestly pass.

---

## BLOCKER findings

### B1. Unstyled-looking mono "StatusBar" rail at the bottom of every authed route reads as a debug overlay
**Evidence:**
- `qa/runs/2026-05-04T02-58-02Z/dashboard/desktop-1440/initial.preview.png` — bottom 22 px is a row of dim mono text "Alpaca paper · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · Claude · healthy · order route closed · ..." with tiny coloured dots and no visible separators. There is no card, no border that reads as a chrome surface, no padding rhythm that distinguishes it from page content.
- Same pattern visible at the bottom of `pipeline/desktop-1440/initial.preview.png`, `analytics/desktop-1440/initial.preview.png`, `reports/desktop-1440/initial.preview.png`, `settings/desktop-1440/initial.preview.png`.
- Source: `frontend/src/components/composites/StatusBar.tsx:42-65` renders `flex items-center h-[22px] px-5 gap-[18px] ... font-mono text-[12px] text-fg-muted` with `border-t border-border bg-ink-050`. The 22 px height + 12 px mono + muted foreground + zero glyph for "I am a status pane" is exactly the recipe for "developer console leaked into prod."
- Mounted from the dashboard at `frontend/src/app/(dashboard)/page.tsx:2486` (`return <StatusBar pills={pills} buildVersion={buildVersion} />;`).

**Why it is a blocker:** This is the very last thing in the user's eye on every authed route. It is the strongest signal in the product for "polished" vs "internal beta" and right now it is the latter. The prior UX review flagged this as the #2 quick win — it is still unfixed in this capture run.

**Fix:** Either elevate the rail visually (slightly brighter `bg-ink-100`, two-row layout with explicit "SYSTEM" eyebrow, clear left-side icon dotline + right-side build/⌘K cluster), or push it into a collapsed bottom-nav drawer that opens on hover/click. A 22 px terminal rail can absolutely be a polish moment (Bloomberg Terminal does this beautifully) — current execution is just unstyled.

---

### B2. Lime-green "BUY" / sign-in green is a different token than the rest of the palette
**Evidence:**
- `trade/mobile-390/initial-prefill.preview.png` — the `BUY` chip in the execution ticket is a saturated neon-lime that visibly does not match the muted profit greens, the ochre CTA on `/not-found`, or the brand brown elsewhere.
- `trade/desktop-1440/initial-prefill.preview.png` — same chip appears at the right rail (smaller but the same lime token).
- `login/desktop-1440/initial.preview.png` — the right-side auth card's "Sign in" button is the same lime; it visibly doesn't appear anywhere else in the marketing pane on the left.
- The prior UX review (`qa/reviews/ux-design.md` lines 12, 38) called this out and the patch isn't shipped in this capture run.

**Why it is a blocker for visuals (not just color):** It breaks the visual continuity of the system. Two affordances that should read as "primary CTA" (auth "Sign in" and trade "BUY") are using a token that lives nowhere else, which makes them feel like prototype paint rather than the canonical action color.

**Fix:** Replace the lime token with the same ochre/brand-tan used on the `/not-found` "Back to AlphaDesk" CTA (or with the desaturated `text-up-500` profit green if the team wants directional signaling on BUY). One-token swap; impact is system-wide.

---

## WARNING findings

### W1. Dashboard repeats `$101,167.01` three times above the fold — no single primary focal point
**Evidence:** `dashboard/desktop-1440/initial.preview.png` shows BOOK EQUITY $101,167.01 in the persistent context bar (top-left), as the Control-room subtitle, and again as the giant Capital Canvas number in the body. Source: `frontend/src/app/(dashboard)/page.tsx:1203` defines the Capital canvas eyebrow; `frontend/src/components/layouts/DashboardLayout.tsx:61` carries a comment acknowledging the "promoted Book Equity hero (28px display). The other 3 rows…" — so the team is aware the duplication exists. The hero is supposed to be the focal point but it's being undermined by competing instances of the same number.

**Why it matters for Pillar 2:** The dashboard nominally has a "Capital canvas" hero (good!) but a hero that repeats itself ceases to function as the focal point. Visual hierarchy collapses to "everything is the same thing."

**Fix:** Keep the giant Capital Canvas number; demote the secondary persistent-bar copy to "P&L only" on the dashboard route (it can keep showing book equity on every other route where the body doesn't repeat it). Drop the `Control room` subtitle re-print.

---

### W2. Three rows of chrome before any page content on every authed route
**Evidence:**
- `dashboard/desktop-1440/initial.preview.png` shows three stacked horizontal rows above any page content: (1) the global TopBar with logo + nav + search + theme toggle + bell + avatar; (2) the StatusStrip with P&L · Regime · VIX · STREAMING · Alpaca (Paper) · PAPER chip — see `frontend/src/components/layout/StatusStrip.tsx:62-124`; (3) the per-page promoted summary row (BOOK EQUITY · DAY P&L · BUYING POWER · POSITIONS · OPEN ORDERS · SELECTED TICKER) immediately under that.
- The same triple-stack appears on `analytics/`, `pipeline/`, `reports/`, `settings/`, `alerts/`. On `analytics/desktop-1440/initial.preview.png` the third row is a dedicated "Portfolio analytics" eyebrow + display heading + 1W/1M/3M/6M/YTD/ALL filter — fine on its own but it competes with the two strip rows above for what is the most important thing on screen.

**Why it matters:** The 6-pillar rubric asks "does each route have a clear primary focal point?" When the user lands on `/analytics` they should see "the analytics" — they currently see strip · strip · header before they see the KPIs. Focal hierarchy is flat.

**Fix:** Collapse the per-route promoted stat row into the page hero (only on `dashboard/`), tighten the global StatusStrip to one row everywhere (`StatusStrip.tsx:62`'s `h-7` is fine; the issue is the secondary stat band beneath, not the strip itself).

---

### W3. `/strategies-earnings-options-play` empty-state right pane is ~75% of the viewport with one sentence in it
**Evidence:** `strategies-earnings-options-play/desktop-1440/initial.preview.png` — the right pane reads only "Select a symbol from the sidebar." centered in an enormous empty rectangle. No illustration, no key benefits, no instructions, no preview of what selecting a symbol will do. The eye lands on the calendar rail (small, dense) and then bounces off a void.

**Why it matters for Pillar 2:** Empty states are visual content. A visually empty 75%-of-viewport region with one line reads as "this page is broken / not finished" rather than "you have a deliberate next step." The pattern is repeated at `alerts/desktop-1440/initial.preview.png` where the empty state ("You haven't set up any alerts yet") sits in a pale-mint band that doesn't match the surfaces around it (different bg token, different padding).

**Fix:** Build a single `EmptyState` component (icon + headline + 1-line + 1 CTA) and use it at both surfaces. The icon alone solves 80% of the visual hollow.

---

### W4. `/strategies-earnings-options-play` "Edge 31 / Edge 16 / Edge 14 …" chips use an orange that appears nowhere else on this surface
**Evidence:** `strategies-earnings-options-play/desktop-1440/initial.preview.png` — each row in the calendar sidebar carries an `Edge NN` chip rendered with an orange-on-dark fill that doesn't read as either the brand ochre or the amber warning tone used in StatusStrip pills (`frontend/src/components/layout/StatusStrip.tsx:52` `text-amber`). It introduces a fourth semantic colour that the user has to learn from context.

**Why it matters:** Density-heavy terminal UIs survive only if every accent has a single, learned meaning. Inventing a fourth chip colour for "edge score" forces re-encoding.

**Fix:** Either reuse the existing brand ochre (the `Back to AlphaDesk` 404 token) or render Edge NN as a numeric-only indicator with a small upward arrow and `text-up-500` if the score is positive — same data, no new token.

---

### W5. `/strategy-momentum-quality` desktop initial frame is a near-empty flat dark page with no focal point
**Evidence:** `strategy-momentum-quality/desktop-1440/initial.preview.png` — the page renders as a hero "Cross-Sectional Momentum + Quality" headline + a single-line metric row (2.21 / -8.6% / +36.20% / 75%) and then ~70% vertical empty space with a faint "Be cautious here" / "When to deploy" pair of subdued sections. There is one badge and two ghost subheads. No chart, no positions table, no order history, no breadcrumb of "what would I do here next?". Compare to `strategies-trading-agents-research/desktop-1440/initial.preview.png` (well-populated, three-column workspace, clear primary "Decision signal HOLD" focal block).

Note: the prior UX review's "near-white text on pale-mint" rendering issue from a previous capture is no longer reproduced here — this run shows a dark theme. The new defect is different: hierarchy is flat and the page has no obvious primary thing.

**Fix:** Pull at least one signal-rich element into the upper fold (the equity curve, even at zero-data, with a "Backtest pending" overlay; or a "Run backtest" hero CTA). The empty-state for the body should be a single deliberate composition, not hollow scroll.

---

### W6. Persistent context bar packs 7+ semantic tokens into a single 28 px row — visual rhythm flattens
**Evidence:** Every authed capture (`dashboard/`, `trade/`, `analytics/`, `pipeline/`, `reports/`, `settings/`, `alerts/`, all `strategies-*`) shows the strip at `frontend/src/components/layout/StatusStrip.tsx:62-124`: P&L block · Regime block · VIX block · STREAMING dot · Alpaca (Paper) label · PAPER chip · (sometimes) Demo data link. Six pipe-divider segments + a coloured chip + a coloured pill + a pulsing dot in 28 px is a lot. On `analytics/desktop-1440/initial.preview.png` the strip and the route hero `Portfolio analytics` headline are competing for the eye and the strip wins (because of the green pulsing dot + the orange PAPER chip).

**Fix:** Either move the PAPER chip into the user-avatar dropdown (it's a trading-mode setting), or de-emphasise the dividers (remove the `border-r border-border/50` between cells at `StatusStrip.tsx:74,80,86,91,114`) so the row reads as a single continuous status caption rather than seven equal-weight badges.

---

## NIT findings

### N1. Dashboard `/dashboard/mobile-390/initial.preview.png` "Review 2 working orders" CTA chip uses a different border-radius than its sibling "Risk gates" / "Cash buffer" cards
The mobile dashboard's primary action card has more rounded corners (`rounded-md` per `frontend/src/app/(dashboard)/page.tsx` mobile-primary-action class string from the DOM: `rounded-md border border-brand/30 bg-brand/10`) than the surrounding metric cards which use a tighter `rounded-md` on a different scale. They look mismatched.

### N2. Settings page section headers render identically (`/settings/desktop-1440/initial.preview.png`)
Trading mode · Brokerage · Notifications · Display · Data refresh · Export data · Security all use the exact same heading treatment + the same icon token (a small circle/bullet). On a long single-column form this kills landmark scanning. A sticky left rail TOC at desktop width would solve it.

### N3. `/reports/desktop-1440/initial.preview.png` strategy-performance table is the cleanest table in the app — promote it as the canonical
This isn't a defect — it's the opposite. Lift the row spacing and column-rule treatment from this table and apply it to the `/dashboard` Book panel and `/pipeline` calendar tables which feel less considered.

### N4. `/about/desktop-1440/initial.preview.png` has eight discrete `<` chevrons rendered before each section header that could read as "broken Markdown" if the user is in a hurry
The `§` glyph is a great voice choice; the chevron / ASCII separator under each "§ NN — TITLE" label is small and looks like an unrendered markdown character. Consider a hairline rule instead.

### N5. Z-index / stacking — no overlap issues observed in the sampled screenshots
Checked dashboard, trade, settings, alerts, strategies-list. No popover/modal/tooltip overlap visible in any captured frame. Pass.

### N6. Image / asset usage — no broken icons or missing images observed
All Lucide-style icons render correctly. No placeholder-looking visuals. The dashboard sparklines render cleanly. Pass.

---

## Icon-only button audit (a11y dimension of Pillar 2)

I ran a Python pass over every `*.dom.html` under `qa/runs/2026-05-04T02-58-02Z/*/desktop-1440/`. The audit identified `<button>` tags whose only inner content is an `<svg>` (no visible text after stripping all child elements), and counted those that had neither `aria-label` nor `aria-labelledby` nor an inner `<title>`.

- Total `<button>` tags audited: **1,177**
- Icon-only candidates: **(varies per page; ~6 per dashboard alone)**
- Icon-only WITHOUT `aria-label` / `aria-labelledby` / `<title>`: **0**

This is a clear pass. Every icon button in the captured run is labeled. Verified examples from `dashboard/desktop-1440/initial.dom.html`:
- mobile sheet trigger — `aria-label="Open menu"`
- command palette — `aria-label="Open command palette"`
- theme toggle — `aria-label="Switch to light mode"`
- notifications — `aria-label="Notifications"`
- user menu — `aria-label="User menu"`

---

## Top 3 fixes (priority order)

1. **Style or replace the bottom `StatusBar` mono rail** (`frontend/src/components/composites/StatusBar.tsx:42-65`). It is the single biggest perceived-polish hit on every authed page in the run. Two paths: (a) elevate it (taller, brighter `bg-ink-100`, "SYSTEM" eyebrow, group pills into icon-prefixed clusters); or (b) collapse it into a single "System OK · build 2.4.1" pill that opens a popover with the detail. Either is better than the current raw mono dot-list.

2. **Swap the lime CTA token to ochre / desaturated profit-green system-wide.** Affects `auth Sign in`, `trade BUY`, plus any other surface using the same token. One-token change; visible everywhere. Eliminates the "two visual identities colliding" complaint cited as the #1 cross-cutting theme in `qa/reviews/ux-design.md:10`.

3. **De-duplicate `BOOK EQUITY $…` on `/dashboard`** (`frontend/src/app/(dashboard)/page.tsx:1203` + `frontend/src/components/layouts/DashboardLayout.tsx:61`). Pick one canonical instance — the giant Capital Canvas number — and demote the persistent-bar repeat on the dashboard route only. This restores the "Capital canvas" as the page's true focal point.

---

## Files Audited

Source files cited:
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StatusBar.tsx` (lines 42-80)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/StatusStrip.tsx` (lines 12-151)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` (lines 1203, 2486)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layouts/DashboardLayout.tsx` (line 61)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/layout.tsx` (line 311)

Screenshots cited (all `.preview.png`):
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/dashboard/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/dashboard/mobile-390/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/login/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/strategy-momentum-quality/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/trade/desktop-1440/initial-prefill.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/trade/mobile-390/initial-prefill.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/strategies-list/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/strategies-list/mobile-390/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/strategies-trading-agents-research/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/strategies-earnings-options-play/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/analytics/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/pipeline/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/reports/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/settings/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/alerts/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/not-found/desktop-1440/initial.preview.png`
- `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T02-58-02Z/about/desktop-1440/initial.preview.png`

DOMs scanned (all `desktop-1440/*.dom.html` for icon-button audit; ~60 files; 1,177 buttons total).
