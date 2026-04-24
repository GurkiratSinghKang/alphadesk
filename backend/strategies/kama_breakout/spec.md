# KAMA Breakout — Academic Specification

**Author:** AlphaDesk Wave A strategy team
**Date:** 2026-04-17
**Target Sharpe (OOS 2023–2024):** 0.50
**Category:** Equity trend-following, long-only

---

## 1. Thesis

Equity index and sector prices exhibit regime-dependent momentum: during directional
regimes, cross-bar autocorrelation is positive and a price trend tends to persist;
during choppy regimes, cross-bar autocorrelation is zero or negative, and a "trend"
signal is noise. A pure breakout system ignores this regime structure and suffers
whipsaws. A pure adaptive moving-average (KAMA) slows itself in chop but does not
itself time entries. **The combination is the edge**: use KAMA to detect that
chop has ended, use a Donchian N-day high to time the entry, gate on the Kaufman
Efficiency Ratio (ER) so we only act in genuinely trending regimes, and overlay
a secular trend filter (200-SMA) so we never fight the macro tape.

The strategy harvests **compensation for bearing regime risk** — payoff is positively
skewed by construction (trailing stop, no hard take-profit), but the strategy lets
losers cut itself fast via the ER gate going cold and the chandelier exit ratcheting
up behind price.

## 2. Academic lineage and citations

| Component | Source |
|---|---|
| Efficiency Ratio, KAMA | Kaufman, P. J. *Smarter Trading* (McGraw-Hill, 1995), ch. 6; *Trading Systems and Methods* (Wiley, 5th ed. 2013), ch. 17. |
| Donchian N-day breakout | Donchian, R. "Donchian's 5- and 20-day moving averages," *Commodities*, 1960; canonicalised in the Turtle system (Dennis & Eckhardt, 1983). |
| Turtle risk sizing (1 % / N) | Faith, C. *Way of the Turtle* (McGraw-Hill, 2007); Covel, M. *The Complete TurtleTrader* (HarperBusiness, 2007). |
| Chandelier trailing stop | LeBeau, C. & Lucas, D. *Technical Traders Guide to Computer Analysis of the Futures Markets* (1992); popularised via LeBeau's "Traders Club". |
| 200-SMA secular-trend filter | Faber, M. "A Quantitative Approach to Tactical Asset Allocation," *J. Wealth Management*, 2007 (updated 2013). |
| ATR volatility-parity sizing | Wilder, W. *New Concepts in Technical Trading Systems* (Trend Research, 1978). |

## 3. Formal rules

### 3.1 Universe

- Core: S&P 500 constituents **plus** top sector/factor ETFs
  {SPY, QQQ, IWM, XLE, XLF, XLK, XLV, XLI, XLP, XLU, XLY, XLB, XLRE, XLC}.
- For the Wave-A first cut the default universe is the ETF basket only (broad,
  deep, always-liquid, no point-in-time survivor bias question). Strategy accepts
  a `universe_symbols` param for a curated list.
- Filter: 20-day average dollar volume > $20 M and last close > $10.

### 3.2 Indicators (all computed from the engine `bar_provider` via
`backend.indicators`)

- `KAMA(close, er_period, fast, slow)` — Kaufman textbook defaults
  **ER period 10, fast 2, slow 30**. Reference: `backend/indicators/trend.py::kama`.
- `ER_t` = Kaufman Efficiency Ratio over `er_period` bars =
  `|close_t − close_{t−N}| / Σ_{i=t−N+1..t} |Δclose_i|`. Range [0, 1]. We read
  this off the KAMA internals by recomputing the numerator and denominator
  directly from the same bars (cheap: O(N)).
- `Donchian(high, low, period)` — upper/middle/lower channel. Reference:
  `backend/indicators/trend.py::donchian`. Default period 20 (classic Turtle).
- `ATR(high, low, close, period)` — Wilder ATR. Default period 22 (one trading
  month, matches the chandelier window).
- `SMA_200(close)` — the secular-trend filter. The single biggest Sharpe
  contributor according to the audit; period 200 by convention (Faber).
- *(Optional)* `volume_SMA_20(volume)` for the per-name volume-surge gate.

### 3.3 Entry rule (long)

All of the following must be true on the *close of bar T* for a MOO (market on
open) order at T+1:

1. `close > KAMA` — price is above the adaptive MA.
2. `close > Donchian_upper_{T−1}` — today's close takes out the Donchian high
   computed *excluding today* (uses `period` bars up to T−1 so we don't cheat
   by comparing the channel to itself).
3. `ER ≥ er_min_trend` (default **0.30**) — the regime is trending. *This is
   the fix the audit flagged — in the legacy code the ER was computed and
   logged but never gated*.
4. `close > SMA_200` and `SMA_200` is rising vs 10 bars ago — macro tape is up.
   *This is the secular-trend filter missing from the legacy code and the
   single biggest Sharpe contributor per the audit.*
5. Per-name earnings-window gate: skip if the symbol has scheduled earnings
   within ±2 trading days (read via `ctx.earnings_provider`; degrade
   gracefully to "no gate" if the provider is unavailable).
6. *(Optional, off by default for ETFs)* volume > `volume_surge_min × volume_SMA_20`.
   Turned on via the `volume_surge_enabled` param for single-name universes.

### 3.4 Exit rules (OR semantics; whichever binds first)

- **Chandelier trailing stop:** `stop_T = highest_high_{T, T−22} − atr_mult × ATR`.
  Default `atr_mult = 3.0`. The stop is updated daily and monotonically non-
  decreasing once the position is open (Gwinner / LeBeau's "ratchet" rule).
- **KAMA crossunder:** `close < KAMA`. Fast exit signal that catches regime
  flips earlier than the chandelier does.
- **No hard take-profit.** Trend strategies harvest the positive-skew tail via
  trailing stops; capping upside with a static TP is exactly the anti-trend
  behaviour the audit flagged in the legacy 9-ATR target.

### 3.5 Sizing — volatility parity, 1 % risk per trade

For each new entry we target 1 % of current equity as the *maximum drawdown per
trade if the stop is hit*:

```
stop_distance = atr_mult × ATR   (dollars per share)
shares        = floor( risk_per_trade × equity / stop_distance )
```

This is the **correct** 1 %-per-trade calc. The audit flagged that the legacy
code wrote `shares = 0.01 × equity / ATR` but placed the stop 3 ATR away, so
the realised risk per trade was 3 %. We use the stop distance explicitly.

After sizing we cap the position's notional at `max_allocation × equity`
(default **15 %**) — this binds in low-vol regimes where the raw Turtle calc
would otherwise ask for too many shares.

### 3.6 Pyramiding

Mirrors Turtle rule 4 but softened to one extra unit (half-size):

- After the entry fill, if price advances by `+1 × ATR_at_entry` and the
  position is still net positive, add **half** the original share count. The
  add re-enters at market open of the next bar.
- Total notional across entry + pyramid is capped at `max_allocation × equity`.
- Pyramid is disabled if `pyramid_enabled=False`.

### 3.7 Portfolio constraints

- Max simultaneous positions = 8 (`max_positions` param).
- Max single-name allocation = 15 % of equity.
- Long-only by construction. Bearish-branch code is absent (the audit called
  the legacy dead code a "trap for future maintainers" — we delete rather than
  disable).

## 4. Why ER-gating is the *fix*

The legacy strategy computed ER and **logged it**. Kaufman's entire motivation
for ER is that KAMA alone adapts its *speed* to trend strength, but a breakout
system needs an explicit *go/no-go* on trend quality at entry time. Without
the gate, every micro-rally past the upper channel fires a signal; with the
gate (`ER ≥ 0.30`), only moves where at least 30 % of the net period return
is coming from the direction of travel fire. On SPY 2019–2024 this roughly
halves the trade count and materially improves per-trade expectancy because
the filtered-out trades are disproportionately chop-regime whipsaws.

## 5. Parameters

See `config.py::DEFAULTS` and `search_space()`. Defaults are Kaufman-textbook;
search ranges are wide enough for Optuna to find the regime-optimal tuning
without overfitting (see the per-parameter rationale in that module).

## 6. Known limitations

1. **Single-asset-class.** Equity-only, no bonds/commodities/FX — diversified
   futures is where breakout systems historically earn Sharpe > 1. Equity-only
   breakout tops out around Sharpe 0.5, which is our target.
2. **Point-in-time constituents.** Default universe is ETFs only; extending to
   S&P 500 constituents requires a PIT membership table to avoid survivorship
   bias. Out of scope for Wave A.
3. **Earnings window** degrades to "no gate" if `ctx.earnings_provider` is
   absent. In production this means live paper-trading should wait until the
   FMP earnings adapter is wired; backtests before 2026 use it if available.
4. **Slippage model.** The engine's default cost model applies a percentage
   slippage; a breakout system's true slippage is state-dependent (worse on
   gap-up breakouts). We accept the default until the tuner reveals whether
   it matters.

## 7. Files in this package

- `strategy.py` — the `Strategy`-protocol implementation + `@register_strategy`.
- `config.py` — defaults and `search_space()`.
- `tests/test_strategy.py` — unit tests with a fake bar provider.
- `spec.md` — this document.


## Migration note (2026-04-24 SOTA shell)

This strategy was migrated from the legacy `generate_signals(asof, ctx)` /
`manage(asof, ctx)` API to the unified `run(input, params) → StrategyResult`
pure-function contract. Academic rationale unchanged; only the shell
changed. See [`docs/STRATEGIES.md`](../../../docs/STRATEGIES.md) for the
new protocol reference and
[`docs/superpowers/plans/2026-04-22-strategy-sota-foundation.md`](../../../docs/superpowers/plans/2026-04-22-strategy-sota-foundation.md)
for the migration design.

Key behavioral notes:

- Parameters are now a Pydantic `<Name>Params(StrategyParams)` model
  (typed, validated, JSON-Schema-exportable). Import from
  `strategies.<name>.config`.
- Reproducibility metadata (`git_sha`, `param_hash`, `snapshot_root`,
  `seed`, `run_at`, `strategy_name`, `runner_version`) is attached to
  every `BacktestResult`.
- Invoke the strategy CLI via `python -m strategies.<name> <subcommand>`.
- Per-run state lives on `input.state` and flows back through
  `StrategyResult.state_update` + the optional `on_fill` return dict;
  no instance mutation.
