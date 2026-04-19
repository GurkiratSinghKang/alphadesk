# Persona 22 — Swing Trader Audit

**Persona**: Multi-day/week holds, EOD bar accuracy, ATR stops, trailing logic, weekly rebalance.
**Scope**: `backend/strategies/{ts_momentum,kama_breakout,regime_adaptive}`, `backend/data/ingestion/daily_pipeline.py`, frontend chart, bar timing.

## Top 10 Findings

1. **RSI indicator is dead — declared, not wired.** `frontend/src/types/index.ts:212` lists `"RSI"` in the `Indicator` union, but `frontend/src/components/charts/TradingChart.tsx` has no `computeRSI`, no `indicators.includes("RSI")` branch, and no sub-panel. Selecting RSI renders nothing. Every swing trader expects RSI(14) on a daily chart — this is a headline regression.

2. **Trailing stop trips at +5% only — not ATR-based.** `daily_pipeline.py:781` moves stop to `entry * 1.01` only after price exceeds `entry * 1.05`. No ATR trail, no chandelier, no percent-of-gain retracement. Fixed 5% trigger punishes low-vol names (MSFT never triggers) and fires early on high-vol names (TSLA). Compare `kama_breakout/strategy.py:257` which correctly uses `highest_high − chandelier_atr_mult × ATR`.

3. **Pipeline trading window ends 15:55 ET — EOD bar captured is NOT 16:00 close.** `daily_pipeline.py:262` caps execution at 15:55. `CLOSE_STRATEGIES` runs at "15:30 ET (MOC)" per `pipeline.py:547`. Swing entries at the true 16:00 auction print are never observed; you're acting on 15:55 snapshot prices (4-5 min early). Calendar (`data/calendar.py:95`) correctly flags 16:00 as regular close — the pipeline just doesn't wait for it.

4. **Stop default of 5% below entry is volatility-blind.** `daily_pipeline.py:439`, `:518`, `:602` all fall back to `entry * 0.95` when the strategy doesn't supply a stop. Requested behavior is `2 * ATR`. The only code computing `current − 2*atr` is `api/routes/analysis.py:480` — an analysis endpoint, not the execution path. Live orders get the 5% hardcode.

5. **Take-profit fallback is symmetric 10% — not R-multiple.** `daily_pipeline.py:603` uses `tp_pct = 0.10` when no TP is set. No 2R/3R logic, no ATR multiple. Analysis route uses `current + 3*atr` (`:481`); execution doesn't. Risk/reward is unknowable at order time for most strategies.

6. **Weekly rebalance is advertised but undefined.** `pipeline.py:549` shows "15:30 Fri — Weekly refresh", referencing `WEEKLY_STRATEGIES` from `pipeline_runner.py`. Monthly rebalance strategies (`ts_momentum`, `regime_adaptive`, `momentum_quality`) use `_is_last_trading_day_of_month` — no strategy I found keys off "last trading day of week". A weekly portfolio rebalance as a swing trader understands it (rebalance target weights Fridays) does not exist.

7. **Trailing stop "update" path has an error-recovery hole.** `daily_pipeline.py:820` cancels existing stop orders before `_place_stop_order` on the new price. If the POST of the new stop fails (rate-limit/403), the cancel already succeeded → position goes naked. The 403 branch (`:830`) silently debug-logs.

8. **ts_momentum exits are MONTHLY MOO only — no intra-month stop.** `ts_momentum/strategy.py:28` explicitly says "Moskowitz 2012 forbids intra-month hard stops". Academically defensible, but for a retail swing trader a 25% monthly drawdown with no stop is unexpected. The `drawdown_delever_threshold` halves weights (`:325`) but doesn't exit.

9. **VWAP overlay on daily charts is mathematically wrong.** `TradingChart.tsx:166` computes cumulative VWAP from the first bar. VWAP is an intraday concept; session-resetting VWAP on daily bars is nonsense — it becomes a typical-price moving-average. Swing traders relying on "VWAP support on daily" are reading a meaningless line.

10. **Position sizing cap $5K overrides vol-targeting.** `master_agent.py:401` `calculate_vol_targeted_size` targets 1% risk per position, but `max_notional=5000` and `MAX_POSITION_DOLLAR=6_000` in `daily_pipeline.py:42`. On a $100K account that's 6% max — below the "vol-targeted" ask for low-vol names and above target for high-vol. The cap dominates; vol targeting is cosmetic.

**Verdict**: Backend strategies (kama_breakout, ts_momentum, regime_adaptive) are solid. The *execution pipeline* around them uses generic 5%/10% stops and cuts 5 min before the close. Frontend RSI and daily VWAP are broken.
