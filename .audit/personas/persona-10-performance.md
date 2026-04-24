# Persona 10 — Performance Analyst

**Profile:** Reads waterfalls, Lighthouse, memory tabs for breakfast. Cares about TTFB, LCP, CLS, request counts, and bundle shape.

## Good news

- TTFB 34 ms, DOMContentLoaded 254 ms, Load 321 ms on the Desk — excellent
- CLS 0.000, zero layout shifts observed
- Transfer size for the HTML doc is ~4 KB (it's a very lean shell)
- FCP 444 ms
- Idle JS heap stayed flat at 24 MB over 8 s (no obvious leak)
- DOM stayed at ~594 nodes (no DOM leak)
- Service worker registered (good for offline resilience of the shell)

## Bugs found

### P1-PERF-1: Polling instead of WebSocket for market data / portfolio
- In a single session, **295 `/api/v1/*` requests** were fired over ~60 s, dominated by the same 10 quote symbols (AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, SPY, QQQ, META, AMD) and the portfolio trio (positions, orders, summary, greeks).
- CSP already allows `wss://tradingalpha.net` in `connect-src` — infrastructure is there.
- **Fix:** Open one WebSocket subscription per symbol set and one for portfolio. Today's architecture puts avoidable load on backend and network, and guarantees an inconsistent snapshot (the P&L drift Risk/PM caught is a direct consequence — each HTTP fetch re-prices independently).

### P1-PERF-2: Duplicate API calls on first paint
- First paint fires `/api/v1/portfolio/summary` twice, `/api/v1/trades/positions` twice, and `/api/v1/trades/orders` **three times** (`orders`, `orders?status=pending`, `orders?status=open`).
- Merge the three orders fetches into one, dedupe the summary call.

### P1-PERF-3: Multiple slow API calls (>450 ms) on cold load
- `/api/v1/strategies/` 484 ms, `/api/v1/market-overview/regime` 322 ms, `/api/v1/market-overview/indices` 321 ms, one blocked-by-cookie fetch at 927 ms.
- For a dashboard, >300 ms APIs cascade into noticeable blank-card states. Add server-side caching for the regime/index summary (refresh every 5s at source, not per-client).

### P1-PERF-4: Next.js RSC payloads fired for same page multiple times
- Three `/?_rsc=*` payloads for the landing route (1.7 KB, 1.5 KB, 1.2 KB) on a single load. Looks like multiple Server Component refetches. Audit whether a `router.refresh()` is being called on an effect without a guard.

### P2-PERF-5: LCP not observed
- `performance.getEntriesByType('largest-contentful-paint')` returned nothing. Either no LCP candidate is large enough to trigger, or the event didn't dispatch in the JS context before I sampled. Instrument this — Core Web Vitals needs it.

### P2-PERF-6: `icon-192.png` is 3.3 KB and fetched but no `manifest.webmanifest` was loaded on the main route
- You already have `frontend/public/manifest.webmanifest` (untracked). Either wire it up or remove the icon fetch to avoid the 404-ish orphan.

### P2-PERF-7: No font resources counted
- Either fonts are inlined via CSS `@font-face data:` or they're unused. Given the page uses both a serif ("SPY" header) and sans-serif text, the actual network fetches should show up. Make sure fonts are preloaded with `rel="preload"` to avoid FOIT/FOUT.

### P2-PERF-8: Marquee ticker scrolls off the right edge of the viewport
- Top-of-page ticker scrolls horizontally past the viewport bounds (observed "AAPL" partially cut off right). Consider `overflow: clip` + virtualized rendering so off-screen nodes aren't painted.
