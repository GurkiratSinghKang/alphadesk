# Pillar 2 — Visuals (Re-audit)

**Run:** `qa/runs/2026-05-04T13-45-11Z`
**Audited:** 2026-05-03
**Stance:** Adversarial. Visuals fail until proven otherwise. FORCE-stance retained from R1.
**Score:** **3 / 4** — Good. Both R1 BLOCKERs are closed and verified at source. The two biggest composition complaints (BOOK EQUITY x3, three rows of chrome) are also closed. What stops 4/4: a `DATA UNAVAILABLE` red banner sits on top of every authed route in this run, the EarningsDetail right pane is still a 70%-of-viewport void during the loading-only state captured here, and `/strategy-momentum-quality` continues to render flat with no upper-fold focal block.

---

## What I sampled

Read 18 `.preview.png` captures across two turns. Desktop: dashboard, login, trade (initial-prefill), strategies-earnings-options-play (initial + 4 sibling frames), strategies-list, strategies-trading-agents-research, strategy-momentum-quality, analytics, pipeline, reports, settings, alerts, not-found, about, risk. Mobile: dashboard, login, trade. Source-validated every claimed remediation against `frontend/src/`.

---

## Score rationale

**Why not 2:** The two R1 blockers are genuinely closed. The bottom rail no longer reads as a debug overlay; the lime-vs-ochre token war is resolved. The dashboard hero is singular. Three R1 WARNINGs (W1, W2, W4) closed at source.

**Why not 4:** The `DATA UNAVAILABLE` red strip is the first visual on every authed route in this run — same "raw debug overlay" complaint R1 raised against the bottom mono rail, relocated to the top. `/strategies-earnings-options-play` never resolves data so the new heatmap is unverifiable. `/strategy-momentum-quality` is still flat.

---

## Closed (verified)

### R1-B1 → CLOSED. Bottom StatusBar mono-pill rail collapsed.
`dashboard/desktop-1440/initial.preview.png` bottom edge now reads as a single `● Degraded · build dev` pill (left) plus `Commands ⌘K` cluster (right). Source: `frontend/src/components/composites/StatusBar.tsx:94-162` wraps the trigger in a Popover; per-service detail moved to `SystemDetailGrid` (lines 62-92) inside `PopoverContent`. Comment lines 19-20 cite BUG-02 explicitly. Confirmed across `analytics/`, `pipeline/`, `reports/`, `settings/`, `alerts/`, `trade/`. Pass.

### R1-B2 → CLOSED. Lime CTA token replaced with brand gold + segmented BUY/SELL.
`login/desktop-1440/initial.preview.png` "Sign in" is now a brand-gold/tan fill (`bg-brand` per `AuthProductFrame.tsx:180`) — matches the `not-found` "Back to AlphaDesk" CTA and the EmptyState action button (`EmptyState.tsx:56`). `trade/mobile-390/initial-prefill.preview.png` and desktop both show OrderBar as a horizontal segmented control with an 8 px `bg-up-500` direction dot inside each segment (`OrderBar.tsx:498-516`). The lime token is dead at every checked surface. Pass.

### R1-W1 → CLOSED. `BOOK EQUITY $100,936.34` is a single canonical hero.
`dashboard/desktop-1440/initial.preview.png` — giant Capital Canvas number in the body, no duplicate "BOOK EQUITY" cell in the ContextBar above. Top strip reads `DAY P&L · BUYING POWER · POSITIONS · OPEN ORDERS · SELECTED TICKER`. Source comments at `app/(dashboard)/page.tsx:281-288, 968` cite BUG-11. Pass.

### R1-W2 → CLOSED. Three rows of chrome compressed to two.
`dashboard/desktop-1440/initial.preview.png` now stacks (1) 48 px TopBar with logo + nav + search + StatusPills (regime/VIX/PAPER) + theme + bell + avatar, then (2) the 56 px ContextBar metric strip. The separate StatusStrip row is gone — content absorbed into TopBar via `StatusPills.tsx:118-136` mounted at `TopBar.tsx:142`. Confirmed across analytics/pipeline/reports/settings/alerts. Pass.

### R1-W4 → CLOSED. Earnings `Edge NN` chip uses brand token.
`EarningsCalendarSidebar.tsx:265` now renders chip with `border-[color:var(--brand)] text-[color:var(--brand)]`. Same family as the canonical ochre. Visual confirmation deferred (page never resolved data in this run; see NEW-B1).

### R1-N1 (mobile dashboard rounding) → CLOSED.
`dashboard/mobile-390/initial.preview.png` "Review 1 working order" CTA card matches surrounding metric-tile rounding.

### R1-N2 (settings landmark), N3 (reports table), N4 (about chevrons), N5 (z-index), N6 (broken icons) → unchanged, still pass / still cosmetic.

---

## Outstanding from R1

### R1-W5 → STILL OPEN. `/strategy-momentum-quality` desktop initial frame is a flat dark page.
`strategy-momentum-quality/desktop-1440/initial.preview.png` is composition-identical to R1: hero title + 4-metric row + `Run snapshot` button + subdued "Be cautious here / When to deploy" lower fold. No chart, no positions, no equity curve in the upper fold. EmptyState is imported into this route's children (`EquityPanel.tsx:8,56`) but the equity panel doesn't render in the initial fold. WARNING.

### R1-W6 → CLOSED via consolidation. Watch-item: at narrow viewports the 3-pill cluster compresses tightly next to the search box.

---

## NEW (not present in R1)

### NEW-B1. `DATA UNAVAILABLE · …Latest: Request timed out after 15000ms` red strip dominates every authed route in this run. (BLOCKER)
All five `strategies-earnings-options-play/desktop-1440/*.preview.png` frames show the strip pinned above the TopBar with a red-orange foreground, `Dismiss` button, and the literal text `grouped 1 backend issue; affected views stay cached, locked, or empty. Latest: Request timed out after 15000ms`. The strip is the only loss-red element on these pages, dominating a dark-on-dark composition. Same R1-B1 diagnostic ("the strongest signal in the product is the unstyled thing, not the deliberate composition") applies, just relocated from bottom to top.

**Fix:** Push backend-availability strings inside the affected pane (wire to existing `EmptyState`). Reserve chrome-level red banners for product-wide outages (auth lost, broker disconnected). Drop the `Latest: Request timed out after 15000ms` dev-console substring.

### NEW-B2. `/strategies-earnings-options-play` right pane still renders as a 70%-of-viewport void in every captured frame. (BLOCKER — BUG-04 unverifiable)
All five sampled earnings frames are visually identical: left card `Loading earnings…`, right card empty grey rectangle, no headline, no skeleton, no heatmap. The new calendar-week heatmap (BUG-04) is invisible to this audit. Either the heatmap doesn't render when data is unavailable (which exactly reproduces the R1-W3 hollow-pane diagnosis), or the run captured pre-data. Either way R1-W3 is **not verifiable as closed**.

**Fix:** Render the heatmap skeleton (week grid, day cells, weekend dimmed) during the loading state. Or fall back to `EmptyState` with an icon + "No earnings yet this week" + a CTA — already wired at `strategies/[id]/page.tsx:780` and `alerts/page.tsx:968`.

### NEW-W1. `EmptyState` primitive ships but the alerts visible composition still looks bespoke.
`EmptyState.tsx` exists with tests (`__tests__/primitives/emptystate.test.tsx`), imported in 6 files. But `analytics/page.tsx:654` still defines a duplicate inline `EmptyState` component (name collision). And `alerts/desktop-1440/initial.preview.png` shows a small alert-icon + "you haven't set up any alerts yet" + 1-line subhead — the icon size is visibly smaller than the primitive's `[&>svg]:size-6` token, suggesting a different code path renders or props omit `icon`. Verify the primitive is actually mounted, not just imported.

### NEW-W2. The top `DATA UNAVAILABLE` red strip and bottom StatusBar pill use different visual languages.
Top: filled red-orange strip, white text, bordered `Dismiss`. Bottom: dim mono `● Degraded · build dev` pill. Both are "system status" affordances; they read as belonging to two different products. Bring the top into the same `StatusBar` family — quiet inline pill that opens a popover on hover. One status grammar across the chrome.

---

## Score-defending findings (the surfaces that justify 3/4)

- **Login** — strongest single page in the run; gold-tan "Sign in" CTA matched on both panes makes the two halves feel like one product (R1's lime complaint resolved).
- **Dashboard** — three real improvements: singular `$100,936.34` Capital Canvas focal point, chrome dropped 3→2 rows, bottom rail no longer reads as debug overlay.
- **Trade** — OrderBar segmented BUY/SELL with 8 px `bg-up-500` direction dot is the cleanest expression of the new visual language. Mobile single-column readable.
- **Strategies list, trading-agents-research, Reports, Pipeline, Analytics** — unchanged positive read from R1; deliberate compositions with single focal points.

---

## Top 3 fixes (priority order)

1. **Move the `DATA UNAVAILABLE` red strip into the affected pane and quiet its tone** (NEW-B1). Top of every authed route in this run; eats the focal point.
2. **Render the earnings calendar heatmap skeleton during the loading state** (`frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsDetailPanel.tsx`). Without it, BUG-04 is unverifiable.
3. **Pull a signal-rich element into the upper fold of `/strategy-momentum-quality`** (R1-W5 carries forward). Equity curve or 4-up tile of last 5 trades / open positions / signal age / regime fit.

---

## Files Audited

Source files cited:
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/StatusBar.tsx` (19-20, 62-92, 94-162)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/ContextBar.tsx` (1-60)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/composites/OrderBar.tsx` (498-516)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/TopBar.tsx` (13, 64, 142)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/layout/StatusPills.tsx` (118-136)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/auth/AuthProductFrame.tsx` (180)
- `/Users/GK/Downloads/alphadesk/frontend/src/components/primitives/EmptyState.tsx` (entire)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/page.tsx` (281-288, 968)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/EarningsCalendarSidebar.tsx` (260-277)
- `/Users/GK/Downloads/alphadesk/frontend/src/app/(dashboard)/analytics/page.tsx` (654 — duplicate inline EmptyState)

Screenshot paths (all under `/Users/GK/Downloads/alphadesk/qa/runs/2026-05-04T13-45-11Z/`): `dashboard/{desktop-1440,mobile-390}/initial.preview.png`; `login/{desktop-1440,mobile-390}/initial.preview.png`; `trade/{desktop-1440,mobile-390}/initial-prefill.preview.png`; `strategies-earnings-options-play/desktop-1440/{initial,scrolled-mid,row-selected,bottom,status-hover}.preview.png`; `strategies-list/{desktop-1440,mobile-390}/initial.preview.png`; `strategies-trading-agents-research/desktop-1440/initial.preview.png`; `strategy-momentum-quality/desktop-1440/initial.preview.png`; `{analytics,pipeline,reports,settings,alerts,not-found,about,risk}/desktop-1440/initial.preview.png`.
