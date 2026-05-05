# Pillar 2 — Visuals (R5 adversarial audit)

**Score: 3/4**  (R1: 2/4, R2: 3/4, R3: 4/4, R4: 4/4 → now: 3/4)
**Run:** `qa/runs/2026-05-04T20-31-40Z`
**Audited:** 2026-05-04
**Stance:** Adversarial. Hunt mode. Three structural visual bugs surfaced that R4 missed because it sampled too sparingly. Drop one bar.

---

## Methodology

- **DOMs (24):** every desktop-1440 spec in the canonical sweep, grepped for slot inventory, chrome-bar variant, marketing-shell wrapper, arbitrary px text literals, brand button text-color, and overflow-x affordances. Mobile-390 DOMs sampled for the dashboard, alerts, login-reset, not-found, strategies-trading-agents-research.
- **PNGs (5, sampled one at a time, all under 2700 px tall):**
  - `dashboard/mobile-390/initial.png` (1170×2532)
  - `alerts/desktop-1440/initial.png` (4320×2700) — confirms TopBar wrap, low-contrast Create Alert, oversized empty-state
  - `not-found/desktop-1440/initial.png` (4320×2700)
  - `not-found/mobile-390/initial.png` (1170×2532)
  - `login-reset/desktop-1440/initial.png` (4320×2700) — sanity check
  - `login-reset/mobile-390/initial.png` (1170×2532) — sanity check
  - `dashboard/desktop-1440/initial.png` (4320×2700)
- **Source files inspected:**
  - `frontend/src/components/composites/TopBar.tsx` (the *new* dashboard TopBar — 48px, "Search" plain text)
  - `frontend/src/components/layout/TopBar.tsx` (the *old* layout TopBar — used by every other authed route)
  - `frontend/src/components/ui/button.tsx` (variant/cva config)
  - `frontend/src/lib/utils.ts` (`cn` = `twMerge(clsx(...))`)
  - `frontend/src/app/(dashboard)/page.tsx` (proves dashboard page *imports its own* TopBar, bypassing layout)
  - `frontend/src/app/(dashboard)/layout.tsx` (the shared layout TopBar import path)
  - `frontend/src/app/_design/page.tsx` (confirms `/_design` `notFound()` is intentional)
  - `frontend/src/app/(dashboard)/alerts/page.tsx:285-301` (Create Alert button)
- **Skipped (>2000 px PNGs):** all desktop-1440 PNGs ≥ 2701 px tall. DOM evidence stands in for those.

---

## Findings (NEW in R5)

### MAJOR

#### R5-NEW-M1 — TopBar chrome is forked: dashboard and the rest of the authed app render different headers
- **Symptom:** The dashboard `/` route uses an entirely different TopBar component than every other authed route (alerts, analytics, pipeline, reports, settings, trade, strategies-*). Different markup, different button geometry, different placeholder, different height, different shadow.
- **Evidence:**
  - `/dashboard/desktop-1440/initial.dom.html` — the search button has `aria-label="Open command palette"` (no "to search symbols and commands"), inner span is plain `<span>Search</span>`, button class `inline-flex items-center gap-2 rounded-md border border-border bg-bg-elev-1 px-2.5 py-1`. No `data-tour="search-bar"`, no `min-w-[180px] max-w-[520px] flex-1`. Header height 48px (`h-12`).
  - `/alerts/desktop-1440/initial.dom.html` (and analytics, pipeline, reports, settings, strategies-list, strategies-trading-agents-research, strategies-earnings-options-play, strategy-momentum-quality, trade) — search button has `aria-label="Open command palette to search symbols and commands"`, inner span is `<span class="flex-1 text-left">Search symbols, commands...</span>`, button class `hidden h-9 min-w-[180px] max-w-[520px] flex-1 items-center gap-2 rounded-sm border border-border-hair bg-bg-elev-1/80 px-3`. Has `data-tour="search-bar"`. Sits inside a 56-or-thereabouts-px header.
  - Source confirms two files exist:
    - `frontend/src/components/composites/TopBar.tsx` (used by `app/(dashboard)/page.tsx`)
    - `frontend/src/components/layout/TopBar.tsx` (used by `app/(dashboard)/layout.tsx` for every non-dashboard route)
  - Cross-reference grep:
    ```
    Search symbols (old TopBar) | plain Search (composites TopBar)
    dashboard:   0 | 1
    alerts:      1 | 0
    analytics:   1 | 0
    pipeline:    1 | 0
    reports:     1 | 0
    settings:    1 | 0
    strategies-* and trade: 1 | 0 (each)
    ```
- **Why it's MAJOR for Visuals:** This is the single most reused chrome surface in the product. Same product, same viewport, navigating from `/` (dashboard) to `/alerts` causes the search button to *change shape, change width, change label, change height, change shadow* — that's a brand-cohesion break visible on every navigation transition. A new user lands on `/` thinking "compact, clean topbar"; they click `Alerts` and the topbar grows, the search field stretches to 520px, and the placeholder mutates. The R4 audit verified the layout TopBar but never noticed the dashboard imports a sibling component that uses different visual grammar.
- **Why not BLOCKER:** Both TopBars individually look "designed". The bug is *consistency*, not catastrophe. But it shows up on every nav click.
- **Recommendation:** Pick one. Either delete `composites/TopBar` and let dashboard inherit from `layout.tsx` like every other authed page (preferred — the old TopBar carries the StatusPills + ContextStrip the rest of the app expects), or delete `layout/TopBar` and migrate everyone to the new 48px composite. Don't ship two.

#### R5-NEW-M2 — Primary `<Button>` variant loses its dark text color when callers pass `text-label` / size className
- **Symptom:** Gold-filled primary button on `/alerts` ("Create Alert" form submit) renders with light foreground text on top of `bg-brand` gold, instead of the documented near-black `text-primary-foreground` (#1a1206). Visible in `alerts/desktop-1440/initial.png`: the "Create Alert" label on the right of the form is barely readable against the gold fill.
- **Evidence:**
  - `frontend/src/components/ui/button.tsx:44-45` declares `primary: "bg-brand text-primary-foreground hover:bg-gold-300"` and `defaultVariants.variant: "primary"`. Comment on line 10 says "near-black text (`text-primary-foreground` = #1a1206)".
  - `frontend/src/app/(dashboard)/alerts/page.tsx:290-294` calls `<Button type="submit" disabled={...} className="w-full h-11 md:h-9 text-label font-semibold">Create Alert</Button>`.
  - The rendered DOM class string for that button is:
    ```
    ...bg-brand hover:bg-gold-300 px-4 w-full h-11 md:h-9 text-label font-semibold
    ```
    Note: `text-primary-foreground` is missing. The only `text-*` class is `text-label`, which is a *font-size* utility (mapped to `var(--fs-label)` in `globals.css:--text-label: var(--fs-label);`).
  - Confirmed across DOMs: alerts has 1 instance of `text-primary-foreground` and that's on the `Skip to content` link, not on a Button. settings has 1 instance, also on Skip to content.
  - **Root cause:** `cn = twMerge(clsx(...))` (`frontend/src/lib/utils.ts`). `twMerge` treats `text-{anything}` as a single class group and keeps only the *last* one. The variant string puts `text-primary-foreground` first, then the user passes `text-label` later → twMerge drops the color and keeps the size. This is a known foot-gun of mixing project-defined `text-*` size utilities with semantic `text-*` color utilities under twMerge.
- **Reach:** Any `<Button>` whose caller's `className` contains a `text-*` utility loses the variant's text color. Found at minimum on `/alerts` (Create Alert) and `/settings` (one `ui-stateful` button). Likely affects any size-customized primary Button in the codebase. 17 `<Button >` usages exist app-wide; needs a sweep.
- **Why it's MAJOR for Visuals:** This produces a contrast/readability regression on the brand's primary call-to-action. The `/alerts` Create Alert button is the page's only conversion point; its label is the most visually-recessive thing on the page. The 404's gold "Back to AlphaDesk" button (no className override → keeps `text-ink-1000`/dark text, readable) is the visual proof of how primary buttons *should* look. Cross-pillar with Color (Pillar 3) and a11y (separate pillar) — but the visual symptom is real and on-screen.
- **Recommendation (in order of preference):**
  1. Add `twMerge` config that classifies project `text-{size-token}` utilities into a `font-size` group separate from `text-{color}`. Tailwind v4 + twMerge supports `extendTailwindMerge({ classGroups: { 'font-size': ['text-label', 'text-body-sm', ...] } })`.
  2. Or rename project size utilities so they don't share the `text-` prefix (e.g. `t-label`, `t-body-sm` — which the codebase *also* uses, see `t-label` and `t-display-lg` elsewhere).
  3. Tactical fix until then: every `<Button>` callsite that customizes `className` with `text-{size}` must also re-include `text-primary-foreground`.

#### R5-NEW-M3 — `/not-found` (404) ships with no shared chrome at all; visually severed from the marketing system
- **Symptom:** The 404 page renders as just a `<main>` with `min-h-screen` + `justify-center` and no logo, no nav, no footer, no `alpha-auth-shell`, no MarketingShell wrapper. Visually it reads as a different product — a content-less black page with one paragraph anchored at vertical center.
- **Evidence:**
  - `not-found/desktop-1440/initial.dom.html` body markup begins with `<main class="min-h-screen bg-bg text-fg"><div class="mx-auto flex min-h-screen max-w-[720px] flex-col justify-center gap-10 px-6 py-16">…`. No `<header>`, no `alpha-auth-shell`, no MarketingShell.
  - Cross-page grep for marketing/auth shell tokens:
    ```
    about:           shell=1
    contact:         shell=1
    docs:            shell=1
    login:           shell=2
    login-reset:     shell=0   ← also chrome-orphaned
    not-found:       shell=0   ← MAJOR
    privacy:         shell=1
    request-access:  shell=2
    ```
  - PNG (`not-found/desktop-1440/initial.png`): vast empty space top-half, content begins ~50% down with `§ · MISSING PAGE` eyebrow, "Not on the tape." h1, then italic paragraph + two CTAs ("Back to AlphaDesk", "Read the docs"). Mobile (`not-found/mobile-390/initial.png`): same composition, ~35% empty viewport above the eyebrow because `justify-center` parks content in the middle of `min-h-screen`.
- **Why it's MAJOR for Visuals:** The 404 is the *most-visited fallback surface* in any product. It's the surface most likely to be a user's last impression after a broken link. Without the AlphaDesk wordmark/nav header, a user has no quick "Back to home" affordance other than the gold CTA, and no visual confirmation they're still inside the AlphaDesk product (the page is indistinguishable from a generic Next.js scaffold with brand colors). Compare to `/about`, `/contact`, `/docs`, `/login`, `/privacy`, `/request-access` which all wear `alpha-auth-shell` chrome — the 404 is an island. Brand cohesion failure.
- **Why not BLOCKER:** The page itself is well-typed and has a coherent CTA pair. It's "designed" in isolation — just visually divorced from the system around it.
- **Recommendation:** Wrap `not-found` in `MarketingShell` (or `alpha-auth-shell` with the simpler header variant `/login-reset` uses). At minimum, render the AlphaDesk wordmark at top-left so the page reads as in-product.

### MINOR

#### R5-NEW-N1 — `/login-reset` is also chrome-orphaned (sibling of M3)
- Same evidence chain as M3: zero shell tokens in `login-reset/desktop-1440/initial.dom.html`. Visible in PNG: page begins with a bare "Sign in / Password reset" breadcrumb `<header>` with no logo or product chrome, then drops into the editorial column.
- Lower severity than M3 because (a) the page is reached from `/login` so context is preserved, (b) it has a "Back to sign in" CTA at the bottom which gives an explicit return path, (c) the page is only ever entered via direct link from a recovery email, not via a typo into the URL bar.
- Recommendation: same MarketingShell/auth-shell wrap as M3. One fix closes both.

#### R5-NEW-N2 — Dashboard mobile StatusStrip ("DAY P&L | BUYING POWER | POSITIONS · OPEN OR…") truncates the third pill mid-word with no scroll affordance
- **Symptom:** On `dashboard/mobile-390/initial.png`, the top status strip shows three pills but the third pill ("POSITIONS · OPEN ORDERS") is cut off after "OPEN OR" because the parent `flex h-[56px] overflow-x-auto snap-x snap-mandatory` runs out of viewport room. There is no fade-out gradient, no chevron, no scroll-hint pseudo-element to indicate "scroll right for more".
- **Evidence:**
  - `dashboard/mobile-390/initial.dom.html` parent class: `flex items-stretch h-[56px] overflow-x-auto lg:overflow-visible snap-x snap-mandatory lg:snap-none border-b border-border/70 bg-ink-100/95`.
  - Each pill is `flex flex-col justify-center gap-0.5 shrink-0 snap-start px-3` — fixed-width, scrollable, snap-to-pill.
  - PNG visual confirms the third pill ends mid-text at the right viewport edge.
- **Severity:** MINOR. Horizontal scroll is the design intent (`snap-x snap-mandatory` makes that explicit), and the pill width is consistent. But without a visual indicator the truncation reads as broken text rather than a scrollable strip. First-time mobile users don't know there's a fourth/fifth pill behind the cut.
- **Recommendation:** Add a right-edge fade gradient (`mask-image: linear-gradient(to right, black 90%, transparent)`) or a `>` chevron pinned-right when scrollX < scrollWidth. 5-line fix.

#### R5-NEW-N3 — TopBar `Search symbols, commands…` placeholder still wraps to 3 lines on the OLD TopBar (carry-over from R3-NEW-N1 / R4-NIT)
- **Symptom unchanged from R4:** Visible in `alerts/desktop-1440/initial.png`. The search button renders `Search` / `symbols,` / `commands…` stacked across 3 lines because the `min-w-[180px] max-w-[520px] flex-1` button gets squeezed by the StatusPills + ThemeToggle + NotificationCenter + ProfileMenu cluster on the right at desktop-1440 width minus chrome.
- Now scoped narrower (post R5-NEW-M1): the bug is on the OLD `layout/TopBar`, which is still rendered on alerts/analytics/pipeline/reports/settings/strategies-*/trade. Doesn't affect dashboard `/` (which uses the new composite TopBar with the plain "Search" label).
- **Recommendation unchanged:** Either shorten the placeholder (`Search · ⌘K`) or add `whitespace-nowrap overflow-hidden text-ellipsis min-w-0` to the inner span at `frontend/src/components/layout/TopBar.tsx:137`. If the M1 fix consolidates onto the new composite TopBar, this issue disappears entirely.

#### R5-NEW-N4 — Marketing pages (`/about`, `/contact`, `/docs`, `/help-earnings-data`, `/privacy`, `/risk`, `/terms`) carry 2× `text-[36px]` arbitrary literals each
- **Source-cleanliness regression vs R4 claim.** R4 reported "Marketing pages have zero `text-[Npx]` literals across desktop frames". Re-grep in this run finds 2× `text-[36px] text-ink-1000` per marketing page. Likely a hero-headline override outside the tokenized type tier.
- Severity NIT for Pillar 2 (the rendered pixels are still on-tier and visually fine). Cross-pillar with Pillar 4 (Typography source-cleanliness).

#### R5-NEW-N5 — `/strategies-trading-agents-research` still ships ~90 `text-[12.5px]` / `text-[13.5px]` / one `text-[54px]` arbitrary literals
- Carry-over from R4-NEW-N4. The 54px literal is the AAPL ticker hero (`<h2 class="… md:text-[54px]">AAPL</h2>`); the 12.5/13.5px literals are the brief/memo body text.
- `globals.css:568-585` `:where([class*="text-[13px]"]) { font-size: var(--fs-body-sm) !important; line-height: 1.45 !important; }` normalization still catches the body literals onto token tiers, but the source still ships them. The 54px literal is unhandled by the normalization (no rule for `text-[54px]`) — it renders raw 54px on md+ rather than mapping to `text-display-md` or `text-display-lg`.
- Severity NIT for Pillar 2 (the rendered hero number looks fine — 54px is a reasonable display size). Cross-pillar with Pillar 4.

---

## Sites verified clean (no NEW visual regressions found)

- `/about` (desktop & mobile) — editorial section grammar holds, t-display-lg + 6× space-y-prose intact, tokenized rhythm verified per R4.
- `/contact` — clean editorial column, same grammar as /about.
- `/docs` (12 714 px tall) — DOM scanned, same shell, same prose tier.
- `/login` (with `alpha-auth-shell` cream theme) — visual identity holds, was not regressed.
- `/login-reset` desktop & mobile — composition is solid (verified PNG); only ding is the missing shell chrome covered in R5-NEW-N1.
- `/dashboard` desktop — well-composed, three-column gestalt with hero $100,723.80 / Action Stack / Capital Canvas / Selected Ticker. Composite TopBar variant is itself clean (just wrong-relative-to-the-rest, see M1).
- `/dashboard` mobile — overall composition intact (Control Room → Risk Gates → Risk Runway), only ding is the StatusStrip truncation in R5-NEW-N2.
- `/alerts` form composition — Create Alert form has restrained density on the left (Symbol/Condition/Target Price + Alert Scope) and a coherent right (Trigger Preview with In-app/Email/Webhook checkboxes). The empty-state ("No alerts set / Define a price, indicator, or P&L trigger above to start watching.") is well-typed but takes up ~half the visible viewport — at minimum considered, but not flagged.
- `/trade` (multi-leg-prefill) — ApiDegradedBanner still uses `state-warning-bg / state-warning-border / state-warning-fg / state-warning-fg-muted` semantic tokens (R4 strength holds).
- `/strategies-list` (9618 px tall) — DOM has rich slot inventory (`research-strategy-card`, `strategies-hero`, `regime-pill`, `status-dot`), readiness workbench tabs ("Ready 8 / Needs data 0 / Review 0 / Paper 3 / Blocked 8"), 12 active strategies listed with OOS Sharpe / CAGR / Max DD trips per row. Reads as a deliberate catalogue.
- `/strategies-earnings-options-play` — slot count remains 45 unique data-slots including `partial-data-banner`, `claude-thesis`, `historical-setup-replay-{comparison,trades,verdict}`, `iv-term-skew`, `options-payoff-panel`, `pnl-zones`, `strike-ladder`, `expected-move-strip`. Visual richness preserved.
- `/strategies-trading-agents-research` — DOM has substantive content (Symbol/Date/Provider config, Run history with one historical AAPL HOLD report, Action brief 1-6 numbered list, Complete research memo with collapsible sections). Slot count is intentionally low (7) because the page renders one detailed report rather than card grids; not a regression.
- Iconography — uniformly lucide across alerts (12 icons, 11 unique), dashboard (4/4), settings (34/23), trade (11/10), strategies-list (26/11). Sizes consistently `h-3.5 w-3.5` and `h-4 w-4`. No mixed icon families found.
- ApiDegradedBanner token decomposition (R4-N1) — verified rendered in trade/multi-leg-prefill.dom.html with `state-warning-*` semantic tokens.
- SectorTreemap migration (R4-N2) — auth-gated; source migration verified in R4 stands.
- The `/_design` "404" rendering — confirmed intentional (`frontend/src/app/_design/page.tsx` calls `notFound()` so production never ships the 698-line dev fixture). Not a bug.
- The `/strategies/sector_rotation` route from the user's prompt — does not exist in this sweep manifest, and `find frontend/src/app -path "*sector*"` returns nothing. Either it didn't land yet or the route name differs. No surface to audit.

---

## Score justification

**Why drop from 4 to 3:**
Three structural visual issues surfaced that R4 missed because R4 only sampled DOMs at a slot-count level and didn't compare cross-route chrome side-by-side:

1. **Chrome forking (R5-NEW-M1)** — same product, same viewport, two different topbars. Visible on every navigation transition between `/` and any other authed route. R4 never noticed because the dashboard `app/(dashboard)/page.tsx` imports `TopBar` from `composites/`, while every other route inherits from `layout.tsx` which imports from `layout/TopBar.tsx`. Cross-page DOM comparison reveals the divergence in 30 seconds; R4 audited each page in isolation.

2. **Primary Button text-color loss via twMerge (R5-NEW-M2)** — gold-filled primary button on `/alerts` Create Alert form renders with light text on gold, missing the documented near-black `text-primary-foreground`. Same root cause likely affects 17+ Button callsites that customize `className` with size utilities.

3. **404 chrome severance (R5-NEW-M3)** — the most-trafficked fallback surface ships with zero shared chrome. No logo, no nav, no footer. Visually orphaned from the marketing system that wraps every other public-facing page.

A 4/4 system would carry none of these. Two are chrome-cohesion failures (M1, M3 + N1) and one is a primary-button rendering failure (M2). Each is independently visible in PNGs.

**Why not 2:**
The remediation discipline that earned the R4 4/4 still holds. Marketing rhythm tokens (`section`, `section-sm`, `space-y-prose`) are intact across `/about`, `/contact`, `/docs`, `/login-reset`. ApiDegradedBanner semantic state-warning tokens are preserved. Iconography is uniform. SectorTreemap source migration holds. The TradingView-inspired data density on `/dashboard`, `/trade`, `/strategies-earnings-options-play` continues to read as a designed terminal, not a stitched dashboard. The bugs are local (chrome forking, one Button variant edge, one missing wrapper) — not system-wide composition failures.

**Path back to 4:**
1. Pick one TopBar (collapse `composites/TopBar` into `layout/TopBar` or vice versa).
2. Fix `cn`/twMerge so `text-{size-token}` and `text-{color}` belong to different class groups (or rename project size utilities to `t-label`/`t-body-sm` consistently across the codebase — the rename is already partially done).
3. Wrap `/not-found` and `/login-reset` in MarketingShell (or `alpha-auth-shell` with the simpler header variant).
4. While there: the carry-over R5-NEW-N3 (TopBar wrap) auto-resolves once M1 collapses onto the composite TopBar that already uses plain "Search".

---

## Top follow-ups (score-gating: 1, 2, 3)

1. **R5-NEW-M1 (MAJOR):** consolidate to one TopBar component. Pick the right one based on whether the dashboard's tighter h-12 chrome should propagate to all authed pages, or the layout's richer 56px chrome with status pills should land on dashboard too. The latter preserves more functionality (StatusPills, ContextStrip), so the recommendation is to delete `frontend/src/components/composites/TopBar.tsx` and rewrite `app/(dashboard)/page.tsx` to drop the explicit `<TopBar/>` and inherit from layout.tsx like every other authed page.

2. **R5-NEW-M2 (MAJOR):** the cleanest fix is in `frontend/src/lib/utils.ts`:
   ```ts
   import { extendTailwindMerge } from "tailwind-merge";
   const twMerge = extendTailwindMerge({
     extend: {
       classGroups: {
         "font-size": ["text-label", "text-body", "text-body-sm", "text-display-sm", "text-display-md", "text-display-lg", "text-h1", "text-h2", "text-numeric-md", "text-numeric-lg", "text-eyebrow"],
       },
     },
   });
   ```
   This tells twMerge that those identifiers are font-size group, not text-color group, so `text-primary-foreground` won't be dropped. Then sweep the 17 `<Button>` callsites and re-run the canonical sweep to verify rendered DOM has `text-primary-foreground` on every primary Button.

3. **R5-NEW-M3 (MAJOR):** wrap `not-found.tsx` (and `app/login/reset/page.tsx`) in `MarketingShell` or apply `alpha-auth-shell` with the simpler header variant. Mirror the chrome that `/about`, `/contact`, `/docs`, `/privacy`, `/request-access` already use.

---

## Files audited (this round)

Source files cited:
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/TopBar.tsx` (the new dashboard-only TopBar)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx` (the shared layout TopBar)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/ui/button.tsx` (cva variants — primary uses `text-primary-foreground`)
- `/Users/GK/Downloads/alphadesk/frontend/src/lib/utils.ts` (`cn = twMerge(clsx(...))` — root cause of M2)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` (imports TopBar from `composites`)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/layout.tsx` (imports TopBar from `layout`)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/alerts/page.tsx` (Create Alert button — proves M2 reach)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/_design/page.tsx` (confirms `/_design` `notFound()` is intentional)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` (`--text-label: var(--fs-label);` proves text-label is a font-size token, explaining M2)

DOMs sampled (under `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T20-31-40Z/`):
- `dashboard/desktop-1440/initial.dom.html` and `dashboard/mobile-390/initial.dom.html`
- `alerts/desktop-1440/initial.dom.html` and `alerts/mobile-390/initial.dom.html`
- `analytics/desktop-1440/initial.dom.html`
- `pipeline/desktop-1440/initial.dom.html`
- `reports/desktop-1440/initial.dom.html`
- `settings/desktop-1440/initial.dom.html`
- `trade/desktop-1440/multi-leg-prefill.dom.html`
- `strategies-list/desktop-1440/initial.dom.html`
- `strategies-earnings-options-play/desktop-1440/initial.dom.html`
- `strategies-trading-agents-research/desktop-1440/initial.dom.html` and `mobile-390/initial.dom.html`
- `strategy-momentum-quality/desktop-1440/initial.dom.html`
- `about/desktop-1440/initial.dom.html`
- `contact/desktop-1440/initial.dom.html`
- `docs/desktop-1440/initial.dom.html`
- `login/desktop-1440/initial.dom.html`
- `login-reset/desktop-1440/initial.dom.html`
- `not-found/desktop-1440/initial.dom.html`
- `privacy/desktop-1440/initial.dom.html`
- `request-access/desktop-1440/initial.dom.html`
- `design/desktop-1440/initial.dom.html` (confirmed renders 404)

PNGs sampled (5 reads, all under 2700 px tall, sampled one at a time):
- `dashboard/mobile-390/initial.png` (1170×2532)
- `dashboard/desktop-1440/initial.png` (4320×2700)
- `alerts/desktop-1440/initial.png` (4320×2700) — primary M2 + carry-over N3 verification
- `not-found/desktop-1440/initial.png` (4320×2700) — primary M3 verification
- `not-found/mobile-390/initial.png` (1170×2532) — M3 mobile parity
- `login-reset/desktop-1440/initial.png` (4320×2700) — N1 verification
- `login-reset/mobile-390/initial.png` (1170×2532) — N1 mobile parity
