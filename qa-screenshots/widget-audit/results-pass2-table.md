Widget | Function | Status | Issue
--- | --- | --- | ---
Portfolio Hero | Shows portfolio equity value | PASS | Found: $100,059.75
Strategy Grid | Cards navigate to strategy detail | PASS | 3/3 navigations succeeded
Sector Treemap | Shows sector names | PASS | Found: Technology, Financial, Industrial, Consumer, Utilities, Materials
Sector Treemap | Shows sector percentages | PASS | Found 27 percentages
Allocation Donut | Shows Cash label | PASS | Cash: true, BuyingPower: false
Allocation Donut | Shows Invested label | FAIL | 
Allocation Donut | Allocation heading present | FAIL | 
Status Strip | Strip renders (role=status) | PASS | 
Status Strip | P&L shown in strip | PASS | 
Watchlist | Watchlist tab present | PASS | 
Watchlist | Sparklines rendered | PASS | Found 10 mini sparklines
Watchlist | Shows tracked symbols | PASS | Found: AAPL, MSFT, GOOGL, AMZN, TSLA, SPY, QQQ, NVDA
Screener Tab | Has Run/Screen button | PASS | 
Technical Analysis Tab | Shows indicators | PASS | Found: RSI, MACD, EMA, BB, Support, Resistance
Technical Analysis Tab | Score gauge rendered | PASS | 
Fundamental Tab | F-Score displayed | PASS | 
Sentiment Tab | Shows sentiment data | PASS | 
Sentiment Tab | Estimated items greyed | PASS | 
Chat Tab | Chat input exists | PASS | 
Chat Tab | AI responds to message | PASS | 
Order Tab | Submit/Place order button | PASS | Buttons found: Buy, Sell, Buy 10 SPY @ Market
Order Tab | Order type options | PASS | 
Options Chain | Options panel visible | PASS | Call: true, Put: true, Chain: true
Options Chain | Shows strikes | PASS | 
Options Chain | IV displayed | PASS | 
Options Chain | Expected Move | PASS | 
Options Chain | Bid/Ask columns | PASS | 
Journal Tab | Textarea found | FAIL | 
Strategy Builder | Builder textarea found | FAIL | 
Backtest | Equity curve rendered | PASS | SVG paths: 45, Canvas: 0
Backtest | Chart container present | PASS | Found 21
Run Pipeline | Run Now button present | FAIL | 
TopBar Navigation | Dashboard/Trade/Pipeline buttons | PASS | Dashboard: true, Trade: true, Pipeline: true
TopBar Navigation | Trade nav works | PASS | URL: https://tradingalpha.net/trade
TopBar Navigation | Pipeline nav works | PASS | URL: https://tradingalpha.net/pipeline
TopBar Navigation | Logo/brand goes home | FAIL | URL: https://tradingalpha.net/pipeline
Profile Menu | Opens on click | PASS | 
Profile Menu | Has logout option | PASS | 
Profile Menu | Has shortcuts option | PASS | 
