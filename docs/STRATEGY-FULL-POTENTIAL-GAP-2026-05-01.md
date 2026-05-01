# Strategy Full-Potential Gap

Date: 2026-05-01
Branch: `feature/strategy-sota-foundation`

## Current State

AlphaDesk has 13 registered backend strategies. The production pipeline only
runs strategies whose registry metadata is `kind="autonomous"`. Research
strategies are intentionally skipped by `DailyPipelineRunner` because they do
not yet have a complete executable signal path.

| Strategy | Category | Runtime status | Main gap to full potential |
|---|---|---:|---|
| `pead` | equity | autonomous | Needs richer earnings surprise, guidance, revisions, and liquidity-aware sizing to improve candidate quality. |
| `momentum_quality` | equity | autonomous | Needs survivorship-safe universe refresh, sector caps, borrow/dividend checks, and ongoing OOS drift monitoring. |
| `rsi2_reversal` | equity | autonomous | Needs close-auction/MOC execution QA, short-side policy, and regime-aware de-risking. |
| `pairs_trading` | pairs | autonomous | Needs cointegration refresh durability, borrow/short availability, and spread execution/slippage model. |
| `regime_adaptive` | macro | autonomous | Needs robust market-regime data, VIX/cache observability, and stress-regime validation beyond 2023-2024. |
| `ts_momentum` | macro | autonomous | Needs end-of-month rebalance verification, dividend-adjusted data, and ETF liquidity/cost checks. |
| `dual_momentum` | macro | autonomous | Needs end-of-month rebalance verification, defensive asset handling, and cash/treasury fallback policy. |
| `kama_breakout` | equity | paper-only autonomous | Needs longer OOS sample and live-paper evidence before live capital. |
| `earnings-options-play` | options | research | Needs event-level options backtester, options-chain `StrategyInput`, multi-leg order generation, and historical earnings move data. |
| `earnings_vol` | options | research | Needs options-chain `StrategyInput`, iron-butterfly signal/exit restoration, event backtest, and broker multi-leg routing. |
| `vrp_harvest` | options | research | Needs options-chain `StrategyInput`, term structure, skew, tail hedge contracts, and defined-risk sizing. |
| `orb` | intraday | research | Needs 1-minute bars in `StrategyInput`, intraday runner, EOD flat enforcement, and no-peeking tuner fix. |
| `vwap` | intraday | research | Needs 5-minute bars in `StrategyInput`, session VWAP feature construction, and intraday execution runner. |

## Cross-Cutting Gaps

1. **Provider inputs**
   - True Level II/depth is not required for all strategies, but chart/order-block
     quality improves with Databento or another depth feed.
   - Options strategies need historical and live option chains with Greeks,
     bid/ask, volume, open interest, expirations, and corporate-action adjusted
     underlyings.
   - Intraday strategies need 1-minute and 5-minute bars in the same typed
     provider bundle used by `DailyPipelineRunner`.

2. **Strategy input contract**
   - `StrategyInput` currently handles bars, earnings, positions, cash/equity,
     state, and RNG.
   - Full options strategies need a typed `options_chain` payload.
   - Intraday strategies need multi-timeframe bars without forcing daily-only
     assumptions in the backtest and live runner.

3. **Execution**
   - Options strategies need explicit multi-leg order tickets, per-leg price
     freshness, spread debit/credit validation, and paper/live broker support.
   - Intraday strategies need session lifecycle controls: opening-range build,
     entry window, stops, exits, and EOD flatten.
   - All strategies need idempotency keys and durable order intent audit trails
     before broader autonomous activation.

4. **Evidence**
   - Keep `paper_only=True` or `kind="research"` until each strategy has a
     reproducible OOS artifact, realistic costs, and a paper-trading shadow log.
   - ORB has a strong-looking artifact, but the repo notes tuner peeking in the
     retuned run. Treat the default artifact as research evidence, not live
     approval.

5. **Operations**
   - Production is currently paper-mode oriented. Do not flip live trading for
     research or paper-only strategies.
   - Scheduler windows should skip terminally when their requested strategies are
     research-only or planned, instead of retrying every tick. This gap is now
     patched in `daily_pipeline.py` and `pipeline_runner.py`.

## Safe Trigger Plan

Use this order:

1. Deploy the market-depth/chart and scheduler guard changes.
2. Trigger a paper-mode production pipeline run with small limits to verify the
   currently autonomous set still starts cleanly.
3. Use `/pipeline/status` and server logs to confirm skipped windows are explicit
   and no research-only strategies are routed to order generation.
4. Start the enablement workstream in this sequence:
   - Add typed options-chain input and backtest harness.
   - Restore `earnings_vol` executable logic in paper-only mode.
   - Reuse that options infrastructure for `earnings-options-play` and
     `vrp_harvest`.
   - Add intraday bar input and runner support.
   - Restore `orb`, then `vwap`, in paper-only mode.
   - Promote only after OOS + paper shadow evidence clears the documented bar.

## Triggered Today

- A production deploy was triggered for commit `ee96ab4`, which contains the
  chart/depth overlay work and market-data provider note.
- A follow-up scheduler guard was added after the gap review found the empty
  research-only `post_or` window bug.
- Safe production pipeline triggering should happen only after the follow-up
  scheduler guard is deployed.
