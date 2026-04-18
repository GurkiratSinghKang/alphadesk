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
  return <div className="min-h-screen bg-bg text-fg">{children}</div>;
}
