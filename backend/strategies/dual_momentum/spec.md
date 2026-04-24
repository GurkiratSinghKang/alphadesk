# Dual Momentum — Global Equities Momentum (GEM)

**Category:** Macro / asset allocation (single-asset monthly rotation)
**Primary reference:** Antonacci, G. (2014). *Dual Momentum Investing: An
Innovative Strategy for Higher Returns with Lower Risk.* McGraw-Hill.
**Secondary references:**
- Antonacci, G. (2012). "Risk Premia Harvesting Through Dual Momentum."
  *Journal of Management and Entrepreneurship*, Vol. 2, Issue 1. (NAAIM
  Wagner Award 2012 winner.)
- Jegadeesh, N., & Titman, S. (1993). "Returns to buying winners and
  selling losers: Implications for stock market efficiency." *Journal of
  Finance*, 48(1). (Relative-momentum foundation.)
- Moskowitz, T., Ooi, Y., & Pedersen, L. (2012). "Time series momentum."
  *Journal of Financial Economics*, 104(2). (Absolute / time-series
  momentum foundation.)

## 1. Why this strategy exists

Antonacci's insight is that **absolute** momentum (own 12-month excess
return vs T-bill) and **relative** momentum (cross-asset 12-month
ranking) are independently robust signals, and combining them dominates
either in isolation. The two filters run *in series* on a three-asset
basket — US equity, ex-US equity, and aggregate bonds — and the monthly
output is a single-asset position. Antonacci's backtest (1974–2013)
reports CAGR ≈ 15.7%, Sharpe ≈ 0.87, max-DD ≈ 17.8% vs SPY's ~51%.

The AlphaDesk audit (`audit-reports/strategy-08-dual_momentum.md`) found
that the legacy implementation is a 30-name cross-sectional Jegadeesh-
Titman momentum screener with a SPY on/off gate; it omits:
- the bond fallback (Antonacci's defining feature),
- the T-bill excess-return comparator (uses nominal `> 0` instead),
- the ex-US equity sleeve,
- and layers hard 8% stops / 20% take-profits on a 12-month signal
  (audit findings F7/F8/F9 — all documented destroyers of momentum
  alpha).

This rewrite restores the textbook rules.

## 2. Rules (exact)

Let `t` be the last trading session of each calendar month. On session `t`:

1. **Absolute-momentum test (equity gate).** Compute
   ```
       r_eq(t)  = close_VOO(t)  / close_VOO(t-L)  - 1
       r_rf(t)  = close_BIL(t)  / close_BIL(t-L)  - 1          (risk-free proxy)
       excess   = r_eq(t) - r_rf(t)
   ```
   If `excess > floor` (default `floor = 0.0`), equities pass absolute
   momentum. Otherwise go to step 4.

2. **Relative-momentum test (equity sleeve selection).** Compute
   `r_vXUS(t) = close_VEU(t) / close_VEU(t-L) - 1`. Pick the larger of
   `r_eq(t)` and `r_vXUS(t)`. Hold 100% of that sleeve (VOO or VEU).

3. **Open position** with a market-on-open order for session `t+1`.
   Close whatever is currently held first (also MOO on `t+1`) — the
   engine's `manage()` hook does this before `generate_signals()`.

4. **Bond fallback.** If `excess ≤ floor`, hold 100% of the aggregate
   bond ETF (default `AGG`; configurable via `bond_fallback` param).

5. **Hold until next month-end.** No intra-month stops, take-profits or
   re-entries. The only other action between rebalance days is
   mark-to-market.

**Lookback `L`:** default 252 trading days (≈12 months). Tuner can pick
126 (≈6m), 189 (≈9m), or 252 — or a 126/252 blend via the
`composite_lookback` knob.

**Rebalance frequency:** default monthly (last trading day of each
month). Tuner can also pick `bimonthly` (every 2 months, end of odd
months), which halves turnover at the cost of signal freshness.

## 3. Universe (default)

| Role | Ticker | Notes |
|---|---|---|
| US equity | `VOO` | Vanguard S&P 500 ETF; same underlying as SPY |
| Ex-US equity | `VEU` | Vanguard FTSE All-World ex-US |
| Bond fallback | `AGG` | iShares Core US Aggregate Bond ETF |
| Risk-free proxy | `BIL` | SPDR 1-3 month T-bill ETF |

AGG has data back to late-2003 and BIL back to mid-2007, so the 2019-2024
study window is fine. For deep-history research (pre-2007) substitutes
are IEF (Treasury 7-10y, proxies BIL with a duration mismatch) and SHV
(SHV inception 2007). The config allows `bond_fallback ∈ {AGG, IEF, TLT,
BIL}` and will eventually allow SPY/EFA/EEM as the ex-US leg for variant
studies.

## 4. Why a bond fallback (and not cash), even after 2022

The 2022 bond bear (`AGG -13%`) is the textbook argument against a
hardcoded bond fallback. Two responses:

1. **It's a diversifier, not a hedger.** From 1973-2021 AGG returns were
   positively correlated with the equity-bear regime (flight-to-quality
   rally). 2022 was the first period since 1969 where *both* legs fell
   together. A parameter that is adjusted so it survives 2022 but not
   any other year is the definition of overfit.
2. **The expected term-premium is positive.** Even when returns are
   mean-zero ex post, the strategy earns the term premium + rolldown
   during the equity-off regime, which is higher carry than BIL. Over a
   multi-decade horizon the trade-off is positive.

The tuner can still pick `BIL` (i.e., cash proxy) if that's what the
data prefers on 2019-2024. We do not forbid it. Default is `AGG`.

## 5. Known weaknesses

- **Whipsaw around inflection points.** Lookback-based signals lag at
  market turns. March 2009 (late re-entry after the bottom) and March
  2020 (too-late exit before the COVID low) cost substantial alpha in
  those windows.
- **Single-parameter sensitivity.** Antonacci argued against 3/6/12-m
  blends as curve-fitting. We expose `composite_lookback` primarily to
  *measure* that fragility, not to recommend it as a production setting.
- **Small trade count.** 12 trades/year means statistical power for
  estimating the Sharpe is modest — a Sharpe of 0.7 vs 1.0 over 6 years
  is roughly one standard-error apart. Walk-forward with tight train/OOS
  splits is the right protocol.
- **2022-style dual-bear.** Both legs can fall together; the strategy
  offers no downside protection in that specific regime beyond avoiding
  equity's sharper drawdown.

## 6. What this does NOT do (versus the legacy dual_momentum.py)

- No per-name cross-sectional momentum ranking.
- No Piotroski F / quality overlay.
- No 8% stops, no 20% take-profits.
- No Kelly sizing, no inverse-vol scaling, no sector caps.
- Holds 100% of *one* asset. Portfolio has at most two positions across
  any given month-boundary (the asset being closed, the asset being
  opened) and exactly one position mid-month.

The implementation deliberately stays small (< 300 lines per module) so
the rules are obvious on a read.

## 7. Expected performance (2019-2024)

From the audit's desk analysis of what the TEXTBOOK version should do
(not the legacy AlphaDesk variant):

- 2019 (bull, low vol): ~+20% (VOO)
- 2020 (COVID): ~0 to +8% (whipsaw March; slow bond→equity re-entry)
- 2021 (bull): ~+22% (VOO)
- 2022 (bear + rate hikes): -4% to -7% (AGG drag ~-13%, partial period)
- 2023 (rebound, narrow breadth): ~+18% (VOO)
- 2024 (bull, rate-cut pivot): ~+20% (VOO)

Annualised: CAGR ≈ 10-12%, Sharpe ≈ 0.7-0.9, MDD ≈ 15-20%. Target in
this rewrite is walk-forward OOS Sharpe ≥ 0.80.

## 8. Parameter defaults

See `config.py::DualMomentumConfig`. Source of truth for defaults +
tuner `search_space()`.


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
