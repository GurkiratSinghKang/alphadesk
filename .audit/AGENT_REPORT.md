# AlphaDesk — Bug Report for a Downstream Agent

**Target:** https://tradingalpha.net
**Audit date:** 2026-04-19 (ET evening; market closed)
**Auditor:** 10-persona manual + scripted walkthrough of the live production app
**Repo:** `/Users/GK/Downloads/alphadesk` (branch `feature/deployment`)
**Test credentials:** gitignored at `.env.local.qa` — `ALPHADESK_TEST_USER=admin`, `ALPHADESK_TEST_PASS=6c9d0974863d6902aa83a932e8db1bc9`
**Total findings:** 55 (5 P0, 25 P1, 20 P2, 5 P3)

---

## How to use this report

This file is self-contained. Another agent can:

1. Read the bugs section below — each has a stable ID, severity, reproduction steps, and suggested fix.
2. Use `gh`/`git` plus the **Likely file(s)** hints to locate code.
3. Verify live behavior with the test credentials above (do *not* run locally per project memory — the app is live at tradingalpha.net).
4. When proposing fixes, cite the BUG-NNN ID.

Severity scale: **P0** blocks ship (data correctness, money, security). **P1** major UX/functional. **P2** polish. **P3** nice-to-have.

---

## Executive summary

Three themes dominate:

1. **Cross-page data inconsistency.** The same AVGO position shows `+$275`, `+$375.15`, and `+$284.25` on Desk, Pipeline, and Reports in the same session. Equity, BA P&L, strategy counts all drift the same way. Root cause: polling architecture where each page re-reads its own snapshot.
2. **Two UI shells.** `/` renders `DeskLayout.tsx` (Desk · Strategies · Analytics · Pipeline · Alerts). Everything else renders `(dashboard)/layout.tsx` (Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports). Docs reference items that don't exist on the Desk.
3. **Silent failures.** The order ticket accepts negative qty and 9-digit qty. Backend rejects with 422. Frontend shows **no** toast, no error, no disabled state.

Security is largely solid (HttpOnly/Secure/SameSite=strict, JWT alg:none rejected, rate-limit at 6 attempts, CORS preflight rejected). Main gap: CSP `'unsafe-inline'`.

---

## Recommended triage order

| Order | Bugs | Why |
|---|---|---|
| 1 | BUG-001, BUG-015, BUG-016 | One root-cause cluster (polling → drift). Fixing the WebSocket stream eliminates three bugs. |
| 2 | BUG-002 | Smallest diff with largest trust impact: surface 4xx from `/trades/orders` as a toast. |
| 3 | BUG-003 | Fastest compliance win: enforce a default stop on every open position. |
| 4 | BUG-005, BUG-008, BUG-009, BUG-012, BUG-013 | The "two shells" cluster — unify nav, reconcile counters, pick one label. |
| 5 | BUG-007, BUG-029 | Regulator-facing liability copy fixes. |
| 6 | BUG-022, BUG-023, BUG-025, BUG-036 | A11y cluster, small diffs for WCAG 2.1 AA. |
| 7 | Remaining P1/P2 | Sprint in clusters. |

---

## Frontend area map (for file-hunting)

| Concern | Likely file(s) |
|---|---|
| Desk page (the `/` route) | `frontend/src/app/(dashboard)/page.tsx` |
| Desk-only shell (nav + layout for `/`) | `frontend/src/components/layouts/DeskLayout.tsx` |
| Everywhere-else shell | `frontend/src/app/(dashboard)/layout.tsx` |
| Order ticket | `frontend/src/components/composites/OrderBar.tsx` |
| Trade page ticket | `frontend/src/app/(dashboard)/trade/page.tsx` |
| Strategies grid | `frontend/src/app/(dashboard)/strategies/page.tsx` |
| Strategy card | `frontend/src/components/composites/StrategyCard.tsx` |
| Pipeline | `frontend/src/app/(dashboard)/pipeline/page.tsx` |
| Pipeline API client | `frontend/src/lib/pipeline-api.ts` |
| Reports | `frontend/src/app/(dashboard)/reports/page.tsx` |
| Command palette | `frontend/src/components/layout/CommandPalette.tsx` |
| Market store (polling) | `frontend/src/stores/market.ts` |
| Workspace selector | `frontend/src/components/layout/WorkspaceSelector.tsx` |
| Global CSS | `frontend/src/app/globals.css` |
| Root layout (html lang, etc.) | `frontend/src/app/layout.tsx` |
| PWA manifest (unwired) | `frontend/public/manifest.webmanifest` |

Backend:

| Concern | Likely file(s) |
|---|---|
| Auth (JWT, cookies) | `backend/core/auth.py` |
| Compliance/tax disclosure | `backend/core/compliance.py` |
| Orders validation (422 shape) | `backend/api/routes/trades/*` |
| Alerts routes | `backend/api/routes/alerts.py` or similar |
| Master data ingestion | `backend/data/ingestion/master_agent.py` |

---

## P0 — ship-blockers

### BUG-001 · Same position shows three different "current prices" across three pages
**Where:** `/` (Desk right panel), `/pipeline`, `/reports`
**Observed for AVGO (qty 15, entry 381.05):**

| Page | CURRENT | P&L |
|---|---:|---:|
| Desk right panel | ~$399.38 (implied) | +$275 / +$273 across reloads |
| Pipeline | $406.06 | +$375.15 |
| Reports | $400.00 | +$284.25 |

Same pattern for BA (Desk −$113 vs Reports −$101.25). EQUITY drifts too: Desk `$100,347.87` → `$100,347.31` over reloads vs Reports `$100,368.54`.
**Repro:** Sign in. Open `/`, note AVGO P&L on right panel. Navigate `/pipeline` — note P&L column. Navigate `/reports` — note P&L column. Compare.
**Root cause (hypothesis):** Three pages each call their own endpoint (`/api/v1/portfolio/summary` vs `/api/v1/trades/positions` vs `/api/v1/reports/*`) and each endpoint re-prices independently off mock/seeded data or per-request random fills.
**Fix:** Introduce a single portfolio-state service keyed by symbol. When market is closed, freeze to last-close NBBO. Ideally stream via WebSocket (`wss://tradingalpha.net` is already in CSP `connect-src`).

### BUG-002 · Invalid / absurd orders silently rejected — no UI feedback
**Where:** `/` and `/trade` order ticket
**Repro:**
1. On `/`, set QTY `-100`, click Place order → POST `/api/v1/trades/orders` → 422 → **no toast, no inline error, button untouched**.
2. Set QTY `999999999`, SIDE BUY → 422 → same silence.
**Likely file:** `frontend/src/components/composites/OrderBar.tsx`
**Fix:** Display 422/4xx responses as toast or inline error below the button. Disable button during in-flight POST. Add HTML-level guards (`min="1"`, `step="1"`, `type="number"`) for client-side first line.

### BUG-003 · `STOP LOSS = None` on all 7 positions while pipeline header says "Risk Monitor: ON"
**Where:** `/pipeline` CURRENT POSITIONS table
**Observed:** All 7 positions (AVGO, BA, CRM, DIS, NKE, PG, WMT) have `None` under STOP LOSS and `—` under TAKE PROFIT. Header: `● Risk Monitor: ON` next to `Last heartbeat: Never`.
**Fix:** Enforce a policy-default stop when a position is opened (e.g., −5% or strategy-specific). Don't claim the monitor is ON when heartbeat is Never; replace with `Idle — next run 09:30 ET` until a heartbeat lands.

### BUG-004 · PEAD shows `Invested $4.9K · 0 positions` — accounting identity broken
**Where:** `/strategies` grid card and `/strategies/pead` detail
**Observed:** Grid card: `0 positions · Invested $4.9K`. Detail page § 03 · POSITIONS says *"No positions open."*
**Likely file:** `frontend/src/components/composites/StrategyCard.tsx` (grid), server aggregator.
**Fix:** `Invested = Σ shares × cost_basis` must equal zero when `positions = 0`. Either attribute the $4.9K to an open-orders bucket (and relabel `Reserved`), or trace why the aggregator double-counts.

### BUG-005 · Two entirely different navigation shells for one app
**Where:** `/` vs every other page
- `/` (DeskLayout) renders: `αAlphaDesk · Desk · Strategies · Analytics · Pipeline · Alerts` (5 items, serif wordmark, no icons)
- `/strategies`, `/analytics`, `/trade`, `/alerts`, `/pipeline`, `/reports` render: `⚡AlphaDesk · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · [Default workspace] · 🔍` (7 items + search + icons)

URL `/dashboard` redirects to `/` where the page labels itself "Desk". Docs tell users to find "Dashboard" and "Trade" — neither exists on the Desk.
**Likely files:** `frontend/src/components/layouts/DeskLayout.tsx`, `frontend/src/app/(dashboard)/layout.tsx`, `docs` page.
**Fix:** Pick one shell. Either migrate `/` under the `(dashboard)` layout or port the analytics shell's nav items/search into DeskLayout. Pick one label — "Desk" or "Dashboard" — and use it in URL slug, nav, and docs.

---

## P1 — major UX / functional

### BUG-006 · Order-ticket defaults differ between `/` and `/trade`
- `/` defaults: QTY `1`, TYPE `Market`
- `/trade` defaults: QTY `100`, TYPE `Limit`
**Likely file:** `frontend/src/components/composites/OrderBar.tsx` (check props passed from `page.tsx` vs `trade/page.tsx`)
**Fix:** Use one defaults object; pass through props only when a caller explicitly overrides.

### BUG-007 · "LIVE" green dot coexists with `Alpaca (Paper) · PAPER` badge
In a trading UI "LIVE" must mean live-trading session.
**Fix:** Rename the streaming indicator to `STREAMING` or `CONNECTED`. Reserve `LIVE` for a genuine live account.

### BUG-008 · Order count mismatch in two places on the Desk
- Top status bar: `POSITIONS · ORDERS 7 · 10`
- Right-panel Book tabs: `POSITIONS 7 · ORDERS 50 · JOURNAL 7`

10 vs 50 under the same "orders" label.
**Fix:** Label distinctly (`Open Orders` vs `Orders (today)`) or reconcile to one source.

### BUG-009 · Strategy counters disagree across pages
- Desk sidebar: `Strategies 12/13`
- `/strategies` header: `12 active · 1 paused · 7 coming soon · 20 total`
- `/reports` strategy table: 2 paused (Earnings Vol Premium **and** Gap Fill); "Opening Range Breakout" shown `active`

**Fix:** Single aggregator for these counts; include them in the same API response and let each surface render them identically.

### BUG-010 · "Opening Range Breakout" card shows `ACTIVE` + `NOT READY FOR LIVE` simultaneously
Mutually exclusive. If not ready, the primary badge should be `PAPER ONLY` or `DRAFT`.

### BUG-011 · "Run Now" on `/pipeline` fires without confirmation
Nothing stops an accidental click from executing the pipeline.
**Fix:** Require a modal confirming intent; when market is closed, additionally warn that no fills will be produced.

### BUG-012 · Login header date is one day ahead of the Desk header
- Login: `2026-04-20`
- Desk after sign-in: `Sun, Apr 19`

Classic UTC vs ET split.
**Fix:** Pass `new Date()` through the same TZ formatter everywhere; run login-page SSR with the same zone.

### BUG-013 · `/pipeline` disagrees with itself on next-run time
- Header: `Next scheduled run: 4/20/2026, 9:35:00 AM`
- Body: `Market is closed today. Next scheduled run: Monday 09:30 ET.`

9:30 vs 9:35.
**Likely file:** `frontend/src/app/(dashboard)/pipeline/page.tsx` or pipeline API client.

### BUG-014 · Two onboarding contact emails
- `/request-access`: `legal@tradingalpha.net`
- `/docs` Getting Started: `support@tradingalpha.net`

**Fix:** Pick one and use it everywhere; ideally route to a real support inbox.

### BUG-015 · Position P&L drifts between back-to-back reloads with market closed
Single-snapshot reloads show `$100,347.87 → $100,347.31` and AVGO `+$275 → +$273`. Same root cause as BUG-001.

### BUG-016 · Polling instead of WebSockets
**Observation:** 295 `/api/v1/*` GETs in ~60 s (10 quote symbols polled repeatedly plus positions/orders/summary/greeks).
**Likely file:** `frontend/src/stores/market.ts` and hooks that `setInterval` against it.
**Fix:** Open a WebSocket to `wss://tradingalpha.net` (already allowed by CSP) for quote + portfolio streams. All pages then consume from a single store.

### BUG-017 · Redundant API calls on first paint
Three `/trades/orders` GETs in a row (`?`, `?status=pending`, `?status=open`) and two `/portfolio/summary` GETs.
**Fix:** Merge the orders fetch. Add a request-dedupe wrapper.

### BUG-018 · All 7 positions share identical entry timestamp `Apr 18, 2026, 01:42 AM`
Same second across all 7 rows — seeded/mock or truncated-precision.
**Fix:** Record real entry timestamps to ms precision; render with TZ.

### BUG-019 · Manual/Discretionary strategy detail emits CAGR but em-dashes Sharpe, MaxDD, HitRate
Partial metrics displayed as if computed.
**Fix:** If one metric is computable, all from the same series should be; otherwise label "No backtest (discretionary)".

### BUG-020 · Strategy-detail breadcrumb says "Dashboard / …"
`/strategies/pead` breadcrumb reads `Dashboard / Post-Earnings Announcement Drift`. Should be `Strategies / …`. Tied to BUG-005.

### BUG-021 · Strategy detail copy exposes internal filenames
PEAD description references `audit-reports/phase1-pead.md` and `audit findings F1-F5`. End users shouldn't see internal filenames.
**Fix:** Link to a rendered page or strip the filename.

### BUG-022 · Desk page has no `<h1>`
`document.querySelectorAll('h1').length === 0` on `/`.
**Likely file:** `frontend/src/app/(dashboard)/page.tsx` or `DeskLayout.tsx`.
**Fix:** Add a visually-hidden `<h1>Trading desk</h1>` (or promote the SPY heading).

### BUG-023 · "Ask anything…" AI input has no accessible name
`<input placeholder="Ask anything..." type="text">` with no `aria-label`, no `<label for>`.
**Fix:** Add `aria-label="Ask Claude a question"`.

### BUG-024 · 41 of 55 interactive targets below 44×44 pt touch minimum on the Desk
Chart range pills `1D`/`5D`/`1M`/`3M`/`6M`/`YTD`/`1Y`/`ALL` are 31×23; top nav 29 px tall.
**Fix:** Enforce minimum `min-h-[44px] min-w-[44px]` on mobile breakpoints.

### BUG-025 · Focus rings reset on some buttons
Sampled `:focus-visible` returned empty `outline` and `box-shadow`.
**Fix:** Audit buttons/anchors for `focus-visible:ring` or equivalent; add a global fallback in `globals.css`.

### BUG-026 · CSP allows `'unsafe-inline'` for `script-src` and `style-src`
Disables the strongest XSS mitigation CSP provides.
**Fix:** Switch to nonce-based CSP (Next.js has first-class support) or hash-based CSP.

### BUG-027 · "Connecting to live data…" banner + OFFLINE flash on navigation
Reload of `/strategies` shows skeleton cards + red `OFFLINE` dot for ~3 s.
**Fix:** Preserve last-known state during reconnect; only flip to OFFLINE after a grace period.

### BUG-028 · Manual/Discretionary strategy has 7 positions + $57.1K invested but `—` backtest metrics on the grid
Contradicts the "metrics required before deploy" posture a grid implies.
**Fix:** If discretionary, label explicitly ("No backtest — discretionary bucket"); otherwise compute.

### BUG-029 · Tax Report has no disclaimer
`/reports` → Tax Report (Simplified) offers CSV download with no "not tax advice · consult a professional" text.
**Likely file:** `backend/core/compliance.py` or `frontend/src/app/(dashboard)/reports/page.tsx`.
**Fix:** Prominent disclaimer above the `Download Tax Report (CSV)` button, and in the CSV itself.

### BUG-030 · Last-trade date for Manual/Discretionary = `Apr 17, 2026` but all pipeline entry dates = `Apr 18, 2026`
Last-trade should be ≥ most-recent entry.

---

## P2 — polish / copy

### BUG-031 · `Last tick —` in status bar is ambiguous
Suggest `Feed idle · market closed`.

### BUG-032 · VOL, AVG VOL, IV, REGIME FIT all `—` on SPY even after load
If intentional when closed, label "unavailable"; dash reads as "loading forever".

### BUG-033 · Notification bell badge drifts by +1 between `/alerts` and `/pipeline` without user action
Count 1 on `/alerts`, count 2 on `/pipeline`.

### BUG-034 · Trade stats for "1 scratch" show `Win Rate 0.0% · Profit Factor 0.00 · Avg Loss −$0.00`
Scratch ≠ loss. Profit factor should be `n/a` (0/0), not 0; Avg Loss shouldn't have a negative sign.

### BUG-035 · Status bar time `21:16:03 ET · Sun, Apr 19` rendered at 11 px
Most UI font floors are 12 px.

### BUG-036 · BUY/SELL toggle missing `role="radiogroup" aria-label="Side"`
Screen readers announce "Buy button, Sell button" without group context.

### BUG-037 · Footer version stamp inconsistent
`/alerts`, `/pipeline`, `/reports`, `/trade` show footer; `/`, `/strategies`, `/analytics` don't.

### BUG-038 · Tax-year dropdown only shows `2026`
No history (even for 2025) despite product living in 2026.

### BUG-039 · "Switch to live trading" command in ⌘K palette has no gating
No visible 2FA or confirm flow documented.
**Fix:** Always prompt with a modal (explicit risk copy + confirm) before flipping the mode.

### BUG-040 · Empty-state voice drifts between pages
`/analytics` — sentence style; `/alerts` — imperative; `/reports` — "No realized trades found for 2026."
**Fix:** Pick one style; apply across the app.

### BUG-041 · Recent orders table lacks Date column
Time-only is ambiguous across midnight.

### BUG-042 · Alerts form has weak validation
Empty submit shows toast "Enter a valid symbol and price" (should say "required"); `<script>alert(1)</script>` with `-50` price submitted without a follow-up error.

### BUG-043 · `PAPER` badge overlaps "Trade" nav tab highlight
Minor visual overlap on `/trade`.

### BUG-044 · Login response body leaks JWT alongside HttpOnly cookies
JSON: `{access_token, refresh_token, token_type, expires_in}` + `Set-Cookie` with HttpOnly. If frontend ever moves to `localStorage`, HttpOnly is defeated.
**Fix:** Separate endpoints for browser vs CLI clients, or content-negotiate.

### BUG-045 · `X-XSS-Protection: 1; mode=block` is set
Deprecated. Omit or set to `0`.

### BUG-046 · No `/.well-known/security.txt`
Add `Contact: mailto:security@tradingalpha.net`.

### BUG-047 · Sitemap lists only `/` and `/login`
Missed SEO opportunity.

### BUG-048 · LCP not observable in `performance.getEntriesByType('largest-contentful-paint')`
Instrument for Core Web Vitals.

### BUG-049 · Three `/?_rsc=*` payloads on one `/` load
Looks like multiple `router.refresh()` or effect re-trigger. Audit the Desk's initial-state effects.

### BUG-050 · `/icon-192.png` fetched but no `manifest.webmanifest` loaded
`frontend/public/manifest.webmanifest` exists (untracked) but isn't linked from `<head>`.
**Likely file:** `frontend/src/app/layout.tsx`
**Fix:** Add `<link rel="manifest" href="/manifest.webmanifest" />` and register the service worker correctly (it's already supported).

---

## P3 — minor

### BUG-051 · `via: 1.1 Caddy` response header leaks proxy
Suppress or rename.

### BUG-052 · Marquee ticker scrolls across full width, no pause-on-touch
Use `overflow: clip` and virtualize.

### BUG-053 · Skip-to-content link is 1×1 px until focused
Functional for screen readers, not clickable for sighted keyboard users.

### BUG-054 · ⌘K is the only palette shortcut; no visible button on the Desk
Footer "⌘K Commands" hint is 11 px and dim.

### BUG-055 · "Invested $4.9K" on strategy card rounded to one decimal
Precise value on hover would help allocation decisions.

---

## Proof-of-work artifacts

- `./personas/persona-01-day-trader.md` through `persona-10-performance.md` — detailed per-persona narratives, including what was attempted and what the app returned.
- `./BUGS.md` — earlier consolidation (now superseded by this report for agent-sharing purposes).
- `./screenshots/` — screenshots directory (captures taken during the walk; most were transient but the file paths exist for future runs).

## What was *not* covered (known gaps for the next pass)

- **Resize-based mobile rendering:** the QA browser wouldn't shrink below 1470×690, so true mobile-breakpoint behavior was inspected via DOM classes only (see Persona 7).
- **Live market-hours behavior:** audit ran on Sunday ET with market closed. Real streaming behavior and order fills not observed.
- **Options/multi-leg order flow:** the 422 response revealed a `legs` schema but multi-leg orders weren't exercised.
- **Strategy builder / backtesting panels on `/pipeline`:** only smoke-checked. Natural-language rule parser not exercised.
- **Alerts with valid symbol + valid price + above/below actually firing:** tested validation, not the full happy path.
- **`/analytics` equity-curve chart and drawdown interactions:** observed static; hover/tooltip behavior not probed.
- **Morning Brief / Claude pre-trade memo generation:** seen as empty state only.
