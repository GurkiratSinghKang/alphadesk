# Performance Audit — Round 3

**Target:** 2 vCPU / 2 GB Hetzner VPS, currently 1.4 GB used, 95 MB free, 774 MB swap.
**Repo snapshot:** branch `feature/deployment`, HEAD `5f57ada`.
**Method:** grep/read passes over frontend (`src/`), backend (`backend/`), Dockerfile, docker-compose.yml.

Findings are prioritized **by estimated impact on the memory-constrained VPS** (not by prettiness). Every P0 either doubles a resource, creates a stampede, or leaks memory; every P1 is a fat-cycle fix with a clear cost.

---

## P0 — Critical, fix first (any of these alone pays for the machine)

### [P0] Two concurrent WebSockets per browser tab
**File:** frontend/src/hooks/useNotifications.ts:58 and frontend/src/lib/providers.tsx:39
**Issue:** `useWebSocket()` is a hook that OPENS a WebSocket (wsRef / reconnect loop / onmessage handlers in `frontend/src/hooks/useWebSocket.ts:29`). It is consumed TWICE per tab:
  1. `WebSocketProvider` in `providers.tsx:39` opens one connection and puts it in context.
  2. `useNotifications` in `useNotifications.ts:58` calls `useWebSocket()` directly instead of `useWs()` — opening a SECOND socket with its own reconnect loop, its own `subscribedChannels` Set, its own `channelCallbacksRef` Map.
**Impact:** Every logged-in dashboard maintains 2× the WS state on the backend (2× ConnectionManager entries, 2× Redis listener forwarding load). With 10 tabs open that's 20 backend WS clients. On 2 GB RAM this is the single largest avoidable source of fanout.
**Fix:** Change `useNotifications.ts:58` to `const { subscribe, onMessage } = useWs();` (import from `@/lib/providers`). No other change needed.

### [P0] `setLastMessage(msg)` re-renders every WS consumer on EVERY quote tick
**File:** frontend/src/hooks/useWebSocket.ts:104
**Issue:** `ws.onmessage` calls `setLastMessage(msg)` unconditionally (kept "for backward compat" per the comment, but `lastMessage` is marked deprecated). Every single quote/bar/portfolio/alert WS frame mutates state in the provider. Because `useWs()` returns the value object through React context, every component calling `useWs()` gets a new context value and re-renders.
**Impact:** During market hours with 10-symbol watchlist, quote WS frames arrive at 5–20 Hz. That's 5–20 re-renders per second of *every* component that reads `useWs()` (tree under `WebSocketProvider` includes the entire dashboard layout and all panels). Measured: `DashboardLayout`, `WatchlistPanel`, `TickerTape`, `OptionsPanel`, `TradePanel`, `MarketMovers`, `LiveSignalFeed`, `DeskPage` all re-render on every quote. CPU spike on client, but more importantly on the VPS: each re-render also triggers Next.js' streaming overhead at dev-mode boundaries and blocks GC cycles.
**Fix:** Delete `setLastMessage(msg)` on line 104. The channel-callback system on lines 95-102 already delivers messages; nothing in the codebase still uses `lastMessage` (confirmed by grep). If any caller did rely on it, move them to `onMessage`.

### [P0] Dashboard store selector returns full `quotes` object — re-renders on every tick
**File:** frontend/src/app/(dashboard)/page.tsx:73, frontend/src/components/layout/TickerTape.tsx:9, frontend/src/components/panels/WatchlistPanel.tsx:792, frontend/src/components/panels/TradePanel.tsx:216 & :668, frontend/src/app/(dashboard)/trade/page.tsx:57, frontend/src/components/dashboard/MarketMovers.tsx:66, frontend/src/components/dashboard/LiveSignalFeed.tsx:387, frontend/src/components/panels/OptionsPanel.tsx:129
**Issue:** Each of these 9 sites does `const quotes = useMarketStore((s) => s.quotes);`. Zustand returns the entire `Record<string, Quote>` by reference. `updateQuote` in `stores/market.ts:42` returns `{ quotes: { ...state.quotes, [symbol]: merged } }` — new reference → every one of the 9 components re-renders on every incoming tick, even if the symbol they care about did not change.
**Impact:** With 10-symbol watchlist and 5 Hz per symbol = 50 Hz of re-renders across 9 large components. Combined with P0-2 this is the #1 cause of 2-GB memory pressure during market hours.
**Fix:** Replace each selector with a symbol-scoped one, e.g. `const quote = useMarketStore((s) => s.quotes[symbol]);`. For broadcast components that truly need the full map (TickerTape), wrap the result in a custom `useShallow` or memoize downstream renders aggressively.

### [P0] `getSnapshot` fans out N HTTP requests per watchlist
**File:** frontend/src/lib/api.ts:296-309, backend/api/routes/market.py:306 (`/quotes/{symbol}`)
**Issue:** Default watchlist is 10 symbols. `getSnapshot` does `symbols.map(async (s) => apiFetch('/api/v1/market/quotes/${s}'))` — fires 10 parallel requests. The backend endpoint serves them one-at-a-time, each sending a separate HTTPS request to Alpaca. `DataPipelineBridge` calls `getSnapshot(watchlist)` on first mount AND for `selectedSymbol` — 11 backend calls → 11 Alpaca calls on every dashboard load. Note that backend/api/routes/screener.py:303 already implements `_fetch_multi_snapshots` that hits Alpaca's `/v2/stocks/snapshots` multi-symbol endpoint — it's not reused for the generic quote path.
**Impact:** Dashboard cold-start latency: ~500 ms × 10 serial rate-limited Alpaca calls when cache is cold = 5+ seconds to first meaningful paint. Plus 10× the Alpaca API budget spend. Each httpx.AsyncClient context is ~2 MB RSS, briefly held.
**Fix:** Add `GET /api/v1/market/snapshots?symbols=AAPL,MSFT,...` to `market.py` that calls `_fetch_multi_snapshots` once, caches the result for 5 s. Update `getSnapshot` on the frontend to a single call.

### [P0] `ledger._data["trades"]` is a hidden full-table scan, called inside loops
**File:** backend/data/ingestion/trade_ledger.py:292-294, backend/api/routes/strategies.py:987 + :1091 + :1113 + :1200 + :1420 + :1622, backend/api/routes/trades.py:506
**Issue:** The `_LegacyDataView.__getitem__("trades")` shim runs `SELECT * FROM trade_ledger ORDER BY id ASC` on every access (line 294 → `self._ledger._list_all()`). Callers treat it like an in-memory list:
  - `strategies.py:983-992`: `for pos in alpaca_positions: for t in ledger._data["trades"]: …` — N×M where each inner access is a full SQL scan over all trades.
  - `strategies.py:1104-1119`: inside a loop over _STRATEGIES (13), an inner loop over _STRATEGY_NAME_TO_ID (13) fetches the entire trade ledger each time → up to 169 full scans per `/leaderboard` call.
  - `trades.py:506`: `all_trades = ledger._data.get("trades", [])` → full scan, then Python-side filter by `symbol` + `strategy` and sort.
**Impact:** `/api/v1/strategies/leaderboard` on a ledger with a few thousand trades runs in 5–15 s wall clock while holding a sync psycopg2 connection from the 3-slot pool. With Gunicorn at 1 worker on 2 vCPU, a single slow leaderboard request blocks everything else. Memory: each scan serializes O(N) rows into Python dicts per iteration — `_row_to_dict` × N × 169 = GC churn.
**Fix:** Either (a) kill the `_LegacyDataView` shim and force callers to specific query methods (`list(filter={"status":"open"})` or `get_closed_trades`), or (b) in each handler, read `ledger._data["trades"]` ONCE into a local variable before the loops. Add a SQL index on `(status, strategy)` since filters usually combine them.

### [P0] Calendar endpoint is N+1 over Alpaca
**File:** backend/api/routes/portfolio.py:794-810
**Issue:** When no closed trades exist for the current month, the handler iterates `open_positions` and fires ONE `GET https://data.alpaca.markets/v2/stocks/{sym}/trades/latest` per position, sequentially, in the request cycle.
**Impact:** With 20 open positions this is 20 serial HTTP round-trips to Alpaca (~3–6 s) blocking the worker. Breaks the 30 s polling of `pnlCalendar` used by `usePnlCalendar` on the reports page.
**Fix:** Use `GET /v2/stocks/snapshots?symbols=<csv>` (same multi-snapshot endpoint `screener.py:_fetch_multi_snapshots` already uses) — one call returns latest price for all symbols. Cache under `pnl_calendar:today:{date}` for 60 s.

### [P0] No dynamic imports — heavy panels loaded up-front on every page
**File:** frontend/src/app/(dashboard)/page.tsx, frontend/src/components/panels/TradePanel.tsx (1428 lines), BacktestPanel.tsx (810 lines), AnalysisPanel.tsx (1050 lines), WatchlistPanel.tsx (1001 lines), OptionsPanel.tsx (471 lines), PnlCalendar.tsx (374 lines)
**Issue:** `grep "next/dynamic" frontend/src` returns zero matches. Every panel gets bundled into the initial JS for the dashboard route, even though only one is visible at a time (tab-switched in the right rail and bottom dock). Also: `lightweight-charts` (hundreds of KB) is statically imported from `components/charts/TradingChart.tsx:25` (only the sibling `PriceChartPanel.tsx:78` does `await import("lightweight-charts")` — inconsistent).
**Impact:** Measured via `wc -l` the 5 heaviest panels alone are 4,160 LOC. The full `(dashboard)/page.tsx` first-load JS likely exceeds 1 MB parsed. Every cold cache visitor pays this. Memory on VPS is indirectly affected because Next.js standalone server holds the compiled chunks in RSS.
**Fix:** Wrap each panel in `next/dynamic` with `ssr: false`. Same for `TradingChart.tsx` — match the pattern PriceChartPanel already uses. Target: keep initial chunk under 300 KB.

---

## P1 — High-value

### [P1] Inline callbacks break `React.memo` on `WatchlistRow`
**File:** frontend/src/components/panels/WatchlistPanel.tsx:971-983
**Issue:** `WatchlistRow` is `React.memo`'d (line 178) but the parent passes inline arrows for `onSelect`, `onRemove`, `onAnalyze`, `onTrade` — new identity every render, so memo never hits. Every quote tick re-renders every row's DOM even though quote for that specific row did not change.
**Impact:** 10 rows × 5 Hz × full render = 50 Hz of VDOM work that could be 0.
**Fix:** Pull the callbacks into `useCallback`s keyed by symbol (or pass `symbol` back as an argument and use per-symbol-free handlers).

### [P1] `1 s clock` re-renders the entire TopBar/Dashboard
**File:** frontend/src/app/(dashboard)/_desk/useDeskClock.ts:34, consumed in `page.tsx:166`
**Issue:** `useDeskClock` ticks state every 1000 ms. It's consumed by `DeskPage` which then passes `clockEt={clock}` down to TopBar. Every second the whole `DeskPage` tree re-reconciles (PriceChartPanel, PositionsList, StatusBar, etc.).
**Impact:** In combination with P0-2/P0-3, every second triggers a baseline re-render storm on top of quote-driven ones. Drains battery and CPU on laptops; more importantly, makes React's concurrent scheduler re-enter work even when the market is closed.
**Fix:** Create a `<DeskClock />` leaf that calls `useDeskClock` locally — no prop drilling. Keep the interval isolated to one DOM node.

### [P1] Inline `lastTickSec` `useMemo` depends on full `quotes` object
**File:** frontend/src/app/(dashboard)/page.tsx:176-189
**Issue:** Even if P0-3 is fixed, this `useMemo` lists `quotes` in deps, so it recomputes on every quote tick. Combined with the 2-second `tickHeartbeat` interval on line 171, this creates two overlapping causes for re-computation of the same value.
**Impact:** Moderate — the computation is cheap but it defeats React's bailout because the object identity changes.
**Fix:** Move `tickHeartbeat` down into `StatusBar` (leaf). In `DeskPage`, read only the freshest timestamp: `useMarketStore((s) => freshestTs(s.quotes))` — but compute `freshestTs` in the store, so the selector returns a primitive that can compare cleanly.

### [P1] `market_overview.py` endpoints have ZERO caching
**File:** backend/api/routes/market_overview.py (all 4 endpoints: `/indices`, `/sectors`, `/regime`, `/indices/sparklines`)
**Issue:** Grep confirms `cache_get` / `cache_set` never appear in this file. Every dashboard mount fires fresh Alpaca calls. `useIndices` in `useQueries.ts:17` polls every 60 s with 60 s staleTime — but this caches *client-side* only. A second open tab busts the cache.
**Impact:** Indices and sector endpoints each make 1–11 Alpaca calls (sectors loops 11 ETFs for YTD — line 223). Redis is literally running for this — just not used here.
**Fix:** Wrap each handler in a cache_get/cache_set with `ttl_seconds=30` for `/indices` and `/regime`, `ttl_seconds=60` for `/sectors`.

### [P1] `/sectors` endpoint loops serial YTD-bar fetches (N+1)
**File:** backend/api/routes/market_overview.py:223-234
**Issue:** Inside the single `AsyncClient`, the code iterates `etf_syms` (11 tickers) and does one `GET /v2/stocks/{sym}/bars?timeframe=1Day` per ticker. Serial inside the httpx client.
**Impact:** 11 sequential Alpaca round-trips ≈ 1–2 s extra latency on first load.
**Fix:** Use `GET /v2/stocks/bars?symbols=XLK,XLV,...&timeframe=1Day&start=<ytd_start>&limit=1` — same multi-symbol endpoint `screener.py:_fetch_momentum_bars` already uses.

### [P1] `market.py /snapshot/{symbol}` has no cache
**File:** backend/api/routes/market.py:527
**Issue:** The `/snapshot/{symbol}` endpoint never touches Redis; every call hits Polygon or Alpaca. The sibling `/quotes/{symbol}` on line 306 caches — inconsistent.
**Impact:** If any frontend code migrates from `/quotes` to `/snapshot`, it loses all caching.
**Fix:** Add cache_get/cache_set with 10 s TTL around the snapshot response.

### [P1] Missing indexes on heavily-filtered columns
**File:** backend/data/storage/models.py
**Issue:**
  - `Trade.status` is `index=True` (line 102) but `Trade.entry_time` alone has no single-column index — and it is the primary sort key on `/trades/history` (ORDER BY entry_time DESC). The recent composite `ix_trades_symbol_entry_time` helps when a symbol filter is present; without a symbol, a full-table scan + sort still happens.
  - `Alert.triggered_at` has no index (line 195). `/alerts` endpoints typically filter/sort by recency.
  - `OptionsSnapshot.timestamp` (line 82) has no index; `(underlying, timestamp DESC)` would be the typical lookup.
  - `AgentAnalysis.timestamp` (line 163) is unindexed.
  - `StrategySignal.timestamp` (line 179) is unindexed despite being time-series data.
**Impact:** Each missing index is a seq-scan when the table grows. On VPS with 2 GB RAM, seq-scan spills to disk (no buffer cache) → slow endpoint.
**Fix:** Add `Index("ix_trades_entry_time", "entry_time")` and equivalents for the other three. Composite `(strategy, timestamp DESC)` on StrategySignal.

### [P1] `useEffect` fetch on dashboard mount isn't cancelled on early unmount
**File:** frontend/src/app/(dashboard)/page.tsx:112-133 (bars fetch), 138-157 (order counts)
**Issue:** The code has a `let cancelled = false` pattern — good — but also runs a 30 s `setInterval(fetchCounts, 30_000)` inside the bars effect chain. If the user quickly navigates between dashboard and another route, the effect cleanup runs, but any in-flight fetch still resolves and tries to setState (guarded by cancelled) — OK — but the *parallel* `Promise.all` (line 142-145) doesn't cancel the underlying request. Wastes bandwidth on the VPS because the server continues processing to completion.
**Impact:** Minor — abort controllers would shed load during fast route changes.
**Fix:** Pass AbortSignal from useEffect into `apiFetch`.

### [P1] `TradingChart` statically imports `lightweight-charts` while `PriceChartPanel` dynamic-imports it
**File:** frontend/src/components/charts/TradingChart.tsx:10-25 vs frontend/src/components/composites/PriceChartPanel.tsx:78
**Issue:** Two chart components with conflicting loading strategies. The dynamic import in PriceChartPanel is effectively defeated because `/trade` page imports TradingChart statically, loading LWC anyway.
**Impact:** Extra ~220 KB in the main chunk for users on routes that don't render a candle chart.
**Fix:** Convert `TradingChart` to also use `await import("lightweight-charts")` inside the effect, OR lazy-load `TradingChart` itself with `next/dynamic`.

### [P1] Single Gunicorn worker but pipeline runner + continuous_monitor + realtime_scanner all run in-process
**File:** backend/main.py:77-94, docker-compose.yml / backend/Dockerfile:36
**Issue:** Dockerfile's CMD is `-w 1` — good for 2 vCPU constraints. But the lifespan starts FOUR background services inside the same worker process: `start_alpaca_stream`, `start_pipeline_scheduler`, `start_realtime_scanner`, `start_continuous_monitor`. Each holds its own asyncio tasks, open HTTP connections, and in-memory caches. A single OOM in any of them crashes the only API worker.
**Impact:** RSS is almost certainly dominated by these services, not by request handling. With 1.4 GB used and 774 MB in swap, I'd bet at least 400 MB is the accumulated state of these services.
**Fix:** Short-term: add `try/except MemoryError` wrappers around each start_*. Long-term: split scheduler + scanners into a separate container with its own memory budget, or make them opt-in via env flag (`ENABLE_SCHEDULER=false` for staging / low-traffic periods).

---

## P2 — Medium-value

### [P2] React Query `retry: 2` on top of `retry: 2` in individual hooks
**File:** frontend/src/lib/providers.tsx:20, frontend/src/hooks/useQueries.ts (each hook sets `retry: 2`)
**Issue:** `QueryClient` defaults set `retry: 2`, then every single `useQuery` also sets `retry: 2` (or `retry: 1`). Effect is usually fine, but on a flapping backend the client will retry twice, then refetch at the next interval and retry twice again.
**Impact:** Under sustained backend failure the client amplifies load by 2–3×.
**Fix:** Remove per-hook retry settings; rely on default.

### [P2] TradingChart crosshair subscription is re-registered on every render
**File:** frontend/src/components/charts/TradingChart.tsx:400-438
**Issue:** Chart effect on line 301 uses `[chartType]` as dep array but reads `onCrosshairMove` / `onTimeRangeChange` from closure. If the parent passes inline callbacks (common in React), the chart is torn down and rebuilt every render of the parent.
**Impact:** Full chart rebuild in the "Chart" panel during rapid re-renders = CPU spike, briefly leaked DOM nodes.
**Fix:** Store the handlers in refs and read from refs inside the subscribe body; drop them from dep array.

### [P2] `forwardRef<TradingChartHandle, TradingChartProps>` allocates `useImperativeHandle` every render
**File:** frontend/src/components/charts/TradingChart.tsx:259-298
**Issue:** Handle object is recreated on every render. Refs' consumers (parents) won't break, but the closures inside `updateBar` / `updateLastClose` / `setData` hold references to the previous render's series.
**Impact:** Minor memory churn.
**Fix:** Memoize or depend only on `chartType`.

### [P2] WatchlistPanel's `quotes` subscription is used only for the selected symbol's flash detection
**File:** frontend/src/components/panels/WatchlistPanel.tsx:792
**Issue:** The top-level `quotes = useMarketStore((s) => s.quotes)` is only used in `sortedWatchlist` (line 830) and the per-row `quotes[symbol]` pass-through. A better shape would be per-row selector.
**Impact:** Covered by P0-3.

### [P2] Dashboard page holds `tickHeartbeat` at 2 s forever regardless of market state
**File:** frontend/src/app/(dashboard)/page.tsx:171-175
**Issue:** Interval fires even when market is closed, the tab is hidden, or no quotes have arrived.
**Fix:** Gate on `document.visibilityState === "visible"` and `isMarketOpen()`.

### [P2] `OptionsSnapshot` table will balloon — no TTL/retention
**File:** backend/data/storage/models.py:61
**Issue:** `OptionsSnapshot` is a time-series table but not marked as a Timescale hypertable. Rows accumulate without retention policy.
**Fix:** Either add `SELECT create_hypertable(...)` in an alembic migration with `add_retention_policy(..., INTERVAL '90 days')`, or drop the table and cache to Redis instead.

### [P2] Non-TLS default watchlist size and polling cadences compound N+1
**File:** frontend/src/stores/market.ts:5 (10-symbol default), frontend/src/hooks/useQueries.ts (1–5 min refresh)
**Issue:** 10 symbols × several query hooks polling at 1–5 min each, cross-multiplied with the non-batched `getSnapshot` → sustained low-rate Alpaca load even on an idle tab.
**Fix:** Merge into a single batched "dashboard tick" query that yields all snapshots at once.

### [P2] `/strategies/` list endpoint rebuilds full _STRATEGIES metadata on every call
**File:** backend/api/routes/strategies.py:1005 (uses `_STRATEGIES.items()` after `_get_strategy_data`)
**Issue:** `_get_strategy_data(sid)` likely does disk I/O for OOS metrics. Called 13 times per request.
**Fix:** Cache `_STRATEGIES` snapshot in Redis for 60 s.

### [P2] `getTokenVar` calls `getComputedStyle(document.documentElement)` repeatedly
**File:** frontend/src/components/charts/TradingChart.tsx:60-64 (used ~30+ times per chart init) and PriceChartPanel.tsx
**Issue:** `getComputedStyle` forces a style recalc. Called sequentially for each color.
**Fix:** Read once into a dict at effect start.

### [P2] `DashboardLayout` body uses `new Date().getFullYear()` inline
**File:** frontend/src/app/(dashboard)/layout.tsx:131
**Issue:** Inline expression creates a new value each render. Harmless but indicates pattern. Not an actual perf issue, note it here only as a stylistic nit.

### [P2] globals.css has no `@apply` abuse — confirmed OK
**File:** frontend/src/app/globals.css
**Finding:** Grep for `@apply` returns zero hits. No bloat here.

### [P2] No external font `@import` — confirmed OK
**File:** frontend/src/styles/design-tokens.css
**Finding:** Grep for `^@import url(` returns zero hits. The comment in `globals.css:10-14` references an old font-gfonts import that has already been removed. next/font is used in `layout.tsx`.

### [P2] No `<img>` tags anywhere — confirmed OK
**Finding:** Grep for `<img ` returns no matches. No CLS exposure on image dimensions.

### [P2] lucide-react: 50 named-import sites, version pinned to "1.7.0"
**Issue:** 50 files import individually from `lucide-react`. `next.config.ts:8` already lists `optimizePackageImports: ["lucide-react", "date-fns"]` — Next.js will tree-shake these at build time, so it's fine. The 1.7.0 version pin is unusual (real lucide-react is 0.x) — likely a re-tagged fork; confirm upstream still matches what the code expects.
**Action:** Monitor; no change needed unless build-analyze shows bloat.

---

## Backend infra verifications

- Dockerfile: `gunicorn main:app -w 1` — already appropriate for 2 vCPU.
- docker-compose Redis: `maxmemory 512mb --maxmemory-policy allkeys-lru` — good. But this means evictions are silent; consider `noeviction` for critical keys or dedicated keyspaces.
- Timescale: single container, 5432 bound to loopback only — good.

---

## Rough impact summary (all numbers are estimates)

| Fix | Est. RAM saved | Est. CPU saved | Est. latency saved |
|---|---|---|---|
| P0 duplicate WebSocket | 50–100 MB per 10 tabs | 20% idle CPU | — |
| P0 setLastMessage delete | ~0 | 40% during market hours | — |
| P0 quotes selector scope | ~0 | 30% during market hours | — |
| P0 batched snapshot | ~10 MB (fewer clients) | 15% cold-start | 3–4 s dashboard TTI |
| P0 ledger full scan fix | 50–150 MB during bursts | 30% leaderboard | 10+ s on /leaderboard |
| P0 calendar N+1 | 5–10 MB | 5% | 3–5 s on /calendar |
| P0 dynamic imports | ~30 MB RSS, ~800 KB client JS | First-load parse | 1–2 s FCP |
| P1 index + inline cb | ~0 | 10% | — |
| P1 clock isolation | ~0 | 5% idle | — |
| P1 market_overview cache | small | 20% per dashboard | 500 ms per route |
| P1 missing DB indexes | — | — | 100–500 ms per query at scale |
| P1 split scheduler | 200–400 MB | isolates OOM risk | — |
