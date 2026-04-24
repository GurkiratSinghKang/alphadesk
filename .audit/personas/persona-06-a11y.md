# Persona 6 — Accessibility User

**Profile:** Screen reader + keyboard user. Runs WCAG 2.1 AA expectations on every page.

## Bugs found

### P1-A11Y-1: Desk page has no `<h1>`
- `document.querySelectorAll('h1').length === 0` on `/`.
- Screen readers rely on heading structure to orient. The serif "SPY" in the chart header and the sidebar "Strategies" are styled like headings but are not marked up as one.
- **Fix:** Add a visually-hidden `<h1>Trading desk</h1>` at the top of the main region, or promote the symbol name to h1.

### P1-A11Y-2: "Ask anything…" AI input has no accessible name
- `<input placeholder="Ask anything..." type="text">` — no `aria-label`, no `<label for>`, no wrapping `<label>`. Only a placeholder, which **is not a label** under WCAG 2.1 SC 3.3.2 / 4.1.2.
- **Fix:** Add `aria-label="Ask Claude a question"` or wrap with a label.

### P1-A11Y-3: Focus styles appear to be reset (no default outline on buttons)
- Sampled button's `:focus-visible` computed style showed empty `outline` and `box-shadow` strings. If the app relies on Tailwind's `focus-visible:ring` and the class is missing on some components, keyboard users can't see where they are.
- **Fix:** Audit `button`, `a`, and interactive divs for consistent `focus-visible` rings.

### P1-A11Y-4: Tab navigation visits nav items and then every one of the 13 strategy rows before reaching the order ticket
- 13 strategy list buttons are all tab-stops. A keyboard scalper reaching the `Qty` field has to press Tab ~20 times after the skip link.
- **Fix:** Mark the strategy list as a `role="tablist"` or a grid with arrow-key navigation rather than linear tabbing, or offer a "Jump to order ticket" landmark.

### P1-A11Y-5: Notification bell and theme toggle icons have no visible focus label
- The icon-only buttons on the analytics-shell (bell with `2` badge, theme toggle) are tab-reachable but their purpose is icon-only; at minimum the bell should announce "2 notifications" via `aria-label`.
- (Note: on inspection `aria-label="Notifications"` exists on the bell — but the badge count is not read. Consider `aria-label={`Notifications (${count})`}`.)

### P2-A11Y-6: Status bar time text is 11px
- `21:16:03 ET · Sun, Apr 19` rendered at `font-size: 11px`. Small but passes contrast. Low-vision users at default zoom will struggle — most apps use a 12px floor.

### P2-A11Y-7: BUY / SELL toggle is built from two `<button role="radio">` elements
- The OrderBar radio group exists but it's not wrapped with `role="radiogroup"` + `aria-label="Side"`. Screen readers announce "Buy button, Sell button" without grouping context.

### P2-A11Y-8: Live-region toasts (e.g., "Enter a valid symbol and price") are rendered but no `role="status"` / `aria-live` confirmed
- Only 2 `aria-live` regions detected on the page. The validation toast I triggered on `/alerts` should route through an `aria-live="polite"` region so screen readers read the error.
