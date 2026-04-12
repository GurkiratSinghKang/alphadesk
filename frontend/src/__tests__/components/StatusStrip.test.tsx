import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusStrip } from '@/components/layout/StatusStrip';
import { usePortfolioStore } from '@/stores/portfolio';

beforeEach(() => {
  usePortfolioStore.setState({
    summary: { equity: 100000, cash: 95000, buyingPower: 200000, totalMarketValue: 5000, unrealizedPnl: 50, unrealizedPnlPct: 1, realizedPnlToday: -20, positionsCount: 1, dayPnl: 30, dayPnlPct: 0.03 },
  });
});

describe('StatusStrip', () => {
  it('renders P&L label', () => {
    render(<StatusStrip />);
    expect(screen.getByText('P&L')).toBeDefined();
  });

  it('renders Regime label', () => {
    render(<StatusStrip />);
    expect(screen.getByText('Regime')).toBeDefined();
  });

  it('renders VIX label', () => {
    render(<StatusStrip />);
    expect(screen.getByText('VIX')).toBeDefined();
  });

  it('renders LIVE indicator when connected', () => {
    render(<StatusStrip />);
    expect(screen.getByText('LIVE')).toBeDefined();
  });

  it('renders Alpaca Paper label', () => {
    render(<StatusStrip />);
    expect(screen.getByText(/Alpaca/)).toBeDefined();
  });

  it('shows day P&L value', () => {
    render(<StatusStrip />);
    expect(screen.getByText(/\$30\.00/)).toBeDefined();
  });
});
