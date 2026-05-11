import { redirect } from "next/navigation";

export default async function TradeSymbolAliasPage({ params }: { params: Promise<{ ticker?: string }> }) {
  const { ticker } = await params;
  redirect(`/trade?symbol=${encodeURIComponent((ticker || "NVDA").toUpperCase())}`);
}
