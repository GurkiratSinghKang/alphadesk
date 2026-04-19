# Persona 65 — Power Loss / Network Drop Mid-POST

**Scope:** A user clicks *Submit Order* in the browser. Between the moment the HTTP request leaves the laptop and the moment the response returns, one of (a) the laptop dies, (b) WiFi drops, (c) the tab is force-killed, (d) the mobile carrier stalls the TCP RST. What is the state of the system? Does the order reach Alpaca? Can the user reconcile on recovery?

**Trust boundary:** The HTTP round-trip `browser → Next.js → FastAPI → Alpaca → FastAPI → Postgres → browser`. Persona-40 covered a *complete* request that is replayed; this persona is the opposite — a *partial* request that is never completed from the client's point of view.

**Target code:** `/Users/GK/Downloads/alphadesk/backend/api/routes/trades.py` (`create_order` 294–433, `_submit_to_broker` 1174–1257, `_check_duplicate_order` 843–881); `/Users/GK/Downloads/alphadesk/backend/data/ingestion/daily_pipeline.py` lines 286–720; `/Users/GK/Downloads/alphadesk/backend/agents/execution.py` lines 70–145; `/Users/GK/Downloads/alphadesk/frontend/src/lib/api.ts` lines 30–152, 876–880.

---

## Executive answers

| Question | Answer |
| --- | --- |
| If the laptop dies mid-POST, did the order reach Alpaca? | **Unknowable from the client.** The TCP FIN/RST from the laptop does not cancel an in-flight FastAPI handler — FastAPI keeps running to the end, including the Alpaca POST, the DB insert, and the Redis publish. |
| Does the FastAPI handler survive the client disconnect? | **Yes.** `create_order` uses plain `async def` with no `request.is_disconnected()` check and no cancellation scope. A disconnect does not abort the broker POST. |
| Can the user know on recovery? | **Partially.** They can `GET /api/v1/trades/orders?status=all` (line 436) and eyeball it — but there is no stable client-generated key to correlate "the click I made" with "the broker row". Manual orders do **not** set `client_order_id` (F1). |
| Is the DB row guaranteed to match the broker? | **No.** The DB write is best-effort in a `try/except` that **swallows failure** (trades.py:389–415). Broker can accept while DB is silent (F2). |

---

## F1 — Manual `POST /trades/orders` submits to Alpaca without a `client_order_id` (CRITICAL)

`_submit_to_broker` (trades.py:1174–1257) builds the body with `symbol/qty/side/type/time_in_force/limit_price/stop_price` only. Contrast `daily_pipeline._place_order` at line 299 which sets `client_order_id = f"{strategy}_{symbol}_{ts}"`. Consequence: after a mid-POST disconnect, the user has **no stable correlation key** to match their browser-side intent against the Alpaca order book. The only fields they can eyeball are symbol+qty+side+price — which collides with any other order the same user sent within the session. Fix: accept an `Idempotency-Key` header (also missing, persona-40 F2), forward it to Alpaca as `client_order_id`, and echo it back in the response.

## F2 — DB insert is best-effort and silently swallowed; broker↔ledger can split (CRITICAL)

`trades.py:389–415`:

```python
try:
    ...
    async with factory() as db:
        trade = Trade(...)
        db.add(trade); await db.flush(); await db.commit()
except Exception:
    logger.warning("Failed to persist trade record to DB (order still submitted to broker)", exc_info=True)
```

The comment ("order still submitted to broker") names the exact split. If Postgres is restarting, the connection pool is exhausted, or the async session errors on flush, the broker has booked a live order and the DB has zero record. `GET /trades/orders` will show it (it reads Alpaca, not the DB — line 492) but the `trades` table — which feeds P&L, strategy attribution, and `trade_ledger` — will never see the row. There is no outbox, no retry, no dead-letter queue.

## F3 — Mismatched timeouts: frontend 15s, backend httpx 10s (HIGH)

`frontend/src/lib/api.ts:30` — `DEFAULT_TIMEOUT_MS = 15_000`. `trades.py:1227` — `httpx.AsyncClient(timeout=10.0)`. When Alpaca is slow (p99 latency spikes happen at market open), the backend's httpx raises `ReadTimeout` at 10s → FastAPI returns 502 "Broker error — please retry" (line 1255). The frontend then times out its own retry logic at 15s, or the user clicks again. Meanwhile Alpaca may have received and accepted the order 500 ms after the httpx client gave up. **The dedup key still exists in Redis** (F6) so the retry is blocked with 409 — but the broker already booked. The user sees "Duplicate order detected" when what actually happened is "your order is live and you can't tell".

## F4 — `create_order` does not short-circuit on client disconnect (HIGH)

There is no `if await request.is_disconnected(): return` anywhere in `create_order` (trades.py:294–433). FastAPI/Starlette only propagate the disconnect as a `CancelledError` at the next `await` boundary if the ASGI server raises it — and the default (uvicorn with `--lifespan on`) does **not** cancel running handlers on a client disconnect. So after the user's laptop dies: the handler continues, (1) runs `_risk_check`, (2) burns the dedup slot, (3) POSTs to Alpaca, (4) logs the audit line "Order submitted: ... (user: X)", (5) tries to write Postgres, (6) tries to publish to Redis. All of these happen *after* the client is gone; no compensating cancel is attempted on the broker side.

## F5 — Redis publish ("portfolio", order_submitted) is unawaited from the user's perspective and has no retry (MEDIUM)

`trades.py:428` — `await publish("portfolio", {...})`. If the laptop dies before the WebSocket receives this message and Redis has also already dropped the connection (broker+DB ok, publish fails), the frontend's React Query cache on reload will fetch `getOrders` and find the order — **but** the in-memory `order_submitted` event that triggers the toast "Order XYZ submitted" was never delivered. The user sees a new row appear in the Orders panel without any confirmation UX. There is no replay of missed WebSocket events on reconnect.

## F6 — Dedup key is not released on broker failure: blocks legitimate retries for 30 s (HIGH)

`_check_duplicate_order` (trades.py:843–881) calls `SET NX EX 30` **before** `_submit_to_broker`. If the broker POST raises (timeout, 502, 422 validation error), the dedup key is **not** deleted — there is no `finally: await redis.delete(cache_key)` and no try/except/else pattern. Effects:

1. User clicks Submit → backend times out at 10s → frontend shows "Broker error".
2. User clicks Submit again inside 30s → 409 "Duplicate order detected."
3. User waits ≥30s → OK but by now the first order may have already filled at the broker (F3 race).

Legit use case — "I got a broker error, let me retry" — is penalised. Combined with F1 (no client_order_id), the user cannot tell whether a retry is safe.

## F7 — `execution.py` agent path has neither dedup nor risk gate nor DB persistence (HIGH)

`backend/agents/execution.py:70–145` (`ExecutionAgent.execute_trade`) POSTs `/v2/orders` on Alpaca directly (line 127) with no call to `_check_duplicate_order`, no `_risk_check`, no `Trade(...)` insert, no `publish()`. This path is invoked from orchestrator code paths and MCP tool calls. A power-loss mid-agent-run (worker process OOM / Python interpreter crash after the httpx.post returns but before the orchestrator logs it) yields a broker-booked order that is invisible to every ledger the UI reads from. The agent does not even set `client_order_id` on its own bodies (line 114–121), so the order is uncorrelatable even if later discovered.

## F8 — Bracket-fallback path still splits if the fallback entry fills but the follow-up stop POST succeeds on broker side after our handler is killed (MEDIUM)

`daily_pipeline.py:544–674`: if the bracket order raises, the code falls back to a plain market entry (`_place_order`) then a separate `_place_stop_order`. The comment (line 547) admits "the follow-on stop-loss failure must now be treated as a CRITICAL — see code-patterns-audit-r4 P0 #2". But there is a **second** split window not named: the entry is filled, the code constructs `_place_stop_order` args, the event loop is killed by SIGKILL (OOM, server reboot, power loss on the Hetzner box) *after* the stop POST writes TCP but *before* httpx reads the response. Alpaca may still accept the stop — duplicate on restart when the pipeline reruns with the same logic against the same symbol. No `client_order_id` de-dup because the timestamp `ts = ...strftime("%Y%m%d%H%M%S")` changes between runs. Result: two stops on one entry, or an un-cancelled stop hanging around after emergency unwind (line 651) also succeeds.

## F9 — No reconciliation job: nothing compares broker ↔ DB on boot/recovery (HIGH context)

Grep for "reconcile", "sync_orders", "backfill_orders" across `backend/` — none. There is no startup task that pulls Alpaca's order list for the last N hours and inserts missing rows into `trades`. Therefore any F2 / F7 / F8 split leaves a permanent ghost: the broker shows a real fill, the DB shows nothing, and the user's P&L on the dashboard (computed from the DB-backed `trade_ledger`, see `feature/deployment` commit 0ce5c4d) understates by one trade. The only remedy is manual SQL. Compare to F2 where the code comment promises the split is "best-effort" — best-effort **without a cleanup loop** is accumulated debt.

## F10 — Frontend submit has no "pending-on-network" UI and no idempotent retry (MEDIUM)

`frontend/src/lib/api.ts:876–880`:

```ts
return apiFetch<Order>(`/api/v1/trades/orders`, {
  method: "POST",
  body: JSON.stringify({ legs, time_in_force: "day" }),
});
```

`apiFetch` (line 77–90) catches only `TimeoutError`; any other network failure (laptop sleep → `TypeError: Failed to fetch`, DNS failure, mid-flight `ERR_NETWORK_CHANGED` on carrier switch) re-throws untouched. There is no local "pending order" ledger in IndexedDB / localStorage. On recovery the frontend has forgotten the user clicked Submit. No banner asks "Your last order may not have been submitted — [Check broker status]". The Orders panel polls on mount but the user gets no signal that "the order you clicked 3 seconds ago may or may not be live". Combined with F1 (no client id), even a deliberate reconciliation UX cannot be built without backend changes.

---

## Summary (~250 words)

**If the laptop dies mid-POST, did the order reach Alpaca?** Unknowable from the client. FastAPI's `create_order` (`backend/api/routes/trades.py:294-433`) does not check `request.is_disconnected()` (F4), so the handler runs to completion after TCP RST: `_risk_check` → burn dedup slot → Alpaca POST → DB insert → Redis publish. **Can the user know on recovery?** Only weakly. The manual order submit does **not** set `client_order_id` (F1) — only the daily-pipeline path does (`daily_pipeline.py:299`). Without a correlation key, a user who reconnects to a fresh Orders panel sees rows they cannot confidently match against their remembered intent. **Is the ledger guaranteed to match the broker?** No (F2). The `Trade(...)` insert is wrapped in a `try/except Exception` that logs "order still submitted to broker" and returns 201 to the client anyway. Broker-accepts / DB-silent is a supported failure mode. **Retry lockout:** the dedup key (F6) is not deleted on broker failure, so a timed-out user's retry is blocked for 30 s with 409 while the original may have actually booked (F3 — 10 s httpx vs 15 s frontend race). **Agent path** (`agents/execution.py:70-145`) bypasses dedup, risk, persistence, and `client_order_id` entirely (F7). **Bracket fallback** (`daily_pipeline.py:544-674`) has an unaddressed "entry filled, stop half-sent, process SIGKILL" window (F8). **No reconciliation job** exists (F9); there is no boot-time scan that pulls Alpaca's order list to backfill missing DB rows. **Frontend** has no pending-order ledger and no recovery UX (F10). **Fix priority:** (1) require + forward `Idempotency-Key` → `client_order_id`; (2) introduce an outbox table for broker↔DB atomicity; (3) add a boot reconciliation job; (4) align timeouts; (5) release dedup key on broker failure in a `finally`.
