# Strategy Audit 09: Pairs Trading (Statistical Arbitrage)

**Auditor perspective:** 15+ years running stat-arb / pairs desks. Engle-Granger, Johansen, OU mean-reversion, sector-neutral stat-arb.

**Files audited:**
- `/Users/GK/Downloads/alphadesk/backend/strategies/pairs_trading.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/__init__.py`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py` (class `PairsTradingRunner`, lines 2265–2556)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/master_agent.py`
- `/Users/GK/Downloads/alphadesk/backend/agents/execution.py`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts`
- `/Users/GK/Downloads/alphadesk/big_run_result.json`
- `/Users/GK/Downloads/alphadesk/multi_strategy_result.json`
- `/Users/GK/Downloads/alphadesk/STRATEGY_RESEARCH_REPORT.md`
- Live API `https://tradingalpha.net/api/strategies` — returned HTTP 404 (public unauthenticated probe)

---

## Executive Summary

AlphaDesk ships two code paths for "pairs trading" that sit on top of a **fixed menu of 12–15 hard-coded large-cap sector pairs** with no true cointegration test, no rolling universe re-qualification, and — in the live execution path — **no short leg**.

There is a surprisingly competent-looking statistics layer (OU half-life regression, Hurst R/S estimator, rolling-std regime-change guard, correlation filter, adaptive exit thresholds). But this sits atop three structural defects that vitiate the whole strategy:

1. **The live `PairsTradingRunner` trades a single leg only** — it converts the pair signal into a "buy sym_a" or "buy sym_b" single-stock order with a 5%/5% stop/target. No short leg is ever generated, so the portfolio takes **outright long exposure to the "underperformer"** of a pair rather than the spread. This is not statistical arbitrage; it is a long-only mean-reversion pick dressed in pairs vocabulary. The market-neutrality the UI promises does not exist in production.
2. **The "cointegration" test is only an OLS hedge regression on 60-day closes, plus an OU-regression half-life filter.** There is no Engle-Granger ADF on the residuals, no Johansen VECM, and no p-value gate. A Hurst exponent (R/S on a small sample) is not a cointegration test. Marketing in `frontend/src/lib/strategy-content.ts:330,337` says the system runs monthly Engle-Granger tests at p < 0.05 across all S&P 500 within-sector pairs — **none of that exists in the code**.
3. **Pair universe is a static Python literal of 12–15 mega-cap names** (`SECTOR_PAIRS` in both files). There is no re-screening, no replacement for broken pairs, and the list still contains pairs that decoupled in 2020–2024 (XOM/CVX, T/VZ, AMZN/WMT). A structural-break guard exists (`_spread_std_expanding`) but only skips entries; broken pairs remain in the universe forever.

Pre-existing statistics are real and mostly correct. Execution and pair-selection are not. Even after those are fixed, an edge based on 12 of the most crowded pairs on earth, scanned daily at z=2 with a 60-day window, is a crowded, low-capacity strategy that 2019–2024 has been particularly unkind to.

---

## Textbook: How Stat-Arb Pairs Trading Should Work

The canonical pipeline (Gatev/Goetzmann/Rouwenhorst 2006; Vidyamurthy 2004; Avellaneda-Lee 2010; Krauss 2017):

1. **Universe construction.** Rolling re-screen of every within-sector pair in a liquid universe (typically S&P 500 or S&P 1500 financials/utilities/industrials). Sector and sometimes sub-industry grouping. Minimum ADV, market cap, and borrow availability filters on the short leg.
2. **Statistical pair selection.** One of:
   - **Distance method (Gatev et al.):** sum of squared normalised-price differences, rank top 20 pairs, trade over a 6-month trading window after a 12-month formation window.
   - **Engle-Granger cointegration:** regress $P_A = \alpha + \beta P_B + \epsilon$, run an ADF unit-root test on $\epsilon_t$; keep pairs with ADF p-value < 0.05.
   - **Johansen cointegration:** VAR-based test that handles >2 assets, produces an eigenvector hedge ratio, less sensitive to the dependent variable choice.
3. **Spread and z-score.** Build the spread $s_t = P_A - \beta P_B$ (Engle-Granger) or $\beta' P$ (Johansen). Compute z on a **rolling window** that matches the half-life. Longer windows give stable signals but stale statistics; shorter windows give noise. A half-life-aware Kalman smoothed z is the modern standard.
4. **Entry / exit / stop.** Enter at |z| ≥ 2.0, exit at |z| ≤ 0.0–0.5, stop at |z| ≥ 3.0 or 4.0 (pair has broken). Time stop at ~2× half-life. Strict dollar-neutral or beta-neutral sizing across legs.
5. **Hedge-ratio maintenance.** Either re-fit OLS on a rolling window, or use a Kalman filter to let $\beta_t$ drift. Static hedge ratios bleed P&L in trending pairs.
6. **Structural break handling.** Re-run the cointegration test monthly or on rolling 60/120-day windows. Drop pairs whose ADF p-value rises above 0.10 or whose residual variance doubles. Replace with newly qualifying pairs.
7. **Costs.** Pairs trading is cost-heavy: round-trip commission + half-spread on both legs, ~10–20 bps slippage per leg, plus short-borrow (0–5% annualised for large caps, >10% for hard-to-borrow). Crowding in large-cap pairs further compresses edge.

**Realistic 2019–2024 Sharpe for equity pairs (large-cap US) after costs: 0.3–0.7 net of slippage and borrow.** 2020 (work-from-home reallocation) and 2022 (energy rally) broke many historical pairs. The strategy still earns crisis alpha when dispersion spikes, but drawdowns are frequent.

---

## What AlphaDesk Does

AlphaDesk has **two pairs-trading code paths that barely share state**:

### Path A — `PairsTradingStrategy` in `backend/strategies/pairs_trading.py`
- Registered in `backend/strategies/__init__.py:12,26` under the key `"pairs_trading"`.
- Implements the full textbook abstract `BaseStrategy` lifecycle including `map_to_trade` that returns a two-legged structure with `legs: [{side:"buy", sym_a}, {side:"sell", sym_b}]` (`backend/strategies/pairs_trading.py:210-213, 231-234`).
- **Is NOT invoked by the live pipeline.** `get_strategy("pairs_trading")` is only called from `backend/strategies/regime_adaptive.py:79,108,149,198` as a candidate sub-strategy, and regime_adaptive's main code path hard-codes source strategies to `"momentum_quality"` (`regime_adaptive.py:141`), so in practice this class is dead code.
- Uses OLS hedge ratio, 60-day rolling z, fixed 2.0 entry / 0.5 exit / 4.0 stop, with an adaptive `manage()` that tightens/widens thresholds based on half-life (`pairs_trading.py:261-288`). This is the cleaner code but never runs.

### Path B — `PairsTradingRunner` in `backend/data/ingestion/strategy_runner.py:2265-2556`
- Registered in `ALL_STRATEGIES` (`strategy_runner.py:3452`); this **is** the class the daily pipeline instantiates (`backend/data/ingestion/daily_pipeline.py:798-824`).
- Scheduled at midday ET (`pipeline_runner.py:55`) and Friday close (`pipeline_runner.py:73`).
- `screen()` (2395–2501) applies: correlation > 0.7 (2429–2437), OU half-life ≤ 30 days (2457–2463), Hurst < 0.5 (2466–2472), spread-std-expansion guard (2475–2480), and |z| ≥ 2.0 (2482).
- `analyze()` (2503–2556) does **single-leg-only** mapping: it picks one symbol (the "undervalued" side), builds a `"signal":"buy"` dict (`strategy_runner.py:2539-2554`) with `stop_loss = entry * 0.95` and `take_profit = entry * 1.05` — flat ±5% risk levels with no z-score-based exit.
- The inherited `BaseStrategyRunner.generate_trades()` (336–432) only submits `side="buy"` orders (line 407, 410–419). There is no short-leg path in this runner.

### UI / API surface
- `backend/api/routes/strategies.py:235-247` registers `"pairs-trading"` in `_STRATEGIES`.
- `backend/api/routes/strategies.py:339-351` registers a separate `"pairs-stat-arb"` entry. But `_STRATEGY_NAME_TO_ID` (521, 533) maps the ledger key `pairs_trading` to `pairs-trading` only; there is **no ledger key `pairs_stat_arb`** and no runner class of that name. The `pairs-stat-arb` card is a UI-only duplicate that can never accumulate trades.
- Frontend (`frontend/src/lib/strategies.ts:109-122,190-191`) lists both, and `frontend/src/lib/strategy-content.ts:319-350, 516-524` describes both with different copy. The "pairs-trading" description matches Path A (map_to_trade with legs); the "pairs-stat-arb" description matches Path B (runner).
- Allocation budget: `master_agent.py:68` assigns `pairs_trading` 6.67% of NAV (~$6,667 on $100k). No budget for `pairs_stat_arb`.
- The audit artifacts `big_run_result.json` and `multi_strategy_result.json` contain **zero references** to pairs, zscore, spread, hedge, or cointegration — pairs trading was not exercised in the sample runs.
- Live `GET /api/strategies` on `tradingalpha.net` returned 404 for unauthenticated probes, so live stats could not be compared.

---

## Findings

### F1 — The live pairs runner has no short leg; it just buys the cheap name

**Severity: Critical.** `strategy_runner.py:2525-2554` maps a pair z-score signal to exactly one `"signal":"buy"` analysis dict keyed on `signal_symbol` (either `sym_a` or `sym_b`). `BaseStrategyRunner.generate_trades` (`strategy_runner.py:407`) hard-codes `side="buy"`. There is no code path that opens a short position against the overperforming leg. The resulting trade is **long-only** in the single stock picked as "undervalued", with a flat ±5% stop/target (`2536-2537`) that has nothing to do with the spread z-score. This makes AlphaDesk's "pairs trading" a long-only mean-reversion bet on one of two large caps, not pairs trading. Market neutrality advertised in `strategy-content.ts:322, 326, 518` is fictional in the live system.

### F2 — No cointegration test anywhere in the codebase

**Severity: Critical.** No Engle-Granger ADF residual test. No Johansen eigenvalue test. No p-value gating. The only stats actually run are: OLS hedge ratio (`strategy_runner.py:2440-2444`), Pearson correlation (2356–2369), OU half-life via AR(1) regression (2293–2314), Hurst R/S (2316–2353), and a heuristic std-expansion check (2371–2385). High correlation and mean-reverting residuals are **necessary but not sufficient** conditions for cointegration — two I(1) series can be highly correlated without being cointegrated. This is a distance-style heuristic labelled as cointegration; Gatev 2006 style distance would at least be an honest branding. The `frontend/src/lib/strategy-content.ts:330,337` marketing copy promises "Engle-Granger two-step method, p < 0.05, 2+ year lookback" — none of this is implemented.

### F3 — Static hard-coded pair list with no re-qualification

**Severity: High.** `backend/strategies/pairs_trading.py:20-36` (15 pairs) and `backend/data/ingestion/strategy_runner.py:2281-2286` (12 pairs — overlapping but **different** list; `MSFT/AAPL`, `DIS/CMCSA`, `MMM/HON` dropped in the runner). These are hand-picked mega-caps. There is no screening of the broader equity universe for new cointegrated pairs, no periodic removal of pairs that have broken, and no logging of pair-level cumulative P&L to retire losing pairs. The Gatev framework requires a rolling formation window that re-ranks the universe every 12 months — absent here.

### F4 — Historically broken pairs still in the universe

**Severity: High.** Several of the hard-coded pairs have decoupled in the 2019–2024 regime:
- **T/VZ** (`strategy_runner.py:2284`): Warner spinoff (Apr 2022) permanently broke the telecom pair. The spread has trended for 3 years.
- **AMZN/WMT** (`strategy_runner.py:2285`): AWS re-rating in 2023–2024 and WMT's post-COVID margin recovery created a persistent trend, not mean reversion.
- **XOM/CVX** (`strategy_runner.py:2282`): 2020 Chevron/Noble + 2022 buyback divergence + 2023 XOM/Pioneer announcement events periodically dislocate this pair.
- **DIS/CMCSA** (only in `pairs_trading.py:31`): DIS DTC losses vs Comcast cable decline created sustained trends 2022–2023.

The rolling std-expansion check (`strategy_runner.py:_spread_std_expanding`, 2371–2385) is a band-aid that blocks entry but does not remove a broken pair from the rotation — if volatility subsides, the pair re-enters the pool even though the underlying cointegration is gone.

### F5 — Z-score uses the same 60-day window as the validation window

**Severity: Medium.** The runner computes z over `window = min(60, min_len)` (`strategy_runner.py:2447`) and estimates half-life, Hurst, and correlation on overlapping windows of the same data. This creates an in-sample fit problem: the spread is de-meaned by its recent 60 days, making |z| > 2 statistically less rare than a true stationary process would imply. Standard practice is to fit the hedge on a formation window (~12 months) and trade on a shorter out-of-sample window (~3–6 months).

### F6 — Hedge ratio is static per screen and not updated once a trade is on

**Severity: Medium.** OLS β is computed inside `screen()` (`strategy_runner.py:2440-2444`) at entry and never refreshed. `PairsTradingStrategy.manage()` (`pairs_trading.py:244-288`) does not re-estimate β over the holding period. For 60-day OU processes in drifting mega-caps, β can move 10–20% over 3 weeks — which silently converts a spread trade into a directional one. A Kalman filter or rolling weekly re-fit is standard. Neither is present.

### F7 — No transaction-cost model, no short-borrow fees, no half-spread

**Severity: High.** The analyze-to-trade chain (`strategy_runner.py:2539-2554` → `BaseStrategyRunner.generate_trades` → `master_agent.request_trade` → `agents/execution.py`) passes through no cost model. For single-stock long-only this is forgivable; for true pairs (round-trip × 2 legs + short borrow) it would kill the edge entirely. Pairs turnover in this system would be ~8–12 round-trips/year per pair, roughly 20–40 bps/year per pair in commissions+slippage even at institutional rates — and that is before borrow on the short leg. A realistic 2019–2024 gross Sharpe of 0.6 becomes 0.2–0.3 net.

### F8 — "Dollar-neutral" sizing works in dead code only; live sizing is unit-notional

**Severity: High.** `pairs_trading.py:197-201` attempts dollar-neutral sizing (notional per leg × |β| / price_b) — but this code is never invoked in the live pipeline (see F1, Path A vs Path B). The live `PairsTradingRunner.analyze()` simply returns `entry_price = price_a OR price_b` and lets the base runner use `MAX_POSITION_DOLLAR` notional sizing via `master.calculate_vol_targeted_size` (`strategy_runner.py:376-382`). No pair-aware sizing, no β-adjustment of leg notionals.

### F9 — Adaptive thresholds in `manage()` are applied to a non-existent position

**Severity: Medium.** `PairsTradingStrategy.manage()` (`pairs_trading.py:244-288`) has genuinely thoughtful adaptive exit/stop logic keyed on half-life (fast → tight exit, slow → wide exit). But because Path A is dead code, this manage logic is never executed on actual open positions. The live runner writes flat `take_profit = entry * 1.05` and `stop_loss = entry * 0.95` (`strategy_runner.py:2536-2537`) which the generic position management applies. So the system's only "pairs management" is a 5% fixed stop — a single-stock exit rule that ignores z-score entirely.

### F10 — Entry z-score fixed at 2.0 with no adaptivity to volatility regime

**Severity: Medium.** `ENTRY_Z = 2.0`, `EXIT_Z = 0.5` (`strategy_runner.py:2287-2288`). Modern pairs research (e.g. Krauss 2017, table 5) shows static thresholds underperform both in high-dispersion (should enter later, at |z|=2.5) and low-dispersion (should enter earlier, at |z|=1.5) regimes. No IV or realised-vol input to z-thresholds. No in-sample/out-of-sample split for threshold selection.

### F11 — Hurst exponent computed on short samples; result is noise

**Severity: Medium.** `_compute_hurst` (`strategy_runner.py:2316-2353`) runs R/S on up to ~120 observations with `max_lag = 20`. The small-sample bias on R/S Hurst estimates is severe: H estimates below ~250 samples have a standard error of ~0.15 (Weron 2002). A filter of `H < 0.5` on a noisy estimate with SE=0.15 rejects about half of true random walks and admits a chunk of trending pairs. It is barely better than a coin flip.

### F12 — No Pair ID or per-pair P&L tracking

**Severity: Medium.** The ledger stores trades keyed by single symbol (`api/routes/strategies.py:466-504`). A "pairs_trading" trade on XOM and one on CVX are not linked in the ledger as a single pair position. You cannot measure per-pair Sharpe, cannot retire losing pairs, cannot even verify that the system closed both legs together (since there is only one leg — see F1). Strategy-level leaderboard (`api/routes/strategies.py:1002-1014`) is symbol-aggregated, not pair-aggregated.

### F13 — Duplicate "pairs-stat-arb" UI card with no backing runner

**Severity: Low (cosmetic, but user-facing).** `api/routes/strategies.py:339-351` registers a separate `"pairs-stat-arb"` strategy card. `_STRATEGY_NAME_TO_ID` (521, 533) wires `pairs_trading` → `pairs-trading` but has no `pairs_stat_arb` → `pairs-stat-arb` entry. No `pairs_stat_arb` runner in `ALL_STRATEGIES` (`strategy_runner.py:3440-3456`). No budget in `master_agent.py:68`. So the `pairs-stat-arb` card appears in the UI (`frontend/src/lib/strategies.ts:116-122,191`) with its own detailed description (`strategy-content.ts:516-524`) and will permanently show 0 trades, 0 positions, N/A win rate. Either wire it to a real second strategy or remove it.

### F14 — Marketing claims in strategy-content.ts do not match code

**Severity: Medium (compliance/trust risk).** Examples:
- `strategy-content.ts:330`: "S&P 500 sector pairs with 2+ year cointegration history (Engle-Granger p < 0.05)". Actual: 12 hard-coded mega-caps, no Engle-Granger.
- `strategy-content.ts:337`: "Run monthly cointegration tests (Engle-Granger two-step method) across all within-sector stock pairs in the S&P 500, requiring p < 0.05 on a 2+ year lookback window." Actual: no monthly tests, 60-day lookback only, no ADF.
- `strategy-content.ts:341`: "Drop pairs that lose cointegration significance at the monthly re-test, and add newly qualifying pairs to the watchlist." Actual: the universe is a static Python list literal.
- `strategy-content.ts:322, 518`: "Market-neutral by construction." Actual: live runner is long-only (see F1).
- `strategy-content.ts:334`: "maxPositions: 8". Actual: `pairs_trading.py:108` sets `MAX_ACTIVE_PAIRS = 5` (though this constant is not enforced in the live runner either).

These gaps are not just stale docs; they describe a fundamentally different strategy than the one running.

### F15 — No sector / beta neutrality even at the pair level

**Severity: Low.** Stat-arb best practice for pairs is beta-neutral, not just dollar-neutral (Avellaneda-Lee 2010). β is computed per-pair as price OLS β, but the portfolio doesn't enforce portfolio-level beta ≈ 0 or sector exposure ≈ 0 across the 5 active pairs. Given the universe is 12 predictable mega-cap pairs that load on common factors (large-cap quality, low-vol), 5 simultaneous pairs will share heavy factor exposure.

### F16 — No capacity / crowding awareness

**Severity: Low.** Pairs trading on large-cap US megacap pairs (XOM/CVX, KO/PEP, V/MA, MSFT/AAPL, JPM/BAC, HD/LOW, GS/MS) is the most crowded stat-arb in the US market — every relative-value hedge fund trades these. Academic capacity estimates for this exact universe are ~$100M total AUM before the edge decays to zero (Do & Faff 2012 update to Gatev). Nothing in AlphaDesk acknowledges or differentiates from the crowd.

### F17 — Half-life cap of 30 days plus 20-day max hold is inconsistent

**Severity: Low.** `strategy_runner.py:2289` sets `MAX_HALF_LIFE = 30`, admitting pairs whose OU half-life is up to a month. `pairs_trading.py:107` sets `MAX_HOLD_DAYS = 20`. If a pair has a 30-day half-life, a 20-day max hold exits half the trades before mean-reversion is statistically likely. One or the other parameter is wrong; the adaptive `manage()` (`pairs_trading.py:261-272`) tries to fix this for Path A but does nothing in Path B live.

### F18 — Conviction inflation

**Severity: Low.** `strategy_runner.py:2516-2523` sets a base conviction of 55, boosts +5 each for fast mean-revert and low Hurst, and floors at 55. This is above the 50 minimum in `master_agent.MIN_CONVICTION`, so **every filtered pair signal is above threshold by construction**. Conviction is a constant in practice; the 50 threshold provides zero filtering.

### F19 — The Friday "cointegration refresh" does nothing of the kind

**Severity: Medium.** `pipeline_runner.py:73`: `WEEKLY_STRATEGIES = ["regime_adaptive", "pairs_trading"]`. `pipeline_runner.py:12` comment: "Weekly (Friday 3:30 PM) — regime and cointegration refresh". But running `PairsTradingRunner.screen()` on a Friday does not refresh any cointegration state: the pair universe is a static constant, no cache is updated, no pair is retired. The Friday run is exactly the same as the midday run with potentially different z-scores. The name is misleading.

### F20 — Spread mean and std recomputed inside the same trade window

**Severity: Low.** `strategy_runner.py:2446-2451` computes mean_spread and std_spread on the last 60 bars that include the bar you are trading on. At a daily cadence this introduces a one-bar look-ahead of roughly 1/60 of the window — small but nonzero. Strict practice is to compute stats on [t-60, t-1] and trade at t.

---

## 2019–2024 Realistic Assessment

Setting aside the critical bugs (F1, F2) and imagining the system was implemented as advertised:

- **2019**: Pairs trading on large-cap US was already capacity-constrained. Gross Sharpe ~0.5, net ~0.2.
- **2020**: COVID broke many pairs (XOM/CVX during negative oil, T/VZ as work-from-home hit telecoms differently, retail pairs during WFM reallocation). Stat-arb desks booked their worst year since 2007. Sharpe near zero for simple implementations; -0.5 for some.
- **2021**: Dispersion recovery and meme-stock squeezes. Short legs (the "overperformer") got squeezed repeatedly. Net Sharpe ~0.3.
- **2022**: Energy rally (XOM, CVX both +60%), rate-regime shift. Two-thirds of classical sector pairs underperformed. Sharpe ~0.2.
- **2023**: AI reallocation broke MSFT/AAPL-style megacap pairs (NVDA-driven flows, meta-rally, etc.). Sharpe ~0.1.
- **2024**: Partial recovery as dispersion normalised. Sharpe ~0.4.

**5-year net Sharpe for a well-implemented large-cap pairs book: 0.2–0.4.** This is below the hurdle rate for a dedicated strategy allocation.

**5-year net Sharpe for AlphaDesk's actual implementation (long-only, single-leg, 12 hand-picked pairs, 60-day z, 5% fixed stops, no borrow cost): probably negative.** The strategy is buying the temporarily-weaker of two mega-caps and holding for up to 20 days against a 5% stop. Historically since 2019, on the specific pair universe the code ships, this would have been hit by the T/VZ break, the 2022 XOM/CVX decoupling, and the 2023 MSFT/AAPL dispersion. The long-only "pick the loser" bias means 2022 would have been particularly ugly.

---

## Score: 28 / 100

| Dimension | Score | Rationale |
|---|---:|---|
| **Pair selection rigour** | 2/15 | No Engle-Granger, no Johansen, no p-value gate, 12 static hand-picked pairs, no rolling re-qualification. |
| **Cointegration / statistics** | 6/15 | OU half-life regression, R/S Hurst, correlation filter, rolling std-expansion guard all **present and correct**; but none of them are cointegration tests and Hurst on ~120 bars is noisy. |
| **Z-score formation** | 5/10 | 60-day OLS hedge + rolling z is reasonable shape, but same window for fit and test, and static hedge ratio. |
| **Entry/exit/stop design** | 4/10 | 2.0 / 0.5 / 4.0 is textbook. But only Path A has adaptive thresholds and Path A is dead code. Path B (live) uses fixed ±5% stops unrelated to the spread. |
| **Execution correctness** | 1/15 | **Live runner is single-leg long-only.** This is the report's biggest deduction. No short leg, no dollar neutrality, no pair tracking in ledger. |
| **Structural-break / risk management** | 3/10 | Rolling std guard exists. Nothing else — no pair retirement, no per-pair P&L to cut losers, no cointegration re-test. |
| **Transaction costs / borrow / slippage** | 0/10 | Not modelled anywhere in the strategy path. |
| **Crowding / differentiation** | 1/5 | 12 of the most-traded sector pairs on Wall Street; no differentiation. |
| **Code quality / hygiene** | 3/5 | Pure-Python math (no numpy/statsmodels) is readable but error-prone at scale; duplicate pair lists drift between files; no unit tests visible. |
| **Truthfulness of marketing copy** | 3/5 | Gap between `strategy-content.ts` claims (Engle-Granger, S&P 500 scan, market-neutral) and code (static list, no cointegration, long-only) is a compliance and user-trust issue. |
| **Total** | **28 / 100** | |

---

## Recommendations (Priority Order)

1. **Fix F1 immediately.** Either (a) make `PairsTradingRunner` emit two legs with one buy and one sell via a short-capable trade path, or (b) change the marketing copy on `tradingalpha.net` and remove all market-neutral / stat-arb language. The current state is dishonest marketing of a long-only mean-reversion pick.
2. **Wire Path A (`PairsTradingStrategy`) into the live pipeline** instead of the half-baked Path B runner. Path A at least has `map_to_trade` that produces a proper two-legged structure (`pairs_trading.py:205-242`).
3. **Add Engle-Granger ADF** on the spread residual after OLS. statsmodels is already a reasonable dependency; a proper ADF test is ~5 lines.
4. **Replace the static `SECTOR_PAIRS` literal with a rolling screener** that tests all within-sector S&P 500 pairs monthly with a 12-month formation window. Retire pairs whose ADF p-value exceeds 0.1 or whose per-pair cumulative P&L falls below -3% over 6 months.
5. **Implement a Kalman-filter hedge ratio** (or at least weekly rolling β re-fit) so that drift in mega-cap correlations doesn't convert pair trades into directional bets.
6. **Add a transaction-cost model** that deducts round-trip commission + half-spread per leg + short-borrow for the short leg when backtesting/attributing P&L.
7. **Track pair positions as compound entities** in the ledger so per-pair Sharpe, pair-level exits, and coordinated closes are possible.
8. **Remove the duplicate `pairs-stat-arb` UI card** or wire it to a genuinely distinct second strategy (e.g. Avellaneda-Lee PCA-residual stat-arb).
9. **Reconcile the 30-day half-life cap with the 20-day max hold** — pick a consistent holding-period-vs-half-life ratio (textbook: 2×HL).
10. **Run the Friday job as an actual cointegration refresh** (re-run the universe screener and update a Redis-cached pair set) rather than the same daily scan at a different time.

---

## Citations for Key Claims

- Single-leg long-only execution: `backend/data/ingestion/strategy_runner.py:2525-2554`, `backend/data/ingestion/strategy_runner.py:407-419`.
- No cointegration test: `backend/data/ingestion/strategy_runner.py:2265-2556` has no call to ADF, Engle-Granger, or Johansen; closest filters are half-life, Hurst, correlation.
- Static hard-coded pair list: `backend/strategies/pairs_trading.py:20-36`, `backend/data/ingestion/strategy_runner.py:2281-2286`.
- Z-score window = validation window: `backend/data/ingestion/strategy_runner.py:2446-2451`.
- Static hedge ratio: `backend/data/ingestion/strategy_runner.py:2440-2444`; no re-fit in `backend/strategies/pairs_trading.py:244-288`.
- No cost model: no reference to `commission`, `slippage`, or `borrow` anywhere on the pairs code path; `backend/agents/execution.py:106-157` submits raw Alpaca orders with no cost overlay.
- Dead Path A: `backend/strategies/__init__.py:12,26` registers `PairsTradingStrategy`; `get_strategy("pairs_trading")` is only called from `backend/strategies/regime_adaptive.py` and regime_adaptive hard-codes its source strategy to `momentum_quality` (`regime_adaptive.py:141`).
- Marketing vs code mismatch: `frontend/src/lib/strategy-content.ts:330,337,341,322,518` vs the code realities cited above.
- Duplicate UI card: `backend/api/routes/strategies.py:235-247` (`pairs-trading`) and `339-351` (`pairs-stat-arb`); only the former has a ledger mapping (`strategies.py:521`). No `pairs_stat_arb` in `ALL_STRATEGIES` (`strategy_runner.py:3440-3456`).
- Live API unreachable: `https://tradingalpha.net/api/strategies` returned HTTP 404 for unauthenticated probes during this audit.
