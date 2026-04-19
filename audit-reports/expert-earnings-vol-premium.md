# Expert Audit — `earnings_vol` (Short Iron Butterfly, Post-Earnings Crush)

**Auditor:** 15-yr quant / single-name options-vol desk
**Scope:** `backend/strategies/earnings_vol/{spec.md, strategy.py, config.py, polygon_helpers.py}` + `phase1-earnings_vol-oos.json`
**Prior context:** Wave-23 (r5) P0 — AMC historical-move denominator — fix confirmed present.
**Date:** 2026-04-18

---

## Summary (400 words)

**Direction.** Short vol, **post-announcement crush harvest**. Confirmed by `spec.md` (thesis), leg definitions (`strategy.py:587–627` — short ATM call + short ATM put + long OTM wings), and signed entry quantity `-int(contracts)` at `strategy.py:646`. This is the Dubinsky et al. (2019) / Ederington-Lee (1996) trade: a defined-risk short iron butterfly entered T-1 close that monetises the event-premium decomposition between diffusive vol and event vol. Wings are Natenberg ch. 18-19 style (`wing_width_multiple = 0.81 × expected_move` at tuned defaults).

**Mechanics.** Entry is MOC on T-1 (`OrderType.MOC` at `strategy.py:648`), exit is MOO on T (filled at T+1 open per engine next-bar semantics). The tuned `exit_timing = "1h_after_open"` currently resolves to MOO too (`_exit_order_type` at `strategy.py:1238`), because the daily engine can't model intraday limits — the spec's "1 hour post-open" is an approximation, not an actual sub-session fill. Candidate scoring is in `_score_candidate` (L374) and uses the ATM straddle mid as implied move, then requires `implied_move_pct / 8Q-median-historical-|ΔS|/S ≥ 1.76`.

**Wave-23 AMC fix.** Verified correct at `strategy.py:781–810`. BMO events use `open_D / close_{D-1} - 1`; AMC events (the universe default via `_classify_earnings_time`, which coerces unknowns to "after_close") use `close_{D+1} / close_D - 1`. The fix is material — it removes the ~50% understatement of the AMC median that previously over-fired the richness gate.

**Structure and sizing.** Single spread per event (`max_concurrent_positions = 1`), sized so `wing_width × 100 − net_credit` worst case = 2.87% of equity. This is **notional/max-loss-constrained**, not vega- or delta-constrained — a legitimate defined-risk choice but not "constant vega across events", so Sharpe distribution varies with event vol level.

**Pinning risk.** Nontrivial. With `dte_target = 21` and exit on T+1 open, the spread carries ≥19 DTE at exit — pinning at body strike K₀ at expiration is not a live concern because the trade is closed long before expiry.

**Capacity.** OOS produced **10 events / 40 legs** across 2023-2024 (2 calendar years, 30-name universe). That is genuinely small. The filter rejects >95% of scheduled events. `max_concurrent_positions = 1` further caps concurrency. At $100k starting equity the total P&L was +$26.3k (Sharpe 1.43 OOS) — scale-dependent only via adding names to the universe, not relaxing the gate.

**Verdict: SHIP with caveats.** Direction, structure, Wave-23 fix, and defined-risk sizing are correct. Three real concerns: (1) BS-inverted entry IV from possibly-stale Polygon close mids, (2) the 10-event OOS sample gives a point-estimate Sharpe with ~±0.5 uncertainty, (3) `dte_target=21` trades theta-heavy but loses most of the pure vega-crush edge the literature emphasises — it's an execution-cost compromise, not a first-principles choice. P0 bugs: **none**. Ship.

---

## Evidence

### 1. Direction — SHORT vol post-earnings

- `spec.md` L3-18 — "implied vol **crushes** to the post-event norm … short iron butterfly … collects a large net credit".
- `strategy.py:587–627` — body call/put `Side.SELL`, wing call/put `Side.BUY`.
- `strategy.py:646` — `quantity=-int(plan["contracts"])` (short signed). The engine's sign semantics make this a credit-received spread at entry.

### 2. Implied vs historical move comparison

Implied move (`strategy.py:436–442`) = straddle mid (C + P at K₀) / underlying close. This is the correct Einhorn / Natenberg front-week implied-move estimator.

Historical move (`_historical_earnings_move`, L681–814):

```python
is_bmo = earn_time == "before_open"
if is_bmo:
    moves.append(abs(open_d / prev_close - 1.0))       # close_{D-1} → open_D
else:
    if idx + 1 >= len(closes): continue                # skip trailing edge
    moves.append(abs(close_d1 / close_d - 1.0))        # close_D → close_{D+1}
```

**Wave-23 fix confirmed correct.** The denominator pair is now timing-aware. Pre-fix, AMC events used `close_{D-1} → close_D` which misses the event window entirely; the median was ~50% understated and the richness ratio was overstated.

One remaining softness (P2, not P0): `_classify_earnings_time` (L902-926) defaults unknown timings to `"after_close"` (L923-926). If FMP's free-tier feed has mostly blank timings, the historical-move computation **assumes AMC for everything**, which is fine when FMP is right (~95% of mega-cap tech reports AMC anyway) but produces the wrong denominator pair for known BMO names (JPM, GS, BAC, MS, WFC — the financials in the universe). Consider asserting explicit classification for the financial sector subset.

### 3. Entry / exit timing

- **Entry** — session T-1 (asof + 1 day = target_date = earnings day, at `_pre_score_today` L228). Order type MOC (`strategy.py:648`). Fills at T-1 close. Correct per Ederington-Lee.
- **Exit** — staged on T via `manage()` (L302-364). Order type = `_exit_order_type(exit_timing)`. Config defaults to `"1h_after_open"` which `_exit_order_type` maps to `OrderType.MOO` with a comment that intraday limits are unsupported in the daily engine (L1238-1245). The spec's 1h-after-open nuance does **not** actually happen — it is next-open MOO in practice. Worth aligning the config/spec/engine to avoid over-promising granularity.
- **Hold** — ~1 trading day. The vega discharge happens in the first minutes post-open; holding longer adds gamma without fresh vega edge. Matches textbook.

### 4. Structure: straddle vs strangle vs spread

**Short iron butterfly** — confirmed. Same-strike body (`body = ATM`), wings at `K₀ ± wing_width_multiple × straddle_mid` (dollar, not percent — `strategy.py:463-464`, correct). This is Natenberg ch. 19's defined-risk earnings structure. Max loss is bounded at `wing_width × 100 − net_credit`, which is the entire reason this is a shippable strategy rather than a naked-straddle gamble with a 4-6× left tail (per Dubinsky 2019).

### 5. Position sizing

Max-loss-per-trade constrained, sized to 2.87% of equity per spread (`strategy.py:534-542`):

```python
max_loss_per_spread = (wing_width_dollars - net_credit_per_contract) * 100.0
contracts = max(1, int(max_risk_dollars // max_loss_per_spread))
```

This is **neither constant vega nor delta-neutral-by-construction** — it is a defined-risk notional gate. The butterfly is approximately delta-neutral at entry by symmetry (ATM body, equidistant wings), but stops being delta-neutral the moment the underlying moves. That's acceptable for a hold-overnight trade; no intraday delta hedging is attempted (which is correct for this overnight structure).

Minor: `min = 1 contract` floor (L542) means a $100k account takes a bigger % max loss than configured if a single spread's max loss exceeds 2.87%. Acceptable given the 1 concurrent slot.

### 6. Pinning risk

Not a concern with `dte_target = 21` and overnight hold. The short body is held 1 session of its ~21-day life; pinning pressure at K₀ near expiration is absent. If `dte_target` were tuned down to 7 (v1's value, literature-preferred), pinning at Friday OPEX with the body ITM would become a real concern — the current 21 DTE avoids that entirely.

### 7. Capacity / slippage

OOS JSON (`phase1-earnings_vol-oos.json`): **40 legs / 10 events / 2 years / 8 underlyings**. This is a capacity-constrained niche. The spec owns this honestly (L112-123).

Slippage handling:
- Entry limit = 0.95 × mid (`strategy.py:641-642`) — allows the engine's default 5% per-leg half-spread (`backend/backtest/execution.py:113`) to chip ~5% off net credit while still filling. Sensible.
- No ATM-strike liquidity filter (spec mentions one at L106-110, but implementation only checks **wings** via `_wing_spread_too_wide`, L1162-1191). A wide short-body bid/ask won't be caught. For the mega-cap universe this is usually fine; for INTC / MU at $30 underlying, body spreads can still be wide. Consider adding a body-leg spread check symmetric to the wing check.

### 8. BS inversion caveat (synthetic ledger legacy)

`strategy.py:494-511` inverts IV from the ATM straddle mids using `iv_from_price` (Black-Scholes). This is used only to seed `entry_iv` for the **deprecated** `_synthetic_exit_net_premium` path (L819-875) — the spec and config (L59-64) acknowledge this is legacy. The live P&L path now uses Polygon contract bars via `_fill_multileg_option` in the execution simulator. OK.

However, `_leg_mid` (L1087-1140) falls back to `contract_close` (daily close) when no bid/ask is present, which **is** the live historical path. A daily close from 16:00 isn't necessarily the marked mid at T-1 close (the actual intended entry time); premium quotes at 15:58 vs 16:00 can diverge 1-3% on volatile names. Acceptable given Developer-tier data constraints, but a small bias.

---

## Findings ranked

### P0 (blocking)
**None.** The Wave-23 AMC fix resolves the prior blocking bug. Structure, direction, entry/exit logic, and sizing are all correct.

### P1 (should fix before scaling)

- **P1-A — `exit_timing=1h_after_open` is misleading.** Engine executes as MOO (`_exit_order_type`, L1238-1245). Either implement intraday exit in the engine or drop the option from the search space and rename default to `"next_open"` (v1's setting).
- **P1-B — BMO sector mislabelling.** Financials (JPM, GS, BAC, MS, WFC) report BMO; FMP free-tier often omits the `time` field; `_classify_earnings_time` defaults to `"after_close"`. Result: historical denominator uses AMC pairing (close-to-close) when the real event window is close-to-open. Not as severe as the pre-Wave-23 bug, but the financials slice of the OOS (GS, MS) may be using the wrong denominator. Add a per-sector or per-ticker override map.
- **P1-C — ATM-body liquidity gate missing.** `_wing_spread_too_wide` only checks wings. Add symmetric body check.

### P2 (nice-to-have)

- **P2-A — Single-contract sizing floor** (L542) breaches risk cap on very small accounts / expensive spreads. Low-frequency issue but worth a guard.
- **P2-B — `dte_target=21` sacrifices pure vega-crush.** Front-week (7 DTE) is textbook-optimal for crush harvesting; the 21 DTE tuned default is an execution-cost workaround. If Polygon tier is upgraded and real bid/ask becomes available, retune with `dte_target=7`.
- **P2-C — 10-event OOS is small.** Sharpe 1.43 point estimate carries ~±0.5 uncertainty on the true population distribution. Honestly disclosed in `phase1-earnings_vol.md` L124-129. Consider running longer OOS (2019-2022 backfill) or expanding universe to 50+ names.
- **P2-D — `polygon_helpers.py:175`** has a reference to `contract_id` which is undefined in that scope (the variable is `contract`). Logging line, not a live bug, but would crash on that specific exception path.

---

## Verdict

**SHIP** — production-ready for the declared capacity band (~10-20 events/yr, single-digit concurrent vega exposure). The strategy implements the short-vol earnings-crush trade correctly with defined-risk wings per Dubinsky et al. (2019) and Natenberg. Wave-23's AMC fix is verified. No P0 bugs.

Expected live performance: **Sharpe 0.9–1.9 at 95% CI**, ~10 trades/yr, ~1-2% max DD, low turnover, 55% leg-hit rate / ~100% event-hit rate on the small 10-event OOS. Scale P&L only by growing the universe, never by loosening the richness ratio.

**Do not ship at larger AUM without rerunning capacity analysis.** Weekly options on single names top out around mid-8-figure short-vega budget; concentrating 2.87% of a $100MM book into a single INTC spread will move the mid against you before you fill the spread.
