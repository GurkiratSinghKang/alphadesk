# Persona 54 — Precision-Obsessed Trader

**Date:** 2026-04-18
**Persona:** Retail/power trader wanting exact decimals — fractional shares, sub-penny prices, 3-decimal options premiums. Needs tax-grade cost basis with no IEEE-754 drift.
**Context:** Wave 17 introduced `Decimal` money math in `trade_ledger.py`, but the Decimal is only a *transient calculator* — every caller round-trips through `float` at the DB, API and model boundary. Persona-11 explicitly flagged "money is float" as a leak. This report traces where precision actually bleeds away once that Decimal hits reality.

---

## TL;DR

Wave 17's `Decimal` stops **at the boundary of two functions** inside `trade_ledger.py`. Everything the Decimal touches — DB column, ORM model, Pydantic response schema, broker payload, frontend input, notional risk check — is still `float` / `DOUBLE PRECISION` / `number`. For a trader who wants exact decimals, the ledger's Decimal is a 20-line fig-leaf on a fully binary-float system. Worst offenders: **shares is hard-cast to `int`** (no fractional-share support despite `qty: float` in the order leg), **`round(price, 2)` on broker payloads** (blows up sub-penny options and tick-bucket equities), and the DB stores everything as `DOUBLE PRECISION` (IEEE-754 binary64 — so 0.1 + 0.2 ≠ 0.3 at the storage layer).

---

## Top 10 precision leaks

**1. `trade_ledger` DB columns are `DOUBLE PRECISION`, not `NUMERIC(18,6)` — Wave 17's Decimal round-trips through binary float at the storage layer.**
`backend/data/ingestion/trade_ledger.py:170-182` — `entry_price`, `exit_price`, `stop_loss`, `take_profit`, `pnl`, `pnl_pct` are all `DOUBLE PRECISION`. On read, `record_exit` does `entry_price = float(row[1] or 0.0)` (line 574) — so even though the subsequent P&L arithmetic happens in `Decimal`, the *input* to that arithmetic was already lossy. `123.45` stored via float round-trip → `123.4500000000000028...`. Wave 17 labeled the fix "Decimal for money" but left the column type alone. Every Decimal-ceremony P&L calculation in this file starts from a float.

**2. Trade model (`Trade`, `Position`, `OHLCVBar`, `OptionsSnapshot`) is 100% `Column(Float)`.**
`backend/data/storage/models.py:49-188` — every monetary / price / greek column (`entry_price`, `exit_price`, `pnl`, `avg_cost`, `current_price`, `unrealized_pnl`, `open/high/low/close`, `strike`, `bid`, `ask`, `last`, `iv`, `delta`, `gamma`, `theta`, `vega`) is declared as SQLAlchemy `Float` → Postgres `DOUBLE PRECISION`. No `Numeric(18,6)` or `Numeric(18,4)` anywhere. This is the second, independent DB table (`trades` vs. `trade_ledger`) used by `POST /trades/orders` — same precision leak, different code path.

**3. Shares are hard-cast to `int` — zero fractional-share support.**
`backend/data/ingestion/trade_ledger.py:286, 468, 582, 683, 911, 942, 985` — every ingestion/persist path does `int(t.get("shares") or 0)` or `int(float(pos.get("qty", 0)))`. Alpaca returns `qty` as a string decimal for fractional positions (e.g. `"0.5"`), which `int(float("0.5"))` silently truncates to `0` — the position disappears. The order leg model even types `qty: float` (`backend/api/routes/trades.py:104`), so the API boundary accepts fractional qty but the ledger silently drops the fraction on persistence.

**4. Broker order payloads are `round(x, 2)` — sub-penny equity quotes and option premiums both break.**
`backend/data/ingestion/daily_pipeline.py:355, 359, 384, 406` — stop, take-profit, limit prices are all sent to Alpaca as `str(round(price, 2))`. US options quote in 1¢ increments for premiums ≥ $3 and **5¢ increments below $3** (the "Penny Pilot" rule); some symbols post 3-decimal mid-points. Sub-penny equity quotes (NMS Rule 612 allows sub-penny for <$1 stocks) likewise have 4-decimal ticks. Hard-coding `round(..., 2)` causes a $2.995 put to be submitted as `$3.00` — Alpaca rejects it as "invalid tick size", or worse fills at the wrong price.

**5. `OptionContract.strike`, `bid`, `ask`, `last` are `float` — options' 3-decimal increments (e.g. `$0.025` mini-penny) get rounded by JSON float serialization.**
`backend/api/routes/options.py:33-49` (`OptionContract`) and `Greeks` (lines 72-86). JSON serialization of a Python `float` uses `repr()` which can emit `0.30000000000000004` for `0.3`. Greek deltas like `-0.07125` (theta in $/day) are deliberately 5-decimal. Round-tripping through `float` means the frontend can't display the canonical broker value.

**6. `OrderLeg.limit_price` / `stop_price` have no tick-size validator.**
`backend/api/routes/trades.py:106-122`. The positive-value check is the only guard. A trader can POST `limit_price=123.45678` — it passes validation, gets shoved through `str(round(..., 2))` in the pipeline (losing the sub-penny), or (for direct orders in `create_order`) is forwarded to Alpaca verbatim as a float, where binary representation noise can land on the wrong tick bucket. Should validate `Decimal(price) % tick_size == 0` based on asset class.

**7. Response schemas type money as `float` — API leaks IEEE-754 noise to every HTTP consumer.**
`backend/api/routes/trades.py:204, 213-222, 233-241` (`OrderResponse`, `PositionResponse`, `TradeHistoryEntry`), `backend/api/routes/portfolio.py:20-105` (`PortfolioSummary`, `PerformanceMetrics`, `CalendarDayEntry`, `CalendarResponse`). Persona-11 already called out `unrealized_pnl_pct: 2.641136285327327`. Pydantic `float` → JSON number — the consumer sees a binary approximation. Tax-accurate clients (and the frontend formatter) have to re-round, and two clients that compute differently will diverge.

**8. Notional risk check uses binary float — `total_notional += leg.limit_price * leg.qty` on line 922.**
`backend/api/routes/trades.py:917-935`. The `$50,000` single-order notional gate is compared in `float`. A legitimate order for 333 shares × $150.15 = $49,999.95 can evaluate as `49999.950000000004` and pass; more pathologically, a 500-share × $100 order at the limit can drift to `50000.00000000001` and be *rejected*. Either direction is a trader-visible bug.

**9. `record_exit` re-lifts `entry_price` to `Decimal` via `_to_decimal(entry_price)` — but `entry_price` came from `float(row[1])` two lines earlier.**
`backend/data/ingestion/trade_ledger.py:574, 587` — `entry_price = float(row[1] or 0.0)` then `entry_dec = _to_decimal(entry_price)`. `_to_decimal` does `Decimal(str(x))`, but by the time `x` is a float it's already the lossy binary approximation — `str(123.45)` is fine here, but `str(0.1 + 0.2)` is `'0.30000000000000004'`. Wave 17's Decimal can only preserve the precision that was present when the Decimal was constructed; pulling from a `DOUBLE PRECISION` column destroys it first.

**10. Frontend types money as `number` (IEEE-754 double) with no BigDecimal/Decimal.js — and qty input has `inputMode="numeric" pattern="[0-9]*"` (integer-only).**
`frontend/src/lib/api.ts:278, 1288, 1423` (`shares: number`), `frontend/src/components/composites/OrderBar.tsx:207-212` (qty pattern rejects decimals), `frontend/src/lib/utils.ts:8-50` (`formatCurrency` rounds to 2 decimals regardless of actual precision). The browser input blocks fractional qty, `Intl.NumberFormat` silently truncates to `maximumFractionDigits: 2` for dollars — so a $0.0125 option premium renders as `$0.01`. TypeScript `number` gives you the same 15-17 significant digits of binary float that Python `float` does; there's nowhere in the stack precision is actually preserved end-to-end.

---

## 250-word summary

Wave 17 added `Decimal` to exactly two functions in `backend/data/ingestion/trade_ledger.py` (`_money`, `_to_decimal`) and surrounded about eight callsites with Decimal arithmetic. Persona-11 correctly flagged "money is float" as a systemic API leak; this audit finds that the Wave-17 fix is narrower than advertised — the Decimal never leaves `trade_ledger.py`, and even inside that file it's fed from a `float(row[...])` read, so the precision was already destroyed before the Decimal got it.

For the persona who wants exact decimals:

- **Storage layer is binary float.** Both `trade_ledger` (raw DDL) and the ORM (`Trade`, `Position`, `OHLCVBar`, `OptionsSnapshot`) use `DOUBLE PRECISION` / `Column(Float)`. Migrating to `NUMERIC(18,6)` is the single highest-leverage change.
- **Fractional shares silently round to zero.** `int(float(qty))` in six places erases any sub-integer share count returned by Alpaca's fractional-share API.
- **Sub-penny prices break at the broker boundary.** `round(price, 2)` in `daily_pipeline.py` will reject or mis-tick Penny Pilot options ($0.005 below $3), NMS sub-penny equities, and 3-decimal option premiums.
- **Pydantic schemas leak IEEE-754 noise.** Every `OrderResponse`, `PositionResponse`, `PortfolioSummary`, and `OptionContract` types money as `float`, so even if the DB were fixed, the API would still serialize `0.1 + 0.2 = 0.30000000000000004` to clients.
- **Frontend has no Decimal type.** TypeScript `number`, integer-only qty input, hard-coded 2-decimal formatter.

The Wave-17 Decimal is real but cosmetic: it guarantees that `(entry - exit) * qty` is banker's-rounding-correct *within* one function, while every input and every output on either side of that function is still binary float. A trader who reconciles to the penny will still see drift from Alpaca's reported P&L.
