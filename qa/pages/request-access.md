# /request-access — expected behavior

## Route
- URL: `/request-access`
- Access: public
- Redirects: none
- Metadata: title "Request access — AlphaDesk"; `robots: { index: false, follow: false }`.

## Layout (desktop ≥640px)
Wraps in `MarketingShell` with `route="/request-access"` (the primary nav includes Docs / Privacy / Terms / Risk; the "Sign in" text link and "Request access" gold CTA remain in the header — the CTA will link to the current page but the user is already here). Inner:
```
<article class="mx-auto max-w-[780px] py-16">
```

### Structure
1. `Eyebrow` "§ 01 · Access"
2. `Display size="lg"` Newsreader italic "Request access" (max-w 16ch)
3. Italic-serif intro 16px `text-fg-muted` line-height snug: "AlphaDesk is invite-only. The desk onboards one book at a time, so the process is deliberately manual."
4. `SectionRule tag="§ 02 · What we ask for"` with an unordered list (3 items, sans 14.5px `text-fg-dim` line-height 1.65):
   - Your name, firm or context, and jurisdiction you trade from.
   - A short note on the book you would run (approximate AUM, instruments, live vs paper).
   - How you heard about the desk, if through a referral.
5. `SectionRule tag="§ 03 · What happens next"` with an unordered list (3 items):
   - A human reads the request, usually within a few days.
   - If it is a fit, the desk schedules a short call (risk policy, execution venue, data entitlements).
   - On approval, you receive credentials and a one-session onboarding. There is no queue jump.
6. Bottom section: `border-t border-border pt-6 mt-16` block with italic-serif 15px `text-fg-muted` reading "Send the request to [legal@tradingalpha.net](mailto:legal@tradingalpha.net?subject=AlphaDesk%20access%20request)." — the mail address is a gold underlined link.

### Typography roles
- H1: Newsreader italic display-lg, ink-1000.
- Eyebrow / SectionRule tag: tracked-caps 10.5px `text-fg-muted`.
- Body: sans 14.5px `text-fg-dim`.
- Intro / footer note: `--font-display italic`, 15–16px, `text-fg-muted`.

### Palette check
- Background inherits MarketingShell `bg-bg`.
- Accent: `text-brand` on the legal@ link and top-right "Request access" CTA in MarketingShell header.
- No P&L colors.

## Mobile (<768px)
- MarketingShell: 4 nav links hide on `<640px`, "Sign in" text + gold "Request access" CTA stay visible.
- Article `max-w-[780px]` + MarketingShell `px-6` keeps readable layout on phones.
- Known bug (iter-1-frontend.md P1): MarketingShell uses `px-12` at all breakpoints in some versions — if the nav overflows on 360px-wide devices, flag it.

## Interactive elements

### MarketingShell top nav
- α AlphaDesk wordmark (italic serif 22px, α in `text-brand`) links to `/`.
- 4 ghost links: Docs, Privacy, Terms, Risk — active one gets `text-fg`, others `text-fg-dim hover:text-fg`, `aria-current="page"` when active.
- "Sign in" ghost link routes to `/login`.
- "Request access" primary CTA (gold fill, sans 13px semibold, `rounded-sm`) — on this page it is the current route but remains clickable (reloads the same page).

### Instruction lists
- Purely static — each `<li>` is non-interactive. No copy-to-clipboard, no forms.

### legal@tradingalpha.net mailto
- `href="mailto:legal@tradingalpha.net?subject=AlphaDesk%20access%20request"`
- Style: `text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300`.

### MarketingShell footer
- 3-column footer + brand block + hairline fineprint (see `test-plan.md` §2).

## Expected states
- Static article. No loading, no error, no empty — always renders.

## Edge cases
- **Email client absent:** clicking legal@ does nothing. UI does not surface the address as copy-able text beyond the link.
- **User already signed in:** CTA still points here; no special behavior.

## What must NOT happen
- No actual request form (explicitly described as manual handling).
- No AUM input, no file upload, no captcha.
- No P&L colors, no emoji, no hex.
- No "Trust us" / hype copy.

## SEO / meta
- Title: `Request access — AlphaDesk`
- Description: "Request access to the AlphaDesk trading terminal. Access is by invitation; the desk onboards one book at a time."
- `robots: { index: false, follow: false }`.

## Accessibility (WCAG 2.1 AA)
- Heading hierarchy: one H1. SectionRules are purely presentational (not heading tags).
- Unordered lists are real `<ul><li>` elements.
- mailto link has accessible text ("legal@tradingalpha.net").
- Focus rings visible on mailto, top-nav links, and footer links.
- Color contrast: body 14.5px `text-fg-dim` ≈ 8:1 (AA).
