# AlphaDesk — Claude-Powered Autonomous Trading Platform

## Overview

AlphaDesk is a multi-strategy automated trading platform that combines ML-driven stock screening, AI-powered analysis (via Claude), and systematic execution through the Alpaca brokerage API. It operates as a local-first application with a professional trading terminal UI.

**Current Status**: Paper trading with $100K on Alpaca. 6 strategies active. Multi-strategy pipeline with Master Agent coordination.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16)                     │
│  Dashboard | Trade Terminal | Pipeline Monitor               │
│  Lightweight Charts v5 | Real-time WebSocket                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Backend (FastAPI)                           │
│  51 API endpoints | WebSocket streaming | Celery tasks       │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              Multi-Strategy Trading Pipeline                  │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Master Agent (Coordinator)               │    │
│  │  Risk budgets | Position limits | Factor monitoring   │    │
│  │  Duplicate prevention | Regime-conditional sizing     │    │
│  └────────┬────────┬────────┬────────┬────────┬────────┘    │
│           │        │        │        │        │              │
│  ┌────────▼─┐ ┌───▼────┐ ┌▼──────┐ ┌▼─────┐ ┌▼──────────┐ │
│  │Momentum │ │ PEAD   │ │ VRP   │ │Earn. │ │Regime     │ │
│  │+Quality │ │        │ │Harvest│ │ Vol  │ │Adaptive   │ │
│  └──────────┘ └────────┘ └───────┘ └──────┘ └───────────┘ │
│                    ┌──────────┐                              │
│                    │Claude    │                              │
│                    │Alpha     │                              │
│                    └──────────┘                              │
└─────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    Data Sources                               │
│  Alpaca (broker + market data) | Polygon.io (options)        │
│  newsdata.io (news) | Claude CLI (AI analysis)               │
│  TimescaleDB | Redis | Docker                                │
└─────────────────────────────────────────────────────────────┘
```

---

## Strategies

### Strategy 1: Cross-Sectional Momentum + Quality
- **Signal**: RS Score > 70th percentile AND Piotroski F-Score >= 6
- **Holding period**: 5-20 trading days (swing)
- **Entry**: Breakout above 20-day EMA on above-average volume
- **Exit**: Stop-loss at -5%, take-profit at +12%, trailing stop after +8%
- **Allocation**: 20% of risk budget
- **Evidence**: Jegadeesh & Titman (1993): 8-12% annual from top-decile momentum. Quality is the most robust, least crowded factor (MSCI 2024).
- **Current status**: Active, screening 8-15 candidates daily

### Strategy 2: Post-Earnings Announcement Drift (PEAD)
- **Signal**: Earnings surprise > 2 standard deviations, stocks that moved > 3% on earnings
- **Holding period**: 20-60 trading days (drift capture)
- **Entry**: Day 1-2 post-earnings in direction of surprise
- **Exit**: Time-based exit at 60 days or momentum exhaustion
- **Allocation**: 10% of risk budget
- **Evidence**: Multi-quarter SUE nearly doubles Sharpe vs single-quarter (2024 study). Text-based surprise = 3.9bp daily alpha.
- **Current status**: Active, proxy screening via big movers

### Strategy 3: Systematic VRP Harvesting
- **Signal**: IV Rank > 40, IV/HV ratio > 1.2
- **Target**: Premium selling on high-IV names (equity proxy for now, options later)
- **Holding period**: 30-45 DTE for options; 5-10 days for equity proxy
- **Exit**: 50% of max profit target, or 2x credit stop-loss
- **Allocation**: 25% of risk budget
- **Evidence**: VRP averages 4.2% on SPX, positive 83% of months (AQR 2018). Dual IV filter yields 56.8% win rate on iron condors.
- **Current status**: Active, screening high-IV stocks. Future: options structures.

### Strategy 4: Earnings Volatility Premium
- **Signal**: IV Rank > 50, upcoming earnings within 5 days
- **Target**: Capture IV crush post-earnings
- **Holding period**: 1-3 days (over earnings event)
- **Exit**: Close morning after earnings
- **Allocation**: 10% of risk budget
- **Evidence**: Options consistently overprice earnings moves. Systematic straddle selling profitable on select names with historical analysis.
- **Current status**: Active, proxy screening. Future: iron condors pre-earnings.

### Strategy 5: HMM Regime-Adaptive Allocation
- **Signal**: Hidden Markov Model regime state (bull/bear/sideways)
- **Action**: Adjusts overall portfolio allocation and strategy weights
- **Implementation**: 
  - Bull regime: Full allocation, favor momentum + offensive
  - Neutral: Heavy premium selling, balanced
  - Bear: Reduce to 30%, defensive only, add backspreads
- **Allocation**: 15% of risk budget (direct trades) + overlay on all strategies
- **Evidence**: Man Group 2024: regime awareness nearly triples risk-adjusted returns.
- **Current status**: Active, using VIX + market structure as regime proxy

### Strategy 6: Claude Alpha (AI Opportunistic)
- **Signal**: Claude CLI analysis with news context, conviction > 60
- **Method**: Screen top 20 by composite score, analyze each with Claude incorporating latest news
- **Holding period**: Variable (Claude determines based on setup)
- **Exit**: Stop-loss and take-profit levels set by Claude per trade
- **Allocation**: 20% of risk budget
- **Evidence**: Novel approach — AI-driven discretionary trading augmented with systematic screening
- **Current status**: Active, placed 9 trades on first run (INTC, CSCO, XOM, ABBV, NVDA, UNH, WMT, DIS, JPM)

---

## Optimizations

### Implemented

#### 1. Master Agent Coordination (v1 — April 8, 2026)
- Central gatekeeper for all trades across strategies
- Prevents duplicate positions (no two strategies can hold same stock)
- Enforces per-strategy allocation limits
- Portfolio-wide deployment cap (60%)
- Per-position size limit (5% of equity / $5K max)
- Minimum conviction threshold (60)
- All rejections logged with reasons

#### 2. Strategy-Specific Screening (v1 — April 8, 2026)
- Each strategy has its own `screen()` method with unique filters
- Momentum+Quality: RS > 70, F-Score >= 6
- PEAD: change_pct > 3% (big movers)
- VRP: IV Rank > 40
- Earnings Vol: IV Rank > 50
- Regime: Broad market ETFs + defensive pairs
- Claude Alpha: Top 20 by composite score

#### 3. News-Augmented Analysis (v1 — April 8, 2026)
- newsdata.io integration for real-time financial news
- Claude receives recent headlines as context for each analysis
- News sentiment considered in conviction scoring

#### 4. Portfolio-Wide Circuit Breaker (v1 — April 8, 2026)
- Halt all trading if daily P&L < -2%
- Paper-only URL enforcement
- Max 15 open positions, max 30 daily trades

### Planned Optimizations (Priority Order)

#### P1: Per-Strategy Stop Losses ✅ (April 8, 2026)
**Impact**: Prevents catastrophic strategy-level drawdown
**Implementation**:
- Track peak equity per strategy
- If strategy drawdown from peak > 5%: halt new trades, close 50% over 2 days
- Resume only when drawdown recovers to 3%
- Non-negotiable — this is the primary tail risk tool (Millennium model)

#### P2: Sector Concentration Limits ✅ (April 8, 2026)
**Impact**: Reduces correlation risk, prevents sector crowding
**Implementation**:
- Track sector exposure across all strategies in real-time
- Hard limit: no sector > 30% of portfolio
- When sector > 25%: require conviction > 70 for same-sector trades
- Factor in sector correlation (Tech/Communication overlap)

#### P3: Regime-Conditional Gross Exposure ✅ (April 8, 2026)
**Impact**: Biggest expected Sharpe improvement
**Implementation**:
- Use VIX + SPY trend + credit spread as regime indicators
- Bull + Low Vol (VIX < 18): Deploy up to 80%, favor growth/momentum
- Bull + High Vol (VIX 18-25): Deploy up to 60%, balanced
- Bear (VIX > 25): Deploy max 30%, defensive only
- Crisis (VIX > 35): Deploy max 10%, close most positions, tail hedges
- HMM model for formal regime detection (future)

#### P4: Risk Budgets (VaR-Based) ✅ (April 8, 2026)
**Impact**: Better capital efficiency — strategies sized by risk, not dollars
**Implementation**:
- Switch from capital allocation to VaR allocation
- Position VaR = Size × Daily Vol × 2.33 (99% confidence)
- Strategy VaR = Σ position VaRs (with correlation haircut)
- Total portfolio VaR capped at 2% of equity per day
- Low-vol strategies can deploy more notional for same risk

#### P5: Smart Master Agent (Claude-Powered) ✅ (April 8, 2026)
**Impact**: Better contextual decisions — holistic portfolio awareness
**Implementation**:
- Master Agent sends portfolio context to Claude before approving trades
- Prompt: "Given portfolio [positions, sector exposure, beta, regime], should we approve [trade]?"
- Claude evaluates: diversification benefit, regime fit, correlation structure
- Override rules-based decisions when Claude provides strong reasoning
- Fallback to rules-based if Claude unavailable

#### P6: Dynamic Kelly Allocation ⬜
**Impact**: Capital flows to winning strategies automatically
**Implementation**:
- Track rolling 20-day Sharpe per strategy
- Quarter-Kelly: Allocation_i = (1/4) × (Sharpe_i² / Σ Sharpe_j²) × Total_Capital
- Minimum floor: 5% per strategy (prevent starvation)
- Maximum cap: 35% per strategy (prevent concentration)
- Rebalance weekly (Monday pre-market)
- Cold-start: use equal risk parity until 20 days of data

#### P7: Cross-Strategy Factor Monitoring ⬜
**Impact**: Institutional-grade risk management
**Implementation**:
- Real-time portfolio factor decomposition:
  - Market beta (target: 0.3-0.8)
  - Sector exposure (no sector > 30%)
  - Momentum tilt (track crowding via RS distribution)
  - Size tilt (market cap weighted average)
  - Volatility exposure (net short/long vol)
- Alerts when any factor exceeds threshold
- Auto-hedge when beta > 1.2 (buy SPY puts or short futures)

---

## Performance Targets (Realistic)

Based on academic research and practitioner evidence:

| Metric | Target | World-Class |
|--------|--------|-------------|
| Annual Return | 10-15% | 15-20% |
| Sharpe Ratio | 0.8-1.2 | 1.5+ |
| Max Drawdown | < 15% | < 10% |
| Win Rate | 55-65% | 60-70% |
| Avg Trade Duration | 5-20 days | Varies |
| Daily Theta (options) | 0.1-0.2% of NAV | 0.15% |

**Reality check**: The Medallion Fund's Sharpe of ~2.0-2.5 represents the greatest track record in history with 275+ PhDs. A sustained Sharpe > 1.0 puts us in the top tier of retail quant traders.

---

## Data Sources

| Source | Type | Cost | Status |
|--------|------|------|--------|
| Alpaca | Broker + market data | Free (paper) | ✅ Connected |
| Polygon.io | Options chain + Greeks | $29-199/mo | ✅ Connected |
| newsdata.io | Financial news | Free tier | ✅ Connected |
| Claude CLI | AI analysis | Included in subscription | ✅ Connected |
| SEC EDGAR | Fundamentals (future) | Free | ⬜ Planned |
| Unusual Whales | Options flow (future) | $59-250/mo | ⬜ Planned |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TailwindCSS v4, Lightweight Charts v5, shadcn/ui |
| Backend | FastAPI, Python 3.12, Uvicorn |
| AI | Claude CLI (Sonnet), claude_agent_sdk (planned) |
| Database | TimescaleDB (time-series), PostgreSQL, Redis |
| Broker | Alpaca (paper), Interactive Brokers (future) |
| Infrastructure | Docker, Windows local-first |

---

## Changelog

### April 8, 2026 (Night) — Literature-Based Strategy Improvements
- **Strategy 8: VCP Breakout** added (Minervini SEPA — volatility contraction patterns, 3% stop, 10% target, 3.3:1 R/R)
- **Absolute momentum gate** (Antonacci Dual Momentum): blocks buys when 12-month return is negative
- **Low volatility factor tilt**: warns when portfolio lacks defensive positions
- **All fake numbers purged**: Dashboard, strategies, pipeline now show ONLY real Alpaca data
- **Dashboard shows 8 strategies** in 4x2 grid with color-coded performance borders
- **"No trades yet"** instead of misleading zeroes on empty strategies
- **Trade ledger cleaned**: removed fabricated demo exits, kept only real Alpaca trades

### April 8, 2026 (Late PM) — Strategy Optimization Based on Research
- **Structured Claude prompts**: 5-axis scoring (trend, momentum, volume, catalyst, risk/reward) — ~8% better directional accuracy per research
- **Volatility-targeted position sizing**: Positions sized inversely to daily volatility (risk parity)
- **Momentum crash protection**: Barroso & Santa-Clara scaling — halves exposure when momentum dispersion is elevated
- **Better exit timing**: Time-based exits (20 trading day max hold), trailing stops (move to breakeven at +5%)
- **Earnings calendar integration**: Day-of-week earnings schedule, PEAD screens both big movers AND upcoming earnings
- **Real strategy performance**: API now shows actual P&L from trade ledger alongside demo data
- **7 strategies now active** (added Mean Reversion)

### April 8, 2026 (PM) — Critical Risk Fixes + Continuous Monitoring
- **Real stop-loss orders**: Now placed on Alpaca immediately after every buy (GTC stop + limit take-profit)
- **Momentum filter**: All trades now require positive 6-month momentum (prevents UNH-type disasters)
- **Continuous news monitor**: Checks news every 60s for held positions, alerts on urgent keywords
- **Price proximity alerts**: Checks every 5 min if positions are near stop/target
- **Mid-day scans**: Automatic pipeline runs at 11:00 AM and 2:00 PM ET
- **Mean Reversion strategy (#7)**: Buys oversold quality stocks (RSI < 35, F-Score >= 5)
- **Strategy Research Report**: Full comparison against best-documented strategies with backtesting

### April 8, 2026 (AM) — Multi-Strategy Pipeline + Master Agent
- Refactored trading pipeline from single-strategy to 6-strategy system
- Built Master Agent coordinator with allocation limits, duplicate prevention
- Added Strategy 6: Claude Alpha (AI opportunistic)
- Added news integration (newsdata.io) into Claude analysis prompts
- First live pipeline run: screened 35 stocks, analyzed 35, placed 9 trades
- Multi-strategy run: 6 strategies, Master approved 2, rejected 6 (working correctly)
- Portfolio: $100,046 (+$46 day 1)

### April 7-8, 2026 — Full Platform Build
- Built complete frontend: Dashboard, Trade terminal, Pipeline monitor
- Connected Alpaca (live quotes, paper trading), Polygon (options), newsdata.io
- Claude CLI integration for AI analysis (no API costs)
- Automated daily pipeline: 9:35 AM screen+trade, 3:30 PM position check
- P&L calendar, risk dashboard, strategy cards
- 60+ bugs found and fixed across 6 QA iterations
- Docker: TimescaleDB + Redis running

### April 6, 2026 — Project Inception
- Master plan created from research documents
- Architecture designed: 12 Claude agents, 6 MCP servers, 5 strategies
- Tech stack selected: Next.js + FastAPI + Lightweight Charts

---

## Running the App

```bash
# Prerequisites: Docker Desktop, Node.js 22, Python 3.12 (conda)

# Start databases
cd D:\exp\alphadesk && docker compose up timescaledb redis -d

# Start backend
cd D:\exp\alphadesk\backend
D:\pinokio\bin\miniconda\envs\alphadesk\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001

# Start frontend (separate terminal)
cd D:\exp\alphadesk\frontend && npm run dev -- --port 3000

# Open in browser
# Dashboard: http://localhost:3000
# Trade:     http://localhost:3000/trade
# Pipeline:  http://localhost:3000/pipeline
# API Docs:  http://localhost:8001/docs
```

---

## API Keys (in backend/.env)

| Key | Required | Purpose |
|-----|----------|---------|
| ALPACA_API_KEY | Yes | Broker + market data |
| ALPACA_SECRET_KEY | Yes | Broker auth |
| POLYGON_API_KEY | Recommended | Options chain data |
| NEWSDATA_API_KEY | Optional | News headlines |
| ANTHROPIC_API_KEY | Optional | Direct API (Claude CLI is primary) |
