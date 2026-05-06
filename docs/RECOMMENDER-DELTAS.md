# Recommender Delta Selection

The earnings recommender (`backend/services/earnings_recommender.py`) picks
strike deltas from three independent regimes — DTE bucket, Claude confidence,
and IV rank — instead of the historical hardcoded 0.20Δ short / 0.10Δ long
defaults. This document covers what the regimes do, why these specific
thresholds were chosen, and how to override them via Settings.

## Three regimes

### 1. DTE bucket — controls baseline delta

| DTE band | Iron condor short | Iron condor long | Iron butterfly wing | Notes |
| --- | --- | --- | --- | --- |
| **Earnings** (DTE ≤ 10) | **0.16** | **0.08** | 0.6× implied move | Tighter for higher win rate |
| **Standard** (10 < DTE ≤ 35) | **0.20** | **0.10** | 1.0× implied move | Balanced default |
| **Long-dated** (DTE > 35) | **0.25** | **0.12** | 1.0× implied move | Wider for more credit |

Why these breakpoints:

- TastyTrade Research backtests on 7-DTE earnings condors find win-rate ×
  avg-credit peaks at the 0.16Δ-short configuration. Above 0.20Δ the wider
  short collects more credit per attempt but the strike is too close to spot
  for a single-event move; the loss-adjusted EV is worse.
- For 30+ DTE indices, 0.20Δ remains the canonical TastyTrade default — long
  enough that the implied terminal-distribution width matches the strike
  selection.
- For long-dated >35 DTE we widen to 0.25Δ because theta has time to absorb
  wider losses; the credit collected is meaningful and the short is far from
  current spot in vol-time.

Wings track at half the short delta so the wing/short ratio is preserved
across the bands.

### 2. Confidence — widens or restores baseline

| Confidence band | Behaviour |
| --- | --- |
| `< RECOMMENDER_LOW_CONFIDENCE_THRESHOLD` (default 0.55) | Multiply iron-condor delta by `RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR` (default 0.7). Drop credit verticals from 0.30 to 0.20 short. **Suppress iron butterflies entirely** (they pin-bet on a tight ATM range). |
| `≥ RECOMMENDER_HIGH_CONFIDENCE_THRESHOLD` (default 0.75) | No widening — use the DTE-bucket baseline. |
| Between 0.55 and 0.75 | Use the DTE-bucket baseline (no adjustment). |

Why these knobs:

- Sosnoff/Battista backtests on low-conviction credit verticals find 0.20Δ
  short beats 0.30Δ on Sharpe — the wider strike costs less when wrong, and
  the aggregate edge over many trades is positive even though per-trade
  credit is smaller.
- On iron condors, multiplying the band by 0.7 moves 0.20 → 0.14 and 0.10 →
  0.07; both shorts and wings widen so the structure remains a valid condor
  with proportionally lower POP-weighted credit.
- Iron butterflies require pin-the-stock conviction. We suppress the
  candidate below the low-confidence threshold so the recommender does not
  lead with a structure the analyst has not earned the right to trade.

### 3. IV rank — fine-tune for vol regime

| IV rank | Multiplier |
| --- | --- |
| `> RECOMMENDER_IV_RANK_HIGH_THRESHOLD` (default 80) | × `RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR` (1.10) — slightly tighter, more credit |
| `< RECOMMENDER_IV_RANK_LOW_THRESHOLD` (default 30) | × `RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR` (0.85) — slightly wider, prefer long-vol structures |
| 30–80 | No adjustment |

Above IV rank 80 the IV crush bonus offsets some of the upside loss when
spot blows through the wider short. Below 30 the credit is too thin for the
risk; the regime classifier already routes us toward calendar / debit
spreads, so the recommender layers a small extra widening as a defence.

## Composition

The three regimes compose multiplicatively. Concrete example:

- Earnings DTE = 3, low confidence (0.40), high IV rank (90):
- Iron condor short: `0.16 × 0.7 × 1.10 = 0.123` ≈ 12Δ short
- Iron condor long: `0.08 × 0.7 × 1.10 = 0.062` ≈ 6Δ wing

For credit verticals the confidence adjustment is a discrete step (0.30 →
0.20) instead of a multiplier — the research result is empirical, not a
multiplicative tweak — but the IV-rank adjustment still multiplies on top.

## Settings overrides

All thresholds and factors live on the existing `Settings` class
(`backend/core/config.py`) and follow the same `EARNINGS_IV_RICH_THRESHOLD`
pattern. Override via environment variables in `.env` or container env.

```python
# DTE band breakpoints
RECOMMENDER_DTE_EARNINGS_MAX: int = 10
RECOMMENDER_DTE_STANDARD_MAX: int = 35

# Iron condor delta tables
RECOMMENDER_IRON_CONDOR_SHORT_DELTA_EARNINGS: float = 0.16
RECOMMENDER_IRON_CONDOR_SHORT_DELTA_STANDARD: float = 0.20
RECOMMENDER_IRON_CONDOR_SHORT_DELTA_LONG_DATED: float = 0.25
RECOMMENDER_IRON_CONDOR_LONG_DELTA_EARNINGS: float = 0.08
RECOMMENDER_IRON_CONDOR_LONG_DELTA_STANDARD: float = 0.10
RECOMMENDER_IRON_CONDOR_LONG_DELTA_LONG_DATED: float = 0.12

# Confidence bands
RECOMMENDER_LOW_CONFIDENCE_THRESHOLD: float = 0.55
RECOMMENDER_HIGH_CONFIDENCE_THRESHOLD: float = 0.75
RECOMMENDER_LOW_CONFIDENCE_DELTA_WIDEN_FACTOR: float = 0.7

# IV-rank fine tuning
RECOMMENDER_IV_RANK_HIGH_THRESHOLD: float = 80.0
RECOMMENDER_IV_RANK_LOW_THRESHOLD: float = 30.0
RECOMMENDER_HIGH_IV_DELTA_TIGHTEN_FACTOR: float = 1.10
RECOMMENDER_LOW_IV_DELTA_WIDEN_FACTOR: float = 0.85
```

Example: bump the earnings short delta to 0.18Δ if your post-deploy data
disagrees with the TastyTrade 0.16Δ result without redeploying:

```bash
export RECOMMENDER_IRON_CONDOR_SHORT_DELTA_EARNINGS=0.18
```

## Where this fires

Builder hooks in `earnings_recommender.py`:

- `_build_iron_condor` — both short and long deltas via the selectors
- `_build_iron_butterfly` — wing factor via `_butterfly_wing_em_factor`,
  suppression via `_should_avoid_iron_butterfly`
- `_build_short_strangle` — short delta via the iron-condor selector
- `_build_bear_call_spread`, `_build_bull_put_spread` — short / long via the
  vertical selectors

Out of scope for this layer (different concerns):

- The regime classifier (`_classify_regime`) — controls *which* setup family
  to consider, not the strike within it.
- The `empirical_pop` POP path and Kelly sizing — those operate on the
  finalised legs the selectors produce.

## Strike preference (Wave V — V4)

The selectors above pick a *target* delta. The actual contract chosen at
that target comes from `find_strike_by_delta` (and, when liquidity gating
is wired up via `find_liquid_strike_by_delta`, that picker too). Both
pickers now apply preference scoring on top of delta matching.

> **Strike preference**: When multiple strikes are within ±0.03Δ of
> target, prefer the one with higher OI + volume. Rationale: established
> OI means tighter spreads, faster fills, and easier exits — especially
> on long protective wings of iron condors and verticals.

### Scoring

Each delta-acceptable candidate (within `RECOMMENDER_DELTA_TOLERANCE`,
default ±0.03) gets a score in `[0, 1]`:

```
score = delta_closeness * 0.50  (default — tunable via Settings)
      + oi_normalised   * 0.30
      + volume_normalised * 0.20
```

| Component | Calculation | Notes |
| --- | --- | --- |
| `delta_closeness` | 1.0 at target, 0.0 at the ±tolerance boundary, linear | Floor at 0 outside tolerance |
| `oi_normalised` | 0 → 0.0, 200 → 0.5, ≥1000 → 1.0 (piecewise linear) | Cap at 1000 stops mega-strikes from dominating |
| `volume_normalised` | 0 → 0.0, 50 → 0.5, ≥200 → 1.0 (piecewise linear) | Volume is a same-session signal, lower thresholds |

The highest score wins. **Score ties break by delta-closeness** so a
chain with all-equal OI degenerates back to the legacy "closest delta"
behaviour.

### Edge cases

| Case | Behaviour |
| --- | --- |
| No candidate within ±tolerance | Falls back to the legacy delta-closest pick — preserves picker output for sparse chains |
| All candidates have OI=0 + volume=0 | OI/volume components score 0 across the board; delta-closeness breaks the tie |
| Pre-Wave-V chain (no `open_interest`/`volume` field) | Same as above — graceful degradation, no behaviour change for legacy chains |
| Single candidate within tolerance | That candidate wins regardless of OI/volume |

### Weight choice rationale

Default weights (50/30/20) were chosen so:

1. **Delta-closeness still dominates by majority.** A 50% weight means
   even a maxed-out OI+volume candidate (combined +50%) cannot beat an
   exact-delta candidate that has *any* OI/volume of its own. This keeps
   the picker behaving like a delta-targeting selector first — high-OI is
   a tiebreaker among already-acceptable strikes, not an override.
2. **OI is weighted more than volume.** OI is a stable cross-session
   measure of "this strike is established"; volume is a same-session
   noisy signal that can spike or zero on any given day. A 30/20 split
   gives more credit to durable established interest.
3. **Combined OI+volume = 50%, equal to delta-closeness.** This means
   that *at the tolerance boundary* (where delta-closeness is 0) the OI
   + volume signal has full discretion — exactly what we want for the
   "the strike is just barely off-target but very tradeable" case.

### Composition with liquidity gating (Agent 2)

When Wave V Agent 2's `find_liquid_strike_by_delta` is in the picker
pipeline:

1. **Liquidity gate runs first** — strikes with `liquidity_score` below
   `RECOMMENDER_MIN_LEG_LIQUIDITY_SCORE` are rejected outright.
2. **V4 preference scoring runs second** — among *liquid* strikes the
   walk-search produces, the highest preference score wins (delta-
   closeness 50% + OI 30% + volume 20%).

Pre-Agent-2 chains (no `liquidity_score` field) skip step 1 and the V4
score handles strike selection directly via OI + volume.

### Settings overrides

```python
RECOMMENDER_DELTA_TOLERANCE: float = 0.03   # ±0.03 of target delta
RECOMMENDER_PREFER_HIGH_OI_WEIGHT: float = 0.30
RECOMMENDER_PREFER_HIGH_VOLUME_WEIGHT: float = 0.20
# delta-closeness weight is computed as 1 - OI - VOLUME (sums to 1.0).
```

To loosen the tolerance band (e.g. for thinly-traded weeklies where
the chain doesn't have a strike at every delta increment):

```bash
export RECOMMENDER_DELTA_TOLERANCE=0.05
```

To bias the picker more aggressively toward established OI:

```bash
export RECOMMENDER_PREFER_HIGH_OI_WEIGHT=0.45
export RECOMMENDER_PREFER_HIGH_VOLUME_WEIGHT=0.25
# delta-closeness drops to 0.30; OI dominates within tolerance.
```
