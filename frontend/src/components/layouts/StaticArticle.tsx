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
      <article className="mx-auto max-w-[780px] py-16">
        <Display size="lg" as="h1">
          {title}
        </Display>
        <p
          className="mt-4 font-mono text-label uppercase text-fg-hint"
          style={{ letterSpacing: "0.18em" }}
        >
          Last updated &middot; {lastUpdated}
        </p>

        {note ? <div className="mt-10">{note}</div> : null}

        <div className="mt-16 flex flex-col gap-14">
          {clauses.map((c) => (
            <section key={c.index}>
              <SectionRule tag={`§ ${c.index} · ${c.title}`} tagAs="h2" className="t-h2" />
              <div className="mt-5">{c.body}</div>
            </section>
          ))}
        </div>
      </article>
    </MarketingShell>
  );
}
