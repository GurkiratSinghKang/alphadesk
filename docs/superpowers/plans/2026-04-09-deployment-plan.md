# AlphaDesk Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy AlphaDesk to a Hetzner VPS with Docker Compose, Caddy, JWT auth, GitHub Actions CI/CD, and production hardening.

**Architecture:** Single VPS running all services via Docker Compose. Caddy handles SSL/routing. GitHub Actions builds images and pushes to GHCR, then SSHs into the VPS to pull and redeploy. JWT auth protects all endpoints for both web and future iOS app.

**Tech Stack:** FastAPI, Next.js 16, TimescaleDB, Redis, Caddy, Docker Compose, GitHub Actions, GHCR, python-jose, passlib, bcrypt

**Spec:** `docs/superpowers/specs/2026-04-09-deployment-design.md`

---

## Task 1: Add Auth Settings to Backend Config

**Files:**
- Modify: `backend/core/config.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add auth dependencies to requirements.txt**

Add these lines to `backend/requirements.txt` after the `orjson` line:

```
# Auth
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
```

- [ ] **Step 2: Add auth settings to config.py**

In `backend/core/config.py`, add these fields to the `Settings` class after the `SKIP_DB_INIT` field (line 72):

```python
    # --- Auth ---
    JWT_SECRET: SecretStr = SecretStr("")
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD_HASH: str = ""  # bcrypt hash
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30

    # --- Production ---
    PRODUCTION_ORIGIN: str = ""  # e.g. "https://alphadesk.example.com"
```

Add a validator to enforce JWT_SECRET in production. After the `sync_database_url` property:

```python
    @property
    def jwt_secret_value(self) -> str:
        val = self.JWT_SECRET.get_secret_value()
        if not val and self.is_production:
            raise ValueError("JWT_SECRET must be set in production")
        return val or "dev-insecure-secret-change-me"
```

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt backend/core/config.py
git commit -m "feat: add auth settings to backend config"
```

---

## Task 2: Implement JWT Auth Module

**Files:**
- Create: `backend/core/auth.py`

- [ ] **Step 1: Create core/auth.py**

Create `backend/core/auth.py`:

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)

ALGORITHM = "HS256"


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "access"},
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": subject, "exp": expire, "type": "refresh"},
        settings.jwt_secret_value,
        algorithm=ALGORITHM,
    )


def decode_token(token: str, expected_type: str = "access") -> dict[str, Any]:
    """Decode and validate a JWT. Raises HTTPException on failure."""
    try:
        payload = jwt.decode(token, settings.jwt_secret_value, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type")

    return payload


async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> str:
    """FastAPI dependency — validates Bearer token and returns username."""
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_token(credentials.credentials, expected_type="access")
    username: str | None = payload.get("sub")
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return username
```

- [ ] **Step 2: Verify the module imports cleanly**

Run from the `backend/` directory:

```bash
cd backend && python -c "from core.auth import create_access_token, require_auth; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add backend/core/auth.py
git commit -m "feat: add JWT auth module with token creation and validation"
```

---

## Task 3: Add Auth API Routes

**Files:**
- Create: `backend/api/routes/auth.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Create auth routes**

Create `backend/api/routes/auth.py`:

```python
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from core.auth import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from core.config import settings

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest) -> TokenResponse:
    if (
        request.username != settings.ADMIN_USERNAME
        or not settings.ADMIN_PASSWORD_HASH
        or not verify_password(request.password, settings.ADMIN_PASSWORD_HASH)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    return TokenResponse(
        access_token=create_access_token(request.username),
        refresh_token=create_refresh_token(request.username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshRequest) -> TokenResponse:
    payload = decode_token(request.refresh_token, expected_type="refresh")
    username = payload.get("sub", "")

    return TokenResponse(
        access_token=create_access_token(username),
        refresh_token=create_refresh_token(username),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
```

- [ ] **Step 2: Register auth router in main.py**

In `backend/main.py`, add the import at line 15 (with the other route imports):

```python
from api.routes import market, screener, analysis, options, trades, portfolio, agents, webhooks
from api.routes import symbols, strategies, market_overview, risk, pipeline, news
from api.routes import auth as auth_routes
```

Add the router registration after the existing routers (after line 132, the news router):

```python
# --- Auth (no auth required on these endpoints) ---
app.include_router(auth_routes.router, prefix="/api/v1/auth", tags=["Auth"])
```

- [ ] **Step 3: Apply require_auth to all existing routers**

In `backend/main.py`, add the import:

```python
from core.auth import require_auth
```

Update every `app.include_router(...)` call to add `dependencies=[Depends(require_auth)]`. The import for `Depends` comes from `fastapi`. Add it to the existing import:

```python
from fastapi import FastAPI, Depends
```

Update each router line. For example:

```python
app.include_router(market.router, prefix="/api/v1/market", tags=["Market Data"], dependencies=[Depends(require_auth)])
app.include_router(screener.router, prefix="/api/v1/screener", tags=["Screener"], dependencies=[Depends(require_auth)])
# ... same pattern for all existing routers EXCEPT auth and webhooks
```

The webhooks router keeps its own secret-based auth:

```python
app.include_router(webhooks.router, prefix="/api/v1/webhooks", tags=["Webhooks"])
```

The auth router has no auth dependency (already registered above without it).

- [ ] **Step 4: Trim /health endpoint in production**

In `backend/main.py`, update the health endpoint:

```python
@app.get("/health", tags=["Health"])
async def health_check() -> dict:
    if settings.is_production:
        return {"status": "ok"}
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT.value,
        "version": app.version,
    }
```

- [ ] **Step 5: Update CORS to include production origin**

In `backend/main.py`, update the CORS middleware origins:

```python
cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
if settings.PRODUCTION_ORIGIN:
    cors_origins.append(settings.PRODUCTION_ORIGIN)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

- [ ] **Step 6: Verify backend starts with auth**

```bash
cd backend && SKIP_DB_INIT=true python -c "import main; print(f'Routes: {len(main.app.routes)}')"
```

Expected: prints route count without errors.

- [ ] **Step 7: Commit**

```bash
git add backend/api/routes/auth.py backend/main.py
git commit -m "feat: add auth login/refresh endpoints and protect all API routes with JWT"
```

---

## Task 4: Add WebSocket Authentication

**Files:**
- Modify: `backend/api/websocket/handler.py`

- [ ] **Step 1: Update websocket_endpoint to require auth before accept**

In `backend/api/websocket/handler.py`, replace the `websocket_endpoint` function (lines 171-218) with:

```python
async def websocket_endpoint(ws: WebSocket) -> None:
    """Main WebSocket endpoint handler.

    Protocol:
      Client must authenticate first:
        {"action": "auth", "token": "<jwt>"}

      Then can subscribe/unsubscribe:
        {"action": "subscribe", "channel": "quotes"}
        {"action": "unsubscribe", "channel": "quotes"}
        {"action": "ping"}
    """
    # Wait for auth before accepting
    await ws.accept()

    try:
        # Require auth as first message within 5 seconds
        import asyncio
        from core.auth import decode_token

        try:
            raw = await asyncio.wait_for(ws.receive_text(), timeout=5.0)
            msg = orjson.loads(raw)
            if msg.get("action") != "auth" or not msg.get("token"):
                await ws.send_bytes(orjson.dumps({"error": "First message must be auth"}))
                await ws.close(code=4001, reason="Auth required")
                return
            decode_token(msg["token"], expected_type="access")
            await ws.send_bytes(orjson.dumps({"type": "authenticated"}))
        except asyncio.TimeoutError:
            await ws.close(code=4001, reason="Auth timeout")
            return
        except Exception:
            await ws.send_bytes(orjson.dumps({"error": "Invalid token"}))
            await ws.close(code=4001, reason="Auth failed")
            return

        # Auth passed — register connection
        async with manager._lock:
            manager._connections[ws] = set()
            count = len(manager._connections)
        logger.info("WebSocket client authenticated (%d active)", count)

        await _ensure_listener_started()

        while True:
            raw = await ws.receive_text()
            try:
                msg = orjson.loads(raw)
            except Exception:
                await manager._send(ws, {"error": "Invalid JSON"})
                continue

            action = msg.get("action", "")

            if action == "subscribe":
                channel = msg.get("channel", "")
                await manager.subscribe_client(ws, channel)
            elif action == "unsubscribe":
                channel = msg.get("channel", "")
                await manager.unsubscribe_client(ws, channel)
            elif action == "ping":
                await manager._send(ws, {"type": "pong"})
            else:
                await manager._send(ws, {"error": f"Unknown action: {action}"})

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("WebSocket error: %s", exc)
    finally:
        await manager.disconnect(ws)
        await _maybe_stop_listener()
```

- [ ] **Step 2: Commit**

```bash
git add backend/api/websocket/handler.py
git commit -m "feat: add JWT auth to WebSocket endpoint"
```

---

## Task 5: Frontend Login Page

**Files:**
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/app/login/layout.tsx`

- [ ] **Step 1: Create login layout (no TopBar)**

Create `frontend/src/app/login/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export default function LoginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create login page**

Create `frontend/src/app/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "";
      const res = await fetch(`${apiBase}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail ?? "Invalid credentials");
        return;
      }

      const data = await res.json();

      // Store tokens in cookies (httpOnly would require a backend proxy,
      // so we use regular cookies + short expiry for simplicity)
      document.cookie = `access_token=${data.access_token}; path=/; max-age=${data.expires_in}; SameSite=Strict; Secure`;
      document.cookie = `refresh_token=${data.refresh_token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict; Secure`;

      router.push("/");
    } catch {
      setError("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm space-y-6 p-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold text-foreground">AlphaDesk</span>
        </div>
        <p className="text-sm text-muted-foreground">Sign in to your trading terminal</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs text-muted-foreground">Username</label>
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            className="mt-1"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Password</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="mt-1"
          />
        </div>

        {error && (
          <p className="text-xs text-[var(--loss)]">{error}</p>
        )}

        <Button type="submit" className="w-full" disabled={loading || !username || !password}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Sign In
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/login/
git commit -m "feat: add login page for JWT authentication"
```

---

## Task 6: Frontend Auth Middleware and API Changes

**Files:**
- Create: `frontend/src/middleware.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/useWebSocket.ts`
- Modify: `frontend/src/env.ts`

- [ ] **Step 1: Create Next.js auth middleware**

Create `frontend/src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!token && !isLoginPage) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (token && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files, _next internals, and api
    "/((?!_next/static|_next/image|favicon.ico|api).*)",
  ],
};
```

- [ ] **Step 2: Update env.ts for relative paths**

Replace `frontend/src/env.ts`:

```typescript
export const env = {
  API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
  WS_URL: process.env.NEXT_PUBLIC_WS_URL ?? "",
} as const;
```

- [ ] **Step 3: Update apiFetch in api.ts for auth + relative paths**

In `frontend/src/lib/api.ts`, replace the `apiFetch` function:

```typescript
function getAccessToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|; )access_token=([^;]*)/);
  return match?.[1];
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = typeof window !== "undefined"
    ? (env.API_URL || "")
    : (env.API_URL || "http://localhost:8000");
  const url = `${base}${path}`;

  const token = getAccessToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && typeof window !== "undefined") {
    // Token expired — redirect to login
    document.cookie = "access_token=; path=/; max-age=0";
    document.cookie = "refresh_token=; path=/; max-age=0";
    window.location.href = "/login";
    throw new Error("Session expired");
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${res.statusText} – ${body}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Update useWebSocket.ts to derive wss:// URL and send auth**

In `frontend/src/hooks/useWebSocket.ts`, update the `connect` function.

Replace the line `const ws = new WebSocket(env.WS_URL);` (around line 51) with:

```typescript
      const wsUrl = env.WS_URL || (
        typeof window !== "undefined"
          ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`
          : "ws://localhost:8000/ws"
      );
      const ws = new WebSocket(wsUrl);
```

In the `ws.onopen` handler, send auth before subscribing. Replace the `ws.onopen` block with:

```typescript
      ws.onopen = () => {
        // Send auth token first
        const token = document.cookie.match(/(?:^|; )access_token=([^;]*)/)?.[1];
        if (token) {
          ws.send(JSON.stringify({ action: "auth", token }));
        }

        setIsConnected(true);
        retriesRef.current = 0;

        // Re-subscribe to all channels after a short delay for auth to process
        setTimeout(() => {
          subscribedChannels.current.forEach((channel) => {
            ws.send(JSON.stringify({ action: "subscribe", channel }));
          });
        }, 100);
      };
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/middleware.ts frontend/src/env.ts frontend/src/lib/api.ts frontend/src/hooks/useWebSocket.ts
git commit -m "feat: add auth middleware, relative API paths, and WebSocket auth"
```

---

## Task 7: Backend Production Hardening

**Files:**
- Modify: `backend/Dockerfile`
- Modify: `backend/core/database.py`
- Modify: `backend/data/ingestion/pipeline_runner.py`

- [ ] **Step 1: Switch Dockerfile CMD to gunicorn**

In `backend/Dockerfile`, replace the last line:

```dockerfile
CMD ["gunicorn", "main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "1", "--bind", "0.0.0.0:8000", "--timeout", "120", "--graceful-timeout", "30"]
```

Add gunicorn to `backend/requirements.txt` (after the `uvicorn` line):

```
gunicorn>=23.0.0
```

- [ ] **Step 2: Reduce database pool size**

In `backend/core/database.py`, update `_get_engine` (line 47-48):

```python
            pool_size=5,
            max_overflow=5,
```

- [ ] **Step 3: Persist pipeline scheduler state in Redis**

In `backend/data/ingestion/pipeline_runner.py`, update the `_scheduler_loop` function.

Replace the `last_morning: str | None = None` and `last_afternoon: str | None = None` initialization with Redis reads:

```python
    # Load last run state from Redis (survives container restarts)
    from core.redis import cache_get, cache_set

    state = await cache_get("pipeline:scheduler_state") or {}
    last_morning: str | None = state.get("last_morning")
    last_afternoon: str | None = state.get("last_afternoon")
```

After each `last_morning = today` assignment, persist to Redis:

```python
                    last_morning = today
                    await cache_set("pipeline:scheduler_state", {"last_morning": last_morning, "last_afternoon": last_afternoon}, ttl_seconds=86400)
```

After each `last_afternoon = today` assignment, do the same:

```python
                    last_afternoon = today
                    await cache_set("pipeline:scheduler_state", {"last_morning": last_morning, "last_afternoon": last_afternoon}, ttl_seconds=86400)
```

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/requirements.txt backend/core/database.py backend/data/ingestion/pipeline_runner.py
git commit -m "feat: production hardening — gunicorn, smaller pool, pipeline state persistence"
```

---

## Task 8: Production Docker Compose and Caddyfile

**Files:**
- Create: `infrastructure/Caddyfile`
- Create: `infrastructure/docker-compose.prod.yml`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Create Caddyfile**

Create `infrastructure/Caddyfile`:

```
{$DOMAIN:localhost} {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /ws {
        reverse_proxy backend:8000
    }
    handle /status/* {
        reverse_proxy uptime-kuma:3001
    }
    handle {
        reverse_proxy frontend:3000
    }
}
```

- [ ] **Step 2: Create docker-compose.prod.yml**

Create `infrastructure/docker-compose.prod.yml`:

```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN:-localhost}
    volumes:
      - ./infrastructure/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      backend:
        condition: service_healthy
    networks:
      - alphadesk

  frontend:
    image: ${FRONTEND_IMAGE:-ghcr.io/OWNER/alphadesk-frontend:latest}
    restart: unless-stopped
    volumes: []
    networks:
      - alphadesk
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  backend:
    image: ${BACKEND_IMAGE:-ghcr.io/OWNER/alphadesk-backend:latest}
    restart: unless-stopped
    env_file: .env.prod
    volumes: []
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8000/health"]
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
    volumes:
      - /var/lib/alphadesk/timescaledb:/var/lib/postgresql/data
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
    volumes:
      - /var/lib/alphadesk/redis:/data
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

- [ ] **Step 3: Clean up base docker-compose.yml for prod compatibility**

In the root `docker-compose.yml`, remove the `volumes` bind-mounts from the `frontend` and `backend` services. Keep them only in a new `docker-compose.dev.yml` if needed for local dev. For now, just remove:

```yaml
    # Remove these from frontend service:
    volumes:
      - ./frontend:/app
      - /app/node_modules

    # Remove these from backend service:
    volumes:
      - ./backend:/app
```

Also remove the `celery_worker` service (it's not used and references a non-existent `core.celery_app`).

- [ ] **Step 4: Commit**

```bash
git add infrastructure/Caddyfile infrastructure/docker-compose.prod.yml docker-compose.yml
git commit -m "feat: add production Docker Compose with Caddy, Uptime Kuma, and host-path volumes"
```

---

## Task 9: GitHub Actions CI/CD Pipeline

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Create deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy AlphaDesk

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

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
            export FRONTEND_IMAGE=ghcr.io/${{ github.repository }}-frontend:${{ github.sha }}
            export BACKEND_IMAGE=ghcr.io/${{ github.repository }}-backend:${{ github.sha }}
            docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml pull frontend backend
            docker compose -f docker-compose.yml -f infrastructure/docker-compose.prod.yml up -d
            sleep 10
            curl -sf http://localhost:8000/health || (echo "Health check failed!" && exit 1)
            docker system prune -f --filter "until=24h"
            echo "Deploy successful: ${{ github.sha }}"
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add GitHub Actions CI/CD pipeline for automated deployment"
```

---

## Task 10: VPS Setup Script and Backup Script

**Files:**
- Create: `infrastructure/vps-setup.sh`
- Create: `infrastructure/backup.sh`
- Create: `infrastructure/.env.prod.example`

- [ ] **Step 1: Create VPS setup script**

Create `infrastructure/vps-setup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== AlphaDesk VPS Setup ==="

# Create deploy user
if ! id deploy &>/dev/null; then
    adduser --disabled-password --gecos "" deploy
    usermod -aG docker deploy
    echo "Created deploy user"
fi

# SSH hardening
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
echo "SSH hardened"

# Firewall
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Firewall configured"

# Prevent Docker from bypassing UFW
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "iptables": false,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker
echo "Docker configured"

# Swap
if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "2GB swap created"
fi

# Fail2ban
apt-get update -qq
apt-get install -y -qq fail2ban rclone curl
systemctl enable fail2ban
echo "Fail2ban installed"

# Data directories
mkdir -p /var/lib/alphadesk/{timescaledb,redis,uptime-kuma}
chown -R deploy:deploy /var/lib/alphadesk

# App directory
mkdir -p /opt/alphadesk
chown deploy:deploy /opt/alphadesk

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Copy your SSH public key to /home/deploy/.ssh/authorized_keys"
echo "  2. Copy the project files to /opt/alphadesk/"
echo "  3. Create /opt/alphadesk/.env.prod from .env.prod.example"
echo "  4. Set up GitHub Actions secrets (VPS_HOST, VPS_SSH_KEY)"
echo "  5. Configure rclone for backups: rclone config"
echo "  6. Add backup cron: crontab -e -u deploy"
```

- [ ] **Step 2: Create backup script**

Create `infrastructure/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/tmp/alphadesk-backups"
DATE=$(date +%Y%m%d)
REMOTE="hetzner-s3:alphadesk-backups"

mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup..."

# Dump database
docker exec alphadesk-timescaledb pg_dump -U alphadesk alphadesk | gzip > "$BACKUP_DIR/db-$DATE.sql.gz"
echo "Database dumped"

# Copy to remote storage
rclone copy "$BACKUP_DIR/db-$DATE.sql.gz" "$REMOTE/daily/"
echo "Uploaded to remote"

# Clean up local files
rm -f "$BACKUP_DIR"/db-*.sql.gz

# Retain only 7 daily backups remotely
rclone delete "$REMOTE/daily/" --min-age 8d 2>/dev/null || true

echo "[$(date)] Backup complete"
```

- [ ] **Step 3: Create .env.prod.example**

Create `infrastructure/.env.prod.example`:

```bash
# === AlphaDesk Production Environment ===
# Copy to /opt/alphadesk/.env.prod and fill in real values

ENVIRONMENT=prod
DEBUG=false
LOG_LEVEL=WARNING
SKIP_DB_INIT=true

# Database (internal Docker network)
DATABASE_URL=postgresql+asyncpg://alphadesk:CHANGE_THIS_PASSWORD@timescaledb:5432/alphadesk

# Redis (internal Docker network)
REDIS_URL=redis://redis:6379/0

# Auth
JWT_SECRET=GENERATE_A_RANDOM_64_CHAR_STRING
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=GENERATE_WITH_python_-c_"from_passlib.context_import_CryptContext;print(CryptContext(schemes=['bcrypt']).hash('your-password'))"

# Production domain (for CORS)
PRODUCTION_ORIGIN=https://alphadesk.yourdomain.com

# Domain (for Caddy)
DOMAIN=alphadesk.yourdomain.com

# Alpaca
ALPACA_API_KEY=your-key
ALPACA_SECRET_KEY=your-secret
ALPACA_BASE_URL=https://paper-api.alpaca.markets

# AI
ANTHROPIC_API_KEY=your-key

# Optional: Polygon, News, Telegram, etc.
POLYGON_API_KEY=
NEWSDATA_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

- [ ] **Step 4: Make scripts executable and commit**

```bash
chmod +x infrastructure/vps-setup.sh infrastructure/backup.sh
git add infrastructure/vps-setup.sh infrastructure/backup.sh infrastructure/.env.prod.example
git commit -m "feat: add VPS setup script, backup script, and production env template"
```

---

## Task 11: Generate Admin Password Hash and Test Locally

- [ ] **Step 1: Generate a bcrypt password hash**

Run:

```bash
cd backend && python -c "from passlib.context import CryptContext; print(CryptContext(schemes=['bcrypt']).hash('your-chosen-password'))"
```

Copy the output hash (starts with `$2b$`).

- [ ] **Step 2: Add auth env vars to local .env**

Add to `backend/.env` (or the root `.env`):

```
JWT_SECRET=dev-local-secret-at-least-32-chars-long
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=$2b$12$THE_HASH_FROM_STEP_1
```

- [ ] **Step 3: Test the full auth flow locally**

Start the backend:

```bash
cd backend && SKIP_DB_INIT=true python -m uvicorn main:app --port 8000
```

Test login:

```bash
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-chosen-password"}'
```

Expected: JSON with `access_token`, `refresh_token`, `expires_in`.

Test protected endpoint without token:

```bash
curl -s http://localhost:8000/api/v1/market/quotes/SPY
```

Expected: `401 Unauthorized`

Test protected endpoint with token:

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-chosen-password"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/market/quotes/SPY
```

Expected: SPY quote JSON.

- [ ] **Step 4: Test the frontend login page**

Start the frontend and navigate to `http://localhost:3000`. You should be redirected to `/login`. Enter credentials. After login, you should be redirected to the dashboard.

- [ ] **Step 5: Commit any adjustments**

```bash
git add -A
git commit -m "chore: verify auth flow works end-to-end"
```
