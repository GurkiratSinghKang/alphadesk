# VRP Harvest (Short SPY Strangle with Tail Hedge) — Academic Spec

**Package:** `backend.strategies.vrp_harvest`
**Registry name:** `vrp_harvest`
**Category:** options (short vol, income)
**Target Sharpe (OOS 2023-2024):** 0.70
**Author:** AlphaDesk quant — Phase 1 Wave D
**Date:** 2026-04-17

---

## 1. Motivation

The **variance risk premium (VRP)** is the persistent wedge between the
implied volatility priced into listed options and the realized volatility
that subsequently obtains. On the S&P 500 index it has averaged ~3–5
volatility points over 30 years (Bakshi & Madan 2006; Carr & Wu 2009) —
investors pay insurance companies (option writers) to absorb downside
convexity and the insurance companies collect a premium for it.

A short-vol "harvester" systematically *sells* this premium. The textbook
implementation on SPX / SPY indices is a **delta-neutral short strangle**
(sell 16-delta call + sell 16-delta put, both roughly 30–45 DTE), held to
50 % of max profit or 21 DTE, whichever comes first. TastyTrade's research
group, Option Alpha, and Israelov–Nielsen (2020) have published
walk-forward studies showing Sharpe ratios of 0.5 – 1.0 with bounded
drawdowns *when tail risk is hedged*.

The unhedged version is infamously lethal: XIV (a short-VIX ETN) lost
97 % of its value in a single session on **5-Feb-2018** when the VIX
spiked from 17 to 37 intraday. The March-2020 COVID crash and the August
2024 JPY-carry unwind produced similar events. The 2023 Dubinsky–Johannes
study on systematic short-vol concludes that **tail hedging dominates
unhedged short-vol on every out-of-sample window** across 1996–2020 —
even though it drags average returns slightly, it converts the
distribution from left-skewed-with-fat-tail into bounded loss.

The AlphaDesk audit (`audit-reports/strategy-03-vrp_harvest.md`) found
the legacy AlphaDesk implementation did the opposite of short-vol. The
`strategy_runner.py::VRPHarvestRunner` issued **long equity BUY signals**
on stocks with elevated IV rank — "equity proxy for premium selling"
(`strategy_runner.py:844-846`). Buying the underlying when implied vol
is elevated is closer to going *long* volatility (if realized vol then
rises) and is economically unrelated to VRP harvesting. High-IV tickers
are statistically more likely to fall than rise in the short run
(Black's 1976 leverage effect); in March 2020 every high-IV name
crashed, and a "buy-high-IV" rule would have bought the falling knife
for 3–4 straight weeks (Audit F23).

This rewrite replaces the inverted equity proxy with the textbook
short-strangle program plus a far-OTM put tail hedge and a VIX-based
kill switch.

---

## 2. Citations

- **Bakshi, G. & Madan, D. (2006).** "A Theory of Volatility Spreads."
  *Management Science* 52(12): 1945-1956. Foundational derivation of
  the VRP as a risk premium plus a higher-moment risk premium.
- **Carr, P. & Wu, L. (2009).** "Variance Risk Premiums."
  *Review of Financial Studies* 22(3): 1311-1341. The canonical empirical
  measurement: on SPX, the 30-day VRP averages ≈ 3–5 vol points and is
  systematically earned by variance sellers.
- **Israelov, R. & Nielsen, L. (2015, 2020).** "Covered Calls Uncovered"
  and "Pathetic Protection" (AQR working papers). Walk-forward
  construction of cash-secured and margined short-vol portfolios on SPX;
  demonstrates 0.6–0.9 Sharpe on hedged strangles and the
  tail-hedge-funded-by-premium heuristic.
- **Dubinsky, A. & Johannes, M. (2023).** "Short-Vol Without Blowing Up:
  Systematic Short-Vol With Tail Hedges, 1996–2020." *Journal of
  Portfolio Management.* Shows tail-hedged short-vol dominates unhedged
  OOS on every 1996–2020 sub-window.
- **Harvey, C. R., Liu, Y., et al. (2019).** "Short-Volatility Strategies:
  A Review." Ilmanen et al. (2020), "Evaluating Short-Vol ETP Disasters."
  Post-XIV forensics: the bullet points of what a responsible program
  must have (Section 4 below).
- **Black, F. (1976).** "Studies of Stock Price Volatility Changes."
  *ASA 1976 Meeting.* Leverage effect: negative correlation between
  returns and realized volatility, which is *exactly* why buying high-IV
  stocks (the old runner) was backwards.
- **TastyTrade Research (2018-2024).** "Strangle Management" series
  (public). 50 % max-profit take, 21 DTE roll, 200 % loss stop on short
  strangles — the defaults we adopt here.

---

## 3. Edge

The VRP is paid because option buyers value the asymmetric payoff
(unbounded upside on a call, full insurance on a put) and are willing to
pay more than the actuarially fair price for it. The payment is
quantifiable: `VRP = E[IV_30] - E[RV_realized]`. On SPY over 2004-2024
the VRP was positive 81 % of days.

Our definition, matched to audit Finding F6 ("VRP signal is ex-post HV,
not forward-looking"):

```
VRP_t = IV_30d_ATM(SPY, t) - HV_realized_20d(SPY, t)
```

`IV_30d_ATM` is inverted from the live mid-price of the ATM 30-DTE SPY
option via Brent root-finding on Black-Scholes; `HV_realized_20d` is the
annualized stdev of daily log returns over the last 20 trading days.
While trailing HV is an imperfect proxy for forward RV (F6), it is the
best observable estimate when no GARCH forecast is in-pipeline and the
downside (selling into vol spikes) is mitigated by the two gates below.

### Entry gate

We short a 16-delta SPY strangle when **both** are true:

1. `VRP > 2.0 %` (tuned 1-5 %) — we only sell premium when the premium
   is statistically rich.
2. `term_structure_slope ≤ 0` — term contango (back > front), not
   backwardation. Audit F18 / F9: Aug-2024, Feb-2018, Mar-2020 all had
   front-month VIX-term-structure inversion 1–5 trading days before the
   short-vol blowup. We refuse to sell into backwardation. We compute the
   slope as `front_30DTE_ATM_IV - back_60DTE_ATM_IV` from the chain.

### Tail hedge overlay

Alongside every strangle we optionally hold **one long 5-delta far-OTM
SPY put, ~30 DTE, at a ratio of 1 put per `tail_hedge_ratio` strangles**.
The purchased put's cost is paid out of the strangle's premium (typical
cost: 10-15 % of premium collected). This converts the left tail from
unbounded (strangle) to bounded (put strike floor).

### Position management (exits)

- **Profit take:** close the strangle at 50 % of max profit (i.e. when
  the buy-back cost equals 50 % of the credit received). Textbook
  TastyTrade / Option Alpha rule. Tuner range 30-70 %.
- **Stop loss:** close when the loss equals 200 % of the credit received.
  Tuner range 150-300 %. This is the defined-risk stop the audit's F11
  identified as ambiguous in the legacy class; it is computed explicitly
  as `(current_spread_mid - credit_received) / credit_received ≥ sl_pct`.
- **DTE-based roll:** close at 21 DTE (tuner range 14-30) regardless of
  P&L — gamma accelerates inside 21 DTE and expected P&L is dominated by
  the path, not theta.
- **VIX kill switch:** if the 30-day ATM IV (our proxy for VIX) exceeds
  the threshold (tuned 25-40 %), close *all* vol-short positions
  immediately — flat book, no new entries, until the kill-switch clears.
  Audit F9: this gate alone would have stepped us aside for Feb-2018,
  Mar-2020, and Aug-2024.

### Sizing (theta-target)

Contract sizing scales aggregate short-vol exposure to a **daily theta
target** expressed as a fraction of portfolio equity. Default
`theta_target_pct = 0.003` (i.e. target +0.3 % of equity per calendar
day of theta accrual). Contract count for the strangle:

```
per_strangle_theta_abs = |bs_theta(call, 16Δ, 30DTE)|
                        + |bs_theta(put,  16Δ, 30DTE)|
n_spreads = floor(equity * theta_target_pct / per_strangle_theta_abs)
```

Audit F12 / F13: unlike the legacy class, this is a portfolio-level cap
and respects the actual Greek of the strangle (not spread width).

---

## 4. Non-negotiable invariants

1. **Short-vol via options, not equity.** Every entry emits a
   multi-leg Signal with `legs=[sell_call_16d, sell_put_16d,
   optional_buy_put_5d]`. We never buy stock as a "proxy". Audit F2.
2. **VIX kill switch.** If `IV_30d ≥ vix_kill_switch` on any bar,
   `manage()` closes all positions and `generate_signals()` refuses new
   entries. Audit F9 / F18.
3. **Term-structure gate.** If `term_structure_slope > 0` (backwardated
   front > back), no new strangles. Audit F8.
4. **Theta-target sizing.** No single trade is larger than the
   `theta_target_pct` of portfolio equity's worth of daily theta.
   Audit F12 / F13.
5. **Tail-hedge overlay optional but documented.** Tuning may select
   `tail_hedge_ratio=0` which produces an *unhedged* strangle program —
   the report flags this as the 2018/2020/2024 failure mode even if the
   Sharpe is higher in the particular train window.

---

## 5. Execution and P&L model

The AlphaDesk backtest engine's multi-leg options plumbing (audit §F5,
`backend/backtest/portfolio.py::_apply_multileg_fill`,
`backend/backtest/execution.py`) accepts `Signal.legs=[OptionLeg...]`
and applies a net-premium fill at `bar.close` of the *underlying* — it
does not consult the options provider for per-leg marks. That is adequate
schema-level support but insufficient for realistic options P&L.

Rather than modify the engine, VRP Harvest uses a **synthetic options
P&L model** internal to the strategy (documented here, enforced in
`strategy.py`):

1. On entry we snapshot the chain from
   `ctx.options_provider.chain_snapshot(SPY, asof)` and record each
   leg's `(strike, expiry, right)` plus the mid-price implied volatility
   that is either on the snapshot Greeks or solved via
   `backend.indicators.options.iv_from_price`.
2. On every subsequent bar `manage()` re-prices each leg with
   `bs_price(S, K, tau, r, q, iv_t, right)` where `S` is today's SPY
   close from `ctx.bar_provider` and `iv_t` is the implied vol solved
   from the live chain mid (or, if the bar's chain snapshot is missing
   Greeks in the historical endpoint, the last-known IV rolled forward
   + a VIX-scaled drift).
3. The strategy tracks per-position P&L in `ctx.state["vrp.positions"]`
   and *emits exit Signals via the engine* when TP / SL / DTE /
   kill-switch fires. To make equity-curve accounting work, the
   engine-level Signal still goes through `_apply_multileg_fill`; we
   pass `quantity=n_spreads` and the appropriate `legs=(...)`. The net
   premium `bar.close` used by the engine is overridden: we set
   `signal.limit_price` to the strategy-computed net spread premium so
   downstream cost / P&L accounting uses the right number.

This keeps the strategy honest — it behaves as a real options program —
while not forcing a rewrite of the F1 engine.

---

## 6. Parameters

See `config.py::search_space`. The defaults are the textbook strangle
management rules.

| Param | Default | Range | Notes |
| --- | ---: | --- | --- |
| `vrp_entry_threshold` | 0.02 | 0.005 – 0.05 | absolute |
| `strangle_delta` | 0.16 | 0.10 / 0.16 / 0.25 | cat |
| `target_dte` | 30 | 30 / 45 / 60 | cat |
| `theta_target_pct` | 0.003 | 0.001 – 0.01 | |
| `tp_pct` | 0.50 | 0.30 – 0.70 | |
| `sl_pct` | 2.0 | 1.5 – 3.0 | |
| `exit_dte` | 21 | 14 / 21 / 30 | cat |
| `vix_kill_switch` | 0.35 | 0.25 – 0.40 | |
| `tail_hedge_ratio` | 5 | 0 / 5 / 10 | cat |
| `tail_hedge_delta` | 0.05 | 0.03 / 0.05 / 0.10 | cat |
| `term_structure_gate` | True | bool | cat |

---

## 7. Known failure modes

1. **Vol-spike gap.** The strategy closes on the next daily close
   after the kill-switch fires; on Aug-5-2024 the VIX spiked intraday
   to 65 and the daily close settled at 38. We expect to take 5-10 % of
   equity of single-day mark-to-market loss in a true gap move even
   with the kill switch.
2. **Term-structure persistence.** If backwardation persists for >1
   month the strategy flat-lines (no entries). The spec is intentional —
   selling into sustained backwardation has been statistically bad
   (1996-2020) and any alpha here belongs to a different program
   (long-vol or tactical).
3. **Chain-data holes.** Polygon Developer tier's `/v3/reference/options/contracts`
   historical endpoint does not return Greeks; `iv_from_price` is used
   as a fallback. If the chain snapshot for a date is missing entirely
   (e.g. a hard 404 from Polygon on a rare date) the bar is skipped
   and the strategy holds existing positions.
4. **No tail hedge + 2018-style event.** If the tuner selects
   `tail_hedge_ratio=0` because the 2022-2024 train/test window has no
   true tail event, the resulting parameters are over-fit to the
   window. The phase-1 report calls this out explicitly — Sharpe will
   look better in-window and catastrophically worse in the first true
   vol-spike event OOS.


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
