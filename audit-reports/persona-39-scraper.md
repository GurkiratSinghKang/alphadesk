# Persona 39 — Scraper / Bot Harvester

**Date:** 2026-04-18
**Target:** tradingalpha.net (AlphaDesk)
**Focus:** Can an automated scraper harvest data en masse? What stops it?

---

## Summary (248 words)

AlphaDesk ships with the minimum-viable scraper defence: a sitemap-gated
`robots.txt` that disallows `/api/` and a single-user JWT auth on every
`/api/v1/*` route except `/webhooks/tradingview`, `/livez`, `/health`,
`/readyz`, and `/api/v1/auth/*`. There is **no WAF, no Cloudflare,
no CAPTCHA / Turnstile, no bot-detection middleware, no User-Agent gating,
no per-IP global request cap, and no Caddy rate-limit directive**
(`infrastructure/Caddyfile` is bare). The only rate limits in the stack are:
(1) login — 5 failures / 5 min / IP; (2) `/pipeline/run` — 1 / 60 s / **user**;
(3) `newsdata.io` upstream backoff. Every other authenticated endpoint is
**unlimited** — including `/agents/chat` (unbounded Claude burn),
`/analysis/analyze/{symbol}`, `/market/snapshots?symbols=...` (100 symbols
per call, no cap on calls/second), `/screener/screen`, `/symbols/search`,
`/market/bars`, and the entire portfolio/trades read surface.

A leaked session (JWT or `access_token` cookie) hands the scraper the whole
API: tokens last **8 hours access / 30 days refresh**, there is a single
admin principal (`settings.ADMIN_USERNAME`), and `is_token_revoked()`
**fails OPEN** on a Redis blip. Until logout is called on the exact cookie,
a harvester can pull every quote, bar, snapshot, options chain, news feed,
and run `/agents/chat` or `/analysis/analyze` against the full S&P 500
limited only by upstream (Alpaca / Polygon / Anthropic) quotas — which
AlphaDesk pays for. The unauthenticated `/api/v1/webhooks/tradingview`
is HMAC-gated but issues **no rate limit**, giving a probe oracle:
timing difference between 403 (bad HMAC) and 422 (good HMAC, bad payload)
leaks when the secret is guessed.

---

## Findings

### 1. `robots.txt` present but advisory-only
**File:** `frontend/public/robots.txt`
```
User-agent: *
Allow: /
Disallow: /api/
Sitemap: https://tradingalpha.net/sitemap.xml
```
Blocks nothing — a scraper ignoring it (all hostile scrapers) gets the
full site. The `Disallow: /api/` hint actually **advertises where the
juicy endpoints live**. Fine as a good-citizen signal; it is not a control.

### 2. No bot detection, no CAPTCHA, no WAF
**Files:** `infrastructure/Caddyfile`, `backend/main.py`, `backend/api/middleware/`
A full-repo grep for `captcha | turnstile | hcaptcha | recaptcha |
cloudflare | bot.?detect | fingerprint | honeypot` returns **zero hits**
across backend + frontend. The only reverse-proxy-level middleware in
Caddy is `header`, `encode`, and two `reverse_proxy` blocks. A `curl -A
""` loop with a stolen JWT is indistinguishable from a real browser.

### 3. No global per-IP rate limit anywhere in the stack
**Files:** `infrastructure/Caddyfile:1-41`, `backend/main.py:137-172`
Caddy has no `rate_limit` directive. FastAPI has no `slowapi` /
`aiolimiter` / global dependency-level throttle. The only request-id
middleware is `add_request_id` — cosmetic. A single authenticated client
can fan out unbounded concurrent requests; the limit is wall-clock
throughput of the Alpaca / Polygon / Anthropic upstreams AlphaDesk pays for.

### 4. Leaked JWT / `access_token` cookie = 8-hour full read access
**File:** `backend/core/auth.py:43-71`, `backend/core/config.py:82-83`
```python
ACCESS_TOKEN_EXPIRE_MINUTES: int = 480   # 8 hours
REFRESH_TOKEN_EXPIRE_DAYS: int = 30
```
JWT is HS256, signed with `JWT_SECRET` (process-wide). An attacker who
exfiltrates the `access_token` cookie from a phishing page — or the
HttpOnly cookie via XSS in a third-party dependency — harvests every
authenticated endpoint for 8 hours, then **renews silently** via
`/api/v1/auth/refresh` for 30 days. Only logout or admin manual
revoke-all-tokens invalidates.

### 5. `is_token_revoked()` fails OPEN on Redis outage
**File:** `backend/core/auth.py:74-131`
```python
except Exception:
    ...
    return False   # fail open
```
Documented design decision (comments justify it), but from a scraper's
perspective: **disrupt Redis and the revocation blocklist stops working**.
Combined with the 60 s in-process cache (`_REVOCATION_CACHE_TTL_SEC`),
a rotated token stays usable for up to a minute even when Redis is up.

### 6. `/agents/chat` — unlimited Claude burn per authenticated session
**File:** `backend/api/routes/agents.py:88-170`
No rate limit, no token-count cap, no cost cap. Each call spawns
`SupervisorAgent.run()` which can fan out to 11 sub-agents. A harvester
can pin a session and run parallel chats until the Anthropic budget
drains. Comment in `auth.py:110` explicitly acknowledges this as a TODO:
> TODO: /agents/chat and /pipeline/run are expensive endpoints and should
> also be rate limited (those routes live in separate files).
Only `/pipeline/run` got the fix.

### 7. `/market/snapshots` — 100 symbols per call, unlimited calls
**File:** `backend/api/routes/market.py:822-875`
Single call fans out to Alpaca's `/v2/stocks/snapshots?symbols=...`.
No per-user call budget, no cooldown. A scraper can harvest the whole
Russell 3000 in ~30 requests and repeat every second. Redis cache on
per-symbol quotes is **5 s TTL** — scraping in a tight loop pulls live
Alpaca data on every hit until Alpaca itself throttles (which bills
the AlphaDesk account).

### 8. `/webhooks/tradingview` — HMAC oracle, no rate limit
**File:** `backend/api/routes/webhooks.py:47-128`
Only public-facing POST endpoint (no `require_auth`). `hmac.compare_digest`
on the secret is constant-time, good. But there is **no attempt counter**:
an attacker can hammer the endpoint forever probing secrets, and the
status code tree leaks progress — 503 (secret not configured), 403
(bad HMAC), 422 (good HMAC, bad payload). Combine with #3: nothing stops
a 10k-req/s guess loop.

### 9. Trusted-proxy hardening helps, but X-Forwarded-For still spoofable at edge
**File:** `backend/main.py:157-167`
```python
_TRUSTED_PROXY_HOSTS = ["127.0.0.1", "::1", "172.16.0.0/12", "10.0.0.0/8", "192.168.0.0/16"]
```
ProxyHeadersMiddleware only trusts XFF from private ranges. Good fix
(old code trusted `"*"`). BUT `_client_ip()` in `auth.py:17-26` still
reads `request.headers.get("x-forwarded-for")` directly without
re-verifying — so if Caddy is bypassed (direct hit on port 8000 inside
docker network, or any future sidecar that forwards XFF from the
internet), the login-attempt counter can be evaded by rotating XFF per
request. Defense in depth is missing.

### 10. Cache TTLs make scraping the cheapest CDN you ever built
**Files:** `backend/api/routes/market.py:343,386,474,529`, `news.py:29`
Quotes cached 5 s, bars cached per-timeframe, news cached 900 s.
A scraper polling at 1 Hz on the same symbol pays one upstream call per
5 s but gets 5 cached responses free — AlphaDesk has effectively built
a public-speed mirror for anyone with an auth token. No `Cache-Control`
headers on responses, no `ETag` / `If-None-Match` (repo-wide grep: zero
hits), so the scraper can't be detected by repeat-hash pattern either.

---

## Recommended priorities (not part of the 10)

1. Add Caddy `rate_limit` plugin or nginx fronting with per-IP 10 req/s global cap.
2. Add per-user rate limit to `/agents/chat`, `/analysis/analyze`, `/market/snapshots`.
3. Add attempt counter to `/webhooks/tradingview` (IP-based, fail closed).
4. Consider Turnstile or hCaptcha on `/auth/login` (currently 5 failures/5 min is per-IP only; residential proxy rotation defeats it).
5. Tighten access-token TTL to 60 min; require refresh for long sessions.
