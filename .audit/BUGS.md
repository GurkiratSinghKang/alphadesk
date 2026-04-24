# AlphaDesk — Comprehensive Bug Report

**Target:** https://tradingalpha.net
**Audit date:** 2026-04-19 (session started 21:03 ET)
**Method:** 10 expert personas, each walking the live product (not local). Each persona captured screenshots, inspected console / network / DOM, probed edge cases, and filed findings independently.

**Personas (see `./personas/` for full write-ups):**

1. Day Trader (scalper) — `persona-01-day-trader.md`
2. Quant Analyst — `persona-02-quant-analyst.md`
3. Risk Manager — `persona-03-risk-manager.md`
4. Compliance Officer — `persona-04-compliance.md`
5. New Retail Investor — `persona-05-new-retail.md`
6. Accessibility User — `persona-06-a11y.md`
7. Mobile User — `persona-07-mobile.md`
8. Security Researcher — `persona-08-security.md`
9. Portfolio Manager — `persona-09-portfolio-manager.md`
10. Performance Analyst — `persona-10-performance.md`

**Severity scale:**
- **P0** — data correctness, money loss, security, or app-break
- **P1** — major UX or functional defect
- **P2** — minor UX, copy, polish
- **P3** — nice-to-have / consistency

---

## Summary — top themes

The single biggest class of defects on AlphaDesk is **cross-page data inconsistency**. The same position, same symbol, same session shows different P&L, different current price, and different equity on the Desk, the Pipeline, and the Reports pages. For a trading / compliance product this is disqualifying. Everything else is secondary.

The second class is **two-shell confusion**: the root `/` route uses a minimal "Desk" shell (Desk · Strategies · Analytics · Pipeline · Alerts) while every other page uses the richer "Analytics" shell (Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports). Navigation, defaults, and copy drift between them.

The third class is **silent failures**: the order ticket accepts negative qty, absurd qty, and bad payloads, the backend returns 422, but the UI never tells the user.

Security posture is largely solid — auth cookies are HttpOnly / Secure / SameSite=strict, alg:none is rejected, rate-limiting trips at 6 attempts, CORS preflight from evil origins is rejected. The main security gaps are CSP `'unsafe-inline'` and the login response leaking JWTs in the JSON body alongside the cookie.

---

## P0 — data correctness, money loss, or security

### BUG-001 [P0] Same position shows three different "current prices" across three pages of the same session
**Persona:** Compliance, Quant, Risk, PM

| Page | AVGO qty | AVG/ENTRY | CURRENT | P&L |
|---|---:|---:|---:|---:|
| Desk (`/`) right panel | 15 | 381.05 | ~399.38 (implied) | +$275 / +$273 (varied across reloads) |
| Pipeline (`/pipeline`) | 15 | 381.05 | **406.06** | **+$375.15** |
| Reports (`/reports`) | 15 | 381.05 | **400.00** | **+$284.25** |

BA shows the same pattern (Desk −$113 vs Reports −$101.25). EQUITY also drifts: Desk `$100,347.87` and `$100,347.31` vs Reports `$100,368.54`. Three pages, three truths, three P&Ls. Users cannot reconcile; regulators cannot audit.

**Fix:** All three surfaces must read portfolio state from a single service with a single cache key; `connect-src wss://tradingalpha.net` is already in CSP — switch quote + position streams to a WebSocket so all pages see the same tick, and freeze portfolio valuations to last-close NBBO when the market is closed.

### BUG-002 [P0] Invalid and absurd orders silently rejected with no UI feedback
**Persona:** Day Trader

Typing `-100` or `999999999` in QTY and clicking Place order fires a POST `/api/v1/trades/orders` that the backend rejects with `422`. The button gives no toast, no inline error, no loading state — the form looks untouched. A scalper cannot tell whether the order hung, submitted, or was rejected.

**Fix:** Surface 4xx responses from the orders endpoint as a toast or inline error. Disable the button while the POST is in flight.

### BUG-003 [P0] Every open position has `STOP LOSS = None` but the pipeline header shows "Risk Monitor: ON"
**Persona:** Risk Manager

All 7 positions on `/pipeline` list "None" under STOP LOSS and `—` under TAKE PROFIT. The risk monitor badge is `ON` next to `Last heartbeat: Never`. A risk monitor that has never heartbeat is not on.

**Fix:** Enforce a policy default stop on every position opened (at least on paper). Don't claim "Risk Monitor: ON" when heartbeat is Never.

### BUG-004 [P0] PEAD shows "Invested $4.9K" but "0 positions" — accounting identity broken
**Persona:** PM

PEAD card: `0 positions · Invested $4.9K`. Detail page `/strategies/pead` confirms *"No positions open."* `Invested = Σ shares × cost_basis` — zero positions cannot hold $4.9K.

**Fix:** Either attribute the $4.9K to the open-orders bucket (and relabel), or trace why the aggregator is off.

### BUG-005 [P0] Two different navigation shells for what is logically one app
**Persona:** Quant, Retail, Docs author

- Desk (`/`) uses: `αAlphaDesk · Desk · Strategies · Analytics · Pipeline · Alerts` (5 items, serif wordmark, no icons)
- Everything else uses: `⚡AlphaDesk · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · [project dropdown] · 🔍` (7 items, icons, search box)

Docs tell users to find "Dashboard" and "Trade" — neither exists on the Desk. The route `/dashboard` redirects to `/` but the page there calls itself "Desk". URLs, shell, and labels all drift.

**Fix:** Unify on one shell. Pick "Desk" or "Dashboard" — not both — and keep `/trade` accessible from both.

---

## P1 — major UX or functional defect

### BUG-006 [P1] Order ticket defaults differ between `/` and `/trade`
- Desk: `QTY 1 · TYPE Market`
- `/trade`: `QTY 100 · TYPE Limit`

A user who clicks "Place order" with defaults gets wildly different exposure on the two surfaces. **Persona: Retail, Day Trader.**

### BUG-007 [P1] "LIVE" green dot co-exists with "Alpaca (Paper) · PAPER" badge
Same status bar shows both. In a trading UI, the word "LIVE" must mean live trading. Rename to `STREAMING` or `CONNECTED`. **Persona: Compliance, Quant.**

### BUG-008 [P1] Order count shown in two places disagrees
- Top bar: `POSITIONS · ORDERS 7 · 10`
- Right panel tabs: `POSITIONS 7 · ORDERS 50 · JOURNAL 7`

10 vs 50 for the same "orders" label. **Persona: Day Trader, Quant.**

### BUG-009 [P1] Strategy counts disagree between Desk sidebar, Strategies page header, and Reports table
- Desk sidebar: `Strategies 12/13`
- Strategies page: `12 active · 1 paused · 7 coming soon · 20 total`
- Reports strategy table: 2 paused (Earnings Vol Premium **and** Gap Fill) + the `ACTIVE` `NOT READY FOR LIVE` contradiction on Opening Range Breakout

**Persona: Quant, Compliance, PM.**

### BUG-010 [P1] "Opening Range Breakout" card shows `ACTIVE` + `NOT READY FOR LIVE` pills simultaneously
Mutually exclusive states rendered together. **Persona: Quant, Compliance.**

### BUG-011 [P1] "Run Now" on `/pipeline` fires without a confirmation modal
Nothing stops a user from firing the pipeline accidentally. For an action that can emit orders, require a confirm step. **Persona: Risk.**

### BUG-012 [P1] Login page header date is one day ahead of the Desk header
Login shows `2026-04-20`; Desk, once signed in, shows `Sun, Apr 19`. Sunday night ET bug — almost certainly a UTC vs ET rendering split. **Persona: Retail, QA.**

### BUG-013 [P1] Pipeline "Next scheduled run" disagrees with itself on the same page
- Header: `Next scheduled run: 4/20/2026, 9:35:00 AM`
- Body: `Market is closed today. Next scheduled run: Monday 09:30 ET.`

9:30 vs 9:35. For scheduled trading, a five-minute drift is material. **Persona: Risk.**

### BUG-014 [P1] Three onboarding/contact channels for invite access
- `/request-access`: email `legal@tradingalpha.net`
- `/docs` getting started: email `support@tradingalpha.net`
- No form on either page

**Persona: Retail.**

### BUG-015 [P1] Position P&L values drift between page reloads with market closed
Back-to-back refreshes of the Desk produce slightly different equity and per-symbol P&L (`$100,347.87 → $100,347.31`, AVGO `+$275 → +$273`). Backend must be re-pricing each HTTP fetch. Root cause is the same polling architecture in BUG-016. **Persona: Quant.**

### BUG-016 [P1] Polling architecture instead of WebSockets
295 `/api/v1/*` requests in ~60 s, dominated by 10 quote-endpoint GETs repeated every few seconds. `wss://tradingalpha.net` is permitted by CSP but not used for the quote stream. Wasteful, and it guarantees cross-page price drift (BUG-001). **Persona: Performance.**

### BUG-017 [P1] Redundant API polling on first paint
Three separate `/trades/orders` GETs (bare, `?status=pending`, `?status=open`) and two `/portfolio/summary` GETs on every page load. **Persona: Day Trader, Performance.**

### BUG-018 [P1] All 7 open positions have the identical entry timestamp `Apr 18, 2026, 01:42 AM`
Same timestamp, same second. Either seeded data or the trail is not recording real entry times. **Persona: Risk, Compliance.**

### BUG-019 [P1] Manual / Discretionary detail page emits a CAGR but em-dashes OOS Sharpe, MaxDD, HitRate
All four are computed from the same trade series. Partial-rendering without a warning is misleading for allocation. **Persona: PM.**

### BUG-020 [P1] Strategy detail breadcrumb says "Dashboard / …"
`/strategies/pead` breadcrumb reads `Dashboard / Post-Earnings Announcement Drift`. Should be `Strategies / …`. Tied to BUG-005 (shell confusion). **Persona: PM.**

### BUG-021 [P1] Strategy detail copy exposes internal filenames
PEAD page references `audit-reports/phase1-pead.md` and `audit findings F1-F5` in user-visible copy. Either link to a rendered page or strip the filename. **Persona: PM.**

### BUG-022 [P1] Desk page has no `<h1>`
Screen readers orient by heading. The "SPY" symbol label is styled like a heading but isn't one. **Persona: A11y.**

### BUG-023 [P1] "Ask anything…" AI input has no accessible name
No `aria-label`, no `<label for>`, only a placeholder — placeholder is not a label. **Persona: A11y.**

### BUG-024 [P1] 41 of 55 interactive targets below 44×44 pt touch minimum on the Desk
Chart range pills (`1D`, `5D`, etc.) are 31×23. Top nav links are 29 px tall. **Persona: Mobile.**

### BUG-025 [P1] Focus rings appear reset on some buttons
Sampled button's `:focus-visible` computed style returned empty outline + box-shadow. Keyboard users may not see where focus lives. **Persona: A11y.**

### BUG-026 [P1] CSP allows `'unsafe-inline'` for script-src and style-src
Disables the strongest XSS mitigation CSP provides. Move to nonce-based CSP. **Persona: Security.**

### BUG-027 [P1] Intermittent "Connecting to live data…" banner + OFFLINE flash on navigation
Cold reloads of `/strategies` flip the top bar to `OFFLINE` and show skeleton cards for 3+ s. During market hours a PM would panic. **Persona: PM.**

### BUG-028 [P1] "Manual / Discretionary" strategy has 7 live positions and $57.1K invested but em-dashes its OOS Sharpe / CAGR / MaxDD on the grid card
On the grid it's em-dashes, on the detail page CAGR appears (+1.50%) but the other three are still em-dashes. If this is a discretionary catch-all, label it `No backtest (discretionary)` rather than blank metrics. **Persona: Quant.**

### BUG-029 [P1] Tax Report has no disclaimer
`/reports` → Tax Report (Simplified) offers `Download Tax Report (CSV)` with no "not tax advice · consult a professional" statement. **Persona: Compliance.**

### BUG-030 [P1] Desk LAST TRADE for Manual / Discretionary = `Apr 17, 2026`, but all position entry dates on Pipeline = `Apr 18, 2026`
Last trade should be on or after the most-recent entry. **Persona: PM.**

---

## P2 — minor UX, copy, polish

### BUG-031 [P2] `/` top bar says `Last tick —` when the market is closed
Ambiguous — idle feed, disconnected, or market closed? Write "Feed idle · market closed". **Persona: Day Trader.**

### BUG-032 [P2] VOL / AVG VOL / IV / REGIME FIT for SPY all show `—` even after load
If intentional for paper / closed market, the data source should say "unavailable," not a dash. **Persona: Day Trader.**

### BUG-033 [P2] Notification bell badge count drifts by +1 between `/alerts` and `/pipeline` without user action
Count 1 on `/alerts`, count 2 on `/pipeline`. Background auto-generated notifications shouldn't silently tick up. **Persona: Risk.**

### BUG-034 [P2] Trade stats "1 scratch" shows `Win Rate 0.0%`, `Profit Factor 0.00`, `Avg Loss −$0.00`
Scratch = zero P&L, no losses. Profit factor should be `n/a` (0/0), not 0. Avg Loss shouldn't carry a negative sign. **Persona: Quant.**

### BUG-035 [P2] Status bar time `21:16:03 ET · Sun, Apr 19` rendered at 11 px
Below most UI font-size floors. **Persona: A11y.**

### BUG-036 [P2] BUY/SELL toggle not wrapped in `role="radiogroup" aria-label="Side"`
Screen readers announce "Buy button, Sell button" without group context. **Persona: A11y.**

### BUG-037 [P2] Footer version stamp inconsistent
`/alerts`, `/pipeline`, `/reports`, `/trade` show `AlphaDesk v1.0 — Powered by Claude AI — © 2026` footer. `/`, `/strategies`, `/analytics` have no footer. **Persona: Compliance.**

### BUG-038 [P2] Tax-year dropdown only shows `2026`
No historical years available. **Persona: Compliance.**

### BUG-039 [P2] "Switch to live trading" command in palette has no gating path
Command exists and is discoverable when palette opens blank; typing "live" pushes it off-screen (symbol matches dominate). Needs a documented safety modal with an explicit confirm. **Persona: Compliance.**

### BUG-040 [P2] Empty-state voice drifts between pages
`/analytics` uses *"Not enough data for rolling Sharpe (need 30+ days)"* (sentence), `/alerts` uses *"No active alerts · Create one above to get started"* (imperative), `/reports` uses *"No realized trades found for 2026."* Pick one. **Persona: Retail.**

### BUG-041 [P2] Recent orders table lacks a Date column
Time is `2:20:06 PM` — but today? Yesterday? Last week? **Persona: Retail.**

### BUG-042 [P2] Alert form says "Enter a valid symbol and price" for empty fields
Should be "Symbol and price are required." Also, submitting `<script>alert(1)</script>` as symbol with price `-50` produced no visible validation at all (earlier toast disappeared). **Persona: Risk.**

### BUG-043 [P2] `PAPER` badge overlaps with "Trade" nav tab highlight
Minor overlap visible on `/trade`. **Persona: Mobile.**

### BUG-044 [P2] Login JSON response leaks `access_token` + `refresh_token` alongside setting HttpOnly cookies
If the frontend ever stores the JSON tokens in `localStorage`, HttpOnly is defeated. Issue separate endpoints for CLI clients. **Persona: Security.**

### BUG-045 [P2] `X-XSS-Protection: 1; mode=block` set
Deprecated header; modern guidance is to omit or set `0`. **Persona: Security.**

### BUG-046 [P2] No `/.well-known/security.txt`
No researcher contact channel. **Persona: Security.**

### BUG-047 [P2] Sitemap lists only `/` and `/login`
Not wrong — just a missed SEO opportunity. **Persona: Security.**

### BUG-048 [P2] LCP event not observable in `performance.getEntriesByType('largest-contentful-paint')`
Instrument for Core Web Vitals. **Persona: Performance.**

### BUG-049 [P2] Multiple RSC payloads for the same page on one load
Three `/?_rsc=*` fetches on `/` — looks like over-eager `router.refresh()` in an effect. **Persona: Performance.**

### BUG-050 [P2] `/icon-192.png` fetched but no `manifest.webmanifest` loaded
The file exists at `frontend/public/manifest.webmanifest` (untracked in git) but is not wired into `<head>`. **Persona: Performance.**

---

## P3 — nice-to-have

### BUG-051 [P3] `via: 1.1 Caddy` header leaks proxy identity
Minor info leak. Rename or suppress. **Persona: Security.**

### BUG-052 [P3] Marquee ticker scrolls across the full viewport with no pause-on-touch
Consider `overflow: clip` + virtualized rendering. **Persona: Mobile, Performance.**

### BUG-053 [P3] Skip-to-content link renders 1×1 px until focused
Functional but not clickable for sighted keyboard users. **Persona: A11y, Mobile.**

### BUG-054 [P3] Command palette ⌘K is the only way to search on Desk; no visible button
Desktop users without ⌘K knowledge can't find the palette. Footer has "⌘K Commands" text but it's 11 px and dim. **Persona: Retail.**

### BUG-055 [P3] "Invested $4.9K" on strategy card is rounded to one decimal
For allocation a PM wants precision on hover. **Persona: PM.**

---

## Counts

| Severity | Count |
|---|---:|
| P0 | 5 |
| P1 | 25 |
| P2 | 20 |
| P3 | 5 |
| **Total** | **55** |

---

## Recommended triage order

1. **BUG-001** (cross-page data inconsistency) — blocks everything else: a product that reports different P&L on different pages cannot ship. Root-cause is BUG-016 (polling) — fixing the WebSocket stream simultaneously resolves BUG-015.
2. **BUG-002** (silent order failures) — simplest single fix with the biggest trust impact: surface 4xx responses as a toast.
3. **BUG-003** (stop losses + risk monitor lying) — fastest compliance win.
4. **BUG-005 / BUG-012 / BUG-013 / BUG-008 / BUG-009** — the "two-shells" cluster. Pick one nav, unify labels, reconcile counters.
5. **BUG-007** (LIVE vs PAPER dot rename) — one-line change, eliminates a regulator-facing liability.
6. **BUG-029** (tax disclaimer) — liability-level copy fix.
7. **BUG-022 / BUG-023 / BUG-025 / BUG-036** — accessibility cluster, small diffs that move the product to WCAG 2.1 AA.
8. Remaining P1/P2 can be sprinted in clusters.

---

## Artifacts

- `personas/persona-01-day-trader.md` through `persona-10-performance.md` — the full write-up for each persona, with reproduction steps.
- `screenshots/` — captures taken during the walk (see tool history for exact frames).
