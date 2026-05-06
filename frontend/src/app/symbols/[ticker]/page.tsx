// Opt out of static prerender. The (dashboard) layout uses client-only
// hooks (useWs etc.) that throw outside the Providers tree; Next.js's
// build-time prerender pass tries to render any (dashboard)-grouped
// route's layout and crashes with "useWs must be used within Providers".
// This route lives OUTSIDE the (dashboard) group on purpose, mirroring
// /admin/control-center, and we still set force-dynamic so the route
// renders only at request time. Do NOT move this file under
// `src/app/(dashboard)/` — `next build` will fail.
//
// This is a Server Component (no "use client" directive) because
// `notFound()` from `next/navigation` only triggers a real 404 status
// in Server Components — in a client component it throws an unhandled
// error instead. See https://nextjs.org/docs/app/api-reference/functions/not-found.
export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";

import { normalizeSymbol } from "./_lib/normalizeSymbol";

export default async function SymbolPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const sym = normalizeSymbol(ticker);

  if (!sym) {
    notFound();
  }

  return (
    <main data-testid="symbol-page" data-sym={sym}>
      <h1 className="font-display text-h1">{sym}</h1>
      <p className="t-mono u-muted">Page shell — sections coming in tasks 2-12.</p>
    </main>
  );
}
