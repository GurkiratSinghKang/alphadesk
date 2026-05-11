import type { Metadata } from "next";

import MarketingShell from "@/components/layouts/MarketingShell";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";
import { ABOUT_CLAUSES } from "./_about/content";

export const metadata: Metadata = {
  title: "About AlphaDesk",
  description:
    "AlphaDesk is an AI-powered trading terminal built by AlphaDesk Labs — a small, invite-only team operating out of a Delaware LLC.",
};

/**
 * /about — proof-of-concept marketing rhythm page.
 *
 * Round-X / R4-4 (QA UI Remediation Sprint, Pillar 5 — Spacing):
 *  The R3 audit flagged that long-form marketing pages were under-cadenced —
 *  ``space-y-{6,10,12}`` had only 3 uses out of 122 total ``space-y-*``.
 *  Three new tokens (``--space-section`` 64px, ``--space-section-sm`` 40px,
 *  ``--space-prose`` 24px) were added to design-tokens.css and wired into
 *  Tailwind's @theme namespace as ``space-y-section``,
 *  ``space-y-section-sm``, ``space-y-prose`` utilities.
 *
 *  This page deliberately does NOT use ``StaticArticle`` so that the
 *  rhythm tokens are visible in the source. /privacy, /terms, /risk
 *  continue to use ``StaticArticle`` until a follow-up PR migrates the
 *  shared layout. Visual outcome: identical hierarchy, slightly more
 *  generous breathing room between hero → note → clauses → contact.
 */
export default function AboutPage() {
  return (
    <MarketingShell route="/about">
      <article className="mx-auto max-w-[780px] py-section">
        {/* Hero block — title + last-updated. ``space-y-prose`` (24px)
            keeps the eyebrow line close to its title. */}
        <header className="space-y-prose">
          <Display size="lg" as="h1">
            About AlphaDesk
          </Display>
          <p
            className="font-mono text-label uppercase text-fg-hint"
            style={{ letterSpacing: "0.18em" }}
          >
            Last updated &middot; 2026-05-11
          </p>
        </header>

        {/* Hero → clause-list break: ``mt-section`` (64px). This was
            previously ``mt-16`` (also 64px) but is now token-driven so
            the rhythm survives a future scale change without sweeping
            every marketing page. */}
        <div className="mt-section flex flex-col gap-section-sm">
          {ABOUT_CLAUSES.map((c) => (
            <section key={c.index} className="space-y-prose">
              <SectionRule tag={`§ ${c.index} · ${c.title}`} tagAs="h2" className="t-h2" />
              {c.body}
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
