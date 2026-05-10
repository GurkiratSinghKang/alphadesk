import '../setup-mocks';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/layout/TopBar';

// StatusPills (added to TopBar in PR-5) calls useRegime — mock it so tests
// don't need a full QueryClientProvider.
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
    data: null,
    isLoading: false,
    error: null,
  }),
}));

// AgentBell (PR #119, pensive-kirch) calls useAgents which uses
// react-query. Mock it so this suite stays QueryClientProvider-free
// like the existing pattern above.
vi.mock('@/hooks/useAgents', () => ({
  useAgents: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

describe('TopBar', () => {
  it('renders logo text', () => {
    render(<TopBar />);
    expect(screen.getByText('AlphaDesk')).toBeDefined();
  });

  it('renders navigation tabs', () => {
    render(<TopBar />);
    expect(screen.getByText('Dashboard')).toBeDefined();
    expect(screen.getByText('Research')).toBeDefined();
    expect(screen.getByText('Trade')).toBeDefined();
    expect(screen.getByText('Pipeline')).toBeDefined();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('renders search bar', () => {
    render(<TopBar />);
    expect(screen.getByText(/Search symbols/)).toBeDefined();
  });

  it('renders Ctrl+K hint', () => {
    render(<TopBar />);
    expect(screen.getByText('Ctrl+K')).toBeDefined();
  });

  it('renders profile avatar', () => {
    render(<TopBar />);
    expect(screen.getByText('A')).toBeDefined(); // Avatar shows "A" for admin
  });

  it('keeps the mobile menu trigger at a touch-safe size', () => {
    render(<TopBar />);
    const trigger = screen.getByLabelText('Open menu');
    // QA r4-4: arbitrary `min-h-[44px]` migrated to the touch-floor token
    // utility (`--spacing-touch` → `min-h-touch`). The hit area is identical
    // (44×44 from `--touch-target-floor`) but now token-driven.
    expect(trigger.className).toContain('min-h-touch');
    expect(trigger.className).toContain('min-w-touch');
  });

  it('renders status pills cluster in right cluster', () => {
    render(<TopBar />);
    // StatusPills renders a VIX label visible in the TopBar
    expect(screen.getByText('VIX')).toBeDefined();
  });
});
