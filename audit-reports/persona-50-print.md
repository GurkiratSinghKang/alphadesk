# Persona 50 — Printable Monthly Statement (Cmd+P on `/reports`)

**Persona:** User needs a printable monthly statement. Hits Cmd+P on `/reports`.
**Verdict:** Prints, but not "clean." Zero print styling. Likely unreadable in B&W and truncated to the first viewport-height page.
**Scope reviewed:**
- `frontend/src/app/(dashboard)/reports/page.tsx`
- `frontend/src/app/(dashboard)/layout.tsx`
- `frontend/src/app/globals.css`
- `frontend/src/styles/design-tokens.css`
- `frontend/src/components/layouts/DashboardPageLayout.tsx`
- `frontend/src/components/ui/scroll-area.tsx`

---

## Findings (max 10)

### 1. [P0] No `@media print` rules exist anywhere in the codebase
`grep @media\s+print` and `grep print:|page-break|break-inside` across `frontend/` return zero hits. `globals.css` ships only `@media (prefers-reduced-motion: reduce)`. The app has **no print stylesheet at all** — whatever the browser does by default is what the user gets.

### 2. [P0] Nested scroll containers truncate the print to a single page
`reports/page.tsx:729,740` wraps the entire page in `<ScrollArea className="h-full">` (Base UI, which renders a `Scrollable.Viewport` with `overflow: auto`). The parent `<main className="flex-1 overflow-y-auto">` in `(dashboard)/layout.tsx:147` is a second clipping ancestor. Chrome/Safari print engines honor the ancestor's viewport height for scrolled containers — the statement gets cut off after ~page 1. Three `overflow-x-auto` table wrappers (lines 217, 258, 407, 593) compound this for wide tables.

### 3. [P0] Dark-theme foreground prints as near-white on white
Design tokens (`design-tokens.css:56–71`): `--bg: #0b0a09`, `--fg: #ece6d2` (cream), `--fg-muted: #a8a08d`, `--fg-hint: #9a9380`. Browsers default to stripping dark backgrounds (`-webkit-print-color-adjust: economy`), but they **keep the text color**. A cream-on-white print is effectively invisible. Muted/hint grays are worse. No `@media print { color: black }` override exists.

### 4. [P0] Tax Report section is collapsed by default — won't print at all
`page.tsx:757`: `<SectionCard title="Tax Report (Simplified)" icon={Calculator} defaultOpen={false}>`. The `open` state gates `{open && <div>…</div>}` (line 94), so a user who hasn't manually expanded it gets a monthly statement missing the tax section entirely. A print stylesheet must force all `<SectionCard>` bodies open.

### 5. [P1] Dashboard chrome prints as part of the statement
`(dashboard)/layout.tsx` renders `<WsStatusBanner>`, `<TopBar>`, `<TickerTape>` (conditional), `<StatusStrip>`, `<footer>` with copyright, plus `<CommandPalette>`, `<AICopilot>`, `<OnboardingTour>`, `<ShortcutOverlay>` overlays — all unshielded by any `.no-print` class. The printed statement will lead with navigation chrome and trail with "Powered by Claude AI" footer. No `display: none` print rules target any of these.

### 6. [P1] In-flow interactive controls print as content
Inside the reports body itself: the range selector radiogroup (`page.tsx:695`), the Chevron toggles on every `SectionCard` header (`page.tsx:92`), three "Download … (CSV)" buttons (lines 289, 458, 632), and the Tax Year `<select>` (`page.tsx:760`) all print as if they were data. They need `@media print { display: none }`.

### 7. [P1] P&L colors (chartreuse/coral) print as pale watermarks
`--profit: #a8d04d` and `--loss: #e07856`. Six sites use these as text colors (`text-[var(--profit)]`, `text-[var(--loss)]` at lines 191, 197, 203, 237, 278, 432, 436, 564, 568, 581, 585, 616). Even with `print-color-adjust: exact`, chartreuse prints nearly white on consumer printers; coral prints as pale pink. The sign prefixes (`+` / `-`) are the only surviving gain/loss cue. Needs a print rule forcing `color: black` with `font-weight: 600` for negative values, or losses rendered in parentheses.

### 8. [P2] Table headers don't repeat across pages
Four `<thead>` blocks (positions, closed trades, strategy performance, tax classified) lack `thead { display: table-header-group }`. Browsers *usually* repeat `<thead>` on paginated tables, but only when not inside an `overflow` container — see finding 2. The "Closed Trades (50 limit)" table on a busy account spans several printed pages with no column labels after page 1.

### 9. [P2] `backdrop-filter: blur(12px)` on `header` risks print glitches
`globals.css:192–195` applies `backdrop-filter: blur(12px)` and `-webkit-backdrop-filter` globally to every `<header>`. Chrome's print engine has historically rasterized blurred surfaces into blank boxes or black rectangles (Chromium issues #993502, #1164097). The `DashboardPageLayout` renders the page title inside `<header>` (line 56), so the statement title can render as a black bar or blank space.

### 10. [P2] No `@page` size/margin, no report generation timestamp
No `@page { size: Letter; margin: 0.5in 0.75in }` rule means Chrome defaults to its "Default" margins, which cut off the `max-w-[1480px]` container on Letter paper. The statement also has no visible "Generated 2026-04-18 10:42 UTC" banner in the DOM — it's only embedded in the CSV download (`page.tsx:118`). A paper statement with no generation timestamp is not archival-grade.

---

## Summary (250 words)

The `/reports` page is not prepared for paper in any way. A search across the entire frontend confirms **zero `@media print` rules**, no `print:` Tailwind utilities, no `page-break-*` properties, no `.no-print` class convention, and no `window.print()` affordance. Everything the user gets from Cmd+P is Chrome's default fallback, which fails on this dark, scroll-container-heavy layout.

The most damaging issues are structural. The page sits inside two stacked overflow-auto ancestors (`<main>` in the dashboard layout, plus Base UI's `ScrollArea` at the route root), which virtually all print engines collapse to a single viewport-height page. The Tax Report `SectionCard` defaults to `open={false}` and gates its body on React state, so it never reaches the DOM for printing until the user manually expands it. Dashboard chrome — TopBar, TickerTape, StatusStrip, WsStatusBanner, AICopilot, OnboardingTour, the copyright footer — prints alongside the statement, as do the in-page range selector, download buttons, and chevron toggles.

Legibility is equally broken. Design tokens give `--fg: #ece6d2` cream text meant for a `#0b0a09` ink canvas; browsers drop the dark background on print but retain the cream foreground, which reads as near-white on white paper. Muted/hint grays compound this. P&L semantic colors (chartreuse `#a8d04d`, coral `#e07856`) print as pale watermarks; only the `+`/`-` sign prefix distinguishes gains from losses.

Fixing this cleanly needs a dedicated `reports.print.css`: force light colors, unclip scrollers, hide chrome, expand all sections, repeat `<thead>`, set `@page` margins, add a generation timestamp block.
