# Persona 41 — SRE Postmortem Reconstruction

**Persona.** Site-reliability engineer, post-hypothetical-outage, trying to reconstruct the incident timeline from whatever telemetry AlphaDesk's production VPS has retained.

**Target.** `tradingalpha.net` — single-host Docker Compose on Hetzner `178.156.145.213` (Ubuntu 24.04). Stack: Caddy (edge) → `alphadesk-frontend` (Next.js 16) + `alphadesk-backend` (FastAPI/Uvicorn/Gunicorn 3 workers) + TimescaleDB + Redis.

**Test outcome.** **Partially reconstructable, with serious gaps.** The backend emits high-quality structured JSON logs keyed by `request_id` (Wave 18 correlation works — `alphadesk.audit` + `httpx` + app traceback records all carry the same UUID). But the edge and the frontend are effectively dark: Caddy has no `log` directive so there are **no HTTP access logs on the system**, and the Next.js container only emits its startup banner. An SRE would have stack traces but not a request/response timeline, no p95 latency, no traffic volume, and nothing survives a container restart beyond the Docker json-file ring buffer.

---

## Findings

### F1 — Caddy has zero access logging (CRITICAL)
`docker exec alphadesk-caddy-1 cat /etc/caddy/Caddyfile` contains no `log { output ... }` block. Over the full 3h44m uptime since the 14:45 UTC boot, Caddy has emitted only **8** request-shaped lines — all `http.handlers.reverse_proxy` warnings for aborted upstream responses. Every successful request (the overwhelming majority) is invisible. A postmortem cannot answer "what was the traffic shape at time T", "did the edge see 5xx before the upstream did", "which IPs hit us", "what URIs spiked". This is the single biggest reconstruction blocker. Fix: add a `log { output file /var/log/caddy/access.log { roll_size 50mb roll_keep 10 } format json }` block (and bind-mount the directory out of the container).

### F2 — Uvicorn access log lacks request_id and client port (HIGH)
Gunicorn is started with `--access-logfile -` but inherits Uvicorn's default access format: `75.181.193.243:0 - "POST /api/v1/auth/login HTTP/1.1" 429`. The `:0` is not a port — Uvicorn can't read the real port through `ProxyHeadersMiddleware` — and the line carries **no request_id, no latency, no user_id**. Application logs have `request_id` (F3), but the access log does not, so an SRE cannot correlate "which HTTP 500 at 14:53:02 corresponds to this traceback at 14:53:02.118". Fix: either swap the access log for a custom middleware that emits JSON with `request_id` + `duration_ms` + `status`, or disable Uvicorn's access log entirely and let Caddy's access log (F1) be the source of truth.

### F3 — Backend structured logging works and is the one bright spot
`backend/core/logging.py` installs a `JsonFormatter` that emits one JSON object per line with `timestamp` (ISO-8601 UTC), `level`, `message`, `logger`, `request_id`, plus any `extra=` fields. The `add_request_id` middleware in `backend/main.py:204-219` honours inbound `X-Request-ID` or mints a uuid4 and stuffs it in a `ContextVar` so downstream loggers (`alphadesk.audit`, `httpx`, app routes, pydantic exceptions) all stamp the same id. Live sample: a single `request_id=76b83f98-6380-4ab5-95e8-5a6eb623d57a` correlates an audit login event → two upstream `httpx` calls to Alpaca → final response. This is the correlation Wave 18 promised and it is real. Preserve this behaviour carefully in future refactors.

### F4 — No log shipping off the VPS (HIGH)
No Loki, Promtail, Fluentd, Fluent-Bit, Vector, or rsyslog remote (`@@host`) forwarder is installed or running. No Sentry DSN is set (`docker exec alphadesk-backend env | grep -i sentry` is empty). All telemetry lives on the single host. If the VPS itself is the outage (disk full, kernel panic, Hetzner host eviction), every log is inaccessible until the box is recovered. Retention is also at the mercy of one `df` check. Minimum viable mitigation: ship Docker logs to a managed Loki/Grafana Cloud free tier, or at minimum rsync `/var/lib/docker/containers/*/*log` to object storage on a cron.

### F5 — Docker json-file retention = 250 MB per container, no time guarantee
All four app containers use `json-file` with `max-size=50m` + `max-file=5` → 250 MB rolling buffer each. At the backend's current rate (~477 access lines + dozens of WARN tracebacks in 3h44m, and the Polygon pydantic traceback alone is ~800 bytes per occurrence every ~17s), retention is **hours to a few days under load, not weeks**. There is no time-based guarantee. An outage discovered Monday morning may have already rolled out of the backend log by the time an SRE starts investigating. Fix: raise `max-file` to 20+ for the backend, and ship off-host (F4).

### F6 — Journald has only one boot of history
`journalctl --list-boots` shows exactly one boot (`2a531ace…` at `2026-04-19 14:45:23`, 3h44m of data, 16 MB). The only other journal directory on disk (`/var/log/journal/005ad1d9…`) is a 3-second fragment from the January 8 provisioning. Current `/etc/systemd/journald.conf` is effectively defaults (only `[Journal]` header, no overrides). That means journald is using `SystemMaxUse=10%` of `/var/log`, fine for size, but there is **no evidence multiple reboots are retained** because this is the first real boot — so we cannot confirm the retention policy until a second reboot happens. `last -x reboot` confirms only one reboot in `wtmp`, which begins `Jan 8 10:27:31`. The good news: `/var/log/journal/` exists, so journald is in persistent mode.

### F7 — Frontend container emits no runtime logs (HIGH)
`docker logs alphadesk-frontend --tail 100` returns only the Next.js 16.2.2 startup banner ("✓ Ready in 0ms"). No per-request logging, no RSC stream errors, no hydration failures, no middleware traces. When F1/F2 combine with F7, the entire user-facing path between `curl` and the FastAPI worker is **a black hole**. If a `/desk` page crashes at SSR time, there will be no record of it on this host. Fix: either enable Next.js request logging (`logging.fetches.fullUrl` + custom middleware) or ensure every Caddy access log line survives (F1), so at least timing is recoverable.

### F8 — No audit log table in the application DB
`\dt` on TimescaleDB shows 10 application tables — none of them `audit_log`, `login_history`, `request_log`, or similar. The only generic event surface is `telemetry_event (created, tag, body jsonb)`, and the volume of rows there is not known from this audit. Login successes/failures land in `alphadesk.audit` logger → stdout → Docker json-file — meaning authentication history has the same short retention (F5) as any other log. A security-sensitive event (forced logout, permission escalation, repeated 429) at the time of an outage may be gone before the postmortem. Fix: double-write `alphadesk.audit` events to a durable DB table with indexed `user_id`, `event`, `timestamp`.

### F9 — No metrics, no /metrics endpoint, no health dashboard
`docker ps` shows no Prometheus, Grafana, node-exporter, cAdvisor, or Netdata container. The Caddyfile explicitly notes "`/status/*` handler removed 2026-04-18 — it pointed at uptime-kuma:3001, which was deleted from docker-compose.prod.yml on 2026-04-17". So the previous status dashboard was torn down without a replacement landing. During a postmortem an SRE cannot answer "was the VPS CPU pegged at 14:50", "did TimescaleDB WAL grow", "did a worker OOM-kill", beyond whatever `dmesg` / `journalctl -k` caught. System state at incident time is not queryable after the fact. Fix: deploy node-exporter + Prometheus + Grafana (or Netdata as the low-overhead single-container alternative the comment already anticipates).

### F10 — Polygon `volume`-is-float traceback repeats every ~0.3s, burning log budget
A single bug — `api/routes/market.py:458` raising `pydantic_core._pydantic_core.ValidationError: volume Input should be a valid integer, got a number with a fractional part` — is logged with full stack every ~300ms in the current window. Each traceback is ~800 bytes. This alone can exhaust the backend's 250 MB rolling buffer (F5) in roughly 30 hours of steady state and drown out the signal an SRE would be looking for post-incident. Fix: either switch `Bar.volume` to `float`/`Decimal`, or wrap the `Bar(...)` construction to round/coerce, and log the validation failure once per minute with a counter rather than per-record.

---

## Reconstruction verdict per telemetry dimension

| Dimension | Available? | Source | Gap |
|---|---|---|---|
| Edge access log (who hit what, when, status, latency) | No | Would be Caddy | F1 blocks |
| App error tracebacks | Yes | Backend JSON | None — good |
| Request correlation (id across middleware/DB/Alpaca) | Yes | `request_id` ContextVar | None — good |
| Access ↔ error correlation | Partial | backend only | F2 — no id in uvicorn access line |
| Frontend runtime errors | No | Next.js stdout | F7 blocks |
| Auth / audit events beyond retention window | No | `alphadesk.audit` logger | F8 — no DB mirror |
| Host metrics (CPU, mem, disk, OOM) | No | Would be Prom/node-exporter | F9 blocks |
| Cross-reboot retention | Unknown | Journald persistent | F6 — only one boot so far |
| Off-host survival of logs | No | None | F4 blocks |

---

## 250-Word Summary

AlphaDesk's production VPS gives an SRE enough signal to diagnose **which FastAPI handler blew up**, but not enough to reconstruct **what the outage looked like from the edge**. The bright spot is the backend: `backend/core/logging.py` installs a `JsonFormatter` and `backend/main.py:204` installs a request-id middleware that propagates a UUID through a `ContextVar`, so every application log line — including `alphadesk.audit`, `httpx` Alpaca calls, and pydantic tracebacks — carries the same `request_id`. One grep, end-to-end trace. Wave 18 correlation genuinely works.

Everything else is thin. Caddy has **no `log` directive**, so over 3h44m of uptime only 8 warn-level request lines exist; the site has no HTTP access log. Uvicorn's access log is plain text with `client:0` (ProxyHeaders can't get the port) and carries no request_id, so access ↔ error correlation is broken at the edge. The frontend emits only its Next.js 16 startup banner — no runtime logs at all. Retention is a Docker json-file ring (250 MB/container, hours-to-days under load), nothing ships off-host (no Loki, Promtail, Sentry, or rsyslog forwarder), and the `telemetry_event` table is the only durable event sink — auth history lives only in the rolling log. There are no metrics (Uptime-Kuma was removed 2026-04-17 without replacement), so host state at incident time is unknowable. A fast-looping Polygon pydantic traceback (`market.py:458`, every ~300ms) also burns the log budget. Postmortem feasibility: stack traces yes, timeline no.
