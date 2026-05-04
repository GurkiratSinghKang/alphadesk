# Pillar 2 — Visuals (R4 re-audit)

**Score: 4/4**  (R1: 2/4, R2: 3/4, R3: 4/4 → now: 4/4)
**Run:** `qa/runs/2026-05-04T19-42-49Z`
**Audited:** 2026-05-04
**Stance:** Adversarial. Held to "above bar" until proven. Held the 4/4 from R3 — the system did not regress and gained one new strength (token-decomposed warning palette + chartreuse/coral SectorTreemap), one new strength on marketing rhythm (/about now uses section/section-sm/space-y-prose tokens), and closed R3-NEW-N2 (request-access hardcoded px sizes are gone). One R3 NIT (NEW-N1 placeholder wrap) survives untouched, but it remains a NIT — not score-gating.

---

## What I sampled

- **DOMs (16):** `about/desktop-1440/initial`, `dashboard/desktop-1440/initial`, `alerts/desktop-1440/initial`, `analytics/desktop-1440/initial`, `pipeline/desktop-1440/initial`, `reports/desktop-1440/initial`, `settings/desktop-1440/initial`, `trade/desktop-1440/multi-leg-prefill`, `strategies-list/desktop-1440/initial`, `strategies-earnings-options-play/desktop-1440/initial`, `strategies-trading-agents-research/desktop-1440/initial`, `strategy-momentum-quality/desktop-1440/initial`, `docs/desktop-1440/initial`, `request-access/desktop-1440/initial`, `contact/desktop-1440/initial`, `help-earnings-data/desktop-1440/initial`. Each grepped for slot inventory, palette tokens, typography tokens, and chrome strip presence/copy.
- **PNGs (4 reads, all under 4600 px tall, sampled one at a time):**
  - `dashboard/mobile-390/initial.png` (1170×2532)
  - `alerts/desktop-1440/initial.png` (4320×2700) — primary verification target for NEW-N1
  - `about/desktop-1440/initial.png` (4320×4512) — primary verification target for marketing rhythm tokens
  - `login-reset/mobile-390/initial.png` (1170×2532) — marketing-shell sanity check
- **Source files:** `frontend/src/components/dashboard/SectorTreemap.tsx` (entire — verifies migration to `bg-up-700`/`bg-down-700`/`text-up-100`/`text-down-100`/`text-profit`/`text-loss`); `frontend/src/app/(dashboard)/layout.tsx:82-115` (ApiDegradedBanner now uses `border-state-warning-border bg-state-warning-bg text-state-warning-fg` semantic tokens with `color-mix` button hover); `frontend/src/components/layout/TopBar.tsx:135-138` (TopBar search button — placeholder text + container styles).
- **Skipped (size cap):** all PNGs > 6000 px tall, including `/strategies-trading-agents-research`, `/strategies-list`, `/strategies-earnings-options-play`, `/login`, `/trade/mobile-390/multi-leg-prefill`, `/about/mobile-390`, `/strategy-momentum-quality`. DOM evidence stands in for those.

PR landing review:
- **PR #27 (R4-2):** SectorTreemap source verified migrated to chartreuse/coral. ApiDegradedBanner source verified token-ized with semantic state-warning ladder. Trade/multi-leg-prefill DOM carries 7× `state-warning-fg`, 3× `state-warning-border`, 2× `state-warning-bg` — banner renders with semantic tokens, not raw amber hex.
- **PR #28 (R4-1):** TopBar.tsx was NOT in the diff (`git log --all --oneline -- frontend/src/components/layout/TopBar.tsx` confirms). The R3 NEW-N1 wrap fix recommendation ("shorten placeholder OR add `whitespace-nowrap text-ellipsis`") was not executed. Placeholder still reads `Search symbols, commands...`.
- **PR #29 (R4-4):** /about uses `py-section`/`mt-section`/`gap-section-sm`/`space-y-prose` rhythm tokens. 6× `space-y-prose` blocks visible in DOM. min-h-11 buttons present (TouchTarget primitive applied to nav CTAs).
- **PR #31 (R4-3):** /request-access has zero arbitrary px text sizes (R3 NEW-N2 closed). Marketing pages (/about, /contact, /login, /login-reset, /request-access) have zero `text-[Npx]` literals across desktop frames. Sweep-wide arbitrary px text is concentrated on `/strategies-trading-agents-research` (~79 `text-[13.5px]` + 10 `text-[12.5px]`), but globals.css:568-585 normalizes those onto `var(--fs-body-sm)` with `line-height: 1.45 !important` — the pixels still render on token tiers.

---

## What changed since R3

1. **Token decomposition is invisible to the eye, visible in the source.** ApiDegradedBanner uses `border-state-warning-border bg-state-warning-bg text-state-warning-fg text-state-warning-fg-muted` plus a `color-mix(in oklab, var(--state-warning-bg) 55%, var(--state-warning-border))` button hover. Visual identity unchanged from R3 (still the brand-amber strip on /trade prefill states), but the palette is now type-safe and re-themable. Verified in `trade/desktop-1440/multi-leg-prefill.dom.html` — DOM carries the semantic class names, not raw `#21190d`/`#f8d590`/`#6f541f` hex.
2. **SectorTreemap is in-system.** Source migration verified line-by-line in `SectorTreemap.tsx:147-155`: `bg-up-700` / `bg-up-500/70` / `bg-up-500/50` / `bg-[var(--neutral)]` / `bg-down-500/50` / `bg-down-500/70` / `bg-down-700`. The hover tooltip and YTD secondary text use `text-profit` / `text-loss` / `text-up-100` / `text-down-100`. Treemap doesn't render on the public dashboard frame (the route is auth-gated), but the source migration is conclusive.
3. **/about reads as a deliberate editorial composition.** Desktop PNG (4320×4512) shows: t-display-lg "About AlphaDesk" hero, "LAST UPDATED 2026-04-19" mono caption, then 5 sequential `§ 01 · WHAT ALPHADESK IS` through `§ 05 · CONTACT` numbered eyebrow sections each anchored by a t-h2 (or label) heading, paragraph blocks with `space-y-prose` between them, gold-tinted inline links, and a 4-column footer (PRODUCT / COMPANY / LEGAL) sitting on top of `OPERATOR-GRADE EXECUTION` divider copy. Same visual grammar as /contact, /login-reset, /docs, /privacy, /terms, /risk, /request-access, EarningsDetailPanel — one product, one voice. The new `mt-section flex flex-col gap-section-sm` + `mx-auto max-w-[780px] py-section` + 6× `space-y-prose` is what gives the page its calm vertical rhythm.
4. **R3 NEW-N2 closed.** `/request-access` desktop DOM has zero `text-[18px]`/`text-[24px]`/`text-[26px]` literals. The R3 cosmetic concern is gone.
5. **R3 NEW-N1 not closed.** TopBar placeholder still wraps to 3 lines (`Search` / `symbols,` / `commands…`) on `/alerts/desktop-1440` — confirmed visually in the PNG. PR #28 didn't ship the recommended fix. This was R3-NIT and remains R4-NIT.
6. **All R3 closed-findings hold.** Zero "data unavailable" hits on the chrome of dashboard/alerts/analytics/pipeline/reports/settings (R2 NEW-B1 stays closed). Only mention in trade/multi-leg-prefill (the legitimate ApiDegradedBanner — token-ized). EarningsDetailPanel slot inventory still rich (24+ data-slots including `partial-data-banner`, `freshness-pill`, `iv-term-skew`, `historical-moves`, `options-payoff-panel`). Strategy-momentum-quality still has `strategy-hero` + `empty-state` slots (R1-W5 closed).

---

## Findings

### CLOSED (since R3)

#### R3 NEW-N2 — `/request-access` heading hardcoded px sizes → CLOSED
- R3 found `text-[18px]`, `text-[24px]`, `text-[26px]` on H2/H3 in `RequestAccessForm.tsx`
- Now: zero arbitrary px text on the rendered DOM. Marketing pages (`/about`, `/contact`, `/login`, `/login-reset`, `/request-access` desktop frames) all carry zero `text-[Npx]` literals
- Likely closed by PR #31 (R4-3 typography polish)

#### CARRIED FROM R3 — these stay closed:

- **R2 NEW-B1** (chrome-level red strip): zero "data unavailable" instances on dashboard/alerts/analytics/pipeline/reports/settings DOMs. Only on `/trade` prefill DOMs, with the new token-ized brand-amber palette.
- **R2 NEW-B2** (hollow earnings right pane): `/strategies-earnings-options-play` carries 24+ data-slots including `partial-data-banner`, `freshness-pill` (Quote/Options/Research), `iv-term-skew`, `historical-moves`, `historical-setup-replay`, `claude-thesis`, `options-payoff-panel` (verified via `data-slot=` grep on the DOM).
- **R1-W5** (`/strategy-momentum-quality` flat): hero + empty-state slots present in DOM. Composition remains deliberate.
- **R2 NEW-W1** (alerts EmptyState bespoke): alerts desktop PNG shows the "No alerts set / Define a price, indicator, or P&L trigger above to start watching." EmptyState rendered cleanly under the `Create Alert` form. Same composition as `strategy-momentum-quality` and the earnings detail panel.
- **R2 NEW-W2** (status banners + StatusBar grammar mismatch): both surfaces still use the same restrained palette. ApiDegradedBanner now provably uses semantic warning tokens (PR #27); visual continuity unchanged.
- **R1 carry-overs** (R1-B1 mono StatusBar; R1-B2 lime CTA; R1-W1 BOOK EQUITY ×3; R1-W2 3-row chrome; R1-W4 Edge chip palette leak): all hold per R3.

### NEW (R4)

#### R4-N1 — Token decomposition + color-mix hover on ApiDegradedBanner is a structural strength
- Not a "finding" in the regression sense — this is an upgrade. ApiDegradedBanner moved from raw amber hex to `state-warning-bg` / `state-warning-border` / `state-warning-fg` / `state-warning-fg-muted` semantic tokens. Hover state derives from `color-mix(in oklab, var(--state-warning-bg) 55%, var(--state-warning-border))`, which means light-mode and any future themes inherit the right contrast automatically.
- Source: `frontend/src/app/(dashboard)/layout.tsx:82-115`.
- Verified rendered in `trade/desktop-1440/multi-leg-prefill.dom.html`.

#### R4-N2 — SectorTreemap chartreuse/coral migration completes the dashboard's color identity
- Treemap was the last component using off-system Tailwind emerald/red defaults. Now uses the `--up-*` / `--down-*` ladder + `--neutral` floor + `text-profit`/`text-loss` semantic tokens.
- Source: `frontend/src/components/dashboard/SectorTreemap.tsx:147-155, 341-413`.
- Visual verification deferred (treemap is auth-gated; doesn't render in the public sweep), but the codepath is exhaustive.

#### R4-N3 — `/about` is now a reference page for marketing rhythm
- 6× `space-y-prose` paragraph stacks, `py-section` outer padding, `mt-section flex flex-col gap-section-sm` for inter-section vertical rhythm. The page reads as a single editorial column with the same numbered-section grammar already canonical on `/contact`, `/docs`, `/login-reset`. Anchors `/help-earnings-data` and the docs as well — same token system, same prose tier.
- This is what "above bar" looks like on a marketing page on a trading product.

### STILL OUTSTANDING (NIT only — not score-gating)

#### NEW-N1 (R3 → R4) — TopBar search placeholder wraps to 3 lines on routes with LIMITED DATA strip → still present
- Visually confirmed in `alerts/desktop-1440/initial.png`: the topbar search button renders `Search` / `symbols,` / `commands…` stacked across 3 lines, with the `Ctrl+K` kbd hint to the right.
- Source: `frontend/src/components/layout/TopBar.tsx:135-138`. The button is `min-w-[180px] max-w-[520px] flex-1` and the inner span lacks `whitespace-nowrap overflow-hidden text-ellipsis`.
- PR #28 (R4-1 Copy) did not touch TopBar.tsx (`git log --all --oneline -- frontend/src/components/layout/TopBar.tsx` confirms — last touch was 564c869d, the R2-1 typography codemod).
- Severity: still NIT (only happens at desktop-1440 on routes with the LIMITED DATA strip; doesn't appear on dashboard mobile, login-reset mobile, or /alerts mobile based on the PNG sample). One-line CSS fix.
- Recommendation unchanged from R3: either shorten the placeholder ("Search · ⌘K") or apply `whitespace-nowrap overflow-hidden text-ellipsis min-w-0` on the placeholder span.

#### NEW-N4 (R4 only) — `/strategies-trading-agents-research` carries ~89 arbitrary `text-[13.5px]` / `text-[12.5px]` literals in the DOM
- These are caught by the `globals.css:568-585` typography normalization (`@layer utilities :where([class*="text-[13px]"]) { font-size: var(--fs-body-sm) !important; line-height: 1.45 !important; }`), so the rendered visual output is on-token. But the source still ships arbitrary literals.
- Severity: NIT for Pillar 2 (visual output is correct); cross-pillar (Pillar 4 / Typography source-cleanliness).
- Not score-gating because the !important fallback genuinely produces token-tier pixels. R3 ranked something equivalent (NEW-N2) at NIT for the same reason.

---

## Score justification

**Why not 3:** Every R2 BLOCKER and R1 carry-over remains closed. R3 NEW-N2 is now closed (request-access px literals gone). Two new structural strengths landed in this round: (a) ApiDegradedBanner is now provably theme-portable via semantic state-warning tokens with `color-mix` hover derivation; (b) SectorTreemap finally speaks the dashboard's chartreuse/coral language instead of generic Tailwind emerald/red. /about is now a reference page for the editorial section/section-sm/space-y-prose rhythm — same composition discipline as /docs, /login-reset, /contact. Visual identity across login → 404 → request-access → contact → about → alerts → trade → strategies → docs → help is one deliberate product.

**Why 4 (above bar):** Three independent strengths sustain it:
1. **Token discipline at the source.** ApiDegradedBanner uses 6 semantic state-warning classes; SectorTreemap uses 4-stop up-* / down-* gradient + neutral floor + text-profit/loss tokens. Marketing pages have zero arbitrary px text. Typography normalization in globals.css catches any literal that did slip through.
2. **Composition discipline at the page.** `/about` mirrors `/docs` mirrors `/contact` mirrors `/login-reset` — all use the eyebrow-numbered-section grammar with t-display-lg + space-y-prose + max-w-[780px] container. The visual rhythm is enforced by 4 design tokens (`py-section`, `mt-section`, `gap-section-sm`, `space-y-prose`), not by hand-tuned margins.
3. **System-state grammar continuity.** The R3 strengths hold: WsStatusBanner state machine remains prioritized correctly (failed → broker-degraded → reconnecting → connecting → null); ApiDegradedBanner now uses theme-portable semantic tokens; bottom StatusBar mirrors the same restraint. The trading-terminal test for "above bar" on system-state surfaces is met.

**Why not 5 (no fifth bar exists, but for honesty):** The one untouched R3 NIT (TopBar placeholder wrap on settings/reports-style routes) is a 1-line CSS fix that didn't get prioritized in R4. It's NIT because it only manifests on desktop-1440 + LIMITED DATA strip routes and the user can still click through to the command palette. But it's the kind of thing a 4/4 system shouldn't carry into R5.

---

## Top follow-ups (post-4/4 polish, not score-gating)

1. **NEW-N1 (R3 → R4) one-line fix:** add `whitespace-nowrap overflow-hidden text-ellipsis min-w-0` to the TopBar search button's inner span at `frontend/src/components/layout/TopBar.tsx:137`. Or shorten placeholder to "Search · ⌘K". 2-minute fix.
2. **NEW-N4 (R4) source-cleanup:** migrate `text-[13.5px]` and `text-[12.5px]` literals on `/strategies-trading-agents-research` to `text-body-sm` (and adjust if the visual delta is non-zero — globals.css normalization should make it identical). Cross-pillar Pillar 4 work.
3. **SectorTreemap rendered verification:** the source migration is exhaustive but the treemap doesn't appear in the public sweep. Add an authed sweep frame (e.g. dashboard?demo=1 or a logged-in fixture) so future regressions on `bg-up-*` / `bg-down-*` palette can be caught visually, not just by source review.

---

## Files audited (this round)

Source files cited:
- `/Users/GK/Downloads/alphadesk/frontend/src/components/dashboard/SectorTreemap.tsx` (entire — verifies r4-2 migration to chartreuse/coral tokens)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/layout.tsx` (lines 82-115 ApiDegradedBanner with semantic state-warning tokens)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx` (lines 66-138 — verifies NEW-N1 source unchanged)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/globals.css` (lines 549-585 — typography normalization fallback for arbitrary px text)

DOMs sampled (under `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T19-42-49Z/`):
- `about/desktop-1440/initial.dom.html`
- `dashboard/desktop-1440/initial.dom.html`
- `alerts/desktop-1440/initial.dom.html`
- `analytics/desktop-1440/initial.dom.html`
- `pipeline/desktop-1440/initial.dom.html`
- `reports/desktop-1440/initial.dom.html`
- `settings/desktop-1440/initial.dom.html`
- `trade/desktop-1440/multi-leg-prefill.dom.html`
- `strategies-list/desktop-1440/initial.dom.html`
- `strategies-earnings-options-play/desktop-1440/initial.dom.html`
- `strategies-trading-agents-research/desktop-1440/initial.dom.html`
- `strategy-momentum-quality/desktop-1440/initial.dom.html`
- `docs/desktop-1440/initial.dom.html`
- `request-access/desktop-1440/initial.dom.html`
- `contact/desktop-1440/initial.dom.html`
- `help-earnings-data/desktop-1440/initial.dom.html`

PNGs sampled (4 reads, all under 4600 px tall, sampled one at a time):
- `dashboard/mobile-390/initial.png` (1170×2532)
- `alerts/desktop-1440/initial.png` (4320×2700)
- `about/desktop-1440/initial.png` (4320×4512)
- `login-reset/mobile-390/initial.png` (1170×2532)

Git history checked:
- `git show --stat 3769e6a9` (PR #27 R4-2 — confirmed 12 files migrated, including SectorTreemap and ApiDegradedBanner)
- `git show --stat 67546380` (PR #28 R4-1 — confirmed TopBar.tsx NOT in diff)
- `git log --all --oneline -- frontend/src/components/layout/TopBar.tsx` (last touch was 564c869d / R2-1, confirms NEW-N1 untouched)
