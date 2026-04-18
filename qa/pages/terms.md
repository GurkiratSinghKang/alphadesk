# /terms — expected behavior

## Route
- URL: `/terms`
- Access: public
- Redirects: none
- Metadata: title "Terms of Service — AlphaDesk"; description "AlphaDesk terms of service: usage terms, responsibilities, and disclaimers." Indexable.

## Layout (all breakpoints)
Renders via `StaticArticle`, wrapping `MarketingShell route="/terms"`. Inner article `max-w-[780px] py-16`.

### Structure
1. `Display size="lg"` Newsreader italic "Terms of Service".
2. Mono `text-fg-hint` 11px uppercase: "LAST UPDATED · 2026-04-12".
3. No `note` banner.
4. Clause list from `TERMS_CLAUSES` (`app/terms/_terms/content.tsx`).

### Expected clauses (verify by opening the content file)
Typical editorial terms sections — confirm indexes / titles match the file:
- §01 Acceptance of terms
- §02 Account eligibility (KYC, jurisdiction)
- §03 Use of the platform (acceptable use, automated access rules)
- §04 Fees / billing (if applicable)
- §05 Brokerage relationship disclaimer (AlphaDesk is not a broker-dealer; Alpaca is the executing broker)
- §06 AI / Claude disclaimer (Claude output is informational, not advice)
- §07 Limitation of liability
- §08 Termination
- §09 Governing law / arbitration
- §10 Contact

### Typography roles
- H1: Newsreader italic display-lg.
- "Last updated" stamp: mono tracked-caps.
- Section tags: tracked-caps with `§` glyph via `SectionRule`.
- Body: sans 15px line-height 1.65 `text-fg-dim`.

### Palette check
- `bg-bg` via MarketingShell.
- Gold accent only on shell chrome.
- No P&L colors.

## Mobile (<768px)
- MarketingShell nav collapses below `sm`.
- Article stays `max-w-[780px]` with shell padding.

## Interactive elements
- **MarketingShell nav** — Terms marked active (`aria-current="page"`).
- **Inline links** inside clauses where applicable (e.g. a link to Alpaca's customer agreement, to `/risk`, to `/privacy`).
- **Sign in / Request access buttons** in top-right.
- **MarketingShell footer** with 3 columns.

## Expected states
- Static article. No loading, empty, or error states.

## Edge cases
- **Stale "Last updated" date:** same as `/privacy` — date is hardcoded in the page prop.
- **Missing clauses:** confirm every clause in `TERMS_CLAUSES` has a non-empty body.

## What must NOT happen
- No Lorem Ipsum.
- No tracking / analytics on this page.
- No P&L colors, no emoji, no hype copy.
- No wording that contradicts the "AlphaDesk is not a broker-dealer" footer copy in MarketingShell.

## SEO / meta
- Title: `Terms of Service — AlphaDesk`
- Description: as above.
- Indexable.
- OpenGraph inherits root.

## Accessibility (WCAG 2.1 AA)
- Single H1.
- Clauses use real `<p>` and `<ul><li>` semantics.
- Links have visible, distinct focus rings and accessible text.
- 15px body on bg ≈ 8:1 (AA).
