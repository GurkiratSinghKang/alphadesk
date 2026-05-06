# Earnings-Options-Play Audit — Master Synthesis (2026-05-06)

**Page:** `/strategies/earnings-options-play`
**Method:** 4 persona agents + Playwright sweep + source-trace cross-check
**QA artefacts:** `qa/runs/2026-05-06T00-59-46Z/strategies-earnings-options-play/`
**Inputs synthesised:**
- `EOP-AUDIT-2026-05-06-flicker-graph-pct.md` (focused user-flagged bugs)
- `EOP-AUDIT-2026-05-06-earnings-hunter.md` (Persona 1 — pre-event hunter)
- `EOP-AUDIT-2026-05-06-risk-manager.md` (Persona 2 — capital preservation)
- `EOP-AUDIT-2026-05-06-mobile-a11y.md` (Persona 4 — non-pointer / 390px)
- (Persona 3 = focused flicker/graph/pct file above)

---

## TL;DR

**The three bugs the user explicitly flagged are confirmed real, with HIGH confidence diagnoses and surgical patches:**

| # | User-flagged bug | Status | Where | Fix complexity |
|---|---|---|---|---|
| 1 | Flicker between suggested trades | CONFIRMED | `TradeButtonRow.tsx:131-134, 387-390` | Trivial — move `onMouseLeave` from per-button to grid container |
| 2 | Buggy graph in option-order detail | CONFIRMED ×3 sub-bugs | `OptionsPayoffPanel.tsx:130-134, 226-228, 213` | Small — independent Y-padding + degenerate-range guard + cursor padding offset |
| 3 | Percentages incorrectly calculated | NOT a calc bug | — | Backend prompt + display fallback |

**Bug 3 is mis-diagnosed by the user.** All `fmtPct` call sites on the page were independently verified by two persona agents — every site is correct. What the user is seeing is the legitimate **`clampForecast` sentinel firing for real**: Claude is returning `12.6` (percent units) when the prompt expects `0.126` (ratio), so the bull/bear case is clamped to `+100% / -100%` and rendered with a dotted underline. The dotted underline is a hover-only marker, invisible on mobile — so to a user it looks like a calculation bug. The real fix is in the prompt + a defensive frontend guard, not the formatter.

**Beyond the user-flagged set, two more P0 issues surfaced from the persona sweeps** that should ship in the same series:

- **P0-A11y:** the IV-rank slider has no accessible name (`FiltersBar.tsx:147-175`) — `<input type="range" name="minIvRank">` rendered without `aria-label` or `<label>` association. WCAG 4.1.2 fail.
- **P0-A11y:** the payoff chart has zero non-pointer access — no keyboard nav, no `role="img"` data table, hover-only readout. WCAG 2.1.1 + 1.3.1 fail.

---

## Bug 1 — Flicker between suggested trades

**Confidence:** HIGH  ·  **User-perceptible:** YES

### Root cause

In [TradeButtonRow.tsx:131-134](frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/TradeButtonRow.tsx#L131), every `DefinedRiskTradeLink` carries `onMouseLeave={previewLeave}` which calls `onHoverPayoffDraft?.(null)`. When the cursor moves from button A to button B, browser event order is:

1. **A** — `mouseleave` → `previewLeave()` → `setHoveredPayoffDraft(null)` → empty state mounts in the chart panel
2. **B** — `mouseenter` → `previewEnter(setup)` → `setHoveredPayoffDraft(draft)` → real chart mounts

Two render passes back-to-back = visible flicker.

The `useMemo`/`useState` machinery in `OptionsPayoffPanel` makes it worse: every leave/enter cycle re-runs `calculatePayoffSummary` and rebuilds 256 SVG points.

### Fix

Move `onMouseLeave` (and its keyboard counterpart `onBlur`) up one level from per-button to the grid container, with `relatedTarget` containment check on blur. Crossing button A→B fires only `enter B` because the grid never lost cursor focus.

```tsx
// TradeButtonRow.tsx:160-164
<div
  data-slot="trade-button-row"
  onMouseLeave={previewLeave}
  onBlur={(e) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      previewLeave();
    }
  }}
  className="..."
>
```

…and remove `onMouseLeave={previewLeave}` / `onBlur={onHoverLeave}` from every individual `DefinedRiskTradeLink`.

---

## Bug 2 — Payoff graph

**Confidence:** HIGH (2a, 2c) / MEDIUM (2b)  ·  **User-perceptible:** YES

`OptionsPayoffPanel.tsx` has three independent rendering bugs.

### 2a — Symmetric Y-scaling crushes asymmetric strategies (P1, HIGH)

[`OptionsPayoffPanel.tsx:226-228`](frontend/src/components/options/OptionsPayoffPanel.tsx#L226):
```ts
const span = Math.max(Math.abs(rawMin), Math.abs(rawMax), 1);
const yMin = -span * 1.12;
const yMax = span * 1.12;
```

Long call: max loss $370, max profit ≈$4,330. The Y axis becomes [-$4,850, +$4,850], so the loss-tinted band fills 45% of the chart in dead space and the curve lives in the top 50%. The risk-manager persona flagged this as visually misleading: the chart literally looks like the strategy has more downside than upside.

Compounded by **no Y-axis tick labels** (only `text-eyebrow` "At expiration · Spot · Expiry" footer) — the user cannot tell from the chart alone what max profit/max loss are. They have to read the metric grid above.

### 2b — Degenerate `xMin === xMax` collapses the curve (P3, MEDIUM)

[`OptionsPayoffPanel.tsx:213-222`](frontend/src/components/options/OptionsPayoffPanel.tsx#L221):
```ts
const xMin = summary.priceRange.min;
const xMax = summary.priceRange.max;
// ...
const x = (price: number) => padding + ((price - xMin) / Math.max(1, xMax - xMin)) * innerWidth;
```

When `xMax - xMin === 0` (single-strike summary, or upstream pricing failure), the `Math.max(1, ...)` guard maps **every point to the same x = padding**. The curve becomes a vertical line at the left edge. No empty state fires because `points.length >= 2` and `summary.status === "ready"`.

Lower frequency than 2a but produces a hard-to-debug "curve disappeared" UX.

### 2c — Hover cursor X math ignores SVG padding (P2, HIGH)

[`OptionsPayoffPanel.tsx:130-136`](frontend/src/components/options/OptionsPayoffPanel.tsx#L130):
```ts
const rect = event.currentTarget.getBoundingClientRect();
const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
const price = chart.xMin + Math.max(0, Math.min(1, ratio)) * (chart.xMax - chart.xMin);
```

But the SVG is rendered with **28px horizontal padding** (line 216-217), so the actual price axis runs from `padding` to `width - padding` in SVG-space, not 0 to width. The cursor at the visual centre of the chart maps to `0.5 * (xMax - xMin) + xMin` instead of the real centre. Off-by-up-to-padding/innerWidth ≈ **8.4% on a 720px chart** at the extremes.

### Fix sketch (single PR)

```ts
// 2a — independent Y padding (keep zero in view, breathing room above and below)
const upPad = Math.max(rawMax * 0.12, span * 0.05);
const downPad = Math.max(Math.abs(rawMin) * 0.12, span * 0.05);
const yMin = Math.min(0, rawMin) - downPad;
const yMax = Math.max(0, rawMax) + upPad;

// 2b — early-return on degenerate range
if (xMax - xMin <= 0) return null;

// 2c — project cursor px → SVG px → inner-x
const svgPxPerCssPx = chart.width / rect.width;
const svgX = (event.clientX - rect.left) * svgPxPerCssPx;
const innerX = Math.max(0, Math.min(chart.innerWidth, svgX - chart.padding));
const ratio = chart.innerWidth > 0 ? innerX / chart.innerWidth : 0;
const price = chart.xMin + ratio * (chart.xMax - chart.xMin);
```

Persona-2 also recommended adding **Y-axis tick labels at zero / max profit / max loss**. Out of scope for the bug fix; queue as a follow-up.

---

## Bug 3 — "Percentages incorrectly calculated"

**Confidence:** HIGH that this is NOT a calc bug. CONFIRMED that the user's perception is real and addressable.

Two persona agents independently traced every `fmtPct` call site through to the backend emitter:

| Frontend | Backend source | Unit | OK? |
|---|---|---|---|
| `expectedMovePct` | `earnings_screener.py:120` | fraction | ✅ |
| `nextDayMovePct` | `earnings_screener.py:426` | fraction | ✅ |
| `avgAbsMovePct` | `earnings_screener.py:137-150` | fraction | ✅ |
| `surpriseBeatRate` | `earnings_screener.py:144` | fraction | ✅ |
| `yieldPct` (despite the name) | `earnings_screener.py:1682` | fraction | ✅ |
| `setup-replay R-multiple` | `HistoricalSetupReplay.tsx` | math-correct ratio | ✅ |

**The displayed `+100% / -100%` on PLTR is the legitimate `clampForecast(raw)` sentinel firing.** The clamp was added because Claude returns `direction_magnitude: 12.6` (percent) instead of `0.126` (ratio) for ~30% of symbols, and without clamping the chart would show `+1260%`. The dotted-underline tooltip says "value clamped to ±100% — model returned 12.6, treating as 0.126". But the dotted underline is hover-only, so on mobile it looks like the model is forecasting binary outcomes.

### Recommended remediation (lower priority than Bugs 1 + 2)

1. **Backend prompt fix** — pin the unit explicitly in `earnings_prompts.py:201`:
   > "`direction_magnitude` MUST be a decimal ratio between 0.0 and 1.0. Example: a 12% expected move = 0.12. NEVER return values > 1."
2. **Frontend defensive divide** — `clampForecast` already exists; extend to auto-divide by 100 when `Math.abs(raw) > 1` and surface a `clamped_unit_correction` flag.
3. **Display fallback** — when clamping fires, render `—` instead of `±100%`. The dotted-underline tooltip alone is invisible on mobile.
4. **Optional rename** `yieldPct → yieldFraction` to remove the misleading name.

---

## Other findings worth shipping in the same series

### P0

- **A11y:** payoff chart hover-only readout (`OptionsPayoffPanel.tsx:128-174`) — no keyboard nav, no sr-only price/PnL table, no `role="img"`. **Fix:** add data table behind `<div className="sr-only">`, render hovered cell as `aria-live="polite"`.
- **A11y:** IV-rank slider missing accessible name (`FiltersBar.tsx:147-175`). **Fix:** wrap in `<label>` or add `aria-label="IV rank minimum"`.
- **Risk surfacing:** synthetic/demo-data disclosure stacks below-the-fold on mobile. **Fix:** promote `PartialDataBanner` above the calendar sidebar in mobile layout, or pin it to the top of `EarningsDetailPanel`.

### P1

- **HistoricalSetupReplay disclaimer is a footnote, not a chip** — the "synthetic premium · ranking only" caveat at lines 316-318 hides at the bottom of a panel that displays "100% WIN, AVG R +167.1%, PF ∞" prominently. Move into verdict-pill area at line 245-261.
- **All Monday rows show `Edge 0`** for PLTR + VRTX — `services/earnings_screener.py:200-218` likely zeros the edge score when `iv_rank: null`. Investigate the `iv_rank` plumbing — calendar sidebar shows null while detail panel has rank 44, so the data exists but isn't propagating to row.
- **Risk warning is dismissible** — only "max-loss capped" assertion lives in a `localStorage`-gated dismissible card. Add a permanent (non-dismissible) chip above the trade buttons: "Defined risk: every button caps max loss at the displayed amount."
- **StrikeLadder POP column** uses `(1 − |Δ|)` approximation but header just reads "POP". Tooltip caveat is hover-only. Add a question-mark badge with click-to-expand on mobile.
- **HistoricalMoves chart** has no `<figure role="img">` and no sr-only data table. `IVTermSkew.tsx:127-148` is the gold pattern — replicate.
- **Claude full-research arrives silently** — `FullResearchBlock` at `ClaudeThesisCard.tsx:349-373` lacks `aria-live`, so the ~30s-delayed thesis slides in without announcement.

### P2

- StrikeLadder needs a horizontal-scroll-cue indicator on mobile.
- Filters bar wraps to ~5 rows at 390px (suboptimal but reachable).
- `BEAT %` cell ambiguous "100" with no unit.
- `DMT` time abbreviation in sidebar undocumented.
- Missing "Today/Tomorrow" filter preset.

---

## Recommended PR sequencing

1. **PR-1: `fix(eop): close 3 user-flagged bugs (flicker + graph)`** — Bugs 1, 2a, 2b, 2c. Trivial blast radius. Ship first.
2. **PR-2: `fix(eop): clamp displayed forecast magnitude to em-dash, pin Claude unit`** — Bug 3 backend + frontend, lower urgency.
3. **PR-3: `a11y(eop): keyboard nav for payoff chart + slider labels`** — P0 a11y, larger blast radius.
4. **PR-4: `feat(eop): permanent risk-context surface + replay disclaimer chip`** — P1 risk-management cluster.

PR-1 patches are ready to commit now.
