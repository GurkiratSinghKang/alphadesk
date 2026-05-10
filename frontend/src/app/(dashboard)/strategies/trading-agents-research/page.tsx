// 2026-05-10 (honest empty-state): previously passed `strategyName="AI Alpha"`
// to DesignSurface, which gave this slug a fake identity ("AI Alpha"
// doesn't exist in the strategy registry). Pass the actual slug so
// the playbook does a real registry lookup against
// `/api/v1/strategies` instead of inventing a name.
import DesignSurface from "@/components/design-v2/DesignSurface";

export default function TradingAgentsResearchPage() {
  return <DesignSurface page="playbook" strategyName="trading-agents-research" />;
}
