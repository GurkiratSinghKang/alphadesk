# buy_and_hold_spy (smoke)

The simplest possible strategy: on the first trading bar of the backtest,
allocate 100% of the portfolio to SPY (S&P 500 ETF) using a market-on-open
order, then hold the position until the end of the run. No exits, no
rebalances, no parameter knobs.

Used by team F1 as the end-to-end smoke test for the backtest engine: a
correct run should reproduce SPY's total-return equity curve (minus a
single entry's worth of cost) and a Sharpe ratio within a few percent of
SPY's buy-and-hold Sharpe over the same window. If the smoke test passes,
the engine, data provider, strategy protocol, registry, and cost model are
all wired together correctly.

Not part of the production strategy universe; lives under
`backend/strategies/_smoke/` so `load_all()` discovers it but the API's
strategy listing can filter it out on `category=="smoke"`.
