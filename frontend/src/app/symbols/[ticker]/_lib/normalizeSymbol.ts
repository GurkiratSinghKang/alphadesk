export function normalizeSymbol(input: string | undefined | null): string | null {
  if (!input) return null;
  const cleaned = input.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
  if (cleaned.length === 0 || cleaned.length > 12) return null;
  return cleaned;
}
