import type { EarningsNewsArticle } from "@/types";

// V1.1 — Defense-in-depth against the "fake TSLA news on production" bug.
//
// Before this guard, /symbols/TSLA was rendering five plausible-looking
// headlines (e.g. "TSLA dividend increase signals management confidence" —
// Tesla doesn't pay a dividend) with ``href=""`` whenever Newsdata
// rate-limited the request. The backend has been hardened to stop serving
// demo articles when an API key is configured; this mapper drops articles
// with empty/whitespace urls so any future regression cannot leak past
// this layer.
//
// We also extract ``magnitude`` / ``confidence`` / ``sourcePriority``
// from the wire envelope so the rich news chips (B2.1 / B2.6) render on
// the symbols page, not just on the earnings detail page.

export function envelopeToNewsArticles(
  value: Record<string, unknown> | null | undefined,
): EarningsNewsArticle[] | null {
  if (!value || typeof value !== "object") return null;
  const raw = value.articles;
  if (!Array.isArray(raw)) return null;
  const out: EarningsNewsArticle[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    const title = a.title;
    const url = a.url;
    const source = a.source;
    const publishedAt = a.published_at;
    if (
      typeof title !== "string" ||
      typeof url !== "string" ||
      typeof source !== "string" ||
      typeof publishedAt !== "string"
    ) {
      continue;
    }
    if (url.trim() === "") continue;
    const relevance = a.relevance_score;
    const tier = a.tier;
    const category = a.category;
    const sentiment = a.sentiment;
    const magnitude = a.magnitude;
    const confidence = a.confidence;
    const sourcePriority = a.source_priority;
    const duplicateCount = a.duplicate_count;
    out.push({
      title,
      url,
      source,
      publishedAt,
      relevanceScore: typeof relevance === "number" ? relevance : 0,
      tier: typeof tier === "number" ? tier : 2,
      category: typeof category === "string" ? category : null,
      sentiment: typeof sentiment === "string" ? sentiment : null,
      magnitude:
        magnitude === "small" || magnitude === "medium" || magnitude === "large"
          ? magnitude
          : null,
      confidence: typeof confidence === "number" ? confidence : null,
      sourcePriority: typeof sourcePriority === "number" ? sourcePriority : null,
      duplicateCount: typeof duplicateCount === "number" ? duplicateCount : 0,
    });
  }
  return out;
}
