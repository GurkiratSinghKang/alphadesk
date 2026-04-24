# Persona 3 — Risk Manager

**Profile:** Cares about stop losses, position limits, concurrency locks, kill switches. Watches the "worst thing that can happen" view.

## Bugs found

### P0-RM-1: Every single position has `STOP LOSS = None`
- All 7 current positions on `/pipeline` list "None" under STOP LOSS and `—` under TAKE PROFIT.
- A position book with zero risk-off triggers is the #1 thing a risk manager cannot tolerate.
- **Fix:** Force-enter a stop when a position is opened (policy default, e.g., -5% or strategy-specific). If the platform is paper-only this should still be enforced so muscle memory transfers to live.

### P0-RM-2: "Risk Monitor: ON" with `Last heartbeat: Never`
- The pipeline header proudly displays `● Risk Monitor: ON` next to `Last heartbeat: Never`. A monitor that has never sent a heartbeat is not on.
- **Fix:** Either heartbeat it (it's not running) or change the indicator to `Idle — will start at 09:30 ET`.

### P0-RM-3: Desk P&L disagrees with Pipeline P&L for the same position
- Desk right panel AVGO: `+$275` (~4.81%) on 2 reloads; `+$273` on a third.
- Pipeline row AVGO: `+$375.15` (+6.56%) with ENTRY $381.05 → CURRENT $406.06.
- That's a ≥ $100 mismatch on a single ticker across two pages of the same app session. If both call `/api/v1/portfolio/summary` and `/api/v1/trades/positions` respectively, they're reading from two different sources of truth. A risk manager cannot reconcile.

### P1-RM-4: "Run Now" fires the pipeline with no confirmation modal
- Clicking `Run Now` on `/pipeline` transitions the state from "Market is closed today. Next scheduled run: Monday 09:30 ET" to a 0/0/0/0 counter bar with no dialog, no "are you sure", no toast. A risk manager expects every action that can emit orders to have a confirm step.

### P1-RM-5: Next-run time disagrees with itself
- Pipeline header: `Next scheduled run: 4/20/2026, 9:35:00 AM`.
- Same page body: `Next scheduled run: Monday 09:30 ET`.
- 9:30 vs 9:35 — which is it? For scheduled-trading, a 5-minute drift is material.

### P1-RM-6: All 7 positions have identical entry timestamp (`Apr 18, 2026, 01:42 AM`)
- Either every position was opened in the same millisecond (implausible) or the timestamp is a seed/fixture value. For a compliance trail this is a red flag — audit trails need real entry times.

### P2-RM-7: Notification badge count drifts without interaction
- On `/alerts` the bell showed `1` notification. Navigating to `/pipeline` the same bell shows `2`. I took no action. Background count either auto-increments wrongly or syncs on nav. Either way, inconsistent.

### P2-RM-8: Strategy builder exposes `Maximum position size: 5% of portfolio` as a "quick start rule" but no such rule is enforced on current positions
- NKE is 62 × 42.80 = $2,653 which is 2.6% of a $100K book — fine. But AVGO is 15 × 381.05 = $5,715 which is 5.7% of book and violates the example rule. The app exposes the rule as a template but doesn't hold any active position to it. Risk manager would want a config view showing currently-enforced rules and violations.
