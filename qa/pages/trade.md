# /trade — expected behavior

## Route
- URL: `/trade`
- Access: requires-auth
- Redirects: **always** — the page is a redirect stub (`useEffect(() => router.replace("/"), [])`). Expected behavior: browser lands on `/` within one tick.
- Metadata: inherits root layout.

## Layout
The page body is a `<TradeRedirect />` client component that renders `null` on mount while `router.replace("/")` fires. The (dashboard) layout may briefly render its skeleton (TopBar + TickerTape + StatusStrip + main empty) before the replace resolves; once the router navigates to `/`, the flagship desk takes over.

## Interactive elements
- None — no visible DOM from the page itself.

## Expected states
- **Transient render (<100ms):** (dashboard) layout skeleton: 44px TopBar strip + 28px status strip + empty main. Replace fires.
- **Post-redirect:** URL address bar shows `/`; the flagship desk page renders.

## Edge cases
- **Direct link in email / share:** old bookmarks / links to `/trade` must still work — they do, via this redirect.
- **Back button after redirect:** `router.replace` *replaces* the history entry, so pressing back does not re-enter `/trade` — it goes to whatever preceded the visit to `/trade`. This is intentional.
- **Slow client JS:** until JS hydrates, the page is genuinely blank (no SSR content). Acceptable because it is a short-lived stub.
- **Auth expired:** if the backend returns 401 on `/`, the auth guard should redirect to `/login`. Behavior depends on the guard, not this page.

## What must NOT happen
- No flash of the old legacy trade workspace (the pre-F3 panel layout has been retired).
- No toast, no error, no loading spinner.
- `/trade` should never render a full page body with contentinfo.

## SEO / meta
- Not intended to be indexed since it redirects. The root layout title applies briefly.

## Accessibility (WCAG 2.1 AA)
- Redirect stub is acceptable a11y-wise as long as it completes quickly. Screen readers may not announce the replace; users rely on the destination page for content.

## Source
- `frontend/src/app/(dashboard)/trade/page.tsx` — 22-line stub; comment: "Before F3 this page owned the trading workspace. The new flagship desk (at `/`) composes `DeskLayout` with the Layer-2 composites, and the legacy panel-based workspace is deferred to the panel retirement pass (F4). This stub keeps existing bookmarks and internal links working by redirecting on mount."
