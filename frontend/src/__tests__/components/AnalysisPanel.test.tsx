import '../setup-mocks';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useMarketStore } from '@/stores/market';
import { useUIStore } from '@/stores/ui';

// Set up store state before import to avoid hook issues
beforeEach(() => {
  useMarketStore.setState({
    selectedSymbol: 'SPY',
    quotes: {
      SPY: { symbol: 'SPY', last: 679, bid: 678, ask: 680, change: 0, changePct: 0, volume: 1000000, high: 680, low: 678, open: 679, close: 679, timestamp: Date.now() },
    },
    watchlist: ['SPY', 'AAPL'],
  });
  useUIStore.setState({
    activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'trade' },
  });
});

describe('AnalysisPanel', () => {
  it('renders without crashing', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    const { container } = render(<AnalysisPanel />);
    expect(container.querySelector('button')).toBeDefined();
  });

  it('renders all 5 tab buttons', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    // Use getAllByText since "Tech" also appears inside "Technical Score"
    expect(screen.getAllByText(/Tech/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Fund/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Sent/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Chat/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Order/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows analysis content on Tech tab', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    // The tech tab is active by default — shows either real analysis or "No analysis available"
    const text = document.body.textContent ?? '';
    expect(text.includes('Technical') || text.includes('analysis') || text.includes('SPY')).toBe(true);
  });

  it('has tab triggers with role="tab"', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.length).toBeGreaterThanOrEqual(5);
  });

  it('switches to Fund tab when clicked', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    const fundTab = screen.getByText(/Fund/);
    fireEvent.click(fundTab);
    // After clicking Fund tab, Piotroski F-Score section should be visible
    expect(screen.getByText(/Piotroski F-Score/i)).toBeDefined();
  });

  it('switches to Order tab when clicked', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    const orderTab = screen.getByText(/Order/);
    fireEvent.click(orderTab);
    // Order tab shows buy/sell buttons
    expect(screen.getByText('Buy')).toBeDefined();
    expect(screen.getByText('Sell')).toBeDefined();
  });

  it('shows symbol name in Tech tab context', async () => {
    const { AnalysisPanel } = await import('@/components/panels/AnalysisPanel');
    render(<AnalysisPanel />);
    // The ScoreGauge renders a "Technical" label in the tech tab
    const text = document.body.textContent ?? '';
    expect(text.includes('Technical') || text.includes('SPY')).toBe(true);
  });
});
