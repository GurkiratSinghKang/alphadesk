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
 * Build the per-request nonce-based Content-Security-Policy.
 *
 * Wave 3M / persona-91 fix. The prior CSP (set in Caddyfile) carried
 * `script-src 'self' 'unsafe-inline'`, which neutered CSP as an XSS
 * mitigation — any injected <script>…</script> payload would execute. The
 * fix is nonce-based: we mint a cryptographically-random nonce per request,
 * Next.js stamps it onto the bootstrap <script> tag (via the `x-nonce`
 * request header + RSC), and the CSP only trusts that nonce.
 *
 * `'strict-dynamic'` lets nonce-trusted scripts load further scripts without
 * re-whitelisting hosts, which is required for Next's chunked bundle
 * loader. `https:` and `'self'` are kept as fallbacks for browsers that do
 * not honour `'strict-dynamic'` (CSP3 ignores them, CSP1/2 falls back to
 * them). We keep `'unsafe-inline'` for `style-src` because Tailwind and
 * Next still emit inline style attributes; migrating style-src to nonces
 * is a larger change and out of scope for this wave.
 *
 * `connect-src` drops the `ws://` variant — production MUST use `wss://`.
 */
function buildCsp(nonce: string): string {
  // Avoid trailing newlines — some browsers refuse CSPs that contain \r\n.
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `connect-src 'self' wss:`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}

/**
 * Mint a 128-bit random nonce encoded as base64. `crypto.randomUUID()` is
 * available in both the Node.js and Edge Proxy runtimes and is
 * cryptographically random; Next 16 defaults Proxy to Node.js, which
 * exposes the `Buffer` global used below. Base64-encoding yields a
 * compact token that is safe to embed in an HTML attribute without
 * escaping (no `<`, `>`, `"`, or `&` in the output alphabet).
 */
function mintNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * Attach the nonce request header (so Next's RSC can read it via
 * `headers().get('x-nonce')`) and the Content-Security-Policy response
 * header to the forwarded request/response pair. Returns the response
 * object the caller can further mutate (e.g. cookies).
 */
function withCsp(request: NextRequest): NextResponse {
  const nonce = mintNonce();
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Propagate the CSP on the *request* too so RSC/streaming render paths
  // that echo request headers see it; the authoritative copy is the
  // response header set below.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
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
    return withCsp(request);
  }

  // Unauthenticated. Public pages and login pages pass through; anything
  // that looks like a protected dashboard route gets bounced to /login.
  // Unknown paths (e.g. `/this-does-not-exist`) also pass through so Next
  // can render the 404 page with a real 404 status.
  if (isLoginPage || isPublicPage) {
    return withCsp(request);
  }

  if (isKnownDashboardRoute(pathname)) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("access_token");
    return response;
  }

  // Unknown route, unauthenticated — let Next's not-found handler run
  // (still with CSP, so the rendered 404 HTML inherits the policy).
  return withCsp(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|robots.txt|sitemap.xml).*)",
  ],
};
