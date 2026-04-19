# Persona 35 — Demo / pre-login visitor

**Scenario**: Landed on `/login` from a link, not signed in. Exploring what can be reached
without auth and grading the polish of the public surface.

**Date**: 2026-04-18
**Reviewer**: public-facing audit (no credentials)
**Site**: https://tradingalpha.net

## What's actually reachable without auth

`proxy.ts` treats `/login`, `/login/*`, `/privacy`, `/terms`, `/risk`, `/docs`,
`/request-access` as public. Unknown paths fall through to `not-found.tsx` (HTTP 404).
Unauthed visits to `/`, `/trade`, `/pipeline`, `/strategies`, `/analytics`, `/alerts`,
`/settings`, `/reports` are 307'd to `/login` and the stale cookie is cleared (good).
`/_design` returns 404 in production (good — 698 lines of fixture data withheld).

## Findings (max 10)

### 1. Sitemap contradicts `noindex` on `/login` — SEO leak
`GET /sitemap.xml` lists `https://tradingalpha.net/` and `https://tradingalpha.net/login`,
but `app/login/page.tsx:15` sets `robots: { index: false, follow: false }` and the
rendered HTML carries `<meta name="robots" content="noindex, nofollow">`. Telling
crawlers "here is my login page" and "do not index it" simultaneously is
self-defeating. Worse, the public-content pages (`/docs`, `/privacy`, `/terms`,
`/risk`) are NOT in the sitemap at all — the only two URLs advertised are
`/` (which redirects to login) and `/login` (which refuses to be indexed).
Net effect: zero public pages are actually discoverable via sitemap.

### 2. 404 page has no shell, footer, or path back to sign in
`app/not-found.tsx` renders a bare div — no `MarketingShell`, no nav, no footer.
It offers two CTAs: "Back to AlphaDesk" (`href="/"`, which 307s unauthed users
to `/login` — so this works, but indirectly) and "Read the docs" (`/docs`).
There is no direct "Sign in" link. Rendered HTML has only `href="/"` and
`href="/docs"`. Inconsistent with the rest of the public surface (which carries
the editorial nav + footer via `MarketingShell`). Found at
`frontend/src/app/not-found.tsx:14-54`.

### 3. 404 page title is generic
`<title>AlphaDesk — AI-Powered Trading Terminal</title>` on a 404 — inherited
from `app/layout.tsx:34`. No `export const metadata` in `not-found.tsx`, so
Google sees the same title as the homepage for every broken URL. Should be
something like "Not found — AlphaDesk" and `robots: noindex` (the page body
does carry `<meta name="robots" content="noindex">` but the title is still wrong).

### 4. "Twelve strategies" claim is inconsistent with the registry
`/login` hero: "Twelve strategies, one execution layer" (page.tsx:81).
`/docs` §04 Strategies: "AlphaDesk runs twelve parallel trading strategies"
(`_docs/content.ts:49`). But `frontend/src/lib/strategies.ts` `STRATEGY_ORDER`
lists 19 ids (momentum-quality, pead, vrp-harvesting, earnings-vol-premium,
regime-adaptive, claude-alpha, dividend-capture, sector-rotation, ts-momentum,
rsi2-reversal, dual-momentum, pairs-trading, pairs-stat-arb, kama-breakout,
orb, vwap-strategy, mean-reversion, vcp-breakout, gap-fill, manual-discretionary).
The docs even enumerate 13 specific strategies by name in §04 — 6 fundamental
books plus 7 technical — which already contradicts "twelve" in the same
sentence. Public-facing copy should match the registry or be rephrased to
"a book of equity strategies" without a hard count.

### 5. `/login/reset` openly admits the reset flow isn't built
"Self-serve reset is not yet wired. Until it is, the desk rotates passwords
by hand on request." This is honest (good), but it's a visible roadmap hint
to competitors: token-signed email reset is on the to-do list. The copy at
`login/reset/page.tsx:42-46` and `:65-66` signals a not-yet-implemented feature.
Not a bug, but worth knowing it's public information.

### 6. `/request-access` is also manual-only, by design
"The desk onboards one book at a time, so the process is deliberately manual"
(`request-access/page.tsx:33`). No form; the entire flow is a `mailto:
legal@tradingalpha.net`. Polished but signals that no automated onboarding/
billing/provisioning pipeline exists. Along with §5, this says: "auth + access
management is still a human process."

### 7. No OG image on any public page
`app/layout.tsx:38-50` sets `openGraph` title + description + url but no
`images:` array. Rendered HTML on `/login`, `/docs`, etc. has no `og:image`
or `twitter:image` meta. Shared links in Slack/Twitter/iMessage will show
a bare text preview with no visual. Low-effort fix given the editorial
design system already exists.

### 8. `/login` form UX is polished
Password show/hide toggle (keyboard-accessible per a11y audit r3), caps-lock
hint, client-side 5-attempts-in-10-minutes lockout with live countdown,
`noscript` warning ("JavaScript is required to sign in"), session-expired
banner rehydrated from `sessionStorage`. `autoComplete="username"`/`current-password`
wired correctly. `aria-invalid`, `role="alert"`, `aria-live` on the error paragraph.
No issues found — this is genuinely production-grade.

### 9. Public pages are polished editorially, and recent
`/privacy`, `/terms`, `/risk` all use `StaticArticle` wrapping `MarketingShell`
with consistent `§ NN · Heading` section rules, newsreader italic display
headings, mono tracked-caps meta. All three carry `lastUpdated: "2026-04-12"`
(6 days ago). Legal copy addresses GDPR, CCPA, data breach notification,
PDT rule, counterparty risk (SIPC $500k), AI hallucination disclaimer,
paper-vs-live divergence. Every in-page CTA email resolves
(`support@tradingalpha.net`, `legal@tradingalpha.net`) and both external
links (`alpaca.markets/disclosures`, `anthropic.com/privacy`) return 200.

### 10. Security/transport headers are correct on `/login`
`strict-transport-security: max-age=31536000; includeSubDomains; preload`,
`x-frame-options: DENY`, `x-content-type-options: nosniff`,
`referrer-policy: strict-origin-when-cross-origin`,
`permissions-policy: camera=(), microphone=(), geolocation=()`,
CSP with `frame-ancestors 'none'`, `connect-src 'self' wss://tradingalpha.net`.
TTFB 122 ms for `/login` (26 KB), 238 ms for `/docs` (61 KB). Cached through
Caddy (`via: 1.1 Caddy`, `x-nextjs-cache: HIT`). One minor note: CSP allows
`'unsafe-inline'` in both `script-src` and `style-src`, which is conventional
for Next.js output but weakens XSS protection.

## Summary (≤ 250 words)

The public surface is in good shape. `/login` is genuinely polished — show/hide
password toggle, caps-lock hint, client-side lockout with a live countdown,
session-expired banner, correct autocomplete attributes, a `noscript` fallback,
and `aria-live` error regions that survive an accessibility audit. The three
legal pages (`/privacy`, `/terms`, `/risk`) share a consistent editorial shell,
were updated six days ago, and read like real lawyer-reviewed copy rather than
boilerplate: GDPR/CCPA carve-outs, breach notification, PDT rule, counterparty
risk, AI hallucination disclaimer, paper-vs-live divergence. Security headers
on `/login` are textbook (HSTS preload, frame-ancestors none, nosniff,
permissions-policy), and TTFB is ~120 ms. Every email link resolves; both
external links (Alpaca disclosures, Anthropic privacy) return 200.

Findings worth fixing: the sitemap lists only `/` and `/login` — and `/login`
is also `noindex`, so the sitemap is actively self-defeating while the actually-
public pages (`/docs`, `/privacy`, `/terms`, `/risk`) are absent. The 404 page
bypasses `MarketingShell`, inherits the generic homepage `<title>`, and
offers no direct "Sign in" link. The "twelve strategies" claim on both
`/login` and `/docs` contradicts the 19-entry `STRATEGY_ORDER` registry.
No OG image is set anywhere, so shared links look bare. And the page
copy honestly telegraphs two not-yet-built features — self-serve password
reset and automated access provisioning — both replaced by
"email the desk" flows that are transparent but signal a small team.

## Files reviewed

- /Users/GK/Downloads/alphadesk/frontend/src/app/login/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/login/layout.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/login/_login/LoginForm.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/login/reset/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/not-found.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/request-access/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/docs/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/docs/_docs/content.ts
- /Users/GK/Downloads/alphadesk/frontend/src/app/privacy/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/privacy/_privacy/content.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/terms/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/terms/_terms/content.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/risk/page.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/risk/_risk/content.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/app/layout.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/components/layouts/MarketingShell.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/components/layouts/StaticArticle.tsx
- /Users/GK/Downloads/alphadesk/frontend/src/proxy.ts
- /Users/GK/Downloads/alphadesk/frontend/src/lib/strategies.ts
