import DesignSurface from "@/components/design-v2/DesignSurface";
import { designStrategyNameFromSlug } from "@/components/design-v2/strategyNames";

interface BacktestPageProps {
  params: Promise<{ id: string }>;
}

export default async function BacktestPage({ params }: BacktestPageProps) {
  const { id } = await params;
  return <DesignSurface page="backtest" strategyName={designStrategyNameFromSlug(id)} />;
}
