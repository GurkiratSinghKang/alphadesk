import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * BUG-067 (audit 2026-05-11, M1-01, continues 2026-04-19 BUG-040):
 * Next.js middleware that sets a strict `Content-Security-Policy-
 * Report-Only` header in parallel with the enforced CSP that Caddy
 * still serves (`infrastructure/Caddyfile:142`).
 *
 * Why Report-Only and not enforced:
 * ─────────────────────────────────
 * Two prior attempts to drop `'unsafe-inline'` from the enforced
 * script-src were rolled back after live incidents — see
 * `.audit/2026-05-11/BUG-067-CSP-NONCE-PLAN.md` for the
 * 2026-04-20 (nonce + stale prerender) and 2026-04-24 (deploy
 * pipeline didn't recreate the frontend container) blank-page
 * stories. The historical comment in `Caddyfile:128-138` notes
 * "Report-Only had been in place long enough to inventory inline
 * usage" — but that data is now ~3 weeks stale and any new
 * inline-script additions since then would slip through.
 *
 * This middleware re-introduces continuous Report-Only collection
 * without touching enforcement. Browsers log violations to
 * `/api/v1/security/csp-report` (already wired in
 * `backend/api/routes/security.py:63`) but DO NOT block any
 * scripts — the enforced Caddy header (still `'unsafe-inline'`)
 * governs actual behavior. When the M-2 deploy reliability work
 * lands and the team is ready to flip to enforced strict CSP,
 * the Report-Only payloads accumulated here name every inline
 * source that needs a nonce or a refactor.
 *
 * Failure modes & rollback:
 *  - Browser ignores Report-Only it doesn't understand → no effect.
 *  - Middleware itself raises → response shipped without the header
 *    (no degradation to the existing enforcement).
 *  - Volume of reports overwhelms the backend → the report endpoint
 *    has its own rate limit; worst case we get fewer reports.
 *  - To kill the middleware entirely without a deploy, set env
 *    `NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY=1` — short-circuits to a
 *    pass-through.
 *
 * What the strict Report-Only policy says:
 *  - script-src: 'self' + 'strict-dynamic' (drops 'unsafe-inline')
 *  - style-src:  'self' + the fonts.googleapis.com source we use
 *  - everything else: matches the enforced policy
 *
 * 'strict-dynamic' lets explicitly-trusted scripts load their own
 * dependencies without enumerating each one — pairs naturally with
 * the nonce migration when it eventually lands.
 */

const STRICT_REPORT_ONLY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'strict-dynamic'",
  "style-src 'self' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
  "report-uri /api/v1/security/csp-report",
].join("; ");

export function middleware(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY === "1") {
    return NextResponse.next();
  }
  const response = NextResponse.next();
  // Browsers prefer the more-strict header only when it's
  // Report-Only — the existing enforced CSP from Caddy continues
  // to govern actual loading. Both headers can coexist per
  // CSP spec.
  response.headers.set(
    "Content-Security-Policy-Report-Only",
    STRICT_REPORT_ONLY_POLICY,
  );
  return response;
}

// Run on every navigation/document response but skip Next.js's
// internal static asset paths and API routes (Next's API routes
// proxy to the FastAPI backend; the backend already sets its own
// security headers).
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (have their own header set by FastAPI / Caddy)
     * - _next/static (CDN-cached, frozen response headers)
     * - _next/image (image optimizer, separate header policy)
     * - favicon, manifest, sitemap, robots
     */
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sitemap.xml|robots.txt).*)",
  ],
};
