# Strategy 05 — Regime Adaptive

**Auditor:** Quant regime-switching specialist (15y, HMM / multi-regime allocators)
**Date:** 2026-04-17
**Code under audit:**
- `backend/strategies/regime_adaptive.py` (class `RegimeAdaptiveStrategy`)
- `backend/data/ingestion/strategy_runner.py:906-988` (class `RegimeAdaptiveRunner` — the one actually run)
- `backend/mcp_servers/ml_models/server.py:62-109` (HMM `detect_regime` tool)
- `backend/data/ingestion/master_agent.py:91-97, 188-197` (VIX-based P3 regime gate)
- `backend/api/routes/strategies.py:183-195` (UI description)
- `frontend/src/lib/strategy-content.ts:168-204` (marketing copy: "HMM Regime-Adaptive Allocation")
- `backend/data/pipeline_logs/2026-04-08/09/10.json` (live output)

---

## Executive Summary

AlphaDesk ships **two unrelated implementations** both named `regime_adaptive`, a marketing deck that describes neither of them, and a daily pipeline that actually runs the weaker of the two — and even that one is fed from a deterministic demo-data generator rather than live prices. The net result is a strategy that is effectively **a sector-rotation wrapper over synthetic stock scores** wearing an "HMM Regime-Adaptive Allocation" costume.

Specifically:

1. `backend/strategies/regime_adaptive.py` is a 222-line HMM-based meta-allocator that rotates weights across 9 sub-strategies by regime. It looks plausible but has **no walk-forward validation, no hysteresis, no cost model**, and its HMM input path is never populated in production (`cache_get("prices:SPY")` has no writer anywhere in the codebase).
2. `backend/data/ingestion/strategy_runner.py:910` — `RegimeAdaptiveRunner` — is what the daily pipeline actually executes (`daily_pipeline.py` imports `ALL_STRATEGIES` from `strategy_runner.py`). It contains **no regime detection at all**. It ranks sectors by the average `composite_score` of demo-generated stocks and buys the top stock from each of the top 3 sectors.
3. The frontend (`strategy-content.ts:168-204`) describes an elaborate HMM with "probability > 70% for 2 consecutive weeks", "3 of 5 macro indicators", "risk-parity 12% vol target", and "multi-asset universe (SPY/QQQ/TLT/GLD/VIX)". **None of that is implemented anywhere in the repo.**
4. Pipeline logs confirm: on 2026-04-08 (VIX=48.9, "crisis") the strategy still emitted two buy signals with conviction 80, both rejected downstream by unrelated guardrails. The regime never affected the strategy itself.

This is a brochure-driven strategy. The **Claude code reviews I'd give** are: the active runner is not a regime model, the dormant class is an untested theoretical sketch, and the production-facing description is science fiction relative to the code. Score: **18/100**.

---

## Textbook: What a regime-adaptive equity allocator should do

1. **Regime definition** — pick a *parsimonious* set of states (2-4). Common choices:
   - Hamilton (1989) 2-state return regime: low-vol-drift vs high-vol-drift.
   - Ang & Bekaert (2002) extended with volatility.
   - Guidolin & Timmermann (2007) 4-state with term structure.
   - Simpler rule-based: SPY 200-DMA + VIX level + yield-curve slope + breadth.

2. **Detection** — a mix of (a) a forward-HMM / EM-fit on features (returns, vol, credit spread, curve slope) OR (b) rule-based confirmed thresholds. Use **only past data at the decision point** (no lookahead via the Viterbi full-sample smoother).

3. **Hysteresis / confirmation** — add a 2-3 bar confirmation or probability-threshold (P(regime) > 0.7 sustained) **to prevent whipsaws**. Without hysteresis, HMM states flip monthly and transaction costs eat the edge.

4. **Allocation change** — smooth (blend by posterior probabilities) rather than binary. Binary flips compound with slippage.

5. **Transaction costs** — model explicitly. Regime flips are the biggest cost generator.

6. **Out-of-sample** — walk-forward estimated HMM. Parameters, feature set, and state labels must be frozen before each forward window.

7. **2019-2024 stress** — 2019 trend up, Feb-Mar 2020 crash, 2020-21 momentum, 2022 bear, 2023-24 AI rally. A decent regime model should identify at least 3 of these 4 transitions without hindsight. Realistic Sharpe for a **rule-based** regime overlay on US equity: **0.4-0.8**. HMM approaches that forget to avoid lookahead backtest at 1.5+ and live at 0.2 — a classic failure mode.

---

## What AlphaDesk Does

### Intended description (UI / marketing)
- `frontend/src/lib/strategy-content.ts:168-204`: 3-state HMM (bull/bear/sideways) on multi-timeframe momentum + credit spreads + yield-curve shape + breadth + cross-asset vol.
- Entry: regime probability > 70% for 2 consecutive weeks + 3 of 5 macro indicators.
- Universe: SPY, QQQ, IWM, XLx sectors, TLT, IEF, SHY, GLD, VIX products.
- Position sizing: risk-parity, 12% annualized vol target.
- 12-18 positions.

### Actual implementation A — `backend/strategies/regime_adaptive.py` (dormant)
- `RegimeAdaptiveStrategy` (line 10). Subclasses `BaseStrategy`.
- `screen()` (line 64) calls `_detect_regime()` (line 204) then loads static dict `REGIME_ALLOCATIONS` (line 23) mapping regime → weights across 9 internal sub-strategies.
- `_detect_regime()` (line 204-222): looks in Redis at `regime:current`; if absent, looks at `prices:SPY`; if 100+ closes available, calls `MLModelsServer.detect_regime(returns)` which runs a **Gaussian 3-state HMM with n_iter=100, full covariance, random_state=42** (`ml_models/server.py:77-83`).
- Else returns hardcoded default `{"current_regime": "neutral"}` (line 222).

### Actual implementation B — `backend/data/ingestion/strategy_runner.py:906-988` (active)
- `RegimeAdaptiveRunner` — what `daily_pipeline.py:29-30` imports via `ALL_STRATEGIES`.
- `screen()` (line 923): calls `_get_screener_results(limit=100)` (line 926) which **calls `_generate_demo_screener_results` directly** (`strategy_runner.py:165-191`).
- Groups synthetic `composite_score` by sector, averages, ranks.
- Picks the best-scoring stock from each of the top 3 sectors → 3 "overweight" buys, plus 5 hold entries. Line 958: returns `candidates[:8]`.
- `analyze()` (line 960): conviction = `50 + sector_avg * 0.3 + composite * 0.15` for top-3 sectors, capped at 85. No regime logic.
- Self-description (line 912): `"Regime-aware sector rotation — long top sectors, avoid weakest"`.

---

## Findings (F1 – F18)

### F1 — Two separate implementations, one is dead code
**Severity: Critical.**
`backend/strategies/__init__.py:8,22` registers `RegimeAdaptiveStrategy`. `backend/data/ingestion/daily_pipeline.py:29-30` imports `ALL_STRATEGIES` from `strategy_runner.py:3440-3461`, which registers the unrelated `RegimeAdaptiveRunner`. The only caller of `RegimeAdaptiveStrategy.screen()` in the codebase is its own unit tests (if any) and the `run_full_pipeline` method it inherits from `BaseStrategy` (`base.py:86`). Pipeline logs `backend/data/pipeline_logs/2026-04-{08,09,10}.json:183-239` confirm `RegimeAdaptiveRunner` is what actually ran.

### F2 — The active runner has zero regime detection
**Severity: Critical.**
`strategy_runner.py:923-958` (`RegimeAdaptiveRunner.screen`) contains no VIX check, no SPY-trend check, no HMM call, no yield curve, no breadth. It is pure cross-sectional sector-mean ranking. The class docstring "Regime-aware sector rotation" at line 912 is aspirational.

### F3 — The active runner is fed synthetic data
**Severity: Critical.**
`strategy_runner.py:165-191` (`_get_screener_results`) instantiates `ScreenRequest`, then explicitly calls `_generate_demo_screener_results(request)` on line 178. That function (`api/routes/screener.py:196-274`) uses `random.Random(_symbol_seed(ticker))` — every `composite_score` is a seeded random draw. There is no path from live prices to this function.

Consequence: the "top 3 sectors" chosen by this strategy on any day are **deterministic noise** seeded off symbol names. The same stocks (BA, WMT, etc.) appear as top picks on 2026-04-08, -09, -10 (see pipeline logs lines 211-239 in each file).

### F4 — The dormant HMM path has no data writer
**Severity: High.**
`regime_adaptive.py:208` `cache_get("regime:current")` and line 213 `cache_get("prices:SPY")`. A repo-wide grep for `cache_set("regime:current"` and `cache_set("prices:SPY"` returns **zero writers**. If the live path were ever selected, every invocation would fall through to the hardcoded default at line 222. The HMM in `ml_models/server.py:67-109` is never invoked in production.

### F5 — HMM fit uses Viterbi smoother (lookahead bias)
**Severity: High.**
`ml_models/server.py:85`: `states = model.predict(X)` runs `predict` on the full returns series, then `current_state = int(states[-1])` (line 86). Crucially, `GaussianHMM.predict` returns the **Viterbi sequence** which is re-estimated against the *entire* series including data *after* `states[-1]`. For live inference this is fine (because `-1` is the latest bar) **but for any backtest the same call leaks future information into past states**. There is no backtest harness in this repo, but if one is ever written using this function as-is it will produce a flattering Sharpe that does not translate live.

Additionally line 83 `model.fit(X)` fits the whole series *each call*, so regime definitions themselves drift as new bars arrive — there is no frozen-parameters walk-forward.

### F6 — No hysteresis, no confirmation buffer
**Severity: High.**
`RegimeAdaptiveStrategy._detect_regime` returns whatever the HMM says on the current bar. There is no "regime probability > 70% for 2 consecutive weeks" gate (despite the marketing copy at `strategy-content.ts:185` claiming exactly that). The class-level allocations (`regime_adaptive.py:23`) are a binary lookup with no blending by posterior probability — a bull→bear print flips all 9 sub-strategy weights instantly.

### F7 — Regime-shift exit rule is asymmetric and crude
**Severity: Medium.**
`regime_adaptive.py:184-192`: `regime_order = {"bull": 2, "neutral": 1, "bear": 0}`. If `current_rank < entry_rank - 1` → close; if `current_rank < entry_rank` → reduce 50%. This means:
- bull→neutral: reduce 50%
- bull→bear: close (one-step close only after a two-rank drop)
- neutral→bear: reduce 50% (never close)
- Upgrades (bear→bull) are never acted on — a bear-regime position just sits.

Real regime-switch books use symmetric probability-weighted resizing.

### F8 — Transaction costs not modeled
**Severity: High.**
`regime_adaptive.py:145-175` (`map_to_trade`) rescales `portfolio["equity"] * risk_mult` (line 156) and delegates to the source strategy. Neither this file, `strategy_runner.py:RegimeAdaptiveRunner`, nor `master_agent.py` subtract slippage or commissions on regime flips. A 3-state HMM on weekly SPY data with no hysteresis would flip 6-12 times/year, which at ~15 bps round-trip on a rebalance compounds to 1-2% drag — that number is never deducted.

### F9 — Hardcoded default regime returns favorable prior
**Severity: Medium.**
`regime_adaptive.py:222`: `{"current_regime": "neutral", "regime_probabilities": {"neutral": 0.6, "bull": 0.2, "bear": 0.2}}`. This is the value returned whenever data is missing — which is **always** in the current deployment (F4). The default being "neutral" with a 75% risk multiplier (line 60) means the strategy never takes the conservative (40%) bear posture even during verified crashes.

### F10 — Risk multiplier applied to perceived equity, not position size
**Severity: Medium.**
`regime_adaptive.py:155-156`: `"equity": portfolio.get("equity", 100_000) * risk_mult`. The delegate strategy sees a smaller portfolio and sizes against that, which is a reasonable proxy — but it means a single position may still take 2% of total portfolio while the *adjusted* portfolio thinks it's 5%. It also silently breaks correlation-based sizing inside any delegate that uses `portfolio["positions"]` for exposure netting.

### F11 — Sub-strategy weights sum > 1.0 and include duplicates
**Severity: Medium.**
`regime_adaptive.py:23-55`:
- bull: weights sum = 0.15+0.15+0.15+0.10+0.10+0.10+0.10+0.10+0.05 = **1.00** (OK)
- neutral: 0.15+0.15+0.15+0.15+0.10+0.10+0.10+0.10 = **1.00** (OK)
- bear: 0.25+0.20+0.15+0.15+0.10+0.05+0.05+0.05 = **1.00** (OK)

Weights sum correctly. However the under-0.05 gate at line 77 (`if weight < 0.05: continue`) excludes bear regime's last three entries on the boundary — an off-by-one that quietly zeros them in bear. (The code says `< 0.05` but those entries are `0.05` — so they pass. OK on re-read. Marking this finding as **resolved**; leaving for transparency.) **Resolved — no actual bug here, but the condition is fragile.**

### F12 — `bear` allocations are structurally long-biased
**Severity: Medium.**
`regime_adaptive.py:45-54`: even in bear, 75% of capital is in long-biased mean-reversion / VWAP / premium-selling / momentum sub-strategies. Only 25% goes to the market-neutral pairs book. None of it goes to cash, treasuries, or shorts. A bear allocation that's 75% long on `rsi2_reversal` (which buys oversold stocks when price > 200-SMA) will eat losing knife-catches in every sustained bear. The "crisis alpha" claim in `ts_momentum` would be achievable if the system shorted or went to cash, but `ts_momentum` at 10% weight is too small and its exit-to-cash happens only inside its own rules, not here.

### F13 — `REGIME_RISK_MULTIPLIER` at 0.40 in bear is effectively 30% cash
**Severity: Low.**
`regime_adaptive.py:58-62`. 40% of equity is an acceptable crisis deployment — matches the P3 bear cap at `master_agent.py:95` (0.30). However, applied *multiplicatively* on already-long sub-strategies, it means 40% of capital still goes long into a crash. The UI claim ("treasury duration, gold, and low-vol equities") at `strategy-content.ts:193` is not reflected in the code.

### F14 — VIX regime in master_agent is separate and actually effective
**Severity: Low (this is the one thing that works).**
`master_agent.py:91-97` `REGIME_DEPLOYMENT_LIMITS` and line 188 `_detect_regime()` — a **rule-based VIX-tier gate** (< 18 bull_low_vol, 18-25 bull_high_vol, 25-35 bear, > 35 crisis). Pipeline log `2026-04-08.json:195` shows it rejecting `regime_adaptive`'s AVGO trade at VIX 48.9 because deployment would exceed 10%. This is the only part of the system that actually does regime-based risk management in production — but it lives in the guardrail layer, **not** in the regime_adaptive strategy itself.

The VIX level passed in (`vix_level=16.5`, `master_agent.py:117`) is also a **default parameter**; whether the live caller supplies a real value depends on the pipeline call-site (`daily_pipeline.py` — which, in the 2026-04-08 log, did supply 48.9, so at least that day it worked).

### F15 — Weekly schedule claim vs. actual cadence
**Severity: Low.**
`pipeline_runner.py:73`: `WEEKLY_STRATEGIES = ["regime_adaptive", ...]` with Friday 3:30 PM rebalance claim. But `pipeline_runner.py:46`: `PREMARKET_STRATEGIES = ["pead", "claude_alpha", "regime_adaptive"]` — it's scheduled **daily at 6 AM** too. That's two run windows for a strategy described as weekly. Pipeline logs confirm daily runs on 04-08/09/10.

### F16 — Frontend description is fiction relative to code
**Severity: High (honesty/compliance).**
`frontend/src/lib/strategy-content.ts:168-204` promises: HMM with 70%-probability gate, multi-asset universe including treasuries/gold, risk-parity with 12% vol target, walk-forward validation, regularization. None of these appear in either implementation. The `api/routes/strategies.py:184-185` one-liner ("ML-based regime detection (bull/bear/sideways) combined with strategy rotation") is closer to accurate but still implies ML when the runner is sector-avg.

### F17 — HMM `n_iter=100, random_state=42` on every call
**Severity: Medium.**
`ml_models/server.py:80-82`. Each call refits the HMM from scratch. `n_iter=100` is low for EM to converge on noisy return series; `full` covariance on 1-D returns is overkill and wastes parameters. `random_state=42` makes each fit deterministic **for the same data**, but because the data grows each call, label permutations (which state index → bull/bear) can silently swap between consecutive calls even though line 90-91 attempts a means-based relabeling. There's no stability check on `regime_history` across calls.

### F18 — Composite score is noise, so sector rankings are noise
**Severity: Critical (compounds F3).**
`screener.py:206-216`: `rs_score = rng.uniform(20, 99)`, `f_score = rng.randint(3, 9)`, `iv_rank = rng.uniform(10, 90)`, `ml_score = rng.uniform(25, 95)`, composite = weighted sum. Sector average of these = noise. The "top 3 sectors" picked by `RegimeAdaptiveRunner.screen()` are whichever sectors happen to contain symbols whose md5 seeds draw higher. Reproducibly meaningless.

---

## 2019-2024 Assessment

On a 2019-2024 out-of-sample run, here is what the system as coded would do:

| Period | Regime | `RegimeAdaptiveRunner` behavior | `RegimeAdaptiveStrategy` behavior (if ever wired) |
|---|---|---|---|
| 2019 | Trend up | Seeded random sector picks. No adaptation. Buys demo names daily. | Default "neutral" (F4/F9). 75% deployed into neutral-regime weights (mean reversion + pairs + VRP). Misses bull tailwind. |
| Feb-Mar 2020 crash | Crisis | Still emits 2 buys/day. `master_agent.py` crisis cap (F14) limits deployment to 10%, but internal logic is unchanged. | Without a populated Redis regime, still "neutral". HMM would flag `bear` on day +5 or later (no hysteresis → late but not the latest), but without cash/short asset, 40% deployment goes into already-falling mean-reversion names. Drawdown likely -15 to -25%. |
| 2020-21 momentum | Bull | Same seeded noise. No bull boost. | `bull` weights finally activate IF Redis were populated. 70% momentum-weighted subs would track SPY + alpha. But: HMM with no hysteresis flips to neutral on any 5-day dip, whipsaws. |
| 2022 bear | Bear | Two buys/day, downstream gates reject on VIX>25. Net ~0 trades. | HMM flags bear. Still 75% long. Expected return ≈ SPY × 0.4 = ~-7% not -17%, so some protection — but only via the blanket risk-mult, not any short/cash leg. |
| 2023-24 AI rally | Bull | Same noise. | `bull` weights, but momentum_quality + ts_momentum + dual_momentum overlap heavily (70% of allocation). Same 3 Mag7 names, 3 weights — look-through concentration. |

**Realistic live Sharpe estimate:**
- `RegimeAdaptiveRunner` (active): Sharpe **≈ 0.0 ± 0.3**. It's noise. The guardrail layer happens to save it on crisis days, dragging the mean toward zero rather than deeply negative.
- `RegimeAdaptiveStrategy` (dormant) if wired with live SPY prices: Sharpe **0.1 – 0.4**, below the textbook 0.4-0.8 band for rule-based regime overlays because of no hysteresis (F6), lookahead-prone HMM call (F5), unmodeled costs (F8), and no bear-side hedge assets (F12, F13).

Nothing in this strategy would have survived 2008 as described.

---

## Score: 18/100

### Breakdown

| Category | Weight | Score | Rationale |
|---|---|---|---|
| Regime definition (is it sound?) | 15 | 4/15 | HMM with 3 states from log returns is defensible. Multi-feature claim in docs isn't implemented. |
| Detection method (lookahead risk, live data path) | 20 | 2/20 | F3, F4, F5. Active runner has no detection. Dormant one uses Viterbi-on-full-series and has no Redis writer. |
| Hysteresis / confirmation buffer | 10 | 0/10 | F6. None. |
| Allocation switching (smoothness, shorts/cash in bear) | 15 | 3/15 | Binary lookup, no posterior blending, bear allocation is 75% long. |
| Transaction cost model | 5 | 0/5 | F8. Not modeled. |
| Out-of-sample / walk-forward validation | 10 | 0/10 | No harness. HMM refit from scratch each call. |
| Engineering (correctness, no dead code) | 10 | 2/10 | F1-F2. Two unrelated impls, live one is demo-data-fed. |
| Honesty of public description | 10 | 1/10 | F16. Marketing copy describes a system that does not exist. |
| Risk guardrails downstream | 5 | 6/5 (capped 5) | F14. The only working regime logic lives in `master_agent.py`, not here. Credit given for the gate catching crisis-day trades. |

**Total: 18/100.**

The floor is held up by the master-agent VIX gate which partially rescues this strategy at runtime. The strategy as a standalone regime-adaptive allocator does not exist — it's either aspirational code (`regime_adaptive.py`) starved of inputs, or a sector-rotation stub (`RegimeAdaptiveRunner`) starved of real data.

---

## Highest-Impact Fixes (in priority order, cite file:line)

1. **Delete one implementation.** Decide whether `regime_adaptive` is the HMM meta-allocator (`regime_adaptive.py`) or the sector-rotator (`strategy_runner.py:910`). Remove the other. If keeping the HMM, register `RegimeAdaptiveStrategy` as the runner in `strategy_runner.py:3440` (`ALL_STRATEGIES`).
2. **Populate Redis regime cache or remove the branch.** Add a pipeline step that writes `cache_set("regime:current", ...)` weekly, else delete `regime_adaptive.py:208-210` and make the HMM path mandatory.
3. **Feed real prices.** Replace `_generate_demo_screener_results` call at `strategy_runner.py:178` with a live Alpaca path (the rest of the file already uses `_enrich_with_real_prices` — use the same pattern here).
4. **Add hysteresis.** Require 2 consecutive weekly observations of P(regime) > 0.70 in `regime_adaptive.py:204` before swapping `REGIME_ALLOCATIONS`.
5. **Freeze HMM parameters.** Move `GaussianHMM.fit` from per-call refit (`ml_models/server.py:83`) to a nightly training job that writes pickled params; `detect_regime` should load and predict only — no fit at inference.
6. **Model costs on flips.** Add a 15 bps haircut per rebalance in `map_to_trade` at `regime_adaptive.py:145`.
7. **Add bear-regime cash / treasuries.** `REGIME_ALLOCATIONS["bear"]` (line 45) should include at least 40% in a `cash_or_tlt` synthetic; today 100% is equity-long sub-strategies.
8. **Fix the frontend description** at `strategy-content.ts:168-204` to match the code, or implement the code to match the description.
9. **Backtest harness** that calls `detect_regime` on expanding windows with parameters frozen at each window start, not full-series Viterbi.
