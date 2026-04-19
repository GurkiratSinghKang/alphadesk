# Expert Audit: `vwap` (Session-Anchored Pullback)

**Auditor frame:** Kyle 1985, BLN 1988, Bouchaud 2003, Connors-Alvarez 2009
**Files:** `backend/strategies/vwap/{spec.md,strategy.py,config.py}`;
`backend/indicators/volume.py::vwap_session`; OOS
`backend/data/oos/phase1-vwap-oos.json`
**Verdict:** PASS — conditional (one P1, three P2, all documented).

---

## 1. Classification: execution vs. alpha

The spec explicitly disavows the Berkowitz-Logue-Noser (1988) execution
benchmark misattribution ("citing it as support for a bounce/breakout
system is a misattribution") and the Madhavan (2002) VWAP-scheduler
reading. Per persona-25 that reframe is correct and is now load-bearing
on the code. The implementation matches: this is an **alpha signal**
(mean-reversion-in-trend to intraday volume-weighted mean), not a child-
order scheduler. No `slice_schedule`, no participation-rate logic, no
TWAP/VWAP execution-cost minimization — just entry/exit signals gated
on price-vs-VWAP, RSI(2), and a daily trend filter. Classification:
correct and honestly labelled.

## 2. VWAP calculation

Per persona-22 ("Daily VWAP is nonsense — cumulative from bar 0,
meaningful only intraday"): verified sound. `vwap_session`
(`indicators/volume.py:24-70`) groups by `df.index.normalize()` which
buckets by calendar date, resets cumulative numerator/denominator at
each new session, and uses `(H+L+C)/3` as the typical price. Session
anchoring is correct. Strategy only feeds the function 5-min intraday
bars filtered to 13:30-21:00 UTC (covers both EDT/EST RTH conservatively,
strategy.py:510). No pre-/post-market pollution of the cumulative
average.

## 3. Signal logic

**Entry (long, strategy.py:315-319):** `0 <= (close-VWAP)/VWAP <=
pullback_pct_max AND RSI(p) < rsi_entry_max AND close > VWAP(t-1)`.
This is "price has retraced *down* to near VWAP from above, RSI
oversold, prior-VWAP still respected" — textbook pullback-in-trend. The
Kyle/Bouchaud citation is defensible: square-root impact cooling near
the volume-weighted mean is the right theoretical anchor; this is
**not** a cited-alpha claim it can't cash.

**Stop (strategy.py:321-325):** Written as `max(bps, ATR)` in the spec
("we take whichever gives a *wider* stop") but the code uses
`min(bps_stop, atr_stop)` — **inversion**. However both are *lower
bounds* (prices below entry), so numerically `min(lower, lower) = the
lower / wider`. Works by accident. Flagging as P2 (readability) — a
future refactor picking different stop variants will break this.

**TP:** `entry + k·σ20(close-VWAP)` with a 0.5% static fallback. Sound.

**Manage (strategy.py:365-406):** Wave 23 fix confirmed — now filters
by `tag.startswith("vwap-")` OR membership in `entries` cache.
Previously flattened the entire book. This is correct post-fix.

## 4. Intraday-only / MOC

EOD-flat enforced via MOC on every `manage()` call for vwap-owned
positions. Spec §7.4 correctly acknowledges MOC ≈ 15:55 LMT within
1-2 bps. Consistent with the no-overnight thesis.

## 5. Real P1 — daily-engine execution shell on intraday signal

The strategy computes entry/stop/TP from T's intraday tape, then emits
MOO for T+1 open and relies on T+1's daily bar high/low for
stop/TP intersection. Stop/TP levels are anchored to T's VWAP — by T+1
open the intraday VWAP has reset and is meaningless as a reference.
R5 already flagged this; spec §7.1 concedes 5-10 bps of slippage vs.
a tick-level sim. This is the load-bearing limitation: OOS Sharpe 0.95
is measured under this approximation and is optimistic by the
intraday-bracket slop.

## 6. OOS

Sharpe 0.95 (target 0.40), hit-rate 56%, PF 1.31, MDD 5.7% over 2024
H1. 302 trades / 604 fills → one round-trip per trade, consistent with
EOD-flat design. Turnover 101× is high but bounded by
`max_positions × sessions`. Believable for the regime; H1 2024 was
trendy and the trend filter gated nicely. Out-of-sample on a chop year
(2022) would likely halve the Sharpe — but that's a parameter question,
not a logic defect.

**Verdict: PASS.** Logic matches the (honest) spec, VWAP math is correct
intraday session-anchored, manage() scoping fixed, one P1 residual
(daily-bar bracket on intraday level) is openly documented.
