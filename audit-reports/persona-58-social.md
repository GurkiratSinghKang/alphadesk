# Persona 58 — Social Preview Audit

**Target:** `tradingalpha.net` (redirects → `/login`)
**Date:** 2026-04-18
**Method:** `curl` inspection of HTML `<head>`, asset probes, and bot-UA fetches (Twitterbot, facebookexternalhit).

---

## Summary (250 words)

Pasting `tradingalpha.net` into Twitter, LinkedIn, or Slack will produce a **broken, thumbnail-less preview card**. The homepage (`/`) issues a 307 redirect to `/login`, which all social scrapers (Twitterbot, facebookexternalhit, LinkedInBot, Slackbot) follow. The resulting `<head>` does carry a baseline set of Open Graph and Twitter Card tags — `og:title`, `og:description`, `og:url`, `og:site_name`, `og:type=website`, `twitter:card=summary_large_image`, `twitter:title`, `twitter:description` — but **no `og:image` or `twitter:image` is declared**, so every preview will render as a text-only card with a generic gray/blank image slot. Worse, `twitter:card` is explicitly set to `summary_large_image`, which Twitter requires an image for; without one, Twitter silently downgrades to a compact card or drops the preview entirely.

Additional problems: `apple-touch-icon.png` returns **404** (iOS home-screen pins will show a blurred screenshot fallback), no `manifest.json` / PWA manifest is served, no `theme-color` meta is set (Slack/iOS Safari use a dull default chrome color), and no `og:locale`, `twitter:site`, or `twitter:creator` handles are declared (LinkedIn cards omit attribution). The `og:description` on every page is cloned from the homepage — the Sign-in and Password Reset pages don't override it, so any shared deep link is misleading. Finally, there is a **direct contradiction**: `robots.txt` allows crawling of `/`, but the HTML head emits `robots: noindex, nofollow` on every rendered page, which will block the site from search entirely while leaving it reachable. Overall: functional enough to not crash, but an unbranded, image-less preview on every platform.

---

## Findings (10)

### 1. No `og:image` declared — preview card has blank/generic thumbnail slot
The homepage renders `twitter:card=summary_large_image` but the head contains **zero** `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, or `twitter:image` tags (`grep -c` returned 0 on the full HTML). Twitter, Facebook/Meta, LinkedIn, and Slack will all render a text-only card with a broken-image placeholder or omit the image entirely.
**Fix:** Add a 1200×630 PNG at `/og-image.png` and reference it: `<meta property="og:image" content="https://tradingalpha.net/og-image.png" />` plus matching `twitter:image`.

### 2. `twitter:card=summary_large_image` without an image → Twitter downgrades/drops card
Twitter's validator requires an image URL for `summary_large_image`. Without one, Twitter silently falls back to a compact `summary` card or skips preview rendering. The mismatch is currently the single worst preview issue.
**Fix:** Either supply an image (preferred) or change `twitter:card` to `summary` to match the image-less reality.

### 3. `apple-touch-icon.png` returns HTTP 404
`curl -I https://tradingalpha.net/apple-touch-icon.png` → `HTTP/2 404`. iOS devices that pin the site to home screen will fall back to a scaled, often-blurry screenshot of the login page. Slack on macOS/iOS also probes this path as a fallback icon.
**Fix:** Add a 180×180 PNG at `/apple-touch-icon.png` and a `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`.

### 4. No `manifest.json` — `curl -I /manifest.json` → 404
No PWA manifest means Android Chrome "Add to Home Screen" falls back to the favicon and generic name, and there's no way to declare maskable icons, short_name, or `theme_color`.
**Fix:** Add a minimal `manifest.json` with `name`, `short_name`, `icons[]`, `background_color`, `theme_color`, `display: standalone`.

### 5. No `theme-color` meta — Slack / iOS Safari chrome uses default gray
No `<meta name="theme-color" content="...">` is emitted. Slack's unfurl sidebar accent and mobile Safari address-bar tint both fall back to platform defaults instead of AlphaDesk's brand amber (`#C9A66B` / brand color seen in inline styles).
**Fix:** Add `<meta name="theme-color" content="#0a0a0a">` (dark) and optionally a light-scheme variant.

### 6. `robots: noindex, nofollow` vs. `robots.txt: Allow: /` — contradiction
`/robots.txt` returns `User-agent: *  Allow: /` (with `Sitemap: /sitemap.xml`), but every rendered page's `<head>` emits `<meta name="robots" content="noindex, nofollow"/>`. Google/Bing will obey the meta tag and drop the site from indexing entirely. This also means `sitemap.xml` (which lists `/` and `/login`) is effectively useless.
**Fix:** Decide intent. If invite-only / private, remove the sitemap and set `robots.txt` to `Disallow: /`. If public-landing, remove the `noindex,nofollow` meta.

### 7. No `twitter:site` or `twitter:creator` handles
LinkedIn and Twitter both attribute previews to an `@handle` when provided. Absent these, Twitter cards show no attribution byline; LinkedIn falls back to just the `og:site_name` string.
**Fix:** `<meta name="twitter:site" content="@alphadesk">` and `twitter:creator` if applicable.

### 8. Duplicate / cloned OG metadata across all routes
Both `/login` and `/login/reset` carry the **identical** `og:title`, `og:description`, `og:url=https://tradingalpha.net`, and `twitter:*` tags — only the `<title>` and `<meta name="description">` change per route. Sharing a deep link to the password-reset page will preview as the generic homepage copy, misleading recipients about what they're clicking.
**Fix:** Give each route its own OG/Twitter block via Next.js `generateMetadata()` per-route overrides.

### 9. `twitter:description` is shorter/weaker than `og:description`
`og:description` = *"Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management."* (139 chars — good).
`twitter:description` = *"Claude-powered trading platform."* (32 chars — a stub that reads like a placeholder).
Twitter prefers `twitter:description` over `og:description`, so the Twitter card will display the weaker copy.
**Fix:** Mirror `twitter:description` to the full `og:description` string (Twitter allows up to 200 chars).

### 10. Favicon served as legacy `image/x-icon` only; no SVG / PNG / sizes variants
`<link rel="icon" href="/favicon.ico?..." sizes="256x256" type="image/x-icon">` is the sole icon link. There's no `rel="icon" type="image/svg+xml"`, no 32×32 or 16×16 PNG variants, and no `mask-icon` for Safari pinned tabs. Modern browsers handle this, but pinned-tab Safari and some RSS readers render a blank square.
**Fix:** Add `<link rel="icon" type="image/svg+xml" href="/icon.svg">` and `<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#C9A66B">`.

---

## Captured metadata (reference)

```
<title>Sign in — AlphaDesk</title>
<meta name="description" content="Sign in to AlphaDesk — a systematic trading terminal for equity strategies with Claude as a pre-trade second opinion."/>
<meta name="robots" content="noindex, nofollow"/>
<meta property="og:title" content="AlphaDesk — AI-Powered Trading Terminal"/>
<meta property="og:description" content="Claude-powered trading platform with multi-strategy pipeline, real-time analysis, and automated portfolio management."/>
<meta property="og:url" content="https://tradingalpha.net"/>
<meta property="og:site_name" content="AlphaDesk"/>
<meta property="og:type" content="website"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="AlphaDesk — AI-Powered Trading Terminal"/>
<meta name="twitter:description" content="Claude-powered trading platform."/>
<link rel="icon" href="/favicon.ico?..." sizes="256x256" type="image/x-icon"/>
```

Asset probes: `/favicon.ico` → **200** · `/apple-touch-icon.png` → **404** · `/og-image.png` → **404** · `/og.png` → **404** · `/opengraph-image` → **404** · `/manifest.json` → **404** · `/robots.txt` → **200** · `/sitemap.xml` → **200**.
