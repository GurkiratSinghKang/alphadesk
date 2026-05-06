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
