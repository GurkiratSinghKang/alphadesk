# AlphaDesk — Architecture

A high-level system map for operators and contributors. For the
strategy-level logic see `audit-reports/expert-*.md` and
`audit-reports/phase1-*.md`; for deployment mechanics see
[`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## 1. Layered overview

```
         ┌──────────────────────────────────────────────────┐
  Edge   │ Caddy 2 — TLS (ACME), HSTS, CSP, X-Request-ID,   │
         │           compression, rate limit, redirects     │
         └───────────────┬──────────────────────────────────┘
                         │
         ┌───────────────▼────────────────┐
  App    │ Next.js 16 (port 3000)         │   ←─── browser clients
         │ React 19 RSC, Tailwind v4      │        (SSR + CSR mix)
         └───────────────┬────────────────┘
                         │ API calls / WS
                         │
         ┌───────────────▼────────────────┐
         │ FastAPI 0.115 (port 8000)      │
         │ uvloop, ORJSONResponse,        │
         │ gunicorn -w 1 (single worker)  │
         │                                │
         │  ┌────────────────────────┐    │
         │  │ REST routes            │    │
         │  │ WebSocket hub          │    │
         │  │ Lifespan bg services   │    │
         │  │ (scheduler, stream,    │    │
         │  │  scanner, monitor,     │    │
         │  │  reconciler, fills,    │    │
         │  │  audit-cleanup, cert,  │    │
         │  │  disk)                 │    │
         │  └────────────────────────┘    │
         └───────┬────────────┬───────────┘
                 │            │
   ┌─────────────▼──┐   ┌─────▼──────────────────────┐
   │ TimescaleDB    │   │ Redis 7                    │
   │ (Postgres 15)  │   │ - response cache           │
   │ - hypertables  │   │ - halt state               │
   │ - continuous   │   │ - idempotency keys         │
   │   aggregates   │   │ - streams (ws fan-out)     │
   │ - app schema   │   │ - rate-limit counters      │
   └────────────────┘   └────────────────────────────┘

                         External services
   ──────────────────────────────────────────────────────
   Alpaca    — broker (paper), REST + websocket market data + trades
   Polygon   — options chain, tick-level aggregates
   FMP       — fundamentals, Piotroski F-Score inputs, earnings
   Anthropic — Claude Code CLI (primary) + Claude API (fallback)
```

---

## 2. Request / data flow

### 2.1 User-initiated API request

```
Browser ──HTTPS──▶ Caddy ──HTTP──▶ FastAPI
                     │                │
                     │                ├─▶ Redis (cache / rate-limit)
                     │                ├─▶ TimescaleDB (reads)
                     │                └─▶ external API (if cache miss)
                     │                       │
                     │                       ▼
                     │◀── JSON response ◀── FastAPI (ORJSON)
                     │
Browser ◀── HTTPS ──┘
```

Every hop carries the `X-Request-ID` header that Caddy mints at the
edge, so a single request can be traced across frontend console logs,
Caddy access logs, backend structlog, and TimescaleDB slow-query logs.

### 2.2 Live market data

```
Alpaca websocket ──▶ stream worker (in-process)
                       │
                       ├─▶ Redis stream key "market:*" (persistent fan-out)
                       │
                       └─▶ local in-memory cache ("hot" quote map)

Redis stream ──▶ FastAPI WS hub ──▶ browser WS clients
```

The lifespan background "alpaca stream" task is the single subscriber
to the broker's websocket; all downstream consumers (FE, scanner,
monitor, reconciler) read from the Redis stream, never directly from
Alpaca. Single writer keeps the broker connection count at 1 per
backend replica.

### 2.3 Pipeline run (daily 09:35 ET, mid-day 11:00 / 14:00 ET)

```
scheduler (APScheduler) ──▶ for each active strategy:
   1. screen(universe)                — strategy-local filter
   2. rank / size / gate              — master agent coordinator
   3. for each candidate:
        a. agent.run(prompt)          — Claude CLI/API analysis
        b. risk + live-gate check
        c. place order via Alpaca
   4. emit run summary to pipeline_logs hypertable
```

Master Agent enforces allocation caps, duplicate-position prevention,
and sector-concentration limits BEFORE any order lands at the broker.
Strategies never bypass the master — they expose a `screen()` method
and the orchestrator owns execution.

### 2.4 TradingView webhook

```
TradingView ──POST──▶ Caddy ──▶ /webhooks/tradingview
                                  │
                                  ├─ rate-limit (Redis, fail-closed)
                                  ├─ replay check (timestamp ±120 s)
                                  ├─ HMAC verify (secret over ts+body)
                                  ├─ parse + route (buy / sell / close / alert)
                                  └─ publish to ws "alerts" channel
```

HMAC is computed over `"{timestamp}:{raw_body}"` keyed on
`TRADINGVIEW_WEBHOOK_SECRET`. Binding the body into the signature
defeats replay attacks where an attacker captures a legitimate payload
and re-submits it with a fresh timestamp.

---

## 3. Deployment topology

- **Host**: one Hetzner CCX13 VPS (2 vCPU, 8 GB RAM). No horizontal
  scaling today; a single backend replica owns the broker websocket.
- **Orchestration**: Docker Compose with a base
  `docker-compose.yml` + `infrastructure/docker-compose.prod.yml`
  overlay. The overlay disables `/docs`, enables Caddy, and wires the
  `.env.prod` secrets bundle.
- **Images**: pushed to `ghcr.io/<org>/<repo>-{frontend,backend}` on
  every merge to `main`. Tagged with the commit SHA for rollback.
- **CI/CD**: GitHub Actions pipeline
  ([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)):
  1. `test` — frontend Vitest suite
  2. `backend-test` — pytest against ephemeral Redis (skips paid APIs)
  3. `security-audit` — `pip-audit` + `npm audit` (HIGH/CRIT gate)
  4. `image-scan` — builds backend image, runs Trivy
     (HIGH/CRITICAL gate, `ignore-unfixed=true`)
  5. `build-and-deploy` — pushes both images, syncs compose config,
     pulls on VPS, runs `alembic upgrade head`, hits `/readyz`
- **Rollback**: `workflow_dispatch` with `image_sha` input — the VPS
  pulls the prior images, re-runs migrations (idempotent up; explicit
  downgrade required for schema rollbacks — see `ROLLBACK.md`).

---

## 4. Background services (lifespan-scoped)

All of these start inside the FastAPI lifespan context of the single
backend worker. They share the async event loop with HTTP handlers, so
each one uses non-blocking I/O or offloads CPU work to a thread pool.

| Service                | Cadence           | Purpose                                     |
|------------------------|-------------------|---------------------------------------------|
| Pipeline scheduler     | cron (09:35 / 11:00 / 14:00 ET) | Orchestrates strategy runs       |
| Alpaca stream          | continuous        | Single subscriber to broker WS              |
| Realtime scanner       | every bar close   | Screens universe, emits watchlist updates   |
| Continuous monitor     | 60 s              | News + price-proximity alerts for held pos  |
| Position reconciler    | 5 min             | Detects drift vs broker positions / cash    |
| Fill reconciler        | 30 s              | Matches local orders to broker fills        |
| Audit-log cleanup      | daily             | Compaction + retention on audit_log         |
| Cert-check             | 1 h               | TLS cert expiry into /healthz detail        |
| Disk-check             | 5 min             | Host disk free % into /healthz detail       |

> We run a single worker (not 3) because these services each assume
> singleton execution. Horizontal scaling requires a distributed
> leader-election lock before we can safely add replicas — tracked in
> the operational backlog.

---

## 5. Security posture

- **TLS**: ACME (Let's Encrypt) managed by Caddy. HSTS max-age
  63072000 (2 y), includeSubDomains, preload.
- **Headers**: CSP strict (no `unsafe-inline`, strict `script-src`),
  X-Frame-Options DENY, Referrer-Policy strict-origin-when-cross-origin,
  Permissions-Policy minimal.
- **Authn**: JWT in HttpOnly + Secure + SameSite=Strict cookie; 8 h
  session; rotation on privilege change.
- **Authz**: per-route dependency injection on the FastAPI side;
  admin-only endpoints require role claim + IP allowlist in prod.
- **Rate limits**: Redis-backed per-IP counters, fail-CLOSED on Redis
  outage (the webhook endpoint, for example, returns 503 rather than
  silently allowing unbounded requests through).
- **Secret scrub**: every outbound Claude prompt passes through
  `_scrub_pii` — usernames, UUIDs, JWTs, bearer tokens, Alpaca
  key/secret prefixes, IPs, emails are redacted before the prompt
  leaves the process.
- **Container**: backend runs as `alphadesk` (uid 10001), not root.
  Trivy HIGH/CRITICAL image scan gates every deploy.
- **Dependencies**: `pip-audit` + `npm audit` HIGH gate in CI.

---

## 6. Data model highlights

TimescaleDB hypertables:

- `market_bars` — OHLCV bars at 1 min / 5 min / daily
- `trades` — executed fills with P&L and strategy attribution
- `positions` — snapshot per symbol per day
- `pipeline_logs` — per-run audit trail (candidates, rejections, orders)
- `audit_log` — authn + mutating API calls
- `equity_curve` — per-strategy rolling NAV

Continuous aggregates:

- `daily_returns_by_strategy`
- `sector_exposure_snapshot`
- `factor_exposure_1d`

Retention: raw bars kept 2 y at 1 min, rolled up beyond that. Audit
logs kept 400 days (one trading year + buffer) then pruned by the
lifespan `audit-log cleanup` service.

---

## 7. Where to go next

- Strategy internals: `backend/strategies/<name>/strategy.py` and
  `audit-reports/expert-<name>.md`
- Operations playbooks: [`RUNBOOK.md`](RUNBOOK.md),
  [`ROLLBACK.md`](ROLLBACK.md)
- Audit findings index: [`../audit-reports/INDEX.md`](../audit-reports/INDEX.md)
- Canonical env: [`../backend/.env.example`](../backend/.env.example)
