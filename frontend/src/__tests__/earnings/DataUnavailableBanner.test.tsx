import "../setup-mocks";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import {
  ApiDegradedBanner,
  type ApiServiceIssue,
  type ApiServiceKey,
} from "@/components/layout/ApiDegradedBanner";

function issue(
  key: ApiServiceKey,
  overrides: Partial<ApiServiceIssue> = {},
): ApiServiceIssue {
  const now = Date.now();
  return {
    key,
    label: key === "market" ? "Market data" : key,
    status: 502,
    message: "Symbol 'I:TQQQIV' not found",
    path: "/api/v1/options/iv/UBER",
    count: 1,
    lastSeen: now,
    ...overrides,
  };
}

describe("ApiDegradedBanner (DATA UNAVAILABLE)", () => {
  it("renders nothing when no issues are present", () => {
    const { container } = render(
      <ApiDegradedBanner issues={[]} onDismiss={() => {}} onRetry={() => {}} />,
    );
    expect(container.querySelector('[data-slot="api-degraded-banner"]')).toBeNull();
  });

  it("renders the collapsed banner with service labels and grouped count", () => {
    const { container } = render(
      <ApiDegradedBanner
        issues={[issue("market"), issue("strategies", { count: 3 })]}
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );
    const banner = container.querySelector('[data-slot="api-degraded-banner"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toMatch(/Data unavailable/i);
    expect(banner?.textContent).toMatch(/Market data/i);
    expect(banner?.textContent).toMatch(/grouped 4 backend issues/i);
    // Expand toggle is collapsed by default.
    expect(container.querySelector('[data-slot="api-degraded-banner-detail"]')).toBeNull();
  });

  it("expands on header-button click and shows affected views + last attempt + retry (B1.22)", () => {
    const { container, getByRole } = render(
      <ApiDegradedBanner
        issues={[
          issue("market", { lastSeen: new Date("2026-05-06T18:30:00").getTime() }),
        ]}
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );
    const expander = container.querySelector(
      '[aria-controls="api-degraded-banner-detail"]',
    ) as HTMLButtonElement;
    expect(expander).not.toBeNull();
    fireEvent.click(expander);
    const detail = container.querySelector('[data-slot="api-degraded-banner-detail"]');
    expect(detail).not.toBeNull();
    // Affected views for market data — strike ladder, IV term, etc.
    expect(detail?.textContent).toMatch(/Strike ladder/i);
    expect(detail?.textContent).toMatch(/IV term structure/i);
    expect(detail?.textContent).toMatch(/Last fetch attempt/i);
    // Retry button is present in the header.
    expect(getByRole("button", { name: /retry/i })).not.toBeNull();
  });

  it("calls onDismiss + onRetry through the respective buttons", () => {
    const onDismiss = vi.fn();
    const onRetry = vi.fn();
    const { getByRole } = render(
      <ApiDegradedBanner
        issues={[issue("market")]}
        onDismiss={onDismiss}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(getByRole("button", { name: /retry/i }));
    fireEvent.click(getByRole("button", { name: /dismiss/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dedupes affected-view labels across multiple matching services (B1.22)", () => {
    const { container, getByRole } = render(
      <ApiDegradedBanner
        // Two market-data hits + one strategies hit; market_data appears
        // once because the views are de-duped before render.
        issues={[issue("market"), issue("market"), issue("strategies")]}
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );
    fireEvent.click(getByRole("button", { name: /Data unavailable/i }));
    const detail = container.querySelector('[data-slot="api-degraded-banner-detail"]');
    const text = detail?.textContent ?? "";
    // "Strike ladder" appears exactly once (no duplicate from two
    // market issues).
    const occurrences = text.split(/Strike ladder/i).length - 1;
    expect(occurrences).toBe(1);
    // Strategies-affected view present too.
    expect(text).toMatch(/Earnings options play/i);
  });
});
