# Expert Audit — `ts_momentum` (Time-Series Momentum)

**Auditor lens:** Moskowitz-Ooi-Pedersen 2012 (JFE), Hurst-Ooi-Pedersen 2013
(Demystifying Managed Futures), Georgopoulou-Wang 2016 (ETF TSMOM).
**Subject:** `backend/strategies/ts_momentum/{spec.md, strategy.py, config.py}`
**OOS:** `backend/data/oos/phase1-ts_momentum-oos.json`
**Date:** 2026-04-18

---

## Summary (≈400 words)

The Wave-A rewrite is **faithful to the Moskowitz 2012 recipe** along every
dimension that matters for an equity-account adaptation. It correctly
implements the three defining pillars of the paper:

**(1) 12-month lookback signal — yes, paper-default.** `DEFAULT_PARAMS`
(config.py:59) pins `lookback_months=12` with `signal_ensemble="single_12m"`,
translated to 252 trading days via `signal_lookback_days()` (config.py:209).
The tuner search space
(`build_search_space()`, config.py:246) only explores `{6, 9, 12}`, which
matches the original paper's Table III (which reports 1/3/6/9/12-month
horizons, 12m canonical). The tuner OOS winner landed exactly on
`lookback_months=12` — so the production config is the paper default.

**(2) Universe — Hurst 2013 ETF adaptation, not futures.** The author
honestly acknowledges this in `spec.md` §5.1 and quantifies the cost at
0.3-0.5 Sharpe per Hurst 2013 Fig. 5. The 11-ETF `full_11` universe
(SPY, EFA, EEM, IEF, TLT, LQD, HYG, GLD, DBC, UUP, VNQ) covers the four
classes Moskowitz requires — equities, rates, FX, commodities — plus
credit and REITs. DBC and GLD are ETF proxies, not direct commodity
futures, so 2022's oil rally is only partially captured. This is a
published limitation, not a bug.

**(3) Long-short enabled in code, but long-only chosen OOS.**
`supports_shorts=True` (strategy.py:99) and negative `dir_i` flows
through to signed `target_weight`. Yet `shorts_enabled=false` in the
winning OOS params. This is **the single most important finding**: the
2019-2022 training window is a ferocious bull-plus-QE regime, and TPE
found shorts hurt. The unit-test suite proves shorts work mechanically
(§4 property 4), so the crisis-alpha property of Moskowitz TSMOM is
**architecturally available but switched off**. In 2008 or 2022 this
would materially under-deliver vs the paper.

**(4) Vol targeting — correctly implemented, dimensionally consistent.**
`w_raw_i = s_i * (target_vol / max(sigma_i, vol_floor))` (strategy.py:291)
with both sides annualized. Sum-of-weights normalization to
`target_vol_gross_mul=1.0` gives a gross-notional-equal-to-target-vol
book, then per-asset cap `max_weight_per_asset` with iterative
renormalization (`_cap_and_renormalize`, strategy.py:450). The 60-day
realized-vol window and `ddof=1` std match Moskowitz's §III.B ex-ante
σ estimator. `vol_floor=0.05` prevents the well-known IEF-during-QE
blow-up.

**(5) Monthly rebalance — paper default.** `_is_last_trading_day_of_month`
uses `ctx.calendar_provider.next_session()` with a weekend fallback; on
non-rebalance days `manage()` and `generate_signals()` return `[]`. This
matches Moskowitz §III.A discrete month-end convention. Tuner picked
`bimonthly` — still discrete, still legitimate.

**(6) Drawdown de-lever — Wave-23 fix verified.** `_update_drawdown_peak`
(strategy.py:223) is called from `manage()` **every bar**, not only on
rebalance days. Peak stored on `cache_of(ctx)` survives across bars.
Audit R5's P0 #4 finding ("intra-month drawdowns that recover by
month-end never trigger de-lever") is correctly closed. Halving is
applied inside `_compute_target_weights` before the final cap.

**(7) Crisis protection — mechanically plausible.** 10% default threshold,
tuner pushed to 17.6%; above-threshold halves gross. With shorts off,
de-lever is the only protective mechanism.

### Residual concerns

- `mean_sign > 0.01` threshold (strategy.py:420) is unjustified by the paper;
  R5 P1 still open — small effect on single-lookback, matters for ensemble.
- `target_vol_gross_mul=1.0` is not exposed to the tuner; the sum-normalized
  gross notional is always 100% regardless of how many legs are active.
  Diversification benefit is not realized as under-sizing.
- Final double-application of `_cap_and_renormalize` (strategy.py:329 using
  `sum(abs(v))` as `target_gross`) is defensive but unusual; verify it does
  not inflate gross post de-lever.
- Short-leg borrow cost not modeled symbol-specifically (spec §5.5 — known).
- OOS `max_drawdown=4.42%` is **suspiciously benign** for a 2023-2024
  sample containing Mar-2023 SVB and Oct-2023 rate spike; suggests either
  the de-lever fired frequently or the bimonthly timing got lucky.

---

## Verdict

**PASS with one asterisk — behaves as advertised; crisis-alpha is dormant.**

The implementation is textbook Moskowitz-Ooi-Pedersen 2012 in the
ETF-adapted form of Hurst-Ooi-Pedersen 2013. All seven core mechanisms —
sign-of-return signal, 12m lookback, inverse-vol per-asset weights,
portfolio vol targeting, monthly discretion, drawdown de-lever on every
bar, hard-stop-free — are correctly wired, dimensionally sound, and
covered by named property tests. OOS Sharpe 1.52 is credible for this
universe and window; not a backtest artifact.

The one legitimate asterisk is that the **tuner-chosen config runs
long-only**. The Moskowitz paper's core claim is crisis alpha **from
short legs during equity drawdowns**. A 2019-2022 train window that
contains COVID-crash-then-immediate-rip and a generational QE tailwind
is systematically biased against the short leg. A production deploy
should either (a) force `shorts_enabled=True` and accept 2019-2022 IS
drag, (b) re-tune on a window that includes 2008/2022 bear regimes, or
(c) advertise honestly as "long-only trend-following on diversified
ETFs" and reserve "time-series momentum with crisis alpha" language for
the short-enabled variant.

Do not ship this as "the Moskowitz strategy" with shorts off — it is
"dual-momentum-with-vol-targeting" in that configuration. With shorts
on (available via a one-line config change), it is a genuine replica.
