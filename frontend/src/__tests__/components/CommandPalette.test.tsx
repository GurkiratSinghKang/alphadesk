import '../setup-mocks';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useUIStore } from '@/stores/ui';
import { useMarketStore } from '@/stores/market';

// Mock cmdk
vi.mock('cmdk', () => {
  const Command = ({ children, ...props }: any) => <div data-testid="cmdk-root" {...props}>{children}</div>;
  Command.Input = ({ placeholder, ...props }: any) => <input placeholder={placeholder} data-testid="cmdk-input" {...props} />;
  Command.List = ({ children }: any) => <div data-testid="cmdk-list">{children}</div>;
  Command.Empty = ({ children }: any) => <div>{children}</div>;
  Command.Group = ({ heading, children }: any) => <div data-testid={`cmdk-group-${heading}`}><span>{heading}</span>{children}</div>;
  Command.Item = ({ children, onSelect, ...props }: any) => <div role="option" onClick={onSelect} {...props}>{children}</div>;
  Command.Separator = () => <hr />;
  return { Command };
});

beforeEach(() => {
  useUIStore.setState({
    commandPaletteOpen: false,
    tradingMode: 'paper',
    sidebarCollapsed: false,
    theme: 'dark',
    activePanels: { left: 'watchlist', center: 'chart', right: 'technical', bottom: 'trade' },
  });
  useMarketStore.setState({
    watchlist: ['SPY', 'AAPL'],
    selectedSymbol: 'SPY',
    quotes: {},
  });
});

describe('CommandPalette', () => {
  it('renders when commandPaletteOpen is true', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByTestId('cmdk-input')).toBeDefined();
  });

  it('shows Popular Symbols group by default', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Popular Symbols')).toBeDefined();
  });

  it('shows popular symbol SPY', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('SPY')).toBeDefined();
  });

  it('shows Commands group', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Commands')).toBeDefined();
  });

  // Wave 32: "Analyze current symbol" command was removed — it toasted
  // "coming soon" without a real target. See persona-6-power-user.md #8.

  it('has Screen momentum stocks command', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Screen momentum stocks')).toBeDefined();
  });

  it('has Show portfolio command', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Show portfolio')).toBeDefined();
  });

  it('has Switch to live trading command', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Switch to live trading')).toBeDefined();
  });

  it('has Navigation group', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Navigation')).toBeDefined();
  });

  it('shows search input with placeholder', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    const input = screen.getByPlaceholderText('Search symbols, commands...');
    expect(input).toBeDefined();
  });

  it('selecting a symbol updates the store', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);

    // Find NVDA option and click it
    const nvdaOption = screen.getByText('NVDA');
    nvdaOption.closest('[role="option"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // After clicking, the store should have the symbol set and added to watchlist
    expect(useMarketStore.getState().selectedSymbol).toBe('NVDA');
    expect(useMarketStore.getState().watchlist).toContain('NVDA');
  });

  it('selecting a symbol closes the palette', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);

    const aaplOption = screen.getByText('AAPL');
    aaplOption.closest('[role="option"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it('shows keyboard shortcut hints in the footer', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('navigate')).toBeDefined();
    expect(screen.getByText('select')).toBeDefined();
    expect(screen.getByText('close')).toBeDefined();
  });
});
