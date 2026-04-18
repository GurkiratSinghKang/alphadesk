# Iteration 1 — Frontend Audit (live state, post-overhaul)
Date: 2026-04-18
Scope: live tradingalpha.net + frontend/src/

## Severity legend
P0 = user-facing break; fix before next deploy.  P1 = degraded UX; this cycle.  P2 = polish.  P3 = nice-to-have.

## Findings

### [P0] Newsreader + Inter Tight + JetBrains Mono never load in prod (CSP blocks Google Fonts)
**Where:** `frontend/src/styles/design-tokens.css:8`; CSP header `style-src 'self' 'unsafe-inline'`
**What:** The tokens' only load path is `@import url('https://fonts.googleapis.com/css2?...')`. Live CSP does not whitelist `fonts.googleapis.com` under `style-src`. `app/layout.tsx` loads `Inter` (not `Inter Tight`) and `JetBrains_Mono` via `next/font` under variables `--font-sans` / `--font-geist-mono` that the tokens never reference. All three custom fonts fall back to Georgia / system sans / Menlo.
**Why it matters:** The F0-F4 editorial identity is invisible to real users. Branded italic serif, tracked caps, mono tabular numbers — all falling back.
**Fix:** Load Newsreader, Inter Tight, JetBrains_Mono through `next/font/google` in `app/layout.tsx`; set the token vars to those Next CSS variables; remove the googleapis `@import`.

### [P0] 174 uses of undefined `var(--panel)` / `var(--surface)` across 43 components
**Where:** 43 files — e.g. `components/dashboard/PnlCalendarMini.tsx:31,35,94`, `app/(dashboard)/reports/page.tsx` (×19), `WatchlistPanel.tsx` (×8), `MorningBrief.tsx` (×6)
**What:** `--panel` and `--surface` are not defined anywhere in current `design-tokens.css` or `globals.css` (grep 0). `bg-[var(--panel)]` / `bg-[var(--surface)]` resolve to nothing → panels render with no fill.
**Fix:** Alias the old names in tokens (`--panel: var(--bg-elev-1); --surface: var(--bg-card);`) or sweep-rename callers.

### [P0] Docs advertise 12 fake strategy names; login page says "Six strategies"
**Where:** `app/docs/_docs/content.ts:49-52, 83` vs `app/login/page.tsx:77`
**What:** Docs §04 lists *Trend Surfer, Breakout Hunter, Dip Buyer, Sector Rotation, GARP, Options Wheel, Volatility Harvester, Macro Regime, Event Catalyst, Quality Compounder*. None of these exist in the repo — real strategies are `momentum_quality, pead, vrp_harvest, earnings_vol, regime_adaptive, ts_momentum, rsi2_reversal, dual_momentum, pairs_trading, kama_breakout, orb, vwap_strategy`. Meanwhile the login hero says "Six strategies, one execution layer."
**Fix:** Rewrite `DOC_SECTIONS[3]` with real names. Reconcile six-vs-twelve narrative.

### [P0] `apiFetch` has no timeout — hung requests hang forever
**Where:** `frontend/src/lib/api.ts:23-67`
**What:** No `AbortController`. Stalled TCP connections never settle; React Query's `retry: 2` can't salvage. Dashboard 30s refresh cycle compounds hung sockets against Chrome's 6-per-host limit.
**Fix:** Default 20s `AbortController` in `apiFetch`; expose `signal` via opts.

### [P0] `mapPipelineRun` synthesizes fake placeholder stocks when only a count is available
**Where:** `frontend/src/lib/api.ts:844-849, 866-873`
**What:** `Array.from({ length: totalScreened }, (_, i) => ({ symbol: 'stock-'+i, ... }))` and analyzed `symbol: '${stratName}-${i}'`. These render in PipelineFlow as if real. Same pattern as the Signals-tab fabrication flagged in the prior audit.
**Fix:** Never synthesize rows. Display the count as a number.

### [P1] 404 page uses old shadcn-alias palette, not new design tokens
**Where:** `app/not-found.tsx:5-17`
**What:** `bg-[var(--background)]`, `text-primary`, `bg-primary`, `hover:bg-primary/90`, `text-primary-foreground` — resolves via compat aliases but skips Newsreader headlines, `bg-bg`, `text-brand`. Only surface in the whole app where 404 lands.
**Fix:** Rewrite with `Display` typography and new tokens.

### [P1] MarketingShell footer has a duplicate `/risk` link
**Where:** `components/layouts/MarketingShell.tsx:60-64`
**What:** "Not investment advice" and "Risk disclosure" both `href="/risk"`. Verified in live HTML.
**Fix:** Remove or re-target one.

### [P1] MarketingShell uses `px-12` at every breakpoint — mobile overflow
**Where:** `components/layouts/MarketingShell.tsx:80`
**What:** Unconditional 48px side padding. 360px-wide phone has 264px content. Nav row (logo + links + "Sign in" + "Request access" pill) horizontally overflows on phones.
**Fix:** `px-4 sm:px-8 lg:px-12`; hamburger for the nav.

### [P1] `/login`, `/login/reset`, `/request-access` are indexable by search engines
**Where:** metadata in each page file
**What:** No `robots: { index: false }` — Google will index. Login pages in search results are an SEO leak + footprint expansion.
**Fix:** Add `robots: { index: false, follow: false }` to each.

### [P1] `TradingChart.tsx` + `OptionsPanel.tsx` hard-code pre-F0 hex palette
**Where:** `components/charts/TradingChart.tsx:284-329`; `components/panels/OptionsPanel.tsx:248,273,319`
**What:** `#0a0a0f` background, crosshair `#3b82f6` (tailwind blue-500), candle up `#22c55e`, down `#ef4444`; OptionsPanel hardcodes `bg-[#14141e]`. The F0 P&L palette is chartreuse/coral, brand is gold, never electric SaaS green/red/blue.
**Fix:** Read from CSS vars at chart init (`getComputedStyle(document.documentElement).getPropertyValue('--up-500')`).

### [P1] WS `bars` handler overwrites day-cumulative high/low with minute-bar values
**Where:** `hooks/useDataPipeline.ts:207-217`
**What:** Bar-channel callback writes `high: bar.high, low: bar.low, volume: bar.volume` into Quote. `market.ts:55` does `Math.max(existing.high, quote.high)` — bars arriving before snapshot freeze `high` at the first minute's high. Volume has the known regression.
**Fix:** Don't write H/L/V from the bar channel; only last price.

### [P1] `portfolio` store defaults `is_demo: true` — flashes "DEMO" on real accounts at mount
**Where:** `stores/portfolio.ts:18-30`
**What:** `defaultSummary.is_demo = true`. Any demo-badge render on initial mount briefly flags real accounts until the first `/api/v1/portfolio/summary` overwrites ~200-500ms later.
**Fix:** Default to `false` or `undefined`; only render demo UI on explicit `true`.

### [P1] `useDataPipeline` `hasFetched.current` latch permanently disables retries after initial failure
**Where:** `hooks/useDataPipeline.ts:19, 41-42, 57-62`
**What:** `hasFetched.current = true` is set before the async resolves. One 3s retry, then never again. If both attempts fail, the user sees no watchlist quotes for the entire session.
**Fix:** Only set `hasFetched.current = true` inside a successful `.then`; add exponential backoff.

### [P2] `/_design` (698 lines of fixture data) ships in production bundle
**Where:** `app/_design/page.tsx`
**What:** Route redirects to `/login` in prod, but the page file is still in the client bundle. Fixture constants (`SERIES`, `TABLE_ROWS`, `TICKERS`, `RAIL_ITEMS`, `POSITIONS`, `MEMO`) plus 12 composite imports.
**Fix:** `if (process.env.NODE_ENV === 'production') notFound()` at top of the page component.

### [P2] `useWebSocket.onopen` resets `retriesRef=0` before auth verification
**Where:** `hooks/useWebSocket.ts:67-82`
**What:** If server rejects auth and closes, retry counter already zeroed → 1s reconnect storm instead of backoff. Also `setTimeout(resend, 100)` can fire on an already-closing socket.
**Fix:** Reset on `auth_ok` message, not on `open`.

### [P2] Dead `isTrailing ? null : null` ternary in `placeOrder`
**Where:** `lib/api.ts:422-423`
**What:** `isTrailing ? null : null` always evaluates null — a half-finished branch that was probably meant to return `trail_price`. Dead code hides a potentially broken trailing-stop payload for Alpaca.
**Fix:** Delete and verify Alpaca's trailing-stop payload shape.

### [P2] `hvRatio` returns `0` (not `null`) when `current_iv` is missing
**Where:** `lib/api.ts:395`
**What:** `((current_iv ?? 0) / Math.max(hv_20 ?? 1, 0.01))` — null input becomes a valid-looking `0` ratio downstream. Classic "zero hides null" anti-pattern.
**Fix:** Return `null` on missing inputs; display "—".

### [P2] Fetch layer has zero runtime response validation
**Where:** `lib/api.ts` (all `apiFetch<T>` sites)
**What:** Return type is asserted, not validated. Missing fields crash at render (`.toFixed` on undefined). Affects `getStrategies`, `getMarketIndices`, `getMarketRegime`, `getIndexSparklines`, and others.
**Fix:** Add zod schemas at the fetch boundary; surface validation errors via the existing `alphadesk:api-error` event.

### [P2] Login form `action="#"` — no-JS fallback loses credentials to history
**Where:** `app/login/_login/LoginForm.tsx:154-155`
**What:** If JS fails to hydrate, `<form method="POST" action="#">` POSTs to the same URL and reloads, putting typed password fragments in browser history/referer.
**Fix:** Set `action="/api/v1/auth/login"` or drop the attribute.

### [P2] Login lockout countdown keyed on OLDEST failure — drops to 0 even right after triggering lockout
**Where:** `app/login/_login/LoginForm.tsx:88-94`
**What:** `LOCKOUT_WINDOW_MS - (now - oldest)`. If the 5th fail happens 9 min after the 1st, lockout displays "1m 00s" remaining even though the user *just* tripped it.
**Fix:** Use `newest + LOCKOUT_DURATION` for the unlock clock.

### [P2] `getPnlCalendar` silently returns empty on shape mismatch
**Where:** `lib/api.ts:551-568`
**What:** `(days || []).map(...)` swallows `days: null` or wrong shape. No error surfaced, calendar just renders empty. Same fall-through in `mapPipelineRun`.
**Fix:** Throw / dispatch error event when the expected shape is missing.

### [P3] MarketingShell primary CTA uses `text-primary-foreground` (legacy alias)
**Where:** `components/layouts/MarketingShell.tsx:123`
**What:** `--color-primary-foreground: #1a1206` is raw hex in `globals.css:94` and bleeds into the brand CTA.
**Fix:** Replace with `text-ink-1000` or add a `--brand-fg` token.

### [P3] Login password placeholder "at least 12 characters" with no client-side enforcement
**Where:** `app/login/_login/LoginForm.tsx:194`
**What:** UX promises a rule the client doesn't validate; backend returns the same generic "Invalid username or password" for both wrong-pw and wrong-length, confusing users.
**Fix:** `minLength={12}` + client-side message, or drop the placeholder.

### [P3] `/login/reset` page has no MarketingShell — user is stranded from docs/privacy/terms
**Where:** `app/login/reset/page.tsx:22` (intentionally bypasses shell per comment)
**What:** Only link out is "Back to sign in." Cold visitors arriving via email can't reach `/docs`, `/privacy`, `/risk`, `/terms`.
**Fix:** Add a minimal top-bar or use MarketingShell with a trimmed nav.

## What's good
- **Login P0-8 / P0-9 genuinely fixed:** show/hide password, caps-lock detection, rolling-window lockout in `LoginForm.tsx`, and a real `/login/reset` page replacing the mailto.
- **StaticClause / EditorialBullet / MailA pattern** cleanly decouples policy content from layout — privacy/terms/risk pages are ~20 lines each.
- **CSP is present and strict** (default-src 'self', frame-ancestors 'none', HSTS preload). Ironic that it's what blocks the F0-F4 fonts.
- **Password lockout is localStorage-backed rolling window** rather than cookie — works with HttpOnly sessions.
