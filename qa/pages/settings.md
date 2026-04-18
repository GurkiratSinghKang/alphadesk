# /settings — expected behavior

## Route
- URL: `/settings`
- Access: requires-auth
- Redirects: none
- Metadata: inherits root.

## Layout
Wraps in `DashboardPageLayout eyebrow="§ SETTINGS" title="Settings"`. Inner `space-y-4` column of `rounded-lg border border-border bg-bg-elev-1 p-4` panels.

### Structure (top-to-bottom panels)
1. **Trading Mode** (icon `Monitor`):
   - Segmented toggle: `Paper` label / switch / `Live` label.
   - Switch styled: `role="switch"` button, chartreuse-bg when Paper, coral-bg when Live, 24x44px.
   - Help copy under: "Live mode uses real capital. Be cautious." or "Paper mode uses simulated funds. Safe for testing." (amber text).
2. **API Keys** (icon `Key`):
   - Static text: "Alpaca API keys are configured on the server. Contact admin to update brokerage credentials." (12px muted).
3. **Notifications** (icon `Bell`):
   - 4 `Toggle` rows (label + description + switch): Order Fills / Alerts Triggered / Pipeline Completed / Strategy Events.
   - Each Toggle: small 5x9 pill (`bg-primary` on / `bg-[var(--panel)]` off) with a white thumb.
4. **Display** (icon `Palette`):
   - Toggle: Ticker Tape (shows marquee below header when on).
   - Toggle: Compact Strategy View.
   - SegmentPicker: Animation Speed (Normal / Reduced / None).
5. **Data Refresh** (icon `RefreshCw`):
   - `IntervalSlider` — 4-button pill: `10s / 30s / 1m / 2m`. Active button primary-tinted.
   - Hint: "Lower intervals increase API usage. Default is 60s.".
6. **Export Data** (icon `Download`):
   - 3 outline small buttons:
     - "Watchlist (JSON)" → `alphadesk-watchlist-YYYY-MM-DD.json`.
     - "Trade History (CSV)" → `alphadesk-trades-YYYY-MM-DD.csv` (fetches 1000 trades).
     - "Settings (JSON)" → `alphadesk-settings-YYYY-MM-DD.json`.
   - While exporting trades: `Loader2 animate-spin`; on success: swap icon to `Check` chartreuse for 2s.
   - If trade export returns empty: dispatches `alphadesk:api-error` event with "No trade history to export" (surfaces as toast via DashboardLayout listener).
7. **Security** (icon `Shield`):
   - Static text: "Sessions expire after 8 hours. JWT tokens are stored in HttpOnly cookies with Secure and SameSite flags.".
8. **PerformanceMetrics** component — renders at bottom (metrics from `components/dashboard/PerformanceMetrics.tsx`).

### Typography roles
- Page title: Display md italic serif.
- Panel titles: sans 14px semibold with icon.
- Labels: sans 12px medium.
- Descriptions: 10px muted.
- Warning lines (Live mode, Lower intervals): 10px amber.

### Palette check
- Panels use `bg-bg-elev-1` (defined).
- Live-mode switch uses `bg-loss/80` (coral); Paper uses `bg-profit/60` (chartreuse).
- No raw hex.

## Mobile (<640px)
- Panels stack; toggles align right with the label wrapping naturally.

## Interactive elements

### Trading Mode switch
- Click toggles state via `useUIStore.setTradingMode`.
- Role / ARIA: `role="switch" aria-checked={live} aria-label="Trading mode toggle"`.

### Notification toggles (×4)
- Persist via `usePreferencesStore.setNotificationPref(key, v)`.

### Display toggles (×2) + Animation SegmentPicker
- Persist via `setDisplayPref`. Ticker Tape toggle controls whether `<TickerTape />` renders in the non-desk dashboard chrome.

### Data Refresh interval buttons
- 4 options: `10 / 30 / 60 / 120` seconds. Persist via `setDataPref("refreshInterval", v)`.

### Export buttons (×3)
- Produce real browser downloads (`Blob` + `URL.createObjectURL`).
- Trade export: `await getTradeHistory(1000)`. If empty, dispatches error event (triggers toast).

## Expected states

| State | Render |
|---|---|
| **Initial mount** | All toggles reflect persisted Zustand state (after hydration). |
| **Switching to Live** | Switch turns coral; status strip reflects mode. |
| **Exporting** | Export button shows spinner; on success swaps icon to `Check` for 2s then reverts. |
| **No trade history to export** | Toast "No trade history to export" via custom event. |

## Edge cases
- **Zustand hydration mismatch** — settings reads from persist; the Dashboard layout guards pre-hydration with a skeleton (per `(dashboard)/layout.tsx`).
- **localStorage unavailable:** persistence silently fails; settings stay in memory for the session.
- **Very large trade history:** export button stays disabled while fetching.

## What must NOT happen
- No direct API-key input field — it's explicitly server-side.
- No "Delete account" affordance (intentional).
- No red/green outside coral/chartreuse on the Live-mode switch.

## SEO / meta
Inherits root.

## Accessibility (WCAG 2.1 AA)
- All toggles have `role="switch" aria-checked` + visible label text.
- SegmentPicker buttons render as real `<button>`s; currently missing `role="radiogroup"` on wrapper (a11y gap).
- IntervalSlider same as SegmentPicker.
- Export buttons have visible labels with icons.
- Focus rings visible on every interactive element.
- Color contrast: body text `text-foreground` ≈ 15:1 (AAA), muted ≈ 8:1.
