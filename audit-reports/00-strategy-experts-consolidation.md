# Strategy Experts — Consolidation Report

**Date:** 2026-04-18
**Scope:** Consolidation of the 12 per-strategy expert audits (`expert-*.md`).
**Goal:** Decide which of AlphaDesk's 12 strategies are safe to flip from paper
to live trading, and enumerate the concrete code-level bugs that must be fixed
before the flip. We are explicitly **not** chasing published Sharpe targets —
this document ships honest fixes for concrete defects, not parameter tuning.

**Reading posture.** The 12 reports were written by agents role-playing as
domain experts (PEAD academic, VRP options trader, pairs stat-arb, etc.). Each
was tasked with distinguishing "concrete bug in the code / data / timing"
from "performance doesn't match a textbook number." This consolidation
preserves that distinction. Section 5 ("What's NOT a bug") lists the
criticisms we are explicitly de-scoping.

---

## 1. Verdict table

| # | Strategy | Verdict | Published / OOS Sharpe | Realistic forward Sharpe (expert estimate) | Sharpe gap | Blockers (P0) |
|---|---|---|---:|---:|---:|---:|
| 1 | `momentum_quality` | **NEEDS_DISCLOSURE** (PASS conditional) | 2.21 | 0.4 – 1.0 (centred ~0.8) | ~1.3 – 1.8 | 1 (conditional) |
| 2 | `pead` | **CONDITIONAL** | 1.32 | 0.6 – 0.9 | ~0.4 – 0.7 | 3 |
| 3 | `vrp_harvest` | **CONDITIONAL** (approved with reservations) | 0.876 | ~0.7 – 0.9 | minor | 1 |
| 4 | `earnings_vol` | **PASS** (ship) | 1.43 | 0.9 – 1.9 (CI ±0.5) | minor | 0 |
| 5 | `ts_momentum` | **PASS with asterisk** | 1.52 | 1.0 – 1.5 long-only, higher with shorts | acceptable | 0 (disclosure only) |
| 6 | `rsi2_reversal` | **PASS** | 1.88 | 0.5 – 0.8 per-unit-invested | deployment-inflated, not a bug | 0 |
| 7 | `pairs_trading` | **CONDITIONAL** | 1.23 | 0.4 – 0.8 post realistic costs | ~0.4 – 0.8 | 1 |
| 8 | `dual_momentum` | **PASS** | 1.26 – 1.34 | 0.7 – 0.9 | acceptable | 1 (artefact gap) |
| 9 | `regime_adaptive` | **PASS with caveats** | 1.62 | 0.5 – 0.9 | regime-driven, not a bug | 0 |
| 10 | `kama_breakout` | **PAPER-ONLY** (OOS reject) | 1.685 | 0.4 – 0.8 (7 trades, CI [0.2, 3.1]) | sample too small to claim | 0 code, 1 statistical |
| 11 | `orb` | **DISABLE** | 8.34 | 0.5 – 0.9 honest | ~7.5 | 3 structural |
| 12 | `vwap` | **PASS** (conditional) | 0.95 | 0.4 – 0.6 outside H1-24 | regime-driven | 0 |

**Totals:**
- **Ship ready (PASS / PASS conditional):** 8 strategies — `earnings_vol`,
  `ts_momentum`, `rsi2_reversal`, `dual_momentum`, `regime_adaptive`, `vwap`,
  `vrp_harvest` (with pin), `momentum_quality` (with disclosure).
- **Conditional on code fixes:** 2 strategies — `pead` (3 P0), `pairs_trading`
  (1 P0).
- **Paper-only (not ready for live capital):** 1 strategy — `kama_breakout`.
- **Disable outright:** 1 strategy — `orb`.

---

## 2. P0 bugs — MUST fix before live flip

These are concrete code-level defects. Each has a strategy, a 1-line
description, a file path hint from the expert report, and a proposed fix
approach. **No P0 is a "published Sharpe doesn't match" complaint** — all are
wrong code, wrong data, or a look-ahead / selection-bias defect.

### P0-1: `pead` — AMC vs BMO not distinguished; BMO reporters silently skipped

- **Strategy:** `pead`
- **Bug:** FMP's `/earnings-calendar` returns a `time` field (`"bmo"` / `"amc"`);
  `FMPEarningsProvider.calendar()` discards it. Current code anchors on
  `prev_session(asof)` and treats every announcement as AMC-on-D-1. For BMO
  reporters (~40-50% of S&P 500), the trade fires at D+1.open instead of
  D.open, losing the single biggest day of canonical drift.
- **Files:** `backend/strategies/pead/strategy.py:408-490`
  (`_yesterday_announcements`); `backend/data/providers/fmp_earnings.py:52-71`
  (`calendar()` drops `time` field).
- **Fix:** Parse FMP `time` into calendar frame as `announcement_when` column.
  In `_yesterday_announcements`, handle AMC and BMO rows distinctly; document
  which fraction of drift is captured per class.

### P0-2: `pead` — Universe is survivorship-biased (static 2024-era winners)

- **Strategy:** `pead`
- **Bug:** `UNIVERSE_SEED` is a 170-name hand-curated list that reads as a
  2024 S&P 500 cross-section (META, NVDA, CRWD, SNOW, PANW, DDOG all
  present; no names delisted during the 2023-24 backtest window). A L/S book
  on this universe inherits post-hoc selection on both legs.
- **File:** `backend/strategies/pead/config.py:54-98` (`UNIVERSE_SEED`).
- **Fix:** Replace the static seed with a point-in-time S&P 500 constituent
  loader via `ctx.calendar_provider` or a fundamentals provider. Acceptable
  Phase 2 work, but the OOS JSON must carry the bias flag until replaced.

### P0-3: `pead` — MOO gap-at-open slippage under-modelled on surprise days

- **Strategy:** `pead`
- **Bug:** Flat 5 bp half-spread applied uniformly at `execution.py`. Real
  post-announcement gap-open spread on 5σ-surprise mid-caps is 15-40 bp, and
  fills execute closer to first-5-minute VWAP than to NYSE opening print.
  Systematically understates transaction cost on the exact bars the strategy
  cares about.
- **Files:** `backend/backtest/execution.py:255-256` (MOO fills at `bar.open`
  with no event premium); `backend/backtest/costs.py:71,168-171`
  (`default_spread_pct=0.0005`).
- **Fix:** Event-conditional spread model, e.g.
  `spread_pct = 0.0005 + 0.0015 * 1{|SUE| >= 3}`, or per-symbol
  `spread_pct` passed into `fill_bar` from a realised-tape lookup.

### P0-4: `pairs_trading` — Raw-price spread instead of log-price spread

- **Strategy:** `pairs_trading`
- **Bug:** `strategy.py:555` computes `spread = df_trim["y"] - betas * df_trim["x"]`
  on raw closes. Spec §3.3 states log-prices are to be applied for the
  Engle-Granger path, and a config knob `prices_in_log_space` is documented
  in prose but not present in `DEFAULTS`. The code path never applies
  `np.log()`. On drifting levels this produces level-dependent
  heteroskedasticity in the "stationary" residual.
- **File:** `backend/strategies/pairs_trading/strategy.py:555`.
- **Fix:** Default to `np.log(y) - β·np.log(x)` for the OLS path; add
  `prices_in_log_space` to `DEFAULTS` with `True` as the default.

### P0-5: `orb` — Leveraged ETFs (TQQQ / SPXL) in tuner universe

- **Strategy:** `orb`
- **Bug:** OOS used `universe_profile=all_leveraged` (SPY, QQQ, TQQQ, SPXL).
  A long-only ORB in a window where 3× beta compounded +200-300% is capturing
  leveraged beta, not an opening-range-breakout edge. Compounds with (b) and
  (c) below to produce an 8.34 headline Sharpe.
- **File:** `backend/strategies/orb/config.py:26` (universe profile).
- **Fix:** Permanently remove TQQQ / SPXL from the search space; restrict to
  `['SPY','QQQ']`. Re-run OOS.

### P0-6: `orb` — `max_notional_pct=0.20` clips σ harder than μ

- **Strategy:** `orb`
- **Bug:** `max_notional_pct=0.20` caps position size independently of
  `risk_per_trade=0.014`. On TQQQ with OR ~2% of price, 1.4%-risk sizing
  calls for ~70% notional; the clip forces 20%. Clipping volatility harder
  than return is the canonical Sharpe-inflation lever; max-DD -0.45% and
  Sortino 44.5 confirm this is not a real return distribution.
- **File:** `backend/strategies/orb/config.py` (position-sizing knobs).
- **Fix:** Either remove `max_notional_pct` from the clip path or raise to
  100% so σ and μ clip identically.

### P0-7: `orb` — `volume_confirm_min=0.8622` disables the noise guard

- **Strategy:** `orb`
- **Bug:** Spec states the volume filter is "effectively disabled" below
  1.0. Tuner landed at 0.8622, turning off the confirmation gate on every
  breakout.
- **File:** `backend/strategies/orb/config.py` (tuner search space).
- **Fix:** Set `volume_confirm_min` lower bound to ≥ 1.0 in the tuner search
  space; re-run OOS.

### P0-8 (conditional): `momentum_quality` — `_drop_halted_symbols` uses future data

- **Strategy:** `momentum_quality`
- **Bug:** `fetch_close_panel` ffills over a ~400-calendar-day window that
  extends past `asof`, then `_drop_halted_symbols` takes the tail-6 bars of
  the panel to decide halt eligibility. Halt decision for a 2023-01-31
  rebalance is made on bars near 2024-03-06. Currently dormant on the
  mega-cap universe (no halts 2023-24), but a silent look-ahead on any
  broader universe.
- **Files:** `backend/strategies/momentum_quality/helpers.py:107-140`
  (`_drop_halted_symbols`); `strategy.py:316-317` (`_get_close_panel`);
  `helpers.py:93-94` (`fetch_close_panel`).
- **Fix:** Slice `wide.loc[:pd.Timestamp(asof, tz="UTC")].tail(HALT_THRESHOLD_BARS + 1)`
  before checking trailing flatness. Classified P0-conditional because the
  code is wrong but currently produces no measurable distortion on the
  frozen 46-name list.

### P0-9: `dual_momentum` — Missing OOS artefact JSON

- **Strategy:** `dual_momentum`
- **Bug:** `backend/data/oos/phase1-dual_momentum-oos.json` does not exist
  on disk. Every other Phase-1 strategy has its OOS JSON persisted. The
  phase1-dual_momentum.md report cites Sharpe 1.26 / 1.34 but there is no
  structured artefact to verify.
- **File:** `backend/data/oos/phase1-dual_momentum-oos.json` (missing).
- **Fix:** Re-run `scripts/tune_dual_momentum.py` (or the OOS-eval script)
  to materialise the JSON artefact. Evaluate defaults (not the tuned
  SPY/EFA/EEM + blend_126_252 variant).

### P0-10: `vrp_harvest` — Pin `tail_hedge_ratio ≥ 5` as non-tunable

- **Strategy:** `vrp_harvest`
- **Bug:** Optuna search space permits `tail_hedge_ratio=0` (no tail hedge),
  which produces an unhedged XIV-template strategy — the Feb-2018 blow-up
  profile. The spec flags the risk (spec.md:262-267) but does not hard-forbid
  it. If the tuner selects 0, the strategy is economically the 2018 failure
  template.
- **File:** `backend/strategies/vrp_harvest/config.py:91` (search space).
- **Fix:** Remove `tail_hedge_ratio=0` from the tuner search space; pin
  `tail_hedge_ratio ≥ 5` as a non-tunable invariant before live deployment.

---

**P0 count:** **10 concrete defects** — 3 on `pead`, 3 on `orb`, 1 each on
`pairs_trading`, `momentum_quality` (conditional), `dual_momentum`
(artefact regeneration), and `vrp_harvest` (search-space pin).

---

## 3. P1 bugs — SHOULD fix before scale

One-line each; lower severity than the P0 set, but still concrete.

- **`momentum_quality`** — Tuner optimizes on the OOS window
  (`tune_momentum_quality.py:86-110` monkey-patches `run_train_test` to skip
  the IS leg). Reported 2.21 Sharpe is tautological selection-on-test. Fix:
  use raw Sharpe on TRAIN as objective; evaluate OOS once.
- **`momentum_quality`** — OOS-eval script doesn't pass `benchmark="SPY"`, so
  alpha / beta silently report as 0.0 in the OOS JSON
  (`scripts/momentum_quality_oos_eval.py:79-90`).
- **`momentum_quality`** — Docstrings / spec §9 call the quality leg "QMJ
  convention" when it is Piotroski F-score only, not AFP's 4-pillar
  composite (`strategy.py:99,102`). Downgrade language to "Piotroski-style".
- **`pead`** — `trading_days_between` uses `pd.bdate_range` and ignores NYSE
  holidays; 40-session window with MLK+Presidents' Day closes at ~38 sessions
  (`backend/strategies/pead/helpers.py:351-361`). Route through
  `ctx.calendar_provider.sessions`.
- **`pead`** — `has_overlapping_earnings` cushion uses `int(round(h*7/5)) + 2`
  calendar days, overshooting by ~2 trading days past planned exit
  (`backend/strategies/pead/helpers.py:322-348`). Use
  `calendar_provider.sessions` directly.
- **`earnings_vol`** — `exit_timing="1h_after_open"` is executed as MOO by
  `_exit_order_type` (`strategy.py:1238-1245`) because the daily engine
  can't model intraday limits. Either implement intraday exit or drop the
  option from the search space and rename default to `"next_open"`.
- **`earnings_vol`** — Financials (JPM, GS, BAC, MS, WFC) report BMO but
  `_classify_earnings_time` defaults unknown `time` fields to `"after_close"`
  (`strategy.py:902-926`). Add per-sector or per-ticker override for
  financials.
- **`earnings_vol`** — `_wing_spread_too_wide` only checks wings; body
  (short-ATM) liquidity is unchecked (`strategy.py:1162-1191`). Add
  symmetric body check.
- **`ts_momentum`** — Tuner-chosen config runs long-only; the Moskowitz
  paper's core claim is crisis alpha *from shorts during equity drawdowns*.
  Either force `shorts_enabled=True`, re-tune on a window including 2008/2022
  bears, or rename honestly to "long-only trend-following on diversified ETFs".
- **`rsi2_reversal`** — `has_upcoming_earnings` horizon uses calendar-day
  arithmetic (`helpers.py:342`) rather than `pd.bdate_range`; `earnings_skip_days=3`
  actually covers 4-5 trading days. Tighten to explicit session math.
- **`pairs_trading`** — No KPSS counter-test on cointegration. Engle-Granger
  ADF alone is low-power on short windows. Add `statsmodels.tsa.stattools.kpss`
  and require ADF-reject AND KPSS-fail-to-reject.
- **`pairs_trading`** — Hurst gate lenient at `0.45`
  (`strategy.py:368`). Tighten to `0.40` for stronger mean-reversion selection.
- **`pairs_trading`** — Asymmetric regression direction (`all_within_sector_pairs`,
  `config.py:80-95`) fixes `y = alphabetically-first`. Run both orderings and
  take lower ADF p-value.
- **`dual_momentum`** — `excess_return_floor` search range `[-0.01, 0.02]`
  allows weakening Antonacci's absolute-momentum gate (`config.py:223`).
  Constrain to `[0.0, 0.02]`.
- **`dual_momentum`** — Tuner search space includes `blend_126_252` composite
  and `(SPY,EFA,EEM)` universe despite spec §5 calling out the first as
  curve-fit and the second as a non-GEM 3-asset variant. Mark both as
  diagnostic-only, not tunable to production config.
- **`vrp_harvest`** — Synthesised 5% bid/ask (`provider.py:224-225`) under-
  states transaction cost on 5Δ tail-hedge legs. Replace with Polygon Starter
  quote history or model-based spreads.
- **`vrp_harvest`** — `price_for_exit = abs(credit_per_spread)`
  (`strategy.py:498`) is a placeholder; actual crisis MTM debit will exceed
  this. Reported kill-switch exit P&L understates losses until a real fill
  anchors.
- **`vrp_harvest`** — No vega cap alongside theta target; gamma/vega are the
  blow-up vectors (`strategy.py:1028-1040`). Add explicit per-1-vol vega cap.
- **`regime_adaptive`** — Streak counter resets on any label change
  (`strategy.py:218-233`). A 1-day blip destroys 10 days of accumulation.
  Add soft-reset (decrement rather than reset to 1).
- **`kama_breakout`** — `trend_sma_period=100` tuned from `{100,150,200}` in
  a 2-year bull window; the report flags regime-risk. Retain default `200`
  until a 2019-2024 walk-forward confirms otherwise.
- **`vwap`** — Daily-engine execution shell on intraday signal: stop/TP
  levels anchored to T's VWAP are evaluated against T+1's daily bar
  high/low, where the intraday VWAP has reset. Documented limitation; 5-10 bp
  slippage vs a tick-level sim. Schedule intraday simulator upgrade.
- **`vwap`** — `min(bps_stop, atr_stop)` in code reads as "tighter stop"
  but the spec text says "wider stop" (`strategy.py:321-325`). Works by
  accident because both are lower bounds. Rename / clarify before anyone
  swaps stop direction.

---

## 4. Non-code actions

Actions that aren't code changes — disclosure copy, lockouts, kill-flags,
docs.

### Disclosure banners

- **`momentum_quality`** — Banner: "Headline Sharpe is tuner-on-test selection.
  Realistic forward Sharpe 0.4 – 1.0 on random 2-year window. Universe is a
  frozen 2026-visibility mega-cap list (survivorship-biased)."
- **`pead`** — Banner: "Static 170-name universe is 2024-era winners.
  Expected forward Sharpe 0.6 – 0.9 after universe / BMO / slippage fixes
  land."
- **`vrp_harvest`** — Banner: "Kill-switch exit paths are empirically
  untested; all OOS exits were DTE-rolls. Bid/ask spreads synthesised, not
  observed. Do not pass to live capital until at least one OOS window
  contains a genuine tail event."
- **`ts_momentum`** — Banner: "Ships long-only in the current config. Crisis
  alpha (short-leg during equity drawdowns) is architecturally available but
  switched off. Enable `shorts_enabled=True` only after explicit re-tune."
- **`orb`** — Banner: "OOS Sharpe 8.34 is not a real edge. Honest forward
  Sharpe for SPY/QQQ ORB 2023-24 is 0.5 – 0.9. Strategy is structurally
  unfit for live capital until three defects land."

### Hard lockouts / flags

- **`orb`** — Add to live-trading *deny*-list. Strategy visible in catalog
  with a NOT-READY warning; cannot be toggled on by a user.
- **`kama_breakout`** — Add to paper-only allowlist. Strategy visible, paper
  engine only, cannot route to live until ≥ 15-25 round-trip trades land on
  a 2019-2024 walk-forward with Sharpe ≥ 0.4 inside a block-bootstrap CI.
- **`vrp_harvest`** — Gate on `tail_hedge_ratio ≥ 5` at the strategy
  constructor; reject-and-log at engine start if config violates.

### OOS artefact regeneration

- **`dual_momentum`** — Re-emit `phase1-dual_momentum-oos.json` via the OOS
  eval script. Use defaults only (not tuned SPY/EFA/EEM variant).
- **`kama_breakout`** — Re-run `scripts/kama_oos_eval.py` over 2019-2024 to
  get statistically meaningful trade count (target ≥ 15-25).
- **`orb`** — Quarantine the existing `phase1-orb-oos.json`; it should not
  be published as a representative result. Rebuild after P0-5..7 fixes.

### Docs / spec updates

- **`momentum_quality`** — Downgrade "QMJ convention" language in spec §9
  and docstring to "Piotroski-style quality composite with AFP-style sector
  exclusions".
- **`pairs_trading`** — Add `prices_in_log_space` to `DEFAULTS` so the
  config surface matches the spec text.
- **`earnings_vol`** — Rename `exit_timing="1h_after_open"` to `"next_open"`
  in the search space so the config reflects actual engine behaviour.

---

## 5. What's NOT a bug

The reports flagged many cases where "the strategy does not earn the
published-paper Sharpe." We are explicitly *not* treating these as bugs.
Documented here to prevent scope creep.

- **`momentum_quality`** — The 252-day JT window (vs. canonical 231-day) is
  AQR/AFP industry practice, not a defect. The tuner-disabled Lehmann skip
  (`momentum_skip_m=0`) is a parameter choice, legitimately in the search
  space. No sector-neutrality / no Daniel-Moskowitz bear switch are
  documented limitations; the spec cites them.
- **`pead`** — 40-day holding window is a reasonable midpoint between
  Chordia's 10-20-day drift and Bernard-Thomas 60. `min_quarters_for_sue=4`
  is fixed outside the search space, but that's tuning hygiene, not a live
  defect.
- **`vrp_harvest`** — Absolute-VRP gate (not percentile IV-rank) is a
  legitimate formulation, cleaner than IV-rank for this scale of wedge.
  Assignment / early-exercise handling missing is mitigated by the 21-DTE
  roll; the spec flags it.
- **`earnings_vol`** — `dte_target=21` sacrifices pure vega-crush (7-DTE is
  textbook-optimal) but is an execution-cost compromise on Polygon Developer
  tier, not a first-principles bug. 10-event OOS sample is small (±0.5 CI)
  but honestly disclosed.
- **`ts_momentum`** — ETF proxies (DBC, GLD) instead of futures cost 0.3-0.5
  Sharpe vs Moskowitz futures universe; documented, not a bug. `mean_sign`
  threshold at 0.01 is unjustified by paper but negligible effect on
  single-lookback.
- **`rsi2_reversal`** — Sharpe 1.88 is deployment-inflated (25-35% invested
  time); per-unit-invested Sharpe ~0.5-0.8 matches post-2015 decay band.
  Not a bug; it's how the strategy behaves. Post-2013 Connors additions
  (CRSI, SPY regime gate, volume surge) are principled, not curve-fit.
- **`pairs_trading`** — No Johansen test; fine for 2-leg pairs. Hard-coded
  universe with no Consumer Staples (KO/PEP) is a coverage choice.
- **`dual_momentum`** — Currency hedging not applied is faithful to
  Antonacci's unhedged implementation. Spec §7 performance expectations
  below realised OOS Sharpe is regime, not defect.
- **`regime_adaptive`** — Rule-based rather than HMM is deliberate
  (HMM Viterbi at inference is a classic look-ahead trap; spec is explicit).
  OOS Sharpe 1.62 is regime-favourable 2023-24; not a code bug.
- **`kama_breakout`** — Implementation is textbook-faithful (KAMA math
  exact, ER gate wired, 200-SMA trend filter, 1%-risk sizing, Wilder ATR,
  LeBeau chandelier). *Code quality is 88/100.* The problem is statistical
  power (7 trades), not the code. Paper-only until longer window.
- **`vwap`** — Daily-engine approximation of intraday levels is a documented
  5-10 bp slip; tick-level sim upgrade is P2 infrastructure work, not a
  strategy bug.

**None of the above are on the fix list.** They are either (a) legitimate
parameter choices inside the search space, (b) documented data-tier
limitations, (c) regime-driven performance artefacts, or (d) known
infrastructure gaps queued for Phase 2.

---

## 6. Fix wave proposal — parallelisable dispatch

Grouped by disjoint file ownership so the waves can be dispatched to
separate subagents concurrently.

### Wave 1 — PEAD (3 P0, 2 P1) — biggest single strategy

**Scope:** `backend/strategies/pead/*`, `backend/data/providers/fmp_earnings.py`,
`backend/backtest/{execution.py,costs.py}` (event-conditional spread only).

- [P0] **P0-1**: Parse FMP `time` field into calendar frame; distinguish
  AMC vs BMO in `_yesterday_announcements`. Files:
  `backend/strategies/pead/strategy.py:408-490`;
  `backend/data/providers/fmp_earnings.py:52-71`.
- [P0] **P0-2**: Replace static `UNIVERSE_SEED` with point-in-time S&P 500
  loader. File: `backend/strategies/pead/config.py:54-98`.
- [P0] **P0-3**: Event-conditional slippage model for MOO fills on
  announcement days. Files: `backend/backtest/execution.py:255-256`;
  `backend/backtest/costs.py:71,168-171`.
- [P1] **trading_days_between**: Route through `ctx.calendar_provider`.
  File: `backend/strategies/pead/helpers.py:351-361`.
- [P1] **has_overlapping_earnings**: Use exact session math. File:
  `backend/strategies/pead/helpers.py:322-348`.

**Sole owner of:** `backend/strategies/pead/*`,
`backend/data/providers/fmp_earnings.py`.
**Shared with Wave 3 (coordinate):** `backend/backtest/{execution.py,costs.py}`
(Wave 3 has no overlap here but any execution-layer change must rebase-
check against Wave 3's work).

### Wave 2 — ORB + Pairs + VRP (5 P0, isolated strategies)

**Scope:** three self-contained strategy config / logic edits; no shared
files across the sub-tasks.

- [P0] **P0-5 (orb)**: Remove TQQQ / SPXL from search space. File:
  `backend/strategies/orb/config.py:26`.
- [P0] **P0-6 (orb)**: Remove `max_notional_pct` clip (or raise to 100%).
  File: `backend/strategies/orb/config.py`.
- [P0] **P0-7 (orb)**: Set `volume_confirm_min` lower bound ≥ 1.0.
  File: `backend/strategies/orb/config.py`.
- [P0] **P0-4 (pairs_trading)**: Default to `np.log(y) - β·np.log(x)` in
  OLS path; add `prices_in_log_space` to `DEFAULTS`. File:
  `backend/strategies/pairs_trading/strategy.py:555`.
- [P0] **P0-10 (vrp_harvest)**: Pin `tail_hedge_ratio ≥ 5` in tuner search
  space; reject-and-log at engine start if config violates. File:
  `backend/strategies/vrp_harvest/config.py:91`.

**Sole owner of:** `backend/strategies/orb/*`,
`backend/strategies/pairs_trading/strategy.py`,
`backend/strategies/vrp_harvest/config.py`.

### Wave 3 — Momentum-Quality + Dual-Momentum + Artefact Regen (2 P0 incl. conditional)

**Scope:** momentum_quality halt-detection slice fix + dual_momentum
OOS artefact regeneration. Includes re-running tune / eval scripts.

- [P0-cond] **P0-8 (momentum_quality)**: Slice `wide.loc[:asof].tail(...)`
  in `_drop_halted_symbols`. File:
  `backend/strategies/momentum_quality/helpers.py:107-140`.
- [P0] **P0-9 (dual_momentum)**: Re-run OOS eval to materialise
  `backend/data/oos/phase1-dual_momentum-oos.json`. Script:
  `scripts/tune_dual_momentum.py` (and / or the eval variant).
- [P1] **momentum_quality tuner hygiene**: Rewire
  `scripts/tune_momentum_quality.py:86-110` to tune on TRAIN; evaluate OOS
  once.
- [P1] **momentum_quality benchmark**: Pass `benchmark="SPY"` in
  `scripts/momentum_quality_oos_eval.py:79-90` and prefetch SPY into
  `InMemoryBarProvider`.
- [P1] **dual_momentum tuner**: Constrain `excess_return_floor` to
  `[0.0, 0.02]`; mark `blend_126_252` and `(SPY,EFA,EEM)` diagnostic-only.
  File: `backend/strategies/dual_momentum/config.py:223`.

**Sole owner of:** `backend/strategies/momentum_quality/*`,
`backend/strategies/dual_momentum/*`,
`scripts/tune_momentum_quality.py`,
`scripts/momentum_quality_oos_eval.py`,
`scripts/tune_dual_momentum.py`.

### Waves are disjoint on file ownership

| Wave | `pead` | `orb` | `pairs` | `vrp_harvest` | `mom_quality` | `dual_momentum` | shared backtest |
|------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Wave 1 | ALL | — | — | — | — | — | `execution.py/costs.py` (event-conditional slip) |
| Wave 2 | — | ALL | ALL | ALL (config) | — | — | — |
| Wave 3 | — | — | — | — | ALL | ALL | — |

Only collision: Wave 1's `execution.py` / `costs.py` edit is in the shared
backtest layer. Rebase order: Wave 1 lands first on the shared files; Waves
2 & 3 don't touch them, so they can run fully parallel either before or
after.

### Non-code post-fix checklist

After the three waves land:

1. **Regenerate OOS JSONs** for orb and pairs_trading (P0-5..7 and P0-4
   change edge-picking behaviour); dual_momentum (P0-9 is the generation);
   pead (P0-1..3 change trade population).
2. **Write disclosure banner copy** for momentum_quality, pead,
   vrp_harvest, ts_momentum, orb.
3. **Ship the live-trading allowlist** — deny orb, paper-only kama_breakout,
   invariant-check vrp_harvest.
4. **Rename `exit_timing="1h_after_open"`** to `"next_open"` in
   earnings_vol config.
5. **Update `momentum_quality` docstrings / spec** to downgrade "QMJ"
   language.

---

## Appendix A — Source expert reports

- `audit-reports/expert-momentum-quality.md`
- `audit-reports/expert-pead.md`
- `audit-reports/expert-vrp-harvesting.md`
- `audit-reports/expert-earnings-vol-premium.md`
- `audit-reports/expert-ts-momentum.md`
- `audit-reports/expert-rsi2-reversal.md`
- `audit-reports/expert-pairs-trading.md`
- `audit-reports/expert-dual-momentum.md`
- `audit-reports/expert-regime-adaptive.md`
- `audit-reports/expert-kama-breakout.md`
- `audit-reports/expert-orb.md`
- `audit-reports/expert-vwap.md`

## Appendix B — What "PASS", "CONDITIONAL", "PAPER-ONLY", "DISABLE" mean here

- **PASS** — No P0 defects. Ship to live on current config, with any
  disclosure banner copy noted in §4. P1 fixes land before scaling AUM.
- **CONDITIONAL** — Has P0 defects but the underlying edge is real; fix
  the P0s in Wave 1/2/3 and the strategy is PASS-equivalent.
- **PAPER-ONLY** — Code quality is acceptable, but the statistical
  evidence is too thin (or the regime too narrow) to justify live capital.
  Route to paper engine until sample size is met. `kama_breakout` only.
- **DISABLE** — Strategy must not be user-toggleable for live until
  structural defects are fixed. Catalog-visible with a NOT-READY warning.
  `orb` only.

## Appendix C — Summary counts

- **Concrete P0 defects:** 10 (incl. 1 conditional, 1 artefact-gen).
- **P1 items worth fixing before scaling AUM:** 22.
- **Strategies shipping PASS with no P0:** 8 (`earnings_vol`, `ts_momentum`,
  `rsi2_reversal`, `vrp_harvest` once pinned, `dual_momentum` once JSON
  re-emitted, `regime_adaptive`, `vwap`, `momentum_quality` with
  disclosure + halt-slice fix).
- **Strategies needing P0 code fixes before live flip:** 3 (`pead` 3,
  `pairs_trading` 1, `orb` 3).
- **Strategies paper-only:** 1 (`kama_breakout`).
- **Strategies disabled:** 1 (`orb`).
- **Proposed fix waves:** 3 parallel; disjoint file ownership except for
  one shared-backtest touch in Wave 1.
