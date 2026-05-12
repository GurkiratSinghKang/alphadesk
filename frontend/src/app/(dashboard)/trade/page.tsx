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
  const normalized = normalizeTradeSymbol(params?.symbol);
  // 2026-05-11 (iter3 audit P1.1): NVDA→AAPL→back navigation left the
  // page blank — the dynamic-imported DesignSurface didn't re-resolve
  // when only its `symbol` prop changed, and the internal
  // `useEffect [initialSymbol]` reset state without re-mounting the
  // tree. Keying the surface on the normalized symbol forces a clean
  // re-mount on each symbol change so back/forward, deep-links, and
  // search navigations all paint correctly.
  return <DesignSurface key={normalized} page="trade" symbol={normalized} />;
}
