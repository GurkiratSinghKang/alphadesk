/**
 * normalizeSymbol — pure helper used by `/symbols/[ticker]` route to clean
 * the dynamic segment before any downstream lookup.
 *
 * Rules:
 *  - trim whitespace
 *  - upper-case
 *  - strip every char outside `[A-Z0-9.-]`
 *  - reject empty result
 *  - reject anything > 12 chars (longest real ticker we expect; OCC option
 *    symbols are out of scope for this surface)
 *
 * Returns the cleaned symbol or `null` when the input is unusable. The page
 * treats `null` as a 404.
 */
export function normalizeSymbol(input: string | undefined | null): string | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (cleaned.length === 0 || cleaned.length > 12) return null;
  return cleaned;
}
