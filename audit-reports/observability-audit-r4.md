# Observability / Logging / Production-readiness audit — r4

Scope: can oncall debug an outage? Can we trace a trade end-to-end? Are we emitting metrics? Are logs machine-parseable? Are we leaking PII?

Repo: `/Users/GK/Downloads/alphadesk`
Stack: FastAPI + Gunicorn/Uvicorn workers, Next.js 16, Caddy, Postgres/TimescaleDB, Redis, docker-compose.

---

### [P0] No APM, no metrics, no distributed tracing — the product is observability-dark
**File:** `backend/requirements.txt`, `frontend/package.json`, `infrastructure/docker-compose.prod.yml`
**Issue:** Zero Prometheus / OpenTelemetry / StatsD / Sentry / Datadog / New Relic instrumentation in either tree. No `/metrics` endpoint. No Prometheus exporter. No traces. No RED (Rate/Error/Duration) per route, no business KPIs (trades/day, orders placed, orders rejected, strategy runs, pipeline window fires). Outside of what a human can read in `docker compose logs backend`, we have no way to answer "is latency getting worse?" "is the error rate up?" "did strategy X stop running?" The only monitor is a docker-compose healthcheck that curls `/health` every 30s. `uptime-kuma` was removed 2026-04-17 and not replaced (`docker-compose.prod.yml:110`).
**Impact:** Outages are invisible until a user notices. No SLO, no paging, no capacity data. Post-mortems rely entirely on Caddy + Gunicorn access logs in memory since last restart.
**Fix:** Ship `prometheus-client` + `starlette-prometheus` (or `opentelemetry-instrumentation-fastapi`) and expose `/metrics` on an auth-gated port; add `Counter` for `orders_submitted_total{strategy,side,status}`, `strategy_runs_total{window,strategy,result}`, `pipeline_circuit_breaker_total`, `alpaca_stream_reconnect_total`, plus `Histogram` for `http_request_duration_seconds{route,method,status}`. Add a small Grafana-ready dashboard. Add Sentry (or equivalent) for unhandled exceptions in both backend and frontend.

---

### [P0] `/health` endpoint returns liveness, not readiness — hides DB/Redis/Alpaca outages
**File:** `backend/main.py:218-226`
**Issue:**
```python
@app.get("/health")
async def health_check() -> dict:
    if settings.is_production:
        return {"status": "ok"}
    return {"status": "healthy", "environment": settings.ENVIRONMENT.value, "version": app.version}
```
No DB check, no Redis check, no Alpaca-key sanity check. The docker-compose healthcheck (`docker-compose.prod.yml:55`) just hits this endpoint and keeps the container green even if Postgres is down, Redis is down, or the Alpaca stream task crashed. `SKIP_DB_INIT=true` is the prod default (`infrastructure/.env.prod.example:7`), so DB-backed routes quietly return empty data and `/health` still says "ok".
**Impact:** Kubernetes/orchestrator never restarts a broken pod. Oncall has no single endpoint to tell "is the platform working". A user load-testing the app sees empty portfolios; health check says OK.
**Fix:** Split into `/livez` (process alive, no deps; used by Caddy) and `/readyz` (runs `SELECT 1` against Postgres, `PING` against Redis, and asserts `_stream_task` is not done; returns 503 on any failure). Report the same JSON shape in prod and dev — no environment-based behaviour.

---

### [P0] No correlation/request IDs in log messages — traces are impossible
**File:** `backend/main.py:208-214`, all `backend/api/routes/*.py`
**Issue:** A request-ID middleware exists (`main.py:209`) and sets `request.state.request_id`, plus the `X-Request-ID` response header. But no logger call anywhere in the codebase reads `request.state.request_id` — every `logger.info/warning/error` emits a free-text line without the ID. `logger.info("Order submitted: ... (user: %s)", username)` (`trades.py:311`) shows how it's done: user is present, but not request_id, order_id-from-broker, strategy, nor trade_id. So when an order fails, you can't tie the broker response to the originating HTTP request, nor to the frontend click.
**Impact:** End-to-end trace (frontend click → `/api/v1/trades/orders` → Alpaca → DB persist → WebSocket publish) is unreconstructable from logs. Oncall cannot debug "this user's order disappeared".
**Fix:** Add a `ContextVar` for `request_id` set in the middleware, plus a logging `Filter` that injects it into every record. Switch to a log format that includes it: `%(asctime)s | %(levelname)s | %(request_id)s | %(user)s | %(name)s | %(message)s`. Propagate the header outbound on the Alpaca call (as `x-client-request-id`) so the broker side can be correlated too. On the frontend, generate a request ID in `apiFetch` and attach it as `X-Request-ID`; log it with any error toast.

---

### [P0] Logs are free-text, not JSON — unparseable in a log aggregator
**File:** `backend/main.py:32`
**Issue:**
```python
logging.basicConfig(level=_log_level, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s", force=True)
```
Pipe-delimited plaintext. No support for structured fields (strategy, symbol, order_id, user, request_id, latency_ms). Every field is concatenated into `%(message)s`. No `structlog`, no `python-json-logger`, no `structlog-sentry`. When this gets shipped to Loki / CloudWatch / Datadog the only way to filter is regex. `print(...)` calls also remain in production code paths (`backend/data/providers/alpaca.py:283-285` is a `__main__` block — non-issue — but the pipeline logs get written as free text to `data/pipeline_logs/YYYY-MM-DD.json` which nobody scrapes).
**Impact:** Cannot grep `strategy=pairs_trading status=rejected` in Grafana. Dashboards impossible without ad-hoc regex parsers. Noise:signal ratio lousy.
**Fix:** Adopt `python-json-logger` or `structlog`. Every log line emits `{"ts":"...","level":"ERROR","logger":"api.routes.trades","request_id":"...","user":"admin","event":"order_submitted","strategy":"pairs_trading","symbol":"AAPL","side":"buy","qty":100,"price":190.5,"order_id":"..."}`. Then any aggregator can filter.

---

### [P0] `except Exception: pass` — 45+ silent failures, many swallowing exceptions without `exc_info`
**File:** widespread; representative:
- `backend/data/ingestion/alpaca_stream.py:60-61` (price alert check after each tick fails silently)
- `backend/data/ingestion/alpaca_stream.py:235-236` (non-ConnectionError auth errors swallowed)
- `backend/data/ingestion/alpaca_stream.py:258-259` (malformed JSON from Alpaca swallowed per-message)
- `backend/api/websocket/handler.py:131-132`, `139-140` (pubsub unsubscribe errors lost)
- `backend/data/ingestion/continuous_monitor.py:56-57, 70-71, 127-128, 141-142` (news / price / publish failures all eaten)
- `backend/data/ingestion/trade_ledger.py:211-212` (file rename after migration — silent)
- `backend/main.py:101-128` (six shutdown tasks — silent; so if stopping the Alpaca stream hangs we never find out)
- `backend/api/routes/auth.py:275-276` (reading JSON body in logout — eaten)
- `backend/api/routes/market_overview.py:233-234`, `backend/api/routes/risk.py:354-355` (eaten inside hot path)

**Impact:** A class of production bugs that look like data loss: the news alert never fires, the ledger fails to migrate, the auth response is dropped — and nothing in the logs indicates why. Debugging requires adding `logger.exception` ad-hoc and waiting for a reproducer.
**Fix:** Every `except Exception: pass` becomes `except Exception: logger.debug("<specific context>", exc_info=True)` at minimum, and `logger.warning(...)` if the failure is semantically meaningful. In `alpaca_stream.py:60-61` specifically, log the symbol that failed its alert check.

---

### [P0] No frontend error reporting — window errors / unhandled promise rejections vanish
**File:** `frontend/src/app/layout.tsx` (no global handler), `frontend/src/lib/providers.tsx`, `frontend/src/lib/api.ts`
**Issue:** Next.js `error.tsx` boundaries exist per-route (good), but they only fire on errors *during render*. There is:
- no `window.addEventListener("error", ...)` or `"unhandledrejection"` handler reporting to the backend
- no APM script in `<head>` (no Sentry, no Bugsnag, no Rollbar, no Datadog Browser RUM)
- no backend endpoint to accept frontend error reports (`/api/v1/_clientlog` or similar)
- the `console.error` calls in `DashboardError.tsx:49` and `global-error.tsx:27` are visible only in the user's devtools — oncall never sees them
- `useWebSocket.ts:125` silently swallows WS errors: `ws.onerror = () => { /* error handling is done in onclose */ };` — but `onclose` doesn't know *why* it closed

**Impact:** If a user's screen is broken (render exception, 500 on trades POST, WS disconnect loop), we know nothing. The staging QA scripts catch some of this, but there is no telemetry from real users.
**Fix:** Wire Sentry (`@sentry/nextjs`) with the beforeSend stripping of auth cookies/tokens. OR, as a poor-man's alternative, add a top-level `layout.tsx` effect that registers `window.addEventListener("error", ...)` + `"unhandledrejection"` and POSTs the error (message, stack, user-agent, route, request_id if we have it) to `/api/v1/_clientlog`. Backend accepts, logs at WARNING, rate-limits.

---

### [P1] `logger.warning(...)` on routine Alpaca auth state / account-unconfigured — wrong level, will dominate log volume
**File:** `backend/api/routes/portfolio.py:441,1161,1195`, `backend/api/routes/screener.py:412`, `backend/api/routes/market.py:393,523,632,687`, `backend/api/routes/market_overview.py:152,172,175,262,265,352,405`, `backend/api/routes/options.py:674`
**Issue:** Dozens of "Serving DEMO data for X — Alpaca unreachable" and "Alpaca keys not configured" messages logged at WARNING. In production these fire on *every* request to these routes when Alpaca is being flaky — a single user session can emit 50+ WARNINGs in 30s. If `LOG_LEVEL=WARNING` (prod default per `infrastructure/.env.prod.example:6`), these become the entire log.
**Impact:** Critical signals (auth failures, circuit breaker, trade submission errors) get buried. Disk fills faster. Alert rules that trigger on WARNING rate are meaningless.
**Fix:** Demote to `logger.info` with a sampling decorator (log 1-of-N when the same message fires repeatedly). Better: keep a per-process `last_warned_at[route]` so "Alpaca demo fallback" logs once per 5 minutes per route. Better still: emit a Prometheus `Counter` `demo_fallback_total{route,reason}` and stop logging entirely on the hot path.

---

### [P1] WebSocket tick/quote logs and per-client subscribe logged at INFO — will flood at real volume
**File:** `backend/data/ingestion/alpaca_stream.py:156-172, 186-196, 242-245`, `backend/api/websocket/handler.py:40,46,56,87,116`
**Issue:** Every subscription / unsubscription of the Alpaca SIP stream logs at INFO with the full response snippet (`str(sub_resp)[:100]`). On a dynamic watchlist with 200 symbols and periodic refresh this fires 2× per 5-min tick. Every client connect/disconnect at INFO (`handler.py:40`). Every Redis listener connect at INFO (`handler.py:116`). `logger.info("Client subscribed to %s", channel)` at DEBUG level is fine (`handler.py:56` — already DEBUG, good), but connect/disconnect is INFO.
**Impact:** On 50 users with a flaky network, WS reconnects can throttle at dozens/sec. The logs look like `connected`/`disconnected` scrolling forever. Real errors go missing.
**Fix:** Move connect/disconnect to DEBUG. Keep the subscription-change log at INFO but omit the response body (`_update_subscriptions` doesn't need to log the server echo). Replace repeated lifecycle logs with counters (`ws_clients_connected_gauge`, `alpaca_stream_reconnects_total`).

---

### [P1] Sensitive payload logging: Alpaca auth response body is echoed
**File:** `backend/data/ingestion/alpaca_stream.py:219`
**Issue:**
```python
auth_resp = await ws.recv()
logger.info("Alpaca SIP stream auth: %s", str(auth_resp)[:100])
```
The slice to 100 chars covers the current success payload (`[{"T":"success","msg":"authenticated"}]`), but this is brittle: Alpaca can change the message format or include more context. If it ever adds a reconnection token, API-key echo, or request ID, it ends up in our logs. Same pattern at lines 157-158 (`str(unsub_resp)[:100]`) and 169-170 (`str(sub_resp)[:100]`) — the response may echo subscribed symbols (benign) but setting a precedent of "log the whole thing" is dangerous.
**Impact:** Potential future secret leak; a reviewer today has to trust that Alpaca will never return anything sensitive in a subscription ack.
**Fix:** Log only status: `logger.info("Alpaca auth OK")` / `logger.info("Alpaca sub OK: %d symbols added", len(to_add))`. Parse then log — don't echo.

---

### [P1] No access logs with user attribution — can't answer "who did this?"
**File:** `backend/Dockerfile:36`, `backend/main.py`
**Issue:** Gunicorn is configured with `--access-logfile -`, which emits default Apache-style logs to stdout with IP, method, URL, status, user-agent. But it doesn't include the authenticated username, request ID, or tenant. When someone asks "who submitted this order?" the only place the username is logged is `trades.py:311` — and even that doesn't carry the request ID. Other mutating routes (`POST /halt`, `POST /resume`, `POST /alerts`, `DELETE /alerts/*`, `POST /refine-strategy`, `POST /pipeline/run`) do not log a user-attributed audit line.
**Impact:** Regulator-unfriendly. Abuse / insider-threat investigation is basically impossible.
**Fix:** Add middleware that logs every authenticated mutating request in a structured "audit" logger: `{"event":"audit","user":"admin","method":"POST","path":"/api/v1/trades/halt","status":200,"request_id":"...","client_ip":"..."}` at INFO. Separate logger name (`alphadesk.audit`) so it can be shipped to a tamper-evident log.

---

### [P1] Frontend: no user-action telemetry
**File:** `frontend/src/components/panels/TradePanel.tsx:665,827`, `frontend/src/components/panels/WatchlistPanel.tsx:482`, `frontend/src/app/(dashboard)/settings/page.tsx:288`, `frontend/src/components/dashboard/ExportButton.tsx:86`
**Issue:** Clicks like "Stage order" / "Place order" / "Cancel" / "Export CSV" have local `console.error` on failure, but no structured telemetry. A user reports "I clicked submit, nothing happened" — we have no record of the click, the validation state, the network attempt, the response. `useDataPipeline.ts` emits `console.warn("[DataPipeline] Snapshot fetch failed (attempt 1)")` — again, only in the user's devtools.
**Impact:** Support tickets become "can you share a screenshot?" instead of "I see your 14:02:05 click failed because the backend returned 422 — validate `limit_price > 0`".
**Fix:** Add a tiny `track(event, props)` helper that POSTs to `/api/v1/_clientlog` (rate-limited) for every mutating click and for every network error. The backend persists the last N events per user.

---

### [P1] No machine-checkable alerting when background tasks die
**File:** `backend/main.py:63-94`, `backend/data/ingestion/alpaca_stream.py:339-379`, `backend/data/ingestion/pipeline_runner.py:302-374`
**Issue:** The Alpaca stream has a `_supervised_run` that retries indefinitely with backoff — good for staying up. But the supervisor only logs at ERROR: `logger.error("alpaca_stream: _run_stream crashed: %s — reconnecting in %ds", ...)`. There is no alert path out of "infinite reconnect loop" because nothing scrapes the logs for rate-of-reconnect. The pipeline scheduler loop (`pipeline_runner.py:371`) does the same: it catches top-level exceptions and sleeps 60s. If Claude-CLI is uninstalled on the container, the scheduler silently tries forever; oncall finds out when a week of strategies didn't run.
**Impact:** "Strategies stopped firing 3 days ago" has no detection path.
**Fix:** Emit Prometheus counters / gauges: `alpaca_stream_up=0/1`, `pipeline_scheduler_last_successful_run_ts`, `pipeline_window_fires_total{window}`. An alert rule triggers when `time() - pipeline_scheduler_last_successful_run_ts > 86400` during trading days. Also add a `POST /internal/heartbeat` that the scheduler pings — frontend / external monitor can detect the absence.

---

### [P2] `logger.error(f"...: {e}")` f-strings defeat log-line deduplication
**File:** `backend/api/routes/pipeline.py:288` (only one in the backend, but sets a bad precedent)
**Issue:** `logger.error(f"Failed to read log: {e}")` — f-string interpolation happens before the logger runs, so the level-check short-circuit never gets to skip work, and every unique error message becomes a unique log line. Everywhere else in the codebase uses `logger.error("msg: %s", e)` — this one outlier breaks the pattern.
**Impact:** Minor. Stylistic inconsistency and, with sampled logging, makes grouping awkward.
**Fix:** `logger.error("Failed to read log: %s", e, exc_info=True)`.

---

### [P2] Pipeline log written to per-day JSON on disk, not shipped anywhere
**File:** `backend/data/ingestion/daily_pipeline.py:580-582`, `backend/api/routes/pipeline.py:19`
**Issue:** `pipeline_logs/YYYY-MM-DD.json` is the authoritative record of every pipeline run. It's written to a volume on the VPS (`/var/lib/alphadesk/pipeline_logs` per `docker-compose.prod.yml:52`). There is no rotation, no shipping, no backup hook. If the VPS disk fails, ledger + pipeline history go with it.
**Impact:** Post-mortem after a bad day: only hope is `ssh` to the VPS and hope the file exists.
**Fix:** Tar + gzip rotate monthly; mirror to S3 / object store via the existing `backup.sh` (`infrastructure/backup.sh`) — confirm it includes this path.

---

### [P2] Docker logging driver is `json-file` with max-size=10m, max-file=3 — 30 MB total of history
**File:** `infrastructure/docker-compose.prod.yml:33-37,65-69,92-96,102-106`
**Issue:** Each service keeps at most 30 MB of logs before rotation. At anything above low traffic that's a few hours of logs. No shipping to journald, Loki, or an external aggregator. Container restart loses all in-flight unrotated log state.
**Impact:** You cannot debug yesterday. Oncall is flying blind if the incident started >6 hours ago.
**Fix:** Either increase `max-size` to 100m and `max-file` to 10, OR switch the driver to `journald` (with `vector`/`promtail` shipping to Loki). At minimum, write a cron that `docker logs backend > /var/lib/alphadesk/logs/backend-$(date).log` on a 1h cadence so there is a historical trail.

---

### [P2] Gunicorn `--log-level info` with `-w 1` single worker — no per-worker request logging tag
**File:** `backend/Dockerfile:36`
**Issue:** Single-worker deployment: fine for now, but Gunicorn access logs don't include `worker_id`, and when you scale to `-w 2+` you lose attribution in a shared stdout stream. `--access-logfile -` uses the default format that drops request body size, referer, user-agent.
**Impact:** When scaling up, access logs become ambiguous.
**Fix:** Before scaling past 1 worker, switch to a structured Gunicorn access format: `--access-logformat '{"worker":%(p)s,"ip":"%(h)s","method":"%(m)s","path":"%(U)s","status":%(s)s,"len":%(b)s,"ms":%(L)s,"ua":"%(a)s"}'` or adopt a logging-config file that handles both uvicorn access + app logs uniformly.

---

### [P2] `/status` endpoint in Caddy still points to dead `uptime-kuma:3001`
**File:** `infrastructure/Caddyfile:30-35`
**Issue:** uptime-kuma was removed from `docker-compose.prod.yml:110` but `Caddyfile` still has a `handle /status/*` block that reverse-proxies to the dead hostname. Hitting `/status/` returns 502 from Caddy, and worse: the basic-auth block still challenges the user, so they see an auth prompt for a service that doesn't exist.
**Impact:** Confusing; also an indicator that there's no health dashboard at all.
**Fix:** Either delete the `/status/*` handler or replumb it at a lightweight self-hosted dashboard (Grafana, Netdata, `/metrics` scrape + small UI).

---

### [P2] Redis listener fail-safe logs at ERROR every retry — noisy on startup if Redis slow
**File:** `backend/api/websocket/handler.py:135,144,148`
**Issue:** On Redis cold-start, `_redis_listener` will `logger.error("Redis listener connection error: %s ...")` per attempt. With exponential backoff to max 30s, a 2-minute Redis boot produces 6-8 ERROR lines before recovery. Further, after 50 consecutive failures the listener gives up silently (line 148: "giving up after %d consecutive failures") — no alert, no heartbeat stopping, no recovery path.
**Impact:** Log spam on benign restarts; silent WS death on real Redis outages.
**Fix:** First 3 retries at WARNING, subsequent at ERROR with exponential dampening. When it gives up, mark a gauge `ws_listener_alive=0` and trigger a process exit (let Gunicorn restart) rather than leaving a broken worker running.

---

### [P2] `/health` does not expose a machine-readable dependency roll-up even in non-prod
**File:** `backend/main.py:220-226`
**Issue:** Non-prod `/health` returns `{"status":"healthy","environment":"dev","version":"0.1.0"}` — no dependency detail. Prod returns `{"status":"ok"}`. Either way, there is no way for a script to detect "DB down" vs "Redis down" vs "Alpaca down".
**Impact:** No runbook can say "curl /health, expect `redis:ok`"; the runbook has to `docker exec` into each container.
**Fix:** Expose `/readyz` with: `{"db":"ok","redis":"ok","alpaca_stream":"ok","alpaca_rest":"ok","ts":"..."}` — 503 if any dependency is down, 200 otherwise. Gate behind internal-network ACL so it doesn't leak version info to internet scanners (current `trusted_hosts` in ProxyHeadersMiddleware covers this).

---

### [P3] Commented-out `# TODO:` in `trade_ledger.py` for schema change — no log when schema migration runs
**File:** `backend/data/ingestion/trade_ledger.py:122-128, 150-158`
**Issue:** Schema-init block (`_ensure_schema`) runs on every module init with `CREATE TABLE IF NOT EXISTS ...`. If the ALTER TABLE for the `side` column fails (e.g., permissions), there's no log — the ddl is silently swallowed into the `engine.begin()` transaction and the next INSERT might fail with `column "side" does not exist`.
**Impact:** Schema drift goes silent.
**Fix:** Wrap each statement in a separate try/except that logs at WARNING on failure. Also, switch to proper Alembic migrations (the TODO already acknowledges this).

---

### [P3] No log rotation config in `backend/core/logging.py` — file doesn't exist
**File:** (missing) `backend/core/logging.py`
**Issue:** Logging is bootstrapped inline in `main.py:27-39` via `logging.basicConfig`. No dedicated config module; no formatter class; no handler enumeration. Testing / tooling / per-route overrides are impossible without editing main.py. When someone wants to turn on DEBUG for just the pipeline loggers, they have to hack the startup block.
**Impact:** Friction for oncall. No central place to configure log destinations.
**Fix:** Create `backend/core/logging.py` with a `configure_logging(level=..., json_mode=bool, handlers=[...])` function called from `main.py` and from test fixtures. Supports a JSON formatter, a plaintext formatter, and console + file handlers.

---

### [P3] Pipeline circuit breaker logged at CRITICAL, but no alert path
**File:** `backend/data/ingestion/daily_pipeline.py:670-682`
**Issue:** `logger.critical(msg)` on circuit-breaker trip — good. The code then tries to post to Discord (line 678), but if the Discord webhook isn't configured (or fails), the whole `except Exception: pass` (line 680-681) swallows that too. So the pipeline halted, the log says CRITICAL, but no human gets paged.
**Impact:** Trades stop without notification; desk thinks "looks quiet today" for hours.
**Fix:** At minimum, fall through to Telegram, log at CRITICAL with a clear "circuit_breaker_notify_failed=true" tag, and emit a Prometheus counter `pipeline_circuit_breaker_total` so an Alertmanager rule can page.

---

### [P3] `global-error.tsx` sends no error payload to backend — it only logs to browser console
**File:** `frontend/src/app/global-error.tsx:27-32`
**Issue:** React's `global-error.tsx` fires when the root layout itself crashes. All we do is `console.error`. If the app has a fatal client error in production (say, a bad deploy causes every page to throw), we get zero visibility.
**Impact:** "Is prod broken?" requires a human to check.
**Fix:** Same as P0-frontend: POST to `/api/v1/_clientlog` with {message, stack, digest, user-agent, url}. Rate-limit aggressively (1/s/user) to prevent a browser-loop DOS.

---

### [P3] No log of which user revoked which token
**File:** `backend/api/routes/auth.py:252-288`, `backend/core/auth.py:133-144`
**Issue:** `revoke_token` logs failures at WARNING but does NOT log successes — so when a token appears on the blocklist, there's no audit trail that records *who* invalidated it (logout vs admin revoke vs refresh rotation).
**Impact:** Security investigation is harder ("who logged this user out?").
**Fix:** On every `revoke_token` call site, log at INFO with an `event` field so auditors can reconstruct: `{"event":"auth.revoke","jti":"...","actor":"admin","reason":"logout"}`.

---

### [P3] `logger.exception` vs `logger.error(..., exc_info=True)` inconsistency
**File:** many; e.g. `backend/data/ingestion/realtime_scanner.py:343,397`, `pipeline_runner.py:166,183,299,356,371`
**Issue:** Some places use `logger.exception(...)` (good — includes traceback), others `logger.error(..., exc_info=True)` (also good), others just `logger.error("Order failed for %s: %s", sym, e)` (bad — no stack trace). Particularly in `daily_pipeline.py:376,384,396,563,787` where order-placement failures don't include `exc_info=True`.
**Impact:** Same-looking ERROR lines carry different debug value. When a trade fails, we see only the exception message — which is often generic (`HTTPError: 400 Bad Request`) without the stack pointing us at which helper built the bad body.
**Fix:** Codify "any ERROR level log for a caught exception must include `exc_info=True` (or use `logger.exception`)". Add a ruff rule or test that scans for `logger.error\(.*, e\)` without `exc_info`.

---

## Summary (ordered by oncall value)

1. **P0 observability stack.** There is no Prometheus, OTel, Sentry, or Datadog. The fastest practical win: add `prometheus-client`, expose `/metrics` with histograms for request latency + counters for trading business events (orders submitted / rejected, strategy runs, circuit-breaker trips, stream reconnects). Pair with Grafana via a container and 4-5 dashboards. Without this, every other fix is cosmetic.
2. **P0 real `/readyz` health check.** Current `/health` is a shell — returns OK while the database is off, Redis is off, the Alpaca stream task has crashed. Split into `/livez` (Caddy probe) and `/readyz` (full dependency check returning 503 on any failure).
3. **P0 request-ID propagation into log records.** Middleware already mints an ID; no log line carries it. Add a `ContextVar` + a `logging.Filter` and update the format string. Then an order problem can be traced from a frontend click all the way through to Alpaca's response.
4. **P0 structured JSON logs.** Free-text `|`-delimited lines are unqueryable in an aggregator. Switch to `python-json-logger`. Every event becomes a queryable field.
5. **P0 silent `except Exception: pass` sweep.** Forty-five-plus instances swallow errors without logging. At minimum attach `logger.debug(..., exc_info=True)`; many warrant `logger.warning`.
6. **P0 frontend error telemetry.** No `window.onerror`, no `unhandledrejection`, no Sentry — prod errors are invisible. Add either Sentry or a minimal `/api/v1/_clientlog` endpoint.
7. **P1 demote noisy WARNINGs to INFO.** "Serving DEMO data for X — Alpaca unreachable" fires per-request, per-route; buries real signals. Sample or move to counters.
8. **P1 tone down Alpaca stream chatter.** Subscription response bodies logged at INFO; client connect/disconnect at INFO. Move to DEBUG + metric counters.
9. **P1 don't log third-party response bodies.** `logger.info("Alpaca SIP stream auth: %s", str(auth_resp)[:100])` — parse the auth status and log "OK" or "FAILED"; stop echoing the bytes.
10. **P1 structured audit log for mutating requests.** Currently only `/orders` logs the user. `/halt`, `/resume`, `/pipeline/run`, `/alerts`, `/refine-strategy`, `/webhooks/*`, `/auth/*` don't. Add a dedicated `alphadesk.audit` logger.
11. **P1 user-action telemetry on the frontend.** Clicks that fail leave zero trace on the server. Minimal `track(event,props)` helper POSTs to the backend for mutating clicks + network errors.
12. **P1 background-task aliveness metrics + alerts.** The Alpaca stream supervisor / pipeline scheduler can loop-forever-on-failure. Emit `alpaca_stream_up`, `pipeline_last_success_ts`, etc., and alert when stale.
13. **P2 ship pipeline-log JSON off the box.** Authoritative daily run records live only on the VPS disk. Mirror to S3/backup.
14. **P2 increase docker log retention.** 30 MB per service is a few hours; extend to 100m×10 or switch to journald + Loki.
15. **P2 delete the dead `/status` Caddy handler** pointing at removed `uptime-kuma:3001`.

The end-to-end picture: this is a paper-trading app running on a single Hetzner VPS, with single-worker Gunicorn, in-process background tasks, and no centralized log/metric store. For the current scale that's survivable. Before opening to more users or enabling live trading, items 1-6 are load-bearing.
