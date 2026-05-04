# Gap-Fill (overnight-gap mean reversion)

**Category:** Equity / intraday (long-only fade by default; long-and-short available)

**Primary references:**
- Branch, B., & Ma, A. (2012). "The Overnight Return, One More Anomaly." *Journal of Banking & Finance* 36(12), 3315–3324.
- Akbas, F., Boehmer, E., Jiang, D., & Koch, P. D. (2022). "Overnight Returns, Daytime Reversals, and Future Stock Returns." *Journal of Financial and Quantitative Analysis* 57(4).

**Secondary references:**
- Berkman, H., Koch, P. D., Tuttle, L., & Zhang, Y. J. (2012). "Paying Attention: Overnight Returns and the Hidden Cost of Buying at the Open."

## 1. Why this strategy exists

Branch-Ma (2012) and Akbas-Boehmer-Jiang-Koch (2022) document that overnight returns and daytime returns are partially mean-reverting on aggregate-equity samples: a stock that gaps up overnight tends to underperform during the regular session, and vice versa. The reversal is most pronounced on names with no material catalyst (the catalyst-driven gaps reflect new fundamental information and persist).

The strategy operationalizes this:
1. **Identify** non-catalyst overnight gaps in a curated large-cap universe (gap size in `[min_gap_pct, max_gap_pct]` — too small is microstructure noise, too large is catalyst).
2. **Filter** by earnings overlap (any name with earnings ±`earnings_skip_days` is skipped).
3. **Enter** the fade direction at `entry_after_minutes` past the open (default 5; lets the opening auction settle).
4. **Exit** all positions at `exit_at_minutes` past the open (default 90 = 11:00 ET) — gaps that haven't faded by mid-morning are usually catalyst-driven.

Default direction is `fade_down_only` (long the down-gaps) for safety: shorting up-gaps requires reliable borrow + carries the binary risk of a continuation rally; the long-only-on-down-gaps half captures most of the documented edge with cleaner microstructure.

## 2. Rules (exact)

### Universe

60-name liquid large-cap seed (`GAP_FILL_UNIVERSE_SEED` in `config.py`). All names have dense 1-min Alpaca bars and stable overnight-gap statistics. Includes index ETFs (SPY, QQQ, IWM, DIA) for additional capacity at scale.

### Signal

For each symbol:

```
gap_pct = (today_open - prev_close) / prev_close
```

- `today_open` = first 1-min bar's open at or after 09:30 ET (from `input.intraday_bars["1min"]`).
- `prev_close` = last daily close strictly before today (from `input.bars`).

A symbol is a candidate iff:
1. `min_gap_pct ≤ |gap_pct| ≤ max_gap_pct` (default `[1.0%, 4.0%]`)
2. Direction is allowed: `direction = "fade_both"` permits both signs; `"fade_down_only"` (default) only admits `gap_pct < 0`
3. No earnings within `earnings_skip_days` (default 2 sessions) — pre-earnings gaps are catalyst, not noise

### Selection + sizing

Survivors are ranked by `|gap_pct|` (largest fades first). Top `max_positions` (default 4) are entered. Per-name target weight = `target_weight_per_name` (default 5%) signed by fade direction.

### Exit

- **Time-stop**: at `exit_at_minutes` past 09:30 ET (default 90 = 11:00 ET), all gap-fill positions exit MKT. This fires every bar after the threshold passes — a position opened at 09:35 and not yet exited at 11:00 will exit on the first 11:00+ bar.
- **No price-based stops** — gap fades are short-duration and price-stops at this scale tend to fire on noise. The 90-minute time stop is the dominant risk control.

### Cadence

Schedule = `OPEN_PLUS_5M_STRATEGIES` (09:35 ET) in `pipeline_runner.py`. Per-bar exit checks run continuously while any gap-fill position is open; entry signals only fire once per session in the entry window (between `entry_after_minutes` and `exit_at_minutes`).

### Execution

`OrderType.MKT` for both entries and exits. Gap fades are short-duration — limit orders that don't fill compound the entry/exit risk asymmetry. DAY-TIF.

## 3. Catalyst classifier (v1 = simple)

The current implementation relies on:
- **Earnings overlap** (`earnings_skip_days` default 2)
- **Gap-size cap** (`max_gap_pct` default 4%) — large gaps are likely catalyst-driven

A future iteration should add:
- News-feed integration (FMP `/general_news` or Polygon news with sentiment scoring)
- Index-rebalance dates (S&P 500 / Russell additions/removals)
- M&A announcements
- FDA / clinical-trial release calendars

Until those land, the gap-size cap + earnings filter is the catalyst classifier.

## 4. What this implementation does NOT do

- **No premarket bar consumption** — the strategy uses the first 1-min bar of the regular session as `today_open`. Premarket gap-formation is information for the catalyst classifier (a name that's been gapped from 4 AM is more likely catalyst than one gapping at the bell), but isn't currently consumed.
- **No tick-level execution simulation** — the FillSimulator stops are still daily-bar approximations. Practical impact: 5-10 bp of slip vs a real intraday simulator, primarily on the time-stop exit. Documented limitation in `audit-reports/00-strategy-experts-consolidation.md` §3 (P1-U).
- **No regime gate** — Branch-Ma's anomaly is robust across regimes per the original sample, but a future iteration could gate on VIX or SPY 5-day return to suspend the strategy in extreme-volatility windows.
- **No size scaling by gap magnitude** — all positions are equal-weight at `target_weight_per_name`. Spec'd as a future tuning knob (gap-size-scaled sizing).

## 5. Performance expectations

Branch-Ma (2012) report 0.4-0.6 Sharpe for filtered overnight-gap fades on US large-caps over 1993-2010. Akbas-et-al (2022) refine the sample to 0.5-0.8 with cleaner catalyst classification. Realistic forward Sharpe band on the post-2015 era: **0.3-0.5** with the basic catalyst filter; higher with the proper news-feed integration. Strategy is `paper_only=True` until live intraday paper evidence demonstrates the realized Sharpe + drawdown profile is consistent with backtest.
