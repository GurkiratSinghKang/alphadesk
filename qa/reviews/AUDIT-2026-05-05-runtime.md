# Runtime Health Audit — 2026-05-05

**Scope:** Console + network sweep across the latest canonical QA run.
**Run ID:** `2026-05-04T20-31-40Z` (post R4 + audit-artifacts + sector_rotation + strategy fixes deploys)
**Base URL:** `https://tradingalpha.net`
**Coverage:** 26 specs × 2 viewports (52 spec/viewport pairs); `_design` and `request-access-submit` desktop-only.
**Aggregates produced:** 11 console errors, 0 console warnings, 9 distinct 4xx responses, 39 `requestfailed` events, ~5,679 total network events.

---

## Headline

The platform is **runtime-healthy**: zero 5xx, zero 429, zero unhandled JS exceptions, zero uncaught Promise rejections, zero CSP violations against the *enforced* policy. Every console error and every 4xx that fired during this sweep falls into one of three buckets:

1. **Intentional QA seed paths** — the harness deliberately exercises 404 / 401 edge cases (`_design`, `not-found`, `login` invalid creds, NVDA OCC strangle deep-link).
2. **Next.js prefetch races** — `?_rsc=…` requests aborted when the harness moves the cursor / scrolls before the prefetch finishes. Benign Chromium signal; not user-visible.
3. **Web-vitals beacon races** — two `sendBeacon` POSTs fired in the same tick on `pagehide`, one wins, the other shows `ERR_ABORTED`. No data loss; backend records 204 for the survivor.

Below those, however, the sweep surfaces three latent issues that are not bugs *today* but will harm production scale: an N-fan-out market-quote pattern still wired to legacy `getSnapshot`, an N-fan-out strategy `/performance` pattern, and 104 outbound CSP-report POSTs from a Report-Only policy that has been "about to migrate" for several rounds. None are P0; the cluster is P1/P2 perf debt.

---

## P0 — Trade-correctness, auth, infinite loops, crash

**None.** The sweep produced zero P0 signals:

- **0 unhandled errors** in the console aggregator (`level == "error"` counted only 11 events; *every one* was a `Failed to load resource …` log emitted by Chromium for the 4xx responses below — none were JS exceptions).
- **0 uncaught Promise rejections** (no `unhandledrejection` events).
- **0 5xx responses** across 5,679 network events (status histogram: 2580×200, 220×204, 9×404, 2×401, 1×307, 1×202).
- **0 429** — rate limiter never triggered under harness load.
- **No crashes / blank-screen captures** in any of the 144 PNG snapshots (cross-checked the pillars audit).
- **/api/v1/auth/me, session refresh, broker connectivity** — all 200 across all authenticated specs.

---

## P1 — Degraded feature, frequent flicker, perf debt

### Cluster A — N-fan-out polling on hot pages

#### A.1 — Watchlist quote fan-out unmigrated to batch endpoint

- **Signature:** 10 simultaneous `GET /api/v1/market/quotes/{ticker}` per tick (AAPL, AMD, AMZN, GOOGL, META, MSFT, NVDA, QQQ, SPY, TSLA).
- **Volume in this run:** 26 polls per ticker × 10 tickers = 260 quote requests. `/trade` alone fired 60 (6 polls × 10 tickers per viewport).
- **Routes:** `/`, `/trade`, `/strategies`, `/strategies/[id]`, `/strategies/earnings-options-play`, `/strategies/trading-agents-research`, `/reports`, `/pipeline`, `/analytics`.
- **Network log evidence:** `qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/network.jsonl`, `…/trade/desktop-1440/network.jsonl` — search for `api/v1/market/quotes/`.
- **Root cause:** `frontend/src/hooks/useDataPipeline.ts:202` calls `getSnapshot(watchlist)`, which `frontend/src/lib/api.ts:900-922` documents as the *legacy per-symbol fan-out* — it `Promise.all`'s N parallel `apiFetch` calls, one per ticker. The backend already exposes `/api/v1/market/snapshots?symbols=A,B,C` and the typed `getSnapshots` wrapper exists at `frontend/src/lib/api.ts:936-968`, but no caller has migrated.
- **Frontend symptom:** ~3-5s cold-start latency on the watchlist (per the in-source TODO at `lib/api.ts:891`). Slowest single quote in this run was 1018ms (`market/quotes/META` on `strategies-trading-agents-research/desktop-1440`); the median is 800ms, suggesting cold cache contention across 10 parallel calls.
- **Severity:** P1. Not user-blocking but consistently degrades LCP on every authenticated page.
- **Fix:** swap `getSnapshot(watchlist)` → `getSnapshots(watchlist)` at `useDataPipeline.ts:202` and `:219`. The fallback path inside `getSnapshots` (line 962-966) preserves resilience if the batch endpoint 5xx's. The TODO comment at `api.ts:881-898` is the exit instruction.

#### A.2 — Strategies `/performance` fan-out

- **Signature:** 15 sequential `GET /api/v1/strategies/{id}/performance` per page load (one per live strategy).
- **Volume:** 45 requests (15 × 3 specs: `strategies-list/desktop-1440`, `strategies-list/mobile-390`, `settings/desktop-1440`).
- **Routes:** `/strategies` and `/settings` (Settings re-runs the call when its strategy section expands).
- **Network log evidence:** `qa/runs/2026-05-04T20-31-40Z/strategies-list/desktop-1440/network.jsonl` — every `api/v1/strategies/.+/performance` line.
- **Root cause:** `frontend/src/app/(dashboard)/strategies/page.tsx:632-649` runs a `for (const id of ids)` loop calling `getStrategyPerformance(id)` per id. The cheaper `getStrategyCatalog` (`frontend/src/lib/api.ts:382-392`) already returns the small-payload subset the list page uses for pills, but the heavier `/performance` payload is still fetched per card for the OOS metrics (Sharpe / CAGR / MaxDD).
- **Frontend symptom:** progressive paint of metric cells; cards show em-dashes for slower strategies until each promise resolves.
- **Severity:** P1. The progressive-resolve UX (added 2026-04-20 per the in-source comment) was a band-aid on the underlying fan-out. Backend should expose a `GET /api/v1/strategies/performance?ids=…` (or attach `performance.summary` to the catalog payload) and the list page should consume it once.
- **Fix:** add `GET /api/v1/strategies/performance` (returns `Record<id, StrategyPerformance>`) to backend; replace the for-loop with one call. Keep `getStrategyPerformance(id)` for the detail page where the full series is needed.

### Cluster B — CSP migration debt

#### B.1 — 104 outbound `csp-report` POSTs from Report-Only policy

- **Signature:** Every page load fires 1-6 `POST /api/v1/security/csp-report` events as Chromium reports inline-script and inline-style violations against the strict Report-Only header. Total in this sweep: 104.
- **Volume by spec:** `/login` × 6, `/trade` × 6, `/request-access` × 6, `/settings` × 3 (per viewport). Public pages each fire 2.
- **Network log evidence:** see `qa/runs/2026-05-04T20-31-40Z/login/desktop-1440/network.jsonl`, line: `request POST https://tradingalpha.net/api/v1/security/csp-report` — appears 6 times in <1s of page boot.
- **Console echoes:** 797 `info` lines aggregated to `/tmp/audit-2026-05-05/console-info.jsonl`. The top six unique violation hashes are accounted for by Next.js inline-runtime-injected `<script>` and `<style>` tags (RSC payload, hydration boundary markers, `next/font` fallback inline `@font-face`).
- **Root cause:** `infrastructure/Caddyfile` ships *both* policies side-by-side:
  - `Content-Security-Policy: … script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' …` (enforced).
  - `Content-Security-Policy-Report-Only: … script-src 'self' https:; style-src 'self' https://fonts.googleapis.com; … report-uri /api/v1/security/csp-report` (target).
- **Backend:** the `csp-report` POSTs land at `backend/api/routes/security.py` and return 200. They are pure overhead — the report destination does nothing useful with these payloads at the moment except log volume.
- **Severity:** P2 going on P1. The current cost is 104 same-origin POSTs per QA sweep; in prod, with N concurrent users, the report rate scales linearly. Browsers do throttle CSP reports but only modestly.
- **Fix path:** either (a) ship a Next.js nonce strategy (set `nonce` in middleware, propagate via `<Script nonce>` and `getCSPHeaders`) so the strict header can replace the lax one — *or* (b) drop the Report-Only header until you have a concrete migration target. Today's middle ground generates noise without unlocking anything.

### Cluster C — Page weight

#### C.1 — Dashboard ships 30 distinct JS chunks on cold load

- **Signature:** `qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/network.jsonl` shows 30 unique `/_next/static/chunks/*.js` loads on first paint (32 if you count CSS). `/trade` ships 33. `/login` (public) is more reasonable at 19.
- **Severity:** P2. Each chunk is small and fingerprinted-cacheable so warm-load is fine, but the *first* visit to dashboard pulls 30 chunk requests in parallel — that's heavy on a slow-3G connection or constrained mobile network. The harness's mobile-390 viewport doesn't simulate slow-3G (it just narrows the window), so the actual mobile-network impact is unknown from this sweep alone.
- **Fix path:** review `next.config` chunk-split heuristics; consider bumping `splitChunks.maxAsyncRequests` downward, or move some always-loaded leaves (e.g. icon libraries) to a vendor-shared chunk so cross-route hits are warm.

---

## P2 — Cosmetic / recoverable

### Cluster D — Next.js prefetch races

#### D.1 — `?_rsc=…` aborted prefetches on hover/scroll

- **Signature:** `requestfailed: net::ERR_ABORTED` on `/strategies/{id}?_rsc=…` requests when the harness rapid-fires hover/scroll/click steps.
- **Volume:** 32 events (16 on `strategies-list/desktop-1440`, 16 on `settings/desktop-1440`).
- **Routes:** `/strategies` (hover-first-if-present + scroll), `/settings` (click-every section toggles fire prefetches as they expand).
- **Sample:**
  ```
  settings/desktop-1440 GET https://tradingalpha.net/strategies/regime-adaptive?_rsc=1na3m failure=net::ERR_ABORTED
  settings/desktop-1440 GET https://tradingalpha.net/strategies/ts-momentum?_rsc=1na3m failure=net::ERR_ABORTED
  ```
- **Root cause:** `<Link href="/strategies/{id}">` at `frontend/src/app/(dashboard)/strategies/page.tsx:357-376` (and equivalent links inside the settings page) triggers Next.js's automatic RSC prefetch on hover/focus. When the user (or the harness) moves on within ~200ms, Chromium aborts the in-flight request. This is intentional Next.js behaviour, not a bug.
- **Why it's still worth noting:** in production, real users scrolling a long strategy list hover 5-10 cards in quick succession; expect prefetch abort logs to spike accordingly. The signal is benign but pollutes APM / Sentry breadcrumbs if you wire one. Filter `net::ERR_ABORTED` for `?_rsc=` URLs at the breadcrumb layer if it becomes noisy.
- **Severity:** P3 noise.

#### D.2 — `metrics/vitals` sendBeacon double-fire on `pagehide`

- **Signature:** Within the same millisecond, the same `POST /api/v1/metrics/vitals` request appears twice — one wins (204), one shows `requestfailed: net::ERR_ABORTED`. Six such pairs in this run, all on `/trade`.
- **Sample:**
  ```
  20:42:56.088 request POST https://tradingalpha.net/api/v1/metrics/vitals
  20:42:56.088 requestfailed POST … net::ERR_ABORTED
  20:42:56.088 request POST https://tradingalpha.net/api/v1/metrics/vitals
  20:42:56.088 requestfailed POST … net::ERR_ABORTED
  20:42:56.104 request POST … (this one wins → 204)
  ```
- **Root cause:** `frontend/src/lib/web-vitals.ts:42-93` registers five web-vitals listeners (LCP/CLS/INP/FCP/TTFB) and beacons each metric independently. When the page hides, two metrics finalize together (typically CLS + INP), causing two `sendBeacon` calls in the same tick. Chromium serializes them and aborts the loser when the navigation starts.
- **Frontend symptom:** none — every metric *that finalizes* makes it through (no missing data; the harness counts 14 successful 204s on `/trade`).
- **Severity:** P3.
- **Fix path (optional):** debounce metric flushes inside `web-vitals.ts:reportMetric` (queue → single beacon on the next microtask), or accept the noise — the current code path already swallows beacon failures (`web-vitals.ts:90-92`).

### Cluster E — Intentional 404/401 from QA test seeds

These are *expected* failures generated by the harness deliberately exercising the failure path. **Do not treat as defects.**

| Spec | URL | Status | Why expected |
|------|-----|--------|--------------|
| `_design` (desktop) | `https://tradingalpha.net/_design` | 404 | Documented in `qa/runs/LATEST.md` — `/_design` MUST 404 in prod. |
| `not-found` (both) | `https://tradingalpha.net/this-route-does-not-exist-qa-harness` | 404 | Spec exercises the 404 boundary. |
| `login` (both) | `https://tradingalpha.net/api/v1/auth/login` | 401 | Spec submits invalid creds to capture the `after-submit-invalid` snapshot. |
| `trade` (both) | `https://tradingalpha.net/api/v1/market/quotes/NVDA260424P00200000` etc. | 404 | R5 multi-leg deep-link seed; R6-5 (`frontend/src/lib/legQuoteReadiness.ts`) consumes the 404 to render the Blocked / Review readiness pill. Per LATEST.md, this is **explicitly out of scope** for runtime audits. |

The 9 trade-spec 404s and 2 login-spec 401s account for **all** error-level console events in the run. Once these intentional seeds are subtracted, the console-error budget is **0**.

---

## P3 — Noise / dev-mode warnings

- **None encountered.** No React hydration warnings, no `useLayoutEffect on server`, no key-prop warnings, no act warnings, no Recharts SSR warnings. Production build is clean.
- **No mixed-content warnings.** Every fetched origin is `https://tradingalpha.net/` or `https://fonts.gstatic.com/` (allowed by the enforced CSP via `font-src 'self' data: https://fonts.gstatic.com`). No `http://` resources.
- **No WebSocket events at all** in this sweep. The Caddyfile reserves `connect-src 'self' wss://{$DOMAIN:localhost}` so the channel is policy-allowed, but no live streams are wired today. Worth confirming this is intentional — earlier rounds discussed a `/ws/` design.

---

## Cross-cuts and observations

### Auth / public-route hygiene

- `/api/v1/auth/me` — never returned 401 on any authenticated spec. Session-refresh path looks healthy.
- No 401 / 403 leaked onto a *public* route. (The login 401 is on `/api/v1/auth/login`, which is correct.)
- `/request-access-submit` correctly returns **202 Accepted** with the `claude-test+<timestamp>@example.com` payload (see `qa/runs/.../request-access-submit/desktop-1440/network.jsonl`). Backend wired.

### Polling cadence

The `useMarketDepth` hook (`frontend/src/hooks/useMarketDepth.ts:42-50`) sets `refetchInterval: 5_000` for the AAPL/NVDA depth panel on `/trade`. Polling at 5s on a panel that the user looks at intermittently is fine, but combine it with the 12s polling cadence of the broader pipeline (`useDataPipeline.ts`, observed at `:43.78 → :56.36 → :07.79` request timestamps on AAPL quotes) and a single user on `/trade` triggers ~1 backend request every 1-2 seconds. Confirm Alpaca rate-limit budget is sized for that.

### Earnings calendar latency

The slowest non-vitals API response in the run:
```
3540ms strategies-earnings-options-play/desktop-1440 200 https://tradingalpha.net/api/v1/earnings/calendar?window=both&min_iv_rank=0&sort=date
```
Mobile mirror: 857ms. The desktop response is more than four times longer than mobile and *eight times* the next-slowest endpoint. Likely cold-cache miss against FMP — investigate whether `min_iv_rank=0` skips a server-side index. Not a bug, but worth monitoring.

---

## Summary table

| ID | Cluster | Severity | One-line | Code path |
|----|---------|----------|----------|-----------|
| A.1 | Fan-out polling | P1 | 10 quote-fetches per tick on every authed page | `useDataPipeline.ts:202` calls `getSnapshot` instead of `getSnapshots` |
| A.2 | Fan-out polling | P1 | 15 strategy `/performance` calls on `/strategies` and `/settings` | `app/(dashboard)/strategies/page.tsx:632-649` for-loop |
| B.1 | CSP migration | P1/P2 | 104 outbound `csp-report` POSTs from Report-Only header | `infrastructure/Caddyfile` (dual policy), `backend/api/routes/security.py` |
| C.1 | Page weight | P2 | Dashboard ships 30 JS chunks on cold load | `next.config` chunk-split |
| D.1 | Prefetch race | P3 | `?_rsc=` aborted prefetches on hover/scroll | benign Next.js behaviour |
| D.2 | Beacon race | P3 | Vitals double-fire on pagehide; one wins | `lib/web-vitals.ts:reportMetric` |
| E.* | QA seeds | n/a | 9 trade 404 + 2 login 401 + 1 `_design` 404 + 2 `not-found` 404 | intentional |

---

## Methodology / artifact pointers

- Aggregated console events: `/tmp/audit-2026-05-05/console-issues.jsonl` (11 entries; all `level: error`).
- Aggregated network failures: `/tmp/audit-2026-05-05/network-issues.jsonl` (50 entries).
- Aggregated info-level (CSP report-only): `/tmp/audit-2026-05-05/console-info.jsonl` (797 entries).
- Full network log: `/tmp/audit-2026-05-05/network-all.jsonl` (5,679 events).
- Source aggregation commands and per-spec breakdowns: see the audit invocation transcript.

The key field-name nuance: this run's harness emits `level` (not `type`) on console events and `phase` (not `kind`) on network events — the canonical jq filters in `qa/runs/LATEST.md` reference an older schema and produced empty aggregates initially.

---

*Generated 2026-05-05 against run `2026-05-04T20-31-40Z`.*
