# Expert Audit — `momentum_quality` Strategy

**Reviewer:** Quant academic / JT-AFP-Piotroski lens
**Scope:** Live-trading readiness of `backend.strategies.momentum_quality`
**Date:** 2026-04-18
**Files audited:**
- `backend/strategies/momentum_quality/{spec.md,strategy.py,helpers.py,config.py}`
- `backend/strategies/momentum_quality/tests/test_strategy.py`
- `backend/data/providers/fmp_fundamentals.py::piotroski_f`
- `backend/backtest/{engine.py,execution.py,walkforward.py,metrics.py}`
- `backend/data/oos/phase1-momentum_quality-oos.json`
- `audit-reports/{strategies-logic-audit-r5.md, strategies-audit-r3.md, phase1-momentum_quality.md}`
- `scripts/{tune_momentum_quality.py, momentum_quality_oos_eval.py}`

---

## Paper conformance

### Jegadeesh–Titman (1993) — 12-1 month momentum
**Canonical:** for month t, signal = return from t−12 to t−2 (~11 months of return ending 1 month ago). In trading-day terms: `r = P_{t−21} / P_{t−252} − 1`, span ≈ 231 trading days.

**Code (`strategy.py:367-378`):**
```
end_val   = series.iloc[-(skip_days+1)]   # P_{t−21} when skip_m=1
start_idx = -(lookback_days + skip_days + 1) = -274
start_val = series.iloc[-274]             # P_{t−273}
r_mom     = end_val / start_val − 1
```

With defaults `momentum_lookback_m=12, momentum_skip_m=1`:
`end=P_{t−21}, start=P_{t−273}` → window spans **252 trading days (~12 months of return, ending 21 days ago)**.

**Deviation:** The code implements "12-month return ending 1 month ago" (252-day span), **not** the JT-canonical "11-month return ending 1 month ago" (231-day span). This is commonly called **"12-1" in loose textbook usage** and what AQR / Asness-Frazzini-Pedersen actually compute — but it is NOT the strict JT construction. **Minor deviation, not a bug** — but the spec's math in §3.2 is internally consistent with this wider window.

**Tuner picked `momentum_skip_m=0`** (Lehmann skip disabled), so OOS actually uses a 252-day plain 12-month return to t. This **drops the one-month reversal overlay** — a textbook-departure the spec admits (§2 interpretation).

### Asness–Frazzini–Pedersen (QMJ, 2014/2019) — Quality composite
**Canonical QMJ:** the four-pillar composite `(profitability + growth + safety + payout)` with z-scored ranks inside each pillar, summed cross-sectionally.

**Code:** Uses **Piotroski F-score only** as the quality signal. QMJ's growth/safety/payout components are **absent**. Spec §9 discloses this substitution honestly.

**Deviation:** Significant — this is "Piotroski-only quality," not AFP QMJ. The Sharpe uplift AFP documents (Table III: ~0.2 Sharpe added to mom) is built on the 4-pillar composite, not F-score alone. Using F-score as a proxy is defensible (F-score correlates with the profitability pillar), but **claiming "QMJ convention"** in docstrings (strategy.py:99) overstates the paper conformance.

### Daniel–Moskowitz (2016) — Momentum Crashes / bear-market switch
**Canonical:** Momentum exhibits conditional left-tail skewness in bear-market rebounds (2009, 1932). The paper proposes a dynamic-weighted "momentum" factor that shrinks exposure when the `bear × high-vol` regime is active.

**Code:** No bear-market switch. No ex-ante crash hedge. The spec names Daniel-Moskowitz in §2 citations but §9 explicitly drops Barroso-Santa-Clara vol-scaling in favour of the `momentum_filter_min` floor.

**Deviation:** The "absolute-momentum floor" (tuned to 5.4% in OOS) is a **static** filter, not a conditional one. It will not protect against a 2009-style rebound where the winners portfolio is short-squeezed on previously-crashed losers. On a long-only top-decile book this is partially mitigated (no short side to squeeze), but the 2022 rotation drawdown risk remains.

### Piotroski (2000) F-score
**Canonical:** 9-signal composite: 4 profitability (NI>0, CFO>0, ΔROA+, CFO>NI) + 3 leverage/liquidity (ΔLev−, ΔCR+, no issuance) + 2 efficiency (ΔGM+, ΔAT+). Score in [0, 9].

**Code (`fmp_fundamentals.py:73-144`):** All 9 signals implemented and correctly named. Point-in-time via `filingDate ≤ asof` filter (line 42). **Match: ✓**.

**Threshold:** Paper uses F ≥ 7 ("winners zone") for the long portfolio. Default config uses `min_f_score=5`; tuner pushed it to **7** for OOS — matching the canonical Piotroski long-side threshold.

---

## Walk-forward hygiene

### Look-ahead bias — signal timing
The engine's `generate_signals(t)` is called after `manage(t)` and after MTM. Signals emit MOO orders which in `ExecutionSimulator._try_fill` (execution.py:211) require `bar.ts > order.staged_on`, so MOO fills at T+1 open. **No same-bar leakage for MOO. ✓**

`panel[panel.index <= pd.Timestamp(asof, tz="UTC")]` (strategy.py:256) correctly truncates the panel at `asof`. `_compute_momentum` uses `series.iloc[-1]` which is the `asof` close. **Decision uses close[T], fill on open[T+1]. ✓**

### LOOK-AHEAD BUG — `_drop_halted_symbols` uses future data
**File:** `helpers.py:107-140`
**Mechanism:**
- `_get_close_panel` (strategy.py:316-317) fetches `end = asof + 400 calendar days`.
- `fetch_close_panel` (helpers.py:93-94) runs `ffill()` over the FULL fetched window, then calls `_drop_halted_symbols(wide)`.
- `_drop_halted_symbols` takes `wide.tail(HALT_THRESHOLD_BARS + 1)` — the LAST 6 BARS of the entire fetched window, which is **~400 days after `asof`**.
- Halt decision for rebalance at `asof=2023-01-31` is made based on bars near `2024-03-06` (future relative to asof).

**Impact on current OOS metrics:** ZERO, because the 46-name mega-cap universe has no halts in 2023-2024 (no BBBY, SIVB, FRC equivalents). But the fix in Wave 23 that claimed "halt detection via ffill" is logically flawed — it is inspecting **future tape** to decide present eligibility. If this strategy is ever pointed at a broader universe (e.g. Russell 2000) or a window containing halts, symbols that will halt later are **pre-emptively excluded from all prior rebalances** — a textbook look-ahead.

**Severity: P0 for any universe change; P2 for the frozen 46-name list.**
**Fix:** Slice `wide.loc[:pd.Timestamp(asof, tz="UTC")].tail(HALT_THRESHOLD_BARS + 1)` before checking flatness.

### Survivorship bias
**Universe (config.py:57-74):** Fixed 52-name seed list → 48 eligible names after exclusions. Hand-curated from today's S&P 500 mega-caps.

**Key names in the list:** AAPL, MSFT, NVDA, META, TSLA, GOOGL, GOOG — all of which were **already dominant going into 2023**. 2020-era bankruptcies or 2022-era losers (e.g. Peloton, Zoom, Beyond Meat) are absent. 2020-2024 delistings are not represented.

**Severity: P1 — acknowledged in spec §8 note 1 and r3 audit.** This is the single largest inflator of the 2.21 Sharpe. A point-in-time SP500 constituent set would likely halve it.

### Data snooping — tuner on train, Sharpe reported on test
**Train/test split:** 2019-01-01 → 2022-12-31 train; 2023-01-02 → 2024-12-30 test. The split is clean on paper.

**But:** `tune_momentum_quality.py:86-110` monkey-patches `run_train_test` to **skip the IS backtest entirely** and only runs the OOS leg for every trial. The Optuna objective is reading OOS Sharpe **directly as the fitness function**. This means:

> **The OOS window is the optimization objective.** Every trial of TPE is scored on 2023-2024. The reported "best OOS Sharpe" is **tautological** — the tuner by construction returns the params that maximize it.

This is a **profound walk-forward hygiene violation**. The honest workflow is: optimize on train (2019-2022), then freeze params and evaluate ONCE on test. The current setup optimizes on test and reports test — there is no true out-of-sample.

**Severity: P0 for interpreting the 2.21 number.** The tune JSON itself (`best_oos_sharpe: 2.185` on trial 8 of 25) is a ranked-order-statistic inflator: picking the best of 25 trials selects for noise even against a mean-zero backbone.

**Fix:** Use raw Sharpe on TRAIN as the objective; evaluate OOS after the tuner finishes without feeding the result back.

### Rebalance timing
**Decision:** last trading session T of month.
**Order type:** MOO (Market On Open) → fills at open of T+1.
**Cost model:** 5 bps spread + commission; no ADV-based market-impact.
**Verdict:** ✓ correct. MOO T+1 is consistent with AQR/MSCI monthly rebalance convention.

---

## OOS metrics reality check

From `backend/data/oos/phase1-momentum_quality-oos.json`:

| Metric | Value | Plausible? |
|---|---:|---|
| Sharpe | 2.21 | **Suspicious** — target was 0.80; published long-only 12-1 mom Sharpe 0.6–0.9 |
| Sortino | 2.03 | Consistent with Sharpe 2.21 |
| Max DD | 8.01% | Unusually shallow for 2-year mom book; 2022 regime was excluded from OOS |
| CAGR | 36.2% | High — driven by NVDA/META/AAPL 2023-24 rally |
| Hit rate | 77.5% | High; mom strategies typically 52-60% at monthly cadence |
| Profit factor | 3.73 | High |
| Turnover | 14.88 cumulative (~7.4×/yr) | Consistent with monthly top-15 rotation |
| Alpha | 0.0 | **Not computed** — oos_eval.py does not pass `benchmark=` to EngineConfig |
| Beta | 0.0 | Same — not computed |
| Round-trip trades | 138 | Statistical: 138 trades yield Sharpe SE ≈ 1 / √138 × √252 ≈ 1.35 → **one SE on the reported 2.21 is ±1.35**. With 24 rebalances × 5-7 rotations = 138, the statistical significance of Sharpe=2.21 vs. 0.80 is not strong. |

**Train/test date separation:** test window 2023-01-02 → 2024-12-30 is crisply after 2022-12-31 train end. But per the hygiene section above, the tuner optimized ON the test window, so the separation is nominal only.

**In-sample bleed:** YES. The train range (2019-2022) contains COVID (03/2020) and the 2022 tech selloff — two of the exact "momentum crash" regimes the strategy should be tested on. These are **in the training window, not the test window**. The OOS sits entirely inside a monotone tech rally (2023-24 NVDA +500%, META +450%). The chosen test window excludes the cases where the strategy's robustness matters most.

**Verdict:** 2.21 Sharpe is largely regime-driven + tuner-on-test + survivorship-biased universe. A forward Sharpe estimate for this exact code on a random 2-year window including bear phases: ~0.5-0.8, consistent with the spec's original 0.80 target.

---

## Concrete bugs beyond Wave 23

Wave 23 claimed fixes: SECTOR_MAP includes GOOG/TSLA/META/NFLX (confirmed: 52 seeds vs 52 sector entries, eligible = 48); halt detection via `ffill`; earnings-cache window.

**Remaining issues:**

### [P0-conditional] Halt detection uses future data (see hygiene section)
**File:** `helpers.py:107-140`. Fires wrong on any universe containing 2023-2024 halts. Currently dormant for the mega-cap seed list. Fix: slice wide to `<= asof` before tailing.

### [P1] Tuner optimizes on test window (see hygiene section)
**File:** `scripts/tune_momentum_quality.py:86-110`. Monkey-patch skips IS backtest; objective reads OOS metrics as fitness. Reported 2.21 Sharpe is selection-biased. Fix: tune on train Sharpe, evaluate on test once.

### [P1] Piotroski-only F-score sold as "QMJ"
**Files:** `strategy.py:99,102` docstring; spec.md §9. The quality leg is Piotroski F-score, not AFP QMJ composite. Docstrings and comments call the exclusions "QMJ convention" — correct for the exclude-list but misleading about the composite signal. Fix: downgrade language to "Piotroski-style quality composite with AFP-style sector exclusions".

### [P1] OOS-eval script doesn't pass benchmark → alpha/beta=0
**File:** `scripts/momentum_quality_oos_eval.py:79-90`. No `benchmark=` argument → metrics.summary_dict writes `alpha=0.0, beta=0.0` which are in the reported OOS JSON. Fix: pass `benchmark="SPY"` AND prefetch SPY into the InMemoryBarProvider (currently absent from UNIVERSE_SEED).

### [P2] `_compute_momentum` uses "12-month window ending 1 month ago" (252-day span), not strict JT "11 months ending 1 month ago" (231-day span)
Described in the paper-conformance section. Common industry practice; spec math internally consistent. Cosmetic.

### [P2] F-score ns cache across concurrent tuner trials
**File:** `helpers.py:162-201`. `cache_of(ctx)` is per-context; trials build fresh contexts → no cross-contamination. OK.

### [P2] `earnings_blocked` upper-cases returned symbols but eligible_syms aren't explicitly uppercased
**File:** `helpers.py:221-231`. The seed UNIVERSE_SEED is already upper-case and FMP returns upper-case, so the `s not in blocked` set lookup works. Fragile if universe ever mixes case; fix with `.upper()` normalization on the match side too. Cosmetic.

### [P2] `momentum_skip_m=0` in OOS winning params
Tuner disabled the Lehmann 1-month reversal skip. This is both a **parameter choice** (the spec permits it via search space `{0,1}`) and a **deviation from JT canonical**. The r3 audit flagged this. Document clearly in user-facing UI so retail users know "JT with Lehmann skip OFF".

---

## Verdict

**NEEDS_DISCLOSURE** — not ready for unhedged live deployment at the reported 2.21 Sharpe; code is otherwise live-tradable with caveats.

### Caveats a user must see before committing real money

1. **Headline Sharpe 2.21 is not a forward expectation.** The tuner was pointed at the OOS window; ranked best-of-25 on test; benchmark-aware alpha/beta not computed; universe is a 2026-visibility selection frozen over 2019-2024. A realistic forward Sharpe range for this code on a random forward 2-year window: **0.4 – 1.0**, centred on the 0.80 spec target.

2. **Optimization objective runs on the evaluation window** (`tune_momentum_quality.py`). The OOS number is selection-biased by construction. This is disclosed in spec §8 note 6 ("walk-forward is a single train/test split") but the single-split IS leg is **skipped entirely** by the tuner monkey-patch.

3. **Universe is survivorship-biased** (48 mega-caps visible in 2026, held frozen across 2019-2024). 2019-era S&P 500 membership included names (e.g. WRK, MXIM, ALXN) that were delisted; none are penalized in this backtest.

4. **The "QMJ" claim overstates paper conformance.** Quality = Piotroski F-score only, not AFP 4-pillar composite. The sector exclusions follow QMJ convention; the composite signal does not.

5. **Halt-detection logic is broken for non-trivial universes.** `_drop_halted_symbols` peeks at the last 6 bars of the fetched panel, which extends 400 days into the future relative to each rebalance. Dormant on the mega-cap seed list; would catastrophically mis-exclude names on a broader universe (look-ahead bias → inflated apparent Sharpe).

6. **No bear-market / crash-hedge switch (Daniel-Moskowitz 2016).** The `momentum_filter_min=5.4%` floor is a static filter, not the dynamic regime-aware overlay the paper motivates. On a 2009-style rebound, long-only top-decile momentum is known to suffer a 30-50% drawdown in weeks.

7. **No sector-neutrality at selection.** 2023-2024 top-15 was ~70% tech-weighted (NVDA/META/AAPL/MSFT/AMZN). A tech sell-off would drop peak-to-trough in correlation > 0.8.

8. **Lehmann skip disabled.** Tuner chose `momentum_skip_m=0` — a real but defensible drift from canonical JT 1993. On windows where the 1-month reversal re-emerges (as in 1993-2015), the OOS number degrades.

---

## 400-word summary

The `momentum_quality` strategy ships the textbook long-only cross-sectional factor: 12-1 month momentum rank × Piotroski F-score rank, composite-weighted, top-N equal-weighted, monthly MOO rebalance on a fixed ~48-name mega-cap universe ex-Financials/Utilities. The core math (`_compute_momentum`, `rank_01`, `piotroski_f`) is correct and point-in-time. Wave 23 fixed the SECTOR_MAP gap (all 52 seed names have sector entries) and added halt detection, so the strategy exits the prior-audit trap of silently shrinking the universe.

Three issues prevent a clean READY_FOR_LIVE verdict.

**First, the tuner optimizes on the OOS window.** `scripts/tune_momentum_quality.py` monkey-patches `WalkForwardRunner.run_train_test` to skip the in-sample leg entirely; every Optuna trial scores on 2023-2024 test metrics. The reported 2.21 Sharpe is therefore the max-order statistic of 25 OOS fits — selection-biased against the true 0.80 spec target. The honest reported number would be in the 0.5-1.0 band on a fresh forward window.

**Second, the universe is survivorship-biased.** The 52-name seed is a 2026-visibility selection frozen across 2019-2024, hand-curated to exclude delisted and under-performing S&P 500 members. 2023-2024 mega-cap winners (NVDA +500%, META +450%) dominate; bankruptcies are absent. This inflates both CAGR (36%) and Sharpe (2.21) vs. a point-in-time constituent set.

**Third, halt-detection (`_drop_halted_symbols`) uses future data.** It inspects the last 6 bars of the panel window, which extends 400 calendar days past `asof`. Dormant on the current mega-cap universe (no halts) but a silent P0 look-ahead if the universe is ever broadened. Fix: truncate the panel to `<= asof` before checking trailing flatness.

Lesser concerns: the "QMJ" branding overstates the quality leg (Piotroski F-score only, not AFP's 4-pillar composite); no Daniel-Moskowitz bear-market switch; no sector neutrality; the benchmark is silently dropped from the OOS JSON (alpha/beta=0); Lehmann's 1-month skip was tuner-disabled (a real drift from JT canonical).

**Verdict: NEEDS_DISCLOSURE.** Code is live-tradable and correctly point-in-time for the signal math. Claims on the order of "we beat the target 2.7×" do not survive walk-forward scrutiny. With the tuner re-wired to optimize on train only, a point-in-time S&P 500 constituent set, and the halt-detection slice fixed, a forward Sharpe of 0.6-0.9 is achievable and publishable. The current OOS number should not appear in any user-facing UI without the caveats above.
