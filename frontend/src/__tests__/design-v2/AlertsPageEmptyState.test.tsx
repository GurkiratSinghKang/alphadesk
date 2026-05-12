/**
 * Iter 24 (audit 2026-05-11) — AlertsPage empty-state CTAs.
 *
 * Background: when the operator's notification stream, broker orders, and
 * news feed all came up empty, the AlertsPage rendered a debug-style
 * counter ("Backend stream empty — Notifications endpoint: 0 · orders
 * endpoint: 0 · news endpoint: 0"). Useful for engineers triaging a feed
 * outage; confusing for brand-new operators who needed to know what
 * action to take to drive the page out of empty.
 *
 * This test pins the new empty-state contract:
 *   - Demo-seed account (no broker) → "Connect your broker" CTA wired to
 *     /settings (the route Settings → Brokerage lives on).
 *   - Non-demo account with no price-alert rules → "Set up your first
 *     alert rule" copy (informational; no rules editor exists yet).
 *   - Non-demo account with rules but a quiet backend → "All quiet · no
 *     alerts in the last 24h" with a refresh affordance.
 *   - The empty-state container is hidden the moment a row arrives.
 *   - The original debug counter only renders when
 *     NEXT_PUBLIC_ALERTS_DEBUG=true so engineers can still read it.
 */
import "../setup-mocks";

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AlphaDeskDesignApp } from "@/components/design-v2/AlphaDeskDesign";
import {
  getCurrentUser,
  getMarketNews,
  getNotifications,
  getOrders,
  getPriceAlerts,
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

/**
 * Pre-seed the React Query cache so `useCurrentUser()` resolves
 * synchronously to the profile we want without round-tripping through the
 * mocked `getCurrentUser`. This matches the prod data path (the dashboard
 * already loaded /me before the operator navigates to /alerts) and keeps
 * the empty-state branch deterministic.
 */
function renderAlerts(profile?: { is_demo_seed?: boolean }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (profile) {
    client.setQueryData(["currentUser"], {
      username: "operator",
      role: "user",
      ...profile,
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <AlphaDeskDesignApp initialPage="alerts" initialSymbol="NVDA" />
    </QueryClientProvider>,
  );
}

describe("AlertsPage empty-state CTAs (iter 24)", () => {
  beforeEach(() => {
    installMatchMedia(false);
    vi.mocked(getNotifications).mockReset();
    vi.mocked(getOrders).mockReset();
    vi.mocked(getMarketNews).mockReset();
    vi.mocked(getPriceAlerts).mockReset();
    vi.mocked(getCurrentUser).mockReset();
    // Default: every feed quiet so the empty-state branch renders.
    vi.mocked(getNotifications).mockResolvedValue([]);
    vi.mocked(getOrders).mockResolvedValue([]);
    vi.mocked(getMarketNews).mockResolvedValue([]);
    vi.mocked(getPriceAlerts).mockResolvedValue([]);
    // Default profile mock so the QueryClient cache miss path still
    // resolves cleanly when a test doesn't pre-seed.
    vi.mocked(getCurrentUser).mockResolvedValue({
      username: "operator",
      role: "user",
      is_demo_seed: false,
    } as unknown as never);
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
    // Ensure the dev-only debug flag is off across tests; one test toggles
    // it explicitly and restores in its afterEach.
    delete process.env.NEXT_PUBLIC_ALERTS_DEBUG;
  });

  afterEach(() => {
    cleanup();
    usePortfolioStore.setState({ orders: [], snapshotAt: null, snapshotSource: null });
    delete process.env.NEXT_PUBLIC_ALERTS_DEBUG;
  });

  it("demo-seed user sees the 'Connect your broker' CTA wired to /settings", async () => {
    const { findByTestId } = renderAlerts({ is_demo_seed: true });

    const wrapper = await findByTestId("alerts-empty-state");
    expect(wrapper).toHaveAttribute("data-alerts-empty-variant", "demo-seed");

    const cta = await findByTestId("alerts-empty-connect-broker");
    expect(cta.tagName).toBe("A");
    expect(cta).toHaveAttribute("href", "/settings");
    expect(cta).toHaveTextContent(/connect broker/i);

    // The debug counter is hidden by default.
    expect(screen.queryByTestId("alerts-empty-debug")).toBeNull();
  });

  it("non-demo user with no alert rules sees the 'Set up alert rules' informational empty state", async () => {
    const { findByTestId } = renderAlerts({ is_demo_seed: false });

    const wrapper = await findByTestId("alerts-empty-state");
    expect(wrapper).toHaveAttribute("data-alerts-empty-variant", "no-rules");
    expect(wrapper).toHaveTextContent(/set up your first alert rule/i);
    // Informational only — no CTA link / button is rendered for this branch.
    expect(screen.queryByTestId("alerts-empty-connect-broker")).toBeNull();
    expect(screen.queryByTestId("alerts-empty-refresh")).toBeNull();
    // The detail block explaining why this is informational is present.
    expect(screen.queryByTestId("alerts-empty-no-rules-detail")).not.toBeNull();
  });

  it("non-demo user WITH alert rules but no triggers today sees the 'All quiet' empty state with a refresh button", async () => {
    vi.mocked(getPriceAlerts).mockResolvedValue([
      // Single configured rule is enough to flip the variant.
      { id: "rule-1", symbol: "NVDA", price: 1.0, condition: "above" } as unknown as never,
    ]);

    const { findByTestId } = renderAlerts({ is_demo_seed: false });

    const wrapper = await findByTestId("alerts-empty-state");
    expect(wrapper).toHaveAttribute("data-alerts-empty-variant", "quiet");
    expect(wrapper).toHaveTextContent(/all quiet/i);
    expect(wrapper).toHaveTextContent(/no alerts in the last 24h/i);

    const refresh = await findByTestId("alerts-empty-refresh");
    expect(refresh.tagName).toBe("BUTTON");
    expect(refresh).toHaveTextContent(/refresh/i);
  });

  it("renders no empty state when there is at least one notification", async () => {
    vi.mocked(getNotifications).mockResolvedValue([
      {
        id: 1,
        type: "fill",
        severity: "info",
        title: "NVDA filled",
        body: "Filled at 134.20",
        symbol: "NVDA",
        link: null,
        created_at: new Date().toISOString(),
        read_at: null,
      } as unknown as never,
    ]);

    renderAlerts({ is_demo_seed: true });

    // Wait for the row, then assert the empty state did not also render.
    await screen.findByText(/NVDA filled/);
    expect(screen.queryByTestId("alerts-empty-state")).toBeNull();
    expect(screen.queryByTestId("alerts-empty-connect-broker")).toBeNull();
  });

  it("debug counter is hidden by default and only shows when NEXT_PUBLIC_ALERTS_DEBUG=true", async () => {
    // Default render — debug should be hidden.
    const first = renderAlerts({ is_demo_seed: false });
    await first.findByTestId("alerts-empty-state");
    expect(screen.queryByTestId("alerts-empty-debug")).toBeNull();
    cleanup();

    // Flip the env flag, re-render, and the engineer-only counter appears.
    process.env.NEXT_PUBLIC_ALERTS_DEBUG = "true";
    const second = renderAlerts({ is_demo_seed: false });
    await second.findByTestId("alerts-empty-state");
    const debug = await second.findByTestId("alerts-empty-debug");
    expect(debug).toHaveTextContent(/notifications endpoint: 0/i);
    expect(debug).toHaveTextContent(/orders endpoint: 0/i);
    expect(debug).toHaveTextContent(/news endpoint: 0/i);
  });
});
