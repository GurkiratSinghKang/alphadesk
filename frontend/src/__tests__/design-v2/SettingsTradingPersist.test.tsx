/**
 * Iter 26 — Settings → Trading defaults round-trips to
 * /api/v1/user/settings.
 *
 * Six controls on the Trading defaults card had hardcoded literals and
 * no onChange before this iter (order type, time-in-force, sizing,
 * two confirm toggles, cost basis). Every pick vanished on navigation
 * and the Trade panel ticket never read them. These tests pin the new
 * contract:
 *
 *   1. Initial render reads the server-side trading defaults into the
 *      visible controls.
 *   2. Picking a new order type fires PATCH /api/v1/user/settings with
 *      the merged appearance.tradingDefaults blob.
 *   3. A failed PATCH surfaces a toast and rolls the cache back so the
 *      dropdown reverts to its prior value.
 *   4. All 6 controls fire PATCH on change (smoke test that the wiring
 *      is complete, not just one control).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stable toast spy that survives across renders (same pattern as
// SettingsPreferencesPersist — setup-mocks installs a fresh vi.fn on
// every render which prevents asserting toast() calls).
const toastSpy = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toast: toastSpy, dismiss: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(""),
  useParams: () => ({}),
}));

global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import * as api from "@/lib/api";
import { STTrading } from "@/components/design-v2/AlphaDeskDesign";

const baseSettings: api.UserSettingsV2 = {
  default_broker_connection_id: 1,
  slippage_tolerance_bps: 5,
  default_order_qty: 1,
  fast_fill_confirms: true,
  appearance: {
    tradingDefaults: {
      defaultOrderType: "limit",
      defaultTimeInForce: "day",
      defaultSizing: "risk",
      confirmMarketOrders: true,
      confirmLargeOrders: true,
      defaultCostBasis: "fifo",
    },
  },
  shortcuts: null,
  feed_providers: null,
};

function renderTrading() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <STTrading />
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

beforeEach(() => {
  toastSpy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings → Trading defaults · persistence", () => {
  it("reads server-side trading defaults into the visible controls", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue({
      ...baseSettings,
      appearance: {
        tradingDefaults: {
          defaultOrderType: "market",
          defaultTimeInForce: "gtc",
          defaultSizing: "shares",
          confirmMarketOrders: false,
          confirmLargeOrders: true,
          defaultCostBasis: "lifo",
        },
      },
    });

    const { container } = renderTrading();

    await waitFor(() => {
      const selects = container.querySelectorAll<HTMLSelectElement>("select");
      expect(selects.length).toBe(4); // 4 selects + 2 toggles
      expect(selects[0].value).toBe("market");
      expect(selects[1].value).toBe("gtc");
      expect(selects[2].value).toBe("shares");
      expect(selects[3].value).toBe("lifo");
    });
  });

  it("PATCHes /user/settings with the merged tradingDefaults blob when order type changes", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const patchSpy = vi.spyOn(api, "patchUserSettingsV2").mockImplementation(async (patch) => ({
      ...baseSettings,
      appearance: {
        ...(baseSettings.appearance ?? {}),
        ...(patch.appearance ?? {}),
      },
    }));

    const { container } = renderTrading();

    // Wait for initial GET to land — once the first select shows
    // "limit" we know the cache is populated and the optimistic merge
    // in updateTradingDefault has access to it.
    await waitFor(() => {
      const selects = container.querySelectorAll<HTMLSelectElement>("select");
      expect(selects[0].value).toBe("limit");
    });

    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    fireEvent.change(selects[0], { target: { value: "stop" } });

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const arg = patchSpy.mock.calls[0]?.[0];
    expect(arg?.appearance).toBeDefined();
    const sentTd = (arg?.appearance as Record<string, unknown>).tradingDefaults as Record<
      string,
      unknown
    >;
    // Merge preserves sibling keys; defaultOrderType replaced.
    expect(sentTd.defaultOrderType).toBe("stop");
    expect(sentTd.defaultTimeInForce).toBe("day");
    expect(sentTd.defaultSizing).toBe("risk");
    expect(sentTd.confirmMarketOrders).toBe(true);
    expect(sentTd.confirmLargeOrders).toBe(true);
    expect(sentTd.defaultCostBasis).toBe("fifo");
  });

  it("rolls back the cache and surfaces a toast on PATCH failure", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    vi.spyOn(api, "patchUserSettingsV2").mockRejectedValue(new Error("503 backend"));

    const { container } = renderTrading();

    await waitFor(() => {
      const selects = container.querySelectorAll<HTMLSelectElement>("select");
      expect(selects[0].value).toBe("limit");
    });

    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    fireEvent.change(selects[0], { target: { value: "stop" } });

    // After the PATCH rejects, the rollback restores the cache and
    // the select reverts to its prior value.
    await waitFor(() => expect(selects[0].value).toBe("limit"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const lastCall = toastSpy.mock.calls[toastSpy.mock.calls.length - 1]?.[0];
    expect(lastCall?.type).toBe("error");
    expect(String(lastCall?.message ?? "")).toMatch(/503 backend|Couldn't save/i);
  });

  it("wires all 6 controls to PATCH (smoke)", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettings);
    const patchSpy = vi.spyOn(api, "patchUserSettingsV2").mockImplementation(async (patch) => ({
      ...baseSettings,
      appearance: {
        ...(baseSettings.appearance ?? {}),
        ...(patch.appearance ?? {}),
      },
    }));

    const { container } = renderTrading();

    await waitFor(() => {
      const selects = container.querySelectorAll<HTMLSelectElement>("select");
      expect(selects[0].value).toBe("limit");
    });

    const selects = container.querySelectorAll<HTMLSelectElement>("select");
    // Buttons (STToggle renders <button>) — filter to the ones that
    // live inside the trading defaults card. The card renders 2
    // toggles total.
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    expect(selects.length).toBe(4);
    expect(buttons.length).toBe(2);

    // Order type select → "stop"
    fireEvent.change(selects[0], { target: { value: "stop" } });
    // TIF select → "gtc"
    fireEvent.change(selects[1], { target: { value: "gtc" } });
    // Sizing select → "notional"
    fireEvent.change(selects[2], { target: { value: "notional" } });
    // Cost basis select → "lifo"
    fireEvent.change(selects[3], { target: { value: "lifo" } });
    // Confirm market orders toggle — flip
    fireEvent.click(buttons[0]);
    // Confirm > $25k toggle — flip
    fireEvent.click(buttons[1]);

    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(6));

    // Each call should be a tradingDefaults blob with the new value
    // present. Collect the keys that changed across calls to assert
    // every control fired.
    const changedKeys = new Set<string>();
    for (const call of patchSpy.mock.calls) {
      const td = ((call[0]?.appearance ?? {}) as Record<string, unknown>)
        .tradingDefaults as Record<string, unknown>;
      // The optimistic merge in updateTradingDefault means each call
      // sends *all* the keys (not just the changed one), but the
      // changed key will have a value different from the baseline.
      const baseline = (baseSettings.appearance as Record<string, unknown>)
        .tradingDefaults as Record<string, unknown>;
      for (const [k, v] of Object.entries(td)) {
        if (v !== baseline[k]) changedKeys.add(k);
      }
    }

    expect(changedKeys).toEqual(
      new Set([
        "defaultOrderType",
        "defaultTimeInForce",
        "defaultSizing",
        "defaultCostBasis",
        "confirmMarketOrders",
        "confirmLargeOrders",
      ]),
    );
  });
});
