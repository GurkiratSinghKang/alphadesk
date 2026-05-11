import { NextRequest, NextResponse } from "next/server";

/**
 * Known dashboard routes that require a valid session. Anything outside this
 * list *and* outside the public marketing surface is passed through so Next's
 * `not-found.tsx` renders a real HTTP 404 instead of being laundered into a
 * 307 to `/login`. QA evidence (qa-3a-auth-marketing.md P0) flagged the
 * previous catch-all redirect: crawlers saw 307 + login metadata on every
 * unmapped URL, which broke SEO and violated `qa/pages/not-found.md` L65.
 *
 * Authenticated users hitting a bogus URL now correctly reach the 404 page.
 * Unauthenticated users still get bounced to `/login` — the session gate
 * remains the same; only the 404 fall-through for authenticated users is
 * new.
 */
const KNOWN_DASHBOARD_ROUTES: readonly string[] = [
  "/",
  "/analytics",
  "/alerts",
  "/admin/control-center",
  "/admin/users",
  "/pipeline",
  "/positions",
  "/reports",
  "/risk",
  "/risk-dashboard",
  "/settings",
  "/strategies",
  "/symbols",
  "/trade",
  "/watchlists",
];

function isKnownDashboardRoute(pathname: string): boolean {
  if (KNOWN_DASHBOARD_ROUTES.includes(pathname)) return true;
  if (/^\/admin\/users\/[^/]+$/.test(pathname)) return true;
  if (pathname === "/strategies/trading-agents-research") return true;
  if (pathname === "/strategies/earnings-options-play") return true;
  if (/^\/symbols\/[^/]+$/.test(pathname)) return true;
  if (/^\/strategies\/[^/]+$/.test(pathname)) return true;
  if (/^\/strategies\/[^/]+\/(?:playbook|backtest)$/.test(pathname)) return true;
  if (/^\/positions\/[^/]+$/.test(pathname)) return true;
  if (/^\/watchlists\/[^/]+$/.test(pathname)) return true;
  return false;
}

const REPORT_URI = "/api/v1/security/csp-report";

/**
 * BUG-067 (audit 2026-05-11, M1-01, continues 2026-04-19 BUG-040):
 * Next.js proxy-managed Content-Security-Policy migration.
 *
 * Default mode (CSP_ENFORCE_STRICT !== "1") sets a strict
 * Content-Security-Policy-Report-Only header so browsers report
 * nonce/strict-dynamic violations without blocking. Strict mode flips
 * to an enforced Content-Security-Policy header via runtime env.
 *
 * This lives in proxy.ts rather than middleware.ts because Next 16 treats
 * proxy.ts as the replacement entrypoint and fails the production build if
 * both files are present.
 */
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

function mintNonce(): string {
  const uuid = crypto.randomUUID();
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined"
    ? btoa(bin)
    : Buffer.from(bytes).toString("base64");
}

export function applyCspToResponse(
  request: Pick<NextRequest, "headers">,
  response?: NextResponse,
): NextResponse {
  if (process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY === "1") {
    return response ?? NextResponse.next();
  }

  const nonce = mintNonce();
  let res = response;
  if (!res) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    res = NextResponse.next({
      request: { headers: requestHeaders },
    });
  }

  const policy = strictPolicy(nonce);
  if (process.env.CSP_ENFORCE_STRICT === "1") {
    res.headers.set("Content-Security-Policy", policy);
  } else {
    res.headers.set("Content-Security-Policy-Report-Only", policy);
  }
  return res;
}

function forwardRequest(request: NextRequest): NextResponse {
  return applyCspToResponse(request);
}

export function resolveBackendSessionApiBase(request: NextRequest): string {
  if (process.env.API_URL) return process.env.API_URL;
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (process.env.NODE_ENV === "production") return "http://backend:8000";
  return request.nextUrl.origin;
}

async function hasActiveBackendSession(request: NextRequest, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const apiBase = resolveBackendSessionApiBase(request);
    const sessionUrl = new URL("/api/v1/auth/session", apiBase);
    const response = await fetch(sessionUrl, {
      method: "GET",
      headers: { cookie: `access_token=${token}` },
      cache: "no-store",
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Local dev / Playwright escape hatch. When the env explicitly opts in *and*
 * NODE_ENV is not production, treat every request as authenticated. This lets
 * the visual-regression suite render protected dashboard routes without going
 * through a real login flow. Production never sees this — even if the env
 * var leaks, the NODE_ENV guard short-circuits.
 */
function isDevAuthBypassEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return process.env.DEV_AUTH_BYPASS === "1";
}

export async function proxy(request: NextRequest) {
  if (isDevAuthBypassEnabled()) {
    // Pass /login through even though we're "authenticated" — the visual
    // suite needs to snapshot the login screen, and bouncing to / would
    // make that impossible. The prod redirect-to-/ behaviour is preserved
    // when bypass is OFF (the normal else-branch below).
    return forwardRequest(request);
  }

  const token = request.cookies.get("access_token")?.value;
  const { pathname } = request.nextUrl;
  // Login subpaths (e.g. /login/reset) are public alongside /login itself.
  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/");
  const isPublicPage = [
    "/privacy",
    "/terms",
    "/legal/risk",
    "/docs",
    "/request-access",
  ].includes(pathname);

  const isValidToken = await hasActiveBackendSession(request, token);

  if (isValidToken) {
    // Authenticated. Bounce off /login back to the desk, otherwise let Next
    // resolve the path — including unknown paths, which fall through to
    // `not-found.tsx` (HTTP 404). Don't redirect unknown paths to /login;
    // that laundered 307 defeated Next's built-in 404 handler.
    if (isLoginPage) {
      // Redirects don't need a CSP (no HTML body), but Caddy's fallback
      // will still cover them. Return early without the nonce.
      return applyCspToResponse(
        request,
        NextResponse.redirect(new URL("/", request.url)),
      );
    }
    return forwardRequest(request);
  }

  // Unauthenticated. Public pages and login pages pass through; anything
  // that looks like a protected dashboard route gets bounced to /login.
  // Unknown paths (e.g. `/this-does-not-exist`) also pass through so Next
  // can render the 404 page with a real 404 status.
  if (isLoginPage || isPublicPage) {
    return forwardRequest(request);
  }

  if (isKnownDashboardRoute(pathname)) {
    const response = applyCspToResponse(
      request,
      NextResponse.redirect(new URL("/login", request.url)),
    );
    response.cookies.delete("access_token");
    return response;
  }

  // Unknown route, unauthenticated — let Next's not-found handler run.
  // CSP for the rendered 404 HTML is supplied by Caddy (see forwardRequest
  // comment above).
  return forwardRequest(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|robots.txt|sitemap.xml).*)",
  ],
};
