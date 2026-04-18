# AlphaDesk A11y Audit — Round 3

Scope: frontend Next.js app (`frontend/src`). Codebase is React 19 + Tailwind v4 on base-ui + cmdk + lucide. All contrast ratios computed against design-tokens.css values using WCAG relative-luminance formula.

Legend: P0 = blocking (WCAG AA violation, breaks a whole interaction class); P1 = important (noticeable barrier / failure path); P2 = polish.

---

### [P0] `text-fg-hint` fails AA contrast on every surface
**File:** `frontend/src/styles/design-tokens.css:64` (token), ~45 call-sites across app (grep `text-fg-hint`)
**Issue:** `--fg-hint = #5b5547` against `--bg #0b0a09` = **2.67:1**, vs `--bg-elev-1 #111110` = 2.55:1, vs `--bg-elev-2 #15140f` = 2.49:1, vs `--bg-card #1c1a14` = 2.35:1. Used for input placeholders (`Input` line 24), ContextBar labels (`ContextBar.tsx:43`), hero chart meta subheads (`PriceChartPanel.tsx:159`), hero hint text (`login/page.tsx:100`, `PositionsList.tsx:117`, etc.)
**User impact:** Low-vision users cannot read hint text, placeholders, or secondary meta — fails AA even though the token is named "hint."
**WCAG:** 1.4.3 Contrast (Minimum)
**Fix:** Redefine `--fg-hint` to at least `#9a9380` (≈4.5:1 on `--bg`). Ripple: the editorial palette needs `fg-hint` to lift ~2 ink steps. If the visual design insists on current value, restrict `text-fg-hint` to ≥18pt text and audit every call-site is actually large.

### [P0] `text-fg-muted` fails AA contrast on elevated surfaces
**File:** `frontend/src/styles/design-tokens.css:63` (token); extensive use (see `text-fg-muted`, `text-muted-foreground`)
**Issue:** `--fg-muted = #7d7665` — 4.38:1 on `--bg` (passes), but **4.18:1** on `--bg-elev-1`, **4.08:1** on `--bg-elev-2`, **3.85:1** on `--bg-card`. Cards and dialogs (`DialogContent` uses `bg-bg-elev-2`) are where muted text is most used, and it fails there. Examples: `DialogDescription.tsx:150`, every `SectionCard` in reports/analytics, StatusStrip labels.
**User impact:** Low-vision; fails wherever muted text lives inside a card or dialog — which is nearly everywhere.
**WCAG:** 1.4.3 Contrast (Minimum)
**Fix:** Lift `--fg-muted` to `#8e8774` (~5.0:1 on `--bg-card`) OR promote muted body text to `text-fg-dim` inside elevated containers.

### [P0] `--loss-foreground` on `bg-loss` fails AA — the fix-token *doesn't actually fix it*
**File:** `frontend/src/styles/design-tokens.css:86`
**Issue:** Token added in prior visual audit: `--loss-foreground: var(--ink-1000)` = `#f7f1dc` on `--loss #e07856` coral = **2.66:1**. Used by `buttonVariants.sell-solid` (`button.tsx:54`) and several toast/error chips. The contrast is *worse* than black-on-coral (7:1). Black-on-chartreuse (profit-foreground) is 11.5:1 and OK; loss-foreground is broken.
**User impact:** Primary LIVE-mode / DESTRUCTIVE buttons ("Submit LIVE Order", "Confirm Live Mode") look fine but read as haze for low-vision users. AA violation on a destructive CTA.
**WCAG:** 1.4.3 Contrast (Minimum) — 3.0:1 for UI components & large text also fails.
**Fix:** Set `--loss-foreground: var(--ink-000)` (i.e. near-black) — that gives 6.99:1 on coral. Then `.sell-solid` remains visually distinct from `.buy-solid` (black text) only via the coral background. Alternatively lower `--loss` to `--down-700 #a04a2b` (5.3:1 with light fg).

### [P0] Trading desk (`/`) has no `<main>` landmark and no skip link
**File:** `frontend/src/components/layouts/DeskLayout.tsx:47-89`; `frontend/src/app/(dashboard)/layout.tsx:102-112` (desk branch omits skip link)
**Issue:** The flagship desk route renders `<div>` + 3× `<aside>` + `<section>`. No `<main>`. And the dashboard layout only emits the "Skip to content" anchor in the non-desk branch. SR users on `/` cannot skip from TopBar → center content; sighted keyboard users tab through all 12 rail buttons before reaching the chart.
**User impact:** Keyboard + SR users on the primary route.
**WCAG:** 2.4.1 Bypass Blocks, 1.3.1 Info & Relationships, 4.1.2 Name, Role, Value (landmark)
**Fix:** Wrap the center `<section>` in `<main id="main-content" tabIndex={-1}>` inside `DeskLayout` and add the skip link to the desk branch in `(dashboard)/layout.tsx`. Move the `href="#main-content"` anchor out of the non-desk `if` so it's emitted for both branches.

### [P0] Command palette Dialog has no `DialogTitle`/`DialogDescription` (SR-only)
**File:** `frontend/src/components/layout/CommandPalette.tsx:241-244`
**Issue:** Uses `<Dialog>` + `<DialogContent>` directly — bypasses the `CommandDialog` helper that would inject an sr-only title/description. Base-ui's dialog requires an accessible name; with no `aria-labelledby` the modal announces as "dialog" only.
**User impact:** SR users opening ⌘K hear "dialog" with no context.
**WCAG:** 4.1.2 Name, Role, Value; 2.4.6 Headings & Labels
**Fix:** Swap the raw `Dialog`/`DialogContent` for the existing `CommandDialog` export, or add `<DialogHeader className="sr-only"><DialogTitle>Command Palette</DialogTitle><DialogDescription>Search symbols and actions.</DialogDescription></DialogHeader>` as the first child of `DialogContent`.

### [P0] Toast container has no `aria-live` region — errors silent to SRs
**File:** `frontend/src/components/ui/toast.tsx:120-126`
**Issue:** Toasts are rendered inside a `fixed` `<div>` with no `role="region"` / `aria-live="polite"` / `aria-atomic`. Each `ToastItem` has `role="alert"` (line 66), but by the time an alert is appended into a region that is not announced, some AT engines miss it. Also "error" toasts should use `aria-live="assertive"` — currently same as info.
**User impact:** SR users submitting an order with a validation error get no audible feedback.
**WCAG:** 4.1.3 Status Messages
**Fix:** Wrap the toast list container in `role="region" aria-live="polite" aria-label="Notifications"`. Change error toasts to `role="alert"` + `aria-live="assertive"`, success/info keep `role="status"`.

### [P0] Trade-desk page skeleton / loading states have no SR text
**File:** `frontend/src/app/(dashboard)/loading.tsx:1-18`; `frontend/src/components/composites/PriceChartPanel.tsx:329-332`
**Issue:** `loading.tsx` renders four `animate-pulse` `<div>` blocks with zero role/label. PriceChartPanel loading state uses `aria-hidden="true"` on the skeleton so SR users see nothing at all while bars fetch.
**User impact:** SR users don't know anything is loading — or whether the page has any content at all.
**WCAG:** 4.1.3 Status Messages; 2.4.6 Headings & Labels
**Fix:** Wrap the loading.tsx root in `<div role="status" aria-live="polite" aria-label="Loading dashboard">` plus an `<span className="sr-only">Loading…</span>`. In `PriceChartPanel.tsx:329`, replace `aria-hidden="true"` with `role="status" aria-label="Loading chart data"`.

### [P0] Input placeholders use `text-fg-hint` (2.55:1) as default
**File:** `frontend/src/components/ui/input.tsx:24` (`placeholder:text-fg-hint`)
**Issue:** Every primitive `Input` has placeholder text below AA contrast even without the shadow/ring. Search bars, command palette input, symbol entry, login.
**User impact:** Low-vision users cannot read what the placeholder says.
**WCAG:** 1.4.3 Contrast
**Fix:** Change the placeholder utility to `placeholder:text-fg-muted` (still fails AA in card surfaces per P0 above, so combine with the token lift). Ideally placeholder → `#a8a08d` (`--ink-700`, 7.6:1 on `--bg`).

### [P0] OrderBar `<select>` and OrderBar Stop `<Input>` have `outline-none` with no visible focus replacement
**File:** `frontend/src/components/composites/OrderBar.tsx:118, 193`
**Issue:** Both native `<select>` elements apply `outline-none` with only `focus-visible:border-brand` (1px). The 1px brand border is the same color as the hover border — essentially no visible focus change. No ring, no outline offset.
**User impact:** Keyboard users cannot see where focus is when tabbing through the order bar.
**WCAG:** 2.4.7 Focus Visible
**Fix:** Add `focus-visible:ring-1 focus-visible:ring-brand focus-visible:shadow-[0_0_0_3px_rgba(201,166,107,0.12)]` to match the `<Input>` primitive.

### [P0] `text-black` on coral loss bg fails but the live-mode submit uses `text-white` — AA fail
**File:** `frontend/src/components/panels/TradePanel.tsx:441, 510, 783`; `frontend/src/components/layout/ProfileMenu.tsx:168`
**Issue:** `bg-[var(--loss)] ... text-white` = white (#fff) on coral #e07856 = **3.00:1** — fails AA body text. This is the primary LIVE-mode submit button and the "Confirm Live Mode" dialog CTA.
**User impact:** Low-vision user about to place a real-money order sees label at sub-AA contrast on the most consequential CTA in the app.
**WCAG:** 1.4.3 Contrast (text ≥4.5:1)
**Fix:** Use the design-system variant `variant="sell-solid"` (fixed via P0 above) or swap bg to `var(--down-700)` `#a04a2b` (5.3:1 vs white) for the LIVE path.

### [P0] Desk route's logo is a `<div>` with `onClick` — not keyboard-operable
**File:** `frontend/src/components/layout/TopBar.tsx:77-83`
**Issue:** `<div className="... cursor-pointer" onClick={() => router.push("/")}>` with no role, no tabIndex, no keyboard handler. Keyboard users cannot activate it.
**User impact:** Keyboard users can't click the logo home.
**WCAG:** 2.1.1 Keyboard, 4.1.2 Name, Role, Value
**Fix:** Replace with `<Link href="/">` or `<button type="button" onClick={…} aria-label="Go to dashboard home">`.

### [P0] Row-as-button components don't `preventDefault()` on Space — page scrolls
**File:**
- `frontend/src/components/panels/WatchlistPanel.tsx:259-261`
- `frontend/src/components/panels/TradePanel.tsx:542-544, 894-896`
- `frontend/src/components/dashboard/MarketMovers.tsx:164-166`

**Issue:** `onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}` — space triggers action *and* browser scroll. Also some rows lack `type="button"` (they are `<div role="button">`), making Space behavior inconsistent.
**User impact:** Keyboard users pressing Space on a watchlist row both select and scroll — jarring and the opposite of the expected button-press semantics.
**WCAG:** 2.1.1 Keyboard (expected behavior of activation)
**Fix:** `if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); }` (model matches the correct implementation already used in `pipeline/page.tsx:638-643` and `StrategyGrid.tsx:52`).

### [P0] `role="marquee"` is not a valid ARIA role
**File:** `frontend/src/components/layout/TickerTape.tsx:30`; `frontend/src/components/composites/TickerStrip.tsx:45`
**Issue:** `role="marquee"` is from the HTML spec and has been deprecated; it's not a valid ARIA 1.2 role and AT engines ignore it or log a warning. Axe flags this.
**User impact:** Screen readers may read every ticker entry as the ticker scrolls by — extremely noisy — or ignore it entirely depending on AT.
**WCAG:** 4.1.2 Name, Role, Value
**Fix:** Remove the role. Use `<div aria-label="Live market ticker" role="region" aria-live="off">` or keep it a presentation-only marquee with `aria-hidden="true"` (the numbers are announced via the StatusStrip aria-live region anyway).

### [P0] Login "Show password" button is removed from tab order
**File:** `frontend/src/app/login/_login/LoginForm.tsx:220` — `tabIndex={-1}` on the Eye/EyeOff toggle
**Issue:** The password-visibility toggle has `aria-label` and `aria-pressed` but is explicitly removed from the tab order. Keyboard-only users cannot reveal their password.
**User impact:** Motor-impaired / keyboard-only users can't verify their password entry.
**WCAG:** 2.1.1 Keyboard; 2.4.3 Focus Order
**Fix:** Remove `tabIndex={-1}`. The historical reason (don't steal focus from submit-on-Enter) isn't valid — the button has `type="button"` so it won't submit the form.

### [P1] OnboardingTour dialog has no title/description labeling, no Escape handler, no focus trap, no initial focus
**File:** `frontend/src/components/layout/OnboardingTour.tsx:227-233`
**Issue:** `role="dialog" aria-modal="true"` but:
- No `aria-labelledby` pointing at the `<h3>` (line 281).
- No `aria-describedby` pointing at the `<p>` (284).
- No `keydown` listener for Escape to close/skip (relies on the backdrop click).
- Focus is not moved into the dialog on mount — Next/Previous buttons are discoverable only by guessing where focus should go. Focus isn't returned to a previous trigger (there isn't one, but it's still unmanaged).
**User impact:** SR users don't get the tour's title/body announced; keyboard users can't Escape out.
**WCAG:** 4.1.2 Name, Role, Value; 2.1.2 No Keyboard Trap; 2.4.3 Focus Order
**Fix:** Add `aria-labelledby="tour-title" aria-describedby="tour-desc"` plus the matching `id`s. Add `useEffect` with `document.addEventListener("keydown", e => e.key === "Escape" && completeTour())`. Move focus to the Next button on mount: `nextBtnRef.current?.focus()`.

### [P1] ShortcutOverlay dialog has no `aria-labelledby`, no focus trap
**File:** `frontend/src/components/ui/shortcut-overlay.tsx:114-120`
**Issue:** `role="dialog" aria-modal="true"` but no `aria-labelledby`; the `<h2>Keyboard Shortcuts</h2>` exists but isn't linked. The overlay receives focus on the search input (good) but nothing traps Tab — tabbing exits to the underlying page.
**User impact:** SR users hear "dialog" only; keyboard users can tab into hidden content behind the overlay.
**WCAG:** 4.1.2; 2.4.3 Focus Order
**Fix:** Add `id="shortcut-overlay-title"` to the `<h2>` and `aria-labelledby="shortcut-overlay-title"` on the outer `<div>`. Implement a `Tab` key trap or port this to a `<Dialog>` primitive which already handles it.

### [P1] AICopilot sidebar uses `role="complementary"` but behaves as a modal sheet
**File:** `frontend/src/components/layout/AICopilot.tsx:160-166`
**Issue:** The side panel has a full-screen backdrop that dims the page and captures clicks (148-157), so it is *effectively* a modal. But it's declared as `role="complementary"` with no `aria-modal`, no Escape handler, and no focus trap. The backdrop is a `<div>` with `onClick` (not a button) — not keyboard-activatable.
**User impact:** Keyboard + SR users cannot dismiss the copilot with Escape; focus can escape the panel into the dimmed background.
**WCAG:** 2.1.1 Keyboard; 4.1.2 Name, Role, Value
**Fix:** Either remove the modal backdrop (make it a true non-modal sidebar) OR convert to the existing `Sheet` primitive which handles role="dialog"/aria-modal/focus/escape. Add an Escape listener regardless: `useEffect(() => { if (!open) return; const onKey = e => e.key === "Escape" && setOpen(false); …` .

### [P1] AICopilot input has no label (visible or aria)
**File:** `frontend/src/components/layout/AICopilot.tsx:286-300`
**Issue:** `<input type="text" placeholder="Ask anything...">` — no `<label>`, no `aria-label`, no aria-describedby. Placeholder is not a substitute for a label (disappears when typing).
**User impact:** SR users hear the placeholder on focus, then nothing once typing. Chrome a11y tree logs "Textbox".
**WCAG:** 4.1.2 Name, Role, Value; 3.3.2 Labels or Instructions
**Fix:** Add `aria-label="Ask the AI copilot"`.

### [P1] NotificationCenter "Clear all" icon button has no accessible name
**File:** `frontend/src/components/layout/NotificationCenter.tsx:151-159`
**Issue:** `<button … title="Clear all"><Trash2 className="h-3 w-3" /></button>` — `title` is a tooltip hint, not an accessible name, and is not exposed by all SR/AT combos. No `aria-label` on the trash button.
**User impact:** SR users hear "button" with no label.
**WCAG:** 4.1.2 Name, Role, Value
**Fix:** Add `aria-label="Clear all notifications"`.

### [P1] Tables throughout app missing `scope="col"` on headers
**File:** `frontend/src/components/ui/table.tsx:86-101` (default `<th>` has no scope); usage sites `frontend/src/app/(dashboard)/trade/page.tsx:210-215`, `frontend/src/app/(dashboard)/pipeline/page.tsx:445-456`
**Issue:** `grep scope="col"` → 0 matches across the app. Default `TableHead` emits a bare `<th>` with no scope, and all consumers rely on it.
**User impact:** SR table navigation (VoiceOver's table rotor) cannot associate cells with column headers correctly on complex tables.
**WCAG:** 1.3.1 Info & Relationships
**Fix:** In `components/ui/table.tsx:88`, default the `<th>` to `<th scope={props.scope ?? "col"} ...>`.

### [P1] DeskLayout rows/columns: no `<main>` / `<nav>` landmark inside the grid
**File:** `frontend/src/components/layouts/DeskLayout.tsx:65-85`
**Issue:** Two `<aside>` + one `<section>` with no labels. `<aside>` without `aria-label` reads as "complementary" with no context. The left rail has strategies; right panel has positions — both should be labeled.
**User impact:** SR users get duplicate "complementary" landmarks.
**WCAG:** 1.3.1; 2.4.6 Headings & Labels
**Fix:** `aria-label="Strategy rail"` and `aria-label="Positions and memo"` on the two `<aside>` elements; wrap center in `<main aria-label="Trading chart and order ticket">`.

### [P1] Pages under `/trade`, `/analytics`, `/alerts`, etc. use `<h2>` as first heading (no `<h1>`)
**File:** `frontend/src/app/(dashboard)/trade/page.tsx:157` has an `<h1>` (good), but `settings/page.tsx:318+` jumps straight to `<h2>`; `alerts/page.tsx:74` uses `<h3>`; `pipeline/page.tsx:421+` uses `<h2>`. `DashboardPageLayout` does provide an `<h1>` (line 56) so pages that use it are fine — but mobile TopBar renders an `<h2>` ("Settings" etc.) outside that context.
**Issue:** Heading hierarchy skip (h1 → h3 on alerts), and the page-level `<h1>` is hidden behind the `DashboardPageLayout` title while page-content is h2.
**User impact:** SR users using heading navigation jump confusingly.
**WCAG:** 1.3.1; 2.4.6
**Fix:** Ensure every dashboard page uses `DashboardPageLayout` (provides the single h1). Demote all `<h2>` heading-title tags for "Create Alert" (`alerts/page.tsx:74` is `<h3>` — should be `<h2>` under the page's h1).

### [P1] Password-visibility toggle: aria-label should match the action, not the resulting state for SR
**File:** `frontend/src/app/login/_login/LoginForm.tsx:217-218`
**Issue:** `aria-label={showPassword ? "Hide password" : "Show password"}` is OK, but `aria-pressed={showPassword}` + the Eye/EyeOff icon both fight for the announcement. VoiceOver says "Show password, toggle button, pressed". Acceptable but confusing.
**User impact:** Minor SR confusion on state.
**WCAG:** 4.1.2 Name, Role, Value
**Fix:** Keep `aria-pressed` only, and set `aria-label="Show password"` (static). The pressed state carries the on/off meaning.

### [P1] `ContextBar` metric labels use 8.5px font at `text-fg-hint`
**File:** `frontend/src/components/composites/ContextBar.tsx:41-46`
**Issue:** `text-[8.5px] uppercase text-fg-hint` — sub-9px text at 2.55:1 contrast. Between the tiny size and sub-AA contrast, the labels are virtually unreadable.
**User impact:** All users with any visual impairment; also zoom-out rendering.
**WCAG:** 1.4.3; 1.4.4 Resize Text
**Fix:** Lift to 10.5px min and swap to `text-fg-muted` (still sub-AA per P0 but better; fully fixing needs the token lift above).

### [P1] Entry animations run on every page render — `prefers-reduced-motion` partial respect
**File:** `frontend/src/app/globals.css:279-301`, `frontend/src/app/(dashboard)/template.tsx` (page-transition), multiple `.card-stagger` users
**Issue:** Global rule kills `animation-duration` to 0.01ms for reduced motion, but doesn't stop the keyframes or guarantee no visual flicker. `animate-marquee` in `TickerTape` and `TickerStrip`'s inline `@keyframes ad-marquee` run continuously — should pause outright.
**User impact:** Vestibular / migraine-susceptible users still see shifted elements for 0.01ms, and the marquee in TickerTape keeps scrolling.
**WCAG:** 2.3.3 Animation from Interactions
**Fix:** Wrap reduced-motion CSS with `animation-play-state: paused !important` specifically for marquee-class utilities. `TickerStrip` already respects this (line 72); `TickerTape.tsx` does not — add a `prefers-reduced-motion` pause rule there (or replace with the `TickerStrip` primitive).

### [P1] OrderBar "Field" label is a non-associated `<span>`
**File:** `frontend/src/components/composites/OrderBar.tsx:245-263`
**Issue:** Visual labels rendered as `<span>` not `<label>`. Inputs get `aria-label` (good) but the visual text and SR text are duplicated. Best practice: real `<label htmlFor>` links visual + SR and boosts click target.
**User impact:** SR users hear label twice; mouse users can't click the label to focus the control.
**WCAG:** 1.3.1; 3.3.2 Labels or Instructions
**Fix:** Convert `Field` to emit `<label htmlFor={id}>`. Generate an id with `React.useId()` in the composite and pass it down to the input/select.

### [P1] `PositionsList` row is a `<li>` containing a `<button>` and text — but whole row isn't clickable, only the symbol
**File:** `frontend/src/components/composites/PositionsList.tsx:138-187`
**Issue:** Mouse users expect the whole row to be clickable (selected-symbol handler); only the small left-column `<button>{symbol}</button>` triggers it. Also the row `<li>` has no `role="row"`; the parent `<ul>` is `role="list"` (good) but lacks `aria-label="Positions"`.
**User impact:** Mouse users mis-click the strategy name or progress bar; SR users don't know this list is positions.
**WCAG:** 2.5.5 Target Size (AAA); 2.4.6 Headings & Labels
**Fix:** Wrap the row content in a button-as-row or add `onClick` to the `<li>` with `role="button" tabIndex={0}`. Add `aria-label="Open positions"` on the `<ul>`.

### [P1] `ProfileMenu` Paper/Live toggle uses two unlinked `<button>` elements, not a radiogroup
**File:** `frontend/src/components/layout/ProfileMenu.tsx:114-116`
**Issue:** Two buttons with no roles indicate selection only by class; no `role="radiogroup"` / `role="radio"` / `aria-checked`. Compare `settings/page.tsx:140-162` (IntervalSlider) which does this correctly.
**User impact:** SR users don't know these are mutually exclusive choices.
**WCAG:** 4.1.2 Name, Role, Value
**Fix:** Wrap in `<div role="radiogroup" aria-label="Trading mode">`; each button gets `role="radio" aria-checked`.

### [P1] WatchlistPanel delete-preset "x" is a `<span role="button">` nested inside a `<button>` — invalid HTML
**File:** `frontend/src/components/panels/WatchlistPanel.tsx:592-601`
**Issue:** `<span role="button" onClick=…>x</span>` inside `<button onClick={applyPreset}>` — buttons cannot contain interactive descendants (AXE rule `nested-interactive`). Also no tabIndex so keyboard users cannot reach it.
**User impact:** Keyboard users can't delete custom presets; SR AT may collapse or mis-announce the structure.
**WCAG:** 4.1.1 Parsing; 2.1.1 Keyboard
**Fix:** Make the preset card a `<div>` containing two `<button>`s (apply + delete) side-by-side.

### [P1] `InputGroupAddon` clicks into a hidden input via `e.currentTarget.parentElement?.querySelector("input")?.focus()`
**File:** `frontend/src/components/ui/input-group.tsx:87-92`
**Issue:** The addon focuses the inner input on click — but has `cursor-text` and no role. Without a linking mechanism (htmlFor/aria-labelledby) SRs see addon text as separate content from the input.
**User impact:** SR users hear the addon ("USD") and the input as two disconnected nodes.
**WCAG:** 1.3.1 Info & Relationships
**Fix:** Pass a generated id from `InputGroupInput` via context or prop so the addon can render as `<label htmlFor={id}>` and drop the imperative focus handler.

### [P1] Error boundaries don't announce with `role="alert"`
**File:** `frontend/src/components/error/DashboardError.tsx:65-100`; `frontend/src/app/(dashboard)/error.tsx`
**Issue:** Error UI renders a Display title + paragraph + buttons — no `role="alert"`, no `aria-live`. A chart or panel failure swaps silently for SR users.
**User impact:** SR users on the dashboard don't get told something failed.
**WCAG:** 4.1.3 Status Messages
**Fix:** Wrap the error container in `role="alert"` and keep `<h1>` heading for navigation context.

### [P1] Icon-only "X" close in ShortcutOverlay mobile has no accessible text for desktop
**File:** `frontend/src/components/ui/shortcut-overlay.tsx:133-140`
**Issue:** `sm:hidden` — the desktop version shows "Press Esc to close" text only; there is no visible close button on desktop, which matches the Esc contract. But if user has Escape remapped or the keyboard shortcut hook fails, user has no mouse option. Minor.
**User impact:** Edge-case keyboard/mouse-only users.
**WCAG:** 2.1.1 Keyboard (dup path)
**Fix:** Show the close button on desktop too (just smaller). Keep Esc as primary.

### [P2] Loading skeleton `animate-pulse` has no reduced-motion alternate
**File:** `frontend/src/app/(dashboard)/loading.tsx:5-14`; `frontend/src/components/composites/PriceChartPanel.tsx:331`
**Issue:** `animate-pulse` is a Tailwind animation; the global reduced-motion rule caps duration at 0.01ms so it effectively disables. Good. But the pulse is also extremely subtle (40% opacity variance) and some users miss it.
**User impact:** Minor — reduced-motion users see static grey blocks only.
**WCAG:** 2.3.3 (met)
**Fix:** None required; noted for completeness.

### [P2] `sr-only` skip link uses `focus:bg-primary focus:text-white` — text-white on gold (c9a66b) = 2.4:1
**File:** `frontend/src/app/(dashboard)/layout.tsx:119`; `frontend/src/components/layout/DashboardShell.tsx:22`
**Issue:** When the skip link receives focus, it renders with `bg-primary` (gold #c9a66b) and `text-white` — contrast **2.4:1**. Fails AA.
**User impact:** Keyboard users activating skip link see low-contrast text.
**WCAG:** 1.4.3
**Fix:** Change to `focus:text-primary-foreground` (near-black on gold = 8.1:1), the same pattern `Button variant="primary"` uses.

### [P2] Rail-section panels use 9.5-11px text at `text-fg-hint` / `text-fg-muted`
**File:** `frontend/src/components/composites/PriceChartPanel.tsx:159,163`; `StrategyRail` etc.
**Issue:** Combination of very small text with sub-AA tokens is a double issue; 11px text at 2.5–4:1 contrast is substantially below AA.
**User impact:** Low-vision / older users.
**WCAG:** 1.4.3; 1.4.4
**Fix:** Raise to ≥12px default body text and use `fg-dim` (`--ink-700`, 7.6:1) for dense chrome text.

### [P2] `Textarea`/`Input` disabled state at `opacity-50` drops contrast too far
**File:** `frontend/src/components/ui/input.tsx:27`
**Issue:** Disabled = `opacity: 0.5`. Starting from body `fg` (#ece6d2, 15.8:1) this becomes ~8:1 — OK. But from `fg-muted` (#7d7665, 4.18:1) this becomes ~2:1 — fails even "disabled is exempt" interpretation when users need to read what the field said.
**User impact:** Low-vision users can't read disabled form values when reviewing an order.
**WCAG:** 1.4.11 Non-text Contrast (disabled controls are exempt; disabled text is not strictly required — this is a UX quality issue).
**Fix:** Use `disabled:text-fg-muted disabled:bg-bg-elev-1/60` instead of blanket `opacity-50`.

### [P2] `Button` inside `DialogContent` uses `absolute top-1.5 right-1.5 size-11 md:size-[30px]` — near-AAA mobile target but desktop under 44x44
**File:** `frontend/src/components/ui/dialog.tsx:74-81`
**Issue:** Mobile target is 44x44 (good, WCAG 2.5.5 AAA). Desktop is 30x30 which falls below 24x24 AAA bonus but is OK for AA (no minimum). Noted so callers don't shrink further.
**WCAG:** 2.5.5 AAA (informational)
**Fix:** None required.

### [P2] Focus indicator on base-ui Popup/Popover has `outline-hidden` only
**File:** `frontend/src/components/ui/popover.tsx:42`, `dropdown-menu.tsx:47, 99`
**Issue:** `outline-hidden` removes the keyboard focus ring on the popup surface itself. Since a popover is rarely tabbed to (focus goes to items inside), this is OK. But if a consumer sets tabIndex on the popup itself it becomes invisible.
**User impact:** Minor — deeply focusable popovers would lose focus indication.
**WCAG:** 2.4.7 (informational)
**Fix:** Change to `focus-visible:outline-none` with a replacement ring OR add a dev-time lint so devs don't put focusable content at the popover root.

### [P2] `<Badge variant="outline">` border-emerald-500/30 text-emerald-400 — contrast of green-400 on bg?
**File:** `frontend/src/components/dashboard/StrategyGrid.tsx:71-75`
**Issue:** `text-emerald-400` (#34d399) on `bg-surface` (#1c1a14) = ~8:1 (pass), but the border emerald-500/30 is at 30% opacity — nearly invisible against the dark card. The visual "active" affordance is entirely the fill/text color; the border is decorative.
**User impact:** None — text passes. Border is non-essential.
**WCAG:** 1.4.11 (border is not an essential component)
**Fix:** None.

### [P2] `AICopilot` suggestion-pill hover color lacks a focus indicator
**File:** `frontend/src/components/layout/AICopilot.tsx:252-262`
**Issue:** `<button>` with `hover:bg-primary/10` but no `focus-visible:ring` / outline. Global `:focus-visible` CSS in `globals.css:169` provides a 2px brand outline at 2px offset — so there IS a default ring. OK.
**User impact:** None confirmed; noted because many custom buttons in panels disable the outline via Tailwind arbitrary values.
**WCAG:** 2.4.7 (met via global rule)
**Fix:** None.

### [P2] TickerTape triples content without announcing duplicates
**File:** `frontend/src/components/layout/TickerTape.tsx:26`
**Issue:** `tripled` content is SRs-exposed. Even without an aria-live, if a user tabs into or hovers the ticker some SRs read the aria-label. The triplication means same content x3.
**User impact:** Rare — `hidden overflow` and no focus make this largely invisible.
**Fix:** Mark the duplicate copies `aria-hidden="true"`, keep the first copy as the SR surface.

### [P2] `TopBar` search button: aria-label describes actions that happen in the palette, not the button
**File:** `frontend/src/components/layout/TopBar.tsx:98`
**Issue:** `aria-label="Open command palette to search symbols and commands"` — long, and the button visually contains the text "Search symbols, commands…". The aria-label *overrides* the visible text, which is undesirable.
**User impact:** SR users don't hear what they see on screen.
**WCAG:** 2.5.3 Label in Name (AA)
**Fix:** Use `aria-label="Open command palette"` or remove `aria-label` entirely — the visible text and `<kbd>` already make it accessible.

---

## Summary

35 findings; 15 P0, 18 P1, 12 P2 (multiple P2 rolled together).

The most impactful cluster is the **token-level contrast failure**: `--fg-hint` and `--fg-muted` are below AA on nearly every surface they're used, and `--loss-foreground` — the token explicitly added to fix contrast on `.sell-solid` — is itself a **2.66:1 fail**. This is the #1 thing to fix; once the tokens move, dozens of UI surfaces come into compliance automatically.

Second cluster: the **desk route's landmark/structure a11y**. `DeskLayout` has no `<main>`, no skip link, no labeled asides. `CommandPalette` skips Title/Description. `OnboardingTour` / `ShortcutOverlay` / `AICopilot` each declare dialog-ish roles but don't implement the Escape/labelledby/focus-trap contract.

Third cluster: **keyboard operability**. Logo is a div-with-onClick. Row-as-button components don't preventDefault on Space (page scrolls). Login's show-password button is explicitly removed from tab order. Nested interactives in WatchlistPanel. OrderBar selects have no visible focus ring.

Quick wins (high-impact, low-effort):
1. Redefine `--fg-hint`, `--fg-muted`, `--loss-foreground` in `design-tokens.css` (10 min).
2. Add `aria-label` to `aside` in `DeskLayout` and wrap center in `<main>` (5 min).
3. Add `scope="col"` default to `TableHead` (1 min).
4. Wrap toast region in `aria-live="polite"` (2 min).
5. Swap raw `Dialog` in `CommandPalette` for `CommandDialog` helper (5 min).
6. Add preventDefault on Space in the four row-as-button components (5 min).
7. Fix desk skip link + landmarks (5 min).
8. Add `aria-label` to AICopilot input and NotificationCenter "Clear all" (2 min).
9. Remove `tabIndex={-1}` from login password toggle (1 min).
10. Drop `role="marquee"` on both ticker components (2 min).
