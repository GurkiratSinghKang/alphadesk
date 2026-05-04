# VCP Breakout — Volatility Contraction Pattern

**Category:** Equity / breakout (long-only weekly screen with intraday-extension hooks)

**Status:** `paper_only=True` until live intraday paper evidence graduates the strategy.

**Primary references:**
- Minervini, M. (2013). *Trade Like a Stock Market Wizard: Performance Strategies for Maximum Returns.* McGraw-Hill.
- Weinstein, S. (1988). *Secrets for Profiting in Bull and Bear Markets.* Dow Jones-Irwin.

**Secondary references:**
- Karpoff, J. M. (1987). "The Relation Between Price Changes and Trading Volume: A Survey." *JFQA* 22(1).
- Lo, A. W., & Wang, J. (2000). "Trading Volume: Definitions, Data Analysis, and Implications of Portfolio Theory." *Review of Financial Studies* 13(2).
- O'Neil, W. J. (1988). *How to Make Money in Stocks.* (Cup-with-handle ⊂ VCP family.)

## 1. Why this strategy exists

Mark Minervini's *Trade Like a Stock Market Wizard* (2013) systematizes a pattern where Stage-2 uptrend stocks consolidate in progressively tighter ranges on declining volume — the **Volatility Contraction Pattern** — before breaking out to new highs. The pattern is the technical-analysis cousin of an information-theoretic phenomenon: as a stock attracts patient holders during the consolidation, supply dries up; when demand returns (the breakout), the price moves with little overhead resistance.

Karpoff (1987) and Lo-Wang (2000) document the volume-price information relationship that underlies the rule: low volume + tight range = supply absorption; volume expansion at the breakout = demand confirmation. The combination is what distinguishes a real breakout from a noise spike.

## 2. Rules (exact)

### Universe
100-name growth-tilted seed (`VCP_UNIVERSE_SEED`) spanning Russell-1000 mega-cap growth, mid-cap growth, and select index ETFs. Production should swap to a Russell-1000-constituent loader.

### Stage-2 gate (Weinstein-Minervini)
- 200-day SMA must be **rising** for at least `stage2_min_sma200_rising_days` sessions (default 150 ≈ 30 weeks)
- Current price must be ≥ `stage2_min_above_52w_low` above the 52-week low (default 25%)
- Current price must be **above** the 200-day SMA

Names not satisfying all three are rejected.

### VCP base
The classical Minervini VCP has 3+ contractions of decreasing magnitude over an 8-15 week base. The **v0** uses a simplified 2-contraction proxy:

- The peak-to-trough range over the most recent `min_base_days` (default 40 ≈ 8 weeks) must be **strictly tighter** than the same window `min_base_days` ago (i.e., the trailing 80 days are split in half; the second half must be tighter than the first).
- The recent base's range as a fraction of last-close must be ≤ `final_base_max_range_pct` (default 10%).

The breakout pivot is the high of the most recent `min_base_days` window.

### Volume confirmation
On the breakout day:
- Today's close > pivot (breakout has occurred)
- Today's volume ≥ `breakout_volume_multiple` × the trailing 50-day average (default 1.5×; excludes today from the average to avoid self-reference)

Multiple candidates are ranked by `breakout_strength × volume_multiple` and the top `max_positions` (default 8) are selected.

### Liquidity floor
Per-name 90-day median dollar volume ≥ `min_adv_millions` (default $20M).

### Entry
- MOC entry on the breakout session at `target_weight_per_name` (default 5% of NAV)
- `time_in_force = DAY`

### Exit
Per-bar (every session, not just rebalance):

1. **Risk-stop**: close ≤ entry_price × (1 − `stop_pct_below_pivot`) (default 8% below entry; Minervini's classical 7-8% rule).
2. **Profit-take**: close ≥ entry_price × (1 + `profit_take_pct`) (default 20%).
3. **Time-stop**: held ≥ `max_holding_days` (default 60 trading sessions).

The first to fire wins; positions are closed MOC.

### Cadence
Rebalance day = Friday (per `_is_rebalance_day`). `rebalance_freq = "biweekly"` halves cadence. Per-bar exits run **every** session.

## 3. v1 follow-on (deferred)

- **Realtime-scanner integration**: extend `realtime_scanner.py` to detect intraday breakouts on the `vcp_pivot` setup type already enumerated there (see `realtime_scanner.py:197, 325`). The current v0 fires on daily-close confirmation, which has 1-day latency vs a real intraday detector.
- **Multi-leg contraction detector**: replace the simplified 2-contraction proxy with a full 3+ contraction detector that walks the price history and identifies discrete consolidation legs.
- **Cup-with-handle classifier**: identify the O'Neil cup-with-handle archetype as a distinct VCP variant with its own breakout rules.
- **Paper-to-live graduation**: collect 30-50 paper trades; verify Sharpe + drawdown match backtest before flipping `paper_only=False`.

## 4. What this implementation does NOT do

- **No tick-level intraday confirmation** — breakouts are detected at the close. A real breakout often sees 5-10% follow-through within minutes; the daily-close approach captures most of that but misses the early-fill edge.
- **No earnings-period skip** — VCP breakouts often coincide with earnings catalysts; v0 doesn't differentiate. A future iteration could add an earnings-context filter (different rules for "breakout on earnings" vs "breakout pre/post-earnings").
- **No partial position exits** — Minervini suggests selling 1/3 at +8%, 1/3 at +16%, etc. v0 uses a single 20% profit-take. Tunable via `profit_take_pct` but coarse.
- **No regime gate** — VCP works best in trending bull markets. A future iteration could gate on broad-market regime (e.g., SPY 200-SMA rising) to suspend the strategy in bear regimes where most breakouts fail.

## 5. Performance expectations

Minervini's track record (1994-2000) reports 200%+ annual returns; the population sample is N=1 and the era was structurally favourable (post-1990s tech bull market, low-cost retail trading nascent). Akademiker replicas (Greenblatt 2010, various Reddit/QuantConnect studies) put the realistic forward Sharpe band at **0.5-0.9** with strict pattern recognition and 1.0+ on the best-quality breakouts. Realistic v0 expectations on the simplified detector: **0.3-0.6** Sharpe, with significant regime-sensitivity (much better in bull markets, much worse in chop). Strategy is `paper_only=True` until the live record validates these bands.
