# AlphaDesk — Deep-Sea Audit (Master Summary)

**Target:** https://tradingalpha.net
**Date:** 2026-04-17
**Audit method:** 16 domain-expert agents dispatched in parallel — each producing an independent, file:line-cited report against the live site and the in-repo code.

> Every claim below is traceable to an individual report in this folder. This document is the reading order and the cross-cutting pattern summary.

---

## 1. Overall verdict

**AlphaDesk today looks like a trading product but does not behave like one.** The shell (UI chrome, TLS, Next.js app structure, WebSocket plumbing) is above average for a solo/small-team build. The core — the 12 strategies that are the whole reason for the product — are in materially worse shape than the UI advertises. Five strategies score below 30/100; the best of the twelve scores 61/100.

Composite scores from each expert:

| # | Report | Domain | Score |
|---|---|---|---|
| 01 | [Frontend](01-frontend.md) | React/UX/Look&Feel | **58 / 100** |
| 02 | [Backend](02-backend.md) | FastAPI/data integrity | **38 / 100** |
| 03 | [Networking](03-networking.md) | TLS/HTTP/WS/Caddy | **71 / 100** |
| 04 | [Performance](04-performance.md) | Load/runtime/real-time | **62 / 100** |
| S01 | [Momentum Quality](strategy-01-momentum_quality.md) | Factor | **21 / 100** |
| S02 | [PEAD](strategy-02-pead.md) | Event-driven | **18 / 100** |
| S03 | [VRP Harvest](strategy-03-vrp_harvest.md) | Vol premium | **18 / 100** |
| S04 | [Earnings Vol](strategy-04-earnings_vol.md) | Options | **14 / 100** |
| S05 | [Regime Adaptive](strategy-05-regime_adaptive.md) | Meta | **18 / 100** |
| S06 | [TS Momentum](strategy-06-ts_momentum.md) | Trend | **32 / 100** |
| S07 | [RSI2 Reversal](strategy-07-rsi2_reversal.md) | Mean-rev | **61 / 100** |
| S08 | [Dual Momentum](strategy-08-dual_momentum.md) | Allocation | **52 / 100** |
| S09 | [Pairs Trading](strategy-09-pairs_trading.md) | Stat arb | **28 / 100** |
| S10 | [KAMA Breakout](strategy-10-kama_breakout.md) | Trend-follow | **58 / 100** |
| S11 | [ORB](strategy-11-orb.md) | Intraday | **46 / 100** |
| S12 | [VWAP](strategy-12-vwap_strategy.md) | Intraday | **28 / 100** |

**Strategy average: 33 / 100.** Infrastructure average: 57 / 100.

---

## 2. Cross-cutting themes (found by ≥8 of 12 strategy experts, independently)

These are structural defects that recur across the codebase. Fix them once, fix many strategies.

### Theme A — "Two implementations, and the dead one is the textbook one"

Every one of the 12 strategies has a **clean, textbook-shaped class** under `backend/strategies/*.py`, and a **parallel, divergent runner** class under `backend/data/ingestion/strategy_runner.py`. The pipeline only invokes the runners. The classes are registered in `backend/strategies/__init__.py` but **never instantiated at runtime** (except cross-references inside `regime_adaptive.py`).

This pattern was reported by **all 12 strategy auditors independently**. The runners are uniformly cruder: they drop short legs, drop options plumbing, drop vol targeting, drop the core signal, and in several cases completely change the economic direction of the trade (e.g. VRP Harvest and Earnings Vol become long-equity-on-high-IV in the runner — the opposite of what they're supposed to do).

**Fix direction:** pick one set. If the runners are the real product, delete `backend/strategies/*.py` and the `STRATEGIES` dict, and update `strategy-content.ts` copy to match what actually runs. If the classes are the intended product, wire them into the pipeline and delete the runners.

### Theme B — Screener feeds strategies seeded random numbers

`_generate_demo_screener_results` in `backend/api/routes/screener.py:196-210` emits `rs_score`, `iv_rank`, `f_score`, `change_pct` as deterministic functions of `hash(ticker)`. Multiple strategies (Momentum Quality, PEAD, VRP Harvest, Earnings Vol, Regime Adaptive, RSI2, KAMA, ORB) consume this in their demo path — so "signals" are a function of the symbol name, not the market. Pipeline logs 2026-04-{08,09,10} show identical picks three days in a row, confirming live behavior.

### Theme C — Marketing copy does not match code

`frontend/src/lib/strategy-content.ts` promises specific academic implementations (Jegadeesh-Titman 12-1 momentum, Piotroski F-score, GEM bond fallback, cointegration-gated pairs, HMM regime, Moskowitz vol-targeted TSMOM, Dubinsky-Johannes systematic short straddles, VWAP execution with Berkowitz-Logue-Noser citations). The code delivers none of those things as described. This is a disclosure issue on a live product.

### Theme D — No real backtest artifacts

`big_run_result.json` and `multi_strategy_result.json` are 0 bytes (or contain zero trades for the strategy in question). `STRATEGY_RESEARCH_REPORT.md` self-admits "current Sharpe ~0.5 vs target 1.0-1.5" and flags missing data feeds. The "Sharpe", "Win rate", and "Max drawdown" numbers shown on the live product are either hardcoded defaults (0s in `strategies.py:157-169`) or derived UI estimates (`strategies/[id]/page.tsx:378-397`).

### Theme E — Long-only, US-equity-only

Pairs (single-leg, no short), TS Momentum (equity only, no futures/FX/commodities), VRP Harvest (buys stock), Earnings Vol (buys stock), PEAD (short leg silently dropped), Dual Momentum (no bond fallback), ORB (shorts hard-discarded). The "crisis alpha" and "market-neutral" claims on the site are structurally unsupported.

### Theme F — Fabricated data rendered as real in UI

Frontend report lists 9 P0 instances:
- Sharpe/Max DD/Win Rate derived from each other on strategy pages
- Options chain from seeded RNG (`OptionsPanel.tsx`)
- Greeks hardcoded on trade legs (`TradePanel.tsx`)
- RSI/MACD/ADX as linear functions of one AI score (`AnalysisPanel.tsx`)
- Watchlist "Signals" tab is a static array
- Economic calendar forecasts hardcoded ("155K", "2.4%")
- Analytics baseline hardcoded to $100k

---

## 3. Top ship-blockers (P0 across all reports)

A trader opening an account tomorrow should not hit any of these. In priority order:

1. **Strategies deliver the opposite economic exposure of their description** — VRP Harvest and Earnings Vol buy equities on high IV (reports S03, S04).
2. **PEAD has no earnings data** — hardcoded weekday rotation of 4 symbols, no SUE, no announcement timestamps. Short leg discarded. (S02)
3. **Screener returns seeded RNG** in demo path that most strategies fall into (Theme B).
4. **Trade ledger is a single JSON file** with `threading.Lock` that is useless across Gunicorn workers; IDs assigned by `len()+1`; silent corruption recovery to empty state (Backend F-block).
5. **`sync_with_alpaca` closes every open trade on an empty-positions response** and is called from GET handlers (Backend).
6. **Redis auth is fail-closed** — a Redis hiccup 401s every session (Networking P0).
7. **No rate limit on `/api/v1/auth/login`** — unthrottled credential stuffing (Networking P0).
8. **CSP allows `'unsafe-inline' 'unsafe-eval'`** on a dashboard with order entry (Networking P0).
9. **`JWT_SECRET` falls back to a hardcoded string in non-prod**; `_check_rate_limit` fails-open on Redis outage; risk monitor can be toggled off by any authenticated user (Backend).
10. **Single-VPS SPOF** — one Hetzner box, no failover, no CDN (Networking P0).
11. **Quote-storm re-render** — 9 components subscribe to the whole `quotes` map; every SIP tick re-renders all of them (Performance P0).
12. **Login page uses `mailto:` for "Forgot password" and "Request Access"** (Frontend P0).
13. **Ticker marquee has `role="marquee"` (invalid ARIA) with no pause control** — WCAG 2.2.2 violation (Frontend P0).
14. **UI shows fabricated Sharpe/MDD/win-rate figures** as if they are real performance metrics (Frontend P0).

---

## 4. What's actually good (preserve these)

- **TLS / transport**: Let's Encrypt ECDSA, TLS 1.3, HSTS preload, HTTP/2, zstd+gzip, strict CORS, Server header stripped, frame-ancestors set. Networking baseline is genuinely solid.
- **Visual design**: dark palette is coherent, tabular-nums used everywhere, command palette works, skeletons have shape, typography is consistent.
- **KAMA math is textbook-correct** (S10) — one of the cleanest quant primitives in the repo.
- **RSI2 entry rule is faithful** to Connors with 200-SMA and SPY systemic filter (S07) — the best-scoring strategy.
- **ConnorsRSI, Hurst R/S, OU half-life regression** in `pairs_trading.py` are all real and mostly correct — the stats library is better than the execution layer deserves (S09).
- **Tab-visibility WS reconnect, Redis listener exponential backoff, request-ID tracking, JWT revocation blocklist** — solid infrastructure plumbing.
- **Master agent rule-based VIX gate** actually rejected crisis-day trades on 2026-04-08 (VIX 48.9) — verified in pipeline logs (S05).

---

## 5. 5-year backtest assessment summary (2019-2024, US markets)

Every strategy expert provided expected Sharpe ranges for both a textbook implementation and what AlphaDesk would realistically produce given the current code. Aggregated:

| Strategy | Textbook Sharpe (2019-24) | AlphaDesk Realistic Sharpe | Gap reason |
|---|---|---|---|
| Momentum Quality | 0.65-0.90 L-only | 0.30-0.55 | No quality, 3-mo not 12-1 mo, RNG screener |
| PEAD | 0.40-0.70 L/S | -0.1 to +0.1 | No earnings data, no SUE, no shorts |
| VRP Harvest | 0.50-0.80 | Negative expected | Runner buys stock, wrong direction |
| Earnings Vol | 0.50-1.00 | Negative expected | Runner is long equity on high IV |
| Regime Adaptive | 0.40-0.80 | n/a | No regime detection in live runner |
| TS Momentum | 0.70-1.00 multi-asset | 0.10-0.30 | Equity-only, no shorts, VIX proxy broken |
| RSI2 Reversal | 0.40-0.70 SPY | 0.20-0.40 | Exits never execute in runner |
| Dual Momentum | 0.60-0.90 GEM | 0.50-0.70 | No bond fallback, stops on 12-mo signal |
| Pairs Trading | 0.30-0.70 | Unquantifiable | Single-leg execution = not market-neutral |
| KAMA Breakout | 0.30-0.60 | 0.20-0.50 | No 200-SMA filter, ER computed but unused |
| ORB | 0.50-0.80 / 1.0-1.5 TQQQ | 0.20-0.40 | No intraday scanner, shorts discarded |
| VWAP | 0.20-0.40 | Unquantifiable | Is actually 20-day VWMA, not VWAP |

**Portfolio-level reality:** if the 12 strategies were run as described in the UI on 2019-2024 US data, the realistic blended Sharpe is in the 0.2-0.4 range — dominated by correlation (all long equity, mostly large-cap), and well below SPY buy-and-hold risk-adjusted returns over the same window.

---

## 6. Recommended sequencing

If the team fixes these in order, each step unblocks the next:

**Week 1 (infrastructure ship-blockers):**
- Rate-limit `/auth/login`; fix fail-closed Redis auth; tighten CSP; remove JWT secret fallback.
- Move trade ledger out of a JSON file into the existing Postgres models (`data/storage/models.py` already has the shape).
- Stop calling `sync_with_alpaca` from GET handlers.

**Week 2 (kill the fake data path):**
- Delete `_generate_demo_screener_results` and the demo code path. If Alpaca or a data provider isn't wired, the product should return "no data" not fabricated data.
- Remove all UI fallbacks that derive Sharpe/MDD/Win% from each other; show `—` until real values exist.
- Pick one strategy implementation per strategy (class or runner) and delete the other.

**Week 3-4 (strategy correctness):**
- Wire a real earnings feed (Polygon Earnings, FMP, Finnhub) before re-enabling PEAD or Earnings Vol.
- Kill VRP Harvest and Earnings Vol as equity strategies (they're options strategies by definition) or relabel them.
- Fix TS Momentum to be multi-asset OR rename it "US Equity Momentum Trend".
- Add bond fallback to Dual Momentum, or relabel.
- Make Pairs Trading emit both legs.

**Ongoing:**
- Build actual walk-forward backtest harness (none exists today — `big_run_result.json` is 0 bytes). Without this, every performance claim is unverifiable.
- Update `strategy-content.ts` to match what the code does, not what a textbook says.

---

## 7. Where to read next

Start with the three reports that contain the most recoverable leverage for a small team:

1. **[Backend](02-backend.md)** — the ship-blockers concentrated here will unblock everything else.
2. **[Frontend](01-frontend.md)** — the fabricated-data problem is equally important to trust.
3. **[Momentum Quality (S01)](strategy-01-momentum_quality.md)** — reads like a template for the other 11 strategy audits; fixing its findings fixes half the themes above.

All 16 reports are in this folder, each with its own severity-tagged finding list and file:line citations.
