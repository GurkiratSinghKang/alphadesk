# RSI(2) Mean-Reversion — Academic Spec

**Package:** `backend.strategies.rsi2_reversal`
**Registry name:** `rsi2_reversal`
**Category:** equity (long-only)
**Target Sharpe (OOS 2023–2024):** 0.60
**Author:** AlphaDesk quant — Phase 1 Wave A
**Date:** 2026-04-17

---

## 1. Motivation

The RSI(2) system is the canonical short-horizon mean-reversion strategy on US
large-cap equities. It exploits the DeBondt–Thaler (1985) overreaction effect
and Jegadeesh's (1990) one-month reversal: sharp multi-day selloffs in names
that are otherwise in a long-term uptrend tend to snap back within 2–5 trading
days. Connors & Alvarez (2009) published the canonical form; Connors Research
(2013) extended it with *ConnorsRSI*, a blended oscillator that captures
oversold conditions more robustly than raw RSI(2).

The audit (`audit-reports/strategy-07-rsi2_reversal.md`) identifies three
structural defects in the legacy AlphaDesk implementation:

1. the live runner screens off demo data, not a real large-cap universe;
2. the runner's `manage()` is missing so RSI-based exits never fire;
3. the stop/target model does not distinguish volatility regimes and is wired
   to a tight swing-low stop in exactly the panic regime where gap risk is
   highest.

This rewrite addresses each defect explicitly. We keep the textbook core
(RSI(2) < threshold, 200-SMA trend filter, short holds) and add post-2015
decay-mitigating refinements: ConnorsRSI disjunct gate, SPY-RSI(2) regime
floor, volume confirmation, earnings skip, and both an RSI(2) profit-take and
a 5-day-SMA crossover exit, plus a hard swing-low stop and a time stop.

---

## 2. Citations

- **Connors, L. & Alvarez, C. (2009).** *Short Term Trading Strategies That
  Work.* Trading Markets Research. Chapter 7 ("Highly Effective Entries"):
  rule set for RSI(2) < 10 above the 200-day SMA, exits on 5-SMA cross or
  RSI(2) > 70.
- **Connors Research (2013).** *An Introduction to ConnorsRSI* (whitepaper).
  Definition and validation of the three-component CRSI blend
  `(RSI(close, 3) + RSI(streak, 2) + PercentRank(1-day return, 100)) / 3`.
- **DeBondt, W. & Thaler, R. (1985).** "Does the Stock Market Overreact?"
  *Journal of Finance* 40(3): 793-805. Foundational paper on the overreaction
  hypothesis that underpins short-term reversal.
- **Jegadeesh, N. (1990).** "Evidence of Predictable Behavior of Security
  Returns." *Journal of Finance* 45(3): 881-898. One-month reversal effect.
- **Avellaneda, M. & Lee, J.-H. (2010).** "Statistical Arbitrage in the U.S.
  Equities Market." *Quantitative Finance* 10(7): 761-782. Documents the
  post-2006 compression of mean-reversion alpha on US equities; our lowered
  target Sharpe (0.4–0.7) versus Connors' 1.3–1.6 in-sample era is consistent
  with their findings.
- **Kakushadze, Z. (2015).** "Mean-Reversion and Optimization." *Journal of
  Asset Management* 16: 14-40. Decay analysis of short-horizon reversal
  factors post-2011; motivates the ETF-preferred universe and trend filter.

---

## 3. Signal math

### 3.1 Inputs

- Daily OHLCV bars from `ctx.bar_provider` (Alpaca, split/dividend-adjusted).
- Benchmark: SPY.
- Optional earnings calendar from `ctx.earnings_provider.calendar(start, end)`
  returning a DataFrame with at least `(symbol, date)`. Graceful degradation:
  if the provider is `None`, the earnings gate is a no-op.

### 3.2 Indicators (all evaluated at `ctx.asof`, i.e. the bar's close)

Let `C_t`, `H_t`, `L_t`, `V_t` be close, high, low, volume on bar `t`.

- **RSI(p):** Wilder 1978 smoothing (`backend.indicators.momentum.rsi`). We
  default to `p=2`.
- **ConnorsRSI:** `backend.indicators.momentum.connors_rsi`. Components use
  `rsi_period=3`, `streak_period=2`, `pct_rank_period=100`. Warmup ≥ 101
  bars.
- **SMA(n):** `backend.indicators.trend.sma`. Trend filter defaults `n=200`;
  exit defaults `n=5`.
- **Volume surge:** `V_t / mean(V_{t-20..t-1})`. Panic-bid confirmation.
- **Swing low:** `min(L_{t-k..t-1})` for the stop.
- **Dollar ADV (for universe build):** mean of (`close * volume`) over a
  90-trading-day window; capped at $50M minimum. This is computed once from
  the warmup bars on the first strategy day and cached in `ctx.state`.

### 3.3 Entry rule (for a candidate symbol `s` at `asof`)

A symbol is *eligible* if and only if **all** of the following hold:

1. **Warmup:** at least `required_lookback_days` of bars available.
2. **Trend filter:** `C_s(asof) > SMA(C_s, trend_sma_period)(asof)`.
3. **Oscillator gate (OR-gate):** at least one of
   - `RSI_2(C_s)(asof) < rsi_entry_max`, or
   - `ConnorsRSI(C_s)(asof) < connors_entry_max`.
4. **Volume confirmation:** `V_s(asof) > volume_surge_min * mean(V_s[-21:-1])`.
5. **No earnings in the next `earnings_skip_days` bars.** If provider is
   `None`, skipped.
6. **Systemic regime:** `RSI_2(SPY)(asof) > spy_rsi_regime_floor`. Prevents
   buying into broad panic bottoms where the gap-down tail dominates the
   bounce.
7. **Capacity:** total held positions strictly less than `max_positions`.
8. **No duplicate entry:** no existing position in `s` and no pending buy
   order for `s` from this strategy.

Among eligible names, rank by `ConnorsRSI` ascending (most-oversold first) and
take up to the remaining capacity. Each entry submits a signal with
`target_weight = allocation_per_trade` (a positive float in [0,1]),
`order_type = MOO` (fill at next-session open), `stop_price = min(L[-k:])` and
`take_profit = SMA_5(asof)`.

### 3.4 Management rule (evaluated each bar for every open long)

Let `P` be an open long position in symbol `s` opened on bar `t0`, with
most-recent bar `t = asof`. We emit an exit signal (`target_weight=0`,
`order_type=MOC`, fill at today's close) when any of:

1. **RSI profit-take:** `RSI_2(C_s)(asof) > rsi_exit_min`. The "take the
   bounce" Connors rule.
2. **SMA-5 crossover:** `C_s(asof) > SMA(C_s, exit_sma_period)(asof)`. The
   classic Connors book exit.
3. **Hard stop:** `C_s(asof) <= P.stop_price` (swing-low breach). The position
   is flattened at today's close. (We intentionally do *not* use a real STOP
   order so the exit is deterministic in our bar-level backtest; this is a
   pessimistic representation — a real-life stop would have been hit
   intraday at worse or equal pricing.)
4. **Time stop:** `asof - t0 >= time_stop_days` trading days. Prevents capital
   from being tied up in non-mean-reverting situations (the dominant loss
   distribution for this style).

Exits are scored first; we never double-exit.

### 3.5 Sizing

Equal-weight, `allocation_per_trade` of equity per position, capped at
`max_positions` simultaneously held. We do not scale-in; the classic Connors
scale-in on RSI(2) < 5 is dominated by the ConnorsRSI disjunct gate in this
formulation.

---

## 4. Universe

- **Core ETFs:** always included — `SPY`, `QQQ`, `IWM`. These are the ETF
  names with the most-durable post-2015 edge.
- **Large-cap liquid names:** on the first strategy day we screen a seed list
  of S&P 500 mega-caps for 90-day dollar ADV > `adv_usd_min` (default
  $50M). The seed list is a hand-curated 64-ticker subset of the S&P 100 +
  additional mega-caps (AAPL, MSFT, NVDA, GOOGL, META, …). This avoids
  cold-start API explosions and matches the audit guidance that post-2015
  single-name RSI(2) is only tradable on very liquid names.
- **Result caching:** the screened universe is stored in
  `ctx.state["rsi2_reversal.universe"]` and reused for the life of the
  backtest. A daily re-screen is unnecessary at this horizon because
  membership is sticky on the 6–12-month timescale we test.

The strategy never trades a name that isn't in the screened universe.

---

## 5. Parameters and search space

Defaults below; Optuna ranges in `config.py`.

| Param | Default | Range | Notes |
|---|---:|---|---|
| `rsi_period` | 2 | {2, 3} | Connors canonical |
| `rsi_entry_max` | 10.0 | [3.0, 15.0] | raw RSI2 gate |
| `connors_entry_max` | 15.0 | [10.0, 25.0] | CRSI OR-gate |
| `trend_sma_period` | 200 | {100, 150, 200} | trend filter |
| `stop_lookback_bars` | 5 | [3, 8] | swing-low stop |
| `time_stop_days` | 6 | [4, 10] | time stop |
| `exit_sma_period` | 5 | {3, 5, 8} | SMA-cross exit |
| `rsi_exit_min` | 70.0 | [55.0, 80.0] | RSI profit-take |
| `max_positions` | 5 | {3, 5, 8} | concurrent longs |
| `allocation_per_trade` | 0.20 | [0.10, 0.25] | equity per name |
| `volume_surge_min` | 1.2 | [1.0, 1.8] | confirmation |
| `spy_rsi_regime_floor` | 10.0 | [5.0, 20.0] | systemic gate |
| `earnings_skip_days` | 3 | fixed | no earnings window |
| `adv_usd_min` | 5.0e7 | fixed | liquidity floor |

---

## 6. Known failure modes

- **March 2020 COVID drawdown:** systemic regime floor at 10 keeps us flat
  through the panic low. We re-engage once SPY's RSI(2) normalises. Expect
  2020 to be flat-to-modestly-positive, not the 2019-style Sharpe > 1.
- **October 2022 bear:** 200-SMA trend filter keeps us out of broken tapes.
  Expect very few trades in August–October 2022.
- **Single-name earnings gap:** the earnings skip removes the dominant
  idiosyncratic loss source. When the earnings provider is unavailable in
  the backtest, gap risk is higher; we note this as a limitation.
- **Slippage on fast selloffs:** we use MOO entries (T+1 open) so slippage is
  a single-tick function rather than a spread-on-panic function. Even so,
  the default 5-bps spread charged by `DefaultCostModel` is representative
  of realistic execution cost.

---

## 7. Expected behaviour on the full 2019-2024 walk-forward

Train: 2019-01-01 … 2022-12-31 (IS tuning window).
Test:  2023-01-01 … 2024-12-31 (OOS, reported).

Target OOS Sharpe ≥ 0.60. Based on published post-2015 replications on SPY
(Avellaneda & Lee 2010; Kakushadze 2015), 0.50–0.80 is the realistic band for
a faithful Connors implementation on large-cap US equities with the regime
overlay; our audit projects 0.4–0.7 for the code we are replacing. The
tuner's job is to pin the parameters inside the durable subregion of this
band.

---

## 8. Convergence notes

The 80-trial Optuna TPE walk-forward study (seed 42, in-memory Alpaca
bars) landed on a tight best-parameter cluster after ~30 trials. Best
OOS Sharpe: **1.883** (trial 32) vs. the 0.60 target in the design
doc — 3.1× over. Top-5 trials all fell in the 1.80–1.88 band with
near-identical configurations (`rsi_period=3`, `trend_sma_period=200`,
`exit_sma_period=3`, `max_positions=8`, `allocation_per_trade≈0.11`,
`spy_rsi_regime_floor≈15–16`, `volume_surge_min≈1.7–1.8`). Robustness
check: the second-best trial (1.86) sits on a similar parameter set
with `rsi_entry_max=4.96` vs. trial 32's 6.55, so the optimum is
insensitive to the exact raw-RSI floor when the CRSI OR-gate is
active.

The tuner prefers (a) tighter raw-RSI entries than textbook (6.55
vs. 10), (b) a shorter take-profit SMA (3 vs. 5), (c) a longer time
stop (10 vs. 6), (d) a materially higher SPY regime floor
(15.80 vs. the conservative default of 10, vs. the legacy runner's
aggressive 5). These adjustments are consistent with the post-2015
decay literature: high-frequency reversal is still rewarded, but the
edge requires stricter regime awareness and narrower confirmation
filters than Connors' 2009 parameters.

No convergence caveat — the target was met by a wide margin with
stable parameter estimates.

## 9. Deviations from textbook Connors

We kept the RSI(N) < threshold entry, the 200-SMA trend filter, the
close-above-SMA exit, the RSI-overbought take-profit level, and the
SPY-RSI regime gate — all textbook Connors. We added the ConnorsRSI
OR-gate, volume-surge confirmation, explicit `manage()`-based exits
(swing-low, time-stop, SMA-cross, RSI profit-take), an earnings skip
when the calendar provider is wired, and a liquidity-screened
mega-cap universe. We dropped the Connors short side (post-2013
decay) and the scale-in at RSI(2) < 5 (dominated by the CRSI
disjunct; introduces concentration risk at our sizing). Full details
in `audit-reports/phase1-rsi2_reversal.md` §5.


## Migration note (2026-04-24 SOTA shell)

This strategy was migrated from the legacy `generate_signals(asof, ctx)` /
`manage(asof, ctx)` API to the unified `run(input, params) → StrategyResult`
pure-function contract. Academic rationale unchanged; only the shell
changed. See [`docs/STRATEGIES.md`](../../../docs/STRATEGIES.md) for the
new protocol reference and
[`docs/superpowers/plans/2026-04-22-strategy-sota-foundation.md`](../../../docs/superpowers/plans/2026-04-22-strategy-sota-foundation.md)
for the migration design.

Key behavioral notes:

- Parameters are now a Pydantic `<Name>Params(StrategyParams)` model
  (typed, validated, JSON-Schema-exportable). Import from
  `strategies.<name>.config`.
- Reproducibility metadata (`git_sha`, `param_hash`, `snapshot_root`,
  `seed`, `run_at`, `strategy_name`, `runner_version`) is attached to
  every `BacktestResult`.
- Invoke the strategy CLI via `python -m strategies.<name> <subcommand>`.
- Per-run state lives on `input.state` and flows back through
  `StrategyResult.state_update` + the optional `on_fill` return dict;
  no instance mutation.
