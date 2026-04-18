# Long-Session Stability Audit r4

Scope: issues that only surface when AlphaDesk stays open for hours or days of
continuous market time. Ordered by time-to-manifest (fastest first).

---

### [P0] Token refresh scheduler is a no-op (every call returns 422)
**File:** frontend/src/lib/api.ts:360-398 (see also backend/api/routes/auth.py — `POST /auth/refresh`)
**Leak/drift:** The interval fires every 7 hours but the POST body is an empty
`{}` while the backend handler requires `{"refresh_token": "<token>"}`. JS cannot
read the refresh token because the cookie is HttpOnly with path
`/api/v1/auth`. The comment on line 352 admits this. Net effect: the 8-hour
access token silently expires during an overnight session; the first request
after the 8-hour mark gets a 401 and boots the user to `/login` with whatever
unsent state they had.
**Time-to-manifest:** 8 hours (first overnight session).
**Fix:** Update the backend `/auth/refresh` handler to read the refresh token
from the HttpOnly cookie (`request.cookies.get("refresh_token")`). Keep the
body-based path as a fallback for non-browser callers. Once that lands, the
existing scheduler interval works unchanged.

---

### [P0] `window.fetch` monkey-patched by PerformanceMetrics without idempotency guard
**File:** frontend/src/components/dashboard/PerformanceMetrics.tsx:50-87
**Leak/drift:** On every mount of the Settings → Performance panel, the effect
saves `originalFetch = window.fetch` then replaces `window.fetch` with a wrapper
that pushes into `timingsRef`. If the panel mounts a second time before unmount
(e.g. React StrictMode double-invoke in dev, fast-refresh in development, or a
future layout change that mounts it twice), the second capture of `originalFetch`
will be the already-wrapped function, producing a chain of wrappers that grows
every reload. Each wrapper keeps its own `timingsRef` closure — all prior
references stay alive. Every API call walks the entire chain.
**Time-to-manifest:** hours (after a handful of navigations to/from Settings in
a single tab lifetime, especially in dev).
**Fix:** Guard with a module-level sentinel so the patch is installed at most
once per page:
```ts
// module scope
let patched = false;
const originalFetch = window.fetch;
useEffect(() => {
  if (patched) return;
  patched = true;
  window.fetch = async function (...args) { /* timing wrapper */ };
}, []);
```
Drop the `return () => { window.fetch = originalFetch; }` (it won't unpatch
correctly anyway if another consumer patched on top). Better: stop monkey-
patching `window.fetch` entirely — wrap `apiFetch` in `lib/api.ts` instead,
which is the only code path the dashboard uses.

---

### [P0] `_last_quotes` / `_last_published` grow forever as the watchlist churns
**File:** backend/data/ingestion/alpaca_stream.py:39-55, :141-174
**Leak/drift:** Every 5 minutes `_watchlist_refresh_loop` recomputes the set and
calls `_update_subscriptions`. When a symbol is unsubscribed from Alpaca, its
entries in `_last_quotes` and `_last_published` are **not** deleted. Any
user-driven churn (add/remove watchlist, position opens and closes, core
indices rotating in and out of the "held" set) leaves stale keys. Worst case
on a busy week: 40+ symbols cycle per day, entries retained indefinitely
until process restart.
**Time-to-manifest:** days (grows by ~tens of symbols per active trading week).
**Fix:** In `_update_subscriptions`, after the `to_remove` set is sent,
```py
for sym in to_remove:
    _last_quotes.pop(sym, None)
    _last_published.pop(sym, None)
```

---

### [P0] Frontend `marketStore.quotes` never evicts removed symbols
**File:** frontend/src/stores/market.ts:37-40
**Leak/drift:** `removeFromWatchlist` drops the symbol from `watchlist` but
leaves its entry in the `quotes` record. Over a long session the user adds,
searches, selects, then removes symbols; each cycle leaves another entry.
Because the WS bars/quotes channel pushes for every subscribed symbol in the
backend's dynamic watchlist (which includes held positions), entries can
accumulate well past the user's current watchlist size.
**Time-to-manifest:** days of normal watchlist editing. Not fatal (per-symbol
Quote is small) but compounds with the Alpaca-stream leak above and is visible
in `getFreshestQuoteTimestamp`'s `for…in` loop cost.
**Fix:** In `removeFromWatchlist`, also delete the quote:
```ts
removeFromWatchlist: (symbol) =>
  set((state) => {
    const nextQuotes = { ...state.quotes };
    delete nextQuotes[symbol];
    return {
      watchlist: state.watchlist.filter((s) => s !== symbol),
      quotes: nextQuotes,
    };
  }),
```

---

### [P1] React Query cache has no `gcTime` configured
**File:** frontend/src/lib/providers.tsx:15-25
**Leak/drift:** `makeQueryClient` sets `staleTime: 30_000` but not `gcTime`, so
v5's default 5 min applies. Queries like `useOptionsChain(symbol, expiration)`
and `useIVData(symbol)` are keyed on symbol/expiration; over a long session a
user hovers many symbols and expirations — each unique key hangs in cache for
5 minutes after unmount. In a heavy research session this can grow to thousands
of entries before gc catches up. Not a leak, but a slowly bloating JS heap.
**Time-to-manifest:** hours for heavy research sessions.
**Fix:** Set explicit bounds in `makeQueryClient`:
```ts
defaultOptions: {
  queries: {
    staleTime: 30_000,
    gcTime: 5 * 60 * 1000, // explicit; consider 2 min for large keyspaces
    refetchOnWindowFocus: false,
    retry: 2,
  },
},
```
For the options chain/IV hooks, pass a shorter `gcTime: 60_000` at the
`useQuery` site.

---

### [P1] Parquet cache lock map `_LOCKS` grows unbounded
**File:** backend/data/providers/cache.py:45-84
**Leak/drift:** Every unique `(provider, method, args, kwargs)` call produces a
new SHA-truncated key; `_lock_for(key)` inserts a new `threading.Lock` and
never evicts. After a few weeks of running with a mature watchlist plus screener
combinations plus each user's symbol pulls, the dict grows into tens of
thousands of entries. Each lock is cheap (~50 bytes) but compounds; the dict
is also walked on hot paths indirectly through lookups.
**Time-to-manifest:** weeks (background RSS creep).
**Fix:** Wrap with an LRU-bounded cache (e.g. `functools.lru_cache(maxsize=4096)`
on `_lock_for`, or a small `collections.OrderedDict` with eviction). A coarser
fix: shared global lock (cheaper than per-key — the locks primarily protect
the parquet write, not throughput).

---

### [P1] `_pending_setups` / `_pairs_setups` pruned only by expiry string comparison
**File:** backend/data/ingestion/realtime_scanner.py:63-118
**Leak/drift:** `clear_expired_setups` only fires when
`int(time.monotonic()) % 60 == 0` in `_scanner_loop` (realtime_scanner.py:389).
`get_message` has `timeout=2.0`, so the tick rate around the modulo check is
non-deterministic — on a busy market the loop iterates faster than once a
second and the `% 60 == 0` check is skipped for minutes at a time. Expired
setups accumulate, and without quote traffic the scanner can skip `clear_expired_setups` for an entire off-hours window. Symbols with typo expiries (e.g.
missing `expires` → defaults to `"9999"`) are kept forever.
**Time-to-manifest:** days (accumulator grows during quiet periods, never flushed
overnight).
**Fix:** Drive cleanup by wall-clock delta instead of modulo:
```py
last_clear = time.monotonic()
...
if time.monotonic() - last_clear >= 60:
    clear_expired_setups()
    last_clear = time.monotonic()
```
And reject setups missing a real `expires` field at `register_setup` time.

---

### [P1] Alpaca SIP stream backoff caps at 300s with no reset
**File:** backend/data/ingestion/alpaca_stream.py:320-327
**Leak/drift:** Contra the docstring in `_supervised_run` (which caps at 60s),
the inner `_run_stream` caps at **300s** (5 min) and only resets on a fully
successful reconnect+subscribe. If the SIP feed has an extended outage
(Alpaca incident, network blip during early morning with nobody watching), the
stream will retry every 5 min. That's fine for the connect loop, but the
process keeps accumulating `_last_quotes` entries from before the outage —
combined with the leak above, multi-day outages inflate the dict meaningfully.
Separately: the `_supervised_run` wrapper and `_run_stream` inner loop both
apply backoff, so failures get compounded (30s outer + 300s inner).
**Time-to-manifest:** during incident recovery.
**Fix:** Align the caps (60s is enough for an external SIP feed) and reset
`backoff` on first successful message receipt, not only after the subscribe
ack — that way a flaky but partially-working feed doesn't stay at max backoff.

---

### [P1] Subscribed channels Set grows if WS reconnects without clearing
**File:** frontend/src/hooks/useWebSocket.ts:46, :98-102
**Leak/drift:** `subscribedChannels: Set<WsChannel>` is filled by callers and
replayed on every reconnect (line 99). There are only 5 valid channels
(quotes/portfolio/alerts/agents/bars), so this set is bounded by construction.
HOWEVER: `subscribe(channel)` adds unconditionally with no validation. If a
future code path ever dispatches a dynamic channel (e.g. `subscribe(symbol)`),
the set grows forever. Flagging for defence-in-depth.
**Time-to-manifest:** never-but-correct-to-fix.
**Fix:** Validate against `ALL_CHANNELS` in `subscribe`, same as the server-side
check in `handler.py:49-51`.

---

### [P1] `ResizeObserver` fires on every pane drag → chart re-applies sizes forever
**File:** frontend/src/components/charts/TradingChart.tsx:440-449
**Leak/drift:** The observer on `containerRef.current` calls
`chart.applyOptions({ width, height })` on every entry. When the user drags a
layout splitter, this fires continuously — LWC debounces its own raster but
our `getTokenVar` reads via `getComputedStyle` on every apply, forcing style
recalc. Not a leak per se, but a long-running browser tab accumulates style-
recalc cost and the Chrome memory inspector shows `lightweight-charts` retained
graph ballooning during drag sessions.
**Time-to-manifest:** during heavy panel resizing, noticeable after an hour of
layout adjustments.
**Fix:** rAF-throttle the ResizeObserver callback. The `SectorTreemap.tsx:208`
pattern already does this with a 100 ms `setTimeout` — lift that into a shared
`useThrottledResize` hook.

---

### [P2] `LiveSignalFeed` schedules a rogue setTimeout that outlives the component
**File:** frontend/src/components/dashboard/LiveSignalFeed.tsx:392-401
**Leak/drift:** The effect starts a 5s `setTimeout` on every quotes-ref change
and returns a cleanup. But the `quotes` dependency for this effect is the full
`useQuotes(watchlist)` result, which returns a new object on every tick for
symbols in the watchlist (even with `useShallow`). On each tick, the cleanup
fires clearing the last timer, and a new timer is started. In a quiet quote
stream this is fine. Under a heavy tick stream (midday SPY), this effect runs
every ~50 ms, creating and tearing down `setTimeout` handles continuously —
the debounce never fires, but the churn shows up as GC pressure.
**Time-to-manifest:** hours on a busy market day.
**Fix:** Use a ref + stable timer. Cancel previous timer only if it hasn't
fired yet, and rely on `useRef` comparison of actual quotes content (not
object identity), e.g.:
```ts
const lastHash = useRef("");
const h = watchlist.map(s => quotes[s]?.last).join("|");
if (h !== lastHash.current) {
  lastHash.current = h;
  // schedule
}
```

---

### [P2] `_ensure_listener_started` leaks a task when a client disconnects during startup
**File:** backend/api/websocket/handler.py:155-175
**Leak/drift:** `_maybe_stop_listener` runs in the `finally` of
`websocket_endpoint` (handler.py:260). If two clients connect simultaneously,
the first one's `_ensure_listener_started` creates the task; when client 2
disconnects first and `manager.active_count == 0` is briefly true (client 1
hasn't yet been `register`'d due to auth timing), the listener gets cancelled
out from under client 1. Then client 1's message loop raises and another
`_ensure_listener_started` creates a second task. Under sustained auth-delay
churn, this could leak short-lived tasks.
**Time-to-manifest:** days of connection churn (rare in practice — auth is fast).
**Fix:** Move `_ensure_listener_started` **before** the auth flow so the
listener outlives transient auth attempts, OR increment a per-request "pending"
counter that `_maybe_stop_listener` checks.

---

### [P2] `_last_eval_slot` and similar module-level strings never reset on date change
**File:** backend/data/ingestion/continuous_monitor.py:147, :209-215
**Leak/drift:** `_last_eval_slot = f"{hour}:{minute:02d}"` tracks the last
evaluation time. On a day that runs uninterrupted from 09:30 to 16:00 (ok),
then continues into the next trading day, the previous day's slot strings
collide — e.g. `"9:30"` on Tue won't re-run if it was last set Mon at `"9:30"`.
So the pipeline skips Tuesday's 9:30 slot entirely.
**Time-to-manifest:** first multi-day run across a weekend.
**Fix:** Key the slot with the date: `slot_key = f"{now.date().isoformat()}:{hour}:{minute:02d}"`.

---

### [P2] `getFreshestQuoteTimestamp` walks the entire quotes object on the 2s heartbeat
**File:** frontend/src/stores/market.ts:133-141, frontend/src/app/(dashboard)/page.tsx:176-192
**Leak/drift:** Not a leak, but a steadily worsening perf cost as the
`quotes` record grows (see P0 #4). With 50 symbols it's nothing; with 500
after a week it's a measurable 2s tick cost. Compound this with the main
market.ts `updateQuote` spread `{ ...state.quotes, [quote.symbol]: merged }`
which also scales with record size.
**Time-to-manifest:** days, conditional on #4 not being fixed.
**Fix:** Maintain a `maxTimestamp` field in the store, updated inside
`updateQuote` / `updateQuotes`. The heartbeat reads one number.

---

### [P2] Pipeline `scheduler_state` Redis key has a 2-day TTL but collects unbounded subkeys
**File:** backend/data/ingestion/pipeline_runner.py:288, :352
**Leak/drift:** `cache_set("pipeline:scheduler_state", state, ttl_seconds=172800)`
refreshes the TTL on every write, but `state` is a dict of
`{"last_premarket": "YYYY-MM-DD", "last_open": "...", …}`. The key set is
bounded by `WINDOWS` so this is actually fine — flagging only because if a
future contributor adds dynamic per-strategy keys (e.g.
`state[f"last_{strategy_id}"] = today`), the dict grows unbounded.
**Time-to-manifest:** never-but-correct-to-document.
**Fix:** Add a schema check or limit to `_run_window` before writing.

---

## Summary

The most load-bearing fixes are the first four: the token-refresh body payload
(8h), the `window.fetch` monkey-patch (dev-mode hours), and the twin backend /
frontend `quotes` accumulators (days). Items 5–9 are slow creep that compounds
over a week. Items 10–15 are defensive hardening plus one latent correctness
bug (#13 `_last_eval_slot` across date boundaries) that will silently skip an
evaluation slot on the first multi-day run.
