# /privacy — expected behavior

## Route
- URL: `/privacy`
- Access: public
- Redirects: none
- Metadata: title "Privacy Policy — AlphaDesk"; description "AlphaDesk privacy policy: how we collect, use, and protect your data." Indexable.

## Layout (all breakpoints)
Renders via `StaticArticle` (`components/layouts/StaticArticle.tsx`), which wraps `MarketingShell route="/privacy"`. Inner article `max-w-[780px] py-16`.

### Structure
1. `Display size="lg"` Newsreader italic "Privacy Policy".
2. Mono `text-fg-hint` 11px uppercase letter-spaced 0.18em: "LAST UPDATED · 2026-04-12".
3. (No `note` panel on this page.)
4. **Clause list** (`mt-16 flex flex-col gap-14`) — rendered from `PRIVACY_CLAUSES` in `app/privacy/_privacy/content.tsx`. Each clause:
   - `SectionRule tag="§ {index} · {title}"`
   - Body rendered from `clause.body` as React node (typically `<p>` + `<ul><li>` groups, sans 15px line-height 1.65 `text-fg-dim`).

### Expected clauses (verify by opening the content file)
The content file defines `PRIVACY_CLAUSES` as an array of `{ index, title, body }`. Typical sections (verify titles match):
- §01 Data we collect
- §02 How we use data
- §03 Data sharing (Alpaca, Anthropic, Polygon)
- §04 Cookies / local storage
- §05 Retention / deletion
- §06 User rights (access, export, deletion)
- §07 Security (HttpOnly cookies, TLS, encryption at rest)
- §08 Contact / updates

### Typography roles
- H1: Newsreader italic display-lg.
- "Last updated" stamp: mono tracked-caps 11px.
- Section tags: tracked-caps with `§` glyph.
- Body: sans 15px line-height 1.65 `text-fg-dim`; inline emphasis via italic (no bold).

### Palette check
- Background `bg-bg` via MarketingShell.
- Brand gold only on shell header α and shell footer brand block; not in the policy body.
- No P&L colors.

## Mobile (<768px)
- MarketingShell nav collapses as elsewhere.
- Article `max-w-[780px]` centers with shell padding.

## Interactive elements
- **MarketingShell nav** (Docs / Privacy / Terms / Risk) — Privacy is active (`aria-current="page"`).
- **Sign in / Request access buttons** in top-right.
- **Inline links** inside clauses: any `<a>` in clause bodies should follow the gold-underline pattern. If a clause mentions "Alpaca", "Anthropic", or "Polygon", expect a link or at least a clearly named reference.
- **MarketingShell footer:** 3-column with Product / Company / Legal and an α brand block.

## Expected states
- Static. No loading, empty, or error states.

## Edge cases
- **Stale "Last updated" date:** renders verbatim from the page prop ("2026-04-12"). If content changes but the date doesn't, the stamp is misleading.
- **Missing clause body:** a clause with no body renders nothing below the SectionRule — confirm no clause is silently empty.

## What must NOT happen
- No placeholder Lorem Ipsum.
- No tracking pixel / analytics embedded on this page.
- No P&L colors.

## SEO / meta
- Title: `Privacy Policy — AlphaDesk`
- Description: as above.
- Indexable (no robots override).
- OpenGraph inherits root layout.

## Accessibility (WCAG 2.1 AA)
- Single H1.
- "Last updated" is purely decorative text (not a heading).
- Clause bodies may contain lists and paragraphs with real semantics.
- Focus rings visible on every inline link and MarketingShell link.
- Color contrast: 15px body `text-fg-dim` ≈ 8:1.
