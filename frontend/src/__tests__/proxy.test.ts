import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { resolveBackendSessionApiBase } from "@/proxy";

function requestFor(url: string): NextRequest {
  return { nextUrl: new URL(url) } as NextRequest;
}

describe("proxy auth session API base", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers the server-only API_URL for container-to-container auth checks", () => {
    vi.stubEnv("API_URL", "http://backend:8000");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://tradingalpha.net");

    expect(resolveBackendSessionApiBase(requestFor("https://tradingalpha.net/login"))).toBe(
      "http://backend:8000",
    );
  });

  it("falls back to the public API URL when no server-only URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.tradingalpha.net");

    expect(resolveBackendSessionApiBase(requestFor("https://tradingalpha.net/login"))).toBe(
      "https://api.tradingalpha.net",
    );
  });

  it("uses the compose backend hostname in production when no env URL exists", () => {
    vi.stubEnv("API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(resolveBackendSessionApiBase(requestFor("https://tradingalpha.net/login"))).toBe(
      "http://backend:8000",
    );
  });

  it("uses the request origin for local development", () => {
    vi.stubEnv("API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");

    expect(resolveBackendSessionApiBase(requestFor("http://localhost:3000/login"))).toBe(
      "http://localhost:3000",
    );
  });
});
