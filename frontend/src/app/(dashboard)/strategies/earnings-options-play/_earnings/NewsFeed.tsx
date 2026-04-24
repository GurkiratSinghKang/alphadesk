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
        {news.slice(0, 10).map((a, i) => (
          <li
            key={a.url ?? i}
            className="border-b border-dotted border-[color:var(--border)] py-1"
          >
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="t-mono text-[12.5px] hover:u-brand"
            >
              {a.title}
            </a>
            <span className="ml-2 t-mono text-[11px] u-muted">
              — {a.source} · {fmtRelative(a.published_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

