# /login/reset — expected behavior

## Route
- URL: `/login/reset`
- Access: public
- Redirects: none
- Metadata: title "Password reset — AlphaDesk"; `robots: { index: false, follow: false }`.

## Layout (all breakpoints)
Wraps in the `app/login/layout.tsx` (bare `bg-bg text-fg min-h-screen`). Own container:
```
<div class="mx-auto flex min-h-screen w-full max-w-[720px] flex-col gap-10 px-6 py-16">
```

### Structure
1. **Breadcrumb** (`aria-label="Breadcrumb"`): sans 11.5px `text-fg-muted` "Sign in / Password reset" — the "Sign in" part is a link back to `/login` with `hover:text-fg`.
2. **Header block:**
   - `Eyebrow` "§ 01 · Access"
   - `Display size="lg"` Newsreader italic "Password reset" (max-w 14ch)
   - Italic-serif body 16px `text-fg-muted` explaining self-serve reset is not wired yet ("the desk rotates passwords by hand on request").
3. **`SectionRule tag="§ 02 · How to reset"`**
4. **Instruction section:** 3 paragraphs, sans 14.5px `text-fg-dim` line-height 1.65:
   - Para 1: tells user to email `support@tradingalpha.net?subject=Password%20reset` from the address tied to their account. The mail address is a gold underlined link.
   - Para 2: explains the desk verifies ownership out-of-band then issues a one-time password.
   - Para 3: typical turnaround is within the same trading session; mention timezone if urgent.
5. **Back-to-sign-in button:** `<Link href="/login">` styled as `inline-flex items-center gap-2 rounded-sm border border-border bg-bg-elev-1 px-4 py-2 font-sans text-[12px] font-semibold text-fg transition-colors hover:bg-bg-elev-2`. Label: "Back to sign in".

### Typography roles
- H1: Newsreader italic display-lg, ink-1000.
- Eyebrow: tracked-caps `--font-ui` 10.5px `text-fg-muted`.
- Body: sans 14.5px line-height 1.65 `text-fg-dim`.
- Italic-serif caption below H1: `--font-display italic` 16px `text-fg-muted`.

### Palette check
- Background `bg-bg`.
- Accent: `text-brand` on the mailto link, `bg-bg-elev-1` on the back button.
- No P&L colors.

## Mobile (<768px)
- `max-w-[720px]` auto-centers; `px-6` keeps breathing room on small screens.
- Breadcrumb, header, section rule, instructions stack naturally.
- Back button remains inline, not full width.

## Interactive elements

### "Sign in" breadcrumb link
- Routes to `/login` via Next `Link`. Hover adds `text-fg`.

### support@tradingalpha.net mailto
- `href="mailto:support@tradingalpha.net?subject=Password%20reset"`
- Style: `text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300`.

### "Back to sign in" button
- Routes to `/login`. Sans 12px semibold.

## Expected states
- Initial / only state: static article. No loading, no error — this page has no data source.

## Edge cases
- **User navigates here via email:** per iter-1-frontend.md P3, this page intentionally bypasses `MarketingShell` so there is no top nav. The only links out are the breadcrumb ("Sign in"), mailto, and the "Back to sign in" button. Users cannot reach `/docs`, `/privacy`, `/terms`, `/risk` directly.
- **Email client absent:** clicking the mailto may do nothing. UI gives no fallback (no copy-to-clipboard).

## What must NOT happen
- No live form (this is intentionally a static surface).
- No P&L colors, no emoji, no hex.
- No placeholder "Enter your email" input box — the content explicitly says there is no self-serve reset.

## SEO / meta
- Title: `Password reset — AlphaDesk`
- Description: "Request a manual password reset for your AlphaDesk account. Automated reset is not wired yet; the desk will rotate your password on request."
- `robots: { index: false, follow: false }`.

## Accessibility (WCAG 2.1 AA)
- Breadcrumb nav has `aria-label="Breadcrumb"`.
- mailto link has accessible name from its text.
- "Back to sign in" button is a real `<a>` (via Next Link), tab-focusable.
- Heading hierarchy: H1 "Password reset" — single top-level.
- Color contrast: body `text-fg-dim` on bg ≈ 8:1.
