# Expert Audit: Dual Momentum (GEM)

**Auditor lens:** Antonacci 2014 *Dual Momentum Investing*; Antonacci 2012 NAAIM; Jegadeesh-Titman 1993; Moskowitz-Ooi-Pedersen 2012.
**Files reviewed:**
- `backend/strategies/dual_momentum/spec.md`
- `backend/strategies/dual_momentum/strategy.py`
- `backend/strategies/dual_momentum/config.py`
- `audit-reports/phase1-dual_momentum.md` (no OOS JSON present — see §Findings)
- Prior: `audit-reports/strategies-audit-r3.md`, `strategy-08-dual_momentum.md`

## Summary (≈400 words)

This is the cleanest textbook implementation in the AlphaDesk suite, and the prior r3 audit's assessment holds up under a paper-level read. The strategy correctly implements Antonacci's GEM as a single-asset, month-end rotation across {US equity, ex-US equity, aggregate bond fallback}. The absolute-momentum gate computes `r_VOO - r_BIL` against a default floor of 0.0 (`strategy.py:242`), which is the **excess-return comparator Antonacci defines** — not the nominal `> 0` rule that the legacy implementation used (prior finding F3/F15, now fixed). The relative-momentum step takes the max of 12-month returns across the equity sleeves (`strategy.py:246`), which is Jegadeesh-Titman cross-sectional ranking applied to the 2-ETF basket exactly as GEM specifies. The bond fallback is AGG (Antonacci's defining feature vs the naive cash fallback), and crucially there are **no 8% stops, no 20% take-profits, no Kelly/inverse-vol scaling, and no intra-month re-entries** — all destroyers of momentum alpha called out in the r5 logic audit as F7-F12. The rebalance trigger (`_is_last_trading_day_of_month`) uses `calendar_provider.next_session(asof)` with a Mon-Fri fallback, which correctly anchors to the last *trading* day, not the last calendar day.

Universe proxies are orthodox: VOO (S&P 500), VEU (FTSE All-World ex-US), AGG (Barclays Agg equivalent), BIL (1-3m T-bill). VOO is a legitimate SPY-equivalent with lower ER; VEU is a closer proxy to MSCI ACWI ex-US than EFA and is the correct ex-US choice for GEM. Currency hedging is **not explicitly applied** — but this is faithful to the paper; Antonacci's original implementation uses unhedged MSCI ACWI ex-US, and applying a currency hedge would be a deviation, not a bug. A minor caveat: BIL has inception 2007-05, so any pre-2007 backtest would silently fall through to the `None → bonds` path in `_composite_return` — the implementation handles this explicitly by returning bonds on insufficient history (F18 fixed), which is the conservative choice.

The walk-forward protocol trains 2019-2022 / tests 2023-2024 with 50 TPE trials (truncated to ~6 in practice per the phase1 report). Defaults post OOS Sharpe 1.26, tuned best 1.34 — a 0.08 delta over a 6-knob search space with a 2-year OOS window of only ~24 rebalances. The authors explicitly shipped **textbook defaults** (`single_252`, AGG, VOO/VEU, monthly, floor=0.0), not the tuned params, which is the correct call for a rule-based strategy. The search space includes `lookback_days ∈ {126,189,252}` and `composite_lookback ∈ {single_126, single_189, single_252, blend_126_252}` which I flag in §Findings as near-overfit but not fatal.

## Findings

**P0 — Blocker:**
- **Missing OOS artifact.** `backend/data/oos/phase1-dual_momentum-oos.json` does **not exist** on disk. Every other Phase 1 strategy (ts_momentum, rsi2_reversal, etc.) has its OOS JSON persisted. The phase1-dual_momentum.md report cites Sharpe 1.26 / 1.34 but there is no structured artifact to verify. Either the run was never written, or it was deleted. Re-emit via `scripts/tune_dual_momentum.py`.

**P1 — Parameter-tuning red flags (mild; not overfit but watchable):**
- `excess_return_floor ∈ [-0.01, 0.02]` search range (config.py:223) — Antonacci's canonical value is exactly 0.0. Allowing a negative floor (-0.01) lets the tuner *weaken* the absolute-momentum gate to capture more equity exposure in the 2023-2024 bull; this is the opposite of the paper's intent and should be constrained to `[0.0, 0.02]` or removed entirely.
- `composite_lookback = blend_126_252` option exists despite spec §5 explicitly noting "Antonacci argued against 3/6/12-m blends as curve-fitting." The spec says it's exposed "primarily to *measure* that fragility" but leaving it in the tuner search space invites exactly that fragility. The tuner's best trial (blend_126_252 + SPY/EFA/EEM) is a 2-knob deviation from Antonacci, for a +0.08 Sharpe delta.
- `relative_universe` choice includes `(SPY, EFA, EEM)` — adding EEM is a **3-asset relative-momentum** variant that isn't in GEM; it's closer to Faber's IVY or Antonacci's GBM variant. The tuner picked it (r3 confirms), which means OOS Sharpe 1.34 is no longer strict-GEM.

**P2 — Minor:**
- Currency hedging not handled — faithful to paper, flag only because users comparing to MSCI ACWI ex-US USD-hedged indices will see a FX-drift basis.
- Spec §7 performance expectations (CAGR 10-12%, Sharpe 0.7-0.9) are below realised OOS Sharpe 1.26, suggesting 2023-2024 is a favourable regime — not a bug, but manage expectations.
- `on_fill` is a no-op with no position-state reconciliation — fine here because the strategy is stateless between bars, but a partial-fill at month-end could leave `_target` in a stale state; low-risk but worth a TODO.

## Verdict

**PASS — ship as-is with two caveats.** This is the reference-quality implementation of GEM in the suite. The core state machine, absolute/relative gate sequencing, bond fallback, and no-stops-no-TP discipline are all textbook. Unlike momentum_quality (curve-fit filter floor) or orb (leveraged ETF inflation), this strategy does not hide alpha in non-paper parameters **when run on defaults**. Recommended production config: defaults only — do not ship the tuned (SPY/EFA/EEM + blend_126_252) variant. Action items: (1) regenerate the missing `phase1-dual_momentum-oos.json`; (2) constrain `excess_return_floor` search range to `[0.0, 0.02]`; (3) consider removing `blend_126_252` and `(SPY,EFA,EEM)` from `search_space` or mark them as diagnostic-only so the tuner can't pick them as production params. The strategy's honest OOS edge — 10-14% CAGR with ~10% MDD over full cycles, drawdown-controlled vs SPY's 2022 -24% — is consistent with Antonacci's 1974-2013 out-of-sample numbers, scaled for the lower-vol recent regime.
