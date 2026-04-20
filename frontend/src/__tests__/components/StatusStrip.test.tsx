import '../setup-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusStrip } from '@/components/layout/StatusStrip';
import { usePortfolioStore } from '@/stores/portfolio';

// Mock React Query-based hooks used by StatusStrip
vi.mock('@/hooks/useQueries', () => ({
  useRegime: () => ({
    data: { regime: { regime: 'Bull', label: 'bull', confidence: 0.8, vix_level: 16.5, description: 'test' } },
    isLoading: false,
    error: null,
  }),
  usePortfolioSummary: () => ({
    data: { is_demo: false, status: 'live', cash: 95000, equity: 100000, buying_power: 200000, positions_count: 1 },
    isLoading: false,
    error: null,
  }),
}));

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

  it('renders STREAMING indicator when connected', () => {
    // BUG-007: pill was renamed from "LIVE" to "STREAMING" so it can't be
    // mistaken for real-money live-trading mode.
    render(<StatusStrip />);
    expect(screen.getByText('STREAMING')).toBeDefined();
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
