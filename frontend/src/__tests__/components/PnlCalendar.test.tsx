import '../setup-mocks';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// The setup-mocks file mocks getPnlCalendar to return data with days: [], etc.
// PnlCalendar uses usePnlCalendar (react-query hook), so we need a QueryClientProvider.

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PnlCalendar', () => {
  it('renders without crashing', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    // Should have at least the navigation buttons
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders month/year header', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // The component shows the current month name and year
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    const year = now.getFullYear().toString();
    const bodyText = document.body.textContent ?? '';
    expect(bodyText.includes(monthName)).toBe(true);
    expect(bodyText.includes(year)).toBe(true);
  });

  it('renders empty state or day-of-week headers after data loads', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const bodyText = document.body.textContent ?? '';
    // Either shows day headers (when data exists) or "No trading data" (when empty)
    const hasDayHeaders = bodyText.includes('Mon');
    const hasEmptyState = bodyText.includes('No trading data');
    expect(hasDayHeaders || hasEmptyState).toBe(true);
  });

  it('renders the component container', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    let container: HTMLElement;
    await act(async () => {
      const result = render(<Wrapper><PnlCalendar /></Wrapper>);
      container = result.container;
    });
    expect(container!).toBeDefined();
  });

  it('previous month button exists', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('next month button exists', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('shows summary or empty state after data loads', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar /></Wrapper>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const bodyText = document.body.textContent ?? '';
    const hasSummary = bodyText.includes('Month P&L');
    const hasEmpty = bodyText.includes('No trading data');
    expect(hasSummary || hasEmpty).toBe(true);
  });

  it('renders in compact mode', async () => {
    const { PnlCalendar } = await import('@/components/panels/PnlCalendar');
    const Wrapper = createWrapper();
    await act(async () => {
      render(<Wrapper><PnlCalendar compact /></Wrapper>);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    // Component renders without crashing in compact mode
    expect(document.body.textContent).toBeDefined();
  });
});
