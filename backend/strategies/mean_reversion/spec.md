# Mean Reversion (slow / quality-conditioned)

**Category:** Equity / mean-reversion (long-only weekly reversal with quality gate)

**Primary references:**
- De Bondt, W., & Thaler, R. (1985). "Does the Stock Market Overreact?" *Journal of Finance* 40(3), 793–805.
- Jegadeesh, N. (1990). "Evidence of Predictable Behavior of Security Returns." *Journal of Finance* 45(3), 881–898.

**Secondary references:**
- Piotroski, J. D. (2000). "Value Investing: The Use of Historical Financial Statement Information to Separate Winners from Losers." *Journal of Accounting Research* 38, 1–41.
- Asness, C., Frazzini, A., Israel, R., & Moskowitz, T. (2015). "Fact, Fiction, and Value Investing." *Journal of Portfolio Management* 42(1).

## 1. Why this strategy is distinct from rsi2-reversal

`rsi2-reversal` is the textbook Connors RSI(2) book: 2–3 session mean reversion on names trading above their 200-day SMA. The signal works because daily noise is mean-reverting at very short horizons.

This strategy is a **slower, fundamentally aware** reversal book. It works at the 30-trading-day horizon — long enough that noise mean-reversion is already exhausted, and short enough that the strategy still benefits from the ~6-month overreaction documented by De Bondt-Thaler (1985) and Jegadeesh (1990). The slower horizon makes a quality gate essential: at this timescale, "price is below average" splits between (a) temporary dislocations of high-quality businesses (the alpha) and (b) early phases of secular decline (the value trap). The Piotroski F-score gate filters (b) before entry.

## 2. Rules (exact)

### Universe

Static seed of 60 liquid US large-caps spanning all 11 GICS sectors (`UNIVERSE_SEED` in `config.py`). The strategy applies an in-flight liquidity gate (`min_adv_millions` default 50M) at run time, so the effective universe is the seed minus illiquid names.

A future iteration should use `fundamentals_provider.sp500_constituents(asof)` (Plan B.2) for a survivorship-bias-free point-in-time universe; for v1 the static seed is the simpler floor.

### Signal

For each name on the rebalance day (default: Friday close):

```
z(sym) = (price - MA(60d)) / σ(60d)
```

Where σ is the standard deviation of the 60-day window (excluding the latest bar). A name is a candidate if `z(sym) ≤ -z_entry` (default `z_entry = 2.0`, so price ≥ 2σ below MA).

### Quality gate

Require `f_score(sym, asof) ≥ min_f_score` (default 5). The Piotroski F-score (0–9) integrates 9 fundamental signals across profitability, leverage/liquidity, and operating efficiency. Asness-Frazzini-Israel-Moskowitz (2015) show that the value+quality combination outperforms pure value, particularly in the left tail.

If `input.fundamentals` is `None` or has no `f_score` column, the gate is permissive — names pass. This matches the fallback convention in `momentum_quality.helpers.get_fscores`.

### Earnings skip

Skip names with scheduled earnings within `earnings_skip_days` trading sessions (default 7). Imminent earnings ride binary catalyst risk that the 30-day holding period can't capture.

### Selection + sizing

Rank surviving candidates by z-score (most-negative first). Take top `max_positions` (default 10). Size each at `target_weight_per_name` (default 5% of NAV). MOC entry (close-on-close).

### Exit

Two parallel exits, whichever fires first:

1. **MA cross**: when price closes ≥ the 60-day MA, exit MOC.
2. **Time stop**: after `holding_days` trading sessions (default 30), exit MOC.

Per-position exit checks fire **every bar**, not just rebalance bars — a name that crosses MA on a Tuesday gets exited Tuesday MOC, not held to the next Friday.

### Cadence

Rebalance day = Friday (per `_is_rebalance_day`). `rebalance_freq = "biweekly"` skips alternate weeks. Between rebalance days only the per-position exit checks fire.

### Execution

- All entries / exits use `OrderType.MOC` (market-on-close) with DAY-TIF.
- Per-name target_weight is set; the broker translates into a share count from current NAV.

## 3. What this implementation does NOT do

- **No Altman Z-score gate.** F-score covers profitability + leverage + efficiency. Adding Altman Z would be a useful additional value-trap filter; deferred to a follow-on so this v1 ships in scope.
- **No sector neutrality.** A regime where 1 sector dominates the candidate list will concentrate the book.
- **No news/sentiment filter on the dislocation.** A name that's down 2σ on a fundamental-news catalyst (earnings miss outside the 7-day skip, fraud, etc.) is treated the same as a name down 2σ on noise.
- **No short leg.** Long-only by spec — the symmetric short side has very different microstructure (borrow costs, recall risk) and is deferred.
- **No survivorship-bias-free universe.** Uses the 60-name static seed; a future PR should wire `sp500_constituents(asof)` from Plan B.2.

## 4. Performance expectations

The De Bondt-Thaler and Jegadeesh papers report 0.6–1.2 Sharpe for slow reversal at this horizon over multi-decade samples, before transaction costs and post-2000 decay. Avellaneda-Lee (2010) and Kakushadze (2015) document material decay in the post-2000 era; the realistic forward Sharpe band is probably **0.3–0.6** with the F-score quality gate active. The 5% per-name sizing × 10 positions caps the book at 50% deployed (rest cash); turnover is modest (weekly with 30-day holds = ~4 round-trips per name per year).
