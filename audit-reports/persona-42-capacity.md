# Persona 42 — Capacity Planner: What Breaks at 10× Traffic?

**Date:** 2026-04-18
**Branch:** feature/deployment, HEAD 5f57ada
**Method:** Read of `backend/Dockerfile`, `infrastructure/Caddyfile`, `infrastructure/docker-compose.prod.yml`, `backend/main.py`, `backend/core/database.py`, `backend/core/redis.py`, `backend/data/providers/alpaca.py`, `backend/data/providers/_polygon_http.py`, `backend/api/websocket/handler.py`, `backend/data/ingestion/alpaca_stream.py`, `backend/api/routes/auth.py`, `backend/api/routes/news.py`.
**Baseline host:** 2 vCPU / 2 GB Hetzner CX22 (confirmed in `audit-reports/perf-audit-r3.md:3`). Backend `mem_limit: 4g` is larger than the host — a red flag on its own.

Findings are ranked by what breaks first as steady-state traffic grows 10×.

---

## [1] Gunicorn worker count is the first thing to saturate (CPU / concurrency)

**File:** `backend/Dockerfile:36` — `gunicorn -w 3 -k uvicorn.workers.UvicornWorker --timeout 120`.
**Issue:** 3 UvicornWorkers on 2 vCPU is already above the textbook `(2*CPU)+1 = 5` rule for sync workers but *below* what async workers can sustain. At 10× traffic, the `--timeout 120` setting is the silent killer: one slow endpoint (e.g. `/api/v1/strategies/leaderboard`, noted in perf-audit-r3 as 5–15 s full-table scans) stalls a worker for 120 s before gunicorn recycles it. Three stuck workers = total backend outage until timeout. No `--max-requests` / `--max-requests-jitter` means workers never recycle, so `pandas`/`numpy` allocations accumulate in RSS.
**Scale first:** Add `--max-requests 1000 --max-requests-jitter 100` immediately. Bump to `-w 5` only after vertical scale (see #2). Drop `--timeout` to 30 s once the N+1 and leaderboard scans in perf-audit-r3 are fixed.

## [2] Host RAM is the binding constraint, not CPU

**File:** `infrastructure/docker-compose.prod.yml:48-146`.
**Issue:** Declared limits: backend 4 g + frontend 1 g + postgres 3 g + redis 1.2 g + caddy 0.25 g = **9.45 GB**, on a 2 GB host. `perf-audit-r3.md:3` reports 1.4 GB used + 95 MB free + 774 MB swap already. At 10× traffic the pages get thrashed out of swap and the oom-killer picks the biggest process (backend) and restarts it mid-request.
**Scale first:** Move to CX32 (4 vCPU / 8 GB) or CPX31 (4 vCPU / 8 GB AMD) — this is the single highest-ROI action. Every other finding on this list becomes cheaper once RAM isn't swapping.

## [3] Postgres `max_connections=100` overflows SQLAlchemy pool — and vice versa

**File:** `backend/core/database.py:48-49` — `pool_size=5, max_overflow=5` (i.e. 10 per worker × 3 workers = 30). `infrastructure/docker-compose.prod.yml:106` — `max_connections=100`.
**Issue:** Headroom looks fine now. At 10× traffic with `-w 5` and Celery workers (declared in `requirements.txt:29`) plus the TradeLedger sync psycopg2 pool, you will cross 100. Postgres then refuses new connections and gunicorn workers raise `QueuePool limit ... overflow -1`. `shared_buffers=1GB` on a 2 GB host also cannibalizes RAM that gunicorn needs (see #2).
**Scale first:** Raise `max_connections=200`, lower `shared_buffers` to 512 MB until host RAM grows, add PgBouncer in `transaction` mode — it's the single change that lets the app scale horizontally later without touching Postgres config.

## [4] Redis `maxmemory 1gb` with `allkeys-lru` silently evicts sessions and rate-limit keys

**File:** `infrastructure/docker-compose.prod.yml:126`.
**Issue:** Redis holds three unrelated concerns in the same keyspace: the async pool (`core/redis.py:22` `max_connections=50` — tight for `-w 5`), the provider cache (`data/providers/cache.py`), *and* rate-limit cooldowns (`api/routes/auth.py:112-113`, `api/routes/news.py:28-29`). `allkeys-lru` means that under memory pressure the newsdata.io cooldown key gets evicted → we hammer the provider → 429s cascade back to users. At 10× traffic the provider cache churn alone will exceed 1 GB.
**Scale first:** Split into two Redis DBs or raise `maxmemory` to 2 g (after #2); switch eviction for rate-limit keys to `noeviction` via a dedicated DB, or use `volatile-lru` so only TTL'd keys are candidates.

## [5] Alpaca market-data is NOT the bottleneck; Polygon 5-calls-per-minute IS

**File:** `backend/data/providers/alpaca.py:9` (`Algo Trader Plus: 10000 requests/min`) vs. `backend/data/providers/_polygon_http.py:31-35` (`max_connections=20, MAX_RETRIES=5, BACKOFF_BASE=0.75 s`).
**Issue:** Alpaca at 10000 req/min is ~167 RPS — far more than a 2 vCPU box will generate. Polygon's free tier is **5 calls/min**. Even the $29 Starter plan is 100 calls/min. The `_polygon_http.py` client has no token-bucket limiter — it relies on 429-then-backoff. At 10× traffic `backend/api/routes/options.py`, `earnings_vol/polygon_helpers.py`, and `regime_adaptive/strategy.py` will all blow the budget, and the 0.75 s×2ⁿ backoff with 5 retries = ~23 s per stuck call. That exhausts gunicorn workers (#1) before Alpaca ever notices.
**Scale first:** (a) Confirm Polygon plan (find `POLYGON_API_KEY` tier in dashboard). (b) Add a Redis-backed token bucket to `_polygon_http.PolygonHTTP.get` — the `news.py` cooldown pattern on lines 96-101 is the template. (c) Move Polygon calls behind Celery tasks so they run in the background worker pool, not the request path.

## [6] Alpaca WebSocket `MAX_SYMBOLS=200` is a hard provider cap on watchlists

**File:** `backend/data/ingestion/alpaca_stream.py:50`.
**Issue:** Alpaca's streaming API accepts at most 30 symbols on the free feed, ~200 on paid tiers per connection. The file hard-codes `MAX_SYMBOLS = 200`. At 10× users (say 500 concurrent dashboards), each contributing 10 watchlist symbols, you hit ~5000 distinct symbols — truncated to 200. Users past the cap get no real-time updates and no error. Also: only one process holds the socket (`_stream_task` module-level in `alpaca_stream.py:31`), so all 5 gunicorn workers share ONE connection; the other 4 workers publish no quotes.
**Scale first:** Move the streamer out of the gunicorn process into a dedicated sidecar container. Multiplex multiple Alpaca WS connections keyed by 200-symbol shards. Ack cap violations to the caller instead of silently dropping.

## [7] WebSocket fanout is O(clients) inside a per-message lock

**File:** `backend/api/websocket/handler.py:64-80`.
**Issue:** `ConnectionManager.broadcast` takes `self._lock`, builds `targets`, then `await`s a `self._send(ws, ...)` with a 2-second timeout *per client, serially*. With perf-audit-r3 P0 #1 confirming 2 sockets per browser tab, at 10× traffic = ~1000 sockets. One slow client with a 2 s timeout blocks the next. During a quote storm (5-20 Hz per symbol × 200 symbols = up to 4000 Hz published to Redis) the broadcaster cannot keep up and backpressures the Redis listener.
**Scale first:** Switch to `asyncio.gather(*[...])` for parallel fanout, drop slow clients on first timeout (don't re-queue), and cap per-client send queue depth.

## [8] No global rate limiting at Caddy or FastAPI — one bot DoSes the host

**File:** `infrastructure/Caddyfile:1-41` (no `rate_limit` directive), `backend/main.py` (no SlowAPI / limiter middleware), only `api/routes/auth.py:112` and `api/routes/news.py:29` have scoped limits.
**Issue:** The auth-route limiter (5 attempts/5 min) protects login only. Every other route — `/api/v1/market/*`, `/api/v1/strategies/*`, `/api/v1/options/*` — is unthrottled. At 10× legitimate traffic a single scraper hitting `/api/v1/symbols/search` sustains 100 RPS and walks over everyone. `X-Forwarded-For` trust is already locked down in `main.py:157-167`, so per-IP limits would actually work.
**Scale first:** Add Caddy `rate_limit` module or a SlowAPI middleware with a global 30 RPS/IP default and looser per-route overrides. Do this *before* scaling up — it's the first thing that keeps capacity increases from being eaten by bots.

## [9] Caddy `mem_limit: 256m` and `cpus: 0.25` will buckle on TLS handshakes

**File:** `infrastructure/docker-compose.prod.yml:30-31`.
**Issue:** 0.25 CPU is ~250 m of a single vCPU. Caddy handles TLS termination + gzip/zstd compression. At 10× HTTPS sessions, TLS 1.3 handshakes (ECDHE) will saturate that quota and queue. 250 MB RAM is also tight if many WebSockets upgrade simultaneously — each connection holds buffers.
**Scale first:** Bump to `cpus: 1.0` and `mem_limit: 512m`. Caddy is cheap to over-provision and expensive to bottleneck.

## [10] Backend has ONE container — no horizontal scale path

**File:** `infrastructure/docker-compose.prod.yml:51-90`.
**Issue:** There's a single `backend` service; no `deploy.replicas`, no load-balancer in Caddy (`reverse_proxy backend:8000` names a single hostname). Vertical scaling to CX32 buys ~3× headroom. Past that, the app must become replica-able. Blockers to replication today: (a) `_stream_task` singleton in `alpaca_stream.py:31` is per-process state, (b) `_INMEM_ATTEMPTS` fallback in `auth.py` is per-process, (c) `_listener_task` WebSocket forwarder in `websocket/handler.py:15` assumes one process per Redis channel.
**Scale first:** Carve the Alpaca streamer and the WebSocket fan-out into a separate "realtime" service; then the `backend` service becomes stateless and Caddy can `reverse_proxy backend_1:8000 backend_2:8000 ...`. This is the foundation for actual 10× scale — everything above (#1–#9) only buys one vertical step.

---

## Summary (250 words)

At 10× today's traffic, the system fails in this order, from fastest to slowest:

1. **RAM thrash on the 2 GB host** (perf-audit-r3 baseline: 95 MB free, 774 MB swap already). Container memory limits sum to 9.45 GB — the oom-killer restarts backend mid-request.
2. **Gunicorn workers stall** on the 120 s timeout because slow endpoints (leaderboard full-scans in perf-audit-r3) consume all 3 workers. No `--max-requests` means they never recycle.
3. **Polygon rate limit — not Alpaca**. Alpaca's 10000 req/min is effectively unbounded for this VPS. Polygon's free tier at 5 calls/min, with no token-bucket limiter in `_polygon_http.py`, means strategies that fetch options or VIX data (regime_adaptive, earnings_vol, options routes) drive 429 cascades and 23 s retry chains per call. This is the provider-side bottleneck.
4. **Redis LRU evicts rate-limit cooldowns**, causing provider 429 storms to feed back on themselves.
5. **Postgres connection ceiling** (100) is crossed once workers scale to 5+ and Celery spins up.
6. **Alpaca WebSocket caps at 200 symbols** — silently truncates above that.

**Scale first, in order:**
(a) CX32 host (4 vCPU / 8 GB) — single biggest multiplier.
(b) Add `--max-requests 1000` and global Caddy/FastAPI rate-limit middleware *before* any other scaling.
(c) Token-bucket Polygon calls in Redis; move them to Celery.
(d) Split the Alpaca streamer into a sidecar so `backend` becomes replica-safe, then horizontal scale behind Caddy's load balancer.

The Polygon free tier — not Alpaca — is the provider-side cliff.
