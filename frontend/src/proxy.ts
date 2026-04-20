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
  "/pipeline",
  "/reports",
  "/settings",
  "/strategies",
  "/trade",
];

function isKnownDashboardRoute(pathname: string): boolean {
  return KNOWN_DASHBOARD_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * CSP is owned by Caddy (see infrastructure/Caddyfile line 97, which uses
 * the `>` operator to FORCE a permissive fallback policy on every response).
 *
 * The earlier nonce/strict-dynamic flow in this proxy was disabled by the
 * INCIDENT on 2026-04-20 13:43 ET: prerendered (X-Nextjs-Cache: HIT) HTML
 * pages bake their nonce at build time, so the per-request nonce minted
 * here never matched — `strict-dynamic` then blocked every bootstrap
 * script. Caddy now force-replaces the CSP header regardless of what this
 * proxy emits, so emitting our own CSP is wasted work (and the ignored
 * `x-nonce` request header was dead code).
 *
 * Kept as a plain pass-through until a build-time hash CSP or
 * `dynamic = "force-dynamic"` approach lets us revive per-request nonces.
 */
function forwardRequest(): NextResponse {
  return NextResponse.next();
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get("access_token")?.value;
  const { pathname } = request.nextUrl;
  // Login subpaths (e.g. /login/reset) are public alongside /login itself.
  const isLoginPage = pathname === "/login" || pathname.startsWith("/login/");
  const isPublicPage = [
    "/privacy",
    "/terms",
    "/risk",
    "/docs",
    "/request-access",
  ].includes(pathname);

  // Check if token is structurally valid (3-part JWT, not expired)
  let isValidToken = false;
  if (token) {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1]));
        isValidToken = typeof payload.exp === "number" && payload.exp * 1000 > Date.now();
      }
    } catch {
      // Malformed token — treat as no token
    }
  }

  if (isValidToken) {
    // Authenticated. Bounce off /login back to the desk, otherwise let Next
    // resolve the path — including unknown paths, which fall through to
    // `not-found.tsx` (HTTP 404). Don't redirect unknown paths to /login;
    // that laundered 307 defeated Next's built-in 404 handler.
    if (isLoginPage) {
      // Redirects don't need a CSP (no HTML body), but Caddy's fallback
      // will still cover them. Return early without the nonce.
      return NextResponse.redirect(new URL("/", request.url));
    }
    return forwardRequest();
  }

  // Unauthenticated. Public pages and login pages pass through; anything
  // that looks like a protected dashboard route gets bounced to /login.
  // Unknown paths (e.g. `/this-does-not-exist`) also pass through so Next
  // can render the 404 page with a real 404 status.
  if (isLoginPage || isPublicPage) {
    return forwardRequest();
  }

  if (isKnownDashboardRoute(pathname)) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("access_token");
    return response;
  }

  // Unknown route, unauthenticated — let Next's not-found handler run.
  // CSP for the rendered 404 HTML is supplied by Caddy (see forwardRequest
  // comment above).
  return forwardRequest();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|robots.txt|sitemap.xml).*)",
  ],
};
