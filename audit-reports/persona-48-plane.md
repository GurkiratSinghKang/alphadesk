# Persona 48 — Plane (60% packet loss, in-flight wifi)

**Scope:** User is on AlphaDesk over airline wifi with ~60% packet loss, frequent ~8–20 s stalls, and periodic full blackouts. Does the app survive? Is there a service worker? Does `apiFetch` retry? Does React Query `gcTime=10min` keep panels warm? What does "offline" actually look like to the user?

**Target code:**
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts:30-152` — `apiFetch` (15 s timeout, no retry)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/pipeline-api.ts:16-101` — duplicate `apiFetch` clone (15 s timeout, no retry)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/providers.tsx:22-31` — `QueryClient` defaults (`staleTime=30_000`, `gcTime=600_000`, `retry: 2`)
- `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useQueries.ts:1-103` — per-query overrides (`retry: 1 or 2`, no `networkMode`, no `retryDelay`)
- `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useWebSocket.ts:49-224` — WS reconnect (MAX_RETRIES=10, 1 s → 30 s exp backoff)
- `/Users/GK/Downloads/alphadesk/frontend/src/hooks/useDataPipeline.ts:86-148` — initial fetch (one 3 s retry), 30 s polling
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/WsStatusBanner.tsx` — UX for `reconnecting` / `failed`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/StatusStrip.tsx:59-74` — "LIVE"/"OFFLINE" pip driven by WS only
- `/Users/GK/Downloads/alphadesk/frontend/public/` — no `sw.js`, no `manifest.json`
- `/Users/GK/Downloads/alphadesk/frontend/next.config.ts` — no PWA plugin, no runtime caching

---

## Executive answers

| Question | Answer |
| --- | --- |
| Is there a service worker / offline shell? | **No.** `public/` has no `sw.js`; `next.config.ts` has no PWA plugin. Hard reload on a dead wifi slice = blank browser error page. |
| Does `apiFetch` retry on network failure? | **No retries inside `apiFetch`.** It has a 15 s `AbortSignal.timeout` and rethrows. Retries live only in React Query (`retry: 1–2`, default backoff ~1 s → 30 s), and only for queries — not `placeOrder`, `cancelOrder`, pipeline mutations, or the direct `fetch()` in `useDataPipeline`. |
| Does `gcTime: 10 min` keep panels warm? | **Yes for idle tabs, no for active ones.** `staleTime: 30_000` means every refetch during the stall tries to hit the network. Data is kept in cache for 10 min after a component unmounts, but mounted components blow past stale and trigger network requests that will time out after 15 s. |
| What does "offline" look like? | An amber "Reconnecting…" strip (`WsStatusBanner`), a red "OFFLINE" pip in `StatusStrip`, stale numbers frozen in place, silent REST failures logged as `console.warn`, and a 15 s UI freeze per trade/cancel/refresh button press. |

---

## F1 — No service worker, no offline shell, no PWA (HIGH)

`frontend/public/` contains only favicons/SVGs; no `sw.js`, no `manifest.webmanifest`. `frontend/next.config.ts` has zero PWA configuration (no `next-pwa`, no Workbox). Package.json has no PWA deps. On the first blackout the user cannot reload the tab — the Next.js HTML shell, JS bundles, and fonts all 404 at the edge, producing the browser's native "no internet" error page. No app chrome, no "you're offline" message, no cached last-known portfolio value. This is the biggest single gap for in-flight use.

## F2 — `apiFetch` does not retry; a single lost packet fails the request for 15 s (HIGH)

`lib/api.ts:37-90` and the near-duplicate at `lib/pipeline-api.ts:36-101` wrap `fetch` in `AbortSignal.timeout(15_000)` and rethrow on any error. At 60% packet loss a TCP handshake frequently needs 3–5 SYN retransmits (each ~1 s OS default) — well within 15 s for a handshake, but a mid-flight TLS record loss can stall the read until the deadline. The user sees a 15 s spinner, then a toast via the `alphadesk:api-error` event, and the request is gone. No exponential backoff, no automatic retry at the transport layer. A trader pressing "Place Order" during a packet burst gets a 15 s freeze with no feedback, then an error toast.

## F3 — `placeOrder` + `cancelOrder` have no retry wrapper — and replay-unsafe if they did (CRITICAL)

`lib/api.ts:862-888` calls `apiFetch` directly with no `useMutation` wrapper. `components/panels/TradePanel.tsx:271-284` and `app/(dashboard)/page.tsx:404` just `await placeOrder(...)`. React Query's `retry: 2` applies only to queries — mutations default to `retry: 0`, and no callsite overrides it. Combined with `audit-reports/persona-40-replay.md` F1/F2: the backend has only a 30 s Redis dedup window and no `Idempotency-Key` support. If the plane wifi drops between request send and response receipt, the user doesn't know if the order booked, retries, and the second send at T+40 s sails past the dedup window → **two real orders**. There is no client-side idempotency key generation to mitigate.

## F4 — React Query `retry: 2` is fine, but `staleTime: 30_000` defeats the 10-min `gcTime` during spotty use (MEDIUM)

`lib/providers.tsx:24-28` sets `staleTime: 30_000, gcTime: 600_000`. Good intent (panels survive 10 min idle), but every mounted query that passes 30 s triggers a refetch — which on flaky wifi often fails after 15 s and shows a stale-flavoured error state. Worse: `useRegime`/`useIndices`/`useStrategies` set `refetchInterval: 60_000` (`hooks/useQueries.ts:10-34`). So every minute, ~5 parallel HTTP requests compete against a 60%-loss link, most timeout, React Query backs off (`retryDelay` defaults ~1 s → 30 s) and then refetches again on the next interval. No `networkMode: 'offlineFirst'` is configured, so queries don't even try to serve from cache while the user is offline — they report an error state.

## F5 — `useDataPipeline` has fire-once retry only, with NO React Query wrapper (HIGH)

`hooks/useDataPipeline.ts:92-126` calls raw `getSnapshot`/`getPositions`/`getOrders`/`getPortfolioSummary`/`getPortfolioGreeks` in `.then/.catch`. Failures `console.warn` and vanish — no surfacing to UI. Only `fetchInitialData` has a single 3 s retry on the first mount (line 107: `setTimeout(() => fetchInitialData(2), 3000)`); everything after relies on a **30 s `setInterval`** that plows on regardless of prior failures with no backoff. On a 60% loss link this means ~10 consecutive `.warn`s per minute, stale Zustand state frozen at the last success, and no visible "your P&L might be stale" hint except the WS banner (which is about WS, not REST).

## F6 — "OFFLINE" pip and banner only reflect WebSocket state, not REST health (MEDIUM)

`components/layout/StatusStrip.tsx:59-74` derives "LIVE"/"OFFLINE" from `useWs().isConnected` only. `WsStatusBanner.tsx` also keys off `wsStatus`. On the plane, a common failure mode is "WS still open (kept alive by pings) but every REST POST is timing out because the flow suffers more than the pings." In that case the pip shows green LIVE, no banner fires, but every trade/refresh button is broken. There is no `navigator.onLine` listener anywhere (grepped `frontend/src` — zero matches) and no aggregated REST-health indicator.

## F7 — Portfolio / orders / positions stores are in-memory only; a reload = full wipe (HIGH)

`stores/market.ts:39-184` persists `watchlist + selectedSymbol` via Zustand `persist` (localStorage). `stores/portfolio.ts:43-60` does **not** — `positions`, `orders`, `summary`, `greeks` live only in RAM. Because F1 means a reload on the plane fails, this mostly hurts after the user makes it back to ground and refreshes: the last-known P&L and order list disappear for the 5–30 s it takes new fetches to succeed. There's no "last-synced at HH:MM" indicator anywhere in the UI to warn the user they're looking at freshly-zeroed defaults instead of real data.

## F8 — WS reconnect gives up after 10 tries (~30 s cap each), then silently dies until tab becomes visible (MEDIUM)

`hooks/useWebSocket.ts:49-191` — `MAX_RETRIES = 10` with `min(1000 * 2^n, 30_000)`. Cumulative max ~5 min of retries. After that `wsStatus = "failed"` → banner shows "Live data offline — Reload to retry". In a 20-minute rough-air stretch this is fine; in a 45-minute atmospheric mess the WS is permanently dead until the user (a) clicks Reload (which fails under F1) or (b) switches tabs and back so `visibilitychange` re-arms. No `online` event listener, no automatic retry when the OS reports network recovered.

## F9 — `useDataPipeline` polls even when `navigator.onLine === false` (LOW/MED)

`hooks/useDataPipeline.ts:138-148` — `setInterval(fetchPortfolioData, intervalMs)` runs regardless of connectivity. The browser itself short-circuits to a NetworkError when fully offline, which is fine, but on a marginal link it still pays the TCP handshake + TLS cost every 30 s for 4 parallel requests, consuming scarce bandwidth the user might want for their trade POST. No `navigator.onLine` gate and no React Query `networkMode` to centralize this.

## F10 — Duplicate `apiFetch` implementations risk divergent retry/timeout policy later (LOW)

`lib/api.ts` and `lib/pipeline-api.ts` each define a private `apiFetch`. A comment in `pipeline-api.ts:6-13` even notes this: "If/when api.ts exports `apiFetch`, this can collapse to a thin re-import." Any future fix for retry/backoff/offline queueing will have to be applied twice; today they share the 15 s default only by coincidence.

---

## Summary (~250 words)

**Service worker: none.** `frontend/public/` contains no `sw.js`; `next.config.ts` has no PWA plugin. A hard reload during a blackout = browser's native "can't reach this page." No cached shell, no last-known P&L snapshot. This is the single biggest in-flight gap. **`apiFetch` retries: none.** `lib/api.ts:37-90` (and its clone `lib/pipeline-api.ts:36-101`) wraps `fetch` in `AbortSignal.timeout(15_000)` and rethrows on any failure. A single lost SYN-ACK burns 15 s of UI time with no automatic retry. React Query's `retry: 2` layers on top for queries, but **mutations default to `retry: 0`** — `placeOrder`/`cancelOrder` call `apiFetch` raw, so a dropped trade has zero client-side resend, and combined with `persona-40-replay.md` F1/F2 (30 s backend dedup, no `Idempotency-Key`), a user-initiated retry after a 40 s stall books a second order. **`gcTime: 10 min` doesn't save panels.** With `staleTime: 30_000` and `refetchInterval: 60_000` on regime/indices/strategies, mounted panels constantly initiate refetches that timeout. No `networkMode: 'offlineFirst'` means cached data is withheld in favour of error states. **"Offline" looks like:** amber "Reconnecting…" strip (WS only — REST can be failing silently while WS is green), red "OFFLINE" pip, numbers frozen mid-tick, `console.warn` for every REST 15 s timeout, 15 s button freezes on trades, and `stores/portfolio.ts` wiped on any reload because only `market` is persisted. `navigator.onLine` is not referenced anywhere in `frontend/src`. **Fix priority:** ship a Workbox service worker with an app-shell cache; add retry-with-jitter + `Idempotency-Key` to `placeOrder`; persist `portfolio` store; gate polling on `navigator.onLine`; merge the two `apiFetch` copies.
