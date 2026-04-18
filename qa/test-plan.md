# AlphaDesk — Mental-Map Test Plan

**Branch:** `feature/deployment`
**Live:** https://tradingalpha.net
**Design source:** `design-system/alphadesk-design-system/project/`
**Scope:** what the app *should do* on the live site, expressed page-by-page as a contract.

This document is the root test plan. Per-page files under `qa/pages/<page>.md` describe each route in detail. Open the live site and verify each page's contract against the corresponding file.

## 1. Route inventory (walk of `frontend/src/app/`)

| Route | Access | File |
|---|---|---|
| `/login` | public | `qa/pages/login.md` |
| `/login/reset` | public | `qa/pages/login-reset.md` |
| `/request-access` | public | `qa/pages/request-access.md` |
| `/docs` | public | `qa/pages/docs.md` |
| `/privacy` | public | `qa/pages/privacy.md` |
| `/terms` | public | `qa/pages/terms.md` |
| `/risk` | public | `qa/pages/risk.md` |
| `/` | requires-auth (flagship trading desk) | `qa/pages/desk.md` |
| `/trade` | requires-auth → redirect to `/` | `qa/pages/trade.md` |
| `/strategies/[id]` | requires-auth | `qa/pages/strategies-detail.md` |
| `/analytics` | requires-auth | `qa/pages/analytics.md` |
| `/pipeline` | requires-auth | `qa/pages/pipeline.md` |
| `/reports` | requires-auth | `qa/pages/reports.md` |
| `/alerts` | requires-auth | `qa/pages/alerts.md` |
| `/settings` | requires-auth | `qa/pages/settings.md` |
| `/_design` | dev-only (must 404 in prod) | `qa/pages/design.md` |
| `*` (unknown) | public 404 | `qa/pages/not-found.md` |

## 2. Global shell / layout contracts

- **Flagship desk (`/`) shell** — `frontend/src/components/layouts/DeskLayout.tsx`. 4-row grid: `48px 38px 1fr 22px` (TopBar · ContextBar · main 260px/1fr/340px · StatusBar). The `(dashboard)/layout.tsx` detects `pathname === "/"` and renders *only overlays* (CommandPalette, AICopilot, ShortcutOverlay, OnboardingTour) on top of the page; the page owns the viewport.
- **Non-desk dashboard pages** — `(dashboard)/layout.tsx` chrome: skip link, `TopBar` (44px), optional `TickerTape`, `StatusStrip` (28px), main (scrollable), `footer` ("AlphaDesk v1.0 — Powered by Claude AI — © YYYY"), plus overlays.
- **Marketing shell** (`/docs`, `/privacy`, `/terms`, `/risk`, `/request-access`) — `MarketingShell.tsx`. 72px top nav (α wordmark, 4 nav links, "Sign in" text, "Request access" gold CTA), main, footer with 3 columns (Product / Company / Legal) + brand block, hairline fineprint strip.
- **Login shell** — own layout (`app/login/layout.tsx` = bare `bg-bg text-fg min-h-screen`). `/login` and `/login/reset` both use it; `/request-access` uses `MarketingShell`.
- **404** — `app/not-found.tsx` renders its own full-bleed `bg-bg text-fg` wrapper, no chrome.

## 3. Authentication & session

- **Form:** `POST /api/v1/auth/login` with JSON `{ username, password }`, `credentials: "include"`.
- **Success (200):** sets HttpOnly + Secure + SameSite cookie, client does `router.push("/")`, clears the localStorage failure counter.
- **Failure (401):** surfaces `body.detail` or generic "Invalid username or password", increments `alphadesk.login_failures` timestamps in localStorage.
- **Rate limit (429) / backend:** backend also rate-limits; UI reflects as the same failure path.
- **Client lockout:** rolling 10-minute window (`LOCKOUT_WINDOW_MS`), 5 failures (`LOCKOUT_THRESHOLD`) → submit disabled with live countdown.
- **Session lifetime:** 8h JWT in HttpOnly cookie (see `/settings` Security block).
- **Expired session behavior:** any API error with `status === 401` is **not** surfaced as a toast (swallowed by `(dashboard)/layout.tsx`), presumed handled by an auth guard elsewhere; non-401 errors emit a toast.

## 4. Command palette (`⌘K` / `Ctrl+K`)

Source: `frontend/src/components/layout/CommandPalette.tsx`. Global — mounted inside `(dashboard)/layout.tsx`.

- **Trigger:** `⌘K` or `Ctrl+K` (global keydown listener); also opens via `TopBar` search button; also opens via keyboard shortcuts `/` and `f` (`focus:search`).
- **Dialog surface:** shadcn Dialog, `max-w-xl`, dark `bg-[var(--surface)]`. Input has `Search` icon (or animated `Loader2` while debouncing).
- **Sections** (in order; each filtered by query when typing):
  1. **Search Results / Popular Symbols** — calls `searchSymbols(q)` after 300ms debounce; falls back to filtering `POPULAR_SYMBOLS` (SPY, QQQ, AAPL, MSFT, GOOGL, AMZN, NVDA, TSLA, META, AMD, NFLX, JPM, V, BA, DIS, COIN, SOFI, PLTR, SMCI, AVGO). Selecting a symbol: `setSelectedSymbol`, `addToWatchlist`, close.
  2. **Commands:** `Analyze current symbol` (shortcut `A`), `Screen momentum stocks` (shortcut `S`), `Show portfolio`, `Switch to live trading`.
  3. **Navigation:** `Focus chart panel` (shortcut `1`), `Focus options chain`.
  4. **Strategies** (filtered by query) — top 6 from `STRATEGY_META`, selecting routes to `/strategies/{id}`.
  5. **Pages** — Dashboard, Trade, Analytics, Alerts, Pipeline, Reports, Documentation.
  6. **Recent Actions** (when `q` matches) — Last order submitted, Last trade executed, Last alert triggered.
- **Footer hints:** `↑↓ navigate`, `↵ select`, `esc close`.
- **Closing:** ESC, click-outside, after navigation (automatic on `pathname` change).

## 5. Keyboard shortcuts

Source: `frontend/src/hooks/useKeyboardShortcuts.ts`. Disabled when focus is on `INPUT` / `TEXTAREA` / `contentEditable`.

| Key | Action |
|---|---|
| `?` | toggle the shortcut overlay |
| `/` or `f` | open command palette |
| `Escape` | dismiss overlay / palette |
| `g d` | navigate to Dashboard (`/`) |
| `g t` | navigate to Trade (`/trade`) |
| `g p` | navigate to Pipeline (`/pipeline`) |
| `n` / `p` | next / previous tab in `[/, /trade, /analytics, /alerts, /pipeline]` |
| `r` | dispatch `alphadesk:refresh` event |
| `1`–`8` | chart timeframe (1m / 5m / 15m / 1H / 4H / D / W / M) |
| `Ctrl+j` | toggle AI Copilot |
| `j` / `k` | watchlist next / prev |
| `b` / `s` | quick buy / sell |
| `Shift+C` / `F` / `S` | positions: close-all / flatten / stop-loss |

Chord timeout: 500ms.

## 6. Toast system

Source: `frontend/src/components/ui/toast.tsx`. Four variants: `success` (chartreuse accent, CheckCircle), `error` (coral, AlertCircle), `info` (gold, Info), `warning` (amber, AlertTriangle).

- **Position:** `fixed bottom-4 right-4`, stacks up to 3 most-recent. `pointer-events-none` container with `pointer-events-auto` items.
- **Dismiss:** auto after `duration ?? 5000`ms, or click the × button, or when an inline action button fires.
- **Animation:** `animate-in slide-in-from-right-full fade-in duration-200`.

## 7. Color / type invariants (MUST hold on every page)

Source: `design-system/alphadesk-design-system/project/SKILL.md`, `colors_and_type.css`, `docs/superpowers/specs/2026-04-17-frontend-overhaul-design.md`.

- **Background:** `--bg` = `#0b0a09` (warm near-black ink), panels `--bg-elev-1` / `--bg-elev-2` / `--bg-card`.
- **Brand accent:** `--gold-500` `#c9a66b`. One chroma. Hover = `--gold-300` `#e0c070`. Dim underline = `--brand-dim`.
- **P&L:** `--up-500` `#a8d04d` (chartreuse — profit/buy/bullish) and `--down-500` `#e07856` (coral — loss/sell/bearish). *Never* `bg-red-*`, `text-green-*`, `#22c55e`, `#ef4444`, or any traffic-light color.
- **Info / regime:** `--ice-500` `#8db3c4`. **Critical / circuit breaker:** `--wine-500`. **Attention:** `amber`.
- **Fonts (via next/font):** Newsreader (`--font-display`, italic by default); Inter Tight (`--font-ui` / class `font-sans`); JetBrains Mono (`--font-mono`, `tabular-nums`).
- **Never-appear list:**
  - No emoji anywhere in the UI.
  - No raw hex colors in component classes (exceptions: `globals.css`, `design-tokens.css`, chart fill registrations).
  - No Tailwind primitive color classes (`bg-red-*`, `text-blue-*`, etc.).
  - No numbers in sans-serif. All numerics in `font-mono tabular-nums`.
  - No "rocket / crushing it / unlock" hype copy.
  - No light mode — `<html class="dark ...">` is hardcoded in `app/layout.tsx`.

## 8. Responsive breakpoints

| Breakpoint | Behavior |
|---|---|
| `< 640px` (mobile) | MarketingShell nav hides the 4 links (hidden `sm:flex`). TopBar of non-desk dashboard layout: nav hides (`hidden md:flex`), hamburger sheet appears. Analytics / pipeline / reports / alerts grids collapse to 1 col. Desk layout (`/`) is *desktop-only* in spirit — no explicit mobile fallback; the 3-col grid still renders, will horizontal-scroll. |
| `sm` 640–767px | Nav links visible in MarketingShell. |
| `md` 768–1023px | TopBar nav visible in non-desk dashboard. |
| `lg` 1024–1279px | Analytics/reports/alerts grids 2-col. |
| `xl` ≥1280px | Dashboard page layouts center at max-width 1280. MarketingShell max-width 1440. Login grid 2-col (`lg:grid-cols-[1.05fr_0.95fr]`). |

## 9. Accessibility invariants (WCAG 2.1 AA)

- **Skip link:** "Skip to content" visible on focus at top of non-desk dashboard layout.
- **Focus visible:** every interactive element gets a focus ring — Buttons use `focus-visible:ring-1 focus-visible:ring-brand focus-visible:border-brand`. Inputs use gold focus ring.
- **ARIA labels:** dialogs use `role="dialog" aria-modal="true"`. Toasts use `role="alert"`. Command palette input is the dialog's labelled input. Tablists use `role="tablist"` / `aria-selected`. Toggle switches use `role="switch" aria-checked`.
- **Live regions:** P&L number in `StatusStrip` is `aria-live="polite" aria-atomic="true"`. Login errors use `aria-live="assertive"`.
- **Color contrast:** ink-1000 on bg ≈ 15:1 (AAA). Body fg-dim on bg ≈ 8:1. Check gold-on-bg ≈ 7:1.
- **Keyboard nav:** all interactive elements tab-focusable. `Escape` closes every overlay. Enter submits forms.
- **No-JS fallback:** login form currently has `action="#"` — known bug (iter-1-frontend.md P2), will POST to same URL and lose credentials to history.

## 10. Performance budgets (expected)

- **TTFB:** < 300ms on Hetzner VPS.
- **LCP:** < 2.5s on a cold load of `/login` or `/`.
- **Bundle:** Next.js app in `/frontend` is the only client bundle; `/_design` page should be 404 in prod (though iter-1-frontend.md P2 notes its fixtures may still ship — verify via route + bundle inspection).
- **Websocket:** `useWebSocket.ts` connects live data; `isConnected` drives the LIVE / OFFLINE indicator in `StatusStrip`.
- **Polling:** market-open / orders count polls every 30s on the desk; portfolio refresh interval is user-configurable 10s / 30s / 60s / 120s in `/settings`.

## 11. Cookie behavior

- **Auth cookie:** HttpOnly, Secure, SameSite — set by `POST /api/v1/auth/login` via backend; frontend reads via `credentials: "include"` on subsequent requests.
- **Preferences:** `alphadesk:keybindings` (localStorage) — user-custom shortcuts; `alphadesk.login_failures` (localStorage) — rolling-window login failure timestamps. Zustand stores (`preferences`, `market`) persist via `localStorage` with a `preferences` key.
- **No 3rd-party cookies.**
- **CSP:** strict (`default-src 'self'`, `frame-ancestors 'none'`, HSTS preload). Known issue per iter-1-frontend.md P0: the `@import` of Google Fonts in `design-tokens.css` is blocked by `style-src 'self' 'unsafe-inline'` — fonts are served via next/font, so the `@import` is effectively dead but should be removed.

## 12. Known issues / deferred fixes

Pull from `audit-reports/iter-1-frontend.md` for full list. Headline items (test plan reflects **current state**, not fixed state):

- [P0] iter-1-frontend.md: Google Fonts `@import` blocked by CSP → all three faces fell back before the switch to next/font.
- [P0] `var(--panel)` / `var(--surface)` used in 43 files without definitions — affects reports, alerts, pipeline, settings surfaces; panels render transparent.
- [P0] Docs §04 currently lists 12 correct strategies but login hero says "Twelve strategies" (fixed per latest page); verify no "Six" reference persists.
- [P0] `apiFetch` has no AbortController timeout.
- [P0] `mapPipelineRun` synthesizes fake `stock-N` placeholder rows when only counts are available.
- [P1] `/login`, `/login/reset`, `/request-access` have `robots: { index: false, follow: false }` now (verified in page files).
- [P1] `TradingChart` hardcodes pre-F0 hex palette (`#22c55e` / `#ef4444`).
- [P1] `portfolio` store defaults `is_demo: true` — flashes DEMO on mount.
- [P2] `/_design` route ships 698 lines of fixture constants in prod bundle.
- [P2] Login form `action="#"` — no-JS fallback loses creds.
- [P3] Login password placeholder promises "at least 12 characters" but no client validation.

## 13. How to test

1. Open https://tradingalpha.net in an incognito Chromium (no extensions).
2. Walk each route against its per-page file in order: public surfaces first (login → docs), then authenticated (desk → analytics/pipeline/reports/alerts/settings → strategies).
3. Resize the window across the breakpoints in §8. Verify layout rules for each page.
4. Run the global invariant checks in §7 against every page (hex colors, emoji, sans numerics, red/green in P&L spots).
5. Run the keyboard shortcuts in §5. Every shortcut must either fire its action or be a no-op with no console error.
6. For authenticated pages, test the full flow with valid credentials — login → dashboard → command palette → strategy detail → logout.
