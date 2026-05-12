import '../setup-mocks';
import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useUIStore } from '@/stores/ui';
import { useMarketStore } from '@/stores/market';

const COMMAND_PALETTE_TEST_TIMEOUT_MS = 15_000;

// Mock cmdk
vi.mock('cmdk', () => {
  type WithChildren = { children?: ReactNode };
  type CommandInputProps = InputHTMLAttributes<HTMLInputElement> & {
    onValueChange?: (value: string) => void;
  };
  type CommandGroupProps = HTMLAttributes<HTMLDivElement> &
    WithChildren & {
      heading?: string;
    };
  type CommandItemProps = HTMLAttributes<HTMLDivElement> &
    WithChildren & {
      onSelect?: () => void;
    };

  function CommandRoot({ children, ...props }: HTMLAttributes<HTMLDivElement> & WithChildren) {
    return <div data-testid="cmdk-root" {...props}>{children}</div>;
  }

  function CommandInput({ placeholder, onValueChange, ...props }: CommandInputProps) {
    return (
      <input
        placeholder={placeholder}
        data-testid="cmdk-input"
        onChange={(event) => onValueChange?.(event.currentTarget.value)}
        {...props}
      />
    );
  }

  function CommandList({ children }: WithChildren) {
    return <div data-testid="cmdk-list">{children}</div>;
  }

  function CommandEmpty({ children }: WithChildren) {
    return <div>{children}</div>;
  }

  function CommandGroup({ heading, children }: CommandGroupProps) {
    return <div data-testid={`cmdk-group-${heading}`}><span>{heading}</span>{children}</div>;
  }

  function CommandItem({ children, onSelect, ...props }: CommandItemProps) {
    return <div role="option" aria-selected={false} onClick={onSelect} {...props}>{children}</div>;
  }

  function CommandSeparator() {
    return <hr />;
  }

  const Command = Object.assign(CommandRoot, {
    Empty: CommandEmpty,
    Group: CommandGroup,
    Input: CommandInput,
    Item: CommandItem,
    List: CommandList,
    Separator: CommandSeparator,
  });
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
  }, COMMAND_PALETTE_TEST_TIMEOUT_MS);

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

  it('shows honest live-trading access copy while paper-only', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Live trading access')).toBeDefined();
  });

  it('offers switch-to-paper copy when already live', async () => {
    useUIStore.setState({ commandPaletteOpen: true, tradingMode: 'live' });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Switch to paper trading')).toBeDefined();
  });

  it('has Navigation group', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Navigation')).toBeDefined();
  });

  it('offers research and admin pages from page navigation', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Go to Research')).toBeDefined();
    expect(screen.getByText('Go to Admin control center')).toBeDefined();
  });

  it('routes chart/options commands to the trade workspace from the dashboard', async () => {
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);
    expect(screen.getByText('Open trade chart')).toBeDefined();
    expect(screen.getByText('Open options chain')).toBeDefined();
    expect(screen.queryByText('Focus chart panel')).toBeNull();
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

  it('confirms before cancelling all working orders', async () => {
    const listener = vi.fn();
    window.addEventListener('alphadesk:cancel-all-orders', listener);
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);

    fireEvent.click(screen.getByText('Cancel all working orders').closest('[role="option"]')!);

    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    expect(screen.getByTestId('confirm-cancel-all-orders-dialog')).toBeDefined();
    expect(listener).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-cancel-all-orders-confirm'));

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('alphadesk:cancel-all-orders', listener);
  });

  it('confirms before flattening the selected symbol', async () => {
    const listener = vi.fn();
    window.addEventListener('alphadesk:flatten-symbol', listener);
    useUIStore.setState({ commandPaletteOpen: true });
    useMarketStore.setState({ selectedSymbol: 'AAPL' });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);

    fireEvent.click(screen.getByText('Flatten AAPL — close at market').closest('[role="option"]')!);

    expect(screen.getByTestId('confirm-flatten-symbol-dialog')).toBeDefined();
    expect(screen.getByTestId('confirm-flatten-symbol-cancel')).toBeDefined();
    expect(listener).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-flatten-symbol-confirm'));

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ symbol: 'AAPL' });
    window.removeEventListener('alphadesk:flatten-symbol', listener);
  });

  it('confirms before pausing all strategies and cancel keeps it inert', async () => {
    const listener = vi.fn();
    window.addEventListener('alphadesk:pause-all-strategies', listener);
    useUIStore.setState({ commandPaletteOpen: true });
    const { CommandPalette } = await import('@/components/layout/CommandPalette');
    render(<CommandPalette />);

    fireEvent.click(screen.getByText('Pause all strategies').closest('[role="option"]')!);

    expect(screen.getByTestId('confirm-pause-all-strategies-dialog')).toBeDefined();
    expect(listener).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-pause-all-strategies-cancel'));

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener('alphadesk:pause-all-strategies', listener);
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
