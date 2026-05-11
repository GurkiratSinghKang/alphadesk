import type { ReactNode } from "react";

/**
 * /login layout
 * ─────────────
 * The login page is its own editorial surface — no MarketingShell nav/footer
 * intrusion around a page whose entire purpose is a hero + form. This layout
 * simply wraps children in a full-bleed bg-bg region so the page's own grid
 * controls the composition.
 */
export default function LoginLayout({ children }: { children: ReactNode }) {
  // BUG-083 / M3-02 (audit 2026-05-11): /login was missing both the `<main>`
  // landmark (WCAG 1.3.1) and a target for the global skip-to-content link
  // (WCAG 2.4.1). Swap the wrapper div for `<main id="main-content">` so
  // assistive tech announces the page's primary content and the universal
  // skip link in app/layout.tsx resolves.
  return <main id="main-content" className="min-h-screen bg-bg text-fg">{children}</main>;
}
