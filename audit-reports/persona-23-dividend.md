# Persona 23 — Dividend Income Investor

**Date:** 2026-04-18  **Persona:** Dividend / income investor. Cares about ex-div alerts, yield (trailing + forward), DRIP, payout calendar, qualified vs ordinary tax treatment, covered-call overlay on dividend names.

## Verdict

AlphaDesk is not set up for me. There is a *Dividend Capture* tile in the strategy catalogue, but it is a marketing stub — no code, no data, no calendar. The one real dividend hook is inside the **backtester**, invisible to live users. I would bounce on day one.

## Top 10 findings

1. **`dividend-capture` is a ghost.** `backend/api/routes/strategies.py:282` describes "enters 2–3 days before ex-dividend date…", but `backend/strategies/registry.py:366` flags it in `PLANNED_STRATEGY_ROUTE_IDS`. No `backend/strategies/dividend_capture/` directory exists. It renders as `stage: "planned"` per `frontend/src/lib/strategies.ts:96`.
2. **No `/api/v1/market/dividends` or `/calendar` endpoint.** Grep for `dividend|ex_div|payout` across `backend/api/routes/` returns zero matches in `market.py`, `market_overview.py`, `screener.py`, `symbols.py`. FMP is wired for earnings and fundamentals only (`fmp_earnings.py`, `fmp_fundamentals.py`) — no dividend module.
3. **No yield column anywhere in the UI.** `WatchlistPanel.tsx`, `types/index.ts`, `PerformanceMetrics.tsx`: no `dividendYield`, no `forwardYield`, no `payoutRatio`. Price + change% only.
4. **Alerts engine is price-only.** `frontend/src/app/(dashboard)/alerts/page.tsx:47` — `condition: "above" | "below"` on target price. I cannot set an ex-div date alert, yield-threshold alert, or dividend-cut alert.
5. **Dividends do accrue — but only in backtest.** `backend/backtest/portfolio.py:114 apply_dividends()` and `engine.py:237` credit cash from `bar.dividend` on ex-date. Live paper/production portfolios never call this path, so realized dividend income is not tracked.
6. **No DRIP toggle.** No mention of reinvest, DRIP, or auto-buy-on-dividend in backend config, settings page, or portfolio code. Dividends in backtest go to cash and stay there.
7. **Tax report ignores dividends entirely.** `reports/page.tsx:468 TaxReport` only classifies realized trade P&L as short- vs long-term capital gains. No qualified dividend bucket, no 1099-DIV equivalent, no holding-period test on the dividend itself.
8. **No covered-call overlay.** Options tooling exists (`backend/data/providers/polygon_options.py`, `OptionsPanel.tsx`), and VRP Harvest cites Israelov on covered calls — but there is no strategy that pairs a long equity position with a short call against it. `StrategyTemplates.tsx:39` lists "Conservative Income" with this description; it is copy only.
9. **Dividend ETFs are searchable but not dividend-aware.** `symbols.py:1665` seeds SCHD, VIG, VYM, DVY, DGRO into the symbol table — yet no associated yield or distribution-frequency metadata is surfaced anywhere.
10. **News occasionally mentions dividends.** `news.py:216` has a hard-coded template "{sym} dividend increase signals management confidence" — a canned sentiment string, not a real dividend-news feed.

## What would make me stay

FMP `historical-price-full/stock_dividend` + `stock_dividend_calendar` pulled into a new `backend/api/routes/dividends.py`; a yield column on the watchlist; an `EX_DIV` alert type; DRIP toggle on position-open; qualified vs ordinary split in the tax report; one real covered-call strategy.
