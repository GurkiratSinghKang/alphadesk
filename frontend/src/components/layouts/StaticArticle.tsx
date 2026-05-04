import * as React from "react";

import MarketingShell from "./MarketingShell";
import Display from "@/components/typography/Display";
import SectionRule from "@/components/typography/SectionRule";

export interface StaticClause {
  index: string;
  title: string;
  body: React.ReactNode;
}

/**
 * StaticArticle (layout · composed)
 * ─────────────────────────────────
 * The shared page shell for `/privacy`, `/terms`, `/risk` (and similar
 * legal/policy surfaces). Wraps the MarketingShell with an editorial
 * article: italic-serif title, mono last-updated line, optional note
 * panel, and a column of `§ NN · Heading` sectioned clauses.
 *
 * Each page supplies only its content via the `clauses` prop; structural
 * styling lives here so the pages stay under the 200-line limit and stay
 * visually consistent.
 */
export interface StaticArticleProps {
  /** Current pathname — forwarded to MarketingShell for active-link state. */
  route: string;
  title: string;
  /** Display-ready (e.g. "2026-04-12"). Rendered in tracked-caps mono. */
  lastUpdated: string;
  /** Optional note banner shown above the clause list. */
  note?: React.ReactNode;
  clauses: StaticClause[];
}

export default function StaticArticle({
  route,
  title,
  lastUpdated,
  note,
  clauses,
}: StaticArticleProps) {
  return (
    <MarketingShell route={route}>
      {/*
       * Marketing rhythm tokens (R6-3, propagating R4-4's /about pattern):
       *  - ``py-section`` (64px) on the article frame replaces the ad-hoc
       *    ``py-16`` so the long-form vertical breathing room stays in
       *    lockstep with the rest of the marketing surfaces.
       *  - ``space-y-prose`` (24px) inside the header keeps the title and
       *    its mono last-updated line cohesively grouped — was ``mt-4``.
       *  - ``mt-section`` (64px) gates the clause list; ``mt-section-sm``
       *    (40px) gates the optional note panel — were ``mt-16`` / ``mt-10``.
       *  - ``gap-section-sm`` (40px) between sibling clauses; each clause
       *    body is ``space-y-prose`` for its own SectionRule → body break.
       *    Were ``gap-14`` / ``mt-5``.
       *  Single-component edit propagates to /privacy /terms /risk /contact.
       */}
      <article className="mx-auto max-w-[780px] py-section">
        <header className="space-y-prose">
          <Display size="lg" as="h1">
            {title}
          </Display>
          <p
            className="font-mono text-label uppercase text-fg-hint"
            style={{ letterSpacing: "0.18em" }}
          >
            Last updated &middot; {lastUpdated}
          </p>
        </header>

        {note ? <div className="mt-section-sm">{note}</div> : null}

        <div className="mt-section flex flex-col gap-section-sm">
          {clauses.map((c) => (
            <section key={c.index} className="space-y-prose">
              <SectionRule tag={`§ ${c.index} · ${c.title}`} />
              {c.body}
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
