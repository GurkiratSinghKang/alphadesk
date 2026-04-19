# Expert Audit — `regime_adaptive`

**Auditor frame:** Hamilton (1989), Whaley (2000), Ang-Bekaert (2002), Faber (2007), Guidolin-Timmermann (2007), Asness-Ilmanen-Israel-Moskowitz (2015).
**Files:** `backend/strategies/regime_adaptive/{spec.md,strategy.py,config.py}`, `backend/data/oos/phase1-regime_adaptive-oos.json`.
**Context:** r5 audit flagged P1 on VIX-proxy multiplier; Wave 23 applied the 100→115 fix.

---

## 1. Classifier — rule-based, not HMM

Ang-Bekaert and Guidolin-Timmermann use Markov regime-switching with latent states fit by EM. Hamilton (1989) uses a two-state filter. The code does **none** of that — it is a Faber-style rule-based classifier on SPY trend (`SMA_50`, `SMA_200`) plus a VIX level, evaluated top-to-bottom: Crisis > HighVol > TrendUp > MeanRevert (`strategy.py:298-308`). The spec is honest about this (§1, "rule-based, not HMM-fitted… HMM path both lookahead-prone and never plugged in"). This is defensible: HMMs overfit with small sample, and the Viterbi smoother at inference is a classic forward-looking-bias trap. Rule-based is the right call for production.

## 2. Regime count — four, correctly partitioned

TrendUp / MeanRevert / HighVol / Crisis (`config.py:83`). This is richer than the binary Hamilton split and closer to Guidolin-Timmermann's 4-state bull-high/bull-low/bear-low/bear-high grid. Non-overlapping when read top-down. Crisis has a proper OR-limb (VIX spike with SPY<SMA_200 **OR** 20-day SPY<SMA_200 grind) — this catches 2022's slow bear that never produced a VIX pop, the textbook reason for adding a slow-trigger disjunction.

## 3. Regime → allocation

Fixed target-weight vectors per regime (`config.py:60-81`), 8-ETF universe (SPY/QQQ/EFA/IEF/TLT/GLD/BIL/VXX). Equity exposure scales 70%→40%→25%→0% across TrendUp→MeanRevert→HighVol→Crisis; duration ramps 15%→40%→45%→50%; cash (BIL) 10%→15%→20%→35%. This is a clean Asness-Ilmanen risk-parity-adjacent defensive rotation. VXX is zero in every row — rightly so, VXX's roll decay makes it a poor long hedge over monthly horizons. Weights sum to 1.00; `allocation_for()` renormalises.

## 4. VIX data — **Wave 23 fix confirmed**

`strategy.py:345-395` implements the documented spec §5 chain: `VIX` column → `I:VIX` column → realized-vol fallback. The Wave 23 fix is present on line 395: `return float(last.iloc[-1]) * 115.0`. Comment explicitly references audit P0 #7 and VRP calibration (VIX ≈ 1.15× realized). **Actual VIX is used if the provider populates it** (lines 370-374 check `VIX`/`I:VIX` columns first). The 115 multiplier only applies in the realized-vol fallback branch. This is correct.

## 5. Transition cost — engine-priced, not modeled

Strategy does not model transition cost explicitly. Rebalance emits `OrderType.MOO` market-on-open signals (`strategy.py:145, 184`); the engine's fill simulator applies slippage/commissions. OOS turnover = 2.85 for 2 years = ~1.4/yr, acceptable for a monthly allocator.

## 6. Stickiness

Two layers: (a) **10-day confirmation buffer** (`config.py:101`, `strategy.py:218-233`) requires 10 consecutive same-label days before confirming; (b) **monthly rebalance** — even on confirmed flips, rotation is queued to month-end (spec §7, `strategy.py:115`). This is textbook hysteresis, solving the whipsaw problem Ang-Bekaert flag.

**Known weakness (from r5):** the streak resets to 1 on *any* label change, so a 1-day blip destroys 10 days of accumulation. Over-sensitive to noise, though safe (errs toward inaction). Not Wave-23-fixed.

---

## Verdict: **PASS with caveats**

Architecturally sound regime switcher. Wave 23 VIX-proxy fix (100→115) is correctly applied. OOS Sharpe 1.62 / MDD 7.9% (vs target 0.60) on 2023-24 — but only 4 regime transitions and identical tuned/default metrics suggests the tuner never escaped TrendUp-dominant local optimum; tuned "improvement" is illusory. The strategy is honest about its weaknesses (bond-heavy in 2022, late on transitions). The unresolved streak-reset bug (r5 P1 #1) is a minor issue, not a blocker. Ship.
