# AlphaDesk Design Brief — 2026
## What information should be displayed where, and in the best form

> Synthesized from research across pro terminals (Bloomberg / ThinkorSwim / IBKR TWS), modern retail platforms (Tastytrade / Robinhood / Public / Lightyear / Trade Republic / Webull), chart-centric tools (TradingView / Stockcharts / NinjaTrader / OptionsPlay), award-winning SaaS dashboards (Stripe / Linear / Vercel / Mercury / Brex / Ramp / Plaid / Datadog / Grafana), and the cognitive principles behind them (Tufte, Munzner, Few, Norman, Nielsen, Miller/Cowan, Hick, Fitts, Sweller, Gestalt, eye-tracking).
>
> AlphaDesk's positioning: a Bloomberg-aspiring retail terminal with editorial typography for the prosumer / quant-curious trader. The audience wants pro-grade information density, but rejects Bloomberg's amber-CRT aesthetic. **Tastytrade's information density + Linear's restraint + an italic editorial voice + a single ownable accent that isn't fintech-blue.**

---

## Part 1 — The 14 cross-cutting principles

These emerged from every research agent independently. They form the foundation; every page-level recommendation below is downstream of them.

### Information architecture

1. **Persistent context, swappable function.** Bloomberg, ToS, and TWS all pin the *security/account/workspace* and swap *function* into the same panel. Retail tools wrongly do the inverse. → **AlphaDesk: a global symbol context (chosen once) drives every panel that can render it.**

2. **Inverted-L navigation chrome.** Linear, Vercel, Stripe, Plaid all use left sidebar (256px collapsible to 56px) + top breadcrumbs. Sidebar tone one shade dimmer than content (Linear's "recede chrome, advance data" thesis).

3. **Cmd+K is mandatory and unifies navigate + act + search.** Linear, Ramp, Notion, Vercel, Stripe all converge here. One hotkey. Same surface for `g s` (Strategies), `flatten AAPL` (action), symbol/order/strategy search.

4. **Symbol-link color groups.** TWS lets you join any panel to a numbered/colored group; changing the symbol in one window propagates to all. → **AlphaDesk: support up to 4 color groups; pin once, every relevant panel updates synchronously.**

5. **Workflow-grouped tabs, not asset-class-grouped.** ToS does Monitor / Trade / Analyze / Scan — verbs not nouns. AlphaDesk's existing Trade / Strategies / Analytics / Reports / Alerts / Pipeline / Settings is correct.

### Visual hierarchy

6. **The 4-chunk rule (Cowan, refined Miller).** Working memory caps at ~4 unrehearsed chunks under reading conditions. Every visual region (KPI strip, hero block, side panel) caps at 4 primary items; the rest goes behind a "More" disclosure.

7. **Munzner's effectiveness ranking for magnitude.** Position-on-common-scale > length > angle > area > color luminance > color saturation > color hue. **Hue encodes IDENTITY (long/short, call/put), not magnitude.** Replace red/green saturation gradients for P&L with bar length on a shared axis.

8. **Tufte sparklines beat scalar numbers.** A 30-day price sparkline next to a watchlist row, or a 1-day intraday spark next to a position row anchored to entry price, is more useful than the single P&L number.

9. **Bullet graphs over gauges (Few).** Replace any dial / donut / radial widget with a horizontal bullet graph (target + qualitative bands + actual). No pies. Few's rule.

10. **F-pattern fixation governs placement.** Eye-tracking on financial dashboards shows traders fixate top-left first, then sweep horizontally. Most-valuable info (overnight P&L, broker connection, market state) goes top-left.

### Typography & color

11. **Display + body + monospace.** The premium pair is **Inter Display** (or equivalent) for headings, **Inter** for body, **Geist Mono / Berkeley Mono** for numerics. Mono ONLY on numbers, tickers, prices, IDs — never as decoration. Apply `tabular-nums` to every numeric cell so digit columns align.

12. **3-token theme in LCH/CIELAB.** Linear collapsed 98 theme variables to 3 (base, accent, contrast); Stripe rebuilt their palette in CIELAB. → **AlphaDesk: one neutral base + one ownable accent + one contrast color**, computed in LCH so a green pill and a red pill have equal perceived weight. Avoid finance-blue (over-used).

13. **One ownable accent.** Robin Neon (yellow-green), Brex orange, Mercury purple. AlphaDesk's existing warm-brown/gold direction is good — lock it. Two-state P&L only (green up / red down); a third color for "expected move" is the Tastytrade signature (warm orange/brown band).

### Motion & feedback

14. **Skeleton screens + content-shaped placeholders.** Every load uses a content-shape shimmer, never a spinner. Empty states write a *next step*, not generic "no data". Progressive disclosure of complexity (Stripe pattern: simplest path first, advanced options behind a `More` reveal animating ≤200ms).

---

## Part 2 — Page-by-page brief

For each of AlphaDesk's 9 pages: **what's the page for**, **what goes where**, **what changes from today**, **what to add**, **what to remove**.

### 2.1 Dashboard — `/`

**Purpose.** Single-screen at-a-glance monitoring of account state + market context + the strategies you operate. The user lands here in the morning, wants to know in <3 seconds: am I making or losing money today, what's the market doing, did anything break overnight.

**Top of viewport (always visible, F-pattern top-left dominance):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ [☰ AlphaDesk]  Dashboard › Today      ⌘K  📅 Apr 26, 14:32 ET       │ ← Top bar (slim)
├─────────────────────────────────────────────────────────────────────┤
│  Equity         Day P&L        BP free       Risk used               │
│  $147,392.18    +$2,418  +1.7% $89,124       62% / 80% cap          │ ← 4-chunk KPI hero
│  ▁▂▄▆█▇▆▇█▆    [bullet graph: 2.4 cap, 1.7 actual] ╴╶▁▂▂▃▃▃▂▁     │
└─────────────────────────────────────────────────────────────────────┘
```

- **4 cells, no more** (Cowan). Each: one primary number (28-32px display) + one comparison metric (14px mono) + one sparkline (30 days for equity, 1d intraday for P&L, full-day arc for BP, bullet graph for risk).
- Mono on all numbers with `tabular-nums`. Italic display title only on the page header, NOT on KPI labels.

**Center surface (60% of viewport):**

```
┌─────────────────────┬─────────────────────────────────────────────────┐
│ WATCHLIST           │ CHART  ▎ AAPL · 187.42  +0.21 (+0.11%)  LIVE   │
│  AAPL  187.42 ▆▆▇▆ │  ┌────────────────────────────────────────────┐ │
│  NVDA  142.18 ▅▆▇▇ │  │  Top-left: ticker · price · OHLC · indi-   │ │
│  MSFT  428.91 ▇▇▆▆ │  │  cator legend (EMA 20, EMA 50, SMA 20…)    │ │
│  GOOGL 173.22 ▇▆▆▅ │  │                                             │ │
│  ...   ...    ▆▇▆▇ │  │           [chart canvas]                    │ │
│                     │  │                                             │ │
│ [+ Add symbol]      │  │  Right axis: floating "+" alert affordance  │ │
│                     │  └────────────────────────────────────────────┘ │
│                     │  TF: 1D  5D  1M  3M  6M  YTD  1Y  5Y  ALL      │
└─────────────────────┴─────────────────────────────────────────────────┘
```

- **Watchlist as small-multiples** (Tufte): each row = ticker + last price + 30-day sparkline + %chg. NO duplicate columns of $-change AND %-change — pick one, tap to toggle (Trade Republic pattern). On hover the row reveals quick-actions: Trade · Inspect · Pin to symbol-group.
- **Chart pinned center.** This is the most-attended surface; treat it like Bloomberg treats the security context.

**Below the fold (collapsible):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ POSITIONS                                                           │
│ ┌────┬────────┬─────┬───────┬─────────┬────────┬─────┬────────────┐│
│ │SYM │QTY     │AVG  │LAST   │UNREAL P&│TODAY $ │%CHG │30D ▆▆▇▆▇▇▆ ││
│ │AAPL│  100  L│185.20│187.42│ +222.00 │ +21.00 │+1.7%│ ▆▇▇▇▆▇▇▇▆ ││
│ │NVDA│  -50  S│141.80│142.18│  -19.00 │ -0.50  │-0.4%│ ▇▆▅▅▆▇▇▆▇ ││
│ └────┴────────┴─────┴───────┴─────────┴────────┴─────┴────────────┘│
│                                                                     │
│ MORNING BRIEF (italic display: "Apr 26, market overview")          │
│  · Catalysts today: NVDA earnings AMC, FOMC at 2pm                 │
│  · Top movers: AAPL +1.7% (premarket buyback), …                   │
│  · AI thesis: rotation into defensives, treasuries flat            │
└─────────────────────────────────────────────────────────────────────┘
```

- **Positions table** uses Munzner's effectiveness ranking: P&L magnitude shown as **bar length** in the 30D column (anchored to entry price), color used only for L/S identity, hue is brand-warm or neutral. Today $ change still shown as a number for the latte-fast scan.
- Sticky header on scroll (Airtable). Right-align all numeric columns. Hover reveals: Close · Roll · Trade more.
- **Morning Brief** demoted to below-fold since it's once-per-day reading; an italic editorial display title differentiates it from data tables.

**What to remove from today's dashboard:**
- Any donut/pie/radial widget for risk or P&L → bullet graph
- Duplicate $-change AND %-change columns → tap to toggle
- "WorkspaceSelector" (already removed in W-1)
- Confetti/celebratory animations on profitable days

---

### 2.2 Trade — `/trade`

**Purpose.** Order entry + chart for a single symbol. Deep-link from `/strategies/earnings-options-play` or watchlist.

**Layout:** **Left sidebar = Order Entry, Right pane = Chart, Bottom strip = Order Book / Time & Sales / Working Orders tabs.** This pattern from ToS Active Trader + IBKR Mosaic + NinjaTrader is the consensus pro layout.

```
┌─ ORDER ENTRY ───────┬─ CHART ─────────────────────────────────────┐
│ AAPL  187.42 +0.21  │  Top-left: OHLC + indicator legend          │
│ ───────────────────  │  Right axis: hover "+" alert affordance    │
│ Side   [Buy] [Sell] │  Click axis below mid → buy limit          │
│ Qty    [100      ]  │  Click axis above mid → sell limit         │
│ Type   Market ▼     │  Working order line shows draggable        │
│ TIF    DAY ▼        │                                             │
│                     │  4-zone P&L preview shaded (Tastytrade):   │
│ POP    72%  📊      │   green = profit                            │
│ Max loss: $4,150    │   red   = loss                              │
│ Max gain: $850      │   gray  = breakeven                         │
│ Defined-risk ✓      │   brown = expected move ±1σ                 │
│ ───────────────────  │                                             │
│ [▸ More options]    │                                             │
│ ─ Notes (optional)  │                                             │
│ ───────────────────  │                                             │
│ [BIG PRIMARY: BUY]  │                                             │
├─────────────────────┴─────────────────────────────────────────────┤
│ [Working orders] [Recent fills] [Time & Sales] [Level II]         │
│ Sticky bottom strip — tabs swap content, height fixed             │
└───────────────────────────────────────────────────────────────────┘
```

**Key patterns adopted:**
- **POP pill at top of ticket** (Tastytrade signature) — probability-of-profit updating live as legs change. Single most distinctive Tastytrade pattern.
- **Four-zone P&L shading on chart** (Tastytrade) — green / red / gray + brown 1σ expected-move band. Italic caption: *"Expected move ±$3.42 by Fri."*
- **Defined-risk ✓ pill** (DR-1 outcome). When undefined-risk, replace with red "⚠ Undefined risk — max loss UNLIMITED" and disable the BUY button.
- **Click-axis-to-place-limit** (NinjaTrader / TradingView). Cursor turns blue/red target near the axis. Working orders show as draggable horizontal lines on the chart.
- **More options progressive disclosure** (Stripe pattern). Default ticket shows qty/side/type/TIF + POP + max loss + primary action. Advanced (post-only, iceberg, slippage tolerance, bracket OCO) hidden behind `▸ More`. Animation ≤200ms.
- **Bottom tabs** for Working Orders / Recent fills / T&S / Level II — IBKR Mosaic pattern, not modal.

---

### 2.3 Strategies catalog — `/strategies`

**Purpose.** Browse the 12 strategies + 1 research stub. Pick one to deploy or backtest.

**Layout:** Editorial grid + filters. The "12 quantitative edges, one execution layer" hero from the login page extends here.

```
┌─────────────────────────────────────────────────────────────────────┐
│  § STRATEGIES                                                       │
│  Twelve quantitative edges. One execution layer.                   │ ← italic display
│                                                                     │
│  Filters: [Live] [Research] [Equity] [Options] [Event] [Momentum]  │
│  Sort:    Sharpe ▼  CAGR  Max DD  Recently changed                 │
│                                                                     │
│  ┌─────────────────────────┬─────────────────────────┐             │
│  │ § PEAD                  │ § Cross-Sectional       │             │
│  │ Post-Earnings           │ Momentum + Quality      │             │
│  │ Announcement Drift      │                         │             │
│  │ ──────────────────      │ ──────────────────      │             │
│  │ Sharpe  1.42  ▆▇▆▇▇    │ Sharpe  1.71  ▇▇▇▆▆    │             │
│  │ CAGR    18.4%          │ CAGR    14.2%          │             │
│  │ Max DD  -12.3%         │ Max DD  -8.7%          │             │
│  │ live · equity · auton. │ live · equity · auton. │             │
│  │ [Open] [Backtest]      │ [Open] [Backtest]      │             │
│  └─────────────────────────┴─────────────────────────┘             │
│                                                                     │
│  ... 11 more cards ...                                              │
└─────────────────────────────────────────────────────────────────────┘
```

- **Card content:** italic display name (with the `§` editorial mark) + one-line tagline. Then 3 KPIs (Sharpe, CAGR, Max DD) with a sparkline of the equity curve. Bottom: status pills (live / research / autonomous / paper-only), category, primary action.
- **No fewer than 3, no more than 4 KPIs per card** (Cowan).
- **Status pills** use Carbon convention: green=Live, blue=Working, amber=Paper, red=Halted, grey=Cancelled.
- Equity sparkline replaces a separate "performance" tab — at-a-glance visualization (Tufte).

---

### 2.4 Strategy detail — `/strategies/[id]`

**Purpose.** Per-strategy operations + backtest review.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ § PEAD — Post-Earnings Announcement Drift              [Pause] ⋮   │
│ Long/short US equity on standardised unexpected earnings.           │
│ ─────────────────────────────────────────────────────────────────  │
│  HERO: 4 KPIs — equity curve sparkline  · Sharpe · CAGR · Max DD   │
│ ─────────────────────────────────────────────────────────────────  │
│  Tabs: [Performance] [Open positions] [Trade history] [Params]     │
│  ─ Performance pane: equity curve, drawdown band, monthly returns  │
│    heatmap (small multiples for cumulative win-rate per month)     │
└─────────────────────────────────────────────────────────────────────┘
```

- **Pause/halt buttons admin-gated** (RD-3 fix).
- **Drawdown shown as a downward-shaded band** below equity curve, never as overlapping red on green (color-blind safe).
- **Monthly heatmap** uses sequential green-to-red Munzner-style luminance ramp, not divergent hue.

---

### 2.5 Earnings options play — `/strategies/earnings-options-play`

**Purpose.** Specialized research screener for earnings setups. Select a calendar row → see the detail panel.

**Layout retains current 3-zone:** Sidebar calendar (left, 360px) + detail panel (right, fluid). But each panel is reorganized.

**Sidebar (calendar):**
- Tier-1 sources first by default (Round-12 NF-1).
- Each row: ticker + company + report time chip (BMO / AMC / DMT) + days_until + IV rank chip.
- Visually dim today_done (Round-12 EC-1).

**Detail panel hero (top of right pane):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ § AAPL · Apple Inc · Technology                                     │
│ Reports Tue Apr 28 AMC · 2 days · 187.42 (-0.11%) ⌚ 12s ago LIVE   │
│ ─────────────────────────────────────────────────────────────────  │
│  DECISION STRIP (4 cells):                                          │
│  Verdict: NEUTRAL-BULL  Expected: ±5.2%  IV rank: 78  POP cap: 72% │
└─────────────────────────────────────────────────────────────────────┘
```

- **Freshness chip** ("12s ago LIVE") next to every price (Nielsen #1 visibility of system status). Distinguish snapshot freshness from quote freshness when divergent (DD finding #6).
- **Decision strip = 4 chunks** (Cowan).

**Below the hero:**

```
┌──────────────────────────────────┬──────────────────────────────────┐
│ § Claude thesis                  │ § Strike ladder                  │
│ NEUTRAL-BULL · 62% confidence    │ ATM 200p / 205c · 30Δ wings     │
│ Suggested play: bull put spread  │ ┌────────────────────────────┐   │
│ ───────────────────────────────  │ │ Strike │Δ   │Bid  │Ask  │IV│   │
│ "IV rank elevated entering…"     │ │ 215c 0.15 ...  defined-risk│   │
│ Catalysts: data-center guide…    │ │ 210c 0.30                  │   │
│ Risks: guide miss…               │ │ 205c 0.50  ATM             │   │
│ ✓ Defined risk · Run full ⏎     │ │ 200p 0.50  ATM             │   │
│                                  │ │ 195p 0.30                  │   │
│                                  │ │ 190p 0.15                  │   │
│                                  │ └────────────────────────────┘   │
│                                  │                                  │
│ § News · price-driving           │ § IV term + skew                 │
│ [earnings] AAPL beats Q3 — 2h ★  │ Term: 78 → 62 → 48 → 36         │
│ [rating]   GS upgrades — 8h ★    │ Skew:  Put 25Δ 81% / Call 79%   │
│ [M&A]      …                     │ ▆▇▆▆▆ small-multiple sparkline  │
│ ───────────────────────────────  │                                  │
│ Stage-1 filtered for relevance   │                                  │
└──────────────────────────────────┴──────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ § Defined-risk trade buttons (Round-12 DR-1)                       │
│ [Bull put 195/200p] [Bear call 205/210c] [Iron condor] [Long strad]│
│  ✓ Defined risk pill on every button                               │
└─────────────────────────────────────────────────────────────────────┘
```

**Key patterns adopted:**
- **Italic `§` editorial titles** for every section (current AlphaDesk hallmark, validated against Stripe Press / Linear typography research).
- **Tastytrade four-zone P&L** preview shown when the user hovers a trade button.
- **News rail with category chips + tier-1 ★** (Round-12 NF-1, now visible end-to-end after RD-5).
- **Strike ladder mini-chart** renders bars on a shared y-axis (Munzner) — bid/ask/mid scaled relatively so the eye reads them in one glance.
- **NO Run-Full-Research timeout race** (Round-12 CL-1 fix already shipped).

---

### 2.6 Analytics — `/analytics`

**Purpose.** Portfolio-level performance, attribution, exposures.

**Layout:**
- Hero: 4-KPI strip (Sharpe, Sortino, CAGR, Max DD) + equity curve hero chart with drawdown band.
- **Small multiples grid** for per-strategy performance (Tufte): one mini equity-curve per strategy on a shared y-axis.
- **Beta-weighted delta** as the headline directional metric (Tastytrade adopted pattern).
- **Heatmap** for monthly returns: green-luminance ramp (Munzner).
- Filters: time range chips (1M / 3M / 6M / YTD / 1Y / 5Y / ALL), strategy multiselect.

---

### 2.7 Reports — `/reports`

**Purpose.** Closed trade ledger + tax exports.

**Layout:** Stripe Dashboard pattern. Sticky-header table + filter rail + bulk-actions bar.

```
┌─ Filters ──────┬─ Trade ledger ──────────────────────────────────┐
│ Date range     │  Sticky header. Right-align all numerics.       │
│ Strategy       │  Status pills: Filled / Cancelled / Rejected.   │
│ Symbol         │  Hover row → Inspect · Re-export · Annotate.    │
│ Side           │  Bulk select → bottom dock action bar           │
│ P&L sign       │  (Export CSV · Tax 1099-B · Re-run analysis)   │
│ Holding period │                                                  │
│                │  Saved views: "Long Q3 winners", "Short losses" │
│ [Reset]        │  (Brex Smart Tables pattern)                     │
└────────────────┴──────────────────────────────────────────────────┘
```

- **Saved views** per table (Brex). Right-click context menu mirrors Cmd+K commands.
- **Compact toggle** Cmd+Shift+D drops row height ~12px, removes card padding (Datadog precedent).

---

### 2.8 Alerts — `/alerts`

**Purpose.** Set + manage price / event alerts.

**Layout:** Two-column. Left: list of active alerts grouped by symbol; Right: detail editor for the selected alert.

- **Hover-the-price-scale "+" alert affordance** (TradingView). Add an alert without leaving the chart.
- **Alert types:** Price (above/below), %-change, IV rank threshold, news category match (Round-12 NF-1 categories), earnings date approaching.
- **Status pill** on each alert row: armed (green pulse) / triggered (amber) / cleared (grey).

---

### 2.9 Pipeline — `/pipeline`

**Purpose.** Operational status of the daily strategy pipeline (12 strategies).

**Layout:** Datadog-style high-density observability dashboard.

- Top: 4 KPIs — strategies running / errors today / next run ETA / last successful run.
- Middle: a Gantt-style swimlane per strategy showing: scheduled runs (faded grey), actual runs (colored by status: green=success, amber=partial, red=failed), each with a tooltip showing duration + emitted signal count.
- Bottom: log stream filtered to current pipeline run.

- **Operator-pause buttons** (Round-13 RD-12) per strategy.
- **Status indicators** use Carbon convention: 6-px filled circle, animated pulse only for `RUNNING`.

---

### 2.10 Settings — `/settings`

**Purpose.** Account, brokers, risk, notifications, API keys.

**Layout:** Linear's "redesigned from the ground up" model. Left rail with sections + right content with grouped cards.

- Left rail: Account / Brokers / Strategies / Risk / Notifications / API Keys / Billing.
- Right pane: one scroll per section, no nested tabs.
- Each card: title + description + control. Mono only on values like API keys (with reveal/hide toggle).
- **Theme picker:** Dark (warm) default, Compact toggle, Reduced motion, Tabular figures (already-on default).

---

## Part 3 — Cross-page system surfaces

These sit ON TOP of every page. Get them right and every page gets better.

### 3.1 Top bar (slim, 56px)

```
[☰ AlphaDesk]    Dashboard › Today          ⌘K        ● Live  $  Apr 26 14:32 ET
```

- Brand left, breadcrumb center-left, Cmd+K hint right-of-center, status segments far-right.
- **One ownable accent** color on `AlphaDesk`. Single weight. No gradients.
- **Mode pill** (`Paper` / `Live`) prominent on the right; `Live` pulses subtly, `Paper` is amber and static (per Carbon status indicators).

### 3.2 Bottom status bar (slim, 24px)

Mirrors Datadog/Bloomberg.

```
● Market: OPEN 14:32 ET · ● Broker: Connected (Alpaca) · ● Last tick: AAPL 187.42 (+0.21) · ● Pipeline: idle · ● Mode: PAPER
```

- 6-px filled circle per segment, **animated pulse only for `LIVE` and `RUNNING`**.
- Each segment is a hover-popover showing details + click-action ("Reconnect broker", "Open pipeline").

### 3.3 Cmd+K command palette (the unifier)

One hotkey for:
- **Navigate**: `g d` Dashboard, `g s` Strategies, `g r` Reports, `g a` Alerts, `g e` Earnings Play
- **Act**: `flatten AAPL`, `pause pead`, `cancel all`, `toggle paper/live`
- **Search**: symbol, strategy, order ID, position, news headline
- **Settings**: theme, density, keybindings

Recently-used at top, keyboard-only operable, ESC closes (Linear convention). Show shortcut chip on hover of every menu item to teach the bindings (Ramp).

### 3.4 Toast notification system

**Sonner pattern.** Bottom-right default, max 3 visible, 5s auto-dismiss for success/info, sticky for error until dismissed, swipe to clear, action button inline ("Undo close").

**Promote to top-center sticky banner** when severity = critical (broker disconnected, margin call, kill-switch tripped) — never auto-dismiss those.

### 3.5 Keyboard shortcuts (global)

| Key | Action |
|---|---|
| `⌘K` | Open command palette |
| `g d` | Go to Dashboard |
| `g s` | Go to Strategies |
| `g r` | Go to Reports |
| `g a` | Go to Alerts |
| `g e` | Go to Earnings play |
| `g t` | Go to Trade |
| `j` / `k` | Next / previous row in any table |
| `⏎` | Open the focused row |
| `b` / `s` | Buy / Sell on the focused order ticket |
| `⎋` | Cancel / clear / close modal |
| `⌘⇧D` | Toggle Compact density |
| `?` | Show this shortcut sheet |

### 3.6 Color tokens (final spec)

Computed in **LCH** so dark-mode legibility doesn't drift.

| Token | Use | Example |
|---|---|---|
| `--bg-base` | Page background | warm dark `#1a1612` |
| `--bg-card` | Card / panel background | `#211c17` (one shade above base) |
| `--bg-elev-1` | Buttons, hover states | `#2a241e` |
| `--brand` | AlphaDesk accent (the ownable color) | warm gold `#c9a66b` |
| `--profit` | P&L positive, status OK | `#a8d04d` (chartreuse, not pure green) |
| `--loss` | P&L negative, status fail | `#e07856` (coral, not pure red) |
| `--warn` | Paper mode, partial-data | amber `#d97706` |
| `--info` | Live ticks, system info | sky `#5b8def` |
| `--expected-move` | Tastytrade 1σ band | brown `#a07550` |
| `--fg-strong` | Primary text | warm off-white `#f0e8dc` |
| `--fg-muted` | Secondary text, labels | `#b3a594` |
| `--border` | Divider lines | `#3a312a` |

**Single accent locked to `--brand`** — no rainbow palette. P&L two-state only. Expected-move = brown band (Tastytrade signature).

### 3.7 Typography stack

| Use | Font | Weight | Size |
|---|---|---|---|
| Page title (italic display) | "EditorialNew" / Inter Display Italic | 400 | 28-32px |
| Section heading (italic display) | Same | 400 | 18-22px |
| Body | Inter | 400 | 14px |
| Body emphasis | Inter | 600 | 14px |
| Label / eyebrow | Inter | 500 (uppercase, tracked) | 11px |
| Numeric / mono | Geist Mono / Berkeley Mono | 400 | 12-14px |
| KPI hero number | Inter | 600 | 28-32px |

`tabular-nums` class applied to every cell rendering a number.

### 3.8 Density modes

**Cozy (default):** 48px row height, 16px card padding. **Compact:** 32px row height, 12px card padding, reveal an extra column on tables. Toggle Cmd+Shift+D, persisted per-table. Datadog precedent.

---

## Part 4 — Implementation priorities

Ranked by impact-to-effort:

### Quick wins (1-2 days each)
1. Apply `tabular-nums` to every numeric cell across the FE
2. Lock the color palette to the LCH tokens above; remove any one-off colors
3. Add the bottom status bar (Datadog/Bloomberg pattern)
4. Add `?` keyboard shortcut sheet
5. Demote the brief drawer below-fold on dashboard (already done in Round-9)
6. Replace any donut/pie/radial widget with bullet graphs
7. Skeleton shimmer everywhere we currently use a spinner

### Medium (3-5 days each)
8. Consolidate OHLC overlay + indicator legend into one fixed top-left block (TradingView pattern)
9. Add price-scale hover-`+` alert affordance on the chart
10. Add click-axis-to-place-limit on chart (NinjaTrader pattern)
11. Add 30-day sparklines to watchlist + position rows (Tufte)
12. Add Cmd+K command palette unifying nav + actions + search
13. Add Tastytrade four-zone P&L preview to order ticket
14. Migrate all data tables to sticky-header + saved-views (Brex/Airtable)

### Larger (1-2 weeks each)
15. Symbol-link color groups (TWS pattern) — pin once, every relevant panel updates
16. Bar Replay mode on chart (TradingView)
17. Beta-weighted delta on Analytics page (Tastytrade)
18. Datadog-style swimlane on Pipeline page
19. Multi-pane chart layouts with templates (TradingView)

### Strategic (4+ weeks)
20. Custom typeface licensing (Editorial New / Arcadia / equivalent) — premium tier signal
21. Move to LCH-computed theme math (Linear's approach) — replace the existing token system

---

## Part 5 — What NOT to do (anti-patterns the research surfaced)

1. **Confetti / dopamine animations on profitable trades** (Robinhood's well-documented mistake)
2. **40+ indicators on by default** (Webull / Moomoo overload)
3. **Modal-based "see more" flows** instead of adjacent context panels
4. **Variable-width fonts on number columns**
5. **Emoji-style up/down arrows** instead of monospace `+0.42 ▲ 1.2%`
6. **No expected-move / IV term anywhere** (Robinhood-class toy)
7. **Re-typing the symbol everywhere** (no symbol groups, no Cmd+K)
8. **Destructive actions without keyboard confirmation**
9. **Burying probability data** in submenus (POP/expected move must be above the fold)
10. **Stripped-back nav with no analytics** (Trade Republic extreme — wrong audience)
11. **Anti-leaderboard for prosumer users** (Public's good-for-beginners pattern doesn't fit AlphaDesk)
12. **Multiple competing accent colors / gradient salads / chunky shadows**
13. **F-pattern violations** — putting overnight P&L in lower-right
14. **Hue used to encode magnitude** (use length/position; reserve hue for identity)
15. **Pie / donut / dial widgets** (Few's rule)

---

## Sources cited (full list)

### Pro terminals
- [Bloomberg Terminal Functions & Shortcuts (CFI)](https://corporatefinanceinstitute.com/resources/equities/bloomberg-functions-shortcuts-list/)
- [Designing the Terminal for Color Accessibility — Bloomberg UX](https://www.bloomberg.com/ux/2021/10/14/designing-the-terminal-for-color-accessibility/)
- [The Impossible Bloomberg Makeover — UX Magazine](https://uxmag.com/articles/the-impossible-bloomberg-makeover)
- [How Bloomberg Terminal UX designers conceal complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/)
- [ThinkorSwim Active Trader (official)](https://toslc.thinkorswim.com/center/howToTos/thinkManual/Trade/Active-Trader/AT-Overview-Layout)
- [TWS Mosaic Cheat Sheet (PDF)](https://www.interactivebrokers.com/download/CheatSheet_TWSMosaic_944.pdf)
- [TWS Color Grouping](https://guides.interactivebrokers.com/tws/usersguidebook/thetradingwindow/colorgrouping.htm)
- [HRT — Optimizing UX/UI Design for Trading](https://www.hudsonrivertrading.com/hrtbeat/optimizing-ux-ui-design-for-trading/)

### Modern retail
- [Tastytrade P&L zones](https://support.tastytrade.com/support/s/solutions/articles/43000472386)
- [Tastytrade Expected Move](https://support.tastytrade.com/support/s/solutions/articles/43000435415)
- [Tastytrade POP](https://support.tastytrade.com/support/s/solutions/articles/43000530527)
- [Robinhood Advanced Charts](https://robinhood.com/us/en/support/articles/using-advanced-charts/)
- [Robinhood A New Visual Identity](https://robinhood.com/newsroom/a-new-visual-identity/)
- [Public.com Themes](https://public.com/themes)
- [Lightyear — Best Investing App 2026](https://goodmoneyguide.com/investing/lightyear-voted-best-investing-app-2026/)
- [Trade Republic teardown — NextSprints](https://nextsprints.com/guide/trade-republic-product-teardown-analysis)
- [Webull Desktop Platform](https://www.webull.com/trading-platforms/desktop-app)

### SaaS dashboards
- [Stripe Dashboard Basics](https://docs.stripe.com/dashboard/basics)
- [Designing Accessible Color Systems — Stripe](https://stripe.com/blog/accessible-color-systems)
- [Linear — Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)
- [Linear — How we redesigned the UI](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Vercel Geist Typography](https://vercel.com/geist/typography)
- [Plaid Dashboard Redesign 2023](https://plaid.com/blog/dashboard-redesign-2023/)
- [Mercury — Pending Card Transactions](https://support.mercury.com/hc/en-us/articles/28778366589076-Understanding-pending-card-transactions)
- [Top Brex Alternatives — Ramp](https://ramp.com/blog/top-brex-alternatives)
- [Datadog Integration Dashboard Guidelines](https://datadoghq.dev/integrations-core/guidelines/dashboards/)
- [Sonner — Shadcn](https://www.shadcn.io/ui/sonner)
- [Carbon Status Indicators](https://carbondesignsystem.com/patterns/status-indicator-pattern/)
- [Dashboard Design Patterns 2026 — Art of Styleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)

### Charts
- [TradingView Drawing Tools](https://www.tradingview.com/support/solutions/43000703396-drawing-tools-available-on-tradingview/)
- [TradingView Bar Replay](https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/)
- [TradingView Price Alerts](https://www.tradingview.com/support/solutions/43000763313-how-to-use-price-alerts/)
- [NinjaTrader single-click chart entry](https://forum.ninjatrader.com/forum/ninjatrader-8/platform-technical-support-aa/1115883-single-click-order-entry-on-chart)
- [OptionsPlay Explorer](https://help.stockcharts.com/charts-and-tools/research-tools/options-summary/optionsplay-explorer)

### Cognitive principles
- [Edward Tufte — Sparkline Theory and Practice](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)
- [Tamara Munzner — Visualization Analysis and Design](https://www.cs.ubc.ca/~tmm/vadbook/)
- [Stephen Few — Information Dashboard Design (PDF)](https://public.magendanz.com/Temp/Information%20Dashboard%20Design.pdf)
- [Don Norman — The Design of Everyday Things (PDF)](https://media.aanda.psu.edu/sites/media/aa/files/documents/norman_design-of-everyday-things.pdf)
- [Nielsen — 10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Miller's Number in Retrospect (Cowan)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4486516/)
- [Hick's Law — Laws of UX](https://lawsofux.com/hicks-law/)
- [Fitts's Law — Laws of UX](https://lawsofux.com/fittss-law/)
- [Trading and cognition in asset markets — eye-tracking (ScienceDirect 2024)](https://www.sciencedirect.com/science/article/abs/pii/S0167268123003736)
- [Designing Enterprise Dashboards with Cognitive Load Theory](https://www.fegno.com/designing-enterprise-dashboards-with-cognitive-load-theory/)
- [Gestalt Principles in Dashboard Design — Hurree](https://blog.hurree.co/this-psychology-principle-will-make-your-dashboards-more-powerful)

---

## Closing thesis

**Tastytrade has already solved the hardest UX problem in your space — making options-risk math glanceable** (POP pill + four-color P&L zones + brown expected-move band). It looks dated because it's gray-on-gray with system fonts.

**Linear has solved how to make a dense product app feel premium** — recede chrome, advance data, custom display typeface, single ownable accent, 3-token theme math, 200ms motion budget.

**AlphaDesk's edge** is to keep Tastytrade's information-density and risk semantics, then re-skin with editorial italic display titles, warm-dark palette, gold accent, Geist Mono numerics, sparklines instead of scalars, and a Cmd+K-first workflow. **That combination doesn't exist on the market today.**

The 14 principles in Part 1 are the load-bearing ones. The page-by-page redesigns in Part 2 are downstream of them. Get Parts 3.6 (color tokens) and 3.7 (typography) shipped first; everything else inherits the right defaults and the redesign accelerates from there.
