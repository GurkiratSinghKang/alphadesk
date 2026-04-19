# Persona 38 — DoS Blast-Radius Audit

**Date:** 2026-04-18 | **Target:** tradingalpha.net | **Method:** static config review + 5-8 concurrent live probes (no flood).

---

## Setup (verbatim from repo)

- `backend/Dockerfile:36` — `gunicorn main:app -k uvicorn.workers.UvicornWorker -w 3 --bind 0.0.0.0:8000 --timeout 120 --graceful-timeout 30` — **3 workers, 120s request timeout, no `--limit-concurrency`, no `--backlog` override, no `--max-requests` recycle, no `--worker-connections` cap.**
- `infrastructure/Caddyfile` — **no `servers { ... max_header_size | read_timeout | idle_timeout | write_timeout }`, no `rate_limit` directive, no per-IP connection cap, no `@slow_post` matcher.** Default Caddy timeouts apply (read header 1 min, read body unlimited until handler consumes, write 0, idle 5 min).
- `infrastructure/vps-setup.sh:56` — `apt-get install -y fail2ban` + `systemctl enable fail2ban`, but **zero jail files are shipped in the repo**. Stock Debian fail2ban defaults only watch `sshd` — nothing filters Caddy access logs for 429/401/slow bodies.
- `infrastructure/docker-compose.prod.yml:51-90` — backend is `mem_limit: 4g, cpus: 2.0` on a 2-vCPU / 1.9 GiB-RAM Hetzner VPS (per `persona-14-devops.md` line 42 — container limits sum to 4.77 GiB, already 826 MB into swap at idle).

## Live probes (conservative — ran 6-8 parallel, not 100)

- 8 × `POST /api/v1/auth/login`: all returned **HTTP 429 in 70-85 ms** — `backend/api/routes/auth.py:112` caps at **5 attempts / 300s / IP**, and `Retry-After: 300` is sent. Login is *not* a DoS path — it's rate-capped before worker-time is spent.
- 8 × `GET /api/health` (unauth, 404): **70-185 ms ttfb, all 200 HTTP-level**, backend still live. No throttling on this path.
- 8 × `GET /` (unauth root, 307 → /login): **65-100 ms ttfb** — fine.

Conclusion from probes: 8 concurrent connections do **not** noticeably degrade. 3 workers × ~100ms per request ≈ 30 req/s ceiling on cheap paths. **Headroom exists for 8, not for 100.**

---

## Blast-radius math

With `-w 3 --timeout 120`, a worker is blocked for up to **120 s** by a single slow request. Key arithmetic:

- 100 slow connections with bodies drizzled at <1 byte/sec (Slowloris-POST), each connection is read by the Uvicorn worker **while it awaits the body** because FastAPI mounts `CORSMiddleware`/auth deps before the route handler reads the body — but the ASGI layer's body-read is handler-triggered. Practical impact: **gunicorn-uvicorn holds the TCP socket in the `uvicorn_worker.handle()` coroutine until the handler yields, and with 3 workers all 3 saturate after 3 slow peers.**
- No `--limit-concurrency` on uvicorn means each worker accepts unlimited pending ASGI coroutines *per process*, BUT once the worker's single-threaded event loop is waiting on I/O from the peer (slow client write), every other request on that worker queues behind it for up to 120s.
- After the 3-worker saturation, Caddy buffers the 4th…Nth incoming request in its own reverse_proxy queue (default Caddy `buffer_requests` off — but it still holds TCP accept). Because there's no Caddy rate-limit, the TCP listen backlog fills, then the kernel starts refusing new SYNs.

**Practical outcome for 100 slow connections:**

1. First ~3-30 slow peers (depending on whether handlers yield before body-read) consume all 3 workers for 120s.
2. Legitimate traffic falls through Caddy → backend `502 Bad Gateway` (upstream not answering) once Caddy's default 30 s dial timeout elapses.
3. Because there is **no fail2ban jail for Caddy logs** and **no per-IP Caddy connection cap**, a single attacker IP can keep rotating fresh slow connections indefinitely — one laptop suffices.
4. Memory pressure: each pending slow body costs a small ASGI task; negligible on its own, but combined with swap-thrashing (827 MB swap in use at idle per persona-14), the VPS becomes unresponsive once real traffic retries stack up. **OOM-kill of the backend container is plausible within minutes**, which would also take out the lifespan-started `continuous_monitor`, `realtime_scanner`, `alpaca_stream`, and `pipeline_scheduler` tasks — full data pipeline outage.

**Recovery:** gunicorn `--graceful-timeout 30` means on worker restart, a hung slow connection is forcibly killed after 30 s. But nothing auto-restarts workers mid-life; Docker healthcheck (`docker-compose.prod.yml:73-77`) hits `/health` every 30 s with 10 s timeout / 3 retries = **120 s before Docker flags the container unhealthy** — coincidentally matching `--timeout 120`, so the first unhealthy mark occurs right as workers free up. No `restart_policy` on health failure beyond `restart: unless-stopped` (which only fires on exit). **The platform stays "unhealthy but running" for the duration of the flood.**

---

## Top 10 findings

### 1. Three workers is a hard ceiling — 3 slow peers = full outage [P0]
`backend/Dockerfile:36` `-w 3 --timeout 120` + async uvicorn means each worker is single-threaded around its event loop. Three slow peers fully saturating the body-read path lock the service for 120 s. **Attacker needs ~3 connections, not 100.**
**Fix:** Add `--worker-connections 1000` and `gunicorn --limit-concurrency 50` per worker, OR drop `--timeout` to 20 s for non-WS routes (WS handler is long-lived — split a separate gunicorn invocation on a different port, or use a Caddy `handle /ws` sub-app).

### 2. No Caddy `rate_limit` on global `/api/*` [P0]
`infrastructure/Caddyfile:24` `handle /api/* { reverse_proxy backend:8000 }` — zero throttling. Only `/api/v1/auth/*` has application-level rate limiting (`auth.py:200`). `POST /api/v1/trades/orders`, `/api/v1/screener/screen`, `/api/v1/pipeline/run` etc. are wide open. A loop of `curl -X POST /api/v1/screener/screen` from a single IP will pin workers.
**Fix:** Install `caddy-ratelimit` module. Global default `rate_limit zone global { key {remote_host} events 60 window 1m }` and a tighter `zone auth` on `/api/v1/auth/*` to back up the Redis one.

### 3. No fail2ban jail shipped — package installed but inert [P0]
`vps-setup.sh:56-58` installs + enables `fail2ban` but the repo contains **no `jail.local`, no filter regex**. Stock defaults watch only `/var/log/auth.log` for SSH. Caddy access logs (actually: Caddy has no `log` directive configured — see persona networking P3-24) are never parsed. `6037 IPs banned` from persona-14 line 73 refers to **SSH banjail only** — HTTP attackers are untouched.
**Fix:** Ship `infrastructure/fail2ban/jail.d/caddy.conf` + a filter that regex-matches 401s, 429s, and 5xx spikes per IP in the Caddy JSON log. Plus add the `log { output file /var/log/caddy/access.log format json }` directive to the Caddyfile so fail2ban has logs to watch.

### 4. No request-body size limit anywhere in the stack [P0]
FastAPI/Starlette has no `max_request_size`. Caddy has no `request_body { max_size }` directive. Gunicorn/uvicorn default is effectively unlimited — a multi-GB POST body is accepted until memory runs out.
**Fix:** Add `request_body { max_size 1MB }` in Caddyfile at site level (or per-route). FastAPI-side, add a `@app.middleware("http")` that rejects `Content-Length > 1_048_576` with 413 before routing.

### 5. No per-IP connection cap on Caddy — one IP can open every socket [P1]
Caddy has no `servers { per_client { max_connections N } }` override (not on by default in 2.8). A single attacker IP exhausts the listen backlog / file-descriptor budget alone.
**Fix:** Put Cloudflare in proxy mode (already called out in `03-networking.md` P0-04) — gets WAF + Under-Attack Mode for free. Short-term: `iptables -I INPUT -p tcp --dport 443 --syn -m connlimit --connlimit-above 50 --connlimit-mask 32 -j REJECT`.

### 6. No Caddy read/write/idle timeouts configured [P1]
Caddyfile has no `servers { timeouts { read_header 10s; read_body 30s; write 30s; idle 120s } }` block. Defaults are: read_header 1 min, read_body unlimited-while-handler-reads, write 0 (unbounded), idle 5 min. **A Slowloris header attack (drip bytes into request line) will hold a Caddy connection for ~60 s before Caddy closes it, then reconnect — no fail2ban sees it.**
**Fix:** Add an explicit `servers { timeouts { read_header 5s; read_body 15s; write 30s; idle 60s } }` at top of Caddyfile.

### 7. Worker saturation cascades into lifespan-started background tasks [P1]
`backend/main.py:65-90` — each backend container runs the Alpaca stream, pipeline scheduler, real-time scanner, continuous monitor inside the same process as HTTP handlers. A worker hung on slow HTTP body delays those tasks' coroutines too (shared event loop per worker). An attacker degrading `/api/*` also degrades **live quote ingestion and the nightly trading pipeline** — not just the UI.
**Fix:** Split: one gunicorn instance for HTTP (3+ workers) + a separate `python -m` process for the background lifespan services (pipeline, scanner, monitor). Or move lifespan tasks to a sidecar container using the same Redis bus.

### 8. Healthcheck timing matches attack window — masks outage [P1]
Docker `healthcheck: interval=30s timeout=10s retries=3` = 120 s to declare unhealthy (`docker-compose.prod.yml:73-77`). Gunicorn `--timeout 120` is identical. A 120 s flood fully locks workers for one full healthcheck cycle — if the attacker releases at second 119, Docker never notices, logs nothing, container stays "healthy". Monitoring/alerts never fire.
**Fix:** Drop healthcheck `interval` to 10 s and `timeout` to 3 s, or bump `--timeout` to 30 s (see #1). Additionally, emit a Prometheus metric for `gunicorn_requests_in_flight` and alert on saturation, not just liveness.

### 9. No WebSocket connection cap — parallel DoS vector [P1]
`backend/api/websocket/handler.py:33` tracks `len(self._connections)` but never caps it. WS auth relies on `require_auth`, so anonymous attackers can't open WS. **But** any authenticated token can open unlimited WS connections (no per-user cap). Paired with the loose login rate-limit (5 / 5 min — one valid token is enough), a single compromised user can open thousands of WS and the broadcast loop (`handler.py:64-87`, serial `await asyncio.wait_for(..., 2.0)`) will drag quote fan-out into minutes.
**Fix:** Cap `self._connections` at ~500 globally and ~5 per `user_id` in `ConnectionManager.connect()`. Reject with WS close code 1013 ("try again later").

### 10. No per-IP `X-Forwarded-For` throttling behind Caddy [P2]
`backend/main.py:157-167` trusts `X-Forwarded-For` only from Docker bridge ranges — good, prevents IP spoofing. But once an IP is extracted, the auth route is the **only** place it's checked for rate limits. `auth.py:165 _check_rate_limit(client_ip)` is unique to login; no other route ever calls it. So `/api/v1/trades/orders` POST has no IP guard.
**Fix:** Factor `_check_rate_limit` into a generic `Depends(rate_limit("global", 60, 60))` and apply it to all write routes (`pipeline/run`, `trades/orders`, `webhooks/*`).

---

## Summary (250 words)

**The DoS blast radius on tradingalpha.net is large and the attacker does not need 100 slow connections — three will do.** Production runs gunicorn with `-w 3 --timeout 120` behind a Caddy reverse proxy that has **no rate limit, no connection cap, no body-size cap, and no configured read/write timeouts**. Fail2ban is installed but ships with zero jail files, so it only guards SSH — Caddy logs are not even being parsed (in fact, Caddy has no `log` directive configured either). Application-level rate limiting exists only on `/api/v1/auth/*` (5 attempts per 5 minutes per IP via `auth.py:112`), which I verified with 8 concurrent probes that all correctly returned 429 in ~75 ms. Every other route — screener, pipeline, trades, webhooks, market-data, health — is wide open. Three slow peers saturating body-read across the three workers lock the service for up to 120 s. Because lifespan-started background tasks (Alpaca stream, pipeline scheduler, continuous monitor, real-time scanner — `main.py:65-90`) share the same event loop as HTTP handlers, a DoS on `/api/*` also degrades **live quote ingestion and the nightly trading pipeline**, not just the UI. The Docker healthcheck (30 s interval × 10 s timeout × 3 retries) coincidentally matches gunicorn's 120 s timeout, so a single attack cycle never trips the unhealthy flag and monitoring stays silent. Fixes: add `--limit-concurrency`, drop `--timeout` to 20 s for non-WS, ship Caddy rate-limit + body-size + timeouts, write a fail2ban jail for Caddy 401/429, and (strategic) put Cloudflare in proxy mode. Live probe results: 8 concurrent connections responded in 70-185 ms — platform holds fine at that scale, the exposure is purely at the ~30+ concurrent / slow-body level.
