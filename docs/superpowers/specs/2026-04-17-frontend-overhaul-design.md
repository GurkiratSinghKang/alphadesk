# Frontend Overhaul — Design Spec

**Date:** 2026-04-17
**Branch:** `feature/strategy-overhaul` (continuing)
**Design source:** `design-system/alphadesk-design-system/` (handoff from claude.ai/design)
**Goal:** Reimplement the AlphaDesk frontend to match the editorial "quiet money, loud math" design system — warm-ink dark palette, single gold accent, Newsreader italic serif / Inter Tight / JetBrains Mono type triplet, chartreuse/coral P&L (not red/green) — modularly, each piece composing into the next.

---

## 1. What the design system demands

Read `design-system/alphadesk-design-system/project/SKILL.md` and `colors_and_type.css`. The hard rules:

1. **One stylesheet, one source of truth.** `colors_and_type.css` defines every token. Never invent colors.
2. **Three font families, strict roles.** Newsreader italic for voice (strategy names, headlines, memos). Inter Tight for UI (nav, body, labels). JetBrains Mono + `font-variant-numeric: tabular-nums` for **every number**.
3. **P&L is chartreuse/coral, not red/green.** `--up-500 #a8d04d` / `--down-500 #e07856`.
4. **Radii stay ≤10px** except modals (16px). Pills are 2px or 999px only.
5. **Depth from border + background step, not shadow.** Shadows are hairlines.
6. **Density is a feature.** Top 80px of the trading desk packs 6+ metrics.
7. **Don't:** invent colors, gradient backgrounds, emoji, round corners >10px, put numbers in sans, use red/green for P&L.

## 2. Current state (from 10-minute audit)

- Next.js 16 + React 19 + Tailwind v4 + shadcn; Zustand state; TanStack Query/Table; lightweight-charts for chart panels.
- `frontend/src/app/globals.css` has a generic slate shadcn theme with `#0a0a0f` bg (cooler than the warm `#0b0a09` ink the design calls for) and generic chart color tokens.
- `frontend/src/components/ui/` already has 20 shadcn primitives (button, card, input, badge, table, tabs, dialog, dropdown-menu, command, popover, scroll-area, separator, sheet, tooltip, toast, textarea, plus AnimatedNumber and some custom helpers). Good foundation — we restyle in place, don't rip out.
- Dashboard routes: `(dashboard)/page.tsx`, `trade`, `strategies/[id]`, `analytics`, `pipeline`, `reports`, `alerts`, `settings`. Marketing: `login`, `privacy`, `terms`, `docs`, `risk`.
- Original frontend audit (in `audit-reports/01-frontend.md`) flagged 30 issues; many are pre-existing trust problems (fabricated data, missing hover states, ARIA marquee, mailto password reset). Those are NOT in scope for this overhaul — this is a visual/type/layout rewrite, not a content/logic cleanup.

## 3. Target architecture (modular, from the bottom up)

Five layers, built in order so each composes into the next:

```
frontend/src/
├── styles/
│   ├── design-tokens.css            ← layer 0: copy of colors_and_type.css (SINGLE source of truth)
│   └── fonts.css                    ← @import Newsreader / Inter Tight / JetBrains Mono
├── app/
│   └── globals.css                  ← layer 0: imports tokens + fonts, sets the semantic-class bridge
│                                      for Tailwind's @theme inline so bg-background / text-fg etc. map to tokens
├── components/
│   ├── primitives/                  ← layer 1: atomic components (retyped shadcn + new)
│   │   ├── Button.tsx               ← primary / secondary / ghost / buy / sell / link
│   │   ├── Input.tsx                ← 36px, mono value text, gold focus ring
│   │   ├── Badge.tsx                ← status dots (active/paused/halted pulse/idle/AI)
│   │   ├── RegimePill.tsx           ← italic serif regime pill with colored LED
│   │   ├── NumericChip.tsx          ← pill with mono value
│   │   ├── Card.tsx                 ← left-accent surface
│   │   ├── Table.tsx                ← tracked-caps headers, mono tabular cells
│   │   ├── Sparkline.tsx            ← small inline SVG line (28px)
│   │   ├── StatusDot.tsx            ← glowing LED atom
│   │   └── PnLNumber.tsx            ← tabular mono with profit/loss color
│   ├── typography/                  ← layer 1.5: semantic text components
│   │   ├── DisplayItalic.tsx        ← Newsreader italic, configurable size
│   │   ├── Eyebrow.tsx              ← tracked-caps label
│   │   ├── SectionRule.tsx          ← editorial hairline with "§ 01" tag
│   │   └── Mono.tsx                 ← tabular mono span
│   ├── composites/                  ← layer 2: surface-specific assemblies
│   │   ├── TopBar.tsx               ← 48px with logo + nav + regime + clock + avatar
│   │   ├── ContextBar.tsx           ← 38px, 7 metrics, right-aligned
│   │   ├── StrategyRail.tsx         ← left-rail strategy list with selected state
│   │   ├── PositionsList.tsx        ← right-rail row-drilldown list
│   │   ├── AIMemoPanel.tsx          ← gold pulsing dot + italic serif + haiku stamp
│   │   ├── OrderBar.tsx             ← exec row: strategy / side / qty / type / price / stop / go
│   │   ├── PriceChartPanel.tsx      ← head (name, ticker, price, delta, meta cells) + ranges + chart
│   │   ├── StatusBar.tsx            ← 22px footer pills
│   │   ├── TickerStrip.tsx          ← marketing marquee (NO auto-scroll; use smooth scroll + pause)
│   │   ├── StrategyCard.tsx         ← editorial dashboard card (left 2px accent, italic name, mono return)
│   │   └── EditorialNameplate.tsx   ← vol/issue plate used on docs + marketing
│   └── layouts/                     ← layer 3: route-level shells
│       ├── DeskLayout.tsx           ← 3-column trading desk grid
│       ├── MarketingShell.tsx       ← 1440-max centered editorial layout
│       └── DashboardShell.tsx       ← general non-desk dashboard pages (analytics/pipeline/etc.)
└── app/...                          ← layer 4: pages consume layouts + composites + primitives
```

**Dependency arrows only point downward.** A primitive never imports a composite. A composite never imports a page. This is the "create the pieces and fit them together" pattern the user asked for.

## 4. Execution phases

Each phase is a commit checkpoint; don't overlap phases across agents.

### F0 — Tokens & typography foundation (1 agent, ~30 min)
- Copy `colors_and_type.css` → `frontend/src/styles/design-tokens.css` (unmodified, as-is — this is the source of truth; never edit here, only extend in a separate file).
- Add `frontend/src/styles/fonts.css` with Google Fonts @import.
- Rewrite `frontend/src/app/globals.css`:
  - Import `design-tokens.css` + `fonts.css`
  - Bridge semantic tokens into Tailwind v4's `@theme inline` block so `bg-bg`, `text-fg`, `text-profit`, `border-border` etc. work
  - Remove the old `--background #0a0a0f` cooler palette
- Verify: one page renders with Newsreader italic headlines + JetBrains Mono numbers + warm ink bg
- Out of scope: don't touch any components in F0

### F1 — Primitives (1 agent, ~60 min)
- Retype every `components/ui/*` primitive to use the new tokens + type classes
- Create new primitives: `StatusDot`, `PnLNumber`, `RegimePill`, `NumericChip`, `Sparkline`
- Create typography components
- `Button` gets the 6 variants: primary / secondary / ghost / buy / sell / link
- Unit tests at `frontend/src/__tests__/` for each primitive's variants
- Visual story page at `frontend/src/app/_design/page.tsx` showing every primitive (dev-only, not linked from nav)

### F2 — Composites (1 agent, ~90 min)
- Each composite is a self-contained assembly of primitives
- They receive data via props (no direct API calls — presentation only)
- Consumer hooks live in `frontend/src/hooks/` or existing Zustand stores; composites take rendered data
- Chart composite wraps `lightweight-charts` with the gold stroke + regime bands + 20-SMA overlay styling

### F3 — Surface layouts (2 agents parallel, ~60 min each)
- **Agent A — Trading Desk:** rewire `(dashboard)/page.tsx` (or whichever the "desk" entry is) to use `DeskLayout` composing TopBar + ContextBar + StrategyRail + PriceChartPanel + OrderBar + PositionsList + AIMemoPanel + StatusBar. Real data via existing stores/queries, structural/visual match to `ui_kits/webapp-trading-desk.html`.
- **Agent B — Marketing + Auth:** rewire `/login`, `/` (if marketing landing is there), `/docs`, `/privacy`, `/terms`, `/risk` to use `MarketingShell` composing EditorialNameplate + section headers + strategy-grid / numbers / pricing patterns from `ui_kits/marketing-landing.html`.

### F4 — Dashboard pages (1 agent, ~60 min)
- Rewrite `(dashboard)/strategies/[id]/page.tsx` in editorial serif style with the real OOS metrics from backend's `/api/v1/strategies/{id}/performance`
- Rewrite `(dashboard)/analytics`, `(dashboard)/pipeline`, `(dashboard)/reports`, `(dashboard)/alerts`, `(dashboard)/settings` using `DashboardShell`
- Minor routes get consistent headers/footers but don't need full editorial treatment

### F5 — Regression sweep (manual)
- `npm run dev`, visit every route, check for contrast / broken components / console errors
- Run `npm run typecheck` and `npm run lint`
- Commit the whole branch

## 5. Hard rules for every agent

- **Do NOT invent colors.** Only tokens from `design-tokens.css`.
- **Do NOT use Tailwind color classes** like `bg-red-500`, `text-green-600`. Only semantic tokens: `bg-bg`, `text-fg`, `text-profit`, `border-border`, `bg-brand`.
- **Numbers in mono always.** Apply `font-mono tabular-nums` or use the `<Mono>` / `<PnLNumber>` primitives.
- **Strategy names in italic serif always.** Use the `<DisplayItalic>` primitive.
- **Labels in tracked-caps always.** Use the `<Eyebrow>` primitive.
- **Radii ≤10px** except modals (16px). Use `rounded-sm` (4), `rounded-md` (6), `rounded-lg` (10), `rounded-xl` (16 — modals only), or `rounded-full`.
- **No emoji, no hype copy, no red/green.**
- Do **NOT** commit from within a sub-agent; I review and commit at phase boundaries.

## 6. What this overhaul does NOT fix

The original frontend audit (`audit-reports/01-frontend.md`) flagged 30 issues. Many are **pre-existing content/logic bugs**, NOT visual issues:
- Fabricated Greeks in Options panel
- Static hardcoded "Signals" tab in Watchlist
- mailto "Forgot password?" on login
- RSI/MACD/ADX as linear functions of a single AI score
- WebSocket volume overwrite bug

Those stay for a follow-up task. Phase 2's backend work (nullable Sharpe from real OOS JSONs, honest `strategy-content.ts`) is what actually fixed the top-three frontend-audit P0s. The visual/type/layout work is what this spec covers.

## 7. Success criteria

- `frontend/src/styles/design-tokens.css` is a byte-for-byte copy of the design-system's `colors_and_type.css`. It is the single source of truth; `grep -r "bg-red-\|bg-green-\|#[0-9a-fA-F]\{6\}" frontend/src/components/` returns zero hits (exceptions: tokens file itself, generated chart fills).
- Every component either uses a design-system CSS variable, a Tailwind token mapped to one, or a typography component. No free colors.
- `frontend/src/app/_design/page.tsx` renders every primitive; visually it matches the preview HTMLs in the design bundle.
- The trading desk page (`(dashboard)/page.tsx` or `/trade`) matches the layout of `ui_kits/webapp-trading-desk.html` — 3 columns, editorial rail titles, gold chart stroke, mono context bar, italic AI memo.
- `npm run typecheck` + `npm run lint` pass; dev server loads without console errors.

---

## Approval gate

- Scope + phasing: ___
- Dependency direction rules (primitives → composites → layouts → pages): ___
- Do-not-invent-colors strict mode: ___
- Pre-existing content/logic bugs deferred to follow-up: ___
