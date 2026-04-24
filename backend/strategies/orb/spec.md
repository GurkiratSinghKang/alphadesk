# Opening Range Breakout (ORB) — Academic Spec

**Package:** `backend.strategies.orb`
**Registry name:** `orb`
**Category:** intraday (long/short equity / leveraged-ETF)
**Target Sharpe (OOS 2023-2024):** 0.70
**Author:** AlphaDesk quant — Phase 1 Wave C
**Date:** 2026-04-17

---

## 1. Motivation

The Opening Range Breakout is the canonical *intraday* day-trading strategy on
US equity indices: it buys a break of the first-N-minutes high (or sells a
break of the first-N-minutes low) and flattens the position before the close.
The basic idea — that imbalance established in the first few minutes of the
session persists and directionally drives the rest of the day — was first
formalised by Toby Crabel in the early 1990s and popularised for retail
readers by Mark Fisher in 2002. Zarattini & Aziz (2023) revived the academic
interest in ORB by documenting that a *5-minute* opening-range formulation on
the leveraged ETF **TQQQ** produced an in-sample Sharpe > 2 on 2016-2023 data,
with a long-only bias, stop at the OR-low, and an end-of-day market-on-close
exit.

The audit (`audit-reports/strategy-11-orb.md`) flagged three structural
defects in the legacy AlphaDesk implementation:

1. **two parallel implementations** (`strategies/orb.py` class and
   `strategy_runner.py::ORBRunner`) that disagree on the breakout buffer
   and on exit rules;
2. **shorts silently discarded** and **no first-break-of-day enforcement** —
   two failures that together eliminate the only mechanism that made 2022 a
   profitable year for ORB;
3. **once-per-day snapshot** wiring (the runner fires at 10:05 ET and never
   inspects intraday bars again), so the strategy effectively never sees the
   breakout unless it happens inside that five-minute window.

This rewrite addresses each defect. We implement the Zarattini parameterisation
(5-min OR, TQQQ/QQQ universe, first-break enforcement, OR-low stop, EOD close)
with a pluggable short side, Crabel-style longer windows (15/30-min) as
tuner-selectable alternatives, and Fib 1.272 / 1.618 scale-outs in the exit
leg. We do *not* reuse the legacy `orb.py` or `ORBRunner`; both are flagged
for Phase 2 removal.

---

## 2. Citations

- **Crabel, T. (1990).** *Day Trading with Short Term Price Patterns and
  Opening Range Breakout.* Traders Press. First formalisation of the
  opening-range breakout as a trading edge on US futures. Crabel used the
  first-30-minute window on S&P/Nasdaq pit futures and recorded stops at
  the opposite extreme. Introduced NR4 / NR7 "narrow-range" day context as a
  volatility conditioner.
- **Fisher, M. (2002).** *The Logical Trader: Applying A Method To The Madness.*
  Wiley. The ACD-method formalisation of Crabel's OR: "A" levels = OR, "C"
  / "D" = failure-reversal levels, layered pivot ranges. Popular retail
  reference for the 5/15/30-minute choice.
- **Zarattini, C. & Aziz, N. (2023).** *A Profitable Day Trading Strategy For
  The US Equity Market.* Working paper (arXiv:2302.13811). 5-minute OR on
  TQQQ and QQQ, 2016-2023. Reports Sharpe > 2 on TQQQ (in-sample, long-only).
  Key methodological choice: entry on the *first bar after the OR window
  that closes above OR-high*, stop at OR-low, EOD close at 16:00 ET, dollar
  volume-normalised sizing.
- **Lo, A. W. & MacKinlay, A. C. (1988).** "Stock Market Prices Do Not Follow
  Random Walks: Evidence from a Simple Specification Test." *Review of
  Financial Studies* 1(1): 41-66. Foundational evidence of short-horizon
  serial correlation in index returns that underpins the ORB edge.
- **Cont, R. (2001).** "Empirical Properties of Asset Returns: Stylized Facts
  and Statistical Issues." *Quantitative Finance* 1(2): 223-236. Documents
  intraday seasonality — U-shaped volatility, outsize opening-bar volume —
  that motivates the OR window as a signal filter.

---

## 3. Strategy design

### 3.1 Core universe

Per the design spec in `docs/superpowers/specs/2026-04-17-strategy-overhaul-design.md`,
the ORB instrument set is **SPY, QQQ, and TQQQ** (3× leveraged QQQ). The
Zarattini > 2 Sharpe result is specifically a **TQQQ** result — removing
TQQQ from the universe forfeits the amplification mechanism and regresses
the OOS to SPY/QQQ levels (Sharpe 0.6-0.9). The tuner may further select
among:

- `spy_qqq`: `['SPY', 'QQQ']` — unleveraged baseline;
- `qqq_tqqq`: `['QQQ', 'TQQQ']` — Zarattini canonical;
- `all_leveraged`: `['SPY', 'QQQ', 'TQQQ', 'SPXL']` — most diversified.

We explicitly flag the curve-fitting risk of tuning on TQQQ alone; the
default is `qqq_tqqq` which retains the leverage effect without
optimizing to a single instrument and period.

### 3.2 Opening range definition

Let `T0 = 09:30:00 ET` (the regular-session open). The opening range is the
extremes of the first `or_minutes` minutes of the session:

```
OR_high = max(H_i for i in [T0, T0 + or_minutes))
OR_low  = min(L_i for i in [T0, T0 + or_minutes))
```

where `H_i`, `L_i` are the 1-minute high and low of the *i*-th RTH bar.

**Tuner choices:** `or_minutes ∈ {5, 15, 30}`. 5-min is Zarattini; 15-min is
Fisher's middle-ground; 30-min is Crabel's classic. Shorter windows produce
more signals and more whipsaws.

### 3.3 Entry

On the **first bar** after `T0 + or_minutes` whose **close** strictly exceeds
`OR_high` (long) or falls strictly below `OR_low` (short, only if
`allow_shorts=True`), we enter a position at the *next* bar's open
(market-on-open on intraday bars).

Constraints:
- **Single entry per day per symbol.** A failed breakout (stop-out) is not
  re-entered that session.
- **Entry cutoff.** No new entries after `entry_cutoff_hour_et` — default
  14:00 ET — because late-day entries have no runway.
- **Volume confirmation** (optional, tunable). Entry bar volume must exceed
  `volume_confirm_min × mean(volume_i for i in OR window)`. When the
  multiplier is ≤ 1.0 the filter is effectively disabled.

### 3.4 Exit

Three exit legs, all evaluated every 1-minute bar after entry:

1. **Hard stop** at the opposite OR boundary. For a long: `L_i < OR_low` →
   exit at the stop price (next bar's open or OR_low, whichever is worse for
   us). For a short: `H_i > OR_high` → cover.
2. **Take-profit scale-outs** at Fib extensions of the OR range, default
   **1.272** and **1.618**. Each TP flattens one-third of the position:
   ```
   OR_range = OR_high - OR_low
   TP1_long = OR_high + tp1_fib × OR_range
   TP2_long = OR_high + tp2_fib × OR_range
   ```
   (symmetric for shorts; subtract from OR_low).
3. **End-of-day flat.** Any residual position is closed at **15:55 ET MOC**
   on the 1-minute bar. Never hold overnight. This is the single hardest
   constraint — it is what makes the strategy statistically clean.

Optional trailing stop (tuner switch `stop_method="or_midpoint_trail"`): once
price has moved 1× OR-range in favour, migrate the stop to the OR midpoint;
from there, trail by `0.5 × OR_range` below the highest 1-min high (long) or
above the lowest 1-min low (short).

### 3.5 Sizing

Per-trade equity risk is `risk_per_trade` (default 1%). Position size in
shares:

```
risk_per_share = |entry_price − stop_price|
shares = floor((risk_per_trade × equity) / risk_per_share)
```

Capped at `max_notional_pct × equity` total notional (default 20%). On
TQQQ, which is 3× leverage, this is effectively a 60% beta-equivalent cap
on SPY exposure — aggressive but standard for the Zarattini-style setup.

### 3.6 Parameters

See `config.py` for defaults. The tuner-searchable subset is listed in
`search_space()`:

| Parameter | Default | Range |
|---|---:|---|
| `or_minutes` | 5 | {5, 15, 30} |
| `entry_cutoff_hour_et` | 14 | IntRange(11, 15) |
| `stop_method` | `"or_bound"` | {`or_bound`, `or_midpoint_trail`} |
| `volume_confirm_min` | 1.0 | FloatRange(0.8, 1.5) |
| `universe_profile` | `"qqq_tqqq"` | {`spy_qqq`, `qqq_tqqq`, `all_leveraged`} |
| `allow_shorts` | False | {True, False} |
| `tp1_fib` | 1.272 | FloatRange(1.0, 1.5) |
| `tp2_fib` | 1.618 | FloatRange(1.5, 2.5) |
| `risk_per_trade` | 0.01 | FloatRange(0.005, 0.02) |

Fixed (not tuner-exposed): `session_end_et=15:55`, `max_notional_pct=0.20`,
`commission_bps=0.5`, `slippage_bps=2.0` (applied on the simulated
breakout-bar fill price).

---

## 4. Engine integration — intraday workaround

The AlphaDesk `BacktestEngine` (see `backend/backtest/engine.py`) is
fundamentally a **daily** engine: it iterates trading sessions one per day,
fills MOO signals at the next session's open and MOC signals at the current
session's close, and has no native concept of same-session intraday entry +
same-session intraday exit. Staging a signal on day T-1 for a same-day
round-trip on T requires knowing T's opening-range values before T starts,
which is impossible without look-ahead.

Rather than distort the engine's contract, we run ORB as a **custom intraday
simulator** that is invoked by a standalone backtest harness
(`scripts/smoke_orb.py`, `scripts/tune_orb.py`). The strategy class
implements the `Strategy` protocol (so it registers correctly and is
discoverable via `registry.get_strategy('orb')`) but its `generate_signals`
method returns an empty iterable — the engine never fires a trade on behalf
of ORB. The real decision loop lives in `ORBStrategy.simulate_day(asof, ctx)`
which:

1. Fetches 1-minute bars for the active symbol(s) on `asof` via
   `ctx.bar_provider.bars(universe, asof, asof, tf='1Min')`.
2. Filters to regular trading hours (13:30-20:00 UTC = 9:30-16:00 ET).
3. Computes the opening range (first `or_minutes` bars).
4. Scans for the first qualifying breakout bar (long or short), respecting
   volume and time-cutoff filters.
5. Simulates the fill, position life (with stop / TPs / trailing), and
   EOD-flat close, producing a realised return fraction and a cash-P&L
   impact.
6. Accumulates into an in-memory equity curve keyed by session date.

The custom harness reports:
- `equity_curve`: compounded daily equity series (the product of
  `1 + daily_ret` across sessions);
- `daily_returns`: the net per-session return series;
- `trades`: a list of (entry_ts, exit_ts, symbol, direction, pnl, exit_reason);
- `metrics`: Sharpe / Sortino / MaxDD / CAGR / hit-rate / profit-factor,
  computed from the daily returns series using the same
  `backend.backtest.metrics.summary_dict` the engine uses.

This makes the ORB report directly comparable to the other strategies' OOS
reports while being honest that the engine's MOO/MOC semantics don't map
to intraday. Phase 2 may add native 1-minute engine support, at which point
this module can be simplified to a conventional `generate_signals` body.

**Note:** the legacy `backend/strategies/orb.py` (class form) and
`strategy_runner.py::ORBRunner` remain in the repo as dead code until
Phase 2 deletes them per the audit. This package (`backend/strategies/orb/`)
is the only live implementation the tuner and future pipeline will use.

---

## 5. Known failure modes

- **Whipsaw days.** A valid-looking 5-min break that fails within 10 minutes
  costs 0.5–1.0% on TQQQ. Mitigated by (a) volume confirmation,
  (b) single-entry-per-day, (c) OR-low hard stop — but not fully. Whipsaw
  frequency is ~25-35% of breakout days in backtests on QQQ 2019-2024.
- **Market structure breaks.** On FOMC / NFP / CPI days the breakout edge is
  known to decay 30-50% (audit F17). The legacy implementation has a
  macro-day filter; this rewrite does **not** add one — we rely on the tuner
  to discover that the filters don't meaningfully boost OOS Sharpe. If the
  OOS Sharpe is materially below target, adding back the macro filter is a
  first-line intervention.
- **TQQQ curve-fitting.** Zarattini's paper reports > 2 Sharpe specifically
  on TQQQ 2016-2023. Replicating that number on 2023-2024 OOS on a TQQQ-only
  universe would require parameters that are tight enough to be suspicious.
  We tune on the `qqq_tqqq` universe by default and let the tuner optionally
  select `all_leveraged`; we **do not** tune on TQQQ-only.
- **Intraday data gaps / stale bars.** Alpaca's minute-bar feed is generally
  complete on RTH, but very-thin pre-RTH bars (before 9:30 ET) are filtered
  out before any OR calculation. If < `or_minutes` bars arrive in the first
  window, the day is skipped (no entry).
- **Fill realism.** Breakout-bar entries in live retail trading often slip
  5-15 bp on volatile ETFs. We bake a **2 bp slippage + 0.5 bp commission**
  into the simulated fill price on every entry and every exit. This is
  conservative relative to Zarattini's costless simulation; absolute Sharpe
  numbers will therefore be lower than the paper quotes even with
  identical parameters.
- **Survivorship / benchmark bias.** TQQQ did not exist before 2010 and has
  been partially rebalanced since. The backtest is bounded to post-2019
  data where the instrument universe is stable.

---

## 6. Expected OOS performance

Walk-forward protocol (per design-spec §7):
- Train: 2021-01-01 … 2022-12-31 (2-year window; intraday data is slow,
  a 4-year training window doubles the tuner wall-clock without changing
  the converged parameters materially).
- Test: 2023-01-01 … 2024-12-31 (24 months OOS).

Realistic OOS Sharpe band, with costs and without TQQQ-only tuning:
**0.5 - 1.2** on the `qqq_tqqq` universe; the design-spec target is
**0.70**. If the tuner converges below that, the report will document
whether it's (a) market-regime-specific (2023-2024 rangebound killed
breakout alpha, which is plausible), (b) cost-model-specific, or
(c) parameterisation-sensitive. No cherry-picking TQQQ to force the paper's
Sharpe.

---

## 7. File layout

- `spec.md` — this document.
- `__init__.py` — imports the strategy so the decorator registers on load.
- `strategy.py` — `ORBStrategy` class implementing the `Strategy` protocol
  and exposing `simulate_day()` for the custom harness.
- `config.py` — defaults + Optuna search space.
- `tests/test_strategy.py` — unit tests enumerating the invariants
  (first-break rule, single-entry-per-day, EOD flat, TP scale-outs, time
  cutoff blocks late entries, no overnight holdings).


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
