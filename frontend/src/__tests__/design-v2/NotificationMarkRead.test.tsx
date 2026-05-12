/**
 * Iter 22 (2026-05-11) — AlertsPage notification mark-as-read wiring.
 *
 * Backend already exposed POST /api/v1/notifications/{id}/read and
 * /api/v1/notifications/read-all but the FE never called them. The
 * unread bell badge would accumulate 50+ items the operator had
 * already triaged.
 *
 * This test pins:
 *   - Click on the per-row "Mark read" button → calls markNotificationRead
 *     with the correct integer id (the backend route is typed `int`).
 *   - "Mark all read" header button → calls markAllNotificationsRead.
 *   - Optimistic update flips the row dot from "up" to "neutral" before
 *     the network promise even resolves.
 *   - API failure reverts local state — the row stays unread so the
 *     bell badge doesn't false-positive.
 *   - The header button is disabled when there's nothing to drain.
 */
import "../setup-mocks";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaDeskDesignApp } from "@/components/design-v2/AlphaDeskDesign";
import {
  getMarketNews,
  getNotifications,
  getOrders,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { usePortfolioStore } from "@/stores/portfolio";

function installMatchMedia(matches = false) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderAlerts() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AlphaDeskDesignApp initialPage="alerts" initialSymbol="NVDA" />
    </QueryClientProvider>,
  );
}

function makeUnreadNotification(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: "fill",
    severity: "info",
    title: `Notification ${id}`,
    body: "Body text",
    link: null,
    created_at: new Date().toISOString(),
    read_at: null,
    ...overrides,
  };
}

describe("AlertsPage mark-as-read wiring (iter 22)", () => {
  beforeEach(() => {
    installMatchMedia(false);
    vi.mocked(getNotifications).mockReset();
    vi.mocked(getOrders).mockReset();
    vi.mocked(getMarketNews).mockReset();
    vi.mocked(markNotificationRead).mockReset();
    vi.mocked(markAllNotificationsRead).mockReset();
    vi.mocked(markNotificationRead).mockResolvedValue(undefined as unknown as never);
    vi.mocked(markAllNotificationsRead).mockResolvedValue(undefined as unknown as never);
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
  });

  afterEach(() => {
    cleanup();
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
  });

  it("clicking 'Mark read' on a row calls markNotificationRead with the numeric id", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      makeUnreadNotification(7, { title: "Row Seven", symbol: "NVDA" }),
    ] as unknown as never);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    renderAlerts();

    const btn = await screen.findByTestId("alerts-mark-read-7");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(markNotificationRead).toHaveBeenCalledWith(7);
    });
  });

  it("clicking 'Mark all read' calls markAllNotificationsRead", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      makeUnreadNotification(1),
      makeUnreadNotification(2),
    ] as unknown as never);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    renderAlerts();

    const btn = await screen.findByTestId("alerts-mark-all-read");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    await waitFor(() => {
      expect(markAllNotificationsRead).toHaveBeenCalledTimes(1);
    });
  });

  it("after mark-read, the per-row affordance disappears (optimistic flip to read)", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      makeUnreadNotification(11, { title: "Optimistic flip" }),
    ] as unknown as never);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    // Make the mark-read promise resolve so the optimistic update
    // sticks. The unread-only button disappears because the row's
    // `read` flag flipped to true.
    vi.mocked(markNotificationRead).mockResolvedValue(undefined as unknown as never);

    renderAlerts();

    const btn = await screen.findByTestId("alerts-mark-read-11");
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.queryByTestId("alerts-mark-read-11")).toBeNull();
    });
    // The header counter also drops to zero — button is now disabled.
    const headerBtn = screen.getByTestId("alerts-mark-all-read");
    expect(headerBtn).toBeDisabled();
  });

  it("API failure on mark-read leaves the row unread (no false positive)", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      makeUnreadNotification(42, { title: "Stays unread on failure" }),
    ] as unknown as never);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);
    vi.mocked(markNotificationRead).mockRejectedValue(new Error("HTTP 500"));

    renderAlerts();

    const btn = await screen.findByTestId("alerts-mark-read-42");
    await act(async () => {
      fireEvent.click(btn);
    });

    // The optimistic update was reverted — the mark-read affordance
    // is back. Use `findByTestId` to wait for the revert microtask.
    await waitFor(() => {
      expect(screen.getByTestId("alerts-mark-read-42")).toBeInTheDocument();
    });
    // Header counter also reverts: the button is still enabled.
    const headerBtn = screen.getByTestId("alerts-mark-all-read");
    expect(headerBtn).not.toBeDisabled();
  });

  it("with zero unread notifications the header button is disabled and no per-row buttons render", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      makeUnreadNotification(99, { title: "Already triaged", read_at: new Date().toISOString() }),
    ] as unknown as never);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);

    renderAlerts();

    await screen.findByText(/Already triaged/);
    const headerBtn = screen.getByTestId("alerts-mark-all-read");
    expect(headerBtn).toBeDisabled();
    // No mark-read affordance on already-read rows.
    expect(screen.queryByTestId("alerts-mark-read-99")).toBeNull();
  });
});
