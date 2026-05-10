// 2026-05-10 (honest empty-state): the previous map remapped slugs to
// the design's mock strategy names — e.g. earnings-options-play →
// "PEAD", trading-agents-research → "AI Alpha". Those mappings were
// false: PEAD is a different strategy, and there is no "AI Alpha" in
// the registry. The redesigned StrategyPlaybook now does its own
// lookup against the live `/api/v1/strategies` registry, so this
// function just hands the raw slug through (humanised for the page
// title until the registry hit returns the canonical name).
export function designStrategyNameFromSlug(slug = "momentum-quality") {
  return String(slug)
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || slug;
}
