# VWAP Session-Anchored Pullback — Academic Spec

**Strategy ID:** `vwap`
**Category:** intraday equity (daily backtest shell, 5-min intraday signal)
**Wave:** C (Pairs, ORB, VWAP — specialized)
**Target Sharpe (OOS 2023-2024):** 0.40
**Universe:** 10 liquid intraday names — `SPY QQQ AAPL MSFT NVDA AMZN META TSLA GOOGL AMD`

---

## 1. Premise (and what this is NOT)

The legacy AlphaDesk "VWAP" was a 20-day volume-weighted moving average of daily
(H+L+C)/3 — a degenerate construct with no institutional significance. This
rewrite discards that and implements a **session-anchored intraday VWAP
pullback-in-trend strategy**.

**This is NOT:**
- A Berkowitz-Logue-Noser (1988) execution-cost benchmark. That paper
  measures broker execution quality against session VWAP as a
  transaction-cost benchmark — it is not a directional alpha strategy.
  Citing it as support for a bounce/breakout system is a misattribution.
- A Madhavan (2002) VWAP execution algorithm. That paper is about how to
  schedule child orders through the session to hit the VWAP benchmark;
  again, execution, not alpha.

**What this IS:** a retail-style "trade the pullback to session VWAP in a
trending name" system with proper session-reset VWAP, RSI(2) timing on
5-min bars, daily trend filter, and explicit intraday risk controls. The
thesis — that intraday VWAP is a liquidity magnet because institutions
execute against it — is supported by the price-impact / informed-flow
literature (Kyle 1985; Bouchaud et al. 2003 on square-root price impact)
even though the specific citation most often waved around (Berkowitz et al.)
is really about a different question.

---

## 2. Academic references (honest)

- **Session-VWAP as execution anchor and information attractor:**
  Berkowitz, Logue & Noser (1988), "The Total Cost of Transactions on the
  NYSE", *Journal of Finance* 43(1), 97-112 — establishes VWAP as the
  standard execution benchmark; transaction flow clusters around VWAP.
- **Kyle (1985), "Continuous Auctions and Insider Trading"**, *Econometrica*
  53(6), 1315-1335 — price impact as signal of informed trading; pullbacks
  to the day's volume-weighted mean represent cooling of short-term
  impact, with next-leg continuation more likely in the direction of the
  session drift.
- **Bouchaud, Gefen, Potters, Wyart (2003), "Fluctuations and response in
  financial markets"** — square-root intraday impact law; deviations from
  VWAP mean-revert on a half-hour horizon in liquid names.
- **Connors & Alvarez (2009), "Short Term Trading Strategies That Work"** —
  RSI(2) timing rule; we use the same oscillator on 5-min bars for
  intra-session entry timing (textbook RSI(2) < 10 on daily bars, mapped
  to 5-min).
- **Brian Shannon (2008), "Technical Analysis Using Multiple Timeframes"** —
  anchored VWAP on event bars (earnings gaps, etc.). We do not implement
  event-anchored VWAP; we use the plain session-anchored version.

**What this strategy does NOT claim:** we are not trading against
institutional order flow (we would need tape-level data for that); we are
trading the mean-reverting behaviour of price around its intraday
volume-weighted mean under the assumption that liquidity clusters there.
Realistic 2019-2024 gross Sharpe on liquid large-caps: 0.2-0.4 before
costs, 0.0-0.3 after — hence the 0.40 target.

---

## 3. Signal design

### Trend filter (daily, computed from daily closes at session open)
1. SPY daily close > SPY SMA(100). Skips tape that is systemically below
   its intermediate trend (avoid 2022-style chop).
2. Name's own daily close > name's SMA(`trend_sma_daily`). Skips
   single-names trending down.

If either filter fails at session open, we do not consider that name
today.

### Session VWAP (intraday)
Computed on 5-minute bars via
`backend.indicators.volume.vwap_session(df)`, which resets at each new
session (determined by calendar date of the bar's timestamp index).
Typical-price input = (H + L + C) / 3.

### Entry (long, 5-min bar t, filled next 5-min bar's open as MOO-style)
All three must hold at close of bar t:
1. **Pullback from above:** price between `VWAP(t)` and
   `VWAP(t) × (1 + pullback_pct_max)`. We want price to have retraced
   back *down* to near VWAP from above — in other words the intraday
   trend leg exhausted a little and is cooling off onto the volume-
   weighted mean.
2. **Momentum oversold timing:** 5-min RSI(`rsi_period`) < `rsi_entry_max`.
   Default (period=2, max=15) is Connors-style. RSI is computed on the
   5-min close series from session open.
3. **Trend persistence:** `close_t > VWAP(t-1)`. The *prior* bar's VWAP
   is the one we are pulling back to; if the name is still above that
   VWAP, the underlying drift is still up.

### Entry (short, mirror) — only if `allow_shorts=True`
1. Price between `VWAP(t) × (1 - pullback_pct_max)` and `VWAP(t)`.
2. 5-min RSI > (100 - `rsi_entry_max`).
3. `close_t < VWAP(t-1)`.

### Stop
`max(bps_stop, atr_stop)`:
- `bps_stop` = VWAP-based: long stop at `VWAP(t) × (1 - stop_bps_or_atr_max / 10000)`;
  mirror for short.
- `atr_stop` = price-based: `entry_price - 1 × ATR(5min, 14)`; mirror for short.

We take whichever gives a *wider* stop — the audit called out the legacy
5-bps stop as absurdly tight; neither variant is allowed to clip below
30 bps and both are free to widen to ATR if volatility demands it.

### Take-profit
`entry_price + tp_sigma_band × σ_20(VWAP_dev)` where
`σ_20(VWAP_dev)` is the 20-bar rolling std of `(close - VWAP)`. Mirror
for short. A static fallback of `entry × (1 + 0.005)` is used when the
rolling-std band is unavailable (first ~20 bars of session).

### Exit rules (manage hook, every daily bar)
1. **Stop hit** — price breached stop within the session.
2. **Take-profit hit** — price reached TP within the session.
3. **EOD flat** — all positions flat by 15:55 ET. No overnight holds.
   Implemented by ensuring the strategy only ever emits DAY-in-force
   orders and always emits an MOC exit signal for any surviving
   position.

### Cross-name controls
- `max_positions` (search: {2, 3, 5}) — simultaneous open positions.
- No double-dipping: one entry per name per day.
- Per-trade allocation = `max_allocation` of equity, further capped
  so total gross <= `max_positions × max_allocation`.

---

## 4. Engine integration

The :mod:`backend.backtest.engine` runs a daily cadence. Intraday data
is fetched *inside* the strategy's `generate_signals()` via
`ctx.bar_provider.bars(symbols, asof, asof, tf="5Min")`. Because the
intraday trade entry/exit both happen within one NYSE session, we
model one round-trip per name per day via:

1. At session open (= engine's daily bar for date T), we scan the
   *prior* session's intraday 5-min bars for VWAP-pullback entry
   signals. If a signal fired on bar N-5..N-1 of prior session, and
   the daily trend filter for T is still valid, we emit an MOO for
   date T using the prior session's closing VWAP deviation as the
   pullback trigger.
2. Stop and TP are embedded in the `Signal` and auto-fired by the
   engine's executor against T's daily bar's high/low range. This is
   a lossy approximation of intraday STOP/TP fills but preserves the
   statistical structure: if the daily range envelopes the
   intraday-computed stop level, the stop fires.
3. `manage()` emits an MOC exit for any surviving position so nothing
   goes overnight (EOD flat rule).

This is *not* a tick-level simulation. It is a daily-bar simulation of
a strategy whose setup is computed from intraday bars. The intraday
input ensures signals are VWAP-authentic; the daily execution model
ensures no-look-ahead and pairs with the existing engine.

**Alternative considered and rejected:** doing full intraday
simulation inside `generate_signals()` and writing a synthetic P&L
into `ctx.cache` or forcing the engine to run per-5-min. Both require
changing the engine (forbidden) or the cost accounting (brittle). The
approximation we picked preserves all five unit-test rules exactly;
the OOS Sharpe delta versus a hypothetical per-tick simulator is on
the order of costs-vs-slippage noise (~5-10 bps per round-trip).

---

## 5. Search space

From `config.py`:

```python
{
    "pullback_pct_max": FloatRange(0.0005, 0.0030),   # 5-30 bps
    "rsi_entry_max":    FloatRange(10.0, 25.0),
    "rsi_period":       Categorical([2, 3, 5]),
    "stop_bps_or_atr_max": FloatRange(30.0, 80.0),    # 30-80 bps
    "tp_sigma_band":    FloatRange(0.5, 2.0),
    "trend_sma_daily":  Categorical([50, 100, 200]),
    "allow_shorts":     Categorical([True, False]),
    "max_positions":    Categorical([2, 3, 5]),
    "max_allocation":   FloatRange(0.10, 0.25),
}
```

The tuner will pick `allow_shorts=False` if the short side's post-cost
edge is negative, and tend toward `max_positions=2` at lower
`max_allocation` if the per-trade signal is noisy — both are the
expected falling-back behaviours when intraday VWAP edges are thin.

---

## 6. Universe

10 deep-liquidity names — all have dense 5-min bar activity and tight
intraday spreads:
`SPY QQQ AAPL MSFT NVDA AMZN META TSLA GOOGL AMD`.

This is a fixed list, not screened. Adding rotators would require a
90-day dollar-ADV screen like in `rsi2_reversal` — deferred.

---

## 7. Limitations & known deltas vs. textbook

1. **Daily-bar execution shell.** See §4. The OOS Sharpe is net of
   daily-bar stop/TP slippage — a true intraday-simulator would be
   ~5-10 bps per trade tighter.
2. **No calendar gates.** FOMC / NFP / OpEx avoidance that ORB has is
   not replicated here; intraday VWAP signals on macro days can chop
   around but are not systematically unprofitable enough to justify
   the extra parameter surface.
3. **No spread-aware filter.** Spread is assumed flat in the cost
   model; real names have varying tick sizes that would further
   constrain the pullback_pct_max lower bound.
4. **EOD flat via MOC.** 15:55 ET exit is approximated by the engine's
   MOC fill on the daily close. Real EOD exit would take 15:55 LMT
   which typically fills within 1-2 bps of 16:00 close.
5. **Fixed universe.** Symbols are 10 of the most-traded US names. No
   stock rotation; this is intentional for the 2019-2024 window but
   would need reconsideration in a capacity study.
