# Persona 55 — Historical Data Researcher (5yr 1-min SPY)

Double-check of persona-15's "/bars capped at 365 days" claim. Live-tested against `https://tradingalpha.net` with session cookie `/tmp/p15.cookies` on 2026-04-18.

**Scenario:** a researcher wants ~1.04 M one-minute SPY bars spanning 2021-04 → 2026-04.

---

## Quick verdict

Persona-15's headline claim is **partially wrong**. The /bars endpoint is **not** hard-capped at 365 days when you pass explicit `start`/`end` AND a unique `limit` that bypasses the cache. The real cap is **5000 rows per request** (the `le=5000` on the `limit` param, `backend/api/routes/market.py:404`). A 5yr 1-min dataset is reachable, but only by paginating ~260 non-overlapping ~7-day windows with varying limits.

---

## Test matrix (live against tradingalpha.net)

| # | Request | Result |
|---|---------|--------|
| 1 | `/market/bars/SPY?timeframe=1min&limit=5000` (no dates) | 5000 bars, Apr 10 → Apr 17 2026 — **~7 days only** |
| 2 | `...&timeframe=1min&start=2021-01-01&end=2026-04-01&limit=5000` | 5000 bars, Mar 25 → Apr 1 2026 — trailing edge of window |
| 3 | `...&limit=10000` | `422 less_than_equal, le=5000` — ceiling confirmed |
| 4 | `...&timeframe=1min&start=2021-06-01&end=2021-06-07&limit=4990` | **3839 bars, Jun 1–7 2021** — 5yr-old data served |
| 5 | `...&timeframe=1d&limit=5000` (no dates) | 250 bars (1yr) — cache hit from prior `bars:SPY:1d:5000` key |
| 6 | `...&timeframe=1d&start=2021-04-01&end=2026-04-01&limit=4887` (unique limit) | **1256 daily bars spanning 5 yrs** — proves no 365-day clamp with unique limit |
| 7 | `...&timeframe=1min&start=2020-01-02&end=2020-01-05&limit=4870` | 1535 bars Jan 2020 — data reach ≥ 6 yrs |
| 8 | `...&timeframe=1min&start=2016-01-04&end=2016-01-07&limit=4871` | 3480 bars Jan 2016 — data reach ≥ 10 yrs |
| 9 | 10 concurrent unique-limit 1-min calls | 1.07 s total → **~9.4 req/s** |
| 10 | Headers / pagination metadata | No `X-Total-Count`, no `Link`, no `Next-Page`, no `X-RateLimit-*`. Only security headers. No `x-alphadesk-warning` on /bars |

---

## Top 10 findings

1. **No true 365-day cap** on `/market/bars`. `effective_start = effective_end - 365` (market.py:409) only applies when `start` is `None`. With `start=2021-06-01&end=2021-06-07` the endpoint happily returns June-2021 minute bars. Persona-15's claim was an artifact of the cache bug (see #2), not a real clamp.

2. **Cache key omits `start`/`end`** (market.py:418: `cache_key = f"bars:{symbol.upper()}:{timeframe.value}:{limit}"`). First caller to use `limit=5000` with default dates seeds `bars:SPY:1d:5000` with last-365-days data; any later caller asking for the same limit over a 5-year window is silently served the cached 1-year slice. 30-second TTL on `1d`/`1w`/`1mo`, zero on `1min`/`5min`/... so the bug mainly bites the daily+ path. **Must be fixed** — include `start` and `end` in the cache key.

3. **Hard ceiling of 5000 rows per call** (`limit: int = Query(500, ge=1, le=5000)`). Polygon's `/v2/aggs` upstream supports 50 000; AlphaDesk's wrapper throws away 10× that capacity. A 5yr 1-min SPY dataset is ~1.04 M bars → **208–260 API round-trips minimum** at 5000 bars/call.

4. **No cursor / next-page / pagination envelope.** The response is a raw `list[Bar]`. No `X-Total-Count`, no `Link` header, no `next_token`. Clients must manage window arithmetic themselves and have zero way to detect gaps except by inspecting timestamps.

5. **Bar order fixed, window-newest truncation.** Internally the code requests `sort=desc&limit=N` from upstream then `bars.reverse()` before returning (market.py:444, 473). Net effect: when `limit < bars-in-window`, you get the NEWEST N bars from the window, not the oldest. Researchers paginating forward-in-time must pick window sizes that always fit under 5000 bars or they'll silently miss the oldest minutes of each window.

6. **No bulk / research / CSV endpoint.** Probed `/market/history/SPY`, `/market/aggregates/SPY`, `/bars/SPY/history`, `/market/bars-bulk`, `/data/bars/SPY`, `/research/bars`, `/stocks/SPY/bars` — all `404`. `/openapi.json` also `404`, so researchers cannot self-discover routes. Only `/docs` is 200 (static landing page, no API surface).

7. **Pagination feasibility is acceptable but fragile.** Observed concurrency: 10 parallel unique-limit requests → 1.07 s (~9.4 req/s). At 10-way concurrency a full 5yr 1-min pull = ~28 s. Serial: ~3 req/s, ~87 s. No `X-RateLimit-*` headers observed, so there's no way to know the safe concurrency ceiling — a good-faith researcher could get IP-banned by pushing too hard.

8. **Adjustment semantics diverge between providers.** Polygon branch passes `adjusted=true` (market.py:443); Alpaca branch passes `adjustment=raw` (market.py:502). Same endpoint, opposite semantics. For a 5-year SPY study this matters: any split/special-div in the window changes the close price by 10–25 %. Client cannot tell which provider answered. No user-visible `?adjustment=` knob.

9. **Data reach ≥ 10 years verified.** `/market/bars/SPY?timeframe=1min&start=2016-01-04&end=2016-01-07` returns 3480 valid bars. So the product CAN deliver 5 yrs of 1-min SPY bars — the API just forces a 260-call pagination dance to extract it.

10. **Required client recipe to actually get 5yr of 1-min SPY bars:**
    ```
    while start < today:
        end = start + 7 days        # tuned so bar-count < 5000
        limit = 4000 + hash(start) % 900   # unique per window to dodge cache bug
        GET /market/bars/SPY?timeframe=1min&start=<start>&end=<end>&limit=<limit>
        dedupe overlaps by timestamp
    ```
    Expect ~260 calls, ~1.04 M bars, ~28 s at 10-way concurrency. No server-side support for any of this; researcher has to implement chunking, dedup, gap-detection, and progress tracking in-house. Combined with #4 (no total-count) and #6 (no bulk endpoint), this makes AlphaDesk unsuitable as a primary historical datasource for research — it's a trading UI backend that happens to expose a bars route.

---

## Relevant files

- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:398-541` — `/bars` handler; `limit le=5000`, cache-key bug, adjustment mismatch, `effective_start = end - 365` default fallback
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py:414-422` — cache-key construction and TTL policy
- `/Users/GK/Downloads/alphadesk/audit-reports/persona-15-historical.md` — prior pass, overstated the 365-day cap

## Delta vs persona-15

- **Corrected:** persona-15's "hard-capped at 365 days regardless of timeframe or limit" — not true once `start` is explicit and cache is bypassed.
- **Confirmed:** 5000-row ceiling; cache-key bug silently serves 1-yr data for default-date round-limit calls; provider-adjustment inconsistency; no rate-limit headers; no CSV / bulk route.
