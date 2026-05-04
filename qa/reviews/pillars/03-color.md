# Pillar 3 — Color

**Audited:** 2026-05-03
**Baseline:** `frontend/src/styles/design-tokens.css` + `frontend/src/app/globals.css`
**Screenshots reviewed:** `qa/runs/2026-05-04T02-58-02Z/{login,dashboard,trade,strategies-list,strategy-momentum-quality,strategies-earnings-options-play,strategies-trading-agents-research,alerts,analytics,pipeline}/desktop-1440/initial.preview.png` (10)
**Stance:** FORCE — assume failure until proven otherwise.

---

## Score: 1 / 4 — POOR

The token system is *immaculate on paper* (`design-tokens.css` is a model citizen — semantic ladder, LCH variants, theme-parity light scale, color-mix tints) and *systematically violated in practice*. Every authed-page header on three of the most-visited routes (Strategies, Pipeline) hard-codes the marketing palette's `#12281f` deep-green over the design-system class via `!important`, the entire auth/marketing surface is built on a parallel hex system that ignores tokens entirely, and at least three "primary" hues (gold brand, chartreuse profit, mint marketing-green) compete on the same fold. Theme parity is broken by construction in the marketing shell. The pillar fails on every one of the six audit dimensions.

---

## Findings

### F1 — BLOCKER: 306 hardcoded color literals in `.tsx` / `.ts` source

A grep for `#[0-9a-fA-F]{3,8}` and `rgba?(` across `frontend/src/**/*.{ts,tsx}` returns **306 hits across ~26 files** (excluding tests). The token system claims to be the single source of truth (per the comment block at `design-tokens.css:1-6`), but the violators are not edge-cases — they are the highest-traffic surfaces:

| File | Hits | Concern |
|------|------|---------|
| `components/auth/AuthProductFrame.tsx` | 44 | Login + request-access shell — every visible color is hex |
| `components/auth/AuthLuxuryPreview.tsx` | 42 | Marketing inset — full parallel palette (`#10281f`, `#0f7a5d`, `#75d9af`, `#f7fbf4`) |
| `components/charts/TradingChart.tsx` | 33 | Chart series literals (acceptable as token *fallbacks*; some are not — see F4) |
| `app/request-access/_request/RequestAccessForm.tsx` | 22 | Cream-on-green form chrome (`#0f7a5d`, `#cddbd0`, `#5d7268`, `#fff1ec`) |
| `app/login/_login/LoginForm.tsx` | 18 | Same parallel palette as AuthProductFrame |
| `components/charts/ChartPane.tsx` | 15 | Chart styling, partly fallbacks |
| `app/(dashboard)/pipeline/page.tsx` | 11 | `!text-[#12281f]` overrides on H2s in a dark-mode page |
| `app/global-error.tsx` | 10 | Inline `style={{ color: "#…" }}` — defensible only because tokens may not have loaded |
| `app/(dashboard)/page.tsx` | 9 | Arbitrary `rgba(…)` values in `shadow-[…]` strings |
| `app/(dashboard)/strategies/page.tsx` | 4 | `t-h2 !text-[#12281f]` overrides on dark-mode headers |

The auth/marketing surface alone (`AuthProductFrame.tsx`, `AuthLuxuryPreview.tsx`, `LoginForm.tsx`, `RequestAccessForm.tsx`, plus the pages that consume them) is built on a **parallel color system** — `#0f7a5d` forest-green, `#12281f` deep-green-black, `#75d9af` mint, `#f8f7ef` cream, `#e8f5ea` mint-50 — that never resolves through `var(--…)`. None of these will theme-switch when `.light` is applied (see F5), and none can be globally retuned without a 5-file find-and-replace.

### F2 — BLOCKER: `!important` hex overrides on token-driven typography classes

`app/(dashboard)/pipeline/page.tsx:897, 1013, 1104, 1315` and `app/(dashboard)/strategies/page.tsx:528, 944` apply

```tsx
<h2 className="t-h2 !text-[#12281f]">
<h2 className="t-display-section !text-[#12281f]">
```

`t-h2` is defined in `design-tokens.css:387` as `color: var(--fg)` — i.e. `#ece6d2` cream (dark theme) / `#20271f` graphite (light theme). The `!text-[#12281f]` Tailwind override forcibly sets the deep-green marketing tone on what are otherwise dark-app pages. On the dashboard's near-black `--bg: #0b0a09` surface this is barely visible (`#12281f` on `#0b0a09` ≈ 1.4:1 — **WCAG AAA fail and likely AA fail at body weight**); on the strategies page's pale-mint empty-state band it produces the "near-white text on pale background" rendering bug flagged in the UX review at `strategy-momentum-quality/desktop-1440/initial.preview.png` and `scrolled-mid.preview.png`. The `!important` makes this immune to the design-tokens cascade.

`pipeline/page.tsx:896, 1012, 1103, 1314` apply the same anti-pattern to icons (`Target className="!text-[#5d7268]"`). At least 13 sites total.

### F3 — BLOCKER: Three competing primary accents on the authed surface

Counting unique brand-tier hues used as CTA / status emphasis across `dashboard`, `trade`, `strategies-list`, and `strategies-earnings-options-play`:

1. **Liquid-gold ochre** `--gold-500 #c9a66b` — top-right "Sign in / Request access", "Run", "+ New Strategies", "Pay Now", and `data-slot="edge-score-chip"` border at `EarningsCalendarSidebar.tsx:265`. This is the declared brand chroma per `design-tokens.css:35`.
2. **Chartreuse-lime** `--up-500 #a8d04d` — applied to *every* positive P&L number on `dashboard/desktop-1440/initial.preview.png` ("+$522, +$870, +$183, +$142…"), to "Buy" buttons (`components/ui/button.tsx:52`), to the "active" status dot (`components/ui/badge.tsx:78`), to half the chart series (`charts/TradingChart.tsx:174,524,918`). Visually it dominates the right half of the dashboard fold — see `dashboard/desktop-1440/initial.preview.png` where chartreuse occupies > 25% of pixels above the fold.
3. **Marketing forest-green** `#0f7a5d` (no token name) — login submit button (`LoginForm.tsx:394`), request-access primary CTA (`AuthProductFrame.tsx:180`), all auth-shell links and labels. Visible on `login/desktop-1440/initial.preview.png` as the bright "Sign in" button on the right card.

The 60/30/10 distribution mandated by the pillar is inverted on the dashboard: the chartreuse "10%" accent is acting as a 25–35% color, the gold "primary brand" is a 5–8% chrome accent, and the warm-near-black "60% dominant" surface barely gets seen because of how saturated chartreuse reads on `#0b0a09`. The login screen mixes #2 and #3 in a single viewport — the marketing left rail uses forest-green, the auth card on the right uses what reads as the same green family but is actually a different hue, producing the "lime reads like debug paint" effect noted in the prior UX critique.

### F4 — WARNING: Token discipline collapse — `text-profit` vs `text-up-500` used interchangeably

The system defines a clean two-layer ladder: raw scale tokens (`up-500`, `down-500`, `gold-500`) at the bottom, semantic aliases (`profit`, `loss`, `brand`) on top. Consumers should reach for the semantic layer; raw scale should be reserved for chart palettes and design-system internals.

```
text-profit         57 hits
text-loss           51 hits
text-amber          47 hits  ← see F6
text-primary        84 hits
text-brand          70 hits  ← also alias for primary
text-up-500         7  hits  ← raw scale leaking into product code
text-down-500       11 hits  ← raw scale leaking into product code
```

`components/ui/badge.tsx:39, 43, 52, 58, 62, 78, 80, 85, 87, 89` and `components/ui/button.tsx:52-53, 66` use `up-500`/`down-500` directly for buy/sell variants and pulse states. `components/ui/table.tsx:89` and `components/ui/dropdown-menu.tsx:103-108` use `down-500`. These are *primitive* components — they should be the strictest about semantic tokens. `text-primary` (84) and `text-brand` (70) coexist as two names for the same value (`--brand` per `globals.css:95`); pick one. `bg-primary` (61) vs `bg-brand` (38) — same redundancy.

### F5 — BLOCKER: Theme parity broken in the auth/marketing shell

`design-tokens.css:265-341` carefully redefines every token for `.light` mode. But the auth/marketing shell ignores tokens altogether: `app/globals.css:528-558` defines `.alpha-auth-shell` with hardcoded `linear-gradient(…, #fbfaf4 0%, #edf6ec 48%, #f7f5ed 100%)` and `color: #12281f`. The shell is *always* light because the rules don't reference any token. Then every consumer of that shell — `AuthProductFrame.tsx`, `LoginForm.tsx`, `RequestAccessForm.tsx`, `AuthLuxuryPreview.tsx`, the marketing pages — uses inline hex literals (`#0f7a5d`, `#12281f`, `#cddbd0`, `#fff1ec`, etc.) for every text and surface color. Toggling the theme will have no visible effect on `/login`, `/request-access`, `/about`, `/contact`, `/docs`, `/privacy`, `/terms`, or `/help/*`.

This is non-trivial to fix because the marketing system is a different *aesthetic* (cream / forest-green editorial) than the dark trading app (warm-near-black / liquid-gold). But the right answer is to define an `.alpha-auth-shell` *theme block* with its own token redefinitions, not to bypass tokens entirely. As written, any future visual refresh of the marketing surface requires editing 5+ files instead of one token block.

### F6 — WARNING: `text-amber` is overloaded across four orthogonal meanings

`text-amber` / `bg-amber` / `border-amber` together are used 113 times. The `--amber-500` token's intent (per `design-tokens.css:50`) is "warning — mustard amber, distinct from loss". The actual usages span:

| Meaning | Site | Example |
|---------|------|---------|
| Warning (intended) | `SessionExpiryBanner.tsx:65` | "Session expires in 2m" |
| Stale data | `state-stale: var(--amber-500)` (`design-tokens.css:120`) + `table.tsx:89` `data-[state=stale]:bg-amber/5` | Stale row indicator |
| Risk threshold breach | `RiskDashboard.tsx:92,262,294,311,328` | Beta > 1.3 / position > 20% / sector > 30% / VIX-out-of-band |
| Time-of-day chrome | `MorningBrief.tsx:46` `if (hour < 20) return { label: "After Hours", color: "text-amber" }` plus `:175, 287, 380` | Morning-brief greeting, lightning icon |
| Status pill (partial / pending) | `composites/StatusBar.tsx:27, 33` | `amber: "text-amber"` for arbitrary tone |

`design-tokens.css:51` even acknowledges the redundancy with `--rust-500: #d9a441` aliased to the same value as `--amber-500` and marked deprecated. Operators looking at a dashboard cannot tell whether an amber number means "warning, act on this" vs "stale, refresh me" vs "after-hours, just informational". A trading product needs status semantics that survive a glance; this one doesn't.

### F7 — WARNING: Off-system Tailwind palette in dashboard widgets

Despite the design system explicitly mapping every meaningful color to a token, five files reach for raw Tailwind palette names:

- `components/dashboard/SectorTreemap.tsx` — 14 hits across `bg-emerald-{400,500,600,700}`, `bg-red-{400,500,600}`, `text-emerald-{200,400}`, `text-red-{200,400}`. This is the entire color logic of the treemap heatmap (`SectorTreemap.tsx:144-150, 345, 378, 388, 401`). None go through `--up-500` / `--down-500`. The result is a heatmap whose green is a *different* green than every other "up" color in the app.
- `components/panels/StrategyTemplates.tsx:109-111` — `border-emerald-500/40 text-emerald-400 bg-emerald-500/10` for "low risk", `border-red-500/40` for "high risk".
- `components/dashboard/StrategyGrid.tsx:72, 174` — `border-emerald-500/30 text-emerald-400`.
- `components/dashboard/MarketContext.tsx:146` — `text-blue-400` on hover for news links.
- `components/dashboard/AllocationDonut.tsx:120` — `text-blue-400/70` for "Connect Alpaca API".

These five sites silently introduce a third green and a fresh blue that don't appear in the token ladder. Cross-talk: the treemap's `bg-emerald-500/70` next to the dashboard's `text-up-500` creates two near-identical greens that read as different intentional hues.

### F8 — WARNING: Inline `bg-[…]` arbitrary values bypass the gradient + shadow system

Beyond the 144 `text-[#…]` / `bg-[#…]` Tailwind arbitrary-value hits, the dashboard's hero panels lean heavily on inline `shadow-[…rgba(16,22,17,…)…]` strings:

```tsx
shadow-[0_18px_48px_-38px_rgba(16,22,17,0.36)]   // page.tsx:48, 1582, 1697
shadow-[0_18px_60px_-36px_rgba(16,22,17,0.34)]   // page.tsx:860
shadow-[0_14px_34px_-28px_rgba(16,22,17,0.36)]   // page.tsx:1164
shadow-[0_18px_48px_-38px_rgba(16,22,17,0.42)]   // page.tsx:1341
shadow-[0_18px_48px_-34px_rgba(16,22,17,0.52)]   // page.tsx:1380
```

`design-tokens.css:247-249` already defines `--shadow-1` and `--shadow-2`. None of these inline shadows use them. Each shadow has a *slightly different alpha*, which means depth perception across panels jitters as you scroll. At minimum, register a third elevation token for hero panels and route consumers through it.

### F9 — WARNING: `!text-[#5d7268]` light-mode muted-grey applied as icon override

`pipeline/page.tsx:896, 1012, 1103, 1314` and `strategies/page.tsx:531, 947` apply `!text-[#5d7268]` to icons inside dark-mode pages. `#5d7268` is the marketing-shell muted grey (a warm-cool taupe), not the dark app's `--fg-muted: #a8a08d` (warm beige). On the dark-mode pipeline page captured at `pipeline/desktop-1440/initial.preview.png`, the section-header icons (Target, Zap, Clock, TrendingUp) render too dim against `--bg-elev-1` because `#5d7268` on `#111110` is only ~3.0:1 — fails AA non-text contrast. The chartreuse "Run" status pills compensate visually, but the affordance-defining icons fade out.

---

## Top 3 priority fixes

1. **Strip the `!text-[#…]` overrides from `pipeline/page.tsx` and `strategies/page.tsx` (13 sites total).** Replace each `!text-[#12281f]` with the token-driven default the class already provides (`t-h2`, `t-display-section`), and each `!text-[#5d7268]` with `text-fg-muted`. This single sweep restores legibility on the strategy-detail empty state (the biggest polish hit in the prior UX run) and makes those pages theme-switchable. ~10 lines of diff.

2. **Reconcile the chartreuse vs forest-green vs gold conflict.** Pick one of:
   - **Option A (preserve dark-app chartreuse, retire marketing forest):** Map `#0f7a5d` → `--gold-500` and `#12281f` → `--ink-900` across the auth/marketing shell. Login becomes ochre-on-cream rather than green-on-cream, ending the "three primaries" problem.
   - **Option B (preserve marketing forest, swap dashboard up-color):** Drop `--up-500` from chartreuse `#a8d04d` to a desaturated forest matching `#0f7a5d`. Aligns the lime "Buy" button and positive P&L with the auth shell's CTA. Quieter dashboard.
   - Either way the lime "Sign in" affordance noted in the prior UX review must either become the same green as the marketing rail or become ochre. As-is it is a third color.

3. **Decompose `--amber-500` overload into three distinct tokens:** `--state-warning` (act on this), `--state-stale` (refresh me), `--state-info-time` (after-hours, informational). Each can pick a different chroma (mustard, dim-amber, ice-blue respectively). Then sweep the 47 `text-amber` / 37 `bg-amber` / 29 `border-amber` sites to the appropriate semantic. Until this is done, an operator cannot distinguish a warning from stale data at a glance.

---

## Files audited

- `frontend/src/styles/design-tokens.css`
- `frontend/src/app/globals.css`
- `frontend/src/app/(dashboard)/page.tsx`
- `frontend/src/app/(dashboard)/layout.tsx`
- `frontend/src/app/(dashboard)/pipeline/page.tsx`
- `frontend/src/app/(dashboard)/strategies/page.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx`
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`
- `frontend/src/app/(dashboard)/analytics/page.tsx`
- `frontend/src/app/login/_login/LoginForm.tsx`
- `frontend/src/app/request-access/_request/RequestAccessForm.tsx`
- `frontend/src/app/global-error.tsx`
- `frontend/src/components/auth/AuthProductFrame.tsx`
- `frontend/src/components/auth/AuthLuxuryPreview.tsx`
- `frontend/src/components/charts/TradingChart.tsx`
- `frontend/src/components/charts/ChartPane.tsx`
- `frontend/src/components/composites/StatusBar.tsx`
- `frontend/src/components/dashboard/SectorTreemap.tsx`
- `frontend/src/components/dashboard/StrategyGrid.tsx`
- `frontend/src/components/dashboard/MarketContext.tsx`
- `frontend/src/components/dashboard/AllocationDonut.tsx`
- `frontend/src/components/dashboard/RiskDashboard.tsx`
- `frontend/src/components/dashboard/MorningBrief.tsx`
- `frontend/src/components/dashboard/ActivityFeed.tsx`
- `frontend/src/components/layout/SessionExpiryBanner.tsx`
- `frontend/src/components/panels/StrategyTemplates.tsx`
- `frontend/src/components/ui/badge.tsx`
- `frontend/src/components/ui/button.tsx`
- `frontend/src/components/ui/table.tsx`
- `frontend/src/components/ui/dropdown-menu.tsx`

**Screenshots referenced:**
- `qa/runs/2026-05-04T02-58-02Z/login/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/dashboard/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/trade/desktop-1440/initial-prefill.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/strategies-list/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/strategy-momentum-quality/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/strategies-earnings-options-play/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/strategies-trading-agents-research/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/alerts/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/analytics/desktop-1440/initial.preview.png`
- `qa/runs/2026-05-04T02-58-02Z/pipeline/desktop-1440/initial.preview.png`
