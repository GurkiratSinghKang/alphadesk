import type { Metadata } from "next";

import MarketingShell from "@/components/layouts/MarketingShell";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";
import { DOC_SECTIONS } from "./_docs/content";

export const metadata: Metadata = {
  title: "Documentation — AlphaDesk",
  description:
    "AlphaDesk user guide: dashboard, trading, strategies, pipeline, and keyboard shortcuts.",
};

export default function DocsPage() {
  return (
    <MarketingShell route="/docs">
      <article className="mx-auto max-w-[780px] py-16">
        <Display size="lg" as="h1">
          Documentation
        </Display>
        <p className="mt-4 font-sans text-numeric-md text-fg-dim">
          A working guide to the AlphaDesk terminal &mdash; operation, not
          marketing.
        </p>

        <nav
          aria-label="Table of contents"
          className="mt-10 border-t border-border pt-6"
        >
          <div
            className="mb-4 font-sans text-label font-semibold uppercase text-fg-muted"
            style={{ letterSpacing: "0.18em" }}
          >
            Contents
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DOC_SECTIONS.map((s) => (
              <li key={s.id} className="flex items-baseline gap-3">
                <span
                  className="font-mono text-label text-fg-hint"
                  style={{ letterSpacing: "0.08em" }}
                >
                  {s.index}
                </span>
                <a
                  href={`#${s.id}`}
                  className="font-sans text-body text-fg-dim transition-colors hover:text-fg"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-16 flex flex-col gap-14">
          {DOC_SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <SectionRule tag={`§ ${s.index} · ${s.title}`} />
              <div className="mt-5 flex flex-col gap-4">
                {s.content.map((paragraph, i) => (
                  <p
                    key={i}
                    className="font-sans text-body leading-[1.65] text-fg-dim"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-16 border-t border-border pt-6">
          <p className="font-display italic text-body text-fg-muted">
            Need help? Reach the desk at{" "}
            <a
              href="mailto:support@tradingalpha.net"
              className="text-brand underline decoration-brand-dim underline-offset-4 hover:text-gold-300"
            >
              support@tradingalpha.net
            </a>
            .
          </p>
        </div>
      </article>
    </MarketingShell>
  );
}
