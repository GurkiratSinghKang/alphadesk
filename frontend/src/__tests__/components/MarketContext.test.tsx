import '../setup-mocks';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarketContext } from '@/components/dashboard/MarketContext';

const defaultProps = {
  indices: [
    { symbol: 'SPY', name: 'S&P 500', price: 679, change: -0.5, changePct: -0.08 },
    { symbol: 'QQQ', name: 'NASDAQ 100', price: 611, change: 0.5, changePct: 0.08 },
  ],
  sectors: [
    { sector: 'Technology', change_pct: 1.2 },
    { sector: 'Healthcare', change_pct: -0.5 },
  ],
  news: [],
  summary: { equity: 100000, cash: 95000, buyingPower: 200000, totalMarketValue: 5000, unrealizedPnl: 0, unrealizedPnlPct: 0, realizedPnlToday: 0, positionsCount: 0, dayPnl: 0, dayPnlPct: 0 },
  sparkData: { SPY: [1,2,3,4,5], QQQ: [5,4,3,2,1] },
};

describe('MarketContext', () => {
  it('renders Market Indices header', () => {
    render(<MarketContext {...defaultProps} />);
    expect(screen.getByText(/Market Indices/i)).toBeDefined();
  });

  it('shows SPY and QQQ', () => {
    render(<MarketContext {...defaultProps} />);
    expect(screen.getByText('SPY')).toBeDefined();
    expect(screen.getByText('QQQ')).toBeDefined();
  });

  it('shows Sector Performance header', () => {
    render(<MarketContext {...defaultProps} />);
    expect(screen.getByText(/Sector/i)).toBeDefined();
  });

  it('shows allocation donut when no news', () => {
    render(<MarketContext {...defaultProps} />);
    expect(screen.getByText(/Allocation/i) || screen.getByText(/Cash/i)).toBeDefined();
  });
});
