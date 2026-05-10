// 2026-05-10 (honest empty-state): the previous map remapped slugs to
// the design's mock strategy names — e.g. earnings-options-play →
// "PEAD" (a different strategy entirely), trading-agents-research →
// "AI Alpha" (which doesn't exist in the registry). Both were false
// identities. The redesigned StrategyPlaybook now does its own lookup
// against the live `/api/v1/strategies` registry. Mappings here only
// remain for slugs whose canonical display name differs from their
// humanised slug (e.g. `momentum-quality` → "Momentum & Quality").
//
// `earnings-options-play` is deliberately omitted — it ships its own
// 790-line research screener at /strategies/earnings-options-play
// (EarningsCalendarSidebar + FiltersBar + EarningsDetailPanel +
// Claude full-research orchestration). `trading-agents-research` is
// likewise omitted — its playbook view does the registry lookup and
// renders honestly when the slug isn't in the registry.
const STRATEGY_SLUG_TO_NAME: Record<string, string> = {
  "momentum-quality": "Momentum & Quality",
  "regime-adaptive": "Regime Adaptive",
  "mean-reversion": "Mean Reversion",
  "pairs-trading": "Pairs · Sector",
  "pairs-stat-arb": "Pairs · Sector",
};

export function designStrategyNameFromSlug(slug = "momentum-quality") {
  const lowered = String(slug).toLowerCase();
  return (
    STRATEGY_SLUG_TO_NAME[lowered] ||
    String(slug)
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") ||
    slug
  );
}
