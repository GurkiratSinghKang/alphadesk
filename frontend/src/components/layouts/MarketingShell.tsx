import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * MarketingShell (layout · Layer 3)
 * ─────────────────────────────────
 * The editorial outer shell used by every public surface — login, docs,
 * privacy, terms, risk. Structure mirrors
 * `design-system/alphadesk-design-system/project/ui_kits/marketing-landing.html`:
 *   · 1440 max width, centered, 48px side padding
 *   · 72px top nav — italic-serif α logo, ui-sans link row, "Sign in"
 *     + primary "Request access" CTA
 *   · main region (children) — pages apply their own vertical rhythm
 *   · footer — brand + three link columns + a hairline fine-print strip
 *
 * Props:
 *  - children: ReactNode (required)
 *  - route:    current pathname so the nav can mark the active link
 *
 * No color outside tokens. No hype copy. No emoji.
 */
export interface MarketingShellProps {
  children: React.ReactNode;
  /** Current pathname — lets the nav mark the active link. */
  route?: string;
  className?: string;
}

interface NavLink {
  label: string;
  href: string;
}

const NAV_LINKS: NavLink[] = [
  { label: "Docs", href: "/docs" },
  { label: "Privacy", href: "/privacy" },
  { label: "Terms", href: "/terms" },
  { label: "Risk", href: "/risk" },
];

const FOOTER_COLS: { heading: string; items: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    items: [
      { label: "Sign in", href: "/login" },
      { label: "Docs", href: "/docs" },
    ],
  },
  {
    heading: "Company",
    items: [
      { label: "Request access", href: "/request-access" },
      { label: "Support", href: "mailto:support@tradingalpha.net" },
    ],
  },
  {
    heading: "Legal",
    items: [
      // "Risk disclosure" is the canonical label for /risk; the earlier
      // "Not investment advice" duplicate link was removed.
      { label: "Risk disclosure", href: "/risk" },
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

export default function MarketingShell({
  children,
  route,
  className,
}: MarketingShellProps) {
  const year = new Date().getFullYear();
  return (
    <div
      data-slot="marketing-shell"
      className={cn("min-h-screen bg-bg text-fg", className)}
    >
      <a
        className="sr-only focus:not-sr-only fixed top-2 left-2 z-50 px-3 py-2 bg-primary text-primary-foreground"
        href="#main"
      >
        Skip to content
      </a>
      <div className="mx-auto max-w-[1440px] px-6 sm:px-8 lg:px-12">
        <nav
          aria-label="Primary"
          className="flex h-[72px] items-center gap-8"
        >
          <Link
            href="/"
            className="flex items-baseline gap-1 font-display italic text-h2 text-ink-1000"
            style={{ letterSpacing: "-0.02em" }}
          >
            <span className="text-primary">α</span>
            <span>AlphaDesk</span>
          </Link>

          <ul className="ml-6 hidden items-center gap-6 sm:flex">
            {NAV_LINKS.map((l) => {
              const active = route === l.href;
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className={cn(
                      "font-sans text-body-sm transition-colors",
                      active ? "text-fg" : "text-fg-dim hover:text-fg"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center rounded-sm px-2 font-sans text-body-sm text-fg-dim transition-colors hover:text-fg"
            >
              Sign in
            </Link>
            <Link
              href="/request-access"
              className="inline-flex min-h-11 items-center rounded-sm bg-primary px-4 py-2 font-sans text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-300"
              style={{ letterSpacing: "0.01em" }}
            >
              Request access
            </Link>
          </div>
        </nav>

        <main id="main">{children}</main>

        <footer className="grid grid-cols-1 gap-10 border-t border-border pt-20 pb-10 sm:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div
              className="flex items-baseline gap-1 font-display italic text-[36px] text-ink-1000"
              style={{ letterSpacing: "-0.02em" }}
            >
              <span className="text-primary">α</span>
              <span>AlphaDesk</span>
            </div>
            <p className="mt-3 max-w-[360px] font-display italic text-numeric-md text-fg-muted">
              A systematic trading terminal for humans who&rsquo;d rather read the
              research than refresh the chart.
            </p>
          </div>

          {FOOTER_COLS.map((col) => (
            <div key={col.heading}>
              <div
                className="mb-4 font-sans text-label font-semibold uppercase text-fg-muted"
                style={{ letterSpacing: "0.18em" }}
              >
                {col.heading}
              </div>
              <ul className="space-y-1">
                {col.items.map((item) => (
                  <li key={`${col.heading}-${item.label}`}>
                    {item.href.startsWith("mailto:") ? (
                      <a
                        href={item.href}
                        className="block py-1 font-sans text-body-sm text-fg-dim transition-colors hover:text-fg"
                      >
                        {item.label}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="block py-1 font-sans text-body-sm text-fg-dim transition-colors hover:text-fg"
                      >
                        {item.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </footer>

        <div
          className="flex items-center justify-between border-t border-border py-5 font-mono text-label uppercase text-fg-hint"
          style={{ letterSpacing: "0.05em" }}
        >
          <span>&copy; {year} AlphaDesk Labs &middot; Not a broker-dealer</span>
          <span>&alpha; &middot; Operator-grade execution</span>
        </div>
      </div>
    </div>
  );
}
