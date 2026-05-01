# Market Data Provider Note — 2026-05-01

Purpose: keep the Level II / order-book provider decision handy for the
next chart/data pass.

## Recommendation

Use **Databento** as the preferred AlphaDesk integration path for true
Level II / order-book data.

Why:

- Clean API and official client libraries fit AlphaDesk's backend provider
  adapter model.
- Supports historical and live workflows, so we can backtest and display
  similar market-structure data.
- Supports `MBP-10` for L2 market-by-price and `MBO` for full order-book
  / L3 style research.
- Covers US equities through direct exchange feeds such as Nasdaq TotalView,
  NYSE Integrated, NYSE Arca Integrated, Cboe Depth, MEMX, and related feeds.

## Budget-Aware Path

1. Keep **Alpaca Algo Trader Plus** as the main L1 / OPRA / normal app-data
   feed if budget allows.
2. Add **Databento historical / limited-symbol depth** first, with a hard
   monthly budget cap.
3. Use true live L2 only for the actively selected chart symbol, not the
   full watchlist.
4. Do not buy true options depth yet; use OPRA top-of-book plus options
   chain liquidity/open-interest until a strategy proves it needs more.

## Alternatives

- **Interactive Brokers**: cheapest useful live L2 experiment for a
  single-user dashboard. Good for a personal terminal, but operationally
  clunky for AlphaDesk production because it depends on TWS / IB Gateway,
  entitlements, API limits, and simultaneous depth-request limits.
- **dxFeed**: best enterprise-grade managed feed if budget stops being the
  constraint. Strong coverage, replay, historical, options, and institutional
  support, but likely more sales-led and expensive.

## Current AlphaDesk State

The app now has a stable `MarketDepthSnapshot` contract and chart rendering
that can consume L2 depth later. Current production providers still expose
only top-of-book/NBBO depth for equities, so support/resistance, order blocks,
and liquidity profile remain chart-derived proxies until a true depth adapter
is added.

