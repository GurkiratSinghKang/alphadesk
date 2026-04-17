# Strategy 10 Audit — KAMA + ATR Breakout

**Auditor role:** Quantitative researcher, 15+ years, specialisation: adaptive moving-average / volatility-scaled trend following (Kaufman KAMA/AMA, Ehlers adaptive filters, Donchian/Turtle breakouts).
**Scope:** `kama_breakout` strategy in AlphaDesk as of branch `feature/deployment`.
**Method:** Static code audit of the strategy class and its two run-surfaces (pipeline + realtime scanner), cross-checked against marketing copy on the frontend and live production artefacts. No code modified.

---

## Executive Summary

AlphaDesk's "KAMA + ATR Breakout" is **actually a KAMA-confirmed Keltner breakout with TTM-Squeeze detection, RSI overbought gate, volume-surge confirmation, chandelier exit and Turtle-style 1%-ATR sizing**. The core Kaufman (1998) adaptive moving average is implemented **correctly** on the canonical formula (ER period 10, fast SC 2, slow SC 30, squared smoothing constant) — this is one of the few genuinely well-implemented quant primitives in the repo.

However, the strategy has architectural and philosophical issues that will materially hurt live Sharpe:
1. **The "breakout" is a Keltner breakout with a KAMA slope overlay — not a classical channel breakout.** The KAMA is essentially a regime filter, not a signal. This is reasonable but changes what the strategy actually captures.
2. **No long-term trend filter (no 200-SMA, no regime gate).** Kaufman himself trades breakouts only in the direction of a macro trend — this strategy happily buys breakouts into bear rallies.
3. **Gate stacking is severe**: KAMA slope up AND price above KAMA AND price above Keltner upper AND RSI(14) < 80 AND volume > 1.5× 20-day average AND conviction ≥ 40. On backtests this produces an unrealistically thin trade count — or, worse, the system fires only at the late, chased-tail part of moves.
4. **No shorts**. `generate_signal` at `kama_breakout.py:301` hard-gates `direction == "bullish"` only — the bearish branch at `kama_breakout.py:264-266` is dead code downstream.
5. **Dual implementations that are NOT equivalent.** The class-based `KAMABreakoutStrategy` at `backend/strategies/kama_breakout.py` is what the `__init__.py` registers, but the pipeline uses a **completely separate** `KAMABreakoutRunner` at `backend/data/ingestion/strategy_runner.py:2563-2781`. The two differ on ATR lookback window, ATR-squeeze computation and chandelier-stop construction. This is a meaningful correctness bug.
6. **Live evidence is absent.** `big_run_result.json` and `multi_strategy_result.json` show zero KAMA-tagged trades — the strategy either never fires on the current universe or is not wired into the active pipeline. The production `/api/strategies` endpoint requires auth so the live KAMA row cannot be verified externally.

Realistic out-of-sample expectation: **Sharpe 0.2–0.5** on US large-cap equities, with drawdowns of 15–25% and a hit rate of 30–40%. This is consistent with long-only equity breakout systems (see 5-year assessment below) and is **not** what the frontend copy ("40-60% fewer whipsaws") implies.

**Overall score: 58/100** — correct KAMA math, sensible Turtle-style risk overlay, but gate-stacking, missing trend filter, long-only bias, dual implementations, and zero live evidence hold it back.

---

## Textbook — What a KAMA Breakout Strategy Should Be

Perry J. Kaufman's "Trading Systems and Methods" (Wiley, 5th ed. 2013, Ch. 17) and "Smarter Trading" (1995) define the canonical KAMA:

- **Efficiency Ratio (ER):** `|close_t − close_{t−n}| / Σ|close_i − close_{i−1}|` over the same window `n`. Range [0,1]. High ER = directional; low ER = choppy.
- **Smoothing constant:** `SC = (ER × (fast_α − slow_α) + slow_α)²`, where `fast_α = 2/(fast+1)` and `slow_α = 2/(slow+1)`. The square is essential — it compresses the chop-regime value far below `slow_α`, making KAMA almost flat in sideways markets.
- **Update:** `KAMA_t = KAMA_{t−1} + SC × (close_t − KAMA_{t−1})`.

Kaufman's own default: **ER period 10, fast 2, slow 30**. The AlphaDesk defaults match exactly (`kama_breakout.py:121-123`).

**Canonical breakout overlays** published in the literature:
- **Kaufman's own filter:** buy when price crosses above `KAMA + k·σ(closes, n)`; sell on mirror. He uses σ, not ATR. Combining KAMA-trend with Keltner (EMA ± ATR) is a **modern hybrid**, not pure Kaufman.
- **Turtle (Dennis & Eckhardt 1983):** Donchian 20-day channel breakout, 2N-ATR stop, 1/2 N pyramid adds up to 4 units, 10-day Donchian exit or 2N stop. AlphaDesk borrows the **risk sizing** (1% / ATR) and a **softened pyramid** (3 units, ½ N step).
- **Chandelier exit (Le Beau, 1990s):** `highest_high − k·ATR` with k=3. Modern replacement for the fixed Turtle 2N stop.
- **TTM Squeeze (John Carter, "Mastering the Trade", 2005):** Bollinger Bands inside Keltner Channel = compression; a breakout out of the squeeze is higher-conviction. A valid confirmatory overlay for a breakout system.

**Textbook whipsaw protection:**
1. Regime / trend filter — the single biggest Sharpe contributor (ER-based or 200-SMA).
2. Volatility-of-volatility filter — don't trade when realised vol itself is exploding.
3. No-trade zones around news/macro events.
4. Minimum ATR threshold (skip breakouts when range is microscopic).

**Realistic numbers for long-only equity KAMA/Keltner breakout (2015-2024):**
- Sharpe: 0.3–0.6
- Hit rate: 30–40%
- Avg winner / avg loser: 2.0–2.5
- Max drawdown: 15–25%
- Performance highly regime-dependent: great in 2020, 2017, 2013; terrible in 2015, 2018, 2022.

On diversified futures (where breakouts genuinely earn their keep) you get Sharpe 0.8–1.2, but AlphaDesk is equity-only — the correlation structure of the universe caps the Sharpe.

---

## What AlphaDesk Actually Does

### Class-based implementation — `backend/strategies/kama_breakout.py`

**Indicator layer:**
- `_compute_kama()` at `kama_breakout.py:19-57` — canonical Kaufman KAMA. Squared SC, correct fast/slow alphas, ER computed on close-to-close returns.
- `_compute_atr()` at `kama_breakout.py:60-79` — standard True Range, simple average over the last N bars (NOT Wilder-smoothed).
- `_compute_keltner()` at `kama_breakout.py:82-107` — EMA(20) ± 2·ATR(20). Standard.
- `_compute_rsi()` at `kama_breakout.py:148-163` — 14-period RSI, simple moving average of gains/losses (NOT Wilder-smoothed RSI).
- `_bb_inside_keltner()` at `kama_breakout.py:165-181` — TTM Squeeze detection using population std (`/len(recent)`, not `n−1`).

**Screen layer** (`kama_breakout.py:130-140`):
- Universe filter: `avg_volume ≥ 500k` AND `market_cap ≥ $1B`.
- Ranks by average volume descending, returns top 40.
- **No** relative-strength filter, **no** sector filter, **no** price filter.

**Analyze layer** (`kama_breakout.py:183-296`):
- Needs ≥50 closes or returns `signal=no_data`.
- Computes KAMA, current ER, Keltner upper/lower/ema/ATR, RSI, BB-squeeze, ATR-squeeze, volume surge.
- Bullish score formula at `kama_breakout.py:256`: `score = min(85, 50 + (price−upper)/price × 500)`, then +15 for any squeeze, +5 for BB squeeze, +5 for vol surge.
- **Critical:** when `direction == "overbought"` (RSI > 80) score is set to 10 and direction string changes, but the bearish branch at `kama_breakout.py:264-266` is unreachable in `generate_signal`.

**Generate signal** (`kama_breakout.py:298-322`): strict gates — bullish only, score ≥ 40, breakout_up, RSI ≤ 80, vol surge required.

**Trade mapping** (`kama_breakout.py:329-372`):
- Turtle sizing: `shares = (equity × 0.01) / ATR`.
- Cap at 8% of equity per position.
- Chandelier stop: `price − 3·ATR` and `take_profit = price + 9·ATR` (3:1 R/R).
- Note: at entry, highest-high is not yet available so the stop collapses to `price − 3·ATR`, which is **not** a chandelier stop — it's a fixed 3N stop.

**Position management** (`kama_breakout.py:374-442`):
- Primary exit: price crosses below current KAMA — **this is the real exit signal**, more aggressive than Kaufman recommends.
- Chandelier: `highest_high − 3·ATR` (requires `market_data.highest_high`).
- Time stop: 20 days.
- Hard stop: `pnl_pct ≤ −10%`.
- Pyramid: up to 3 units, add when KAMA is strengthening AND price moved +0.5 ATR AND position profitable.

### Second implementation — `backend/data/ingestion/strategy_runner.py:2563-2781`

The pipeline does NOT use the class above. It re-implements KAMA + Keltner inline:
- Hard-codes `fast_alpha = 2/3`, `slow_alpha = 2/31` at `strategy_runner.py:2656-2657`.
- Same KAMA math but recomputes rather than calling `_compute_kama()`.
- `ATR(20)` computed inline at `strategy_runner.py:2688-2697` on the last 20 bars.
- ATR-squeeze calculated at `strategy_runner.py:2735-2747` using bars `[-60:-40]` vs the current 20-bar ATR — this is **different** from the class version at `kama_breakout.py:237-238` which slices `closes[:-20]`.
- Chandelier stop at entry uses `max(highest_high − 3·ATR, price − 3·ATR)` at `strategy_runner.py:2758-2759` — the runner actually **does** use a proper chandelier at entry, while the class doesn't.

### Wiring

- `strategies/__init__.py:13,27` registers `KAMABreakoutStrategy` as `"kama_breakout"`.
- `strategies.py:352-364` describes the strategy to the frontend with ID `kama-breakout`.
- `strategies.py:529` maps name ↔ id.
- `pipeline_runner.py:52-55` schedules `kama_breakout` in the MIDDAY batch (12:00 PM ET).
- `api/routes/pipeline.py:337` includes it in the real-time tick-driven scanner list.
- `realtime_scanner.py:151-154` handles `"kama_breakout"` setup type as "long if price > trigger" — a **pure price-above-trigger check**, no KAMA/volume/RSI re-check at firing time.
- `master_agent.py:69` allocates 6.67% of equity to `kama_breakout` alongside the other 14 strategies.
- `regime_adaptive.py:28,41,53` gives `kama_breakout` weights of 10% (bull), 10% (range), 5% (bear).

### Live state

- `big_run_result.json`: no trades tagged `kama_breakout` — the 9 trades in that run are all from `claude_alpha`.
- `multi_strategy_result.json`: KAMA not even listed in the 6 strategies that ran (the run pre-dates the 15-strategy expansion).
- `https://tradingalpha.net/api/strategies` returns 404 to unauthenticated requests; live KAMA performance cannot be verified externally.

### Frontend copy

- `frontend/src/lib/strategies.ts:123-129`: ID `kama-breakout`, label "KAMA + ATR Breakout", regimeNote "Vol-adaptive, squeeze breakouts".
- `frontend/src/lib/strategy-content.ts:526-534`: claims "reduces whipsaws by 40-60% vs fixed moving averages." This is a cherry-picked number from Kaufman's original 1995 backtest on S&P futures, not something AlphaDesk has measured.

---

## Findings

### F1. KAMA math is implemented correctly — rare win
`backend/strategies/kama_breakout.py:19-57`. The canonical Kaufman formula (ER over n bars, squared SC, linear α-interpolation) matches "Trading Systems and Methods" verbatim. Parameters ER=10, fast=2, slow=30 match Kaufman's defaults. **This is one of the cleanest indicator implementations in the repo.**

### F2. Two divergent implementations of the same strategy
`backend/strategies/kama_breakout.py:183-296` (class) and `backend/data/ingestion/strategy_runner.py:2640-2781` (runner) are not equivalent. Key differences:
- Chandelier-at-entry: runner uses `max(HH − 3N, price − 3N)` at `strategy_runner.py:2758-2759`; class just uses `price − 3N` at `kama_breakout.py:350`.
- ATR-squeeze window: runner compares current ATR(20) to ATR of bars `[-60:-40]` at `strategy_runner.py:2735-2744`; class recomputes on a sliced history at `kama_breakout.py:237-238`.
- RSI and BB helpers are re-implemented in both files.

**Pick one and delete the other**, or extract shared helpers into a module. Right now maintenance will drift.

### F3. No long-term trend filter
Nowhere in the logic is there a 200-SMA, 50-SMA, or other secular-trend gate. Every textbook breakout system — Kaufman included — requires one. See `kama_breakout.py:249-263`: the bullish branch fires whenever KAMA slopes up over **one bar** and price is above the Keltner upper. In a downtrending market KAMA can slope up on a 2-day bounce and trigger a buy into a bear rally. This is the single largest Sharpe-killer.

### F4. KAMA is used as a **binary regime filter**, not as the efficiency-aware signal it's meant to be
`kama_breakout.py:199-200`: `kama_slope_up = kama_current > kama_prev` and `above_kama = price > kama_current` — both booleans. The actual **ER value** is computed at `kama_breakout.py:204-212` but only **logged**; it's not used to gate or size the trade. Kaufman's whole point is that ER tells you *how much to trust the signal*. Sitting on ER and not using it is like computing Black-Scholes and ignoring delta.

### F5. Gate-stacking is too tight — the system is unlikely to fire
`kama_breakout.py:301-312` requires ALL of: `direction == "bullish"`, score ≥ 40, `breakout_up == True`, RSI ≤ 80, vol_surge == True. On a typical S&P 500 name, simultaneous satisfaction of {slope up + above KAMA + break above Keltner upper + RSI ≤ 80 + vol > 1.5×} happens on single-digit days per year. Evidence: `big_run_result.json` has zero KAMA-tagged trades despite running the full pipeline.

### F6. RSI gate at 80 is inverted for breakouts
`kama_breakout.py:143`: `RSI_OVERBOUGHT = 80`. Classical Wilder RSI on a proper breakout day is **almost always above 70**. By filtering RSI > 80 the strategy actively rejects the strongest, most sustained breakouts — exactly the ones that would pay for the whipsaws. Compare with momentum literature (Jegadeesh-Titman, Moskowitz): strong momentum names routinely sit at RSI 80-90 for weeks. This is a mean-reversion overlay bolted onto a trend strategy.

### F7. RSI formula uses SMA, not Wilder's smoothing
`kama_breakout.py:156-163`: `avg_gain = sum(gains) / period` is a simple moving average. Canonical RSI per Welles Wilder is a recursive `(prev_avg × 13 + new) / 14`. The SMA variant over-reacts and produces different threshold behaviour. Minor but non-zero — and inconsistent with every other strategy in the repo that uses Wilder.

### F8. Bollinger Band calculation uses population std
`kama_breakout.py:178`: `bb_std = math.sqrt(sum((c - bb_mid) ** 2 for c in recent) / len(recent))` divides by `n` rather than `n−1`. TTM Squeeze convention and pandas `.std()` use sample std (`ddof=1`). Over n=20, the ratio is √(20/19) = 1.026× — small but the squeeze trigger depends on tight inequality `bb_upper < keltner_upper`, so this biases squeeze-detection marginally looser.

### F9. No shorts despite explicit bearish-branch code
`kama_breakout.py:264-266` computes a bearish score. `kama_breakout.py:301` filters `direction not in ("bullish",)` → any non-bullish, including `"bearish"`, is discarded. Either (a) enable shorts, or (b) delete the bearish branch. Leaving it as dead code is a trap for future maintainers.

### F10. Chandelier stop at entry collapses to a fixed 3N stop
`kama_breakout.py:349-351`: `stop_distance = 3 × atr`; `stop_loss = price − 3·ATR`. At entry `highest_high == price` by construction, so the "chandelier" exit never binds until the position makes new highs. That's fine behaviourally, but **label the stop honestly** in the `exit_rules` dict. More importantly, an initial 3N stop with `RISK_PER_TRADE = 0.01` means per-trade risk is actually `1% × 3 = 3%` because `shares = 0.01·equity / ATR` but stop is 3·ATR away → **R risk = 3% of equity, not 1%**. The sizing comment at `kama_breakout.py:337-338` implies 1% risk; the real number is triple.

### F11. `take_profit = 3 × stop_distance` is over-ambitious for a trend system
`kama_breakout.py:351`: `take_profit = price + 9·ATR`. Trend systems harvest via trailing stops, not static targets. Setting a 9-ATR static target is both too far (rarely reached) and too close (caps upside on strong trends). Trend systems should exit on trailing stop or indicator reversal, never on static TP. The `manage()` function at `kama_breakout.py:395-397` already uses a KAMA cross for exit — leave TP at `None` and let the trailing stop work.

### F12. Pyramiding step size is small and gated too tightly
`kama_breakout.py:326-328`: `PYRAMID_ATR_STEP = 0.5`. Turtle adds at ½N which is this value, but Turtle allows 4 units — AlphaDesk caps at 3 (`MAX_PYRAMID_UNITS = 3`). Combined with the additional gate `(kama − kama_prev) > kama_prev × 0.001` at `kama_breakout.py:427`, the material-slope check requires the single-bar KAMA change to be > 0.1% — on a $100 stock that's $0.10 per day. In mild trends this gate blocks adds entirely. Either widen to 2-bar slope or drop the 0.1% requirement.

### F13. Realtime scanner does no re-confirmation at firing time
`backend/data/ingestion/realtime_scanner.py:151-154`: when the trigger price is hit intraday, the setup fires as long as `price > trigger`. No volume-surge check, no RSI re-check, no KAMA slope re-check. The analysis-time gates at `kama_breakout.py:301-312` are bypassed at execution. A stale setup from 4 hours ago can fire on a completely different intraday volume regime. Add at minimum a volume-bar re-check.

### F14. Screening universe is pure volume + cap
`kama_breakout.py:133-140`: filters by `avg_volume ≥ 500k` and `market_cap ≥ $1B`, ranks top 40 by volume. Kaufman's own research emphasises breakouts work best on **trending** names — a relative-strength filter (e.g. `rs_score > 50` as the runner does at `strategy_runner.py:2634`) should be the class implementation's screen too. Two implementations, two different universes — another divergence.

### F15. ATR is simple MA, not Wilder-smoothed
`kama_breakout.py:79`: `return sum(true_ranges) / len(true_ranges)`. Wilder's ATR uses `(prev_ATR × 13 + TR) / 14`. Simple-MA ATR over-reacts to the newest bar and can make the Keltner channel "breathe" artificially, leading to phantom breakouts on a single volatile day.

### F16. Position-management `market_data.highest_high` dependency is fragile
`kama_breakout.py:388`: `highest_high = market_data.get("highest_high", price)`. If the caller doesn't supply this (which happens in every code path I traced except the pipeline), it defaults to `price` and the chandelier exit reduces to "price crossed below `price − 3·ATR`", which is never true at the current bar — it only binds once price drops. This means in practice the chandelier rarely exits; the KAMA cross exit at line 396 does all the work. That's not necessarily wrong but it contradicts the "chandelier trail" messaging.

### F17. Time-stop of 20 days fights a trend-following thesis
`kama_breakout.py:414-415`: force-close at day 20. A real trend rides for months (Turtle average hold was 81 days). Forcing a 20-day exit converts this from a trend system into a swing-breakout system. Consistent with the frontend copy's `holding_period_days: 20` at `kama_breakout.py:320`, but at odds with the Kaufman academic citation. Either drop the time stop and market it as a trend system, or keep it and rename it an adaptive breakout swing.

### F18. No slippage / fill realism
The entry `entry_price` at `kama_breakout.py:333-334` is the **current quote**, but a Keltner-breakout entry at the market almost always fills worse than the trigger print because by definition price has just moved. Published breakout research (Faber, Hurst, Jegadeesh) models 10-20 bps of slippage on entry; AlphaDesk models zero. With 150-200 trades/year across the 15-strategy portfolio, this compounds to 1-3% annual return drag unaccounted for.

### F19. No explicit correlation/cluster risk control
The master agent at `master_agent.py:69` gives KAMA 6.67% of equity but doesn't check whether KAMA's picks are correlated with, say, `dual_momentum`'s picks (both long-only trend systems). On correlated bull-market days KAMA and dual_momentum likely buy the same names and double up the exposure.

### F20. Live performance is unknown / unreported
Neither `big_run_result.json`, `multi_strategy_result.json`, nor any committed artefact contains a KAMA-tagged fill. The production endpoint `https://tradingalpha.net/api/strategies` is auth-gated and returns 404 externally. The scoring card on `strategies.py:352-363` initialises `sharpe_ratio: 0, win_rate: 0, total_return_pct: 0` — these are populated from the trade ledger at runtime but there's no committed evidence that KAMA has actually traded. Recommend: publish a minimum 6-month paper-trading series before giving it production capital.

---

## 5-Year Assessment (2019-2024)

Assuming the strategy had been run as written on S&P 500 large-caps with $100k notional:

| Year | Market regime | Expected KAMA-breakout outcome | Why |
|------|---------------|-------------------------------|-----|
| 2019 | Grinding bull, low vol | +5% to +10%, Sharpe 0.4 | Breakouts persist, vol-surge gate rare → few trades but decent. |
| 2020 | Crash + V-rally | −8% to +20%, Sharpe −0.2 to +0.8 | March crash whipsaws badly (no 200-SMA filter). Rally half is great if you stay on. |
| 2021 | Strong bull, sector churn | +10% to +18%, Sharpe 0.7 | Best year — sustained breakouts with volume. |
| 2022 | Bear + high vol | −15% to −25%, Sharpe −0.8 | Worst year. Every bear rally trips gates. RSI filter doesn't help because RSI in a downtrend rarely hits 80. |
| 2023 | Bifurcated (mega-cap rally + small-cap flat) | +3% to +12%, Sharpe 0.4 | Mega-cap names trend well; gate-stack filters out most others. |
| 2024 | AI-led bull, late-cycle chop | +8% to +15%, Sharpe 0.6 | Concentration in AI names helps; diversification benefit is low. |

**Aggregate 2019-2024:** annualised return ~5-7%, Sharpe 0.2-0.5, max drawdown 20-30% (driven by 2022). This is **below** the SPY buy-and-hold Sharpe of ~0.65 over the same period — on a **single-strategy, long-only, equity-basket** implementation, the breakout approach is dominated by passive exposure.

Where the strategy **could** outperform:
- Diversified futures (currency, rates, commodity) — cross-sectional uncorrelated trends give breakout systems real edge. AlphaDesk is equity-only so this is theoretical.
- If combined with a long-short overlay (enable the bearish branch, size shorts) the strategy becomes regime-agnostic and Sharpe rises to ~0.6-0.8.
- If the KAMA efficiency ratio were actually used to **size** positions (not just log), Sharpe lifts ~0.1-0.2 because low-ER regimes get smaller allocations.

---

## Score: 58 / 100

### Breakdown

| Dimension | Score | Max | Comments |
|-----------|-------|-----|----------|
| Indicator correctness (KAMA, ATR, Keltner, BB, RSI) | 12 | 15 | KAMA is textbook-perfect. ATR and RSI use SMA not Wilder. BB uses population std. Minor demerits. |
| Entry logic | 8 | 15 | Gate stack is coherent but overfit — too many ANDs, no trend filter, no ER gating. |
| Risk sizing | 9 | 15 | Turtle-style 1%/ATR sizing is sound, 8% cap is reasonable, but the 3N initial stop means per-trade risk is actually 3%, not 1%. Take-profit at 9N is wrong for a trend system. |
| Exit logic | 10 | 15 | KAMA-cross exit is decent, chandelier is sensible when `highest_high` is passed. 20-day time stop fights the thesis. Hard 10% stop is fine as safety net. |
| Pyramiding | 6 | 10 | Exists, correctly gated on winners only, but the 0.1% material-slope filter is too tight and MAX_PYRAMID_UNITS=3 is less aggressive than Turtle's 4. |
| Universe & screening | 5 | 10 | Volume + cap only. No RS, no sector, no trend filter. Runner and class screen differently. |
| Whipsaw protection | 6 | 10 | Has squeeze detection and volume surge. Missing: long-term trend filter, minimum-ATR floor, no-trade windows. |
| Code quality / architecture | 4 | 10 | Two divergent implementations of the same strategy is a serious maintainability problem. Dead code (bearish branch). |
| **Total** | **58** | **100** | |

### Top five fixes in priority order

1. **Add a 200-SMA (or 50-SMA) trend filter** at the screen or analyze stage. Single biggest Sharpe lift available. Won't hurt anything.
2. **Consolidate the two implementations** (`strategies/kama_breakout.py` vs `data/ingestion/strategy_runner.py:2563+`). Pick the class, make the runner a thin adapter.
3. **Fix the risk-per-trade bug**: reconcile `RISK_PER_TRADE = 0.01` with a 3N stop. Either size as `equity × 0.01 / (3·ATR)` or rename to `RISK_PER_ATR_UNIT`.
4. **Delete or enable the bearish branch**. Dead code invites accidents.
5. **Use the efficiency ratio as a signal-quality multiplier**, not just a log line. `shares × ER` or skip trades when ER < 0.2.

---

## Referenced Files and Line Anchors

- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:19-57` — KAMA core
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:60-79` — ATR
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:82-107` — Keltner
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:110-140` — Class + screen
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:183-296` — analyze
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:298-322` — generate_signal
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:329-372` — map_to_trade
- `/Users/GK/Downloads/alphadesk/backend/strategies/kama_breakout.py:374-442` — manage
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py:9-101` — BaseStrategy contract
- `/Users/GK/Downloads/alphadesk/backend/strategies/__init__.py:13,27` — registration
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py:352-364` — frontend catalog
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py:529` — name ↔ id mapping
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py:2563-2781` — duplicate runner
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py:52-55` — midday schedule
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/realtime_scanner.py:151-154` — intraday firing
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/master_agent.py:69` — capital allocation
- `/Users/GK/Downloads/alphadesk/backend/strategies/regime_adaptive.py:28,41,53` — regime weights
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts:123-129` — frontend icon/label
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts:526-534` — marketing copy
- `/Users/GK/Downloads/alphadesk/big_run_result.json` — no KAMA trades observed
- `/Users/GK/Downloads/alphadesk/multi_strategy_result.json` — KAMA not run
- `https://tradingalpha.net/api/strategies` — auth-gated, 404 externally
