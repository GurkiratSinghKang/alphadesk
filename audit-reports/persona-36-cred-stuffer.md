# Persona 36 — Credential Stuffer

**Target:** `POST /api/v1/auth/login` on tradingalpha.net
**Test username:** `nobody-test-pwned-2026` (fake; admin lockout avoided)
**Date:** 2026-04-18
**Scope:** Verify rate-limit regression from Wave 31 (success-counting bug) and Wave 15 (X-Forwarded-For spoof fix) still hold under live attack simulation.

---

## Executive verdict: **PASS — rate-limit and XFF defences hold**

- Lockout trips exactly on the 6th attempt (after 5 failures within 5 min window), returning HTTP 429 + `Retry-After: 300`.
- XFF spoofing, `X-Real-IP`, RFC 7239 `Forwarded`, and CIDR-chain headers all **fail to bypass** the per-IP limit — attacker's real public IP remains the counter key because Caddy is the only proxy whose forwarded headers are trusted (`main.py:157-167`).
- Successful login wipes the failure counter (`_clear_login_failures` called in success branch, `auth.py:335`) — Wave 31 regression fixed.
- Attacker with 100 passwords will have ~5 tries before hitting 5-minute cool-down → must wait 300s between every 5 attempts → 100 passwords = ~100 min of locked-out idle time. Impractical.

---

## Findings (10)

### F1. [INFO] Rate limit activates at 6th attempt, 5-minute window, 429 + Retry-After: 300
Attempts 1–5 return 401, attempt 6 returns 429 with `retry-after: 300`. Matches spec in `backend/api/routes/auth.py:112-113` (`_RATE_LIMIT_WINDOW=300`, `_RATE_LIMIT_MAX=5`). Evidence: live test logged 8 consecutive POSTs — attempts 1–5 `HTTP 401`, attempts 6–8 `HTTP 429 retry-after=300`.

### F2. [INFO] Read-only check — successful login does NOT consume an attempt (Wave 31 fix verified by code review)
`_check_rate_limit()` in `auth.py:165-205` is purely read; only `_record_login_failure()` (called from the 401 branch, `auth.py:322`) increments. `_clear_login_failures()` (called from success branch, `auth.py:335`) wipes the counter. The success-counting regression from persona-9 P0 #1 cannot recur without a code change. Live re-verification with admin creds deferred to avoid lockout risk per task constraints.

### F3. [INFO] XFF spoofing ignored — attacker cannot rotate source IPs
Sent `X-Forwarded-For: 1.2.3.4`, `5.6.7.8`, `9.10.11.12`, `13.14.15.16`, `17.18.19.20` — all returned 429 (my real public IP was already over the threshold). Confirms `ProxyHeadersMiddleware(trusted_hosts=_TRUSTED_PROXY_HOSTS)` in `main.py:167` restricts XFF trust to Caddy's Docker subnet (`172.16/12`, `10/8`, `192.168/16`, loopback). Wave 15 fix verified live.

### F4. [INFO] Alternative proxy headers also don't bypass
`X-Real-IP`, `Forwarded` (RFC 7239), and chained `X-Forwarded-For: A, B` all resulted in 429. FastAPI only respects XFF via `ProxyHeadersMiddleware` and only from trusted hosts. `_client_ip()` in `auth.py:17-26` also only reads `x-forwarded-for` — other headers are ignored entirely.

### F5. [LOW] `Retry-After` is hard-coded to 300s, never reflects actual remaining TTL
`auth.py:204` emits `headers={"Retry-After": str(_RATE_LIMIT_WINDOW)}` unconditionally. 30 seconds after lockout began, `Retry-After` still said 300. Not a security bug but a UX lie: well-behaved API clients will back off longer than necessary. Could query Redis TTL (`redis.ttl(key)`) and emit the actual remaining seconds. Low priority.

### F6. [LOW] TTL is NOT extended on subsequent failures (`nx=True`) — correct, by design
`auth.py:225` uses `pipe.expire(key, _RATE_LIMIT_WINDOW, nx=True)` — TTL set only on freshly minted key. Without `nx`, every incr would reset the TTL → lockout-forever bug. Worth noting here because the test confirmed the window *does* slide off: if an attacker stops at attempt 5 and waits 300s, they get a fresh 5 attempts. Not exploitable (5 per 5 min = 1 per min sustained, totally impractical for cred stuffing).

### F7. [MEDIUM] Lockout is per-IP, not per-username — NAT collateral damage
A legitimate user behind the same corporate/residential NAT gateway as an attacker will be locked out along with them. With a singleton admin account this is mostly theoretical, but consider a composite key `(ip, submitted_username)` so a flood targeted at `nobody-test-pwned-2026` doesn't also block a legit admin login from the same egress IP. File: `auth.py:181` (key format `login_attempts:{client_ip}`).

### F8. [LOW] In-memory fallback is per-worker — a multi-worker deploy permits `N × 5` attempts during Redis outage
`auth.py:115-163` maintains `_INMEM_ATTEMPTS` per Python process. With e.g. 4 uvicorn workers, an attacker gets 20 attempts during a Redis blip before getting locked out. Acknowledged in docstring (`auth.py:176-179`) as "dramatically lower than unlimited" which is fair — Redis outage is rare and the multiplier is bounded. Worth monitoring: spike in the `"Rate limit: Redis unavailable"` warning (`auth.py:193, 228, 250`) should page.

### F9. [LOW] `_INMEM_MAX_KEYS` eviction is a full `.clear()` not LRU
`auth.py:150-151`: if more than 10k IPs land in memory during a Redis outage, the entire table is wiped. An attacker flooding from 10k+ IPs during a Redis outage could trigger this and wipe their own lockouts. Implausible attack chain (requires Redis outage + 10k unique IPs) but noted. Prefer OrderedDict popitem(last=False).

### F10. [INFO] No lockout-notification / audit on 429
Lockout itself (hitting the cap) doesn't emit an audit log line — only individual login attempts do (`_audit("login", ..., result="failure")` at `auth.py:319`). When an IP trips the cap, SOC should see a distinct event. Add `_audit("login_ratelimit", user=submitted_username or "-", ip=client_ip, result="blocked")` inside `_check_rate_limit` before raising 429. Defensive detection, not prevention.

---

## Summary (250 words)

The login endpoint's rate-limit and XFF-spoofing defences are live and correct on tradingalpha.net. Firing 8 consecutive failed logins against `nobody-test-pwned-2026` confirmed the cap trips exactly on the 6th attempt — attempts 1–5 return 401, attempts 6+ return 429 with `Retry-After: 300`. The Wave 31 fix (don't count successful logins toward the cap) is structurally preserved: `_check_rate_limit` in `backend/api/routes/auth.py:165-205` is read-only, and only the 401 branch increments via `_record_login_failure`. The success branch clears the counter via `_clear_login_failures`.

The Wave 15 XFF-spoof fix holds: rotating `X-Forwarded-For: 1.2.3.4`, `5.6.7.8`, `9.10.11.12`, etc. across five requests did not reset the per-IP counter — all returned 429. The `ProxyHeadersMiddleware` in `backend/main.py:167` only trusts forwarded headers from Caddy's private network (`172.16/12`, `10/8`, `192.168/16`, `127.0.0.1`). Alternative headers (`X-Real-IP`, RFC 7239 `Forwarded`, CIDR-chain XFF) are ignored. A 100-password cred-stuffing attack would take ~100 minutes of idle time — impractical.

Minor advisory items: `Retry-After` is hard-coded to 300s rather than actual Redis TTL (UX lie, not a security hole); lockout is per-IP so NAT-shared legit users get collateral-locked; in-memory fallback is per-worker and could permit `N × 5` attempts during a Redis outage. None of these materially degrade the defence. Verdict: rate-limit is production-grade. No admin account was locked out during testing.
