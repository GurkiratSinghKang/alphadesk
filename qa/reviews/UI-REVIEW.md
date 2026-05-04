# AlphaDesk UI Review — GSD 6-Pillar Adversarial Audit

**Captured:** 2026-05-04 against tradingalpha.net (post-PR-1..4 deploys, run `2026-05-04T02-58-02Z`)
**Methodology:** GSD ui-auditor (`/Users/GK/Downloads/alphadesk/.claude/agents/gsd-ui-auditor.md`)
**Scoring:** 1=Poor 2=Needs work 3=Good 4=Excellent (per pillar). 24 max.

## Score card

| Pillar | Score | Headline |
|---|---|---|
| 1. Copywriting | 2/4 | Editorial voice exists; ~30% of strings drop register at the moment they matter most |
| 2. Visuals | 2/4 | Strong moments overshadowed by debug-overlay status rail and three competing primaries |
| 3. Color | 1/4 | Token system is immaculate on paper, systematically violated in practice |
| 4. Typography | 2/4 | 30+ font sizes in use against a 13-token contract; hierarchy breaks on 3 routes |
| 5. Spacing | 2/4 | 148 distinct spacing values, top 10 cover only 50%; void empty states alongside cramped sidebars |
| 6. Experience Design | 2/4 | Workspace interior solid; cracks at edges (offline shell, error boundaries, destructive consistency) |
| **Overall** | **11/24** | Needs systemic remediation, not point fixes |

Consistent picture: AlphaDesk has a *real design system* that has *not been adopted*. Token files are textbook. Implementation runs three parallel scales (px-arbitrary, Tailwind default, semantic `.t-*`), three parallel color systems, and three parallel writing voices. Remediation path is consolidation, not greenfield.

---

## Top 10 highest-impact bugs (ranked, deduplicated across pillars)

1. **[BUG-01] [BLOCKER] `!text-[#12281f]` and `!text-[#5d7268]` `!important` overrides on dark-mode pages** — pillars: 3 (F2, F9), 4 (F3) — `frontend/src/app/(dashboard)/pipeline/page.tsx:896, 897, 1012, 1013, 1078, 1103, 1104, 1314, 1315`, `frontend/src/app/(dashboard)/strategies/page.tsx:528, 531, 944, 947` (13 sites). Marketing-shell deep-green rammed past `t-h2`/`t-display-section` defaults via `!important`, producing ~1.4:1 contrast on near-black `--bg` (WCAG AAA fail; likely AA fail). Icons `#5d7268` ~3.0:1 — fails AA non-text. Fix: strip every `!text-[#…]`; token-driven defaults will resolve correctly (`text-fg-muted` for icons). Effort: **S** (~10 lines).

2. **[BUG-02] [BLOCKER] Bottom `StatusBar` mono-pill rail reads as debug overlay on every authed page** — pillars: 2 (B1), 5 — `frontend/src/components/composites/StatusBar.tsx:42-65`, mounted at `frontend/src/app/(dashboard)/page.tsx:2486`. `flex h-[22px] px-5 gap-[18px] font-mono text-[12px] text-fg-muted` with no chrome glyph reads as "developer console leaked into prod" — last thing in user's eye on every authed route. Visible across `qa/runs/2026-05-04T02-58-02Z/{dashboard,pipeline,analytics,reports,settings}/desktop-1440/initial.preview.png`. Fix: elevate (taller, `bg-ink-100`, "SYSTEM" eyebrow, icon-prefixed clusters) or collapse to one "System OK · build 2.4.1" pill that opens a popover. Effort: **M**.

3. **[BUG-03] [BLOCKER] Three competing primary accents (lime / forest-green / gold) collide above the fold** — pillars: 2 (B2), 3 (F3) — `frontend/src/components/ui/button.tsx:52` (chartreuse `--up-500 #a8d04d` BUY), `frontend/src/app/login/_login/LoginForm.tsx:394` (forest `#0f7a5d` Sign in), `frontend/src/components/auth/AuthProductFrame.tsx:180` (forest CTA), `frontend/src/app/not-found.tsx` (gold ochre `--gold-500`). 60/30/10 inverted on dashboard — chartreuse >25% of pixels above fold; gold "primary brand" only 5–8% chrome. Login viewport mixes forest left-rail with similar-but-different-hue green CTA on the right. Fix: pick Option A (map `#0f7a5d` → `--gold-500`, `#12281f` → `--ink-900` across auth/marketing) or Option B (drop `--up-500` to desaturated forest matching `#0f7a5d`). Either way "Sign in" / "BUY" collapse to one canonical action color. Effort: **L**.

4. **[BUG-04] [BLOCKER] Empty right pane on `/strategies/earnings-options-play` is ~70% of viewport with one instructional sentence** — pillars: 2 (W3), 5 (BLOCKER 1), 6 (B-2) — `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx:190-192`; auto-select effect at `…/page.tsx:197-220`. Sidebar shows 6 selectable rows (ABNB/DDOG/MCD/NET/BABA/CSCO with Edge chips) yet detail pane reads "Select a symbol from the sidebar." Auto-select did not fire (URL-pin path interfered with `userClearedRef` first-paint exception). Fix: kill the `userClearedRef` exception on first paint AND build `<DetailPanePreview/>` skeleton (3 rows: thesis / edge / IV-rank). Effort: **M**.

5. **[BUG-05] [BLOCKER] Service-worker offline shell hijacks `/trade` deep-links on slow navigations** — pillars: 6 (B-1) — `frontend/public/sw.js:127-141`, `frontend/public/offline.html`. 4 of 7 desktop trade DOMs in the run are the static shell (navigate-fail, single-leg-prefill, validate-single-leg-prefill-fail, wait-fail); same 4 on mobile. "Try again" `<a href="/">` drops the user on dashboard, losing `?contract=…&legs=…` state. Shell uses `-apple-system + Newsreader` — looks like a crash, not a blip. Fix: lengthen SW timeout (or skip SW intercept for `/trade*`); replace `href="/"` with original pathname+search; add analytics event. Effort: **M**.

6. **[BUG-06] [BLOCKER] Heading hierarchy broken on `/alerts`, `/strategies`, `/strategies/earnings-options-play`** — pillars: 2, 4 (F4) — `frontend/src/app/(dashboard)/alerts/page.tsx:213` (`<h3 className="text-sm font-semibold…">` with no h1/h2 ancestor, visually 14px); `…/strategies/page.tsx:455, 528, 944` (multiple h2s, no h1); `…/strategies/earnings-options-play/page.tsx` (no page-level h1; sidebar h3 at `EarningsCalendarSidebar.tsx:150` outside any h2). WCAG 1.3.1 fail; SR users hear "heading level 3" while sighted users see body text. Fix: every route renders one `<h1>` (sr-only OK); section headings descend without skips. Effort: **S** per route.

7. **[BUG-07] [BLOCKER] `Submit LIVE Order` / `Confirm Order` shouting on TradePanel — OrderBar uses sentence case in same product** — pillars: 1 (BLOCKER 2) — `frontend/src/components/panels/TradePanel.tsx:541, 545, 555, 607` ships ALL-CAPS Title-Case primary destructive plus dialog title + body button `"Confirm Order"`. `frontend/src/components/composites/OrderBar.tsx` uses `"Place order"` / `"Submitting…"`. Two ticket flows, two registers — destructive one is louder. Fix: adopt OrderBar's case. Title `"Confirm order"`, button `"Confirm and place"`. Effort: **S** (4 strings).

8. **[BUG-08] [BLOCKER] Marketing/auth shell built on parallel hex palette — theme parity broken by construction** — pillars: 3 (F1, F5) — `frontend/src/components/auth/AuthProductFrame.tsx` (44 hex literals), `AuthLuxuryPreview.tsx` (42), `…/login/_login/LoginForm.tsx` (18), `…/request-access/_request/RequestAccessForm.tsx` (22), plus `frontend/src/app/globals.css:528-558` `.alpha-auth-shell` hardcoded gradient + `color: #12281f`. None resolve through `var(--…)`. Theme toggle has no visible effect on `/login`, `/request-access`, `/about`, `/contact`, `/docs`, `/privacy`, `/terms`, `/help/*`. Fix: define `.alpha-auth-shell` *theme block* with token redefinitions; sweep 5 files. Effort: **L**.

9. **[BUG-09] [BLOCKER] Inconsistent destructive-action confirmation — Cmd+K is gold standard; in-page Cancel/Pause/Logout fire instantly** — pillars: 6 (B-3) — `frontend/src/components/panels/TradePanel.tsx:987-1013`, `…/page.tsx:413-431` (order cancel immediate); `…/strategies/[id]/page.tsx:716-739` (pause/resume immediate); `…/pipeline/page.tsx:553-595, 793-806` (pipeline cancel immediate); `frontend/src/components/layout/ProfileMenu.tsx:83-102, 142` (logout immediate, unsaved drafts gone); compare canonical `frontend/src/components/layout/CommandPalette.tsx:269-410` (bulleted modal + labeled `Cancel orders`). Inconsistent treatment is worse than uniformly absent — pipeline cancel mid-run aborts a pass costing API budget. Fix: adopt the palette's `setPendingDestructiveAction` modal for all four. Effort: **M**.

10. **[BUG-10] [BLOCKER] `t-display-section` ships at 22px, every consumer overrides to `text-[13px]` — token is dead** — pillars: 4 (F2) — `design-tokens.css:191` declares `--fs-display-section: 22px`. 15 consumer sites override: `_earnings/HistoricalMoves.tsx:12, 22`, `IVTermSkew.tsx:13, 22, 31`, `NewsFeed.tsx:34, 55`, `HistoricalSetupReplay.tsx:216`, `EarningsCalendarSidebar.tsx:150`, `StrikeLadder.tsx:17, 32` — all `<h3 className="t-display-section italic text-[13px]">`. Section headings render as tracked-caps mono indistinguishable from body labels in `strategies-earnings-options-play/desktop-1440/initial.preview.png`. Fix: pick one — drop `--fs-display-section` to 13px (rename `--fs-section-cap`) or remove `text-[13px]` from every consumer. Effort: **S**.

---

## Cross-cutting themes
(Themes that appear in 3+ pillars — these are systemic, not point issues)

- **The token system is decorative, not enforced.** Color (306 hex literals across 26 files — Pillar 3 F1), typography (23 arbitrary `text-[NNpx]` sizes alongside the full Tailwind ladder, ~30 sizes against a 13-token contract — Pillar 4 F1), and spacing (148 distinct spacing classes; top 10 cover only ~50% vs >70% benchmark — Pillar 5 BLOCKER 2). Root cause per Pillar 5 W8: `postcss.config.mjs` does not extend Tailwind's scales to consume `--space-*` / `--fs-*` tokens, so Tailwind defaults shadow the design system and there's no lint rule preventing arbitrary values.

- **Three parallel writing voices on a serious surface.** Editorial (good — `/login/reset`, `/contact`, `/help/earnings-data`), generic-product ("Save", "Cancel", "Got it", "Try Again"), vendor-marketing (`/docs`: "leverages", "powerful", "sophisticated"). Voice is aspired-to but inconsistently enforced — ~30% of strings drop register at the moment they matter most (errors, destructive confirms, primary CTAs). Title Case sprawl and ALL-CAPS register breaks are loudest symptoms.

- **Empty states leak hollow content into focal regions.** Pillars 2 (W3), 5 (BLOCKER 1, W7), 6 (B-2, W-4) all flag this — earnings detail pane (BUG-04), `/strategy-momentum-quality` flat dark page (Pillar 2 W5), `/alerts` mismatched-bg band, `/pipeline` orphan "Pipeline has not yet run today" callout, `EquityPanel` "Not enough data" with no recovery. No shared `<EmptyState>` primitive — each is a one-off, several render as voids.

- **Triple-row chrome above any page content.** Pillar 2 W2 + W1 + Pillar 6 W-1 — TopBar + StatusStrip + per-route promoted summary row stack before any body content. On `/dashboard` the giant Capital Canvas number is the third repeat of `$101,167.01` above the fold. Combined with bottom StatusBar (BUG-02), 4 chrome rows surround ~1 row of content.

- **Marketing/auth shell is its own ungoverned product.** Pillar 1 (vendor voice on `/docs`), Pillar 3 (F1/F5: parallel hex palette + theme parity broken), Pillar 4 (F6: 30 instances of `text-[10px]`/`text-[11px]` concentrated in `auth/*` and `RequestAccessForm.tsx`), Pillar 5 W4 (`/about`, `/contact`, `/help-earnings-data` ship walls of tightly-stacked `§ NN` sections with no `space-y-12` rhythm) all converge on the same surface. Needs governance independent of the trading workspace.

---

## Per-pillar BLOCKER summary (deduplicated)

| Pillar | BLOCKER | Mapped to |
|---|---|---|
| 1 | `/docs` whole-page voice break | BUG-12 (below) |
| 1 | `Submit LIVE Order` shouting | **BUG-07** |
| 1 | Generic DashboardError fallback | BUG-13 |
| 1 | AICopilot "Please try again" cliché | BUG-14 |
| 1 | Lazy `(s)` plural in destructive toasts | BUG-15 |
| 1 | Login error messages still generic | BUG-16 |
| 1 | Request-access success H2 voice break | BUG-17 |
| 1 | Lockout `Reset lockout` button contradicts message | BUG-18 |
| 2 | StatusBar mono rail | **BUG-02** |
| 2 | Lime CTA mismatch | **BUG-03** |
| 3 | 306 hardcoded color literals | **BUG-08** |
| 3 | `!text-[#12281f]` overrides | **BUG-01** |
| 3 | Three competing primaries | **BUG-03** |
| 3 | Theme parity broken in auth shell | **BUG-08** |
| 4 | 23 arbitrary `text-[NNpx]` sizes | BUG-19 |
| 4 | `t-display-section` 22px-vs-13px contradiction | **BUG-10** |
| 4 | Heading hierarchy broken on 3 pages | **BUG-06** |
| 4 | (F3 forced overrides — folded) | **BUG-01** |
| 5 | Earnings empty-state void | **BUG-04** |
| 5 | 148 spacing values, 50% top-10 cover | BUG-20 |
| 5 | Arbitrary-pixel gaps/paddings | BUG-20 |
| 6 | Offline shell hijacks `/trade` | **BUG-05** |
| 6 | Empty earnings detail pane | **BUG-04** |
| 6 | Inconsistent destructive confirmation | **BUG-09** |
| 6 | Missing per-route `error.tsx` for `/strategies/*` | BUG-21 |

---

## All remaining BLOCKERs not in Top 10

- **[BUG-11] [BLOCKER] `BOOK EQUITY $101,167.01` repeated three times above dashboard fold** (Pillar 2 W1) — `frontend/src/app/(dashboard)/page.tsx:1203`, `frontend/src/components/layouts/DashboardLayout.tsx:61`. Demote persistent-bar copy on dashboard route only. Effort: S.
- **[BUG-12] [BLOCKER] `/docs` whole-page voice break — vendor marketing tone** (Pillar 1 #1) — `frontend/src/app/docs/_docs/content.ts:14, 49, 83, 94, 118-122`. Rewrite in `/help/earnings-data` register. Effort: M.
- **[BUG-13] [BLOCKER] Generic primary error fallback in DashboardError** (Pillar 1 #3) — `frontend/src/app/(dashboard)/error.tsx:21-23`, `frontend/src/components/error/DashboardError.tsx:41-42`. Replace "Something went wrong" with editorial copy. Effort: S.
- **[BUG-14] [BLOCKER] AICopilot "Please try again" cliché × 2** (Pillar 1 #4) — `frontend/src/components/layout/AICopilot.tsx:313, 345`. Name Claude, reference `/pipeline` status. Effort: S.
- **[BUG-15] [BLOCKER] `(s)` plural in destructive toasts** (Pillar 1 #5) — `frontend/src/app/(dashboard)/alerts/page.tsx:787, 789, 806`, `frontend/src/components/panels/TradePanel.tsx:699, 725, 734`. Use NotificationCenter's pluralization pattern. Effort: S.
- **[BUG-16] [BLOCKER] Login error messages still generic** (Pillar 1 #6) — `frontend/src/app/login/_login/LoginForm.tsx:164, 207`. Effort: S.
- **[BUG-17] [BLOCKER] Request-access success H2 voice break + literal `"queued"` fallback** (Pillar 1 #7) — `frontend/src/app/request-access/_request/RequestAccessForm.tsx:154-158`. Effort: S.
- **[BUG-18] [BLOCKER] `Reset lockout` button contradicts message above it** (Pillar 1 #8) — `frontend/src/app/login/_login/LoginForm.tsx:372-380`. Rename `"Clear local timer"`. Effort: S.
- **[BUG-19] [BLOCKER] 23 arbitrary `text-[NNpx]` sizes alongside full Tailwind ladder** (Pillar 4 F1) — app-wide. Codemod to closest `--fs-*`; ESLint `no-restricted-syntax: text-\[\d+px\]`. Effort: L.
- **[BUG-20] [BLOCKER] Spacing fragmentation: 148 values in 3,603 uses, top 10 only 50%** (Pillar 5 BLOCKER 2/3) — half-step proliferation (`gap-1.5` 127, `py-1.5` 86, `mt-0.5` 69) plus 21+ raw `[Npx]` sites in `ContextBar.tsx:47`, `StatusBar.tsx:58/95/101`, `PositionsList.tsx:123,246,254,294,300,332,340,362`, `AIMemoPanel.tsx:53/80`. Wire `--space-*` into Tailwind `@theme`; ESLint `no-arbitrary-spacing`. Effort: L.
- **[BUG-21] [BLOCKER] Missing per-route `error.tsx` for `/strategies/*`** (Pillar 6 B-4) — none in `strategies/`, `earnings-options-play/`, `momentum-quality/`, `trading-agents-research/`. Throws bubble to `(dashboard)/error.tsx` with no `route` context. Add 4 scoped boundaries. Effort: S.

---

## All WARNINGs (consolidated)

**Visuals/chrome:** Pillar 2 W2 (triple-row chrome — collapse promoted row into hero on dashboard only); W6 (StatusStrip 7+ tokens in 28px — drop dividers, move PAPER chip to avatar); W4 (Edge chip orange — `EarningsCalendarSidebar.tsx:265`, reuse brand ochre); W5 (`/strategy-momentum-quality` flat — pull equity curve / "Run backtest" CTA into upper fold).

**Color:** Pillar 3 F4 (`text-profit` 57 vs `text-up-500` 7 used interchangeably; `text-primary` 84 vs `text-brand` 70 dual names — pick semantic); F6 (`text-amber` overloaded across 4 meanings — decompose into `--state-warning`, `--state-stale`, `--state-info-time`); F7 (off-system Tailwind palette in `SectorTreemap.tsx` 14 hits, `StrategyTemplates.tsx:109-111`, `StrategyGrid.tsx:72/174`, `MarketContext.tsx:146`, `AllocationDonut.tsx:120` — sweep to tokens); F8 (inline `shadow-[…rgba(16,22,17,…)]` strings at `page.tsx:48, 860, 1164, 1341, 1380, 1582, 1697` — register hero-elevation token).

**Typography:** Pillar 4 F5 (mono numbers without `tabular-nums` in 173+ sites — `<Mono>` helper); F6 (30 instances of `text-[10px]`/`[11px]` in source despite 12px floor — lift + ESLint guard); F7 (10 arbitrary `tracking-[…em]` values across 51 sites — map eyebrows to `.t-label`); F8 (13 arbitrary `leading-[…]` values — codify `--lh-editorial: 1.65`); F10 (two `<h2>`s on `/strategies` mismatched 18px semibold vs 22px medium at `strategies/page.tsx:455, 528`).

**Spacing:** Pillar 5 W4 (marketing/legal collapse `space-y-` rhythm — introduce `.t-section-stack { @apply space-y-12 }`); W5 (half-step paddings → sub-40px tappable; promote `min-h-[44px]` from `ClaudeThesisCard.tsx:208` into primitive); W6 (`gap-1` too tight, drives `gap-1.5` proliferation); W7 (`/pipeline` orphan callout, `/alerts` mismatched-bg empty band); W8 (Tailwind config doesn't consume token scale — root cause).

**Experience:** Pillar 6 W-1 (`requestfailed` storms on auth route mount — 10 `ERR_ABORTED` at `/trade`; batch quotes, SWR ttl, `aria-busy`); W-2 (lockout countdown stale, `LoginForm.tsx:215, 365-373` — `useEffect` 1Hz tick); W-3 (OCC quote 404 silent — render "stale midpoint" badge, degrade gate); W-4 (`EquityPanel.tsx:53-70` empty no recovery — status badge + next step); W-5 (`OnboardingTour.tsx:102-122` `setTimeout(1500)` no first-paint suppress — delay 3s + `requestIdleCallback`); W-6 (`window.confirm()` at `settings/page.tsx:378-381, 1162` — styled Dialog with consequence list).

**Copywriting (consolidated from Pillar 1 §9-§31):** Title Case sprawl on dashboard sections + toggles (Active Alerts, Order Fills, Watchlist (JSON), Activate Template, Search Results, Create Alert, Open Trade × 4 lines apart on the same component); three-dot ASCII ellipses across 7+ sites (brief mandates `…`); three different titles for the same Live-mode dialog (`ProfileMenu.tsx:197, 131`, `settings/page.tsx:1131`); bare-verb buttons (`Save`, `Cancel`, `Hide`, `Show`, `Refresh`, `Reset`, `Clear`, `Got it` × 3); `Powered by Claude AI` vendor pattern; `made with discipline` fluff; `"No X yet"` empty stubs without next steps. Consolidate via lint pass + `<NotYetWiredCallout>` primitive.

---

## Quick wins (≤1 hour each, high impact)

1. **Strip the 13 `!text-[#…]` overrides in `pipeline/page.tsx` + `strategies/page.tsx`** (BUG-01) — single `git rm` of `!text-[#12281f]` and `!text-[#5d7268]`. Restores legibility on the strategies empty state, makes pages theme-switchable.
2. **Standardize three-dot ellipsis to single `…` glyph** — 7+ sites. Sed-able codemod. Brief explicitly mandates `…`.
3. **Rewrite the 8 BLOCKER strings from Pillar 1 §3-§8 + §1** (BUG-12 through BUG-18) — each is one-line copy edit. Highest perceived-polish win per minute of work.
4. **Add `useEffect` 1Hz tick to login lockout countdown** (W-Pillar6-W-2) — 4 lines.
5. **Auto-select first earnings calendar row unconditionally** (BUG-04 partial) — kill the `userClearedRef` exception on first paint at `earnings-options-play/page.tsx:197-220`.
6. **Demote one of the three `BOOK EQUITY $…` instances on `/dashboard`** (BUG-11) — one-line conditional in `DashboardLayout.tsx:61`.
7. **Add page-level `<h1 className="sr-only">` to `/alerts`, `/strategies`, `/strategies/earnings-options-play`** (BUG-06) — fixes WCAG 1.3.1 hierarchy in <30 minutes.
8. **Add per-route `error.tsx` boundaries for the four `/strategies/*` sub-routes** (BUG-21) — 4 small files; copy from `app/(dashboard)/error.tsx` with `route` prop populated.
9. **Title Case sweep on dashboard sections + toggles** (Pillar 1 §13) — 14 known offenders; sentence-case codemod. Eliminates the loudest register break.
10. **Replace `(s)` plurals in destructive toasts** (BUG-15) — 6 sites; uses pattern already proven in NotificationCenter.

---

## Bigger bets (multi-day systemic fixes)

1. **Wire `--space-*` and `--fs-*` tokens into Tailwind v4 via `@theme` in `globals.css`, then add lint rules to reject arbitrary px values** (BUG-19, BUG-20). Today the tokens are decorative because Tailwind defaults shadow them. After wiring + ESLint guard, the design system becomes load-bearing and the next fragmentation can't merge. Multi-day because every codemod needs a visual regression sweep against the 22 captured routes.

2. **Resolve the lime / forest / gold primary collision system-wide** (BUG-03). Pick Option A (auth shell adopts gold) or Option B (dashboard adopts forest as profit color). Either way: one-token swap propagates to `Sign in`, `BUY`, all positive P&L, the EarningsCalendar `Edge` chip, and ~10 other surfaces. Multi-day because the visual identity decision touches marketing, brand, and trading workspace simultaneously.

3. **Build governance for the marketing/auth shell as its own sub-system** (BUG-08, plus marketing voice issues, plus marketing typography issues). Define `.alpha-auth-shell` *theme block* with token redefinitions; sweep `AuthProductFrame.tsx`, `AuthLuxuryPreview.tsx`, `LoginForm.tsx`, `RequestAccessForm.tsx`, `RequestAccessForm.tsx`, marketing pages to consume tokens. Document the marketing voice register separately from the trading workspace register so future contributors know which one to write in. Multi-day because it spans 5+ files, the marketing pages themselves, and a writing-style guide.

4. **Build a shared `<EmptyState>` primitive (icon + headline + 1-line + 1 CTA) and migrate all empty surfaces to it** — earnings detail pane (BUG-04), strategy-momentum-quality body, alerts empty band, pipeline orphan callout, EquityPanel (W-Pillar6-W-4). Eliminates 5+ one-off compositions and makes empty states a deliberate visual moment instead of a void.

5. **Adopt the Cmd+K destructive modal as the canonical pattern for all 4 in-page destructive actions** (BUG-09). One shared modal component; consequence list per action; `Cancel orders` / `Cancel pipeline run` / `Pause strategy` / `Sign out` labels. Makes the destructive-action mental model consistent.

6. **Decompose `--amber-500` overload into `--state-warning`, `--state-stale`, `--state-info-time`** (W-Pillar3-F6). Sweep 113 amber sites to the right semantic. Operators currently can't distinguish "warning, act on this" from "stale, refresh me" at a glance — that's a critical defect for a trading product. Multi-day because the sweep spans 8+ files and chart legends.

---

## What's working (preserve)

These moments are strong and **must not regress** during remediation. Several are in the same files being edited, so explicit guard tests are wise.

- **Editorial voice on `/login/reset`, `/contact`, `/help/earnings-data`, the global error boundary, and a handful of dashboard empty states.** Platonic AlphaDesk sentence per Pillar 1 #40: "Self-serve reset is not yet wired." Codify as `<NotYetWiredCallout>`.
- **`/not-found/desktop-1440` is a complete focal-point composition** — reference for empty-state primitives.
- **`/strategies-list/desktop-1440` and `/strategies-trading-agents-research/desktop-1440` compose dense terminal information with hierarchy** — reference for hero composition.
- **`/reports/desktop-1440` strategy-performance table is the cleanest table in the app** (Pillar 2 N3) — lift to `/dashboard` Book panel and `/pipeline` calendar.
- **Token system on paper** (`design-tokens.css` + `globals.css`) — semantic ladder, LCH variants, theme-parity, color-mix. Remediation path is enforcement, not redesign.
- **12px readable floor enforced at runtime** — `fontSizeFailureCount: 0` across 95 sampled text runs.
- **Two-tap delete on alerts** (`alerts/page.tsx:451-481`) — 4s arm window, h-9 target, armed `aria-label`. BUG-09 must not regress this.
- **`aria-busy` + dim-without-skeleton refetch** (`EarningsCalendarSidebar.tsx:139`, `EarningsDetailPanel.tsx:218`) — reference for W-1 watchlist fix.
- **`OrderBar.submitDisabledReason`** (`OrderBar.tsx:784-791`) — gate reason in amber + `data-state="stale"`. Reference for W-3.
- **Cmd+K destructive modal** (`CommandPalette.tsx:351-410`) — bulleted consequences, OS-style labels. Adopt for BUG-09.
- **Optimistic order cancel** (`page.tsx:413-431`) — instant `updateOrderStatus` + refresh-after. Keep; BUG-09 modal fires *before* this.
- **Login form caps-lock detection, password show/hide** — only nit is W-2 lockout tick.
- **All icon-only buttons labeled** — 1,177 buttons scanned, **0** missing `aria-label`/`aria-labelledby`/`<title>`. Preserve under any button refactor.

---

## Suggested fix order for next sprint

**Day 1 — quick-win sweep (closes 8 BLOCKERs + 5 WARNINGs in one ~6h session)**
1. BUG-01 (`!text-[#…]` strip) — restores `/pipeline` + `/strategies` legibility.
2. BUG-13/14/15/16/17/18 + dashboard Title Case sweep — 8 copywriting BLOCKERs + loudest WARNING in one PR.
3. BUG-06 — `<h1 className="sr-only">` to 3 routes.
4. BUG-21 — 4 `error.tsx` boundaries for `/strategies/*`.
5. BUG-11 — demote dashboard book-equity duplicate.
6. W-Pillar6-W-2 — login lockout 1Hz tick.

**Day 2 — earnings polish + offline shell guard**
7. BUG-04 — auto-select fix + `<DetailPanePreview/>`.
8. BUG-05 — SW timeout + restore-original-pathname.
9. BUG-07 — TradePanel button copy alignment.
10. BUG-10 — drop `--fs-display-section` to 13px.

**Day 3-5 — destructive consistency + empty-state primitive**
11. BUG-09 — adopt Cmd+K modal for cancel/pause/pipeline/logout.
12. BUG-02 — re-style or collapse StatusBar mono rail.
13. Build `<EmptyState>` primitive; migrate earnings, momentum-quality, alerts, pipeline, EquityPanel.

**Week 2 — token enforcement bigger bets**
14. BUG-03 — lime/forest/gold reconciliation + visual regression sweep.
15. BUG-08 — `.alpha-auth-shell` theme block; sweep auth/marketing.
16. BUG-19 + BUG-20 — wire tokens into Tailwind `@theme`; ESLint guards; codemod arbitrary values.
17. BUG-12 — `/docs` voice rewrite.

**Rationale:** Day 1 is highest perceived-polish per hour, closes embarrassing low-hanging defects (hierarchy, generic error copy, plurals, lockout). Days 2 and 3-5 fix highest user-impact functional issues. Week 2 handles systemic remediation that prevents the next 50 findings from shipping. BUG-02 is deferred past Day 1 because it needs a one-day design spike; BUG-03 deferred to Week 2 because the brand-level call benefits from being made *after* the system is on tokens.
