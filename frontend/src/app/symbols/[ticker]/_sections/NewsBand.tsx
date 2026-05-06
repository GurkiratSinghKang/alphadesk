"use client";

import NewsFeed from "@/app/(dashboard)/strategies/earnings-options-play/_earnings/NewsFeed";
import type { EarningsNewsArticle } from "@/types";

export interface NewsBandProps {
  news: EarningsNewsArticle[] | null;
}

// T9 / UI-SPEC §1 Section 10. Re-uses the price-driving NewsFeed from the
// earnings-options-play strategy (already mapped to camelCase + 60s "5m
// ago" tick + tier-1 chip + relevance ranking) so the symbol page does not
// own a parallel renderer.
export function NewsBand({ news }: NewsBandProps) {
  return (
    <section
      id="news"
      data-testid="news-band"
      data-slot="news-band"
      className="rounded-md border border-border-hair bg-bg-elev-1 p-4 scroll-mt-24 mx-4 sm:mx-6 mb-6"
    >
      <h2 className="t-label u-muted">NEWS</h2>
      <NewsFeed news={news ?? []} />
    </section>
  );
}

export default NewsBand;
