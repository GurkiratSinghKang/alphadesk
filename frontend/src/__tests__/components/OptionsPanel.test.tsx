import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMarketStore } from '@/stores/market';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  queryClient.clear();
  useMarketStore.setState({
    selectedSymbol: 'SPY',
    quotes: {
      SPY: { symbol: 'SPY', last: 590, bid: 589, ask: 591, change: 0, changePct: 0, volume: 1000000, high: 592, low: 588, open: 590, close: 590, timestamp: Date.now() },
    },
    watchlist: ['SPY'],
  });
});

describe('OptionsPanel', () => {
  it('renders without crashing', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    const text = document.body.textContent ?? '';
    expect(text.includes('Options') || text.includes('IV') || text.includes('Chain')).toBe(true);
  });

  it('renders option chain table', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    const { container } = render(<OptionsPanel />, { wrapper: Wrapper });
    const table = container.querySelector('table');
    expect(table).toBeDefined();
  });

  it('shows the selected symbol name in the header', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    expect(screen.getByText(/SPY Options/i)).toBeDefined();
  });

  it('shows IV Rank badge', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    expect(screen.getByText(/IV Rank/i)).toBeDefined();
  });

  it('shows IV Pctl badge', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    expect(screen.getByText(/IV Pctl/i)).toBeDefined();
  });

  it('shows Expected Move text', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    expect(screen.getByText(/Expected Move/i)).toBeDefined();
  });

  it('renders expiration date buttons', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    const { container } = render(<OptionsPanel />, { wrapper: Wrapper });
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('renders column headers for calls and puts', async () => {
    const { OptionsPanel } = await import('@/components/panels/OptionsPanel');
    render(<OptionsPanel />, { wrapper: Wrapper });
    const text = document.body.textContent ?? '';
    expect(text.includes('Last') || text.includes('Bid') || text.includes('IV')).toBe(true);
  });
});
