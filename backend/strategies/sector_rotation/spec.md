# Sector Rotation — GICS-sector momentum with bond-fallback risk-off

**Category:** Macro / tactical asset allocation (top-N monthly rotation across sectors)

**Primary references:**
- Stangl, J., Jacobsen, B., & Visaltanachoti, N. (2009). "Sector Rotation Across the Business Cycle." *Journal of Portfolio Management* 35(3), 117–134.
- Moskowitz, T., & Grinblatt, M. (1999). "Do Industries Explain Momentum?" *Journal of Finance* 54(4), 1249–1290.

**Secondary references:**
- Faber, M. T. (2013). *A Quantitative Approach to Tactical Asset Allocation.* (10-month moving-average / risk-off bond fallback.)
- O'Neil, W. J. (1988). *How to Make Money in Stocks.* (Industry leadership / relative strength.)

## 1. Why this strategy exists

Stangl-Jacobsen-Visaltanachoti (2009) and Moskowitz-Grinblatt (1999) document that **industry-level momentum** is a robust signal beyond stock-level momentum, with sectors persisting in their relative-strength ranking over 3–12 month horizons. The "sector rotation" trade combines two well-documented effects:

1. **Cross-sectional momentum at the sector level.** Top-quintile sectors over the past 6–12 months tend to outperform bottom-quintile sectors over the next 1–3 months, even after controlling for market-cap and style factors.
2. **Time-series momentum / risk-off.** Faber (2013) and many practitioners show that a simple bond-fallback rule (when broad-market trailing return < 0, hold bonds instead of equities) materially reduces drawdown without sacrificing CAGR over multi-decade samples.

The sector ETF universe (XLK, XLV, XLF, …) has the cleanest expression because membership is fixed, liquidity is deep, transaction costs are low, and rebalancing once a month is structurally cheap.

## 2. Rules (exact)

### Universe
The 11 GICS sector SPDR ETFs:

| Symbol | Sector | First listing |
|---|---|---|
| XLK | Technology | Dec 1998 |
| XLV | Health Care | Dec 1998 |
| XLF | Financials | Dec 1998 |
| XLY | Consumer Discretionary | Dec 1998 |
| XLP | Consumer Staples | Dec 1998 |
| XLE | Energy | Dec 1998 |
| XLI | Industrials | Dec 1998 |
| XLB | Materials | Dec 1998 |
| XLU | Utilities | Dec 1998 |
| XLRE | Real Estate | Oct 2015 (split out from Financials per GICS 2016) |
| XLC | Communication Services | Jun 2018 (created from Tech + Discretionary + Telecom) |

Backtests pre-2015 only see 9 sectors; the strategy is robust to this — it ranks whatever's available and falls back to bonds if `top_n` can't be filled.

### Signal

For each sector ETF on the rebalance day:

```
composite_score(sym) = short_weight × R_short(sym)
                     + (1 − short_weight) × R_long(sym)
```

Where:
- `R_short(sym)` = total return over `short_lookback_days` (default 126 ≈ 6 months)
- `R_long(sym)` = total return over `long_lookback_days` (default 252 ≈ 12 months)
- `short_weight` ∈ [0, 1] (default 0.5; equal-weight)

### Risk-off rule

If `risk_off_enabled` (default True):
- Compute SPY's trailing return over `risk_off_lookback_days` (default 126 ≈ 6 months).
- If SPY's return < 0 → hold 100% `bond_fallback` (default AGG).
- Otherwise → continue to ranking.

### Top-N selection

Among sectors with valid composite scores:
- Rank descending.
- Hold the top `top_n` (default 3) at equal weight (1 / top_n each).
- If fewer than `top_n` sectors have valid scores → hold 100% `bond_fallback`.

### Cadence

- Rebalance on the **last trading session of each calendar month** (NYSE-aware via `data.calendar.is_trading_day`).
- `rebalance_freq = "bimonthly"` halves the cadence (alternate months only).
- Between rebalance days: no-op.

### Execution

- Entries / exits use `OrderType.MOO` (market-on-open) at the next session's open.
- `time_in_force = DAY` — DAY-TIF orders that don't print expire and re-emerge on the next rebalance.
- `target_weight` is set per signal; the broker layer computes the share count from current NAV.

## 3. Why this implementation differs from the audit catalogue stub

The catalogue page (`frontend/src/lib/strategy-content.ts:399-432`) previously declared sector rotation a "planned concept, not an implemented backend strategy." This implementation delivers:

- A real backend package at `backend/strategies/sector_rotation/`.
- Registration via `@register_strategy` so the registry returns `kind="autonomous"` and the daily pipeline scheduler routes monthly EOM 3:55 PM rebalance signals through `MONTHLY_STRATEGIES`.
- A textbook composite-rank signal (no curve-fit), Faber-style risk-off, and equal-weight top-N entry.

## 4. Limitations & known caveats

- **No GICS-2016 fidelity pre-2015.** XLRE didn't exist as an ETF before Oct 2015; pre-Oct-2015 backtests only see 10 sectors (and pre-2018 only 10 sectors with XLC absent; pre-Oct-2015 only 9). This is acknowledged in the rules — the strategy ranks what's available and the audit JSON should mention the calendar implication.
- **Sector ETFs are gross-of-dividends total returns.** SPDRs reinvest distributions in NAV, so closing prices are total-return proxies. This is the intended behaviour for momentum ranking; if a future strategy needs cash-distribution tracking, use `adj_close` instead.
- **No minimum-AUM filter.** The 11 SPDRs are the most-liquid GICS sector ETFs by orders of magnitude; an explicit AUM filter is unnecessary at this universe.
- **Risk-off-via-SPY** is a rough regime detector. Combining with the existing `regime_adaptive` strategy as a portfolio overlay can deliver a deeper risk-off signal but is out of scope here.
- **No transaction-cost model beyond the engine's default slippage**. Sector ETFs are tight; default 1bps slippage approximates real fills well.

## 5. Performance expectations

Stangl-Jacobsen-Visaltanachoti (2009) report 1.5–3% annualized excess return for 6m+12m sector momentum baskets after costs. Faber's bond-fallback rule reduces max drawdown by ~30–50% in equity-bear regimes (1973–74, 2000–02, 2008, 2020-Q1).

A plausible forward Sharpe band for this strategy on the 2019–2024 OOS window is **0.4–0.8**. The 2023–24 sub-window was favourable to large-cap tech (XLK), so a backtest restricted to those 2 years will show inflated Sharpe; the realistic expectation comes from a 5+ year run that crosses regime boundaries.
