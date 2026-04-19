# Persona 60 — Journalist / Podcaster Press Kit Audit

**Audit date:** 2026-04-18
**Persona:** Journalist or podcaster requesting logos, brand guidelines, executive bios, and a press kit ZIP for a story on AlphaDesk (tradingalpha.net).
**Tested surfaces:** Next.js app router at `frontend/src/app/*`, `public/` static assets, `public/robots.txt`, `public/sitemap.xml`, backend API routes (`backend/api/routes/`), reverse proxy (`infrastructure/Caddyfile`), and the in-repo `design-system/` bundle.
**Method:** Route enumeration, gitignore inspection, `git ls-files`, asset inventory. Max 10 findings.

---

## Summary (≈250 words)

The public marketing surface is journalist-hostile by design. A reporter arriving cold at tradingalpha.net hits a login wall, a two-URL sitemap (`/` and `/login`), and no press, about, media, team, company, or brand page anywhere in the Next.js app router. Enumerated routes are: `(dashboard)` (gated), `_design` (404 in production), `docs`, `login`, `privacy`, `request-access`, `risk`, `terms`. None of these carry logos, executive bios, founder names, company address, AUM, funding history, contact-for-press email, or downloadable assets. `public/` holds seven files — six generic Next/Vercel scaffolding SVGs and a two-URL sitemap — no `/press`, no `/brand`, no press-kit ZIP, no PR contact. Backend has no `press`, `about`, `team`, or `brand` route. Caddy's reverse-proxy config has no alias routing any such path. The separate `design-system/alphadesk-design-system/` folder **is committed to git (31 tracked files)** — it is NOT gitignored. It contains real brand assets (`logo-alpha-mark.svg`, `logo-wordmark.svg`, `logo-lockup.svg`, `mark-mono.svg`), a tokens file (`colors_and_type.css`), HTML previews for brand voice and components, and a `README.md` labelling it a "Claude Design handoff bundle" for engineering — **not a press kit**. A matching `AlphaDesk Design System-handoff.zip` (118 KB) sits at the repo root, also tracked in git but never served over HTTP (nothing in `public/` or Caddy references it). None of this is publicly reachable. Recommendation for the journalist: nothing to download; email `/request-access` and ask. Recommendation for AlphaDesk: add `/press` route + `public/brand/` assets + a machine-readable `security.txt`-style contact.

---

## Findings (10)

### 1. No `/press` route exists
No folder or `page.tsx` under `frontend/src/app/` named `press`, `media`, `newsroom`, `pr`, or similar. App router routes total eight top-level segments: `(dashboard)`, `_design` (dev-only, 404 in prod), `docs`, `login`, `privacy`, `request-access`, `risk`, `terms`. Full list verified at `/Users/GK/Downloads/alphadesk/frontend/src/app/`.

### 2. No `/about`, `/team`, `/company`, or `/brand` route either
Same enumeration. There is no page describing the firm, its founders, headcount, location, funding, or legal entity. A reporter cannot name a CEO or headquarters from the public site.

### 3. Sitemap advertises only two URLs
`/Users/GK/Downloads/alphadesk/frontend/public/sitemap.xml` lists `https://tradingalpha.net/` and `https://tradingalpha.net/login`. Nothing else is surfaced to crawlers — so even if press pages existed, Google News and podcast researchers wouldn't find them.

### 4. `robots.txt` is permissive but there's nothing to crawl
`/Users/GK/Downloads/alphadesk/frontend/public/robots.txt`: `User-agent: * / Allow: / / Disallow: /api/ / Sitemap: ...`. The login page itself sets `noindex, nofollow` (per persona-34 audit), so the practical indexed surface is zero.

### 5. `public/` has no brand assets
`/Users/GK/Downloads/alphadesk/frontend/public/` contains exactly seven files: `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` (Next.js starter scaffolding), plus `robots.txt` and `sitemap.xml`. No `logo.svg`, no `logo.png`, no `favicon` variants beyond `app/favicon.ico`, no `/brand/` directory, no press-kit ZIP served over HTTP.

### 6. Backend exposes no press/about/brand endpoints
`/Users/GK/Downloads/alphadesk/backend/api/routes/` contains 14 route modules (agents, analysis, auth, market, market_overview, news, options, pipeline, portfolio, risk, screener, strategies, symbols, trades, webhooks). None mention `press`, `about`, `team`, `brand`, or `company` as a route. `news.py` is market news ingestion, not company press.

### 7. Caddy reverse proxy has no press alias
`/Users/GK/Downloads/alphadesk/infrastructure/Caddyfile` does not alias `/press`, `/brand`, `/media`, `/about`, or `/design-system` to anything — so even if a static folder existed, it wouldn't be reachable externally.

### 8. `design-system/alphadesk-design-system/` is tracked in git, NOT gitignored
`.gitignore` at repo root does not mention `design-system` or `alphadesk-design-system` in any form (verified by pattern search). `git ls-files design-system/` returns **31 tracked files**. Anyone cloning the repo — or browsing the GitHub/GitLab remote if public — gets the full bundle. This is a **supply-chain / brand-leak risk** if the remote is public: press can scrape logos and brand rules the firm has not officially released.

### 9. Design-system bundle contents are brand-grade but marked internal
`/Users/GK/Downloads/alphadesk/design-system/alphadesk-design-system/` ships:
  - Logos: `project/assets/logo-alpha-mark.svg`, `logo-lockup.svg`, `logo-wordmark.svg`, `mark-mono.svg`.
  - Tokens: `project/colors_and_type.css`.
  - HTML previews: `project/preview/brand-logo.html`, `brand-voice.html`, plus color (gold, ink, semantic) and component pages.
  - UI kits: `project/ui_kits/marketing-landing.html`, `webapp-trading-desk.html`, `mobile-companion.html`, `ios-frame.jsx`.
  - README (`design-system/alphadesk-design-system/README.md`) explicitly frames this as a **Claude Design handoff for coding agents**, not a press kit. Misusing these as "official brand" risks inconsistency with whatever the firm later publishes.

### 10. A pre-built ZIP exists at repo root but is never served
`/Users/GK/Downloads/alphadesk/AlphaDesk Design System-handoff.zip` (118,607 bytes, dated 2026-04-18) sits at the repo root. It is tracked in git. It is NOT copied into `frontend/public/`, NOT referenced from any page, and NOT aliased by Caddy. Ironically the exact artifact a journalist would want (a single downloadable bundle) exists in the repo but is invisible to the public web. No `press@tradingalpha.net`, `media@tradingalpha.net`, or PR contact address appears anywhere in `terms/`, `privacy/`, `risk/`, `docs/`, or `layout.tsx` metadata; the only contact path is the gated `/request-access` form.
