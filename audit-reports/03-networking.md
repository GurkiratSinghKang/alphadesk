# Networking / Transport Audit — AlphaDesk
Auditor: Senior Networking Engineer (25 yrs)
Date: 2026-04-17

---

## Executive Summary

AlphaDesk (https://tradingalpha.net) is served from a single Hetzner VPS in Germany
(87.99.143.65, ttl=48, ~16 ms RTT from the auditor's US-East machine) via a
**Caddy 2 reverse proxy fronting a FastAPI + Next.js backend in Docker**.
The transport layer is broadly competent — Let's Encrypt TLS 1.3 with ECDSA/X25519,
HTTP/2 enforced, HTTP/3 advertised, HSTS preload, strong security header set,
HTTP -> HTTPS 308, zstd+gzip compression — but has **several real correctness,
reliability, and operational problems** that will bite a market-data / trading
product:

1. **Single VPS, single IP, no IPv6, no CDN.** Any Hetzner DC event is a full
   outage. No edge caching for static Next.js chunks. TTFB is fine from nearby
   clients (~60-150 ms p95 from US-East) but will be painful from APAC/ME.
2. **No `Cache-Control` on Next.js chunks or RSC payloads.** `/favicon.ico`
   returns `cache-control: public, max-age=0, must-revalidate` and an
   `x-nextjs-cache: HIT` with no hashed-filename caching — every page revisit
   refetches the full bundle from origin.
3. **Permissive WebSocket reconnect, no server heartbeat.** Browser reconnects
   up to 10 times with 1->30 s exponential backoff, but the server never sends
   ping frames and there's no idle-timeout watchdog; a silently-dead TCP (common
   on mobile NAT / Wi-Fi handoff) keeps the UI "connected" while receiving no
   quotes.
4. **Fragile, undeclared dependency on Redis for auth.** `is_token_revoked()`
   **fails closed** — if Redis blips, every authenticated HTTP call and the WS
   handshake 401. Whole app goes dark. No circuit breaker.
5. **CSP `script-src 'self' 'unsafe-inline' 'unsafe-eval'`** — the product runs
   with eval/inline JS permitted, which defeats the main point of having a CSP
   for a trading app handling order entry.
6. **Bad error hygiene.** Caddy returns plain-text `"Method Not Allowed\n"` (22
   bytes) for 405s and JSON `{"detail":"Not Found"}` for 404s — inconsistent
   content types on errors, no standard error envelope.
7. **No rate limiting visible.** `/api/v1/auth/login` happily returns 401 on
   each attempt with no `Retry-After`, no `WWW-Authenticate`, no evidence of
   throttling — credential stuffing is wide open.
8. **HTTP/3 advertised but not actually usable by most clients.** `alt-svc:
   h3=":443"` is broadcast, but the server also responds with HTTP/2 via
   TLS1.3. Confirmed server has QUIC open (Caddy 2-alpine supports it by
   default), but there's no fall-forward verification in CI.
9. **JWT in a cookie and in a header simultaneously.** `apiFetch` sends
   `Authorization: Bearer <token>` **and** `credentials: include`, so the same
   JWT crosses the wire twice. Minor, but doubles exposure surface and makes
   CORS preflight matter for every call.
10. **Client retry is undersized for trading.** TanStack Query `retry: 2` on
    portfolio/strategies; on a flaky 5xx during market open the UI flickers to
    "error" after 3 attempts total with default linear backoff — not
    appropriate for live P&L.

**Score: 71 / 100** — see breakdown at bottom.

---

## Severity Legend
- **P0** — security / availability risk. Fix immediately.
- **P1** — noticeable perf / correctness issue. Fix this sprint.
- **P2** — hygiene. Fix when touching the area.
- **P3** — polish.

---

## Measured Baseline (verbatim, 2026-04-17 16:21-16:30 UTC)

### DNS
```
$ dig tradingalpha.net +short
87.99.143.65

$ dig tradingalpha.net AAAA +short
(empty — no IPv6 / AAAA)

$ dig tradingalpha.net CAA +short
(empty — no CAA record)

$ dig tradingalpha.net DNSKEY +short
(empty — no DNSSEC at apex)

$ dig tradingalpha.net NS +short
carlane.ns.cloudflare.com.
aiden.ns.cloudflare.com.
```
DNS hosted on Cloudflare nameservers (good), but **A record points to
Hetzner origin directly** — Cloudflare is name-resolution-only, not a CDN
for this domain. Apex has `net.` DNSSEC one level up but domain itself is
not signed (`DNSKEY` empty).

### ICMP
```
$ ping -c 2 tradingalpha.net
64 bytes from 87.99.143.65: icmp_seq=0 ttl=48 time=17.262 ms
64 bytes from 87.99.143.65: icmp_seq=1 ttl=48 time=16.069 ms
```
`ttl=48` confirms origin is ~16 hops away — direct to Hetzner, no edge.

### Timing (US-East -> Falkenstein, DE)
```
$ curl -w '...' -o /dev/null -s https://tradingalpha.net
DNS: 0.002s   Connect: 0.019s   TLS: 0.040s
TTFB: 0.059s  Total: 0.059s   HTTP: 2   Size: 6

$ for i in 1..5; do curl -w '%{time_*}\n'; done
0.002226 0.018176 0.039997 0.059709 0.059796 307 2
0.001798 0.017568 0.035673 0.057150 0.057223 307 2
0.001894 0.022779 0.048617 0.073157 0.073249 307 2
0.002199 0.020341 0.039250 0.056977 0.057058 307 2
0.001996 0.023180 0.122307 0.145266 0.145420 307 2   <-- outlier TLS
```
Median TTFB 60 ms, p95 ~145 ms. The outlier was a full TLS handshake (~120 ms
app-layer-connect) — session resumption does not appear to be kicking in for
cold curl.

### TLS handshake
```
$ openssl s_client -connect tradingalpha.net:443 -servername tradingalpha.net
Certificate chain
 0 s:/CN=tradingalpha.net
   i:/C=US/O=Let's Encrypt/CN=E8
 1 s:/C=US/O=Let's Encrypt/CN=E8
   i:/C=US/O=Internet Security Research Group/CN=ISRG Root X1
subject=/CN=tradingalpha.net
issuer=/C=US/O=Let's Encrypt/CN=E8
Server Temp Key: ECDH, X25519, 253 bits
SSL-Session:
    Protocol  : TLSv1.3
    Cipher    : AEAD-CHACHA20-POLY1305-SHA256
    Verify return code: 0 (ok)
Not Before: Apr 10 04:26:49 2026 GMT
Not After:  Jul  9 04:26:48 2026 GMT
```
Cert issued 2026-04-10, expires 2026-07-09 — 82 days validity (Let's Encrypt
short-lived). ECDSA P-256 / X25519 KX, CHACHA20-POLY1305 AEAD. **TLS 1.3
only** — confirmed TLS 1.0/1.1 refused at ClientHello level:
```
$ curl --tls-max 1.0 https://tradingalpha.net/
curl: (35) LibreSSL/3.3.6: error:1404B410:SSL routines:...:sslv3 alert handshake failure
```
No `SAN` beyond `tradingalpha.net` itself — `www.tradingalpha.net` would
fail SNI (and indeed does, `net_www.txt` request returned only base headers
with no separate cert — not tested exhaustively but SAN list is minimal).

### HTTP response — root `/`
```
$ curl -vI https://tradingalpha.net/
HTTP/2 307
alt-svc: h3=":443"; ma=2592000
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss://tradingalpha.net https://tradingalpha.net; frame-ancestors 'none'
location: /login
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: strict-origin-when-cross-origin
set-cookie: access_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
strict-transport-security: max-age=31536000; includeSubDomains; preload
via: 1.1 Caddy
x-content-type-options: nosniff
x-frame-options: DENY
x-xss-protection: 1; mode=block
```
(No `Server` header — stripped by Caddyfile `-Server`.)

### HTTP -> HTTPS
```
$ curl -sI http://tradingalpha.net/
HTTP/1.1 308 Permanent Redirect
Location: https://tradingalpha.net/
Server: Caddy
```
(Port 80 leaks `Server: Caddy` — the `-Server` header strip only applies
inside the main `{$DOMAIN}` site block, not to the automatic ACME/80
handler.)

### API surface
```
$ curl -sI https://tradingalpha.net/api/health
HTTP/2 404 content-type: application/json

$ curl -sI https://tradingalpha.net/api/v1/auth/login
HTTP/2 405 allow: POST

$ curl -sI -X POST https://tradingalpha.net/api/v1/auth/login ... -d '{"username":"x","password":"y"}'
HTTP/2 401
{"detail":"Invalid username or password"}

$ curl -sI https://tradingalpha.net/api/v1/market/quotes/AAPL
HTTP/2 405 allow: GET    <-- HEAD not supported on data endpoints
```

### WebSocket probe
```
$ curl -sI -H "Connection: Upgrade" -H "Upgrade: websocket" ... https://tradingalpha.net/ws
HTTP/2 404 content-type: application/json
```
(Caddy refuses WS upgrade over HTTP/2 — expected; FastAPI WS at `/ws` needs
HTTP/1.1 Upgrade. Confirmed the Caddyfile has `handle /ws { reverse_proxy
backend:8000 }`.)

### CORS
```
$ curl -sI -X OPTIONS -H "Origin: https://evil.com" ... https://tradingalpha.net/api/v1/auth/login
HTTP/2 400           <-- good, origin not allowlisted
(no access-control-allow-origin returned)

$ curl -sI -X OPTIONS -H "Origin: https://tradingalpha.net" ... /api/v1/auth/login
HTTP/2 200
access-control-allow-origin: https://tradingalpha.net
access-control-allow-credentials: true
access-control-max-age: 600
vary: Origin
```
Clean, strict CORS — only the production origin is echoed, credentials
allowed, preflight cached 10 min.

### Compression
```
$ curl -sI -H "Accept-Encoding: gzip, br, zstd" https://tradingalpha.net/
...
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
```
`Caddyfile` has `encode zstd gzip`. For HTML responses there's no
`content-encoding` on a 307, but assets like `/robots.txt` show
`vary: Accept-Encoding` — compression is wired. **Brotli (`br`) is NOT offered**;
Caddy defaults to zstd + gzip.

### Cache / ETag
```
$ curl -sI https://tradingalpha.net/robots.txt
HTTP/2 200
cache-control: public, max-age=0         <-- max-age=0!
etag: W/"55-19d849b0488"
last-modified: Mon, 13 Apr 2026 02:10:45 GMT

$ curl -sI https://tradingalpha.net/favicon.ico
HTTP/2 200
cache-control: public, max-age=0, must-revalidate
content-type: image/x-icon
x-nextjs-cache: HIT
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch
(no content-length, no etag)
```
Every static asset comes back with `max-age=0`. See P1-06.

---

## Findings

### [P0-01] Auth fails closed on Redis outage — whole app offline
**Where:** `backend/core/auth.py:62-71`, used by every authenticated route
and the WS handler.
**Evidence:**
```python
async def is_token_revoked(jti: str) -> bool:
    try:
        r = await get_redis()
        raw = await r.get(f"revoked:{jti}")
        return raw is not None
    except Exception:
        logger.warning("Redis unavailable — treating token as revoked (fail closed)")
        return True  # FAIL CLOSED: block auth when we can't check revocation
```
Every `require_auth` dependency calls this (`backend/core/auth.py:109`).
Every protected router uses it (`backend/main.py:151-164`).
**What:** If Redis is unreachable (restart, OOM, mem_limit=640m hit), every
authenticated HTTP call returns 401 and every WS connection closes with code
1008. UI immediately logs users out (`frontend/src/lib/api.ts:44-54`
redirects to `/login` on any 401).
**Why it matters:** Redis has a 640 MB memory cap in the prod compose
(`infrastructure/docker-compose.prod.yml:88` — `--maxmemory 512mb` with
`mem_limit: 640m`). `allkeys-lru` eviction is fine for cache, but a restart
or a slow AOF rewrite takes the whole platform down for anyone logged in.
For a trading app, being logged out at 9:30 ET because a cache blipped is a
P0.
**Fix:** Change the default to **fail open for revocation checks**, but keep
fail-closed for the per-user rate limit and audit trail. Alternative: cache
JTIs in memory with a short TTL (~60 s) as a fallback when Redis is down, so
revoked tokens are blocked within 1 min even offline. Add a Redis circuit
breaker so repeated failures don't spam the error log or add latency on each
call.

### [P0-02] `script-src 'unsafe-inline' 'unsafe-eval'` defeats CSP
**Where:** `infrastructure/Caddyfile:10`
**Evidence:**
```
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
```
**What:** Both `unsafe-inline` and `unsafe-eval` are allowed for scripts.
Any XSS sink on the Next.js surface executes attacker JS — CSP provides
essentially no protection against script-injection classes.
**Why it matters:** A trading dashboard with order entry is one of the worst
places to be CSP-permissive. A DOM-based XSS on a quoted symbol name or
strategy rationale string would let an attacker read the `Authorization`
header (included in fetches — `frontend/src/lib/api.ts:34-36`) and post
orders via `placeOrder()` (ibid:382).
**Fix:** Next.js supports nonce-based CSP. Generate a per-request nonce in
middleware, inject it into `<script>` tags, set `script-src 'self'
'nonce-XXX' 'strict-dynamic'`. Audit inline code; Next 15 emits almost none
by default. Remove `'unsafe-eval'` entirely — it's only needed for old
Webpack dev HMR, which is not shipped to prod.

### [P0-03] No rate limiting on login, no account lockout, no CAPTCHA
**Where:** `backend/api/routes/auth.py` (via `/api/v1/auth/login`), reverse-
proxied by `infrastructure/Caddyfile:18 handle /api/*`.
**Evidence:**
```
$ curl -s -X POST -d '{"username":"x","password":"y"}' https://tradingalpha.net/api/v1/auth/login
HTTP/2 401
{"detail":"Invalid username or password"}
```
Ten consecutive POSTs return ten clean `401`s with no `Retry-After`, no
`X-RateLimit-*` headers, no Cloudflare Turnstile, no fail2ban rule in
`infrastructure/vps-setup.sh` that filters Caddy access logs for auth
failures.
**What:** Credential stuffing and password spraying are completely unthrottled.
**Why it matters:** For a trading account, a compromised login = direct
money loss. This is the #1 attack path against any prod trading UI.
**Fix:** Add `caddy-ratelimit` plugin (or the built-in `rate_limit`
experimental module) to `handle /api/v1/auth/*` — something like 5 req/min
per IP + 20/hour per username. Ship `fail2ban` filter for `Caddy
JSON access logs` that bans IPs after N 401s. Consider Cloudflare in front
of the origin for WAF + bot management (see [P1-04]).

### [P0-04] Single origin, no CDN, no failover
**Where:** DNS A record 87.99.143.65 is the only A, no AAAA, no multi-region.
**Evidence:**
```
$ dig tradingalpha.net +short
87.99.143.65       <-- single IP

$ dig tradingalpha.net NS +short
carlane.ns.cloudflare.com.    <-- Cloudflare DNS only, not proxy
aiden.ns.cloudflare.com.

$ ping ... ttl=48       <-- direct hop, no CF anycast in front
```
Infrastructure is a single Hetzner VPS (`infrastructure/vps-setup.sh`
confirms — single machine with fail2ban, Docker, UFW).
**What:** Any DC event (Hetzner Falkenstein outage, network maintenance, VM
crash) = full outage. No geo-distribution, no edge cache.
**Why it matters:** For a trading product, regional users in APAC/ME see
~250-350 ms TTFB from Falkenstein. This adds latency to every quote fetch.
And a single-VPS dependency is an unreviewed SPOF.
**Fix:** Put Cloudflare (or similar) in proxy mode in front of the origin
— takes DDoS absorption off the origin, gives Brotli, edge TLS, static
caching, regional POPs. Current DNS is already on Cloudflare, it's one
orange-cloud toggle. For real redundancy, mirror the Docker stack to a
second VPS in another region and use Cloudflare Load Balancer health
checks.

### [P1-05] WebSocket has no server heartbeat, client relies on close events
**Where:** `backend/api/websocket/handler.py:178-260`,
`frontend/src/hooks/useWebSocket.ts:42-134`.
**Evidence:** Server protocol only handles client-sent `{"action":"ping"}`
(`handler.py:249-250`); there's no `asyncio.create_task` that periodically
sends pings. The browser's `useWebSocket` has `onopen`, `onmessage`,
`onclose`, `onerror` — **no `setInterval` ping, no idle timeout**.
**What:** On mobile networks, proxies silently drop idle TCP connections
after ~60-120 s with no RST. Browser's `readyState` stays `OPEN`, the hook
sits happily waiting for messages that never come. The user sees a stale
portfolio / stale quotes and has no UI indication the stream is dead.
**Why it matters:** Stale quotes on a live book are dangerous — the user
thinks they're seeing live P&L, trades on bad data.
**Fix:**
- Server: add a `asyncio.create_task` in `websocket_endpoint` that sends
  `{"type":"ping"}` every 20 s, and closes the connection if no client
  message (even a pong) arrives in 45 s.
- Client: in `useWebSocket`, set up `setInterval` sending
  `{"action":"ping"}` every 20 s when `readyState === OPEN`, and track
  `lastMessageAt`. If `Date.now() - lastMessageAt > 45000`, treat as dead
  and force `ws.close()` to trigger the reconnect path.
- Add a visible `isStale` indicator in the UI (e.g. dim the quote text
  after 10 s of no updates during market hours).

### [P1-06] Next.js static assets shipped with `max-age=0`
**Where:** Next's own handler, exposed through Caddy.
**Evidence:**
```
$ curl -sI https://tradingalpha.net/favicon.ico
cache-control: public, max-age=0, must-revalidate
content-type: image/x-icon
x-nextjs-cache: HIT
vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch

$ curl -sI https://tradingalpha.net/robots.txt
cache-control: public, max-age=0
etag: W/"55-19d849b0488"
last-modified: Mon, 13 Apr 2026 02:10:45 GMT
```
Neither the Caddyfile nor any Next.js config I can see (`frontend/next.config.*`
is not committed at the paths I checked) sets long TTLs on `_next/static/*`
(hashed filenames that are safe to cache forever).
**What:** Every page load revalidates every chunk against origin. Even with
the `If-None-Match` 304 path, that's one RTT per asset per tab switch.
**Why it matters:** On a trading dashboard that loads ~50 JS chunks on first
visit, this multiplies TTFB by every chunk for returning users. Returning
sessions should reuse the hashed `_next/static/chunks/*.js` from disk cache
for months.
**Fix:** Add a Caddy `@static` matcher and override headers:
```
@static path /_next/static/* /fonts/* /icons/*
header @static Cache-Control "public, max-age=31536000, immutable"
```
Next's default when you set `experimental.staticGenerationRetryCount` and
`output: "standalone"` + CDN-friendly is to ship `immutable` — confirm
`next.config` doesn't clobber it.

### [P1-07] Client retry / backoff is too timid for trading use
**Where:** `frontend/src/hooks/useQueries.ts` (all `useQuery` calls) and
`frontend/src/lib/api.ts:38-54`.
**Evidence:**
```ts
// useQueries.ts:13
return useQuery({
  queryKey: ["regime"],
  queryFn: getMarketRegime,
  staleTime: 5 * 60 * 1000,
  refetchInterval: 5 * 60 * 1000,
  retry: 2,            <-- just 2 retries, default linear delay
});

// api.ts:38 — no timeout on the fetch
const res = await fetch(url, { ...init, headers, credentials: "include" });
```
There's **no timeout at all** on the fetch — a hung origin will block the
query indefinitely (until the browser's 300 s connect timeout).
There's no distinction between "network error — should retry" and "401 —
do not retry". Right now `retry: 2` retries all errors including 4xx.
**What:**
- Hung upstream (e.g. backend blocked on a long query) = frozen UI.
- Bad request (400 / 422) also gets retried twice — wasted cycles.
- Network blip mid-order = no idempotent retry on `placeOrder`.
**Why it matters:** Traders will interpret stale data as live data during
the retry window.
**Fix:**
1. Wrap `fetch` in `AbortController` with a 10 s hard timeout (15 s for
   heavy endpoints like `/api/v1/screener/screen`).
2. In `apiFetch`, throw a subclass error (`NetworkError`, `ServerError`,
   `ClientError`) so React Query's `retry: (count, err) => ...` can skip
   4xx.
3. For trading endpoints, generate an `Idempotency-Key` UUID client-side
   and include it on POST; server must dedupe so a retried `placeOrder`
   is safe.
4. Increase `retry` to 4 with jittered exponential backoff for non-4xx.

### [P1-08] No server-side idle timeout or backpressure on WebSocket broadcasts
**Where:** `backend/api/websocket/handler.py:64-87` (ConnectionManager.broadcast).
**Evidence:**
```python
for ws in targets:
    try:
        await asyncio.wait_for(
            self._send(ws, {"channel": channel, "data": data}),
            timeout=2.0,
        )
    except Exception:
        dead.append(ws)
```
Serial send, 2 s per client, no per-client outbound queue. Under a large
connected-client set (100+), one slow TCP buffer stalls all subsequent
broadcasts on that tick up to 2 s.
**What:** Single slow client can delay quote delivery to every other
client on the same Redis message by up to 2 s × (N clients behind them).
**Why it matters:** This is the classic WebSocket broadcast tarpit. On a
hot tick event (market open, major print), all clients get hit
simultaneously — any ISP-level packet loss on one client becomes global
tail latency.
**Fix:** Use `asyncio.gather(*[send() for ws in targets],
return_exceptions=True)` so sends happen concurrently. Or better, give each
connection its own bounded `asyncio.Queue(maxsize=N)` + per-connection
sender task, and drop-oldest-on-overflow (policy: stale quotes are worse
than dropped quotes).

### [P1-09] `access_token` JWT double-sent (cookie + Authorization header)
**Where:** `frontend/src/lib/api.ts:29-42`.
**Evidence:**
```ts
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
  credentials: "include",     // <-- also sends cookie
});
```
Backend (`backend/core/auth.py:93-100`) tries header first then falls back
to cookie.
**What:** JWT crosses the wire twice, increasing the size of every request
by ~250-500 bytes (small, but cumulative with ~10 requests on a page load).
More importantly, `access_token` is read from `document.cookie`
(`api.ts:17-21`) — which means **the cookie is not `HttpOnly`**, defeating
the main defense-in-depth benefit of cookie-based auth.
**Why it matters:** An XSS (see P0-02) can steal the JWT directly from JS.
**Fix:** Commit to **cookie-only**. Mark the login cookie `HttpOnly;
Secure; SameSite=Lax; Path=/`. Remove the `Authorization` header path in
`apiFetch`. Backend already supports cookie auth (`auth.py:100`). This
also removes the JS `document.cookie` read and the redundant header.

### [P1-10] `x-xss-protection: 1; mode=block` is obsolete & harmful in some browsers
**Where:** `infrastructure/Caddyfile:7`.
**Evidence:**
```
x-xss-protection: 1; mode=block
```
**What:** The XSS Auditor was removed from Chrome 78 (2019) and was never
supported in Firefox. In Safari it's still present but has been
demonstrated to introduce cross-site leaks. Modern guidance (MDN, OWASP
2024) is `X-XSS-Protection: 0` or omit entirely.
**Why it matters:** It gives a false sense of security and the legacy
header has CVE history for information disclosure. Harmless but noisy.
**Fix:** Remove the line from the Caddyfile header block.

### [P1-11] `encode zstd gzip` — no Brotli; Brotli is broadly supported
**Where:** `infrastructure/Caddyfile:16`.
**Evidence:** Caddy's `encode` directive lists `zstd gzip` — Brotli
(`br`) not enabled. curl sent `Accept-Encoding: gzip, br, zstd`; responses
I pulled were small enough not to be compressed (307 redirects) but for
larger assets Brotli yields ~15-25% better ratios than gzip.
**What:** Minor perf loss on first-paint HTML + JSON payloads.
**Why it matters:** On mobile, the few KB on the critical path add up.
**Fix:** Change to `encode zstd br gzip` (br needs the Caddy build with
`caddy-brotli` or Caddy 2.8+ which includes it). Zstd is still the
top-line choice for clients that support it, so keep it first.

### [P1-12] `h3=":443"` advertised but no QUIC verification in CI
**Where:** `alt-svc: h3=":443"; ma=2592000` response header, UFW config
opens only TCP 443/80 (`infrastructure/vps-setup.sh:23-26`).
**Evidence:**
```
$ ufw allow 80/tcp
$ ufw allow 443/tcp
(no UDP 443 allowed)
```
curl 8.7.1 on macOS doesn't have HTTP/3 compiled in, so I couldn't
confirm an H3 handshake completes, but `ufw` explicitly only allows
**TCP** 443. QUIC is UDP. **UDP 443 is blocked at the firewall.**
**What:** Clients honoring `Alt-Svc: h3=":443"` will try QUIC and fail
silently, falling back to HTTP/2. The Alt-Svc cache (`ma=2592000` = 30
days) will have them trying a blocked port for a month.
**Why it matters:** Wasted DNS + UDP handshake attempts on every
supporting client for 30 days per cache entry. On lossy mobile networks
this adds real latency before fallback kicks in.
**Fix:** Either (a) open UDP 443 on the VPS and confirm Caddy is
configured to serve H3 (`servers { protocol { experimental_http3 } }`
in newer Caddy, or just rely on 2.8+ defaults — **and confirm UFW
allows `udp/443`**), or (b) strip the `alt-svc` header in the Caddyfile
until you're ready: `header -alt-svc`.

### [P1-13] Caddy `-Server` header strip doesn't cover port-80 redirector
**Where:** `infrastructure/Caddyfile:11` only applies inside the
`{$DOMAIN}` block; Caddy's built-in port-80 ACME+redirect handler
leaks `Server: Caddy`.
**Evidence:**
```
$ curl -sI http://tradingalpha.net/
HTTP/1.1 308 Permanent Redirect
Server: Caddy       <-- leaks
```
**What:** Minor fingerprinting — tells a scanner which reverse proxy is
in use, which directs them to Caddy-specific CVEs.
**Why it matters:** Low impact but trivially fixed.
**Fix:** Add an explicit `:80` block to the Caddyfile with the same
`-Server` header strip, or use a separate `header -Server` in a
`handle_path /*` route.

### [P1-14] 404 returns JSON, 405 returns text — inconsistent error format
**Where:** FastAPI default handlers, unchanged.
**Evidence:**
```
$ curl -sI https://tradingalpha.net/api/does-not-exist
HTTP/2 404
content-type: application/json
content-length: 22
{"detail":"Not Found"}

$ curl -sI https://tradingalpha.net/api/v1/market/quotes/AAPL  (HEAD)
HTTP/2 405
content-type: application/json
allow: GET
(body: {"detail":"Method Not Allowed"} — 31 bytes)

$ curl -sI https://tradingalpha.net/api/trade_ledger    (CORS preflight shape)
HTTP/2 400
content-type: text/plain; charset=utf-8
content-length: 22
```
**What:** Frontend `apiFetch` (`api.ts:56-66`) does
`const body = await res.text()` and throws `API ${status}: ${statusText} –
${body}`. When the body happens to be text rather than JSON, the toast
system (`window.dispatchEvent("alphadesk:api-error", ...)`) gets a bare
HTTP status string instead of a parsed `{detail}`.
**Why it matters:** UX degrades — toast shows `API 400: – Bad Request`
instead of a useful message.
**Fix:** Add a `@app.exception_handler(HTTPException)` in `backend/main.py`
that returns a consistent `{error: {code, message, request_id}}`
envelope. Update `apiFetch` to parse JSON first, fall back to text.

### [P1-15] WebSocket auth reads cookie from handshake — but cookie isn't HttpOnly
**Where:** `backend/api/websocket/handler.py:199`, cookie set flow in
`frontend/src/lib/api.ts:17-21`.
**Evidence:**
```python
cookie_token = ws.cookies.get("access_token")    # works because browser
                                                  # includes cookies on ws://
                                                  # same-origin
```
Since the cookie is readable from JS (`document.cookie.match(/access_token=/)`,
api.ts:19), a stolen cookie can be used for WS auth too.
**What:** Same XSS-steal path as P1-09 — WS adds one more way an attacker's
JS can replay the token.
**Fix:** See P1-09 — move to HttpOnly cookie. WS cookie auth will still
work because the browser sends cookies on the WS handshake automatically;
JS does not need to read them.

### [P2-16] `set-cookie: access_token=; Path=/; Expires=Thu, 01 Jan 1970`
sent on every 307 to /login
**Where:** Server response to unauthenticated `GET /`.
**Evidence:** Shown in the baseline above. Every single unauthenticated
request includes a cookie-clear directive in the 307.
**What:** Not harmful, but wasteful — the browser clears an already-absent
cookie on every request. Confusing for debug.
**Why it matters:** Tiny overhead, but muddies logs when trying to track
real logout vs. implicit redirect.
**Fix:** Only set the clearing cookie on explicit logout (`/api/v1/auth/logout`)
and on a known-bad-token 401, not on every anonymous 307.

### [P2-17] No CAA record
**Where:** DNS.
**Evidence:** `dig tradingalpha.net CAA +short` returns empty.
**What:** Any CA can issue a cert for `tradingalpha.net`. A compromised
validation path at any CA = mis-issued cert.
**Why it matters:** Defense-in-depth for TLS.
**Fix:** Add at the Cloudflare DNS:
```
tradingalpha.net. CAA 0 issue "letsencrypt.org"
tradingalpha.net. CAA 0 issuewild ";"
tradingalpha.net. CAA 0 iodef "mailto:security@tradingalpha.net"
```

### [P2-18] No DNSSEC on `tradingalpha.net`
**Where:** DNS.
**Evidence:** `dig tradingalpha.net DNSKEY +short` empty (parent `.net`
has DS from the trace output, but this domain is unsigned).
**What:** DNS cache poisoning / on-path DNS hijack not detected.
**Why it matters:** For a trading product subject to account-takeover
risks, DNSSEC would make it measurably harder for a regional attacker to
intercept `tradingalpha.net` resolution.
**Fix:** Enable DNSSEC on Cloudflare (one-click), then add the DS record
at the registrar.

### [P2-19] `cache-control: private, no-cache, no-store` on `_next/static/chunks/`
**Where:** Observed on `/_next/static/chunks/` — 404 path response had
`cache-control: private, no-cache, no-store, max-age=0, must-revalidate`.
**What:** Even actual hashed chunk responses (when they 200) inherit
cautious caching from Next's default middleware. See P1-06 for fix.

### [P2-20] `content-length: 22` JSON 404/405 bodies waste bytes on HEAD
**Where:** Caddy/FastAPI 404/405 handlers.
**What:** HEAD responses return 22-byte content-length but the body is
implicitly empty (`HEAD`), while the content-length from GET is the full
`{"detail":"Not Found"}`. Mostly correct but the Caddy via header `via: 1.1 Caddy`
and the `content-length` for the stub body appear on HEAD where they
shouldn't strictly. Not a bug, just hygiene.
**Fix:** None required. Noting for completeness.

### [P2-21] No `/healthz` or `/readiness` exposed for LB checks
**Where:** Backend has `/health` (`backend/main.py:190-198`) behind the
Caddy `handle /api/*` rule; but the Caddy config doesn't route `/health`
to the backend, so it's effectively inaccessible from outside.
**Evidence:**
```
$ curl -sI https://tradingalpha.net/health
HTTP/2 404  content-length: 2444     <-- Next.js 404 page
$ curl -sI https://tradingalpha.net/api/health
HTTP/2 404  content-length: 22       <-- FastAPI not found (no /api/health route)
```
The actual route is `/api/v1/...` — there's no top-level health endpoint
that a load balancer or Uptime Kuma can probe without auth. The prod
compose file (`infrastructure/docker-compose.prod.yml:50-55`) has
`healthcheck: urllib.request.urlopen('http://127.0.0.1:8000/health')` — that
works **inside** the Docker network but not from the public side.
**What:** External monitoring has to pick an endpoint that returns 307
and call it healthy. Fragile.
**Fix:** Add to the Caddyfile:
```
handle /health {
    reverse_proxy backend:8000
}
```
Or better, expose a `/healthz` in FastAPI that also checks DB + Redis
liveness and returns structured health data. Use it in Cloudflare Load
Balancer / Uptime Kuma.

### [P2-22] `Permissions-Policy` is minimal
**Where:** `infrastructure/Caddyfile:9`.
**Evidence:**
```
permissions-policy: camera=(), microphone=(), geolocation=()
```
**What:** Three features disabled; everything else (usb, payment, bluetooth,
idle-detection, serial, accelerometer, gyroscope, encrypted-media, ...)
still allowed by default.
**Why it matters:** If an attacker lands XSS (see P0-02), they can
leverage features like `usb` (for hardware fingerprinting) or
`payment` (for phishing). Best practice is to explicitly deny everything
not used.
**Fix:** Expand to:
```
Permissions-Policy "accelerometer=(), ambient-light-sensor=(), autoplay=(), battery=(), camera=(), cross-origin-isolated=(), display-capture=(), document-domain=(), encrypted-media=(), execution-while-not-rendered=(), execution-while-out-of-viewport=(), fullscreen=(self), geolocation=(), gyroscope=(), keyboard-map=(), magnetometer=(), microphone=(), midi=(), navigation-override=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), sync-xhr=(), usb=(), web-share=(), xr-spatial-tracking=()"
```

### [P2-23] No `Cross-Origin-*` hardening
**Where:** Caddyfile — absent.
**Evidence:** No `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy`,
or `Cross-Origin-Resource-Policy` headers.
**What:** Spectre/Meltdown mitigations + cross-origin isolation are not
engaged.
**Why it matters:** For a trading dashboard with financial data,
cross-origin read should be strictly denied for JSON endpoints.
**Fix:**
```
Cross-Origin-Opener-Policy "same-origin"
Cross-Origin-Resource-Policy "same-site"
```
Consider `Cross-Origin-Embedder-Policy "require-corp"` once you verify
no third-party embeds are needed (chart libraries, etc.).

### [P3-24] `X-Request-ID` returned but not logged alongside Caddy access log
**Where:** `backend/main.py:180-186` sets `X-Request-ID`; Caddy config
doesn't log it.
**Evidence:** Response has `x-request-id: 0c48271c-...`; Caddy Caddyfile
has no `log` directive at all — default logs go to stderr but without
the request ID.
**What:** When a user reports "my order failed at 14:30", there's no way
to correlate their browser's request ID with server logs without SSH +
grep.
**Fix:** Add to Caddyfile:
```
log {
    output file /var/log/caddy/access.log
    format json
    level INFO
}
```
And have the backend echo `X-Request-ID` into the log line — Caddy's
template can include `{>X-Request-ID}`.

### [P3-25] No `/.well-known/security.txt`
**Where:** Web root.
**Evidence:** `curl -sI https://tradingalpha.net/.well-known/security.txt`
returns a 307 to `/login` (goes through the SPA catch-all).
**What:** No contact path for disclosure. RFC 9116 recommends this.
**Fix:** Host a static `security.txt` in the Next.js `public/.well-known/`
directory with a `Contact: mailto:security@...`, `Expires:`, `Preferred-Languages: en`.

### [P3-26] `qa-*.mjs` files (100+) polluting the repo root
**Where:** `/Users/GK/Downloads/alphadesk/qa-*.mjs` — 90+ files.
**What:** Not a network issue per se, but these are served by the Next.js
public folder potentially if named oddly. They're currently `.mjs` at repo
root, not in `public/`, so they won't be web-served. Noting only because a
careless `cp ./*.mjs frontend/public/` in the future would expose them.
**Fix:** Move to `qa/` or `tests/e2e/`.

---

## What's good

1. **TLS 1.3 only, modern AEAD cipher (CHACHA20-POLY1305), X25519 KX.**
   Exactly the right profile.
2. **HSTS preload with `includeSubDomains`.** 1 year max-age, preload eligible.
3. **HTTP -> HTTPS 308 redirect works** (`curl http://tradingalpha.net` ->
   308 Location: https://).
4. **Strict CORS** — only production origin echoed; preflight 400 on evil.com.
   `Vary: Origin` properly set.
5. **`X-Frame-Options: DENY` + `frame-ancestors 'none'`** — clickjacking
   protection doubled up.
6. **`X-Content-Type-Options: nosniff`** + explicit content types.
7. **Server header stripped** (on main site block), `X-Powered-By` removed.
8. **WebSocket reconnect on the client has jittered exponential backoff**
   up to 10 retries (`useWebSocket.ts:25-28`, `115-121`).
9. **Redis listener has retry with exponential backoff** capped at 30 s,
   gives up after ~25 min (`handler.py:106-152`). Good.
10. **Request ID tracking** (`X-Request-ID` header, `backend/main.py:180`) —
    present in every response, foundational for debugging.
11. **TanStack Query with 30-60 s `staleTime` / `refetchInterval`** is
    appropriate for most endpoints (strategies, portfolio summary).
12. **Let's Encrypt with short (82-day) cert lifetime** forces rotation
    hygiene.
13. **UFW default deny + explicit 22/80/443 TCP allow** in
    `vps-setup.sh:19-26` — correct firewall default.
14. **JWT revocation blocklist** via Redis (`core/auth.py:74-85`) — good,
    even if the fail-closed semantic is the P0 above.
15. **Visibility-based reconnect** in `useWebSocket.ts:148-161` — when the
    tab becomes visible again after sleep, it resets the retry counter and
    reconnects. Nice touch.
16. **Proxy headers trusted correctly** —
    `app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])`
    (`backend/main.py:148`) means `X-Forwarded-For` is honored but the
    comment acknowledges Caddy is the only upstream.

---

## Overall Networking Score: **71 / 100**

Breakdown:

| Category | Score | Notes |
|---|---|---|
| **Security /30** | **19/30** | Great TLS, HSTS, CORS, XFO — but CSP has `unsafe-inline 'unsafe-eval'` (P0), no rate-limit on auth (P0), JWT also readable from JS cookie (P1), no CAA/DNSSEC (P2), missing COOP/CORP (P2). |
| **Latency /25** | **18/25** | 60 ms p50 TTFB from US-East is fine — but no CDN/edge, no HTTP/3 actually reachable, no static-asset caching, no Brotli. For APAC users this is 250+ ms. |
| **Reliability /25** | **16/25** | Single VPS single region (P0), fail-closed Redis auth (P0), no WS heartbeat (P1), WS broadcast is serial (P1), client retry too timid (P1), no external-facing healthcheck (P2). On the plus side: good reconnect logic, good Redis listener retry, good request ID tracking. |
| **Configuration /20** | **18/20** | Caddyfile is clean and minimal; CORS well-configured; compression on; proxy headers correctly trusted. Losing a few points for port-80 redirector leaking `Server`, for `max-age=2592000` Alt-Svc without UDP 443 open, and for missing log config. |

---

## Recommended priority ordering

1. [P0-01] Make Redis auth revocation fail-open or cache-JTI fallback.
2. [P0-02] Switch CSP to nonce-based, drop `'unsafe-inline'` + `'unsafe-eval'`.
3. [P0-03] Rate-limit `/api/v1/auth/*` at Caddy layer; add fail2ban rule.
4. [P1-05] Add bidirectional WS ping + stale-connection detection.
5. [P1-09] HttpOnly cookie only for JWT; remove Authorization header path.
6. [P1-06] Long cache TTL on `_next/static/*`.
7. [P1-07] Per-endpoint fetch timeout + idempotency keys for POST /trades/orders.
8. [P0-04] Put Cloudflare in proxy mode for DDoS + edge cache + Brotli.
9. Remaining P1/P2 items.
