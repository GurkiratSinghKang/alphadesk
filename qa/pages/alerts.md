# /alerts — expected behavior

## Route
- URL: `/alerts`
- Access: requires-auth
- Redirects: none
- Metadata: inherits root.

## Layout
Wraps in `DashboardPageLayout eyebrow="§ ALERTS" title="Alerts & triggers"`. Header right-slot shows the active/triggered counts, "Clear Triggered" and "Delete All" buttons (when alerts exist).

### Structure
1. **CreateAlertForm card** — `rounded-lg border border-border bg-[var(--surface)] p-4` with header "+ Create Alert". 4-col grid on sm (1-col on mobile):
   - Symbol text input (`id="alert-symbol"`, placeholder "AAPL", uppercases on submit).
   - Condition: two-button segmented picker (Above = chartreuse tint, Below = coral tint), `ArrowUp` / `ArrowDown` icons.
   - Target Price number input (`step=0.01 min=0`, placeholder "150.00", mono tabular-nums).
   - Submit: primary full-width "Create Alert" → `createPriceAlert(sym, price, condition)`. On success: toast "Alert created: AAPL above $150.00", clears inputs, refreshes list. On error: toast with error message.
2. **Active Alerts card** — `rounded-lg border border-border bg-[var(--surface)]`:
   - Header: `Clock` icon + "Active Alerts ({count})".
   - Column headers row (tracked-caps 10px): Symbol · Condition · Target · Status · Date.
   - Scrollable (`max-h-[400px]`) list of AlertRow components.
   - Empty state: `AlertTriangle` icon + "No active alerts" + "Create one above to get started".
3. **Triggered History card** (only if `triggeredAlerts.length > 0`):
   - Header: `CheckCircle2` chartreuse icon + "Triggered History ({count})".
   - Same column headers.
   - Scrollable (`max-h-[300px]`) list — rows rendered with 60% opacity.

### AlertRow (per alert)
- Status icon left: `CheckCircle2` chartreuse for triggered, `Clock` gold for active.
- Symbol: sans 14px semibold tabular-nums.
- Condition: `Badge` with `ArrowUp`/`ArrowDown` icon.
- Target: `$XXX.XX` mono tabular-nums.
- Status: chartreuse "Triggered" or gold "Active".
- Date: muted 12px, either "Triggered {formatDate}" or "Created {formatDate}".
- Delete button: `Trash2` icon, hover coral. `Loader2` spinner while deleting.

### Typography roles
- Page title: Display md italic serif "Alerts & triggers".
- Form labels: tracked-caps 10px `text-muted-foreground`.
- Values: sans 14px; prices mono.
- Column headers: tracked-caps 10px `text-muted-foreground`.

### Palette check
- `var(--surface)` + `var(--panel)` — known undefined tokens (may render transparent).
- Chartreuse for "Triggered"/"Above"; coral for "Below"/"Delete hover".
- No red/green classic.
- No raw hex in the page file.

## Mobile (<640px)
- Form grid collapses from 4-col to 1-col.
- Delete-All confirmation popover stays `min-w-[240px]` absolute-positioned below its trigger.

## Interactive elements

### Symbol / Price inputs + Condition toggle
- Controlled. Symbol uppercased on submit; price parsed to float.
- Validation: empty symbol or non-positive price → toast "Enter a valid symbol and price" (error).

### Create Alert button
- While submitting: `Loader2` spinner replaces label.

### Delete one alert
- Confirmation: none — single-row delete is immediate. Shows spinner while in-flight.
- Toast on success: "Alert deleted".

### "Clear Triggered" button
- Only visible when triggered alerts exist. Bulk-deletes all triggered.
- Toast: "Cleared N triggered alert(s)" or error summary.

### "Delete All" button
- Popover confirm: "Delete all alerts?" with description "This will permanently delete N alerts. This action cannot be undone." Cancel + destructive Delete All buttons.
- Bulk-deletes; toast on completion.

## Expected states

| State | Render |
|---|---|
| **Loading** | 3 placeholder rows with animate-pulse. |
| **No alerts** | Form card + Active Alerts card empty-state (AlertTriangle + hint). No Triggered History. |
| **Alerts exist, none triggered** | Active list populated; Triggered History omitted. |
| **Some triggered** | Both cards visible; Triggered rows at 60% opacity. |
| **API 404 / offline** | Fetch resolves with empty `data`; shows same empty state (no error toast). |

## Edge cases
- **Symbol lowercase:** always uppercased on submit (`sym = symbol.trim().toUpperCase()`).
- **Invalid price:** NaN or ≤0 → error toast, no API call.
- **Network failure on create:** error toast with `err?.message ?? "Failed to create alert"`.
- **Bulk-delete partial failure:** toast summarizes failure count.

## What must NOT happen
- No confirmation dialog for single-row delete (intentional).
- No fake alerts.
- No red/green outside the `--up`/`--down` token set.

## SEO / meta
Inherits root.

## Accessibility (WCAG 2.1 AA)
- Form has `<label htmlFor>` for each input.
- Condition segmented control: two real `<button>` elements (missing `role="radio"` inside a `role="radiogroup"` — a11y gap).
- Delete button has `aria-label="Delete alert for {symbol}"`.
- Toasts are `role="alert"` via the Toast system.
- Focus rings on all inputs, buttons.
- Color contrast: chartreuse/coral tints ≈ 4.5:1+ (AA).
