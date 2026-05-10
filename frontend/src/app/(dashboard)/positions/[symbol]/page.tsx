import DesignSurface from "@/components/design-v2/DesignSurface";

interface PositionPageProps {
  params: Promise<{ symbol: string }>;
}

export default async function PositionPage({ params }: PositionPageProps) {
  const { symbol } = await params;
  return <DesignSurface page="positions" symbol={(symbol || "NVDA").toUpperCase()} />;
}
