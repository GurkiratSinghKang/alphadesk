# Persona 25 — The Pairs / Correlation Arbitrageur

**Date:** 2026-04-18
**Environment:** tradingalpha.net (production, live APIs)
**Persona:** seasoned stat-arb trader who lives in spread z-scores, cointegration
p-values, and dollar-neutral leg sizing. Wants live KO/PEP, XLE/XOP style pair
monitoring, on-demand Engle-Granger rescreens, a spread chart, and a pair-screening
UI to approve/reject candidates before they go live.

The backend for this persona is unusually strong — `pairs_trading/strategy.py` is
a rigorous, production-grade cointegration engine (Engle-Granger + Hurst +
OU half-life, Kalman hedge option, 21-day watchdog, two-legged MOO signals by
construction). The frontend, however, has **zero surface area** for a pairs
trader. There is no z-score ticker, no spread chart, no list of active pairs,
and no universe override. The arbitrageur has a Ferrari engine with no
instrument panel.

---

## Top 10 findings (~350 words)

1. **No live z-score UI anywhere.** Grep of `/frontend/src` for `zscore`, `z.score`,
   `spread` returns only strategy-doc prose — no component, no API hook, no
   widget. `StrategyCorrelation.tsx:62-330` renders a Pearson-on-sparklines heatmap
   *across strategies* (not pairs); it is not what the persona needs.

2. **Universe is hard-coded to 49 large caps — no KO, PEP, XLE, or XOP.**
   `config.py:53-77` ships 6 sectors of mega-caps (AAPL/MSFT, JPM/BAC, XOM/CVX,
   LLY/UNH, WMT/HD, CAT/HON). No Consumer-Staples (KO/PEP), no ETF pairs
   (XLE/XOP, GLD/SLV). Persona's canonical examples are literally absent.

3. **`pairs-stat-arb` is a phantom strategy.** `strategies.py:373-385` registers
   it with ACTIVE status and a KO/PEP description, but no Python package
   `strategies/pairs-stat-arb/` exists (`Glob` returns nothing). The route card
   links to a strategy that cannot generate a signal.

4. **Realtime scanner expects pair setups but nothing registers them.**
   `realtime_scanner.py:258-352` runs a 30-second z-score check loop on
   `_pairs_setups`, but `register_setup("pairs_zscore", ...)` has no caller in
   the repo — no cron, no pipeline, no API. The pair-trigger path is dead
   plumbing.

5. **Scanner uses `price_a - beta*price_b`, not `log(p_a) - beta*log(p_b)`.**
   `realtime_scanner.py:319` subtracts raw prices; `strategy.py:555` does the
   same on backtest. Engle-Granger is usually run on log-prices; the raw-price
   formulation diverges from the spec's citations (Chan 2013 §3.5).

6. **No pair-screening UI.** A stat-arb trader wants to see a ranked list of
   active pairs with ADF p-value, OU half-life, Hurst, current z, time-in-trade.
   `ActivePair` dataclass (`strategy.py:112-138`) carries all of it but no API
   endpoint exposes `cache_of(ctx)["pairs_trading.active"]`.

7. **No spread chart.** The persona needs `spread_t = y - beta*x` plotted with
   rolling mean/std bands (Bollinger-on-spread). `TradingChart.tsx` only plots
   single-symbol OHLCV. No dual-axis, no spread overlay, no z-score sub-panel.

8. **No live cointegration re-test button.** `_rescreen()` runs on a fixed
   63-day cadence gated by `(asof - last_screen).days`. There is no
   `/pairs/rescreen` API, so a trader who wants to force a rescreen after an
   earnings shock has to restart the process.

9. **Entry/exit thresholds invisible.** `z_entry=2.0 / z_exit=0.5 / z_stop=3.5`
   (`config.py:23-25`) are Optuna-tunable but surfaced nowhere in the UI.
   `StrategyHero` shows OOS Sharpe — not the knobs the persona tunes daily.

10. **Backend documents KO/PEP in prose but universe excludes Staples.**
    `strategies.py:375` advertises "KO/PEP, V/MA" — neither pair can trade.
    Classic spec/implementation drift. Fix: add a Consumer-Staples sector and
    an Financials-pair-ETF row, or make the universe user-configurable via a
    `/api/pairs/universe` POST.

---

## Key files

- `/Users/GK/Downloads/alphadesk/backend/strategies/pairs_trading/strategy.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/pairs_trading/config.py`
- `/Users/GK/Downloads/alphadesk/backend/strategies/pairs_trading/spec.md`
- `/Users/GK/Downloads/alphadesk/backend/data/ingestion/realtime_scanner.py`
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/StrategyCorrelation.tsx`
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py`
