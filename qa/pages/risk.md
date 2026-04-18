# /risk — expected behavior

## Route
- URL: `/risk`
- Access: public
- Redirects: none
- Metadata: title "Risk Disclosure — AlphaDesk"; description "AlphaDesk risk disclosure: trading risks, AI analysis disclaimers, and important warnings." Indexable.

## Layout (all breakpoints)
Renders via `StaticArticle`, wrapping `MarketingShell route="/risk"`. Inner article `max-w-[780px] py-16`.

### Structure
1. `Display size="lg"` Newsreader italic "Risk Disclosure".
2. Mono `text-fg-hint` 11px uppercase: "LAST UPDATED · 2026-04-12".
3. **Warning banner** (unique to this page — `note` slot):
   - `<aside role="note">` with `rounded-md border border-down-500/30 bg-loss-tint p-5`.
   - Body: Newsreader italic 17px line-height 1.5 `text-down-500` reading "Trading securities and options involves substantial risk of loss and is not suitable for all investors. Consider carefully whether trading is appropriate for you in light of your financial condition."
4. Clause list from `RISK_CLAUSES` (`app/risk/_risk/content.tsx`). Expected themes (verify titles match the file):
   - §01 Substantial risk of loss
   - §02 Options / derivatives specific risks
   - §03 Past performance does not guarantee future results
   - §04 AI / Claude is not a financial advisor
   - §05 Backtest limitations (survivorship, out-of-sample, regime drift)
   - §06 Execution / slippage / liquidity risks
   - §07 Your responsibility for decisions
   - §08 Regulatory / jurisdiction notice

### Typography roles
- H1: Newsreader italic display-lg.
- "Last updated" stamp: mono tracked-caps.
- Warning banner: italic-serif 17px in `text-down-500` (coral) — the only place coral appears on the public surfaces.
- Section tags via `SectionRule`.
- Body: sans 15px line-height 1.65 `text-fg-dim`.

### Palette check
- `bg-bg` inherited; the warning banner uses `bg-loss-tint` and `border-down-500/30`.
- Coral (`text-down-500`) is intentional for the warning block — it is the warning color token, not a P&L tint.
- Gold accent only on shell chrome.

## Mobile (<768px)
- MarketingShell nav collapses as elsewhere.
- Warning banner spans the full article width; copy reflows cleanly inside `p-5`.

## Interactive elements
- **MarketingShell nav** — Risk marked active (`aria-current="page"`).
- **Sign in / Request access buttons** in top-right.
- **Inline links** inside clauses (if any) — typically cross-refs to `/terms`, `/privacy`.
- **Footer:** "Risk disclosure" should appear in the Legal column (per `MarketingShell.tsx:FOOTER_COLS`).

## Expected states
- Static. Warning banner always renders — never hidden or lazy-loaded.

## Edge cases
- **Duplicate footer link to `/risk`:** iter-1-frontend.md P1 flagged that "Not investment advice" and "Risk disclosure" both pointed to `/risk`. Current shell shows only "Risk disclosure" in the Legal column. Verify the dupe is gone.
- **Banner contrast:** coral on near-black + coral tint should still meet AA large-text contrast (italic 17px qualifies as large).

## What must NOT happen
- No minimizing of the warning banner behind a disclosure toggle — it must be immediately visible at page load.
- No tracking / analytics.
- No P&L colors other than the warning semantics.

## SEO / meta
- Title: `Risk Disclosure — AlphaDesk`
- Description: as above.
- Indexable.

## Accessibility (WCAG 2.1 AA)
- Warning block: `<aside role="note">` — announced by screen readers as a note region.
- Italic-serif banner copy is large enough (17px) to meet 3:1 large-text contrast.
- Single H1.
- Focus rings on all interactive elements.
