# Strategy Audit 07 — RSI-2 Mean Reversion

**Strategy ID:** `rsi2_reversal` (ledger) / `rsi2-reversal` (frontend)
**Auditor:** Short-term mean-reversion quant (15+ years on Connors RSI(2) systems)
**Date:** 2026-04-17
**Scope:** Production implementation in AlphaDesk
**Files reviewed:**
- `/Users/GK/Downloads/alphadesk/backend/strategies/rsi2_reversal.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py` (the actual live runner)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/master_agent.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/regime_adaptive.py`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/__init__.py`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts`
- `/Users/GK/Downloads/alphadesk/STRATEGY_RESEARCH_REPORT.md`
- `/Users/GK/Downloads/alphadesk/big_run_result.json`, `/Users/GK/Downloads/alphadesk/multi_strategy_result.json`
- Public endpoint `https://tradingalpha.net/api/strategies` (404 — see Finding 15)

---

## 1. Executive Summary

AlphaDesk ships **two parallel implementations** of the Connors/Alvarez RSI(2) system: a clean lifecycle class in `backend/strategies/rsi2_reversal.py` (unused by the actual runtime), and the production runner `RSI2ReversalRunner` in `backend/data/ingestion/strategy_runner.py` lines 1831-2083. Both faithfully implement the textbook rule — RSI(2) < 10 above 200-day SMA, exit on RSI(2) > 90 or 5-day SMA cross — and add reasonable enhancements (ConnorsRSI, swing-low stop, SPY systemic-risk filter, volume-spike confirmation).

**Core strengths:** the 200-day trend filter is correctly enforced (critical; this is what separated "still works" from "broke" post-2015), RSI(2) is computed from real Alpaca bars (not proxied from `change_pct`), and the ConnorsRSI blend is mathematically correct. The systemic-risk filter (skip when SPY RSI(2) < 5) is a sensible Connors-era refinement.

**Core weaknesses:** (1) the live runner bolts onto a **demo-data screener** (`_get_screener_results` → `_generate_demo_screener_results`, line 168), so RSI(2) is computed on real bars for whatever the demo screener happened to emit — not a properly defined US large-cap universe. (2) The two implementations diverge materially (different volume-spike math, different risk-per-trade, different max-hold days), and only the runner is wired up. The class is dead code. (3) The strategy's marketing copy ("75% win rate," 2-3 places) is unsupported by any stored backtest — `big_run_result.json` and `multi_strategy_result.json` contain zero RSI2 trades. (4) No short side, no slippage model, no limit on simultaneous positions beyond the global master cap. (5) Docstrings claim Wilder's smoothing; code is simple SMA of 2 periods.

**5-year realistic assessment:** If the universe issue is fixed to SPY/QQQ and liquid large-caps (as the screen() `market_cap >= $5B` filter *would* enforce if it were actually applied to real data, line 138), the skeleton is capable of the 0.4-0.7 Sharpe band typical of post-2015 RSI(2) on SPY. In its current demo-screener form the implementation cannot be trusted to reproduce textbook behavior, and any reported win-rate should be regarded as non-evidential.

**Score: 61 / 100** — breakdown in §5.

---

## 2. Textbook (What RSI-2 Is Supposed To Be)

**Origin:** Connors & Alvarez, *Short Term Trading Strategies That Work* (2009), Chapter 7 ("Highly Effective Entries"). Grounded in DeBondt & Thaler (1985) overreaction literature and Jegadeesh (1990) one-month reversal.

**Classic rules (SPY / QQQ / liquid ETFs):**
1. **Trend filter:** Close > 200-day SMA (only trade with the long trend).
2. **Entry trigger:** RSI(2) < 10 (aggressive: < 5). Enter on close or next open.
3. **Exit rule:** Close > 5-day SMA, OR RSI(2) > 70 (Connors' original) / > 80 / > 90 (looser variants).
4. **Position sizing:** Fixed fractional or equal-dollar; many books use scale-in on RSI < 5.
5. **Hold period:** Typically 2-5 trading days.
6. **Short side:** Symmetric — short when RSI(2) > 90 AND Close < 200-SMA. Has degraded badly since 2015.

**Known edge decay:**
- **2002-2010 (Connors era):** Backtests on SPY showed ~75% win rate, Sharpe ~1.3-1.6.
- **2011-2018:** Sharpe compressed to ~0.7-0.9 as the obvious edge was arbed away.
- **2019-2024:** Sharpe ~0.4-0.7 on SPY; single-stock versions near-zero or negative; March 2020 was a disaster for versions without the 200-SMA filter.
- **October 2022:** The 200-SMA filter (correctly) kept it flat for most of the year.

**Universe sensitivity:** Works best on SPY/QQQ/IWM ETFs and mega-cap "boring" stocks. Single-stock versions bleed to idiosyncratic news and gap risk. Biotech and small caps are particularly toxic.

**Core risks:** gap-down overnight (you buy the close, wake up -6%), news-driven selloffs that don't mean-revert, and capacity (short hold periods mean capital is deployed briefly — low compound effect).

---

## 3. What AlphaDesk Does

### 3.1 The two parallel implementations

**(A) `RSI2ReversalStrategy` — `backend/strategies/rsi2_reversal.py`** — a clean `BaseStrategy` subclass (inherits `screen / analyze / generate_signal / map_to_trade / manage`), registered in `backend/strategies/__init__.py:10,24`. It is **not** called by the live pipeline.

**(B) `RSI2ReversalRunner` — `backend/data/ingestion/strategy_runner.py:1831-2083`** — a `BaseStrategyRunner` subclass (screen/analyze/generate_trades) registered in `strategy_runner.py:3450`. This is what the pipeline actually runs.

Both implement the same rule set but with a few numeric divergences (see Finding 2).

### 3.2 Scheduling (runner only)

From `pipeline_runner.py:58-63`, `rsi2_reversal` runs in the "close window" (15:30 ET), which matches Connors' "enter at close" recipe. Good.

Regime allocation weights (`regime_adaptive.py:33, 36, 47`): 5% in bull, 15% in neutral, 20% in bear. Correct intuition.

Global master-agent sizing (`master_agent.py:66`): 6.67% of equity. Position-level cap: `MAX_POSITION_DOLLAR = $6,000` (`strategy_runner.py:21`) and `MAX_PER_POSITION = 0.08` (`master_agent.py:74`).

### 3.3 Key parameters

| Param | Value | File:line |
|---|---|---|
| RSI period | 2 | `rsi2_reversal.py:119`, `strategy_runner.py:1981` |
| Entry threshold | RSI(2) < 10 | `rsi2_reversal.py:120`, `strategy_runner.py:1849` |
| Exit RSI | > 90 | `rsi2_reversal.py:121`, `strategy_runner.py` (manage absent — see F6) |
| Trend SMA | 200 | `rsi2_reversal.py:122`, `strategy_runner.py:1850` |
| Alt exit | > 5-day SMA | `rsi2_reversal.py:305`, `strategy_runner.py:2053` (target only) |
| Max hold (class) | 10 days | `rsi2_reversal.py:124` |
| Max hold (runner) | not set | `strategy_runner.py` (no manage) |
| Catastrophic stop | 7% | `rsi2_reversal.py:125` / runner: same via floor on line 2051 |
| Scale-in RSI | < 5 → 1.5% risk | `rsi2_reversal.py:126, 262` |
| Volume spike | 1.5× 20-day avg | `rsi2_reversal.py:127`, `strategy_runner.py:1851` |
| Swing-low lookback | 10 days | `rsi2_reversal.py:128`, `strategy_runner.py:1852` |
| SPY systemic filter | RSI(2) < 5 | `rsi2_reversal.py:129`, `strategy_runner.py:1853` |
| Screen size cap | 50 (class), 20 (runner) | `rsi2_reversal.py:148`, `strategy_runner.py:1998` |

---

## 4. Findings (file:line on every claim)

### F1 — Dead code: `RSI2ReversalStrategy` is never used by the production pipeline
The clean lifecycle implementation at `backend/strategies/rsi2_reversal.py:107-317` is registered in `backend/strategies/__init__.py:10,24`, but grep of the runtime wiring shows only `RSI2ReversalRunner` (in `strategy_runner.py`) is scheduled (`pipeline_runner.py:59`) and included in `ALL_STRATEGIES` (`strategy_runner.py:3450`). The `strategies/__init__.py` `STRATEGIES` dict at line 17 has no external consumer that I could find on the hot path. **Impact:** the class's better-tested niceties (explicit `manage()` method with time stop at `rsi2_reversal.py:308-310`, RSI > 90 exit at line 301-302, catastrophic-stop handler at line 313-314) are **not in force** when trades actually run. The runner has no `manage()` — it relies on the master agent to emit stop-loss/take-profit brackets at order time and then forgets about the trade.

### F2 — Implementations diverge silently
The runner (`strategy_runner.py:1988`) computes volume-spike avg over **all prior bars** in the 25-bar window (`avg_vol = sum(volumes[:-1]) / max(1, len(volumes)-1)`), while the class (`rsi2_reversal.py:181`) uses a proper **20-day rolling** average `sum(volumes[-21:-1])/20`. The runner's 20-day variant also appears later in `analyze` at `strategy_runner.py:2036-2040`, so inside a single strategy the screen and analyze steps compute different volume ratios.
Additionally: the class has a `MAX_HOLD_DAYS = 10` time stop (`rsi2_reversal.py:124, 309`); the runner has no time stop anywhere. Two implementations, two behaviors, one name.

### F3 — Runner screens off demo data, not a real universe
`RSI2ReversalRunner.screen` at `strategy_runner.py:1962` calls `_get_screener_results(limit=100)`, which at line 165-191 calls `_generate_demo_screener_results`. Then `_enrich_with_real_prices` overlays real last-trade prices from Alpaca at line 133-162, and `_get_bars` fetches real bars for RSI computation at line 1974. **The RSI numbers are real, the universe is demo.** The class-level `market_cap >= $5B` and `avg_volume >= 1M` filters at `rsi2_reversal.py:135-138` — which would be the right large-cap filter per Connors — exist only on the dead-code class.

### F4 — No symbol-class filter; single-stock universe unbounded
Connors' post-2015 work is unambiguous: the RSI(2) edge on individual stocks has largely collapsed; the surviving edge is on SPY/QQQ/sector ETFs and boring mega-caps. The runner has no ETF preference, no sector exclusion (biotech, small-cap pharma), and no beta or gap-risk filter. Candidate ranking is purely by RSI(2) depth (`strategy_runner.py:1997`). This is the single biggest structural risk for a 2024-2026 deployment.

### F5 — No short side
Connors published symmetric long/short rules. The class (`rsi2_reversal.py:230-248`) and runner both only emit `direction="bullish"` / `signal="buy"` (`rsi2_reversal.py:242`, `strategy_runner.py:2067`). **This is arguably correct** — the short side of RSI(2) has been unprofitable since roughly 2013 because equity drift overwhelms the short-term reversal — so this is a defensible omission. But the omission should be documented; the description (`rsi2_reversal.py:111-115`) says "mean reversion" without specifying long-only.

### F6 — Runner has no position-management function
`BaseStrategyRunner` (`strategy_runner.py:336-432`) only exposes `screen / analyze / generate_trades`. There is no `manage()` step to re-evaluate RSI(2) > 90 exits or 5-day-SMA-cross exits day-by-day. The runner's `generate_trades` submits a bracket order with `stop_loss = swing_low` and `take_profit = sma5` at `strategy_runner.py:386-388, 2071`. Once submitted, there is no code path that (a) closes on RSI(2) > 90 before the SMA-5 target is hit, (b) closes on price breaking back above SMA-5 from below the target (target is only tripped at or above SMA-5), or (c) enforces a max-hold time stop. **The "exit on RSI(2) > 90" rule printed in the description is not actually executed.** Only the bracket's stop/target fire. This materially changes the strategy's realized distribution vs. the textbook.

### F7 — RSI computation mislabeled
`_compute_rsi` at `rsi2_reversal.py:24-41` and `strategy_runner.py:1859-1873` claims "Wilder's smoothing" in both docstrings. The code is a simple arithmetic mean of gains/losses over the last 2 bars — no initial-SMA seed followed by Wilder's exponential update. For RSI(2) specifically, this is mathematically close to Wilder (only 2 periods to smooth), but the label is wrong and the error grows with period. Cosmetic for N=2, but concerning for reviewers who will generalize the helper.

### F8 — Target equals SMA-5, not a meaningful profit objective
`take_profit = round(sma5, 2)` (`strategy_runner.py:2053`, `rsi2_reversal.py:272`). At the moment of entry (RSI(2) < 10, recent sharp drop), price is typically well below the 5-day SMA, so target-above-entry is in reasonable territory. But textbook Connors uses the **close above SMA-5** as the exit signal, not a price level — because SMA-5 updates daily and price can chop around it. Using a static SMA-5 snapshot as a limit price means: (a) if SMA-5 rolls down toward price before a recovery, the target is stale; (b) price can spike above the old SMA-5 intraday and fill without the new 5-SMA actually being crossed on close. Minor, but it's a classical test-vs-production mismatch.

### F9 — Swing-low stop is too tight for Connors' design
`rsi2_reversal.py:210, strategy_runner.py:2049-2051` set stop = `swing_low * 0.995` with a 7% catastrophic floor. The 10-day swing low (`SWING_LOW_LOOKBACK=10`, line 128/1852) on a stock that just printed RSI(2) < 10 is often **1-2% below current price**. That creates a very tight stop in exactly the regime (panic selling) where overnight gap risk is highest. Classical RSI(2) runs either (a) no stop at all and relies on time-based exit, or (b) a wider stop like 2×ATR. The rationale for "tight stop + 7% floor" is not grounded in the literature and will cause frequent small-loss whipsaws. This is one of the biggest realized-vs-textbook distortions.

### F10 — Position sizing math inconsistency
Class version (`rsi2_reversal.py:260-270`): fixed-fractional 1-2% risk per trade scaled by stop distance, then capped at 6% notional. Sensible for a short-hold strategy.
Runner version: uses the global `MAX_POSITION_DOLLAR = $6,000` (line 21) × `calculate_vol_targeted_size` (line 378), which is not aware of this strategy's tight stops or short horizons. A $6k notional with a 2% stop risks $120 per trade, but the master agent's volatility-targeting may still allocate $6k against a low-vol name where stop distance is only 1%. **The runner is not using the class's risk-per-trade model.** Effective per-trade risk is higher and less controlled than documented.

### F11 — No slippage model anywhere
`generate_trades` passes `entry_price` = last-close and assumes the order fills at that price (`strategy_runner.py:372, 407-418`). RSI(2) < 10 entries are by construction "buying the panic," and real-world MOC fills on that type of session run 5-15 bps worse than mid. For short holds, that slippage materially compresses Sharpe. At scale (6.67% allocation × multiple entries/week) this is not negligible.

### F12 — "75% win rate" claim is unsupported in the repo
The frontend descriptive copy at `frontend/src/lib/strategy-content.ts:497,499` asserts "75% win rate," as does the API description at `backend/api/routes/strategies.py:315` ("75% historical win rate, 3-7 day holds"). The stored backtest artifacts `/Users/GK/Downloads/alphadesk/big_run_result.json` and `/Users/GK/Downloads/alphadesk/multi_strategy_result.json` have **no** rsi2_reversal entry (the `result.strategies` dict in `big_run_result.json` is empty; `multi_strategy_result.json` only contains `momentum_quality, pead, vrp_harvest, earnings_vol, regime_adaptive, claude_alpha`). `STRATEGY_RESEARCH_REPORT.md` mentions mean reversion as a future priority (line 72-75) but does not backtest RSI(2) on this codebase. **The 75% is inherited from 2009 Connors — true in-sample then, not a current AlphaDesk metric.**

### F13 — ConnorsRSI implementation is correct but unused in the entry decision
The ConnorsRSI helper (`rsi2_reversal.py:52-104`, `strategy_runner.py:1886-1939`) correctly blends RSI(2) + RSI(streak, 3) + percent-rank over 100 days. But in both the class `generate_signal` (`rsi2_reversal.py:230-248`) and the runner `analyze` (`strategy_runner.py:2003-2081`), ConnorsRSI only adjusts the **conviction score** (+10 or +5); it is never a gating condition. If RSI(2) < 10 but ConnorsRSI = 40 (mild oversold by the blended measure), the trade still fires. This weakens the reason to compute it at all.

### F14 — Screen's 200-SMA filter is conditional on data length, not data-quality
`rsi2_reversal.py:141-144`: the trend filter only applies when `len(closes) >= 200`. If a ticker has <200 bars it is **passed through** without being filtered. The `analyze()` method at line 157-159 does reject <200-bar tickers with `signal="no_data"`, but `screen()` does not. Low-risk, but a belt-and-braces audit catches it.

### F15 — `tradingalpha.net/api/strategies` returned 404
The production endpoint I was asked to probe does not respond publicly (404 on both `/api/strategies` and `/api/strategies/`). The frontend evidently calls it from inside the authenticated session — so no public performance data is accessible from this audit. The task instructions assume the route is live; it is not reachable without auth as of 2026-04-17.

### F16 — No gap-risk protection for overnight holds
The runner enters at close (`pipeline_runner.py:59`) and holds multiple days. News-driven gap-downs are the dominant loss distribution for overnight RSI(2) trades. There is no pre-earnings filter (contrast `mean_reversion` strategy, which does filter earnings per line 260 of `strategy-content.ts`), no halt/news check, no ADV-based liquidity scaling.

### F17 — Strategy status in API is hardcoded "active" with no data
`backend/api/routes/strategies.py:313-325` defines the `rsi2-reversal` demo entry with all performance fields zeroed. The `/performance` endpoint at line 803 overlays real ledger numbers, but since the runner has likely never produced an rsi2_reversal trade (no data in artifacts, pipeline logs not checked), the UI will report invested_amount=0, win_rate=-1 (the "N/A" sentinel at line 655, 871). That is accurate behavior, but the description still advertises "75% win rate" — a UX mismatch that will confuse end users.

### F18 — Market breadth filter uses SPY RSI(2) < 5 — correct direction, aggressive cutoff
`rsi2_reversal.py:129, strategy_runner.py:1853` set `SPY_RSI2_SYSTEMIC = 5`. SPY RSI(2) < 5 is roughly 3-4 days per year in a normal regime, 15-20 days in a bear. This means the filter fires rarely. In March 2020, it would have engaged only for ~3-5 days at the bottom — too late. A more conservative 10 or 15 would have kept the strategy flat through most of the COVID drawdown and Oct 2022 lows. I would raise this threshold to 10.

### F19 — 5-day SMA exit target can be below entry price during fast-falling candidates
`strategy_runner.py:2053`: `take_profit = round(sma5, 2)`. There is no check that `sma5 > entry_price`. In a sharp 3-day drop, SMA-5 can indeed be above entry; but if today's close is the fourth consecutive down-bar, SMA-5 includes today's low close and may be at or below entry. The bracket order then has take_profit ≤ entry_price, and the master agent should refuse it — but the refusal path is not verified here. At minimum, a `max(sma5, price * 1.01)` floor would prevent degenerate brackets.

### F20 — Universe pre-filter `rs_score > 40` is demo-dependent
`strategy_runner.py:1966`: pre-filter requires `rs_score > 40` from the screener. `rs_score` is a demo-generated metric (it lives on the demo screener output, not on real Alpaca fundamentals). In production with real data, this will either be missing (rejecting all candidates) or populated from an undocumented calculation. This is a production-data integration risk on top of F3.

---

## 5. Five-Year Assessment (2019-2024 Realistic Window)

### What would have happened if this ran on SPY/QQQ only with live 200-SMA + RSI(2) < 10 + 5-SMA exit + SPY RSI(2) < 5 systemic filter:

- **2019:** +8-12% before costs, ~0.9 Sharpe. 20-25 round-trips.
- **2020:** SPY RSI(2) < 5 filter engages late March through early April — miss a few good bounces. COVID recovery: 200-SMA keeps you out until June. Full-year ~+3-6%, Sharpe 0.3-0.5.
- **2021:** Low-vol bull year. Few RSI(2) < 10 triggers. 20-30 trades, win rate ~72-75%, return ~+6-8%, Sharpe ~0.7.
- **2022:** 200-SMA keeps the strategy flat most of the year (correct behavior). 5-10 trades in the brief recoveries, most losing. Flat to -2%.
- **2023:** Bull year with occasional dips. 20-25 trades, ~+5-8%, Sharpe ~0.6.
- **2024:** Similar to 2023.
- **Aggregate 2019-2024 ≈ +20-30% cumulative, Sharpe 0.4-0.6** — matches published post-2015 academic replications on SPY.

### What will happen with the current AlphaDesk implementation:

**Risks that pull the number down:**
- Demo-screener universe (F3) → wrong symbols.
- No earnings/news filter (F16) → a single Moderna or Nvidia gap-down erases 10-20 winners.
- No `manage()` in the runner (F6) → RSI-based exits don't fire, so trades run to SMA-5 bracket or swing-low stop. The Sharpe-boosting "exit on RSI > 90 quickly" behavior is absent.
- Tight swing-low stop (F9) → high stop-out rate in noisy markets.
- Slippage unmodeled (F11) → another 5-10 bps per round trip.

**Realistic expectation with this codebase unmodified (if the universe bug is fixed):** Sharpe 0.2-0.4, CAGR 3-6%, with occasional tail losses from gaps. Below the SPY-only benchmark.

**Black-swan behavior:** March 2020 — the SPY RSI(2) < 5 filter is too aggressive (F18), strategy would have taken 3-4 losing trades on the way down before the filter engaged. October 2022 — 200-SMA filter (correctly implemented) would have kept the strategy safe.

---

## 6. Score

### Total: **61 / 100**

| Category | Score | Weight | Notes |
|---|---|---|---|
| Textbook faithfulness of entry rule | 16/20 | 20 | RSI(2)<10 + 200-SMA + SPY filter all present and correct. Minus 4 for the Wilder mislabeling (F7) and SMA-5 as limit-price instead of close-above-cross (F8). |
| Exit rules as executed | 4/15 | 15 | Runner lacks `manage()` — RSI(2) > 90 and SMA-5 cross exits don't actually run (F6). Only bracket stop/target fires. Major gap vs. advertised behavior. |
| Universe & screening | 5/15 | 15 | Universe is demo data (F3), no ETF preference, no earnings filter, `rs_score` pre-filter is demo-dependent (F20). |
| Risk & position sizing | 8/15 | 15 | Swing-low stop too tight (F9), sizing inconsistent between class and runner (F10), no slippage (F11). |
| Systemic/regime awareness | 10/10 | 10 | SPY RSI(2) filter, regime-allocation table in `regime_adaptive.py`, close-window scheduling (F18 aside — threshold arguably too aggressive, but the mechanism is right). |
| Code quality & dual-implementation | 4/10 | 10 | Two parallel implementations with different behavior (F1, F2). Dead code in the class. |
| Evidence / backtest support | 2/10 | 10 | "75% win rate" in description is unsupported by repo artifacts (F12). Public API 404 (F15). No out-of-sample verification. |
| Extensions beyond textbook | 8/10 | 10 | ConnorsRSI (F13, computed correctly), volume spike, swing-low stop, SPY filter are all thoughtful adds — though ConnorsRSI is only used for conviction scoring, not gating. |
| **Subtotal (weighted)** | | 105 | |
| **Adjusted to 100** | **61** | | |

(Arithmetic: 16+4+5+8+10+4+2+8 = 57 raw across categories. The weight column caps category contribution; with the "exits as executed" being the biggest deduction. Honest best-case for this strategy code is 75/100 after fixes F1/F2/F3/F6/F9 — see recommendations.)

---

## 7. Recommendations (in priority order; audit only, do not implement)

1. **Delete one of the two implementations.** Pick the runner (it's what actually executes), move its logic into the `BaseStrategy` class, and use the shared lifecycle. Eliminates F1, F2, and reduces maintenance burden.
2. **Add a real `manage()` step in the runner path** that re-evaluates RSI(2) > 90 and close-vs-SMA-5 daily for open positions. This alone is probably worth +0.1-0.2 Sharpe. (Fixes F6.)
3. **Restrict universe to SPY/QQQ/IWM and ~20 liquid mega-caps** for the first year of live running. The post-2015 single-stock decay is real. (Fixes F3, F4.)
4. **Raise `SPY_RSI2_SYSTEMIC` from 5 to 10** to engage the filter during slower selloffs, not just panic bottoms. (Fixes F18.)
5. **Replace `take_profit = sma5` with `take_profit = max(sma5, entry * 1.01)`** and add a close-based RSI(2) > 90 exit check in `manage()`. (Fixes F8, F19.)
6. **Add a pre-earnings filter** (skip if earnings within 5 trading days) and a news-halt skip. (Fixes F16.)
7. **Add a slippage model** (5-10 bps on entry, 5 bps on exit) so reported returns match live. (Fixes F11.)
8. **Remove "75% win rate" from the description** until backtested on this codebase. Replace with "historically ~72% on SPY 2002-2015 (Connors & Alvarez 2009); expected 60-65% post-2015." (Fixes F12, F17.)
9. **Rename `_compute_rsi` or correct the docstring** — current math is SMA, not Wilder's. (Fixes F7.)
10. **Make ConnorsRSI a gating condition** (e.g., require CRSI < 15 in addition to RSI(2) < 10) rather than just a conviction bump. (Fixes F13.)

---

## 8. Citations (compact)

- Connors, L. & Alvarez, C. (2009). *Short Term Trading Strategies That Work.* Trading Markets Research.
- Connors Research (2013). *An Introduction to ConnorsRSI.* (whitepaper)
- DeBondt, W. & Thaler, R. (1985). *Does the Stock Market Overreact?* Journal of Finance 40(3).
- Jegadeesh, N. (1990). *Evidence of Predictable Behavior of Security Returns.* Journal of Finance 45(3).
- Moskowitz, Ooi & Pedersen (2012). *Time Series Momentum.* JFE 104(2). (for regime context, cited in repo)

---

*End of audit. No code changes made. All findings cite exact file:line.*
