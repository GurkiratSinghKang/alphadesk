# AlphaDesk: Top 5 Next Features to Build

**Date:** April 12, 2026
**Research basis:** Live app audit at tradingalpha.net, codebase analysis (75+ features, 652 tests), competitor research across TradingView, Robinhood, Bloomberg Terminal, Notion/Linear, and Arc Browser.

---

## Executive Summary

AlphaDesk has built an impressive institutional-grade trading terminal. But after auditing the live app and studying what makes competitors sticky, five clear gaps emerge. Each leverages AlphaDesk's **unique advantage** -- a Claude AI backbone with 11 specialist agents already wired up -- in ways competitors cannot easily replicate.

The single biggest unlock: **AlphaDesk already has the AI infrastructure (supervisor agent, 11 specialist sub-agents, MCP servers, WebSocket channels) but surfaces it through a tiny chat tab buried inside the Analysis Panel on the /trade page.** The AI is the product's moat; it needs to be the product's centerpiece.

---

## 1. AI Morning Brief -- "Open AlphaDesk First"

**The problem it solves:** Traders currently open Bloomberg, TradingView, Twitter, and email before AlphaDesk. There is no reason to open AlphaDesk *first* thing in the morning.

**What Bloomberg does:** Portfolio Manager Workspace (PM GO) surfaces exception-driven metrics -- what changed overnight, what needs attention. Bloomberg Brief delivers curated morning summaries. Hedge fund PMs live inside this.

**What we build:**

A full-screen morning briefing that auto-generates when you log in before market open, powered by the existing `SupervisorAgent` orchestrating the `research`, `technical`, `sentiment`, `risk`, and `portfolio` agents.

### Implementation Details

**Backend: `/api/brief/morning` endpoint**
- Runs overnight (cron at 6:30 AM ET) using the existing `run_daily_pipeline` infrastructure
- Calls `sentiment` agent: scan overnight news, futures moves, Asia/Europe session
- Calls `portfolio` agent: calculate overnight P&L impact, positions at risk from gap
- Calls `risk` agent: new risk alerts, VaR breaches, correlation shifts
- Calls `research` agent: surface today's economic calendar events with portfolio impact analysis
- Calls `technical` agent: overnight S/R breaks on watched symbols
- Output: structured JSON brief cached in Redis (already used for alerts)

**Frontend: Morning Brief overlay component**
- Full-screen card-based layout, one per section: "What Happened Overnight", "Your Portfolio Impact", "Today's Catalysts", "AI Recommendations"
- Each card is collapsible, skimmable in 30 seconds
- "Act on This" buttons next to each recommendation link directly to /trade with symbol pre-loaded
- Automatically shows on first login of the day; accessible anytime via Command Palette (Cmd+K > "Morning Brief")
- Dismiss animation inspired by Arc's space-switching: cards slide off horizontally

**iOS: Push notification at 7 AM ET**
- "Your morning brief is ready. SPY gapped +0.3%, 2 positions need attention."
- Deep-links to a native `MorningBriefView` using the same API

**Why this wins:** No competitor generates a *personalized* AI brief about *your specific portfolio* against overnight market moves. TradingView's AI Copilot (launched April 2026) only analyzes the chart you're looking at. Bloomberg's brief is generic news. This is *your* AI analyst preparing *your* daily game plan.

**Effort:** ~3-4 days. Most infrastructure exists (pipeline runner, agents, Redis, WebSocket).

---

## 2. AI Copilot Sidebar -- "Stay for Hours"

**The problem it solves:** The current AI chat is a small tab inside AnalysisPanel.tsx on the /trade page. It's single-symbol, no memory, no context about your portfolio. Users cannot ask portfolio-wide questions, cannot execute actions from chat, and cannot access it from Dashboard, Analytics, or Pipeline pages.

**What TradingView just launched:** AI Chart Copilot (April 2026) -- a Chrome extension sidebar that answers chart questions, manages alerts, pulls news, scans watchlists via natural language. 50M+ users. But it CANNOT generate Pine Script, run backtests, or connect to live trading.

**What we build -- and why ours is better:**

A persistent AI sidebar that follows you across all pages, connected to all 11 specialist agents, with the ability to *execute actions* (not just answer questions).

### Implementation Details

**Frontend: `<CopilotSidebar />` component**
- Slides in from the right edge (Arc-style), toggled via `Cmd+J` or a persistent tab on screen edge
- Renders on the DashboardLayout level (currently: TopBar, TickerTape, StatusStrip, CommandPalette, main content, footer -- add CopilotSidebar alongside CommandPalette)
- Context-aware: automatically passes current page, selected symbol, visible data as context to the agent
- Conversation memory: persist messages in `localStorage` keyed by session, send last 10 messages as context
- Action cards: when Claude suggests a trade, render an inline "Execute Trade" button that calls `placeOrder` API
- When Claude suggests an alert, render a "Create Alert" button that calls `createPriceAlert`
- When on /analytics, can ask "Why did I underperform this week?" and it calls the `portfolio` agent with date range
- Streaming responses via the existing `agents` WebSocket channel (already wired in `useWebSocket.ts`)

**Backend: Enhance `/api/agents/chat` endpoint**
- Add `page_context` parameter: "dashboard" | "trade" | "analytics" | "pipeline" | "alerts" | "reports"
- Add `portfolio_summary` parameter: current positions, P&L, risk metrics (auto-populated by frontend)
- The `SupervisorAgent` already decomposes requests and routes to sub-agents -- this just needs richer context
- Add conversation history support: accept `history` array of prior messages

**Example interactions that differentiate us from TradingView:**
- "Show me my worst-performing position and suggest a hedge" (portfolio + risk + options agents)
- "Run a backtest on AAPL with the momentum quality strategy" (research agent + backtest API)
- "Set alerts on all my positions at their 20-day lows" (portfolio agent + alerts API -- batch action)
- "What's the pipeline recommending today and do I agree?" (pipeline API + strategy agent)

**UX polish (Robinhood/Linear inspiration):**
- Typing indicator with three animated dots, not a spinner
- Messages animate in with a subtle slide-up + fade (CSS `@keyframes`, not a library)
- Suggestion chips below the input: "Analyze AAPL", "Portfolio risk check", "What did pipeline find?"
- Claude's avatar: a subtle pulsing ring animation when "thinking"

**Effort:** ~4-5 days. The agent infrastructure, WebSocket, and API are all built. This is primarily frontend.

---

## 3. Trade Journal with AI Post-Trade Analysis -- "Tell a Friend"

**The problem it solves:** AlphaDesk tracks trades and P&L but does not help traders *learn* from their trades. The trade log exists (`/api/portfolio/trades`) but there is no journaling, tagging, screenshot annotation, or pattern recognition. Bloomberg's PORT function shows attribution but not *behavioral* analysis.

**What makes this a "wow" feature:** After each trade closes, Claude automatically writes a post-mortem analyzing what went right or wrong, compares the trade to the strategy's historical patterns, and identifies behavioral biases. No competitor does this.

### Implementation Details

**Backend: New `TradeJournal` model + endpoints**

```
POST   /api/journal/entries          -- create/auto-create entry
GET    /api/journal/entries          -- list with filters (date, symbol, strategy, outcome)
GET    /api/journal/entries/{id}     -- single entry with AI analysis
POST   /api/journal/entries/{id}/ai  -- trigger AI analysis for existing entry
GET    /api/journal/insights         -- aggregated behavioral patterns
```

**Data model (extend `data/storage/models.py`):**
- `trade_id` (FK to existing trades)
- `symbol`, `strategy`, `entry_price`, `exit_price`, `pnl`, `pnl_pct`
- `user_notes` (free text)
- `tags` (array: "earnings play", "momentum", "revenge trade", "FOMO", etc.)
- `setup_screenshot` (optional URL -- chart screenshot at entry)
- `ai_analysis` (JSON from Claude)
- `ai_patterns` (JSON: detected behavioral patterns)
- `created_at`, `updated_at`

**AI Analysis (uses existing `portfolio` + `technical` + `strategy` agents):**
- "Entry timing: You entered 2 days before the RSI crossed 30. Historically, waiting for the cross improves your win rate by 12%."
- "Sizing: This position was 8% of portfolio, above your typical 5% max. Larger positions have a 0.3 lower Sharpe in your history."
- "Hold duration: You held 3 days. Your average winner in momentum strategies is held 7 days. You may be cutting winners short."
- "Emotional pattern: This trade was opened 14 minutes after a losing trade closed. Trades opened within 30 minutes of a loss have a 38% win rate vs your 54% average."

**Frontend: `/journal` page + Journal sidebar on Trade page**
- Calendar view (reuse `PnlCalendar` component) showing journal entries by date
- Each entry card: symbol, P&L, strategy tag, one-line AI summary, user notes
- Detail view: full AI analysis with expandable sections
- "Insights" tab: aggregated patterns over time ("Your best day of the week is Tuesday", "You perform worst after 3+ consecutive wins")
- Tag filter sidebar with preset behavioral tags

**iOS: Trade detail view enhancement**
- Add "Journal" tab to `SymbolDetailView` 
- Push notification after trade closes: "Your AAPL trade closed +$340. Tap to journal it."

**Why this is the "tell a friend" feature:** Traders are obsessed with improving. When they see "Your revenge trades lose 62% of the time" backed by their own data, they screenshot it and send it to their trading group. It's inherently shareable, personal, and actionable.

**Effort:** ~5-6 days. New page + new API endpoints, but AI analysis uses existing agent infrastructure.

---

## 4. Workspace Layouts with Command-K Superpowers -- "Premium Feel"

**The problem it solves:** The app uses a fixed single-page layout per route. A PM cannot arrange their own dashboard. The Command Palette (Cmd+K) exists but only navigates pages and searches symbols -- it cannot execute actions, toggle components, or control the workspace.

**What Arc innovated:** Spaces -- distinct environments with their own visual identity and content, switched instantly. The Command Bar replaced the omnibox with a universal action launcher.

**What Linear perfected:** LCH color space theming, mathematically precise contrast, Inter Display headings, and a sense that every pixel was considered.

### Implementation Details

**A. Workspace Layouts (Arc Spaces for trading)**

Extend the existing `LayoutSelector` component (currently only controls chart grid on /trade) to a full workspace system.

**Frontend: `WorkspaceManager` component + store**
- `useWorkspaceStore` (new Zustand store):
  - `workspaces`: array of named workspace configs
  - Each workspace: `{ id, name, icon, accentColor, layout: { dashboard: Widget[], trade: Widget[], analytics: Widget[] } }`
  - Preset workspaces: "Morning Research", "Active Trading", "Risk Monitoring", "End of Day Review"
  - Custom workspaces: user can save current layout as a named workspace
- Workspace switcher in TopBar (pill-shaped tabs, Arc-style, with accent color dot)
- Switch animation: crossfade with subtle scale (0.98 -> 1.0), 200ms ease-out
- Keyboard: `Cmd+1` through `Cmd+4` for workspace switching

**Dashboard widget system:**
- Each existing dashboard component (PortfolioHero, StrategyGrid, RiskDashboard, MarketBreadth, etc.) becomes a draggable widget
- Widget grid: CSS Grid with `gridTemplateAreas`, user-configurable via drag handles
- "Add Widget" button opens a picker with previews
- Persist layout in `localStorage` + sync to backend via preferences API

**B. Command Palette superpowers**

Extend the existing `CommandPalette.tsx` (currently: page navigation, symbol search, strategy links, recent actions) with action execution.

**New command categories:**
- **Actions:** "Create alert for AAPL at $200", "Run pipeline now", "Export portfolio report"
- **Toggles:** "Show/hide ticker tape", "Toggle risk dashboard", "Switch to dark/light mode"
- **AI:** "Ask Claude about AAPL", "Get morning brief", "Analyze my worst position"
- **Workspace:** "Switch to Active Trading", "Save current layout", "Reset to default"

**Implementation:** Add `executeAction(actionId, params)` function that maps command IDs to store mutations and API calls. The existing `PAGES`, `POPULAR_SYMBOLS`, and `RECENT_ACTIONS` arrays in CommandPalette.tsx become one unified action registry.

**C. Visual polish (Linear-grade refinements)**

- **Color system upgrade:** Switch from HSL to LCH/OKLCH color space for perceptually uniform theming
- **Typography:** Add a display font weight for headings (H1/H2 in dashboard cards)
- **Micro-animations (Robinhood-inspired):**
  - Price changes: AnimatedNumber component already exists -- add a green/red flash background on change
  - Tab switches: content crossfade (currently instant, add 150ms transition)
  - Card hover: subtle lift (translateY -1px) + shadow increase
  - Button press: scale(0.97) on :active
  - Loading states: skeleton shimmer instead of spinner where applicable

**Effort:** ~5-6 days. Workspaces are the most complex part; command palette extensions and visual polish are 1-2 days each.

---

## 5. Live Signal Feed with Pipeline Transparency -- "Trading Edge"

**The problem it solves:** The pipeline runs daily and produces trade recommendations, but users only see the final output on the /pipeline page. There is no real-time feed of *what the AI is thinking*, no way to see signals as they develop throughout the day, and no transparency into why a trade was recommended or rejected.

**What Bloomberg provides:** MOST function (real-time most active), liquidity assessment, and AIM (asset/investment management) with real-time position management. Portfolio managers see the full decision chain.

**What TradingView provides:** Ideas stream -- a real-time social feed of trade ideas with charts, rationale, and community engagement.

### Implementation Details

**Backend: Real-time signal streaming**

**New endpoint: `/api/signals/stream` (WebSocket channel: "signals")**
- During pipeline runs, emit intermediate signals as they are generated:
  - `screener_hit`: "NVDA passed momentum+quality screen (score: 87/100)"
  - `analysis_started`: "Running technical analysis on NVDA..."
  - `analysis_complete`: "NVDA: Bullish -- RSI 42 rising, MACD cross, above 50 EMA"
  - `trade_proposed`: "Proposing: Buy NVDA 120C 30DTE, risk/reward 2.8:1"
  - `master_review`: "Master agent reviewing NVDA proposal..."
  - `trade_approved` / `trade_rejected`: "NVDA approved -- correlation to existing TECH positions acceptable"
  - `order_placed`: "Market order submitted: NVDA 120C x5"
- Store signals in a rolling Redis list (keep last 200)
- Each signal has: `timestamp`, `type`, `symbol`, `strategy`, `detail`, `confidence`, `severity`

**New endpoint: `/api/signals/intraday`**
- Runs lightweight scans every 30 minutes during market hours using the `screener` + `technical` agents
- Surfaces: unusual volume spikes, S/R breaks on watchlist symbols, options flow anomalies, earnings movers
- Much lighter than full pipeline -- focuses on alerting, not trade execution
- Configurable: user selects which signal types they want

**Frontend: `<SignalFeed />` component**
- Vertical timeline layout, newest at top, auto-scrolling
- Each signal card: icon (by type), symbol chip, one-line summary, timestamp, confidence badge
- Click to expand: full analysis detail, chart mini-preview, "Trade This" button
- Filter bar: by strategy, by symbol, by signal type, by confidence threshold
- Pipeline transparency mode: toggle "Show AI reasoning" to see the full agent chain for each decision
- Renders on Dashboard page (replaces or augments ActivityFeed) and as a collapsible panel on /trade

**iOS: Signal notifications**
- Push for high-confidence signals (> 80%) on watchlist symbols
- `SignalFeedView` in the Pipeline tab with grouped-by-time sections
- Haptic feedback on new signal arrival (using existing haptic infrastructure)

**Why this provides real edge:** This turns AlphaDesk from a tool you check into a platform that *tells you* when something matters. The pipeline transparency ("here's why the AI thinks this") builds trust and education simultaneously. No other platform shows you the AI's reasoning chain for trade recommendations.

**Effort:** ~4-5 days. Pipeline infrastructure exists; this adds streaming output and an intraday light scan.

---

## Priority Ranking

| Rank | Feature | Impact | Effort | Why This Order |
|------|---------|--------|--------|----------------|
| 1 | AI Morning Brief | Opens app first | 3-4 days | Highest habit-forming potential, lowest effort |
| 2 | AI Copilot Sidebar | Keeps users for hours | 4-5 days | Leverages entire agent stack, most visible upgrade |
| 3 | Live Signal Feed | Provides trading edge | 4-5 days | Makes pipeline value visible in real-time |
| 4 | Trade Journal + AI Analysis | "Tell a friend" moment | 5-6 days | Unique differentiator, shareability |
| 5 | Workspace Layouts + Polish | Premium feel | 5-6 days | Important but less urgent than AI features |

---

## The "One Feature" Wow Moment

If forced to pick one: **the AI Copilot Sidebar (#2)**. When a user presses `Cmd+J` and says "What should I do about my TSLA position that's down 12%?" and Claude responds in 3 seconds with a specific hedge recommendation, calculates the cost, and offers a "Place This Hedge" button -- that is the moment they realize this is not another trading terminal. That is the moment they tell a friend.

The infrastructure is already 80% built. The supervisor agent, 11 specialist agents, WebSocket streaming, and the chat API all exist. This is primarily a frontend architecture change: lift the chat from a tab in AnalysisPanel to a first-class sidebar in the DashboardLayout.

---

## Competitor Feature Gap Matrix

| Feature | Bloomberg | TradingView | Robinhood | AlphaDesk (now) | AlphaDesk (proposed) |
|---------|-----------|-------------|-----------|-----------------|---------------------|
| Personalized AI morning brief | No (generic) | No | No | No | YES |
| AI copilot with trade execution | No | Partial (no execution) | No | Partial (one tab) | YES |
| AI trade journal analysis | No | No | No | No | YES |
| Custom workspace layouts | Yes | Partial | No | No | YES |
| Live signal feed with reasoning | No | Ideas (human-only) | No | Pipeline (batch) | YES |
| Conversational portfolio analysis | No | No | No | No | YES |

Every proposed feature targets a cell where all major competitors show "No". That is where AlphaDesk wins.
