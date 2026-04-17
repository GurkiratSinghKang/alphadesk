# Strategy Audit 03 — VRP Harvest

**Strategy ID:** `vrp_harvest` (route id `vrp-harvesting`)
**Auditor persona:** Quant vol trader, 15+ yrs VRP harvesting (VIX/VXX/SPX options)
**Files audited:**
- `backend/strategies/vrp_harvest.py` (the "intended" options implementation)
- `backend/strategies/base.py`
- `backend/strategies/__init__.py`
- `backend/data/ingestion/strategy_runner.py` (the "actual" runner executed by the pipeline)
- `backend/api/routes/strategies.py`
- `backend/api/routes/options.py` (IV/chain data source)
- `backend/api/routes/screener.py` (what `_get_screener_results` returns)
- `frontend/src/lib/strategies.ts`, `frontend/src/lib/strategy-content.ts`
- `big_run_result.json`, `multi_strategy_result.json`, `backend/data/pipeline_logs/2026-04-10.json`
- `STRATEGY_RESEARCH_REPORT.md`

---

## Executive Summary

AlphaDesk ships **two** VRP Harvest implementations that should not be conflated.

1. **`backend/strategies/vrp_harvest.py` — `VRPHarvestStrategy`** (the one the user pointed us at). This is a textbook-looking, options-based class that builds iron condors / bull put spreads with a 16-delta short, 45 DTE, 50% profit target, 21 DTE roll, and a 2x-credit stop. It is structurally correct at the schematic level but **never executes real options trades**: `map_to_trade` returns a dict of pseudo-legs, none of which are routed to a broker; there is no options order endpoint in the codebase (Alpaca OPRA is read-only in `routes/options.py` and Alpaca equities does not accept multi-leg option orders from this app).
2. **`backend/data/ingestion/strategy_runner.py` — `VRPHarvestRunner`** (what actually runs in the pipeline and is registered in `ALL_STRATEGIES`). This is an **equity proxy**: when a large-cap has IV rank > 60 and composite > 50, it issues a **long equity "buy" signal** — the literal opposite of short-vol. It never sells premium, never touches an option chain, never hedges delta, and never detects term-structure inversion. The "VRP" rationale is a string in the trade note.

The user-facing description in `strategy-content.ts:91-127` promises a 16-delta delta-neutral strangle strategy with VIX term-structure gating and portfolio vega caps. The backend delivers neither. **This is a severe disclosure/implementation mismatch.** In production at tradingalpha.net the strategy page advertises short-vol and the order blotter, if this strategy ever fired, would be buying underlying stock.

Separately, even as pure intent, the `VRPHarvestStrategy` class has survival-critical gaps: no VIX term-structure check (only intra-chain per-name check), no portfolio-level vega or gamma cap, stop-loss is stated as "2x credit" but the `manage()` function compares it against a `pnl_pct` field whose definition never includes credit received, sizing uses notional/max_risk but ignores buying-power reduction and vega concentration, there is no long-tail-hedge overlay, and earnings gating is a single 14-day flag with no macro-event (FOMC/CPI) or VIX gate. Against the 2018/2020/2024 VRP blowup template, this design would not have survived Feb 2018 or March 2020 in its current form — even if it could fill options.

**Score: 18 / 100.** The options class is a schematic mock; the equity proxy that actually runs is the opposite sign of the advertised trade.

---

## Textbook (what a VRP strategy should look like)

A production VRP harvester has these minimum ingredients; they are the consensus of the post-XIV literature (Harvey–Liu, Ilmanen, Sinclair, Eraker, Israelov–Nielsen):

- **Signal.** VRP = IV − expected future RV, not IV − trailing RV. Typical proxy: VIX vs. rolling 20-30d realized on SPX (Parkinson / Yang–Zhang for intraday precision). Decision is on the *forward-looking* premium, not ex-post residual.
- **Regime gate.** Step aside when VIX term structure inverts (VXX/VIX contango ratio < 1; e.g. `VIX9D/VIX > 1` or `M1/M2 > 1` on /VX futures). In Aug 2024, Feb 2018, and Mar 2020, front-month inversion preceded the VRP crash by 1–5 days.
- **Instruments.** SPX/SPY index options (not single-names, which have idiosyncratic blowup risk), or VIX futures short rolled on the term structure. Iron condors and put spreads are defined-risk substitutes; **strangles are undefined** and were the XIV killer.
- **Sizing.** Vol-targeted (scale notional by 1/σ to maintain stable portfolio vega); buying-power aware; hard cap on aggregate short vega (e.g., portfolio vega ≤ 0.3% of NAV per 1-vol-point move); concentration limit per underlying.
- **Delta hedging.** Daily delta recenters for strangles/naked short puts. Condors/spreads need monitoring but not continuous hedging.
- **Tail hedge overlay.** Long far-OTM put wings (6–10% OTM, 3–6 months) to cap tail; some implementations spend 10–20% of premium collected on convexity.
- **Exit.** 50% profit take, 21 DTE roll, 2.0–2.5x credit stop, *and* a "vol spike" circuit breaker (e.g., VIX > 40 → close everything regardless of P&L).
- **Earnings / event gate.** No single names near earnings; for indices, no positions straddling FOMC/CPI with short gamma concentration.
- **Expected performance (2019-2024).** Sharpe 0.5–0.8 after tail hedges; pre-tail-hedge Sharpe ~1.0 with a −30%+ drawdown (XIV was −97% in one day).

---

## What AlphaDesk does

### The intended options class — `backend/strategies/vrp_harvest.py`

- Class registered in `backend/strategies/__init__.py:6,20` as `"vrp_harvest"`.
- `screen()` (`vrp_harvest.py:28-58`) filters by `iv_rank ≥ 40`, current_iv − hv_20 ≥ 3 vol pts, `days_to_earnings ≥ 14`, `avg_option_volume ≥ 1000`. Top-30 by composite.
- `analyze()` (`vrp_harvest.py:60-90`) scores `iv_rank*0.5 + vrp*200`, +10 for contango, +10 for IV percentile > 70. Picks `iron_condor` if `iv_rank > 60` else `put_spread`.
- `generate_signal()` (`vrp_harvest.py:92-105`) returns a neutral signal if score ≥ 35 and conviction not "low".
- `map_to_trade()` (`vrp_harvest.py:107-148`) emits pseudo-legs (buy/sell, call/put, delta target) with `spread_width = 5.0` and contracts = `(equity * 0.02) / 500`. **No exchange-symbol strike lookup, no actual routing.**
- `manage()` (`vrp_harvest.py:150-176`) compares a `pnl_pct` scalar to the profit target, stop, and DTE.
- The call to `map_to_trade` from this file is **never invoked by the live pipeline**. See next section.

### The runner that actually executes — `backend/data/ingestion/strategy_runner.py`

- `ALL_STRATEGIES` in `strategy_runner.py:3440,3443` registers `VRPHarvestRunner`.
- `daily_pipeline.py:30,798,801` imports and iterates `ALL_STRATEGIES` from `strategy_runner`, not from `backend/strategies`.
- `VRPHarvestRunner.screen()` (`strategy_runner.py:812-814`) pulls demo-screener equity dicts whose `iv_rank` is a `random.uniform(10, 90)` value (`screener.py:208`). No real chain, no real HV.
- `VRPHarvestRunner.analyze()` (`strategy_runner.py:816-848`) emits `signal = "buy"` (long equity) for `iv_rank > 60 and composite > 50`.
- `generate_trades()` in the base class (`strategy_runner.py:353-432`) converts each "buy" signal into a `master.request_trade(..., side="buy", ...)` — a **long stock** order. There is no options leg anywhere in the flow.
- Rationale literally calls itself an "Equity proxy for premium selling." (`strategy_runner.py:844-846`).

### User-facing description — `frontend/src/lib/strategy-content.ts:91-127`

Promises: 16-delta delta-neutral strangle, vega-capped portfolio, VIX term-structure inversion gating, 50%/21-DTE/2x exits, IV rank > 50 filter. None of this is in `VRPHarvestRunner`; most is stubbed but unused in `VRPHarvestStrategy`.

### Route registration — `backend/api/routes/strategies.py:157-169, 514`

Shows status=ACTIVE and description "Volatility Risk Premium harvesting through systematic short options strategies. Sells put spreads on liquid large-caps when IV rank is elevated." This is surfaced on the live `/strategies` route.

### Observed pipeline output — `backend/data/pipeline_logs/2026-04-10.json:106-135`

```
"vrp_harvest": { "screened": 20, "analyzed": 2, "trades_requested": 0, "trades_approved": 0 }
```
Both analyses are `signal: "hold"` on MRK and COIN with `conviction: 40`. Entry/stop/take profit are computed as stock prices via `_compute_levels(price)` (`strategy_runner.py:325-329`), i.e., ±5% / +10% of the underlying — stock levels, not option premiums. If conviction had ever crossed 50, the order placed would have been a **long equity** buy.

---

## Findings

### F1 — Two implementations exist; the advertised one does not run
`backend/strategies/__init__.py:6,20` registers `VRPHarvestStrategy`; `backend/data/ingestion/strategy_runner.py:3440,3443` registers `VRPHarvestRunner`. `backend/data/ingestion/daily_pipeline.py:30,798` imports `ALL_STRATEGIES` from the *runner* module. The options class is effectively dead code (referenced only by `regime_adaptive.py:73-88` for its `screen()` candidates). **Severity: critical — disclosure mismatch.**

### F2 — The running implementation buys stock, not sells vol
`strategy_runner.py:816-848` emits `signal = "buy"` (equity long) for high-IV-rank names. `generate_trades` (`strategy_runner.py:353-432`) converts "buy" to `side="buy"` in `master.request_trade`. Buying the underlying when IV is elevated is **closer to being long gamma/long vol** (if followed by RV rising) and is economically unrelated to VRP. A high-IV stock is statistically more likely to fall than rise in the short run (leverage effect). **Severity: critical.**

### F3 — `iv_rank` fed to the runner is `random.uniform(10, 90)`
`strategy_runner.py:813` calls `_get_screener_results()` which flows through `screener.py:196-234`. `iv_rank = round(rng.uniform(10, 90), 1)`; `iv_percentile`, `rs_score`, `composite_score` are all `rng.uniform` on a deterministic symbol seed. The live pipeline's "VRP" screen is filtering on **pseudo-random numbers seeded per ticker**, not market data. **Severity: critical.**

### F4 — Runner has no concept of realized vol, term structure, or VRP itself
`strategy_runner.py:808-848` never computes `iv − rv`, never reads `term_structure` or the VIX. The word "VRP" appears once, in a string (`strategy_runner.py:844`). **Severity: critical.**

### F5 — No broker path for multi-leg options
`routes/options.py` is read-only (`/chain/{symbol}`, `/iv/{symbol}`, `/greeks/...`). No `POST /options/orders` endpoint exists; Alpaca live-trading integration in this repo does not support multi-leg option orders. `VRPHarvestStrategy.map_to_trade` (`vrp_harvest.py:107-148`) therefore produces a data structure nothing consumes. **Severity: critical if intent is live execution.**

### F6 — VRP signal is ex-post HV, not forward-looking
`vrp_harvest.py:37-40`: `vrp = current_iv − hv_20`. That is IV minus *trailing* 20-day realized vol. Textbook VRP requires comparing IV to *expected future* RV (e.g., GARCH/EGARCH forecast or a conditional mean of forward RV). Using trailing HV biases the signal right before vol spikes (HV is low just before the regime change) — exactly the wrong time to sell premium. **Severity: high.**

### F7 — Realized vol proxy is even weaker in the IV endpoint
`routes/options.py:596-599` (`_fetch_real_iv`): `hv_20 = current_iv * 0.85`, `hv_50 = current_iv * 0.90`, `hv_100 = current_iv * 0.92`. HV is synthesized as a fraction of IV, which **guarantees VRP > 0 always** by construction. If `VRPHarvestStrategy` ever read real Alpaca IV, its `screen()` would accept every single name. **Severity: high.**

### F8 — Term-structure check is per-underlying, not VIX
`vrp_harvest.py:67-72`: term structure is read from the symbol's own option chain (`routes/options.py:613-621` builds it from ATM IV by expiry). This picks up single-name IV shape, not the VIX front-month-vs-back or VVIX. It would have missed all three 2018/2020/2024 VIX-term-structure-driven blowup signals because the check is on the *name you're about to sell*, not the market. **Severity: high.**

### F9 — No VIX/VVIX/regime filter whatsoever
Neither file references `VIX`, `VXX`, `VVIX`, `/VX`, or futures. In Aug 2024, the JPY carry unwind produced a VIX spike from 16 → 65 intraday. A VRP strategy without a top-level VIX kill switch is single-day-blowup risk. **Severity: high.**

### F10 — `iv_rank` in the "intended" class requires an unmodeled history buffer
`vrp_harvest.py:32-34` reads `t.get("iv_rank", 0)` from the universe dict. The actual IV endpoint computes IV rank **from the dispersion of IVs across strikes/expirations in the current snapshot** (`routes/options.py:588-594`), not from 52-week IV history. So "IV rank" in this app measures skew/term shape, not historical elevation. True IV rank needs history. **Severity: high.**

### F11 — Stop-loss definition is ambiguous / likely wrong
`vrp_harvest.py:145-161`: `stop_loss_multiplier = 2.0` → `max_loss_pct = 2.0 * 100 = 200`. `manage()` then closes when `pnl_pct <= -200`. For a short spread collecting $1 credit on a $5 wide (max loss $4), 200% of premium is $2 — only reachable if `pnl_pct` is computed as (loss/credit)*100. But the comment says `stop_loss_multiplier: 2.0  # lose 2x credit received` — which would be 200% of credit, not 200% of max. The code compares `pnl_pct` to a fixed −200 without ever verifying the scale. If `pnl_pct` is the standard (loss/cost)*100 = (loss / max_risk)*100, the stop triggers at a −200% impossible value and effectively never fires. **Severity: high — silent disable of the stop.**

### F12 — No portfolio vega / gamma / theta cap beyond a single constant
`vrp_harvest.py:26`: `MAX_PORTFOLIO_THETA = 0.003` is defined but **never read anywhere in the file**. There is no portfolio-level check against short-vega concentration, gross short-premium, or per-underlying clustering. Sizing is per-trade (`max_risk = equity * 0.02`) with no aggregate cap across positions. 10 trades at 2% is 20% gross short-vol exposure with zero portfolio-level brake. **Severity: high.**

### F13 — Sizing ignores buying-power reduction and vol scaling
`vrp_harvest.py:122` / `130`: `max_contracts = int(max_risk / (spread_width * 100))`. Spread width is hard-coded `5.0`. Real iron condor BPR is (width − credit) × 100; using raw width over-caps contracts when credit is material and under-caps when strikes are wide. No vol-targeting adjustment (should shrink size when VIX rises). **Severity: medium.**

### F14 — No long-wing tail hedge
Neither file buys far-OTM puts on SPX/VIX to cap tail. Condors have wings but they are *defined* at ~5 pts wide; in a gap move the long leg may cap loss at spread width − but that still burns 80–95% of the position and portfolio-wide 10 positions × $2k max loss = $20k on $100k (20% drawdown) in one gap. **Severity: medium.**

### F15 — No delta hedging for strangles (and no strangles at all)
`map_to_trade` only constructs condors (4-leg) or vertical put spreads (2-leg), both of which are defined risk. The user-facing text in `strategy-content.ts:93,100,115` says "delta-neutral strangles" — naked short strangles. The code and the docs disagree, and neither is hedged. **Severity: medium (confusion) / low (actual risk, since code is condors).**

### F16 — Earnings gate is weak; no macro event gate
`vrp_harvest.py:44-46`: `days_to_earnings < 14` gate. No FOMC/CPI/NFP gate. `days_to_earnings` has no ingestion source in the repo's runner path — if the universe dict doesn't supply it, the gate is skipped (`is not None`). **Severity: medium.**

### F17 — "Composite score" is made up
`vrp_harvest.py:54`: `iv_rank/100 * 0.4 + vrp * 5 * 0.4 + (avg_option_volume / 10000) * 0.2`. These weights have no backing in any file, backtest, or research note. No cross-validation, no walk-forward, no ablation. Entry threshold (`score >= 35`) is equally arbitrary. **Severity: medium.**

### F18 — No regime-change detection / step-aside mechanism
No VVIX trigger, no `VIX > X → flatten`, no term-structure-inverted flag, no equity correlation spike filter. Aug 2024, Feb 2018, Mar 2020 all had VIX term-structure inversion 1–5 days before the short-vol blowup. This system is blind to all of them. **Severity: high.**

### F19 — `manage()` has no re-entry cooldown or loss-streak throttle
`vrp_harvest.py:150-176`: Every day, if a trade closes, the next screen can immediately re-enter. A VRP drawdown typically clusters (vol spike Monday → bad Tuesday → worse Wednesday). No equity curve kill switch ("if 5-day PnL < −5% equity → pause the strategy 10 days"). **Severity: medium.**

### F20 — Hard-coded static parameters with no version or audit trail
`TARGET_DTE=45`, `MIN_IV_RANK=40`, `MIN_VRP=0.03`, `TARGET_DELTA=0.16` are class constants (`vrp_harvest.py:22-26`) with no source citation and no runtime override path. The conflict with the frontend promise (`strategy-content.ts:107` says IV rank > 50, code says ≥ 40; frontend says 10 max positions, code has no per-strategy cap). **Severity: medium.**

### F21 — Live leaderboard shows zeros because it never trades
`routes/strategies.py:157-169` initializes `invested_amount: 0`, `total_return_pct: 0`, etc. Observed pipeline log `2026-04-10.json:106-135` confirms `trades_requested: 0`, `trades_approved: 0`. On the live product, the VRP Harvesting card at `/strategies/vrp-harvesting` will show permanent zeros unless the runner's `iv_rank > 60 and composite > 50` gate fires and then it shows *long equity* P&L mis-attributed as VRP. **Severity: high (misleading UI).**

### F22 — `_compute_levels(price)` gives 5% / 10% stops on the underlying
`strategy_runner.py:325-329`: `stop_loss = price * 0.95`, `take_profit = price * 1.10`. These are applied to any trade the runner would emit, as if it were a long-equity swing strategy. They bear no relation to option-premium P&L. **Severity: high if the runner ever fires.**

### F23 — No survivorship of the 2018/2020/2024 template
The runner is long-stock on high-IV names. In March 2020, COVID crash:
- Every high-IV ticker crashed (high IV predicts directional risk).
- A "buy when IV is high" rule would have bought the falling knife for 3-4 straight weeks.
This is worse than a textbook VRP blowup — it has downside convexity in the wrong direction. **Severity: critical.**

### F24 — Rationale includes metrics it didn't compute
`strategy_runner.py:844-846`: `f"VRP: {symbol} IV Rank {iv_rank:.0f}, IV Pctl {iv_pctl:.0f}. Equity proxy for premium selling."` — the string admits it's a proxy but the UI presents this in the trade history as the explanation for a stock purchase. Paper trail for a future audit/regulator will be incoherent. **Severity: medium.**

### F25 — Live endpoint surface — the API page referenced in the brief
`https://tradingalpha.net/api/strategies` (unauth) returns 404; `/strategies` page returns the marketing landing, not the strategy list. The list endpoint is `GET /` on the strategies router (`routes/strategies.py:575-694`) mounted behind the SPA. Could not independently verify live statistics without auth, but the code path would surface `{invested:0, total_return_pct:0, sharpe_ratio:0, win_rate:-1}` for vrp-harvesting given the runner never trades. **Severity: informational.**

---

## 5-Year Assessment (2019–2024)

**How a real VRP harvester performed 2019–2024:**

- 2019: VIX benign (avg 15), term in contango all year. Sharpe 1.5+ trivially. Most implementations up 10–15%.
- Mar 2020: VIX 13 → 82 in 4 weeks. Well-hedged programs (long far-OTM puts, term-structure kill switch) drew down 15–25% and recovered by year-end. Naked short-vol (the XIV template) was −60% to −90%.
- 2021: Gentle recovery year, Sharpe 0.8–1.2.
- 2022: Sustained high vol (VIX avg 25). VRP was compressed; many strategies underperformed or flatlined.
- Aug 5 2024 carry unwind: VIX 16 → 65 intraday. Short-vol programs without an intraday kill switch took −10% to −30% in 48 hours. Programs with term-structure inversion gating stepped aside on Aug 2 (front-month inversion Aug 1 close) and were flat.

**Would AlphaDesk's VRP Harvest have survived?**

- The options class (`vrp_harvest.py`): **Not applicable** — it doesn't route orders. If it *had* traded in 2020:
  - Mar 2020: Front-month iron condors at 45 DTE sold early March. Both wings tested on SPY by 3/12. `manage()` stop (F11) likely never fires due to scale ambiguity. 10 open positions × full max loss ≈ 20%+ of portfolio in two weeks. No tail hedge, no VIX kill switch.
  - Aug 2024: Same problem — no VIX gating, no term-structure (per-name only).
  - Likelihood of survival: poor. Probably a survivable drawdown if condors are defined-risk and sized at 2%, but the ambiguous stop (F11) and lack of aggregate cap (F12) amplify the tail.
- The runner (`VRPHarvestRunner`): **It would have been worse than a naïve S&P long** during Mar 2020. Buying high-IV names into a crash = buying into forced liquidation. COIN, TSLA, high-IV semis were the worst performers. Sharpe 2019–2024 would likely be negative, with a Mar 2020 drawdown approaching 40%+.

**Tail-survival scorecard (0–5):**

| Dimension | Options class | Runner |
|---|---|---|
| VIX-level kill switch | 0/5 | 0/5 |
| Term-structure gate (VIX M1/M2) | 0/5 (per-name only) | 0/5 |
| Long tail hedge | 0/5 | 0/5 |
| Portfolio vega cap | 0/5 | n/a |
| Delta hedging | n/a (condors) | n/a |
| Vol-targeted sizing | 0/5 | 0/5 |
| Real IV data | 3/5 (if Alpaca keys) | 0/5 (random) |
| Real RV data | 1/5 (trailing HV proxy) | 0/5 |
| Event gate (earnings) | 2/5 | 0/5 |
| Macro event gate (FOMC) | 0/5 | 0/5 |

---

## Score: 18 / 100

**Breakdown:**

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Correct instruments (options vs stock) | 20 | 3/20 | 3 |
| Signal correctness (fwd-looking VRP) | 15 | 4/15 | 4 |
| Tail / regime management | 20 | 1/20 | 1 |
| Sizing / vega budget | 10 | 2/10 | 2 |
| Exit & stop logic | 10 | 3/10 | 3 |
| Execution path (broker routing) | 10 | 0/10 | 0 |
| Disclosure / UI honesty | 10 | 2/10 | 2 |
| Code / parameter provenance | 5 | 3/5 | 3 |
| **Total** | **100** | | **18** |

**To get to a defensible 60/100:**

1. Kill the equity runner entirely, or retitle it "equity long on high IV" — it is not VRP.
2. Add a real SPX/SPY options order path (or swap to VIX-future roll) before claiming short-vol functionality.
3. Replace `hv_20 = current_iv * 0.85` with actual daily HV from price history.
4. Add a top-level VIX term-structure check: `M1/M2 > 1.0 → flatten/no-new-entries`.
5. Portfolio-level vega cap at e.g. 0.3% NAV per 1-vol-pt move; enforce in `map_to_trade`.
6. Fix the stop: use `(current premium / credit received) ≥ 2` explicit expression.
7. Long-wing SPX 10% OTM 90-120 DTE put tail overlay funded by 10–15% of monthly premium.
8. Earnings + FOMC + CPI + NFP + quadruple-witching gates.
9. Vol-targeted contract sizing: scale contracts by `target_vega / current_vix`.
10. Reconcile `strategy-content.ts` prose with real behavior and version the parameters.

---

**All claims above reference files under `/Users/GK/Downloads/alphadesk/`; every finding cites `path:line` from the audited files.**
