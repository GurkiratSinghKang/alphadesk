/**
 * Regression test for BUG-067 — CSP proxy modes.
 *
 * The Next.js proxy ships in two modes gated by CSP_ENFORCE_STRICT:
 *   - default: Content-Security-Policy-Report-Only
 *   - strict:  Content-Security-Policy (enforced, with nonce)
 *
 * These tests pin the contract so a future env-var rename or policy
 * drift doesn't silently switch enforcement modes (which is exactly
 * the failure class the 2026-04-20 + 2026-04-24 incidents hit).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Lightweight mock of NextRequest / NextResponse so we don't have to
// boot the Next.js Edge runtime in vitest.
function makeRequest(): unknown {
  return {
    headers: new Headers(),
  };
}

describe("BUG-067 — CSP middleware mode flag", () => {
  let savedFlag: string | undefined;
  let savedDisable: string | undefined;

  beforeEach(() => {
    savedFlag = process.env.CSP_ENFORCE_STRICT;
    savedDisable = process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY;
    delete process.env.CSP_ENFORCE_STRICT;
    delete process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY;
    // Reset module cache so the proxy re-reads env vars each test.
    vi.resetModules();
  });

  afterEach(() => {
    if (savedFlag !== undefined) {
      process.env.CSP_ENFORCE_STRICT = savedFlag;
    }
    if (savedDisable !== undefined) {
      process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY = savedDisable;
    }
  });

  it("default mode sets Report-Only, not enforced", async () => {
    // Default: env var unset → Report-Only path
    const mod = await import("@/proxy");
    const req = makeRequest() as never;
    const res: { headers: Headers } = mod.applyCspToResponse(req);
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeTruthy();
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("strict mode sets enforced Content-Security-Policy", async () => {
    process.env.CSP_ENFORCE_STRICT = "1";
    const mod = await import("@/proxy");
    const req = makeRequest() as never;
    const res: { headers: Headers } = mod.applyCspToResponse(req);
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    // In strict mode, Report-Only is NOT set (the enforced header
    // covers it; sending both would double the report volume for the
    // same violations).
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("strict mode CSP contains 'nonce-' and 'strict-dynamic' but NOT 'unsafe-inline'", async () => {
    process.env.CSP_ENFORCE_STRICT = "1";
    const mod = await import("@/proxy");
    const req = makeRequest() as never;
    const res: { headers: Headers } = mod.applyCspToResponse(req);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toMatch(/nonce-[A-Za-z0-9+/=]+/);
    expect(csp).toMatch(/'strict-dynamic'/);
    // CRITICAL: the audit's whole point is dropping 'unsafe-inline'.
    // If this fails, the strict mode regressed to the loose policy.
    const scriptSrcMatch = csp?.match(/script-src [^;]+/);
    expect(scriptSrcMatch?.[0]).not.toContain("'unsafe-inline'");
  });

  it("strict mode mints a different nonce per request", async () => {
    process.env.CSP_ENFORCE_STRICT = "1";
    const mod = await import("@/proxy");
    const reqA = makeRequest() as never;
    const reqB = makeRequest() as never;
    const resA: { headers: Headers } = mod.applyCspToResponse(reqA);
    const resB: { headers: Headers } = mod.applyCspToResponse(reqB);
    const nonceA = resA.headers.get("Content-Security-Policy")?.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    const nonceB = resB.headers.get("Content-Security-Policy")?.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    expect(nonceA).toBeTruthy();
    expect(nonceB).toBeTruthy();
    expect(nonceA).not.toBe(nonceB);
  });

  it("disable env var short-circuits both modes", async () => {
    process.env.CSP_ENFORCE_STRICT = "1"; // would normally enable
    process.env.NEXT_PUBLIC_DISABLE_CSP_REPORT_ONLY = "1";
    const mod = await import("@/proxy");
    const req = makeRequest() as never;
    const res: { headers: Headers } = mod.applyCspToResponse(req);
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("report-uri matches the wired backend endpoint", async () => {
    const mod = await import("@/proxy");
    const req = makeRequest() as never;
    const res: { headers: Headers } = mod.applyCspToResponse(req);
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    // The endpoint lives at backend/api/routes/security.py:63 — if
    // someone moves it without updating this string, violations stop
    // being collected.
    expect(csp).toContain("/api/v1/security/csp-report");
  });
});
