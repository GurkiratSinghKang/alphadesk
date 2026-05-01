# /trade - expected behavior

## Route

- URL: `/trade`
- Access: requires-auth
- Redirects: none in the current workspace. This route renders the canonical trade ticket surface.
- Metadata: inherits the dashboard layout.
- Source: `frontend/src/app/(dashboard)/trade/page.tsx`

## Layout

The page renders a single-column trade workspace with a compact header, chart context, order ticket, optional pre-staged option context, and recent orders.

Expected high-level regions:

- Header: `§ TRADE`, `Trade · <symbol>`, optional `data-slot="trade-strategy-tag"`, and "Back to desk".
- Chart section: `PriceChartPanel` for the selected or URL-prefilled symbol.
- Ticket section: `OrderBar`, including `data-testid="order-bar-symbol"`, `data-testid="order-bar-qty"`, and `data-testid="order-bar-submit"`.
- Optional single-leg section: `data-slot="active-contract"` when `?contract=` is valid.
- Optional multi-leg section: `data-slot="active-legs"` with one `data-slot="active-leg"` per valid leg when `?legs=` is valid.
- Recent orders section: table or empty state, refreshed from `getOrders`.

## Query prefill contracts

### Equity ticket

Example:

```text
/trade?symbol=AAPL&side=buy&qty=1&type=limit&limit=123.45&strategy=manual
```

Expected:

- The selected symbol and chart context use `AAPL`.
- The order ticket symbol field contains `AAPL`.
- The order ticket quantity field contains `1`.
- The order type is `limit`; price is populated from `limit` or `price`.
- The route does not submit anything on load.
- If `strategy` is present, the strategy tag is visible and the ticket default uses it when available.

### Single-leg OCC option

Example:

```text
/trade?symbol=NVDA&contract=NVDA260425C00205000&side=sell&qty=1&limit=1.42&strategy=earnings-options-play
```

Expected:

- The selected underlying is `NVDA`.
- `data-slot="active-contract"` is visible.
- The active contract shows the OCC symbol, expiry, call/put side, strike, order side, quantity, and limit price when present.
- `data-order-side` matches `buy` or `sell`.
- The order ticket symbol field is prefilled with the OCC contract, not the equity ticker.
- The route does not submit anything on load.

### Multi-leg combo

Example:

```text
/trade?symbol=NVDA&legs=NVDA260424P00200000:sell:1:1.45,NVDA260424C00220000:sell:1:1.32&strategy=earnings-options-play&combo_type=strangle
```

Expected:

- The selected underlying is the explicit `symbol` or the first valid leg's underlying.
- `data-slot="active-legs"` is visible.
- Each valid leg renders as `data-slot="active-leg"` with OCC symbol, side, quantity, and optional limit.
- The strategy tag includes the strategy and combo type when provided.
- The order ticket is locked to the first valid leg by convention, including its limit price when present, while the submit payload carries all active legs.
- The submit label reads as a combo action, for example "Place 2-leg combo".
- The route does not submit anything on load.

## Validation and safety expectations

- Invalid or malformed symbols should not create an executable ticket.
- Invalid OCC contracts should not render an active contract or active leg.
- Quantity must remain a positive whole number within ticket limits.
- Limit and stop orders require their respective price fields before submission.
- Tests may intercept the order endpoint to verify payload shape, but must not place real or paper orders in shared environments unless a test-only account and explicit submit scenario are configured.
- Mobile coverage is required for equity, single-leg, and multi-leg deep links because a wrong tap target or clipped ticket can change order intent.

## What must NOT happen

- No redirect from `/trade` back to `/`.
- No automatic order submission on page load.
- No dashboard-only order-bar assertions; order-entry checks belong to `/trade`.
- No silent loss of the `strategy`, `combo_type`, `limit`, or `quote_ts` URL context.

## Harness coverage

- [x] Add `qa/harness/tests/trade.mjs` for desktop and mobile.
- [x] Cover equity prefill without submit.
- [x] Cover OCC single-leg prefill without submit.
- [x] Cover multi-leg combo prefill without submit.
- [x] Move stale dashboard order-bar fill checks out of `qa/harness/tests/dashboard.mjs`.
- [ ] Add malformed query fuzz cases for contract, legs, side, qty, limit, and stop.
- [ ] Add an intercepted-submit payload test only when the environment guarantees no real broker side effects.
