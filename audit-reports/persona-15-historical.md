# Persona 15 — Historical Data Researcher

Long time ranges, many symbols, pagination, CSV exports.

Production target: `https://tradingalpha.net`. Session cookie `/tmp/p15.cookies`. All tests run against live API on 2026-04-19.

---

## Test matrix & raw results

| # | Test | Endpoint | Outcome |
|---|------|----------|---------|
| 1 | Long-range daily bars `limit=500` | `/api/v1/market/bars/SPY?timeframe=1d&limit=500` | 200; returned only **250 bars** (1 year), not 500 |
| 2 | Explicit range 2020 | `...&start=2020-01-01&end=2020-12-31` | 200; returns **250 most-recent bars** (2025–2026). `start`/`end` silently ignored |
| 3 | Max limit | `...&limit=10000` | 422 `less_than_equal`, **ceiling is 5000** |
| 4 | Limit=5000 daily | `...&limit=5000` | 200; but still only **250 bars** (1 year). Polygon/Alpaca window still defaulted to `today - 365d` |
| 5 | Unique limit bypasses cache | `...&start=2020-01-01&end=2020-12-31&limit=501` | 200; **253 bars covering 2020** — proves upstream honors dates, but normal-limit cache key hides it |
| 6 | Cache key bug | `TSLA ?start=2019...limit=150` then `TSLA ?limit=150` | Second call returns **2019 data** because cache key is `bars:TSLA:1d:150` (start/end not in key) — **silent data-freshness bug** |
| 7 | Minute bars max | `timeframe=1min&limit=5000` | 200; 5000 bars = **~7 days of 1-min** (not months) |
| 8 | Weekly / monthly span | `timeframe=1w&limit=500` | 200; 52 weekly + 12 monthly — **capped at 1 year regardless of timeframe** |
| 9 | Batch snapshots 50 symbols | `/api/v1/market/snapshots?symbols=...` | 200; all 50 returned |
| 10 | Batch 101 symbols | 101 symbols | 400 `Too many symbols: 101 > 100`; **batch ceiling 100** |
| 11 | Trade history pagination | `limit=50&offset=50` | 200 empty `[]` (only 8 trades exist) |
| 12 | Offset > 1000 | `offset=9999` | 422 `less_than_equal`; **offset ceiling 1000** |
| 13 | Trade count / pagination headers | inspect response | **No `X-Total-Count`, no `Link`, no pagination envelope** — plain array. Every client has to refetch `limit=10000` to know how many rows exist |
| 14 | Trades `limit` ceiling | `limit=100000` | 422 `less_than_equal`, max 10000 |
| 15 | Strategy-filtered trades | `?strategy=pead` | 200; 1 row. Works. (`pead` id maps to `pead` in ledger via hard-coded map.) |
| 16 | Dedicated strategy-trades route | `/api/v1/strategies/{id}/trades` | 404 — **only filter-via-query works** |
| 17 | OOS file access | `/api/v1/oos/...`, `/api/v1/strategies/pead/oos`, `/strategies/pead/backtest` | 404 all. `phase1-*.json` files are **disk-only**; no API surface |
| 18 | CSV export — trades | `/api/v1/trades/export`, `/api/v1/export/trades.csv`, `/api/v1/trades/history.csv`, `Accept: text/csv` | All 404 except Accept-header which returned **JSON anyway** — **no CSV export for any entity** |
| 19 | Rate limit sustained | 60 serial + 100 concurrent @ 20 threads | 86 req/s concurrent, 0 failures, **no throttling headers present** |
| 20 | Consistency (same call twice) | `bars/SPY?...limit=100` × 2 | Bit-identical SHA-256 within 30 s cache TTL. Outside TTL: unverified |
| 21 | Historical quote | `/api/v1/market/quotes/SPY?asof=2025-06-15` | 200; **returns live quote, param silently ignored** |
| 22 | Adjustment control | `...&adjusted=false`, `&adjustment=raw` | Same hash → **parameter ignored, hard-coded `adjusted=true` upstream to Polygon, `adjustment=raw` to Alpaca (inconsistent between providers!)** |
| 23 | Invalid symbol | `bars/INVALID_SYMBOL_XYZ` | 200 `[]` — **silent empty instead of 404** |
| 24 | Calendar / holidays | `/market/calendar`, `/market/holidays`, `/market/clock`, `/market/economic_calendar` | All 404 — **no market-calendar API** |
| 25 | Portfolio calendar (wrong thing) | `/portfolio/calendar` | 200, but this is P&L-by-day for YOUR account, not exchange holidays |
| 26 | DB skipped warning | all trade responses | `x-alphadesk-warning: db-skipped; results may be empty` — history is file-ledger only |

---

## Summary: top 10 research-workflow issues

AlphaDesk's public API is catastrophically underpowered for a researcher trying to pull long-range historical data. Verified against tradingalpha.net, login token `/tmp/p15.cookies`.

1. **`start`/`end` silently ignored on cached `/market/bars` responses.** The cache key in `backend/api/routes/market.py:418` is `bars:{symbol}:{tf}:{limit}` — date range is excluded. Calling `bars/TSLA?start=2019-01-01&limit=150` populates the cache with 2019 data; the next caller asking for *today's* 150 TSLA bars with the same limit receives 2019 bars instead. This is a **silent data-correctness bug** affecting every downstream chart, signal, and backtest replay. Cache key must include `start` and `end` (and any future `adjusted` flag).

2. **`/market/bars` hard-capped at 365 days regardless of timeframe or limit.** `effective_start = effective_end - 365` (market.py:409). Even `limit=5000&timeframe=1d` returns only 250 bars. `timeframe=1w&limit=500` → 52 rows; `1mo&limit=500` → 12 rows. Cannot build any multi-year dataset — no way to do cross-cycle momentum, long-horizon vol surfaces, or regime studies.

3. **No historical quote endpoint.** `/market/quotes/SPY?asof=2025-06-15` returns the *live* quote; `asof` / `date` / `at` all ignored. Only bars are time-travellable, and only within the 1-year window.

4. **No OOS / phase1 / tuning-JSON API surface.** `phase1-pead-oos.json` and siblings live only on disk (audit-reports/). No `/strategies/{id}/oos`, no `/strategies/{id}/backtest`, no `/oos/*`. Research on OOS performance requires SSH to Hetzner.

5. **No CSV export anywhere.** Tried `/api/v1/trades/export`, `/api/v1/export/trades.csv`, `/trades/history.csv`, and `Accept: text/csv` content negotiation — all 404 or JSON. Frontend does client-side conversion only (the CSV-injection sanitizer at trades.py:145 is a fossil of a removed feature). Researcher must JSON-parse + build CSV manually for every extract.

6. **No total-count / pagination metadata on `/trades/history`.** Plain `list[...]`, no `X-Total-Count`, no envelope, no `Link` header. Client cannot tell how much data exists without fetching `limit=10000` and counting. Offset is capped at 1000, limit at 10000, so a researcher paginating large ledgers hits a hard ceiling of 10000 rows with no page-count signal.

7. **No dedicated per-strategy trade endpoint.** `/strategies/{id}/trades` is 404; only filter-via-query (`/trades/history?strategy=pead`) works. Strategy ID→ledger-name mapping is hard-coded (trades.py:706) so new strategies silently return empty unless added to the map.

8. **Dividend/split adjustment is inconsistent between providers and uncontrollable.** Polygon branch uses `adjusted=true`, Alpaca branch uses `adjustment=raw` (market.py:442 vs 502). Same endpoint, opposite semantics — researcher can't know which one served the response. Passing `adjusted=false` or `adjustment=raw` is silently ignored.

9. **Silent-empty on bad symbol.** `/market/bars/INVALID_SYMBOL_XYZ` returns `200 []` not 404, so batch scripts mask typos and partial-coverage gaps as "zero trades / zero bars" instead of erroring.

10. **No market calendar / holidays / economic calendar API.** `/market/calendar`, `/market/holidays`, `/market/clock`, `/market/economic_calendar` all 404. Researchers must maintain their own session-aware calendar. Combined with item #2, this means reconciling bar gaps against holidays is impossible from the API alone.

### Also noted
- `x-alphadesk-warning: db-skipped; results may be empty` on every response — the DB tier is disabled; trade history is file-ledger only. Only 8 trades exist in the whole system.
- Rate limiting appears nonexistent: 86 req/s concurrent, all 200, no `X-RateLimit-*` headers. Safe for researchers; risky for operators.
- No `/openapi.json` or `/docs` endpoint (both 404), so discovering endpoints requires reading the router source.

---

## Relevant files

- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py` lines 398–541 (bars cache-key bug + 365-day clamp + adjustment mismatch)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/market.py` lines 822–874 (snapshot batch, 100-symbol cap)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` lines 691–773 (no pagination envelope, strategy map hard-coded)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py` lines 1059–1852 (no per-strategy trades/oos route)
