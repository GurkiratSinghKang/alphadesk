import { describe, it, expect } from "vitest";

import { envelopeToNewsArticles } from "../_lib/envelopeToNewsArticles";

describe("envelopeToNewsArticles", () => {
  describe("V1.1 — empty-URL articles must not leak through", () => {
    it("drops articles with url=''", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "Wall Street consensus: TSLA is top pick for swing traders",
            url: "",
            source: "MarketWatch",
            published_at: "2026-05-06 23:40:00",
          },
        ],
      });
      expect(result).toEqual([]);
    });

    it("drops articles with whitespace-only url", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "TSLA dividend increase signals management confidence",
            url: "   ",
            source: "Reuters",
            published_at: "2026-05-06 23:40:00",
          },
        ],
      });
      expect(result).toEqual([]);
    });

    it("keeps articles with a real url", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "AMD reports Q1 results",
            url: "https://reuters.com/amd-q1",
            source: "Reuters",
            published_at: "2026-05-06 23:40:00",
          },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result?.[0].url).toBe("https://reuters.com/amd-q1");
    });
  });

  describe("B2.1 / B2.6 — rich chip fields propagated from wire envelope", () => {
    it("extracts magnitude, confidence, and source_priority", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "AMD beats Q1 estimates by 15%",
            url: "https://reuters.com/amd",
            source: "Reuters",
            published_at: "2026-05-06 23:40:00",
            sentiment: "bullish",
            magnitude: "large",
            confidence: 0.9,
            source_priority: 50,
            duplicate_count: 2,
          },
        ],
      });
      expect(result).toHaveLength(1);
      const article = result![0];
      expect(article.sentiment).toBe("bullish");
      expect(article.magnitude).toBe("large");
      expect(article.confidence).toBe(0.9);
      expect(article.sourcePriority).toBe(50);
      expect(article.duplicateCount).toBe(2);
    });

    it("coerces unknown magnitude values to null", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "AMD news",
            url: "https://reuters.com/amd",
            source: "Reuters",
            published_at: "2026-05-06 23:40:00",
            magnitude: "ginormous", // not in the small/medium/large set
          },
        ],
      });
      expect(result?.[0].magnitude).toBeNull();
    });

    it("falls back to null when magnitude/confidence/source_priority absent", () => {
      const result = envelopeToNewsArticles({
        articles: [
          {
            title: "AMD news",
            url: "https://reuters.com/amd",
            source: "Reuters",
            published_at: "2026-05-06 23:40:00",
          },
        ],
      });
      const article = result![0];
      expect(article.magnitude).toBeNull();
      expect(article.confidence).toBeNull();
      expect(article.sourcePriority).toBeNull();
      expect(article.duplicateCount).toBe(0);
    });
  });

  describe("envelope shape guards", () => {
    it("returns null for null/undefined envelope", () => {
      expect(envelopeToNewsArticles(null)).toBeNull();
      expect(envelopeToNewsArticles(undefined)).toBeNull();
    });

    it("returns null when articles is not an array", () => {
      expect(envelopeToNewsArticles({ articles: "oops" })).toBeNull();
    });

    it("skips articles missing required string fields", () => {
      const result = envelopeToNewsArticles({
        articles: [
          { title: 123, url: "https://x.com", source: "x", published_at: "2026-05-06" },
          { title: "ok", url: "https://x.com/ok", source: "x", published_at: "2026-05-06" },
        ],
      });
      expect(result).toHaveLength(1);
      expect(result?.[0].title).toBe("ok");
    });
  });
});
