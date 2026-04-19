# Persona 57 — Share-with-Advisor

## Scenario
Trader wants to hand an advisor a read-only view of a strategy (or a specific trade) via a link, attachment, or PDF.

## Summary (250 words)

AlphaDesk has no public-share capability. There is no read-only link, no
advisor-view URL, no tokenized share route, no PDF export, and no strategy
snapshot endpoint anywhere in the codebase. Every API router except
`/webhooks` and `/auth` is mounted with `dependencies=[Depends(require_auth)]`
(`backend/main.py:175-189`), and the frontend has only the authenticated
`(dashboard)` route group plus marketing pages (`login`, `privacy`, `terms`,
`request-access`) — no `/share/...`, `/public/...`, or `/embed/...` segment
exists.

The one artifact named "share" is `frontend/src/components/panels/ShareTrade.tsx`,
the Wave-5 ShareTradeButton. It renders a 420px card purely in the client,
offers "Copy to Clipboard" (plain-text summary) and "Download PNG"
(hand-rolled Canvas2D render) — but **it is never imported**. `grep
ShareTradeButton` across `frontend/src` returns only the definition, so
even the text/PNG path is dead code that no user can reach. Nothing about
it produces a link — PNG is `canvas.toBlob` → object URL → `<a download>`,
lifetime = until `URL.revokeObjectURL`.

No PDF library exists on either side — `backend/requirements.txt` has no
`reportlab`/`weasyprint`/`pdfkit`, and the frontend ships no `jspdf` or
`html2canvas`. The strategies router exposes `/`, `/leaderboard`,
`/{id}/performance`, `/{id}/analytics`, `/{id}/positions`, and admin
endpoints, none of which are shareable. For advisor hand-off today the
trader must screenshot manually or export the PNG from dead code they
can't see. The primitive exists at component level but the product wiring
(mount point, URL, server artifact, access token) is entirely missing.

## Findings (max 10)

### 1. No public share endpoint exists — every API route requires auth
`backend/main.py:175-188` mounts every non-auth/non-webhook router with
`dependencies=[Depends(require_auth)]`. There is no `/share`, `/public`,
`/embed`, or tokenized route anywhere under `backend/api/routes/`. A
search for `share_token`, `public_link`, `read_only` in the backend
returns zero hits.

### 2. No frontend share route
`frontend/src/app/` contains `(dashboard)`, `login`, `privacy`, `terms`,
`request-access`, `risk`, `_design`, `docs` — no `share`, `public`,
`view`, or `embed` segment. The dashboard group itself is gated by
middleware, so no URL exists that an unauthenticated advisor could open.

### 3. ShareTradeButton is orphaned — defined but never imported
`frontend/src/components/panels/ShareTrade.tsx:263` defines
`export function ShareTradeButton`, but `grep ShareTradeButton` across
`frontend/src` returns **only** that definition line. No page, panel, or
layout imports it. The Wave-5 feature is unreachable in the running
product — the button does not appear on any screen.

### 4. Even if mounted, ShareTradeButton produces no shareable link
The component has two actions: `handleCopyText` (clipboard plain-text)
and `handleDownloadPng` (`canvas.toBlob` → `URL.createObjectURL` →
`<a download>`, then `revokeObjectURL`). Neither writes to a server,
creates a token, or returns a URL. The PNG exists only on the trader's
disk; nothing lets an advisor fetch it by link.

### 5. No PDF export — zero PDF libraries in the project
`backend/requirements.txt` does not list `reportlab`, `weasyprint`,
`pdfkit`, `xhtml2pdf`, or `playwright`/`puppeteer`. The frontend
`package.json` has no `jspdf`, `html2canvas`, `html-to-image`, or
`react-pdf`. There is literally no code path that can emit a `.pdf`.

### 6. Strategy detail endpoints are all authenticated and user-scoped
`backend/api/routes/strategies.py` exposes `/`, `/leaderboard`,
`/{strategy_id}/performance`, `/{strategy_id}/analytics`,
`/{strategy_id}/positions`, `/{strategy_id}/toggle`, plus
`/admin/risk-monitor` and `/admin/leaderboard` (admin-only via
`require_admin`). None take a share token, none return a public-safe
snapshot — an advisor cannot receive a link that resolves to any of
these without the trader's session cookie.

### 7. ShareCard renders client-side only — no server snapshot
`ShareTrade.tsx:110-252` builds the card from live Zustand store state
(`useMarketStore` quotes + `analysis` prop). There is no server-side
`POST /share` that persists `{symbol, price, technicals, summary}` as a
durable snapshot. If a trader managed to DOM-inspect the button into
existence, the PNG they'd download captures live data that drifts the
moment markets move — not a preserved artifact at the advisor's eventual
view time.

### 8. Copy-to-Clipboard text is the only "shareable" artifact today
`buildTextSummary` (`ShareTrade.tsx:68-106`) emits ~6 lines of plain text
ending in "Via AlphaDesk — tradingalpha.net". This is the product's
entire sharing surface as of Wave 5, and it's unreachable because no UI
mounts it. A trader today must screenshot their browser window manually
to show an advisor anything.

### 9. Strategies page has no export/download/print affordance
`frontend/src/app/(dashboard)/strategies/page.tsx` (surfaced by the
share grep) contains strategy listing + detail views but no "Share",
"Export", "PDF", or "Print" button. No `window.print`, no PNG route,
no CSV download — nothing even approximating advisor hand-off for a
strategy.

### 10. No webhook/email/Slack share-out path either
`backend/api/routes/webhooks.py` has one endpoint — `POST /tradingview`
(inbound from TradingView), not outbound. There is no SendGrid, SES,
Mailgun, or Slack integration that would email a strategy snapshot to
an advisor. The only unauthenticated surface (`/api/v1/webhooks/...`)
accepts data in; nothing sends it out.

## Verdict

**Advisor share-out capability: 0/10.** ShareTrade (Wave 5) exists as a
component file but is not wired in, produces no link, and would only
generate a local PNG of a single-symbol card even if it were. No
strategy share, no read-only URL, no PDF, no email, no tokenized
snapshot. The persona cannot complete their task through the product.

## Files referenced
- `/Users/GK/Downloads/alphadesk/frontend/src/components/panels/ShareTrade.tsx` (orphaned ShareTradeButton, client-only PNG/text)
- `/Users/GK/Downloads/alphadesk/backend/main.py` (lines 175-189, blanket `require_auth`)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/strategies.py` (all routes auth-gated)
- `/Users/GK/Downloads/alphadesk/backend/api/routes/webhooks.py` (inbound only)
- `/Users/GK/Downloads/alphadesk/backend/requirements.txt` (no PDF libs)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/` (no `/share`, `/public`, `/embed`)
