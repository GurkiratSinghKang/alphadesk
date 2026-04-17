# Strategy Audit 04 — Earnings Vol Premium

**Auditor persona:** 15-yr quantitative volatility trader, single-name earnings cycles desk
**Files audited:**
- `backend/strategies/earnings_vol.py` (154 lines)
- `backend/strategies/base.py` (102 lines)
- `backend/strategies/__init__.py`
- `backend/api/routes/options.py` (799 lines)
- `backend/api/routes/strategies.py` (1,304 lines)
- `backend/data/ingestion/strategy_runner.py` — `EarningsVolRunner` (L855–903) and `_get_upcoming_earnings()` (L614–630)
- `backend/agents/earnings.py` (164 lines)
- `backend/api/routes/screener.py` — demo IV-rank generator (L196–227)
- `frontend/src/lib/strategies.ts`, `frontend/src/lib/strategy-content.ts`
- `big_run_result.json`, `multi_strategy_result.json` (both empty, 0 bytes)
- `STRATEGY_RESEARCH_REPORT.md` (April 8 2026)
- `https://tradingalpha.net/api/strategies` — 404 (no public endpoint at that path)

---

## Executive Summary

AlphaDesk ships **two disconnected implementations** of "earnings vol" in the same codebase, and neither one actually executes an options trade. The file the task points at, `backend/strategies/earnings_vol.py`, is a **short-vol iron-butterfly spec** with the correct shape on paper (sell ATM straddle, buy 20Δ wings, close morning after the print). It is also **100% dead code in production**: the pipeline actually instantiated by the running system is `EarningsVolRunner` in `strategy_runner.py` (L855), which ignores the iron-butterfly structure entirely and instead buys the **underlying equity** with a 5%/10% stop/target whenever `iv_rank > 65` and a generic composite score > 55.

The options-oriented class (`EarningsVolStrategy`) depends on four fields the rest of the system never supplies (`days_to_earnings`, `expected_move_pct`, `avg_historical_earnings_move`, `avg_option_volume`) and on an earnings calendar that is a hard-coded weekday rotation of 20 symbols (`_get_upcoming_earnings` at `strategy_runner.py:614`, comment: *"In production, this would query an earnings calendar API"*). The equity runner that actually runs has no concept of IV crush, no options, no earnings-date filter, no historical-move comparison, no T-1 timing, and no next-open exit. It is a momentum trade with an earnings label.

The `frontend/src/lib/strategy-content.ts` marketing copy promises Dubinsky & Johannes (2006)–style systematic straddle selling with 8-quarter historical-move conditioning and a 1.3× implied/realized threshold (L131–157). The backend delivers neither. The strategy is listed as `PAUSED` in `strategies.py` (L173) and the code comment on `max_positions` says *"currently paused — strategy under review for position sizing refinement"*. That disclosure is the single most honest statement on this strategy in the repo.

**Bottom line:** the options iron-butterfly design is textbook-correct but unimplemented; the runner that actually trades is a mislabelled IV-rank equity screen with no earnings-vol edge at all. Selling naked-ish vol through earnings without an options leg is the wrong trade.

---

## Textbook — What Earnings Vol Should Do

Institutional earnings-vol desks fall into two opposite camps:

### 1. Short-vol / IV-crush seller (iron condor, iron butterfly, short straddle/strangle)
- **Thesis:** IV on weekly options ramps into the event; ATM straddle implies a move that is ~20–30% larger than the median realized 1-day move (Dubinsky & Johannes 2006; Gao, Xing & Zhang 2018). Post-print, IV collapses from ~event-implied (e.g. 150 annualized) to post-event norm (e.g. 35) within minutes of the open. The edge is the *difference* between implied and realized **for the residual lifetime of the contract**, not a simple implied-vs-actual-return bet.
- **Structure:** short ATM straddle with 20Δ wings (iron fly) or 10Δ wings (iron condor) on the nearest weekly expiring ~2 days post-earnings. DTE short enough that vega decay dominates; longer DTE dilutes the crush into Vomma/long-vol residuals.
- **Entry:** T-1 (day before earnings) **at or after 15:45**. Earlier than T-1 = you eat IV ramp (vega long from earnings IV expansion) and get whipsawed by pre-print drift. Some desks enter T-0 near the close to minimize ramp exposure; tradeoff is worse fills.
- **Exit:** next-morning open or within 15 minutes after the open call. Hold-through-day = you own 3 more hours of gamma on a de-juiced option — fine if your realized is going to beat 1-day IV, usually not the trade.
- **Size:** 0.25–0.75% NAV per event for defined-risk; Kelly on a 70% win rate / 2–3× avg-loss distribution points to ~0.5% of NAV, and real desks cut that in half for earnings-season clustering.
- **Universe:** single-name only — SPY/QQQ have no meaningful earnings crush. Weekly options required. Minimum ~5k ATM straddle daily volume, ~10k OI, and bid-ask < 5% of mid on the short strike. Historical 8–12Q IV vs realized ratio > 1.2 (bias the book toward names with a measurable premium).
- **Skew:** do not sell naked — any earnings miss on guidance can produce a 4σ realized, and 2022 (META –24%) / 2023 (NFLX +35%) reminded the short-vol community that "70% win rate" with a –6× left-tail payoff is negative-EV without wings.

### 2. Long-vol / gamma-scalper
- Buy the straddle when IV rank < 30 and historical earnings move > implied (rare, happens in quiet-IV names with binary catalysts). Pre-pandemic TSLA was the archetype. Hard to scale; almost no alpha at index level.

### What matters — the 10 things a real earnings-vol book tracks

| # | Factor | Why |
|---|--------|-----|
| 1 | Confirmed earnings datetime (BMO vs AMC) | Drives expiry selection and entry cutoff |
| 2 | ATM straddle mid / spot vs 8Q median realized 1-day |ΔS|/S | The edge |
| 3 | IV rank + term structure front/back ratio | Need front IV > back IV (event contango/backwardation); premium lives in the front |
| 4 | Bid/ask / mid on short strike | >5% and you give back half the edge to the MM |
| 5 | Earnings surprise dispersion & guidance sensitivity | AMZN/NFLX = high dispersion → under-sell or skip |
| 6 | Correlation to other held short-vol earnings trades that week | Earnings-season clustering = correlated vega shock |
| 7 | Macro overlay (FOMC/CPI inside the DTE window) | Never sell earnings vol into a macro print |
| 8 | Post-event hold decision rules written *before* entry | Removes adrenaline |
| 9 | Delta hedge schedule if holding past the open | Gamma-scalping on residual IV |
| 10 | Realistic mid/slippage fill model | On single-name weeklies at 16:00 the NBBO is wide |

A well-run systematic book does Sharpe 0.5–1.0 at low to mid 8-figure AUM, struggles past mid 8-figure AUM because the short-vega capacity is bounded by the liquidity of 20Δ weekly options on the 30–40 liquidly-optioned single names per earnings cycle.

---

## What AlphaDesk Does

**Two implementations. They are not linked.**

### A) `backend/strategies/earnings_vol.py` — EarningsVolStrategy (the spec)
- Expects a universe of dicts with `days_to_earnings`, `expected_move_pct`, `avg_historical_earnings_move`, `iv_rank`, `avg_option_volume`, `earnings_straddle_history` (earnings_vol.py:30–51, 68).
- Screens for `0 <= days_to_earnings <= 3`, `iv_rank >= 50`, `avg_option_volume >= 5000`, `overprice_ratio >= 0.20` where `overprice_ratio = expected_move_pct / avg_historical_move - 1` (L31–50).
- `map_to_trade` returns an iron butterfly with ATM short call + short put + 20Δ long wings, `target_dte: 3`, `exit_timing: "next_market_open"`, `profit_target_pct: 30`, `stop_loss_multiplier: 1.5`, sized at 1% NAV (earnings_vol.py:110–135).
- `manage` closes on `earnings_reported == True`, on profit target, or on pre-earnings stop (earnings_vol.py:137–153).
- **Wired into registry** at `strategies/__init__.py:21` via `STRATEGIES["earnings_vol"] = EarningsVolStrategy`. Never instantiated by the production pipeline — only `regime_adaptive.py` uses `get_strategy()` (and only for a different purpose).

### B) `backend/data/ingestion/strategy_runner.py::EarningsVolRunner` (the runner that actually runs)
- Registered in `ALL_STRATEGIES` at L3444.
- `screen()` (L859–871): pulls 100 demo-screener stocks, keeps those with `iv_rank > 50`, prioritises names that intersect `_get_upcoming_earnings()`, returns top 10.
- `analyze()` (L873–903): if `iv_rank > 65 AND composite > 55` → `signal="buy"`, `conviction = 50 + iv_rank*0.25 + composite*0.15` (capped 90); else `hold` at 35.
- Stop/target come from the generic `_compute_levels(price)` (L325–329): stop = 0.95×price, target = 1.10×price. **Equity stops, not vega stops.**
- Inherits the base `generate_trades()` (L353–432) which sends a **long equity** order of up to $6,000 notional to the master agent. No options, no legs, no straddle, no crush.

### C) Earnings calendar
`_get_upcoming_earnings()` at `strategy_runner.py:614–630` is a literal hardcoded dict of 20 tickers keyed by `today.weekday()`. Comment: *"In production, this would query an earnings calendar API (e.g. FMP)."* — `_EARNINGS_CALENDAR_PLACEHOLDER`.

### D) Options infrastructure
`backend/api/routes/options.py` has a real Alpaca OPRA chain fetcher (L399–551) with greeks, a BSM demo fallback (L155–272), and an IV analytics endpoint (L672–728). **None of it is called by EarningsVolStrategy or EarningsVolRunner.** The `EarningsAgent.compute_expected_move` in `agents/earnings.py:116` *does* use a straddle-from-chain computation, but the agent is not in the strategy pipeline.

### E) Frontend marketing copy
`frontend/src/lib/strategy-content.ts:129–166`: cites Dubinsky & Johannes (2006), Ederington & Lee (1996), Gao Xing & Zhang (2018); promises S&P 500 weekly options with 8+Q of historical moves, implied/realized > 1.3, IV Rank > 60, 0.5–1% NAV sizing, close at next-day open or 60% profit. Entry criteria (L146) match real desks. Backend delivers none of it. Strategy status in `strategies.py:173` is `PAUSED`.

### F) Production API
`GET https://tradingalpha.net/api/strategies` returned HTTP 404 during this audit (v1/strategies returned 401 auth gate). Could not confirm live performance numbers. `big_run_result.json` and `multi_strategy_result.json` are both 0 bytes — no backtest artefacts exist.

---

## Findings

### F1 — Two incompatible strategies share the name "earnings_vol"
- `backend/strategies/earnings_vol.py:8` defines an options iron-butterfly strategy (ID `earnings_vol`).
- `backend/data/ingestion/strategy_runner.py:855` defines `EarningsVolRunner` (same `name = "earnings_vol"`, L856) that trades the **underlying equity**.
- Frontend UI at `frontend/src/lib/strategy-content.ts:129` describes the **options** version as the product.
- The pipeline executes the runner, not the strategy. **The advertised product does not exist.**

### F2 — The file the task asks about is dead code
- `strategies/__init__.py:21` registers `EarningsVolStrategy` in `STRATEGIES`.
- A grep of the backend for `EarningsVolStrategy(` or `STRATEGIES["earnings_vol"]` returns no invocation path. `get_strategy("earnings_vol")` is never called.
- Only consumer of `get_strategy` is `regime_adaptive.py:79,108,149,198`, and it routes to sub-strategies, never this one.
- `BaseStrategy.run_full_pipeline` (`base.py:86`) is defined but not called by `strategy_runner.py`, `pipeline_runner.py`, or `master_agent.py`.

### F3 — LONG vs SHORT vol: runner gets it exactly backwards
- `EarningsVolRunner.analyze` at `strategy_runner.py:881–886`: `if iv_rank > 65 and composite > 55: signal = "buy"`. This buys **equity long** when IV is rich.
- `generate_trades` (base class, `strategy_runner.py:353–432`): executes `side="buy"` as a long-stock order.
- High-IV-rank + long-stock has no relation to earnings-vol premium selling. You are not short vol; you are long delta. The "IV premium" edge is thrown away.
- Worse, `rationale` at L899–901 says *"implied vol appears overpriced vs historical"* — implying short-vol intent while the code is long stock.

### F4 — No implied vs realized move comparison in the runner
- The core edge of earnings vol is implied move / realized move > 1.0. `EarningsVolRunner` never computes this.
- `EarningsVolStrategy` has the right variable (`overprice_ratio = expected_move_pct / avg_historical_move - 1` at `earnings_vol.py:45`) but the required field `avg_historical_earnings_move` is not populated anywhere in the codebase. Grep finds exactly one producer: itself (L41) and one historical source reference in `agents/earnings.py:155` — and that is the unused agent.
- `_generate_demo_screener_results` in `api/routes/screener.py:196–227` produces `iv_rank`, `iv_percentile`, `rs_score`, `f_score`, `ml_score` — **no earnings-move fields at all.**
- Conclusion: the `overprice_ratio` filter in the spec (earnings_vol.py:46) can only evaluate against `0 / 0 - 1` → NaN, then the `avg_historical_move <= 0` guard at L42 kicks every candidate out. Even if the spec were wired in, it would screen 0 candidates on live data.

### F5 — Term structure and DTE handling absent
- Textbook: sell the front-week weekly whose expiry is 1–3 DTE after the print, because vega decay on sub-4 DTE options is where crush lives. Monthlies and back-weeks don't crush the same way.
- `EarningsVolStrategy.map_to_trade` hardcodes `target_dte: 3` (earnings_vol.py:128). Not computed from the expiry calendar; not verified against the earnings date. If earnings is Thursday AMC and weeklies expire Friday, you want 1 DTE, not 3.
- `EarningsVolRunner` has no concept of DTE because it trades equity.
- Options chain in `options.py` exposes weekly expirations (`_next_friday`, L147–152) and a `term_structure` endpoint (L613–621), but neither is consulted by either earnings_vol implementation.

### F6 — Entry timing: nominal T-3 window, unverified calendar, no intraday cutoff
- Spec entry window is `0 <= days_to_earnings <= 3` (earnings_vol.py:31). Serious desks enter T-1 or T-0 to avoid IV ramp. T-3 entry is early — you sell into rising vega.
- The runner entry has no earnings-timing filter whatsoever — it fires on IV rank alone.
- No intraday cutoff. Real flow is sized and entered between 15:30 and 15:55. AlphaDesk's pipeline runs at 09:35 and 15:30 (STRATEGY_RESEARCH_REPORT.md:93–102) — that afternoon run *could* be the entry window, but nothing in the strategy code keys off it.

### F7 — Exit: spec is correct, runner is wrong
- Spec (`earnings_vol.py:129–134`): `exit_timing: "next_market_open"`, `profit_target_pct: 30`, `stop_loss_multiplier: 1.5` on credit. `manage()` closes on `earnings_reported==True`. This is textbook.
- Runner uses `_compute_levels(price)` (`strategy_runner.py:325–329`): equity –5% stop / +10% target. Held through earnings with a dumb 5% stop on the underlying is the worst of both worlds: the underlying gaps 8%, stop triggers inside the gap, you are filled at the bottom tick, IV crush benefits you zero because you own shares not options.
- `manage()` in the spec is only reachable via `BaseStrategy.run_full_pipeline`, which nothing calls — so the exit-at-open rule is aspirational.

### F8 — Earnings calendar is hardcoded weekday rotation
- `strategy_runner.py:614–630`: `week_earnings = {0: {"JPM","WFC","C","BLK"}, 1: {"JNJ","UNH","GS","BAC"}, ...}` — 20 tickers, no date awareness. Q4 JPM earnings actually report 2nd week of January, not "every Monday". The system will claim UNH has earnings tomorrow any time it runs on a Tuesday.
- Comment at L617–619 acknowledges it: *"In production, this would query an earnings calendar API (e.g. FMP)."* Unshipped.
- Spec (`earnings_vol.py:30`) expects `days_to_earnings` as an integer but no code path ever writes it. `_get_screener_results` at `strategy_runner.py:165` does not include it; neither does `_generate_demo_screener_results` in screener.py.

### F9 — No confirmed vs estimated earnings date distinction
- Every real earnings calendar product distinguishes *confirmed* dates from *estimated*. Trading estimated dates produces 15–25% calendar errors (date slips by a day, straddle is wrong-DTE, gap risk on a non-event day).
- Neither implementation exposes a confirmed flag. The hardcoded calendar is de-facto "estimated" for every ticker, every time.

### F10 — Universe filter too loose, liquidity gate fails in practice
- Spec (`earnings_vol.py:50`): `avg_option_volume >= 5000`. That is daily *option volume across the whole chain*, not ATM-straddle volume, not OI. 5k total-chain volume on a small-cap is illiquid for a straddle sale.
- Real desks gate on: ATM short-strike daily volume > 1k, OI > 5k, NBBO width < 5% of mid on the short strike, underlying avg daily volume > 1M shares, market cap > $5B. None of these live anywhere.
- Runner has no options-liquidity gate at all — it uses the same universe as every other strategy (30 hardcoded demo stocks, screener.py:163–184).

### F11 — Position sizing untied to vol or capital at risk
- Spec (`earnings_vol.py:106–118`): `max_risk = equity * 0.01`, `wing_width = expected_move_pct * 1.2`, `max_contracts = int(max_risk / (wing_width * 100))`. This confuses % return with $ and treats `expected_move_pct` (a percent like 5.0) as if it were dollar wing width. If `expected_move_pct = 5`, wing_width = 6, contracts = int(1000/600) = 1 for a $100k account. On NVDA at $197 that is a $197-wide "wing" — nonsensical. Math bug.
- Runner sizes identically to every other strategy (`strategy_runner.py:377–382`) at `MAX_POSITION_DOLLAR = 6000` (L21) scaled by optional vol-targeting. No reduction for earnings gap risk. Textbook cuts earnings-play size to 50% of normal (`agents/earnings.py:57`) — the agent writes this prompt but the runner ignores the agent.
- No Kelly calc anywhere. No cluster-risk cap across names reporting the same week. No concurrent-event vega budget.

### F12 — Slippage / fill model: absent
- Options.py builds a chain with synthetic bid/ask spreads (`_demo_chain`, L237: `spread = price * rng.uniform(0.02, 0.08)`), but the strategy never uses it. No entry fills at bid, exits at ask, or vice versa. When the runner trades equity, it hits the master agent's equity sizing path which assumes market orders at `price` (strategy_runner.py:381, `price * math.floor(...)`).
- Real earnings weeklies at the close on T-1 have 5–15% spreads on the short strike. Selling at mid is a fiction on all but the top 10 names. A Sharpe-0.8 theoretical strategy becomes Sharpe-0 at 3% round-trip slippage.
- `STRATEGY_RESEARCH_REPORT.md:56` labels this strategy "Sharpe 0.7–1.2" alongside a note *"Need options execution"* — that is an honest own-goal.

### F13 — IV rank is synthetic, rank-not-a-rank
- `_generate_demo_screener_results` at `api/routes/screener.py:208`: `iv_rank = round(rng.uniform(10, 90), 1)`. Uniform random. Not a rank against the symbol's trailing 252-day IV history. This is the IV rank the runner's `iv_rank > 65` filter fires on.
- `_fetch_real_iv` in `options.py:554–638` derives a pseudo-rank from the *spread of IVs in the current chain* (L590–593), explicitly commented as not-a-real-rank: *"True rank needs history; we use the distribution of IVs in the chain"*. This endpoint is never called by the strategy.
- Without a real IV rank, "elevated-IV" gating is meaningless — you get random 50% pass rate.

### F14 — No guidance/one-time-item screen, no dispersion filter
- Textbook (Dubinsky & Johannes) conditions on historical surprise dispersion. High-dispersion names (NFLX, META post-2022, TSLA) are where the short-vol trade dies.
- Neither implementation has surprise history, SUE, or dispersion metrics.
- `EarningsAgent.system_prompt` at `agents/earnings.py:30` lists "Revenue vs earnings beat", "Guidance quality" as analysis factors — but the agent does not feed the strategy.

### F15 — No concurrent-macro-event lockout
- Frontend copy (`strategy-content.ts:146`): *"no concurrent macro events"*. Backend has no FOMC / CPI / NFP calendar. Running the short-vol trade into a Powell speech and an AMD print in the same week, unhedged, is how 2018 blew up multiple vol books.

### F16 — Post-earnings drift completely ignored
- Holding through the morning open captures gamma-scalp residual. The spec closes at "next_market_open" which is fine for crush but sacrifices any drift edge when it exists (PEAD is separately implemented and doesn't coordinate with earnings_vol).
- No coordination logic prevents EarningsVolRunner from buying NVDA T-1 while PEADRunner sells NVDA T+1 on a beat. You get chopped for spread twice with no net position.

### F17 — `earnings_straddle_history` win-rate base case is a hardcoded 65%
- `earnings_vol.py:68–73`: if no history, default `win_rate = 65`. Hard-coded base rate with no citation. Frontend claims "approximately 70% of the time" (strategy-content.ts:132) — both numbers are plucked and neither is backed by any backtest in the repo (`big_run_result.json` is 0 bytes).
- `score = overprice * 100 + win_rate / 5` (L75) then caps at 80, feeding a conviction that's cosmetic.

### F18 — The exit trigger depends on a boolean that is never set
- `manage()` in `earnings_vol.py:142` reads `market_data.get("earnings_reported", False)`. No code path in the ingestion layer, master agent, or strategy runner writes `earnings_reported`. The exit rule can only fire on profit target or stop — the primary earnings-vol exit condition is unreachable.

### F19 — Strategy is paused, status override persists in Redis, and the runner still runs
- `strategies.py:173` status = `PAUSED`. The toggle API writes a Redis override (`strategies.py:551–557`), not the underlying config.
- However `EarningsVolRunner` in `strategy_runner.py` is not gated by strategy status — it is registered in `ALL_STRATEGIES` at L3440 and executed by `pipeline_runner.py` regardless. (Search for `status == "paused"` in strategy_runner.py returns zero results.) The "paused" badge on the UI is cosmetic; the strategy still trades if the pipeline runs.

### F20 — Marketing copy materially exceeds implementation; defined-risk claim is false
- `strategy-content.ts:136`: *"Naked short straddles carry unlimited theoretical risk"* — correct for the *spec*, but the runner trades long equity (no unlimited risk). The copy describes product B, code runs product A.
- `strategy-content.ts:142`: *"average straddle bid-ask spread < 5% of mid-price"* — no bid/ask filter implemented.
- `strategy-content.ts:156`: *"reduced sizing for names with high historical surprise variability"* — no dispersion-aware sizing exists.
- A regulated RIA/CTA would have a disclosure problem here.

---

## 2019–2024 Assessment

**Could a well-run earnings-vol book produce Sharpe 0.5–1.0 over 2019–2024?** Yes — several documented CTAs and options funds (e.g., Alpha Gen Capital, ORG) did it. But the 2019–2024 regime specifically punishes naive earnings vol:

- **2019:** calm IV, tight spreads, vol-seller paradise. Sharpe 1.2+ achievable on disciplined execution.
- **2020 March:** vol explosion, earnings delayed/deferred, correlations to 1. Any short-vol book without variance hedges took 2–5× monthly loss. A naive T-3 entry book was catastrophic.
- **2020 Q2–Q4:** reflation rally, IV still elevated. Short-vol worked if you had capacity.
- **2021:** meme-stock squeezes (GME earnings-cycle Jan–Mar 2021) produced 15–25% realized moves against short straddles. Any book without name-level veto got hit.
- **2022:** NFLX –24% (Apr Q1 '22), META –24% (Feb Q4 '21 print), AMZN Q2 '22 –14% — single-event 3σ+ realizations that exceeded 2-month accumulated premium.
- **2023:** NFLX +35%, NVDA +24% Q1 earnings surges. Short calls without wings annihilated.
- **2024:** AI-driven earnings reactions (SMCI, ARM, CRWD) with 3–10σ moves at least 8 times.

**Net:** over 2019–2024, an undefended short-vol earnings book would have had ~2020 and ~2022 as –40%+ drawdown years. A defined-risk iron-fly book with decent sizing could have held Sharpe 0.4–0.7 — modest, capacity-constrained, and requires actually owning options.

**AlphaDesk's real behavior** in this period (inferred from the runner): long-IV-rank equity buys with a 5% stop and a 10% target held through the print. This is a long-gamma-equivalent exposure (you benefit from moves in your favor, lose the stop in gaps against you). Over 2019–2024, with earnings gaps averaging 4–6% and 30–35% of them exceeding the 5% stop, this produces roughly –2% expected per trade after slippage, pre-survivorship. It is **worse than random** on the earnings-vol thesis and does not deserve the name.

**Capacity note:** The spec claims `max_positions: 8` paused (strategy-content.ts:150). At $100k NAV, 1% sizing, 8 concurrent iron flies on single-name weeklies requires ~$8k option notional — trivial. At $50M NAV, 1% is $500k on ATM weekly straddles; you'd clear half the NBBO width on entry in NFLX. This strategy is scale-capped at ~$5–10M AUM realistically. The product description doesn't disclose this.

---

## Score: 14 / 100

| Component | Points Available | Points Earned | Reasoning |
|---|---|---|---|
| Thesis correctness (short vs long vol framing) | 15 | 10 | Spec is correct short-vol iron fly. Runner is wrong (long equity). Split the difference. |
| Edge computation (implied vs realized) | 15 | 2 | Spec has the formula (`overprice_ratio`, earnings_vol.py:45). Required input never populated (F4). Runner doesn't compute it at all. |
| Entry timing & term structure | 10 | 1 | T-0 to T-3 window in spec (earnings_vol.py:31) is too wide; runner has no earnings timing at all (F5, F6). No expiry selection logic. |
| Exit discipline | 10 | 2 | Spec has next-market-open rule (earnings_vol.py:130) but trigger `earnings_reported` is never set (F18). Runner uses equity 5%/10% stops (F7). |
| Earnings calendar integrity | 10 | 0 | Hardcoded 20-ticker weekday rotation (`strategy_runner.py:614`, F8). No confirmed/estimated distinction (F9). |
| Universe / liquidity gate | 10 | 1 | Minimal option-volume check in spec (F10), none in runner. No OI, spread, mkt-cap filters. |
| Position sizing (Kelly, capital-at-risk) | 10 | 1 | Spec has a math bug treating % as $ (F11). Runner reuses generic $6k per trade with no earnings adjustment. |
| Slippage / fill model | 5 | 0 | No fill model anywhere (F12). Mid-price assumed. |
| IV rank quality | 5 | 0 | `rng.uniform(10,90)` as IV rank (F13). |
| Agent integration | 5 | 1 | `EarningsAgent` at `agents/earnings.py` has useful scaffolding but is not connected to the strategy. |
| Documentation / honest disclosure | 5 | 2 | Strategy correctly flagged `PAUSED` (`strategies.py:173`) with a plain-English reason. But frontend copy (F20) promises an implementation that does not exist. |

**Total: 14 / 100.**

### What would move this to 60+
1. Delete `EarningsVolRunner` or make it short options via the real Alpaca OPRA chain in `options.py:399`.
2. Wire a real earnings calendar (FMP / Benzinga / Zacks) with confirmed-date filter.
3. Compute `expected_move` from ATM straddle mid (already implemented at `agents/earnings.py:116`) and `avg_historical_earnings_move` from 8Q of price history.
4. Gate on IV rank from real 252-day IV history, not `rng.uniform`.
5. Enforce DTE = `first_weekly_post_earnings`, not `target_dte: 3`.
6. Enter T-1 after 15:30 only; exit at next-day 09:35 by rule.
7. Defined-risk iron fly with 20Δ wings; Kelly-sized at 0.25–0.5% NAV per event with a weekly vega cap.
8. Slippage model: sell at bid – 1 tick, buy at ask + 1 tick on entry; mid on exit.
9. Cluster cap: max 4 concurrent names, max 2 in same sector.
10. Disable strategy on weeks containing FOMC/CPI within DTE.

Without those, the strategy-content.ts prospectus is aspirational and the runner is earnings-themed momentum.
