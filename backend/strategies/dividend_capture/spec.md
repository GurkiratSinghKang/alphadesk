# Dividend Capture

**Category:** Equity / event-driven (long-only ex-dividend-day pricing anomaly)

**Primary references:**
- Elton, E. J., & Gruber, M. J. (1970). "Marginal Stockholder Tax Rates and the Clientele Effect." *Review of Economics and Statistics* 52(1).
- Frank, M., & Jagannathan, R. (1998). "Why Do Stock Prices Drop by Less Than the Value of the Dividend on Ex-Dividend Days?" *Journal of Financial Economics* 47(2).
- Graham, J. R., Michaely, R., & Roberts, M. R. (2003). "Do Price Discreteness and Transactions Costs Affect Stock Returns?" *Journal of Finance* 58(6).

## 1. Why this strategy exists

Elton-Gruber (1970) documented the *ex-dividend-day pricing anomaly*: stock prices on the ex-date drop by *less* than the cash dividend per share, on average. Originally attributed to a tax-clientele effect (long-term holders avoid the dividend, short-term traders price the dividend at less than face), Frank-Jagannathan (1998) and Graham-Michaely-Roberts (2003) refine it as a microstructure + transaction-cost phenomenon.

The strategy holds a position across the ex-date so it captures the difference between the cash dividend received and the ex-day price drop. After fees, slippage, and short-term tax treatment the gross 10-30 bp per event compresses to single-bp net per event; the trade is volume-driven, not edge-driven.

This implementation is **conservative** — small per-name weight (5%), max 8 concurrent positions, strong yield + liquidity + earnings filters — to bound the inevitable adverse-selection cases (REITs that mismatch their declared cash; financials with overlapping earnings; ETFs with their own ex-day microstructure).

## 2. Rules (exact)

### Universe

Static seed of ~40 large-caps with sustained dividend programs (`DIVIDEND_UNIVERSE_SEED` in `config.py`). The strategy applies its own liquidity floor (`min_adv_millions`, default $50M 90-day median dollar volume) and event-yield filter at run time.

`skip_etfs=True` (default) excludes the dividend ETFs from selection. They're in the seed for completeness only; their ex-day microstructure differs materially from underlying stocks.

### Signal

Each premarket scan, look at upcoming ex-dividend events (from `input.dividends`, populated by the FMP `/dividends-calendar` endpoint via the new `FMPDividendsProvider`).

Filter:
1. **Window**: `ex_date` is approximately `entry_offset_days` trading sessions away (default 3 → ~4 calendar days; rounded with `int(round(N * 7/5))`).
2. **Yield**: `cash_amount / current_price ≥ min_yield_pct` (default 0.5%). Filters tiny dividends where transaction costs dominate.
3. **Earnings overlap**: skip if the symbol has scheduled earnings within `earnings_skip_days` sessions (default 10). The 4-5 session holding window can ride a binary catalyst that overwhelms the 0.5–1% dividend.
4. **Liquidity**: 90-day median dollar volume ≥ `min_adv_millions`.
5. **Not currently held**.
6. **Not a dividend ETF** (when `skip_etfs=True`).

Survivors are ranked by event yield (highest first), top `max_positions` (default 8) are entered.

### Entry / Exit

- **Entry**: MOC at T - `entry_offset_days` (default T-3 sessions before ex-date). Per-name `target_weight = target_weight_per_name` (default 5% of NAV).
- **Exit**: MOC at T + `exit_offset_days` (default T+1). State-backed scheduled exit; per-bar checks fire every session, not just rebalance days, so a position whose scheduled exit date arrives mid-week is closed cleanly.

### Cadence

Premarket scan every session (the strategy is event-driven; "rebalance day" is whenever there's an actionable upcoming ex-event in the window). Schedules to `PREMARKET_STRATEGIES` window (6:00 AM ET) in `pipeline_runner.py`.

### Execution

All orders are MOC with DAY-TIF. The broker translates `target_weight` into share count from current NAV.

## 3. Tax-aware caveat

This implementation does **not** model holding-period taxation. Under US tax code (IRC §1(h)(11)), to qualify for long-term capital-gains treatment the holder must own the stock for more than 60 days during the 121-day window centered on the ex-date. A 4-5 session capture trade *does not* qualify — the dividend is short-term ordinary income for tax purposes.

The catalogue copy + this spec acknowledge that the **gross** edge is documented but the **net-of-tax** edge for a US taxable account is materially smaller than the headline. Run this strategy in a tax-deferred account (IRA / 401(k)) to capture full economics.

## 4. What this implementation does NOT do

- **No DRIP toggle**. Dividends are credited to cash at exit.
- **No symbol-specific borrow-cost model on shorts** (strategy is long-only by spec).
- **No qualified-vs-ordinary split in tax reporting**. The portfolio system records P&L; tax classification is left to the user / accountant.
- **No covered-call overlay**. A future strategy could pair a long dividend-capture position with a short call against it; out of scope here.
- **No ex-day price-drop forecasting model**. The strategy assumes the average drop < dividend (Elton-Gruber), which is the empirical ~75-90% of cases over 1970-2010 samples; the residual ~10-25% of events where the drop equals or exceeds the dividend is absorbed as the strategy's noise floor.

## 5. Performance expectations

Frank-Jagannathan (1998) report ~0.3-0.5% gross return per ex-event on liquid US large-caps over 1970-1995. After 2000, decimalization + tighter spreads (Graham-Michaely-Roberts 2003) compressed this to ~0.1-0.2% per event. Realistic forward Sharpe band on US large-caps in tax-advantaged accounts: **0.4-0.8** at low capacity (5-10 events per quarter, 4-5 day average hold). Higher in a wider universe; lower for taxable accounts.
