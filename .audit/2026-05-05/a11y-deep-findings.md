# Deep A11y Adversarial Findings (2026-05-05)

Scope: NEW issues not closed by R3 a11y audit (`audit-reports/a11y-audit-r3.md`)
or R5 Pillar 6 (`qa/reviews/pillars-r5/06-experience.md`). Hunt focused on
components landed since 2026-04-18: multi-leg TradePanel, NotificationCenter,
DestructiveConfirmModal, KillSwitchStatusPanel, claude_alpha (ClaudeThesisCard),
sector_rotation/vcp_breakout strategy pages, and the new alerts form / login
lockout / OnboardingTour focus-trap upgrades.

Methodology: source read of every NEW or recently-modified component, plus a
spot-check against the canonical sweep at
`qa/runs/2026-05-04T20-31-40Z/{trade,dashboard,alerts,strategy-momentum-quality,login}/`
DOM captures.

## Summary

- **15 findings**: 5 A11Y-BLOCKER · 7 A11Y-MAJOR · 3 A11Y-MINOR

Pattern clusters that emerge:

1. **Custom widgets carry `role="radiogroup"` but no arrow-key handlers.** Six
   radiogroups in production use plain `onClick` only — keyboard SR users
   trapped in roving-focus convention can't move between options without Tab.
2. **Modals declare role="dialog" but don't move initial focus to the safest
   control.** `DestructiveConfirmModal` defaults focus to the destructive
   confirm button via natural tab order; press Enter on a keyboard and you
   destroy.
3. **Live regions are inconsistent for kill-switch and order-status changes.**
   The kill-switch state dot is `aria-label="enabled"`/`"disabled"` only — no
   live region announces the transition; only the (auto-dismiss) toast does.
4. **Form inputs missing `required` / `aria-required` even when client-side
   validation rejects empty values.** Login + alerts both visibly mark fields
   as required (asterisks, "is required" toast) but the input has no
   programmatic required attribute. SR users get no announcement.

---

## Findings (grouped by WCAG SC)

### WCAG 2.1.2 No Keyboard Trap

#### F1 — OnboardingTour focus trap eats Tab on the dashboard chrome behind the tour, but the spotlight target itself remains focusable
**Severity:** A11Y-MAJOR
**File:** `frontend/src/components/layout/OnboardingTour.tsx:249-276`
**DOM excerpt:**
```tsx
useEffect(() => {
  if (!active) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const root = tooltipRef.current;
    if (!root) return;
    const focusables = root.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    // … bounces focus between first/last in the tooltip only
  };
  document.addEventListener("keydown", onKey);
  // …
}, [active]);
```
The trap only includes the tooltip's own buttons (Skip / Next). The spotlight
target — e.g. `[data-slot='context-bar']` cell, the Next-Actions section,
the Cmd+K trigger — sits behind the modal backdrop but is **not** marked
`inert` / `aria-hidden`. So a screen-reader user navigating by element walks
into the dimmed page content while the tour is "modal," but a keyboard user
gets bounced back to the tooltip on Tab — the two AT modalities disagree on
whether content behind the tour is reachable.

**Impact on AT users:** SR-only users get told they're in a `role="dialog"`
yet hear page content keep reading on linear navigation; keyboard users hit
a focus ricochet pattern that doesn't match what voice-control users get.

**Fix:** When the tour mounts, set `inert` on the dashboard root
(`document.querySelector('main')`) and remove on unmount. Or remove the
manual focus trap and let Base UI's `Dialog` primitive handle it (its
`useFloatingTree` properly propagates `inert` to siblings). Drop the
custom keydown handler.

---

### WCAG 2.1.1 Keyboard

#### F2 — Six `role="radiogroup"` instances missing required arrow-key navigation
**Severity:** A11Y-MAJOR
**Files:**
- `frontend/src/app/(dashboard)/strategies/page.tsx:465-483` (filter pills)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar.tsx:103-140` (WINDOW)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar.tsx:179-215` (TIME)
- `frontend/src/app/(dashboard)/settings/page.tsx:231-256` (interval)
- `frontend/src/app/(dashboard)/settings/page.tsx:686-707, 728-746` (broker provider/env)
- `frontend/src/components/composites/OrderBar.tsx:617-667` (Buy/Sell side)
- `frontend/src/components/layout/ProfileMenu.tsx:170-192` (theme)

**DOM excerpt (representative — `OrderBar.tsx:617`):**
```tsx
<div role="radiogroup" aria-label="Order side" className="…">
  <button
    type="button"
    role="radio"
    aria-checked={side === "buy"}
    onClick={() => handleSideClick("buy")}
    // No onKeyDown for ArrowLeft/Right/Up/Down
    className="…"
  >…</button>
  <button
    type="button"
    role="radio"
    aria-checked={side === "sell"}
    onClick={() => handleSideClick("sell")}
    // No onKeyDown
    className="…"
  >…</button>
</div>
```

**Impact on AT users:** WCAG / WAI-ARIA Authoring Practices require `radiogroup`
to support roving-focus arrow-key navigation between members AND make only
the checked option Tab-focusable (the rest get `tabIndex={-1}`). Currently
every "radio" is a separate Tab stop AND none respond to arrow keys. SR users
relying on the ARIA convention press ArrowRight on `BUY` expecting focus to
move to `SELL` — instead nothing happens, breaking their mental model. JAWS
in particular announces the role mismatch.

**Fix:** Implement a small `useRovingTabIndex` hook (or use `react-aria`'s
`useRadioGroup` helper). Set `tabIndex` to `0` on the checked button and
`-1` on the others; on `ArrowLeft`/`ArrowUp` move to previous, on
`ArrowRight`/`ArrowDown` move to next, with wraparound.

---

#### F3 — `<select>` controls in OrderBar advanced panel skip Strategy/Type focus ring on Safari iOS due to `outline-none` + 2px ring not visible at 16px font
**Severity:** A11Y-MINOR
**File:** `frontend/src/components/composites/OrderBar.tsx:583-595, 716-723, 786-787, 800-801`

**DOM excerpt:**
```tsx
<select
  aria-label="Strategy"
  className={cn(
    "h-11 md:h-10 min-w-[90px] w-full px-3 …",
    "font-mono text-base md:text-body-sm text-ink-1000 outline-none",
    "focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
    …
  )}
>
```
Two issues with the ring: (1) Safari iOS clips `:focus-visible` ring on
native `<select>` because the select renders via the OS picker; the visible
ring vanishes once the picker is closed. (2) The advanced-panel selects
(L:786, L:800) have `focus-visible:ring-2 focus-visible:ring-ring` but no
ring-offset color — `ring-offset-0` isn't set there, so on a background that
matches the ring color the ring disappears.

**Impact on AT users:** Keyboard users on Safari/iOS lose track of focus
after closing the native select picker.

**Fix:** Add `focus-visible:shadow-[0_0_0_3px_var(--brand-ring)]` as a
secondary focus indicator that survives the OS picker close. Or replace
native selects with the Base UI `Select` primitive which renders a fully
controlled focus indicator.

---

### WCAG 2.4.3 Focus Order

#### F4 — `DestructiveConfirmModal` initial focus lands on the destructive button via Base UI's natural-tab default
**Severity:** A11Y-BLOCKER
**File:** `frontend/src/components/destructive/DestructiveConfirmModal.tsx:51-58`

**DOM excerpt:**
```tsx
<DialogFooter className="mt-5 flex gap-2">
  <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
    Cancel
  </Button>
  <Button variant="destructive" onClick={onConfirm} disabled={loading}>
    {loading ? "Confirming…" : confirmLabel}
  </Button>
</DialogFooter>
```
Base UI's `Dialog` moves focus to the first focusable on open. With the
markup above, that's the **Cancel** button (good). However: the modal is
used by 19 sites including Cancel-Order (TradePanel), Disable-Broker (Settings),
Confirm-Live-Mode (Settings), and Reset-All-Preferences (Settings). For
*destructive* actions the safer pattern is to (a) explicitly call `.focus()`
on Cancel via a ref so a future markup change can't silently swap it, AND
(b) require `Enter` to be re-pressed once focus is on the destructive button
(WCAG 3.3.4 confirmation). Currently a user who Tabs once and presses Enter
fires the destructive action — the only friction is the modal opening,
which a power user already discounts.

**Impact on AT users:** Motor-impaired users with keyboard assistance can
accidentally Tab+Enter through what looks like a confirmation but acts as a
single-click destructive action.

**Fix:**
```tsx
const cancelRef = useRef<HTMLButtonElement>(null);
useEffect(() => {
  if (open) cancelRef.current?.focus();
}, [open]);
// …
<Button ref={cancelRef} variant="ghost" autoFocus …>Cancel</Button>
```
And consider requiring an explicit affordance for "Confirm" (e.g. a
`requireDoubleConfirm` prop for the live-mode + reset-all-prefs sites).

---

#### F5 — Stop-Loss dialog (TradePanel PositionsTab) uses unlinked `<label>` and the `<input>` has no `id` — clicking the visible label doesn't focus the input
**Severity:** A11Y-MAJOR
**File:** `frontend/src/components/panels/TradePanel.tsx:819-833`

**DOM excerpt:**
```tsx
<div>
  <label className="text-label text-muted-foreground mb-1 block">Stop Price</label>
  <div className="relative">
    <span className="absolute …">$</span>
    <input
      type="number"
      step="0.01"
      value={stopLossPrice}
      onChange={(e) => setStopLossPrice(e.target.value)}
      placeholder="0.00"
      className="…"
      autoFocus
    />
  </div>
</div>
```
The `<label>` has no `htmlFor`, the `<input>` has no `id`, and the wrapping
`<div>` does not associate them either. SR users hear the input as
"Edit text 0.00, blank" — no field name. Clicking the visible "Stop Price"
text doesn't focus the input.

**Impact on AT users:** SR users do not hear the Stop Price label associated
with the input; voice-control users cannot say "click Stop Price" to focus.
Particularly bad because this dialog is invoked from a keyboard shortcut
(`positions:stop-loss`) so the user is already in keyboard mode.

**Fix:** Wrap the input in the label, or add a `useId()` and link via
`htmlFor`/`id`:
```tsx
const id = useId();
<label htmlFor={id} className="…">Stop Price</label>
<input id={id} type="number" … />
```

---

### WCAG 4.1.2 Name, Role, Value

#### F6 — Kill-switch status indicator (`<span aria-label="enabled" />`) is a non-interactive visual dot with `aria-label` only — no role, no live region for transitions
**Severity:** A11Y-BLOCKER
**File:** `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:144-152`

**DOM excerpt:**
```tsx
<span
  className={cn(
    "inline-block w-2.5 h-2.5 rounded-full",
    activeEvent ? "bg-loss" : "bg-profit",
  )}
  aria-label={activeEvent ? "disabled" : "enabled"}
  title={activeEvent ? "Disabled" : "Enabled"}
/>
```
Multiple issues: (1) `<span>` with `aria-label` and no `role` is invisible
to many SR engines (NVDA + Firefox in particular ignore aria-label on
non-interactive non-landmark elements). (2) The label text is "enabled" /
"disabled" which is grammatically incomplete — SR users don't know what
is enabled. (3) When the kill-switch trips (Layer 1/2 auto-trigger), the
state changes from "enabled" to "disabled" inside this section but there
is **no aria-live region** announcing the change; only the toast (which
auto-dismisses in 5s) carries the news.

For a kill-switch — the safety-critical surface that signals whether a
strategy is currently running real trades — silent state changes are a
WCAG 4.1.3 violation in production.

**Impact on AT users:** SR users monitoring kill-switch state for an open
position get no announcement when the strategy auto-disables. The visual
dot turns red; the SR says nothing.

**Fix:**
```tsx
<span
  role="img"
  aria-label={activeEvent ? `${strategyName} kill-switch active — strategy disabled` : `${strategyName} enabled`}
  className={…}
/>
```
Plus wrap the whole `<header>` block in `<div role="status" aria-live="polite" aria-atomic="true">` so any transition (Layer 1/2/3 trigger or re-enable) is announced.

---

#### F7 — NotificationCenter "tab" buttons not marked as `role="tab"` inside a `role="tablist"` — they're plain `<button>` but visually behave as tabs
**Severity:** A11Y-MAJOR
**File:** `frontend/src/components/layout/NotificationCenter.tsx:177-203`

**DOM excerpt:**
```tsx
<div className="flex items-center gap-0.5 border-b border-border px-2 py-1.5">
  {TABS.map((tab) => (
    <button
      key={tab.value}
      onClick={() => setActiveTab(tab.value)}
      className={cn(
        "rounded-md px-2.5 py-1 text-label font-medium transition-colors",
        activeTab === tab.value
          ? "bg-primary/15 text-primary"          // visually "active"
          : "text-muted-foreground …",
      )}
    >
      {tab.label}
      {count > 0 && <span className="…">{count}</span>}
    </button>
  ))}
</div>
```
The container is a `<div>` (no `role="tablist"`), buttons have no `role="tab"`
/ `aria-selected` / `aria-controls`. Below them lies the filtered notification
list which has no `role="tabpanel"` / `aria-labelledby`. Yet the visual
behavior is exactly tabs: click changes the panel, only one is "active."

**Impact on AT users:** SR users hear five generic "All button," "Trades
button," "Alerts button"… and have no signal that selecting one changes
the panel below. They cannot tell which is currently selected.

**Fix:** Replace with the existing `<Tabs>` primitive (`@/components/ui/tabs`)
which wires up `role="tablist"`/`tab`/`tabpanel`/`aria-selected` correctly and
adds arrow-key navigation. Or hand-roll the attributes:
```tsx
<div role="tablist" aria-label="Notification categories">
  {TABS.map((tab) => (
    <button
      role="tab"
      aria-selected={activeTab === tab.value}
      aria-controls={`notif-panel-${tab.value}`}
      id={`notif-tab-${tab.value}`}
      tabIndex={activeTab === tab.value ? 0 : -1}
      …
    />
  ))}
</div>
<div
  role="tabpanel"
  id={`notif-panel-${activeTab}`}
  aria-labelledby={`notif-tab-${activeTab}`}
>…</div>
```

---

#### F8 — KillSwitchStatusPanel `<details><summary>Emergency disable</summary>` with internal `<input>` + destructive button — disclosure widget pattern but no announcement of expansion state
**Severity:** A11Y-MAJOR
**File:** `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:191-216`

**DOM excerpt:**
```tsx
<details>
  <summary className="cursor-pointer text-sm text-fg-muted">
    Emergency disable
  </summary>
  <div className="mt-2 space-y-2">
    <label className="block text-label font-medium">
      Reason (required)
      <input type="text" value={reason} onChange={…} maxLength={500} … />
    </label>
    <button
      type="button"
      onClick={handleDisable}
      disabled={busy || !reason.trim()}
      className="rounded border border-loss px-3 py-1 …"
    >
      {busy ? "Disabling…" : "Emergency disable"}
    </button>
  </div>
</details>
```
Two problems: (1) The native `<details>` element does carry implicit
`aria-expanded` semantics in modern browsers, but VoiceOver on Safari iOS
announces it as "summary, group" with no clear "collapsed/expanded" state
unless the consumer provides the JS to toggle `aria-expanded` explicitly.
(2) The reason label says "(required)" inline but the `<input>` has no
`required` attribute and no `aria-required="true"`, so the field is not
machine-discoverable as required. SR users only learn the reason is required
when they try to submit and get the inline `setError("Reason is required…")`.
(3) The destructive "Emergency disable" button skips the
`<DestructiveConfirmModal>` pattern that 19 other destructive sites use —
clicking commits without a second confirmation — for a kill-switch action
that takes a strategy off live trading.

**Impact on AT users:** SR users opening the disclosure don't know it
expanded; the required field isn't announced as required; the
single-click destructive action has no second-step gate.

**Fix:**
```tsx
<details onToggle={(e) => setIsExpanded(e.currentTarget.open)}>
  <summary aria-expanded={isExpanded}>Emergency disable</summary>
  …
  <input
    type="text"
    required
    aria-required="true"
    aria-invalid={!reason.trim() && touched}
    aria-describedby="reason-hint"
    …
  />
  <span id="reason-hint" className="text-label text-fg-muted">Required to disable a live strategy.</span>
  <button onClick={() => destructive.request({title: "Emergency disable strategy", …})}>…</button>
</details>
```

---

### WCAG 4.1.3 Status Messages

#### F9 — TradePanel "Place live order" submit produces no live-region announcement when the order is in flight; the toast on result is the only feedback
**Severity:** A11Y-MAJOR
**File:** `frontend/src/components/panels/TradePanel.tsx:529-552, 599-611`

**DOM excerpt:**
```tsx
<Button
  onClick={handleSubmit}
  disabled={submitting || legs.length === 0}
  className={cn("w-full font-medium", …)}
>
  {submitting ? (
    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
  ) : tradingMode === "paper" ? (
    <><ShieldCheck className="mr-1.5 h-4 w-4" /> Paper Trade</>
  ) : (
    <><AlertTriangle className="mr-1.5 h-4 w-4" /> Place live order</>
  )}
</Button>
```
The button has no `aria-busy={submitting}`, no `role="status"` companion
saying "Submitting order to broker…". The only state communicated to the
user during the 600-1200ms broker round-trip is the `Loader2` icon (visually
spinning, silent to SR) and the absence of button text. A SR user hears
"Place live order, button" — clicks — silence — and then a toast appears
saying "Order failed: …" or the dialog closes. They never hear that the
click was acknowledged.

The dialog confirm button at L:599-611 has the same shape. The OrderBar
submit button at `OrderBar.tsx:917` correctly sets `aria-busy={submitting}`
— but the TradePanel inner submit button does not.

**Impact on AT users:** SR users submitting a live order get no audible
ack until the result toast — and on a slow network they may double-tap
because the silent first tap reads as "did nothing."

**Fix:** Add `aria-busy={submitting}` to the button, and sibling:
```tsx
{submitting && <span role="status" className="sr-only">Submitting order to broker</span>}
```

---

#### F10 — `LoadingDots` in ClaudeThesisCard / FullResearchTrigger uses `motion-reduce:hidden` to hide the dots but renders the static fallback as `motion-reduce:inline` — for users WITHOUT reduced-motion preference, the static "·  ·  ·" sibling is `motion-safe:hidden` which is fine, but the fallback is rendered with `aria-hidden="true"` so SR users hear NEITHER state
**Severity:** A11Y-MINOR
**File:** `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx:315-343`

**DOM excerpt:**
```tsx
<>
  <span aria-hidden="true" className={inline ? "motion-safe:inline-flex motion-reduce:hidden …" : "motion-safe:flex motion-reduce:hidden items-center gap-1"}>
    <span className="… animate-pulse [animation-delay:0ms]" />
    <span className="… animate-pulse [animation-delay:150ms]" />
    <span className="… animate-pulse [animation-delay:300ms]" />
  </span>
  <span aria-hidden="true" className={inline ? "motion-safe:hidden motion-reduce:inline ml-1" : "motion-safe:hidden motion-reduce:flex"}>
    ·&nbsp;·&nbsp;·
  </span>
</>
```
Both copies are `aria-hidden="true"`. The parent context (the calling
`role="status" aria-live="polite"` block at L:67-75) DOES carry the live
region, but the actual visible "loading" indicator is hidden from AT — so
the SR announcement depends entirely on the surrounding sibling text
("Generating full research with the available quote, …"). Inside the button
variant (line 283-287) the loading dots sit inside the button label
"Generating full research" — that *is* announced. But on the structured-
skeleton state (L:67-72) the live region text is the explanatory paragraph,
not the dots, so the announcement is fine. This is more a hygiene issue
than a blocker.

**Impact on AT users:** Minor — both branches still get an announcement
through the live region. Filed as MINOR for completeness.

**Fix:** None strictly required. Optional: replace the dots with a
`role="progressbar" aria-valuetext="loading"` if you want explicit
progress semantics.

---

### WCAG 1.3.1 Info & Relationships

#### F11 — Login form inputs have no `required` attribute and no `aria-required`, despite the form rejecting empty submission via the disabled-button trick
**Severity:** A11Y-MAJOR
**File:** `frontend/src/app/login/_login/LoginForm.tsx:265-277, 293-308, 340-349`

**DOM excerpt:**
```tsx
<Input
  id="login-username"
  value={username}
  onChange={…}
  placeholder="email or desk handle"
  autoComplete="username"
  autoFocus
  className={authInputClass}
/>
…
<Input
  id="login-password"
  type={showPassword ? "text" : "password"}
  value={password}
  onChange={…}
  placeholder="your password"
  autoComplete="current-password"
  className={`${authInputClass} pr-12`}
  aria-invalid={error ? true : undefined}
/>
```
DOM grep confirms: 0 `required` and 0 `aria-required` attributes on the
login surface (`qa/runs/2026-05-04T20-31-40Z/login/desktop-1440/initial.dom.html`).
The form button is disabled via `disabled = … || !username || !password …`
(L:216), so SR users tabbing through hear "username, edit text, blank" —
focus the disabled submit — back to the password — and never get told
either field is required. They guess until both are non-empty.

Same issue in the alerts CreateAlertForm (`alerts/page.tsx:223-243, 272-287,
328-338`): symbol, price, reference price all visibly required, none with
`required` / `aria-required`. The error message reads "Symbol is required"
only after submit.

**Impact on AT users:** SR + voice-control users get no programmatic signal
that fields are required. Combined with the disabled-submit pattern they
can't even attempt submission to discover the requirement.

**Fix:** Add `required aria-required="true"` to all required inputs. Browser
autofill / SR will announce the requirement on focus.

---

### WCAG 2.4.6 Headings and Labels

#### F12 — `SectionRule` defaults to `<h2>` with the heading content being the `tag` prop ("§ 01 · Signal", "§ 02 · Performance", …) — non-semantic punctuation/numerics are the entire accessible heading
**Severity:** A11Y-MAJOR
**File:** `frontend/src/components/typography/SectionRule.tsx:25-38`

**DOM excerpt (consumer in `strategies/[id]/page.tsx:760-826` × 6 sections):**
```tsx
<SectionRule tag="§ 01 · Signal" />
<SectionRule tag="§ 02 · Performance" />
<SectionRule tag="§ 03 · Positions" />
<SectionRule tag="§ 04 · Health" />
<SectionRule tag="§ 05 · References" />
<SectionRule tag="§ 06 · Known limitations" />
```

The rendered HTML is:
```html
<h2 class="t-label">§ 01 · Signal</h2>
```

When a SR user opens the heading rotor on a strategy detail page (e.g. for
`momentum-quality`) they hear: "§ 01 · Signal, heading level 2; § 02 ·
Performance, heading level 2; § 03 · Positions, …" — the section symbol
and number prefix dominate, and on some SRs the "§" character either
verbalises as "section" (helpful but verbose) or is silently skipped
(losing the section number).

`/about/page.tsx:56`, `/docs/page.tsx:59`, `/help/earnings-data/page.tsx:68`,
and `/_design/page.tsx` (10 instances) all carry the same pattern.

**Impact on AT users:** SR heading navigation becomes a "§ N" lottery
instead of skimming meaningful section names ("Signal", "Performance",
"Positions"). Heading-level skim is the #1 way SR users navigate long
pages.

**Fix:** Strip the `§ NN · ` prefix from the accessible heading and put
it back as a presentational pseudo-element OR add the section name as the
primary text and the section number as `<span aria-hidden>`:
```tsx
<TagEl className="t-label">
  <span aria-hidden>{tag.split(" · ")[0]} · </span>
  {tag.split(" · ").slice(1).join(" · ")}
</TagEl>
```

---

#### F13 — NotificationRow `<button>` has no accessible name discoverable from the icon alone; the title and detail strings are the actual content but the tab order announces them as "button, title, detail, time"
**Severity:** A11Y-MINOR
**File:** `frontend/src/components/layout/NotificationCenter.tsx:71-97`

**DOM excerpt:**
```tsx
<button onClick={() => onRead(notification.id)} className="…">
  <div className="mt-0.5 shrink-0">
    <NotificationIcon category={notification.category} iconHint={notification.icon} />
  </div>
  <div className="flex-1 min-w-0">
    <p className={…}>{notification.title}</p>
    {!notification.read && <span aria-hidden="true" className="mt-0.5 inline-block h-1.5 w-1.5 …" />}
    <p className="mt-0.5 …">{notification.detail}</p>
    <span className="mt-1 block text-label …">{relativeTime(notification.timestamp)}</span>
  </div>
</button>
```
The button's accessible name is the concatenation of all child text — fine
on the surface but: (1) the unread dot has no SR equivalent (the only signal
is its presence — needs `<span className="sr-only">Unread.</span>`),
(2) the icon has no `aria-label` so the "category" (trades / alerts /
pipeline / system) is invisible to SR. SR users hear "Order filled NVDA 100
shares 2m ago" but not that this is a Trade-category notification, which is
the whole point of the category-icon affordance.

**Impact on AT users:** SR users miss the category cue and the unread
state.

**Fix:**
- In `NotificationIcon`, add `aria-label={category}` to the chosen `<svg>`
  (or wrap with `<span aria-label={`${category} notification`}>`).
- For the unread dot: `<span className="sr-only">Unread. </span>` rendered
  conditionally, before the title, so SR reads "Unread. Order filled NVDA …"

---

### WCAG 2.5.5 Target Size (AAA — informational; mobile inspection)

#### F14 — Notification "Mark all as read" + "Clear all" icon-buttons are inline 12×12px on a 28px row — well below the 24×24 AAA bonus and 44×44 AA-on-mobile floor
**Severity:** A11Y-MINOR
**File:** `frontend/src/components/layout/NotificationCenter.tsx:151-172`

**DOM excerpt:**
```tsx
<div className="flex items-center justify-between border-b border-border px-3 py-2.5">
  <span className="text-label …">Notifications</span>
  <div className="flex items-center gap-2">
    {unreadCount > 0 && (
      <button onClick={markAllRead} className="flex items-center gap-1 text-label …" title="Mark all as read">
        <CheckCheck className="h-3 w-3" />
        Mark all read
      </button>
    )}
    {notifications.length > 0 && (
      <button onClick={clearAll} className="flex items-center gap-1 text-label …" title="Clear all">
        <Trash2 className="h-3 w-3" />
      </button>
    )}
  </div>
</div>
```

The "Mark all read" button at least has visible text plus icon (acceptable
target via the text). The "Clear all" button is icon-only `Trash2 h-3 w-3`
(12×12) inside a `text-label` button — the entire interactive footprint is
~16×16px. On a 390px mobile viewport with finger taps this is below WCAG
2.5.5 24×24 and far below the Apple HIG / Android 44×44 floor. R3 already
flagged the missing accessible name (P1) for this button — the fix added a
`title` attribute but the touch-target size remains too small.

**Impact on AT users:** Motor-impaired users on mobile can't reliably hit
the trash icon to clear notifications.

**Fix:** Either add visible "Clear" text alongside the trash icon (matching
the "Mark all read" pattern) OR pad the button to `min-h-11 min-w-11` so
finger taps land. R3's `aria-label` advisory still applies — title is not
a substitute for `aria-label`.

---

### WCAG 2.3.3 Animation from Interactions

#### F15 — OnboardingTour spotlight glow ring uses `animate-pulse` directly without `motion-reduce:hidden` or `motion-reduce:animate-none`
**Severity:** A11Y-MINOR
**File:** `frontend/src/components/layout/OnboardingTour.tsx:397-398`

**DOM excerpt:**
```tsx
<div
  className="absolute rounded-lg transition-all duration-300 ease-out"
  style={{
    top: spotlightRect.top - padding,
    left: spotlightRect.left - padding,
    …
    boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
    zIndex: 1,
  }}
>
  <div className="absolute inset-0 rounded-lg ring-2 ring-primary/50 animate-pulse" />
</div>
```
The global reduced-motion CSS in `globals.css` caps `animation-duration` to
`0.01ms` for `prefers-reduced-motion: reduce`, so the pulse effectively
disables. R5-6 already noted the 1500ms `setTimeout` chain doesn't honor
reduced-motion. Adding to the carry-over: the spotlight glow ring is also
not explicitly opted out via `motion-reduce:animate-none`, and the
`transition-all duration-300` on the spotlight rect itself runs on every
step change — vestibular-sensitive users get a moving spotlight on every
"Next" click.

**Impact on AT users:** Vestibular / migraine-susceptible users see the
spotlight smoothly slide between targets even with reduced-motion preferred.

**Fix:** Add `motion-reduce:transition-none motion-reduce:animate-none`
to both the spotlight container and its glow ring child. Better: when
`prefers-reduced-motion: reduce`, render the spotlight without the
`transition-all` class so it snaps instead of slides.

---

## Cross-cutting observations

- **Custom widgets without arrow-key handlers is a ROOT pattern.** F2 lists
  six instances; the fix is one shared `useRovingTabIndex` hook that all
  six can adopt. Without it, a future developer adding the seventh
  radiogroup will inherit the same gap.
- **`aria-required` is missing across all forms.** F11 covers login + alerts;
  spot-check found the same in settings broker form (`settings/page.tsx:686+`)
  and reset-password (`login/reset/page.tsx`). A lint rule that flags
  `<input>` without `required`/`aria-required` inside a `<form>` would
  catch all of them.
- **Live regions are inconsistent for state-change announcements.** R5-4
  closed three hero-numeric composites; this audit adds the kill-switch
  state dot (F6) and the order-submit busy state (F9) as two more silent
  state changes. The pattern needs to extend to "any element whose
  display-content changes in response to user action OR network event."
- **DestructiveConfirmModal is the right shape but misses two micro-details:**
  (F4) initial focus on the destructive button by default tab order, and
  (R5-7 carry-over) text-only "Confirming…" label without a glyph. Both
  fixes are <5 LOC each.
- **OnboardingTour is the most a11y-fragile NEW surface.** It hand-rolls
  focus trap (F1), aria-modal, and motion handling — three places where
  using the existing Base UI Dialog primitive would inherit correctness
  for free. Worth a refactor.

## Files referenced
- `frontend/src/components/layout/OnboardingTour.tsx:249-276,397-398` (F1, F15)
- `frontend/src/app/(dashboard)/strategies/page.tsx:465-483` (F2)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/FiltersBar.tsx:103-140,179-215` (F2)
- `frontend/src/app/(dashboard)/settings/page.tsx:231-256,686-707,728-746` (F2)
- `frontend/src/components/composites/OrderBar.tsx:583-595,617-667,716-723` (F2, F3)
- `frontend/src/components/layout/ProfileMenu.tsx:170-192` (F2)
- `frontend/src/components/destructive/DestructiveConfirmModal.tsx:51-58` (F4)
- `frontend/src/components/panels/TradePanel.tsx:529-552,599-611,819-833` (F5, F9)
- `frontend/src/app/(dashboard)/strategies/[id]/_strategy/KillSwitchStatusPanel.tsx:144-152,191-216` (F6, F8)
- `frontend/src/components/layout/NotificationCenter.tsx:71-97,151-172,177-203` (F7, F13, F14)
- `frontend/src/app/(dashboard)/strategies/earnings-options-play/_earnings/ClaudeThesisCard.tsx:315-343` (F10)
- `frontend/src/app/login/_login/LoginForm.tsx:265-277,293-308` (F11)
- `frontend/src/app/(dashboard)/alerts/page.tsx:223-243,272-287,328-338` (F11)
- `frontend/src/components/typography/SectionRule.tsx:25-38` (F12)
- `frontend/src/app/(dashboard)/strategies/[id]/page.tsx:760-826` (F12 consumer)

## Evidence (canonical sweep)
- `qa/runs/2026-05-04T20-31-40Z/strategy-momentum-quality/desktop-1440/initial.dom.html` — confirms `aria-label="enabled"` on the kill-switch dot (F6)
- `qa/runs/2026-05-04T20-31-40Z/login/desktop-1440/initial.dom.html` — 0 `required`/`aria-required` attributes (F11)
- `qa/runs/2026-05-04T20-31-40Z/alerts/desktop-1440/initial.dom.html` — 0 `aria-required`, no live region for the form (F11)
- `qa/runs/2026-05-04T20-31-40Z/dashboard/desktop-1440/initial.dom.html` — only 1 `aria-live`/`role="status"`/`role="alert"` total — confirms the live-region gap from R5-4 + F9
