# Strategy Detail Page — Design Spec

**Date:** 2026-04-10
**Scope:** Dedicated strategy detail page at `/strategy/[id]` showing full performance, trade history, thesis, and advanced analytics for each of AlphaDesk's 8 trading strategies.

## Problem

Clicking a strategy card on the dashboard navigates to the generic `/trade` page with no strategy context. A hedge fund manager needs a dedicated view per strategy to evaluate performance, understand the thesis, review trade decisions, and assess risk — all in one place.

## Route & Navigation

- **Path:** `/strategy/[id]` where `id` is the strategy slug (e.g., `momentum-quality`, `pead`, `vrp-harvest`, `earnings-vol`, `regime-adaptive`, `claude-alpha`, `mean-reversion`, `vcp-breakout`)
- **Entry:** Dashboard strategy cards link here instead of `/trade`
- **Exit:** Breadcrumb `Dashboard > Strategy Name` at the top, back to `/`
- **Auth:** Protected by the proxy (same as all dashboard routes)

## Page Layout

Three vertical sections, no horizontal splits. Single scrollable page.

### Section 1: Hero — Performance Dashboard

The first thing you see. Answers "is this strategy making money?"

**Equity Curve Chart (primary visual)**
- Full-width area chart, 400px tall
- Default 90-day range
- Time period selector: 1M / 3M / 6M / YTD / All
- Benchmark overlay toggle: SPY comparison line (different color, dashed)
- Interactive hover: crosshair shows date, strategy value, benchmark value, spread
- Uses the `equity_curve` data from the performance endpoint

**Metrics Row (below chart)**
Six key metrics in a horizontal card strip:

| Metric | Source | Format |
|--------|--------|--------|
| Total Return | `total_return_pct` + `return_dollars` | +12.5% ($6,250) |
| Sharpe Ratio | `sharpe_ratio` | 1.82 |
| Max Drawdown | `max_drawdown` | -8.3% |
| Win Rate | `win_rate` | 67% (of closed trades) |
| Active Positions | `active_positions_count` | 3 |
| Calmar Ratio | `annualized_return_pct / max_drawdown` | 2.1 |

**Status & Controls**
- Status badge: Active (green) / Paused (amber)
- Toggle button to pause/resume strategy (calls `POST /strategies/{id}/toggle`)
- Strategy name as page title with short description subtitle

### Section 2: Trade History Table

Compact, scannable table. Click to expand for AI reasoning.

**Columns:**
- Date (entry date, formatted `Apr 10`)
- Symbol
- Side (Long/Short, color-coded)
- Entry Price
- Exit Price (or "Open" for active)
- P&L ($, color-coded green/red)
- P&L %
- Hold Time (e.g., "3d", "2w")

**Row expansion (on click):**
- Rationale text (the AI's reasoning for entering)
- Conviction score (0-100, with visual bar)
- Stop-loss and take-profit levels
- Exit reason (if closed): stop hit, target hit, time exit, manual
- Entry/exit timestamps

**Filters:**
- Toggle: All / Open / Closed
- Default: All, most recent first

**Sorting:**
- Click any column header to sort ascending/descending

**Data source:** New endpoint `GET /strategies/{id}/trades` returning the trade ledger entries filtered by strategy. Returns the full trade objects (symbol, shares, entry/exit prices, timestamps, rationale, conviction, stop/target, pnl, status).

### Section 3: Tabs

Five tabs below the trade history. Default tab: "About".

#### Tab: About

Strategy thesis and configuration. Static content sourced from strategy implementation descriptions.

**Content:**
- **Thesis** — 2-3 paragraph explanation of the strategy, the market inefficiency it exploits, and the academic research supporting it
- **Edge** — What gives this strategy an advantage (e.g., "exploits post-earnings drift documented by Bernard & Thomas 1989")
- **Parameters** — Table of strategy configuration:
  - Rebalance frequency
  - Universe (e.g., "S&P 500", "US equities > $1B market cap")
  - Position sizing rules
  - Entry criteria
  - Exit criteria (stop-loss %, take-profit %, time-based)
  - Max positions
- **Risk Profile** — Qualitative assessment: Low/Medium/High with explanation

**Data source:** Hardcoded strategy descriptions in the frontend, one per strategy ID. Content derived from the strategy implementation classes in `backend/strategies/`.

#### Tab: Positions

Current open positions with live data.

**Table columns:**
- Symbol
- Shares
- Entry Price
- Current Price
- P&L ($, %)
- Stop-Loss level
- Take-Profit level
- Entry Date
- Entry Rationale (truncated, expandable)

**Data source:** Trade ledger open positions filtered by strategy.

#### Tab: Sector Exposure

Visualize where the strategy's capital is allocated.

**Content:**
- **Bar chart** showing current allocation by GICS sector (Technology, Healthcare, etc.)
- **Historical sector drift** — small multiples or stacked area showing how sector weights changed over the last 90 days
- **Concentration metrics** — top 3 sectors %, Herfindahl index

**Data source:** Derived from open positions + historical trades. Each position's sector from the symbol metadata. New endpoint: `GET /strategies/{id}/analytics`.

#### Tab: Correlation

How this strategy relates to markets and other strategies.

**Content:**
- **Correlation matrix** — heatmap showing rolling 30-day correlation between this strategy's daily returns and:
  - SPY (S&P 500)
  - QQQ (NASDAQ)
  - IWM (Russell 2000)
  - VIX (Volatility)
  - Other active strategies
- **Rolling beta** — line chart showing 30-day rolling beta to SPY
- **Regime analysis** — performance breakdown by market regime (bull/bear/sideways) if regime data is available

**Data source:** New endpoint: `GET /strategies/{id}/analytics` returning pre-computed correlation data. Strategy equity curves + market data for beta calculation.

#### Tab: Analytics

Advanced performance analytics for deep-dive analysis.

**Content:**
- **Monthly return heatmap** — calendar-style grid, months as rows, colored by return (green/red intensity)
- **Drawdown timeline** — area chart showing drawdown depth over time (inverted, worst drawdowns highlighted)
- **Win/loss streaks** — bar chart of consecutive wins/losses, current streak highlighted
- **Conviction distribution** — histogram of conviction scores (0-100) for all trades, colored by outcome (win/loss)
- **Hold time analysis** — scatter plot or bar chart: average hold time by outcome (wins vs losses)
- **Trade size distribution** — histogram of position sizes

**Data source:** All derived from the trade ledger. Computed on the frontend from the full trade history for this strategy.

## New Backend Endpoint

### `GET /strategies/{id}/analytics`

Returns pre-computed analytics for a strategy.

```json
{
  "strategy_id": "momentum-quality",
  "sector_exposure": {
    "current": {"Technology": 0.35, "Healthcare": 0.25, ...},
    "history": [{"date": "2026-04-01", "sectors": {...}}, ...]
  },
  "correlations": {
    "SPY": 0.72,
    "QQQ": 0.68,
    "IWM": 0.45,
    "VIX": -0.31,
    "other_strategies": {"pead": 0.15, "vrp-harvest": -0.22, ...}
  },
  "rolling_beta": [{"date": "2026-04-01", "beta": 0.85}, ...],
  "monthly_returns": [{"year": 2026, "month": 1, "return_pct": 2.3}, ...],
  "streaks": {
    "current": {"type": "win", "count": 3},
    "best_win": 7,
    "worst_loss": 4
  },
  "conviction_distribution": [{"bucket": "0-20", "wins": 2, "losses": 5}, ...],
  "hold_time_stats": {
    "avg_win_days": 8.2,
    "avg_loss_days": 3.1,
    "median_hold_days": 5
  }
}
```

Computation: derived from trade ledger + market data. Can be computed on-demand (not cached) since the dataset is small.

## Strategy ID Mapping

| Dashboard Card | Route ID | Backend strategy field |
|----------------|----------|----------------------|
| Momentum + Quality | `momentum-quality` | `momentum_quality` |
| PEAD | `pead` | `pead` |
| VRP Harvesting | `vrp-harvest` | `vrp_harvest` |
| Earnings Vol | `earnings-vol` | `earnings_vol` |
| Regime Adaptive | `regime-adaptive` | `regime_adaptive` |
| Claude Alpha | `claude-alpha` | `claude_alpha` |
| Mean Reversion | `mean-reversion` | `mean_reversion` |
| VCP Breakout | `vcp-breakout` | `vcp_breakout` |

## Strategy Thesis Content

Each strategy's "About" tab content. Sourced from `backend/strategies/` implementations:

1. **Momentum + Quality** — Buys stocks with strong 12-1 month momentum and high Piotroski F-Score (>=6). Rebalances monthly. Based on Jegadeesh & Titman (1993) momentum factor combined with quality screening to avoid momentum crashes.

2. **PEAD** — Post-Earnings Announcement Drift. Enters bull call spreads on stocks that beat earnings estimates. Holds 30-60 days to capture the documented 60-day drift. Based on Bernard & Thomas (1989).

3. **VRP Harvesting** — Systematically sells delta-neutral strangles on high IV-rank underlyings. Captures the Volatility Risk Premium (implied > realized). Based on Ilmanen (2011). Requires IV Rank > 50.

4. **Earnings Vol Premium** — Sells straddles before earnings to capture IV crush. Currently paused pending refinement. Based on the observation that implied vol overestimates earnings moves ~70% of the time.

5. **Regime Adaptive** — Uses ML-based market regime detection (bull/bear/sideways) to dynamically shift allocation. Increases equity exposure in bull regimes, shifts to defensive/cash in bear regimes.

6. **Claude Alpha** — AI-driven stock picking using Claude's analysis of fundamentals, technicals, sentiment, and options flow. Highest conviction = highest position size. Novel approach — no academic basis, pure AI alpha.

7. **Mean Reversion** — Buys oversold quality stocks (RSI < 30, F-Score >= 5). Targets mean reversion to fair value. Holds until RSI > 50 or 20 trading days, whichever comes first.

8. **VCP Breakout** — Identifies Volatility Contraction Patterns (Minervini). Enters on breakout above pivot with 3% stop-loss and 10% take-profit targets. Trend-following entry with tight risk management.

## Design Principles

- Dark theme consistent with existing dashboard
- Same component library (shadcn/ui via base-ui)
- Charts use the same style as the dashboard sparklines / trade page candlestick
- Equity curve + rolling beta: `lightweight-charts` (already used on trade page for candlesticks)
- Bar charts, histograms, heatmaps, treemaps: custom SVG components (same approach as dashboard sparklines)
- No new charting dependencies
- Mobile responsive is not a priority (desktop-first trading terminal)

## Out of Scope

- Strategy backtesting interface
- Strategy parameter editing UI
- Strategy creation wizard
- Notifications/alerts per strategy
