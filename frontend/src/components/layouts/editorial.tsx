import * as React from "react";

/**
 * Editorial helpers — shared by the static marketing-surface pages
 * ────────────────────────────────────────────────────────────────
 * Small, content-free building blocks used on /docs, /privacy, /terms,
 * /risk. Keeps each page file under the 200-line limit without reinventing
 * the same bullet / link pattern six times.
 */

/**
 * Gold italic `+` bullet, mirroring the marketing-landing pricing card
 * bullet. Use inside a `<ul className="space-y-3">`.
 */
export function EditorialBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 font-sans text-body leading-[1.65] text-fg-dim before:absolute before:left-0 before:top-[1px] before:font-display before:text-body before:italic before:text-brand before:content-['+']">
      {children}
    </li>
  );
}

/**
 * mailto anchor in brand gold with the design-system underline pair.
 */
export function MailA({ address }: { address: string }) {
  return (
    <a
      href={`mailto:${address}`}
      className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
    >
      {address}
    </a>
  );
}

/**
 * External link with a brand gold underline.
 */
export function ExternalA({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
    >
      {children}
    </a>
  );
}

/**
 * Body paragraph at the editorial 15px / 1.65 rhythm used across every
 * static marketing surface.
 */
export function EditorialP({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-sans text-body leading-[1.65] text-fg-dim">
      {children}
    </p>
  );
}
