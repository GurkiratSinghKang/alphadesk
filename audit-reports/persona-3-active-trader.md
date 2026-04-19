# Persona 3 — Active Trader Audit

**Date:** 2026-04-18 (market closed, Saturday)
**Scope:** full trade lifecycle + alerts + notifications at tradingalpha.net
**Account:** admin (live Alpaca, 7 positions, $101k equity)

---

## P0 — Would lose real money

### [P0] Duplicate-order check collides across DIFFERENT limit prices
**Scenario:** I want to ladder into PEP with two limit buys — 1 share @ $50 and 1 share @ $75.
**Observed:**
```
POST /trades/orders (PEP buy 1 @ limit 50) → 201 Created
POST /trades/orders (PEP buy 1 @ limit 75) → 409 "Duplicate order detected. Please wait before resubmitting."
```
The dedup hash in `backend/api/routes/trades.py:668` is:
```python
[{"s": l.symbol, "sd": l.side.value, "q": l.qty, "t": l.order_type.value}]
```
— **does not include `limit_price` or `stop_price`**. Two legitimately different orders at the same qty/side/symbol are blocked for 30 s.
**Expected:** distinct limit prices = distinct orders.
**Fix:** add `"lp": l.limit_price, "sp": l.stop_price` to the hash payload.

### [P0] Stop orders with NULL `stop_price` pass the Pydantic validator and hit the broker
**Scenario:** Stop-loss order without a stop price.
**Observed:** backend `OrderLeg.stop_price_must_be_positive` only rejects `v <= 0` when `v is not None`. `stop_price=null` on a stop order passes validation, reaches Alpaca, and comes back with a useless `{"detail":"Broker rejected order. Check order parameters and try again."}` — no diagnostic, no reason.
Meanwhile, **5 of my live GTC stop orders (AVGO, MRK, BA, CRM, DIS) show `stop_price: null`** in the API response — I cannot tell at what price they will trigger.
**Expected:** (a) reject `order_type=stop` with null `stop_price` at validation; (b) copy Alpaca's `stop_price` into the response.
**Fix:** see next item for the read-path; add a model validator:
```python
@model_validator(mode="after")
def _require_stop_price_for_stop_orders(self):
    if self.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and self.stop_price is None:
        raise ValueError("stop_price is required for stop and stop_limit orders")
```

### [P0] `list_orders` drops `stop_price` and `rejected` status on the read path
**Scenario:** I need to see what protective stops I have in the market.
**Observed:** `backend/api/routes/trades.py:421-427` builds `OrderLeg` from the Alpaca response but never copies `stop_price`, `filled_qty`, or `filled_avg_price` into the leg. So every stop order returned by GET `/trades/orders` shows `stop_price: null` — the data is permanently missing in the UI.
Additionally, line 409: `"rejected": OrderStatus.CANCELLED` — Alpaca's `rejected` status is silently remapped to `cancelled`. A trader cannot distinguish "I cancelled it" from "broker refused it". The `useNotifications` hook in `frontend/src/hooks/useNotifications.ts:113` listens for `data.status === "rejected"` but backend never emits that.
**Expected:** round-trip `stop_price`, preserve `rejected` status end-to-end, and surface the broker's reject reason if available.
**Fix:** map `stop_price=float(o["stop_price"]) if o.get("stop_price") else None`, add `OrderStatus.REJECTED` to the enum if missing, and include Alpaca's `reject_reason` in `notes`.

### [P0] Default `GET /trades/orders` hides cancelled orders (your cancel looks like a black hole)
**Scenario:** I cancel an order, then glance at my orders list to confirm.
**Observed:**
```
GET /trades/orders            → only status=submitted (12 rows)
GET /trades/orders?status=cancelled → returns the just-cancelled order
```
Alpaca's list endpoint defaults to `status=open` when no filter is sent (backend line 385-387 sends nothing so Alpaca defaults apply). The cancelled order disappears from view. Combined with the backend's reject→cancelled remap, my rejected orders also vanish.
**Expected:** either default to `status=all` with a visible filter, or at minimum include recently cancelled/rejected orders from the last 24 h.
**Fix:** in `list_orders`, pass `until=now, after=now-1d, status="all"` when the caller doesn't specify, and render "cancelled" and "rejected" as separate chips in the UI.

### [P0] Desk page never refreshes positions or orders after a fill
**Scenario:** I place a market order that fills; I expect my Positions panel and Book count to update.
**Observed:** `frontend/src/app/(dashboard)/page.tsx:handleStageOrder` calls `usePortfolioStore.getState().addOrder(placed)` and that's it. No `getPositions()` or `getOrders()` refetch. The positions list is updated only by:
- `useDataPipeline` 30-second poll, and
- WS `portfolio` channel messages that include a `payload.positions` array.
The backend only publishes `{"type": "order_submitted", "order": ...}` on create (line 359-362) — not fills, not cancels, not positions deltas. So after a fill the UI is stale for up to 30 s.
**Expected:** on successful place/cancel, refetch positions + summary immediately (and let WS do the rest later). `trade/page.tsx` does refetch orders but not positions.
**Fix:** call `getPositions()`, `getPortfolioSummary()`, `getOrders()` in parallel in the success branch; also change the WS publish in `create_order` to include `"positions": ...` so other tabs update.

### [P0] Alert system allows unlimited duplicates
**Scenario:** Clicking "Create Alert" twice by accident.
**Observed:**
```
POST /trades/alerts {symbol:AAPL, price:300, condition:above} → alert-e442fd69
POST /trades/alerts {symbol:AAPL, price:300, condition:above} → alert-b6b04525
GET  /trades/alerts → both rows
```
On trigger the trader gets two chips + two toasts.
**Expected:** reject duplicate (symbol, price, condition) combinations, or dedupe on client with an "already exists" message.
**Fix:** backend: upsert on `(user, symbol, price, condition)`; frontend: check `alerts` store before POST.

### [P0] Day P&L on the dashboard is hard-zeroed when nothing closed today
**Scenario:** First glance at the ContextBar — is my book up or down today?
**Observed:** `backend/api/routes/portfolio.py:504-513` computes `realized_pnl_today` strictly from closed trades in the ledger. Today I have zero closed trades so `realized_pnl_today = 0`. Frontend `getPortfolioSummary` falls back:
```ts
const dayPnl = rawAny.day_pnl ?? rawAny.profit_loss ?? raw.realized_pnl_today;  // → 0
```
But Alpaca returns `equity - last_equity` in its `/v2/account` response, which is the real *Day P&L* (unrealized mark-to-market delta from yesterday's close). The UI displays "$0 Day P&L" while the Positions panel shows $1,506 unrealized — internally contradictory.
**Expected:** Day P&L = today's equity change = `equity - last_equity`, matching Alpaca's portfolio history.
**Fix:** add `day_pnl` to `PortfolioSummary` computed from `equity - equity_previous_close`; the frontend already looks for it.

### [P0] Snapshot batching exists but isn't wired up — 10 round-trips on desk load
**Scenario:** Desk load → watchlist quotes.
**Observed:** `frontend/src/lib/api.ts:308 getSnapshot()` does per-symbol fan-out (N requests). `getSnapshots()` at line 335 calls the batched `/api/v1/market/snapshots` endpoint, but `useDataPipeline.ts:49` still calls the old `getSnapshot(watchlist)`. On a 10-symbol watchlist the desk fires 10 Alpaca calls on every mount — the very thing the batching was supposed to fix.
**Expected:** `useDataPipeline` uses the batched endpoint.
**Fix:** one-line swap `getSnapshot` → `getSnapshots` in `useDataPipeline.ts`.

### [P0] Initial desk page fires ~11+ API calls on mount
**Scenario:** Cold load at 9:31 am.
**Observed (by static count):**
- `useRegime` (1)
- `useIndices` (1)
- `useStrategies` (1)
- `usePortfolioSummary` via React Query (1) — **same endpoint hit by `useDataPipeline.fetchPortfolioData` (duplicate!)**
- `useDataPipeline`: `getSnapshot(watchlist)` = 10 sequential fan-out, `getPositions`, `getOrders`, `getPortfolioSummary`, `getPortfolioGreeks` (14 calls; see above P0)
- `getBars` on selected symbol (1)
- Desk `useEffect` fires `getOrders("pending")` + `getOrders("open")` (2 more)
= **~22 round-trips on first render**. `usePortfolioSummary` is literally requested twice from two different hook sites.
**Expected:** one batched snapshot, one `/portfolio/summary`, one `/trades/orders?status=all`, one `/trades/positions` — ~4-5 calls total.
**Fix:** make `usePortfolioSummary` the single source and delete the pipeline's own `getPortfolioSummary` call; use `getSnapshots`; collapse the two `getOrders(pending|open)` into one `?status=open` call.

### [P0] `/trade` page has no Cancel button on its recent-orders table
**Scenario:** I placed a fat-finger limit from `/trade`. I want to cancel it from the same page.
**Observed:** `frontend/src/app/(dashboard)/trade/page.tsx:211-242` renders a `Time/Symbol/Side/Qty/Type/Status` table with no actions column. Design spec `qa/pages/trade.md` is itself stale — it declares the page should be a redirect to `/`.
**Expected:** row-level cancel button for open orders (the desk page has it in `PositionsList`, but not here).
**Fix:** add a ✕ button to each row wired to `cancelOrder(o.id)`, then refetch; also reconcile the spec with reality.

---

## P1 — Degraded UX but survivable

### [P1] Generic "Broker rejected order" error message exposes no reason
**Scenario:** Broker rejects a malformed order (e.g. limit order with null limit_price).
**Observed:** user sees `"Broker rejected order. Check order parameters and try again."` — same message for every reason (buying-power breach, duplicate client id, bad symbol, etc). Alpaca returns structured error JSON the backend is throwing away.
**Fix:** include the Alpaca error `message` and `code` in the HTTPException detail.

### [P1] Cancelling an already-cancelled order returns 204 (should be 404 or 409)
**Scenario:** I double-click the cancel button.
**Observed:** first DELETE → 204. Second DELETE on the same id → also 204. No indication that the action was idempotent or that the order was already gone.
**Expected:** 410 Gone or 409 Conflict with message, so the UI can show "Already cancelled". Cancelling a truly-nonexistent id returns 404 with vague `"Failed to cancel order"` — which is fine except the message implies failure of our end, not "not found".

### [P1] Trade ledger entry for open MRK position is orphaned
**Scenario:** Sanity check between `/trades/positions` and `/trades/history`.
**Observed:** `/trades/positions` shows 7 positions (AVGO, BA, CRM, DIS, NKE, PG, WMT). Trade history has 8 entries; entry id=1 (MRK, pead strategy) has `status=closed` with `exit_time=2026-04-18` but `pnl=null` and `exit_price=null`. The position is gone from broker but the ledger never captured the exit price/pnl.
**Fix:** when `TradeLedger.close_trade` runs, require `exit_price`; reconcile nightly against broker filled orders.

### [P1] `total_market_value` uses `long_mv + short_mv` (not abs) — near-zero for shorts
**Scenario:** Short positions present.
**Observed:** `backend/api/routes/portfolio.py:525` returns `total_market_value=long_mv + short_mv`. If short_mv is negative (as Alpaca returns it), two equal-sized long and short offset to ~0. The cost-basis calc two lines above correctly uses `abs(short_mv)`.
**Fix:** `total_market_value=long_mv + abs(short_mv)`.

### [P1] OrderBar resets only on successful submit — keeps broken inputs for retry
**Scenario:** Submit fails, I fix one field and retry.
**Observed:** the comment says "Keep the OrderBar populated so the user can correct + retry" — fine in principle — but if the error was a client-side validation it toasts and returns without clearing. Good. If it was a 409 duplicate, the same order is still in the form and re-submit within 30 s 409s again. User sees no clue about the 30-s window.
**Fix:** show remaining cooldown in the toast ("Duplicate — retry in 27 s").

### [P1] No market-status banner when market closed — orders fail late
**Scenario:** I stage a market order at 6pm, click Submit.
**Observed:** `POST /trades/orders` returns 400 only after server round-trip. The OrderBar does not warn. `GET /market/market-status` shows `{"market":"closed"}` but the desk's `isMarketOpen()` uses a client-side calendar (`lib/marketHours.ts`) that may diverge.
**Fix:** disable the "Stage order" button when `market=closed` AND order type is `market`; show a regime-aware hint next to the Type select.

### [P1] Notification bell is silent on order_submitted events
**Scenario:** I stage an order and expect a confirmation chip in the bell.
**Observed:** `useNotifications` only reacts to `event === "fill"`, `"order_filled"`, `"order-filled"`, or `data.status === "filled"`. Backend publishes `{"type": "order_submitted", "order": ...}` — the event key is `type`, not `event`, AND the frontend doesn't listen for `order_submitted` anyway. Net: no chip fires on submission, cancellation, or replacement. Only fills trigger chips — and fills come through the Alpaca WS, not this publish. So the bell stays at 0 even for active traders.
**Fix:** either emit a `"submitted"` category chip from the frontend optimistically, or widen the WS listener to react to `msg.type === "order_submitted"`.

### [P1] `/trade` page spec vs reality is wildly out of sync
**Scenario:** I read the design doc to understand what's on the page.
**Observed:** `qa/pages/trade.md` says `/trade` is a ~22-line redirect stub. Actual page is a 247-line workspace. Spec refers to `TradeRedirect` component that doesn't exist.
**Fix:** rewrite the spec to match reality, or restore the stub. Documentation drift is a team-wide hazard.

### [P1] `PlaceOrderPayload.stop_price` vs `payload.stop_price ?? leg.price` fallback is wrong
**Scenario:** Stop-limit leg passed via `legs` array.
**Observed:** `lib/api.ts:672` — `stop_price: ... (payload.stop_price ?? leg.price ?? null)`. `leg.price` is a limit price, not a stop. Using it as a stop fallback silently plants the limit price as the stop trigger.
**Fix:** require stop_price explicitly; remove the `leg.price` fallback on stop fields.

---

## P2 — Minor / cosmetic

### [P2] `Duplicate order detected` response is 409 but no `Retry-After` header
A client can't programmatically know when to retry.

### [P2] Order status filter enum mismatches between Alpaca and the UI
UI knows `pending | submitted | partial | filled | cancelled | rejected`. Backend list endpoint accepts `open | closed | all | pending | submitted | partial_fill | filled | cancelled | rejected` but `partial_fill` never surfaces because `partially_filled` from Alpaca is remapped to `PARTIAL`.

### [P2] Alerts returned from DB aren't ordered by triggered status / age
Alerts page filters in-memory into active/triggered lists; fine, but the list endpoint returns them in insertion order descending — not explicit. Adding `?sort=created_at&order=desc` behavior is an easy win.

### [P2] `realized_pnl_today` ledger scan runs on every `/portfolio/summary` call
No Redis cache. Re-scans the whole closed-trade table every 30 s. Cache with 30-s TTL.

### [P2] Alert `condition` is free-text in many code paths but pattern-locked to `"above|below"` at input. Design doc mentions "price_above" — outdated naming.

### [P2] Symbols regex `^[A-Z][A-Z0-9.\\-]{0,9}$` requires leading letter — blocks tickers like `9988` (HKEX), but AlphaDesk is US-only so it's fine. Worth documenting.

### [P2] Position sanity-check passes, but all positions share side=`"long"` with no explicit validation. A short position from broker would silently mis-render because frontend type accepts `side: "long" | "short"` but UI copy says "shares" not "shares short".

---

## Smoke test summary

| Check | Result |
|---|---|
| Positions sum = summary.total_market_value | PASS (both $58 562.54) |
| Positions sum unrealized_pnl = summary.unrealized_pnl | PASS ($1 506.92) |
| No qty=0 positions / no NaN | PASS |
| Place market order (market closed) | REJECTED with clear message — good |
| Place limit order | SUCCESS |
| Place BRK.B (dot in symbol) | SUCCESS |
| Place lowercase/spaces/empty | REJECTED at validation — good |
| Cancel limit order | 204 — good |
| Cancel nonexistent UUID | 404 with vague message |
| Cancel malformed UUID | 422 |
| Cancel already-cancelled | 204 (idempotent — probably wrong) |
| Create alert + list + delete | PASS |
| Create duplicate alert | silently allowed (P0) |
| Market status endpoint at /market/status | 404 (correct path: /market/market-status) |
| Reports endpoints (/reports/today, /reports/pnl) | 404 — they don't exist; reports page composes from other APIs |
