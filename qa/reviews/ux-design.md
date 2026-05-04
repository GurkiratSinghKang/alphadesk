# UX & Design Critique — AlphaDesk

**Captured:** 2026-05-03 against tradingalpha.net (run 2026-05-03T23-07-16Z)
**Sampled:** 16 route-default desktop + 6 interactive states + 5 mobile-390 spot-checks across login, dashboard, trade, strategies (list + 3 detail variants), settings, alerts, analytics, pipeline, reports, request-access, docs, contact, about, privacy, terms, login-reset, not-found, help-earnings-data.

---

## Top 5 cross-cutting themes

1. **Two visual identities are colliding inside one product.** The marketing/legal/help surface ("AlphaDesk Labs / a broker-dealer") leans into a warm cream-on-near-black editorial system (serif-feeling display headings, generous whitespace, ochre CTA). The authenticated app is a dense Bloomberg-flavored terminal (compressed type, bright accents on near-black, status chips in the top strip). Each is internally coherent, but the seam between them is abrupt — login at `qa/runs/.../login/desktop-1440/initial.preview.png` even mixes a marketing hero on the left against an app-style sign-in card on the right with a bright lime-green "Sign in" button that reads as a different system than either side. Pick a reconciliation strategy (e.g., a shared "midnight" surface that the marketing pages quietly inherit) or own the contrast deliberately.

2. **The accent palette has drifted; "primary" is ambiguous.** I count at least three competing primaries in the auth app: warm ochre/tan (top-right "Request access" buttons, 404 CTA at `qa/runs/.../not-found/desktop-1440/initial.preview.png`, status chips), a bright neon-lime green (Sign-in button on login, "Buy" affordance on the trade ticket at `qa/runs/.../trade/mobile-390/initial-prefill.preview.png`), and a softer mint/sage that shows up as fills in alerts and earnings rows. The lime is jarring next to the otherwise muted terminal palette and reads as test/debug paint rather than an intentional CTA color. Decide which is the action color and which is the status color.

3. **The status strip / context bar at the top of authed pages is doing too much.** Every authed screenshot (`dashboard`, `trade`, `analytics`, `pipeline`, `reports`, `settings`, `alerts`, `strategies-*`) shows a horizontal stack of: app logo + nav, a P&L readout, a regime label ("Bull · Low Volatility"), VIX number, "STREAMING" pill, "PAPER" pill, search, theme toggle, bell, avatar — plus the route's own hero block immediately under it. On `dashboard/desktop-1440/initial.preview.png` the strip then *also* repeats book equity, day P&L, buying power, positions/orders as a second row, and the page repeats Book Equity again at the top of the Control Room. Three rows of contextual chrome before any actual page content appears is a lot of upper-fold surface area on a 1440-px viewport. Consider collapsing the secondary stat row into the page hero (only show it on dashboard, not on every route) and letting the persistent strip be denser/single-line.

4. **The strategy-detail page is unreadable in its empty/loading state.** `qa/runs/.../strategy-momentum-quality/desktop-1440/initial.preview.png` and `scrolled-mid.preview.png` show what appears to be near-white text on an extremely pale mint/cream background — body copy, H1, table headers all ghost out. Compare to `strategies-trading-agents-research/desktop-1440/initial.preview.png` which is a fully populated dark surface and reads beautifully. Either the empty/loading state is rendering on the wrong theme, or "no historical ledger data" is using a "muted" treatment so heavy that it's effectively invisible. This is the single biggest polish hit in the run.

5. **Tablet/mid-width is missing.** The captures are 1440 desktop and 390 mobile, but several pages signal that the in-between (768–1100 px) will be rough: `dashboard/desktop-1440/initial.preview.png` packs 5 hero stat cards across, then a 4-column body grid, then a 4-column right rail; `analytics/desktop-1440/initial.preview.png` uses a fixed 4-up KPI row plus a 2x2 chart grid plus a 2-col table. None of these will degrade gracefully without explicit `lg` breakpoints. The mobile views suggest you have only "stack everything" as the fallback. Worth a 1024-px audit pass.

---

## Per-route notes

### /login — desktop & mobile
- The split layout (`login/desktop-1440/initial.preview.png`) is the strongest brand moment in the app, but the auth card's "Sign in" button is a saturated lime that doesn't appear in the surrounding palette. Swap to ochre or a deeper green for harmony.
- "No account? Request access" link is barely visible against the white card — looks like it's running underneath the form footer (`filled-invalid.preview.png`).
- The right rail of the marketing hero ("Inside the workspace / Private desk / AI review / Controls") uses small-caps labels with thin underlines that visually compete with the form labels right next to them. Consider pulling that rail tighter or moving it below the hero on >1100 px.
- Mobile (`login/mobile-390/initial.preview.png`) stacks beautifully but the page is genuinely long (multiple marketing sections below the form). On mobile, sign-in users likely want to land on the form — consider hiding marketing below-the-fold or behind a "Why AlphaDesk?" disclosure.

### /dashboard ("Control room")
- Beautiful information density (`dashboard/desktop-1440/initial.preview.png`). The "Capital canvas" $101,153.17 anchor is a clear hero number. Sparklines in the right rail are tasteful.
- However: `BOOK EQUITY $101,153.17` is repeated in the persistent strip *and* as the Control-room subtitle *and* as the giant Capital Canvas number — three instances of the same number on the same fold. Pick one.
- The bottom debug/QA strip ("Alpaca paper · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · Claude · healthy · order route closed · ...") looks unintentional — it reads like a developer console leaked into prod. If it's a real "trader status" component, it needs styling; right now it's an unstyled flex row that breaks the polish of everything above it.

### /trade
- `trade/desktop-1440/initial-prefill.preview.png` — the alert banner "Executable quote required before submit" is a strong, useful pattern, but the muted brown/red color reads more like "warning" than "info needed." Consider a neutral tone since it's a guard, not a bug.
- The "Build strategy" / "Options payoff" callouts inside the right rail use multiple small inset cards in a row — each with its own border, padding, status pill — making the rail feel busy compared to the elegant chart on the left. Some of these could collapse into expandable sections.
- Mobile (`trade/mobile-390/initial-prefill.preview.png`) — full ticket stacks impressively, but the lime "BUY" button next to a green "Buy" type label and a magenta-brown "SELL" button next to it creates flashbulb conflict. Reduce one of the affordances.

### /strategies (list)
- `strategies-list/desktop-1440/initial.preview.png` is one of the most successful pages: a clean grid of strategy cards with consistent header structure (title, status chip, two metrics, footer line). Keep this card pattern as the canonical "object index" component.
- The "Active / Paused / Research / Coming soon" section headers inherit different left-icons and accent treatments — homogenize so the visual rhythm of the page is predictable.
- Card metric labels are very small caps; combined with the dense numbers they're at the edge of readable on 1440. A 1px size bump on the metric labels would help.

### /strategies/momentum-quality (detail)
- **Critical:** `strategy-momentum-quality/desktop-1440/initial.preview.png` and all states (`scrolled-mid`, `metric-hover`, `pause-click`, `bottom`) render as nearly-blank pale-mint pages with ghost text. Either the equity-chart-empty branch is hijacking the entire layout's color tokens, or these screenshots caught a true rendering regression. Investigate first; then decide whether the empty state should still show the page chrome at full contrast.
- The card header ("Click any number for...") at the top is the only element that renders dark — confirms the page chrome is intact and only the body has gone white-on-white.

### /strategies/trading-agents-research
- `strategies-trading-agents-research/desktop-1440/initial.preview.png` — excellent. Three-column workspace (research setup / report content / artifacts) is dense but legible, the "Decision signal HOLD" hero is well-anchored, and the "Price map" stripe of horizontal range bars is a great novel visualization.
- The "Memo source map" lines look like they could become hover-link-styled but are rendered as plain numbers — slight affordance mismatch.
- Mobile version (`strategies-trading-agents-research/mobile-390/initial.preview.png`) is genuinely pleasant — vertical stack respects the section hierarchy.

### /strategies/earnings-options-play
- `strategies-earnings-options-play/desktop-1440/initial.preview.png` shows a left calendar rail and a huge empty right pane reading "Select a symbol from the sidebar." The right pane is ~75% of the viewport and entirely empty — the empty state needs more visual weight (illustration, key benefits, instructions) or the layout should reflow when no symbol is selected.
- The "Edge 1×" / "Edge 1×" status chips next to symbols use orange — a fourth accent color that doesn't appear elsewhere in this density.
- `row-selected.preview.png` and `scrolled-mid.preview.png` are nearly identical to `initial.preview.png` — suggests the row-click interaction may not be wired up, or the screenshot fired before render. Worth confirming with the trade team.

### /settings
- `settings/desktop-1440/initial.preview.png` is a long single-column form with section cards. Layout is solid, but the section headers ("Trading mode · Brokerage · Notifications · Display · Data refresh · Export data · Security") all look identical and the page could use anchor-link nav on the left at desktop width (the route is long enough to warrant TOC).
- The "Performance Monitor" graph at the bottom is a nice touch but feels out of place in user settings — consider moving to a dedicated `/settings/diagnostics` or admin pane.

### /alerts
- `alerts/desktop-1440/initial.preview.png` — the create-alert form is the only content above the empty state, and the empty state ("You haven't set up any alerts yet") sits in a weird pale-mint band that doesn't match anything else on the page. The page would feel more intentional if the form lived inside a card and the empty state lived underneath as a list-empty placeholder, with consistent surface tones.

### /analytics
- `analytics/desktop-1440/initial.preview.png` — really strong. KPI row, 2x2 chart grid, trade stats, monthly heatmap. Only nit: the monthly heatmap row is mostly empty (year just started) and the gradient legend isn't shown — add a tiny color scale.

### /pipeline, /reports
- Both render densely and consistently; the `HOLD` chips and status pills follow the same pattern as elsewhere. `reports/desktop-1440/initial.preview.png` strategy-performance table is excellent — it's the cleanest table in the entire app. Use that table style as the system reference.

### /docs, /privacy, /terms, /risk, /about, /contact, /help/earnings-data
- All adopt the warm marketing system. Consistent typography and rhythm. `/docs/desktop-1440/initial.preview.png` table-of-contents header is well-considered. `/about/desktop-1440/initial.preview.png` uses §-numbered sections that reinforce the "trading desk briefing" voice — nice.
- `/contact/desktop-1440/initial.preview.png` is too sparse for a contact page — consider adding response-time expectations as cards rather than inline paragraph text.

### /not-found
- `not-found/desktop-1440/initial.preview.png` — "Not on the tape" with two CTAs is the best 404 in the run. Voice + brand + clear next-step. Keep.

### /request-access (and submit)
- Marketing hero on left + form on right, very similar to login. Consistent and good.
- After submit (`request-access-submit/desktop-1440/after-submit.preview.png`) — the success card "The desk has your details" is good copy but the marketing scaffolding underneath persists, making the page feel like the form just refreshed. Consider replacing the right column entirely with a confirmation panel + next steps timeline.

---

## Quick wins (each <1 hour)

1. **Reconcile the green.** Replace the lime "Sign in" / "Buy" green with the ochre or with a desaturated forest-green that matches the existing data-positive tones. One-token swap.
2. **Style or remove the bottom QA/status footer strip on dashboard** (the unstyled `Alpaca paper · Dashboard · …` line). It actively damages first impressions.
3. **Fix momentum-quality empty/loading contrast** so the page chrome and empty-state copy meet the same contrast standard as the rest of the authed app.
4. **De-duplicate `BOOK EQUITY` on the dashboard** — it appears three times in the upper viewport.
5. **Tighten the persistent context bar** to one row everywhere (regime + VIX + streaming + paper + search + actions + avatar). Move per-route stat cards into the page hero instead of pinning them to the global strip.

## Bigger bets

1. **Define a "terminal surface" vs "editorial surface" boundary.** Document which is which, where they meet (login, request-access, marketing-to-app transitions), and ensure a unified palette that lets one quote the other without jarring. Today they read like two separate brand systems sharing a logo.
2. **Invest in the empty-state library.** Strategies-detail empty, alerts empty, earnings-options "select a symbol" empty all feel different. A single empty-state component (icon + headline + 1-line + 1 CTA) used across every route would lift perceived polish significantly and reduce the "is this loading or broken?" anxiety in a trading product.
3. **Consider an explicit TOC pattern for long single-column pages** (`settings`, `docs`, legal). At 1440 px, a sticky left rail of section anchors costs little and makes density-heavy pages feel intentional rather than scrolly.
