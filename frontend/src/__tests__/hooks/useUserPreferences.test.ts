/**
 * Iter 25 — Settings → Preferences persistence.
 *
 * The useUserPreferences hook is the React Query-backed bridge between
 * the Settings → Preferences card and `/api/v1/user/settings`. These
 * tests pin the three contracts the rest of iter 25 relies on:
 *
 *   1. Initial load returns the server-side appearance preferences.
 *   2. updatePreference fires PATCH with the merged appearance blob
 *      (existing keys preserved + new key/value applied).
 *   3. A failed PATCH surfaces the error and rolls the cache back to
 *      the prior value (so the dropdown reverts visually).
 *   4. The optimistic update is reflected in the cache before the PATCH
 *      promise resolves.
 *
 * Plus a few unit tests for the landing-page whitelist (resolveLandingPath)
 * which the LoginForm post-login redirect depends on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import React from "react";

import * as api from "@/lib/api";
import {
  ALLOWED_LANDING_PATHS,
  USER_SETTINGS_V2_QUERY_KEY,
  isAllowedLandingPath,
  resolveLandingPath,
  useUserPreferences,
} from "@/hooks/useUserPreferences";

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  }
  return { Wrapper, client };
}

const baseSettings: api.UserSettingsV2 = {
  default_broker_connection_id: 1,
  slippage_tolerance_bps: 5,
  default_order_qty: 1,
  fast_fill_confirms: true,
  appearance: {
    timezone: "America/New_York",
    density: "comfortable",
    numberFormat: "us",
    landingPage: "/watchlists",
  },
  shortcuts: null,
  feed_providers: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("useUserPreferences — initial load", () => {
  it("returns the server-side appearance preferences", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.preferences).toEqual({
      timezone: "America/New_York",
      density: "comfortable",
      numberFormat: "us",
      landingPage: "/watchlists",
    });
  });

  it("returns an empty object when the server returns null appearance", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: null,
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.preferences).toEqual({});
  });
});

describe("useUserPreferences — updatePreference", () => {
  it("PATCHes /user/settings with the merged appearance blob", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const patchSpy = vi
      .spyOn(api, "patchUserSettingsV2")
      .mockImplementation(async (patch: api.UserSettingsV2Patch) => ({
        ...baseSettings,
        appearance: { ...(baseSettings.appearance ?? {}), ...(patch.appearance ?? {}) },
      }));
    const { Wrapper } = makeWrapper();

    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updatePreference("timezone", "Europe/London");
    });

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const arg = patchSpy.mock.calls[0]?.[0];
    // Existing keys preserved + timezone replaced.
    expect(arg?.appearance).toEqual({
      timezone: "Europe/London",
      density: "comfortable",
      numberFormat: "us",
      landingPage: "/watchlists",
    });
  });

  it("optimistically updates the cache before the PATCH resolves", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    let resolvePatch: ((value: api.UserSettingsV2) => void) | undefined;
    vi.spyOn(api, "patchUserSettingsV2").mockImplementation(
      () =>
        new Promise<api.UserSettingsV2>((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Kick off the mutation but don't await it — let the optimistic
    // update land first.
    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.updatePreference("density", "dense");
    });

    // The cache should reflect the optimistic update synchronously,
    // before we resolve the PATCH promise.
    await waitFor(() => {
      const cached = client.getQueryData<api.UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY);
      const appearance = (cached?.appearance ?? {}) as Record<string, unknown>;
      expect(appearance.density).toBe("dense");
    });

    // Resolve the PATCH so the act() doesn't hang.
    await act(async () => {
      resolvePatch?.({
        ...baseSettings,
        appearance: { ...(baseSettings.appearance ?? {}), density: "dense" },
      });
      await pending;
    });
  });

  it("rolls back the cache and surfaces the error on PATCH failure", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const err = new Error("network down");
    vi.spyOn(api, "patchUserSettingsV2").mockRejectedValue(err);

    const { Wrapper, client } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      // The mutation rejects — swallow it so this test focuses on
      // the rollback rather than the rejection.
      await expect(result.current.updatePreference("timezone", "Asia/Tokyo")).rejects.toThrow(
        "network down",
      );
    });

    // saveError should reflect the error.
    await waitFor(() => expect(result.current.saveError).toBe(err));

    // Cache should have rolled back to the pre-mutation value.
    const cached = client.getQueryData<api.UserSettingsV2>(USER_SETTINGS_V2_QUERY_KEY);
    const appearance = (cached?.appearance ?? {}) as Record<string, unknown>;
    expect(appearance.timezone).toBe("America/New_York");
  });
});

describe("useUserPreferences — updateTradingDefault (iter 26)", () => {
  it("PATCHes appearance.tradingDefaults with the merged sub-blob", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: {
        ...(baseSettings.appearance ?? {}),
        tradingDefaults: {
          defaultOrderType: "limit",
          defaultTimeInForce: "day",
        },
      },
    });
    const patchSpy = vi
      .spyOn(api, "patchUserSettingsV2")
      .mockImplementation(async (patch: api.UserSettingsV2Patch) => ({
        ...baseSettings,
        appearance: { ...(baseSettings.appearance ?? {}), ...(patch.appearance ?? {}) },
      }));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateTradingDefault("defaultOrderType", "market");
    });

    expect(patchSpy).toHaveBeenCalledTimes(1);
    const arg = patchSpy.mock.calls[0]?.[0];
    // Existing trading defaults preserved + defaultOrderType replaced.
    expect(arg?.appearance).toMatchObject({
      tradingDefaults: {
        defaultOrderType: "market",
        defaultTimeInForce: "day",
      },
    });
  });

  it("seeds tradingDefaults blob from scratch when none exists yet", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: { timezone: "America/New_York" }, // no tradingDefaults key
    });
    const patchSpy = vi
      .spyOn(api, "patchUserSettingsV2")
      .mockImplementation(async (patch: api.UserSettingsV2Patch) => ({
        ...baseSettings,
        appearance: { ...(baseSettings.appearance ?? {}), ...(patch.appearance ?? {}) },
      }));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateTradingDefault("defaultCostBasis", "lifo");
    });

    const arg = patchSpy.mock.calls[0]?.[0];
    expect(arg?.appearance).toMatchObject({
      tradingDefaults: { defaultCostBasis: "lifo" },
    });
  });

  it("preserves sibling appearance keys when updating tradingDefaults", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const patchSpy = vi
      .spyOn(api, "patchUserSettingsV2")
      .mockImplementation(async (patch: api.UserSettingsV2Patch) => ({
        ...baseSettings,
        appearance: { ...(baseSettings.appearance ?? {}), ...(patch.appearance ?? {}) },
      }));

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useUserPreferences(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateTradingDefault("defaultSizing", "notional");
    });

    // The hook's mutation merges into the existing appearance blob
    // before PATCHing, so the body carries every sibling key untouched
    // alongside the new tradingDefaults blob. We assert here that
    // updating tradingDefaults didn't drop or overwrite the iter 25
    // preference keys (timezone, density, numberFormat, landingPage).
    const arg = patchSpy.mock.calls[0]?.[0];
    expect(arg?.appearance).toMatchObject({
      timezone: "America/New_York",
      density: "comfortable",
      numberFormat: "us",
      landingPage: "/watchlists",
      tradingDefaults: { defaultSizing: "notional" },
    });
  });
});

describe("resolveLandingPath", () => {
  it("returns each whitelisted path unchanged", () => {
    for (const p of ALLOWED_LANDING_PATHS) {
      expect(resolveLandingPath(p)).toBe(p);
    }
  });

  it("falls back to / for an external URL", () => {
    expect(resolveLandingPath("https://evil.com")).toBe("/");
  });

  it("falls back to / for a path not in the whitelist", () => {
    expect(resolveLandingPath("/admin")).toBe("/");
  });

  it("falls back to / for non-string values", () => {
    expect(resolveLandingPath(undefined)).toBe("/");
    expect(resolveLandingPath(null)).toBe("/");
    expect(resolveLandingPath(42)).toBe("/");
    expect(resolveLandingPath({ path: "/" })).toBe("/");
  });

  it("isAllowedLandingPath is a working type guard", () => {
    expect(isAllowedLandingPath("/watchlists")).toBe(true);
    expect(isAllowedLandingPath("/admin")).toBe(false);
    expect(isAllowedLandingPath(null)).toBe(false);
  });
});
