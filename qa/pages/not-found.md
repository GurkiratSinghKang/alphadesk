# Not found (404) — expected behavior

## Route
- URL: any URL that does not map to a route.
- Access: public.
- Redirects: none.
- Source: `frontend/src/app/not-found.tsx`.

## Layout (all breakpoints)
Own full-bleed wrapper — does NOT use `MarketingShell` or the dashboard chrome:
```
<div class="min-h-screen bg-bg text-fg">
  <div class="mx-auto flex min-h-screen max-w-[720px] flex-col justify-center gap-10 px-6 py-16">
    ...
  </div>
</div>
```

### Structure
1. `Eyebrow` "§ · Missing page".
2. Content block (flex-col gap-5):
   - Mono 13px uppercase letter-spaced 0.16em `text-fg-hint` "404".
   - `Display size="lg"` Newsreader italic (max-w 14ch) "Not on the tape.".
   - Italic-serif 16px `text-fg-muted` line-height snug: "The page you requested is not in the desk's registry. It may have moved, been retired, or never existed in the first place.".
3. Two action buttons (flex-wrap):
   - Primary "Back to AlphaDesk" — gold bg `bg-brand`, ink-1000 text, hover `bg-gold-300`, routes to `/`.
   - Secondary "Read the docs" — `bg-bg-elev-1` with border, routes to `/docs`.

### Typography roles
- H1: Newsreader italic display-lg "Not on the tape."
- "404" label: JetBrains Mono 13px tracked `text-fg-hint`.
- Eyebrow: tracked-caps sans.
- Body: italic-serif 16px.

### Palette check
- `bg-bg` warm near-black.
- Gold brand only on the primary CTA.
- No P&L colors.

## Mobile
- `max-w-[720px]` auto-centers; `px-6 py-16` keeps margins readable on phones.
- Buttons wrap if needed.

## Interactive elements

### "Back to AlphaDesk" button
- Next `Link href="/"` styled as primary gold CTA, ink-1000 text.

### "Read the docs" button
- Next `Link href="/docs"` styled as secondary outlined button.

## Expected states
- Static — only one rendered state.

## Edge cases
- **From an authenticated context:** the 404 page has no chrome (no TopBar, no StatusStrip, no overlays), so context about the user session is lost. User can still click "Back to AlphaDesk" to return.
- **From marketing context:** same — user loses the MarketingShell nav. The two action buttons are the only way out.

## What must NOT happen
- No stack trace or debug info.
- No emoji.
- No P&L colors, no hex.

## SEO / meta
- Next.js automatically sets HTTP status 404 for `not-found.tsx` renders.
- Title inherits root unless overridden (it is not).

## Accessibility (WCAG 2.1 AA)
- Single H1.
- Two action buttons have real href labels ("Back to AlphaDesk", "Read the docs"); focus rings visible.
- Color contrast: H1 ink-1000 on bg ≈ 15:1 (AAA); italic-serif muted ≈ 6:1 (AA).
