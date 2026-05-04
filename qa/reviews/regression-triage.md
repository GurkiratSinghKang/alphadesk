# Functional Regression Triage — AlphaDesk

**Captured:** 2026-05-03 (run `2026-05-03T23-07-16Z`)
**Sources:** `manifest.json` + per-spec `console.jsonl` + `network.jsonl` + DOM snapshots
**Scope:** 23 specs × 2 viewports = 46 results, 388 steps total → 376 pass / 4 fail / 8 skipped

---

## P0 bugs (block users / silent data corruption)

### 1. NVDA underlying quote is **47.3 hours stale** in production — every options ticket is hard-blocked from submitting
- **Page:** `/trade?contract=…` and `/trade?legs=…` (NVDA confirmed; likely affects all underlyings)
- **Evidence:**
  - DOM `qa/runs/2026-05-03T23-07-16Z/trade/desktop-1440/validate-single-leg-prefill-fail.dom.html` and `validate-multi-leg-prefill-fail.dom.html` both contain the literal text `Quote freshness: 47.3h old.` and the submit button reads `Resolve quote first` with `data-state="stale"` and `!border-amber/50 !bg-bg-elev-2 !text-amber` styling.
  - "Blocked" execution-readiness pill rendered 4× in the surrounding panel.
  - `network.jsonl`: `GET /api/v1/market/quotes/NVDA` → `200`, but the payload's `last_quote_time` is ~47h before run start (2026-05-03 23:18 UTC), i.e. ~Friday 2026-05-01 close.
- **Symptom:** A real user navigating any earnings/strategy deep-link to NVDA options today cannot submit. Gate logic at `frontend/src/app/(dashboard)/trade/page.tsx:1989-1995` flags `quoteAge > 300s` as `block`. Both single-leg and multi-leg eval steps fail the submit-label assertion (`"Place order"` / `"2-leg combo"`) because the label is overridden to `"Resolve quote first"` (line 1389).
- **Root cause hypothesis:** Upstream market-data ingestion has stopped refreshing quotes since the Friday close. The frontend gate is functioning correctly. Notably, `brokerDegraded` is NOT firing — no fallback banner appears anywhere in the run — so the feed is silently going stale without escalating.
- **Suggested fix:** (a) Investigate `backend/data/ingestion/` and the periodic reconciler; verify other tickers (AAPL/MSFT/etc returned 200 but I did not validate their `last_quote_time`). (b) When freshest quote is > ~30 min old during market hours, escalate to `brokerDegraded=true` so users see "Broker data is in fallback mode" instead of generic "Resolve quote first" on a Tuesday.

### 2. Trade page never fetches a quote for the actual OCC option contract being staged
- **Page:** `/trade?contract=…` and `/trade?legs=…`
- **Evidence:** In `trade/desktop-1440/network.jsonl`, after navigating to `?contract=NVDA260425C00205000`, the page issues `GET /api/v1/market/quotes/NVDA` plus the watchlist quote burst — but **zero** requests to `/api/v1/market/quotes/NVDA260425C00205000` or to the multi-leg OCCs. `jq 'select(.url|test("NVDA260425|NVDA260424"))' network.jsonl` returns only the document URL.
- **Source:** `frontend/src/app/(dashboard)/trade/page.tsx:166-168` — `tradeContextSymbol = urlUnderlyingSymbol ?? selectedSymbol`; `useQuote(tradeContextSymbol)` always uses the equity symbol.
- **Symptom:** OrderBar telemetry cards "Bid"/"Ask"/"Spread" (lines 879-881) and `quote.hasTwoSided` are driven by the **underlying stock quote** while the user is staging an options order. The comment at line 1897 acknowledges this for the gate, but the displayed values are also wrong UX.
- **Suggested fix:** Add `useQuote(activeContract.occ)` and per-leg quotes; surface the option's own bid/ask/spread in OrderBar telemetry. Keep underlying freshness as the gate, but display the option's actual market.

---

## P1 bugs (degraded experience)

### 3. `Resolve quote first` copy implies user action — but on a stale upstream feed, the user can do nothing
- **Evidence:** `frontend/src/app/(dashboard)/trade/page.tsx:1389` — `submitLabel: quoteBlocked ? "Resolve quote first" : "Resolve blocker first"`. The headline `"Executable quote required before submit"` and detail `"Load a fresh two-sided quote or stage a priced limit"` (lines 1383-1385) imply user-fixable. In P0#1 they are not.
- **Suggested fix:** When `quoteAge > 1h` AND market is open, branch to "Market data feed delayed" copy with a "report" CTA.

### 4. Combo-aware submit label (`"2-leg combo"` etc.) does not exist in source — spec asserts a never-shipped feature
- **Evidence:** `qa/harness/tests/trade.mjs:174` requires `submit.textContent.includes("2-leg combo")`. `grep -rn "2-leg combo" frontend/src/` returns nothing. Even if quote freshness passed, the submit label would be `"Place order"` (lines 1419/1433/714) — never combo-aware.
- **Symptom:** A user about to submit a strangle sees the same "Place order" CTA as for a single share. No confirmation that 4 legs are being routed.
- **Suggested fix:** Restore (or implement) the combo-aware label e.g. `Place 2-leg combo` in `buildExecutionReadiness` or downstream of OrderBar. OR drop the assertion if the product decision is to keep `Place order` everywhere.

### 5. `POST /api/v1/metrics/vitals` aborted on every page-unload
- **Evidence:** `dashboard×2`, `trade×2` `network.jsonl` contain `{"phase":"requestfailed","method":"POST","url":".../api/v1/metrics/vitals","failure":"net::ERR_ABORTED"}` (2 each on dashboard, 4 each on trade).
- **Likely cause:** `fetch keepalive` racing tab navigation. Suggest switching to `navigator.sendBeacon` if not already.

---

## P2 bugs (cleanup)

### 6. Harness `data-testid="strategy-rail"` selector is dead — feature was removed in 2026-04-20 redesign
- Source comment at `frontend/src/app/(dashboard)/page.tsx:54-58` says rail "is no longer on the dashboard". Components use `data-slot=` not `data-testid=`. Dashboard DOM has zero `data-testid` attributes.
- **Action:** Delete `strategy-rail-click` step from `qa/harness/tests/dashboard.mjs:19-25` or repoint at `[data-slot="dashboard-mobile-priority-rail"]`.

### 7. Watchlist quote burst on every authenticated page mount
- Eleven `quotes/*` requests (AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, QQQ, SPY, META, AMD, …) fire on every page mount. Likely contributing to the consistent ~10s `wait for networkidle` ceiling on most authenticated specs.
- **Action:** Add SWR-style cache at the market store layer so subsequent mounts within ~30s reuse the payload.

---

## Hard test failures (4)

### trade @ desktop-1440 — `validate-single-leg-prefill`
- **Expected:** `submit.textContent` includes `"Place order"` (`trade.mjs:115`).
- **Actual:** `Resolve quote first` (DOM: `…!text-amber disabled:opacity-100">Resolve quote first<`).
- **File:** `frontend/src/app/(dashboard)/trade/page.tsx:1378-1394` (hard-block branch), assignment line 1389.
- **Diagnosis:** Hard-block branch entered because active check is `Quote freshness: 47.3h old.` (DOM-confirmed). NOT a copy change — submit button is functioning correctly. Real production regression, but in the data pipeline, not the trade page UI.
- **Recommendation:** **File P0 against backend market-data ingestion** (this report's P0#1). Update spec to gate the assertion on `quote.hasTwoSided && quote.last_quote_age_hours < 1` and skip otherwise.

### trade @ desktop-1440 — `validate-multi-leg-prefill`
- **Expected:** `submit.textContent` includes `"2-leg combo"` (`trade.mjs:174`).
- **Actual:** `Resolve quote first`.
- **Diagnosis:** Same root cause — `Quote freshness` hard-block. Combo UI itself is correct: DOM has `data-slot="active-legs"` containing two `data-slot="active-leg" data-order-side="sell"` rows with both OCC contracts and `@ $1.45`/`@ $1.32` limits rendered. Symbol/qty/price inputs are present and disabled per spec. Secondary issue: even if the quote freshness gate passed, no source path produces a label containing `"2-leg combo"` (P1#4 above).
- **Recommendation:** Fix combo label OR drop the assertion (see P1#4) AND fix the upstream quote feed (P0#1).

### trade @ mobile-390 — `validate-single-leg-prefill` & `validate-multi-leg-prefill`
- Same root cause and same DOM evidence as desktop. Mobile renders `Quote freshness: 47.3h old.` identically and the submit button reads `Resolve quote first`. No mobile-specific issue.

---

## Skipped steps — legitimate vs hiding bugs

| Spec | Step | Skip reason | Verdict | Action |
|------|------|-------------|---------|--------|
| `alerts` desk/mobile | `hover-first-alert` | no `[data-testid=alert-row]` | **Legit empty state.** Source has the testid (`alerts/page.tsx:486`); DOM shows "alerts yet" empty-state. User has zero alerts. | None. |
| `dashboard` desk/mobile | `strategy-rail-click` | no match | **Stale harness selector.** Strategy rail removed in 2026-04-20 redesign. Components use `data-slot=`. | Update or remove (see P2#6). |
| `dashboard` desk/mobile | `command-palette-visible` | no match | **Legit harness limitation.** Already documented in `dashboard.mjs:30-38` — headless Chromium can't trigger Cmd+K reliably; palette works in real browser. | None. |
| `strategy-momentum-quality` desk/mobile | `range-1M` | no `[data-range='1M']` | **Legit empty state.** EquityPanel returns empty state when `data.length < 2` (`EquityPanel.tsx:53`); range chips are inside the populated branch. DOM confirms "Not enough data for equity curve." text. | None — but flag separately: strategy has no curve data, suggesting it's paused or never had a fill. |

---

## Console errors aggregated

| Spec | Viewport | Count | Top error | Cause |
|------|----------|-------|-----------|-------|
| `not-found` | desk + mobile | 1 each | `404` | By design — spec navigates to a known-bad route. |
| `login` | desk + mobile | 1 each | `401 /api/v1/auth/login` | By design — spec exercises invalid-credential path. |
| `_design` | desktop | 1 | `404 /_design` | By design — design page gated, returns 404 in prod. |

**Verdict: no silent runtime errors, no `pageerror` events, no React error boundaries triggered, no hydration mismatches.** All five console errors are intentional probes. Strong signal that runtime is clean across all 21 authenticated pages.

---

## Network failures aggregated

| Endpoint / failure | Count | Affected | Severity |
|--------------------|-------|----------|----------|
| `POST /api/v1/metrics/vitals` `net::ERR_ABORTED` | 8 | dashboard, trade | P1 (see P1#5) |
| `GET /strategies/<slug>?_rsc=…` `net::ERR_ABORTED` | 33 | settings(9), strategies-list(16+8) | Benign — Next.js RSC prefetches cancelled when test navigates away. |
| `404 /this-route-does-not-exist-qa-harness` | 2 | not-found×2 | By design |
| `404 /_design` | 1 | design | By design |
| `401 POST /api/v1/auth/login` | 2 | login×2 | By design |

**No 5xx anywhere. No CORS / CSP failures. No 401/403 on auth-required routes. No 404 on JS/CSS chunks.** Network surface is healthy.

---

## Endpoints with notable latency

| Step | Spec/viewport | Duration | Notes |
|------|---------------|----------|-------|
| `click-every` | settings/mobile-390 | 18.0s | Mobile settings page exercises many click targets sequentially. Single outlier; not a per-endpoint issue. |
| Initial `navigate` | trade, pipeline, strategies-list, dashboard, strategy-detail, reports, strategies-trading-agents-research | ~10.0s consistently | Hits roughly half the harness `networkidle` timeout. Driven by the watchlist quote burst — see P2#7. |

No single-endpoint latency outlier > 5s. Total spec durations (`trade` desk = 36.4s, mobile = 32.2s) are dominated by 3× navigate × ~10s waits — harness instrumentation overhead, not a server bug.

---

## Recommendations summary

1. **P0 — Fix backend market-data ingestion.** NVDA quote feed is 47.3h stale on `tradingalpha.net` as of run time. Investigate `backend/data/ingestion/`. Verify all watchlist tickers (the 200 responses don't tell us if `last_quote_time` is fresh). **Silently disables options trading site-wide.**
2. **P0 — Escalate stale-quote to broker-degraded mode.** Today, when underlying quote is hours old but API returns 200, the user sees a generic blocker copy implying user action. Should trigger the existing `brokerDegraded` banner (`trade page.tsx:1363-1376`).
3. **P1 — Fetch the OCC contract's own quote on `/trade`** when an `?contract=` or `?legs=` deep-link is active. Today's OrderBar shows the underlying stock's market for an options ticket.
4. **P1 — Restore combo-aware submit label** that the harness expects. No source path produces `"2-leg combo"` text today.
5. **P2 — Switch `metrics/vitals` to `navigator.sendBeacon`** (or accept the abort as benign).
6. **P2 — Update `qa/harness/tests/dashboard.mjs`** to drop the dead `strategy-rail-click` step.
7. **P2 — Cache watchlist quote burst** with SWR/TTL at the market store.
8. **Harness hygiene.** Trade spec hard-asserts UI labels that depend on live market data state. Either precondition assertions on `executionReadiness.label === "Ready"` or treat a `Blocked`-state caused by stale upstream data as `skipped`. Today an upstream outage manifests as 4 hard failures that look like a UI regression.
