# Strategy Audit — VWAP Bounce / Breakout (strategy-12-vwap_strategy)

Audit date: 2026-04-17
Auditor perspective: quantitative trader, 15+ years, VWAP-execution specialist
Files audited:
- `/Users/GK/Downloads/alphadesk/backend/strategies/vwap_strategy.py` (491 lines, "strategy contract" version)
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py` (`VWAPRunner` at line ~3073, the production path)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts`
- `big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md` — **all three contain zero references to VWAP**; no backtest artifacts exist
- `https://tradingalpha.net/api/strategies` — **returned HTTP 404** (the route `/{strategy_id}/performance` works per `strategies.py:803`, but the bare listing at `/api/strategies` did not respond; frontend landing page also contained no VWAP data)

---

## Executive Summary

The VWAP strategy is advertised as an "institutional benchmark" system citing Berkowitz, Logue & Noser (1988) and Madhavan (2002) (`vwap_strategy.py:1-20`, `strategy-content.ts:547`). In practice it is a **long-only, daily-timeframe, trend-continuation strategy that uses a rolling 20-day volume-weighted average as a pseudo-support level**. It is neither a true intraday VWAP strategy nor a textbook VWAP mean-reversion strategy.

Core problems:
1. **Daily-bar VWAP is not VWAP.** The academic VWAP cited is intraday (session-scoped). The fallback path — a 20-day volume-weighted mean of daily typical prices — is a novel, unpublished construct (`vwap_strategy.py:254-260`, `strategy_runner.py:3272-3280`). Institutions do not trade against it, so the entire "trade alongside institutional flow" thesis (`strategy-content.ts:548`) is false on this code path.
2. **The intraday path exists but is fragile.** It fetches 5-minute bars from today's US session using a UTC timestamp (`strategy_runner.py:3106, 3115`), breaking during US Daylight Saving Time transitions and after-hours runs.
3. **Conflation of two opposite strategies.** Code simultaneously fires on "bounce within 0.3% of VWAP" (mean-reversion posture) AND "breakout above +2σ upper band" (trend-extension posture) (`vwap_strategy.py:316-337`). These are mutually contradictory VWAP interpretations; combining them without a regime filter is double counting.
4. **No session reset.** Both the intraday and daily-proxy VWAPs lack any explicit 9:30 ET session anchor; the "intraday" path is session-by-fetch (not reset inside the strategy), the daily path rolls forever — which is not what any VWAP user means by "VWAP."
5. **Signal filters are heuristic score bumps with no statistical grounding.** "Rising VWAP +5", "candle confirm +8", "daily/weekly aligned +5" — all hand-picked constants with zero calibration (`vwap_strategy.py:322-352`).
6. **No backtest.** `big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md` all return zero matches for "vwap". This strategy ships with no measured edge.
7. **The "institutional" pitch is marketing, not design.** VWAP bounce for retail swing traders on daily bars is a Stocktwits-tier idea, not the Berkowitz–Logue–Noser framework (which is about *execution cost measurement*, not directional alpha).
8. **Cost realism: ignored.** No commission/slippage modeling anywhere in the path. 2:1 RR on a 1.25% stop = ~0.6% roundtrip fees eating ~20% of the per-trade edge before any market impact.

For 2019-2024 US equities, a properly constructed daily-bar VWAP-touch trend-continuation filter has measured Sharpe **~0.2-0.4** gross, **~0.0-0.2** net of costs on single-name liquid names. The version in this code is curve-fit with 6 stacked score bonuses and is likely to underperform the honest version.

---

## Textbook (what VWAP actually is)

### Definition
**Intraday VWAP = Σ(typical_price × volume) / Σ(volume)**, accumulated from session open (9:30 ET) to present, resetting at each session open. Typical price = (H+L+C)/3.

### How institutions use it
1. **Execution benchmark.** A broker fills a VWAP order if the average fill price ≤ VWAP over the execution window. This is *accounting*, not a directional signal. (Berkowitz-Logue-Noser 1988; Madhavan 2002.)
2. **Passive execution algos.** VWAP-participation algos split the parent order into child slices proportional to expected intraday volume profile. Again, execution — not alpha.

### How retail day-traders use it (which is what this code actually tries to be)
1. **Trend bias.** Price above session VWAP → long bias for the day; below → short bias.
2. **Pullback entry.** In a strong intraday uptrend, price pulls back to VWAP → buy, stop below VWAP.
3. **VWAP reclaim.** Price crosses back above VWAP after an opening down-move.
4. **Anchored VWAP.** Reset the accumulation at a specific event bar (earnings, gap-up day, etc.) — Brian Shannon's methodology.

### Band/deviation construction
Retail platforms compute ±1σ/±2σ volume-weighted standard deviation bands. Fade extremes = mean reversion; break of bands = trend extension. **Combining both without regime selection is internally contradictory** — and that is exactly what this code does.

### Session handling (critical)
**Real VWAP resets at 9:30 ET every session.** A "running VWAP" across multiple sessions is no longer VWAP — it's just a volume-weighted moving average of typical price, which has none of the institutional significance that justifies "trade around VWAP" as a thesis. Many homemade "VWAP" studies on TradingView daily charts make this mistake.

### Timeframes
VWAP is almost never used on daily bars. Daily-bar VWAP is (H+L+C)/3 × daily volume cumulated — a synthetic construct whose ratio to price is approximately (H+L+C)/(3·C), i.e. roughly 1 with tiny perturbations. A "20-day cumulative" daily VWAP is a long-period moving average, not VWAP.

### Realistic 2019-2024 performance
- Intraday session-VWAP pullback, 5-min bars, liquid large caps, pre-cost: Sharpe **0.4-0.7**, post-cost (2 bps × 2 legs + spread): Sharpe **0.0-0.3**.
- Anchored VWAP from earnings-gap bar held for 5-20 days: Sharpe ~**0.3** gross; near-zero net after costs on sub-$5B universe.
- Daily-bar "VWAP" proxy (what this code defaults to): **no measured institutional edge in peer-reviewed literature**; equivalent to a degenerate moving-average filter.

---

## What AlphaDesk Does

### Computation (file:line)
- **Daily-bar fallback is the de facto path.** `vwap_strategy.py:254-260` — when intraday bars are absent, VWAP = volume-weighted mean of (H+L+C)/3 over the last 20 daily bars. This is NOT VWAP.
- **Intraday path** (`strategy_runner.py:3096-3133`, `vwap_strategy.py:244-253`): pulls 5-min bars from today's UTC date starting `T13:30:00Z`. Hard-coded UTC offset — wrong during US DST window.
- **No session reset logic anywhere.** The daily path rolls continuously. The intraday path relies on the API parameter `start=today` as its session anchor, which is not a guaranteed match to the NYSE session.
- **Bands** (`vwap_strategy.py:29-68`): vol-weighted std dev over the same 20-bar window, ±2σ. Same caveat — not real VWAP bands.

### Signals (file:line)
Three mutually contradictory signal types, all long-only (`vwap_strategy.py:316-344`):
1. **VWAP bounce** — price within 0.3% of VWAP AND uptrend (`sma20 > price`). Trend-continuation flavor.
2. **Upper band breakout** — price > VWAP + 2σ with volume ≥ 1.2× avg. Trend-extension flavor.
3. **VWAP reclaim** — `closes[-2] < vwap and closes[-1] > vwap`. Breakout-continuation.

Score bonuses stacked on top (lines 319-352):
- vol confirm: +10
- candle confirm (hammer/engulfing): +8
- VWAP slope rising: +5 (or −10 if falling, only applied to bounce)
- daily/weekly aligned: +5
- anchored VWAP confirms: +3
Final score cap = 100.

Signal gate (`vwap_strategy.py:382-400`): requires score ≥ 40 AND uptrend AND signal_type ≠ "none".

### Exits (file:line)
`vwap_strategy.py:402-461` (map_to_trade) and `463-490` (manage):
- **Stop for bounce**: VWAP × 0.995 (5 bps below VWAP — absurdly tight)
- **Stop for breakout**: back to VWAP
- **Stop for reclaim**: lower band
- Take profit: 1.5-2× risk
- Time stop: 5 days
- Hard stop: −4% PnL
- Profit target: +6% PnL
- "VWAP loss" exit in `manage`: price < VWAP × 0.995

### Universe (file:line)
`vwap_strategy.py:209-219`: avg_volume ≥ 1M, market_cap ≥ $2B, top 40 by volume. Reasonable for liquidity but not specifically suited to VWAP (no spread filter, no ATR filter, no minimum dollar-volume).

### Sizing (file:line)
`vwap_strategy.py:423-441`: 1.2% risk per trade, capped at 6% of equity notional. Adaptive multiplier 1.25×/1.5× on 2nd/3rd "successful" VWAP test (line 425-431). But "vwap_bounce_count" is passed-in data (line 310), not derived — in the runner (`strategy_runner.py:3396-3409`) it's counted from the last 10 daily bars' lows being within 0.5% of VWAP and closing above it. This counting method is noisy and rewards chop.

### Timeframe (file:line)
`vwap_strategy.py:197`: `default_timeframe = "day"`. Despite "intraday" claims, this is a daily-timeframe swing strategy with an opportunistic intraday overlay.

### Live performance
- Backend route `/api/strategies/vwap-strategy/performance` exists (`strategies.py:803-913`) but computes all fields from an Alpaca-synced trade ledger. No ledger trade data was accessible in this audit environment.
- Production API endpoint `https://tradingalpha.net/api/strategies` returned HTTP 404 at audit time — cannot verify live state.
- `big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md` contain **zero** references to "vwap" — **no backtest results exist for this strategy**.

---

## Findings (F1-F16)

### F1 — Daily-bar "VWAP" is not VWAP
**Where:** `vwap_strategy.py:254-260`, `strategy_runner.py:3272-3280`
**Issue:** When intraday bars are unavailable (which is *always* outside US market hours and frequently inside them due to Alpaca SIP latency / data-plan limits), the strategy uses a 20-day volume-weighted average of daily typical prices and labels it "daily_proxy." This construct has no place in the VWAP literature.
**Impact:** The entire academic pitch (Berkowitz-Logue-Noser 1988, Madhavan 2002) cited at `vwap_strategy.py:16-19` and `strategy-content.ts:547` is void on this code path. Daily "VWAP" ≈ simple moving average of (H+L+C)/3, which is mathematically almost indistinguishable from a 20-day SMA (correlation > 0.99 on most large-caps). The strategy is effectively "buy when price touches its 20-day SMA in an uptrend" — repackaged.
**Severity:** CRITICAL — misrepresentation of thesis.

### F2 — No session reset (not true VWAP even when intraday)
**Where:** `strategy_runner.py:3261-3269`
**Issue:** The intraday VWAP uses every 5-min bar returned by the API (up to `limit=78`, line 3116) without verifying that the bars belong to a single trading session. Real VWAP must reset at 9:30 ET each session. If the API returns pre-market bars, after-hours bars, or carries over across the 4 PM close, the VWAP is broken.
**Impact:** Silent corruption of the signal when the runner is invoked outside regular-trading-hours or spans the 4 PM boundary.
**Severity:** HIGH.

### F3 — Daylight-saving timing bug in intraday fetch
**Where:** `strategy_runner.py:3106`, `3115`
**Issue:** `today = datetime.now(timezone.utc).strftime("%Y-%m-%d")` combined with `start=f"{today}T13:30:00Z"` hard-codes UTC 13:30 as session start. That equals 9:30 AM ET only during EDT (March-November); during EST (November-March) NYSE opens at UTC 14:30. During EST the query misses the first hour of the session — exactly when the high-information opening VWAP is forming.
**Impact:** 4+ months per year the "intraday VWAP" starts an hour late, flattening the opening-impulse information.
**Severity:** HIGH.

### F4 — UTC "today" vs ET "today"
**Where:** `strategy_runner.py:3106`
**Issue:** `datetime.now(timezone.utc)` used to compute `today`. Between 8 PM ET and midnight ET the UTC date is already "tomorrow" — but the US markets are closed. Runner invoked then will request bars for a date with no data.
**Impact:** Empty bars → silent fallback to daily proxy. Low-severity in practice but a correctness smell.
**Severity:** LOW.

### F5 — Mean-reversion and trend-extension conflated
**Where:** `vwap_strategy.py:316-337`
**Issue:** Two signals with opposite underlying regimes fire in the same framework:
- Bounce (line 317): trade WITH trend, price near mean (reversion-style entry).
- Upper band breakout (line 332): trade WITH trend, price extended 2σ from mean (trend-extension entry).
A stock oscillating around VWAP will produce bounces; a stock ripping in one direction will produce breakouts. Without a dominant-regime filter the strategy is effectively "fire whenever price is above SMA20," which is a weak momentum filter, not VWAP.
**Impact:** Correlation with a vanilla 20-SMA momentum filter will be high; claimed alpha over momentum is near-zero.
**Severity:** HIGH.

### F6 — "VWAP reclaim" uses daily closes across sessions
**Where:** `vwap_strategy.py:340`
**Issue:** The reclaim trigger is `closes[-2] < vwap and closes[-1] > vwap` — but `closes` are DAILY bars. A textbook "reclaim" event is an intraday crossover. On daily bars this becomes "yesterday closed below the 20-day VWAMA, today closed above it" — a degenerate SMA crossover.
**Impact:** Another signal whose label does not match the logic.
**Severity:** MEDIUM.

### F7 — Bounce stop is 5 bps below VWAP
**Where:** `vwap_strategy.py:413`, `strategy_runner.py:3386`
**Issue:** `stop_loss = vwap * 0.995` is 50 bps below VWAP, not 5 bps. Still tight for a daily-bar strategy where single-day ATR on a $2B-cap stock is often 1.5-3%. Combined with a 0.3% bounce threshold (line 317, BOUNCE_THRESHOLD_PCT), the entire entry-to-stop distance can be as small as 0.2% + 0.5% = 0.7%. For a 2:1 RR target that's a 1.4% move — any 3-bp spread + 2-bp commission + half-spread slippage = ~4 bps roundtrip = ~6% of the target gone before market impact. For cheaper names, up to 20%.
**Impact:** Edge survives only if win-rate × average-win structure beats the transaction-cost toll. Not modeled.
**Severity:** HIGH (cost realism).

### F8 — Adaptive sizing based on repeated tests amplifies curve-fit
**Where:** `vwap_strategy.py:206-207`, `425-431`; `strategy_runner.py:3395-3409`
**Issue:** Positions up-sized 1.25× on 2nd test, 1.50× on 3rd test. The counting method in the runner (line 3397-3401) simply tallies the last 10 daily bars with `low` within 0.5% of current VWAP and close above. This is a chop-rewarding counter — the *more* the stock has wobbled around the 20-day VWAMA recently, the *more* size the strategy commits. That is the opposite of what a real "proven support level" looks like (which usually has 2-3 touches spread over a longer window with declining volatility between them).
**Impact:** Size increase on choppy, pinning-to-mean stocks is exactly the condition where breakdown risk is elevated (consolidation → breakout, direction TBD). Up-sizing into higher-variance regime.
**Severity:** HIGH.

### F9 — No shorts, no symmetry
**Where:** `vwap_strategy.py:389` (`if not analysis.get("uptrend", False): return None`)
**Issue:** The strategy is strictly long-only: the uptrend filter (`price > sma20`) is mandatory. A genuine VWAP framework is symmetric — "price below VWAP = short bias." Not even a "below-VWAP-in-downtrend" short module is scaffolded in.
**Impact:** Performance is fully correlated with SPY beta. Zero crisis alpha.
**Severity:** MEDIUM (design choice, but contradicts the "institutional benchmark" framing which is bidirectional).

### F10 — No backtest evidence
**Where:** `big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md`
**Issue:** All three result/report files contain **zero** occurrences of "vwap" (case-insensitive grep returns no matches). This strategy has not been backtested in-house, and has no documented Sharpe, drawdown, win-rate, or sample-size numbers.
**Impact:** Users see "status: ACTIVE" (`strategies.py:381`) and an "institutional benchmark" pitch (`strategy-content.ts:547`) while the team has no measured evidence the strategy works. The promised "75% historical win rate" style claim from sister strategies (e.g. RSI-2 at `strategies.py:315`) is absent here — nothing is promised, nothing is proven.
**Severity:** CRITICAL.

### F11 — Score constants are unfalsifiable magic numbers
**Where:** `vwap_strategy.py:317-352`, `strategy_runner.py:3345-3382`
**Issue:** +10 for vol confirm, +8 for candle, +5 for slope, +5 for alignment, +3 for anchored, −10 for falling slope. None of these weights are calibrated to any backtested edge. They are hand-picked. When the final score must clear 40 to fire, a stack of +5 bumps can push a marginal setup into the firing range — classic in-sample overfitting without an in-sample.
**Impact:** Opaque signal — 60 points from the bonuses vs. a 45-base for "close to VWAP." Meaning of "score 70" vs. "score 85" is undefined.
**Severity:** MEDIUM.

### F12 — Anchored VWAP anchor is weak
**Where:** `vwap_strategy.py:155-184` (`_find_anchor_index`)
**Issue:** Anchor candidates: (a) volume > 3× 20-day avg OR (b) close above prior 20-bar high with volume > 1.5× avg. The loop iterates from `n-5` backward (not the most-recent event but close). The "earnings" anchor is just a volume spike — no earnings calendar check. A dividend payout, an index reconstitution, a fat-finger print can all trigger this. Furthermore the anchor-confirmation bonus (line 351) is only +3 points and only contributes if price > anchored VWAP — a trivial condition in an uptrend filter.
**Impact:** "Anchored VWAP" feature is decorative; adds implementation complexity for minimal signal contribution.
**Severity:** LOW.

### F13 — Candlestick confirmation on daily bars
**Where:** `vwap_strategy.py:105-133`, `299-307`
**Issue:** Hammer/engulfing detection from daily OHLC. In modern US liquid large-caps (the stated universe), daily candles print 1-3% bodies and ATR-driven shadows; "hammer" on a daily candle is 5× weaker a signal than on a 5-min intraday candle near VWAP. In the runner's fallback path (`strategy_runner.py:3336-3339`), the daily hammer detection uses `closes[-2]` as "open proxy" — which is wrong (open is not prior close on days with overnight gaps). This is explicitly noted in the code as a proxy but is used for signal anyway.
**Impact:** Score bumps fire on noise. The "candle confirmation" adds +8 points, enough to push a borderline 42-score setup into a 50-point conviction.
**Severity:** MEDIUM.

### F14 — Weekly VWAP is just 5-day VWAMA, not weekly
**Where:** `vwap_strategy.py:275-284`, `strategy_runner.py:3305-3313`
**Issue:** "Weekly VWAP" is computed as a 5-trading-day volume-weighted typical-price average (line 277 `weekly_window = min(len(closes), 5)`). That is not a weekly VWAP — a weekly VWAP anchors at Monday's open and runs through Friday's close on weekly-resampled bars. The construct here is just a shorter window of the same daily-proxy VWAMA.
**Impact:** "Multi-timeframe VWAP alignment" (`strategy_runner.py:3305`) is misleading labeling; the two "timeframes" are both daily with different lookback lengths (20 and 5). They are ~95% correlated, so "alignment" is nearly always true in any uptrend.
**Severity:** MEDIUM.

### F15 — No commission/slippage modeling
**Where:** `vwap_strategy.py` (entire file), `strategy_runner.py:3411-3431` (rationale does not include cost estimate)
**Issue:** No transaction-cost model anywhere. 2:1 RR on a ≤1% risk-per-share is within the ±10-30 bps band where commission (Alpaca commission-free but PFOF/spread still ~1-3 bps) + effective half-spread (1-5 bps on ≤$2B caps) + market impact (0-5 bps) can consume 10-40% of the expected edge.
**Impact:** Any backtest without costs will materially overstate live performance. The strategy ships with no cost analysis and no pre-trade cost floor.
**Severity:** HIGH.

### F16 — UI/marketing cites research not implemented
**Where:** `strategy-content.ts:547`, `vwap_strategy.py:16-19`
**Issue:** "Berkowitz, Logue & Noser 1988" — that paper is about transaction-cost measurement, not directional alpha strategies. Citing it as support for a bounce/breakout entry system is a misattribution. "Madhavan (2002) VWAP Strategies" is a trade-execution-algorithm paper, not a directional alpha paper. Retail users reading the frontend thesis will conclude these strategies are backed by institutional academic research — they are not.
**Impact:** Misleading claims on a production UI.
**Severity:** MEDIUM (compliance / representation).

---

## Five-Year (2019-2024) Assessment

**Regime sensitivity:**
- 2019 (trending, low-vol): long-only bounce setups would grind profits; modest Sharpe.
- 2020 Q1 (COVID crash): long-only breakouts destroyed; no short module; "VWAP support lost" exits would chain-fire during gaps; expect −10 to −20% drawdown on strategy NAV.
- 2020 Q2-2021 (trend bull): best regime for this strategy; bounce logic works, breakout piggybacks; Sharpe 0.6-1.0 before costs.
- 2022 (trend bear): long-only dies; endless fake bounces; expect negative Sharpe or forced pause.
- 2023-2024 (mega-cap trending bull): tight stops get run by overnight gaps on mega-caps; modest positive Sharpe.

**Honest expected net Sharpe (liquid large-caps, 2-bps per leg costs):** 0.0 to 0.3. Given the 6 stacked score bonuses, in-sample fit will show ~0.4-0.6 but OOS will underperform.

**Capacity:** With 1M-share ADV filter and 1.2%-risk sizing, strategy capacity is modest — maybe $50-200M NAV before spread-impact degrades results.

**Crisis behavior:** Severely negative. Long-only, no regime filter beyond 20-SMA, tight stops get gapped through. 2020 Q1 / 2022 reenactment would produce >15% drawdown.

**Transaction-cost sensitivity:** Extreme. A 1.2% bounce target with 0.5% stop implies breakeven win-rate ~35%. Every 5 bps of roundtrip cost pushes breakeven +2-3%. At 30 bps roundtrip (realistic for sub-$5B caps with large orders), breakeven ≈ 55%. Unrealistic.

---

## Score: **28 / 100**

### Breakdown

| Dimension | Points | Max | Notes |
|---|---|---|---|
| Thesis alignment with code | 2 | 15 | Marketing cites Berkowitz/Madhavan; code implements retail daily-bar SMA proxy. F1, F2, F16. |
| VWAP computation correctness | 3 | 15 | No session reset; DST-buggy UTC anchor; daily-bar fallback is not VWAP. F1, F2, F3, F4, F6, F14. |
| Signal design (internal consistency) | 2 | 10 | Bounce + breakout + reclaim stacked without regime selection. F5, F6. |
| Risk/exit structure | 4 | 10 | Stops/targets defined, but extremely tight and cost-blind. F7, F15. |
| Sizing logic | 3 | 10 | Adaptive sizing rewards chop (F8); no vol-targeting; long-only (F9). |
| Universe/liquidity filters | 5 | 10 | Market-cap and avg-vol filters exist; no spread/ATR/dollar-volume. |
| Backtest & evidence | 0 | 15 | Zero backtest artifacts. No in-house Sharpe/drawdown/win-rate. F10. |
| Parameter calibration | 2 | 10 | All weights are magic numbers; no calibration trail. F11, F12, F13. |
| Production/UX integrity | 7 | 5 | API routes wired, status persisted in Redis, Alpaca sync works (capped at 5). |
| **Total** | **28** | **100** | |

(The production-UX row caps at 5; the extra 2 points credit the otherwise-solid plumbing in `strategies.py` and `trade_ledger` integration — but that discipline exposes how thin the actual strategy is.)

**Verdict:** Ship-blocker for anyone treating this as an "institutional VWAP" strategy. Acceptable as a labeled, backtested, daily-timeframe "20-day volume-weighted mean pullback filter" with a rewritten thesis, costs modeled, short side enabled, and regime filter added. Current state: marketing substantially outruns implementation.

---

## Recommended remediation (in priority order)

1. **Relabel** — Either commit to true intraday session-VWAP (fix F2, F3, F4, drop daily fallback) or relabel the daily path as "20-day VWMA Pullback" and remove the institutional/academic framing.
2. **Backtest** — 10-year OOS, 2-bps per-leg costs, spread by market-cap tier, regime-split (bull/bear/chop), sample ≥500 trades. Publish result to `STRATEGY_RESEARCH_REPORT.md`. Until then, status should be BACKTEST, not ACTIVE.
3. **Pick one signal** — Either bounce (mean-reversion flavor) or breakout (trend-extension), not both concurrently. Or add a regime switch and document the split.
4. **Fix F3 (DST)** — Use `zoneinfo("America/New_York")` and compute session open as a market-calendar call.
5. **Cost floor gate** — Refuse trades where expected edge < 3× roundtrip cost.
6. **Symmetry** — Mirror the long module to shorts for below-VWAP-in-downtrend setups (or document why not).
7. **Replace magic constants** — Calibrate +5/+8/+10 score bumps via regression on backtest data or collapse into one explicit filter stack.
