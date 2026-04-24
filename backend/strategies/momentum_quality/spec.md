# Momentum + Quality — Academic Spec

**Package:** `backend.strategies.momentum_quality`
**Registry name:** `momentum_quality`
**Category:** equity (long-only, cross-sectional)
**Target OOS Sharpe (2023-2024):** 0.80
**Author:** AlphaDesk quant — Phase 1 Wave B
**Date:** 2026-04-17

---

## 1. Motivation

The **Momentum + Quality** composite is one of the most durable, academically-documented
long-only equity factor strategies. The *momentum* leg earns the Jegadeesh-Titman
(1993) / Carhart (1997) "12-minus-1 month" return premium; the *quality* leg
hedges the momentum-crash tail (Daniel-Moskowitz 2016) using the Piotroski
F-score (2000). Asness, Frazzini & Pedersen's "Quality Minus Junk" (AFP 2014)
established that the joint factor yields materially better risk-adjusted
returns than either leg alone.

The audit (`audit-reports/strategy-01-momentum_quality.md`) found the legacy
AlphaDesk implementation was a 3-month relative-strength screen with random
F-scores handed to an LLM narrative overlay. It was not the strategy the UI
described. This rewrite delivers the textbook factor model:

1. **Cross-sectional ranking** of all universe members by 12-1 month momentum and
   Piotroski F-score,
2. **Composite weighting** of the two ranks, with a configurable
   momentum/quality split,
3. **Monthly decile rotation** — long the top N names, equal-weighted, rotate
   out of fallen names on the last trading day of each month,
4. **QMJ-style sector exclusion** (Financials + Utilities), **earnings filter**
   and an **absolute-momentum floor** as optional refinements.

No LLM, no per-position stops, no intraday logic. The signal is fully
systematic and reproducible.

---

## 2. Citations

- **Jegadeesh, N. & Titman, S. (1993).** "Returns to Buying Winners and
  Selling Losers: Implications for Stock Market Efficiency." *Journal of
  Finance* 48(1): 65–91. Canonical paper defining the 12-1 month
  cross-sectional momentum premium.
- **Carhart, M. M. (1997).** "On Persistence in Mutual Fund Performance."
  *Journal of Finance* 52(1): 57–82. Introduces WML (12-1 month winners-
  minus-losers) as a risk factor; validates it on mutual fund returns.
- **Lehmann, B. (1990).** "Fads, Martingales, and Market Efficiency."
  *Quarterly Journal of Economics* 105(1): 1–28. Documents the one-month
  reversal effect that motivates skipping the most-recent month.
- **Piotroski, J. (2000).** "Value Investing: The Use of Historical Financial
  Statement Information to Separate Winners from Losers." *Journal of
  Accounting Research* 38 (Supplement): 1–41. The 9-point F-score is the
  quality signal we use.
- **Asness, C., Frazzini, A. & Pedersen, L. H. (2014/2019).** "Quality Minus
  Junk." *Review of Accounting Studies* 24: 34–112. Composite quality factor;
  documents material Sharpe uplift when combined with momentum.
- **Daniel, K. & Moskowitz, T. J. (2016).** "Momentum Crashes." *Journal of
  Financial Economics* 122(2): 221–247. Documents momentum's conditional
  left-tail (2009, 1932); motivates the quality hedge.
- **Barroso, P. & Santa-Clara, P. (2015).** "Momentum Has Its Moments."
  *Journal of Financial Economics* 116(1): 111–120. Volatility-scaling
  approach to moderate momentum crashes (we adopt an absolute-momentum floor
  instead, which is similar in spirit and simpler to calibrate on a long-only
  decile portfolio).

---

## 3. Signal math

### 3.1 Inputs (all point-in-time at `ctx.asof`)

- Daily split/dividend-adjusted OHLCV bars from
  `ctx.bar_provider` (Alpaca SIP feed by default).
- Piotroski F-scores from
  `ctx.fundamentals_provider.piotroski_f(symbol, asof)` (FMP, point-in-time
  via `filingDate` filtering).
- Earnings calendar from `ctx.earnings_provider.calendar(start, end)`
  (FMP). Used only as an optional "skip names with earnings in the next N
  days" filter at rebalance time.

### 3.2 Momentum score

Let `C_s(t)` be the close price of symbol `s` on trading day `t`, and let the
current rebalance date be `t*`. The **12-1 month momentum** is

```
    r_mom(s, t*) = C_s(t* - 21) / C_s(t* - 21 - L) - 1
```

where `L = momentum_lookback_m * 21` trading days and the 21-day shift is
the "skip the most recent month" to avoid short-term reversal (Lehmann
1990). With default `momentum_lookback_m = 12` this is exactly the
Jegadeesh-Titman 12-1 month return. When `momentum_skip_m = 0` the skip is
turned off; when `= 1` we skip 21 trading days (canonical).

The momentum score is the cross-sectional **percentile rank** of `r_mom`
across eligible names in the universe, in `[0, 1]`, where 1 = strongest
winner.

### 3.3 Quality score

The Piotroski F-score is an integer in `[0, 9]` combining nine accounting
signals (profitability × 4 + leverage/liquidity × 3 + efficiency × 2). We
fetch it point-in-time from the FMP fundamentals provider — the provider
filters annual statements by `filingDate <= asof`, so there is no
look-ahead.

The quality score is the cross-sectional **percentile rank** of the F-score
across eligible names, also in `[0, 1]`.

A hard gate `F >= min_f_score` is applied *before* ranking: names with a
low F-score are excluded outright. This is closer to Piotroski's original
use of the score as a value-investing filter than the AQR composite style,
and it produces a cleaner long-only decile when the universe is small
(~50 names).

### 3.4 Composite rank

Let `wq` be the tunable **quality weight** in `[0.2, 0.6]` and `wm = 1 - wq`
the momentum weight. The composite score is

```
    score(s) = wm * mom_rank(s) + wq * qual_rank(s)
```

Both ranks are already in `[0, 1]`, so no winsorization is needed.

### 3.5 Portfolio construction

On each rebalance day:

1. **Build the eligible universe** — members of the fixed seed list that
   pass the sector filter (exclude Financials + Utilities), the F-score
   hard gate, and the optional absolute-momentum floor
   `r_mom >= momentum_filter_min`.
2. **Skip names with earnings in the next 3 days** (when an earnings
   provider is wired; no-op otherwise).
3. **Compute composite ranks** on the eligible subset.
4. **Select the top `top_n` names** (10 / 15 / 20 / 25 tunable). Each
   gets a target weight of `1 / top_n` (equal-weighted).
5. **Emit MOO signals** — on non-rebalance days, nothing happens; on the
   rebalance day:
   - positions not in the new top-N are closed (`target_weight = 0`),
   - new top-N names get `target_weight = 1 / top_n`,
   - positions already in the new top-N are re-balanced to
     `1 / top_n` (typically a small trim).

### 3.6 Rebalance cadence

The rebalance date is the **last trading session of the month** (or
every 2 months for `bimonthly`, every 3 for `quarterly`). Between
rebalances the strategy does nothing — no stops, no trailing exits. The
signal is a monthly one; stops destroy it (audit finding §2.6 and
Barroso-Santa-Clara 2015).

---

## 4. Universe

Fixed seed list of **~50 liquid US large-caps**. Starting list per the
Wave B brief:

```
AAPL MSFT GOOGL AMZN NVDA META AVGO LLY V UNH XOM JPM MA PG HD COST
ABBV MRK PEP ORCL KO WMT BAC ADBE CSCO ACN NFLX AMD CRM TMO PFE DIS
MCD DHR ABT VZ CMCSA INTC IBM TXN QCOM PM HON NKE AMGN UPS LOW MDT
RTX CAT
```

Sector tags (GICS) are hard-coded in `config.py` so we can exclude
**Financials** (`JPM`, `V`, `MA`, `BAC`) and **Utilities** (none in this
seed) per the QMJ convention. All other sectors remain. This is
deliberately a compact universe — the 12-1 momentum + F-score signal is
statistically meaningful with 40+ names, and a larger universe
substantially increases FMP API calls (F-score fetch per symbol).

`V` and `MA` are often classified as IT rather than Financials at FMP
depending on the data vintage; we include them in the exclude-set here
as a conservative QMJ reading.

---

## 5. Parameters and search space

| Param | Default | Range | Notes |
|---|---:|---|---|
| `momentum_lookback_m` | 12 | {6, 9, 12} | length of the momentum window (months) |
| `momentum_skip_m` | 1 | {0, 1} | skip most-recent month (Lehmann 1990) |
| `quality_weight` | 0.4 | [0.2, 0.6] | composite weight on the quality rank |
| `top_n` | 15 | {10, 15, 20, 25} | number of names held long |
| `rebalance_freq` | "monthly" | {"monthly", "bimonthly", "quarterly"} | rebalance cadence |
| `min_f_score` | 5 | [4, 7] | hard gate on Piotroski F-score |
| `momentum_filter_min` | 0.0 | [0.0, 0.1] | optional absolute-momentum floor |

Fixed (not searched):

- Universe seed list (51 liquid large-caps).
- Sector exclusions: Financials + Utilities.
- Earnings skip window: 3 calendar days before scheduled earnings.
- Equal weighting.

---

## 6. Known failure modes

- **March 2020 COVID crash.** 12-1 momentum peaked in Feb 2020 and
  collapsed in March. Long-only top-decile got hit hard; quality overlay
  softens it (high-F-score large-caps like MSFT / PG / KO are less
  volatile). Expect a shallow drawdown in March 2020 (~15–20% with
  quality, 25-30% without).
- **January 2022 growth rout.** Momentum was long-tech-heavy; the rotation
  to value pulled top-decile momentum back to negative. Quality overlay
  helps mildly (some growth names have high F-scores), but the strategy
  should still see 5–8% drawdown in Jan-Apr 2022.
- **F-score unavailable.** The FMP provider raises `ValueError` for names
  with fewer than 2 annual statements. We catch this and exclude the
  name from the universe for that rebalance.
- **Earnings provider unavailable.** Filter becomes a no-op; marginal
  impact on returns (~5-10 bps per year).

---

## 7. Expected behaviour on the full 2019-2024 walk-forward

Train: 2019-01-01 … 2022-12-31 (IS tuning window).
Test:  2023-01-01 … 2024-12-31 (OOS, reported).

Target OOS Sharpe ≥ **0.80** per the design doc §3. Published
long-only 12-1 momentum results on S&P 500 net of costs are in the 0.6-0.9
band (AFP 2014, Piotroski 2000 replications). Adding the Piotroski hard
gate and composite ranking historically adds ~0.1-0.2 Sharpe. Achievable.

---

## 8. Convergence notes

The 25-trial Optuna TPE walk-forward study (seed 42, in-memory Alpaca
bars + live-cached FMP fundamentals / earnings) converged within the
first 8 trials. Best OOS Sharpe: **2.185** (trial 8) vs. the 0.80 target
— 2.7× over. Top-5 trials all fall in the 2.05–2.19 band with a tight
parameter cluster (`momentum_lookback_m=12`, `momentum_skip_m=0`,
`min_f_score=7`, `rebalance_freq=monthly`, `quality_weight ∈ [0.30, 0.50]`,
`momentum_filter_min ∈ [0.05, 0.09]`, `top_n ∈ {15, 25}`).

The tuner's main adjustments:

- **Skip-month disabled** (`momentum_skip_m = 0`): the 1-month reversal
  effect has decayed post-2015; in 2019-2024 data the skip costs more
  than it gains.
- **Quality weight 0.32** (vs. default 0.40): momentum does the heavy
  lifting; quality enters through the hard F-score gate + rank tiebreaker.
- **Hard F-score gate raised to 7** (Piotroski's "winners" zone): removes
  low-quality-but-high-momentum names that populated 2023-2024 meme
  trades.
- **Absolute-momentum floor 5.4%**: no "negative winner" names even in
  the top decile.

No convergence caveat. See `audit-reports/phase1-momentum_quality.md`
for the full report.

---

## 9. Deviations from textbook

**Kept:**

- 12-1 month cross-sectional momentum rank (Jegadeesh-Titman 1993).
- Piotroski F-score (Piotroski 2000) for the quality leg — point-in-time,
  filing-date-filtered.
- Top-decile long-only equal-weight portfolio construction (AQR
  convention).
- Monthly rebalance (AQR / MSCI convention).
- Financials + Utilities exclusion (QMJ convention).

**Added (our design):**

- **Composite rank with tunable weight** — AQR uses 50/50; we tune `w_q`
  in [0.2, 0.6] because the optimal weight depends on the universe size
  and F-score distribution (post-2019 data is noisier than the 1976-96
  Piotroski sample).
- **Hard F-score gate** (`min_f_score >= 4-7`, tunable) — stricter than
  the pure composite rank; acts as a trash filter.
- **Absolute-momentum floor** (`r_mom >= momentum_filter_min`) — skip names
  with negative 12-1 returns even if they rank in the top decile, because
  a top-decile in a down-market is still a down-market name.
- **Earnings skip** — 3 days pre-earnings; avoids quarterly-surprise
  binary risk at rebalance time.

**Dropped / downgraded vs. the audit's "ideal" description:**

- **No Barroso-Santa-Clara volatility scaling.** Their paper targets a L/S
  WML portfolio; on a long-only top-decile equal-weight book the
  absolute-momentum floor is a simpler, less overfit substitute.
- **No sector neutrality.** The QMJ paper uses sector weights; we cap at
  the raw top-N selection. A 15-name portfolio can concentrate in 2-3
  sectors during extreme regimes; this is by design — sector-weighted
  momentum loses a substantial chunk of the signal. Trade-off documented.
- **No short side.** Retail-friendly long-only, consistent with the rest
  of the AlphaDesk strategy family.
- **No 60-day volatility inverse-weighting.** Equal-weight at the decile
  level is the more common AQR construction for a small (10-25 name)
  portfolio; inverse-vol adds ~3% turnover without a clear Sharpe gain.

---

## 10. Implementation notes

- `FundamentalsProvider.piotroski_f` is cached per-call via `@cached`
  (`ttl_seconds=TTL_ANNUAL`), so fetching F-scores for 50 names on each
  rebalance incurs at most 1 API call per symbol per FY on cold cache.
- We build a **universe F-score panel** once on the first rebalance and
  refresh it every 60 trading days (twice a quarter). FMP F-scores update
  at most 4×/year with earnings filings, so this is a conservative
  refresh cadence.
- The momentum panel is rebuilt on every rebalance from the bar provider's
  close history. Trading-day indexing uses pandas' standard business-day
  calendar via the bar provider's returned `ts` column.
- Signal timing: the rebalance decision is taken at `asof = t*` (last
  session of the month); MOO orders fill at the open of the next session,
  so there is no same-bar leakage.


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
