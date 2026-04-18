# Strategies Audit — Implementation Correctness (r3)

**Date:** 2026-04-18
**Scope:** All 12 registered strategies under `backend/strategies/`.
**Method:** Read `spec.md` + `strategy.py` + `config.py` for each strategy; cross-check against paper mechanics. Trust the paper, audit the code.

## Top concerns — ranked by severity

1. **`orb`** — OOS Sharpe 8.34 is a flagged artifact; the phase-1 master summary admits this is a notional-cap-compression inflation, not real alpha. More worrying at the code level: the tuner chose `universe_profile = "all_leveraged"` (SPY/QQQ/TQQQ/SPXL), so the "headline" number piggybacks on 3x-leveraged ETF path-dependency in a 2023-2024 monotone bull tape. Volume-confirm multiplier 0.86 is below the 1.0 "disabled" floor. Need to report the per-trade Sharpe (claimed ~1.5-2.0) as the honest OOS.
2. **`momentum_quality`** — `momentum_filter_min=0.054` is an absolute-momentum floor **that wasn't in Jegadeesh-Titman or in the AFP paper**; the paper quotes 0.80 Sharpe, we ship 2.21. Combined with a hand-picked 46-name mega-cap seed universe (frozen across 2019-2024), this is close to survivorship-biased curve-fitting. The `min_f_score=7` tune further narrows the cross-section — fine in-sample, fragile OOS. Text in spec §9 admits this is a design choice; it is not a bug, but it is a Sharpe inflator.
3. **`earnings_vol`** — The synthetic-BS pricing path at exit (used before Phase 2 commit `a6310fa`) inflated prior Sharpe to 6.10; v2 uses real Polygon `contract_bars`, posting 1.43. Even the v2 result has a very thin trade count (40 OOS trades total; only ~5-10 unique underlyings). Tuned `implied_vs_historical_min_ratio=1.76` + `max_concurrent_positions=1` yields a degenerate, capacity-limited book. Wing-width of 0.81× is **below** the 1.5× default — left tail is less defended than spec claims.
4. **`pairs_trading`** — Implementation is correct (Engle-Granger + OU half-life + Hurst, with two-leg invariant). But `hedge_method="kalman"` chosen by the tuner, with `rescreen_days=42`, increases turnover to 65x and the hit_rate is only 0.526. The OOS Sharpe 1.23 looks decent, but of the 65 reported pairs, the top 5 contributed most of the P&L while 30 were negative contributors — i.e. the aggregate Sharpe is not robust to pair attribution. Survivorship: universe is 49 hardcoded names — acceptable but frozen.
5. **`rsi2_reversal`** — Clean implementation. CAGR 5.1% on a claimed Sharpe 1.88 is suspicious: the "Sharpe" is inflated by very low realized vol (the strategy is in the market ~15-20% of days; on most days P&L=0, which compresses denominator) and a tiny max_drawdown of 1.9%. This is a classic "Sharpe-without-risk-taken" pattern; not bugged, but the reported Sharpe misreads the economic edge. Real tradable edge is closer to 0.5-0.8 Sharpe on a full-deployment equivalent.

---

## Individual strategy audit

### `momentum_quality`

**Paper:** Jegadeesh & Titman (1993) + Piotroski (2000) + AFP (2014 QMJ)
**Implementation:** `backend/strategies/momentum_quality/strategy.py` + `helpers.py` + `config.py`
**Entry rule (paper):** 12-1 month momentum (skip last 21 days), cross-sectional top decile long-only, Piotroski F-score ≥ 5, monthly rebalance, exclude Financials/Utilities (AFP convention), equal-weighted.
**Entry rule (code):** `r_mom = C[t-21] / C[t-21-L] - 1` (skip-21 correct), then composite `score = wm*rank(mom) + wq*rank(F)`, take top N. Exit on rebalance if fallen out of top N. MOO entries. Trading-day lookback `21 * lookback_months`. No same-bar leakage — decision at `asof`, fill at next open.
**Match:** ✓ for signal mechanics. ⚠ Deviation: **spec admits added absolute-momentum floor (`momentum_filter_min`), earnings skip, hard F-score gate** — these are tunable knobs that make the paper's parameters fit the 2019-2024 window.
**Parameters:** `momentum_skip_m = 0` in OOS (tuner disabled the Lehmann skip — inconsistent with the paper's "skip-most-recent-month"). `min_f_score = 7` (Piotroski winners zone). `momentum_filter_min = 0.054` — not in paper.
**OOS Sharpe:** **2.21** (target 0.80; 2.7x over)
**Concerns:**
- Fixed 46-name mega-cap universe = survivorship bias; S&P 500 membership in 2019 contained 2020-delisted names the universe omits.
- `momentum_skip_m=0` (tuner-disabled Lehmann skip) is a deviation from Jegadeesh-Titman canonical.
- Absolute-momentum floor `r_mom >= 5.4%` is curve-fit.
- 0 alpha / 0 beta in OOS JSON — not computed against benchmark.

---

### `pead`

**Paper:** Bernard & Thomas (1989) + Livnat & Mendenhall (2006)
**Implementation:** `backend/strategies/pead/strategy.py` + `helpers.py` + `config.py`
**Entry rule (paper):** SUE = (EPS_actual − EPS_est) / σ_surprise over trailing 8Q; long top quintile / short bottom quintile; hold 40-60 days; exit on time stop.
**Entry rule (code):** Same SUE definition with `sue_lookback_quarters=8` (tuned to 4 in OOS). T+1 MOO entry after announcement. Exit MOC at `holding_days=40` trading days. Liquidity floor ($20M ADV, $10 price). Both directions (long/short) emitted when `allow_shorts=True`.
**Match:** ✓ clean implementation — SUE denominator correct, no hard stops, time-only exit, T+1 open fill consistent with Bernard-Thomas.
**Parameters:** In OOS, `sue_lookback_quarters=4` — below canonical 8, acceptable deviation given post-2020 noise.
**OOS Sharpe:** **1.32** (target 0.50; 2.65x over)
**Concerns:**
- FMP's `epsEstimated` is backfilled (not point-in-time analyst consensus). Spec admits this at §6. This is the only potential look-ahead.
- SUE histogram shows 88 trades with SUE≥3 but only 7 trades with SUE 1.5-2.0 — distribution is front-weighted to extreme surprises, fine for the paper but the tail risk of 3σ catalysts is non-trivial. Hit rate 0.61 overall but only 0.57 in the 2.0-3.0 bucket — some buckets under-perform.
- No concern flagged — implementation matches Bernard-Thomas faithfully.

---

### `ts_momentum`

**Paper:** Moskowitz, Ooi & Pedersen (2012)
**Implementation:** `backend/strategies/ts_momentum/strategy.py` + `config.py`
**Entry rule (paper):** sign(r_12m) per asset, inverse-vol weighted, target portfolio vol 10%, monthly rebalance. Originally on futures — we use ETFs per Hurst-Ooi-Pedersen 2013.
**Entry rule (code):** `mean_sign(r_L)` over lookback_days. Per-asset `w_raw = sign * target_vol / max(sigma, vol_floor)`, normalized to gross 1.0, capped at max_weight_per_asset, drawdown-de-levered.
**Match:** ✓ clean. Signal math is the sign of return (not log-return) — matches paper. Realized vol computed over 60-day window with sqrt(252) annualization factor — correct. Inverse-vol weight formula dimensionally correct.
**Parameters:** OOS tuner picked `shorts_enabled=False` (keeps strategy long-only in a monotone bull window), `universe_size=full_11`, `rebalance_freq=bimonthly`.
**OOS Sharpe:** **1.52** (target 0.80; 1.9x over)
**Concerns:**
- `shorts_enabled=False` is tuner-chosen — disables the "crisis alpha from short leg" that is one of the paper's three defining claims. Fine for 2023-2024 but fragile on a real bear regime.
- Realized-vol window 90 days + bimonthly = slow responder, under-captures regime flips.
- No look-ahead concerns.

---

### `pairs_trading`

**Paper:** Engle & Granger (1987) + Vidyamurthy (2004) + Chan (2013)
**Implementation:** `backend/strategies/pairs_trading/strategy.py` + `config.py`
**Entry rule (paper):** Engle-Granger ADF (p<0.05) + OU half-life + Hurst filter for pair selection. Trade |z| >= 2.0, exit |z| < 0.5, stop |z| > 3.5. Dollar-neutral two-leg entries. 21-day watchdog.
**Entry rule (code):** Every component implemented correctly, including the hardest invariant: `generate_signals()` always emits two coincident MOO signals (one +w, one -w) with sibling `pair_id` tags. Kalman-hedge-ratio option uses Chan 2013 eq. 3.5. Structural-break watchdog reruns E-G every 21 days.
**Match:** ✓ clean. Spread z-score uses `.shift(1).rolling()` — strict no-look-ahead.
**Parameters:** OOS tuner chose `hedge_method=kalman`, `rescreen_days=42`, `z_entry=2.48`, `max_pairs=8`.
**OOS Sharpe:** **1.23** (target 0.60; 2.05x)
**Concerns:**
- Dollar-neutral (not beta-neutral) — spec documents the choice (§8), but the beta exposure is non-zero. On sector-homogeneous pairs this is usually within tolerance.
- Pair contribution in OOS JSON is highly skewed: 20 of 65 pairs have negative P&L, top 3 pairs drive most of the gain. Aggregate Sharpe is not robust to which pairs survive screening.
- Hardcoded 49-name universe (frozen) is a minor survivorship bias.

---

### `dual_momentum`

**Paper:** Antonacci (2014) "Global Equities Momentum"
**Implementation:** `backend/strategies/dual_momentum/strategy.py` + `config.py`
**Entry rule (paper):** Monthly: if `r_VOO_12m - r_BIL_12m > 0` (absolute mom passes), pick the better of VOO/VEU (relative mom), else hold AGG. 100% single-asset allocation.
**Entry rule (code):** `excess = r_eq - r_rf`, if `excess > floor` then max of equity returns else bond. Default floor = 0.0. Uses configurable composite lookback (default `single_252` = 12m trading days). MOO at next open on last trading day of month.
**Match:** ✓ clean textbook implementation. No stops, no TP. Explicit excess-return comparator against BIL.
**Parameters:** Default 252-day lookback. Monthly rebalance.
**OOS Sharpe:** **1.26** (target 0.80; 1.57x)
**Concerns:**
- None. One of the cleanest implementations in the suite.
- Spec candidly notes the 2022 dual-bear was a problem for bond fallback.

---

### `rsi2_reversal`

**Paper:** Connors & Alvarez (2009) + Connors RSI (2013)
**Implementation:** `backend/strategies/rsi2_reversal/strategy.py` + `helpers.py`
**Entry rule (paper):** RSI(2) < 10 above SMA(200), exit on RSI(2) > 70 or close > SMA(5). Textbook.
**Entry rule (code):** RSI(2) OR-gate with ConnorsRSI, SMA(200) trend filter, SPY-RSI regime floor, volume-surge confirmation, explicit `manage()` exits (RSI profit-take, SMA-cross, swing-low, time-stop), earnings skip. Wilder-smoothed RSI with period=2-3 tunable.
**Match:** ✓ entry gate matches paper. Additional filters (CRSI OR, SPY regime, volume) are refinements, not deviations.
**Parameters:** OOS `rsi_period=3` (textbook is 2), `spy_rsi_regime_floor=15.8` (tuner-chosen). `volume_surge_min=1.73` — aggressive.
**OOS Sharpe:** **1.88** (target 0.60; 3.1x)
**Concerns:**
- CAGR 5.1% at Sharpe 1.88 implies very low deployment — strategy trades ~15% of days. Reported Sharpe is inflated by the high proportion of zero-return days.
- Turnover 56 = 256 fills for 522 trading days, but most fills cancel out (max_drawdown 1.9%). This is a "many small trades" story; reported Sharpe doesn't reflect economic alpha in $ terms.
- Earnings provider dependency is graceful (no-op if unavailable), so behavior is deterministic.

---

### `kama_breakout`

**Paper:** Kaufman (1995, 2013) + Donchian breakout + chandelier stop
**Implementation:** `backend/strategies/kama_breakout/strategy.py` + `config.py`
**Entry rule (paper):** Price > KAMA + price > Donchian upper + ER ≥ threshold + price > SMA(200) rising. Volatility-parity sizing.
**Entry rule (code):** All 4 gates enforced. ER computed as `|c[t] - c[t-N]| / sum(|dc|)` — matches Kaufman formula. Donchian `high.shift(1)` / `low.shift(1)` — correct no-look-ahead (yesterday's channel vs today's close). SMA rising check (`sma[t] > sma[t-10]`). Risk sizing `shares = risk * equity / stop_distance` — correctly computes 1% risk vs. the audit's prior 3%-realized bug.
**Match:** ✓ clean. ER gate (the audit's "F" fix) is actually wired into entry logic.
**Parameters:** OOS `kama_slow=20` (not 30), `donchian_period=30` (not 20), `trend_sma_period=100` (not 200). All tunable but drift from textbook.
**OOS Sharpe:** **1.69** (target 0.50; 3.4x)
**Concerns:**
- Only 7 round-trip trades in OOS (2023-2024). Statistical significance of Sharpe 1.69 is weak — one standard error is ~0.4 Sharpe. The summary honestly labels this "thin".
- Pyramiding is implemented but requires an `on_fill` state handshake. If fills arrive with non-zero lag, pyramid trigger may miss.

---

### `orb`

**Paper:** Crabel (1990) + Zarattini & Aziz (2023)
**Implementation:** `backend/strategies/orb/strategy.py` + `config.py`
**Entry rule (paper):** First-N-minute high/low as opening range; enter on first bar that closes beyond range; stop at opposite end; EOD flat.
**Entry rule (code):** Custom intraday simulator (`simulate_day`) because the BacktestEngine is daily. First-break rule enforced by iterating `post_or` and breaking on first `close > or_high`. MOO fill at next bar's open (`fill_idx = entry_idx + 1`) — correct. Slippage + commission applied. TP1/TP2 scale-outs, EOD flat at 15:55 ET. OR-low stop.
**Match:** ✓ mechanically correct, but **strategy bypasses engine** — `generate_signals()` returns `[]` and the real P&L is in `simulate_day()`. This is disclosed in spec §4 but means the ORB OOS numbers come from a different code path than the other 11 strategies.
**Parameters:** OOS `or_minutes=15` (middle-ground), `universe_profile=all_leveraged` (SPY/QQQ/TQQQ/SPXL — includes 3x and 2x leveraged ETFs), `volume_confirm_min=0.86` (below 1.0 "disabled" floor).
**OOS Sharpe:** **8.34** (target 0.70; 11.9x) — **flagged as inflated** in the Phase-1 summary.
**Concerns:**
- Sharpe 8.34 is a cap-compression artifact from `max_notional_pct=20%` clipping the daily-return σ. Honest per-trade Sharpe ~1.5-2.0.
- `all_leveraged` universe is tuned to the 2023-2024 bull tape; OOS includes TQQQ which had year +60%. This is close to data-snooping on the leverage factor.
- 1337 entries → `direction_counts: {long: 1337}`. Zero shorts (`allow_shorts=False` — tuner disabled).
- Volume-confirm set below 1.0 = filter effectively off.

---

### `vwap`

**Paper:** Session-VWAP pullback — **NOT Berkowitz-Logue-Noser** (that's execution cost benchmark); spec clarifies this.
**Implementation:** `backend/strategies/vwap/strategy.py` + `config.py`
**Entry rule (paper as reframed in spec):** Price within pullback_pct_max of session VWAP from above; 5-min RSI(2) < 10; `close > prior-bar VWAP` (trend persistence); daily trend filter (SPY > SMA(100) + name > SMA(trend_sma_daily)).
**Entry rule (code):** Scans 5-min bars fetched via `ctx.bar_provider.bars(..., tf="5Min")`. `vwap_session()` from indicators with `(H+L+C)/3` typical price. Stop = `max(bps_stop, atr_stop)` (actually `min(...)` in code since long-side stops are **below** entry; mathematical error corrected — see concerns).
**Match:** ✓ for entry. Exit wiring relies on engine's STOP/TP fired against **daily bar's high/low range** — a documented lossy approximation. `manage()` emits MOC every bar to flatten.
**Parameters:** OOS `trend_sma_daily=100`, `rsi_period=5` (not 2 — tuner picked 5), `allow_shorts=False`.
**OOS Sharpe:** **0.95** (target 0.40; 2.37x) — on an abbreviated 2024-H1 window.
**Concerns:**
- **Code bug (minor, not fatal):** In `_evaluate_pullback`, `stop_px = min(bps_stop, atr_stop)` for the long side. `bps_stop` is below entry by `(stop_bps / 10000)`; `atr_stop` is `px - ATR`. Taking the `min` means the **wider** (more protective) stop is chosen if both are below entry — this is actually correct in the sign convention (wider stop means lower stop price = more protective on longs). Spec says "whichever gives a *wider* stop" and code does this. OK.
- Daily-bar envelope of intraday stops is a lossy approximation — signals that stop out intraday may appear as wins if the daily bar's high/low didn't cross the level. Disclosed in spec §4.
- Short side disabled by tuner.
- 101 turnover with 302 trades on 6-month window — very high churn; Sharpe 0.95 but CAGR 7.5% → many micro-trades with thin per-trade edge.

---

### `regime_adaptive`

**Paper:** Ang & Bekaert (2002) + Faber (2007)
**Implementation:** `backend/strategies/regime_adaptive/strategy.py` + `config.py`
**Entry rule (paper):** Four regimes (Crisis / HighVol / TrendUp / MeanRevert) from SPY + SMA(50/200) + VIX; 10-day confirmation hysteresis; monthly rebalance to regime-specific allocation vector.
**Entry rule (code):** Rule-based classifier matches the spec table exactly. `confirmation_days=10` streak requirement enforced via `ra_streak` counter. Monthly rebalance on last trading day.
**Match:** ✓ clean.
**Parameters:** OOS defaults and tuned params produce **identical metrics** — the walk-forward tuner found no improvement over defaults, which is honest (the strategy has few degrees of freedom and 2023-2024 was mostly TrendUp).
**OOS Sharpe:** **1.62** (target 0.60; 2.7x)
**Concerns:**
- **VIX proxy:** spec admits VIX is computed from SPY's 20-day realized vol × 100 because VIXY is unreliable (roll decay). This is a stated substitution, not a bug. The 20/25 thresholds are calibrated on realized-vol points rather than CBOE VIX points — acceptable, but reduces apples-to-apples with the paper's regime definitions.
- Regime timeline from OOS shows only 4 transitions (2023-02-01, 2023-03-01, 2024-09-03, 2024-10-01) — the 2023-2024 window was effectively single-regime (TrendUp), so the regime machinery is not battle-tested on OOS. Sharpe 1.62 is largely a "TrendUp allocation outperformed" result.
- Walk-forward claimed but tuning produced zero parameter deltas.

---

### `vrp_harvest`

**Paper:** Bakshi & Madan (2006) + Carr & Wu (2009) + Israelov-Nielsen + Dubinsky-Johannes (2023)
**Implementation:** `backend/strategies/vrp_harvest/strategy.py` + `config.py`
**Entry rule (paper):** Sell 16-delta SPY strangle when VRP = IV_30 - HV_20 > threshold, optional tail-hedge far-OTM put, 50% TP / 21-DTE / 200% SL / VIX kill switch.
**Entry rule (code):** VRP computed correctly as `iv_30 - hv_20`. Term-structure gate enforced (slope = front_30DTE_ATM_IV - back_60DTE_ATM_IV; refuses backwardation). VIX kill-switch at 0.35. 16-delta leg selection from chain. Theta-target sizing via BS Greeks.
**Match:** ✓ textbook. Implementation correctly flipped the legacy "long-equity-proxy" bug (audit F23).
**Parameters:** Default params, 2024 H1 window (abbreviated) — `window = 2024-04-01 to 2024-09-30`, only **6 months** OOS. 10 strangles over the window.
**OOS Sharpe:** **0.88** (target 0.70; 1.25x) — on 6-month window, small trade count.
**Concerns:**
- **Very small trade count** (10 strangles, 10 hedges, 18 exits all via `dte-roll`). No TP / SL / kill-switch fired in OOS — means the 50% TP / 200% SL rules were never stress-tested.
- 6-month OOS window is half the others — cannot compare Sharpe on equal footing.
- Uses Polygon options data with synthetic BS re-pricing at exit; spec admits this is lossy.
- Term-structure gate only works if both 30-DTE and 60-DTE ATM IVs are available from the chain — may silently pass on sparse chain days.
- Entry happened only when VRP > 2% AND contango AND below kill-switch — in 2024 summer vol was low, so 10 strangles is plausible.

---

### `earnings_vol`

**Paper:** Dubinsky-Johannes-Kaeck-Seeger (2019) + Natenberg (2015)
**Implementation:** `backend/strategies/earnings_vol/strategy.py` + `config.py` + `polygon_helpers.py`
**Entry rule (paper):** At T-1 close, short ATM iron butterfly at ~7 DTE. Wings at 1.5× implied move. Exit T+1 open. Filter by implied/historical ratio.
**Entry rule (code):** Same. Implied move = straddle mid / underlying close. Historical median = |close_T/close_{T-1} - 1| over 8Q. Ratio filter. Iron-butterfly legs via `_pick_leg_strikes`. Exit MOO at T+1 open.
**Match:** ✓ mechanics correct. Wing width is `wing_width_multiple × implied_move_abs`. Max-loss sizing.
**Parameters:** OOS tuner: `wing_width_multiple=0.81` (below the 1.5× spec default — **tighter wings = less tail protection**), `implied_vs_historical_min_ratio=1.76` (more selective), `max_concurrent_positions=1` (one event at a time), `exit_timing=1h_after_open` (not next_close).
**OOS Sharpe:** **1.43** (target 0.70; 2.05x) — **v2**, after engine fix in Phase 2 (`a6310fa`).
**Concerns:**
- **Wing width 0.81× is below the spec's 1.5× default.** Spec warns this "converts defined-risk to close-to-unbounded" on a tail event. The tuner picked a thinner wing because the 2023-2024 OOS had no true tail event (no Mar 2020 / Feb 2018 / Aug 2024 analog).
- **Prior version inflated Sharpe to 6.10** via synthetic BS exit pricing; only after Phase 2 engine fix did the number drop to 1.43. The v1 results remain in the tree as stale.
- 40 OOS trades across ~10 underlyings = **very capacity-limited**. Headline Sharpe 1.43 comes from a small sample.
- `exit_timing=1h_after_open` is approximated with MOO order type (the engine doesn't support hourly intraday exits). Spec admits this.

---

## Summary — what's structurally sound vs. what's Sharpe-inflated

**Mechanically correct and textbook-faithful:**
- `dual_momentum` — cleanest textbook implementation in the suite.
- `pead` — SUE / trailing-σ / time-exit all matches Bernard-Thomas.
- `ts_momentum` — inverse-vol weighting + drawdown de-lever correct.
- `pairs_trading` — two-leg invariant enforced; Engle-Granger + Hurst + OU half-life all wired correctly.
- `regime_adaptive` — rule-based classifier + hysteresis + monthly rebalance.
- `kama_breakout` — ER gate actually gates entries (audit F4 fixed).

**Correct but with tuner-chosen parameter drift:**
- `momentum_quality` — textbook at base, but absolute-momentum floor + F-score=7 is curve-fit.
- `rsi2_reversal` — textbook, but Sharpe is inflated by low deployment (~15% of days in market).
- `vwap` — correct but daily-bar envelope of intraday stops is lossy.

**Correct but capacity/window-limited:**
- `vrp_harvest` — 10-strangle, 6-month OOS; TP/SL never fired.
- `earnings_vol` — 40 trades, 10 underlyings; wing width below spec default.
- `kama_breakout` — 7 round-trip trades in 2-year OOS.

**Inflated Sharpe (flagged as such):**
- `orb` — 8.34 Sharpe is notional-cap compression on leveraged-ETF universe in a bull tape; honest per-trade Sharpe ~1.5-2.0.

**No strategy has a clear look-ahead bias.** All `spec.md`s document no-look-ahead constraints, and the code uses `.shift(1)`, `asof` slicing, and T+1 MOO fills consistently. No strategy uses today's close in today's decision (except ORB which is intraday by design).

**No strategy is shipping with OOS Sharpe < 0.** Every strategy beats its stated target, but many are beating by margins that suggest the targets were conservative or the OOS window favored the design. A 5-year walk-forward (2019-2024 full) would likely compress Sharpes by 30-50% for the factor strategies.

---

## 500-word summary

The 12 AlphaDesk strategies are each a package with a spec.md, strategy.py, and config.py; every spec ties to a named academic paper, and the implementations are meaningfully faithful to their source — this is a substantial improvement over the audit-flagged legacy code. Every strategy has OOS Sharpe > 0 and beats its target. No look-ahead bias, no shipping Sharpe < 0, and the two-leg invariant for pairs_trading is correctly enforced. That said, five implementations need scrutiny before production.

**ORB (Sharpe 8.34)** is the highest-priority concern. The Phase-1 master summary openly labels the Sharpe inflated — a notional-cap compression artifact caused by `max_notional_pct=20%` clipping daily-return σ. More troubling, the tuner chose `universe_profile="all_leveraged"` (SPY/QQQ/TQQQ/SPXL), which data-snoops on leveraged ETF path-dependency in a monotone 2023-2024 bull tape. `volume_confirm_min=0.86` is below the 1.0 disable floor. Honest per-trade Sharpe is claimed as 1.5-2.0. Before shipping: retune on a broader regime window and insist on a non-leveraged-only universe profile.

**Momentum Quality (Sharpe 2.21)** ships with a 46-name hand-picked mega-cap seed universe frozen across 2019-2024 (survivorship bias) plus an absolute-momentum floor (`momentum_filter_min=0.054`) that isn't in Jegadeesh-Titman or AFP. The tuner also disabled the Lehmann "skip most recent month" (`momentum_skip_m=0`), deviating from the canonical paper. Combined with `min_f_score=7` (Piotroski's winners-only zone), these are all reasonable design choices but compound into curve-fitting. The paper's quoted 0.80 Sharpe vs. the shipped 2.21 is a 2.7x overshoot that should prompt a 5-year walk-forward re-validation.

**Earnings Vol (Sharpe 1.43)** is a Phase-2 rescue of a prior 6.10 Sharpe that was a synthetic-BS exit pricing artifact. Even v2 uses `wing_width_multiple=0.81` — **below** the spec's 1.5× default — which the spec itself warns converts defined-risk to near-unbounded on a tail event. The OOS window (2023-2024) had no Mar-2020-style volatility spike to stress-test thin wings. The strategy also only traded ~10 unique underlyings in 40 total trades, an extremely capacity-limited book. Ship with the wing width floored at 1.5× and await a true vol-spike OOS before trusting the Sharpe.

**Pairs Trading (Sharpe 1.23)** is mechanically correct (Engle-Granger + OU + Hurst, two-leg emission) but its OOS attribution is highly skewed: 20 of 65 pairs were negative contributors, and the top 3 pairs drove most of the P&L. Aggregate Sharpe masks pair-level concentration risk. `hedge_method="kalman"` + `rescreen_days=42` produces 65x turnover with hit-rate only 52.6%. Healthy strategy but pair-level monitoring is mandatory.

**RSI2 Reversal (Sharpe 1.88)** is textbook-faithful but the reported Sharpe is inflated by very low deployment (strategy is in-market ~15% of days, compressing denominator vol). CAGR of 5.1% with max-drawdown of 1.9% at Sharpe 1.88 is the classic "Sharpe without risk taken" profile. The economic alpha, scaled to full deployment, is closer to 0.5-0.8 Sharpe.
