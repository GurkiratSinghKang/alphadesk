# /_design — dev-only design preview

## Route
- URL: `/_design`
- Access: **dev-only.** `if (process.env.NODE_ENV !== "development") { notFound(); }` at the top of the page. In production the route MUST return 404.
- Redirects: none.
- Source: `frontend/src/app/_design/page.tsx` (698 lines of fixtures + composites).
- Metadata: inherits root.

## Production contract
- **GET `/_design` must return HTTP 404** on `tradingalpha.net`.
- **Known bug** (iter-1-frontend.md P2): even though the page renders 404 in prod, the page **file** — including its 698 lines of fixture constants and 12 composite imports — may still ship in the production client bundle because Next's RSC tree shakes only at module-level. Verify bundle impact separately.

## Development contract (dev server only)
When `NODE_ENV === "development"` the page renders a 10-section reference of every primitive, typography helper, and composite.

### Structure (only visible in dev)
1. **Header** — giant α (72px Newsreader italic gold) + `Display size="lg"` "AlphaDesk" + `SerifEyebrow` "§ F1 · primitives & typography" + body blurb.
2. **§ 01 Tokens** — grid of 12 color swatches (`bg-bg`, `bg-bg-elev-1`, `bg-bg-elev-2`, `bg-bg-card`, `bg-brand`, `bg-profit`, `bg-loss`, `bg-ice`, `bg-wine`, `bg-amber`, `bg-ink-200`, `bg-ink-300`).
3. **§ 02 Typography** — Display xl / lg / md samples; Eyebrow / SerifEyebrow; body copy; Mono display / body / micro.
4. **§ 03 Buttons** — 6 variants × 3 sizes: primary / secondary / ghost / buy / sell / link. Buy/sell show tracked-caps order labels.
5. **§ 04 Inputs** — Input + InputGroup variants with addons ($, shares), plus an error-state input with "Must be ≥ 3% per risk policy" hint.
6. **§ 05 Badges, regime pills & chips** — 5 status badges (Active/Paused/Halted/Idle/AI), 3 regime pills (bull/neutral/bear), 5 numeric chips including a P&L chip.
7. **§ 06 Cards** — plain card, brand-accent card (Momentum & Quality with +3.42% PnL), loss-accent card (Claude Alpha -1.18%), hoverable card.
8. **§ 07 Table** — Open positions table with 4 rows (NVDA, INTC, UNH, SPY) showing Long/Short sides, Qty, Entry, PnL, Strategy.
9. **§ 08 Sparkline** — profit / loss / brand tones.
10. **§ 09 StatusDot & PnLNumber** — dot tones (profit/loss/ice/amber/wine/brand/muted + loss pulse); PnLNumber formats (currency, percent, bps, abbreviated, zero).
11. **§ 10 Composites** — renders TopBar, ContextBar, StrategyRail, PriceChartPanel (with 40 synthetic OHLCV bars), OrderBar, PositionsList, AIMemoPanel (Haiku 4.5, confidence 0.72, 180ms), StatusBar, TickerStrip, StrategyCard, EditorialNameplate, ClaudeStamp.

### Palette check (dev only)
- All swatches live on `bg-bg` warm near-black.
- Gold α mark, brand-accented strategy card, gold chart line.
- Chartreuse and coral from the token set.

## Interactive elements (dev only)
- Each composite is interactive per its own contract (see `qa/pages/desk.md` for detail on TopBar/ContextBar/etc.).
- Fixture data is inline; `onRangeChange` / `onSubmit` / `onSelect` callbacks are no-ops or `console.log`.

## What must NOT happen
- **In production: this page must not render.** A 404 page is expected.
- No fixture data should leak to users via the client bundle (tracked issue).
- No emoji, no hex in component classes.

## SEO / meta
- Not indexable in either environment (no metadata specifically set; falls through to root; but should 404 in prod).

## Accessibility (WCAG 2.1 AA)
- Dev-only page; a11y of the composites themselves is tested via their real routes.
- In prod, only the 404 page's a11y matters — see `qa/pages/not-found.md`.
