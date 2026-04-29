# Earnings Options Play Audit

Date: 2026-04-29
Scope: `tradingalpha.net` production UI, local codebase, targeted tests, and available backtest artifacts.

## Executive Summary

The Earnings Options Play page is currently a decision-support screener, not a backtested or autonomous trading strategy. Production login, calendar loading, symbol detail loading, and defined-risk trade deep-linking all work. The biggest gap is that the product already feels like a strategy picker, while the code underneath still has no executable strategy logic, no earnings-options-play backtest, and several calendar ranking fields that are always null.

The live production run found 8 curated candidates for Apr 27 - May 8, 2026: BMY, MA, CL, CVX, LIN, XOM, PLTR, and VRTX. BMY detail rendered quote, IV metrics, expected move, strike ladder, IV term/skew, news, and four defined-risk trade buttons. A bull put spread deep-link successfully pre-staged a 2-leg option combo on `/trade`. I did not submit the order.

Main blockers to "perfecting" the strategy:

1. `earnings-options-play` is a research-only no-op strategy: zero universe, zero signals, zero trades.
2. Calendar ranking is weak: premium yield, Claude confidence, historical move, top setup, and beat-rate fields are unset in the calendar payload.
3. The trade page preloads the option combo but keeps the chart/header on the previously selected underlying (SPY in my run), creating a risky mismatch before order placement.
4. Mobile works as a long stacked page, but it is not a swipe-card workflow. The current phone flow forces a long vertical scan before action.
5. Live Claude structured analysis was unavailable, and the UI then hides the "Run full research" control entirely.

## Remediation Progress

### 2026-04-29

Closed:

- `/trade` option deep-links now move the visual trade context to the URL underlying. A BMY/NVDA option-combo link should show the underlying chart/header while preserving the OCC contract legs in the ticket.
- Calendar rows now hydrate ATM call/put premium yields, cached Claude verdict/confidence/top setup, and historical earnings move stats instead of hardcoding those ranking fields to null.
- Historical earnings context now joins FMP earnings surprises with adjusted Alpaca daily bars to compute last-8-quarter event moves, average absolute move, beat rate, and prompt context for structured/full Claude analysis.

Validation after these fixes:

- `npm --prefix frontend test -- src/__tests__/earnings-trade-flow.test.tsx`: 6 passed.
- `npm --prefix frontend run typecheck -- --pretty false`: passed.
- `npm --prefix frontend test -- src/__tests__/earnings src/__tests__/earnings-trade-flow.test.tsx src/__tests__/hooks/useKeyboardShortcuts-earnings.test.tsx`: 100 passed.
- `PYTHONPATH=backend:. .venv/bin/python -m pytest -q backend/tests/test_earnings_screener.py backend/tests/test_earnings_routes.py backend/tests/test_earnings_round5.py backend/tests/test_earnings_schemas.py backend/tests/test_earnings_prompts_l1.py backend/tests/test_earnings_symbol_validation.py backend/tests/test_earnings_window.py`: 135 passed.

Still open:

- Dedicated event-level options backtest harness.
- Explainable edge score and candidate ranking.
- Mobile swipe-card queue and web compare/order queue.
- `/help/earnings-data` route.
- BMO/AMC timing enrichment.
- Claude unavailable retry/full-research state.

## Evidence Collected

Screenshots:

- `output/playwright/earnings-options-audit/01-desktop-default.png`
- `output/playwright/earnings-options-audit/02-desktop-detail-BMY.png`
- `output/playwright/earnings-options-audit/06-desktop-detail-no-intro-BMY.png`
- `output/playwright/earnings-options-audit/07-desktop-trade-prefill.png`
- `output/playwright/earnings-options-audit/08-mobile-default-no-intro.png`
- `output/playwright/earnings-options-audit/09-mobile-detail-BMY.png`

Machine-readable live run outputs:

- `output/playwright/earnings-options-audit/live-ui-summary.json`
- `output/playwright/earnings-options-audit/trade-mobile-summary.json`
- `output/playwright/earnings-options-audit/earnings-vol-oos-analysis.json`

Validation:

- Backend targeted earnings tests: 135 passed.
- Frontend earnings/trade tests: 100 passed.
- Live login: passed.
- Live calendar API: passed.
- Live detail API for BMY: passed, partial with `claude_unavailable`.
- Live trade deep-link: passed, pre-staged 2 legs.
- Actual order placement: not submitted.

## What It Does Today

Frontend route:

- `frontend/src/app/(dashboard)/strategies/earnings-options-play/page.tsx`
- Layout is calendar sidebar plus detail panel.
- It does not auto-select a symbol on cold load, by design, to avoid burning Claude/options-provider budget.
- Selecting a symbol fetches detail, syncs `?symbol=...` into the URL, and scrolls to the detail on mobile.

Backend route and service:

- `backend/api/routes/earnings.py`
- `backend/services/earnings_screener.py`
- Calendar pulls FMP earnings, filters to a static curated optionable universe, hydrates quote/IV/expected move, and returns rows.
- Detail pulls quote, metrics, strike ladder, news, IV term/skew, and Claude structured analysis.
- Full research is a separate POST path with auth and rate limits.

Strategy registry:

- `backend/strategies/earnings_options_play/strategy.py`
- The registered strategy is explicitly `kind="research"`.
- `universe()` returns `[]`.
- `run()` returns `signals=[]`.

## Live Production UX Findings

### Works

- Login works.
- Calendar renders quickly and groups reports by date.
- BMY detail loaded useful options context: IV rank, IV percentile, HV/IV, expected move, strike ladder, IV term/skew, news, and four defined-risk trades.
- Trade buttons generate reasonable option combo URLs.
- `/trade` parses the combo URL and pre-stages all legs.
- No horizontal page overflow was detected at 1440px desktop or 390px mobile.

### Bugs And Shortcomings

#### P0 - Strategy Backtest Is A No-op

`backend/strategies/earnings_options_play/strategy.py:1` says there is no engine logic. The class confirms this at lines 48-59: empty universe, no signals, research-shell diagnostics only.

Command run:

```bash
PYTHONPATH=backend:. .venv/bin/python -m strategies.earnings_options_play backtest --from 2026-04-01 --to 2026-04-29
```

Result:

- `trade_count`: 0
- `total_return`: 0.0
- `cagr`: NaN

This is the core gap. The UI can help a human choose trades, but there is no executable strategy to evaluate, tune, or compare yet.

#### P1 - `/trade` Shows The Wrong Underlying Context

The BMY bull put spread deep-link pre-staged:

- Sell `BMY260501P00058000` at 1.54
- Buy `BMY260501P00056000` at 0.61

But the trade screen header and chart still showed SPY. The order ticket had the correct OCC symbol, and the staged legs were correct, but the visual decision context was SPY.

Likely cause:

- `/trade` reads pre-staged legs from query params at `frontend/src/app/(dashboard)/trade/page.tsx:156`.
- The chart/header still derive from `selectedSymbol` in the market store at lines 137-139 and 216-218.
- The deep-link parser does not update the selected market symbol from the query `symbol=BMY`.

Fix direction:

- When `symbol` is present in query params, set the market store selected symbol or derive a local chart symbol from the URL.
- For option orders, chart the underlying, not the first OCC leg.
- Make the header say `Trade - BMY`, while the ticket still shows the selected OCC leg/legs.

#### P1 - Calendar Sorts Are Mostly Dead

Live API probes showed every calendar row had:

- `premiumYieldCallAtm`: null
- `premiumYieldPutAtm`: null
- `claudeConfidence`: null

Code confirms this in `backend/services/earnings_screener.py:1206-1211`, where these fields are hardcoded to `None`.

The sort implementation at `backend/services/earnings_screener.py:1444-1452` sorts by premium yield and Claude confidence, but those values are empty. In production, `sort=yield` and `sort=claude_confidence` returned the same practical order as the default date sort.

Fix direction:

- Populate ATM call/put premium yields during row hydration.
- Either read cached Claude structured values into calendar rows or remove/suppress Claude sort until values exist.
- Add an explicit "edge score" sort rather than making the user infer edge from IV rank.

#### P1 - Candidate Quality Ranking Is Not Yet Strategy-aware

The live list had IV ranks mostly below 40. `min_iv_rank=50` returned 0 rows in my run. MA had the highest IV rank in the default list but no expected move. Several candidates had expected move but low IV rank.

For a short-vol earnings strategy, the list should not just be "upcoming curated symbols." It should rank tradability and edge:

- IV rank / IV percentile.
- Expected move versus historical average absolute earnings move.
- Options spread width, open interest, and volume.
- Event timing quality: BMO/AMC known, not DMT.
- Liquidity of the specific defined-risk structure.
- News/catalyst ambiguity and expected gap risk.
- Post-earnings drift behavior.
- Market/sector regime.

Right now the page gives ingredients, but it does not reliably place the strongest trades first.

#### P1 - Missing Historical Earnings Edge Data

The detail prompt and UI still lack historical earnings move data:

- `hist_avg_abs_move_pct` is passed as `None` in `backend/services/earnings_screener.py:1630-1634`.
- Full research passes `historical_quarters=[]` in `backend/services/earnings_screener.py:1763-1765`.
- Live BMY displayed `HIST |MV| -` and `BEAT % -`.

This prevents the central earnings-volatility comparison: "Is the current implied move rich or cheap versus what this stock actually does on earnings?"

Fix direction:

- Join FMP earnings dates with historical underlying bars.
- Compute next-session and five-day absolute moves.
- Store/report last 8 quarters, median absolute move, percentile rank, and implied/historical ratio.
- Use this in ranking, Claude context, and card visuals.

#### P2 - Claude Unavailable State Hides Full Research

Production BMY detail returned `errorCodes=["claude_unavailable"]`. The UI showed a partial-data banner and "Analysis pending," but no "Run full research" button.

Code cause:

- `ClaudeThesisCard` returns early when `structured` is null at `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx:26-47`.
- The full-research trigger only renders later, after structured data exists, at lines 94-104.

The banner says retry in about 30 seconds, but there is no visible retry action in this state.

Fix direction:

- Show a retry structured-analysis action.
- Show full research as disabled with a reason, or allow full research to run independently when enough non-Claude data exists.
- Avoid infinite "Analyzing" copy after the backend has already returned `claude_unavailable`.

#### P2 - Help Link Is Broken

The disclaimer links to `/help/earnings-data` in `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:270-275`.

Live probe:

- `GET https://tradingalpha.net/help/earnings-data`
- Status: 404

Fix direction:

- Add the help page or change the link to an existing docs route.

#### P2 - BMO/AMC Filters Returned Zero

Live rows were all `DMT`, so `bmo_amc=bmo` and `bmo_amc=amc` returned 0 rows. The filters exist, but the provider data currently leaves the user with all-or-nothing DMT behavior.

Fix direction:

- Enrich report timing from a better source or maintain a correction table for liquid names.
- If no BMO/AMC data exists for the current result set, disable those filter chips or show counts beside them.

#### P2 - Mobile Is Responsive, But Not Mobile-native

At 390x844, the page is a long stacked research page. It is usable, but not optimized for a trader triaging a list. The user must scroll through filters, calendar, partial banner, header, metrics, ladder, term/skew, news, and trade buttons.

This is the opposite of the desired swipe-card interaction.

Fix direction:

- Create a mobile-first card queue.
- Each card should expose only the decision fields first, with detail behind expansion.
- Swipe left: discard.
- Swipe right: save/watch.
- Swipe up: open an order confirmation sheet, not direct submit.

## Backtest And Performance Findings

### Current Strategy Backtest

`earnings-options-play` current code:

- 0 universe symbols.
- 0 signals.
- 0 trades.
- No performance evidence.

`earnings_vol` current CLI also returned 0 trades for Apr 1 - Apr 29, 2026. Its current strategy file says options-chain integration is deferred and the class is also `kind="research"`.

### Available Historical OOS Evidence

There is a bundled older OOS artifact:

- `backend/data/oos/phase1-earnings_vol-oos.json`

This is not an earnings-options-play backtest. It is the closest available evidence for the related short-vol earnings concept.

Summary from that artifact:

- OOS total return: 26.25%
- Start equity: 100,000
- End equity: 126,245.61
- Sharpe: 1.43
- Sortino: 1.28
- Max drawdown: 1.90%
- Hit rate: 55%
- Profit factor: 1.31
- Count: 40 option legs, grouped across 8 underlyings

Important caveat:

- The current checked-in `earnings_vol` strategy is a research shell and does not reproduce these trades through the current CLI.
- Treat the artifact as a historical research result, not as a live, reproducible strategy result for the current app.

## Strategy Improvements

### Define The Trade Archetypes

The screener should explicitly classify candidates into strategy buckets:

- Rich IV, no strong direction: iron condor / iron butterfly.
- Rich IV, bullish bias: bull put spread.
- Rich IV, bearish bias: bear call spread.
- Cheap IV, strong catalyst: long straddle or debit spread.
- No liquidity / no historical edge / missing report timing: skip.

### Add An Edge Score

Candidate score should be visible and explainable. Suggested model:

```text
edge_score =
  30% implied_vs_realized_edge
  20% options_liquidity
  15% IV_rank_or_percentile
  15% event_timing_quality
  10% catalyst_clarity
  10% risk_penalty
```

Suggested components:

- `implied_vs_realized_edge = expected_move_pct / median_abs_earnings_move_8q`
- `options_liquidity = OI/volume score - bid_ask_spread penalty`
- `event_timing_quality = AMC/BMO known > DMT unknown`
- `risk_penalty = earnings gap risk, binary FDA/legal/antitrust/news shock, low float, wide spreads`

### Backtest Harness Needed

Build a dedicated event-level options backtester:

1. Dataset:
   - Earnings date, time, actual report timing.
   - Underlying OHLCV before and after the event.
   - Historical options chain snapshots, bid/ask/mid, OI, volume, greeks if available.
   - Corporate action adjustment.

2. Entry rules:
   - Enter one session before AMC, or report morning for confirmed AMC/BMO logic.
   - Use mid plus half-spread/slippage.
   - Enforce max spread width, min OI, min volume.

3. Exit rules:
   - Exit after event at open, 1h after open, close, or IV crush threshold.
   - Test separately by report timing.

4. Strategy shapes:
   - Bull put spread, bear call spread, iron condor, long straddle.
   - Compare generated card recommendation versus naive baselines.

5. Metrics:
   - Per-trade P&L, max loss utilization, average credit/debit, slippage drag.
   - Hit rate, profit factor, Sharpe, max drawdown.
   - Calibration: expected move containment rate versus actual move.
   - Candidate-score deciles to prove that the ranking puts winners first.

## Mobile Swipe Card Proposal

Each mobile card should show one trade candidate, not a page section.

Primary card fields:

- Symbol, company, report date/time.
- One-line recommended setup.
- Edge score and confidence.
- Expected move versus historical move.
- IV rank / IV percentile.
- Liquidity badge: tight / okay / wide.
- Max loss, max profit/credit/debit, breakevens.
- Mini payoff strip with expected move overlay.
- Three reasons to trade and three reasons to skip.

Gestures:

- Swipe left: discard with undo toast.
- Swipe right: save for later/watchlist.
- Swipe up: open order confirmation sheet.
- Tap: expand full research and strike ladder.

Order safety:

- Swipe up should never submit directly.
- It should open a bottom sheet with legs, credit/debit, max loss, estimated slippage, buying power effect, and a final `Place paper order` button.

## Web Proposal

Web should not copy mobile swiping as the primary pattern. Better web flow:

- Left: sortable candidate table with score, IV rank, expected/historical ratio, liquidity, setup.
- Center: selected candidate research panel.
- Right: order preview / saved queue.
- Keyboard shortcuts:
  - `j/k`: next/previous candidate.
  - `x`: discard.
  - `s`: save.
  - `o`: stage order.
- Bulk compare mode for 2-4 candidates.

The current sidebar/detail design can evolve into this, but it needs richer columns and scoring.

## Recommended Priority Order

1. Fix `/trade` underlying context mismatch for option deep-links.
2. Populate calendar premium yield, Claude cache fields, historical earnings move, and top setup, or hide the corresponding sort options.
3. Implement the event-level backtest harness and reproduce a small historical sample end to end.
4. Add edge score and candidate ranking.
5. Add the mobile card queue with discard/save/stage state.
6. Add `/help/earnings-data` or fix the broken link.
7. Improve DMT/BMO/AMC timing quality.
8. Improve Claude unavailable/retry/full-research states.

## Bottom Line

The existing page is a strong options research surface. It is not yet a proven strategy. The fastest path to a winning product is to make the ranking truthful: historical earnings move, expected move richness, liquidity, report timing, and defined-risk payoff should decide the card order. Once the top of the list demonstrably beats the bottom in backtests, the swipe-card UX becomes much more than a nice interaction. It becomes a fast way to process a ranked edge.
