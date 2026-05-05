# F1 — already resolved in source (deploy-pending)

**Audit finding:** Persona-workflow F1 — dashboard hides `Session mode: Paper trading` chip while every other authed page shows it.

**Status:** **Source fix already landed.** Surgical-fix agent (2026-05-05) found no source change is required.

## Evidence

Commit `bd1ba839` (2026-05-05 11:13 EST, "fix(chrome): batch D — twMerge config, not-found shell, TopBar dedupe, …"):

> P1-02: composites/TopBar (240-line duplicate) deleted. The canonical
> layout/TopBar — already used by every non-desk dashboard route — is now
> also used on the desk. The desk page sheds its NAV_ROUTES list (the
> canonical TopBar already owns the nav set) and threads no regime/clock/
> avatar props (zustand-driven inside the canonical component). Ones-and-
> only-one TopBar in the codebase.

The audit's `persona-workflow-findings.md:20` correctly identified the root
cause as `composites/TopBar` (used by dashboard) ≠ `layout/TopBar` (used by
every other authed page). Batch-D consolidated to a single `layout/TopBar`,
which renders `<StatusPills>` → `<SessionPill>` with `aria-label="Session
mode: Paper trading"` (`frontend/src/components/layout/StatusPills.tsx:80-107`).

Trace, current `main`:
- `frontend/src/app/(dashboard)/page.tsx:42` → `import { TopBar } from "@/components/layout/TopBar"`
- `frontend/src/app/(dashboard)/page.tsx:752` → `<TopBar />` rendered inside the desk shell
- `frontend/src/components/layout/TopBar.tsx:142` → `<StatusPills />`
- `frontend/src/components/layout/StatusPills.tsx:133` → `<SessionPill mode={tradingMode} />`
- `frontend/src/stores/ui.ts:41` → default `tradingMode: "paper"`
- `frontend/src/components/composites/TopBar.tsx` → **deleted in batch-D**

## Why the audit DOM still shows 0

The audit harness sweep at `qa/runs/2026-05-04T20-31-40Z` was captured
2026-05-04 16:33 EST (= 20:31 UTC) — **before** batch-D merged the morning
of 2026-05-05.

Even the most recent canonical sweep (`qa/runs/2026-05-05T14-21-21Z`,
2026-05-05 10:21 EST) is pre-batch-D-deploy: `qa/runs/LATEST.md` annotates
it as *"pre-deploy of 2026-05-05 audit-fix commits — same code as 2026-05-
04T20-31-40Z plus R6-1/-2/-5/-6/-8 not yet deployed."*

So the dashboard DOMs in both `2026-05-04T20-31-40Z` and `2026-05-05T14-
21-21Z` will continue to grep `Session mode|Paper trading` → 0 until
batch-D ships to `tradingalpha.net`. A re-run of the QA harness against the
new build will show the chip in the dashboard `app-top-bar` slot like
every other page.

## Verification gates run

- `npm run typecheck` — pass (no errors)
- `npm run build` — pass (clean, no warnings)
- `vitest run StatusStrip.test.tsx TopBar.test.tsx dashboard-selectors.test.ts` — 13/13 pass

## Bonus: F2 was actionable and not R6-locked, fixed in same agent run

`frontend/src/app/(dashboard)/strategies/[id]/page.tsx` is not in the
R6 lock list. Added an `<Open in trade ticket>` link to the strategy
detail header action row (between Pause/Resume and View trades). The
trade page already supports `?strategy=<id>` (R5-B1, used by the
earnings-options-play page), so this is a pure deep-link with no new
plumbing. Rendered as `<Link>` (not `<button>`) so middle-click /
cmd-click open in a new tab — same lesson the audit's F4 finding
recommends for the mobile dashboard primary action.

F3 (earnings-options-play per-card "Stage trade ticket") was skipped
because `(dashboard)/strategies/earnings-options-play/page.tsx` IS in
the R6 lock list (`/tmp/r6-locked-files.txt`).
