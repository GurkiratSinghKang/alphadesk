import { NextResponse, type NextRequest } from "next/server";

import { dispatch } from "../_mocks/handlers";

/**
 * Catch-all `/api/v1/*` mock router.
 *
 * Local dev has no backend; production routes /api/v1/* to the real service
 * via Caddy (see infrastructure/Caddyfile). This handler only fires when
 * `NEXT_PUBLIC_ENABLE_MOCKS=1` is set on the dev server, so it never runs
 * in production. The visual-regression suite enables it via
 * `playwright.config.ts → webServer.command` so snapshots see real chrome
 * instead of the "DATA UNAVAILABLE" degraded state.
 *
 * Unmatched paths fall through to a 404 so missing handlers stay visible
 * in the dev log — silent passthrough would mask coverage gaps.
 */

function mocksEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_MOCKS === "1";
}

async function handle(request: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  if (!mocksEnabled()) {
    return new NextResponse(null, { status: 404 });
  }
  const { path } = await ctx.params;
  const pathname = `/${(path ?? []).join("/")}`;
  const matched = dispatch(request, pathname);
  if (!matched) {
    return new NextResponse(JSON.stringify({ error: "no_mock", path: pathname, method: request.method }), {
      status: 404,
      headers: { "content-type": "application/json", "x-mock-source": "v2-visual" },
    });
  }
  return matched;
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
