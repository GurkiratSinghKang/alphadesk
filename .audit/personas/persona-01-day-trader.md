# Persona 1 — Day Trader (Scalper)

**Profile:** Scalps SPY/QQQ with 100–1000 share orders, uses hotkeys, expects sub-second feedback on every click.

## Bugs found

### P0-DT-1: Invalid orders silently rejected — no user feedback
- Entered qty `-100`, SIDE default, clicked Place order. No toast, no inline error, no button state change. Nothing.
- Entered qty `999999999`, SIDE BUY. Button pulsed, POST `/api/v1/trades/orders` returned **422**. UI still silent — no error surfaced.
- **Impact:** Scalper cannot tell if the order went through, failed, or hung. In a real-money flow this loses trades or causes duplicate fires from panic-re-clicking.
- **Fix:** Display 422/4xx errors as a toast or inline below the Place order button. Disable button while request is in flight.

### P1-DT-2: Qty field has no client-side validation
- Accepts negative numbers, zero, and absurd values (`999999999`) with no red border or helper text. Only the backend bounces it.
- **Fix:** `min=1`, `step=1`, `type=number`, HTML validation + live guard.

### P1-DT-3: Order count mismatch in two places
- Top status bar: `POSITIONS · ORDERS 7 · 10`
- Right panel tabs: `POSITIONS 7  ORDERS 50  JOURNAL 7`
- Two different "orders" counts on the same screen (10 vs 50). Likely one counts open+pending, the other counts lifetime — same label, wildly different meaning.
- **Fix:** Label them distinctly (`Open Orders` vs `Orders (today)`) or reconcile to one source.

### P1-DT-4: Redundant API polling on load
- On every refresh, the desk fires **three** orders endpoints back-to-back: `/trades/orders`, `/trades/orders?status=pending`, `/trades/orders?status=open`. Same data shape, should be one call or share cache.
- Also duplicates `/portfolio/summary` twice on first paint.

### P2-DT-5: Chart placeholder bars (VOL, AVG VOL, IV, REGIME FIT) all show `—`
- For SPY — a symbol that has these values readily available — these fields stay as em-dash even after load. If intentional for paper/closed market, the data source should be labeled "unavailable" not a vague dash.

### P2-DT-6: `Last tick —` in status bar is ambiguous
- With the market closed, the scalper can't tell if the feed is stale, disconnected, or simply closed. "Feed idle · market closed" would communicate both pieces.
