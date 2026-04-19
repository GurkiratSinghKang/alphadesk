# Persona 10 — Multi-Session / Long-Session Audit

**Date:** 2026-04-18
**Scope:** 3+ tabs open at tradingalpha.net, left running overnight / for days.
**Method:** Code-level trace of auth refresh, WS lifecycle, Zustand persist, and backend caching against `audit-reports/long-session-audit-r4.md` and `audit-reports/concurrency-audit-r4.md`. Live login verified; static inspection for long-running behaviour.

---

## Top 10 findings — "leave 3 tabs open for a week"

### [P0] No `storage` listener on any Zustand persist store → cross-tab actions don't sync
`frontend/src/stores/market.ts:160`, `stores/ui.ts:59`, `stores/preferences.ts:84`, `stores/notifications.ts:69` all use `persist({ name, skipHydration: true })` and nothing else. Zustand persist does **not** install a `window.addEventListener("storage", …)` by default, and a grep for `"storage"` across `frontend/src/` returns zero hits. Real effect: tab A adds `"NFLX"` to the watchlist → localStorage updates → tab B still renders the old list until the user hard-reloads. `tradingMode` flips in tab A, tab B still says "paper". Notifications marked-read in tab A come back unread in tab B. This was flagged in a prior audit as P1 and is still unfixed.

### [P0] Refresh-token scheduler silently no-ops after a page reload
`frontend/src/lib/api.ts:427` stores the refresh_token in a module-local `let refreshToken`. On F5 the module is re-evaluated, `refreshToken` goes back to `null`, and `ensureTokenRefreshScheduled()` returns early (line 505). LoginForm only dispatches `alphadesk:auth-login-success` on the login POST (`LoginForm.tsx:142-146`); after a reload there's no login. Net result: the 8-hour access cookie expires, the first subsequent request 401s, `apiFetch` awaits `/auth/logout` then `window.location.href = "/login"` (`api.ts:92-110`) with no toast, no banner — a silent redirect that discards any unsent order. Overnight behaviour with a reloaded tab: guaranteed eviction at the 8-hour mark.

### [P0] `/portfolio/summary` is not cached → 3 tabs = 3× Alpaca calls every 30 s
`backend/api/routes/portfolio.py:437-536` has no `cache_get` / `cache_set` wrapper — each request hits `httpx` twice (account + positions). `useDataPipeline` polls every 30 s (`useDataPipeline.ts:124`). Three tabs sustain 6 Alpaca calls/min against a 200 req/min Alpaca rate-limit; add portfolio-performance/calendar/greeks and a week of 3 tabs eats rate-limit headroom and pushes latency. The prior audits expected a Redis 5 s TTL here; it's missing.

### [P1] Logout from one tab leaves siblings with stale UI until their next API call
`ProfileMenu.handleLogout` (`components/layout/ProfileMenu.tsx:74-93`) POSTs `/auth/logout`, dispatches `alphadesk:auth-logout` (this window only — it's not a storage-event, so tab B never hears it), then `window.location.href = "/login"`. Tab B keeps running, its WebSocket keeps streaming (handler doesn't re-check revocation mid-connection), and the next REST call 401s and hard-redirects. For the minutes in between, tab B may render quotes + allow a click on Place Order that then fails silently. Fix needs a `storage`-event or `BroadcastChannel` bridge.

### [P1] Session-expired UX is a hard redirect with no toast and no banner
`api.ts:92-110` on 401: await logout POST, `window.location.href = "/login"`, `throw new Error("Session expired")`. No toast, no banner, no "your session expired — click to sign in". The user returns to a stale desk, sees `/login`, and has to figure out why. The WsStatusBanner handles WS loss gracefully with amber/red copy, but nothing equivalent exists for REST 401. Users who leave a tab open past 8 h will find themselves back at /login on their next click with no context.

### [P1] WS reconnect correctly re-subscribes, but long-session audit P1 #11 leaves subscriptions unvalidated at the API
`useWebSocket.ts:125-131` replays `subscribedChannels.current` on every `ws.onopen`. The set is now validated against `ALL_CHANNELS` (line 230, wave 19 fix landed). `useNotifications` correctly uses `useWs()` context (`hooks/useNotifications.ts:61` — wave 14 fix held). So 1 WS per tab, 3 tabs = 3 backend connections, each re-subscribing to 5 channels on reconnect. Backend `ConnectionManager` (`handler.py:19-102`) iterates connections under a lock for every broadcast — fine for 3 tabs, will show fanout cost at 30+ concurrent clients. No immediate concern for this persona.

### [P1] 30 s portfolio poll survives background-tab throttling, but 7 h token refresh is at the mercy of browser sleep
Chrome throttles `setInterval` in background tabs to 1/min after 5 min, and suspends them entirely after 5 min if the laptop closes. The 30 s poll is fine (user only cares about data when they switch back). The 7 h token-refresh interval (`api.ts:423`) is **not** fine — on a closed-laptop scenario the interval never fires at all and the access cookie expires server-side. Reopening the lid, the first request 401s and the user is logged out. Recommended: run the refresh in a `document.visibilitychange` handler that also checks how long the tab has been hidden.

### [P2] localStorage schema evolution is unprotected — no `version` or `migrate`
None of the stores set a `version` or `migrate` in their persist config. If a future wave adds a field to `MarketState.watchlist` (e.g. `[{symbol, addedAt}]` instead of `[string]`), every existing tab rehydrates the old shape and runtime-crashes on a `.toUpperCase()` or `.addedAt` access. Fix: `persist({ name, version: 2, migrate: (state, v) => … })`. Non-urgent, but "week-long session" surfaces schema drift after a deploy.

### [P2] WebSocket auth is cookie-only on handshake — no mid-connection revocation check
`backend/api/websocket/handler.py:215-222` reads `ws.cookies.get("access_token")` on connect and that's it. If the access cookie is revoked server-side (via `/auth/logout` in another tab) while the WS is still open, the stream keeps delivering quotes until the client disconnects. For a 7-day tab this is a subtle privacy/correctness drift: a "logged-out" tab can still receive portfolio frames. Fix: periodic `is_token_revoked(jti)` check on the inner receive loop (`handler.py:251`).

### [P2] Notifications store accumulates 200 entries forever; every tab rehydrates the full log
`stores/notifications.ts:45` caps at 200, which is fine for memory, but persist means every tab writes the same 200-entry array on every `addNotification`. With 3 tabs subscribed to the same WS-driven fills + alerts, each fill writes three copies of the list to localStorage (one per tab). Over a week with a chatty strategy, that's megabytes of write amplification for localStorage quota (5–10 MB). At quota exhaustion the persist middleware silently drops writes. Fix: dedupe writes across tabs via `BroadcastChannel("notifications")` or a lead-tab election.

---

## Cross-cutting notes

- `useDeskClock` (`frontend/src/app/(dashboard)/_desk/useDeskClock.ts`) reads `Date.now()` each tick — no accumulating drift. Clean.
- `useWebSocket` correctly clears `reconnectTimerRef` + `subscribeTimeoutRef` + cancels stale onclose (lines 72-90, 197-207). `visibilitychange` handler resets retries and reconnects cleanly.
- `marketStore.quotes` now evicts on `removeFromWatchlist` and tracks `freshestTs` in O(1) (market.ts:60-71, 140-158) — Wave 19 fixes held.
- Alpaca-stream `_last_quotes` / `_last_published` / `_last_quote_seen_at` now evict on unsubscribe (`alpaca_stream.py:180-182`) and periodic sweep (`_sweep_stale_quotes`, lines 200-225). Clean.
- React Query has explicit `gcTime: 10 * 60_000` (`providers.tsx:27`) — cache bounded.

**Summary for the persona:** the app survives a single-tab overnight (WS reconnects + quote memory is bounded), but **multi-tab + >8 h without a login** is the failure mode — silent logouts, no cross-tab sync, and one `/portfolio/summary` call per tab per 30 s. Top 3 to fix: refresh-token scheduler after reload, storage-event cross-tab sync, and a Redis TTL on `/portfolio/summary`.
