# Expert Audit — KAMA Breakout

**Auditor role:** Quant, 15+ yrs, breakout / trend-following — Donchian, LeBeau-Lucas, Kaufman, Turtles (Dennis/Faith), Covel.
**Scope:** `backend/strategies/kama_breakout/` (Phase 1 rewrite) + OOS artefacts + prior audit `strategy-10-kama_breakout.md`.
**Method:** Static review against textbook canon; verification of KAMA / ATR / Donchian / sizing / stops; OOS sample-size sanity.

---

## 1. Component correctness

| Component | Textbook canon | AlphaDesk impl | Verdict |
|---|---|---|---|
| **KAMA (ER + SC)** | Kaufman *Smarter Trading* 1995 ch.6 — `SC = (ER·(fast_α − slow_α) + slow_α)²`, `KAMA_t = KAMA_{t-1} + SC·(p_t − KAMA_{t-1})` | `backend/indicators/trend.py:51-113` — exact, squared SC, seeds with SMA of first `er_period` prices (Kaufman's worked example). | Correct |
| **ER gate** | Prior audit F4: ER computed but never used. | `strategy.py:429, 442` — `er < er_min_trend → reject`. `_efficiency_ratio()` at `strategy.py:630-646` is the canonical formula. Default `0.30`, tuned to `0.39`. | **Fixed** — the flagged defect is closed. |
| **Breakout definition** | Turtle / Donchian: price > N-day high (excl. today). | `strategy.py:407` — `donchian(high.shift(1), low.shift(1), 20)`; compares close to *yesterday's* channel (no same-bar look-ahead). Plus `close > KAMA`. | Correct, double-confirmed (KAMA + Donchian). |
| **Trailing stop** | LeBeau-Lucas chandelier: `HH − k·ATR` with k≈3 on Wilder ATR. | `strategy.py:256-268` — `st.highest_high − chandelier_atr_mult · ATR(22)` with Wilder ATR (`volatility.py:16+`). Ratchets in `manage()` at `strategy.py:234`. Secondary exit: KAMA cross-under (faster regime-flip catch). No hard TP. | Correct, idiomatic. |
| **Position sizing** | Vol-parity / Turtle: 1% equity at risk *on stop hit*. | `strategy.py:468-479` — `shares = risk · equity // (atr_mult · ATR)`, capped at `max_allocation · equity`. Fixes prior F10 (3×-actual bug). | Correct 1%-risk math. |
| **Trend filter (Faber 200-SMA)** | Faber 2007; prior audit F3 called this "single biggest Sharpe contributor". | `strategy.py:412-421, 444-448` — `close > SMA(trend_sma_period)` AND `SMA` rising vs 10 bars back. Default 200; tuned to 100 (see §4). | Present and gated. |
| **Pyramiding** | Turtle rule 4: +½N, up to 4 units. | `strategy.py:283-315` — one half-size add at +1·ATR advance. Conservative softening (1 add, not 3-4). Capped by `max_allocation`. | Sound; less aggressive than Turtle but safer for equity-only. |

No residual correctness defects against the listed canons. The textbook lineage in `spec.md §2` is accurately traceable to the implementation.

## 2. OOS statistical assessment — **sample size is the problem**

The file the request named (`backend/data/oos/phase1-kama_breakout-oos.json`) **does not exist**; the OOS numbers live embedded in `audit-reports/phase1-kama_breakout-tune.json` and the report. Reported figures: Sharpe 1.685, Sortino 1.40, Calmar 2.73, MaxDD 3.43%, CAGR 9.38%, hit-rate 85.7%, profit factor 8.21, **7 round-trip trades over 2 years** (19 fills).

**Seven trades is not a statistically meaningful sample.** Back-of-envelope confidence band: the SE of an annualised Sharpe estimate is approximately √((1 + SR²/2)/T) where T is *years of data*. On 2 years of daily data the SE itself is ~0.8, but on a system with only 7 independent bets the effective sample is the **trade count**, not bar count — the 95% CI on a Sharpe of 1.68 from 7 trades spans roughly [0.2, 3.1]. The point estimate is **not distinguishable from the 0.50 spec target at any reasonable significance**. Hit rate 86% on n=7 has a Wilson 95% CI of [49%, 97%] — a true 50% hit rate is still inside the band. Profit factor 8.2 from one or two oversized winners in a 7-trade sample is exactly what you'd expect from a single 2023-2024 AI-rally QQQ/XLK ride; remove one winner and it collapses. Max DD of 3.43% is ~10× lower than any published equity-only breakout system across 2019-2024 and is clearly regime-conditional (this window had no real bear leg for the strategy to sit in).

**Peer comparison**: `ts_momentum` OOS 2019-2024 uses 6 years on the full 11-asset basket and reports Sharpe 1.52 on a proper bootstrap-feasible trade count. The KAMA 2-year window should be refit over 2019-2024 (5-fold purged walk-forward) and the Sharpe re-reported with block-bootstrap CI.

## 3. Remaining concerns

1. **`trend_sma_period=100` tuned from search over {100,150,200}.** The report itself flags this as regime-risk (2023-2024 AI-led bull). Default 200 is the safe hold-out.
2. **Pyramid caps at 1 add** vs Turtle's 4. Leaves edge on table in sustained trends but is appropriate for a 14-ETF equity book.
3. **Earnings gate degrades to no-op** (`strategy.py:608-611`) — only matters when universe expands past ETFs; acceptable now.
4. **Long-only** — still caps Sharpe in bear regimes (2022 was out of window).
5. The mentioned OOS JSON file is missing on disk despite `kama_oos_eval.py` being written to produce it. Re-run `scripts/kama_oos_eval.py` to materialise it.

## 4. Verdict

**Implementation: ACCEPT.** The rewrite correctly closes every defect flagged in `strategy-10-kama_breakout.md` — KAMA math exact, ER gate wired, 200-SMA filter present, 1%-risk sizing fixed, Wilder ATR, LeBeau chandelier, no anti-trend TP, no 20-day time stop. Textbook-faithful.

**Claimed OOS Sharpe 1.685: REJECT as dispositive evidence.** Seven round-trips is statistically unfit to distinguish from the 0.50 target. Treat the result as "not falsified" rather than "validated". Required next step before production capital: re-run 2019-2024 walk-forward (captures 2022 bear + 2020 crash), expect ~15-25 trades, expect Sharpe to compress to 0.4-0.8 range consistent with equity-only breakout literature (Covel/Faith, Faber). Retain `trend_sma_period=200` default until the longer window confirms 100 isn't overfit.

**Code quality: 88/100. Statistical evidence: 35/100. Ship to paper-trading, not capital.**
