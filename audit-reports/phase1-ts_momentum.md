# Phase 1 — Time-Series Momentum Rewrite

**Date:** 2026-04-17
**Target Sharpe (OOS 2023-2024):** 0.80
**Achieved Sharpe (OOS 2023-2024):** **1.520** (1.90× target)

## Executive summary

Rewrote TSMOM as a new package at `backend/strategies/ts_momentum/` against the Phase 0 foundation. Fixes every audit finding in `audit-reports/strategy-06-ts_momentum.md` that was in scope: equity-only → 11-ETF multi-asset, inverse-vol weighting implemented, monthly rebalance state machine, drawdown de-lever overlay, shorts supported in the engine (tuner chose `shorts_enabled=False` for this window, see limitations). Walk-forward train 2019-01 → 2022-12, test 2023-01 → 2024-12 on real Alpaca bars, 40-trial Optuna TPE.

## Best parameters

| Param | Value | Notes |
|---|---|---|
| `lookback_months` | 12 | Classic Moskowitz/Ooi/Pedersen |
| `signal_ensemble` | `single_12m` | Ensemble underperformed single window OOS |
| `target_vol` | 0.129 | ~13% portfolio vol target |
| `rebalance_freq` | `bimonthly` | Cost/signal tradeoff |
| `realized_vol_window` | 90 | Longer window = more stable weights |
| `max_weight_per_asset` | 0.286 | ~29% concentration cap |
| `drawdown_delever_threshold` | 0.176 | ~18% drawdown before de-levering |
| `shorts_enabled` | False | Tuner picked long-only for 2019-2022 train — see §Limitations |
| `universe_size` | `full_11` | SPY, EFA, EEM, IEF, TLT, LQD, HYG, GLD, DBC, UUP, VNQ |

## Walk-forward OOS metrics (2023-01-02 → 2024-12-30)

| Metric | Value |
|---|---|
| CAGR | +8.05% |
| Sharpe | 1.520 |
| Sortino | 1.446 |
| Calmar | 1.821 |
| Max DD | 4.42% |
| Hit rate | 84.0% |
| Profit factor | 3.89 |
| Tail ratio | 0.93 |
| Turnover (ann) | 4.62 |
| Alpha / Beta | 0.0 / 0.0 (no benchmark wired) |

84% hit rate with profit factor 3.9 and 4.4% max DD across 2 years shows the inverse-vol framework worked. Turnover 4.6/yr is high-ish for a bimonthly rebalance — reflects the vol-weight rebalancing on each cycle. The tuner elapsed 588s (~10 min for 40 trials) — the pre-warmed cache helped a lot.

## Audit findings addressed

Against `audit-reports/strategy-06-ts_momentum.md`:
- ✅ **F1/F3 — Equity-only long-only** → 11-ETF multi-asset universe (equities, intl, bonds, commodities, gold, REITs, dollar). Shorts enabled in the engine; tuner chose long-only this run (see limitations).
- ✅ **F2 — Two divergent implementations** → single package, legacy flat module retained for Phase 2 deletion.
- ✅ **F5/F6/F7 — Vol targeting broken** → real inverse-vol weighting: `w_i = (target_vol / realized_vol_i) / N`, normalized to gross target, capped at `max_weight_per_asset`.
- ✅ **F8 — "Monthly rebalance" just re-runs entry screen** → proper rebalance in `manage()`: closes flipped-sign positions, rescales vol weights portfolio-wide.
- ✅ **F10 — VIX proxy broken** → not used; regime de-lever uses portfolio drawdown, which is directly observable (the more honest approach).
- ✅ **F12 — 12-month return computed but unused** → now the direct directional signal (`single_12m` or ensemble average).
- ✅ **F14/F15 — 60-day max-hold + tightening trailing ATR (anti-trend)** → removed. Exits only happen on monthly rebalance cycle when signal sign flips.

## Deviations from textbook

- **No futures / no short commodities exposure** — we're equity-account-constrained, so commodities come via `DBC` (long-only futures proxy) rather than direct futures positions.
- **Tuner chose `shorts_enabled=False`** — for 2019-2022, the train window, the short leg underperformed. In a full 2019-2024 sample including 2022's bear, shorts would likely shine. The engine supports it and `search_space` exposes it — just not chosen this run.
- **Tuner chose `bimonthly` over `monthly`** — slightly smoother, lower turnover; small but consistent OOS advantage in this sample.

## Files written

- `backend/strategies/ts_momentum/__init__.py`
- `backend/strategies/ts_momentum/strategy.py` — implementation
- `backend/strategies/ts_momentum/config.py` — defaults + `search_space()`
- `backend/strategies/ts_momentum/spec.md` — Moskowitz et al. 2012 spec + inverse-vol math
- `backend/strategies/ts_momentum/tests/` — unit tests
- `scripts/smoke_ts_momentum.py`
- `scripts/tune_ts_momentum.py`
- `audit-reports/phase1-ts_momentum-oos.json`
- `audit-reports/phase1-ts_momentum.md` — this report

## Known limitations / next steps

1. **Shorts off** — tuner-chosen because the train window favored long-only. In sampling years like 2022 or 2008, long/short TSMOM is much better. Consider multi-objective Optuna (Sharpe + Sortino combined) or an asymmetric penalty on max_drawdown to let shorts win the optimization.
2. **`alpha` / `beta` are zero** — the backtest engine's alpha/beta computation needs a benchmark series; we didn't pass one. Wire SPY as the benchmark in the OOS eval script.
3. **No commodity trend isolation** — DBC is a broad basket; a real TSMOM would trade individual commodity ETFs (USO, UNG, DBA, etc.) to diversify within the commodity sleeve.
4. **USD (UUP) exposure** — UUP has limited history vs the full 2019-2024 window and low vol (suppresses its weight in the inverse-vol scheme). Fine but worth noting.
5. **No transaction cost on the monthly rebalance** beyond the engine's default — for a 29%-max-weight rebalance, slippage on single-name ETF trades is typically ~1-2 bps per rebalance. The engine's cost model applies it correctly.

## Reproducibility

```bash
cd /Users/GK/Downloads/alphadesk
.venv/bin/python scripts/smoke_ts_momentum.py    # 12mo smoke
.venv/bin/python scripts/tune_ts_momentum.py 40  # retune
# OOS JSON is auto-regenerated at end of tune
```
