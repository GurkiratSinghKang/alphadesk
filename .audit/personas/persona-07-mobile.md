# Persona 7 — Mobile User

**Profile:** Phone-first trader. iPhone 14 (390×844). Expects hamburger, bottom sheets, 44×44 touch targets.

> Note: the QA browser window resize wouldn't drop below 1470×690, so I couldn't render the breakpoint live. Findings below are from DOM inspection of the desktop layout + responsive-class review.

## Bugs found

### P1-MOB-1: 41 of 55 interactive targets are below 44×44 pt on the Desk
- `1D / 5D / 1M / 3M / 6M / YTD / 1Y / ALL` chart range pills are 31×23.
- Top nav links `Desk, Strategies, Analytics, Pipeline, Alerts` all 29px tall.
- The main footer status items (Build · dev · ⌘K · Commands) are even smaller.
- WCAG 2.1 SC 2.5.5 (AAA) suggests ≥ 44×44; Apple HIG enforces it for touch.

### P1-MOB-2: Skip-to-content link is rendered 1×1 px even on focus check
- Focusable skip link measured 1×1 at inspection. When a screen reader focuses it, it's technically visible but has zero target area for sighted keyboard users who might want to click it.

### P2-MOB-3: Desk has responsive classes (`hidden md:block` on sidebar) but positions panel uses fixed layout
- Sidebar correctly hides below `md`. Book/Positions right panel would stack? — couldn't verify live. But the main chart + order ticket use a complex grid that isn't obviously single-column-friendly.

### P2-MOB-4: Order ticket has many fields (STRATEGY, SIDE, SYMBOL, QTY, TYPE, PRICE, STOP) all in one row on desktop
- On a phone-width this would either horizontal-scroll or wrap chaotically. The "Place order" button would have smaller-than-44px tap area wrapped with its subtitle.
- **Fix:** Collapse into a card with stacked fields and a full-width primary button.

### P2-MOB-5: Command palette is ⌘K-only
- No visible "Open search" button on the Desk's desktop view, and unclear whether the analytics shell's header search is touch-accessible at phone width.

### P2-MOB-6: Ticker marquee scrolls horizontally across full width
- On a phone the auto-scrolling marquee of prices will be touch-hostile (can't read while scrolling, can't pause).
- **Fix:** Pause on touch; shrink to a single swipeable card below `md`.
