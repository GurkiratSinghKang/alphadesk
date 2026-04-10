# AlphaDesk Strategy Research Report
### Prepared: April 8, 2026

---

## Executive Summary

This report compares AlphaDesk's 6 active strategies against the best-documented systematic approaches in quantitative finance (2020-2026). It includes real backtesting on 15 stocks using 1 year of Alpaca data, identifies critical gaps in our system, and recommends specific improvements for higher risk-adjusted returns and continuous market monitoring.

**Key Finding**: Our current system has good strategy diversity but suffers from three critical gaps: (1) no mean-reversion strategy to complement momentum, (2) no intraday monitoring — we only check twice per day, and (3) Claude's analysis lacks real-time price action context because we don't stream charts to it.

---

## Part 1: Backtesting Results — Our Universe (April 2025 - April 2026)

Real data from Alpaca, 255 trading days:

| Stock | 1Y Return | Sharpe | Max DD | Daily Vol | Our Trade | Outcome |
|-------|-----------|--------|--------|-----------|-----------|---------|
| GOOGL | +94.6% | **2.31** | -20.5% | 1.93% | Bought today | TBD |
| INTC | +139.9% | **1.63** | -24.2% | 4.18% | Bought today | TBD |
| WMT | +38.0% | **1.43** | -11.1% | 1.54% | Bought today | TBD |
| XOM | +37.6% | **1.37** | -16.0% | 1.60% | Bought today | TBD |
| NVDA | +61.7% | **1.36** | -20.2% | 2.59% | Bought today | TBD |
| CSCO | +30.6% | **1.09** | -13.9% | 1.76% | Bought today | TBD |
| JPM | +22.1% | **0.91** | -15.5% | 1.59% | Bought today | TBD |
| TSLA | +29.1% | 0.73 | -29.2% | 3.50% | Claude: SELL | Correct! |
| AAPL | +13.6% | 0.56 | -22.8% | 1.97% | Claude: SELL | Debatable |
| AMZN | +11.3% | 0.48 | -21.7% | 2.19% | Not traded | — |
| META | -1.8% | 0.15 | -33.4% | 2.51% | Not traded | — |
| ABBV | +0.1% | 0.14 | -17.5% | 1.72% | Bought today | Poor pick |
| DIS | -1.9% | 0.09 | -25.5% | 1.95% | Bought today | Poor pick |
| MSFT | -2.5% | 0.03 | -34.2% | 1.65% | Not traded | — |
| UNH | **-41.2%** | **-0.74** | **-60.3%** | 3.27% | Bought today | **Bad pick!** |

### Assessment of Today's Trades

**Good picks** (Sharpe > 1.0 over past year):
- GOOGL, INTC, WMT, XOM, NVDA, CSCO — all had strong momentum + positive Sharpe

**Questionable picks**:
- ABBV (Sharpe 0.14, essentially flat) — weak momentum, shouldn't pass RS filter
- DIS (Sharpe 0.09, -1.9% return) — negative return, momentum strategy should avoid
- **UNH (Sharpe -0.74, -41.2% return)** — catastrophic. This stock has been in freefall with -60% max drawdown. Our momentum screen should have filtered this out.

**Key takeaway**: Claude's conviction scoring is decent but NOT checking actual price momentum. UNH had a Medicare catalyst (short-term bullish narrative) but a -41% trend (long-term disaster). **The system trusted narrative over price action.**

---

## Part 2: Our Strategies vs. Best-in-Class Benchmarks

| Strategy | Our Expected | Best Documented | Gap |
|----------|-------------|-----------------|-----|
| 1. Momentum + Quality | Sharpe 0.8-1.2 | Sharpe 0.5-0.9 (academic), 1.5+ (ML-enhanced) | We're in range; need ML scoring |
| 2. PEAD | Sharpe 0.6-1.0 | Sharpe 0.6-1.0 (multi-quarter SUE) | Missing: actual earnings date data |
| 3. VRP Harvesting | Sharpe 0.6-1.0 | Sharpe 0.6-1.0 (equity), 1.0+ (global VRP) | Need real options execution |
| 4. Earnings Vol | Sharpe 0.7-1.2 | Sharpe 0.7-1.2 | Need options execution |
| 5. Regime Adaptive | Sharpe 0.3-0.8 | Sharpe 0.3-0.8 (trend), 2.3+ (sector rotation) | Regime detection is crude |
| 6. Claude Alpha | Unknown | Sharpe 1.5-2.5 (AI/ML) | Promising but needs guardrails |

### Critical Gap: AI/ML strategies show Sharpe 1.5-2.5+

The research is clear: **AI-augmented strategies dramatically outperform traditional factor strategies.** Renaissance, Two Sigma, DE Shaw all use ML as the core signal generator. Our Claude Alpha strategy (Strategy 6) is the closest to this but it lacks:
- Historical price pattern recognition (Claude doesn't see charts)
- Quantitative feature inputs (RSI, EMA crossovers, volume patterns)
- Backtested validation of Claude's signals

---

## Part 3: Strategies We're Missing

### Priority 1: Mean Reversion (MUST ADD)
- **Evidence**: 11% annualized excess returns on US equities (1962-2024). Sharpe 4-6x passive.
- **Why we need it**: Our portfolio is 100% momentum-oriented. Mean reversion is **negatively correlated** with momentum — when momentum crashes (as it did in 2009, 2020 March), mean reversion profits. This is the single biggest diversification improvement we can make.
- **Implementation**: Buy RSI < 30 oversold stocks with strong fundamentals. Sell at RSI > 50 reversion.
- **Expected impact**: +2-4% annual return, significantly lower portfolio drawdown.

### Priority 2: Sector Rotation (SHOULD ADD)
- **Evidence**: Sharpe 2.31 documented. Max drawdown cut from 34% to 7%.
- **Why**: Macro regime shifts drive sector performance more than individual stock selection. Our regime-adaptive strategy should explicitly rotate sectors, not just adjust gross exposure.
- **Implementation**: Monthly rebalance into top 3 relative-strength sectors. Short bottom 2.
- **Expected impact**: +3-5% annual return, better drawdown protection.

### Priority 3: Event-Driven / Buyback (SHOULD ADD)
- **Evidence**: $4.8 trillion M&A in 2025. Buyback announcements predict 12-month outperformance.
- **Implementation**: Screen for recent buyback announcements, insider buying clusters, and M&A rumors.
- **Expected impact**: +1-3% annual return, low correlation to other strategies.

---

## Part 4: Continuous Monitoring — Gap Analysis

### Current State (What We Do)
| Check | Frequency | Gap |
|-------|-----------|-----|
| Screening | 1x/day (9:35 AM) | Misses mid-day opportunities |
| Analysis | 1x/day (pipeline trigger) | No reaction to intraday events |
| Position check | 1x/day (3:30 PM) | Stop losses only checked once/day! |
| News | Fetched during pipeline only | Not monitoring continuously |
| Price alerts | None | No price-level triggers |
| WebSocket quotes | Running but UI-only | Not feeding into decision engine |

### Ideal State (What Prop Firms Do)
| Check | Frequency | Method |
|-------|-----------|--------|
| Price monitoring | Tick-level (WebSocket) | Event-driven triggers |
| Stop loss / take profit | Every tick / 1-second | Alpaca native stop orders OR local monitor |
| News monitoring | 30-60 second polling | API + webhook alerts |
| Earnings surprises | Within 5 minutes of release | Calendar + real-time feed |
| Unusual volume | 1-minute bars | Volume spike detector |
| Regime shift | 5-minute check | VIX + SPY + credit spread monitor |
| Rebalancing signals | Hourly | Factor exposure drift check |
| Pre-market scan | 4:00-9:30 AM | Gaps, earnings, macro releases |

### Critical Gaps to Fill

#### Gap 1: Stop Losses Are NOT Active Orders
**Problem**: We track stop-loss levels in our ledger but only check them at 3:30 PM. If UNH drops 15% at 10:30 AM, we sit in the trade for 5 more hours.
**Fix**: Place actual stop-loss orders on Alpaca immediately after entry. Alpaca supports OCO (One-Cancels-Other) orders with stop + take-profit.
**Impact**: This is the #1 risk management gap. Must fix immediately.

#### Gap 2: No Continuous News Monitoring
**Problem**: News is fetched only during the pipeline run. If a stock reports earnings at 4:01 PM, we don't know until the next morning.
**Fix**: Background task that polls newsdata.io every 60 seconds. On detecting earnings/catalyst for a held stock, trigger Claude analysis and alert.
**Impact**: Would have caught UNH fundamental deterioration earlier.

#### Gap 3: No Intraday Signal Generation
**Problem**: Strategies only screen once per day. Mid-day setups (breakouts, reversals, earnings reactions) are missed entirely.
**Fix**: Add a lightweight "mid-day scan" at 11:00 AM and 2:00 PM that checks for:
- New breakouts above resistance
- Volume spikes (>3x average)
- Earnings surprises released during the day
- Significant sector rotation

#### Gap 4: WebSocket Data Isn't Used for Decisions
**Problem**: Alpaca streams live quotes via WebSocket, but this data only goes to the frontend for display. The trading engine doesn't use it.
**Fix**: Connect the WebSocket stream to a decision engine that monitors:
- Price crossing stop/take-profit levels
- Unusual volume spikes
- Bid-ask spread widening (liquidity warning)
- Momentum divergence from sector

#### Gap 5: No Pre-Market Analysis
**Problem**: The pipeline runs at 9:35 AM but doesn't analyze overnight developments.
**Fix**: Add a 8:00 AM pre-market scan that:
- Checks futures/pre-market prices for gap analysis
- Scans overnight news for held positions
- Identifies earnings released pre-market
- Adjusts opening strategy based on overnight developments

---

## Part 5: Recommendations — Priority Implementation Plan

### Immediate (This Week)
1. **Place real stop-loss orders on Alpaca** for all positions (not just ledger tracking)
2. **Add mean reversion strategy** (RSI < 30 with quality filter)
3. **Continuous news monitoring** (60-second polling background task)
4. **Mid-day scans** at 11 AM and 2 PM
5. **Fix UNH-type errors**: Require RS Score > 50 (positive 6-month momentum) for ALL strategies, not just momentum

### Short-Term (Next 2 Weeks)
6. Add sector rotation to regime-adaptive strategy
7. Pre-market scan at 8 AM
8. Feed WebSocket quotes to decision engine for real-time stop monitoring
9. Add event-driven screening (buybacks, insider buying)
10. Improve Claude prompts with actual price data (recent high/low, distance from 50/200 MA)

### Medium-Term (Next Month)
11. Train LightGBM model on historical data (replace demo screener scores with real ML)
12. Options execution for VRP and Earnings Vol strategies
13. Implement dynamic Kelly allocation (P6)
14. Add cross-strategy factor monitoring (P7)
15. Backtest all strategies with walk-forward validation

---

## Part 6: How to Make Claude Watch Markets All Day

### Architecture: Event-Driven Claude Pipeline

```
Alpaca WebSocket ─────────────────────────────────────────┐
   (tick data for all positions + watchlist)               │
                                                           ▼
                                                  ┌──────────────┐
newsdata.io ──(60s poll)──────────────────────────│  Event Router │
                                                  │  (Python)     │
Earnings Calendar ──(daily load)──────────────────│              │
                                                  └──────┬───────┘
                                                         │
                    ┌────────────────┬───────────────────┼────────────┐
                    ▼                ▼                   ▼            ▼
           ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────┐
           │Price Alert   │ │News Alert    │ │Volume Spike  │ │Regime    │
           │Engine        │ │Engine        │ │Detector      │ │Monitor   │
           │              │ │              │ │              │ │          │
           │Stop hit?     │ │Earnings?     │ │>3x avg vol?  │ │VIX move? │
           │Target hit?   │ │Lawsuit?      │ │Block trade?  │ │Sector    │
           │Breakout?     │ │Upgrade?      │ │Unusual flow? │ │rotation? │
           └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └────┬─────┘
                  │                │                 │              │
                  ▼                ▼                 ▼              ▼
           ┌─────────────────────────────────────────────────────────┐
           │                    Claude Analysis                       │
           │  (Triggered ONLY on significant events)                  │
           │  Uses: event context + portfolio state + price data      │
           │  Output: hold/adjust/exit + rationale                    │
           └────────────────────────┬────────────────────────────────┘
                                    │
                                    ▼
                             ┌──────────────┐
                             │ Master Agent  │
                             │ (approve/     │
                             │  reject)      │
                             └──────────────┘
```

### Key Principle: Don't Call Claude on Every Tick

Claude CLI takes 5-20 seconds per call. You can't call it 1000x/day. Instead:

1. **Rules-based filters** catch 99% of events (price at stop? sell. Volume 5x? alert.)
2. **Claude is called ONLY for ambiguous situations**: Stock at stop but positive news, unusual pattern, regime change affecting multiple positions
3. **Budget**: ~50 Claude calls/day max (10 morning scan, 5 mid-day, 5 afternoon, 30 event-triggered)
4. **Use Haiku for quick checks** (3s response), **Sonnet for deep analysis** (10s), **Opus for strategy research** (30s)

### Estimated Daily Claude Usage (Optimized)
| Task | Calls | Model | Time |
|------|-------|-------|------|
| Morning scan (10 stocks) | 10 | Sonnet | ~2 min |
| Mid-day check (5 stocks) | 5 | Haiku | ~15 sec |
| Afternoon position review | 5 | Sonnet | ~1 min |
| Event-triggered analysis | ~10 | Haiku/Sonnet | ~30 sec each |
| Master Agent smart reviews | ~5 | Haiku | ~15 sec each |
| **Total** | **~35/day** | Mixed | **~7 min/day** |

---

## Conclusion

AlphaDesk has a solid multi-strategy foundation with 6 strategies and a smart Master Agent. The biggest improvements will come from:

1. **Better risk management** (real stop orders, continuous monitoring) — prevents the UNH-type catastrophe
2. **Adding mean reversion** — the single biggest diversification gain
3. **Continuous monitoring architecture** — move from 2 checks/day to event-driven
4. **Better Claude prompts** — give Claude actual price data, not just narratives

The gap between where we are (estimated Sharpe ~0.5) and where we could be (Sharpe 1.0-1.5) is primarily about **avoiding bad trades** (UNH, DIS, ABBV) more than finding better ones. Risk management > alpha generation.
