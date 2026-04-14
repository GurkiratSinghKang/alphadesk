Widget | Function | Status | Issue
--- | --- | --- | ---
Allocation Donut | Allocation heading | FAIL | 
Allocation Donut | Cash label | PASS | 
Allocation Donut | Invested label | FAIL | 
Allocation Donut | Total shown in donut center | PASS | 
Journal Tab | Can add note to trade entry | PASS | 
Journal Tab | Note persists after tab switch | PASS | 
Strategy Builder | Rule input found | PASS | 
Strategy Builder | Parses natural language rule | PASS | 
Strategy Builder | Example chips visible | FAIL | Found 0 example chips
Run Pipeline | "Run Now" button visible | PASS | 
Run Pipeline | Triggers on click | PASS | Running: true, Completed: false, Error: true
TopBar Navigation | Logo/brand is clickable (goes home) | FAIL | CONFIRMED BUG: Logo div has no onClick handler in TopBar.tsx line 73-76. The AlphaDesk text is a plain <div> with no navigation.
TopBar Navigation | Dashboard button goes home | PASS | URL: https://tradingalpha.net/
