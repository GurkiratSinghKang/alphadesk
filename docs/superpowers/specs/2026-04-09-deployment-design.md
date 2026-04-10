# AlphaDesk Deployment Design

**Date**: 2026-04-09
**Status**: Draft
**Scope**: Production deployment of AlphaDesk to a single Hetzner VPS with CI/CD, auth, and future iOS app support

---

## 1. Overview

Deploy the AlphaDesk trading platform (Next.js frontend + FastAPI backend + TimescaleDB + Redis) to a single Hetzner VPS behind Caddy, with GitHub Actions CI/CD, JWT authentication, and a custom domain. The system must run the trading pipeline 24/7 and be accessible from any device including a future iOS app.

### Design Principles

- **Portable**: Everything runs in Docker. Moving to AWS/GCP/Railway later requires zero code changes.
- **Modular**: Each service is independently deployable. Auth, API, pipeline, and frontend are separate concerns.
- **Single-user for now, public-ready later**: Auth and API design support multi-user without structural changes.

### Cost

| Item | Cost |
|---|---|
| Hetzner CX22 (2 vCPU, 4GB, 40GB) | ~$5/mo |
| Domain (if not already owned) | ~$10/year |
| Cloudflare DNS | Free |
| GitHub Actions CI/CD | Free (2000 min/mo) |
| Hetzner Object Storage (backups) | ~$1/mo |
| **Total** | **~$6-7/mo** |

Upgrade path: CX32 (4 vCPU, 8GB) for ~$10/mo if memory pressure appears.

---

## 2. Infrastructure Architecture

```
Internet
   │
   ▼
Cloudflare DNS (alphadesk.yourdomain.com → VPS IP)
   │
   ▼
┌─────────────────────────────────────────────────────────────┐
│  Hetzner VPS                                                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Docker Compose                                      │   │
│  │                                                      │   │
│  │  ┌─────────┐                                         │   │
│  │  │  Caddy   │ :80/:443 (only exposed ports)          │   │
│  │  │  (SSL)   │                                        │   │
│  │  └────┬─────┘                                        │   │
│  │       │                                              │   │
│  │       ├── /*           → frontend:3000               │   │
│  │       ├── /api/*       → backend:8000                │   │
│  │       └── /ws          → backend:8000                │   │
│  │                                                      │   │
│  │  ┌───────────┐  ┌───────────┐                        │   │
│  │  │ Frontend  │  │  Backend  │                        │   │
│  │  │ Next.js   │  │  FastAPI  │                        │   │
│  │  │ :3000     │  │  :8000    │                        │   │
│  │  └───────────┘  └─────┬─────┘                        │   │
│  │                       │                              │   │
│  │              ┌────────┼────────┐                     │   │
│  │              ▼                 ▼                     │   │
│  │  ┌───────────────┐  ┌──────────────┐                 │   │
│  │  │  TimescaleDB   │  │    Redis     │                │   │
│  │  │  :5432         │  │    :6379     │                │   │
│  │  │  (host volume) │  │  (AOF on)    │                │   │
│  │  └───────────────┘  └──────────────┘                 │   │
│  │                                                      │   │
│  │  ┌───────────────┐                                   │   │
│  │  │  Uptime Kuma  │  (monitoring, :3001 internal)     │   │
│  │  └───────────────┘                                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Cron: pg_dump → Hetzner Object Storage (daily)             │
│  Swap: 2GB swapfile                                         │
└─────────────────────────────────────────────────────────────┘
```

### Key Decisions

- **Only ports 80 and 443 are exposed** to the internet (via Caddy). All other services are internal Docker network only.
- **TimescaleDB data is mounted to a host path** (`/var/lib/alphadesk/timescaledb/`) rather than a Docker named volume, so `docker compose down -v` cannot accidentally wipe it.
- **Redis has AOF persistence** enabled and a 512MB memory cap.
- **2GB swap file** configured on the VPS as OOM protection.
- **Docker's iptables bypass of UFW** is mitigated by not publishing any ports except through Caddy.

---

## 3. Authentication

### Design

Single-user JWT auth that works for both the web app and future iOS app.

**Backend (`core/auth.py`):**

- New settings in `core/config.py`:
  - `JWT_SECRET: SecretStr` (required in prod, validated by model_validator)
  - `ADMIN_USERNAME: str`
  - `ADMIN_PASSWORD_HASH: str` (bcrypt hash)
  - `ACCESS_TOKEN_EXPIRE_MINUTES: int = 30`
  - `REFRESH_TOKEN_EXPIRE_DAYS: int = 30`
- `POST /api/v1/auth/login` — accepts `{username, password}`, returns `{access_token, refresh_token, token_type, expires_in}`
- `POST /api/v1/auth/refresh` — accepts `{refresh_token}`, returns new access token
- `require_auth` dependency — validates Bearer token from `Authorization` header. Returns 401 on invalid/expired token.
- Applied to all routes except: `/health`, `/api/v1/auth/login`, `/api/v1/auth/refresh`
- `/api/v1/webhooks/*` routes use their existing shared-secret auth, exempt from JWT, with rate limiting (10 req/min)

**WebSocket auth:**

- `websocket_endpoint` does NOT call `ws.accept()` immediately
- Waits for first message: `{"action": "auth", "token": "<jwt>"}`
- Validates JWT. If valid, accepts and proceeds. If invalid or 5-second timeout, closes with code 4001.

**Frontend (`middleware.ts`):**

- New `src/middleware.ts` intercepts all routes except `/login` and `/_next/`
- Checks for `access_token` cookie. If missing or expired, redirects to `/login`
- `/login` page: simple username/password form, calls `/api/v1/auth/login`, stores tokens in httpOnly cookies
- Auto-refresh: a client-side interval checks token expiry and calls `/api/v1/auth/refresh` before it expires
- `apiFetch` updated: reads token from cookie, sends as `Authorization: Bearer` header, adds `credentials: 'include'`

**iOS app (future):**

- Same login endpoint, stores JWT in iOS Keychain
- Sends token via `Authorization: Bearer` header
- Refresh token handles silent re-auth

### Health endpoint

`/health` returns only `{"status": "ok"}` in production (no environment leak).

---

## 4. Frontend Changes for Production

### Relative API paths

The current `env.ts` uses `NEXT_PUBLIC_API_URL` which gets baked into the JS bundle at build time. Since Caddy proxies everything on the same domain, the frontend should use **relative paths**.

**Changes to `lib/api.ts`:**

```typescript
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // path is already relative like "/api/v1/market/quotes/SPY"
  // In production, this resolves to the same domain (via Caddy)
  // In development, use env override for absolute URL
  const base = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL ?? '')
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000');
  const url = `${base}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    credentials: 'include',
    ...init,
  });
  // ... rest unchanged
}
```

- In production: `NEXT_PUBLIC_API_URL` is not set, so browser-side fetches use relative paths (`/api/v1/...`) which Caddy routes correctly
- In development: `NEXT_PUBLIC_API_URL=http://localhost:8000` in `.env.local` (already exists)
- Server-side rendering: uses the env var or falls back to localhost

**Changes to `hooks/useWebSocket.ts`:**

```typescript
// Derive WS URL from current page location in production
const wsUrl = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_WS_URL ?? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`)
  : 'ws://localhost:8000/ws';
```

This eliminates the `wss://` mixed-content problem entirely.

### Login page

New `src/app/login/page.tsx` — outside the `(dashboard)` layout group so it doesn't render TopBar. Simple form with username/password fields and error display.

### Docker build

The frontend Dockerfile does NOT need `NEXT_PUBLIC_*` build args since we use relative paths. The existing multi-stage build works as-is.

---

## 5. Backend Changes for Production

### CORS

Update `main.py` to allow the production domain:

```python
allow_origins=[
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    settings.PRODUCTION_ORIGIN,  # e.g. "https://alphadesk.yourdomain.com"
]
```

New setting: `PRODUCTION_ORIGIN: str = ""` in `core/config.py`.

### Process management

Replace raw `uvicorn` with gunicorn as process supervisor:

```dockerfile
CMD ["gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker", \
     "-w", "1", "--bind", "0.0.0.0:8000", "--timeout", "120", \
     "--graceful-timeout", "30"]
```

Single worker is correct for async FastAPI. Gunicorn adds automatic restart on crash.

### Database connection pool

Reduce pool size for single-VPS deployment:

```python
# In core/database.py
pool_size=5,
max_overflow=5,
```

### Pipeline resilience

The trading pipeline scheduler currently uses in-memory state (`asyncio.Task` + `last_morning` variable). A container restart loses this state.

**Fix**: Persist pipeline state in Redis:

- `pipeline:last_run` — ISO timestamp of last successful run
- `pipeline:schedule_lock` — distributed lock to prevent duplicate runs
- On startup, the scheduler reads `pipeline:last_run` from Redis to determine if today's run already happened
- The pipeline endpoint `POST /api/v1/pipeline/run` can always trigger a manual run regardless

This makes deploys safe: the container restarts, reads state from Redis, and picks up where it left off.

### Graceful shutdown

Add a `SIGTERM` handler in the lifespan that:
1. Stops accepting new WebSocket connections
2. Waits for in-flight API requests to complete (gunicorn's `--graceful-timeout`)
3. Closes the Alpaca stream cleanly
4. Flushes any pending pipeline state to Redis

---

## 6. Docker Compose — Production

Two compose files: `docker-compose.yml` (base, used for both dev and prod) and `docker-compose.prod.yml` (production overrides).

### `docker-compose.prod.yml`

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./infrastructure/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_started
    networks:
      - alphadesk

  frontend:
    image: ghcr.io/OWNER/alphadesk-frontend:latest
    restart: unless-stopped
    # NO volume mounts — standalone build is self-contained
    networks:
      - alphadesk
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  backend:
    image: ghcr.io/OWNER/alphadesk-backend:latest
    restart: unless-stopped
    env_file: .env.prod
    # NO volume mounts in prod
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    networks:
      - alphadesk
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  timescaledb:
    image: timescale/timescaledb:latest-pg16
    restart: unless-stopped
    volumes:
      - /var/lib/alphadesk/timescaledb:/var/lib/postgresql/data  # host path, not named volume
    environment:
      POSTGRES_USER: alphadesk
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: alphadesk
    command:
      - postgres
      - -c
      - shared_buffers=512MB
      - -c
      - work_mem=16MB
      - -c
      - max_connections=50
    networks:
      - alphadesk
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    volumes:
      - /var/lib/alphadesk/redis:/data  # host path
    networks:
      - alphadesk
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  uptime-kuma:
    image: louislam/uptime-kuma:1
    restart: unless-stopped
    volumes:
      - /var/lib/alphadesk/uptime-kuma:/app/data
    networks:
      - alphadesk

networks:
  alphadesk:
    driver: bridge

volumes:
  caddy_data:
  caddy_config:
```

**Key differences from dev compose:**
- Images pulled from GHCR (not built locally)
- No source code volume mounts
- Host-path volumes for data persistence
- Log rotation on all services
- Health checks on backend
- Caddy added as reverse proxy
- Uptime Kuma added for monitoring
- Tuned Postgres settings for 4GB RAM
- No ports exposed except Caddy's 80/443

### Caddyfile

```
alphadesk.yourdomain.com {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /ws {
        reverse_proxy backend:8000
    }
    handle {
        reverse_proxy frontend:3000
    }
}
```

---

## 7. CI/CD — GitHub Actions

### Workflow: `.github/workflows/deploy.yml`

```yaml
name: Deploy AlphaDesk

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push frontend
        uses: docker/build-push-action@v6
        with:
          context: ./frontend
          push: true
          tags: |
            ghcr.io/${{ github.repository }}-frontend:${{ github.sha }}
            ghcr.io/${{ github.repository }}-frontend:latest

      - name: Build and push backend
        uses: docker/build-push-action@v6
        with:
          context: ./backend
          push: true
          tags: |
            ghcr.io/${{ github.repository }}-backend:${{ github.sha }}
            ghcr.io/${{ github.repository }}-backend:latest

      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: deploy
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/alphadesk
            docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
            docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
            sleep 10
            curl -f http://localhost:8000/health || (echo "Health check failed" && exit 1)
            docker system prune -f
```

### GitHub Secrets required

| Secret | Purpose |
|---|---|
| `VPS_HOST` | Hetzner VPS IP address |
| `VPS_SSH_KEY` | SSH private key for `deploy` user |

`GITHUB_TOKEN` is provided automatically by GitHub Actions for GHCR access.

### Rollback

If the health check fails, the workflow exits with error. Rollback is manual: SSH in and run `docker compose up -d` with the previous image SHA tag. Image tags are immutable in GHCR so any prior version can be restored.

---

## 8. VPS Setup (One-time)

### Server hardening

```bash
# Create deploy user
adduser deploy
usermod -aG docker deploy

# SSH hardening
sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# Firewall — only allow SSH + HTTP/HTTPS
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable

# Prevent Docker from bypassing UFW
# In /etc/docker/daemon.json:
# { "iptables": false }
# Then configure Caddy as the only ingress point (no published ports on other containers)

# Swap
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Fail2ban
apt install fail2ban -y
systemctl enable fail2ban

# Data directories
mkdir -p /var/lib/alphadesk/{timescaledb,redis,uptime-kuma}
chown -R deploy:deploy /var/lib/alphadesk

# App directory
mkdir -p /opt/alphadesk
chown deploy:deploy /opt/alphadesk
```

### Backup cron

```bash
# /etc/cron.d/alphadesk-backup
0 3 * * * deploy docker exec alphadesk-timescaledb pg_dump -U alphadesk alphadesk | gzip > /tmp/alphadesk-backup-$(date +\%Y\%m\%d).sql.gz && \
  rclone copy /tmp/alphadesk-backup-$(date +\%Y\%m\%d).sql.gz hetzner-s3:alphadesk-backups/daily/ && \
  rm /tmp/alphadesk-backup-*.sql.gz
```

Retention: 7 daily + 4 weekly snapshots managed by rclone or a simple cleanup script.

### Monitoring

Uptime Kuma runs as a container, accessible internally through Caddy at a path like `/status/` (password-protected). Monitors:

- `http://backend:8000/health` — backend health
- `http://frontend:3000` — frontend health
- `tcp://timescaledb:5432` — database connectivity
- `tcp://redis:6379` — Redis connectivity

Alerts via Telegram bot (already configured in AlphaDesk settings).

---

## 9. Files to Create or Modify

### New files

| File | Purpose |
|---|---|
| `backend/core/auth.py` | JWT token creation, validation, `require_auth` dependency |
| `backend/api/middleware.py` | Auth middleware wiring, rate limiting for webhooks |
| `backend/api/routes/auth.py` | Login and refresh endpoints |
| `frontend/src/middleware.ts` | Next.js middleware for auth redirect |
| `frontend/src/app/login/page.tsx` | Login page |
| `infrastructure/Caddyfile` | Reverse proxy configuration |
| `infrastructure/docker-compose.prod.yml` | Production compose overrides |
| `infrastructure/vps-setup.sh` | One-time VPS setup script |
| `infrastructure/backup.sh` | Database backup script |
| `.github/workflows/deploy.yml` | CI/CD pipeline |

### Modified files

| File | Change |
|---|---|
| `backend/core/config.py` | Add JWT_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, PRODUCTION_ORIGIN, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS |
| `backend/main.py` | Add CORS production origin, register auth router, apply require_auth globally, trim /health response in prod |
| `backend/Dockerfile` | Switch CMD to gunicorn |
| `backend/api/websocket/handler.py` | Add JWT validation before ws.accept() |
| `backend/data/ingestion/pipeline_runner.py` | Persist scheduler state in Redis |
| `backend/core/database.py` | Reduce pool_size to 5 |
| `frontend/src/lib/api.ts` | Use relative paths, add credentials: 'include' |
| `frontend/src/hooks/useWebSocket.ts` | Derive wss:// URL from window.location |
| `frontend/src/env.ts` | Make API_URL optional (empty string = relative paths) |
| `docker-compose.yml` | Remove frontend/backend volume mounts, keep as base config |

---

## 10. Implementation Order

1. **Auth module** (backend + frontend login page + middleware)
2. **Frontend production changes** (relative paths, WS URL, credentials)
3. **Backend production hardening** (CORS, gunicorn, pool size, pipeline state)
4. **Infrastructure files** (Caddyfile, prod compose, GitHub Actions)
5. **VPS provisioning** (Hetzner setup, SSH keys, domain, DNS)
6. **First deploy** (push to main, verify CI/CD, test from browser)
7. **Monitoring + backups** (Uptime Kuma, pg_dump cron)
