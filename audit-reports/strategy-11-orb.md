# Strategy Audit 11 — Opening Range Breakout (ORB)

**Auditor:** Quant research (15+ yrs, intraday specialist)
**Date:** 2026-04-17
**Repo branch:** feature/deployment
**Files audited:**
- `/Users/GK/Downloads/alphadesk/backend/strategies/orb.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/base.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/__init__.py`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/strategy_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/realtime_scanner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/pipeline_runner.py`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/daily_pipeline.py`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts`
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/strategy-content.ts`
- `/Users/GK/Downloads/alphadesk/big_run_result.json`, `multi_strategy_result.json`, `STRATEGY_RESEARCH_REPORT.md`
- Live API probe: `https://tradingalpha.net/api/strategies` (404; authenticated-only surface)

---

## Executive Summary

AlphaDesk ships two parallel ORB implementations — a "clean" class-based one in `backend/strategies/orb.py` and a runner variant in `backend/data/ingestion/strategy_runner.py::ORBRunner` — that share identical parameters, identical calendar helpers, and identical logic but are never cross-referenced (code duplication — not reuse). Both use a **30-minute opening range** (not 5-minute), sized as `max(first 6 × 5-min bars)` for the high and `min` for the low. This is the classic Crabel / Fisher ACD formulation, not the Zarattini & Aziz 2023 paper that reignited academic interest in ORB (which uses a **5-min OR on TQQQ/QQQ**). The platform does **not** trade leveraged ETFs — it scans the generic large-cap screener universe.

The design is deliberate about filters: FOMC / NFP / OpEx exclusion, a 0.3 %–3 % OR-width band, a relative-volume gate (1.5× of a crude `daily_vol × 0.30` proxy), a pre-market gap-reversal penalty, a NR7 bonus, a VWAP-confirmation bonus, and a hard 11:30 ET cutoff. On paper these match what a serious ORB practitioner would put in, and they are well named and well commented.

But **the plumbing is broken in three ways that make the strategy effectively non-executing or non-realistic in production**:

1. The runner discards **every short signal** (`if direction == "short": continue` — `strategy_runner.py:3044–3045`), so 2022 bear-market shorts — the one market condition that actually *worked* for ORB out-of-sample — are structurally unreachable.
2. The runner is scheduled to fire at **exactly one moment per day** (10:05 AM ET window, `pipeline_runner.py:80, 186`) — it evaluates the OR break once, and if price is not already outside the range at that snapshot, no entry ever happens today. There is **no** persistent intraday monitoring for ORB even though `realtime_scanner.py` has scaffolding for an `orb_breakout` setup type (`realtime_scanner.py:125–133`) — nothing in the ORB runner ever calls `register_setup()` for it.
3. The `manage()` lifecycle uses a **hard-coded ±3 %/+5 % exit** (`orb.py:348, 352`) and a **"close after 1 day" rule keyed off calendar `days_held`** (`orb.py:344–345`), neither of which is consistent with the trade's *declared* exit rules (Fib 1.272 / 1.618 scale-out, 14:30 ET time-stop, 300-minute max hold — `orb.py:328–336`). Intraday positions that fire near market open will hit "days_held >= 1" within 24 hours, so the strategy effectively closes **once per calendar day** regardless of the intraday exit logic. For a strategy whose entire purpose is same-session close, this is fine in direction but the other management rules are dead code.

Secondary issues: crude RVOL proxy, generic universe with no ETF/TQQQ tilt (Zarattini's result does **not** generalize), no slippage/fill model, `prev_close` for gap detection read from `daily_closes[-2]` which is yesterday's close vs. today-or-yesterday's OR low (off-by-one risk depending on Alpaca bar timestamping), and zero published backtest numbers — neither `big_run_result.json` nor `multi_strategy_result.json` nor `STRATEGY_RESEARCH_REPORT.md` contains a single ORB trade, signal, or statistic.

**Score: 46 / 100** (see breakdown below).

---

## Textbook ORB (what a quant would expect)

### Canonical references
- **Toby Crabel (1990)** — *Day Trading With Short Term Price Patterns and Opening Range Breakout.* First-30-minute or 60-minute range; entry on break of high/low; stop at opposite extreme; intraday only; NR4 / NR7 context days. Crabel himself used the New York futures pit open.
- **Mark Fisher (2002)** — *The Logical Trader* (ACD Method). "A" level = OR, "C" / "D" = failure reversal levels; pivot-range layering.
- **Zarattini & Aziz (2023)** — *A Profitable Day Trading Strategy For The US Equity Market.* This is the paper that revived ORB in the literature: **5-minute** opening range on **TQQQ** (and separately QQQ/SPY), **long-only** when price breaks above OR-high, **stop at OR-low**, EOD close at 16:00 ET, volume-normalized sizing. Reports Sharpe > 2 on the TQQQ variant 2016–2023.

### Textbook design (intraday equities ORB circa 2024)
| Dimension | Canonical choice |
|---|---|
| OR window | **5-min** (Zarattini) or 15/30-min (Crabel). Shorter = more signals, more noise. |
| Direction | Long-only on OR-high break is the Zarattini cut; symmetric long/short is Crabel. |
| First-break-of-day rule | Only the **first** cross of either boundary counts; later re-crosses are noise. |
| Instrument | TQQQ / QQQ / SPY favored by Zarattini. Single-name universes fragment signal into dozens of correlated bets. |
| Stop | OR-low (long) / OR-high (short). Some use 1× OR width or 0.5× OR width. ATR-based is a variant. |
| Target | None in Zarattini (hold to 16:00 ET). Fib extensions (Fisher). Multiples of OR width (Crabel). |
| Volume filter | First-30-min RVOL > 1× typical; Zarattini uses dollar-volume percentile rank. |
| Time cutoff | No new entries after 11:00–12:00 ET; Zarattini has only the open bar. |
| Macro filter | FOMC / NFP / CPI days reduce edge by 30–50 %. |
| EOD close | Mandatory — holding overnight destroys the statistical edge. |
| Data | **1-min or 5-min bars with accurate timestamps.** Daily bars are insufficient. |
| Slippage | Breakout fills are the worst in retail trading; realistic model uses 5–10 bp one-way. |

### Typical out-of-sample performance
- Zarattini TQQQ in-sample: Sharpe > 2.0, MAR > 1.0.
- Out-of-sample (after publication, 2023-2024) and on non-leveraged ETFs: Sharpe collapses to **0.4–1.0** once realistic slippage and half-turn commissions are applied.
- 2022 bear market: long-only ORB loses money; shorts make the year (this is why Zarattini's long-only cut needs the leveraged-long TQQQ edge).

---

## What AlphaDesk actually does

### Parameters
- OR window: **30 minutes** = 6 × 5-min bars (`orb.py:117`; `strategy_runner.py:2807, 2975–2976`). Matches Crabel, **not** Zarattini.
- OR-width acceptance band: **0.3 %–3 %** (`orb.py:122–123, 162`; `strategy_runner.py:2981`).
- Breakout buffer: **0.1 %** above/below in the class (`orb.py:118, 210–212`); **zero buffer** in the runner (`strategy_runner.py:3009–3010`). *These two implementations disagree.*
- Signal cutoff: **11:30 AM ET** (`orb.py:128–129, 174–180`; `strategy_runner.py:2812–2813, 2940–2946`).
- Stop: **0.5 × OR width** beyond entry (`orb.py:121, 309, 313`; `strategy_runner.py:3035` — long only).
- Targets: **Fib 1.272× and 1.618×** OR width (`orb.py:119–120, 310–315`; `strategy_runner.py:2810–2811, 3036–3037`).
- Time exit (declared): **14:30 ET** or **300 min** (`orb.py:124, 329, 331`).
- Risk per trade: **1 %** of equity (`orb.py:125, 297–299`).
- Notional cap: **6 % of equity** (`orb.py:302–304`).
- Relative-volume floor: **1.5×** (`orb.py:127, 196–202`; `strategy_runner.py:2809, 2999–3004`).
- Gap-reversal warning threshold: **+2 %** (`orb.py:126, 189`; `strategy_runner.py:2808, 2991`).

### Direction & instrument
- Class form `analyze()` computes both long and short breakouts and scores them symmetrically (`orb.py:211–235`).
- Runner form rejects short trades entirely: `if direction == "short": continue` (`strategy_runner.py:3044–3045`).
- Universe: generic screener results filtered by `volume > 500k` and `|change_pct| > 0.3 %` (`strategy_runner.py:2918–2926`). Class-form screen filters to `avg_volume > 2M` and `market_cap > $5B` (`orb.py:134–141`). **No TQQQ / QQQ / SPY tilt, no leveraged-ETF routing.**

### Data pipeline
- 5-min intraday bars via Alpaca `timeframe=5Min` (`strategy_runner.py:2894–2895`), with `start=YYYY-MM-DDT13:30:00Z` — i.e. 9:30 ET in UTC (`strategy_runner.py:2896`). Limit 78 (one full 5-min RTH day). This is adequate.
- Falls back to previous day's daily high/low when < 6 intraday bars are available (`strategy_runner.py:2965–2972`). That fallback is incorrect — it silently treats *yesterday's daily range* as today's OR, which has nothing to do with an opening range.
- Daily bars for NR7 and gap detection via `_get_bars` (`strategy_runner.py:2959–2963, 1470–1502`).

### Execution lifecycle
- Runner wired into `ALL_STRATEGIES` at `strategy_runner.py:3454`.
- Scheduled in `POST_OR_STRATEGIES = ["orb", ...]` at `pipeline_runner.py:52`, fired once per day at the `post_or` 10:05 ET window (`pipeline_runner.py:80, 184–186`).
- Class form registered at `backend/strategies/__init__.py:14, 28` but not used by the runner path.
- Frontend registration: `frontend/src/lib/strategies.ts:130–136` ("ORB", group `technical`); copy at `frontend/src/lib/strategy-content.ts:536–544`.
- Route/summary registration at `backend/api/routes/strategies.py:365–377, 530` (`"orb": "orb"`). Status: `ACTIVE`.
- Production API probe `/api/strategies` returns 404/401 — the public endpoint is authenticated-only and not publicly inspectable (no live ORB performance numbers available to the audit).

---

## Findings (20)

### F1 — Two parallel implementations with drift between them
Two ORB implementations exist: `backend/strategies/orb.py::ORBStrategy` (`orb.py:104–355`) following the `BaseStrategy` abstract class (`base.py:9–101`), and `backend/data/ingestion/strategy_runner.py::ORBRunner` (`strategy_runner.py:2788–3066`) following the runner interface. They re-declare the same FOMC / NFP / OpEx helpers twice (`orb.py:29–88` vs `strategy_runner.py:2817–2866`) and the same NR7 helper twice (`orb.py:91–101` vs `strategy_runner.py:2868–2874`). The runner never imports `ORBStrategy`. They also disagree in at least one behavioral parameter — the runner uses a **zero-buffer** breakout (`strategy_runner.py:3009–3010`) while the class uses a **0.1 % buffer** (`orb.py:118, 210–212`). This is a maintenance landmine: fixing a bug in one will not propagate.

### F2 — All short signals are silently discarded in the runner
`strategy_runner.py:3043–3045` hard-filters out `direction == "short"` after computing and scoring it. The *class-form* `analyze()` at `orb.py:211–235` scores shorts symmetrically and returns `direction = "bearish"`. The runner is the one actually executed by the daily pipeline (`pipeline_runner.py:52, 140`), so the short side is dead. Historically, 2022 was the year ORB *shorts* paid — long-only ORB loses money in a bear market. This is the single biggest performance-killing silent-default in the file.

### F3 — "Manage" function is inconsistent with declared exit rules
`map_to_trade` on `orb.py:328–336` declares `time_exit: 14:30_ET`, `or_midpoint_trail: True`, `max_hold_minutes: 300`, and a Fib 1.272 / 1.618 50/50 scale-out. But `manage` (`orb.py:339–355`) ignores all of that and uses fixed `pnl_pct <= -3` / `>= 5` thresholds with a calendar `days_held >= 1` close. Nothing in the code path ever consumes `or_midpoint_trail`, `max_hold_minutes`, `scale_out`, `take_profit_runner`, or `14:30_ET`. The declared exit contract is cosmetic. The class form is also bypassed entirely by the runner that actually executes (`strategy_runner.py::ORBRunner.analyze` returns its own dict).

### F4 — No real-time intraday monitoring; ORB only evaluated once per day
`pipeline_runner.py:186` fires `POST_OR_STRATEGIES` inside a 5-minute window around 10:05 ET. The runner pulls 5-min bars, computes the OR from the first 6 bars, and checks `price > or_high` **at that instant** (`strategy_runner.py:3009`). If price breaks out at 10:17 or 11:04 — which is when most ORBs trigger in live data — the strategy never sees it. `realtime_scanner.py:125–133` has an `orb_breakout` setup path that *would* catch live breaks via the Redis quote stream, but `ORBRunner` never calls `register_setup()`. The ORB watchlist is effectively empty. This turns a strategy whose whole edge is intraday breakout detection into a single-timestamp snapshot check.

### F5 — OR-window fallback silently substitutes yesterday's daily range
`strategy_runner.py:2965–2972`: when fewer than 6 intraday bars are available, the code falls back to `or_high = daily_highs[-1]`, `or_low = daily_lows[-1]`. This is **yesterday's (or today-so-far's) daily extremes** — not an opening range. The strategy then continues the full analysis, RVOL check, breakout detection, and trade generation using these imposter levels. In practice this only triggers before 10:00 ET (before 6 bars exist), but any schedule drift or early run silently fires a "breakout" of an unrelated range.

### F6 — Prev-close / gap math uses a potentially wrong daily-bar index
`strategy_runner.py:2987–2992` computes `prev_close = daily_closes[-2]` and compares to `or_low`. Alpaca's daily-bar API (`strategy_runner.py:1488`) with `limit=10` will include today's partial bar in most market sessions, making `daily_closes[-1]` = today's running close and `daily_closes[-2]` = **yesterday's** close — which is what the code intends. But if the call races to before the today bar exists, `daily_closes[-2]` becomes **the day before yesterday's** close. No date assertion is present. Best practice is to filter by `timestamps[-1] < today` before indexing. Combined with F4 (only one firing per day), the window is small but still a silent wrong-data risk.

### F7 — Breakout buffer inconsistency & zero-buffer default in runner
Class: `price > (or_high + buffer)` with `buffer = price × 0.001` (`orb.py:210–212`). Runner: `price > or_high` flat (`strategy_runner.py:3009–3010`). The runner's zero-buffer version will fire on the first tick that exactly equals or exceeds OR high by one cent — this is where false breakouts live. Academic Crabel uses a ≥ $0.10 / tick buffer; Zarattini uses first 5-min close > OR-high not first trade. Neither implementation uses a close-based confirmation.

### F8 — First-break-of-day is not enforced
Neither path tracks whether *an OR boundary has already been crossed today*. If price whips across and back through OR high multiple times, each subsequent cross above is treated as a fresh signal in the runner (up to the once-per-day schedule) or — if intraday monitoring were wired — in `realtime_scanner._evaluate_tick` (`realtime_scanner.py:125–133`). Zarattini and Crabel both explicitly trade only the **first** break. This is a known ORB failure mode.

### F9 — RVOL proxy is crude and biases against ORB-favoring days
`strategy_runner.py:2995–2998`: `avg_or_volume = avg_daily_vol × 0.30`, then `rvol = or_volume / avg_or_volume`, floor 1.5. The 30 % first-30-min share of daily volume is the unconditional historical average for NYSE large-caps (rough but acceptable as a scalar). The bias is in the **denominator**: `avg_daily_vol` is the mean of the last 10 days of daily volume. On days where yesterday's volume spiked (e.g., post-earnings), the denominator is inflated and today's first-30-min volume is *penalized*, exactly the opposite of what you want — ORB works best when today's volume is elevated. A median or a 20-day trailing median would be more robust. The class form skips this proxy entirely and expects the caller to inject `avg_or_volume` (`orb.py:194`) — a field no caller produces.

### F10 — Instrument selection is wrong for the Zarattini result
The Zarattini & Aziz 2023 Sharpe > 2 result was on **TQQQ** specifically (a 3× leveraged QQQ ETF) — leverage amplifies the intraday drift. QQQ/SPY at 1× produce Sharpe ~0.7-1.0 in the paper. The AlphaDesk screener universe (`strategy_runner.py:2918–2923`; `orb.py:135–141`) contains generic liquid large-caps filtered by market cap and volume — TQQQ/QQQ/SPY/SPXL have never been in the universe per `api/routes/symbols.py` (based on `_build_demo_symbols` usage throughout `strategies.py:1017–1028`). If the backtest numbers were implicitly benchmarked against Zarattini's paper, that's a cargo-cult.

### F11 — Sharpe / return / win-rate always zero in `_STRATEGIES` metadata
`backend/api/routes/strategies.py:365–377`: the ORB entry hard-codes `sharpe_ratio: 0`, `total_return_pct: 0`, `win_rate: 0`, `max_drawdown: 0`. The list endpoint (`strategies.py:575–694`) fills win-rate and return from the trade ledger, but **Sharpe is forced to 0** at `strategies.py:689` and `strategies.py:908`. The `/leaderboard` endpoint does compute a real Sharpe from per-trade returns × √252 (`strategies.py:774–779`), but that's Sharpe only when `>=1 closed trade` exists. No backtest drawdown is ever computed or displayed for ORB (or any strategy).

### F12 — Description text overstates the implementation
- Frontend copy at `frontend/src/lib/strategy-content.ts:536–544` claims the strategy "Close[s] all positions before 4:00 PM ET" and lists `"exitCriteria: Fibonacci targets (1.272x, 1.618x OR width), 0.5x OR stop, or end of day"` — but the runtime `manage()` (`orb.py:339–355`) uses `days_held >= 1`, not 4:00 PM intraday, and never implements the Fib scale-out.
- Router copy at `strategies.py:367` says "1.5x OR width target" — but the actual `map_to_trade` uses 1.272 / 1.618 (`orb.py:119–120, 310–315`). Router description and implementation contradict each other.

### F13 — No academic-citation consistency
`orb.py:1–18` cites Crabel 1990 and Fisher ACD. The description at `strategies.py:367` cites only Crabel + Fisher. Neither cites **Zarattini & Aziz 2023**, which is the paper driving 2024-era ORB interest and the specific source for the Fib/0.5× parameter choices the code actually uses. Either cite it or don't borrow its parameterizations.

### F14 — No slippage, fill, or opening-spread model
The `map_to_trade` entry price is just `price` (`orb.py:289–293, 324`). Breakout fills in live equity trading are notoriously bad — at 9:45 ET, with 1-cent ticks above OR high, the first fill can be 5–15 bp away on non-ETF names, and wider on volatile small/mid caps (the screener is not filtered to mega-caps only, just `market_cap > $5B`). No slippage is modeled in the runner or in any backtest infrastructure reachable from this audit.

### F15 — 1 % risk / 6 % notional cap produces wildly variable sizes
`orb.py:296–305`: `shares = floor(1% equity / (0.5 × OR width))`, capped at `6% equity / price`. For a $50 stock with 1 % OR width (= $0.50 range, stop = $0.25 risk), on $100k equity the unconstrained size is 4,000 shares = $200k notional. The 6 % cap drops it to 1,200 shares = $60k. The 4× forced downscaling means the 1 %-risk sizing logic is *constantly* overridden by the cap — the declared stop is meaningless because true position-level risk floats between 0.3 % and 1 % depending on how hard the cap binds. This is a Kelly-unfriendly sizing regime. Better: cap **before** computing shares, or use ATR- rather than OR-based risk.

### F16 — `or_vwap` never populated → VWAP-confirmation bonus always false
`orb.py:152, 214–220, 260`: the class form scores a +10 bonus on `vwap_confirm`. The required `data["or_vwap"]` field is read from the input dict, which no runner ever sets (`strategy_runner.py:2949–3047` passes `stock`, not an or_vwap-enriched dict). The class form is the only path that uses it, and that path isn't wired. So the VWAP-confirm bonus is dead code in both implementations.

### F17 — Calendar data is unmaintained and hard-coded
`orb.py:36–49` and `strategy_runner.py:2820–2833`: FOMC dates are hard-coded per year through 2026 only. NFP / OpEx are computed correctly (first / third Friday). Once 2027 rolls around, FOMC filter silently fails open (empty set, no skip). There's no "missing-calendar-data → fail closed" guard. For a strategy whose described edge depends on *avoiding* these days, silently allowing entries on a 2027 FOMC day is a real regression hazard.

### F18 — No backtest numbers exist anywhere
`STRATEGY_RESEARCH_REPORT.md` (the platform's benchmarking artifact) does not mention ORB / Crabel / Zarattini at all (grep: zero hits). `big_run_result.json` has one literal string "ORB" in it, inside a rejection reason for a different strategy — no ORB trade, signal, or analysis. `multi_strategy_result.json` contains only 6 strategies (momentum_quality, pead, vrp_harvest, earnings_vol, regime_adaptive, claude_alpha) — ORB isn't in the last captured multi-strategy run at all. There's no paper trail that says this strategy has ever produced a signal in any environment.

### F19 — Live production signal not inspectable from the audit
`https://tradingalpha.net/api/strategies` returns 404; `/api/v1/strategies` returns 401. The public tradingalpha.net marketing page does not expose per-strategy detail. Consequently, this audit cannot confirm or refute any live Sharpe / win-rate — the in-app ledger is the only source of truth and it is not reachable externally. The `_STRATEGIES["orb"]` scaffold at `strategies.py:365–377` will report `total_return_pct: 0, win_rate: -1, sharpe: 0` unless and until the ledger has ORB trades, which — per F18 — it almost certainly does not.

### F20 — Short-path stop/target still populated even though shorts are discarded
`strategy_runner.py:3038–3042` computes `stop_loss = price × 1.02`, `take_profit = price × 0.97`, `take_profit_runner = price × 0.96` for shorts — a fixed 2 %/3 % stop-target pair that has no relation to OR width. Then immediately at `strategy_runner.py:3044–3045`, shorts are discarded. This is dead branch logic, but if the short discard is ever removed without updating 3038–3042, shorts will trade with asymmetric, non-OR-scaled risk — which is exactly the failure mode that would kill 2022-style short performance. It's a trap.

---

## 5-Year Assessment (2019-2024)

Holding AlphaDesk's *implementation* to the test of 2019-2024 equity market regimes (not the Zarattini TQQQ curve):

| Period | Market regime | Expected ORB edge (textbook) | Expected ORB edge (AlphaDesk impl.) |
|---|---|---|---|
| 2019 | Grinding bull, low vol | ~0.3 Sharpe (long-only works but weak) | ~0.2 after costs; slippage unmodeled |
| 2020 Mar | COVID crash, VIX 80 | **ORB shorts Sharpe > 2**. Longs blow up. | **Zero** — shorts discarded at `strategy_runner.py:3044`. Calendar filters irrelevant. Long-only gets stopped out repeatedly. |
| 2020 Apr-2021 | Liquidity bull | Long-only ORB OK, Sharpe 0.6-0.9 | 0.3-0.5 after slippage; 6 % cap compresses winners |
| 2022 | Bear | **ORB shorts are the only way to make money**. Long-only loses. | Loses money; shorts structurally disabled |
| 2023 | AI-led bull | 0.5-0.8 Sharpe long-only | 0.2-0.4 after slippage, first-break-not-enforced whipsaws |
| 2024 | Rangebound to bull | 0.4-0.6 Sharpe long-only | 0.2-0.4 |

**Realistic out-of-sample Sharpe with this implementation, 2019-2024 equity-weighted:** ~**0.2-0.4 net of costs**, vs. textbook 0.5-0.8 long-only on a mega-cap universe and 1.0-1.5 on TQQQ specifically. The gap is entirely explained by:
1. Missing the 2022 short side.
2. Once-a-day snapshot check missing the actual breakout triggers.
3. No TQQQ / QQQ / SPY benchmark instrument.
4. Unmodeled slippage and first-break-not-enforced whipsaw losses.

The **parameter choices** (0.5× OR stop, 1.272/1.618 Fib targets, 30-min OR, 11:30 cutoff, 1 % risk, macro-day exclusion) are reasonable-to-good. The execution wiring is what gives back the edge.

---

## Score: 46 / 100

### Breakdown

| Component | Weight | Score | Weighted | Notes |
|---|---:|---:|---:|---|
| Academic foundation / parameter sanity | 15 | 11/15 | 11 | Crabel/Fisher params are correct; no Zarattini citation; numbers match the 2023 revival tightly, just not attributed. |
| Opening-range definition & math | 10 | 7/10 | 7 | 30-min OR via first 6×5-min bars is fine; fallback to yesterday's daily range is a silent bug (F5). |
| Entry logic (breakout rule, buffer, first-cross) | 10 | 4/10 | 4 | Zero-buffer in runner, 0.1 % in class (F7); first-cross-of-day not tracked (F8); VWAP confirm dead (F16). |
| Direction handling (long/short) | 10 | 2/10 | 2 | Shorts silently discarded (F2) — kills 2022; dead short-path with non-OR stops (F20). |
| Filter quality (RVOL, gap, NR7, macro, time cutoff) | 10 | 7/10 | 7 | All five filters are implemented; RVOL proxy is crude but present (F9); FOMC calendar goes stale 2027+ (F17). |
| Instrument/universe selection | 10 | 4/10 | 4 | Generic large-cap screen is not what the modern ORB edge lives on; no TQQQ/QQQ/SPY tilt (F10). |
| Risk & sizing discipline | 5 | 3/5 | 3 | 1 % risk + 0.5× OR stop is textbook; 6 % cap constantly overrides, so realized per-trade risk is not the declared 1 % (F15). |
| Exit logic (targets, stops, EOD) | 10 | 3/10 | 3 | Fib scale-out declared but never executed; `manage()` uses hard-coded ±3/+5 %; 14:30 time-exit is cosmetic (F3). |
| Intraday monitoring / execution plumbing | 10 | 2/10 | 2 | Single 10:05 ET snapshot check; real-time scanner has ORB path but is never populated (F4). |
| Data pipeline (1-min/5-min bars, timestamps) | 5 | 4/5 | 4 | Alpaca 5-min pull is correct; prev-close index is fragile (F6). |
| Slippage & fill realism | 5 | 1/5 | 1 | None modeled (F14). |
| Backtest evidence & observability | 5 | 0/5 | 0 | Zero ORB trades in any captured run artifact (F18); Sharpe hard-coded 0 in UI metadata (F11); live API inaccessible (F19). |
| Code hygiene / duplication | 5 | 2/5 | 2 | Two parallel implementations with drift (F1); copy/description contradicts code (F12); dead-code short branch (F20). |
| **Total** | **100** | | **46** | — |

### What would get this to 75+
1. Pick one implementation and delete the other (F1). Make `ORBRunner` delegate to `ORBStrategy` or vice versa.
2. Remove the unconditional short-discard (F2) and either (a) let shorts trade, or (b) delete the short-side math so reviewers understand it's long-only.
3. Wire `ORBRunner` to `realtime_scanner.register_setup()` with `orb_breakout` setups at the end of the 30-min OR window, so intraday breakouts actually fire via the tick stream (F4).
4. Add a TQQQ / QQQ / SPY variant tracked separately — Zarattini's result lives there, not on mid-cap singles (F10).
5. Enforce **first-break-of-day** in the tick handler (F8).
6. Replace `manage()` with the declared Fib scale-out and 14:30 ET time-stop actually driven by intraday clock, not `days_held` (F3).
7. Add a slippage model (5-10 bp breakout fill penalty) at least in the sizing/target math (F14).
8. Compute and persist a real Sharpe/MaxDD per strategy (F11, F18) — `/leaderboard` already does per-trade Sharpe; propagate to the summary endpoint and the UI.
9. Fail-closed on missing calendar data past 2026 (F17).
10. Fix the description/metadata inconsistencies (F12) or the code — pick one source of truth.

---

## Appendix: Audited citation targets

| Claim | Source |
|---|---|
| 30-min OR window | `backend/strategies/orb.py:117`, `backend/data/ingestion/strategy_runner.py:2807, 2975-2976` |
| Fib 1.272/1.618 targets | `backend/strategies/orb.py:119-120, 310-315`, `backend/data/ingestion/strategy_runner.py:2810-2811, 3036-3037` |
| 0.5× OR width stop | `backend/strategies/orb.py:121, 309, 313`, `backend/data/ingestion/strategy_runner.py:3035` |
| 11:30 ET cutoff | `backend/strategies/orb.py:128-129, 174-180`, `backend/data/ingestion/strategy_runner.py:2812-2813, 2940-2946` |
| FOMC / NFP / OpEx skip | `backend/strategies/orb.py:29-88, 166-170`, `backend/data/ingestion/strategy_runner.py:2817-2866, 2931-2935` |
| NR7 bonus | `backend/strategies/orb.py:91-101, 241-243`, `backend/data/ingestion/strategy_runner.py:2868-2874, 3029-3031` |
| Gap > 2 % penalty | `backend/strategies/orb.py:126, 186-190, 237-239`, `backend/data/ingestion/strategy_runner.py:2808, 2987-2992, 3026-3027` |
| RVOL ≥ 1.5× | `backend/strategies/orb.py:127, 192-202`, `backend/data/ingestion/strategy_runner.py:2809, 2994-3004` |
| Shorts discarded | `backend/data/ingestion/strategy_runner.py:3043-3045` |
| Zero-buffer breakout (runner) | `backend/data/ingestion/strategy_runner.py:3009-3010` |
| 0.1 % buffer (class) | `backend/strategies/orb.py:118, 210-212` |
| OR fallback to daily | `backend/data/ingestion/strategy_runner.py:2965-2972` |
| `manage()` `days_held >= 1` | `backend/strategies/orb.py:339-355` |
| Declared 14:30 ET time-exit (unused) | `backend/strategies/orb.py:328-336` |
| Scheduler 10:05 ET single-fire | `backend/data/ingestion/pipeline_runner.py:52, 80, 184-186` |
| Real-time ORB setup hook (unused) | `backend/data/ingestion/realtime_scanner.py:125-133` |
| Runner registered | `backend/data/ingestion/strategy_runner.py:3454` |
| Class registered | `backend/strategies/__init__.py:14, 28` |
| Router metadata | `backend/api/routes/strategies.py:365-377, 530` |
| Frontend metadata | `frontend/src/lib/strategies.ts:130-136, 193`; `frontend/src/lib/strategy-content.ts:536-544` |
| Sharpe hard-coded 0 | `backend/api/routes/strategies.py:689, 908` |
| Live API 404/401 | `https://tradingalpha.net/api/strategies` (probe 2026-04-17) |
| No ORB trades in run artifacts | `/Users/GK/Downloads/alphadesk/big_run_result.json`, `/Users/GK/Downloads/alphadesk/multi_strategy_result.json`, `/Users/GK/Downloads/alphadesk/STRATEGY_RESEARCH_REPORT.md` |
