import DesignSurface from "@/components/design-v2/DesignSurface";

export default async function SymbolPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return <DesignSurface page="ticker" symbol={(ticker || "NVDA").toUpperCase()} />;
}
