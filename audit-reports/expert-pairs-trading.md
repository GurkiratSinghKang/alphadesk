# Expert Audit — `pairs_trading` Strategy

**Auditor persona:** Stat-arb quant (Engle-Granger 1987, Vidyamurthy 2004, Gatev-Goetzmann-Rouwenhorst 2006, Avellaneda-Lee 2010, Do-Faff 2012, Chan 2013).
**Scope:** `backend/strategies/pairs_trading/{spec.md,strategy.py,config.py}`, `backend/indicators/stats.py`, `backend/data/oos/phase1-pairs_trading-oos.json`.
**Date:** 2026-04-18.

---

## 1. Cointegration test

Engle-Granger ADF is implemented correctly in `backend/indicators/stats.py:162-195`: OLS fit with intercept, then `statsmodels.tsa.stattools.adfuller(residuals, autolag="AIC")`. The p-value gate at `strategy.py:354` (default `adf_pvalue_max=0.05`, OOS-tuned to 0.032) is standard.

**Gaps:**
- **No KPSS counter-test** (confirmed via Grep — zero references in the codebase). Engle-Granger rejects the unit-root null; KPSS tests the stationarity null. The textbook defense against low-power ADF on short windows (252 bars) is to require ADF reject AND KPSS fail-to-reject. Missing.
- **No Johansen test.** For multi-asset cointegrating baskets (e.g. 3-leg energy trades) Johansen dominates E-G. Not fatal for 2-leg pairs but a ceiling on extensibility.
- **Asymmetric regression direction.** `all_within_sector_pairs()` (`config.py:80-95`) fixes `y = alphabetically-first`, so BAC regresses on GS but never the reverse. E-G residuals and hedge ratios are direction-sensitive; running both orderings and taking the lower p-value is the standard remedy (see Chan 2013 §3.5, pp.68-71).

## 2. Hurst + OU half-life

Hurst via variance-of-increments log-log regression (`stats.py:120-156`) is the Chan-standard technique, not R/S. The `hurst_max=0.45` gate at `strategy.py:368` gives a `|H-0.5|>0.05` buffer — modest. Rigorous texts (Peters 1994) use 0.40 for stronger mean-reversion selection. OU half-life via the discretised AR(1) `Δx = α + β·x_{t-1}` with `hl = -ln2/β` (`stats.py:86-113`) is textbook-correct. Half-life cap 30 days is tight enough to exclude quasi-random pairs but loose enough to admit multi-week mean-reverters.

## 3. Z-score thresholds

`z_entry=2.0, z_exit=0.5, z_stop=3.5` — exactly the Chan 2013 §3.3 band. OOS-tuner drift to `z_entry=2.48, z_exit=0.70, z_stop=4.73` is a reasonable adaptive widening given 2023-24's post-Fed-pivot dispersion. Rolling z at `strategy.py:557-559` uses `.shift(1).rolling(z_window)` — strict no-look-ahead. Correct.

## 4. Log vs raw price spread (persona-25 flag)

**Confirmed.** `strategy.py:555` computes `spread = df_trim["y"] - betas * df_trim["x"]` on raw closes. The spec (§3.3) states log-prices are applied "only when `hedge_method='kalman'`" — but the code path **never** applies `np.log()`. Config knob `prices_in_log_space` is documented in prose but not present in `DEFAULTS`. This is a real deviation from Engle-Granger orthodoxy (Chan 2013 §3.5 explicitly uses `log(y) - β·log(x)`). Impact: when individual leg levels drift (AAPL 150→200), the raw hedge ratio β re-scales with levels, so the "stationary" residual acquires level-dependent heteroskedasticity. Moderate concern — papers over with Kalman dynamic β, but OLS mode is mis-specified.

## 5. Hedge ratio & Kalman

Kalman implementation at `stats.py:226-292` is the Chan 2013 eq. 3.5 random-walk state-space formulation with `δ/(1-δ)·I` process noise. Correct. Optimisation amortises one Kalman fit per pair per rescreen via `pair.kalman_betas` caching (`strategy.py:401-421`) — good. OLS mode freezes β at rescreen and drifts for 42-63 days between refreshes — the prior audit's concern is valid.

## 6. Universe & rescreen cadence

49 mega-caps across 6 sectors = 149 within-sector candidate pairs. Hard-coded, no Consumer Staples (KO/PEP absent — persona-25 finding confirmed), no ETFs (XLE/XOP, GLD/SLV missing). Rescreen at 42 days (OOS-tuned) with `max_pairs=8` → 63-day implicit max holding and 21-day watchdog. OOS `turnover=65×` on `hit_rate=52.6%` with `profit_factor=1.16` is characteristic of a low-edge stat-arb regime (Do-Faff 2012 documents 2003-2009 Sharpe 0.4-0.6 post-costs — OOS Sharpe 1.23 here is above the Do-Faff band, suggesting cost model may be understating borrow/slippage for 1003 fills).

## 7. Concentration

Top 3 pairs (DHR-LLY, META-NVDA, COST-TGT) = $4,680 PnL on $10,042 total = **46.6% of gains from 3 of 65 pairs**. Bottom 5 losers cost $4,717. Distribution is P&L-concentrated — kill the top 3 and the strategy is flat. Persona-25's flag is verified.

---

## Verdict

**CONDITIONAL PASS.** Backend is genuinely rigorous and fixes the legacy single-leg defect. Remaining issues: (1) **raw-price spread** diverges from the spec's cited log-price formulation — fix `strategy.py:555` to `np.log(y) - β·np.log(x)` by default; (2) **no KPSS counter-test** on cointegration — add `statsmodels.tsa.stattools.kpss` and require ADF-reject AND KPSS-fail-to-reject; (3) **hurst gate is lenient** at 0.45 — tighten to 0.40; (4) **P&L concentration** masks per-pair drawdown — log pair-level drawdown in tearsheet. OOS Sharpe 1.23 is unusually strong for this asset class; re-run with realistic 5-10bps slippage + IBKR borrow curve before accepting.
