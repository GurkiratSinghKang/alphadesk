/**
 * Iter 27 — Settings → Broker "Make default" persists to
 * /api/v1/user/settings via UserSettingsV2.default_broker_connection_id.
 *
 * Before this iter the per-row "Make default" button only POSTed to
 * /broker/connections/{id}/default (a per-connection flag). The user's
 * "which broker should route my orders" choice didn't survive page
 * reload because the canonical source — `default_broker_connection_id`
 * on UserSettingsV2 — wasn't being patched. These tests pin the new
 * contract end-to-end:
 *
 *   1. The broker that matches `settings.default_broker_connection_id`
 *      shows the ACTIVE badge; other connected brokers show the
 *      "Make default" button (when expanded).
 *   2. Clicking "Make default" fires PATCH /api/v1/user/settings with
 *      the new connection id.
 *   3. The optimistic flip swaps the ACTIVE badge to the clicked broker
 *      and hides its "Make default" button — before the PATCH resolves.
 *   4. A failed PATCH rolls back: the original broker keeps the badge
 *      and a toast surfaces the error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stable toast spy that survives across renders (same pattern as
// SettingsPreferencesPersist / SettingsTradingPersist — setup-mocks
// installs a fresh vi.fn on every render which prevents asserting
// toast() calls).
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
import { STBroker } from "@/components/design-v2/AlphaDeskDesign";

// Two connections — Alpaca (id=2) and IBKR (id=1). We deliberately
// pick IBKR for the "currently active" slot so the broker the user
// flips TO (Alpaca, id=2) is the one whose row is open by default
// — STBroker initializes `open` to "alpaca", so the Make default
// button lives inside the rendered DOM without a row toggle click.
const alpacaConn: api.BrokerConnection = {
  id: 2,
  provider: "alpaca",
  account_env: "paper",
  display_name: "Alpaca paper",
  key_last4: "1234",
  status: "verified",
  is_default: false,
  verified_at: "2026-05-12T10:00:00Z",
  last_sync_at: "2026-05-12T10:30:00Z",
  last_error: null,
  broker_account_id: "PA3KW2J18ZNX",
  metadata: {},
};
const ibkrConn: api.BrokerConnection = {
  id: 1,
  provider: "ibkr",
  account_env: "live",
  display_name: "IBKR live",
  key_last4: "5678",
  status: "verified",
  is_default: false,
  verified_at: "2026-05-12T09:00:00Z",
  last_sync_at: "2026-05-12T09:30:00Z",
  last_error: null,
  broker_account_id: "U7421906",
  metadata: {},
};

function baseSettingsWith(defaultId: number | null): api.UserSettingsV2 {
  return {
    default_broker_connection_id: defaultId,
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
}

function renderBroker() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <STBroker />
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

describe("Settings → Broker · setActiveBroker (iter 27)", () => {
  it("renders ACTIVE badge on the default broker and Make default on others", async () => {
    // IBKR is the user's chosen default (settings.default_broker_connection_id = 1).
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettingsWith(1));
    vi.spyOn(api, "getBrokerConnections").mockResolvedValue([alpacaConn, ibkrConn]);
    vi.spyOn(api, "getReconciliationState").mockResolvedValue({
      last_reconciled_at: null,
      open_issue_count: 0,
      primary_provider: null,
      is_clean: true,
    });

    const { queryByTestId } = renderBroker();

    // IBKR (id=ibkr) is the active broker — badge appears.
    await waitFor(() => {
      expect(queryByTestId("broker-active-badge-ibkr")).not.toBeNull();
    });
    // Alpaca is non-default — and STBroker auto-expands the alpaca
    // row (`useState("alpaca")`), so its "Make default" button is
    // visible without a row-toggle click.
    expect(queryByTestId("broker-make-default-alpaca")).not.toBeNull();
    // IBKR shows no ACTIVE badge would be wrong — the active *badge*
    // is on IBKR. What we don't want on IBKR is the Make default
    // button (and IBKR's row is collapsed anyway, so the button is
    // not rendered).
    expect(queryByTestId("broker-make-default-ibkr")).toBeNull();
    // Alpaca is not the active broker — no badge.
    expect(queryByTestId("broker-active-badge-alpaca")).toBeNull();
  });

  it("clicking Make default on Alpaca PATCHes default_broker_connection_id", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettingsWith(1));
    vi.spyOn(api, "getBrokerConnections").mockResolvedValue([alpacaConn, ibkrConn]);
    vi.spyOn(api, "getReconciliationState").mockResolvedValue({
      last_reconciled_at: null,
      open_issue_count: 0,
      primary_provider: null,
      is_clean: true,
    });
    // Legacy POST is a fire-and-forget best-effort sync — mock it so
    // the catch path in handleMakeDefault doesn't swallow a real
    // network error masquerading as nothing.
    vi.spyOn(api, "setDefaultBrokerConnection").mockResolvedValue({ id: 2, is_default: true });
    const patchSpy = vi
      .spyOn(api, "patchUserSettingsV2")
      .mockImplementation(async (patch) => ({
        ...baseSettingsWith(1),
        ...patch,
      }));

    const { queryByTestId } = renderBroker();

    // Wait for the initial GETs to land + the Make default button
    // to be present.
    let button: HTMLElement | null = null;
    await waitFor(() => {
      button = queryByTestId("broker-make-default-alpaca");
      expect(button).not.toBeNull();
    });

    fireEvent.click(button!);

    // The PATCH should have been fired with the root-level
    // default_broker_connection_id set to Alpaca's id (2).
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const arg = patchSpy.mock.calls[0]?.[0];
    expect(arg?.default_broker_connection_id).toBe(2);
  });

  it("optimistically swaps the ACTIVE badge to the clicked broker", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettingsWith(1));
    vi.spyOn(api, "getBrokerConnections").mockResolvedValue([alpacaConn, ibkrConn]);
    vi.spyOn(api, "getReconciliationState").mockResolvedValue({
      last_reconciled_at: null,
      open_issue_count: 0,
      primary_provider: null,
      is_clean: true,
    });
    vi.spyOn(api, "setDefaultBrokerConnection").mockResolvedValue({ id: 2, is_default: true });
    // Resolve the PATCH lazily so we can observe the optimistic flip
    // before the server response lands.
    let resolvePatch: ((value: api.UserSettingsV2) => void) | undefined;
    vi.spyOn(api, "patchUserSettingsV2").mockImplementation(
      () =>
        new Promise<api.UserSettingsV2>((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { queryByTestId } = renderBroker();

    await waitFor(() => {
      expect(queryByTestId("broker-active-badge-ibkr")).not.toBeNull();
      expect(queryByTestId("broker-make-default-alpaca")).not.toBeNull();
    });

    fireEvent.click(queryByTestId("broker-make-default-alpaca")!);

    // Before the PATCH resolves, the optimistic update should have
    // flipped the badge to Alpaca + hidden Alpaca's Make default
    // button (Alpaca is now default; the button is gated by
    // !broker.default).
    await waitFor(() => {
      expect(queryByTestId("broker-active-badge-alpaca")).not.toBeNull();
      expect(queryByTestId("broker-make-default-alpaca")).toBeNull();
      expect(queryByTestId("broker-active-badge-ibkr")).toBeNull();
    });

    // Resolve the PATCH so the test doesn't leak an in-flight
    // mutation past the cleanup() in afterEach.
    resolvePatch?.({
      ...baseSettingsWith(2),
    });
  });

  it("rolls back to the original active broker on PATCH failure + surfaces toast", async () => {
    vi.spyOn(api, "getUserSettingsV2").mockResolvedValue(baseSettingsWith(1));
    vi.spyOn(api, "getBrokerConnections").mockResolvedValue([alpacaConn, ibkrConn]);
    vi.spyOn(api, "getReconciliationState").mockResolvedValue({
      last_reconciled_at: null,
      open_issue_count: 0,
      primary_provider: null,
      is_clean: true,
    });
    vi.spyOn(api, "setDefaultBrokerConnection").mockResolvedValue({ id: 2, is_default: true });
    vi.spyOn(api, "patchUserSettingsV2").mockRejectedValue(new Error("503 backend down"));

    const { queryByTestId } = renderBroker();

    await waitFor(() => {
      expect(queryByTestId("broker-active-badge-ibkr")).not.toBeNull();
      expect(queryByTestId("broker-make-default-alpaca")).not.toBeNull();
    });

    fireEvent.click(queryByTestId("broker-make-default-alpaca")!);

    // After the rejection the rollback restores the cache: IBKR is
    // the active broker again, Alpaca's Make default button is
    // visible again.
    await waitFor(() => {
      expect(queryByTestId("broker-active-badge-ibkr")).not.toBeNull();
      expect(queryByTestId("broker-active-badge-alpaca")).toBeNull();
      expect(queryByTestId("broker-make-default-alpaca")).not.toBeNull();
    });

    // The toast effect in STBroker surfaces saveError to the user.
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const errorToastCall = toastSpy.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === "error",
    );
    expect(errorToastCall).toBeDefined();
    expect(String((errorToastCall?.[0] as { message?: string })?.message ?? "")).toMatch(
      /default broker.*503 backend down/i,
    );
  });
});
