# Global UX Infrastructure — Design Spec

Sub-project 4 of the AlphaDesk UI/UX overhaul. Builds shared infrastructure that improves every page: typography, toasts, loading states, keyboard shortcuts, TopBar layout, and empty-state guidance.

## Implementation Order

1. Typography Scale
2. Toast System
3. Progressive Loading States
4. Keyboard Shortcuts
5. TopBar Redesign
6. Empty-State Hints

Each step is independently deployable. Later steps build on earlier ones (toasts use typography tokens; TopBar uses the status strip; empty states use hint copy with dimmer label color).

---

## 1. Typography Scale

Global CSS token system in `globals.css`. No component-level changes — just CSS variables and utility classes.

### The Scale

| Level | Size | Weight | Color | Letter-spacing | Use |
|-------|------|--------|-------|----------------|-----|
| Display | 36px | 700 | `#e2e2ea` | `-0.03em` | Portfolio value, page hero numbers |
| Title | 15-20px | 500-600 | `#e2e2ea` | `-0.01em` | Section values, strategy returns, prices |
| Body | 12-13px | 400-500 | `#e2e2ea` | normal | Content text, table cells |
| Label | 10-11px | 500-600 | `#555555` | `0.08em` | Section headers, uppercase labels, hints |

### CSS Classes

```css
.text-display { font-size: 36px; font-weight: 700; letter-spacing: -0.03em; color: var(--foreground); }
.text-title   { font-size: 15px; font-weight: 500; color: var(--foreground); letter-spacing: -0.01em; }
.text-body    { font-size: 13px; font-weight: 400; color: var(--foreground); }
.text-label   { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #555; }
.text-secondary { opacity: 0.65; }
```

### Changes from Current

- Labels dim from `#71717a` to `#555555`
- Display numbers get `-0.03em` letter-spacing
- Secondary values (percentages, subtotals) get `opacity: 0.65`
- Existing `text-muted-foreground` stays for backward compat but new code uses `.text-label`

### Files

- `frontend/src/app/globals.css` — add utility classes and update `--muted-foreground` variable

---

## 2. Toast System

React context provider + hook that renders action toasts and persists them to the Alerts store.

### Architecture

```
ToastProvider (wraps root layout)
  └── ToastContainer (fixed bottom-right, renders toast stack)
        └── ToastItem[] (individual toasts)

useToast() hook → { toast, dismiss }
  └── Calls ToastProvider context to add toast
  └── Also calls useAlertsStore.addAlert() for persistence
```

### Toast Types

| Type | Accent Color | Icon | Example |
|------|-------------|------|---------|
| `success` | `var(--profit)` green | CheckCircle | "Strategy paused" |
| `error` | `var(--loss)` red | AlertCircle | "Order rejected" |
| `info` | `var(--primary)` blue | Info | "Pipeline completed" |
| `warning` | amber `#f59e0b` | AlertTriangle | "Risk limit approaching" |

### Behavior

- Slides up from bottom-right corner
- Auto-dismisses after 5 seconds (configurable per toast)
- Optional action button (label + onClick callback)
- Max 3 visible simultaneously; older toasts collapse upward
- Each toast persists to `useAlertsStore.addAlert()` so missed toasts appear in the Alerts bell
- Dismiss on click or via dismiss button
- 200ms slide-in animation, 150ms fade-out

### API

```tsx
const { toast } = useToast();

// Simple
toast({ type: "success", message: "Strategy paused" });

// With action
toast({
  type: "info",
  message: "Order placed: Buy 10 AAPL @ $260.43",
  action: { label: "Undo", onClick: () => cancelOrder(orderId) },
  duration: 8000,
});
```

### Files

- `frontend/src/components/ui/toast.tsx` — ToastProvider, ToastContainer, ToastItem components
- `frontend/src/hooks/useToast.ts` — hook wrapping context + alerts store integration
- `frontend/src/app/layout.tsx` — wrap children with `<ToastProvider>`

---

## 3. Progressive Loading States

Real layout from frame 1 with placeholder values that fill in as data arrives. No spinners, no shimmer, no layout shift.

### Placeholder Formats

| Data Type | Placeholder | Style |
|-----------|------------|-------|
| Currency | `$--.--` | color: `#555`, tabular-nums |
| Percentage | `--.-%` | color: `#555`, tabular-nums |
| Text/name | `---` | color: `#555` |
| Integer | `--` | color: `#555`, tabular-nums |
| Chart/curve | Flat gray horizontal line at vertical midpoint | stroke: `#2a2a3e` |
| Score gauge | Empty ring outline, `--` in center | stroke: `var(--border)` |
| Table rows | 3 ghost rows with `---` in each cell | same row height as real rows |

### Placeholder Component

```tsx
// src/components/ui/placeholder.tsx
interface PlaceholderProps {
  value: number | string | null | undefined;
  format: "currency" | "percent" | "text" | "integer";
  className?: string;
}

function Placeholder({ value, format, className }: PlaceholderProps) {
  if (value == null) {
    const placeholder = { currency: "$--.--", percent: "--.-%", text: "---", integer: "--" }[format];
    return <span className={cn("text-[#555] tabular-nums transition-opacity duration-200", className)}>{placeholder}</span>;
  }
  // Format and render real value with fade-in
  return <span className={cn("animate-in fade-in duration-200", className)}>{formatted}</span>;
}
```

### Application Points

- Dashboard: portfolio value, day P&L, indices prices, strategy return percentages, position prices, calendar cells
- Trade: watchlist prices/changes, analysis scores, options chain cells
- Pipeline: position P&L values, performance card numbers
- Strategy detail: metric card values, equity curve

### Files

- `frontend/src/components/ui/placeholder.tsx` — Placeholder component with formatters
- Incremental edits to dashboard, trade, pipeline, and strategy pages to wrap data values

---

## 4. Keyboard Shortcuts

Lightweight shortcut engine with chord support, localStorage config, and a `?` help overlay.

### Architecture

```
useKeyboardShortcuts() hook
  ├── Reads bindings from localStorage key "alphadesk:keybindings"
  ├── Falls back to DEFAULT_BINDINGS
  ├── Registers keydown listener on document
  ├── Supports single keys ("?") and chords ("g d" within 500ms)
  └── Maps action IDs to handler functions

ShortcutOverlay component
  └── Full-screen semi-transparent modal
  └── Grouped grid of shortcuts with <kbd> badges
  └── Triggered by "?" key, dismissed by Escape
```

### Default Bindings

| Key | Action ID | Description | Group |
|-----|-----------|-------------|-------|
| `?` | `toggle:shortcuts` | Toggle shortcut overlay | Global |
| `Ctrl+k` | `toggle:command-palette` | Command palette (existing) | Global |
| `/` | `focus:search` | Focus symbol search | Global |
| `Escape` | `dismiss` | Close overlay / deselect | Global |
| `g d` | `navigate:dashboard` | Go to Dashboard | Navigation |
| `g t` | `navigate:trade` | Go to Trade | Navigation |
| `g p` | `navigate:pipeline` | Go to Pipeline | Navigation |
| `1` | `chart:timeframe:1m` | 1-minute chart | Chart |
| `2` | `chart:timeframe:5m` | 5-minute chart | Chart |
| `3` | `chart:timeframe:15m` | 15-minute chart | Chart |
| `4` | `chart:timeframe:1H` | 1-hour chart | Chart |
| `5` | `chart:timeframe:D` | Daily chart | Chart |
| `6` | `chart:timeframe:W` | Weekly chart | Chart |
| `j` | `watchlist:next` | Next watchlist item | Watchlist |
| `k` | `watchlist:prev` | Previous watchlist item | Watchlist |

### localStorage Schema

Key: `"alphadesk:keybindings"`

```json
{
  "?": "toggle:shortcuts",
  "g d": "navigate:dashboard",
  "g t": "navigate:trade",
  "g p": "navigate:pipeline",
  "1": "chart:timeframe:1m",
  "j": "watchlist:next",
  "k": "watchlist:prev"
}
```

Users customize by editing this in DevTools → Application → localStorage. Action IDs are fixed strings mapped to handler functions in the hook.

### Chord Detection

The engine tracks the last keypress and timestamp. If a second key arrives within 500ms, it checks for a chord match (e.g., `g` then `d` = `"g d"`). If no chord matches, the single key is evaluated independently.

### Shortcut Overlay

- Full-screen with `bg-black/60` backdrop
- Centered card (~600px wide) with grouped sections: Global, Navigation, Chart, Watchlist
- Each row: `<kbd>` styled key badge + action description
- Dismisses on `Escape` or clicking backdrop

### Guard Rails

- Shortcuts are suppressed when focus is inside `<input>`, `<textarea>`, or `[contenteditable]`
- Chords reset if the user types in a non-matching sequence

### Files

- `frontend/src/hooks/useKeyboardShortcuts.ts` — engine, defaults, chord logic
- `frontend/src/components/ui/shortcut-overlay.tsx` — `?` modal component
- `frontend/src/app/(dashboard)/layout.tsx` — register the hook

---

## 5. TopBar Redesign

Split current 48px single row into a 44px navigation bar + 28px status strip (72px total).

### Row 1 — Navigation Bar (44px)

```
LEFT:   [⚡ AlphaDesk]  [Dashboard] [Trade] [Pipeline]
CENTER: [━━━━━ Search symbols, commands... ━━━━━ Ctrl+K]
RIGHT:  [🔔 Alerts]  [👤 Profile dropdown]
```

- Nav tabs: same style, slightly larger hit areas (py-2 instead of py-1.5)
- Search bar: centered, wider (~480px), same design
- Alerts bell: moved from far-right group, keeps badge count
- Profile avatar: new element, shows first letter of username in a circle. Click opens dropdown menu containing:
  - Broker connection status + switch
  - Trading mode toggle (Paper/Live)
  - Settings
  - Keyboard shortcuts (`?`)
  - Logout

### Row 2 — Status Strip (28px)

```
P&L: -$54.18 (-0.05%)  │  Bull - Low Volatility  │  VIX 16.5 ↓3.2%  │  ● LIVE  │  Alpaca (Paper)  PAPER
```

- Background: `var(--background)` (darker than nav row's `var(--surface)`)
- Text: 11px, `#555` labels with brighter values
- Items separated by `│` dividers (border-right on each item)
- P&L value uses glow effect (existing `.glow-profit` / `.glow-loss`)
- Regime badge inline (no outline border, just colored text)
- LIVE indicator: pulsing green dot (existing animation)
- Mode badge: inline `PAPER` or `LIVE` text with colored background
- No interactive elements in this row except mode badge click (confirms switch)

### Component Structure

```
TopBar.tsx (deleted / replaced)
  → NavBar.tsx — Row 1 (logo, tabs, search, alerts, profile)
  → StatusStrip.tsx — Row 2 (P&L, regime, VIX, connection, broker/mode)
  → ProfileMenu.tsx — dropdown (broker, mode, settings, shortcuts, logout)
```

### Layout Change

```tsx
// (dashboard)/layout.tsx
<div className="flex h-screen flex-col overflow-hidden">
  <NavBar />
  <StatusStrip />
  <main className="flex-1 min-h-0">{children}</main>
  <CommandPalette />
</div>
```

### Files

- `frontend/src/components/layout/NavBar.tsx` — new, Row 1
- `frontend/src/components/layout/StatusStrip.tsx` — new, Row 2
- `frontend/src/components/layout/ProfileMenu.tsx` — new, dropdown
- `frontend/src/components/layout/TopBar.tsx` — delete (replaced by NavBar + StatusStrip)
- `frontend/src/app/(dashboard)/layout.tsx` — update to render both rows

---

## 6. Empty-State Hints

Contextual inline guidance in every section that can be empty. Three elements per empty state: icon, what-line, how-line with optional action link.

### Empty States

| Section | What Line | How Line | Action |
|---------|-----------|----------|--------|
| Activity Feed (0 events) | "No activity yet today" | "Events appear when the pipeline runs" | "Run Pipeline →" link to `/pipeline` |
| Positions (0 holdings) | "No open positions" | "The pipeline opens trades during market hours" | None |
| Headlines (0 articles) | Keep Account Overview fallback | Add note: "Headlines appear when the market is open" | None |
| Strategy trades (0) | "No trades yet" | "This strategy will enter positions when its signals trigger" | "View Pipeline →" link |
| Pipeline today (no run) | "No run today" | Compact single line, not centered box | Inline "Run Now" button |
| Pipeline history (0) | "No history yet" | "History appears after the first automated run" | None |
| Metric cards (N/A) | Gray out entire card | Subtle "No data" text instead of large "N/A" | None |

### Style

- Icon: existing muted icon, `opacity: 0.3` (dimmer than current `0.4-0.5`)
- What-line: `.text-body` (13px, `#e2e2ea`)
- How-line: `.text-label` but without uppercase — 11px, `#555`
- Action link: 11px, `var(--primary)` blue, underline on hover

### Files

- `frontend/src/app/(dashboard)/page.tsx` — feed, positions, headlines
- `frontend/src/app/(dashboard)/pipeline/page.tsx` — today's run, history, metrics
- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx` — trades, metrics

---

## File Summary

### New Files (6)

| File | Purpose |
|------|---------|
| `src/components/ui/toast.tsx` | ToastProvider, ToastContainer, ToastItem |
| `src/hooks/useToast.ts` | Toast hook with alerts integration |
| `src/components/ui/placeholder.tsx` | Progressive loading placeholder component |
| `src/hooks/useKeyboardShortcuts.ts` | Shortcut engine with chord support |
| `src/components/ui/shortcut-overlay.tsx` | `?` keyboard shortcut modal |
| `src/components/layout/StatusStrip.tsx` | Status data strip (Row 2) |

### Modified Files (7)

| File | Changes |
|------|---------|
| `src/app/globals.css` | Typography utility classes, label color variable |
| `src/app/layout.tsx` | Wrap with ToastProvider |
| `src/app/(dashboard)/layout.tsx` | Render NavBar + StatusStrip, register shortcuts hook |
| `src/components/layout/TopBar.tsx` | Refactor into NavBar (Row 1) + ProfileMenu |
| `src/app/(dashboard)/page.tsx` | Empty-state hints, placeholder values, typography classes |
| `src/app/(dashboard)/pipeline/page.tsx` | Empty-state hints, placeholder values |
| `src/app/(dashboard)/strategies/[id]/page.tsx` | Empty-state hints, placeholder values |

### Deleted Files (0)

TopBar.tsx is refactored in-place into NavBar, not deleted (to preserve git history).
