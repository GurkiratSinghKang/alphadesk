import { describe, it, expect } from "vitest";

import { cn } from "../utils";

/**
 * `cn()` wraps `extendTailwindMerge()` so that AlphaDesk type-token classes
 * (`text-eyebrow`, `text-label`, `text-body`, `text-h1`, `text-display-md`, …)
 * live in their own font-size group. Without the override, tailwind-merge sees
 * `text-label` and `text-primary-foreground` as conflicting size utilities and
 * silently drops the second one — the bug that left the gold "Create alert"
 * CTA on `/alerts` painting gold on gold (P0-02).
 */
describe("cn", () => {
  it("preserves colour utilities when paired with type-token sizes", () => {
    const result = cn("text-label", "text-primary-foreground");
    expect(result).toContain("text-label");
    expect(result).toContain("text-primary-foreground");
  });

  it("preserves all type-token sizes alongside colour utilities", () => {
    const tokens = [
      "text-eyebrow",
      "text-label",
      "text-body-sm",
      "text-body",
      "text-h1",
      "text-h2",
      "text-h3",
      "text-display-sm",
      "text-display-md",
      "text-display-lg",
      "text-display-xl",
    ];
    for (const token of tokens) {
      const result = cn(token, "text-fg-muted");
      expect(result).toContain(token);
      expect(result).toContain("text-fg-muted");
    }
  });

  it("still de-duplicates conflicting type-token sizes", () => {
    // Two sizes from the same group should still collapse to the last one.
    const result = cn("text-label", "text-body");
    expect(result).not.toContain("text-label");
    expect(result).toContain("text-body");
  });
});
