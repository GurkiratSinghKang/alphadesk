# Persona 64 — Old Browser Compatibility Audit

Scope: audit modern browser-API and CSS usage for Safari 15, iOS 15, and IE11-equivalent baselines. Findings below are ranked by severity; Wave 31's BroadcastChannel already has a storage-event fallback (confirmed at `frontend/src/lib/api.ts:542-616`).

## Findings

### 1. `AbortSignal.timeout()` used without feature-guard for older Safari (HIGH)
File: `frontend/src/lib/api.ts:56`, `frontend/src/lib/pipeline-api.ts:57`
`AbortSignal.timeout()` shipped in Safari 17.4 (March 2024). The code guards only on `typeof AbortSignal !== "undefined"`, which is true in Safari 15 but `.timeout` is undefined — every API call throws `TypeError` and the whole app fails to fetch. `AbortSignal.any` is correctly guarded but `.timeout` is not.

### 2. CSS `:has()` selector used heavily, no fallback (HIGH)
Files: `frontend/src/components/ui/card.tsx:45,50,66,67`, `frontend/src/components/ui/input-group.tsx:30-40,61-67`, `frontend/src/components/ui/tooltip.tsx:62`, `frontend/src/components/ui/command.tsx:175`, `frontend/src/components/ui/table.tsx:99,115`
`:has()` shipped in Safari 15.4 — Safari 15.0-15.3 will silently drop these rules. Layouts with card footers, input-group addons, and table checkboxes will mis-render. No `@supports` guard anywhere.

### 3. CSS container queries `@container` with no fallback (HIGH)
File: `frontend/src/components/ui/card.tsx:64` uses `@container/card-header`
Container queries (`container-type`, `@container`) shipped in Safari 16. Safari 15 / iOS 15 will ignore all container-query rules; card-header responsive behavior collapses.

### 4. BroadcastChannel has fallback — OK (confirmed, LOW)
File: `frontend/src/lib/api.ts:542-616`
Feature-detected, falls back to localStorage `storage` event. This is correctly implemented.

### 5. `ResizeObserver` used without guard (MEDIUM)
Files: `frontend/src/components/dashboard/SectorTreemap.tsx:211`, `frontend/src/components/charts/TradingChart.tsx:440`
`ResizeObserver` exists in Safari 13.1+ so Safari 15 is OK, but IE11 has no support — chart + treemap will throw on construction. No `typeof ResizeObserver` guard.

### 6. `navigator.clipboard.writeText` without fallback (MEDIUM)
File: `frontend/src/components/panels/ShareTrade.tsx:316`
Works in Safari 13.1+ but only over HTTPS, and silently rejects in some iOS 15 PWA contexts. No `execCommand('copy')` textarea fallback; users may see a silent no-op.

### 7. `scrollIntoView({behavior:"smooth"})` options-object variant (MEDIUM)
Files: `frontend/src/components/panels/OptionsPanel.tsx:199`, `frontend/src/components/layout/CommandPalette.tsx:205,217`, `frontend/src/components/layout/AICopilot.tsx:92`
Options-object signature shipped in Safari 15.4; 15.0-15.3 ignores smooth behavior (falls back to jump). Not broken but degraded. No IE11 support at all.

### 8. Subgrid — not used (OK, INFO)
No `subgrid` occurrences found. No concern.

### 9. Web Animations API — not used (OK, INFO)
No `.animate(` or WAAPI usage found; all animation is CSS (via `tw-animate-css`). Safe.

### 10. `Intl.DateTimeFormat.formatToParts` — OK (LOW)
Files: `frontend/src/lib/marketHours.ts:33`, `frontend/src/components/panels/PnlCalendar.tsx:32`, `frontend/src/components/dashboard/PnlCalendarMini.tsx:22`, `frontend/src/components/dashboard/MorningBrief.tsx:41`
`formatToParts` ships in Safari 10+, iOS 10+ — Safari 15 is fine. Author comments already acknowledge the "24 for midnight" quirk at `marketHours.ts:40`. IE11 has no Intl.DateTimeFormat parts support (would need polyfill) but IE11 is not a stated Next 16 / React 19 target regardless.

Additional note — `browserslist` is not configured in `frontend/package.json`, so Next.js defaults apply (modern evergreen + last 2 iOS). No targeting is done for Safari 15 specifically. Tailwind v4 also emits modern CSS (custom variants with `:is()`, logical properties via utility classes) that assumes Safari 16+.

---

## 250-word summary

AlphaDesk targets modern evergreen browsers and the codebase reflects that. Most "bleeding-edge" APIs the user listed are handled correctly: BroadcastChannel has a clean storage-event fallback (`lib/api.ts`), `Intl.DateTimeFormat.formatToParts` is widely supported back to Safari 10, subgrid is not used, and the Web Animations API is not used. `AbortSignal.any` is feature-detected before use.

Three real problems surface for Safari 15 / iOS 15. First, `AbortSignal.timeout()` is called in `lib/api.ts:56` and `lib/pipeline-api.ts:57` with only a `typeof AbortSignal !== "undefined"` check — that's true on Safari 15, but the `.timeout` static method didn't ship until 17.4 and every API call would throw `TypeError`. Second, CSS `:has()` is used pervasively across shadcn/ui primitives (card, input-group, tooltip, table, command) — Safari 15.0-15.3 dropped support, breaking card-footer padding, input-group focus rings, and table checkbox layout silently. Third, CSS container queries (`@container/card-header` in `ui/card.tsx`) shipped in Safari 16, so all container-driven responsive behavior no-ops on Safari 15.

Medium-severity issues: `navigator.clipboard.writeText` in `ShareTrade.tsx` has no `execCommand` fallback; `ResizeObserver` in TradingChart/SectorTreemap will throw on IE11 (not on Safari 15). `scrollIntoView` smooth-option is degraded but not broken.

Recommend: feature-guard `AbortSignal.timeout` with `setTimeout`-based fallback, wrap `:has()` / `@container` rules in `@supports` with flattened non-has fallback, and configure `browserslist` in `frontend/package.json` to make targeting explicit.
