# AlphaDesk Agent-Team Competitive Gap Analysis

Date: 2026-05-01
Live target tested: https://tradingalpha.net
Local workspace: /Users/GK/Downloads/alphadesk

## Scope And Guardrails

This pass used multiple specialized review teams against AlphaDesk and public competitor sources.

Allowed access:

- AlphaDesk live QA via the gitignored QA credential environment.
- AlphaDesk local source, docs, QA specs, existing audit reports, and generated Playwright artifacts.
- Competitor research using public pages, docs, pricing pages, app listings, and public product pages.

Not performed:

- No competitor login.
- No unauthorized credential use.
- No behind-auth scraping.
- No real or paper order submission.
- No secrets printed in this report.

Note: The user mentioned `tradingview.net`; the repo and QA environment point to `https://tradingalpha.net`, so this run used `tradingalpha.net`.

## Teams Deployed

| Team | Mission | Status |
|---|---|---|
| AlphaDesk QA Synthesis | Inventory QA harness, page specs, prior manifests, prior audit gaps | Complete |
| Product/Code Explorer | Map actual frontend/backend modules and product strengths/weaknesses | Complete |
| Hedge Fund PM + Risk Committee | Judge institutional desk-readiness and live-capital blockers | Complete |
| Active Trader + Day Trader UX | Evaluate hotkeys, chart/order workflow, alerts, options workflow, speed | Complete |
| Novice Trader + Education | Evaluate onboarding, risk comprehension, dangerous misuse paths | Complete |
| Quant Strategy + Backtest Integrity | Review strategy inventory, evidence quality, data gaps, live readiness | Complete |
| Competitor Incumbents | Public research on major incumbents and Bloomberg alternatives | Complete |
| Competitor Upstarts + Fancy New Stuff | Public research on AI/options-flow/mobile/MCP-style entrants | Complete |
| QA Traders + Full-Coverage Matrix | Build deeper test matrix across personas and risk surfaces | Complete |

## Live QA Run

Command:

```bash
set -a; . ./.env.local.qa; set +a; ALPHADESK_BASE="$ALPHADESK_BASE_URL" node qa/harness/run-all.mjs --base="$ALPHADESK_BASE_URL"
```

Manifest:

- `qa/runs/2026-05-01T14-28-17Z/manifest.json`
- Started: `2026-05-01T14:28:18.198Z`
- Completed: `2026-05-01T14:37:07.147Z`
- Pages/results: 30
- Steps: 220
- Passed: 205
- Failed: 7
- Skipped: 8
- Snapshots: 82

### Current Failures

All step failures are on the authenticated dashboard `/`.

| Route | Viewport | Failures | Details |
|---|---:|---:|---|
| `/` dashboard | desktop 1440 | 2 | Harness expects `order-bar-symbol` and `order-bar-qty` on dashboard; current product moved the real `OrderBar` to `/trade`. |
| `/` dashboard | mobile 390 | 5 | Three load-state waits timed out, then the same two missing order-bar selector failures occurred. |

Skipped steps:

- Alerts hover on both viewports: no first alert row or hover target in current state.
- Dashboard strategy rail click on both viewports: rail/card target absent or hidden.
- Dashboard command palette visible on both viewports: known harness flake/conditional mount.
- Strategy detail range `1M` on both viewports: absent selector or current UI drift.

### QA Interpretation

The live site is mostly render-stable across the existing harness, but the harness is now stale around the most important trading surface.

Key drift:

- `qa/pages/trade.md` still describes `/trade` as redirecting to `/`.
- `frontend/src/app/(dashboard)/trade/page.tsx` is now a full trade workspace with equity, single-leg OCC, multi-leg deep-link prefill, and `placeOrder` wiring.
- `qa/harness/tests/dashboard.mjs` still tries to fill an order bar on `/`, but current dashboard copy says users should open the dedicated trade ticket.

Immediate QA fix:

1. Update `qa/pages/trade.md` to describe the real `/trade` workspace.
2. Move dashboard order-entry fill checks into a new `/trade` harness spec.
3. Add no-submit Playwright tests for equity ticket prefill, OCC single-leg prefill, and multi-leg combo prefill with network interception.

## Product Surface Inventory

AlphaDesk currently covers more than a simple charting tool:

- Public pages: `/login`, `/login/reset`, `/request-access`, `/docs`, `/privacy`, `/terms`, `/risk`, 404.
- Authenticated app: `/`, `/trade`, `/strategies`, `/strategies/[id]`, `/analytics`, `/pipeline`, `/reports`, `/alerts`, `/settings`.
- Trading workspace: chart, order bar, recent orders, equity/OCC/multi-leg query prefill, strategy attribution.
- Strategy system: registry, deterministic strategy protocol, research/paper/autonomous flags, pipeline runner, backtester/signal runner docs.
- Strategy catalog: 12 implemented strategies plus research/planned entries, with detail pages and status separation.
- Earnings options play: research-only options calendar/detail surface with IV/skew/strike/news/research affordances.
- Risk and operations: emergency halt/resume/flatten, risk monitor toggle, pipeline run/cancel/status/history, strategy toggles.
- Portfolio/reporting: analytics, P&L, drawdown, reports, CSV exports, settings exports.
- Security/ops: JWT cookie auth, refresh/logout/all sessions/change password/2FA hooks, webhooks, audit writes, user export/erase, CSP reports.

## Main Strengths

1. AlphaDesk is not just another charting UI. Its strongest wedge is "idea -> evidence -> strategy -> risk gate -> broker execution -> report".
2. Safety architecture has credible pieces: emergency halt, idempotency, quote freshness, option validation, paper/live strategy flags, webhook HMAC, audit records.
3. The product is more operationally mature than many early trading apps: architecture docs, deployment docs, runbook, rollback docs, SAR workflow, and repeated audit reports exist.
4. Strategy metadata and gating are unusually explicit: `research` and `paper_only` strategies are blocked from live emission.
5. The UI is dense and trader-oriented: dashboard, trade, alerts, pipeline, analytics, reports, settings, strategy detail, and earnings research are real surfaces.

## Main Gaps

### P0: Trading Workflow And Safety

- Command palette destructive actions can dispatch too easily: cancel working orders, flatten symbol, pause strategies. These need explicit confirmations, impact preview, and durable audit reason codes.
- `/trade` is now the highest-risk route but is under-tested by the current harness.
- Active-trader workflow is split between dashboard, `/trade`, legacy panels, and options surfaces.
- The command palette advertises "Open options chain", but current `/trade` does not mount the `OptionsPanel`.
- Mobile `/trade` deep-link coverage is absent, even though wrong mobile order intent is a high-risk failure.

### P0: Institutional Live Readiness

- AlphaDesk should remain paper/pilot/shadow-only for institutional capital today.
- Live mode is not a true server-side entitlement or control plane.
- Strategy evidence is not governance-grade yet. Several OOS Sharpes are provisional, regime-favored, sample-thin, or affected by optimizer/test-window issues.
- Risk analytics are not institutional-grade: correlation/crowding and VaR/stress/factor/liquidity workflows need stronger implementation and enforcement.
- Audit persistence is useful but partly best-effort; regulated workflows need stronger evidentiary guarantees.
- Infrastructure appears single-host/single-region oriented; institutional desks need HA, PITR, failover, restore drills, and RTO/RPO commitments.

### P0: Strategy Evidence

Best current evidence:

- `dual_momentum`: cleanest textbook implementation.
- `ts_momentum`: solid mechanics, but long-only crisis-alpha caveat.
- `rsi2_reversal`: clean implementation, many fills; report economic return alongside Sharpe.
- `regime_adaptive`: coherent allocator, but under-tested across stress regimes.

Weakest current evidence:

- `orb`: keep paper-only; evidence is structurally inflated.
- `momentum_quality`: discount headline Sharpe until tuner-on-test and survivorship issues are fully resolved.
- `kama_breakout`: paper-only; seven round trips is not enough validation.
- `vrp_harvest` and `earnings_vol`: research shells currently emit no live-equivalent option signals.

Strategy validation needs:

- Frozen params before OOS.
- Walk-forward validation with purged folds.
- Block-bootstrap confidence intervals.
- Benchmark alpha/beta wiring.
- Per-regime attribution.
- Slippage/fill/cost reconciliation.
- Paper shadow logs for 30-60 trading days before graduation.

### P1: Beginner And Education

- Strategy detail language is advanced: OOS Sharpe, VRP, KAMA, ATR, contango, delta/theta, and regime terms need beginner explanations.
- Risk disclosure is broad but not contextual at the moment of action.
- Add a beginner/advanced toggle on strategy detail pages.
- Add an "Explain this" layer for metrics, options terms, strategy status, and order-entry consequences.
- Add a required paper checklist before live mode or first real order.

### P1: Active Trader UX

- Add a single canonical trade workspace with watchlist, chart, options chain, trade builder, positions/orders, alerts, and recent fills.
- Add real intraday hotkeys: `1m`, `5m`, `15m`, `1h`; guarded flatten; crosshair-to-limit staging.
- Add bracket/OCO, TIF, risk-percent sizing, buying-power impact, estimated slippage, route/venue context, and compact confirmations.
- Make alerts harder to miss: sound, desktop notifications, severity, snooze, chart markers, and "alert fired -> open trade ticket".
- Add an opportunity tape: relative volume, gap, halt/news/earnings flags, flow/catalyst ranking.

### P1: QA Coverage

First missing tests to implement:

1. `/trade` equity ticket validation with submit intercepted.
2. `/trade` single-leg OCC deep-link E2E.
3. `/trade` multi-leg combo payload E2E.
4. Dashboard cancel working order with mocked API.
5. Flatten/close-all keyboard/event dedupe.
6. Pipeline run confirmation, polling, cancel.
7. Admin risk-monitor authorization and state persistence.
8. Restricted-symbol enforcement across manual and webhook paths.
9. TradingView webhook HMAC/replay/tamper/rate-limit regression.
10. Websocket bad-origin, bad JSON, oversized frame, reconnect.
11. Malformed `/trade` query fuzzing.
12. Earnings-options-play calendar to detail to thesis to trade-link flow.
13. Full-research 429 countdown.
14. Mobile `/trade` deep-link viewport/tap-target coverage.
15. Static route inventory drift checker.
16. Global visual invariant crawler.
17. Risk API empty/extreme fixture tests.
18. User export/erase privacy journey.
19. Multi-tab auth expiry/refresh/logout.
20. Low-priv authorization boundary suite.

## Competitor Landscape

### Incumbents And Major Platforms

| Competitor | Public source | What They Win On | AlphaDesk Response |
|---|---|---|---|
| TradingView | https://www.tradingview.com/features/ | Chart polish, Pine Script, public scripts, alerts, paper trading, broker connectivity, social graph | Build TradingView-grade alert/rule builder, import/export TradingView webhooks/Pine-like rules, publishable strategy cards |
| TrendSpider | https://trendspider.com/ | Automated trendlines, pattern detection, scanners, alerts, backtesting, bots, Sidekick AI | Add visual chart-condition builder: condition -> backtest -> paper deploy -> monitored execution |
| Koyfin | https://www.koyfin.com/ | Dashboards, macro/fundamental research, screeners, advisor/reporting workflows | Add a research terminal per symbol/strategy with fundamentals, transcript snippets, macro context, comps |
| Trade Ideas | https://www.trade-ideas.com/ti-ai-virtual-trade-assistant/ | Intraday scanner, Holly AI signals, alert cockpit, backtesting, paper/live trading workflows | Build a real-time opportunity tape with ranked catalysts, relative volume, flags, and one-click paper execution |
| QuantConnect | https://www.quantconnect.com/live/ | LEAN engine, cloud research, backtesting, optimization, live trading, datasets | Expose AlphaDesk strategy SDK, reproducible artifacts, parameter sweeps, Git-linked strategy versions |
| Composer | https://www.composer.trade/ | Natural-language/no-code strategy builder, backtesting, automated execution, community strategies | Add prompt-to-strategy wizard with guardrails, evidence cards, and paper deploy |
| AlphaSense | https://www.alpha-sense.com/ | Enterprise AI search over filings, broker research, expert calls, news, internal docs | Add source-cited evidence engine behind every AI trade rationale |
| Seeking Alpha | https://help.seekingalpha.com/what-is-seeking-alpha-premium | Contributor network, quant ratings, factor grades, transcripts, screeners, alerts | Add explainable factor grades and earnings-call insight extraction |
| FINVIZ Elite | https://finviz.com/elite | Fast screener, heatmaps, alerts, exports/API, low-friction visual market overview | Add public market-map/screener preview with deep links into paper strategies |
| StockCharts | https://stockcharts.com/pricing/ | ChartLists, technical scans, scheduled scans, alerts, SCTR/RRG, education | Add saved scan lists and daily scan report emails |
| YCharts | https://ycharts.com/ | Advisor reporting, Excel workflows, model portfolios, economic data | Add signed strategy/fund-style reports and advisor-grade benchmark/exposure packs |
| Bloomberg/LSEG/FactSet/S&P CIQ | Public product pages | Trust, data depth, research provenance, enterprise workflow | Do not copy terminals wholesale; win with focused, source-grounded AI execution desk |

### Upstarts, AI, Options Flow, And Agent Interfaces

| Competitor | Public source | What Feels New/Fancy | AlphaDesk Response |
|---|---|---|---|
| Fiscal.ai / FinChat | https://fiscal.ai/ | AI-native fundamental terminal with global equity data and API | Combine fundamentals, earnings-call AI, options positioning, and scenario planner |
| Danelfin | https://danelfin.com/how-it-works | AI scores, historical score evolution, broker sync, API/MCP positioning | Add "why score changed" audit trail, factor-level explanations, customizable weights |
| Prospero.ai | https://www.prospero.ai/ | Mobile-first AI stock signals, social/newsletter wedge | Ship free signal digest plus professional desk workflow |
| Tickeron | https://tickeron.com/ | AI robots, signal agents, bot stats, ML timeframes | Build transparent bot lab with train/test split, live cohorts, drawdown, slippage |
| Toggle AI | https://www.nasdaq.com/publishers/toggle | Knowledge graph, global assets, portfolio alerts, scenario insights | Build broker-aware AI pre-trade checks and no-trade recommendations |
| Unusual Whales | https://docs.unusualwhales.com/features/1-welcome/ | Options flow, dark pool, Congress/insider data, API/bot ecosystem | Build flow decoder with uncertainty, spread/hedge classification, and trade structures |
| OptionStrat | https://optionstrat.com/flow | Options visualizer, live/historical flow, news/Congress/insider flow, alerts | Click flow -> auto-build candidate spreads -> liquidity/Greeks/max-loss/event-risk |
| Market Chameleon | https://marketchameleon.com/Reports/UnusualOptionVolumeReport | Options/volatility analytics, unusual volume, historical context | Modern volatility workbench with historical analog cards |
| FlowAlgo | https://flowalgo.com/ | Real-time options/dark-pool flow, voice alerts, AI signals | Cleaner confidence scoring and delayed-data honesty labels |
| CheddarFlow | https://www.cheddarflow.com/pricing/ | Flow filters, gamma exposure, Cheddar AI, Discord bots | Alert journal with MFE/MAE, IV crush, fillability, post-alert review |
| TradingFlow | https://tradingflow.com/ | Lower-cost clean options-flow UI, GEX/IV screens | Watchlist operating system with flow replay and team notes |
| Optionomics | https://optionomics.ai/ | AI commentary, trade ideas, API/MCP, options strategy builder/backtesting | Source-cited AI, editable thesis, broker-aware sizing, no-trade calls |
| OptionWhales | https://www.optionwhales.io/ | Low-cost AI flow, intent classification, API/WebSocket | Verified data lineage and pro/team workflow |
| Flowasis | https://apps.apple.com/us/app/flowasis-real-time-options/id6612017616 | iOS-first flow, AI assistant, GEX, earnings/transcripts, social | Mobile companion with push "why it matters" and desktop handoff |

Market direction:

- AI plus options flow is becoming table stakes.
- New entrants are adding MCP/API/agent access early.
- Retail flow pricing clusters around roughly $50-100/month, with older tools higher and newer challengers lower.
- Vendor performance claims are common; AlphaDesk can stand out by being more auditable than more promotional.

## Best Product Positioning

AlphaDesk should not try to become a generic Bloomberg clone or a pure TradingView clone.

Best wedge:

> A source-grounded AI trading desk that turns research, flow, fundamentals, and strategy evidence into broker-aware, risk-controlled paper/live actions with auditable outcomes.

The high-leverage loop:

1. Detect: scanner, flow, earnings, macro, strategy trigger, or webhook.
2. Explain: source-cited AI rationale, stale-data flags, base rates, uncertainty.
3. Structure: equity/order/option spread candidates with max loss, liquidity, slippage, and invalidation.
4. Gate: risk limits, account mode, strategy status, restricted symbols, live entitlement.
5. Execute: paper first, then limited live with server-side approvals.
6. Journal: automatic thesis, fills, MFE/MAE, IV crush, slippage, outcome review.
7. Learn: evidence cards, cohorts, failed-signal analysis, model/strategy governance.

## Actionable Backlog

This checklist converts the gap inventory into implementation-sized work. P0 is the current stabilization pass: route/spec drift, high-risk trading workflow coverage, and live-capital safety gates. P1/P2 are deferred unless they directly unblock a P0.

### P0: Current Pass - Fix Before Claiming Trading Workflow Coverage

| ID | Backlog item | Owner lane | Acceptance checklist | Source gap |
|---|---|---|---|---|
| P0-01 | Correct `/trade` QA contract and route inventory | QA/docs | `qa/test-plan.md` lists `/trade` as a real authenticated trade workspace; `qa/pages/trade.md` documents equity, OCC, and multi-leg prefill; dashboard spec no longer owns order-entry checks | Harness failures on `/`; stale `/trade` redirect spec |
| P0-02 | Add route/spec drift guard | QA tooling | Read-only script compares `frontend/src/app/**/page.*` routes with the root QA inventory; exits non-zero on missing/stale routes; documented command exists for CI or pre-release use | Static route inventory drift checker |
| P0-03 | Add no-submit `/trade` equity ticket harness coverage | QA | Navigate `/trade?symbol=AAPL&side=buy&qty=1&type=limit&limit=123.45`; assert symbol, qty, type/price review, no network order submit | `/trade` highest-risk route is under-tested |
| P0-04 | Add no-submit `/trade` single-leg OCC deep-link coverage | QA | Navigate OCC URL; assert `data-slot=active-contract`, side, qty, limit, strategy tag, locked ticket behavior as applicable; intercept `placeOrder` if submit path is exercised | Missing single-leg prefill regression |
| P0-05 | Add no-submit `/trade` multi-leg combo coverage | QA | Navigate `legs=...` URL; assert each `data-slot=active-leg`, combo type, first-leg ticket defaults, and no auto-submit | Missing multi-leg combo regression |
| P0-06 | Add mobile `/trade` deep-link coverage | QA | Repeat equity/OCC/combo smoke on `mobile-390`; verify no clipped submit controls, tap targets remain usable, and pre-staged context is visible without horizontal scroll | Wrong mobile order intent is high risk |
| P0-07 | Gate destructive command-palette actions | Frontend/backend safety | Cancel/flatten/pause actions require explicit confirmation, impact preview, durable reason code, and audit event; keyboard repeat/dedupe covered | Destructive actions dispatch too easily |
| P0-08 | Server-side live-mode entitlement | Backend/platform | Live/paper mode is authorized server-side; UI local state cannot enable live trading; entitlement denial is tested across manual, strategy, and webhook paths | Institutional live-readiness blocker |
| P0-09 | Restricted-symbol, webhook HMAC/replay, and idempotency regression gates | Backend/QA | Automated tests cover manual order, strategy order, TradingView webhook tamper/replay/rate-limit, and duplicate idempotency keys | Trading safety and webhook abuse paths |
| P0-10 | Institutional no-go label for current live mode | Product/docs | Product/release notes say paper, pilot, or shadow only until P0-08/P0-09 and evidence gates pass | Report verdict: no institutional live capital today |

### P1: Next 30-45 Days - Product Maturity

| ID | Backlog item | Acceptance checklist | Depends on |
|---|---|---|---|
| P1-01 | Canonical trade workspace | One route combines watchlist, chart, options chain, ticket, positions/orders, alerts, fills; dashboard links do not duplicate partial trading surfaces | P0-01 through P0-06 |
| P1-02 | Active-trader controls | Hotkeys for core ranges, guarded flatten, crosshair-to-limit staging, bracket/OCO, TIF, risk-percent sizing, buying-power impact, estimated slippage | P0-07 |
| P1-03 | Alert-to-order workflow | Fired-alert drawer, sound/desktop notifications, severity/snooze, chart markers, and "open trade ticket" handoff | P1-01 |
| P1-04 | Strategy evidence cards | Frozen params, walk-forward/purged folds, bootstrap CIs, benchmark alpha/beta, regime attribution, cost/slippage reconciliation | P0-10 |
| P1-05 | Risk command center | Limits, breaches, exposures, stress, liquidity, approvals, crowding/correlation, and persistence tests | P0-08 |
| P1-06 | Beginner/advanced strategy layer | Explain-this affordances for OOS Sharpe, VRP, KAMA, ATR, Greeks, regime terms, and action consequences | None |
| P1-07 | Paper checklist before first live order | Required readiness checklist with contextual risk disclosure and durable completion event | P0-08 |
| P1-08 | Source-cited AI rationale | Every AI trade rationale cites filings/transcripts/news/strategy evidence, shows uncertainty, and can say "no trade" | P1-04 |
| P1-09 | Opportunity tape | Relative volume, gap, halt/news/earnings flags, flow/catalyst ranking, and one-click paper ticket staging | P1-01 |
| P1-10 | Expanded QA boundary suite | Pipeline confirm/cancel, admin risk-monitor auth, websocket malformed input, export/erase privacy, multi-tab auth expiry | P0-02 |

### P2: Next Quarter - Competitive Differentiation And Scale

| ID | Backlog item | Acceptance checklist | Notes |
|---|---|---|---|
| P2-01 | Options-flow ingestion and decoder | Flow events include uncertainty, spread/hedge classification, base rates, liquidity/fillability labels | Competes with flow upstarts |
| P2-02 | MCP/API access | Watchlists, strategy evidence, flow summaries, and portfolio risk questions available through documented API/agent interface | New entrants expose agent access early |
| P2-03 | No-code/prompt-to-strategy wizard | Prompt to rule/strategy draft, guardrails, backtest, evidence card, paper deploy only by default | Requires P1 evidence discipline |
| P2-04 | HA/DR foundation | PITR/WAL, restore drills, failover plan, broker outage mode, RTO/RPO targets | Institutional readiness |
| P2-05 | Signed reporting and retention | Server-side report hashes, scheduled packs, retention policy, export audit trail | Advisor/institutional trust |
| P2-06 | Execution quality analytics | NBBO at decision/fill, slippage, price improvement, venue, rejects, post-trade review | Broker-aware desk differentiation |

## Bottom Line

AlphaDesk already has a serious skeleton: strategy framework, AI research angle, broker integration, risk controls, ops docs, and a real app surface. The main gap is evidence and workflow maturity.

For consumer/prosumer product-market fit, the best path is explainable "thesis to trade" with options/fundamental/flow context.

For institutional live capital, current verdict is No-Go. Paper trading, research, and controlled shadow pilots are appropriate; institutional live needs stronger strategy evidence, live entitlements, enforceable risk, durable auditability, and operational resilience.
