# Persona 12 — Options Trader Audit

**Verdict: AlphaDesk is not usable for options trading today.** The options chain endpoint surfaces data, Greeks/IV/put-call-parity numbers pass sanity checks near-the-money, and a payoff diagram renders — but the path from "click a strike" to "broker accepts a spread" is broken end-to-end, and chain coverage is far below what a real multi-leg trader needs. Findings are ranked by blast radius on a real trading session.

## Top 10 concerns

1. **OCC option symbols are rejected by the order API.** `OrderLeg.symbol` is regex-gated to `^[A-Z][A-Z0-9.\-]{0,9}$` (max 10 chars, letters/digits/dot/hyphen) in `backend/api/routes/trades.py:102`. Every real OCC ticker is 15–21 chars (e.g. `AAPL260420C00270000`). I POSTed a vertical spread to `/api/v1/trades/orders` — both legs 422'd with `string_pattern_mismatch`. No spread, condor, covered call, or single contract can reach Alpaca. The `asset_class: "option"` field on `OrderLeg` exists but is unreachable. Blocking bug for the entire persona.

2. **Frontend never builds an OCC leg.** `TradePanel.handleSubmit` (`frontend/src/components/panels/TradePanel.tsx:252`) builds each leg with `symbol: l.symbol` where `l.symbol = selectedSymbol` (the underlying). `strike`, `expiry`, `option_type`, and `asset_class` are held only in component state and dropped at submit. Even if the regex were relaxed, the broker call has no way to identify which contract was clicked.

3. **Naive buy/sell alternation.** `TradePanel.tsx:136` assigns leg side by `i % 2 === 0 ? "buy" : "sell"`. An iron condor (short-short-long-long) and a call butterfly (buy-sell-sell-buy) can't be expressed. There's no UI to flip a leg's side independently of clicking order.

4. **Chain depth is capped at ~100 contracts, ~1–2 expirations.** Every response I tested — AAPL, SPY, TSLA, NVDA, BRKB — returned exactly 100 contracts across 1–2 expirations. Real AAPL has 20+ expirations (weeklies, monthlies, LEAPS) and hundreds of strikes. The Alpaca snapshots endpoint is being called once with no pagination in `options.py:441–446`. A trader picking a 60-DTE spread sees nothing beyond the front two weeks.

5. **Open interest is universally zero; ~72% of contracts have zero IV/Greeks.** On AAPL I measured 0/100 OI>0 and only 28/100 with IV>0. Alpaca's snapshots populate `greeks`/`openInterest` only when quoted; the backend accepts the zeros as-is with no fallback. A trader cannot filter by OI for liquidity, and "delta=0, gamma=0" rows will silently misclassify into any strategy screen.

6. **SPX (and other index tickers) return wrong spot price.** `/options/chain/SPX` returned `spot_price=375.83` — that's near SPY, not SPX (~5,000). `_demo_spot` fell through to the `random.Random(seed).uniform(20, 500)` branch because Alpaca's equity trades endpoint doesn't quote cash indices. Also no distinction between American (AAPL) and European (SPX, XSP) style, no cash-settlement flag — dangerous for anyone trading index options.

7. **Past-dated greeks endpoint returns nonsense.** `GET /options/greeks/AAPL/250/2025-04-18` (one year expired) returned `delta=1.0, theta=-0.0342`, no error. BSM silently plugs `T = max(days/365, 1/365)` clamping past expiries to positive time. A live order builder pointed at an expired contract will get plausible-looking numbers.

8. **Expiration generator ignores non-Friday series.** `generateExpirations()` in `OptionsPanel.tsx` emits 12 consecutive Fridays only. SPY/SPX/QQQ have Monday/Wednesday weeklies; post-2022 0-DTE is the dominant listed option product. LEAPS (Jan-15 anchored) and quarterlies are missed. The "expiration chip row" shows exp dates that don't match reality.

9. **Risk check undercounts option notional by 100×.** `_risk_check` (`trades.py:917`) does `limit_price * qty` with no multiplier. A 10-contract position on a $5 premium contract registers as $50 notional versus $5,000 real — $50k single-order cap is effectively un-hittable for options. Separately, no margin/BP check, no early-assignment buffer, no pin-risk gate.

10. **Strategies' option legs never reach the broker path.** `vrp_harvest` and `earnings_vol` emit `strategies.signal.OptionLeg` — a different model from `api.routes.trades.OrderLeg`. The two aren't reconciled anywhere I found; strategy signals feed the backtest engine's `_fill_multileg_option` path but there's no adapter to the live order endpoint. So even if the UI bugs above were fixed, the strategies themselves can't submit live.

## Honorable mentions (observed but lower severity)

- Payoff diagram is expiration-only (no T+n curve); gamma/theta decay can't be visualized before expiry.
- No assignment/exercise/ex-div handling in any backend code path (`grep` returned zero hits for `assignment`, `early_exercise`, `pin_risk`).
- `OrderLeg` caps legs at `max_length=4` — iron condor fits, but call-ratio backspreads / reverse jade lizards (5+ legs) are excluded.
- IV rank/percentile are computed from the cross-section of strikes in the single fetched chain (`options.py:598–602`), not from an IV history series — the 11.5 rank I saw for AAPL is meaningless.
- Alpaca `mleg` order_class is wired up (`trades.py:1212`) but legs don't carry `ratio_qty` / `position_intent` that OCC-style combos require, so even a valid OCC symbol would likely reject.

## Evidence trail

- Auth: logged in at tradingalpha.net as `admin` via persona bootstrap curl.
- Live chain tests: AAPL/SPY/TSLA/NVDA/BRKB/SPX/XYZ123. Responses saved to `/tmp/chain_*.json`.
- Order submit: `POST /api/v1/trades/orders` with OCC legs — **HTTP 422** (regex mismatch).
- Put-call parity at SPY 710 ATM: C−P = 0.06 vs S−K = 0.14 — within carry, chain pricing near-money is trustworthy.
- Deep-ITM AAPL 140C: bid/ask present, IV=0, delta=0 — Alpaca didn't quote greeks.
- SPX spot: 375.83 (wrong).
- Expired greek call 2025-04-18: no error, delta=1.0 returned.

**Bottom line**: the options *analytics* read-path is acceptable for near-the-money front-week exploration; the *trading* write-path is non-functional.
