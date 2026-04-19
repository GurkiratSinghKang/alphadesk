# Persona 21 — Day Trader

**Session:** 2026-04-18 Sat, market closed. Admin on Alpaca paper ($101k eq).

## Top 10

1. **WS has no per-symbol subscription.** Valid channels are `quotes|bars|portfolio|alerts|agents` — firehose only. `quotes:SPY` returns `{"error":"Unknown channel"}` (`backend/api/websocket/handler.py:50`, `core/redis.py:48`). Scalpers must filter the whole market client-side. Blocker.

2. **Zero ticks in 30s while subscribed to every channel.** Weekend, Alpaca WS idle — but the client only gets `subscribed` confirmations then silence. No `stream_closed` hint. WsStatusBanner will say "connected" while dead.

3. **Intraday bars 42h stale with `is_demo:false`.** `/market/bars/SPY?timeframe=1min` ends at `2026-04-17T23:59:00Z` vs. now `2026-04-19T18:16Z` = 152,233s lag. No staleness flag in payload — the chart looks live.

4. **No cancel/replace endpoint.** `PATCH`/`PUT /trades/orders/{id}` = 405. Replace = DELETE+POST (~225ms + fresh risk check + duplicate-lock collision). Alpaca supports native replace; it's missing here, not just misrouted.

5. **Order roundtrip 95–260ms.** Serial POST /trades/orders: 94/101/208/96/120ms. DELETE: 95ms. Acceptable, not sub-100ms.

6. **Bars endpoint never caches intraday.** `market.py:416` hardcodes `cache_ttl=0` for 1min–1h. Every chart tick hits Polygon/Alpaca (223–309ms). Five parallel requests = 498ms total.

7. **Duplicate-order dedup blocks laddering.** Five limits at $491–$495 fired in sequence → "Duplicate order detected, wait before resubmitting." The 30s Redis NX lock in `trades.py:843` claims to hash limit_price, but the behavior says otherwise. Verify the hash key.

8. **Alpaca "wash trade" errors surface raw.** Limit buys at $601, $705 → `422 "potential wash trade detected. use complex orders"`. No friendly UX, no "cancel opposing order first."

9. **No PDT tracking anywhere in API.** Grep for `pdt|pattern_day_trader|daytrade_count` = `backend/mcp_servers/broker/server.py:36-37` only (MCP read-only). Sub-$25k accounts get zero warning before the 4-in-5 flag trips.

10. **Snapshot strips change fields.** `/market/snapshot/SPY` returns `quote.high/low/open/close=0.0, change=0, changePct=0` while `/market/quotes/SPY` returns them populated (`changePct:1.21`). Snapshot builder at `market.py:544` doesn't copy fields. Chart headers show "$0.00 change."

## Bottom line

Plumbing is solid — auth, session-aware calendar gate (correctly blocked my Saturday market order), Alpaca integration, stop/stop-limit accepted, 95ms cancel. The day-trader UX breaks at two places: (a) WS firehose can't filter by symbol, (b) stale bars ship without a staleness flag. Fix those two, add a PDT counter, and it's usable for scalping. Until then it's a swing-trader tool.
