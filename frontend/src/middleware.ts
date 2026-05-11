import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * BUG-067 (audit 2026-05-11, M1-01, continues 2026-04-19 BUG-040):
 * Next.js middleware managing the Content-Security-Policy migration.
 *
 * Default mode (NEXT_PUBLIC_CSP_ENFORCE_STRICT !== "1"):
 *   - Caddy's static enforced CSP (Caddyfile:142, still allows
 *     `'unsafe-inline'`) governs actual blocking.
 *   - This middleware ALSO sets a strict
 *     `Content-Security-Policy-Report-Only` header so browsers log
 *     violations to `/api/v1/security/csp-report` without blocking.
 *   - The team uses the accumulated Report-Only payloads to audit
 *     every inline source that would need a nonce or a refactor
 *     before the enforced flip.
 *
 * Strict mode (NEXT_PUBLIC_CSP_ENFORCE_STRICT === "1"):
 *   - Middleware mints a per-request base64 nonce.
 *   - Sets ENFORCED `Content-Security-Policy: ... 'nonce-X'
 *     'strict-dynamic'` (no `'unsafe-inline'`) so non-nonced inline
 *     scripts are BLOCKED.
 *   - The nonce is passed to the root layout via an `x-nonce` request
 *     header so Next.js's `<NextScript nonce={nonce}>` (in
 *     `app/layout.tsx`) and any `<Script>` tags can stamp it on
 *     emitted inline scripts. Next.js auto-applies the nonce to its
 *     own internal `__next_f` streaming pushes when it sees the
 *     nonce in headers.
 *   - Caddy's static CSP (Caddyfile:142) is still served as a SECOND
 *     header. Per CSP3 multi-header semantics, browsers enforce BOTH
 *     policies independently — Caddy's loose policy + middleware's
 *     strict policy together = strict wins (a non-nonced inline
 *     would pass Caddy's `'unsafe-inline'` but fail the middleware's
 *     nonce-only policy → blocked).
 *
 * Rollback path (when strict mode is enabled and something blanks
 * the page):
 *   1. Unset `NEXT_PUBLIC_CSP_ENFORCE_STRICT` in prod env, redeploy.
 *      ~2 min. Drops the enforced strict header; Report-Only resumes.
 *   2. Or, set `NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY=1` to kill both
 *      paths entirely without a code change.
 *
 * Why both modes share a single middleware:
 *   - Single source of truth for the policy string (one place to
 *     audit, one place to extend).
 *   - The flag flip is a one-line env-var change; no code deploy
 *     needed between Report-Only-only and enforced-strict.
 *   - Both modes need the same nonce generation (Report-Only uses
 *     it too so reports show which scripts WOULD have passed).
 *
 * Historical incidents (in case the team is reading this):
 *   - 2026-04-20 (Wave 3M): nonce-via-proxy.ts → blank-page login
 *     because prerendered HTML had stale nonces baked in. FIX:
 *     `force-dynamic` on layouts that emit nonce-bearing scripts.
 *     See BUG-067-CSP-NONCE-PLAN.md prereq #2.
 *   - 2026-04-24 (Round-6 L-2): strict CSP shipped into a broken
 *     deploy pipeline. FIXED by deploy.yml M-2 work
 *     (.github/workflows/deploy.yml:480 `</dev/null` redirect).
 *
 * To verify before flipping strict mode in prod:
 *   - 1 week+ of Report-Only data with no surprise sources.
 *   - `force-dynamic` on `app/layout.tsx`,
 *     `app/(dashboard)/layout.tsx`, `app/login/layout.tsx`.
 *   - Staging deploy with `NEXT_PUBLIC_CSP_ENFORCE_STRICT=1` for
 *     ~1 day, manual smoke across Chrome / Safari / Firefox.
 *   - Post-deploy smoke (`qa/post-deploy/smoke-audit-2026-05-11.sh`)
 *     extended to check `Content-Security-Policy` (enforced)
 *     contains `nonce-` and lacks `unsafe-inline`.
 */

const REPORT_URI = "/api/v1/security/csp-report";

function strictPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    `report-uri ${REPORT_URI}`,
  ].join("; ");
}

// Edge-runtime crypto is available globally. Use `randomUUID` then
// base64 it so the value is a CSP-legal source token. UUIDs are
// 16 bytes → 22 base64 chars; CSP allows the full base64 alphabet.
function mintNonce(): string {
  const uuid = crypto.randomUUID();
  // Replace dashes and base64-encode the hex bytes (atob/btoa are
  // available in Edge runtime).
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  // btoa expects a binary string; assemble it.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // CSP nonce value can be base64 (RFC4648); no need to strip padding.
  return typeof btoa !== "undefined"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
}

export function middleware(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY === "1") {
    return NextResponse.next();
  }

  const nonce = mintNonce();
  const policy = strictPolicy(nonce);

  // Pass the nonce to the React tree via a request header. The root
  // layout reads it via `headers()` and stamps `<NextScript
  // nonce={nonce}>` so Next.js's internal __next_f pushes get the
  // nonce too. This is the standard pattern from
  // https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const enforceStrict = process.env.NEXT_PUBLIC_CSP_ENFORCE_STRICT === "1";
  if (enforceStrict) {
    // Strict mode: middleware OWNS the enforced CSP. Caddy's static
    // CSP is still emitted as a second header; the browser enforces
    // BOTH → strict wins.
    response.headers.set("Content-Security-Policy", policy);
  } else {
    // Default: middleware only sets Report-Only. Caddy's loose
    // enforced CSP governs actual blocking. Browsers log violations
    // to REPORT_URI without blocking.
    response.headers.set("Content-Security-Policy-Report-Only", policy);
  }
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
