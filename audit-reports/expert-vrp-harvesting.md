# Expert Audit — VRP Harvest Strategy

**Strategy:** `vrp_harvest` (formerly the inverted `VRPHarvestRunner`)
**Files audited:**
- `backend/strategies/vrp_harvest/spec.md`
- `backend/strategies/vrp_harvest/strategy.py` (1317 lines)
- `backend/strategies/vrp_harvest/config.py`
- `backend/strategies/vrp_harvest/provider.py` (`BoundedPolygonOptionsProvider`)
- `backend/data/oos/phase1-vrp_harvest-oos.json` (6-month 2024-H2 OOS)
- Prior audits: `audit-reports/strategies-logic-audit-r5.md` (Wave 23 kill-switch fail-open fix) and `audit-reports/strategies-audit-r3.md`.
- Reference OOS artifact: `audit-reports/phase1-vrp_harvest-oos.json`, `audit-reports/phase1-vrp_harvest.md`.

**Author perspective:** quant/options trader — VRP theory grounded in
Bakshi-Madan (2006), Carr-Wu (2009), Dubinsky-Johannes (2023),
Israelov-Nielsen (2020), Harvey-Liu-Ilmanen (2019).

---

## 1. Is the edge actually VRP?

**Yes — this is genuine variance-risk-premium harvesting, not a covered-call
proxy.** Every entry emits a multi-leg `Signal` with `legs=(SELL call 16Δ,
SELL put 16Δ, optional BUY put 5Δ)` (strategy.py:316-412). The legacy
`VRPHarvestRunner` that issued *long-equity* BUY signals on high-IV names
(documented audit F23, ancestor file `strategy_runner.py:844-846`) is
genuinely retired. The signal itself is the Carr-Wu VRP proxy
`IV_30d_ATM(SPY) − HV_realized_20d(SPY)` computed bar-by-bar against Polygon
chains and Alpaca bars (strategy.py:273, `_atm_iv` at 721-751, `_hv_20` at
655-673). No equity notional is transacted. VRP is the edge; the
implementation is the textbook vehicle.

## 2. Structure

**Delta-neutral short SPY strangle (16Δ call + 16Δ put, ~30 DTE)** with an
optional long 5Δ far-OTM put as a separate tail-hedge line item. **This is
NOT an iron condor or iron butterfly** — there is no fixed-width protective
call wing. The put-side "wing" is a 5Δ put (far OTM, deep tail) at a 1:5
ratio to strangles (config.py:54, `tail_hedge_ratio=5`, `tail_hedge_delta=0.05`).
Call-side tail is unprotected — the program assumes the left tail is the
dominant risk (correct per Carr-Wu leverage-effect skew) and sizes the hedge
accordingly.

## 3. IV rank gate — not implemented

The typical textbook short-strangle program uses an **IV rank ≥ 50
percentile** gate to sell premium only when implied vol is statistically
rich within its own history. This code uses an **absolute VRP threshold**
(`vrp_entry_threshold = 2 % default`, config.py:26). That is a legitimate
and arguably cleaner formulation (a 2-point IV-HV wedge is already rich by
Carr-Wu's 3-5-point long-run mean), but it is NOT percentile-ranked. An
absolute floor of 2% underweights 2017-19-style calm-vol regimes (where
everything sits at 8-12% IV and the 2-point wedge rarely clears) and
overweights crisis regimes where the wedge is wide but the kill-switch
should already be flat. Acceptable but worth the caller's awareness.
Additionally, `min_iv_30 = 0.08` (config.py:28) acts as an IV floor but
not a rank.

## 4. Wing width

**This strategy does not have a fixed-width condor/butterfly wing.** The
persona-flagged "0.81× vs spec 1.5×" issue applies to `earnings_vol`
(`wing_width_multiple`), not `vrp_harvest` — confirmed by
`strategies-audit-r3.md:205-208`. **Not a bug here.** However, the
functional equivalent — tail-hedge delta (`tail_hedge_delta = 0.05`,
config.py:56) — is appropriate (5Δ ~ 3σ), and `tail_hedge_ratio` defaults
to 5. The search space does allow `tail_hedge_ratio=0` (config.py:91),
which removes the hedge entirely and reverts to an unhedged XIV-style
strangle. **If the tuner selects 0, the program is economically the 2018
blow-up template.** The spec flags this (spec.md:262-267) but does not
hard-forbid it; a principled production deployment should pin
`tail_hedge_ratio ≥ 5` as a non-tunable invariant.

## 5. Kill-switch (Wave 23 fix verified)

**Correct per Wave 23.** Prior R5 audit flagged: if the chain fetch fails
during a crisis, `iv_30 is None → kill_active=False`, and the strategy
would hold short-vol blind through a Mar-2020-style chain-data outage.
The current code (strategy.py:439-460) fails **CLOSED**: after
`kill_switch_missing_sessions_max = 2` consecutive sessions of missing IV,
the kill-switch trips and flats the book even without a fresh mark (using
the entry credit as the exit limit-price anchor). Single transient misses
do not churn the book. **Logic is sound.** Minor nit: `price_for_exit =
abs(credit_per_spread)` (strategy.py:498) is a crude placeholder — in a
true crisis the actual mark-to-market debit will massively exceed this,
so the reported exit P&L in the ledger will understate losses until the
real fill anchors it.

## 6. Assignment / early exercise

**Not handled.** No code path for early-exercise of the short put on a
crashing market, no pin-risk handling at expiry, no ITM-expiration
settlement logic. Polygon chain data does not flag assignment events; the
engine's `_apply_multileg_fill` has no assignment model. Mitigation: the
21-DTE `exit_dte` rolls positions well before expiry (strategy.py:530),
so pin/exercise risk is largely neutered in normal paths. But if the
kill-switch fails to fire intraday and a short put goes 5% ITM, the
strategy cannot model Friday-close auto-exercise. In paper-trade this is
cosmetic; in live it is a material execution-path gap. **Flag for Phase 2.**

## 7. Options data provider

`BoundedPolygonOptionsProvider` (provider.py) narrows Polygon Developer-tier
`/v3/reference/options/contracts` to the 30/60-DTE expirations and
±12-25% strike window. Reliable, cached on disk, concurrency-safe via
`contextvars` (per `concurrency-audit-r4 P0 #1`). **Critical quality gap:**
bid/ask are synthesised as `last × 0.95 / last × 1.05` (provider.py:224-225)
— a fabricated 5% half-spread. Real SPY weekly wing spreads are often 1-3%;
far-OTM 5Δ puts can be 10-20% wide. Entry-credit numbers are therefore
optimistic at the ATM legs and pessimistic at the tail-hedge leg, with the
net bias unclear. Polygon Developer also returns no Greeks and no
intraday-quote history. The strategy solves IV via Brent root-finding
(strategy.py:764-809), which is correct but amplifies any mid-price noise.

## 8. Position sizing

**Theta-target sizing** (strategy.py:1028-1040): `n_spreads =
floor(equity × theta_target_pct / per_strangle_theta)`, default
`theta_target_pct = 0.003` (30 bps/day). This is the **right Greek for
this strategy** — it caps theta exposure, which is the premium-rate being
harvested. It does NOT cap vega or gamma, which is where the blow-up risk
lives. A more defensive implementation would additionally cap vega
exposure at ~`0.5%` of equity per 1-vol move. **Not a bug, but a
conservatism gap.** Hard cap `max_spreads_per_entry = 20` (config.py:41)
is a belt-and-suspenders floor.

## 9. OOS evidence (`phase1-vrp_harvest-oos.json`)

Six-month 2024-04 to 2024-09 OOS: Sharpe 0.876 (+0.17 above 0.70 target),
10 strangles opened, 10 hedges, 18 exits — **all 18 via DTE-roll.** Zero
TP exits, zero SL exits, zero kill-switch firings observed — TP/SL/VIX
branches are untested OOS. The Aug-5-2024 JPY-unwind VIX spike (16→65
intraday) was stepped aside by the entry-gate kill-switch (2024-08
monthly return = 0.00%), which is the intended behaviour but means we
still have no empirical evidence of the exit-side kill-switch firing.
Small-sample caveats apply (10 strangles, half-year window).

---

## Verdict

**APPROVED WITH RESERVATIONS.** This is a mechanically correct, textbook
implementation of tail-hedged short SPY strangle harvesting — a substantial
improvement over the 18/100-scored legacy "buy high-IV equity" ancestor.
The VRP signal, entry gates (term-structure contango + absolute VRP
threshold + IV floor), theta-target sizing, 16Δ leg selection, and the
fail-closed kill-switch are all on solid academic footing. The rewrite
retires the F23 "long equity on high IV" inversion that would have caught
every falling knife in Mar-2020.

**Wing width is NOT flagged.** The 0.81× persona concern applies to
`earnings_vol`, not `vrp_harvest`. The equivalent risk vector here —
`tail_hedge_delta` — is set to 5Δ with a 1:5 ratio by default, which is
reasonable. However, the Optuna search space permits `tail_hedge_ratio=0`,
which produces an unhedged XIV-template strategy — the 2018 failure mode.
**Pin this parameter to ≥5 as a non-tunable invariant before live
deployment.**

**Open gaps for Phase 2:** (a) synthesised 5% bid/ask spreads materially
understate transaction costs on the 5Δ tail-hedge leg; fix with Polygon
Starter quote history or model-based spreads; (b) no assignment /
early-exercise / ITM-expiration handling (mitigated by 21-DTE roll);
(c) no vega cap alongside theta target; (d) no intra-day kill-switch —
daily-bar kill will miss the 16→65 gap event by a full session; spec
admits this (spec.md §7.1); (e) all OOS exits via DTE-roll — TP/SL paths
are untested empirically; (f) absolute-VRP vs. percentile-IV-rank gate is
a philosophical choice, not a bug, but blends poorly with the existing
`min_iv_30` floor.

This strategy is safe for paper trading at the current default
parameters. Do not pass to live capital until the tuner is pinned, the
bid/ask spread model is realistic, and at least one full OOS window
includes a true tail event (Feb-2018, Mar-2020, or a synthetic
bootstrap thereof).
