import type { EarningsNewsArticle } from "@/types";
import { fmtRelative } from "@/lib/intl";

export interface NewsFeedProps {
  news: EarningsNewsArticle[];
}

export default function NewsFeed({ news }: NewsFeedProps) {
  if (!news || news.length === 0) {
    return (
      <section data-slot="news-feed" className="mt-4">
        <h3 className="t-display-section italic text-[13px]">News</h3>
        <p className="mt-1 t-mono text-[12px] u-muted">— no recent news</p>
      </section>
    );
  }
  return (
    <section data-slot="news-feed" className="mt-4">
      <h3 className="t-display-section italic text-[13px]">
        News <span className="t-label u-muted">· filtered</span>
      </h3>
      <ul className="mt-1 space-y-0.5">
        {news.slice(0, 10).map((a, i) => {
          const rel = fmtRelative(a.publishedAt);
          return (
            <li
              key={a.url ?? i}
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
