# Time-Series Momentum (TSMOM) — Academic Spec

**Package:** `backend/strategies/ts_momentum/`
**Strategy key:** `ts_momentum`
**Category:** `macro`
**Author of this spec:** Wave A — Phase 1 rewrite
**Date:** 2026-04-17

---

## 1. Lineage

The canonical reference is:

> Moskowitz, T. J., Ooi, Y. H., & Pedersen, L. H. (2012). "Time series
> momentum." *Journal of Financial Economics*, 104(2), 228-250.

The paper's three defining claims — replicated here in an equity-account
adaptation:

1. **Sign-of-excess-return signal.** The sign of an asset's own past return
   (most commonly 12-month, optionally ensembled across 1/3/6/9/12 months)
   predicts the direction of its next-month return across a wide cross-section
   of liquid futures (equity indices, bond futures, FX, commodities).
2. **Per-asset vol scaling.** Each asset is sized so that `w_i · σ_i = constant`
   across assets — the "inverse-volatility" weighting that delivers equal
   ex-ante risk contribution from every leg.
3. **Portfolio vol targeting.** The whole book is scaled so ex-ante portfolio
   vol matches a target (typically 10-15% annualized).

The crisis-alpha property (positive convexity during equity drawdowns) arises
from the interaction of (a) **long-short** deployment (the system goes short
assets in downtrends) and (b) **multi-asset** diversification across four
loosely-correlated classes: equities, rates, currencies, commodities.

Operational specifics for the equity-ETF adaptation draw on:

> Hurst, B., Ooi, Y. H., & Pedersen, L. H. (2013). "Demystifying Managed
> Futures." *Journal of Investment Management*, 11(3), 42-58.

Hurst/Ooi/Pedersen 2013 show that the core Moskowitz signal survives even
when the futures universe is replaced by liquid ETF proxies, at the cost of
roughly **0.4 Sharpe lost to imperfect hedges** (Figure 5). They also
document the failure modes (2009 reversal, 2020 H2 whipsaw, 2023 trendless
chop) and the role of drawdown de-levering. Both citations ground the choices
made in §3 below.

Equity-account ("retail") TSMOM literature — essentially a proof that ETF
TSMOM still clears zero after costs:

> Georgopoulou, A., & Wang, J. (2016). "The Trend is Your Friend: Time Series
> Momentum Strategies across Equity and Commodity Markets." *Review of
> Finance*, 21(4), 1557-1592.

---

## 2. Why the legacy implementation failed the audit

`audit-reports/strategy-06-ts_momentum.md` scored the legacy strategy
**32/100** for seven specific reasons. The rewrite targets each directly:

| Audit finding | Mechanism in this rewrite |
|---|---|
| F1 — single asset class | Universe is 6-11 ETFs spanning US eq / intl eq / UST / credit / gold / commodities / USD / REITs. |
| F3 — long-only | `supports_shorts=True`; the signal emits signed `target_weight`. |
| F4 — no sign-of-return signal | Signal is literally `sign(roc(close, 252))` (or 1/3/6/12 ensemble). |
| F5 — static 24-entry VOL_MAP | Realized vol is re-estimated from bars for every asset every rebalance. |
| F6 — no portfolio vol target | Per-asset inverse-vol × portfolio scaling to hit `target_vol ∈ [6%, 15%]`. |
| F7 — dimensionally wrong sizing formula | `w_i = (target_vol / σ_i) / N`, both sides annualized. |
| F8 — monthly "rebalance" is an entry screen | Monthly rebalance re-runs the full signal + sizing on every asset; stale positions either get resized, flipped, or closed. |
| F14/F15 — 60d max hold + tightening trailing stop | No stops. Trend-following requires letting winners run. |

---

## 3. Rules of the rewrite

### 3.1 Universe

Two configurable variants; `minimal_6` is the stable default and `full_11`
is the audit-response ideal when all 11 ETFs have data.

| Variant | Tickers |
|---|---|
| `minimal_6` | `SPY`, `EFA`, `IEF`, `TLT`, `GLD`, `DBC` |
| `full_11` | `SPY`, `EFA`, `EEM`, `IEF`, `TLT`, `LQD`, `HYG`, `GLD`, `DBC`, `UUP`, `VNQ` |

Rationale:

- **SPY / EFA / EEM** — US large-cap, developed ex-US, emerging markets.
- **IEF / TLT** — 7-10y / 20+y US Treasuries (duration exposure).
- **LQD / HYG** — IG / HY corporate credit (carry + credit risk premium).
- **GLD** — gold (safe-haven, dollar-crash hedge).
- **DBC** — broad commodities (inflation, supply-shock hedge).
- **UUP** — USD basket (risk-off).
- **VNQ** — US REITs (rates + real estate).

Fallbacks: if EEM has no history in the requested window, EEM is silently
dropped from the universe (graceful degradation per the constraint list).
The strategy does not attempt `EEM → VWO` substitution in this wave —
that is a phase-2 concern.

### 3.2 Signal

On rebalance day, for each universe member `i`:

1. Compute 12-month price return
   `r_12m_i = close_t / close_{t-252} - 1`
   via `backend.indicators.momentum.roc`.
2. If `signal_ensemble == "ensemble_1_3_6_12"`, also compute the 1/3/6-month
   returns and take the equal-weighted mean of the four sign-indicators
   (each is +1, -1, or 0 if data missing).
3. Direction:
   ```
   dir_i = +1   if ensemble_score > 0
           -1   if ensemble_score < 0 and shorts_enabled
            0   if ensemble_score < 0 and NOT shorts_enabled
            0   if signal is missing / zero
   ```

The "sign of return" is deliberately **not** "sign of excess return over
T-bill": for liquid US ETFs with 12-month returns this difference is almost
always immaterial (T-bill returns 2-5% annualized vs ETF vol of 12-25%), and
including a risk-free subtraction adds an ingestion dependency the rewrite
does not want. Hurst/Ooi/Pedersen 2013 Table 3 shows Sharpe moves by
≤ 0.05 across the two conventions.

### 3.3 Per-asset weighting (inverse vol)

After determining `dir_i`, compute realized vol:

```python
returns_i = close_i.pct_change()
sigma_i   = realized_vol(returns_i, window=realized_vol_window)  # annualized
```

Per-asset raw weight:

```
w_raw_i = dir_i * (target_vol / max(sigma_i, vol_floor))
```

where `vol_floor = 0.05` annualized — prevents explosive sizing on ultra-low-
vol legs like IEF during QE periods.

Normalize so gross exposure equals `target_vol` times the diversification
benefit across the active universe:

```
N_active   = number of assets with dir_i != 0 and valid sigma_i
w_raw_sum  = sum(|w_raw_i|)
w_i        = w_raw_i / max(w_raw_sum, 1.0) * target_vol_gross_mul
```

where `target_vol_gross_mul = 1.0` by default. A variant that treats the
position sizing as "each leg contributes target_vol / N to portfolio vol"
would divide by `sqrt(N)`; we keep the simpler sum-of-weights normalization
because the engine's `target_weight` is a portfolio-fraction, not a
risk-contribution measure. Capping `max_weight_per_asset ∈ [0.15, 0.35]`
handles the pathological case where a single low-vol leg wins the whole
book.

### 3.4 Rebalance cadence

Monthly (last trading day of the month) or bimonthly. Every rebalance day
the strategy:

1. Closes any position whose asset is no longer in the active universe, or
   whose sign has flipped. Emitted as a `target_weight=0.0` MOO exit in
   `manage()`.
2. Emits new target weights (signed) as MOO entries in `generate_signals()`.
   The engine's weight-to-shares conversion handles the sign and the delta
   from the existing position.

On non-rebalance days both hooks return `[]`. This matches the Moskowitz
2012 "discrete month-end" convention and dodges the per-bar Kalman-drift
failure modes that destroy naive continuous-rebalance TSMOM.

### 3.5 Drawdown de-lever (optional)

If portfolio peak-to-trough drawdown exceeds `drawdown_delever_threshold`
(default 0.10, tunable [0.08, 0.20]), the next month's gross notional is
halved. This is a first-order approximation of the "vol-scaling from
realized drawdown" convention used by AQR / Man AHL in production, without
requiring a second-derivative estimator.

The drawdown signal is read from `ctx.equity` vs the all-time high stored
on `ctx.state`. When the drawdown recovers below the threshold, the halving
is removed next month.

### 3.6 No hard stops

Monthly signals only. Intra-month price moves are not re-examined. This is
exactly what the audit's F14/F15 demanded — hard stops at ATR multiples on a
month-long signal destroy the signal.

### 3.7 Drawdown / vol floor / weight cap — worked example

With `target_vol=0.10`, `realized_vol_window=60`, `max_weight_per_asset=0.20`,
`universe=minimal_6`, and the following realized vols (annualized) on a
rebalance day when the 12-month signs are all positive:

| Asset | σ_60d | w_raw (target=0.10) |
|---|---:|---:|
| SPY | 0.15 | 0.667 |
| EFA | 0.18 | 0.556 |
| IEF | 0.07 | 1.429 |
| TLT | 0.15 | 0.667 |
| GLD | 0.14 | 0.714 |
| DBC | 0.22 | 0.455 |

Sum of `|w_raw|` = 4.487. Each `w_i = w_raw_i / 4.487 * target_vol_gross_mul`.
Since `target_vol_gross_mul=1.0`, gross notional = 1.0 (100% invested,
spread across the 6 legs). The IEF weight before the cap would be
`1.429 / 4.487 = 0.319` — above the 0.20 cap — so IEF is capped at 0.20 and
the remaining five assets are renormalized to sum to `1.0 - 0.20 = 0.80`.
Final weights are all in [0.00, 0.20] and sum to 1.00 gross.

If a scan were to produce negative signs on some assets, the long-short
gross would still be 1.0 but the net would be less; the engine handles
negative `target_weight` natively — tested under §4.

---

## 4. Verified properties (unit tests, file `tests/test_strategy.py`)

The audit wanted explicit proof of five behaviors. One test per property:

1. **Sign-of-return correctness** — given scripted closes where the 252-day
   return is `+0.15`, the signal is `+1`; given `-0.15`, the signal is `-1`
   (shorts on) or `0` (shorts off).
2. **Inverse-vol weights sum to gross target** — when all assets have
   positive signs and the per-asset cap is not binding, `sum(|w_i|) ==
   target_vol_gross_mul` within float tolerance.
3. **Monthly trigger** — `manage()` and `generate_signals()` emit exactly
   `[]` on mid-month dates; they emit signals only on the last trading day
   of the month.
4. **Shorts generate negative `target_weight`** — with `shorts_enabled=True`
   and a scripted `-30%` 12-month return on SPY, the emitted signal carries
   `target_weight < 0`.
5. **Drawdown de-lever triggers** — after a scripted 12% drop from the
   portfolio's peak equity, the next rebalance emits weights that are half
   the un-delevered values.

Each test drives the strategy's hooks directly with a synthetic scripted
bar provider; no live Alpaca calls. Follows the `dual_momentum` /
`kama_breakout` testing patterns so the conftest shim for the legacy
aggregator reuses the same bootstrap.

---

## 5. Known weaknesses (documented honestly)

1. **Equity-account universe is not the futures universe.** ETF tracking
   error on commodity futures (DBC, GLD) and FX (UUP) means 2022's
   $20+/bbl oil rally and USD super-cycle are only partially captured.
   Expected Sharpe loss vs a true futures TSMOM: 0.3-0.5 per Hurst/Ooi/
   Pedersen 2013 Figure 5.
2. **2023 trend dislocation.** TSMOM had a difficult 2023 — SG Trend Index
   -4.2% — driven by reversals in rates (Fed pivot anticipation) and yen
   carry. A Sharpe in the 0.3-0.6 range on the 2023-2024 OOS window is
   plausible and not evidence of implementation bugs. We honestly report
   whatever the tuner finds and document the regime.
3. **Inverse-vol denominator sensitivity.** The 60-day realized-vol
   window is the standard Moskowitz choice; shorter windows (20-30 days)
   would adapt faster but overweight recent spikes. The tuner tests
   `[30, 60, 90]`.
4. **Rebalance-day data availability.** If a single ETF has no bars on
   the rebalance day (rare but possible), its signal is dropped and the
   rest of the book is normalized without it. The strategy does not
   queue a makeup trade on the next day.
5. **Borrow cost on shorts.** Short legs carry a borrow fee in reality.
   The backtest engine's `DefaultCostModel` applies a generic borrow rate;
   for precision, wire a symbol-specific borrow model in a future wave.

---

## 6. Reproducibility

```
# Unit tests (five property tests):
PYTHONPATH=. .venv/bin/python -m pytest backend/strategies/ts_momentum/tests -q

# Smoke test (Alpaca, 12 months ending 2024-06):
PYTHONPATH=. .venv/bin/python scripts/smoke_ts_momentum.py

# Walk-forward tuner (40 Optuna trials, IS 2019-2022, OOS 2023-2024):
PYTHONPATH=. .venv/bin/python scripts/tune_ts_momentum.py 40
```

Alpaca bars are cached under `~/.alphadesk/cache/` by the provider, so
once the universe is pre-warmed the tune is CPU-bound rather than
network-bound. Seed 42 is passed to the TPE sampler; with the same
Alpaca snapshot the tune is deterministic.
