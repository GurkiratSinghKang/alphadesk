import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { usePortfolioStore } from '@/stores/portfolio';
import { useMarketStore } from '@/stores/market';
import { useUIStore } from '@/stores/ui';

beforeEach(() => {
  useMarketStore.setState({ selectedSymbol: 'SPY', quotes: {}, watchlist: ['SPY'] });
  usePortfolioStore.setState({
    positions: [],
    orders: [],
    summary: {
      equity: 100000,
      cash: 95000,
      buyingPower: 200000,
      totalMarketValue: 5000,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
      realizedPnlToday: 0,
      positionsCount: 0,
      dayPnl: 0,
      dayPnlPct: 0,
    },
    greeks: { netDelta: 0, netGamma: 0, netTheta: 0, netVega: 0, betaWeightedDelta: 0 },
  });
  useUIStore.setState({
    activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'trade' },
    tradingMode: 'paper',
  });
});

describe('TradePanel', () => {
  it('renders without crashing', async () => {
    const { TradePanel } = await import('@/components/panels/TradePanel');
    render(<TradePanel />);
    // At least one of the known tab labels should appear
    const text = document.body.textContent ?? '';
    expect(
      text.includes('Trade') || text.includes('Positions') || text.includes('Orders') || text.includes('Journal')
    ).toBe(true);
  });

  it('has tab navigation with role="tab"', async () => {
    const { TradePanel } = await import('@/components/panels/TradePanel');
    render(<TradePanel />);
    const buttons = screen.getAllByRole('tab');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders all 5 tab labels', async () => {
    const { TradePanel } = await import('@/components/panels/TradePanel');
    render(<TradePanel />);
    expect(screen.getByText('Trade')).toBeDefined();
    expect(screen.getByText('Positions')).toBeDefined();
    expect(screen.getByText('Orders')).toBeDefined();
    expect(screen.getByText('Journal')).toBeDefined();
    expect(screen.getByText('Calendar')).toBeDefined();
  });

  it('shows Trade Builder content on trade tab', async () => {
    const { TradePanel } = await import('@/components/panels/TradePanel');
    render(<TradePanel />);
    // Default tab is "trade" — should show the strategy badge (e.g., "Bull Call Spread")
    // and the symbol name
    const text = document.body.textContent ?? '';
    expect(text.includes('SPY') || text.includes('Spread') || text.includes('Leg')).toBe(true);
  });

  it('renders empty state when no positions', async () => {
    const { TradePanel } = await import('@/components/panels/TradePanel');
    render(<TradePanel />);
    // Switch to positions tab via the store (controlled Tabs component)
    await act(async () => {
      useUIStore.setState({
        activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'positions' },
      });
    });
    // Demo data was removed — positions tab should show empty state or no AAPL
    const text = document.body.textContent ?? '';
    expect(text.includes('AAPL')).toBe(false);
  });
});
