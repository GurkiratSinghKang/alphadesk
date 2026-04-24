# Persona 9 — Portfolio Manager

**Profile:** Allocates risk across strategies. Wants clean aggregates, honest attribution, and drill-down to individual rules.

## Bugs found

### P0-PM-1: PEAD shows `Invested $4.9K` but `0 positions` — accounting identity broken
- Strategies grid card: `0 positions · Invested $4.9K`.
- PEAD detail page `/strategies/pead` `§ 03 · POSITIONS` says *"No positions open. Positions will appear here when the strategy next enters a trade."*
- `Invested` should equal `sum(shares × cost_basis)` for open positions. Zero positions can't invest $4.9K. Either the card is leaking a cash-earmark, a phantom partial-fill, or a rounding/labeling bug.

### P0-PM-2: Manual / Discretionary detail page shows CAGR but no OOS Sharpe / MaxDD / HitRate
- All three should be computable from the same trade series that gave CAGR. Emitting one metric and em-dashing the rest suggests a pipeline that fails partially and renders the partial result without warning — dangerous for allocation decisions.

### P1-PM-3: Intermittent "Connecting to live data…" banner flashes on navigation
- On reload of `/strategies`, a banner *"Connecting to live data…"* appeared for ~3 seconds, top bar flipped to `OFFLINE`, VIX showed `---`, strategy cards were skeletons. A PM watching during the market open would panic.
- **Fix:** Preserve last-known state during reconnect; only show OFFLINE after a grace period (e.g., 5s).

### P1-PM-4: Breadcrumb on strategy detail pages says "Dashboard / …"
- `/strategies/pead` breadcrumb: *"Dashboard / Post-Earnings Announcement Drift."* A user who arrived from `/strategies` would expect `Strategies / …`. The home crumb also points to the wrong label ("Dashboard" vs "Desk" vs "Strategies").

### P1-PM-5: Strategy detail copy exposes internal file paths
- PEAD description: *"See audit-reports/phase1-pead.md"* and *"audit findings F1-F5"*.
- Internal artifacts shouldn't be referenced by filename in user-facing copy. Either link to the audit as a rendered page on the desk or strip the filename.

### P1-PM-6: Date discrepancy between pipeline positions and strategy last-trade
- Pipeline `ENTRY DATE` for all 7 positions: `Apr 18, 2026, 01:42 AM`.
- Manual / Discretionary detail `LAST TRADE`: `Apr 17, 2026`.
- If those 7 positions were all opened by the manual strategy (as `/reports` suggests), last-trade should be 4/18 or later, not 4/17.

### P1-PM-7: Strategies top-of-page counter `12 active · 1 paused · 7 coming soon · 20 total` doesn't match Reports table
- Reports lists 2 paused (Earnings Vol Premium + Gap Fill). Strategies grid has 1 paused.
- PM cannot rely on the top-of-page count.

### P2-PM-8: No allocation view across strategies
- There is no page where I can see "allocation: 57% manual, 5% PEAD, 0% rest". PM has to mentally sum cards. Add a "Risk allocation" bar on /strategies header.

### P2-PM-9: "Invested $4.9K" is rounded to one decimal but the detail cost basis is precise
- Card shows `$4.9K` (reads as ~$4,900). The true invested could be anywhere in $4,850–$4,949. For allocation decisions that's loose. Expose precise value on hover.
