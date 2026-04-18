import { NextRequest, NextResponse } from "next/server";

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

  if (!isValidToken && !isLoginPage && !isPublicPage) {
    // Clear stale cookies before redirecting to login
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("access_token");
    return response;
  }

  if (isValidToken && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|robots.txt|sitemap.xml).*)",
  ],
};
