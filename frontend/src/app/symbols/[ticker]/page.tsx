"use client";

// Opt out of static prerender. The (dashboard) layout uses client-only
// hooks (useWs etc.) that throw outside the Providers tree; Next.js's
// build-time prerender pass tries to render any (dashboard)-grouped
// route's layout and crashes with "useWs must be used within Providers".
// This route lives OUTSIDE the (dashboard) group on purpose, mirroring
// /admin/control-center, and we still set force-dynamic so the route
// renders only at request time. Do NOT move this file under
// `src/app/(dashboard)/` — `next build` will fail.
export const dynamic = "force-dynamic";

import { notFound, useParams } from "next/navigation";

import { SymbolPageClient } from "./_components/SymbolPageClient";
import { normalizeSymbol } from "./_lib/normalizeSymbol";

/**
 * /symbols/[ticker] — ticker research page (T1 shell).
 *
 * Task 1 of the ticker research MVP: route shell + symbol normalization
 * only. The full surface (quote header, IV/skew, news, etc.) lands in
 * subsequent tasks. Auth is handled implicitly: any API call that 401s
 * gets redirected to /login by the existing api-error infrastructure,
 * so this page itself does not gate on auth.
 */
export default function SymbolPage() {
  const params = useParams<{ ticker: string }>();
  const sym = normalizeSymbol(params.ticker);

  if (!sym) {
    notFound();
  }

  return <SymbolPageClient symbol={sym} />;
}
