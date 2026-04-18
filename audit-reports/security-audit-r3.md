# AlphaDesk Security Audit (Round 3)

**Scope:** defensive audit of /Users/GK/Downloads/alphadesk (FastAPI + Next.js, JWT-auth, Caddy + Hetzner).
**Commit:** feature/deployment @ 5f57ada
**Auditor:** Claude (authorized engagement)
**Date:** 2026-04-18

---

## Summary

Overall the backend auth surface is in **good shape**: all `backend/api/routes/*` routers are mounted with `dependencies=[Depends(require_auth)]` (except `auth.py` — intentional — and `webhooks.py` — HMAC-gated). JWT secret hard-fails if unset, cookies are HttpOnly/Secure/SameSite=strict, login is rate-limited, and refresh-token rotation is properly single-use. Wave 4's SQL injection fix has held; the remaining two `f"...{col}..."` interpolations in `trade_ledger.py` are **safe** (column allow-list + raise-on-unknown, values parameterised).

However a few **P0-class** issues remain:

* Admin-only endpoints (`/strategies/admin/risk-monitor`, `/strategies/admin/leaderboard`) are not role-gated — *any* authenticated user can flip a process-global that disables every P1-P4 risk check, enabling unrestricted trading.
* A **single admin account** with no MFA + a 480-minute access-token lifetime is the entire human-identity model. If the bcrypt hash leaks, no second factor stops an attacker.
* `docker-compose.prod.yml` defaults `POSTGRES_PASSWORD=alphadesk_dev` if unset — one missing env var = prod DB with a publicly-known password.

Everything below is ordered by severity then file.

---

### [P0] Admin endpoints not role-gated — any authenticated user can disable the global risk monitor
**File:** backend/api/routes/strategies.py:1312-1343
**Vulnerability class:** Broken Access Control (BOLA / BFLA)
**Description:** `POST /api/v1/strategies/admin/risk-monitor` mutates `MasterAgent.RISK_MONITOR_ENABLED` — a *process-global* that when set `False` bypasses all P1-P4 checks so orders auto-approve (per the docstring, "P1-P4 checks bypassed — trades auto-approved"). Likewise `GET /admin/leaderboard` returns per-strategy P&L. Both live under the `/api/v1/strategies` router which only requires `require_auth`; there is no additional `is_admin`-style dependency and no per-caller identity check. The returned `username` from `require_auth` is never consulted. In a single-admin deployment this is *currently* moot, but the moment a second user is added (or one token leaks into a CI log) the entire risk regime becomes toggleable by a read-only principal.
**Exploit scenario:** Attacker compromises any lower-privilege token (future support user, shared workstation, XSS in a demo page, Caddy upstream log leak), calls `POST /api/v1/strategies/admin/risk-monitor?enabled=false`, then either waits for the scheduled pipeline to fire or triggers `/pipeline/run` — every trade request now skips concentration, drawdown, correlation, and sizing checks.
**Fix:** Add an `is_admin` dependency: resolve `require_auth`'s returned username against an `ADMIN_USERNAMES` list (or a dedicated role column once multi-user) and raise 403 on mismatch. Also gate state mutation behind a second POST-confirmation token or short-lived 2FA challenge given the blast radius.

---

### [P0] `docker-compose.prod.yml` defaults POSTGRES_PASSWORD to `alphadesk_dev`
**File:** infrastructure/docker-compose.prod.yml:46
**Vulnerability class:** Secrets / insecure default
**Description:** `DATABASE_URL: postgresql+asyncpg://alphadesk:${POSTGRES_PASSWORD:-alphadesk_dev}@...`. If `POSTGRES_PASSWORD` is missing from `.env.prod` (typo, misconfigured secret manager, forgotten var rotation), the compose file silently boots Postgres with the *publicly-known* `alphadesk_dev` password — the same string that ships in `docker-compose.yml` and is shown in the repo. Combined with `timescaledb:5432` binding inside the `alphadesk` docker network (not internet-exposed), this is defence-in-depth lost if *any* other container (caddy, frontend, backend) is ever compromised.
**Exploit scenario:** Prod deploy rolls with a typo'd secret; Postgres comes up with `alphadesk_dev`. Attacker who gains a shell on the Hetzner VPS (via a separate hole) can `docker exec` into any container on the `alphadesk` bridge and hit `psql -h timescaledb -U alphadesk` with a known password to dump the trade ledger, P&L history, and (if the backend ever persists API keys to DB) Alpaca secrets.
**Fix:** Remove the default: `${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}` — docker-compose supports this and will refuse to start. Same pattern should apply to `REDIS_PASSWORD` everywhere it appears (docker-compose.yml:29, docker-compose.yml:33, docker-compose.yml:50 also fall back to `alphadesk_redis_dev`, though those are dev-only files).

---

### [P0] Single-admin model with no MFA and an 8-hour access token
**File:** backend/core/config.py:80-83, backend/core/auth.py:44
**Vulnerability class:** Authentication design
**Description:** `ADMIN_USERNAME`/`ADMIN_PASSWORD_HASH` is the *only* identity; there is no MFA/WebAuthn/TOTP. `ACCESS_TOKEN_EXPIRE_MINUTES: 480` means a stolen session cookie or header stays valid for eight hours, and the revocation blocklist fails *open* on Redis outage (backend/core/auth.py:77-130 — intentional defence-in-depth tradeoff, noted below). There is no "session binding" (IP/UA/device-fingerprint) that would invalidate a token that moved across networks, and no password-change flow that rotates `jti`s. Given this is a terminal wired to real broker credentials, the identity layer is the thinnest part of the stack.
**Exploit scenario:** Admin laptop browser is compromised (malicious extension, XSS, physical access). Attacker exfiltrates the HttpOnly cookie via DevTools or a malicious CA-pinned proxy, then uses it from their own machine for up to 8 hours — plenty of time to call `/trades/orders`, disable risk monitor, and place the full $50k single-order cap repeatedly across many symbols.
**Fix:** (a) Add a TOTP step in the login flow; store `totp_secret` alongside `ADMIN_PASSWORD_HASH`. (b) Shorten access tokens to 15-30 minutes and rely on the already-implemented refresh rotation. (c) Optionally bind tokens to a hashed UA + a `/24` subnet and re-prompt on material drift. (d) Add `/auth/me/sessions` so the operator can audit and kill active tokens.

---

### [P1] `_is_trading_halted` flag is shared, not per-user — any authed caller can globally halt trading
**File:** backend/api/routes/trades.py:26-51, 689-728
**Vulnerability class:** Broken Access Control
**Description:** `POST /api/v1/trades/halt` sets a global `trading:halted` Redis flag that blocks *every* subsequent order across every principal. No admin check. Combined with the 8-hour TTL hardcoded at line 44 (`ttl_seconds=86400`) this is effectively a denial-of-trading primitive for any token-holder. Its twin `POST /api/v1/trades/resume` is similarly ungated.
**Exploit scenario:** Same as P0 above — stolen lower-privilege token issues `halt` during a critical market event; legitimate orders reject with 503 until the operator notices and manually `resume`s.
**Fix:** Gate `/halt` and `/resume` behind the same admin check proposed for `/admin/risk-monitor`. Also log `username` into the halted-state JSON so the operator sees *who* halted — currently the log line at auth.py-style has no actor attribution.

---

### [P1] CSRF protection relies solely on SameSite=strict — no Origin/Referer enforcement
**File:** backend/api/routes/auth.py:90-110, backend/main.py:148-154
**Vulnerability class:** CSRF
**Description:** Cookies are `httponly=True`, `secure=is_prod`, `samesite="strict"` — correct. However, state-changing endpoints (`/trades/orders`, `/trades/halt`, `/strategies/*/toggle`, `/strategies/admin/risk-monitor`, `/agents/chat`) accept the cookie with no Origin/Referer check and no CSRF token. SameSite=strict is robust against cross-site POSTs from *browsers that honour it* — but any intermediary that strips or relaxes the cookie attribute (some old mobile webviews, some corporate MITM proxies, browser extensions with `webRequest` host permissions) can resurrect the attack. A defence-in-depth Origin check costs nothing.
**Exploit scenario:** Admin's browser runs a benign-looking extension with `*://tradingalpha.net/*` permissions; the extension's background page POSTs to `/api/v1/trades/orders` with credentials included — SameSite is bypassed because the extension is considered "first-party" in Chrome's model. A 1-liner Origin check would have caught this.
**Fix:** Add an ASGI middleware that, for any non-`GET`/`HEAD`/`OPTIONS` request under `/api/v1/`, verifies `request.headers["Origin"]` (or `Referer` as fallback) exactly matches `settings.PRODUCTION_ORIGIN` (or `http://localhost:3000`/`http://127.0.0.1:3000` in dev). Reject with 403 otherwise. Similarly, verify the WebSocket upgrade's `Origin` header in `backend/api/websocket/handler.py:190`.

---

### [P1] `POST /api/v1/agents/refine-strategy` has no rate limit and triggers Claude CLI spawns
**File:** backend/api/routes/agents.py:245-347
**Vulnerability class:** Resource exhaustion / cost abuse
**Description:** The endpoint spawns a Claude CLI process per call (subprocess_exec, ~20s timeout). Body size is capped at Pydantic's default, but nothing caps calls-per-minute. Contrast with `/pipeline/run` which is rate-limited (1/60s/user, fail-closed). Same issue with `POST /api/v1/agents/chat` — 4000 char input, no rate limit, each call is a `SupervisorAgent.run` that fans out to specialist agents (dozens of tool calls). An authenticated attacker can burn the Anthropic API budget in minutes.
**Exploit scenario:** Compromised or shared token sends 100 `/agents/chat` requests/sec with 4000-char prompts; the master agent dispatches to 5+ specialists each; within ~10 minutes the monthly Anthropic budget is exhausted and legitimate pipeline runs fail.
**Fix:** Reuse the existing Redis pipeline rate-limit helper from `backend/api/routes/pipeline.py:30-57` (`_pipeline_rate_limit`) on `/agents/chat` (e.g. 20/min/user) and `/agents/refine-strategy` (5/min/user). Document the TODO already present in `auth.py:26-27` — it explicitly calls out this gap.

---

### [P1] `backend/api/routes/portfolio.py:408` leaks Alpaca error body to the client
**File:** backend/api/routes/portfolio.py:408
**Vulnerability class:** Data exposure / error-message leak
**Description:** `raise HTTPException(status_code=resp.status_code, detail=f"Alpaca API error: {resp.text[:200]}")`. The first 200 chars of Alpaca's error payload are returned verbatim. Alpaca errors have included request IDs, account identifiers, and in some historical responses partial API keys in `WWW-Authenticate` style hints. Even at 200 chars this is an enumeration surface for attackers probing the broker path.
**Exploit scenario:** Attacker repeatedly hits `/api/v1/portfolio/summary` with manipulated auth headers or during partial Alpaca outages and harvests error bodies for account metadata (account number, status, entity type).
**Fix:** Log `resp.text` server-side; return a generic `"detail": "broker_error"` to the client, matching the pattern already used at portfolio.py:412 (`"Invalid response from Alpaca API"`) and trades.py:398-399 (`{"error": "broker_unavailable", "retry": True}`).

---

### [P1] Webhook and screener error paths interpolate raw exceptions into HTTP detail
**File:** backend/api/routes/webhooks.py:68, 89; backend/api/routes/screener.py:751
**Vulnerability class:** Information disclosure
**Description:** `detail=f"Invalid JSON payload: {e}"` / `detail=f"Database unavailable: {e}"`. Pydantic validation errors and SQLAlchemy operational errors often contain the exact line of data that failed parsing and, for DB errors, occasionally the connection string or hostname. For the TradingView webhook path this is pre-auth (HMAC is checked right after), so the raw exception reaches an unauthenticated attacker.
**Exploit scenario:** Attacker posts malformed JSON to `/api/v1/webhooks/tradingview` and reads the returned error to learn the pydantic schema and infer internal model names. For screener/presets: an auth'd user whose DB error path fires sees the DB host:port.
**Fix:** Log the exception; return a stable, non-reflective message ("Invalid JSON payload" / "Database unavailable"). The webhooks path is especially high-leverage because it's network-accessible from any IP that knows the URL.

---

### [P1] TradingView webhook doesn't verify payload HMAC, only equality-compares a shared secret
**File:** backend/api/routes/webhooks.py:73-82
**Vulnerability class:** Authentication / message integrity
**Description:** `hmac.compare_digest(provided_secret, secret)` is constant-time-safe, but it's comparing a *bearer-style shared secret*, not an HMAC of the *body*. Anyone who learns the secret (logs, header sniff, TV config leak, support ticket with the X-TV-Secret header) can forge any alert payload they want — buy/sell signals that the execution agent then acts on. TradingView does not natively sign webhook bodies, so this is an inherent TV limitation, but it deserves explicit acknowledgement.
**Exploit scenario:** TV alert config file is ever shared (screenshot in Slack, pasted into a ticket); attacker now has a direct channel to the execution agent. Without per-alert replay protection (timestamp + nonce), they can also replay old captured alerts.
**Fix:** (a) Require a timestamp in the body and reject if `abs(now - ts) > 60s`. (b) Maintain a Redis set of recent alert-IDs with 5-minute TTL and reject duplicates. (c) Document that `TRADINGVIEW_WEBHOOK_SECRET` must be rotated any time the TV alert list is touched. (d) Consider routing webhooks through a Cloudflare/Caddy IP allow-list of TradingView's documented source ranges.

---

### [P1] Deprecated/end-of-life frontend packages
**File:** frontend/package.json
**Vulnerability class:** Dependency risk
**Description:**
- `lucide-react: ^1.7.0` — that is NOT a real recent major; the current series is 0.x (e.g. 0.468+). `^1.7.0` either resolves to nothing and uses a lockfile pin, or is a typo; in either case it deserves a dependabot audit. Worth verifying in `package-lock.json`.
- `react 19.2.4` / `next 16.2.2` — cutting-edge (Next 16 just released). Not inherently a bug, but pin these to exact versions (`"next": "16.2.2"`) and review Next 16 changelog for security advisories; the `CLAUDE.md` reminder in `frontend/AGENTS.md` flags "This is NOT the Next.js you know" — auditors should verify there are no known CVEs in `16.2.x`.
- `jsdom ^29.0.2` — dev-only, OK.
**Exploit scenario:** A known-vulnerable transitive dep (e.g. an old `cookie` or `path-to-regexp` pulled via Next) gives an XSS/prototype-pollution primitive that bypasses React's auto-escaping.
**Fix:** Run `npm audit --production` (pre-deploy gate) and `npx npm-check-updates` monthly; pin major versions; verify `lucide-react` version is correct (probably should be `^0.468.0` or similar).

---

### [P1] No password policy / no lockout on login
**File:** backend/api/routes/auth.py:129-156, backend/core/config.py:81
**Vulnerability class:** Authentication hardening
**Description:** There is no enforced password complexity/length — `ADMIN_PASSWORD_HASH` can be a bcrypt of `"password"` and the server will happily accept it. Rate-limit is 5/5min per IP (good), but there is no per-account lockout: an attacker rotating IPs (proxies, Tor, cloud providers) can still do 5/IP/5min × N IPs. No `pwned_passwords`-style check.
**Exploit scenario:** Weak admin password + distributed credential stuffing. Per-IP limit adds friction but doesn't stop a determined attacker with a botnet.
**Fix:** (a) Enforce min 12 chars + mixed classes at *hash-generation* time (document in `reference_production_url.md`). (b) Add a per-*username* counter (`login_attempts_user:admin`) alongside the per-IP one, with a stricter threshold (e.g. 10 failed/hour). (c) On 3 consecutive failures, require a 5-minute cooldown regardless of IP.
---

### [P2] `/health` exposes `environment` and `version` in non-prod
**File:** backend/main.py:218-226
**Vulnerability class:** Information disclosure (minor)
**Description:** In non-prod mode the endpoint returns `{"status": "healthy", "environment": "dev", "version": "0.1.0"}`. Since the default `ENVIRONMENT` is `PROD` (good — core/config.py:35), this is only reachable when someone *has* flipped to dev mode. But a misconfigured staging env that ends up exposed would leak version + env to unauthenticated probes, which feeds CVE discovery.
**Exploit scenario:** Auth-less attacker fingerprints version to match it against a future CVE database entry.
**Fix:** In non-prod, still only return `{"status": "ok"}` from unauthenticated `/health`; put version under an auth-gated `/health/detail`.

---

### [P2] CORS `allow_headers` permits X-Requested-With and Content-Type — fine, but no preflight cache
**File:** backend/main.py:148-154
**Vulnerability class:** CORS hygiene
**Description:** `allow_credentials=True` + an explicit origin list (not `*`) is correct. The list contains `http://localhost:3000` and `http://127.0.0.1:3000` unconditionally — these leak into production by default. If `PRODUCTION_ORIGIN` is set these are additive, so prod still allows localhost origins — not a security issue in itself (credentials only come from the browser's same-origin context) but it bloats the allow-list. No `max_age` means the preflight is re-sent on every request, which is perf-cost, not security.
**Exploit scenario:** Negligible direct risk. Possible confused-deputy scenario if an attacker can trick a victim's browser into making a cross-site fetch from `http://localhost:3000` (rare).
**Fix:** In prod, only include `settings.PRODUCTION_ORIGIN` — wrap the `http://localhost*` entries in `if not settings.is_production:`.

---

### [P2] `ADMIN_USERNAME` default is `"admin"` — enumeration-friendly
**File:** backend/core/config.py:80
**Vulnerability class:** Username enumeration
**Description:** Default admin username is `"admin"`. The login endpoint's response for wrong-username vs wrong-password is identical (`"Invalid username or password"`), which is correct. But a known default username halves the search space for credential stuffing.
**Exploit scenario:** Rate-limited credential stuffing against the single known username. With a weak bcrypt cost factor this is amplified further (currently the bcrypt cost is whatever `gensalt()` defaults to — 12 as of bcrypt 4.x, which is OK).
**Fix:** Force an override at deploy time: `ADMIN_USERNAME: str = Field(...)` with no default, same as `JWT_SECRET`. Doc update: runbook must instruct operators to choose a non-trivial username.

---

### [P2] Revocation check fails *open* on Redis outage
**File:** backend/core/auth.py:77-130
**Vulnerability class:** Auth hardening tradeoff
**Description:** Intentional behaviour (well-commented). During a Redis outage, recently-revoked tokens remain valid until their natural expiry. The tradeoff was chosen to prevent a 5-second Redis blip from logging every user out. Acceptable for the current single-user deployment, but for any multi-user future this is a "revoked admin" window of up to 8 hours.
**Exploit scenario:** Admin discovers token theft, calls `/logout`, but Redis is mid-crash — the revocation never lands in the blocklist, and the stolen token remains valid for 8 hours.
**Fix:** (Mitigation for future) Flip to *fail-closed* once a second identity exists, or publish a short-lived in-memory revocation broadcast across the backend workers via a Redis pub/sub heartbeat. Less disruptive alternative: shorten access-token lifetime to 15 minutes (see P0 on MFA) — then the "revocation missed" window shrinks to 15 minutes.

---

## Negative findings — areas that are genuinely clean

These were checked and are fine (documenting for next time so we don't re-audit the same ground):

- **SQL injection sweep.** `backend/data/ingestion/trade_ledger.py:621,661` *looks* like f-string SQL, but on inspection both interpolations are **column names from an explicit allow-list** (`_ensure_schema` columns), with a `raise ValueError` on unknown keys; the **values are always parameterised** via `:k` named binds. All other `session.execute(...)` calls in the backend use SQLAlchemy ORM select-construction (`select(Trade).where(...)`) with no user-controlled format strings. Clean.
- **Command injection.** Only two `subprocess` call sites (`backend/agents/base.py:118`, `backend/data/ingestion/master_agent.py:772`), both using `asyncio.create_subprocess_exec` with argument lists (NOT `shell=True`). Prompt content is not shell-evaluated. Clean.
- **Path traversal.** No file-upload endpoints. The only user-path reaching the filesystem is `GET /pipeline/history/{date}` (backend/api/routes/pipeline.py:275-289), which validates the date with `re.fullmatch(r"\d{4}-\d{2}-\d{2}", date)` before `LOG_DIR / f"{date}.json"`. Clean.
- **XSS (frontend).** Zero occurrences of `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, or `eval(` in `frontend/src/`. React auto-escaping is the only rendering path. Clean.
- **JWT secret fallback.** `config.py:98-114` hard-raises if `JWT_SECRET` is empty — no "known-insecure" fallback remains. Clean.
- **Refresh token replay.** `auth.py:159-193` correctly revokes the *old* refresh token *before* minting a new one, verifies the revocation landed, and aborts with 503 on Redis failure (fail-closed). Clean.
- **Docs / CORS.** `/docs` and `/redoc` are gated by `not settings.is_production` and default is PROD. CORS is not `*`; allow-list is enumerated. `allow_credentials=True` is safe given the explicit list. Clean.
- **CSP.** `infrastructure/Caddyfile:16` has an explicit CSP without `unsafe-eval`, and `'unsafe-inline'` is commented with justification (Next.js hydration). `frame-ancestors 'none'` + `X-Frame-Options: DENY` stops clickjacking. `connect-src` is limited. HSTS is set with 1y max-age + includeSubDomains + preload. Clean.
- **HSTS / TLS / auto-cert.** Caddy auto-manages certs via ACME; HSTS is set; no HTTP->HTTPS downgrade path in the Caddyfile (Caddy auto-redirects :80 -> :443). Clean.
- **`.env` in git.** `.gitignore` excludes `.env`, `.env.prod`, `.env.local*`, `secrets/`. Only `.env.example` is tracked, and it contains no real values. Clean.
- **Broker API key storage.** Alpaca / Polygon / FMP keys are `SecretStr` in `Settings`, loaded from env / `.env`. No DB persistence. No logging of the key. Clean.
- **Rate-limiting on login.** Redis-backed with in-memory fallback, fail-*closed* behaviour is correct — it degrades to per-worker counters rather than uncapped. Clean.

---

## Top 15 (summary for triage, ordered by severity)

1. **[P0]** Admin endpoints not role-gated — `/strategies/admin/risk-monitor` and `/admin/leaderboard` let any authed caller disable all risk checks.
2. **[P0]** `infrastructure/docker-compose.prod.yml:46` defaults `POSTGRES_PASSWORD` to `alphadesk_dev`.
3. **[P0]** Single-admin identity, no MFA, 8-hour access token — entire model rests on one bcrypt hash.
4. **[P1]** `/trades/halt` and `/trades/resume` are ungated — any authed token can globally suspend trading.
5. **[P1]** No Origin/Referer enforcement on state-changing endpoints — SameSite=strict is the only CSRF defence.
6. **[P1]** `/agents/chat` and `/agents/refine-strategy` are not rate-limited — Anthropic budget can be burned.
7. **[P1]** `portfolio.py:408` leaks Alpaca error body (200 chars) to the client.
8. **[P1]** `webhooks.py:68,89` and `screener.py:751` leak raw exception strings in HTTP detail (webhooks path is pre-auth).
9. **[P1]** TradingView webhook uses a shared bearer-style secret with no timestamp / nonce / replay protection.
10. **[P1]** `frontend/package.json` has a suspicious `lucide-react: ^1.7.0` pin (likely typo for `^0.46x`) — verify.
11. **[P1]** No password policy or per-username lockout — distributed credential stuffing viable.
12. **[P2]** `/health` leaks `environment` and `version` in non-prod mode.
13. **[P2]** CORS allow-list includes `localhost:3000` unconditionally (even in prod).
14. **[P2]** `ADMIN_USERNAME` default is `"admin"` — known username halves the credential-stuff surface.
15. **[P2]** Revocation check fails *open* on Redis outage — intentional, but worth reconsidering once a second user exists.

---

*End of report.*
