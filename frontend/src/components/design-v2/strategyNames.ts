const STRATEGY_SLUG_TO_NAME: Record<string, string> = {
  "momentum-quality": "Momentum & Quality",
  "regime-adaptive": "Regime Adaptive",
  "earnings-options-play": "PEAD",
  "earnings-vol-premium": "PEAD",
  "mean-reversion": "Mean Reversion",
  "pairs-trading": "Pairs · Sector",
  "pairs-stat-arb": "Pairs · Sector",
  "trading-agents-research": "AI Alpha",
  "claude-alpha": "AI Alpha",
};

export function designStrategyNameFromSlug(slug = "momentum-quality") {
  return (
    STRATEGY_SLUG_TO_NAME[String(slug).toLowerCase()] ||
    String(slug)
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}
