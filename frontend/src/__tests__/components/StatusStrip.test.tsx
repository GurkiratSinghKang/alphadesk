import '../setup-mocks';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusPills from '@/components/layout/StatusPills';

// StatusStrip was removed in PR-5 (BUG-02 + BUG-09).
// These tests now cover the replacement: StatusPills in the TopBar.

vi.mock('@/hooks/useQueries', () => ({
  useRegime: () => ({
    data: {
      regime: {
        regime: 'Bull',
        label: 'bull',
        confidence: 0.8,
        vix_level: 16.5,
        description: 'test',
      },
    },
    isLoading: false,
    error: null,
  }),
  usePortfolioSummary: () => ({
    data: { is_demo: false, status: 'live', cash: 95000, equity: 100000, buying_power: 200000, positions_count: 1 },
    isLoading: false,
    error: null,
  }),
}));

describe('StatusPills (replaces StatusStrip after PR-5)', () => {
  it('renders VIX label', async () => {
    render(<StatusPills />);
    expect(await screen.findByText('VIX')).toBeDefined();
  });

  it('renders PAPER pill when tradingMode is paper', async () => {
    render(<StatusPills />);
    expect(await screen.findByText('PAPER')).toBeDefined();
  });

  it('renders regime dot with accessible label', async () => {
    render(<StatusPills />);
    const regimeBtn = await screen.findByRole('button', { name: /Market regime/i });
    expect(regimeBtn).toBeDefined();
  });

  it('renders VIX value', async () => {
    render(<StatusPills />);
    expect(await screen.findByText('16.5')).toBeDefined();
  });
});
