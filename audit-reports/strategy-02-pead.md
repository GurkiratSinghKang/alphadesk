# Strategy Audit — PEAD (Post-Earnings Announcement Drift)
Auditor: PEAD Quant (15 yrs)
Date: 2026-04-17

## Executive Summary

AlphaDesk ships **two parallel PEAD implementations** that never meet. The `PEADStrategy` class in `backend/strategies/pead.py` reads like a respectable textbook PEAD screener (SUE-ish surprise, revenue confirmation, volume confirmation, debit vertical spreads, 40-day drift window, time-based exit). It is registered in `backend/strategies/__init__.py:19` — and **never called by the live pipeline**. The strategy that actually runs on tradingalpha.net is `PEADRunner` in `backend/data/ingestion/strategy_runner.py:633`, which uses a price-change proxy (`|change_pct| > 3`), a hand-coded weekday earnings calendar (`_get_upcoming_earnings`, line 614), and a deterministic RNG demo screener (`_generate_demo_screener_results`, `backend/api/routes/screener.py:196`) as its only data source.

Net effect: the live PEAD engine has **no earnings surprise data, no SUE, no consensus, no announcement timestamp, no point-in-time estimates, no borrow model, no short side, no options leg** — and it trades long-only equity off a pseudo-random `change_pct` that is regenerated each run with a symbol-seeded RNG. It also runs twice per day in `PREMARKET_STRATEGIES` and `OPEN_STRATEGIES` (`backend/data/ingestion/pipeline_runner.py:46,49`), meaning the same RNG draw drives duplicate signals on the same session.

The textbook file (`strategies/pead.py`) would earn a modest passing grade on a skeleton-level review; the live runner (`strategy_runner.py`) would not be recognisable as PEAD by Bernard & Thomas (1989) or Livnat & Mendenhall (2006). Expected out-of-sample 2019–2024 Sharpe for the live engine, had it ever traded real data, is in the range **−0.1 to +0.1** (statistically indistinguishable from zero, with adverse selection on the revenue_confirm filter). For the textbook file, assuming the `eps_surprise_pct`, `days_since_earnings`, `revenue_beat`, `earnings_volume_ratio` dict keys were wired to a real fundamentals feed, a realistic long-only Sharpe would be **0.2–0.4** post-cost (PEAD has decayed substantially since ~2005), not the "0.6–1.0" claimed in `STRATEGY_RESEARCH_REPORT.md:55` or the `Sharpe 1.5-2.0` implied by the frontend marketing copy at `frontend/src/lib/strategy-content.ts:54-89`.

## How it's supposed to work (textbook)

A production PEAD book looks roughly like this:

1. **Signal.** Standardised Unexpected Earnings: `SUE_t = (EPS_actual − E[EPS_t]) / σ(surprises)`, where `E[EPS_t]` is either the seasonal random walk `EPS_{t-4}` (Bernard & Thomas 1989) or the median I/B/E/S analyst consensus frozen as of T-1 (Livnat & Mendenhall 2006). σ is a trailing 8-quarter standard deviation of the forecast error. Dollar-SUE or revenue-SUE variants are common.
2. **Universe.** Liquid U.S. equities, median ADV > $5–20M, price > $5, market cap > $500M. Exclude OTC, SPACs, recent IPOs (< 4 quarters of history).
3. **Entry.** Form deciles/quintiles on SUE. Go long top decile (SUE > ~1.5–2), short bottom decile (SUE < ~−1.5 to −2). Enter at the open of T+1 (first full post-announcement day), never at T open (look-ahead), never at T close (you'd need real-time earnings time-of-day classification). Control for BMO vs AMC reports.
4. **Holding period.** 60 trading days (canonical) or to next earnings report (whichever first), with monotonic decay — the modern implementation is 1–30 day CARs because most of the drift now concentrates in the first 2 weeks (Chordia, Goyal, Sadka et al. 2009).
5. **Portfolio construction.** Equal-weight within deciles, or size ∝ |SUE|·1/σ (risk parity). Overlapping cohort structure: each day holds K overlapping 60-day baskets, so turnover is bounded and exposure is stable.
6. **Short side.** Real PEAD P&L comes disproportionately from the short leg. Borrow costs must be modelled (hard-to-borrow names carry 50–500 bps of negative carry annualised, occasionally far worse), and negative-SUE names are disproportionately hard to borrow — this is where naive backtests explode in post-2005 era.
7. **Realism.** Model bid/ask on entry, slippage around the 4pm earnings gap, IV crush for any option overlay, and point-in-time restatements (never use revised EPS).
8. **Regime awareness.** PEAD Sharpe was ~1.0–1.5 in the 1980s–1990s (Bernard & Thomas); ~0.6–0.8 in 2000–2004; **0.3–0.5 post-2005**; and below 0.3 in 2015–2024 with frequent multi-year flat stretches. Decomposition shows most decay is in the long leg; the short leg retains more of its edge but is eaten by borrow.

Typical modern implementation: long/short equal-weight deciles, 60-day overlapping holding, post-cost Sharpe ~0.4 (US), ~0.6 (global), drawdowns of −15% to −25%, correlation to SPY near zero.

## What AlphaDesk actually does

There are two code paths and they diverge at every design decision.

### Path A — `backend/strategies/pead.py` (textbook skeleton, NOT WIRED)

- **Ingress dict keys** (`pead.py:33-48`): `days_since_earnings`, `eps_surprise_pct`, `revenue_beat`, `earnings_volume_ratio`, `guidance`, `earnings_gap_pct`, `historical_drift`, `analyst_revisions_up`. **None of these keys are ever populated anywhere in the codebase** — a repo-wide grep for the names returns only these in-file reads, no writes (confirmed via search).
- Screen criteria (`pead.py:22-27`): `MIN_SURPRISE_PCT=5.0` (of what? the code reads `eps_surprise_pct` — presumably percent surprise vs consensus, but the semantics are ambiguous and no σ-normalisation), `MIN_REVENUE_BEAT=True`, `MIN_VOLUME_RATIO=1.5`, `MAX_ENTRY_DELAY=3`, `DRIFT_WINDOW_DAYS=40`.
- Composite score (`pead.py:56`): `|surprise|/10 + guidance_bonus + vol_ratio/5`. Dimensionally incoherent — adding a pure ratio, a bonus in the ±0.2 range, and a rescaled volume ratio.
- Direction (`pead.py:57`): long on positive surprise, short on negative — but shorting never actually happens because `map_to_trade` converts both directions to option spreads (`pead.py:113-152`), and the live runner strips the short leg entirely.
- Trade mapping (`pead.py:125-136`): **bull call spread** at 0.55/0.30 delta, **bear put spread** at −0.55/−0.30, target DTE 45, profit target 75% of max, stop 100%, time stop 40 days. The legs are defined but no options selection / quoting / fill logic exists anywhere that consumes this output.
- This whole class is registered at `backend/strategies/__init__.py:19` via `get_strategy("pead")` — and the helper `get_strategy()` has **zero callers** in the backend. Pipeline execution goes through the `strategy_runner.py` path below.

### Path B — `backend/data/ingestion/strategy_runner.py:633` (the live PEADRunner)

- **Earnings calendar** (`strategy_runner.py:614-630`): a hard-coded five-element dict mapping `weekday() → {"JPM","WFC",...}`. No real earnings feed, no API, no date cross-check. On a Monday the calendar always contains the same four banks; on a Tuesday always the same four healthcare/banks; ad infinitum. This is a placeholder, not a signal.
- **Surprise proxy** (`strategy_runner.py:655-681`): `change_pct` is compared to a static `SECTOR_AVG_REACTION` dict of long-run averages (e.g. Technology 6.5%, Utilities 2.5%, hard-coded). `reaction_ratio = |change_pct| / sector_avg`. This is **not** a surprise measure — it is a same-day price move scaled by an intuited sector constant. There is no announced EPS, no consensus, no σ.
- **Revenue confirmation proxy** (`strategy_runner.py:672-674`): `f_score >= 6 AND composite > 55`. The Piotroski F-Score is an annual-data quality screen with no mechanical link to current-quarter revenue beat; `composite` is the screener's own weighted blend (`backend/api/routes/screener.py:211-216`) that includes `rs_score`, `f_score`, `(100 − iv_rank)`, `ml_score`, and **a uniform random number between 30 and 90**. Calling this a "revenue beat confirmation" is misleading.
- **Input data** (`strategy_runner.py:685`, via `_get_screener_results` → `_generate_demo_screener_results`): the entire candidate universe is **14 hard-coded demo stocks** (`screener.py:180-184` and the surrounding list) with metrics produced by `random.Random(_symbol_seed(ticker))` — deterministic per symbol, but re-drawn each call to `_generate_demo_screener_results`. The comment in `strategy_runner.py:166` reads "Return demo screener results as plain dicts." Production PEAD is being driven by `rng.uniform(-4.0, 5.0)` (`screener.py:203`).
- **Entry rule** (`strategy_runner.py:698-708`): `|change_pct| > 3` either with or without calendar confirmation. This means: any RNG draw of magnitude > 3% is a "PEAD candidate", whether or not earnings were released, whether or not the calendar placeholder is populated.
- **Signal / side** (`strategy_runner.py:745-768`): buy if `change_pct > 3 AND composite > 55`; "sell" if `change_pct < −3 AND composite < 45`; but `BaseStrategyRunner.generate_trades` (`strategy_runner.py:353-432`) only routes `sig == "buy"` to the master agent — the short side is **silently discarded** at line 369: `if sig != "buy" or conv < 50: continue`. So the strategy is long-only in practice.
- **Position size** (`strategy_runner.py:381-382`): `notional = min(vol_targeted, MAX_POSITION_DOLLAR)` where `MAX_POSITION_DOLLAR = 6_000.0` (`strategy_runner.py:21`). On a $100K demo account this is 6% per name — aggressive concentration for an anomaly with 55–58% hit rate.
- **Exit logic** (`strategy_runner.py:774-777`): `stop_loss = price * 0.96` (4% hard stop), `take_profit = price * (1.08 + min(reaction_ratio*0.02, 0.06))` — so TP is 8%–14%. There is **no time-based exit, no drift-window management, no exit-on-next-earnings, no manage() call from the runner path**. The textbook `manage()` in `pead.py:154-172` uses `DRIFT_WINDOW_DAYS=40` but is never invoked.
- **Scheduling** (`pipeline_runner.py:46,49`): runs in both `PREMARKET_STRATEGIES` and `OPEN_STRATEGIES`, so signals are generated at 06:00 ET and 09:35 ET on the same data.
- **Ledger** (`backend/data/pipeline_logs/2026-04-10.json:46`, `ledger.json:12-14`): actual live trades include "PEAD: MRK moved +4.8% (composite 76), drift expected to continue." with a fixed 4% stop / 8% target. MRK was the sole PEAD position during the 2026-04-08 through 2026-04-10 pipeline logs I inspected.

### Production status
- `multi_strategy_result.json` shows PEAD screened 13, analysed 3, requested 3, approved 1 (MRK).
- `STRATEGY_RESEARCH_REPORT.md:55` flags "Missing: actual earnings date data" — the team is aware.
- Frontend copy (`frontend/src/lib/strategy-content.ts:54-89`) describes a spread-based SUE-filtered PEAD with Bernard & Thomas citations; none of that matches the running code.
- The production `/api/strategies` endpoint lives behind auth (returned 401 on unauth fetch) and `/api/strategies` on the bare host returned 404; the UI wraps the same backend routes described in `backend/api/routes/strategies.py`, whose PEAD metadata (`strategies.py:144-156`) carries the swing description matching the frontend copy.

## Findings / Shortcomings

1. **P0 — Two parallel PEAD code paths; the textbook one is dead code.** `backend/strategies/pead.py` is never called. The live path is `backend/data/ingestion/strategy_runner.py:633 PEADRunner`. Frontend copy, strategy metadata (`backend/api/routes/strategies.py:144-156`), and `STRATEGY_RESEARCH_REPORT.md` all describe the dead one. This is a documentation-vs-implementation fraud vector.

2. **P0 — No real earnings data, no SUE, no consensus.** `PEADRunner` has no access to announced EPS, no analyst consensus, no surprise standard deviation. `_estimate_surprise_strength` at `strategy_runner.py:647-681` computes `reaction_ratio = |change_pct| / sector_avg` which is a post-hoc price classifier, not a surprise signal. Bernard & Thomas–style SUE requires `(EPS_actual − E[EPS]) / σ`; none of the three terms exist in this codebase.

3. **P0 — Screener is a deterministic RNG, not a data source.** `_generate_demo_screener_results` at `backend/api/routes/screener.py:196-266` produces `change_pct = rng.uniform(-4.0, 5.0)`, `f_score = rng.randint(3, 9)`, etc., seeded by the ticker's md5 hash. Every "signal" the live PEAD runner generates is therefore a function of ticker hash, not of market data. Result: MRK appears as a "PEAD buy" on 2026-04-08, 2026-04-09, and 2026-04-10 with the same +4.8% move — not because MRK moved, but because `_symbol_seed("MRK")` is constant.

4. **P0 — Hard-coded weekday earnings calendar.** `_get_upcoming_earnings` at `strategy_runner.py:614-630` is a 5-key dict keyed on `date.today().weekday()`. No API, no date, no actual announcement time. JPM is always "reporting" on Mondays. This placeholder cannot be used for point-in-time signal construction under any interpretation.

5. **P0 — Short leg is silently dropped.** `PEADRunner.analyze` emits `"signal": "sell"` for negative surprises at `strategy_runner.py:766-768`, but `BaseStrategyRunner.generate_trades` filters `if sig != "buy"` at line 369. The entire left half of the SUE distribution — which is where most of the post-2005 PEAD edge lives — is discarded. Strategy is de-facto long-only, and the marketing/frontend content claiming "long/short" is incorrect.

6. **P0 — No point-in-time data discipline.** There is no restatement control, no vendor timestamp gate, no "as-of" EPS. Even if the data were real, there is nothing preventing the signal from using post-hoc values. For a strategy whose entire premise is timing the information boundary around an announcement, this is fatal.

7. **P1 — No entry-timing protocol.** No BMO/AMC classification, no "enter at T+1 open", no gap-open handling. `entry_price = a.get("entry_price") or a.get("price", 0)` (`strategy_runner.py:372`) uses whatever price is on the screener row at scan time. For morning announcements the signal fires pre-open at 06:00 ET (`pipeline_runner.py:46`); for evening announcements, next morning at 09:35 — inconsistent treatment, and both are subject to the RNG screener anyway.

8. **P1 — `MAX_ENTRY_DELAY = 3 trading days`** in the textbook file (`pead.py:26`) is tight by textbook standards (3–5 is OK), but the field `days_since_earnings` that feeds it is never populated. The live runner has no equivalent — it enters any day the RNG draws `|change_pct| > 3`, so "drift contamination" is not merely possible, it is the mechanism.

9. **P1 — No liquidity / size screens.** No ADV floor, no price floor, no market-cap minimum, no spread check. The only universe filter is `_get_screener_results` which takes 14 demo stocks with price 10–500 (`backend/data/ingestion/strategy_runner.py:174-176`). On a real universe, the 1,000-stock small-cap names are where PEAD is strongest (Livnat & Mendenhall 2006) — and where execution costs destroy it without a liquidity filter.

10. **P1 — Holding period mismatch.** The textbook `DRIFT_WINDOW_DAYS = 40` (`pead.py:25`) is reasonable. The live runner has **no** holding-period control: it sets a 4% stop and an 8–14% target (`strategy_runner.py:774-777`) and lets the position live until one hits. This changes the distribution of outcomes — classical PEAD P&L is a positive-skew, time-exit payoff; the live implementation converts it to a stop-loss-capped mean-reversion bet in the wrong direction.

11. **P1 — Position sizing is fixed-notional, not SUE-weighted and not inverse-volatility.** `MAX_POSITION_DOLLAR = 6000` (`strategy_runner.py:21`) is a flat cap. Volatility scaling is opt-in via `calculate_vol_targeted_size` (line 377), but no SUE-weighting (which is what controls risk-adjusted PEAD performance) exists. Textbook `|SUE|·σ⁻¹` sizing is absent.

12. **P1 — "Revenue confirmation" is the F-Score, which is annual-data.** `strategy_runner.py:672-674` requires `f_score >= 6 AND composite > 55`. Piotroski's F-Score is based on annual 10-K metrics (ROA, leverage change, margin change, etc.); it has no mechanical relation to the current quarter's revenue beat. Using it as "revenue confirmation" is a category error, and it biases the filter toward high-ROA, low-leverage names (a factor tilt, not a PEAD input).

13. **P1 — No borrow-cost model, no HTB check.** Even if the short side were kept, there is no borrow-rate awareness. Negative-SUE names are disproportionately hard-to-borrow; backtests without borrow over-state the short leg by 200–500 bps/year historically.

14. **P2 — Composite score at `pead.py:56` is unit-inconsistent.** `abs(surprise)/10 + guidance_bonus + vol_ratio/5` mixes a 0–∞ rescaled surprise with a ±0.2 categorical bonus and a 0–∞ rescaled volume. Rank stability across regimes is not analysed. A z-scored SUE-weighted composite would be standard.

15. **P2 — Guidance bonus magnitudes (`pead.py:53`) are ad hoc.** `raised = +0.2, lowered = −0.1` is asymmetric and uncalibrated. The literature (Ke & Yu 2006) supports treating guidance as a second-order signal but would calibrate to σ of post-guidance returns, not to hand-picked constants.

16. **P2 — No regime / decay handling.** PEAD has decayed materially post-2005 (Chordia et al. 2009, Chu et al. 2020). The implementation has no rolling re-estimation of drift magnitude, no regime gate, no "turn off when the anomaly flattens" switch. The frontend copy at `frontend/src/lib/strategy-content.ts:82` says "PEAD works across market regimes because it is event-driven" — that is the opposite of the empirical evidence since 2010.

17. **P2 — Duplicate signal generation from scheduling.** PEAD runs in both `PREMARKET_STRATEGIES` and `OPEN_STRATEGIES` (`pipeline_runner.py:46,49`). The RNG draws drive the same candidates; the master agent's "already held" dedup (`multi_strategy_result.json` shows `MRK already held by strategy 'pead'`) is the only thing preventing double-ups. A real calendar would gate this properly.

18. **P2 — Pseudo-options plumbing in `pead.py:113-152` is unreachable.** The textbook path produces `bull_call_spread` / `bear_put_spread` legs at 0.55/0.30 delta with 45 DTE. The codebase has no options quoting, no leg selection, no IV surface — Alpaca in the codepath I see is equities-only. So even if `PEADStrategy` were wired, the output would not be executable.

19. **P3 — Annualised return helper (`backend/api/routes/strategies.py:394-419`) extrapolates short track records.** For any `days_held >= 30`, it linearly scales return to an annual basis. PEAD should be the first to benefit from this being conservative — PEAD's Sharpe is most mis-estimated on short samples.

20. **P3 — Sparkline synthesis (`backend/api/routes/strategies.py:422-451`) uses a symbol-seeded RNG even when actual trades exist.** Strategy performance shown on the UI is partly a seeded random walk targeted at the real end-value, not a true reconstruction. Cosmetically fine, scientifically misleading — and relevant because this is the visual the user sees for "PEAD performance".

## 5-Year Backtest Assessment (2019-2024, US markets)

I cannot reproduce a 5-year live backtest from the repo because **there is no backtest engine** — `STRATEGY_RESEARCH_REPORT.md` contains 1-year Sharpe estimates for individual stocks and a handful of pipeline snapshots (`big_run_result.json`, `multi_strategy_result.json`, `backend/data/pipeline_logs/2026-04-*.json`) that capture a single live pipeline run each. No walk-forward, no rolling window, no out-of-sample split.

Given the construction, here is what a competent PEAD quant would expect if each path were actually run live over 2019-2024 on a liquid US mid/large-cap universe:

| Implementation | Expected 2019–2024 Sharpe (post-cost) | Expected CAGR | Max DD | Notes |
|---|---|---|---|---|
| **Textbook `PEADStrategy` (wired to real data, long-only, no options)** | 0.2 – 0.4 | 3–6% | −12 to −20% | Plausible under the stated params if inputs were real. PEAD has decayed; 0.4 is an upper bound with generous assumptions. |
| **Textbook with options overlay as coded (bull/bear verticals, 45 DTE)** | 0.1 – 0.3 | 2–5% | −18 to −28% | Vertical debit spreads eat the drift's gentle slope with theta. Classical PEAD pays off slowly; verticals are wrong instrument. |
| **Textbook long/short (top–bottom decile, equal-weight, 60d overlapping)** | 0.3 – 0.5 | 4–7% | −15 to −22% | This is what "Sharpe 0.6–1.0" in `STRATEGY_RESEARCH_REPORT.md:55` *could* achieve circa 1995–2004, not 2019–2024. |
| **Live `PEADRunner` on real data, long-only, 4%/8%-14% stops** | **−0.1 to +0.1** | −1% to +2% | −10 to −22% | Tight stops clip positive-skew payoffs; wide targets rarely fill; filter is a price-momentum proxy not a SUE signal; long-only throws away the healthier short leg. |
| **Live `PEADRunner` as currently wired (demo RNG screener)** | N/A (degenerate) | N/A | N/A | Output is a deterministic function of ticker hash. Sharpe is undefined because there is no real randomness vs market returns. |

**Benchmarks for a well-implemented PEAD L/S book, 2019–2024 US:**
- Long-only top decile: Sharpe 0.2–0.4, CAGR 4–7%, DD −15 to −22%
- Long/short (D10 − D1), equal-weight: Sharpe 0.4–0.6, CAGR 3–5% (net of costs), DD −10 to −18%
- Long/short, |SUE|-weighted, ex-HTB universe: Sharpe 0.5–0.7, CAGR 4–6%, DD −8 to −14%

The 0.4–0.7 range the task spec cites is right for a competently built L/S PEAD book. AlphaDesk's live implementation is not that; the textbook file, if wired, would be in the 0.2–0.4 range (long-only, equity, no options, no SUE-weighting) — still defensible, just much lower than the marketing suggests.

**Existing artifacts cited:**
- `STRATEGY_RESEARCH_REPORT.md:55` acknowledges PEAD is "Missing: actual earnings date data" with an expected Sharpe range of 0.6–1.0 — optimistic by current-decade standards but consistent with mid-2000s literature.
- `multi_strategy_result.json` shows PEAD generated 3 trade requests, 1 approved (MRK), 0 closed — insufficient sample.
- `backend/data/pipeline_logs/2026-04-08.json`, `2026-04-09.json`, `2026-04-10.json` show the same MRK PEAD position re-proposed across three consecutive runs, each time rejected for "already held" — confirms the RNG-driven screener behaviour noted in Finding #3.
- `backend/data/pipeline_logs/ledger.json:11-14` shows the single live PEAD trade open on MRK with rationale "PEAD: MRK moved +4.8% (composite 76), drift expected to continue" — indistinguishable from a 1-day momentum trade.

## Strategy Score: 18/100

Breakdown:
- **Signal correctness /25 — 3/25.** No SUE, no consensus, no σ, no announcement timestamp. `reaction_ratio` is a price-momentum variable masquerading as a surprise measure. `revenue_confirm` is misnamed F-Score. Long-only despite the short-side signal being emitted then discarded. Earnings calendar is a weekday placeholder. Credit is limited to recognising that PEAD requires post-announcement entry (the `is_upcoming` skip at `strategy_runner.py:742-743` is correct in spirit).
- **Portfolio construction /20 — 4/20.** Fixed `$6,000` per position with optional vol-target; no SUE-weighted sizing; no overlapping-cohort structure; no sector or beta neutralisation; no decile/quintile formation. Short leg silently dropped.
- **Risk controls /15 — 4/15.** Has hard 4% stop and 8–14% profit target (`strategy_runner.py:774-777`), and master-agent allocation caps (`multi_strategy_result.json` shows the `$10,005` cap enforced). Missing: time-exit, drift-window exit, exit-on-next-earnings, sector concentration limits, borrow-cost gating, HTB exclusion. Stop-loss on a 40-day drift is the wrong instrument.
- **Data hygiene /20 — 1/20.** Point-in-time: absent. Restatement control: absent. Calendar: a hand-coded weekday dict. Universe: 14 demo stocks from a seeded RNG. Look-ahead: not prevented structurally because there is no real data in the path. This dimension is effectively a 0; the 1 point recognises that the `analyze` step does avoid pulling the "bar after the signal".
- **Realism /10 — 2/10.** No borrow, no commission model, no slippage, no bid/ask, no IV-crush modelling for the dead options path, no overnight gap handling. Position-size notional is real-ish and Alpaca execution is connected for the equity leg — which is why it isn't zero.
- **Production readiness /10 — 4/10.** The runner is integrated with the pipeline scheduler, the master agent, the trade ledger, and the Alpaca execution path. It does produce orders and they do get placed. This is real production plumbing — it is just plumbed to the wrong signal. Given how much of the scaffolding is correct, fixing the strategy is weeks of work (real earnings feed, SUE computation, point-in-time store), not a full rewrite.

**Total: 18/100.**

Verdict: the live PEAD book should be **paused** until a real earnings-calendar + consensus data source is wired (`Finviz Elite`, `FMP`, `Zacks`, `Refinitiv IBES Summary` are the typical vendors), the short side is implemented or the strategy is renamed "long-only earnings-gap continuation", and the dead `strategies/pead.py` is either wired or deleted. The textbook file is a credible starting skeleton and should not be discarded — it is the right shape, just the wrong side of the data cliff.

**Files examined:**
- `/Users/GK/Downloads/alphadesk/backend/strategies/pead.py` (full)
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py` (full)
- `/Users/GK/Downloads/alphadesk/backend/strategies/__init__.py` (full)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py` (lines 1-300, 336-480, 600-820, 3440-3442)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py` (full)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/screener.py` (lines 180-270)
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py` (schedule constants)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts` (full)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts` (PEAD section at lines 54-89)
- `/Users/GK/Downloads/alphadesk/STRATEGY_RESEARCH_REPORT.md` (sections 1-4)
- `/Users/GK/Downloads/alphadesk/multi_strategy_result.json`
- `/Users/GK/Downloads/alphadesk/big_run_result.json`
- `/Users/GK/Downloads/alphadesk/backend/data/pipeline_logs/2026-04-08.json`, `2026-04-09.json`, `2026-04-10.json`, `ledger.json`
- Live endpoint `https://tradingalpha.net/api/strategies` — 404; `/api/v1/strategies/` — 401 (auth required; inaccessible without a session cookie).
