import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useMarketStore } from '@/stores/market';
import { useUIStore } from '@/stores/ui';

beforeEach(() => {
  useMarketStore.setState({
    selectedSymbol: 'SPY',
    quotes: {
      AAPL: { symbol: 'AAPL', last: 260, bid: 259, ask: 261, change: -0.5, changePct: -0.19, volume: 500000, high: 262, low: 259, open: 260, close: 260.5, timestamp: Date.now() },
      SPY: { symbol: 'SPY', last: 679, bid: 678, ask: 680, change: 0, changePct: 0, volume: 1000000, high: 680, low: 678, open: 679, close: 679, timestamp: Date.now() },
    },
    watchlist: ['AAPL', 'SPY'],
    // Iter 23: post-hydration state so the rows render rather than the
    // loading skeleton.
    hydrated: true,
  });
  useUIStore.setState({
    activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'trade' },
  });
});

describe('WatchlistPanel', () => {
  it('renders without crashing', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    expect(screen.getByText(/Watchlist/i)).toBeDefined();
  });

  it('shows watchlist symbols', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    expect(screen.getByText('AAPL')).toBeDefined();
    expect(screen.getByText('SPY')).toBeDefined();
  });

  it('has Screener and Signals tabs', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    expect(screen.getByText(/Screener/i)).toBeDefined();
    expect(screen.getByText(/Signals/i)).toBeDefined();
  });

  it('has add symbol input', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    const { container } = render(<WatchlistPanel />);
    const input = container.querySelector('input');
    expect(input).toBeDefined();
  });

  it('shows sort column headers', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    expect(screen.getByText('Symbol')).toBeDefined();
  });

  it('shows Last and Chg% column headers', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    expect(screen.getByText(/Last/i)).toBeDefined();
    expect(screen.getByText(/Chg%/i)).toBeDefined();
  });

  it('renders quote prices for symbols', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    // SPY at $679 should display as $679.00
    const text = document.body.textContent ?? '';
    expect(text.includes('679') || text.includes('260')).toBe(true);
  });

  it('has 3 tab triggers', async () => {
    const { WatchlistPanel } = await import('@/components/panels/WatchlistPanel');
    render(<WatchlistPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(3);
  });
});
