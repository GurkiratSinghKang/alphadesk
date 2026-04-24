# Persona 2 — Quant Analyst

**Profile:** Stares at numbers until something crosses or breaks. Cares about data consistency, statistical honesty, and backtest/live divergence.

## Bugs found

### P0-QA-1: Two completely different navigation bars
- **Desk (`/`)** nav: `a AlphaDesk · Desk · Strategies · Analytics · Pipeline · Alerts` (serif wordmark, no icons, 5 items)
- **Analytics (`/analytics`)** and **Strategies (`/strategies`)** nav: `⚡ AlphaDesk · Dashboard · Strategies · Trade · Analytics · Alerts · Pipeline · Reports · [default project dropdown] · 🔍 search` (sans wordmark, icons, 7 items + search)
- Not only is the count different, so are the item names (Desk vs Dashboard, no "Trade", no "Reports" on desk). A user switches pages and the shell changes under them.
- **Repro:** Land on `/`. Click "Analytics". Observe the top bar morph into a different shell.

### P0-QA-2: Portfolio P&L values change between page reloads with market closed
- Reload 1 desk: `BOOK EQUITY $100,347.87 · DAY P&L +$818.57`. Positions: AVGO +$275, NKE +$179.
- Reload 2 desk: `BOOK EQUITY $100,347.31 · DAY P&L +$818.01`. Positions: AVGO +$273, NKE +$180.
- Delta: equity dropped 56¢ between back-to-back requests with no market tick. For a quant, this means the "snapshot" can never be reproduced from the GL — every refresh produces a slightly different truth.
- **Fix:** Freeze portfolio valuations to last-close NBBO when market is closed; ensure repeat `/api/v1/portfolio/summary` calls are idempotent.

### P1-QA-3: `/dashboard` URL redirects to `/` but the nav elsewhere calls it "Dashboard"
- Clicking "Dashboard" in the analytics shell lands on `/` where the label changes to "Desk". URL label mismatch.
- **Fix:** Pick one — "Desk" or "Dashboard" — and use it everywhere, including URL slug.

### P1-QA-4: Strategy counts disagree
- Desk sidebar: `Strategies 12/13`.
- Strategies page header: `12 active · 1 paused · 7 coming soon · 20 total`.
- Where does the 13 in the sidebar come from? 12 + 1 paused = 13? Then the sidebar should say `12/13 active` not `Strategies 12/13`.

### P1-QA-5: "Manual / Discretionary" strategy has 7 live positions + $57.1K invested but "—" backtest stats
- OOS SHARPE, CAGR, MAX DD all em-dash.
- A real-money catch-all with no statistical baseline is a governance concern for a quant. Even if intentional, the card should carry a "No backtest (discretionary)" label rather than empty metrics.

### P1-QA-6: "Opening Range Breakout" card shows `ACTIVE` + `NOT READY FOR LIVE` pills simultaneously
- Mutually exclusive states rendered together. If "not ready for live" the top badge should be `PAPER ONLY` or `DRAFT`, not `ACTIVE`.

### P1-QA-7: "LIVE" green dot + "PAPER" badge in the same status bar
- The Alpaca account is clearly marked `Alpaca (Paper) · PAPER` but the green dot is labeled `LIVE`. The word "LIVE" next to "PAPER" is indefensible in a trading UI — a trader could misread it as a live-trading session.
- **Fix:** Rename the green dot to `CONNECTED` or `STREAMING`; reserve "LIVE" for actual live-trading mode.

### P2-QA-8: Rolling Sharpe empty state is honest but Trade Stats show `1 scratch` with Win Rate `0.0%` and Profit Factor `0.00`
- Scratch trade should produce `n/a` profit factor (0/0), not `0.00` — division by zero being rendered as zero is misleading.
- `Avg Loss -$0.00` is also wrong when there are no losing trades; should be `n/a` or `$0.00` without negative sign.
