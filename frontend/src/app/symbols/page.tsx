import { SymbolsDirectoryClient } from "./_components/SymbolsDirectoryClient";

// Keep this route aligned with /symbols/[ticker]. The ticker page opts out
// of static prerender because surrounding app chrome depends on client-only
// providers; the directory should behave the same way.
export const dynamic = "force-dynamic";

export default function SymbolsPage() {
  return <SymbolsDirectoryClient />;
}
