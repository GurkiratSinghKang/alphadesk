import DesignSurface from "@/components/design-v2/DesignSurface";
import { designStrategyNameFromSlug } from "@/components/design-v2/strategyNames";

interface StrategyPageProps {
  params: Promise<{ id: string }>;
}

export default async function StrategyPage({ params }: StrategyPageProps) {
  const { id } = await params;
  return <DesignSurface page="playbook" strategyName={designStrategyNameFromSlug(id)} />;
}
