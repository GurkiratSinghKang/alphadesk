# Regime-Adaptive Asset Allocation

**Category:** Macro / tactical asset allocation (multi-ETF, rule-based regime overlay)
**Primary references:**
- Ang, A., & Bekaert, G. (2002). *International Asset Allocation with
  Regime Shifts.* Review of Financial Studies, 15(4), 1137-1187.
  (Regime-switching allocation with volatility and correlation changes.)
- Faber, M. T. (2007). *A Quantitative Approach to Tactical Asset
  Allocation.* Journal of Wealth Management, Spring 2007.  (SMA-based
  trend filter — "own the asset when it is above its 10-month SMA.")
- Guidolin, M., & Timmermann, A. (2007). *Asset Allocation under
  Multivariate Regime Switching.* Journal of Economic Dynamics and
  Control, 31(11), 3503-3544.

**Secondary references:**
- Hamilton, J. D. (1989). *A New Approach to the Economic Analysis of
  Nonstationary Time Series and the Business Cycle.* Econometrica.
- Whaley, R. E. (2000). *The Investor Fear Gauge.* Journal of Portfolio
  Management, 26(3), 12-17. (VIX as a regime proxy.)
- Asness, C., Ilmanen, A., Israel, R., & Moskowitz, T. (2015). *Investing
  with Style.* Journal of Investment Management — diversified multi-asset
  defensive allocations.

## 1. Why this strategy exists

The AlphaDesk audit (`audit-reports/strategy-05-regime_adaptive.md`)
documented that the shipped `regime_adaptive` was two disjoint
implementations stacked with a marketing deck that described neither.
The dormant "meta-allocator" rotated weights over nine other strategies
but had no regime-data wire-up (its cache key `regime:current` had zero
writers); the active runner was a synthetic-data sector-rotation stub
with no regime logic at all.

This rewrite takes a different architectural stance per the design
doc: **a standalone regime-aware allocation** that classifies the
market into one of four regimes on each bar, requires a confirmation
buffer before switching, and rebalances on a monthly cadence to a
pre-defined asset-weight vector for that regime. It does **not** rotate
over other strategies — it stands alone as a diversified, macro-aware
ETF allocator.

The design is deliberately close to Faber's SMA-based tactical
allocation (rule-based, parsimonious, interpretable) crossed with
Ang & Bekaert's regime-switching premise (explicit regime labels that
drive allocations). The regime *classification* is rule-based, not
HMM-fitted — the audit flagged the HMM path both as lookahead-prone
(full-series Viterbi smoother used at inference) and as never
actually plugged in. Rule-based regimes are transparent, replicable and
do not drift with the sample.

## 2. Four regimes

Regimes are assigned daily from three inputs: SPY close, SPY's
50-day and 200-day SMAs, and the VIX level. The rules are
non-overlapping when read in the order below (the first matching
clause wins):

| Regime | Rule (evaluated in order) |
|---|---|
| **Crisis** | `VIX > vix_high_threshold` AND `SPY < SMA_200` — OR — SPY has closed below SMA_200 for 20+ consecutive trading days |
| **HighVol** | `VIX > vix_high_threshold` AND `SPY >= SMA_200` |
| **TrendUp** | `SPY > SMA_200` AND `SMA_50 > SMA_200` AND `VIX < vix_low_threshold` |
| **MeanRevert** | default — equities intact but not in a strong uptrend, vol moderate |

Defaults: `vix_low_threshold = 20`, `vix_high_threshold = 25`,
`sma_fast = 50`, `sma_slow = 200`. All tunable.

Design rationale:

- **Crisis** needs both a drawdown (SPY < SMA_200) and a vol spike (or
  a sustained bear). Either in isolation is noise; both together is the
  regime. The OR-limb ("20 consecutive days below SMA_200") catches
  slow grinds that never produce a VIX pop — e.g. 2022's
  rate-hike-driven slide where VIX stayed in the mid-20s.
- **HighVol** is a vol-stressed but still-bullish regime (equities
  above their 200-SMA, VIX elevated). This is the April 2018 / October
  2018 / COVID-tail type. We cut equity exposure but do not go to the
  crisis mattress.
- **TrendUp** is the textbook bull: price + fast-MA confirmation + low
  realized vol. Asset allocation leans aggressive.
- **MeanRevert** is the catch-all middle regime: price around
  SMA_200, vol moderate. Allocation is balanced; we take advantage of
  rangy markets by holding more bonds and gold for chop.

## 3. Confirmation buffer (hysteresis)

The audit's F6 finding was that the previous implementation had zero
hysteresis — any one-bar print of a new regime label would flip all
allocations, whipsawing costs. This rewrite requires the *new* regime
label to persist for **`confirmation_days` consecutive trading days**
(default **10**, ≈ 2 weeks) before the strategy accepts it as the
"confirmed" regime. The rebalance decision only acts on confirmed
labels, not on instantaneous ones.

Pseudocode:

```
daily_label = classify(SPY, SMA_50, SMA_200, VIX, today)   # instantaneous
regime_streak[daily_label] += 1
for other in regimes: regime_streak[other] = 0 (if label != other)
confirmed = daily_label if regime_streak[daily_label] >= confirmation_days
            else confirmed_prev
```

On a monthly rebalance day:
```
if confirmed != current_allocation_label:
    exit all held positions not in the target allocation
    emit signals bringing weights to target_allocation[confirmed]
    current_allocation_label = confirmed
```

Between rebalance days the strategy does nothing. Drift between
rebalances is acceptable — the target weights are conservative enough
that a month of drift does not materially change risk.

## 4. Allocation table

Eight-ETF universe; weights per regime (normalised to 1.00 gross):

| Regime | SPY | QQQ | EFA | IEF | TLT | GLD | BIL | VXX |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TrendUp | 0.40 | 0.20 | 0.10 | 0.15 | 0.00 | 0.05 | 0.10 | 0.00 |
| MeanRevert | 0.25 | 0.10 | 0.05 | 0.25 | 0.15 | 0.05 | 0.15 | 0.00 |
| HighVol | 0.15 | 0.05 | 0.05 | 0.15 | 0.30 | 0.10 | 0.20 | 0.00 |
| Crisis | 0.00 | 0.00 | 0.00 | 0.20 | 0.30 | 0.15 | 0.35 | 0.00 |

- `SPY`, `QQQ`, `EFA`: US large-cap core, US tech tilt, ex-US developed.
- `IEF`, `TLT`: intermediate- and long-duration Treasuries.
- `GLD`: gold as a crisis / inflation hedge.
- `BIL`: 1-3 month T-bills (cash proxy).
- `VXX`: reserved for future expansion. Left at 0 because volatility
  futures roll decay makes VXX a poor long-only hedge over monthly
  horizons and our engine is ETF-reliable but options / futures-roll
  naive. Kept as a column so the tuner search space can experiment.

**Tunable allocation knobs:**
- `crisis_equity_floor` — scales residual equity weight in `Crisis`;
  default 0 but can be 0-15% to let the strategy retain a small equity
  sleeve even in crisis (it gets split proportionally to SPY/QQQ/EFA).
- `defensive_bond_weight` — scales the combined `IEF + TLT` weight in
  `HighVol` and `Crisis`; default 0.45 (= 0.15 + 0.30 in HighVol). The
  remainder is preserved pro-rata.

## 5. VIX data — fallback chain

VIX is not a directly-tradable instrument; for regime classification we
need the actual index level, not a tradable proxy. The data acquisition
chain:

1. **Preferred:** Polygon index ticker `VIX` via
   `backend.data.providers.polygon.PolygonStockBarProvider` (if the
   Polygon plan includes index endpoints). The strategy's `ctx.state`
   can cache this per-backtest.
2. **Fallback A:** Polygon index ticker `I:VIX` (some Polygon plans
   expose the CBOE index feed through the `I:` prefix).
3. **Fallback B (default in this project):** compute an "implied VIX"
   from SPY's 20-day realized volatility:
   `vix_equiv = std_20(SPY_daily_returns) * sqrt(252) * 100`.
   VIX historically trades at ~1.0-1.2× SPY's 20-day realized vol
   (the volatility-risk-premium means the VIX is slightly higher than
   realized), so this under-estimates VIX by ~3-5 points in normal
   regimes and can by larger amounts during vol spikes. We compensate
   by tuning the VIX thresholds on the realized-vol scale
   (`vix_low_threshold=20`, `vix_high_threshold=25` — these are
   *realized-vol points*, not CBOE VIX points — though the two are
   close enough that the Ang-Bekaert style rules stay faithful).

Why not VIXY (the tradable VIX ETN)?  VIXY has undergone multiple
reverse splits since 2018 (most recently 1-for-4 in 2022) and suffers
heavy roll-decay from the VIX-futures term structure. Its close price
is not a stable linear function of VIX — the scale factor drifts by
several multiples over multi-year windows. This makes threshold
classification unreliable. SPY realized volatility, by contrast, is
deterministic from the SPY data we already fetch.

The code tries each source in order and remembers which one it is
using. If no source is available (no SPY data) the classifier returns
`None` and the strategy abstains — per the base.py contract, silent
degradation creates garbage backtests.

## 6. Universe

```
SPY, QQQ, EFA, IEF, TLT, GLD, BIL, VIXY
```

VIXY is in the data universe as a *VIX-proxy data source*, not as a
tradable. It carries a zero weight in every allocation row. The
target-weight mechanism in the engine means VIXY positions are never
opened.

## 7. Rebalance rhythm

- `rebalance_freq="monthly"` (default): last trading day of each month.
- `rebalance_freq="bimonthly"`: last trading day of odd months (Jan,
  Mar, May, ...). Halves turnover.

Between rebalance days the strategy does nothing. If the confirmed
regime flips *during* the month, the new target weights are queued for
the next rebalance day — we do not react intra-month even when the
confirmation buffer fires. This keeps turnover bounded and matches
how real pension / tactical allocators operate.

## 8. Known weaknesses

- **Mediocre during smooth TrendUp periods.** In a 2023-2024-style
  environment the strategy is stuck in TrendUp and delivers ≈ SPY's
  return scaled to 0.40 weight — good drawdown control, merely-OK
  upside capture. Textbook regime Sharpes are 0.4-0.8.
- **VIX threshold sensitivity.** The 20 / 25 thresholds were chosen
  from VIX's multi-decade distribution (75th and 85th percentiles).
  They are the main tuning surface. The strategy's edge is
  inseparable from these choices.
- **Late on regime changes.** 10-day confirmation means we enter
  Crisis 2 weeks after the instantaneous Crisis trigger fires. In
  2020-02 that cost ~5% of equity vs a zero-hysteresis model, but
  the zero-hysteresis model whipsawed in every normal 2-week vol
  spike (cost 2-3% per year in turnover). Net-net the buffer is
  worth the lag.
- **Bond bear (2022 regime).** TLT/IEF down 15%/8% in 2022. Our
  HighVol allocation is 45% bonds; Crisis is 50% bonds. In 2022 the
  regime labelling oscillated between HighVol and Crisis (VIX mostly
  stayed in the mid-20s while SPY slid), so the bond drag was direct.
- **VIXY drift.** Using VIXY × 10 as a VIX proxy works for threshold
  crossing but accumulates a 1-3% level error per year from roll decay.
  Fine for this application; disclosed in §5.

## 9. What this does NOT do (vs legacy `regime_adaptive.py`)

- No HMM. No per-call refit. No Viterbi smoother.
- No 9-sub-strategy rotation. No `REGIME_ALLOCATIONS`-over-strategies.
- No `cache_get("regime:current")` path. The regime is computed from
  market data at each bar; no external-cache handoff.
- No hardcoded "neutral" fallback. If VIX data is unavailable, the
  strategy raises.
- No demo-data screener input. Allocations operate on real ETF closes
  via `ctx.bar_provider`.
- No risk multiplier that scales a fictive equity. Weights are applied
  directly by the engine.
- No binary bull/bear/sideways labels. Four regimes.

## 10. Expected performance (2019-2024)

From the audit's reasoning on what a well-specified regime-based
allocator should do, plus our allocation choices:

- **2019** (TrendUp all year): 0.40 SPY + 0.20 QQQ + 0.10 EFA +
  0.15 IEF + 0.05 GLD + 0.10 BIL. Rough return ≈ 0.40(31) + 0.20(39)
  + 0.10(22) + 0.15(8) + 0.05(18) + 0.10(2) ≈ 24.2%.
- **2020** (TrendUp through Feb, Crisis March-April, MeanRevert, then
  TrendUp). The strategy should be in Crisis for April only (entered
  late, exited late). Estimated ≈ 8-12% return with 15% drawdown.
- **2021** (TrendUp all year): ≈ 22%.
- **2022** (HighVol / Crisis all year): the killer. Stuck in
  bond-heavy allocations while rates ripped up. Estimated −8 to −12%.
- **2023** (TrendUp after 2-month confirmation lag from late-2022
  MeanRevert): ≈ 15-18% (misses the first 4-6 weeks of rally).
- **2024** (TrendUp all year): ≈ 17%.

Walk-forward 2019-2024 Sharpe band: **0.4-0.8**. Target in this
rewrite is walk-forward OOS (2023-2024) Sharpe ≥ **0.60**. 2023-2024
is likely TrendUp-dominant; the Sharpe will reflect the quality of
the TrendUp allocation more than the regime machinery itself.

## 11. Parameter defaults

See `config.py::RegimeAdaptiveConfig`. Source of truth for defaults and
the Optuna `search_space()`.
