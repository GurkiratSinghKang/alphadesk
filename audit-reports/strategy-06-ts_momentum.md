# Strategy Audit #06 — Time-Series Momentum (TSMOM)

**Auditor**: Quantitative Researcher — 15+ years TSMOM / CTA (AQR, Man AHL, Winton lineage)
**Date**: 2026-04-17
**Scope**: `ts_momentum` as implemented in AlphaDesk (backend + frontend + live API)
**Verdict**: **32 / 100** — an *equity long-only SMA filter* that has borrowed TSMOM's vocabulary but discards every property that makes real TSMOM work.

---

## Executive Summary

AlphaDesk's `ts_momentum` is described to the user as "Time-series momentum — Moskowitz, Ooi & Pedersen (2012)… crisis alpha, positive convexity during market crashes" (`frontend/src/lib/strategy-content.ts:487-494`, `backend/api/routes/strategies.py:301-302`). What actually ships is a US-equity **long-only 200-day-SMA trend filter** with a conviction score, ATR trailing stops, and a monthly rebalance *group assignment that is never actually a rebalance*. The critical machinery of TSMOM — multi-asset diversification across equities / rates / FX / commodities, inverse-volatility weighting at a portfolio level, ex-ante vol targeting, and the ability to **go short** on negative-trend assets — is **absent**.

This is the difference between a CTA fund and a stock screener that filters by "price > 200-SMA." The paper's signature property (crisis alpha / positive convexity in equity drawdowns) is impossible here because the strategy is (a) long-only and (b) only trades equities.

Two separate implementations exist in the codebase — `TSMomentumStrategy` in `backend/strategies/ts_momentum.py` and `TSMomentumRunner` in `backend/data/ingestion/strategy_runner.py` — with subtly different parameters, different signal logic, and different stops. Only the runner is wired into the daily/monthly pipeline (`backend/data/ingestion/pipeline_runner.py:66-70`); the strategy class appears to be dead code except for a regime-adaptive cross-reference. This code duplication is itself a bug.

---

## Textbook — What TSMOM Should Be

Moskowitz, Ooi & Pedersen (JFE 2012) built the canonical TSMOM spec:

1. **Universe**: 58 liquid futures across **four asset classes** — equity indices, bonds, currencies, commodities. Diversification across uncorrelated asset classes is the key Sharpe driver; a single asset class delivers a Sharpe of ~0.3–0.5, the **full 58-instrument portfolio delivered ~1.17 gross** (Hurst/Ooi/Pedersen 2017).
2. **Signal**: sign of **excess** return over risk-free, at 1m / 3m / 12m horizons. Ensemble, not single-horizon. Long if positive, **short if negative**.
3. **Per-asset sizing**: position notional = `target_vol / realized_vol(asset)` so every asset contributes equal ex-ante volatility. Typical realized vol window is 60d EWMA.
4. **Portfolio construction**: equal-weight the vol-scaled positions across *all* assets, then scale the whole portfolio so **ex-ante portfolio vol ≈ 10-15%** annualized.
5. **Rebalance**: monthly (some implementations daily with threshold-based rebalancing).
6. **Crisis alpha**: the long-short structure on four asset classes creates positive convexity — when equities crash and bonds rally and the dollar bids, TSMOM profits on multiple legs.
7. **Known failure modes**: reversal years (2009, H2 2020), choppy sideways markets (2019, 2023), and crowding during monetary policy turns.

TSMOM is **not** an equity long-only SMA screener. It is a multi-asset long-short vol-targeted system.

---

## What AlphaDesk Actually Does

### The strategy class — `backend/strategies/ts_momentum.py`

- **Universe**: US equities only. Screen at `ts_momentum.py:142-150` requires `avg_volume ≥ 500k` and `market_cap ≥ $2B`; top 40 by volume.
- **Signal**: price above 200-day SMA **plus** EMA-50 > EMA-200 golden cross **plus** ADX ≥ 20. Purely long. (`ts_momentum.py:164, 170, 194`)
- **Score**: heuristic mashup of distance-from-SMA, EMA bonus, ADX bonus, 50-day-SMA slope (`ts_momentum.py:207-222`); capped at 95. Not a sign-of-excess-return t-stat.
- **Sizing**: intended to be inverse-vol (`ts_momentum.py:276-280`), but the formula `(equity * TARGET_VOL) / (realized_vol * sqrt(252))` is **dimensionally wrong** (see Findings #7).
- **Stops**: 2.5× ATR hard stop, trailing stop tightens to 1.5× ATR when PnL > 20% (`ts_momentum.py:365-379`).
- **Exits**: close below 200-SMA, EMA death cross, trailing-ATR stop, or **60-day max hold** (`ts_momentum.py:386-391`).
- **Status in pipeline**: **unused**. `get_strategy()` only referenced from `regime_adaptive.py:73-198`. See Finding #2.

### The runner — `backend/data/ingestion/strategy_runner.py` (what actually executes)

- **Universe**: top-100 screener results pre-filtered to RS-score > 40, then top-50, then top-30 after 200-SMA check (`strategy_runner.py:1646-1691`). Still US equities only.
- **Signal**: price > 200-SMA **and** ADX ≥ 20 **and** multi-SMA (50/100/200) alignment bonus (`strategy_runner.py:1722-1753`). Same long-only posture.
- **Conviction**: 45 base + heuristic bonuses (`strategy_runner.py:1776-1803`), clipped to [40, 95].
- **Regime awareness**: VIX via VIXY close as a "VIX level" proxy (`strategy_runner.py:1617-1640`, `1794-1802`); conviction scaled 0.70× if VIXY > 30, 0.85× if > 20.
- **Sizing**: handed to the master agent. `BaseStrategyRunner.generate_trades` calls `master.calculate_vol_targeted_size(symbol, max_notional=$6,000)` (`strategy_runner.py:376-386`). The master uses a **static per-symbol VOL_MAP** dictionary of 24 hand-coded vols (`master_agent.py:103-110`) and a naive `target_risk / vol` formula (`master_agent.py:316-325`).
- **Stops**: 2.5× ATR stop, 3:1 R/R take-profit (`strategy_runner.py:1755-1759`).
- **Rebalance**: listed in `MONTHLY_STRATEGIES` alongside `dual_momentum`, `momentum_quality` (`pipeline_runner.py:66-70`), fired once on the last trading day at 3:55 PM ET (`pipeline_runner.py:82-84`, `209-212`). But this only triggers the *entry screen*; it is **not an actual portfolio rebalance** — no target-weight computation, no exit of legacy legs, no vol re-scaling.
- **Allocation cap**: $6,667 per strategy (6.67% of a $100k book) via `STRATEGY_LIMITS["ts_momentum"] = 0.0667` (`master_agent.py:65`), with a position cap of $6,000 via `MAX_POSITION_DOLLAR` (`strategy_runner.py:21`). Effectively one to two positions ever, on one asset class.

### Frontend / production API

- Marketing copy promises *inverse-vol weighting, 12% target vol, monthly rebalance, EMA 50/200 golden cross, ADX > 20, SP500 liquid stocks, 10 max positions, crisis alpha* (`frontend/src/lib/strategy-content.ts:487-494`; `frontend/src/lib/strategies.ts:88-94`; `api/routes/strategies.py:300-312`).
- Live API: `/api/strategies` and `/api/strategies/ts-momentum/performance` both returned **HTTP 404** when probed unauthenticated (tradingalpha.net redirects unauthenticated traffic to `/login`); the endpoints exist in code (`api/routes/strategies.py:575, 803`) but auth-gated. No live performance numbers available for this audit.
- Demo-run artifacts `big_run_result.json` and `multi_strategy_result.json` at repo root contain **no `ts_momentum` activity** — only six legacy strategies (`momentum_quality`, `pead`, `vrp_harvest`, `earnings_vol`, `regime_adaptive`, `claude_alpha`) were exercised. So we have zero empirical runs for this strategy in-tree.

---

## Findings

### F1 — Universe is single-asset-class; crisis-alpha claim is unachievable
**Severity: Critical.** TSMOM's headline Sharpe ~1.17 and crisis-alpha property come from diversifying across equities + rates + FX + commodities. AlphaDesk's screen is hard-coded to US liquid stocks (`strategies/ts_momentum.py:142-150`; `strategy_runner.py:1646-1671`). Equity-only TSMOM historically delivers Sharpe 0.2-0.4 *before* costs (see Georgopoulou & Wang 2016). The frontend copy at `strategy-content.ts:488` — "Provides crisis alpha -- positive convexity during market crashes, acting as portfolio insurance" — is unsupportable by this implementation: when SPY drops 30%, every long in a US-equity-only TSMOM drops with it. Positive convexity comes from *going long bonds and long USD when equities crash*. Neither is possible here.

### F2 — Two divergent implementations; the one users read about is dead code
**Severity: High.** `TSMomentumStrategy` (`strategies/ts_momentum.py`) and `TSMomentumRunner` (`strategy_runner.py:1509`) share a name and roughly a description but diverge in parameters (EMA 50/200 filter in the class, multi-SMA 50/100/200 in the runner), sizing logic, and conviction scoring. The runner is the one scheduled by the pipeline (`pipeline_runner.py:67`). The strategy class is registered in `strategies/__init__.py:23` and is only referenced by `regime_adaptive.py:73-198`, which is itself an allocator-of-strategies that imports signals from other strategies. If any research/marketing reads `strategies/ts_momentum.py` and believes it is the running system, they will draw false conclusions. Pick one implementation; delete the other.

### F3 — Long-only; no short leg on negative-trend equities
**Severity: Critical for TSMOM identity.** Moskowitz 2012's defining test is "long positive-trend, **short negative-trend**." The strategy generates no bearish signals: `generate_signal()` returns `None` unless `above_sma` and ADX is trending (`ts_momentum.py:248-254`); the runner's analyzer `continue`s on `not above_sma200` (`strategy_runner.py:1723-1724`). Inverting to short on negative trend is the entire reason TSMOM earned positive 2008 and 2020 March returns in the academic record. Dropping the short leg converts this from TSMOM into a 200-SMA regime filter on equities. Related: Alpaca retail accounts can borrow and short liquid US equities; this is an implementation choice, not a platform limit.

### F4 — No t-stat, no ensemble, no excess return
**Severity: High.** Moskowitz 2012 signal = `sign(r_{t-12} − r_f)` with optional ensemble across {1m, 3m, 12m}. AlphaDesk substitutes heuristics: `above_sma ? +40 + dist*3 + slope*2 + ema_bonus + adx_bonus` (`ts_momentum.py:208-222`). There's no t-statistic on 12m return (`ret_12m` is computed at line 173 but **never used for signal generation** — only shown in the rationale string at `strategy_runner.py:1817`). No 1m/3m/12m horizon blending. The signal is a trend filter, not a time-series momentum signal.

### F5 — No per-asset inverse-vol weighting at the strategy level
**Severity: Critical.** TSMOM's second defining feature is sizing each asset so `pos × vol_asset = constant`, achieved with asset-specific realized vol. The *class* version attempts this at `ts_momentum.py:276-280`:
```
vol_target_notional = (equity * self.TARGET_VOL) / (realized_vol * math.sqrt(252))
```
This is dimensionally wrong. `realized_vol` is already annualized (`ts_momentum.py:186`: `math.sqrt(var * 252)`). Dividing an annualized vol by `sqrt(252)` again shrinks the denominator ~16×, inflating notional 16×. Mitigated only by the `min(..., equity * 0.08)` cap on the next line. The *runner* version doesn't even try — it delegates to `master.calculate_vol_targeted_size` (`strategy_runner.py:376-380`), which uses a **24-symbol hand-coded `VOL_MAP`** (`master_agent.py:103-110`) with a default of 2.0% daily vol for everything else. Trading XOM? Vol is hard-coded 1.6%. Trading TSM? Uses the 2.0% default. There is **no realized-vol look-up for most of the universe**.

### F6 — No ex-ante portfolio vol target; $6,667 cap dominates
**Severity: High.** The marketing copy promises "12% target vol inverse-vol weighted" (`strategy-content.ts:490`). In reality the strategy's total exposure is capped at `STRATEGY_LIMITS["ts_momentum"] = 6.67%` of equity (`master_agent.py:65`), and per-position at the lesser of `$6,000` (`strategy_runner.py:21`) and `8%` of equity (`master_agent.py:76`). For $100k equity that's **$6,667 total, i.e. one or at most two positions**. That is not a vol-targeted portfolio — it is a single-stock trade sleeve. You cannot have 12% portfolio vol with a single 7% notional long on an equity that has ~20% annualized vol; realized portfolio vol contribution is ~1.4%. Either the cap is wrong or the marketing claim is wrong.

### F7 — Dimensional error in sizing formula (strategy class)
**Severity: Medium (contained by cap).** At `ts_momentum.py:276-280` the vol-target formula divides an already-annualized vol by `sqrt(252)`, over-sizing ~16× before the `min(..., equity*0.08)` cap saves it. This means the cap is *always* binding and the inverse-vol term is effectively dead. In a different environment (remove the cap, or lower target_vol) the bug would blow out risk. Correct formula:
```python
vol_target_notional = equity * TARGET_VOL / realized_vol   # both annualized
```

### F8 — Monthly "rebalance" is an entry screen, not a rebalance
**Severity: High.** Real TSMOM rebalance at t+1 *re-estimates sign-of-return and vol for every asset*, closes any leg that flipped sign, resizes surviving legs to the new vol target, and scales the portfolio back to target vol. AlphaDesk's "monthly rebalance" (`pipeline_runner.py:66-70, 82-84, 209-212`) only re-runs the *entry screen*. Existing positions are managed bar-by-bar by `manage()` (`ts_momentum.py:315-398`) and by whatever the trade-ledger / master-agent do — there is no rebalance-level portfolio view. Consequence: a position opened at $100 with vol 18% can drift to $180 with vol 40% and the weight silently becomes 2× its vol-target — never corrected.

### F9 — No cross-sectional diversification; no correlation awareness
**Severity: Medium.** Real TSMOM benefits from low pairwise correlations across asset classes. Within-equity TSMOM is highly correlated (equities move together in sell-offs). There's no concept here of correlation-scaled weights or max-pairwise-corr caps; the only diversification knob is the portfolio-wide `SECTOR_LIMIT = 0.30` (`master_agent.py:88`). This is better than nothing, but with only 1-2 positions it's rarely binding. Barroso/Santa-Clara (2015) momentum crash protection is partially implemented in `MomentumQualityRunner` (`strategy_runner.py:444-488`) but **not** used by TS Momentum.

### F10 — VIX proxy is VIXY close; that is not VIX
**Severity: Medium.** `_get_vix_level()` (`strategy_runner.py:1617-1640`) fetches `https://data.alpaca.markets/v2/stocks/VIXY/bars`. VIXY is a short-term **VIX futures** ETF subject to contango decay; its price in 2026 is ~1/100th the VIX level it tracked in 2012. Thresholds `VIX_HIGH = 30` and `VIX_ELEVATED = 20` (`strategy_runner.py:1531-1532`) are **never triggered** because VIXY trades in the $10-30 range, not the 15-80 range VIX trades. Net effect: the regime override `conviction * 0.70` never fires, the "crisis de-leveraging" claim (`strategy-content.ts:489`) is defunct. For VIX level, fetch `^VIX` from Yahoo / a proper vendor, or the spot VIX from CBOE.

### F11 — ADX ≥ 20 filter creates a "no-whipsaw" claim it cannot honor
**Severity: Medium.** ADX ≥ 20 (`strategy_runner.py:1529`, `ts_momentum.py:47`) is a common industry choice but is **lagging**. Peak ADX coincides with trend maturity; entering on ADX ≥ 20 often times the tail of a move. In 2019 and 2023 (both trend-poor for US equities — SG Trend Index -5.3% and -4.2%), ADX-gated long-only equity trend systems lost ~2-6%. The strategy's description promises it "skips sideways markets" but the filter shifts the failure mode from whipsaw to late-entry reversal. Historical TSMOM literature (Baltas & Kosowski 2013) finds ADX-like filters add modest value (~20-40 bps) and require trend persistence > 6 months to dominate.

### F12 — 12m return computed but not used; lookback uses full window edge
**Severity: Medium.** `ts_momentum.py:173`: `ret_12m = (closes[-1] / closes[0] - 1) * 100`. Three issues:
  a. It uses `closes[0]` — the first available bar — not 252 days ago. If the buffer holds 300 bars, lookback is ~14 months; if 500, ~2 years. Nondeterministic. Should be `closes[-252]`.
  b. It's computed but never fed into `score` or `generate_signal` (grep shows it only appears in `return {...ret_12m...}`).
  c. Moskowitz uses excess return over risk-free; AlphaDesk uses raw price ratio. With risk-free at 4.5% (2026), this biases signals positive.

### F13 — Signal uses SMA slope of last 20 days, not the SMA of 200 — inconsistent horizon
**Severity: Low.** `ts_momentum.py:200-205` computes the slope of the 50-day SMA over 20 days for the "trend slope" bonus. The "trend" the strategy trades is the 200-day SMA crossover, but scoring is from a 50-day regression — an adolescent mismatch. The runner's `trend_slope` at `strategy_runner.py:1769-1774` is the 20-day slope of the **200-day SMA**, which is correct in spirit but the two code paths disagree.

### F14 — 60-day max hold is anti-trend-following
**Severity: High.** Both implementations time-stop at 60 days (`ts_momentum.py:262, 311, 387-391`). This is fundamentally inconsistent with trend-following: the biggest profit years in CTA performance come from 12-18 month trends (2014 USD rally, 2022 rate-hike cycle, 2023 yen carry). Forcing exit at 60 days caps the winner's distribution and inflates turnover. Combined with the ADX-entry lag (F11), the strategy enters late and exits before the trend exhausts. AQR / Man AHL target holding periods are 4-12 months with no hard max. If you need a time-stop as risk control, use 250+ days with a trailing vol target, not 60.

### F15 — ATR trailing stop tightens during winners — another trend cap
**Severity: High.** `manage()` at `ts_momentum.py:365-372` tightens trailing ATR mult from 2.5× (baseline) to 2.0× (PnL > 10%) to 1.5× (PnL > 20%). "Locking in gains" is retail advice that destroys trend-following Sharpe. The 2022 CTA boom (SG Trend Index +27%) happened because systems **held winners through 3-6× normal pullbacks**. A 1.5× ATR stop on a +30% trend will be triggered by any typical 3-day consolidation and the system misses the next leg. Leave stops at 2.5-3.5× ATR throughout the life of the trade.

### F16 — No crowding / correlation signal; no cross-strategy de-leveraging
**Severity: Medium.** Popular trend-following setups in the same lookback window are heavily exploited by CTAs. The 2020 February/March reversal and the 2023 H1 chop both burned naive TSMOM because all trend-followers covered their shorts (and puts) at the same time. `MomentumQualityRunner` has a `_momentum_vol_scale()` using cross-sectional momentum dispersion (`strategy_runner.py:444-488`) — a form of Barroso/Santa-Clara crash protection. TS Momentum doesn't use it, doesn't check CoT positioning, doesn't watch the SG Trend Index as a crowding proxy.

### F17 — Cost model is absent
**Severity: Medium.** `generate_trades` (`strategy_runner.py:353-432`) applies no spread, commission, slippage, or borrow cost. For a strategy that should hold trends for 4-12 months and rebalance monthly, commissions matter less than slippage and market impact on exits; both are zero in this model. For Alpaca retail, 0bp commission but ~3-15 bp implicit cost on market orders in liquid names. Add ~30 bp/year drag to any simulated Sharpe.

### F18 — Drawdown de-leveraging uses a flat -5% strategy limit
**Severity: Low-Medium.** Master Agent halts a strategy at -5% drawdown and re-enables at -3% (`master_agent.py:84-85`). For a low-vol equity trend sleeve this is too tight — realized vol 15-20%, so -5% drawdowns are monthly events, not rare. The strategy will be halted frequently on noise, then re-enabled on noise, creating whipsaw at the meta level. TSMOM literature uses 20-25% drawdown budgets for trend sleeves.

### F19 — 12% TARGET_VOL (strategy class) is sensible but never propagates
**Severity: Low.** `TARGET_VOL = 0.12` (`ts_momentum.py:42`) is the standard AQR retail-product target. Fine in isolation. But because the strategy class is dead code and the runner path delegates sizing to a static VOL_MAP without a portfolio vol target, the parameter has no effect on live trading.

### F20 — Frontend copy contains claims the code cannot honor
**Severity: Medium.** `strategy-content.ts:490` enumerates: *inverse-volatility sizing, 12% target vol, monthly rebalance, S&P 500 universe, 10 max positions, EMA 50/200 golden cross, ADX > 20, trailing ATR stop*. Actual:
  - S&P 500: no — universe is filtered by market_cap $2B and volume > 300k-500k, which is more like Russell 1000 + some (`ts_momentum.py:144-148`; `strategy_runner.py:1677`).
  - 10 max positions: no — strategy cap is 6.67% of equity and position cap 8%, so typically 1 position (`master_agent.py:65`, `:76`).
  - Monthly rebalance: no — entry screen only (F8).
  - 12% target vol: not enforced (F6, F19).
  - EMA 50/200: strategy class has this; runner uses SMA 50/100/200. (F2)
  - Inverse vol: dimensionally wrong in strategy class (F7) and mapped to a static 24-symbol table in runner (F5).

---

## 5-Year Assessment (2019 – 2024)

What a real multi-asset TSMOM delivered (SG Trend Index proxy):
- **2019**: -5.3% (whipsaw). Rates flipped twice, yield curve re-inverted.
- **2020**: +1.9% (decent — oil crash Long USD, rates rally saved the year despite equity V-shape).
- **2021**: +8.0% (commodities rally).
- **2022**: +27.3% (stellar — rate hikes, USD rally, oil rally all cooperated).
- **2023**: -4.2% (trend-less chop, JGB/JPY reversals).
- **2024**: +4.8%.

What AlphaDesk's implementation would have delivered (estimated, long-only equities, ADX ≥ 20, 60-day max hold, 1-2 positions):
- **2019**: ~-3 to -6%. Long-only equities, SPY +28%, but 60-day max hold caps gains; ADX filter whipsaws in Q4 repo stress; late entry on re-established uptrend.
- **2020**: ~-8 to -12%. Feb crash exits long positions on 200-SMA break at the bottom; stays out through March rally; re-enters late. **No short leg = no crisis alpha**. Frontend promises the opposite.
- **2021**: ~+12 to +18%. Best year — clean equity uptrend favors the filter.
- **2022**: ~-15 to -22%. Worst year — SPY -19%, everything long fails, and the *real* TSMOM's short rates / long USD / short bonds legs are absent.
- **2023**: ~+5 to +10%. The ADX ≥ 20 filter and 60-day time stop actually help in chop (enter late, exit before reversal).
- **2024**: ~+8 to +12%. Equity uptrend.

Implied ex-ante Sharpe: **0.1 to 0.3** after costs. Inverse to the marketing copy's claim of "crisis alpha." This is a leveraged SPY minus a late-entry fee, not TSMOM. Ex-ante max drawdown: **20-28%** (inherited from SPY's 2022), vs. multi-asset TSMOM's typical 8-12%.

The real equity-only TSMOM literature (Hurst/Ooi/Pedersen 2013 Figure 5) shows that when you strip multi-asset diversification, Sharpe drops from ~1.17 to ~0.4. AlphaDesk's implementation sits below that floor because of (a) long-only, (b) 60-day time stop, (c) tightening trailing stops, (d) static vol map, (e) monthly "rebalance" that isn't one.

---

## Score: **32 / 100**

### Breakdown

| Dimension | Weight | Score | Notes |
|---|---|---|---|
| Academic fidelity (Moskowitz 2012 spec) | 20 | 3/20 | Long-only equities, no t-stat signal, no ensemble, no shorts. Keeps only 200-SMA name. |
| Universe & diversification | 15 | 2/15 | Single asset class (F1). No rates/FX/commodities. Kills the whole thesis. |
| Signal quality (sign of excess return) | 10 | 3/10 | 200-SMA + ADX + EMA is a reasonable *trend filter*, not a TSMOM signal. 12m return computed-but-unused (F12). |
| Vol targeting (inverse-vol per asset) | 10 | 2/10 | Class version has dimensional bug (F7); runner uses 24-entry static map (F5). No ex-ante portfolio vol (F6). |
| Rebalance discipline | 5 | 1/5 | "Monthly rebalance" is an entry screen, not a rebalance (F8). |
| Risk management (stops, drawdown) | 10 | 6/10 | ATR stops OK, but tightening trailing is anti-trend (F15); 60-day time stop caps winners (F14); drawdown budget too tight (F18). |
| Regime awareness & crisis de-leveraging | 5 | 1/5 | Uses VIXY-close as "VIX"; thresholds never fire (F10). No crowding signal (F16). |
| Implementation quality | 10 | 3/10 | Two divergent codebases (F2); dead-code class (F2); frontend promises diverge from reality (F20). |
| Cost & execution realism | 5 | 1/5 | No spread, no slippage, no commissions modeled (F17). |
| Production wiring & tooling | 10 | 10/10 | Scheduled, wired to master agent, ledger, dashboard endpoints; toggles work. |
| **Total** | **100** | **32** | |

### Priority Fixes (if this had to ship as "TSMOM")

1. **Add shorts** on negative-trend equities, or pivot the name from "TSMOM" to "200-SMA Equity Trend Filter" (F3).
2. **Expand universe** to at least ETF proxies: SPY/IWM/EFA/EEM for equities, TLT/IEF for rates, UUP for USD, GLD/USO/DBC for commodities (F1).
3. **Unify** the strategy class and runner; delete one (F2).
4. **Compute realized vol per symbol** using actual bars, not a 24-entry static map (F5).
5. **Implement a real rebalance** — monthly close of flipped-sign positions, resize to vol target (F8).
6. **Extend max-hold to 250 days** or remove it; loosen trailing ATR mult back to a flat 3× (F14, F15).
7. **Use actual VIX** (`^VIX` from vendor) not VIXY close (F10).
8. **Fix the dimensional bug** in the class `vol_target_notional` formula (F7).
9. **Reconcile frontend copy** — either make the code do what the copy says, or update the copy (F20).
10. **Use 12m excess return sign** as the actual signal; keep ADX / EMA as *filters*, not signal ingredients (F4, F12).

Until these are addressed, this should be presented to users as a "200-day SMA Equity Trend Filter," not as Moskowitz-Ooi-Pedersen Time-Series Momentum.
