const STRATEGY_SLUG_TO_NAME: Record<string, string> = {
  "momentum-quality": "Momentum & Quality",
  "regime-adaptive": "Regime Adaptive",
  // `earnings-options-play` deliberately omitted — it now ships its own
  // 790-line research screener at /strategies/earnings-options-play
  // (rich EOP backend: EarningsCalendarSidebar + FiltersBar +
  // EarningsDetailPanel + Claude full-research orchestration). The
  // earlier mapping pointed it at "PEAD" — which is a *different*
  // strategy with its own /strategies/pead detail page — so any
  // researcher landing on /strategies/[id] with `id=earnings-options-play`
  // got a generic PEAD design playbook instead of the real EOP product.
  // Same for `earnings-vol-premium`: it is its own strategy, not PEAD.
  "mean-reversion": "Mean Reversion",
  "pairs-trading": "Pairs · Sector",
  "pairs-stat-arb": "Pairs · Sector",
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
