# Dashboard Redesign — Hedge Fund Command Center

**Date:** 2026-04-10
**Scope:** Redesign the main dashboard page to be a hedge fund manager's morning briefing — instant overview of portfolio, system activity, strategy status, and market context.

## Problem

Current dashboard shows strategy cards and market data but doesn't answer the key questions a hedge fund manager asks: "What did the system do? What should I worry about? Are we making money?"

## Design

### Section 1: Command Bar (top strip)

Full-width bar with key metrics at a glance:

- **Portfolio equity** — large, bold ($100,081.46)
- **Day P&L** — colored green/red with percent (+$19.33, +0.02%)
- **Market regime badge** — "Bull - Low Vol" (green), "Bear" (red), "Crisis" (red pulse), pulled from `/market-overview/regime`
- **VIX level** — number with trend arrow (16.5 ↓)
- **Pipeline status** — "Last run 12:30 PM — 93 screened, 0 trades" from `/pipeline/status` + latest log
- **Live indicator** — WebSocket connection dot

### Section 2: Activity Feed (left ~60%)

Reverse-chronological feed of everything the system did today. Each entry has:
- Timestamp
- Icon + color: green (win), red (loss/alert), blue (info), amber (warning)
- Description text

**Feed items generated from:**
- Pipeline run results (`/pipeline/history/{date}`) — "8 strategies evaluated, 9 candidates rejected"
- Trade executions (trade ledger) — "Bought 43 MRK @ $113.84 via PEAD"
- Position alerts — "MRK +0.37% unrealized"
- Stop-loss/take-profit hits — "PG stop-loss hit, -$744.52"
- News alerts (from continuous monitor logs) — "News: Brodsky & Smith investigation affecting MRK"
- Regime changes — "Regime shifted from Crisis to Bull - Low Vol"

Unexpected events (large losses, regime changes, stop hits) get a highlight amber/red left border.

**Minimum text size:** 13px for feed items (up from 11px). Caption/label text 12px minimum.

### Section 3: Strategy Grid (right ~40%)

Compact card per strategy:
- Strategy name + status badge (Active/Paused)
- Last action text ("Screened 13, analyzed 2, 0 approved")
- Return % colored
- Position count
- How regime affects this strategy (e.g., "Favored in bull regime" or "Reduced allocation in crisis")

Click → navigates to `/strategies/[id]`

### Section 4: Market Context (bottom strip)

- **Indices row** — SPY, QQQ, IWM, VIX with price + change + mini sparkline
- **Sector heatmap** — compact colored blocks (green/red by sector performance)
- **Headlines** — 2-3 latest news articles from `/news/market`

## Typography Change

Increase minimum text sizes across the dashboard:
- Body text: 14px (was 12px in places)
- Captions/labels: 12px minimum (was 10-11px)
- Feed items: 13px
- Metric values: unchanged (already large)

This applies to the `text-[11px]` and `text-[10px]` classes used in the current dashboard — bump to `text-xs` (12px) minimum.

## Data Sources

All existing endpoints, no new backend work:

| Data | Endpoint |
|------|----------|
| Equity, P&L | `GET /portfolio/summary` |
| Regime | `GET /market-overview/regime` |
| Pipeline status | `GET /pipeline/status` |
| Pipeline logs | `GET /pipeline/history/{date}` |
| Strategies | `GET /strategies/` |
| Indices | `GET /market-overview/indices` |
| Sectors | `GET /market-overview/sectors` |
| News | `GET /news/market` |
| Positions | `GET /trades/positions` |

## Activity Feed Construction

The feed is assembled client-side from multiple sources:
1. Fetch today's pipeline log → extract run events
2. Fetch positions → generate position status entries
3. Fetch news → generate headline entries
4. Pipeline log `rejections` → generate rejection summary entries
5. Trade ledger entries (from pipeline log `orders_placed`/`orders_closed`) → trade events

Sort all by timestamp, most recent first.

## Out of Scope

- Historical activity (only today's feed)
- Alerts/notifications system
- Chat/AI assistant panel
- Editing strategies from dashboard
