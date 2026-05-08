# AlphaDesk Preservation Register

> **Purpose:** This register catalogs the load-bearing optimizations,
> behavioral invariants, and silent contracts inside this app that
> the v2 redesign must NOT regress. Every Phase 1 PR is reviewed
> against this list before merge. Anything you add here gets
> permanent enforcement; anything you remove needs a written ADR.

**Source:** Audit ran during Phase 0 planning of the v2 redesign,
using a `Plan`-mode Explore agent over the entire frontend tree on
branch `claude/elegant-pascal-e149ee` (May 2026). 50+ items
catalogued; the five highest-risk items are flagged at the top.

---

## The 5 invariants that cannot regress

These five items are the hill we will die on. PRs that touch the
listed code paths must include an explicit "PRESERVATION-REGISTER:
{item} preserved" line in the PR body, plus a passing test.

| # | Invariant | Where | What breaks if you regress |
|---|---|---|---|
| 1 | **`tradingMode` cross-tab sync** | [`stores/ui.ts:79–103`](src/stores/ui.ts) | Tab A flips to live; tab B stays paper — wrong trading context, real money at stake |
| 2 | **Stream-backed WS channel resume cursors (Wave C)** | [`hooks/useWebSocket.ts:9–16, 91–94, 206–256`](src/hooks/useWebSocket.ts) | Order fills + portfolio updates silently drop on reconnect — lost money |
| 3 | **One-time `fitContent` gate** | [`components/charts/TradingChart.tsx:465–468, 1174–1209`](src/components/charts/TradingChart.tsx) | Every tick resets pan/zoom — chart unusable |
| 4 | **Destructive-action confirmation pattern** | [`components/destructive/`](src/components/destructive/) | Accidental deletes/halts/resets — data loss |
| 5 | **Stale-quote 422 → auto-refresh quote + inline error** | trade flow + [`(dashboard)/strategies/earnings-options-play/_earnings/TickerFreshnessStrip.tsx`](src/app/(dashboard)/strategies/earnings-options-play/_earnings/TickerFreshnessStrip.tsx) | Users trade on stale quotes — bad fills |

---

## A. Chart / data-viz optimizations

[`components/charts/TradingChart.tsx`](src/components/charts/TradingChart.tsx) is
treated as a **black-box engine** by the v2 redesign. Phase 1.2
(Trade) and Phase 1.3 (Symbol) rebuild the *toolbar/pane chrome* and
add v2 overlays as *new series-primitive plugins* — but the
following twelve items stay intact.

1. **Lightweight-charts v5 wrapper** — OHLCV bars, candle/line/area
   modes, indicator suite (EMA, SMA, BB, RSI, MACD, VWAP, anchored
   VWAP, ATR, Stochastic), event markers. Lines 1–1319.
2. **One-time `fitContent` gate** (Round-12 / CH-1) — `didFitRef`
   ensures `timeScale().fitContent()` fires once per
   (chartType, indicators) lifecycle, not on every refetch. Lines
   465–468, 1174–1209.
3. **Indicator math** — domain-correct Wilder's smoothing (RSI),
   EMA alignment in MACD, Fibonacci levels. Lines 205–439. Refactors
   must regression-test against historical charts.
4. **Anchored VWAP** (Slice-14 / AVWAP-1) — anchor-index clamping
   logic at lines 996–999. Lines 264–291.
5. **Event markers** (E/D/F/S badges) with shape + position
   conventions. Lines 792–875.
6. **Token-driven chart palette** — `getTokenVar()` lazy resolution
   so chart re-colors on theme swap without remount. Lines 154–158,
   186–200, 541–546, 898–901, 1221–1223.
7. **Drawing plugin** (Series Primitives canvas, fancy-canvas bitmap
   scaling) — [`drawingPlugin.ts:1–341`](src/components/charts/drawingPlugin.ts).
8. **Drawing plugin canvas math** — pixel-coordinate transforms,
   pixel-ratio handling for high-DPI. Lines 72–240 of drawingPlugin.
9. **ChartPane toolbar** — chart-type toggle, indicator menu,
   drawing-tools rail with state-machine wiring. Indicator priority
   stack (VWAP first) is owner-research-driven; preserve the order.
   Tests: [`__tests__/charts/ChartPane.test.tsx:19–77`](src/__tests__/charts/ChartPane.test.tsx).
10. **Comparison series overlay** (Slice-9 / CH-3C) — separate left
    price-scale, percent-rebased to first-bar. Lines 1137–1172.
11. **Alert hover callback** (Slice-4 / CH-3B) — `onAlertHover` emits
    `(price, yCoord)` on crosshair so parent can render the "+"
    affordance. Lines 63, 669–682.
12. **Historical fetch debounce** — ref-based `loadingMoreRef`
    pattern. Lines 694–708, 457–461.

**v2 chart additions land as plugins, not rewrites.** The Bookmap
heatmap, regime bands, S/R dashed lines + price tags, and Studies
dropdown overlays are series-primitive plugins alongside
`drawingPlugin.ts` — adding to the engine, never replacing it.

---

## B. Real-time / WebSocket optimizations

[`hooks/useWebSocket.ts`](src/hooks/useWebSocket.ts) is **untouched**
by the v2 redesign. New WS channels (`CHANNEL_PIPELINE`,
`CHANNEL_WATCHLISTS`, `CHANNEL_BACKTEST`, `CHANNEL_PLAYBOOKS`,
`CHANNEL_REPORTS`, `CHANNEL_ADMIN`) are added to the existing
allow-list and consume the existing dispatch pattern.

1. **Exponential backoff with FULL jitter** (capped 30s, 10 retries).
   Prevents thundering herd. Lines 68–70, 284–309, 312–328.
2. **Client-originated heartbeat** (Round-28 / persona-E P1) —
   ping every 30s, force-close after 90s idle. Detects half-open
   sockets. Lines 83–84, 181–195, 223–226.
3. **Stream-backed channel resume cursors** (Wave C) — track Redis
   Stream IDs per channel; re-subscribe with `last_id` on reconnect
   for at-least-once delivery of trade_updates + portfolio. Lines
   9–16, 91–94, 206–217, 240–245, 251–256. Tests:
   [`__tests__/hooks/useWebSocket.test.tsx`](src/__tests__/hooks/useWebSocket.test.tsx).
4. **Cursor expiration handling** (Round-29 / persona-E F2) —
   `cursor_expired` notice clears the stored cursor so the next
   reconnect starts fresh. Prevents replay loops. Lines 234–245.
5. **Network recovery listeners** — `online` +
   `navigator.connection.change` re-trigger reconnect on WiFi
   recovery. Lines 336–392.
6. **Visibility change reconnect** — `document.visibilitychange`
   resumes after tab backgrounding. Lines 414–428.
7. **Channel allow-list** — defense-in-depth against unbounded
   channel growth. Lines 19–36. Mirrors backend handler check.
8. **Callback-based message dispatch** — `Map<channel, Set<cb>>`
   avoids React re-render cascade per WS frame. Lines 107–108,
   257–260, 459–471. Reverting to state-based dispatch regresses
   measured perf.
9. **Re-subscribe timeout cleanup** (long-session-audit-r4 P2) —
   prevents `InvalidStateError` from stale callbacks firing on
   closed sockets. Lines 88–89, 124–130, 201–218.

---

## C. Performance / React optimizations

1. **WebSocketProvider dynamic import** — saves ~50–100KB on the
   `/login` chunk. [`lib/providers.tsx`](src/lib/providers.tsx),
   [`lib/providers/WebSocketProvider.tsx:1–38`](src/lib/providers/WebSocketProvider.tsx).
2. **React Query stale/refetchInterval per-hook tuning** — regime
   5m/5m, indices 1m/1m, market-status 60s/60s, strategies 30s/60s.
   Prevents thundering herd + redundant fetches.
   [`hooks/useQueries.ts:7–130+`](src/hooks/useQueries.ts).
3. **Zustand `partialize` + `skipHydration: true` on UI store** —
   prevents holiday market-status flash. [`stores/preferences.ts:135–152`](src/stores/preferences.ts),
   [`stores/ui.ts:59–75`](src/stores/ui.ts).
4. **`useShallow` selectors** — shallow-equality subscriptions in
   the market store avoid re-rendering all consumers on unrelated
   quote updates. [`stores/market.ts:3–4`](src/stores/market.ts).
5. **Phosphor `optimizePackageImports`** — saves ~1.6MB by deep-
   importing icons rather than the full barrel.
   [`next.config.ts:47–50`](next.config.ts).
6. **Web Vitals reporter** — onLCP / onCLS / onINP / onFCP / onTTFB
   beaconed via `sendBeacon` (or `fetch` w/ `keepalive` on Safari).
   [`lib/web-vitals.ts:1–119`](src/lib/web-vitals.ts).

---

## D. Accessibility / UX (not obvious)

1. **Skip link** to `#main-content` per WCAG 2.4.1.
   [`(dashboard)/layout.tsx`](src/app/(dashboard)/layout.tsx).
2. **44px touch-target floor** per WCAG 2.5.5 — `--touch-target-floor`
   token + `min-h-touch` Tailwind utility. ~26 sites consume.
3. **Focus-visible ring** in warm gold (`var(--focus-ring)`).
4. **LCH perceptually-uniform color tokens** — `--brand-lch`,
   `--profit-lch`, `--loss-lch`, `--info-lch`. Anchor lifted to
   L=48 in light mode to maintain WCAG AA contrast on cream paper.
5. **`prefers-reduced-motion`** respected on every animation.
   [`components/ui/AnimatedNumber.tsx`](src/components/ui/AnimatedNumber.tsx).
6. **Safe-area-inset for iOS** home indicator. Layout + globals
   CSS. Verify on notched / dynamic-island devices.
7. **Font-feature-settings** for ligatures + cv01/cv11 alternates.
   [`styles/design-tokens.css:511`](src/styles/design-tokens.css).
8. **Tabular numbers** forced on every numeric column —
   `font-variant-numeric: tabular-nums` via the `t-num-*` ladder.

---

## E. Backend FE-surface invariants

1. **Holiday-aware market status** — `/api/v1/market/market-status`
   proxies Polygon + Alpaca holiday calendars. Local heuristic gets
   holidays wrong. [`hooks/useQueries.ts:44–53`](src/hooks/useQueries.ts).
2. **Order idempotency keys** — submitter generates stable IDs;
   backend deduplicates. Network blips + retries cannot multiply
   orders. Frontend MUST keep using stable Idempotency-Key headers.
3. **Optimistic watchlist updates** — fire-and-forget local-first
   sync; server-authoritative reconciliation on success.
   [`stores/market.ts:119–145`](src/stores/market.ts). Tests pin the
   pattern: [`__tests__/stores/marketWatchlist.test.ts`](src/__tests__/stores/marketWatchlist.test.ts).
4. **Portfolio re-fetch on WS reconnect** (Wave C) — one-shot
   `fetchPortfolioData()` on reconnect so stale positions/orders
   refresh. [`hooks/useWebSocket.ts:163–176`](src/hooks/useWebSocket.ts).
5. **`clearPersistedStores()` on logout** — resets all Zustand
   stores so the next user can't see prior session's
   positions/watchlist. Cross-user data leak fix (commit
   `2b47b2be`). [`lib/auth/clearPersistedStores.ts`](src/lib/auth/clearPersistedStores.ts).

---

## F. Cross-tab sync + persistence

1. **`tradingMode` cross-tab sync** (persona-10 #1) —
   [`stores/ui.ts:79–103`](src/stores/ui.ts). HIGHEST-RISK
   regression. Listed at top.
2. **Zustand `persist` with versioned `migrate()`** on every major
   store. [`stores/preferences.ts:135–150`](src/stores/preferences.ts),
   [`stores/ui.ts:59–75`](src/stores/ui.ts).
3. **Deprecated-field retention** — preferences store keeps
   `animationSpeed`, `strategyEvents`, `tickerTapeOn` so older
   localStorage payloads don't throw on load. Pattern documented
   in `stores/preferences.ts:17–18, 28–29, 39, 72–73`.

---

## G. Destructive-action safeguards

1. **`useDestructiveAction` hook** — central destructive-modal
   dispatch. [`components/destructive/useDestructiveAction.ts:1–37`](src/components/destructive/useDestructiveAction.ts).
2. **`DestructiveConfirmModal`** — consequences-only confirm dialog
   used by 19 callers. **Kept as-is.** v2's new `DangerConfirm`
   primitive is opt-in for the ~10 sites that need typed-confirm +
   reason + audit preview.
3. **PaperLive `confirmLiveOpen` safety gate** in
   [`components/layout/CommandPalette.tsx:106`](src/components/layout/CommandPalette.tsx).
   v2 PaperLiveToggle in TopBar mimics the same toast (paper→live
   never flips client-side; admin-gated).

---

## H. Recent perf / hardening commits worth knowing

These shipped in the months before v2 work began. Each encodes a
specific regression class — keep the test or the comment intact.

1. **Stale-quote 422 auto-refresh + inline error** (commit
   `c196e610`). Trade flow + earnings flow.
2. **Earnings discipline gates** (`c5cb4069`) — confidence threshold
   + warning modal. Lives in
   [`(dashboard)/strategies/earnings-options-play/_earnings/`](src/app/(dashboard)/strategies/earnings-options-play/_earnings/).
3. **Cross-user data-leak fix** (`2b47b2be`) —
   `clearPersistedStores` on logout.
4. **Preserve public ticker previews on page** (`2e1d6c4d`) —
   most recent commit. Symbol page must continue rendering preview
   data without auth.

---

## I. Tests pinning specific behaviors

If you change anything in these test files, you are signing up to
explain the regression delta in the PR body. The behaviors they pin
are load-bearing — not test artifacts.

1. **`__tests__/hooks/useWebSocket.test.tsx`** — pins the Wave C
   resume-token contract (invariant #2).
2. **`__tests__/charts/ChartPane.test.tsx`** — pins the drawing-
   tools state machine (invariant #3 adjacent).
3. **`__tests__/stores/marketWatchlist.test.ts`** — pins optimistic
   update + server reconciliation pattern.
4. **Holiday-aware market status tests** — likely in
   `__tests__/hooks/useQueries.test.ts`. Pin backend-call dependency.

---

## How v2 enforces this register

1. **TradingChart contract is sacred.** Phase 0 + 1 work treats
   `TradingChart.tsx` as a black-box engine. New overlays ship as
   series-primitive plugins (Bookmap, regime, S/R, Studies).
2. **WebSocket plumbing is sacred.** New WS channels are added to
   the allow-list; the dispatch pattern is unchanged.
3. **Existing tests run on every PR** via `npm run ci` (typecheck
   + typecheck:tests + vitest). Failing any of the 4 pinning tests
   above blocks merge.
4. **Token migration is additive-first.** New tokens (`--brand-on`,
   `--up-on`, tints, regime, chart-line) added before any consumer
   migrates. Existing decomposed `--state-warning` palette
   untouched.
5. **Three banners stay functionally separate** (WsStatusBanner +
   SessionExpiryBanner + ApiDegradedBanner) but render through the
   shared `<StatusBanner>` primitive in Phase 1+ refactors.
6. **`HaltTradingButton`, `clearPersistedStores`, destructive modal
   hook** keep their public APIs even if their internals are
   re-skinned.
7. **Safety gate on PaperLive flip preserved.** v2 PaperLiveToggle
   in TopBar fires the same admin-gated toast as the existing
   CommandPalette flow. No client-side flip without the operator
   endpoint.

---

## Adding to this register

When a future change reveals a load-bearing invariant, add a new
section here in the same shape:

```markdown
- **Name** — what it is (1 sentence).
  Where: `path/to/file.tsx:line-range`.
  What breaks: 1-sentence regression.
  Tests: `path/to/test.tsx` (if present).
```

Keep the prose tight. The register is most useful when it's
read in full before every Phase 1 PR; bloat kills that habit.
