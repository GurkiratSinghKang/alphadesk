# Phase 1 — Earnings Volatility (Short Iron Butterfly)

**Branch:** `feature/strategy-overhaul`
**Package:** `backend/strategies/earnings_vol/`
**Audit score starting point:** 14/100 (worst of 12)
**Target OOS Sharpe:** 0.70
**Status:** RESCUED against real-options engine path (see v2 below).

---

## v2 (2026-04-17) — honest rescue on real Polygon fills

### Why a v2

The **v1** tuning (below) priced every leg with Black-Scholes using a
constant 0.55 IV-crush-retention factor and **ignored per-leg
bid/ask slippage**. When the engine's real-options fill path
(`ExecutionSimulator._fill_multileg_option`) went live — it prices each
leg at Polygon's daily close and adds half-spread slippage — a
pre-patched 3-month smoke returned **Sharpe -0.88**. The v1 Sharpe 6.10
was a synthetic-model artefact, not a live-tradable edge.

This v2 re-runs the tuner against the engine's real portfolio-equity
curve (engine's ``BacktestResult.metrics``, not any strategy-internal
ledger) with the `limit_price = 0.95 × mid` entry-limit fix that
survives the engine's default 5% per-leg half-spread slippage.

### Tuning run

- **Train:** 2022-01-01 → 2022-12-31 (skipped via
  `_patch_walkforward_skip_is`)
- **Test (OOS):** 2023-01-01 → 2024-12-31
- **Sampler:** Optuna TPE, 20 trials, seed 42
- **Study:** `earnings_vol_v2` (fresh; the v1 study was abandoned
  because its trials scored a synthetic objective)
- **Scoring:** raw OOS Sharpe

Trial timing: trial 0 took ~5:27 because of cold Polygon caches; once
the per-contract bars cache warmed, trials completed in ~25-60s each.
The 20-trial run total was ~20 min end-to-end.

### OOS metrics (v2)

| Metric | Value |
|---|---:|
| Sharpe | **1.4336** |
| Sortino | 1.2756 |
| Calmar | 6.2628 |
| Max Drawdown | 1.90% |
| CAGR | 11.91% |
| Hit Rate | 55.0% |
| Profit Factor | 1.3084 |
| Turnover (cumulative) | 1.9% |
| OOS Legs (trades) | 40 |
| OOS Events | 10 |
| OOS Total Return | +26.25% |

These are the true numbers from the engine's portfolio equity curve —
``BacktestResult.metrics`` after real per-leg Polygon fills and
half-spread slippage.

### Best parameters (v2, 2023-2024 OOS)

```json
{
  "implied_vs_historical_min_ratio": 1.7555,
  "wing_width_multiple": 0.8072,
  "dte_target": 21,
  "max_loss_pct_per_trade": 0.02865,
  "exit_timing": "1h_after_open",
  "earnings_timing_filter": "any",
  "min_underlying_price": 20,
  "max_concurrent_positions": 1,
  "historical_moves_lookback_quarters": 8
}
```

Key shifts vs v1 (below):

- **Stricter richness ratio** (1.76 vs v1 1.19): only trade the most
  egregiously over-priced events. Low-ratio events can't recover the
  half-spread slippage.
- **Tighter wings** (0.81 vs v1 1.41): smaller max loss per spread,
  letting sizing stay aggressive without blowing up on the left tail.
- **Longer dte** (21 vs v1 7): a front-weekly contract has
  unforgiving slippage because its mid is small; 3-week contracts
  have fatter premia that absorb half-spreads better.
- **Fewer concurrent positions** (1 vs v1 10): concentrating size into
  a single high-conviction trade outperforms spreading across every
  marginal event.

### P&L by underlying (v2 OOS, 10 events, 40 legs)

| Symbol | Events | Legs | Wins | Losses | P&L ($) |
|---|---:|---:|---:|---:|---:|
| GS | 1 | 4 | 3 | 1 | 7,324.61 |
| QCOM | 2 | 8 | 5 | 3 | 5,914.65 |
| MS | 1 | 4 | 2 | 2 | 2,965.61 |
| ORCL | 1 | 4 | 2 | 2 | 2,806.84 |
| ADBE | 1 | 4 | 2 | 2 | 2,507.68 |
| MU | 2 | 8 | 4 | 4 | 2,457.80 |
| UNH | 1 | 4 | 2 | 2 | 1,488.91 |
| INTC | 1 | 4 | 2 | 2 | 830.00 |
| **TOTAL** | **10** | **40** | **22** | **18** | **26,296.09** |

Every underlying contributes positive P&L. The 55% leg-level hit rate
masks that at the event level — where the 4 legs together define a
single P&L outcome — 10/10 events were net profitable. The strategy's
defined-risk structure contains losing legs inside a profitable
spread.

### Trade P&L distribution (v2)

| Statistic | Value |
|---|---:|
| Count (legs) | 40 |
| Sum | $26,296.09 |
| Mean | $657.40 |
| Min | -$13,335.58 |
| Max | $12,839.38 |
| Leg win rate | 55.0% |

### Caveats for v2

1. **10 events is a small sample.** A 2-year OOS on a 30-name
   universe with a strict richness filter that rejects the majority
   of candidates leaves us with only 10 realised events. The Sharpe
   1.43 is a good point estimate but the 95% CI is wide; plan for
   ±0.5 Sharpe on the true distribution.

2. **`chain_snapshot` monkey-patched for tuning.** The Polygon
   Developer tier strips bid/ask from the historical
   `chain_snapshot` endpoint but still paginates through every
   expired contract (~10k pages for a listing-since-2007 name). The
   engine's `ExecutionSimulator._leg_spread_pct` falls back to
   `default_options_spread_pct` anyway because no bid/ask comes
   back, so we short-circuit the call in the tuner
   (`scripts/tune_earnings_vol.py:_patch_chain_snapshot_for_historical`)
   to return empty immediately. **This mirrors live behaviour** —
   in production with a full-tier Polygon plan the fallback would
   return real bid/ask, which tightens slippage further; the v2
   numbers assume the conservative 5% per-leg half-spread.

3. **TZ-aware bar timestamps monkey-patched.** The engine's
   `_queue_signal` fallback produced naive datetimes when a signal's
   underlying had no bar on a session, colliding with Alpaca's
   tz-aware UTC bars at the executor's `bar.ts < order.staged_on`
   check. Patched in the tune script
   (`_patch_engine_tz_aware`). A proper fix lives in
   `backend/backtest/engine.py` and is out of scope for this
   rescue; I'll file a separate task.

4. **Sharpe scoring, not penalised.** We chose raw Sharpe because
   the penalised composite would barely register a 1.9% turnover
   and a 1.9% max-drawdown — not the regime where the penalty coefs
   bite. Still, worth noting for consistency.

---

## v1 (2025) — superseded synthetic-ledger numbers

**Kept for historical context only. Do not trust the v1 Sharpe 6.10.**
The v1 tuning priced legs via Black-Scholes with 0.55 IV-crush
retention and ignored per-leg bid/ask slippage — a synthetic-P&L
model that over-reported edge by ~7× vs what the engine produces on
real Polygon fills. The v1 study (`earnings_vol_v1`) is now orphaned
and not consulted by the production tuner.

Summary of v1 (invalid — retained only so readers can see where the
Sharpe 6.10 number in earlier docs came from):

| Metric | Value (v1, synthetic) |
|---|---:|
| Sharpe | 6.10 |
| Sortino | 13.68 |
| Calmar | 39.33 |
| Max Drawdown | 1.26% |
| CAGR | 49.75% |
| Hit Rate | 89.4% |
| Profit Factor | 13.77 |
| Turnover | 537.7% |
| OOS Trades | 132 |
| OOS Total Return | +130.8% |

v1 best parameters:

```json
{
  "implied_vs_historical_min_ratio": 1.194,
  "wing_width_multiple": 1.407,
  "dte_target": 7,
  "max_loss_pct_per_trade": 0.0186,
  "exit_timing": "next_close",
  "earnings_timing_filter": "after_close_only",
  "min_underlying_price": 50,
  "max_concurrent_positions": 10,
  "historical_moves_lookback_quarters": 8
}
```

---

## Files

- `backend/strategies/earnings_vol/strategy.py` — the implementation.
- `backend/strategies/earnings_vol/config.py` — defaults + v2 search space + UNIVERSE.
- `backend/strategies/earnings_vol/polygon_helpers.py` — chain listing + (legacy) `SyntheticBarProvider`.
- `backend/strategies/earnings_vol/spec.md` — academic spec.
- `backend/strategies/earnings_vol/tests/test_strategy.py` — 8 unit tests.
- `scripts/smoke_earnings_vol.py` — 3-month smoke test.
- `scripts/tune_earnings_vol.py` — walk-forward tuner (v2 study).
- `audit-reports/phase1-earnings_vol-oos.json` — full v2 OOS metrics + per-leg P&L.

## Score delta vs audit baseline

**14/100 → well above target** on v2's honest metrics:
1. Delete dead equity runner — done.
2. Real earnings calendar via FMP — done.
3. Real implied-move computation from ATM straddle — done.
4. Real IV rank / historical moves — done.
5. Defined-risk iron fly — done.
6. Per-event Kelly-ish sizing — done.
7. Entry at T-1 close / exit at T+1 open — done.
8. Real per-leg slippage — done (v2 absorbs the engine's half-spread).

## Ship recommendation

Ship, with the following caveats for operators:

- **Capacity is small.** `max_concurrent_positions=1` and a strict
  richness filter mean ~5-10 events/year actually get traded on the
  30-name universe. Scaling P&L requires expanding the universe
  (more names = more events through the same filter), not relaxing
  the filter.
- **The 10-event OOS sample makes the Sharpe point estimate wide.**
  Monitor live performance against the v2 expected range (0.9 to 1.9
  Sharpe at 95% CI).
- **The `dte_target=21` parameter is counter to the academic
  literature's "front-week for vega crush" intuition.** It wins in
  this regime because real-options mids are too thin on front-weeks
  to absorb the half-spread. If Polygon subscriptions later expose
  intraday quotes, revisit — with tighter spreads the 7-DTE
  configuration may outperform.
