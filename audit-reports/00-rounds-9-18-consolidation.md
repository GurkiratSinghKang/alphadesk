# Rounds 9–18 Consolidation — 50 Personas

Walking findings across 50 audits. Organized by fix-window.

## MUST FIX before flipping `ALPACA_BASE_URL` → live

Addressed by **Waves 41–44** (in flight as of 2026-04-19):

| # | Finding | Source | Wave |
|---|---|---|---|
| 1 | Kill switch (`/trades/halt`) not checked by pipeline or master_agent; auto-expires 24h; doesn't flatten | P16 | 41+42 |
| 2 | Manual trade bypasses MasterAgent; $50k per-order only; reproduced $82k in 1s | P16 | 41 |
| 3 | Drawdown halt state resets every run (instance-local); feeds deployed notional not realized P&L | P16, P63 | 42 |
| 4 | `STRATEGY_LIMITS` off-by-one — 12 × 10% default = 120% over-deploy | P63 | 42 |
| 5 | Dedup hash excludes `notes`/`strategy` → trivial replay bypass; float perturbation also bypasses | P40 | 41 |
| 6 | No `Idempotency-Key` support; 30s Redis TTL; 10-min replay books second order | P40, P65 | 41 |
| 7 | Bracket entry-filled / stop-unsent window leaves naked position on SIGKILL | P65 | 42 |
| 8 | Agent path (`agents/execution.py`) bypasses every gate | P65 | 42 |
| 9 | CSV injection: whitespace-prefix (`' =cmd…'`) + Unicode homoglyph (`＝`) bypass sanitizer | P37 | 41 |
| 10 | Username timing oracle — bcrypt short-circuits on missing user | P37 | 43 |
| 11 | `/agents/chat` unbounded — attacker can burn Claude Max quota | P38, P39 | 43 |
| 12 | Broker outage returns `is_demo: true` silently; frontend ignores flag | P43 | 44 |

## SHOULD fix soon after (pre-scale, pre-second-user)

| # | Finding | Source |
|---|---|---|
| 13 | Alpaca `trade_updates` stream not subscribed — no fill notifications | P27, P43 | Wave 44 scaffolding |
| 14 | Token revocation fails OPEN on Redis outage | P39 | Wave 43 |
| 15 | Caddy has no rate_limit, no access log, no body-size cap | P38 | Wave 43 (partial) |
| 16 | fail2ban inert for HTTP (only SSH) | P38 | defer |
| 17 | Lifespan tasks share event loop → HTTP DoS cascades to quotes + pipeline | P38 | defer (needs Celery) |
| 18 | No backend tests in CI; only frontend tested | P45 | defer |
| 19 | Sector cap (30%) currently breached at 41.58% on live portfolio | P16 | needs rebalancer — defer |
| 20 | MasterAgent class-level mutable state (momentum data, warnings set) | P63 | defer |

## OBSERVABILITY / UX gaps (worth fixing before onboarding users)

| # | Finding | Source |
|---|---|---|
| 21 | WsStatusBanner ok, but StatusStrip drives off `isConnected` binary — conflicting state | P43 |
| 22 | `claudeHealthy: true` hardcoded — AI outages lie | P43 |
| 23 | useDeskClock appends " ET" to local time → wrong time for non-US | P18 |
| 24 | Backend buckets trades by UTC not ET → date attribution drift | P18, P53 |
| 25 | Notifications silent to screen readers; WS fills never toast | P49 |
| 26 | TradePanel LIVE buttons `text-white` on coral = 2.8:1 AA fail | P46 |
| 27 | `--neutral` token undefined in CSS, used in 8 places | P46 |
| 28 | Destructive-foreground uses `--fg` (cream on coral) = 2.7:1 fail | P46 |
| 29 | AICopilot + skip link use `text-white` on gold = 2.1:1 fail | P46 |
| 30 | 4 tables missing `scope="col"` on headers | P49 |
| 31 | Cache-key bug on `/market/bars` omits dates → cross-range pollution | P15, P55 |
| 32 | StrategyRail hidden on mobile with no drawer → strategies unreachable on phone | P28 |
| 33 | No PWA manifest; apple-touch-icon 404; no OG images | P28, P58 |
| 34 | Sitemap lists 2 URLs; contradicts noindex on public pages | P35, P59 |

## COMPLIANCE / REGULATORY (pre-real-capital)

| # | Finding | Source |
|---|---|---|
| 35 | Audit log only in auth.py; order/halt/pipeline-run events unlogged | P17 |
| 36 | Trade model has no `broker_order_id` column → no CAT correlation | P56, P65 |
| 37 | Timestamps second-precision; fails FINRA 4590 ms-precision | P56 |
| 38 | 30-day retention undershoots SEC 17a-4(b)(1) 6-year minimum | P56 |
| 39 | Trade ledger mutable (no WORM / S3 Object Lock) | P56 |
| 40 | AI chat TTL 1h — treated as customer comms under FINRA 2210 | P56 |
| 41 | Analysis/Copilot emit recommendation-language without "not advice" disclaimer | P56 |
| 42 | Halt auto-expires 24h with no audit event | P56 |
| 43 | App-side rejections (`_risk_check` 422s) not persisted; 17a-3(a)(6) gap | P56 |
| 44 | TradingView webhook routes live orders with no principal, no 606/3110.09 | P56 |
| 45 | No consent capture at login; privacy policy claims multi-user but app is single-admin | P17 |
| 46 | No wash-sale detection; no FIFO/LIFO option; no 1099-B box mapping | P51 |

## DEFERRED (would-be-nice, not blockers)

| Category | Gaps | Sources |
|---|---|---|
| **i18n** | Zero i18n infra; `en-US`/`USD` hardcoded in 265 sites | P31, P52 |
| **Multi-account** | No `user_id`/`account_id` columns; single-admin everywhere | P30, P33 |
| **Feature flags** | Zero infrastructure | P44 |
| **Release** | No rollback tag; force-recreate outage; no pre-deploy backup | P45 |
| **Precision** | Float throughout models; `int(float(qty))` truncates fractional shares | P54 |
| **Ultrawide** | 1480 cap too tight at 5K; `/strategies/[id]` still 1280 | P47 |
| **Print CSS** | Zero @media print rules; cream-on-white at print time | P50 |
| **Offline** | No service worker; no retry in apiFetch; mutations unprotected | P48 |
| **Enterprise** | No SSO, RBAC, SOC2; single-admin | P33 |
| **Referral/journalist** | Homepage is login wall; no self-serve; no press kit | P32, P34, P60 |
| **Sector strategies** | `sector-rotation`, `dividend-capture` are planned stubs | P23, P24 |
| **Pairs UI** | Backend is rigorous; frontend has zero live z-score display | P25 |
| **Day trader** | No per-symbol WS filter; no cancel/replace; raw Alpaca wash-trade errors | P21 |
| **Backtest** | Engine is production-grade; no HTTP endpoint, frontend panel is client-JS toy | P13 |
| **Sheets/bot/API-only** | No CSV; no outbound webhooks; no Idempotency-Key | P26, P27, P29 |
| **Old browsers** | `AbortSignal.timeout` (Safari 17.4+), CSS `:has()`, no `@supports` fallbacks | P64 |
| **Mass positions** | No virtualization; 500 sparkline-bars = 500 parallel GETs | P61 |
| **Alert storm** | NotificationCenter caps at 50 rendered rows; footer count lies | P62 |

## What's working well (verified across personas)

- **Cred-stuffing defenses hold** — rate limit + XFF-spoofing both correctly blocked (P36)
- **Backend correlation via X-Request-ID** — JSON logs + ContextVar propagation (P41)
- **Backtest engine** is production-quality (walk-forward, bar-by-bar, splits+divs, Decimal costs) (P13)
- **Legal pages** (Privacy/Terms/Risk) fresh, professional, FINRA/SIPC + Alpaca + GDPR-correct (P34, P35)
- **Security headers** (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy) textbook (P35, P36)
- **Postgres concurrency** — trade_ledger migrated off JSON to Postgres with proper DDL (P54)
- **Wave 13 ET timezone fix** in PnlCalendar/PnlCalendarMini is correct (P53 verified)
- **Wave 16 WsStatusBanner** + correct ARIA roles (P43, P49)
- **Wave 31 BroadcastChannel logout** with storage-event fallback (P64)
- **Wave 33 `/pipeline/status`** exposes running/stage/progress (verified)
- **Wave 35 strategy-slug 404** real HTTP 404 (verified)

## Stats

- **50 personas** audited across R9–R18
- **~500 concrete findings** logged
- **12 P0 blockers** being fixed in Waves 41–44
- **~80 P1/P2 items** deferred post-live

Post-Wave-44 deployment, the app will be **tactically safe for live trading** — aggregate risk enforced, kill switch functional, idempotent trades, no silent demo-data substitution. The list above in "DEFERRED" is the real product-maturity roadmap.
