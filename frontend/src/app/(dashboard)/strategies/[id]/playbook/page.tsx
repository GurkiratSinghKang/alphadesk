import DesignSurface from "@/components/design-v2/DesignSurface";
import { designStrategyNameFromSlug } from "@/components/design-v2/strategyNames";

interface StrategyPlaybookPageProps {
  params: Promise<{ id: string }>;
}

export default async function StrategyPlaybookPage({ params }: StrategyPlaybookPageProps) {
  const { id } = await params;
  return <DesignSurface page="playbook" strategyName={designStrategyNameFromSlug(id)} />;
}
