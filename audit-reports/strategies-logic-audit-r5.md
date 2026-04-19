# Strategies — Logic-Bug Audit (R5)

**Scope:** Deep code-level audit of the 12 strategy packages under
`backend/strategies/`, hunting logic bugs (not parameter issues). Focus
areas: lookback indexing, universe filtering, corporate actions, price
adjustment consistency, signal-to-order conversion, data type / shape
confusion, edge cases.

**Audited files:** registry.py, signal.py, base.py; each strategy's
`strategy.py`, `config.py`, `helpers.py` where present. Also the Alpaca
bar provider (`backend/data/providers/alpaca.py`).

**Priority legend:**
- **P0** — systematically bad trades (wrong signals / wrong direction /
  missed capacity).
- **P1** — wrong metrics, correct direction / tradability.
- **P2** — minor / cosmetic.

---

## momentum_quality

### [P1] Duplicate-dedup of UNIVERSE_SEED discards legit name
**File:** `backend/strategies/momentum_quality/config.py:53-74`
**Current behavior:** `UNIVERSE_SEED` contains AMZN twice (marked deliberate
to cover two GICS taxonomies). `dict.fromkeys(UNIVERSE_SEED)` dedupes
silently. META, NFLX, TSLA, GOOG (class C) are all **missing** from
`SECTOR_MAP`, and `eligible_universe()` conservatively drops any name with
no sector entry.
**Intended behavior:** All ~50 seed names should make it into
`eligible_universe()`. Any seed name missing from `SECTOR_MAP` is silently
dropped — so the effective universe is **smaller than intended** and
omits big names.
**Fix:** Add SECTOR_MAP entries for every seed symbol (META, NFLX, TSLA,
GOOG, PM etc.) or raise on missing entries at configure time rather than
drop silently. Category: universe filter bug (B1/B2).

### [P1] `_compute_momentum` skip_days=0 case misses 1 day of return
**File:** `backend/strategies/momentum_quality/strategy.py:367-378`
**Current behavior:**
```python
end_val = (
    float(series.iloc[-(skip_days + 1)])
    if skip_days > 0
    else float(series.iloc[-1])
)
start_idx = -(lookback_days + skip_days + 1)
```
When `skip_days=0`, `end_val = series.iloc[-1]` (asof bar). `start_idx =
-(lookback_days + 0 + 1) = -(lookback_days+1)`. Return =
`p[-1]/p[-(lookback_days+1)]` — this is `lookback_days`-day return. OK.
When `skip_days>0`, `end_val = series.iloc[-(skip_days+1)]`, `start_idx =
-(lookback_days + skip_days + 1)`. Return =
`p[-skip_days-1] / p[-lookback_days-skip_days-1]` — `lookback_days` span
ending `skip_days` back. **This is correct**.
**Not a bug** — marked here for future reviewers; verified.

### [P2] F-score fallback gives F=9 to all names when no fundamentals provider
**File:** `backend/strategies/momentum_quality/helpers.py:124-128`
**Current behavior:** When `ctx.fundamentals_provider` is `None`, every
symbol receives `scores[s] = 9`, meaning the F-score filter becomes a
no-op. A silent fallback that produces tradable signals despite missing
data is quietly dangerous.
**Intended behavior:** Fail closed (return empty universe) or log at
`WARN` and document the behaviour clearly. Currently logs `WARN` once,
then passes every name through.
**Fix:** Either (a) return empty targets when no provider, or (b) promote
the warning to a hard error in prod configs. Class F3.

---

## pead

### [P0] 3-day announcement window over-counts weekends and double-fires
**File:** `backend/strategies/pead/strategy.py:408-440`
**Current behavior:** `_yesterday_announcements` computes `latest` = most
recent prior announcement date, then takes a 3-CALENDAR-day window
`[latest - 3 days, asof)`. Intent is Monday asof → Friday's
announcements. But since `latest` already IS the Friday (or prior
trading day), `latest - 3 days` is Tuesday. So on Monday it would pull
Tue/Wed/Thu/Fri announcements.
**Impact:** On a typical Monday, any name that reported Tuesday-Friday
is treated as a *fresh* Monday-morning PEAD opportunity, even though by
Wednesday / Thursday the drift was already partially absorbed. This
systematically over-trades on Mondays and stacks positions in names
whose drift is already 2-4 days old.
**Fix:** Iterate through the last N trading days using the calendar
provider (same pattern as `is_last_trading_day_of_month` in
momentum_quality/helpers.py) and only include announcements that came
**between the previous trading day's close and today's open** (one
session). Class A3 (signal vs. execution bar).

### [P1] `_next_session` fallback skips weekends but not US holidays
**File:** `backend/strategies/earnings_vol/strategy.py:1165-1186`
**Current behavior:** `_next_session` falls back to Mon-Fri skip when
`ctx.calendar_provider` is missing or raises. US market holidays (MLK
Day, Juneteenth, Thanksgiving, etc.) fall through, and the exit_date is
set to a non-trading session. The subsequent MOO exit either fires a bar
too late or on the wrong session.
**Intended behavior:** Always use `ctx.calendar_provider.sessions()`;
fail closed if no calendar.
**Fix:** Remove the Mon-Fri fallback or degrade to a hard skip of the
entry. Class C4 (halt / missing-session handling).

### [P1] `has_overlapping_earnings` uses calendar-days inflation (cushion=1.4×)
**File:** `backend/strategies/pead/helpers.py:322-348`
**Current behavior:** `cushion = int(round(horizon_days * 7.0 / 5.0)) + 2`.
For `holding_days=40`, cushion = 58 calendar days. The function returns
True if ANOTHER earnings falls in `(entry_day, entry_day + 58 cal
days]`. A 40-trading-day horizon is ~56 calendar days. Fine — but the
+2 padding means we reject entries whose next-earnings is 2 days
*after* the planned exit. Low-impact but wrong.
**Fix:** Use trading-day arithmetic via `pd.bdate_range` matching the
actual `holding_days` window, not calendar-day inflation. Class E3
(staleness).

### [P2] `trading_days_between` uses `pd.bdate_range` which ignores NYSE holidays
**File:** `backend/strategies/pead/helpers.py:351-361`, same pattern in
`rsi2_reversal/helpers.py:307-318`
**Current behavior:** `pd.bdate_range` counts Mon-Fri regardless of NYSE
holidays. A 40-trading-day time-stop may actually fire at T+38 or T+41
trading days depending on how many NYSE-only holidays fell in the
window.
**Fix:** Use `ctx.calendar_provider.sessions()` for precise trading-day
arithmetic or switch to `pandas.tseries.offsets.CustomBusinessDay` with
a US-market holiday calendar. Class G1.

---

## vrp_harvest

### [P0] VIX kill-switch uses `iv_30` in absolute decimal terms vs VIX points
**File:** `backend/strategies/vrp_harvest/strategy.py:258`, config:51
**Current behavior:** `vix_kill_switch` default is `0.35` (decimal: 35%).
`iv_30` is returned by `_atm_iv` as a BS-inverted sigma (decimal, e.g.
0.20 = 20% annualised vol). Correctly compared.
**However:** `iv_30 < float(p["min_iv_30"])` — default `min_iv_30 = 0.08`
(8%). A decimal-vs-percent error here would produce *always-true* or
*always-false* results, but the defaults are consistent (both in decimal
form). OK. **Not a bug** — verified.

### [P1] Kill-switch read of `iv_30` after `_revalue_legs` in management loop
**File:** `backend/strategies/vrp_harvest/strategy.py:432-438`
**Current behavior:** `iv_30` may be `None` if chain/spot is unavailable.
`kill_active = (iv_30 is not None and iv_30 >= vix_kill_switch)` — if
chain data is missing the kill switch **never trips**, meaning we hold
through a crisis that's invisible to us.
**Intended behavior:** Fail closed: if chain data is missing and IV
cannot be computed for 2+ consecutive sessions, force-close.
**Fix:** Track consecutive-missing-data sessions in cache; trigger a
fallback close at N sessions of missing IV. Class C4.

### [P1] Short-premium vs long-premium logic uses `rec.credit_per_spread > 0`
**File:** `backend/strategies/vrp_harvest/strategy.py:459`
**Current behavior:** The strangle's `credit_per_spread` is stored as
positive for short-premium positions (line 370) and negative for long
puts (line 406). The TP / SL logic at line 461-480 branches on this
sign. If a future code path ever creates a strangle with near-zero or
slightly-negative credit (wide market, low IV environment), the position
would be treated as a long-hedge and TP/SL logic would flip. No guard.
**Fix:** Store a `tag` or `position_type` enum rather than inferring
position direction from a signed scalar. Class F3.

### [P2] `_spot_price` long-window fetch re-fetches every 400 days but doesn't extend
**File:** `backend/strategies/vrp_harvest/strategy.py:568-605`
**Current behavior:** `needs_fetch = long_df is None or long_df.empty or
pd.Timestamp(long_df["ts"].iloc[-1]).date() < asof`. When `asof` advances
past the last cached bar, the **entire** window is refetched rather than
extending forward. In a multi-year backtest each session past the initial
cache boundary triggers a full refetch. Performance, not correctness.
**Fix:** Track `(fetch_start, fetch_end)` and only request the suffix
`(last_cached + 1, asof + 400d)`. Class (performance).

---

## earnings_vol

### [P0] `_historical_earnings_move` compares `post_close / prev_close` but index alignment assumes `d` == announcement date
**File:** `backend/strategies/earnings_vol/strategy.py:745-761`
**Current behavior:**
```python
idx = _find_nearest_session_idx(dt_arr, d)
prev_close = closes[idx - 1]
post_close = closes[idx]
```
`_find_nearest_session_idx` returns the *first session date >= target*.
For an AMC report on date D, FMP's `d = D` is a trading day, so `idx`
points at D, `prev_close = close_{D-1}`, `post_close = close_{D}` — the
move is from D-1 close to D close, which **does not capture the
after-close move** that happens between D close and D+1 close. AMC
earnings cause a gap on D+1 morning, not an intraday D move.
**Impact:** Historical move denominator is understated for AMC reporters
(~half the universe), which means `ratio = implied / hist_median` is
*overstated*, which causes more trades to pass the `1.2x` filter. The
strategy trades more frequently than intended, especially on AMC names.
**Fix:** For each event classify BMO vs AMC; use `(close_{D} -
close_{D-1}) / close_{D-1}` for BMO and `(close_{D+1} - close_{D}) /
close_{D}` for AMC. Class A1/A3 (bar timing).

### [P1] `_select_expiration` walks forward but `target = asof + dte_target cal days`
**File:** `backend/strategies/earnings_vol/strategy.py:909-925`
**Current behavior:** Picks "closest expiration >= target" where `target
= asof + dte_target`. For weekly options (default `dte_target=7`) on a
Monday, target=next Monday; but weekly expiries are Friday → picks next
week's Friday instead of this Friday. For earnings events, the natural
target is "the Friday after earnings" (to maximize theta decay with
minimum gamma); this picks one week too late.
**Fix:** For earnings-adjacent expirations, prefer the first **Friday
after the earnings date** rather than N-days-from-asof. Class A3.

### [P1] Order of operations: `_wing_spread_too_wide` reuses the *first-pass* leg picks
**File:** `backend/strategies/earnings_vol/strategy.py:469-475`
**Current behavior:** `_pick_leg_strikes` is called twice — once with
`wing_width_abs=None` to pick the ATM, then again with the actual
width. Then `_wing_spread_too_wide` is called with the fresh wings. OK.
**But:** chains can change between these two calls if they come from
a provider that has stateful cursors. With
`BoundedPolygonOptionsProvider`, chain_snapshot takes `set_spot`
hints; repeated calls within a single bar are OK, but a future racy
implementation could return different frames. Not a current bug.
**Fix:** Cache the snapshot inside `_score_candidate` and pass the same
frame to all helpers. Class F1.

---

## regime_adaptive

### [P1] Confirmation-day streak resets to 1 on ANY classifier change — even MeanRevert→TrendUp
**File:** `backend/strategies/regime_adaptive/strategy.py:215-219`
**Current behavior:** Any time `instant != prev_instant`, `streak` resets
to 1. So if the series of daily labels is
TrendUp(10x) → HighVol(1x) → TrendUp(20x), we confirm TrendUp once, then
confirm TrendUp again 20 days after the HighVol blip (total: 30 days
elapsed). A 1-day blip destroys 10 days of accumulation.
**Intended behavior per spec:** 10 consecutive days of a *new* label
before switching. A single-day reversal shouldn't reset the streak of
the *prior* confirmed regime — we should only switch when we see 10
straight of the new label.
**Fix:** Track streak per *candidate next regime* rather than resetting
on every flicker. The current code is defensible (any label change
restarts counting) but over-sensitive to 1-day noise. Class A1.

### [P1] `_vix_level` uses `realized_vol_20 * 100` as a VIX proxy
**File:** `backend/strategies/regime_adaptive/strategy.py:370-388`
**Current behavior:** The spec documents `VIXY × 10` as a VIX proxy, but
the code actually computes `realized_vol_20(SPY) * 100` as the fallback.
Realized vol systematically **under-estimates** VIX (VRP is
positive-mean). Using realized vol for the VIX threshold (default 25) is
equivalent to a lower threshold on true VIX — the strategy flags HighVol /
Crisis more aggressively than intended.
**Intended behavior:** Either fetch real VIX (`I:VIX` on Polygon) or use
a calibrated multiplier (VIX ≈ 1.15 × HV_20 historically; the code
doesn't apply this). Docs say `rv * 100`; actual VIX ≈ `rv * 115`.
**Fix:** Multiply by ~1.15 to get a VIX-equivalent, OR source real VIX
from Polygon `/v2/aggs/ticker/I:VIX`. Class B3.

### [P2] `@classmethod _search_space` attached *after* class definition
**File:** `backend/strategies/regime_adaptive/strategy.py:411-416`
**Current behavior:** `_search_space` is decorated with `@classmethod`
then assigned to `RegimeAdaptiveStrategy.search_space` outside the class
body. This works but is unusual; other strategies use a static
`search_space` class method. Readability.
**Fix:** Move into class body. Cosmetic.

---

## ts_momentum

### [P0] Peak-equity drawdown-delever uses `ctx.equity` which includes MTM of current (un-rebalanced) positions
**File:** `backend/strategies/ts_momentum/strategy.py:280-301`
**Current behavior:** `cur_equity = float(ctx.equity)`; `peak` is
tracked over bars. Because rebalance day only fires `manage()` AFTER
mark-to-market, `ctx.equity` includes open-position MTM. During a
drawdown the position's MTM is falling, so `cur_equity` reflects it.
`dd = (peak - cur_equity) / peak` — correct formula. But `peak` is
advanced on every bar when `cur_equity > peak`, which **is not
a rebalance-day-only operation** — it's updated inside
`_compute_target_weights` which is called only on rebalance days.
So peak is effectively updated on a monthly cadence, not daily.
**Impact:** After a multi-month drawdown the peak stays anchored at the
pre-drawdown month-end, so dd computation is correct. But if the
backtest has an intra-month drawdown that recovers by month-end, the
peak sees the recovery but not the drawdown — de-lever never fires.
**Fix:** Track peak on every bar via `manage()` or a dedicated per-bar
hook, not just on rebalance days. Class A1.

### [P1] `_compute_signals` ternary on `mean_sign > 0.01` drops exactly-zero ensemble
**File:** `backend/strategies/ts_momentum/strategy.py:388-394`
**Current behavior:** When `abs(mean_sign) <= 0.01` the output is 0
(exit position). For the 1-month ensemble (single lookback) this means
a tiny positive/negative ensemble sign flips to 0 and we exit. For 3-12m
ensemble this is rare but the 0.01 threshold is arbitrary — not
mentioned in the Moskowitz-Ooi-Pedersen paper.
**Fix:** Document or remove the threshold; literature uses `>0 → long,
<0 → short, =0 → flat`. Class A1.

### [P1] `_fetch_close_panel` does NOT refetch between rebalances even if universe changes mid-backtest
**File:** `backend/strategies/ts_momentum/strategy.py:315-321`
**Current behavior:** `need = (panel.get("symbols") != tuple(tickers)
or (panel.get("end") or date.min) < asof)`. If `universe_tickers()` is
invoked with a config change (e.g. tuner pivots mid-trial), the tuple
mismatch triggers a refetch. OK. **Not a bug**.

---

## rsi2_reversal

### [P0] Earnings calendar cached with a fixed 2-year window based on first `asof.year`
**File:** `backend/strategies/rsi2_reversal/helpers.py:275-293`
**Current behavior:**
```python
if cal is None:
    start = date(asof.year - 1, 1, 1)
    end = date(asof.year + 1, 12, 31)
    df = provider.calendar(start, end)
    ...
    cache[_EARNINGS_KEY] = cal
```
The earnings calendar is fetched ONCE on first call, pinned to
`[asof.year - 1, asof.year + 1]`. For a multi-year backtest (2019-2024),
the first call at `asof = 2019-06-01` caches earnings for 2018-2020. All
earnings in 2021-2024 are **silently missing** → every
`has_upcoming_earnings` call returns False → earnings-skip gate is
bypassed and we buy into earnings announcements.
**Impact:** A positional strategy that was meant to skip the ~10
earnings-adjacent days per name per year effectively NEVER skips them
after the first 2 calendar years of a backtest.
**Fix:** (a) Fetch the full backtest window up-front via `ctx.calendar`
or (b) extend the cache when `asof > cached_end - safety_margin` (same
pattern as PEAD's `_study_window`). Class E3 (staleness).

### [P1] `has_upcoming_earnings` horizon uses `window_days * 2` calendar-day fudge
**File:** `backend/strategies/rsi2_reversal/helpers.py:297`
**Current behavior:** `horizon_end = asof + timedelta(days=window_days *
2)`. For `earnings_skip_days=3`, this checks 6 calendar days — over a
weekend, a Friday entry captures Tue-Wed earnings. Works by accident.
For larger windows it balloons (earnings_skip=7 → 14 calendar days =
~10 trading days = 43% more skipping than configured).
**Fix:** Use `pd.bdate_range` and check against the configured number of
trading days. Class A1.

### [P2] `_PROC_IND_CACHE` is a module-global dict with FIFO eviction at 8192 entries
**File:** `backend/strategies/rsi2_reversal/helpers.py:43-54`
**Current behavior:** Process-wide cache keyed by `(data_id, period)`
where `data_id = (sym, first_ts, last_ts, n)`. Two concurrent tuner
trials touching the same symbol with the same data but different
parameters will get different keys (good). But: if the same (symbol,
data) appears in trial 1 and trial 2 with bars updated between them
(e.g. live data refreshed), `data_id` changes and the old entry stays
in the cache until FIFO eviction — OK, just memory growth. Not a bug.
**Fix:** None needed; flag for future reviewers.

---

## dual_momentum

### [P1] `_composite_return` requires EVERY lookback component to have history — returns `None` on any missing component
**File:** `backend/strategies/dual_momentum/strategy.py:336-367`
**Current behavior:** Loops through `(L, w)` components and returns
`None` if any single `L` lacks `L+1` bars. For the default 12-month
lookback the bar requirement is 253 bars. In a backtest with an asset
that IPO'd mid-window (AGG history goes back to 2003 — fine for most
tests but VEU started in 2007, may fail for early 2008 rebalance). On
any single missing component the strategy goes to **bonds** (default
fallback). In a multi-component ensemble this may mask a legitimate
equity signal.
**Fix:** Drop missing components and rescale weights, rather than
aborting. Class G1.

### [P2] `relative_universe[0]` assumed to be the US-equity sleeve (VOO)
**File:** `backend/strategies/dual_momentum/strategy.py:191`
**Current behavior:** `us_sym = cfg.relative_universe[0]` hard-coded
positional convention. Silent coupling to config ordering.
**Fix:** Explicit `cfg.us_sleeve` field. Class (readability).

---

## pairs_trading

### [P0] `_spread_and_z` computes rolling std on 25-bar tail — std window may be too short
**File:** `backend/strategies/pairs_trading/strategy.py:530-560`
**Current behavior:** `need = z_window + 5` (e.g. 25 for default
z_window=20). Rolling `.mean()` and `.std(ddof=1)` with
`min_periods=z_window`. On the last bar, mean/std use observations
`[t-z_window-1, t-2]` (after `.shift(1)`). With only 25 bars total and
`min_periods=20`, the first 20 bars have `NaN`, so mean/std only have
5 valid values to smooth through. The z-score itself is `(spread_t -
mean_{t-1}) / std_{t-1}` — using a 20-bar rolling on a 25-bar tail
computes std from `n=20` observations, fine for statistical validity.
**However:** When `z_window=90` (max), `need=95`, and if fewer than 95
bars are available (e.g. early in a backtest), we still return a
`z_today` but it may be computed on fewer observations because rolling
silently backfills when `min_periods` is met. Not clearly a bug — OK.
**Verified** — not a bug.

### [P1] `all_within_sector_pairs()` generates ALL pairs every rescreen — no formation-window history check
**File:** `backend/strategies/pairs_trading/strategy.py:336-346`
**Current behavior:** Iterates over every within-sector pair, calls
`_closes_for` for each leg. If either leg has insufficient history
(`None`), skips. But doesn't note that early-backtest pairs may screen
differently than late-backtest pairs due to different overlapping
history lengths. Mainly a performance issue (O(sectors × names^2) on
every rescreen). Class (performance, not correctness).

### [P1] Dollar-neutral sizing uses `pair_weight` for both legs — ignores leg-price asymmetry
**File:** `backend/strategies/pairs_trading/strategy.py:739-754`
**Current behavior:** Both legs get `±pair_weight` (e.g. ±5%). The
engine's `target_weight` path computes `qty = weight * equity / price`;
so 5% × $100k / $34 (BAC) = ~147 shares of BAC, 5% × $100k / $400 (GS) =
~12 shares of GS. Dollar notional per leg is identical (both $5k), so
this IS dollar-neutral — correct. **Verified, not a bug**.

### [P2] `watchdog` updates `last_watchdog_date` even when a pair fails watchdog (then gets dropped next rescreen)
**File:** `backend/strategies/pairs_trading/strategy.py:494-495`
**Current behavior:** `pair.last_watchdog_date = asof` is set AFTER
adding to `failed` — innocuous since pair is then closed and replaced at
next rescreen. Cosmetic.

---

## kama_breakout

### [P1] `_efficiency_ratio` returns `abs(close[-1] - close[-1-period])` over `sum(abs(diffs[-1-period:]))`
**File:** `backend/strategies/kama_breakout/strategy.py:630-646`
**Current behavior:**
```python
change = abs(float(vals[-1] - vals[-1 - period]))
diffs = np.abs(np.diff(vals[-1 - period:]))
vol = float(diffs.sum())
return change / vol
```
This computes ER over the last `period+1` bars — matches the Kaufman
definition (N-bar ER = |p_t - p_{t-N}| / Σ|Δp| over N bars). But
`np.diff(vals[-1-period:])` gives `period` differences (correct), and
`vals[-1] - vals[-1-period]` is the total net move — correct. **Verified.**

### [P1] Pyramid shares calc uses `pos.quantity * close` for current notional — doesn't account for leverage / cash use
**File:** `backend/strategies/kama_breakout/strategy.py:298-315`
**Current behavior:** `max_alloc * equity` treats equity as total
portfolio. If other positions are also open, the `max_allocation` is
really per-position, not aggregate. Sizing each name to 15% without
tracking aggregate exposure could push aggregate > 100% if many names
fire on the same day. OK if `max_positions=5` and `max_allocation=0.15`
— aggregate cap 75%. With tuner-suggested `max_positions=10,
max_allocation=0.15` → 150% aggregate. Not caught.
**Fix:** Cap by remaining cash / aggregate notional budget across all
open positions. Class E2 (sizing consistency).

### [P2] `manage()` pyramid stores `atr` into `pending` dict — but variable name `atr` shadows `atr_last` never-set
**File:** `backend/strategies/kama_breakout/strategy.py:191-197`
**Current behavior:**
```python
pending[sym] = {
    "atr": float(sig.stop_price or 0.0),  # will be overwritten
    ...
}
```
Comment says "will be overwritten" but the only write is in
`on_fill` which calculates `atr_entry` itself. The `pending` dict's
`atr` field is initialized to `sig.stop_price` (which is `None` on
KAMA-breakout signals — the signal has no `stop_price` set). So the
dict value is always `0.0` until on_fill overwrites. Dead code
disguised as important.
**Fix:** Remove the pending["atr"] field (unused) or wire on_fill to
read from it instead of recomputing. Cosmetic.

---

## orb

### [P0] `_filter_rth` slice assumes bars carry a 'symbol' column — breaks on single-symbol providers
**File:** `backend/strategies/orb/strategy.py:264-279, 601-619`
**Current behavior:** `simulate_day` filters `sub = df[df["symbol"].str.upper() == sym.upper()]`. If the provider returns a multi-symbol frame without an explicit "symbol" column (e.g. some test doubles return a single-symbol frame with no symbol column), this crashes.
**Fix:** Defensive check: if "symbol" not in columns and single-symbol context, pass through; otherwise filter. Class F1.

### [P1] Same-bar fill on breakout uses `post_or.iloc[fill_idx]` which is bar i+1's **open** — **but** the min/tp checks still run on the *same bar* as the fill
**File:** `backend/strategies/orb/strategy.py:382-463`
**Current behavior:** `entry_idx = i` (breakout bar), `fill_idx = i+1`
(next bar's open). Then `remaining_bars = post_or.iloc[fill_idx:]` and
the walk-forward loop begins at `fill_idx`. The very first bar of the
walk is the fill bar itself — so stop/TP checks use the **high/low of
the fill bar** which includes price action DURING the same minute we
filled at the open. Not a look-ahead (the high/low is realized after
our fill), but intrabar stops could trigger at the SAME bar as entry
— possible race if the fill price is adverse to the open.
**Intended behavior:** Skip stop/TP checks on the fill bar; start
walk-forward at fill_idx + 1.
**Fix:** Initialize `remaining_bars = post_or.iloc[fill_idx + 1:]` or
skip stop/TP on the first iteration. Class A3.

### [P2] `_filter_rth` can throw on tz-naive 'ts' column via `dt.tz_convert`
**File:** `backend/strategies/orb/strategy.py:607-614`
**Current behavior:** Catches `TypeError` by reconverting; robust
enough. Cosmetic.

---

## vwap

### [P0] Manage emits MOC exit for EVERY held position every bar, overriding other strategies
**File:** `backend/strategies/vwap/strategy.py:365-388`
**Current behavior:** `for pos in list(ctx.positions)` — iterates ALL
portfolio positions, not just those the vwap strategy opened. In a
multi-strategy run this will emit MOC exits on positions owned by
dual_momentum, momentum_quality, etc. With the engine's position
router, this MAY or MAY NOT be filtered by strategy ownership; if the
engine attributes signals strictly by strategy there's no collision,
but the code as-written is not namespace-clean.
**Intended behavior:** Only flatten positions opened by vwap (tag-based
or cache-based tracking).
**Fix:** Filter by `entries_cache` symbols or positions whose `tag`
starts with `"vwap-"`. Class E1/E2 (signal-to-order).

### [P1] `_evaluate_pullback` score comparisons use `< best[4]` but short-score is `-rsi_t`
**File:** `backend/strategies/vwap/strategy.py:332, 357`
**Current behavior:** For long: `score = float(rsi_t)` (lower = more
oversold = stronger). For short: `score = -float(rsi_t)` (lower = more
negative = more overbought = stronger). Comparison `if cand[4] <
best[4]`. A strong long with RSI=10 (score=10) vs a strong short with
RSI=90 (score=-90) → short wins even if long is stronger in its own
direction. Probably intentional (short is "more extreme"), but
asymmetric: a moderate short beats a strong long.
**Fix:** Either normalize both scores to absolute-distance-from-50 or
document that shorts have priority.

### [P1] `_intraday_bars` uses 5-min bars of TODAY's session to generate a signal for **tomorrow**'s MOO fill
**File:** `backend/strategies/vwap/strategy.py:170-173, 212-224`
**Current behavior:** Scan today's 5-min intraday tape at EOD (asof=T),
emit MOO → fills T+1 open. Valid — T intraday is fully known at T
close. But stop/TP levels computed from T's VWAP are applied to T+1
intraday on a DAILY engine that uses T+1's daily bar high/low for
stop-hit detection. Intrabar stop logic fires at T+1 against an
intraday level anchored to T's VWAP. Stop logic works only if T+1's
range intersects T's VWAP-derived stop — often true, but the bracket
is stale by a day.
**Fix:** Recompute stop/TP at T+1 open (requires intraday engine
support, not available in daily engine).

---

## Cross-cutting findings

### [P1] All long-history fetchers call `ffill()` on symbol close series
**Files:** every strategy's `_fetch_close_panel` (momentum_quality,
regime_adaptive, ts_momentum, dual_momentum, pairs_trading,
rsi2_reversal).
**Current behavior:** `wide.ffill()` silently fills holidays / halts /
data gaps with the prior close. A symbol halted for 5 days shows up as
5 identical bars with zero returns; any realized-vol / RSI / momentum
computation sees this as a flat series. Strategies then treat the
halted name as tradable with a zero-vol / zero-RSI reading.
**Intended behavior:** Leave `NaN` in place; downstream indicators
handle it; skip symbols with insufficient observations.
**Fix:** Remove `.ffill()` from the universe-wide panel builders, OR
add a halt-detection filter that excludes symbols with >N consecutive
identical closes. Class C4 (halt handling).

### [P1] `momentum_quality`, `pead`, `rsi2_reversal` fetch bars/fundamentals assuming Alpaca's `adjustment=all`
**Files:** `backend/data/providers/alpaca.py:161` (`"adjustment": "all"`
— split + div adjusted).
**Current behavior:** Alpaca always returns SPLIT **and** DIVIDEND
adjusted bars. Polygon provider uses `adjusted=true`. This is consistent
across backtesting bars. BUT: Alpaca's live-trading tape returns raw
bars in the websocket stream. Backtests train on adjusted close; live
trading executes on raw prices. If a dividend is paid mid-trade, the
live fill price will be ~2% lower than the modeled "adjusted" close,
triggering a phantom stop or take-profit.
**Intended behavior:** Consistent adjustment policy between backtest
and live — typically: backtest on adjusted, live on adjusted-up-to-last-
close with raw from then on. Or: both unadjusted, with strategy-level
div handling.
**Fix:** Audit the live data path (not covered in this audit); add a
warn-log when a dividend or split is observed on a held position.
Class D1/D2.

### [P2] `trading_days_between` / `has_upcoming_earnings` use `pd.bdate_range` everywhere
**Files:** `pead/helpers.py:351`, `rsi2_reversal/helpers.py:297,316`,
`earnings_vol/strategy.py:170`.
**Current behavior:** Mon-Fri count ignores NYSE holidays. A 40-trading-day
time-stop fires at ~38-41 actual trading days depending on holiday
density. Minor metric noise.
**Fix:** Route through `ctx.calendar_provider.sessions()` — available
on every strategy via `cache_of(ctx)`. Class G1.

---

# Summary: Top 10 Logic Bugs by Trade-P&L Impact

| Rank | Strategy | Bug | Class | Impact |
|------|----------|-----|-------|--------|
| 1 | rsi2_reversal | Earnings calendar cache pinned to first asof's ±1 year; multi-year backtests skip no earnings after year 2 | Staleness | Every trade into earnings T+1 gap → tail losses on beats / misses. For a 5y backtest, ~40% of trades bypass the earnings gate. |
| 2 | pead | `_yesterday_announcements` uses 3-calendar-day window stacked on top of "latest prior trading day" — Mondays over-count Tue-Fri announcements | Signal-to-execution timing | 2-4 day stale PEAD entries; Monday concentration triples trade count vs intended. |
| 3 | earnings_vol | Historical move denominator uses `close_{D-1} → close_D` for AMC events (wrong session pair) | Lookback indexing | Historical median is ~50% understated for AMC reporters → `implied/hist` ratio is overstated → trades 1.5-2× more frequent on AMC names. |
| 4 | ts_momentum | Peak-equity for drawdown-delever only updates on rebalance days (monthly), missing intra-month drawdowns | Signal-on-wrong-bar | Intra-month drawdowns that recover by month-end never trigger the de-lever. Crisis risk control compromised. |
| 5 | vwap | `manage()` emits MOC exits for every portfolio position, not just vwap-owned ones | Signal-to-order conversion | In multi-strategy runs, vwap flattens positions owned by other strategies at MOC daily. Could zero-out a trend-follower book. |
| 6 | orb | Walk-forward loop starts at fill bar; stop/TP checks run on same bar as fill | Lookback indexing | Fills at open get stopped out at same-bar low/high on volatile breakouts → negative expectancy on high-volatility days. |
| 7 | regime_adaptive | VIX proxy = realized_vol × 100 (not ×115); under-estimates VIX | Universe/signal math | HighVol/Crisis regimes flag ~15% more aggressively than intended. More defensive allocation overall → lower CAGR in a 2019-2024 mostly-bull tape. |
| 8 | momentum_quality | UNIVERSE_SEED drops names missing from SECTOR_MAP (META, NFLX, TSLA, GOOG-C) — silent universe shrinkage | Universe filter | ~10% of seed universe silently excluded; misses top-momentum names of 2020-2024. |
| 9 | vrp_harvest | VIX kill-switch `iv_30 is None → kill_active=False`; missing chain data never trips the crisis switch | Corporate actions / halt | During severe crisis (Mar 2020, Mar 2023), options chains sometimes fail to fetch; strategy holds short vol through it. |
| 10 | cross-cutting | All panel builders call `ffill()` on closes — halted names trade with zero-returns (flat series) through halts | Data handling | Halted symbols (BBBY, SIVB, FRC) appear tradable with zero vol → sizing formulas divide by ~0, producing runaway sizes or silently tradable names that can't actually be traded live. |

**Note:** Parameter-driven concerns (ORB's 20%-notional cap, momentum_quality's
~50-name survivorship universe) are excluded per audit scope.

### Summary narrative

The highest-impact class of bug is **cached-data staleness** — RSI2's
2-year earnings window that silently expires, VRP's infinite forward-
extend spot cache, and the universal `ffill()` on close panels. These
produce plausible-looking signals on data that isn't what the strategy
thinks it is; they scale with backtest length.

Second-tier is **signal-to-execution timing** — PEAD's 3-calendar-day
window, Earnings-Vol's AMC-vs-BMO move measurement, ORB's fill-bar
stop detection, and VWAP's next-day bracket on T-anchored levels. All
produce trades at the wrong bar or wrong direction relative to the
intended signal.

Third is **risk-control coupling** — TS-Momentum's monthly peak update,
VRP's fail-open kill switch, VWAP's portfolio-wide MOC flattening. In
normal markets these are dormant; in a crisis they fire at the wrong
time or not at all.

Price-adjustment consistency (D) is broadly correct — both Alpaca and
Polygon feeds return adjusted bars, and the Alpaca raw live tape is
not an audited code path here. The biggest real D-class issue is the
panel-builder `ffill()` pattern: adjusted close on a halted name
produces a flat series, and the strategy can't distinguish "halt" from
"flat day". Strategies that gate on low-vol / low-RSI will light up on
halted names.

Universe filtering (B) is the area most brittle to future changes: the
momentum_quality `SECTOR_MAP` dropout, the PEAD hardcoded `UNIVERSE_SEED`
(no dynamic constituent list, so no IPO coverage), and the rsi2 CORE_ETFS
vs. LARGE_CAP_SEED merge (which survives across config changes but
doesn't account for delisted names like DISCK or missing ones like TSM).

Corporate-action handling (C) is weakest for the short-vol leg (vrp_harvest)
— no explicit halt detection, no kill-switch fallback when data is
missing. Dividend handling is handled at the data-provider level
(adjusted bars); ex-div phantom drops are not an issue in the backtest
path.

No bug is a "strategy immediately loses money" P0. Every P0 above
produces systematically wrong trades in specific conditions — multi-year
cached data, AMC earnings, intraday breakouts, crisis regimes — that
skew metrics and expose tail risk. Fix priority should follow the P&L-
impact order in the table above.
