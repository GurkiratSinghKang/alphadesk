# Earnings Volatility (Short-Vol Iron Butterfly)

## Thesis

Around earnings, implied volatility in the front-week options is systematically
elevated relative to the volatility actually realised after the print. The
earnings cycle produces a predictable two-part pattern: (i) implied vol
**ramps** into the report as demand for hedging and speculative straddles
pushes front-week IV well above the realised distribution; (ii) within
minutes of the next session's open, implied vol **crushes** to the
post-event norm even if the stock moves substantially.

The classic short-vol earnings trade harvests the crush. A **short iron
butterfly** — short ATM call + short ATM put + long OTM wings at ±N × the
implied move — collects a large net credit on the short body, pays a small
premium for the wings, and defines risk at the wing width. Holding **only
overnight** captures the pure vega discharge without exposing the book to a
second day of gamma and drift.

## Academic grounding

| Reference | Contribution to this design |
|---|---|
| Beckers (1981), *Variances of Security Price Returns Based on High, Low, and Closing Prices*, JoB | Establishes high-low range as a lower-variance estimator of true realised vol than close-to-close, useful when comparing 1-day earnings moves to 8Q of history. |
| Ederington & Lee (1996), *The Creation and Resolution of Market Uncertainty*, JFQA | Documents the IV run-up before scheduled announcements and the crush immediately after — the core micro-structure this strategy exploits. |
| Einhorn (2011), *Options and the Volatility Term-Structure*, industry note | Describes the event vol term-structure front-weighting that makes short-DTE (≤2 weeks) positions the best vehicle for an IV-crush trade. |
| Gao, Xing & Zhang (2018), *What Does the Individual Option Volatility Smirk Tell Us about Future Equity Returns?*, RFS | Cross-sectional evidence that option-implied uncertainty around earnings systematically over-states the realised single-name response. |
| Dubinsky, Johannes, Kaeck & Seeger (2019), *Option Pricing of Earnings Announcement Risk*, RFS | The central paper: develops a parametric model that decomposes option prices into a "diffusive" and an "event" component and shows that the event premium is empirically mispriced. They find short-straddle returns around earnings are positive on average with an elevated (but not unbounded) left tail. |
| Natenberg (2015), *Option Volatility and Pricing*, 2e, ch. 18–19 | Standard desk handbook for defined-risk earnings trades — iron fly / iron condor sizing, wing choice, and exit discipline used here. |

The strategy **is not** a naked straddle seller. Dubinsky et al. (2019)
and subsequent practitioner work (ORATS, CBOE VRP series) make clear that
the unprotected trade has a negative-tail-skewed P&L distribution with a
4-6× left tail when the name gaps hard. Wings at 1.5× the implied move cap
the worst case at the wing width minus the collected credit — small enough
that single-event shocks cannot destroy the book.

## Rules

### Candidate detection
At the **close of session T-1**, pull the FMP earnings calendar for
session T. Filter to:

1. **Earnings timing** — event must be after-market-close on T or
   before-market-open on T+1 (configurable; `after_close_only` is stricter).
2. **Universe** — hardcoded 30-name list of names with liquid weekly
   options: mega-cap tech + major financials + a handful of healthcare /
   energy / semis. Polygon options-chain bandwidth constrains us; a fixed
   universe keeps the strategy reproducible and the cache foot-print flat.
3. **Underlying price** ≥ `min_underlying_price` (default $30) so
   percentage moves translate to meaningful absolute moves and the
   chain has reasonable strike granularity.

### Signal computation
For each candidate:

1. **Implied move** — pull the chain snapshot as-of T-1 close. Select
   the expiration closest to `dte_target` days out (default 7). At the
   ATM strike, price the straddle (call mid + put mid). The implied
   move is `straddle_price / underlying_close`.
2. **Historical move** — compute `|close_T / close_{T-1} - 1|` on the
   last `historical_moves_lookback_quarters × 1` earnings events
   (default 8). Use the 8-quarter median. If fewer than 4 historical
   events are observable, **skip the name**.
3. **Richness ratio** — `implied_move / historical_move`. Require
   `≥ implied_vs_historical_min_ratio` (default 1.2). Below this, the
   market is not over-pricing the event by enough for the trade to have
   expected edge net of slippage and commissions.

### Entry — short iron butterfly
On session T-1 close, emit a single Signal with 4 OptionLegs:

| Leg | Side | Strike | Right |
|---|---|---|---|
| Body call | SELL | ATM (K₀) | C |
| Body put  | SELL | ATM (K₀) | P |
| Wing call | BUY  | K₀ + w × expected_move | C |
| Wing put  | BUY  | K₀ − w × expected_move | P |

where `w = wing_width_multiple` (default 1.5) and expected_move is the
absolute straddle price ($, not %). Expiry is the first standard option
expiration at or beyond `dte_target` calendar days from T-1. Order type
is MOC (fill at T-1 close).

### Sizing
Maximum loss per trade = `max_loss_pct_per_trade` × equity
(default 2%). Maximum loss is `wing_width × 100 − net_credit`, so

```
max_contracts = floor( equity * max_loss_pct /
                       (wing_width * 100 - net_credit_per_spread) )
```

clamped to `≥1`. Additionally, a `max_concurrent_positions`
cap (default 5) caps cluster risk during earnings weeks.

### Exit
On session T (or T+1 if earnings were after-close on T) at the
**next open**: emit a closing Signal for all 4 legs (MOO). The vol
crush has already happened by the opening print; holding past then
adds gamma risk without fresh vega discharge. Configurable via
`exit_timing` (default `next_open`, alternatives `1h_after_open`,
`next_close`).

### Skip filters
- **Thin wings** — if the chain's bid-ask on either wing > 10% of the
  mid, skip. Illiquid wings blow up the round-trip cost.
- **Underlying price < `min_underlying_price`** — skip.
- **Earnings during market hours** — skip (IV pattern is muddied when
  the name trades with fresh news for half the session).

## Why this is small

This is a **capacity-constrained** strategy by design. Single-name weekly
options have limited depth on the short strikes, a fixed 30-name universe
only sees ~200 earnings events per year, and the richness filter knocks
40-60% of those out. A disciplined book produces 50-100 trades per year
with Sharpe in the 0.5-1.0 range (Dubinsky et al.'s headline number, with
defined-risk sizing).

Without the historical-move filter the strategy is mediocre — it sells vol
on names where IV is not actually rich versus realised, and the left tail
dominates. The ratio-filter is the entire edge.

## Honest caveats

- **Polygon Options Developer tier lacks historical-IV time-series.** We
  compute IV via chain mid and BS inversion at entry and repricing is
  handled by our synthetic BS model during the hold (the engine's
  options fill plumbing assumes a net per-spread fill; we therefore
  compute the overnight P&L in-strategy using BS pricing with an
  assumed post-event IV crush of 40-60%).
- **Earnings-date drift** in FMP's calendar is non-zero (~2-5% of names
  have their date slip by ±1 day). We accept this cost; a confirmed-only
  feed would help marginally.
- **2020 Q1 regime** — the March 2020 vol explosion is a known failure
  mode for any short-vol book. Walk-forward results include this period;
  expect a visible drawdown.
- **AI-boom outliers** — NFLX, NVDA, META have produced 3-6σ earnings
  realisations multiple times in 2022-2024. The wing-width multiplier is
  the guard; we still take losses on those events, but the wing caps the
  damage at the defined max.

## Files

- `strategy.py` — the implementation.
- `config.py` — defaults + Optuna search space + fixed universe list.
- `tests/test_strategy.py` — unit tests for implied-move computation,
  historical-move computation, leg selection, multi-leg Signal shape,
  next-open exit, and the after-close-only earnings filter.
