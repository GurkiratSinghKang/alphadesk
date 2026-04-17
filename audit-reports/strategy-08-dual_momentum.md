# Strategy Audit 08 — Dual Momentum

**Auditor:** Quantitative researcher, 15+ yrs, specialty Dual Momentum / GEM
**Target:** AlphaDesk `dual_momentum` strategy
**Code reviewed:**
- `/Users/GK/Downloads/alphadesk/backend/strategies/dual_momentum.py` (290 lines)
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py` (DualMomentumRunner, L2086-2258)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/master_agent.py`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts`
- `/Users/GK/Downloads/alphadesk/big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md`
**Production API:** `https://tradingalpha.net/api/strategies` returned 404; `/strategies` page returned auth-only shell (no live metrics accessible).

---

## Executive Summary

AlphaDesk's "Dual Momentum" strategy is **not Gary Antonacci's Dual Momentum**. It is a cross-sectional relative-strength equity screener with an absolute-momentum gate on individual names, a SPY 12-month regime filter, sector caps, inverse-vol scaling, and quarter-Kelly sizing. The marketing copy (backend/strategies/dual_momentum.py:1-15, frontend/src/lib/strategy-content.ts:506-513) cites Jegadeesh & Titman (1993) AND Antonacci (2014), but the implementation is essentially **cross-sectional JT-momentum with a market-on/off switch**. It omits the single most defining feature of Antonacci's GEM: **the bond fallback when equities fail the absolute-momentum test**. When SPY 12m is negative, this strategy sits in cash (backend/strategies/dual_momentum.py:60-62, backend/data/ingestion/strategy_runner.py:2127-2133) instead of rotating to AGG/IEF/IEI.

Two redundant implementations exist — `DualMomentumStrategy` (backend/strategies/dual_momentum.py) and `DualMomentumRunner` (backend/data/ingestion/strategy_runner.py:2090-2258). Only the Runner is wired into the pipeline (backend/data/ingestion/pipeline_runner.py:66-70; backend/data/ingestion/strategy_runner.py:3440-3456). The `BaseStrategy` subclass appears to be dead code for this strategy — the pipeline scheduler never calls it.

There is no look-ahead bias per se (all returns use `closes[-22]` or `closes[0]` as anchors against `closes[-1]`, which are point-in-time), but the implementation has several subtle departures from textbook GEM, parameter stacking, and overfitting vectors that will erode the thin edge DM is known for.

**Score: 52/100.** It resembles the label more than it implements it. Decent hygiene (sector caps, vol scaling, regime filter), but the missing bond leg alone costs ~20 points, and 1-month hold with 8%/20% stops for a strategy documented as "low-turnover monthly rebalance" costs another ~10.

---

## Textbook Dual Momentum (what Antonacci actually does)

**Global Equities Momentum (GEM) from Antonacci, *Dual Momentum Investing* (2014), NAAIM winner 2012:**

1. **Absolute momentum filter:** compare 12-month excess return of US equity (SPY/VFINX) vs risk-free (T-Bills, BIL, or 3-month T-bill yield). If US equity 12m excess return > 0, equities pass the absolute test.
2. **Relative momentum:** rank US equity 12m return vs International equity (VEU/EFA) 12m return. Hold whichever is higher.
3. **Bond fallback:** if US 12m excess return < 0, move the **entire allocation** to an aggregate bond index (AGG) or intermediate Treasuries (IEF). This is the crisis-alpha feature — you are not in cash, you are earning the bond term premium/risk-off flight-to-quality return.
4. **Monthly rebalance.** Low turnover (typically 1-2 round trips per year on average). Virtually no intra-month trading.
5. **Two assets at a time, max.** GEM holds exactly one of {US equity, intl equity, bonds}.

**Published results (Antonacci, 1974-2013):** CAGR ~15.7%, Sharpe ~0.87, max drawdown ~17.8% vs SPY's ~51%.

**Known weaknesses:**
- Momentum crashes (2009 rebound, 2020 March) — lookback-based signals lag at inflection points.
- 2022: a rare year where both equities AND bonds fell together; AGG -13%, IEF -15%. GEM's bond fallback turned into a drag. Realistic 2022 GEM return was slightly negative (-4 to -7%) while 60/40 was -16% — still relative outperformance, but not the crash protection the literature advertises.
- Parameter-single: GEM lives or dies by a single 12-month lookback. Some variants (Faber, Wouters) blend 3/6/12 to reduce period-luck — Antonacci argued against this as curve-fitting.

**Universe definition is small and deliberate:** SPY, VEU (or EFA/VXUS), AGG (or IEF/BIL). Three tickers. That discipline is the point.

---

## What AlphaDesk calls "Dual Momentum"

**Two parallel implementations:**

### A. `DualMomentumStrategy` (BaseStrategy subclass) — backend/strategies/dual_momentum.py
- Takes a passed-in `universe: list[dict]` with pre-loaded `closes` arrays (L46).
- Filters by market cap ≥ $2B and avg volume ≥ 500k (L40-41, L68-71).
- Computes 12-1m return as `closes[-22] / closes[-252] - 1` (L81) and 12m return as `closes[-1] / closes[-252] - 1` (L82).
- 60-day realized vol (L89-98), inverse-vol scaling to 15% target (L101-102).
- Ranks by vol-adjusted 12-1m return, takes top 20% (L111-115).
- Absolute filter: keeps only names with **own 12m return > 0** (L118-121) — note: this is NOT Antonacci's absolute-momentum gate on the market, this is a per-name trend filter.
- SPY 12m regime gate: if SPY 12m return < 0, return empty list (L56-62) — no bond fallback.
- Sector cap: max 3 per sector, max 20 names (L124-134).

### B. `DualMomentumRunner` (BaseStrategyRunner) — backend/data/ingestion/strategy_runner.py:2090-2258
- Fetches up to 100 stocks from screener (L2120), enriches 50, fetches 252 bars for top 30 via `asyncio.gather` (L2136-2138).
- SPY regime filter (L2124-2133), 12-1m/12m returns (L2149-2155), 60d vol (L2157-2168), vol-adj mom ranking (L2170-2182).
- Top quintile (L2185-2186), absolute ≥0 filter (L2189), sector cap (L2191-2202).
- Kelly-from-daily-returns sizing, clamped [0.02, 0.10] (L2221-2234).
- 8% stop, 20% target (L2236-2237).
- Wired to the monthly scheduler: `backend/data/ingestion/pipeline_runner.py:66-70` runs it on the last trading day at 15:55 ET.
- Registered in `ALL_STRATEGIES`: `backend/data/ingestion/strategy_runner.py:3451`.
- Has a $6,667 per-strategy allocation cap: `backend/data/ingestion/master_agent.py:67`.
- Frontend description: `backend/api/routes/strategies.py:326-338`, `frontend/src/lib/strategies.ts:102-108`, `frontend/src/lib/strategy-content.ts:506-513`.

### C. Not present
- No bond/AGG/IEF ticker anywhere in the strategy.
- No int'l equity universe (VEU/EFA/VXUS) anywhere in the strategy.
- No T-bill / excess-return proxy anywhere.
- No cash-yield accrual when the regime filter triggers.

---

## Findings (20)

### F1 — Not Antonacci's Dual Momentum; it's cross-sectional JT-momentum with a market on/off switch
**Severity: Critical (label mismatch).**
**File:line:** backend/strategies/dual_momentum.py:1-15, 56-134; backend/data/ingestion/strategy_runner.py:2086-2202; frontend/src/lib/strategy-content.ts:506-513.
The docstring, the UI description ("Antonacci…absolute momentum filter…Monthly rebalance") and the name "Dual Momentum" evoke GEM, but the implementation is:
- A top-quintile cross-sectional relative-strength screener (this is Jegadeesh-Titman 1993).
- An "absolute" filter applied per name (individual 12m > 0) — this is just a trend filter on the candidate, not the market.
- A SPY on/off switch that, when off, sits in cash.
There is no US-vs-Intl relative leg. There is no bond fallback. Calling this "Dual Momentum" is marketing, not implementation.

### F2 — No bond fallback (Antonacci's defining feature)
**Severity: Critical.**
**File:line:** backend/strategies/dual_momentum.py:60-62; backend/data/ingestion/strategy_runner.py:2127-2133.
When SPY 12m < 0, both implementations `return []` and do nothing. The strategy holds cash. Antonacci's GEM explicitly rotates to AGG or IEF in that regime — that is the "dual" in dual momentum (equity absolute OR bond). In 2008-09 and 2022 this distinction materially mattered: 2008-09 bonds rallied (positive drag offset), 2022 bonds fell (so cash beat bonds). A real GEM audit report needs to show both outcomes; this implementation reduces to a binary equity-on / cash-off strategy and forfeits the bond term premium during long equity bear markets.

### F3 — No risk-free / excess-return proxy for absolute momentum
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:39 (`ABS_MOMENTUM_THRESHOLD = 0`), backend/data/ingestion/strategy_runner.py:2189 (`_ret_12 > 0`).
The absolute-momentum test in Antonacci is **excess return over T-bills** (`r_equity_12m - r_tbill_12m > 0`), not `r_equity > 0`. When T-bill rates are 4-5%, a 1% equity 12m return passes AlphaDesk's test but fails Antonacci's. In 2022-2024 this materially changes signal timing — with SOFR/T-bill at ~5%, several months passed with nominally positive equity returns that were negative on an excess basis.

### F4 — Universe is wrong for GEM
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:68-72, backend/data/ingestion/strategy_runner.py:2120-2121.
GEM's universe is literally 3 ETFs (SPY, VEU, AGG). AlphaDesk pulls 100 names from the fundamental screener (`_get_screener_results(limit=100)`), then enriches 50 with prices and 30 with bars. This is a **single-stock momentum strategy**, not an asset-class rotation. The per-stock idiosyncratic risk is an order of magnitude higher, the turnover is also much higher, and the strategy will have completely different factor loadings than published GEM backtests.

### F5 — Redundant/dead code: two implementations
**Severity: Medium.**
**File:line:** backend/strategies/dual_momentum.py (entire file), backend/data/ingestion/strategy_runner.py:2090-2258; registry backend/strategies/__init__.py:11,25.
`DualMomentumStrategy` (BaseStrategy) is registered in `strategies/__init__.py:25` but `backend/data/ingestion/pipeline_runner.py:66-68` and `strategy_runner.py:3440-3456` route the monthly run through `DualMomentumRunner`. I see no caller of `DualMomentumStrategy.run_full_pipeline()` in the pipeline path. This is unreviewable drift — the "spec" class differs from the live class (BaseStrategy version has Kelly sizing inside `map_to_trade`, Runner computes Kelly inside `analyze`).

### F6 — 12-1 momentum window math is approximate and subtly different between the two
**Severity: Medium.**
**File:line:** backend/strategies/dual_momentum.py:81 vs backend/data/ingestion/strategy_runner.py:2151.
`dual_momentum.py:81`: `ret_12_1 = (closes[-22] / closes[-252] - 1) * 100` — anchors 252 bars ago (correct when `len(closes) >= 252`).
`strategy_runner.py:2151`: `ret_12_1 = (closes[-22] / closes[0] - 1) * 100` — anchors at the **first element of whatever the API returned**. If Alpaca returns 200 bars (not 252), the anchor silently becomes ~200 trading days ago, not 252. `len(closes) < 200` is filtered at L2146 so the range is 200-252; the effective lookback is 9.5-12 months depending on what Alpaca ships that day. This is a non-deterministic lookback — a classic source of period-luck drift.

### F7 — Monthly rebalance exists in spirit only; per-position 30-day hold is the actual rule
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:216 (`holding_period_days: 30`), L269-270 (`if days_held >= 30: return {"action": "close"…}`).
Antonacci rebalances the **entire portfolio** on the last trading day — signals are recomputed and the winner ticker is selected. What AlphaDesk does is: each position opens with a 30-day life, and at day 30 it is closed. Because positions are opened whenever the pipeline finds a candidate (and the monthly scheduler runs the strategy monthly anyway), this collapses into the same thing at the portfolio level — **but** the 8% stop and 20% target in `manage()` (L281-287) and `map_to_trade()` (L241-242) add intra-month exit rules that Antonacci explicitly does not have. Textbook DM has one exit: month-end rebalance. This implementation can whipsaw a position on a 2-week drawdown.

### F8 — Hard 8% stop on a 12-month-signal strategy is inconsistent
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:241 (`stop_loss = price * 0.92`), L281-283; backend/data/ingestion/strategy_runner.py:2236.
Signals derived from 252-day lookbacks should not be exited by 5-day noise. An 8% pullback is less than 1 annualized vol-unit for most stocks and is totally normal inside a momentum winner. Stops like this are the documented cause of strategy underperformance vs published DM results — the backtest literature uses month-end-only exits. Expect ~10-20% of positions to hit this stop as pure noise, turning a low-turnover strategy into a mid-turnover one with higher commission/slippage drag.

### F9 — 20% take-profit also inconsistent with momentum
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:242, L286-287; backend/data/ingestion/strategy_runner.py:2237.
Momentum works because winners keep winning. Truncating winners at +20% is the most common documented way to destroy momentum alpha — you clip the right tail of the return distribution. Academic DM backtests have no take-profit. If the strategy holds NVDA that is up 20% mid-month, closing it throws away the cross-sectional ranking's raison d'être.

### F10 — Vol-adjusted momentum ranking is a departure from GEM
**Severity: Medium.**
**File:line:** backend/strategies/dual_momentum.py:101-107; backend/data/ingestion/strategy_runner.py:2170-2177.
Ranking by `ret_12_1 * (TARGET_VOL / realized_vol)` tilts toward low-vol names — this is a **factor tilt** (momentum × low-vol), not dual momentum. It likely *helps* Sharpe modestly but it is not what the docstring claims. It also conflicts with how Kelly sizing is applied downstream (F11) — you get inverse-vol in the ranking AND inverse-vol in sizing AND a 10% cap. That's three stacked vol adjustments on the same input.

### F11 — Three-layer vol scaling stack (overengineered, non-obvious)
**Severity: Medium.**
**File:line:** backend/strategies/dual_momentum.py:101-102 (rank scale), L228-235 (Kelly sizing), L232-234 (inverse-vol sizing overlay), L237 (10% cap).
Sequence per name:
1. Rank by `ret_12_1 × (0.15 / realized_vol)`.
2. Kelly fraction `kelly_pct` from 60-day daily returns, clamped `[0.02, 0.10]`.
3. Multiply notional by `(0.15 / realized_vol)`, clamped `[0.5, 2.0]`.
4. Cap at 10% equity.
Each step is independently defensible, but stacked they produce a sizing function that is hard to reason about and highly parameter-sensitive. Kelly estimated from 60 daily returns has standard error ~30% — using it for sizing on a 12-month signal is noise.

### F12 — Kelly from 60-day daily returns is statistically unsound
**Severity: High.**
**File:line:** backend/strategies/dual_momentum.py:169-186; backend/data/ingestion/strategy_runner.py:2224-2234.
Kelly requires a stable win-rate/payoff-ratio distribution, typically fit on hundreds of independent samples. 60 daily returns is far too short and is highly autocorrelated. `kelly_pct = max(0.02, min(0.10, kelly_full * 0.25))` — after quarter-Kelly and clamping, the actual range of position sizes is narrow (2-10%) and is dominated by the clamp rather than by the Kelly formula itself. The Kelly math here is effectively decorative; the clamp is the sizing rule.

### F13 — Cross-sectional ranking on only 30 names ≠ "top quintile" of the market
**Severity: Medium.**
**File:line:** backend/data/ingestion/strategy_runner.py:2136, L2185.
`enriched` is at most 30 stocks, so "top quintile" is 6 names (30/5). These 30 come from a screener that already filters on `price > 10, < 500` (L165-177 of the same file) — it is not a broad Russell 1000 or S&P 500 ranking. Whatever cross-sectional momentum premium this captures is on a small, already-pre-filtered slice, not on a real cross-section.

### F14 — Sector cap (max 3) may be too tight given shrunk universe
**Severity: Low.**
**File:line:** backend/strategies/dual_momentum.py:42, L124-134; backend/data/ingestion/strategy_runner.py:2107, L2191-2202.
Combined with the 30-stock universe and 6-name quintile, capping 3 per sector means if tech dominates momentum you still only take 3 tech names and leave 3 slots open for (possibly weak) other sectors. For a real broad universe this is fine; for 30 names it will force marginal picks into the book.

### F15 — SPY regime check uses a non-risk-free-adjusted threshold, same as F3
**Severity: High (duplicate root cause).**
**File:line:** backend/strategies/dual_momentum.py:60; backend/data/ingestion/strategy_runner.py:2127-2128.
SPY `(closes[-1] / closes[-252] - 1) < 0` is the gate. Same as F3: this is nominal, not excess. In a 5% T-bill environment, you should be off the market when SPY 12m < 5%, not < 0%. 2015, early 2016, and mid-2022 would all have been filtered differently had excess returns been used.

### F16 — No slippage / commission / tax overlay
**Severity: Medium.**
**File:line:** entire file (no occurrence of `commission`, `slippage`, `tax`, `short_term_gain` in either implementation).
Antonacci's appeal rests on low turnover (< 2 round trips/yr avg). AlphaDesk's per-position hard 30-day life (F7) + 8%/20% stops (F8/F9) + monthly rebalance generates **high turnover on 15+ names**. At 15 names × 12 months = 180+ round trips/yr. Without a realistic cost model this strategy will look better in backtest than live by ~1-2% annually (Alpaca commission-free helps, but spreads + tax on short-term gains are still real for a taxable account). The claim "DM is famously low-turnover" is false for this variant.

### F17 — Capital allocation makes the strategy trivially small
**Severity: Medium.**
**File:line:** backend/data/ingestion/master_agent.py:67 (`"dual_momentum": 0.0667`).
Competition mode allocates $6,667. With a 10% per-position cap (L237 of dual_momentum.py), max position = $667 on a $6,667 allocation, or 1 share of a $500 stock. With up to 20 names returned (L134), this cannot fit — the strategy will cluster into ~8-10 low-price names. Integer-share rounding (`shares = max(1, int(notional/price))`) means meaningful slippage vs the theoretical vol-adjusted weights. For a research-grade DM backtest you want $100k+ per strategy.

### F18 — 200-bar minimum silently passes as "12-month" in fallback path
**Severity: Medium.**
**File:line:** backend/strategies/dual_momentum.py:83-85 (fallback uses stale `mom_12m - mom_1m` metric); backend/data/ingestion/strategy_runner.py:2146, L2153-2155.
If bars < 252, the Runner still computes a "12-1m return" using `closes[0]` — but this could be only 200 bars (9-10 months). Meanwhile the BaseStrategy variant falls back to a precomputed `momentum_12m - momentum_1m` field (L83-85), which is a different (and lossy) proxy. There's no assertion that data length is actually ~12 months. This is silent data-quality drift — the signal definition changes with the data feed.

### F19 — No look-ahead bias, but no explicit month-end anchoring either
**Severity: Low (clean but informal).**
**File:line:** backend/strategies/dual_momentum.py:81-82; backend/data/ingestion/strategy_runner.py:2151-2152.
Indexing `closes[-22]` and `closes[-252]` (or `[0]`) uses only past data — no look-ahead. However, Antonacci's rebalance is strictly month-end to month-end. AlphaDesk's Runner runs at 15:55 ET on the last trading day of the month (pipeline_runner.py:83), which *is* month-end, but the lookback is calendar-day count (22 and 252 trading days), not exact month-end bars. In practice this is fine; noting it for methodological completeness.

### F20 — UI claim "Absolute momentum filter reduces drawdowns by 30%" is unsubstantiated
**Severity: Low (UI/marketing).**
**File:line:** frontend/src/lib/strategy-content.ts:509.
"Absolute momentum filter reduces drawdowns by 30% vs buy-and-hold" — no backtest artifact in the repo substantiates this number for the AlphaDesk implementation. It is approximately right for Antonacci's published GEM vs SPY (~17.8% max DD vs ~51%), but that is a ~65% reduction, not 30%, and not for this strategy variant. The copy is conflating published GEM results with whatever this implementation does.

---

## 2019-2024 assessment (realistic expectation for what is actually coded)

I cannot find a stored backtest for this strategy in the repo (no `dual_momentum_backtest.json`, no `dual_momentum` timeseries in `big_run_result.json` or `multi_strategy_result.json`; `STRATEGY_RESEARCH_REPORT.md` doesn't mention it). This assessment is my expert read on what the code *would* produce:

| Year | Regime / Calendar | Textbook GEM | This implementation (expected) | Why different |
|---|---|---|---|---|
| 2019 | Strong bull, low vol | ~+20% | ~+15-18% | 8%/20% caps clip winners (F9), but regime is favorable |
| 2020 | March crash, then rebound | ~+0 to +8% | ~-5 to +5% | Stops (F8) whipsaw in March; SPY 12m stayed positive until mid-March; no bond rotation so missed bond rally; late re-entry after bear signal (F2) |
| 2021 | Steady bull | ~+22% | ~+15-20% | OK, but take-profit clipping (F9) reduces NVDA/TSLA tails |
| 2022 | Bear, rising rates, AGG -13% | ~-4 to -7% | ~-8 to -15% | GEM had painful bond fallback year; this impl goes to cash — so *avoids* the AGG loss, but the SPY 12m gate triggered late (around June/July) after equities had already fallen ~15% — lag is worse without the bond leg to offset. No T-bill accrual since it sits in cash (F3, F15). |
| 2023 | Rebound, narrow breadth (Mag 7) | ~+18% | ~+10-15% | Narrow leadership + sector cap (F14) + 20% take-profit (F9) leave performance on the table; Mag 7 winners get clipped |
| 2024 | Strong year, rate-cut pivot | ~+20% | ~+14-18% | Similar drag from F8/F9/F10 stack |

**Realistic 2019-2024 CAGR for this implementation: 8-12%.** For comparison textbook GEM CAGR was probably 9-11% over this window. **Sharpe: 0.5-0.7** (textbook GEM 0.6-0.9 over this period). The strategy is directionally correct but bleeds 2-4% annually to F7/F8/F9/F16.

**2022 deserves a call-out:** the user's prompt correctly notes "bond fallback during rising rates was painful — AGG down ~13%." This implementation *sidesteps* the bond-fallback problem by not having a bond leg — which sounds like a feature but actually means in years where bonds *do* rally during an equity bear (2008-09), this strategy forgoes 5-8% of bond return. It's not a cleaner variant; it's just a different trade-off that swaps 2022-style pain for 2008-style missed return.

---

## Score: 52/100

Breakdown:

| Category | Weight | Score | Weighted | Notes |
|---|---|---|---|---|
| Faithfulness to named method (is it actually Dual Momentum?) | 25 | 8/25 | 8 | Cites Antonacci but omits the bond leg, int'l equity, and T-bill proxy. It's JT-1993 cross-sectional momentum with a SPY on/off switch. (F1, F2, F3, F4) |
| Absolute momentum implementation | 10 | 4/10 | 4 | SPY gate exists but uses nominal not excess return; per-name trend filter exists. No T-bill comparison. (F3, F15) |
| Relative momentum implementation | 10 | 7/10 | 7 | Cross-sectional quintile ranking is clean; vol-adjustment is a defensible tilt though off-spec. (F10, F13) |
| Bond fallback | 10 | 0/10 | 0 | Not present. Strategy sits in cash during equity bear. (F2) |
| Rebalance discipline (monthly, low-turnover) | 10 | 4/10 | 4 | Monthly scheduler is correct, but 30-day hard hold + 8%/20% stops destroy the low-turnover property. (F7, F8, F9, F16) |
| Look-ahead / point-in-time hygiene | 10 | 8/10 | 8 | No look-ahead. Lookback is trading-day count, not month-end anchored, with silent data-length drift. (F6, F18, F19) |
| Parameter stability / overfitting risk | 10 | 5/10 | 5 | Single 12-month param, but layered with vol/Kelly/stops/caps that multiply the degrees of freedom. (F10, F11, F12) |
| Universe definition | 5 | 2/5 | 2 | 30-name screened universe is wrong for GEM (should be 3 ETFs). (F4, F13) |
| Cost realism (slippage/commission/tax) | 5 | 1/5 | 1 | No cost overlay anywhere; high effective turnover. (F16) |
| Engineering quality (non-dead code, single source of truth) | 5 | 3/5 | 3 | Two parallel implementations; only one is live. (F5) |
| **Total** | **100** | — | **52/100** | |

---

## Recommendations (not implemented — code read-only)

1. **Decide what this strategy is.** If it is meant to be Antonacci's GEM, gut it and rebuild: universe = {SPY, VEU, BIL}, comparator = BIL 12m return for absolute gate, rotate between SPY/VEU/AGG, one position at a time, month-end only, no stops. If it is meant to be cross-sectional JT-momentum, rename to "Cross-Sectional Momentum" or "Top-Quintile RS," drop the Antonacci citation, and own the variant.
2. **Remove F8 and F9.** Stops/targets on a 12-month signal destroy the edge. Exit at month-end re-rank only.
3. **Add risk-free proxy.** If you keep the GEM framing, the absolute filter must be `r_equity - r_tbill > 0`, not `r_equity > 0`.
4. **Delete the dead `DualMomentumStrategy` class** or route it through the pipeline — don't keep two copies drifting.
5. **Don't use Kelly on 60 daily returns.** Either remove Kelly or estimate from the strategy's own historical trade distribution (not cross-sectional daily noise).
6. **Fix the lookback anchor** in the Runner to `closes[-252]` (consistent with the BaseStrategy variant) and assert `len(closes) == 252`.

---

## Appendix — citations in code

- Academic citation: backend/strategies/dual_momentum.py:6-8 ("Jegadeesh & Titman, Antonacci").
- UI citation: frontend/src/lib/strategy-content.ts:506-513 (Antonacci 2014, "doubled Sharpe").
- Route description: backend/api/routes/strategies.py:328 (repeats the Antonacci framing).
- Pipeline doc: backend/data/ingestion/pipeline_runner.py:17 ("Antonacci (2014): Dual Momentum rebalances end of month").

All four public-facing surfaces claim Antonacci; none of the surfaces acknowledge the missing bond leg.
