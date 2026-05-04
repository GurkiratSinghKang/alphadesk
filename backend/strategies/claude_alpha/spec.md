# Claude Alpha (LLM-driven discretionary book — v0 scaffold)

**Category:** Equity / discretionary (LLM-scored systematic equity selection)

**Status:** `kind="research"` — the v0 implementation provides the deterministic-replay cache + scoring abstraction + risk filters, but does NOT yet wire a live Claude prompt. The full prompt path is gated until the OOS replay validates.

**Primary references:**
- Grossman, S. J., & Stiglitz, J. E. (1980). "On the Impossibility of Informationally Efficient Markets." *American Economic Review* 70(3).
- Lopez de Prado, M. (2018). *Advances in Financial Machine Learning.* (Walk-forward replay + meta-labelling discipline.)

## 1. Why this strategy exists (and why it's research-mode)

Grossman-Stiglitz (1980) formalize that prices cannot fully reflect available information when information acquisition is costly. An LLM that can rapidly process earnings transcripts, management commentary, industry reports, and macro context lowers the cost of processing — particularly in names with thinner sell-side coverage. The bet is that this lowered cost translates to a discoverable edge.

The largest risk of an LLM-driven strategy is **NOT** the prompt quality — it's the lack of replay determinism. Per Lopez de Prado (2018), backtest validity requires that the same strategy on the same data produces the same result twice. LLM calls are inherently non-deterministic (even at temperature=0 there's distributional drift across model versions). Without a replay-cache solving that, every backtest run produces a different number, and you cannot tell whether a Sharpe change came from prompt iteration or from sampling noise.

This v0 ships the **replay-cache infrastructure** — keyed by `(prompt_id, prompt_version, input_hash, asof)` — that solves replay determinism. Production calls hit the live Anthropic API; backtests / replays serve cached responses from the disk cache. The cache lives at `~/.alphadesk/claude_alpha_cache/`.

## 2. v0 architecture (this PR)

```
                   ┌──────────────────────────────────────┐
                   │ ClaudeAlphaStrategy.run()            │
                   │   universe + StrategyInput + asof    │
                   └────────────────────┬─────────────────┘
                                        │
                                        ▼
                   ┌──────────────────────────────────────┐
                   │ _input_hash(input, asof) → 16-char hex│
                   └────────────────────┬─────────────────┘
                                        │
                                        ▼
                   ┌──────────────────────────────────────┐
                   │ ~/.alphadesk/claude_alpha_cache/     │
                   │   <prompt_id>_v<version>_<asof>_     │
                   │   <input_hash>.json                  │
                   └──────┬─────────────┬─────────────────┘
                   cache hit         cache miss
                          │             │
                          ▼             ▼
                   ┌──────────┐  ┌──────────────────────┐
                   │ scores   │  │ _deterministic       │
                   │  dict    │  │  _fallback_score()   │
                   └────┬─────┘  │  (momentum × liq)    │
                        │        └────┬─────────────────┘
                        │             │ writes to cache
                        ▼             ▼
                   ┌──────────────────────────────────────┐
                   │ Conviction-weighted top-N selection  │
                   │ ranked by score, weight scales       │
                   │ linearly from min_weight to max_     │
                   │ weight                               │
                   └──────────────────────────────────────┘
```

The `_deterministic_fallback_score` is a 252-day return × log(ADV) composite — a **placeholder** that exercises the rest of the pipeline (selection, weighting, exits) without actually generating alpha. When the live Claude path is wired in v1, this fallback only fires on cache miss + budget exhaustion.

## 3. Path to v1 (live Claude calls)

The v0 deliberately does not include the live Claude call. Three reasons:
1. **Cost discipline**: a multi-trial OOS validation run with un-cached LLM calls costs ~$50-200 per trial. The replay cache makes that ~$0 after the first inference.
2. **Risk discipline**: LLM-driven order generation needs a safety review before going live. `kind="research"` excludes this strategy from the autonomous run loop, so a misbehaving prompt cannot move capital.
3. **Iteration discipline**: the v0 lets us validate the cache + selection + weighting pipeline against the deterministic fallback. When we flip to v1, only the scoring function changes.

Follow-on plan to ship v1:
1. Implement `_score_via_claude(...)` using `backend.agents.claude_client.ClaudeClient` (already provides per-day spend kill-switch + token tracking + retry logic per `claude_client.py`).
2. Define the structured-output JSON schema: `{symbol, score, catalyst, thesis, uncertainty, invalidation_criteria, max_holding_days}` — parse and validate via Pydantic.
3. Add drift monitoring: daily metric of average score variance vs a rolling baseline; alert if drift exceeds threshold.
4. Add a kind="autonomous" flip behind a feature flag in `StrategyMeta`.
5. Validate via OOS replay against 2019-2024 — every cached call costs $0, so we can iterate the prompt cheaply.
6. Once OOS Sharpe + drawdown are stable, flip the feature flag.

## 4. Rules (v0 — what this PR ships)

### Universe
80-name liquid-large-cap seed (`CLAUDE_ALPHA_UNIVERSE_SEED`). Production should swap to point-in-time S&P 500 via `fundamentals_provider.sp500_constituents()` (Plan B.2) once the prompt path is validated.

### Signal
- Compute `input_hash` from the bars/fundamentals frames + asof
- Look up `~/.alphadesk/claude_alpha_cache/<prompt_id>_v<version>_<asof>_<hash>.json`
- Cache hit: serve cached scores
- Cache miss: deterministic fallback (momentum × log-liquidity composite, min-max normalized to `[0, 1]`); persist to cache

### Selection
- Drop names with score below `min_score` (default 0.80 = top quintile)
- Take top `target_positions` (default 15) of the surviving set
- Don't re-enter names already held

### Sizing
- Conviction-weighted: linear from `min_weight_per_name` (lowest selected) to `max_weight_per_name` (highest selected)
- Default 1% to 3% of NAV per name

### Cadence
- `weekly` (Friday close), `biweekly` (alternate Fridays), or `monthly` (last business day of month)
- Default `weekly`

### Exits
- Per-position: force-exit MOO any position past `max_holding_days` trading sessions (default 21)
- No price stops in v0 — the v1 prompt should emit explicit `invalidation_criteria` per name that the strategy translates into stops; until then, time-stop is the only risk control

## 5. What v0 does NOT do

- **Live Claude API calls** — gated behind `kind="research"` until v1
- **Drift monitoring** — separate plan
- **Universe market-cap or ADV filtering at runtime** — the seed is curated to be deeply liquid; v1 will add explicit `sp500_constituents` + ADV filter
- **Per-name `invalidation_criteria` exits** — v1 prompt + parser will feed these into the strategy state
- **News / catalyst feed integration** — v1 will pull recent news per candidate before scoring
- **Options-flow integration** — Polygon options data is wired but the prompt doesn't yet consume it

## 6. Performance expectations

v0 ships with a **placeholder scorer**. Don't read anything into its backtest numbers — the deterministic fallback is a 252-day momentum × liquidity composite, NOT an alpha signal. Realistic forward Sharpe band is **0.0** for v0 (it's research-mode, doesn't trade).

For v1 (when the live Claude path lands): the academic benchmark for LLM-driven equity strategies is sparse. Sharpe expectations should be set conservatively at 0.4-0.8 net of API costs, with high regime-sensitivity (LLM-driven systems may behave very differently in 2026 vs 2030 due to capability drift).
