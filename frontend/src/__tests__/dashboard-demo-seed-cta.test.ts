import { describe, expect, it } from "vitest";

import { selectIsDemoSeedAccount } from "@/app/(dashboard)/_desk/selectors";

/**
 * Audit Batch E P0-05 added a "Connect your broker" CTA to the dashboard
 * Action stack so brand-new operators don't mistake the demo seed book
 * for their real one. Iter 19 wired the backend ``is_demo_seed`` flag
 * through to the dashboard via the ``selectIsDemoSeedAccount`` selector.
 *
 * These tests pin the three states the selector must collapse cleanly:
 *  1. Truthy backend flag → CTA on.
 *  2. Falsy backend flag (admin, or non-admin with broker connected) → CTA off.
 *  3. Missing user (loading, degraded /me, logged-out) → CTA off.
 *
 * The pre-iter-19 frontend used ``currentUser?.username === "admin"`` as
 * a stop-gap proxy; that was inverted (admins are operators, not demo
 * users) and is the regression these tests guard against.
 */
describe("dashboard demo-seed CTA gating", () => {
  it("returns true when the backend reports is_demo_seed=true", () => {
    expect(
      selectIsDemoSeedAccount({ is_demo_seed: true }),
    ).toBe(true);
  });

  it("returns false when the backend reports is_demo_seed=false", () => {
    expect(
      selectIsDemoSeedAccount({ is_demo_seed: false }),
    ).toBe(false);
  });

  it("returns false when the user payload omits is_demo_seed", () => {
    // Legacy /me payload (pre-iter-19 deploy in flight, or degraded
    // SKIP_DB_INIT path that returned the env-admin shape without the
    // flag) — the selector must default to false so the CTA stays
    // hidden rather than misfire on a real operator.
    expect(selectIsDemoSeedAccount({})).toBe(false);
  });

  it("returns false when currentUser is undefined (loading state)", () => {
    // useCurrentUser starts at undefined while React Query is in flight.
    // The CTA must NOT flash on first paint before the profile arrives.
    expect(selectIsDemoSeedAccount(undefined)).toBe(false);
  });

  it("returns false when currentUser is null", () => {
    // Defensive: a future refactor that sets data to null on logout
    // shouldn't accidentally light up the CTA.
    expect(selectIsDemoSeedAccount(null)).toBe(false);
  });

  it("returns false when is_demo_seed is the literal null value", () => {
    // JSON.parse on a backend payload that emitted ``"is_demo_seed":
    // null`` (e.g. a future schema migration mid-rollout) must collapse
    // the same as missing — the selector compares strictly to ``true``
    // so any non-true value hides the CTA.
    expect(
      selectIsDemoSeedAccount({ is_demo_seed: null }),
    ).toBe(false);
  });
});
