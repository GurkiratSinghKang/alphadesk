Widget | Function | Status | Issue
--- | --- | --- | ---
Portfolio Hero | Shows dollar amount | PASS | Found: $1, $1, $7
Portfolio Hero | P&L has color coding | PASS | Green: true, Red: true
Portfolio Hero | Period buttons present | PASS | Found 4 period buttons
Portfolio Hero | Period buttons change chart | PASS | Clicked 1W and 3M
Equity Curve | Line chart renders | PASS | Found 41 chart elements, 105 SVG paths
Activity Feed | Shows real events | PASS | Events found
Activity Feed | Events have timestamps | PASS | 
Activity Feed | Rejected trades show remediation | PASS | Found
Strategy Grid | Shows strategy cards | PASS | Found 7 strategy names, 0 card elements
Strategy Grid | Cards show position counts | PASS | 
Strategy Grid | Cards show returns | PASS | 
Strategy Grid | Card navigation | FAIL | No strategy links found
Open Positions | Lists Alpaca positions | PASS | Found: MRK, NKE, PG, WMT
Open Positions | P&L values shown | PASS | 
P&L Calendar | Calendar renders | PASS | 
P&L Calendar | Month navigation exists | PASS | Nav buttons: 0, Month label: true
Market Indices | Shows index symbols | PASS | Found: SPY, QQQ, IWM
Market Indices | Prices appear real | PASS | 
Market Indices | VIX displayed | PASS | 
Market Indices | Change percentages meaningful | PASS | Found 2 zero percentages
Sector Treemap | Treemap renders | FAIL | 
Sector Treemap | Has tiles with varying sizes | FAIL | Treemap not found
Sector Treemap | Shows sector ETF data | FAIL | Found 0 sector ETFs
Allocation Donut | Donut chart renders | PASS | 
Allocation Donut | Shows Cash vs Invested | FAIL | Cash: false, Invested: true
Economic Calendar | Shows economic events | PASS | Found 8 economic terms
Economic Calendar | Sample data has opacity | PASS | Opacity < 1 found
Status Strip | Strip renders | FAIL | 
Status Strip | Regime displayed | PASS | 
Status Strip | VIX is real (not 16.5 default) | PASS | VIX: 28.6
Status Strip | LIVE indicator shown | PASS | 
Status Strip | Alpaca (Paper) badge | PASS | 
Chart | Chart loads | PASS | 
Chart | Timeframe buttons present | PASS | Found 8 timeframe buttons
Chart | Chart type buttons | PASS | 
Chart | Timeframe 5m works | PASS | 
Chart | Timeframe 1H works | PASS | 
Chart | Timeframe D works | PASS | 
L1 Data Bar | L1 data displayed | PASS | Found 3/7 L1 terms
L1 Data Bar | Values populated (not all zero) | PASS | Found 232 non-zero price values
Watchlist | Watchlist renders | FAIL | 
Watchlist | Sparklines rendered | FAIL | Found 0 sparklines
Watchlist | Add symbol works | PASS | 
Screener Tab | Content loaded | FAIL | "Run Screen" not found
Screener Tab | Run Screen returns results | PASS | 
Signals Tab | Content loaded | PASS | Found "Signal"
Technical Analysis Tab | Tab button found | FAIL | No "Technical" tab found
Fundamental Tab | Tab button found | FAIL | No "Fundamental" tab found
Sentiment Tab | Tab button found | FAIL | No "Sentiment" tab found
Chat Tab | Tab test | FAIL | locator.click: Timeout 30000ms exceeded.
Call log:
[2m  - waiting for locator('[class*="chat"] button[type="submit"], [class*="Chat"] button:has-text
Order Tab | Content loaded | PASS | Found "Buy"
Order Tab | Buy/Sell toggle present | PASS | 
Order Tab | Quantity input present | PASS | 
Order Tab | Submit button present | FAIL | 
Options Chain | Options tab found | FAIL | No Options tab
Trade Builder | Trade Builder rendered | PASS | 
Trade Builder | Add Leg works | PASS | 
Trade Builder | Shows Net Credit/Debit | PASS | 
Positions Tab (bottom) | Lists positions | PASS | Found 4 symbols
Orders Tab (bottom) | Orders section works | PASS | 
Journal Tab (bottom) | Journal input found | FAIL | 
Calendar Tab (bottom) | Calendar renders | PASS | 
Pipeline Positions | Positions table rendered | PASS | 
Pipeline Positions | Shows entry price | PASS | 
Pipeline Flow | Flow diagram rendered | PASS | Found 5 flow terms
Pipeline Flow | Numbers are non-zero | PASS | 
Strategy Builder | Builder rendered | PASS | 
Strategy Builder | Example chips present | PASS | Found 1 chips
Backtest | Backtest section rendered | PASS | 
Backtest | Shows return | PASS | 
Backtest | Shows Sharpe ratio | PASS | 
Backtest | Shows max drawdown | PASS | 
Backtest | Equity curve rendered | FAIL | 
Run Pipeline | Button present | FAIL | 
Performance Summary | Total P&L shown | PASS | 
Performance Summary | Best/worst trade shown | PASS | 
TopBar Navigation | Nav links present | FAIL | 
Command Palette | Ctrl/Cmd+K opens | PASS | 
Command Palette | Search returns results | PASS | 
Profile Menu | Profile button found | FAIL | No profile button found
Notifications Bell | Popover opens | PASS | 
Notifications Bell | Shows alerts or empty state | PASS | 
Keyboard Shortcuts | Overlay opens with ? | PASS | 
Keyboard Shortcuts | Lists shortcuts | PASS | 
Keyboard Shortcuts | Escape closes overlay | PASS | 
