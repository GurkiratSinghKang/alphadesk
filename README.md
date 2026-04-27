# AlphaDesk — Claude-Powered Autonomous Trading Platform

AlphaDesk is a multi-strategy automated trading platform combining
systematic stock screening, Claude-powered AI analysis, and execution
through the Alpaca brokerage API. It ships as a containerised web app
(FastAPI backend + Next.js frontend) fronted by Caddy for TLS, CSP, and
HSTS.

- Production: [tradingalpha.net](https://tradingalpha.net)
- Current status: **paper trading** on Alpaca; 12 implemented strategies
  plus 7 planned / catalogue-only entries
- Infrastructure: Hetzner CCX13 VPS, deployed from `main` via GitHub
  Actions to Docker Compose

---

## Table of contents

- [Architecture at a glance](#architecture-at-a-glance)
- [Strategies](#strategies)
- [Quick start (local)](#quick-start-local)
- [Configuration](#configuration)
- [Operations](#operations)
- [Tech stack](#tech-stack)

---

## Architecture at a glance

```
                        ┌──────────────────────┐
       HTTPS / WSS      │  Caddy 2 (edge)      │   TLS, HSTS, CSP,
        443 →  ─────────▶  ACME, X-Request-ID  │   ACME, compression
                        └──────────┬───────────┘
                                   │
                 ┌─────────────────┴─────────────────┐
                 │                                   │
      ┌──────────▼──────────┐           ┌────────────▼──────────┐
      │   Next.js 16 (FE)   │           │   FastAPI 0.115 (BE)  │
      │   React 19, RSC     │   API /   │   uvloop, ORJSON,     │
      │   port 3000         │   WS      │   gunicorn -w 1       │
      └──────────┬──────────┘           │   port 8000           │
                 │                      └──┬──────────────────┬─┘
                 │                         │                  │
                 │                ┌────────▼───────┐  ┌───────▼────────┐
                 │                │  TimescaleDB   │  │  Redis 7       │
                 │                │  hypertables,  │  │  cache, halt,  │
                 │                │  continuous    │  │  idempotency,  │
                 │                │  aggregates    │  │  streams, rate │
                 │                └────────────────┘  └────────────────┘
                 │
                 │       External services
                 │
                 ├────▶ Alpaca (broker + market data + live stream)
                 ├────▶ Polygon.io (options chain + aggregates)
                 ├────▶ FMP (fundamentals, F-Score inputs)
                 └────▶ Anthropic Claude (CLI / API — agents & alpha)
```

Background services (lifespan-scoped inside the backend container):

- **Pipeline scheduler** — orchestrates daily / mid-day strategy runs
- **Alpaca stream** — live trades / quotes over websocket
- **Realtime scanner** — screens the universe on every bar close
- **Continuous monitor** — news + price-proximity alerts for open positions
- **Reconciler** — account / position / cash drift detection
- **Fill reconciler** — matches local orders to broker fills
- **Audit-log cleanup** — compaction + retention
- **Cert-check / disk-check** — infra health signals into /healthz

Full component map and data flow: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Strategies

12 strategies are fully implemented in `backend/strategies/` and run in
the Phase-1 backtester + live pipeline:

1. **Momentum + Quality** — cross-sectional momentum with Piotroski F-Score filter
2. **PEAD** — Post-Earnings Announcement Drift
3. **VRP Harvesting** — systematic volatility risk premium (options)
4. **Earnings Vol Premium** — short-vega pre-earnings structures
5. **Regime Adaptive** — rule-based macro regime (SPY trend + VIX)
6. **Time-Series Momentum** — absolute momentum with inverse-vol sizing
7. **RSI-2 Reversal** — Connors short-term mean reversion with 200-SMA filter
8. **Dual Momentum** — Antonacci relative + absolute momentum
9. **Pairs Trading** — cointegration z-score spread trading
10. **KAMA + ATR Breakout** — Kaufman adaptive MA with Keltner channels
11. **Opening Range Breakout** — intraday breakout with VWAP confirmation
12. **VWAP Bounce / Breakout** — institutional VWAP-based intraday signals

Planned (advertised in the catalogue, implementation pending):
`claude-alpha`, `dividend-capture`, `gap-fill`, `mean-reversion`,
`pairs-stat-arb`, `sector-rotation`, `vcp-breakout`.

Per-strategy write-ups live in `audit-reports/phase1-*.md` and
`audit-reports/expert-*.md`; an index is at
[`audit-reports/INDEX.md`](audit-reports/INDEX.md).

---

## Quick start (local)

Cross-platform. Requires Docker Desktop (or Colima on macOS) + Docker
Compose. No host Python or Node install needed.

```bash
# 1. Clone and enter
git clone https://github.com/<org>/alphadesk.git
cd alphadesk

# 2. Seed environment — copy the canonical template and fill in keys.
#    backend/.env.example is the authoritative list of supported env vars.
cp backend/.env.example backend/.env
# Edit backend/.env — set at minimum ALPACA_API_KEY, ALPACA_SECRET_KEY,
# JWT_SECRET, TRADINGVIEW_WEBHOOK_SECRET

# 3. Boot the stack
docker compose up -d

# 4. Open the app
open http://localhost:3000       # Dashboard
open http://localhost:8000/healthz   # Backend liveness
```

Services:

| Service    | Port | Purpose                                        |
|------------|------|------------------------------------------------|
| frontend   | 3000 | Next.js 16 dashboard / trade / pipeline UI     |
| backend    | 8000 | FastAPI — REST, websockets, pipeline runner    |
| timescale  | 5432 | Time-series + app DB                           |
| redis      | 6379 | Cache, halt state, idempotency, streams        |
| caddy      | 80/443 | Production edge (disabled locally by default) |

> The auto-generated OpenAPI docs at `/docs` are **disabled in production**
> (see `docker-compose.prod.yml`); they are only mounted when `DEBUG=true`
> in local dev.

---

## Configuration

All backend configuration is read from environment variables validated
by `core.config.Settings`. The canonical template is
[`backend/.env.example`](backend/.env.example) — it documents every
supported key, the default, and whether the service degrades gracefully
when the key is absent.

Keys you will always need:

| Key                        | Purpose                                |
|----------------------------|----------------------------------------|
| `JWT_SECRET`               | Session signing — 32+ random bytes     |
| `DATABASE_URL`             | TimescaleDB URL                        |
| `REDIS_URL`                | Redis URL                              |
| `ALPACA_API_KEY` / `ALPACA_SECRET_KEY` | Broker + market data       |
| `TRADINGVIEW_WEBHOOK_SECRET` | HMAC key for TV webhooks (see below) |

Optional but recommended: `POLYGON_API_KEY`, `FMP_API_KEY`,
`ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`,
`DISCORD_WEBHOOK_URL`.

### TradingView webhooks

The `/webhooks/tradingview` endpoint authenticates inbound alerts via
**HMAC-SHA256 over `timestamp:body`** keyed on
`TRADINGVIEW_WEBHOOK_SECRET`. Configure TradingView to send:

- `X-TV-Timestamp` — unix seconds of alert firing
- `X-TV-Signature` — hex-encoded `HMAC_SHA256(secret, "{ts}:{body}")`

The replay window is 120 s. The legacy `X-TV-Secret` / body-`secret`
fallback is accepted only during migration and is deprecated; switch
your alerts to the signature scheme as soon as practical.

---

## Operations

- **Deployment**: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) —
  CI/CD pipeline, GHCR image promotion, VPS layout, secrets sourcing
- **Rollback**: [`docs/ROLLBACK.md`](docs/ROLLBACK.md) —
  re-deploy a prior `image_sha` via `workflow_dispatch`, schema
  downgrade playbook
- **Runbook**: [`docs/RUNBOOK.md`](docs/RUNBOOK.md) —
  incident triage, common failure modes, on-call checklist
- **SAR workflow**: [`docs/SAR_WORKFLOW.md`](docs/SAR_WORKFLOW.md) —
  subject access request handling (GDPR art. 15)

Production server reference:

```bash
# SSH (admin only)
ssh -i ~/.ssh/alphadesk root@178.156.145.213
# Live URL
https://tradingalpha.net
```

---

## Tech stack

| Layer          | Technology                                            |
|----------------|-------------------------------------------------------|
| Edge           | Caddy 2 (TLS, HSTS, CSP, ACME, X-Request-ID)          |
| Frontend       | Next.js 16, React 19, TailwindCSS v4, Lightweight Charts v5 |
| Backend        | FastAPI 0.115, Python 3.12, uvloop, ORJSONResponse    |
| Data           | TimescaleDB (hypertables + continuous aggregates), Redis 7 |
| AI             | Claude Code CLI (primary), Anthropic API (fallback)   |
| Broker         | Alpaca (paper); IBKR planned                          |
| Infra          | Docker Compose, GitHub Actions CI/CD, Hetzner CCX13   |
| Observability  | structlog + X-Request-ID, Prometheus scrape endpoint  |

---

## Safety posture

- **Paper-only URLs** are enforced at the Alpaca client layer — a
  mis-configured key pointing at `live` refuses to open positions
- **Circuit breakers**: daily P&L floor, per-strategy drawdown stops,
  gross-exposure cap, max open positions, max daily trades
- **Live-trading allowlist**: strategies must be explicitly opted in to
  real capital via `STRATEGY_LIVE_DISABLED` / `STRATEGY_PAPER_ONLY`
  config sets
- **Outbound PII scrub**: every prompt sent to Claude passes through
  `_scrub_pii` (`backend/agents/base.py`) — usernames, UUIDs, JWTs,
  bearer tokens, Alpaca key prefixes, IPs, emails are redacted
- **Container hardening**: backend runs as `alphadesk` (uid 10001), not
  root; Trivy HIGH/CRITICAL image scan gates every deploy
