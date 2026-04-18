# Data Correctness Audit — Round 3

**Scope:** P&L math, risk metric formulas, timezones, chart math, formatting.
**Target:** Findings that materially mislead a trader (wrong numbers → wrong decisions).
**Date:** 2026-04-18

Severity key: P0 = wrong numbers the trader sees on main screens; P1 = wrong in secondary views / special cases; P2 = cosmetic or borderline.

---

## P0 — Material misleads on primary screens

### [P0] Sharpe ratio uses dollar P&L instead of returns
**File:** backend/api/routes/portfolio.py:339-342 (and 173, 264, 553-554; frontend BacktestPanel.tsx:191, 283, 354)
**Formula current:**
```python
mean_ret = sum(daily_pnls) / n                 # <-- $ amounts
std_ret  = sqrt(Σ(p - mean_ret)² / (n-1))      # <-- $ amounts
sharpe   = mean_ret / std_ret * sqrt(252)
```
`daily_pnls` is built from `trade_ledger.pnl` (dollar amounts), NOT per-period returns.
**Formula correct:** Convert to returns relative to equity before computing:
```python
daily_returns = [pnl / equity_at_start_of_period for pnl in daily_pnls]
sharpe = mean(daily_returns) / std(daily_returns) * sqrt(252)
```
Additionally, `rf` (risk-free rate) is never subtracted in this path. `backend/backtest/metrics.py:sharpe` does subtract rf and operates on returns, but the API route does not use it.
**Impact:** The Sharpe number shown on `/analytics` page and strategy detail pages is arithmetically unitless (dollars / dollars × √252) so it looks dimensionally correct, but its magnitude scales with **absolute** dollar variance, not with risk-adjusted performance. A trader with $1M and one with $10k running the same % strategy will see **different** Sharpes. Also the number cannot be compared to any external Sharpe benchmark (e.g. "SPY Sharpe = 0.6").
**Fix:** Divide each daily P&L by the prior day's equity (or a static base equity of the account NAV) before computing mean/std. Also subtract a configurable annual rf/252 before the ratio.

---

### [P0] Sharpe annualises per-trade returns as if they were daily
**File:** backend/api/routes/strategies.py:1112-1130
**Formula current:**
```python
for trade in closed_trades:
    daily_returns.append((exit_p - entry_p) / entry_p)   # per-trade pct
...
sharpe = round(mean_r / std_r * math.sqrt(252), 2)       # annualised as daily
```
**Formula correct:** Per-trade returns are NOT daily returns. If the strategy holds 30 days on average, the annualisation factor must be `sqrt(252 / avg_hold_days)`, not `sqrt(252)`.
**Impact:** Every strategy that holds positions >1 day gets its Sharpe inflated by `sqrt(avg_hold_days)`. PEAD (30-60d hold) shows Sharpe ≈ 5-8× higher than reality. Momentum-quality (monthly rebalance, ~21d hold) gets ~4.6× inflation. The strategy leaderboard ranking becomes meaningless.
**Fix:** Either (a) track daily returns of an equity series and use `sqrt(252)`, or (b) compute average holding period and use `sqrt(252 / avg_hold_days)`. Option (a) is standard and matches `backend/backtest/metrics.py`.

---

### [P0] Sortino ratio uses wrong denominator (N, not downside N)
**File:** backend/api/routes/portfolio.py:200-204 (see also 550-554)
**Formula current:**
```python
mean_ret = sum(daily_pnls) / n
downside = [p for p in daily_pnls if p < 0]
downside_std = sqrt(Σd² / max(len(downside), 1))  # divided by count of downside days
```
**Formula correct:** Standard Sortino downside deviation divides the sum-of-squared-downsides by the **total** observation count (N), not by the number of downside periods. The "target return" is also conventionally 0 or rf, not the mean; here the mean isn't subtracted from downside so the spec is ambiguous.
```python
downside_sq = sum(min(p, 0)**2 for p in daily_pnls) / n
sortino = mean(daily_pnls) / sqrt(downside_sq) * sqrt(252)
```
**Impact:** Dividing by `len(downside)` systematically over-states the downside deviation (fewer points → larger denominator per-point) and therefore under-states Sortino. Strategies with infrequent losses will look *worse* than reality. Also note line 551 uses `np.std(downside)` which subtracts downside mean (another non-standard variant).
**Fix:** Use the standard LPM₂ formulation and divide by total N.

---

### [P0] Max drawdown computed from cumulative P&L, not equity
**File:** backend/api/routes/risk.py:447-472 (_generate_drawdown)
**Formula current:**
```python
cumulative_pnl += pnl
if cumulative_pnl > peak_pnl: peak_pnl = cumulative_pnl
dd_pct = (cumulative_pnl - peak_pnl) / peak_pnl * 100  # <-- peak of PNL, not equity
```
**Formula correct:** Max drawdown is peak-to-trough of **equity** (cash + positions), not cumulative P&L. Dividing by peak *PNL* makes the percentage huge when PNL is small (e.g. $50 drawdown on $100 peak PNL = -50%, even though account equity barely moved).
**Impact:** A trader with $100k account who has a $500 loss after a $1000 profit will see "max drawdown -50%" when actual equity drawdown is 0.5%. This is the most trust-destroying number in the audit.
**Fix:** Equity curve = starting_equity + cumulative_pnl. Drawdown = (equity - running_max_equity) / running_max_equity. Use Alpaca account equity as the base.

---

### [P0] Analytics hardcodes $100,000 base equity for all frontend charts
**File:** frontend/src/app/(dashboard)/analytics/page.tsx:47-48, 59, 110
**Formula current:**
```typescript
const base = 100000 + curve[i-1].cumulative_pnl;   // <-- magic number
const equity = 100000 + pt.cumulative_pnl;
```
Used in daily returns, drawdown, monthly returns — every chart on the analytics page.
**Formula correct:** Use the actual account starting equity. This should come from `PortfolioSummary.equity` (or a dedicated `/portfolio/starting-equity` endpoint).
**Impact:** For any trader whose account isn't exactly $100k:
- Daily returns are mis-scaled (a $500 gain on a $1M account shows as 0.5% instead of 0.05%).
- Drawdown percentages are wrong.
- Monthly returns and the heatmap are wrong.
- Rolling Sharpe divides by wrong std.
**Fix:** Thread `portfolio.equity` into the analytics page and use it as the equity base for all per-period return conversions.

---

### [P0] Short P&L is computed as if long (ledger-level)
**File:** backend/data/ingestion/trade_ledger.py:502-505
**Formula current:**
```python
pnl = round((float(price) - entry_price) * int(shares), 2)
pnl_pct = ((price - entry_price) / entry_price) * 100
```
No side argument. The schema does not persist a `side` column (see line 128-140). Closes always compute long P&L. The route-layer `_derive_side` heuristic (backend/api/routes/trades.py:171-202) guesses side from sign of shares or strategy name — but the ledger never stores a signed qty for shorts.
**Formula correct:** Short P&L = (entry - exit) × |shares| (negated direction). Need to persist `side` (or signed shares) at trade entry and dispatch P&L accordingly.
**Impact:** Any strategy that ever shorts (pairs_trading, VRP harvest, regime_adaptive, earnings_vol) produces **wrong-signed** P&L on close. Winners show as losers, losers show as winners. Direct impact on win_rate, profit_factor, equity curve, leaderboard ranking — basically every downstream metric.
**Fix:** Add `side` column to `trade_ledger` schema. Modify `record_exit` to compute `pnl = (fill_side_sign * (exit - entry)) * |shares|`. Backfill existing rows using `_derive_side`.

---

### [P0] Day P&L split between realized and unrealized can go negative-of-negative
**File:** backend/api/routes/portfolio.py:435-441
**Formula current:**
```python
day_pnl = equity - last_equity            # today's total equity delta
unrealized_pnl = sum(p.unrealized_pl ...)  # current unrealized P&L (all-time)
realized_pnl_today = day_pnl - unrealized_pnl
```
**Formula correct:** `unrealized_pl` from Alpaca is the **total** unrealized P&L on open positions since entry, not today's unrealized change. Alpaca provides `unrealized_intraday_pl` for today's portion. Subtracting total unrealized from day equity-delta gives a nonsense number.
**Impact:** `realized_pnl_today` shown in Portfolio summary is arbitrary — can flip sign at random when long-held positions swing, even if no trades closed today. A trader will see "Realized today: +$8,400" when nothing closed, or "-$3,200" when they just took a $1,500 profit.
**Fix:** Use `unrealized_intraday_pl` not `unrealized_pl`, OR compute realized_today directly from the ledger (sum of closed trade PnL with exit_time === today).

---

### [P0] Profit factor treats break-even trades as losses
**File:** frontend/src/app/(dashboard)/analytics/page.tsx:149, frontend/src/components/panels/BacktestPanel.tsx:93
**Formula current:**
```typescript
const wins   = closed.filter((t) => (t.pnl ?? 0) > 0);
const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);   // <-- includes zero
```
**Formula correct:** Break-even trades (pnl === 0) should be excluded from both buckets or tracked as a third category; they should never be counted as losses.
**Impact:** A scratch trade (commission-wiped pnl = 0) lowers win_rate and inflates gross_losses by $0 (neutral for PF but lowers win count). Trader sees a win rate of 49% instead of 50% on paper. Backend `backend/backtest/metrics.py:113-119:hit_rate` does this correctly (`t > 0`), so the frontend and backend disagree on the same concept.
**Fix:** Change `<= 0` to `< 0` in both frontend spots.

---

### [P0] Monthly returns heatmap double-counts year YTD total
**File:** frontend/src/app/(dashboard)/analytics/page.tsx:372-374
**Formula current:**
```typescript
const ytd = months.reduce((s, _, mi) => s + (monthlyReturns.get(key) ?? 0), 0);
```
Summing **arithmetic** monthly returns gives the wrong YTD. If Jan = +10%, Feb = -10%, summed YTD = 0%, but compounded YTD = (1.1 × 0.9) − 1 = -1%.
**Formula correct:**
```typescript
const ytd = months.reduce((p, _, mi) => p * (1 + (monthlyReturns.get(key) ?? 0)/100), 1) - 1;
return ytd * 100;
```
**Impact:** YTD in the heatmap drifts from the true compounded return. Error scales with monthly volatility (±0.5% typical at 20% annual vol, up to ±3% in crisis months). Does not tie to headline YTD figures elsewhere.
**Fix:** Compound returns via (1+r) product; only sum when returns are log-returns.

---

## P1 — Wrong in specific views / edge cases

### [P1] Annualised return uses linear extrapolation for <365 days
**File:** backend/api/routes/strategies.py:773-777
**Formula current:**
```python
if days_held >= 365:
    annualized = ((1 + return_pct/100) ** (365/days_held) - 1) * 100
else:
    annualized = return_pct * (365/days_held)    # <-- linear for <1yr
```
**Formula correct:** Compound regardless of period length: `((1+r)^(365/days) - 1) * 100`.
**Impact:** A strategy +10% over 90 days linearly extrapolates to +40.6% annualised. CAGR-correct is (1.10)^(365/90) - 1 = +45.4%. Linear approach *under-states* short-run annualisation. Cosmetically comparable but wrong by ~5% for 3-month periods.
**Fix:** Remove the branch and always compound.

---

### [P1] Annualised return uses calendar days instead of trading days
**File:** backend/api/routes/strategies.py:767, 774, 776
**Formula current:** `days_held = (date.today() - start).days`. Uses 365 (calendar days/year).
**Formula correct:** For an equity strategy, use trading-day count and 252. A strategy active only on weekdays will be ~1.4× under-annualised otherwise.
**Impact:** CAGR shown 6-7% too low on short-track records.
**Fix:** Count only business days between dates (or use the pipeline calendar).

---

### [P1] BacktestPanel annualised return is linear, not compounded
**File:** frontend/src/components/panels/BacktestPanel.tsx:107
**Formula current:** `annualizedReturn = totalReturnPct * (252 / totalBars)`
**Formula correct:** `annualizedReturn = ((1 + totalReturnPct/100)^(252/totalBars) - 1) * 100`
**Impact:** Over multi-year backtests this **under-states** returns; e.g. a 100% 2-year return is linearly annualised to 50% but correctly-compounded 41.4%. Trader over-weights the strategy.
**Fix:** Compound.

---

### [P1] BacktestPanel max-drawdown uses negative-only signs but computeEnhancedMetrics returns positive
**File:** frontend/src/components/panels/BacktestPanel.tsx:100-103
**Formula current:** `drawdownCurve` returns negative percentages (line 100), then `maxDd = Math.abs(Math.min(...drawdownCurve))` (line 103) so it returns a positive magnitude. But the engine also tracks `maxDd` as a positive fraction (`(peak-equity)/peak`, line 172-173). Internal consistency ≈ fine, but `calmarRatio = annualizedReturn / maxDd` — if annualizedReturn is negative and maxDd positive, Calmar is negative; correct would be `|annualizedReturn| / maxDd` or preserve sign thoughtfully.
**Impact:** Calmar flips sign when drawdown is larger than the annualised return at the start of the equity curve.
**Fix:** Define Calmar = max(0, CAGR) / |MDD| OR document sign convention consistently.

---

### [P1] Filter-by-period `setMonth(now.getMonth() - n)` gives wrong cutoff on month-end
**File:** frontend/src/app/(dashboard)/strategies/[id]/page.tsx:82-93, frontend/src/components/dashboard/PortfolioHero.tsx:29-41
**Formula current:**
```typescript
const cutoff = new Date();
cutoff.setMonth(now.getMonth() - 1);  // today=Mar 31 → cutoff=Mar 3 (Feb has only 28 days)
```
**Formula correct:** `setMonth` overflow when day-of-month > target month's length produces "spillover" into the next month.
**Impact:** Cutoff shifts by 2-3 days on the last days of March/May/July/etc. Equity curve 1M/3M period filter loses or gains a few days at month-end.
**Fix:** Use `date-fns subMonths` or normalise: set day to 1 before subtracting month, or use `Date.UTC(y, m, 1)` with explicit math.

---

### [P1] PnL Calendar Mini uses local tz, not ET
**File:** frontend/src/components/dashboard/PnlCalendarMini.tsx:10-11, frontend/src/app/(dashboard)/pipeline/page.tsx:88
**Formula current:** `const now = new Date()` — uses user's local timezone. After 20:00 PT on weekday, local date is still Mon but ET date is Tue. Before 00:00 local for EU/Asia, the "today" shown is yesterday's ET.
**Formula correct:** Resolve "now" in America/New_York to pick market date.
**Impact:** Calendar highlights wrong day for international users or US-West late-evening users. "Today's P&L" row misses after-hours fills.
**Fix:** Use `Intl.DateTimeFormat(en-US, {timeZone:"America/New_York"}).formatToParts(now)` or equivalent.

---

### [P1] Strategy list annualization uses √252 on per-trade returns
**File:** backend/api/routes/strategies.py:1119, 1126-1130
**Formula current:** Same bug as P0 §2 but for the leaderboard. Per-trade pct returns are computed and annualised via √252.
**Impact:** Leaderboard Sharpe inflated by `sqrt(avg_hold_days)`. A long-hold strategy can rank #1 on leaderboard despite being worse risk-adjusted than a short-hold strategy.
**Fix:** Same fix — use daily equity series, not per-trade returns.

---

### [P1] Market-order-hours check does not respect holidays or half-days
**File:** backend/api/routes/trades.py:244-255
**Formula current:** Checks `weekday() >= 5` and 9:30-16:00 ET. NYSE-observed holidays (MLK Day, Presidents' Day, Good Friday, Memorial Day, Juneteenth, Independence, Labor, Thanksgiving, Christmas) and half-days (13:00 ET close day after Thanksgiving, Christmas Eve) are ignored.
**Impact:** User submits a market order on a holiday; backend passes the regular-hours check, Alpaca rejects the order, user sees a confusing broker error.
**Fix:** Use `backend/data/calendar.py` (or NYSE holiday list) to verify the session is open.

---

### [P1] VaR treats positions as uncorrelated
**File:** backend/api/routes/risk.py:361-367
**Formula current:**
```python
weighted_var_sq = sum((mv * vol)² for each symbol)
portfolio_vol = sqrt(weighted_var_sq)
```
Assumes zero correlation (comment: "as conservative estimate").
**Formula correct:** "Conservative" is actually wrong direction — zero correlation *under*-estimates portfolio variance when positions are positively correlated (typical for equity longs). Use sample covariance matrix: σ²p = Σ wᵢwⱼσᵢσⱼρᵢⱼ.
**Impact:** Reported VaR understates downside risk for a typical long equity book by ~40-70% (equity markets are ~0.4-0.8 correlated). Trader thinks they have $X at risk; reality is 2-3× that.
**Fix:** Compute correlations from recent bars. As an interim, use an assumed portfolio correlation of 0.5 for long-only equity.

---

### [P1] Frontend Risk dashboard VaR uses VIX / √252 as daily vol across all positions
**File:** frontend/src/components/dashboard/RiskDashboard.tsx:159
**Formula current:** `marketDailyVol = (vix/100) / Math.sqrt(252)`; then per-position vol = beta × market_vol. VIX is the 30-day **implied** vol of S&P — using it as a realised-vol estimate underweights fat tails and ignores idiosyncratic risk.
**Impact:** VaR is biased toward the market beta component only; names with high idiosyncratic vol (e.g. biotechs, small caps) appear much safer than they are.
**Fix:** Use realised 20-day vol per ticker from bars (same as options/iv routes already do).

---

### [P1] Catalyst "upcoming" calendar skips holidays
**File:** backend/api/routes/portfolio.py:987-1012
**Formula current:** `_upcoming_catalysts` uses weekday-of-week mapping; does not account for e.g. NFP being delayed when first Friday is a holiday, or FOMC dates being irregular.
**Impact:** Morning Brief shows wrong dates for key macro events.
**Fix:** Replace with an actual economic calendar feed.

---

## P2 — Cosmetic / minor

### [P2] datetime.now() without tz in analysis age
**File:** backend/api/routes/analysis.py:305
**Formula current:** `(datetime.now() - ld).days / 365` — naive datetime minus naive, but container TZ is UTC so result is UTC-approximation of company age. Off by hours, not business-relevant.
**Fix:** `datetime.now(timezone.utc)` explicitly.

---

### [P2] Pipeline "today" uses local timezone for run-date comparison
**File:** frontend/src/app/(dashboard)/pipeline/page.tsx:88
As noted above — minor because pipeline runs in ET and the display is usually correct for ET users.

---

### [P2] OptionsPanel's aggregateGreeks double-applies side sign
**File:** frontend/src/components/panels/TradePanel.tsx:167-174
**Formula current:**
```typescript
const mult = leg.side === "buy" ? leg.quantity : -leg.quantity;
acc += v * mult;
```
Works if greeks are already signed for option type (e.g. put delta is already negative). But line 142 already flips delta for puts: `delta: s.type === "call" ? s.delta : -s.delta`. For a SELL PUT, sign becomes: -(-δ) × qty = +δ × qty — correct. For a BUY CALL: +δ × qty — correct. Non-obvious but verifiable.
**Impact:** Minor — cross-check against known combo (e.g. long straddle) if in doubt.

---

### [P2] Calmar denom uses `max_dd` directly (may be positive or negative)
**File:** backend/api/routes/portfolio.py:206-208
`calmar = annualised_return / abs(max_dd)` — correct (abs applied). No bug, flagging for cross-reference.

---

### [P2] Negative P&L formatting
**File:** frontend/src/lib/utils.ts:38-41
Uses `Intl.NumberFormat('en-US', {style:'currency'})` which emits `-$1,234.56` not `$-1,234.56`. Correct.

### [P2] Risk dashboard sharpe_ratio always 0.0
**File:** backend/api/routes/risk.py:191-192
`sharpe_ratio=0.0, sortino_ratio=0.0` are hard-coded zeros in the dashboard response; not computed from the account history. Frontend shows "0.00" Sharpe unless it pulls from a different endpoint. Cosmetic only if UI doesn't display it — but it is a foreign contract that silently returns 0.

---

## Cross-cutting theme: dollars-as-returns

Multiple modules treat dollar P&Ls as returns for annualization / ratio computations. This is the #1 source of systematic bias in the app. Grep for `pnl.*sqrt\(252\)` to find the family.

- backend/api/routes/portfolio.py:173 — rolling 30d Sharpe
- backend/api/routes/portfolio.py:342, 553 — period Sharpe
- backend/api/routes/portfolio.py:204, 554 — period Sortino
- backend/api/routes/strategies.py:1128, 1130 — leaderboard Sharpe

All should normalise P&L by account equity before annualising.

## Cross-cutting theme: long-only assumption

- backend/data/ingestion/trade_ledger.py:502 — close P&L ignores side
- backend/api/routes/trades.py:171-202 — `_derive_side` is a best-effort heuristic that runs AFTER P&L is already stored incorrectly
- Schema has no `side` column

Any strategy that shorts will compute wrong P&L at the ledger layer. The backtest engine (`backend/backtest/portfolio.py`) is correct — it uses signed quantity — but the live-trading persistence layer is not.

## Cross-cutting theme: hardcoded $100,000

- frontend/src/app/(dashboard)/analytics/page.tsx:47, 59, 110
- backend/api/routes/portfolio.py:141 (`base_equity=100_000`)
- backend/api/routes/risk.py:563 (`equity=100000`)

All should thread actual account equity.
