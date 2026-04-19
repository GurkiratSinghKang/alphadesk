# Persona 59 — SEO Specialist Audit

**Date:** 2026-04-18
**Target:** https://tradingalpha.net
**Scope:** robots.txt, sitemap.xml, JSON-LD, canonicals, meta descriptions, titles, internal link graph

---

## Summary

AlphaDesk is an invite-only systematic trading terminal, and the production site is deliberately low-surface-area to search engines — `/` redirects to `/login` (307), and every public page (`/login`, `/request-access`, `/docs`, the 404) ships with `<meta name="robots" content="noindex, nofollow">`. That is defensible product strategy (no public docs, no marketing SEO objective), but the discoverability plumbing contradicts itself: a sitemap is advertised in `robots.txt` and served at `/sitemap.xml`, yet every URL the sitemap lists is then `noindex`ed. Crawlers are being told "index these" and "don't index these" simultaneously, which wastes crawl budget and risks `noindex` from a `<meta>` tag being treated as a soft-404 signal over time.

The metadata that is present is passable for social sharing but has bugs: `og:url` is globally hardcoded to `https://tradingalpha.net` (so every page's Open Graph card points at the homepage), no page has a `<link rel="canonical">`, there is no `og:image` (Twitter card is declared `summary_large_image` but the image doesn't exist, so cards will fall back to no-image or refuse to render), no `application/ld+json` structured data exists anywhere, and `twitter:description` on the homepage is truncated to "Claude-powered trading platform." — a 31-character description that is much shorter than the matching `description`/`og:description`. The homepage title (`AlphaDesk — AI-Powered Trading Terminal`) and the login/docs/request-access titles follow a clean `Page — AlphaDesk` pattern, which is the one SEO thing the site is doing well.

Internal link graph is almost nonexistent because the authenticated product is gated — the only public hrefs I can see from the login/404/homepage (all the same shell) are `/login`, `/login/reset`, `/request-access`, `/docs`, and `/`. No breadcrumbs, no footer sitemap, no cross-links. Given the noindex posture, that is consistent. The highest-leverage fixes are: either commit to noindex (remove sitemap.xml and the Sitemap directive from robots.txt), or commit to indexing (remove noindex from `/`, `/login`, `/docs` and add canonicals + og:image + JSON-LD). The current half-state is the worst of both.

---

## Findings (10)

### 1. Sitemap contradicts `noindex` on every listed URL — HIGH
`/sitemap.xml` lists `https://tradingalpha.net/` and `https://tradingalpha.net/login`. Both pages return `<meta name="robots" content="noindex, nofollow">` (login) and `<meta name="robots" content="noindex">` (homepage 404 fallback). Googlebot will fetch, render, discover noindex, drop — but this wastes crawl budget and the "Sitemap URL marked noindex" warning surfaces in Search Console as a soft error. **Fix:** either remove the sitemap entirely and the `Sitemap:` line from robots.txt (if intent is truly private), or remove noindex from the two URLs the sitemap lists.

### 2. No `<link rel="canonical">` on any page — HIGH
Checked `/`, `/login`, `/request-access`, `/docs`. None of them emit a canonical tag. With `/` currently 307-redirecting to `/login`, the absence of canonicals means any future trailing-slash, query-string, or uppercase-path variant will be treated as duplicate content. **Fix:** add `alternates.canonical` in the Next.js `generateMetadata` for each public route. Minimum: `/login`, `/request-access`, `/docs`, and the marketing `/` once it stops redirecting.

### 3. `og:url` hardcoded to homepage on every page — HIGH
On `/login`, `/request-access`, `/docs`, the 404, and `/` the HTML ships `<meta property="og:url" content="https://tradingalpha.net"/>`. Social shares of `/docs` or `/request-access` will present the homepage URL in the card. **Fix:** make `og:url` dynamic per route via Next.js metadata (`openGraph.url`).

### 4. Missing `og:image` despite declaring `summary_large_image` — HIGH
`<meta name="twitter:card" content="summary_large_image">` is set but no `og:image` or `twitter:image` is present anywhere. Twitter and LinkedIn will render a degraded text-only card or refuse to unfurl. **Fix:** add a 1200x630 branded image (`/og-image.png`), declare `openGraph.images` and `twitter.images` in `app/layout.tsx`.

### 5. No structured data (JSON-LD) anywhere — MEDIUM
No `application/ld+json` blocks on any page. Even for an invite-only product, a minimal `Organization` schema on `/` (name, url, logo, sameAs) and `SoftwareApplication` schema would give Google a clean knowledge-panel hook if the brand ever gets discovered. Currently zero structured data means no rich-result eligibility. **Fix:** inject `<Script type="application/ld+json">` with `Organization` + `WebSite` in root layout.

### 6. `twitter:description` truncated vs `og:description` — MEDIUM
Homepage/login: `og:description` = "Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management." (121 chars). `twitter:description` = "Claude-powered trading platform." (31 chars). This inconsistency suggests a copy-paste error — either deliberately shortened and lost detail, or a bug. **Fix:** reuse the same description string for both.

### 7. `robots.txt` `Allow: /` then `Disallow: /api/` then Sitemap listing noindex'd pages — MEDIUM
```
User-agent: *
Allow: /
Disallow: /api/
Sitemap: https://tradingalpha.net/sitemap.xml
```
The `Allow: /` is redundant (default), `Disallow: /api/` is good, but the Sitemap line combined with the noindex meta tags on every page sends mixed signals (see finding #1). Also missing: `Disallow: /_next/`, `Disallow: /login/reset` (parameterized reset-token pages should not be crawled even if noindex'd). **Fix:** tighten disallow list; resolve the sitemap/noindex contradiction.

### 8. No `hreflang` and no `og:locale` despite `<html lang="en">` — LOW
The HTML declares `lang="en"` but metadata does not emit `og:locale` or hreflang. If the desk ever plans multi-region rollout (persona-31 i18n audit exists), this is an architectural gap to address now rather than retrofit. **Fix:** add `openGraph.locale: 'en_US'` and reserve the hreflang pattern in metadata helpers.

### 9. No `/llms.txt` and `/docs` is `noindex`'d — LOW
There is no `/llms.txt` at the root (checked — returns the 404 shell). For an AI-adjacent product that explicitly uses Claude for pre-trade analysis, this is a missed positioning opportunity with AI crawlers (ChatGPT, Claude, Perplexity). Also `/docs` is noindex'd, so the documentation cannot be surfaced via AI search either. **Fix:** publish a minimal `/llms.txt` describing the product and a public docs index; decide whether docs should be public-indexable.

### 10. Title length and brand separator are good, but homepage title duplicates on 404 — LOW
Titles follow `Page — AlphaDesk` pattern (em-dash separator, under 60 chars — good). However the Next.js 404 shell serves `<title>AlphaDesk — AI-Powered Trading Terminal</title>` (the default homepage title) on missing pages instead of something like `404 — Not on the tape — AlphaDesk`. This dilutes title uniqueness and any 404 that accidentally gets indexed will collide with the homepage title. **Fix:** add `export const metadata = { title: '404 — Not on the tape — AlphaDesk' }` to the `not-found.tsx`.

---

## Quick wins (ship this week)
1. Add canonicals to every page (1 line per route in Next.js metadata).
2. Fix `og:url` to be dynamic per route.
3. Add a single branded `og-image.png` and wire it up globally.
4. Fix `twitter:description` to match `og:description`.
5. Decide: fully private (drop sitemap) OR public marketing (drop noindex on `/`). The current hybrid is actively worse than either.
