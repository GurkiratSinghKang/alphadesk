# /docs — expected behavior

## Route
- URL: `/docs`
- Access: public
- Redirects: none
- Metadata: title "Documentation — AlphaDesk"; description "AlphaDesk user guide: dashboard, trading, strategies, pipeline, and keyboard shortcuts."; no explicit robots override (inherits root — indexable).

## Layout (desktop ≥640px)
Wraps in `MarketingShell` with `route="/docs"` (the primary nav mark "Docs" as active).

```
<article class="mx-auto max-w-[780px] py-16">
```

### Structure
1. `Display size="lg"` Newsreader italic "Documentation".
2. Intro paragraph sans 16px `text-fg-dim`: "A working guide to the AlphaDesk terminal — operation, not marketing."
3. **Table of contents** nav (`aria-label="Table of contents"`, `border-t border-border pt-6 mt-10`):
   - Heading: tracked-caps 10.5px `text-fg-muted` "Contents".
   - 2-col grid (1-col on mobile) of 10 items. Each row: mono 11px `text-fg-hint` numeric index (01..10) followed by a sans 14px `text-fg-dim hover:text-fg` anchor linking to `#<section-id>`.
4. **Section list** (`mt-16 flex flex-col gap-14`) — 10 sections from `app/docs/_docs/content.ts:DOC_SECTIONS`:
   - §01 Getting Started — login flow, Cmd+K tip, mobile hamburger.
   - §02 Dashboard — Portfolio Hero / Activity Feed / Strategy Grid / Positions Summary / P&L Calendar / Market Context.
   - §03 Trading — chart, order panel, position manager, search, timeframes; Alpaca execution; market/limit/stop orders; real-time depth.
   - §04 Strategies — twelve parallel strategies; fundamental (momentum-quality, PEAD, VRP harvesting, earnings vol, regime-adaptive, claude-alpha) and technical (ts-momentum, rsi2-reversal, dual-momentum, pairs-trading, kama-breakout, orb, vwap-strategy) groups. Claims `lib/strategies.ts` is the source of truth.
   - §05 Pipeline — stages: data collection → Claude analysis → signal generation → risk checks → order execution; history table.
   - §06 Keyboard Shortcuts — ? for overlay; Cmd/Ctrl+K palette; 1–3 for dashboard/trade/pipeline (note: actual bindings are richer, see `useKeyboardShortcuts.ts`).
   - §07 How Claude AI Analysis Works — Anthropic Claude; conviction score (0–100); post-scoring risk checks.
   - §08 Strategy Methodology — PEAD, momentum (Jegadeesh & Titman 1993), VRP; out-of-sample calibration.
   - §09 FAQ / Troubleshooting — login problems; data loading; websocket disconnection; cache clearing; strategy not executing.
   - §10 API Keys (Alpaca Setup) — Settings > Alpaca keys; encrypted at rest; alpaca.markets link.
   - Each section renders with `SectionRule tag="§ {index} · {title}"` and `scroll-mt-24` for proper in-page scroll offset; paragraphs sans 15px line-height 1.65 `text-fg-dim`.
5. Closing block: `border-t border-border pt-6 mt-16`, italic-serif 15px `text-fg-muted` reading "Need help? Reach the desk at [support@tradingalpha.net](mailto:support@tradingalpha.net)."

### Typography roles
- H1: Newsreader italic display-lg.
- Section tags (`SectionRule`): tracked-caps `--font-mono`/`--font-ui` 10.5px with a gold `§` glyph and hairline rule.
- Body: sans 15px line-height 1.65 `text-fg-dim`.
- Index numbers in ToC: mono 11px `text-fg-hint`.

### Palette check
- `bg-bg` inherited from MarketingShell.
- Gold accent: α in the shell header, mailto link underline, `§` glyphs in section rules.
- No P&L colors.

## Mobile (<768px)
- MarketingShell nav links hide below `sm`; only logo + "Sign in" + "Request access" visible.
- ToC 2-col → 1-col (`grid-cols-1 sm:grid-cols-2`).
- `max-w-[780px]` article + `px-6` / `sm:px-8` / `lg:px-12` shell padding.

## Interactive elements

### ToC anchor links (10)
- `<a href="#{id}">` — each scrolls to its section via native browser anchor behavior (`scroll-mt-24` keeps headings visible under fixed chrome).
- Hover: `hover:text-fg`.

### Section headings
- Rendered via `<SectionRule>` — presentational only, not anchored links themselves.

### support@tradingalpha.net mailto (closing)
- Gold underlined link; `href="mailto:support@tradingalpha.net"`.

### MarketingShell nav / footer
- See global shell contract in `qa/test-plan.md` §2.

## Expected states
- Static content — no loading, no empty, no error. Content never mutates.

## Edge cases
- **Strategy registry drift:** §04 currently lists all 12 real strategies by name and their slugs. If the registry in `lib/strategies.ts` changes, this text *does not* auto-update. Tracked in iter-1-frontend.md P0 — previously the docs listed 10 fake strategy names; current version uses the real names.
- **In-page anchor navigation without JS:** works via native anchor link behavior.

## What must NOT happen
- No fake strategy names ("Trend Surfer", "Dip Buyer", "GARP", "Options Wheel", "Volatility Harvester") — the real twelve are listed verbatim in §04.
- No emoji, no hype copy.
- No P&L colors on the docs page (none should appear).

## SEO / meta
- Title: `Documentation — AlphaDesk`
- Description: "AlphaDesk user guide: dashboard, trading, strategies, pipeline, and keyboard shortcuts."
- Indexable (no `robots` override).
- OpenGraph inherits root.

## Accessibility (WCAG 2.1 AA)
- Single H1 ("Documentation"). SectionRule tags are visual only; use the page's `<nav aria-label="Table of contents">` for navigation.
- Anchor links are real `<a href="#id">` elements with visible labels.
- mailto has accessible text.
- Focus rings visible on every ToC link, mailto, and shell nav.
- Color contrast: body 15px `text-fg-dim` ≈ 8:1 (AA body), gold on bg ≈ 7:1 (AA large).
