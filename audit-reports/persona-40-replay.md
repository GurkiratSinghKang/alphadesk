# Persona 40 — Replay Attacker

**Scope:** Attacker captures a valid `POST /api/v1/trades/orders` (with its `Authorization: Bearer <JWT>` or `access_token` cookie) and replays it 10 minutes later. Can dedup or `Idempotency-Key` stop it? Can bypass be achieved with payload tweaks?

**Trust boundary:** any vantage point where the full HTTP request is visible — a compromised browser extension, a logged CI job, a proxy/TLS-terminator log, a stolen HAR file. Attacker needs only the token + body; no origin check applies on a pure server-to-server replay.

**Target code:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` lines 294–433 (`create_order`) and 843–881 (`_check_duplicate_order`); `/Users/GK/Downloads/alphadesk/backend/core/auth.py` lines 43–49, 147–174; `/Users/GK/Downloads/alphadesk/backend/main.py` lines 144–167, 175–189.

---

## Executive answers

| Question | Answer |
| --- | --- |
| Does the 30-sec Redis dedup protect against a 10-min replay? | **No.** Dedup window is 30 s; the replay at T+10 min sails through. |
| Does an `Idempotency-Key` header help? | **No.** The header is parsed by no middleware and no route. It is silently ignored — one bit of entropy in the header does nothing; a second identical replay still books a fresh order. |
| Is dedup bypass possible inside the 30-sec window? | **Yes — trivially.** Toggling `notes`, `strategy`, or `time_in_force`, or floating-point-permuting `qty` / `limit_price` all produce a new dedup key. |

---

## F1 — 30-second dedup window is far too short to be a replay defence (CRITICAL)

`trades.py:843-881` hashes `symbol/side/qty/type/limit_price/stop_price/tif` into `order_dedup:<sha256>` with `SET NX EX 30`. A replay at T+10 min hits an empty key — `SET NX` succeeds, a second identical order is booked. For a 1k-share MARKET BUY on AAPL this is a second position, second commission, second slippage. The 30 s TTL is documented in the docstring as a dedup window for double-clicks; it was never a replay defence and there is no other layer behind it.

## F2 — `Idempotency-Key` header is silently ignored (CRITICAL)

Grep for `idempotency` across `/Users/GK/Downloads/alphadesk/backend/` returns zero references in `api/routes/trades.py`. `CreateOrderRequest` (trades.py:175) does not read headers. No FastAPI middleware extracts it. A well-behaved API client that sends `Idempotency-Key: <uuid>` believing it gets at-most-once semantics instead gets at-least-once: the first call books, the timeout-driven retry books a second order. (Confirmed and documented in `audit-reports/persona-11-api-consumer.md:25` and `audit-reports/02-backend.md:193`.)

## F3 — JWTs are valid for 480 min; a captured token trivially covers the 10-min replay (HIGH)

`core/config.py:82` — `ACCESS_TOKEN_EXPIRE_MINUTES = 480`. No `iat`/freshness check on the resource endpoint, no per-request nonce, no request signing. A token stolen at 09:00 is accepted at 17:00. Combined with F1/F2 the 10-min replay is a pure `curl` replay with no wrapping needed. Refresh tokens last 30 days.

## F4 — Trivial dedup bypass: change `notes` by one byte (HIGH)

`notes: str \| None` (trades.py:179) is in the request body but deliberately excluded from the dedup hash (which only hashes the legs + `tif`, trades.py:856-872). An attacker replaying **inside** the 30 s window can append a space, a newline, or a different UUID-looking comment each time and submit N identical trades. `_sanitize_user_text` (trades.py:144) only strips control bytes; it does not normalise whitespace, so `"buy"`, `"buy "`, `"buy\n"` are three distinct payloads that hash-dedup misses by construction.

## F5 — Trivial dedup bypass: change `strategy` attribution (HIGH)

`strategy` (trades.py:178) is also omitted from the dedup hash. Rotating `strategy` through `"momentum_quality"`, `"pead"`, `"claude-alpha"`, `null` gives at least four fresh dedup keys for the same real order. Ledger attribution also gets polluted — a compliance report will attribute the same fill to four strategies. No validator enforces that `strategy` matches a known identifier; any 1-500-char string passes `_sanitize_user_text`.

## F6 — Floating-point permutation bypass on `qty` / `limit_price` (MEDIUM)

Dedup serialises `qty`/`limit_price` directly via `json.dumps(..., sort_keys=True)`. `qty: float` (trades.py:104) accepts `1.0`, `1.00`, `1e0`, `1.0000000000000002` (machine-eps neighbour) — `json.dumps` stringifies them as `1.0`, `1.0`, `1.0`, `1.0000000000000002`. The last is a distinct key, bypassing dedup. Alpaca rounds back to `1`, so the broker sees two qty-1 orders. Same trick works on `limit_price` with sub-cent perturbations (Alpaca accepts up to 4 decimals on sub-$1 names, 2 decimals otherwise — any extra-precision suffix survives the hash stage even if Alpaca later truncates).

## F7 — Multi-leg order reordering bypass (MEDIUM)

The dedup key is built as `json.dumps([leg1, leg2, ...] + [{tif}], sort_keys=True)`. `sort_keys=True` only sorts keys **inside** each leg dict — it does **not** reorder the outer list. For a 2-leg mleg options combo, `[long_call, short_call]` and `[short_call, long_call]` hash differently. Alpaca accepts both orderings as the same combo. An attacker (or a confused client) can bypass dedup by permuting leg order within the 30 s window.

## F8 — `time_in_force` bypass: `day` vs `gtc` (LOW/MED)

`tif` is included in the hash (trades.py:869). So `day` and `gtc` of an otherwise identical order hash differently. If the attacker wants two copies of the same immediate market order, flipping `gtc -> day -> ioc -> fok` each time yields four distinct dedup slots. For MARKET orders `tif` has practically no effect on execution (market orders fill immediately regardless), so all four replays execute as the same market trade.

## F9 — No origin / CSRF / CORS enforcement on server-to-server replay (HIGH context)

`main.py:144` sets `CORSMiddleware` with an allowlist (localhost:3000, `PRODUCTION_ORIGIN`). This is a **browser preflight** defence only; `curl`, Python, Burp Repeater, or any non-browser client ignores CORS entirely. The auth cookie is `SameSite=strict, HttpOnly` (auth.py:269, 278) which blocks cross-site browser replay — but an attacker with a copied HAR or a stolen token sends the request directly and no SameSite/CSRF hop is involved. Conclusion: the browser-side protections have **no effect** on the scenario in the prompt.

## F10 — `/api/v1/trades/orders` is not rate-limited (MEDIUM)

`api/routes/auth.py:165` has `_check_rate_limit` on login and refresh. `trades.py` has none. `main.py` installs no global throttle on POSTs. An attacker with a token can script N replays at N requests/sec. The only gate is (a) `_check_duplicate_order` (bypassed by F4–F8) and (b) the single-order notional ceiling of $50 000 (`_risk_check`, trades.py:932) — which does not stop 50 separate $49 999 orders. Combined with a refresh token living 30 days, replay amplification goes unchecked.

---

## Summary (~250 words)

**Does the 30-second dedup protect against a 10-minute replay? No.** `_check_duplicate_order` in `backend/api/routes/trades.py:843-881` uses Redis `SET NX EX 30`; by T+10 min the key has expired and the replay creates a fresh order with a fresh broker ID. **The `Idempotency-Key` header does not help either** — zero code paths read it (confirmed by grep across `backend/` and already documented in `audit-reports/persona-11-api-consumer.md:25` and `audit-reports/02-backend.md:193`). A compliant client expecting at-most-once semantics instead gets at-least-once. **Dedup bypass within the 30 s window is trivial:** `notes` (F4) and `strategy` (F5) are in the body but excluded from the hash, so one-byte changes defeat it; floating-point sub-eps permutations on `qty`/`limit_price` (F6) produce distinct hashes even though the broker rounds to the same number; outer-list reordering on multi-leg orders (F7) bypasses because `sort_keys=True` only sorts dict keys, not list elements; and `time_in_force` cycling (F8) gives ~4 free distinct dedup slots for a MARKET order. **Context amplifiers:** JWT access tokens last 8 hours (F3), refresh tokens 30 days; the trades router is **not rate-limited** (F10) — only the auth router is; the single-order notional cap is $50k but does nothing against N separate sub-cap replays. Browser-only defences (CORS allowlist, `SameSite=strict` cookies) are no obstacle to a non-browser replay (F9). **Fix priority:** require a client-generated `Idempotency-Key`, persist `(key → response)` in Redis for 24 h (replay returns original response), enforce a `Date`/`X-Timestamp` header with ±5 min skew plus HMAC request signing on the trades router, and add per-user rate limits to POST trades.
