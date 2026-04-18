# AlphaDesk Design System — SKILL

## TL;DR
A dark-first, editorial "quiet money, loud math" design system for a systematic trading terminal. Warm near-black ink, a single gold brand accent, editorial italic serif for voice, tabular mono for numbers, sans for UI. P&L semantics use chartreuse/coral, not traffic-light red/green.

## Import
Every new artifact imports the tokens:
```html
<link rel="stylesheet" href="/path/to/colors_and_type.css">
```
Fonts auto-load from Google Fonts (Newsreader, Inter Tight, JetBrains Mono).

## Core tokens (see colors_and_type.css for the full set)

### Ink scale — warm near-blacks
- `--ink-050` #0b0a09 — app background
- `--ink-100` #111110 — panel
- `--ink-200` #1c1a14 — card surface
- `--ink-300` #2a271d — border
- `--ink-900` #ece6d2 — body text
- `--ink-1000` #f7f1dc — display text

### Brand — liquid gold (only chroma)
- `--gold-500` #c9a66b — PRIMARY
- `--gold-300` #e0c070 — bright, used on hero data
- `--gold-700` #8c6d2f — deep accents

### P&L — chartreuse & coral (NOT red/green)
- `--up-500` #a8d04d — profit, buy, bullish
- `--down-500` #e07856 — loss, sell, bearish
- `--ice-500` #8db3c4 — info / regime
- `--wine-500` #8a3a4a — critical / circuit breaker

## Type
Three families, strict roles:

- **Display — Newsreader italic** (`--font-display`): hero headlines, strategy names, pull quotes, memos, eyebrows. Always italic unless explicitly neutral. Tracking −0.025em to −0.04em. Optical sizing 60–72 on large sizes.
- **UI — Inter Tight** (`--font-ui`): navigation, buttons, body copy, metadata labels. Use `.t-label` for the signature all-caps 0.16em tracked style.
- **Mono — JetBrains Mono** (`--font-mono`): ALL numerics, timestamps, tickers, system stamps. Always `font-variant-numeric: tabular-nums`.

**Never swap jobs.** Numbers are always mono. Strategy names are always serif italic. Labels are always tracked sans caps.

## Components (documented in `preview/`)
- Buttons: `primary` (gold), `secondary` (outline), `ghost`, `buy` (chartreuse tint), `sell` (coral tint), `link` (underlined gold).
- Inputs: 36px tall, `--bg-elev-1` fill, mono value text, gold focus ring.
- Badges: status dots (active / paused / halted pulse), regime pill (italic serif), numeric chips.
- Cards: 2px brand/loss left accent, italic-serif name, mono percentage, sparkline.
- Tables: tracked-caps headers, mono cells, tabular-nums, `text-align:right` on numerics, hairline row borders.

## Layout rules
- Radii stay under 10px except modals (16px). Pills are 2px for inline chips, 999px for regime/status pills only.
- Shadows are hairlines: `--shadow-hair` almost always; `--shadow-2` only on floating cards/modals.
- Depth comes from **border + background step**, not shadow.
- Density is a feature — the trading desk packs 6+ metrics in the top 80px. Embrace it.

## Voice
- **Quiet money, loud math.** No hype, no "crushing it," no "unlock," no rocket emoji.
- Em-dashes, Oxford comma, italics for emphasis (not bold).
- Use real numbers. "12 positions" not "many positions."
- Claude speaks in italic serif, gold accent for emphasis words.

## Files
- `colors_and_type.css` — the only source of truth. Import this.
- `README.html` — editorial index with principles + links to every surface.
- `preview/*.html` — individual token/component cards (used in the design-system review pane).
- `ui_kits/webapp-trading-desk.html` — flagship 3-column workstation.
- `ui_kits/marketing-landing.html` — editorial landing w/ manifesto + pricing.
- `ui_kits/mobile-companion.html` — iOS companion (overview + position detail).
- `slides/alphadesk-pitch.html` — 8-slide pitch deck (1920×1080, deck-stage).
- `assets/` — α mark, lockup, wordmark, mono mark.

## Don't
- Don't invent new colors. Extend scales in `colors_and_type.css` instead.
- Don't gradient backgrounds. Radial glows at 6–12% opacity are allowed for hero letterboxes only.
- Don't emoji (not in the brand).
- Don't round big corners (avoid the SaaS trope of 24px+ radii).
- Don't put numbers in sans-serif. Ever.
- Don't use red/green for P&L — always chartreuse (`--up-500`) / coral (`--down-500`).
