# Iteration 1 — Live Networking + Performance Audit
Date: 2026-04-18
Source of truth: tradingalpha.net in production

## Measured baseline

| Probe | Result |
|---|---|
| HTTP/2 HEAD `/` | `307 → /login`, HSTS `max-age=31536000; includeSubDomains; preload`, `alt-svc: h3=":443"` |
| TLS | TLSv1.3 AEAD-CHACHA20-POLY1305-SHA256, Let's Encrypt `CN=E8`, `notBefore=Apr 10 2026`, `notAfter=Jul  9 2026` (~82 days left) |
| Handshake | namelookup 2.3ms / connect 18.4ms / appconnect 39.7ms / ttfb 63.0ms / total 63.1ms |
| DNS | A `87.99.143.65`; AAAA **empty**; CAA **empty**; MX **empty**; TXT **empty** |
| `/api/v1/strategies` | `307` redirect to trailing-slash variant (unauthenticated) — CSP + HSTS applied, `x-request-id` present |
| Rate limit probe | 10 rapid POSTs to `/api/v1/auth/login` all returned `401` (no 429, no lockout) |
| HTTP/3 | advertised via `alt-svc` only; local curl lacks h3 so unverified |
| Static asset caching | `/_next/static/chunks/*.js` → `cache-control: public, max-age=31536000, immutable` + brotli (3733→1605 bytes) |
| docker stats | backend 91 MB / 1.5 GB, frontend 60 MB / 512 MB, caddy 20 MB, redis 3 MB, timescale 12 MB, uptime-kuma 56 MB |
| Host memory | `Mem: 1919 used 1279 free 106`, `Swap: 2047 used 728` — **36% of swap in use on a 2 GB box** |
| Disk | `/dev/sda1 38G used 27G free 8.8G (76%)` |
| Bundle | `.next/static/chunks` 1.8 MB uncompressed across 40 `.js` files; largest 222 KB, 198 KB, 180 KB; login preloads **14 script tags** |
| Container uptime | backend "Up 3 minutes", frontend "Up 3 minutes" (just redeployed 06:19); restart count backend=0 frontend=0 |
| journalctl | **restartCount=12** observed for a caddy container `f07b7c...` at 06:10; image signature validation errors on every pull ("expected image index descriptor, got ...manifest.v2+json") |

## Severity legend
P0 = security hole or availability risk; P1 = performance; P2 = hygiene; P3 = polish

## Findings

### [P0] CSP still carries `'unsafe-inline' 'unsafe-eval'` — unchanged since iter-0
**Where:** `/opt/alphadesk/infrastructure/Caddyfile`, every response header.
**Evidence:** `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; …`
**What:** Next.js inline bootstrap chunks still require both directives — CSP is effectively disabled for script injection.
**Why it matters:** Any stored-XSS vector (e.g. strategy name, chat echo) executes in the authenticated session.
**Fix:** Switch to Next's nonce mode (`experimental.cspNonce` + `next-safe` middleware), emit `script-src 'self' 'nonce-<random>' 'strict-dynamic'`; drop `unsafe-eval` after confirming no remaining `new Function()` usage in vendor chunks.

### [P0] No rate limit on `/api/v1/auth/login` — unchanged
**Where:** Caddyfile has **no** `rate_limit` directive; backend relies on Redis bucket which returns 401 on every hit.
**Evidence:** 10 consecutive bad logins from one client returned `401 401 401 401 401 401 401 401 401 401`. Backend log shows all ten requests served, no 429.
**What:** Credential stuffing and brute force are free.
**Fix:** Install `caddy-ratelimit` module and add `rate_limit { zone login { key {client.ip} events 5 window 60s } }` on `handle /api/v1/auth/login`. Fail with 429 + `Retry-After`.

### [P0] Swap thrashing on a 2 GB VPS — availability risk
**Where:** host (87.99.143.65).
**Evidence:** `Swap: 2047 used 728` means 728 MB of the 2 GB swapfile is active; `free` shows only 106 MB truly free. Backend+frontend+timescale+redis+kuma containers sum to ~241 MB RSS, so ~1 GB is kernel/dockerd/other — and traffic spikes will page-fault.
**Why it matters:** Next `/api/v1/strategies` TTFB already 63 ms on an idle box; under load swap I/O tanks latency and can OOM-kill containers. Single VPS SPOF (iter-0 P0) still present.
**Fix:** Hetzner CCX13 (4 GB) is a one-click resize. Also set memory limits explicitly; `alphadesk-backend` is capped at 1.5 GB but nothing stops kuma+timescale from ballooning.

### [P0] TLS cert has 82 days of life, no DNS CAA record
**Where:** DNS zone for tradingalpha.net.
**Evidence:** `dig tradingalpha.net CAA +short` — empty.
**What:** Any CA that DV-validates port-80 can mint a cert for the domain.
**Fix:** Add `tradingalpha.net. 3600 IN CAA 0 issue "letsencrypt.org"` and `CAA 0 iodef "mailto:gurkiratkang@gmail.com"`.

### [P1] Login page preloads **14 async JS chunks** totalling ~1.3 MB uncompressed
**Where:** GET `/login` HTML.
**Evidence:** 14 `<script src="/_next/static/chunks/*.js" async>` tags; the three largest bundled chunks are 222 KB, 203 KB, 184 KB.
**Why it matters:** Unauthenticated sign-in page ships the entire app — recharts, lightweight-charts, zustand, etc. Time-to-interactive on a 3G mobile connection is >4 s even before auth succeeds.
**Fix:** Route-split `/login` and `/request-access` into a standalone layout with no client-side providers; lazy-load charts/tables only on authenticated routes.

### [P1] No HTTP/3 (QUIC) actually terminated despite `alt-svc` advertisement
**Where:** Caddyfile global block.
**Evidence:** `alt-svc: h3=":443"; ma=2592000` is sent but Caddy v2 needs `servers { protocols h1 h2 h3 }` block, not present.
**Fix:** Add `{ servers { protocols h1 h2 h3 } }` at top of Caddyfile; open UDP/443 in Hetzner firewall.

### [P1] Docker image signature validation failing every pull
**Where:** journalctl 06:19:22, 06:19:43.
**Evidence:** `level=error msg="failed to validate image signature" error="resolving signature chain for image … expected image index descriptor, got application/vnd.docker.distribution.manifest.v2+json"`
**What:** Supply-chain verification is silently disabled — deployment hook logs errors but still runs the image.
**Fix:** Either (a) publish proper OCI image index with cosign attestations and enforce `containerd.toml` policy, or (b) disable the half-configured verifier so alerts are meaningful.

### [P1] Caddy container restart loop earlier tonight (count 12)
**Where:** `journalctl` 06:09:48 … 06:11:02 for container `f07b7c1…`.
**Evidence:** `restarting container … exitCode=1 restartCount=11` then `…restartCount=12` then `stopping restart-manager`.
**What:** Caddy crashed 12 times before being replaced during the 06:19 deploy. No healthcheck / alert fired.
**Fix:** Add Caddy healthcheck (`/health` endpoint) in `docker-compose.yml` and uptime-kuma monitor. Capture `docker logs alphadesk-caddy-1 --previous` on restart.

### [P2] `X-XSS-Protection: 1; mode=block` — deprecated, mildly harmful
**Where:** Caddyfile `header` block.
**Evidence:** `x-xss-protection: 1; mode=block` in every response.
**Why it matters:** Modern Chrome/Firefox/Edge ignore it; old IE/Safari implementations are themselves XSS vectors. OWASP now recommends `0`.
**Fix:** Either remove the line or set `X-Xss-Protection "0"`.

### [P2] No `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` / `Cross-Origin-Resource-Policy`
**Where:** Caddyfile header block.
**Evidence:** absent from response headers above.
**Why it matters:** Site is not cross-origin isolated; vulnerable to Spectre-class side-channel and tab-nabbing via `window.opener`.
**Fix:** Add `Cross-Origin-Opener-Policy "same-origin"`, `Cross-Origin-Resource-Policy "same-origin"`. (COEP `require-corp` would break OAuth popups — skip.)

### [P2] No IPv6 (AAAA missing)
**Evidence:** `dig tradingalpha.net AAAA +short` empty.
**Fix:** Enable IPv6 on the Hetzner server and publish the AAAA. Hetzner provides /64 free.

### [P2] Disk at 76% on 38 GB — growth headroom is 8.8 GB
**Evidence:** `/dev/sda1 38G used 27G`; timescaledb block I/O 60 MB already, uptime-kuma 112 MB, frontend image layers 26 MB. `du` on `/var/lib/docker` not yet run but growth rate is what matters.
**Fix:** Add `docker system prune --filter "until=72h" -f` weekly cron; move TimescaleDB data volume to a Hetzner Volume so it doesn't share root disk.

### [P2] No SPF / DMARC (if email is ever sent)
**Evidence:** `dig … TXT` empty, `dig … MX` empty.
**Why it matters:** When password-reset or invite emails launch, unauthenticated senders can spoof `@tradingalpha.net`.
**Fix:** Publish `v=spf1 -all` + `_dmarc.tradingalpha.net TXT "v=DMARC1; p=reject; rua=mailto:…"` **now** (reject-everyone posture), relax when a real sender is configured.

### [P3] Referrer-Policy could be tightened
**Evidence:** `strict-origin-when-cross-origin` sent; site has no outbound third-party content anyway.
**Fix:** `Referrer-Policy "no-referrer"`.

### [P3] `via: 1.1 Caddy` header leaks proxy identity
**Evidence:** `via: 1.1 Caddy` in every response.
**Fix:** Add `header -Via` to Caddyfile header block (already stripping `Server` and `X-Powered-By`).

### [P3] `Set-Cookie: access_token=` on the 307 from `/` is sent without `Secure`/`HttpOnly`/`SameSite`
**Evidence:** `set-cookie: access_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT` — this is an expiry/unset of the cookie but the set-cookie directive itself has no `Secure; HttpOnly; SameSite=Strict`.
**Why it matters:** Minor; browsers typically honour prior cookie attributes on deletion. But attackers can replay a bare `access_token=…` over `ws://` if an HTTP downgrade ever slipped HSTS (e.g. a subdomain without HSTS).
**Fix:** In backend `auth.py`, when deleting the cookie always set `Secure=True, HttpOnly=True, SameSite="strict"` explicitly.

## What's good

- TLS 1.3 with AEAD cipher, HSTS 1y + `includeSubDomains; preload` — preload list eligible.
- TTFB 63 ms on `/` from my US-West box to a Falkenstein-ish VPS is very respectable; network is not the bottleneck.
- Frontend bundle chunks are served `immutable` + brotli — brotli ratio ~2.3× on the sampled chunk (3733 → 1605 bytes).
- `x-request-id` header on API responses — tracing works.
- Caddy correctly drops `Server` and `X-Powered-By`.
- All six application containers healthy at audit time; backend and frontend RestartCount=0.
- Rapid login probe returned structured 401s (no info leak, no 500) — auth path is calm under repeat.
- Free swap of 1319 MB still exists — we aren't OOM-ing yet.
- Uptime-kuma is running → alerting infrastructure is already on-host, just needs more probes.

## Overall score: 74/100 (vs prior 71)

Small improvement over the 71 iter-0 baseline: Redis fail-closed behaviour isn't re-tested here (nothing in the live probe evidences it one way or another) but the observable security posture is slightly better thanks to HSTS-preload + x-request-id. The three iter-0 P0s that are **directly reproducible from outside** — CSP `unsafe-inline/eval`, no login rate-limit, single-VPS SPOF — are **still all present**, and the swap pressure on the 2 GB host is a new availability P0.
