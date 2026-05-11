import { redirect } from "next/navigation";

export default async function SymbolAliasPage({ params }: { params: Promise<{ ticker?: string }> }) {
  const { ticker } = await params;
  redirect(`/symbols/${encodeURIComponent((ticker || "NVDA").toUpperCase())}`);
}
