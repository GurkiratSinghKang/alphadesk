# Persona 43 — Incident Responder: Alpaca Outage Graceful-Degradation Audit

Scenario: Alpaca Broker API and Alpaca Market Data WebSocket both degrade
(partial/full 503s, WS drops). The test: can the trader see what is broken,
or does the app silently paper over the outage?

Scope: WebSocket reconnect UX, REST 503 surfacing per route, status
indicators, and user-facing signals that quotes/fills may be unreliable.

---

## Findings (10)

### F1 — `/trades/orders` (GET) swallows broker 503 into empty list when keys are missing
File: `backend/api/routes/trades.py:458-459`

```python
if _alpaca_keys_empty():
    return []
```

A missing-key config returns `[]` with HTTP 200. The frontend Orders grid
then renders "No orders" — indistinguishable from a genuinely empty book
or from an Alpaca outage. The later block (line 569-578) DOES correctly
raise 503 `{error: broker_unavailable, retry: true}` on httpx failure,
but the misconfig branch is silent. Severity: P1 (ambiguous UI state).

### F2 — `/portfolio/summary` silently falls back to FAKE $100k demo account on Alpaca outage
File: `backend/api/routes/portfolio.py:534-536`

```python
except Exception:
    logger.warning("Failed to fetch portfolio summary from Alpaca, falling back to demo", exc_info=True)
    return _demo_portfolio_summary()
```

On any Alpaca exception (timeout, 5xx, network) the endpoint returns a
synthetic $100k paper portfolio with `is_demo=true`. The frontend
(`StatusStrip.tsx:76-79`, `_desk/selectors.ts:380-394`) does use
`is_demo` to flip the "Alpaca · offline" pill, but the equity figure in
the hero tile still renders a believable $100,000.00 — the trader could
believe they have buying power they do not have. Severity: P0
(dangerous; visible $100k could prompt orders).

### F3 — `/market/quotes/{symbol}` + `/bars` + `/snapshots` silently serve FAKE deterministic prices
File: `backend/api/routes/market.py:391-395`, `535-541`, `648-649`

```python
logger.warning("DEMO FALLBACK: Serving fake quote for %s — Polygon and Alpaca both failed", symbol.upper())
return _demo_quote(symbol)
```

When Polygon and Alpaca both fail, a random-but-deterministic fake quote
is returned with `is_demo=true`. The backend Quote/Bar/Snapshot Pydantic
models include `is_demo` (`market.py:35,46,56`), BUT the frontend
`Quote` type (`frontend/src/types/index.ts:60-84`) does NOT declare
`is_demo`. The market store (`stores/market.ts`) never reads it. Result:
the chart and watchlist render Alpaca-shaped fake prices with no visual
affordance. A trader could place limit orders against fake quotes.
Severity: P0 (direct trade-on-fake-data risk).

### F4 — `WsStatusBanner` is correctly wired (Wave 16 / edge-cases-r3 P0 #6) — VERIFIED
File: `frontend/src/components/layout/WsStatusBanner.tsx`; mounted in
`frontend/src/app/(dashboard)/layout.tsx:119,143`.

States render correctly: connecting (muted), reconnecting (amber,
`role=status` + polite), failed (red, `role=alert` + assertive + Reload
button). `useWebSocket.ts:49-51` uses 10 retries with exponential
backoff from 1s to 30s cap. Banner hides on "open". Mounted at the
dashboard root so it covers every authenticated route. This is the one
thing working as specified. Severity: None — pass.

### F5 — StatusStrip "LIVE/OFFLINE" indicator drives off `isConnected` only (binary), ignoring `wsStatus`
File: `frontend/src/components/layout/StatusStrip.tsx:16, 59-73`

```tsx
const { isConnected } = useWs();
…
{isConnected ? <LIVE/> : <OFFLINE/>}
```

During `wsStatus === "reconnecting"` (which can last up to 5+ min on
max backoff), StatusStrip flips directly to red "OFFLINE" with no
distinction between transient reconnect and `failed` dead state. The
strip ignores the richer `wsStatus` the hook exports. A user seeing
OFFLINE on the status strip but a yellow "Reconnecting…" banner gets
mixed signals. Severity: P2 (UX inconsistency).

### F6 — Hardcoded `claudeHealthy: true` pill lies during an AI outage
File: `frontend/src/app/(dashboard)/page.tsx:311`

```tsx
claudeHealthy: true,
```

The "Claude · healthy" status pill is constant — no probe, no ping, no
500-counter. If `/agents/chat` or `/analysis/analyze/{symbol}` is
503'ing, the desk footer still shows Claude as healthy. A Claude or
agent outage is invisible until the user tries and fails. Severity: P2
(misleading assurance).

### F7 — WebSocket has no client-side ping/pong heartbeat; only relies on TCP close
File: `frontend/src/hooks/useWebSocket.ts` (no heartbeat); server
supports `{action:"ping"}` → `{type:"pong"}` at `websocket/handler.py:268-269`
but the client never sends it.

A half-open socket (proxy or NAT drop, no FIN) will sit in
`readyState=OPEN` for minutes with no live ticks arriving. `onclose`
never fires → `wsStatus` stays `open` → banner stays hidden →
StatusStrip stays green LIVE → quotes go stale silently. Only the
visibilitychange handler (line 211-224) can recover, and only when the
user backgrounds/foregrounds the tab. Severity: P1 (stale-quote risk
on long sessions).

### F8 — `/trades/positions` (same shape bug as F1): missing keys return `[]`, httpx failure correctly 503s
File: `backend/api/routes/trades.py:646-647, 685-688`

```python
if _alpaca_keys_empty():
    return []
…
except Exception:
    raise HTTPException(status_code=503, detail={"error": "broker_unavailable", "retry": True})
```

The 503 path is correct; the silent `[]` on misconfig again makes "no
positions" ambiguous. Frontend `useDataPipeline.ts:18-24` swallows any
catch into a `console.warn` — a real broker 503 produces no user-visible
toast (the API-error event handler in `layout.tsx:47-73` only fires
when `apiFetch` throws, which happens on 503; but the positions call
returns `[]` on misconfig without throwing). Severity: P1.

### F9 — `market_overview` (indices/sectors/regime) silently flips to demo on Alpaca failure
File: `backend/api/routes/market_overview.py:172-176, 264-266, 354-359, 407`

```python
logger.warning("Serving DEMO data for ALL indices — Alpaca API call failed", exc_info=True)
indices = [IndexData(**d, is_demo=True) for d in _DEMO_INDICES]
```

Indices/sectors/regime return demo values with `is_demo=true`. The
regime pill in StatusStrip does dim on `is_demo` (line 49,55) — good —
BUT the TickerTape, PortfolioHero market context, and SectorTreemap
display DEMO numbers with a tiny badge at best. No global "market data
degraded" toast. Severity: P1.

### F10 — `placeOrder` failure UX: generic "Order failed" toast, no 503-specific retry affordance
File: `frontend/src/components/panels/TradePanel.tsx:279-281`

```tsx
catch (err: any) {
  toast({ type: "error", message: "Order failed: " + (err?.message || "Unknown error") });
}
```

When backend returns `503 {"error":"broker_unavailable","retry":true}`,
the catch block stringifies the raw error (`"API 503: Service Unavailable – …"`)
into a toast. The `retry: true` signal from the server is never
interpreted — no automatic retry, no "Retry" button, no distinction
between "risk rejected my order" (422) and "broker is down" (503). The
pending order is cleared from state (`setPendingOrder(null)` is inside
the try block so it won't fire — minor; but the order just vanishes
from the Builder with no queue). Severity: P1.

---

## Summary (250 words)

The WebSocket banner (Wave 16 / edge-cases-r3 P0 #6) is correctly wired
and covers every authenticated route with appropriate ARIA semantics
and retry UX — that one lands (F4). Everything else on the broker-
outage path is either silent or ambiguous.

The central failure mode is **demo fallback without user-facing
signal**. On an Alpaca outage, `/portfolio/summary` returns a fake
$100k account (F2), `/market/quotes` returns fake deterministic prices
(F3), and `/market-overview/*` returns fake indices/sectors/regime
(F9). All three set `is_demo=true` on the wire — but the frontend
Quote/Bar types never read it, the market store drops it, and the
equity hero tile renders the believable $100k figure. A trader could
place a real limit order against a fake price. The backend has a
correct 503 path for `/trades/orders` and `/trades/positions` (httpx
exceptions surface as `broker_unavailable` with `retry:true`), but the
misconfig branch silently returns `[]` (F1, F8), and the frontend
`placeOrder` catch block throws away the structured `retry` hint (F10).

The WebSocket has no client-side ping/pong, so half-open sockets don't
trip the banner (F7). The StatusStrip LIVE/OFFLINE pill flips binary
on `isConnected` and ignores the richer `wsStatus` the banner uses
(F5), and the "Claude · healthy" pill is a hardcoded constant (F6).

Net: during an Alpaca outage, a careful trader learns mostly from a
tiny opacity change on the regime pill and the "Alpaca · offline"
footer chip. Critical demo-shim prices reach the chart unannounced.
