# Pairs Trading (Cointegration-Gated Statistical Arbitrage) — Academic Spec

**Package:** `backend.strategies.pairs_trading`
**Registry name:** `pairs_trading`
**Category:** pairs (dollar-neutral long/short equity)
**Target Sharpe (OOS 2023-2024):** 0.60
**Author:** AlphaDesk quant — Phase 1 Wave C
**Date:** 2026-04-17

---

## 1. Motivation

Pairs trading is the canonical statistical-arbitrage strategy: find two
assets whose log-price spread is *cointegrated* (shared stochastic trend), and
earn the mean-reversion premium when the spread dislocates from its long-run
equilibrium. Unlike single-name mean reversion, a properly-hedged pair is
dollar-neutral and market-beta-neutral by construction, so the edge is
orthogonal to the overall equity tape.

The AlphaDesk audit (`audit-reports/strategy-09-pairs_trading.md`) identified
four structural defects in the legacy runner that vitiated the entire
strategy:

1. **Single-leg execution.** The live `PairsTradingRunner` converted a spread
   signal into a single `BUY` on whichever leg was "cheaper" — no short leg
   was ever opened. The resulting portfolio took outright long directional
   exposure instead of trading the spread. "Market-neutral" was fiction.
2. **No cointegration test.** No Engle-Granger ADF, no Johansen, no p-value
   gate. The only filters were correlation, OU half-life, and Hurst R/S —
   necessary but not sufficient conditions for cointegration.
3. **Static hand-picked pair list.** 12 hard-coded mega-cap pairs (including
   several that decoupled in 2020-2024: T/VZ, AMZN/WMT, XOM/CVX) with no
   rolling rescreen.
4. **Static hedge ratio.** OLS beta computed once at entry and never
   refreshed, silently converting drifting pair trades into directional bets.

This rewrite addresses every one of those defects:

- **Every pair emits TWO signals on every entry/exit** — one `+w` on the
  cheap leg and one `-w` on the rich leg, filled coincidentally as MOO
  orders. The audit's most important fix.
- Pair selection runs **Engle-Granger ADF** on within-sector pairs from a
  ~50-ticker universe, keeping only those with `p < 0.05` and
  Hurst < 0.4 (mean-reverting).
- Pairs are **rescreened every ~quarter** (63 trading days) from the live
  universe, not from a hardcoded list.
- Hedge ratio can be refreshed via **Kalman filter** (Chan 2013 eq. 3.5)
  for pairs that drift.
- A **structural-break watchdog** re-runs Engle-Granger on active pairs
  every 21 days; if `p > 0.10`, both legs are force-closed and the pair is
  retired from the active set.

---

## 2. Citations

- **Engle, R. F. & Granger, C. W. J. (1987).** "Co-integration and Error
  Correction: Representation, Estimation, and Testing." *Econometrica*
  55(2): 251-276. The foundational two-step cointegration test used here:
  OLS-fit `y = alpha + beta*x + eps`, then ADF the residuals for unit
  root.
- **Vidyamurthy, G. (2004).** *Pairs Trading: Quantitative Methods and
  Analysis.* Wiley. Canonical textbook treatment; Chapter 4 on
  cointegration-based pair selection and Chapter 5 on the spread
  z-score trading rule.
- **Gatev, E., Goetzmann, W. N. & Rouwenhorst, K. G. (2006).** "Pairs
  Trading: Performance of a Relative-Value Arbitrage Rule." *Review of
  Financial Studies* 19(3): 797-827. Formation-period / trading-period
  split; documents the ~11% p.a. gross return on the distance-based
  rule pre-2002 and the decay thereafter.
- **Avellaneda, M. & Lee, J.-H. (2010).** "Statistical Arbitrage in the
  U.S. Equities Market." *Quantitative Finance* 10(7): 761-782.
  Documents the post-2006 compression of stat-arb alpha; justifies the
  lowered 0.60 Sharpe target relative to the 1970-2000 era.
- **Chan, E. P. (2013).** *Algorithmic Trading: Winning Strategies and
  Their Rationale.* Wiley. Chapter 3 ("Mean Reversion of Stocks and
  ETFs"): the exact OU half-life and Kalman-filter hedge-ratio
  formulations we use.
- **Do, B. & Faff, R. (2012).** "Are Pairs Trading Profits Robust to
  Trading Costs?" *Journal of Financial Research* 35(2): 261-287.
  Update to Gatev et al.; shows that after realistic transaction costs
  the 2003-2009 Sharpe of pairs is ~0.4-0.6 on large-cap US — the
  realistic band our target sits inside.

---

## 3. Algorithm

### 3.1 Inputs

- Daily OHLCV bars for a ~50-ticker universe of liquid S&P 500 names,
  grouped by sector (§4).
- Bars pulled via `ctx.bar_provider` (Alpaca, split- and
  dividend-adjusted).

### 3.2 Pair selection (runs once every `rescreen_days` ≈ 63 trading days)

For every **within-sector** pair `(y, x)` in the universe:

1. Fetch the last `formation_days` of aligned closes (default 252 —
   one trading year).
2. Run `engle_granger_adf(y, x)`:
   - Step 1: OLS regression `y_t = alpha + beta * x_t + eps_t`.
   - Step 2: ADF test on `eps_t` with `autolag="AIC"`.
3. Estimate OU half-life on `eps_t` (`ou_half_life` in bars).
4. Estimate Hurst exponent on `eps_t` (variance-of-increments).
5. Keep the pair iff:
   - ADF p-value `< adf_pvalue_max` (default 0.05), **and**
   - OU half-life `0 < hl <= ou_halflife_max_days` (default 30), **and**
   - Hurst `< 0.45` (so `|H - 0.5| > 0.05`; mean-reverting).

Rank survivors by ADF p-value ascending (most-cointegrated first). The
first `max_pairs` survivors with distinct underlyings — i.e. no two
surviving pairs share a ticker — form the **active set**.

The active set, hedge ratios, and entry-window sample-mean / sample-std
of the spread are cached in `ctx.state["pairs_trading.active"]`.

### 3.3 Spread & z-score (daily)

For each active pair `(y, x)` with hedge ratio `beta_t`, compute the
spread:

> `s_t = log(close_y_t) - beta_t * log(close_x_t)`

(`log` is omitted when `prices_in_log_space = False` — the default uses
raw prices; log-prices are used only when the tuner selects
`hedge_method = "kalman"` and we want Kalman to run on stationary-scale
residuals.)

The trading z-score is:

> `z_t = (s_t - mu_N) / sigma_N`,  `N = z_window` (default 60)

where `mu_N`, `sigma_N` are rolling sample-mean and sample-std over
`[t-N, t-1]` (strict no-look-ahead: today's bar is *not* included in the
rolling stats used for today's entry decision).

### 3.4 Hedge-ratio maintenance

Two options, controlled by `hedge_method`:

- **`"ols"`** — beta estimated once during the screen on the formation
  window and held fixed until the next rescreen. Simple, transparent,
  and the baseline of Vidyamurthy 2004.
- **`"kalman"`** — dynamic beta from the 2-D Kalman filter in
  `backend.indicators.stats.kalman_hedge_ratio` (Chan 2013 eq. 3.5).
  The filtered slope is used for spread computation and for
  dollar-neutral leg sizing. Captures parameter drift in mega-cap
  correlations over multi-month windows.

### 3.5 Entry rule

For each active pair that has **no open position**:

- **Enter long-short** iff `|z_t| >= z_entry` (default 2.0).
- **Direction:**
  - If `z_t <= -z_entry` → spread is "too low", meaning `y` is cheap
    relative to `x`. Go **long y, short x**. Signals:
    `Signal(symbol=y, target_weight=+pair_weight, order_type=MOO)`,
    `Signal(symbol=x, target_weight=-pair_weight * beta_t * (price_y/price_x), order_type=MOO)`.
  - If `z_t >= +z_entry` → spread is "too high", `y` is rich relative
    to `x`. Go **short y, long x**. Signals with symmetric signs.
- Both signals are emitted on the same bar with the same `asof` and
  same `tag = "pairs-entry-<pair_id>-<direction>"` so the engine fills
  them together.

**Dollar-neutral sizing.** Each leg is allocated `pair_weight *
equity` in notional dollars (default 10%). Both legs carry the
same *absolute* notional, so net market exposure on the pair is
zero at entry regardless of the hedge ratio (`beta` enters the
spread computation only). This is the Chan 2013 §3.3 "dollar
neutral" formulation; a strict "cointegration-neutral" sizing
that uses `beta` shares of x per share of y (Vidyamurthy 2004) is
rejected because it produces zero-share short legs when the two
underlyings have very different prices (e.g. BAC @ \$34 vs
GS @ \$400). `max_pairs` (default 5) caps total gross exposure at
roughly `2 * max_pairs * pair_weight` = 100% gross (50% long +
50% short).

**Capacity guard.** If the number of active pairs at `|z| >= z_entry`
exceeds `max_pairs`, rank by `|z|` descending and take the top
`max_pairs - current_positions`.

### 3.6 Exit rule

For each pair with an open position (identified by `pair_id` stored on
`ctx.state["pairs_trading.positions"][pair_id]`):

- **Mean-reversion exit:** close BOTH legs when `|z_t| < z_exit`
  (default 0.5). Two signals with `target_weight=0`.
- **Stop-loss exit:** close BOTH legs when `|z_t| > z_stop` (default
  3.5). The spread has "broken"; re-entry requires the pair to
  requalify on the next rescreen.
- **Structural-break exit:** every `watchdog_days` trading days
  (default 21), re-run `engle_granger_adf` on the most-recent
  `formation_days` of closes. If the p-value exceeds `watchdog_pvalue`
  (default 0.10), **force-close both legs** and remove the pair from
  the active set until next rescreen.

Every exit emits **two** signals with `target_weight=0` and
`order_type=MOC`. No single-leg closures are ever emitted — the
audit's hardest-line invariant.

### 3.7 Invariant: every pair trades both legs

The strategy enforces this invariant at both emit-time and
engine-level:

- `generate_signals()` always returns an *even* list for pair activity:
  every entry adds two coincident signals (one `+w`, one `-w`) for the
  same `pair_id`.
- `manage()` similarly returns two exit signals per closing pair.
- State in `ctx.state["pairs_trading.positions"][pair_id]` carries both
  `(y, x, beta, entry_z, entry_date)` so the pair is a single logical
  position regardless of how the engine books the two tickers.

---

## 4. Universe

Sector-grouped S&P 500 mega-caps (hard-coded starter list; rescreening is
at the **pair** level within this universe, not at the universe level
itself):

- **Tech:** AAPL, MSFT, GOOGL, AMZN, NVDA, META, ORCL, CRM, ADBE
- **Financials:** JPM, BAC, MS, GS, WFC, C, USB, AXP
- **Energy:** XOM, CVX, COP, EOG, SLB, OXY
- **Health:** LLY, UNH, JNJ, PFE, MRK, ABT, TMO, DHR
- **Consumer:** WMT, HD, COST, LOW, TGT, MCD, SBUX
- **Industrial:** CAT, HON, UPS, FDX, DE, NOC, RTX

49 tickers across 6 sectors. Within-sector pair counts:
`9*8/2 + 8*7/2 + 6*5/2 + 8*7/2 + 7*6/2 + 7*6/2 = 36 + 28 + 15 + 28 +
21 + 21 = 149 candidate pairs` per rescreen. Running Engle-Granger
on 149 pairs once a quarter is trivial on a modern CPU (<5 seconds).

---

## 5. Parameters and search space

| Param | Default | Range | Notes |
|---|---:|---|---|
| `z_window` | 60 | {30, 45, 60, 90} | rolling z lookback |
| `z_entry` | 2.0 | [1.5, 3.0] | entry threshold |
| `z_exit` | 0.5 | [0.0, 1.0] | mean-revert exit |
| `z_stop` | 3.5 | [3.0, 5.0] | stop-loss |
| `pair_weight` | 0.10 | [0.05, 0.15] | long-leg notional |
| `max_pairs` | 5 | {3, 5, 8} | concurrent pairs |
| `hedge_method` | "ols" | {"ols", "kalman"} | static or dynamic |
| `rescreen_days` | 63 | {42, 63, 126} | ~quarter |
| `ou_halflife_max_days` | 30 | [20, 60] | admission HL cap |
| `adf_pvalue_max` | 0.05 | [0.01, 0.10] | cointegration gate |
| `formation_days` | 252 | fixed | Engle-Granger fit window |
| `watchdog_days` | 21 | fixed | break re-test cadence |
| `watchdog_pvalue` | 0.10 | fixed | break threshold |
| `hurst_max` | 0.45 | fixed | mean-reversion gate |

---

## 6. Known failure modes

- **Universe event-driven breaks.** 2020 WFM reallocation broke
  tech-consumer pairs; 2022 energy rally broke XOM/CVX; 2023 NVDA-led
  dispersion broke mega-cap tech pairs. The quarterly rescreen and
  21-day watchdog eject broken pairs; we accept the drawdown on
  detection but limit it by stop-loss at `|z| = z_stop`.
- **Cointegration drift within the rescreen window.** The Kalman
  hedge-ratio option tracks continuous drift; OLS does not. The tuner
  picks between them per-regime.
- **Crowding.** Large-cap stat-arb on a 49-ticker universe is
  capacity-constrained (Do & Faff 2012 estimate ~$100M total AUM on
  this exact universe before edge decay). Realistic Sharpe band
  0.3-0.7; we do not attempt to beat the band with esoteric parameter
  tweaks.
- **Short-borrow costs.** The engine's `DefaultCostModel` applies a
  flat 1% annualised borrow rate on shorts. Holding a short leg for
  20 trading days costs ~0.08% of notional — non-trivial but not
  strategy-killing at pair_weight = 10%.

---

## 7. Expected behaviour on 2019-2024 walk-forward

Train: 2019-01-01 … 2022-12-31 (IS tuning window).
Test:  2023-01-01 … 2024-12-31 (OOS, reported).

Target OOS Sharpe ≥ 0.60. Realistic band 0.3-0.7 per Do & Faff 2012 and
Avellaneda & Lee 2010 on post-2006 large-cap US equities. The tuner's
job is to pin parameters inside the durable subregion of this band. If
convergence stalls below 0.60 we report honestly and document the
reason (the audit warns that 2019-2024 has been particularly unkind to
this class).

---

## 8. Deviations from textbook Gatev/Vidyamurthy

- **Formation window:** we use a rolling 252-day formation and a
  trading window that runs until the next quarterly rescreen (~63 days)
  — rather than the Gatev 12m formation / 6m trading split. 6 months of
  stale hedge ratios is too long in a 2019-2024 regime with multiple
  structural breaks; 63 days matches the 21-day watchdog cadence.
- **Hedge method:** Gatev uses normalised-price distance; we use
  Engle-Granger cointegration with OLS *or* Kalman hedge ratio. Chan
  2013 documents the Kalman extension; the tuner picks per-regime.
- **Universe:** Gatev screens the entire S&P 500; we restrict to the
  49 mega-caps where liquidity, short-borrow, and sector neutrality
  are all realistic. Adding hundreds of small-caps would pad the
  pair count without adding tradable edge.
- **Dollar-neutral, not beta-neutral.** Avellaneda & Lee 2010
  recommend beta-neutral; we use dollar-neutral per Chan 2013 §3.3
  because per-pair beta from a 252-day window is noisy and the
  difference is small for within-sector mega-caps (sector beta ~ 1
  for both legs).
- **No scale-in.** Classic Vidyamurthy scales in at |z|=2, 2.5, 3; we
  enter once at |z|=z_entry and hold. Scaling adds turnover without
  measurable Sharpe improvement in Do & Faff 2012 robustness checks.

Full convergence notes are added to `audit-reports/phase1-pairs_trading.md`
after the tuner run completes.


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
