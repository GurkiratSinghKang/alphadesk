# Persona 62 — Alert Storm (100 alerts in 5 min at open)

Scenario: volatile market open, a power user has 100 price alerts all triggering within a 5‑minute window. Does the UI degrade gracefully — bell, list, toast — or does it melt?

Scope: `frontend/src/stores/notifications.ts`, `frontend/src/hooks/useNotifications.ts`, `frontend/src/components/layout/NotificationCenter.tsx`, `frontend/src/components/ui/toast.tsx`, `frontend/src/hooks/useToast.ts`, `frontend/src/app/(dashboard)/alerts/page.tsx`.

---

## Findings (max 10)

### 1. [P1] NotificationCenter has no dedup — 100 fires, 100 bell rows
`stores/notifications.ts:35-46` `addNotification` blindly prepends every payload. The only bound is `.slice(0, 200)`. A hundred `alert_triggered` events in 5 minutes = 100 separate unread rows in the bell. There is no `(symbol + condition + price)` key collapse, no "5 similar events" grouping, no time‑window merge. During the storm the user sees a wall of near‑identical rows and the "9+" badge is useless beyond that.

### 2. [P1] Toast queue caps at 3 — but there is no per‑source rate limit
`components/ui/toast.tsx:105` uses `[entry, ...prev].slice(0, 3)`. Good: only 3 visible. Bad: every one of the 100 alert WS events still allocates a toast, a `setTimeout`, and a Map entry, only for the slice to immediately discard it. On a slow phone that's 100 React renders per second‑burst. Also, the toast code path is only exercised by `useToast` callers — the alert WS path (`useNotifications`) does NOT currently route through toast, so the main user‑visible storm actually bypasses the cap entirely (see #4).

### 3. [P1] Alerts WS events never show a toast — they only land in the bell
`hooks/useNotifications.ts:128-144` pushes directly to the notifications store, no toast call. So a trader watching the chart will miss the fire entirely unless they have the bell popover open. Contrast with the claim in `components/ui/toast.tsx` a11y comments about "error toasts" — alert triggers are exactly the user‑critical event class that should raise `role="alert"` + `aria-live="assertive"`, but currently don't.

### 4. [P1] No WebSocket batching / coalescing of alert fires
`useNotifications.ts:129` fires `addNotification` synchronously per message. 100 WS frames in 5 min is fine CPU‑wise, but every call triggers a Zustand `set`, which re‑runs every `useNotificationsStore` subscriber including the tab count memo in `NotificationCenter.tsx:108,168` (5 tab counts re‑computed, each an O(n) filter over up to 200). 100 fires × 5 filter passes × up to 200 items = ~100k comparisons during the storm burst. Not catastrophic but avoidable with a single `requestAnimationFrame` batch.

### 5. [P2] Bell list is hard‑capped at 50 rendered rows, no pagination, no "load more"
`NotificationCenter.tsx:203` renders `filtered.slice(0, 50)`. Rows 51–200 are silently invisible even though they're in the store. No "Show older" button, no virtualization, no count indicator of the hidden set. Footer shows `filtered.length` (line 214) which now lies about what is shown (can show "120 notifications" while only 50 are in the DOM). Persona loses visibility into alerts 51–100 of the storm.

### 6. [P2] Alerts page `/alerts` has zero pagination — client renders all rows
`app/(dashboard)/alerts/page.tsx:464-472` maps `activeAlerts.map(alert => <AlertRow />)` unconditionally. No page size, no windowing. 100 active alerts = 100 DOM rows inside a `max-h-[400px]` ScrollArea. With a typical Radix ScrollArea this is still 100 mounted components with per‑row state (`deleting`). On a 2019 MacBook Air it renders — on an iPhone SE during an open, it stutters.

### 7. [P2] `handleClearTriggered` / `handleDeleteAll` fire N concurrent DELETEs with no batching
`app/(dashboard)/alerts/page.tsx:304-312, 323-330` do `Promise.all(triggered.map(deletePriceAlert))`. With 100 triggered alerts cleared during the storm this is 100 parallel HTTP requests. Browser caps at ~6 per origin, so most queue — but if the backend has no rate limit, this can hammer the API. No bulk `/alerts/delete?ids=...` endpoint is called; the UI simply blasts individual DELETEs.

### 8. [P2] Storage‑event cross‑tab sync replays full 200‑item list on every change
`stores/notifications.ts:98-122` installs a `window.addEventListener("storage")` handler that re‑sets the full `notifications` array into tab B whenever tab A writes. During the storm tab A writes on every `addNotification` (persist middleware flushes to localStorage), so tab B re‑parses and re‑sets 100 times. Each `setState` re‑renders every subscriber. The shallow‑equality short‑circuit at lines 111‑116 only catches no‑op writes, not storm writes.

### 9. [P3] No sort order asserted on alerts list; order depends on backend
`app/(dashboard)/alerts/page.tsx:288-289` just filters — no `.sort((a,b) => b.created_at - a.created_at)`. If the backend returns creation order ascending, the newest‑triggered (most relevant during a storm) will be at the bottom of the scroll area, hidden behind the 400px clip.

### 10. [P3] No "Active Alerts" count in the header when the list is long
`app/(dashboard)/alerts/page.tsx:340-345` shows counts in header actions but only when `alerts.length > 0`. During the storm there is no visual indicator of "N alerts triggered in the last minute" — just a blob of rows. Compare Bloomberg‑style systems: a flashing "47 new" pill at the top is the norm.

---

## 250‑word Summary

During a volatile open, 100 price alerts triggering in 5 minutes will technically work but will degrade the UX in meaningful ways. The notifications store is bounded at 200 items (`stores/notifications.ts:45`) and the toast container caps visible toasts at 3 (`components/ui/toast.tsx:105`), so neither blows up memory. However, the alert WS path in `useNotifications.ts:128-144` writes straight to the bell and never raises a toast, so a trader focused on a chart will miss fires entirely — the toast cap protects nothing here because the alert storm bypasses toasts.

There is no dedup: 100 near‑identical `alert_triggered` rows pile up in the bell with no grouping, no "5 similar" collapse, and no time‑window merge. The list renders only the first 50 (`NotificationCenter.tsx:203`) with no "show more" affordance, so rows 51–100 are invisible yet still counted in the footer. The `/alerts` page has zero pagination (`page.tsx:464`) and renders every active row; bulk clears fan out N parallel DELETEs with no backend batch endpoint. Per‑event Zustand writes cause O(n) re‑renders across 5 tab counters. Cross‑tab storage sync replays the entire array per write.

Net effect: the storm is survivable — nothing crashes — but the user loses situational awareness exactly when they need it most. Priority fixes: dedup keyed on `(symbol, condition, price)`, raise assertive toasts for alert fires, add a "load more" / virtualization path in the bell, and add a bulk‑delete endpoint. Word count: 248.
