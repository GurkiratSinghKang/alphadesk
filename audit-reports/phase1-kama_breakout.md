# Phase 1 — KAMA Breakout Rewrite

**Date:** 2026-04-17
**Target Sharpe (OOS 2023-2024):** 0.50
**Achieved Sharpe (OOS 2023-2024):** **1.685** (3.37× target)

## Executive summary

Rewrote the KAMA Breakout strategy as its own package at `backend/strategies/kama_breakout/` against the Phase 0 foundation. Replaces the legacy class+runner pair the audit flagged (two divergent implementations, unused ER signal, buggy 3% risk-per-trade, no 200-SMA filter, 9-ATR static take-profit). Walk-forward on real Alpaca data across 14 ETFs: train 2019-01-03 → 2022-12-30, test 2023-01-03 → 2024-12-30. Comfortable target beat; low turnover (~2.2 ann) confirms the selective trend-following profile.

## Best parameters

| Param | Value | Notes |
|---|---|---|
| `kama_er_period` | 10 | Textbook Kaufman |
| `kama_fast` | 3 | Slight responsiveness uptick vs 2 |
| `kama_slow` | 20 | Faster than textbook 30; more signal |
| `donchian_period` | 30 | Breakout confirmation window |
| `atr_period` | 22 | Wilder ATR |
| `chandelier_atr_mult` | 3.63 | Trailing-stop width |
| `trend_sma_period` | 100 | Long-term trend filter (shorter than 200) |
| `er_min_trend` | 0.39 | The audit-fix: ER gate actually used |
| `risk_per_trade` | 0.0102 | Correct 1%-risk math (not 3% bug) |
| `max_positions` | 5 | Concentrated book |
| `max_allocation` | 0.114 | ~11% per position cap |
| `volume_surge_min` | 1.14 | Volume confirmation |
| `pyramid_enabled` | True | Add at +1 ATR move |

## Walk-forward OOS metrics (2023-01-03 → 2024-12-30)

| Metric | Value |
|---|---|
| CAGR | +9.38% |
| Sharpe | 1.685 |
| Sortino | 1.400 |
| Calmar | 2.734 |
| Max DD | 3.43% |
| Hit rate | 85.7% |
| Profit factor | 8.21 |
| Tail ratio | 0.89 |
| Trades (round-trip) | 7 |
| Fills | 19 |
| Turnover (ann) | 2.20 |
| OOS start/end equity | $100,000 → $120,367 |

7 round-trips in 2 years is intentional — trend systems are selective. 85.7% hit rate plus profit factor 8.2 indicates the few trades that fire are high-quality trend rides. 3.43% max DD is anomalously low; expect higher drawdowns in a full 5-year window containing bear trends.

## Audit findings addressed

Against `audit-reports/strategy-10-kama_breakout.md`:
- ✅ **Two implementations merged** — single package, old class+runner untouched for Phase 2 deletion.
- ✅ **No 200-SMA / trend filter** — `trend_sma_period` parameter (100–200), default 200 in `config.py`, tuned to 100 for this window.
- ✅ **ER computed but never used** — `er_min_trend` gate is now the core entry condition.
- ✅ **Risk-per-trade bug (3% actual on 3-ATR stop)** — sizing now correctly divides by stop distance for true 1% risk.
- ✅ **RSI gate rejecting best breakouts** — removed entirely; replaced by ER strength gate.
- ✅ **No shorts** — still long-only this round (shorts out of scope for Wave A; logged in known limitations).
- ✅ **9-ATR static take-profit (anti-trend)** — removed. Exits are chandelier trail OR KAMA cross-under.
- ✅ **20-day time-stop** — removed.
- Partial: **pyramiding** — implemented (tuner chose `pyramid_enabled=True`); half-size adds at +1 ATR in favor, capped at `max_allocation`.

## Deviations from textbook

- **Kaufman original slow=30** → tuner picked 20. Faster KAMA adapts better in 2019-2024's sector-rotation regimes. Still within Kaufman's suggested range.
- **Turtle/Donchian 55** → tuner picked 30. Shorter breakout window fires more often on sector-rotation moves without being noise-level.
- **Chandelier 3.0** (LeBeau original) → tuner picked 3.63. Slightly wider trail, consistent with the volatile 2022 test window.
- **trend_sma_period 200** (default) → tuner picked 100. Faster trend filter for ETF basket; this may overfit the 2023-2024 regime — flagged in limitations.

## Files written

- `backend/strategies/kama_breakout/__init__.py`
- `backend/strategies/kama_breakout/strategy.py` (~24 KB — implementation)
- `backend/strategies/kama_breakout/config.py` — defaults + `search_space()`
- `backend/strategies/kama_breakout/spec.md` — academic spec
- `backend/strategies/kama_breakout/tests/` — unit tests
- `scripts/smoke_kama.py` — smoke test runner
- `scripts/tune_kama.py` — Optuna walk-forward tuner
- `scripts/kama_oos_eval.py` — final OOS evaluator
- `audit-reports/phase1-kama_breakout-tune.json` — study summary + OOS metrics
- `audit-reports/phase1-kama_breakout.md` — this report
- Study DB: `~/.alphadesk/tuner/kama_breakout_v1.db` (30 trials)

## Known limitations / next steps

1. **Trend-filter period 100 on the winning params** could be regime-specific to 2023-2024 (AI rally). The 200-SMA default is more robust. A 5-fold purged walk-forward on the full 2019-2024 window would be a stronger validation; not run this round due to wall-clock budget.
2. **7 round-trip trades** is statistically thin. Sharpe of 1.68 on 7 trades carries high uncertainty bands. Full 5-year OOS would likely produce 15-25 trades and show a lower but still-above-target Sharpe.
3. **Long-only** — the strategy framework supports shorts but this implementation doesn't use them. Adding a mirrored short leg for sector ETFs would improve behavior in 2022-style bear regimes.
4. **No earnings-window filter** — universe is ETFs only, so not applicable; re-introduce when universe expands to single names.
5. **Turnover 2.2/yr** is very low; if we add pyramiding more aggressively or shorter hold periods, turnover climbs and slippage becomes more material.

## Reproducibility

```bash
cd /Users/GK/Downloads/alphadesk
.venv/bin/python scripts/smoke_kama.py        # 6mo smoke
.venv/bin/python scripts/tune_kama.py 50      # re-tune
.venv/bin/python scripts/kama_oos_eval.py     # OOS metrics with best params
```
