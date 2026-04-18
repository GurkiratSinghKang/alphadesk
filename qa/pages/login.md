# /login — expected behavior

## Route
- URL: `/login`
- Access: public
- Redirects: on successful login, `router.push("/")` (the flagship desk)
- Metadata: title "Sign in — AlphaDesk"; `robots: { index: false, follow: false }`.

## Layout (desktop ≥1024px)
### Structure
- Root: `<div class="mx-auto grid min-h-screen max-w-[1440px] grid-cols-1 gap-16 px-12 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">` wrapped by `app/login/layout.tsx` `bg-bg text-fg min-h-screen`.
- Left pane (hero):
  - `EditorialNameplate` with `volume="01" issue="01" title="Sign in" date=<todayIso>`.
  - Kicker: tracked-caps 11px text-brand "A SYSTEMATIC TRADING TERMINAL" (`letter-spacing: 0.2em`).
  - `Display size="lg"` Newsreader italic "Trade with *the* patience *of* capital." — the words "the" and "of" are `not-italic text-fg-dim`.
  - Body paragraph: sans 16px line-height 1.55 text-fg-dim, max-w 480px — describes the product and Claude as "pre-trade second opinion, not a co-pilot on the wheel."
  - `SectionRule` with `tag="§ 01 · Access"`.
  - Two-column bullet grid (stacks on mobile): tracked-caps labels ("Invite-only", "Twelve strategies, one execution layer") with italic-serif 15px captions underneath.
- Right pane (form card): `w-full max-w-[380px] rounded-md border border-border bg-bg-elev-1 p-8` containing:
  - Header row: tracked-caps `Desk · live` and mono hint `tradingalpha.net`.
  - `<LoginForm />` (see Interactive elements).

### Typography roles
- Hero H1 (`Display size="lg"`): Newsreader italic (`--font-display`), large display size, color `ink-1000` for the italics, `fg-dim` for the non-italic filler words.
- Kicker: Inter Tight 11px uppercase, `text-brand`.
- Body copy: Inter Tight 16px `text-fg-dim`.
- Labels: Inter Tight 10.5px uppercase `text-fg-muted` letter-spaced 0.18em (`Eyebrow` component).
- Desk hint: mono 10.5px `text-fg-hint`.

### Palette check
- Background: `bg-bg` (warm near-black `#0b0a09`).
- Accent: `text-brand` on the α mark, kicker, and the "Request access" link underline.
- P&L chartreuse / coral — must **not** appear on this page.
- No raw hex in components.

## Mobile (<1024px)
- Grid collapses to single column (`grid-cols-1`); hero stacks on top of form.
- Padding remains `px-12 py-12`.
- Form card stays `max-w-[380px]` centered in its section.

## Interactive elements (LoginForm.tsx)

### Username input
- Id: `login-username`
- Label: "Username" (via `Eyebrow` + `<label htmlFor>`)
- Placeholder: `your handle`
- `autoComplete="username"`, `autoFocus`
- Uncontrolled initial value `""`.
- Focus: gold 1px border + ring via shadcn `Input` primitive.

### Password input
- Id: `login-password`
- Label: "Password"
- Placeholder: `at least 12 characters` (known: the 12-char rule is not client-validated; see `audit-reports/iter-1-frontend.md` P3).
- `type` toggles between `"password"` and `"text"` by the show/hide button.
- `autoComplete="current-password"`.
- `aria-invalid` is `true` when an `error` is present.
- Caps-lock detection: on keydown / keyup, if `event.getModifierState("CapsLock")` is `true`, a line appears below the input: italic-serif 11.5px `text-amber` reading "Caps lock is on."

### Show / hide password toggle
- Ghost `Button` absolutely positioned at `right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0`, `tabIndex={-1}` (not in tab order).
- Icon: `Eye` when hidden, `EyeOff` when visible.
- `aria-label` swaps between "Show password" and "Hide password".
- `aria-pressed` reflects state.

### Forgot password link
- Text: "Forgot password?"
- Positioned right-aligned on same baseline as the Password label (`flex items-baseline justify-between`).
- Routes to `/login/reset` (was previously a `mailto:` — fixed per iter-1-frontend.md).
- Style: sans 10.5px `text-fg-hint hover:text-fg`.

### Error line
- Only rendered when `error` truthy. Mono 11.5px `text-down-500`, `role="alert"`, `aria-live="assertive"`. Contains either the backend `body.detail` or "Invalid username or password" / "Failed to connect to server".

### Lockout line
- Rendered when `locked` truthy (≥5 failures inside rolling 10 min).
- Mono 11.5px `text-down-500`, `role="alert"`, `aria-live="assertive"`. Text: "Too many attempts. Try again in {Nm SSs}." — countdown ticks every 1s via `setInterval`.
- Submit button is disabled while locked.

### Pre-lockout warning
- Rendered when `!locked` and `failCount >= 3`. Mono 11px `text-amber`. Text: "{N} attempt(s) left before lockout."

### Submit button
- `Button variant="primary" size="lg" type="submit" className="mt-1 w-full"`.
- Gold background (`bg-brand`), near-black text (`text-primary-foreground`), scales to 0.98 on press.
- Icon: `ArrowRight` left of label; swaps to `Loader2 animate-spin` while loading.
- Label: "Sign in" (sentence case).
- Disabled when any of: `loading`, no username, no password, locked.
- On submit: `fetch(${apiBase}/api/v1/auth/login, { method: "POST", credentials: "include", JSON body })`. On 2xx success: clears localStorage failure log, `router.push("/")`. On non-2xx: stores the error in state (from `body.detail`), appends `Date.now()` to the failures list, persists via `writeFailures`. On network throw: `setError("Failed to connect to server")`.

### Request access CTA
- Below the submit button. Italic-serif 13px `text-fg-muted` reading "No account? [Request access]".
- Link routes to `/request-access`.
- Style: `text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300`.

## Keyboard
- Tab order: username → password input → show/hide toggle (skipped; `tabIndex={-1}`) → forgot-password link → submit → request-access link. Autofocus starts on username.
- Enter in either input submits the form (native form behavior; `handleSubmit` is wired on `<form onSubmit>`).
- Escape has no special handler — default browser input behavior.

## Expected states

| State | Render |
|---|---|
| Initial | Empty username + password, submit disabled, no error, no caps-lock warning, no lockout. |
| Typing password with Caps Lock | Amber italic-serif line "Caps lock is on." appears below password field. |
| After 1 failed login | Error line shows detail; `failures` stored in localStorage. |
| After 3 failed | Amber mono "2 attempts left before lockout." shows. |
| After 5 failed in 10 min | Coral mono lockout line with live countdown; submit disabled for remainder of window. |
| Loading submit | Submit label shows `Loader2 animate-spin`; remains "Sign in" text with spinner. Button disabled. |
| Network error | "Failed to connect to server" — coral mono line. |

## Edge cases
- **Storage unavailable** (private mode quota exceeded): `writeFailures` silently catches — no error raised, lockout never triggers client-side (backend still rate-limits). Known.
- **Clock drift:** lockout keyed on `Date.now()`; if user changes system clock mid-session, countdown may jump. Acceptable.
- **Oldest-failure countdown bug:** per iter-1-frontend.md P2, if 5th failure happens 9 min after the 1st, displayed "1m 00s" is wrong. Known.
- **Mobile viewport <420px:** form stays `max-w-[380px]`, nothing breaks but side padding `px-12` may crowd the card. Acceptable.
- **No-JS:** `<form action="#" method="POST">` will refresh the page and put credentials in history. Known bug (iter-1-frontend.md P2).

## What must NOT happen
- No demo data, no placeholder usernames, no pre-filled credentials.
- No red/green for P&L (none should appear here at all).
- No emoji.
- No mailto: links ("Forgot password?" routes to `/login/reset`, "Request access" routes to `/request-access`).
- Page must not be crawled (robots: noindex, nofollow).

## SEO / meta
- Title: `Sign in — AlphaDesk`
- `robots: { index: false, follow: false }`
- Description: "Sign in to AlphaDesk — a systematic trading terminal for equity strategies with Claude as a pre-trade second opinion."
- OpenGraph inherits from root layout (title: "AlphaDesk — AI-Powered Trading Terminal", siteName: AlphaDesk).

## Accessibility (WCAG 2.1 AA)
- Both inputs have visible tracked-caps labels rendered via `<Eyebrow><label htmlFor>...</label></Eyebrow>`.
- Submit button has accessible name ("Sign in"); show/hide toggle's `aria-label` toggles with state.
- `aria-describedby="login-error"` attaches when an error exists.
- Error and lockout lines are `role="alert" aria-live="assertive"`.
- Focus rings visible on every interactive element (including the forgot / request-access links).
- Color contrast: gold brand text on bg ≈ 7:1 (AA large); ink-1000 body ≈ 15:1; coral error text on bg ≈ 4.7:1.
