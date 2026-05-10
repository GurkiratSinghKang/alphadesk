import DesignSurface from "@/components/design-v2/DesignSurface";

interface TradePageProps {
  searchParams?: Promise<{ symbol?: string | string[] }>;
}

function normalizeTradeSymbol(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value || "NVDA")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 16) || "NVDA";
}

export default async function Page({ searchParams }: TradePageProps) {
  const params = await searchParams;
  return <DesignSurface page="trade" symbol={normalizeTradeSymbol(params?.symbol)} />;
}
