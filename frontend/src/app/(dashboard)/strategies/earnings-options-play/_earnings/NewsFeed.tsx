"use client";

import { useState } from "react";
import type { EarningsNewsArticle } from "@/types";
import { fmtRelative } from "@/lib/intl";
import { useTick } from "@/lib/time";

export interface NewsFeedProps {
  news: EarningsNewsArticle[];
}

// Round-4 (CLUSTER E/16): cap initial render at 10, allow expand to a
// hard cap of 50. Hard cap protects layout & re-render perf when a
// vendor returns a long unfiltered firehose.
const COLLAPSED_LIMIT = 10;
const HARD_CAP = 50;

export default function NewsFeed({ news }: NewsFeedProps) {
  const [showAll, setShowAll] = useState(false);

  // Round-4 (CLUSTER E/14): 60s tick keeps the "5m ago" labels honest
  // without refetching the news feed payload. fmtRelative reads the
  // wall clock at render time, so a re-render is enough.
  useTick(60_000);

  if (!news || news.length === 0) {
    return (
      <section data-slot="news-feed" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">News</h3>
        <p className="mt-1 t-mono text-[12px] u-muted">— no recent news</p>
      </section>
    );
  }
  const total = news.length;
  const overflow = total > COLLAPSED_LIMIT;
  const visibleLimit = showAll ? Math.min(total, HARD_CAP) : COLLAPSED_LIMIT;
  const visible = news.slice(0, visibleLimit);

  return (
    <section data-slot="news-feed" className="mt-4">
      <h3 className="t-display-section italic text-[13px]">
        News <span className="t-label u-muted">· filtered</span>
      </h3>
      {overflow && (
        <p className="mt-0.5 t-mono text-[11px] u-muted" data-slot="news-feed-overflow">
          Showing {visible.length} of {total}
          {" · "}
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="not-italic underline u-brand hover:u-brand"
            data-slot="news-feed-toggle"
          >
            {showAll ? "Show less" : "Show all"}
          </button>
        </p>
      )}
      <ul className="mt-1 space-y-0.5">
        {visible.map((a, i) => {
          const rel = fmtRelative(a.publishedAt);
          // Round-7 / EP-9: ``key={a.url ?? i}`` collided when two
          // syndicated providers returned the same Reuters URL (FMP
          // commonly does this) — React warned and only rendered one.
          // Append publishedAt + index so duplicates remain distinct
          // and items missing a URL don't index-key into the head of
          // the list (which shifts every refetch as new headlines
          // arrive, causing flicker / lost focus on hover).
          const itemKey = `${a.url ?? "no-url"}::${a.publishedAt ?? "no-ts"}::${i}`;
          return (
            <li
              key={itemKey}
              className="border-b border-dotted border-[color:var(--border)] py-1"
            >
              {/* B-95 — `title` surfaces source + time on hover for sighted
                  users. The trailing metadata span is aria-hidden so the
                  link's accessible name is just the headline, not
                  "Headline — Source · 3h ago". */}
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${a.source} — ${rel}`}
                className="t-mono text-[12.5px] hover:u-brand"
              >
                {a.title}
              </a>
              <span
                aria-hidden="true"
                className="ml-2 t-mono text-[11px] u-muted"
              >
                — {a.source} · {rel}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
