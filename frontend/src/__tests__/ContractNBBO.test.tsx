import './setup-mocks';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ContractSnapshot } from '@/types';

// Pin Date.now so the FIX-A relative-time strings + freshness dot
// thresholds are deterministic across CI / local runs. The fixture
// timestamps below are written relative to NOW.
const NOW = new Date('2026-04-25T15:00:30.000Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Mock the hook BEFORE importing the component so the import-time
// React Query reference resolves to our spy.
vi.mock('@/hooks/useContractSnapshot', () => ({
  useContractSnapshot: vi.fn(),
}));

import { useContractSnapshot } from '@/hooks/useContractSnapshot';
import ContractNBBO, {
  SpreadBadge,
  LiquidityBar,
  BidSide,
  AskSide,
} from '@/components/options/ContractNBBO';

const mockUseContractSnapshot = vi.mocked(useContractSnapshot);

function snapshot(overrides: Partial<ContractSnapshot> = {}): ContractSnapshot {
  return {
    symbol: 'NVDA260425C00205000',
    bid: 1.0,
    ask: 1.05,
    bidSize: 50,
    askSize: 60,
    bidExchange: 'CBOE',
    askExchange: 'NYSE',
    midpoint: 1.025,
    lastPrice: 1.02,
    lastTimestamp: '2026-04-25T15:00:00Z',
    volume: 1234,
    openInterest: 5678,
    impliedVolatility: 0.42,
    fetchedAt: '2026-04-25T15:00:00Z',
    isDemo: false,
    isUnavailable: false,
    ...overrides,
  };
}

function mockReturn(value: Partial<ReturnType<typeof useContractSnapshot>>) {
  mockUseContractSnapshot.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    ...value,
  } as ReturnType<typeof useContractSnapshot>);
}

describe('ContractNBBO', () => {
  it('renders skeleton while loading and no snapshot yet', () => {
    mockReturn({ isLoading: true });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(container.querySelector('[data-slot="contract-nbbo-skeleton"]')).toBeTruthy();
  });

  it('renders an "NBBO unavailable" message on error', () => {
    mockReturn({ error: new Error('boom') as unknown as Error });
    render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(screen.getByText('NBBO unavailable')).toBeInTheDocument();
  });

  it('renders bid/ask/mid/IV when snapshot is available', () => {
    mockReturn({ data: snapshot() });
    render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(screen.getAllByText(/\$1\.0[05]/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Mid \$1\.0[23]/)).toBeInTheDocument();
    expect(screen.getByText('Vol 1234')).toBeInTheDocument();
    expect(screen.getByText('OI 5678')).toBeInTheDocument();
  });

  it('renders the synthetic-data warning when isDemo is true', () => {
    mockReturn({ data: snapshot({ isDemo: true }) });
    render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(screen.getByText(/NO LIVE QUOTE/)).toBeInTheDocument();
  });

  it('hides the synthetic-data warning when isDemo is false', () => {
    mockReturn({ data: snapshot({ isDemo: false }) });
    render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(screen.queryByText(/NO LIVE QUOTE/)).toBeNull();
  });

  it('attaches the panel id derived from the OCC symbol', () => {
    mockReturn({ data: snapshot() });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(container.querySelector('#nbbo-NVDA260425C00205000')).toBeTruthy();
  });

  // ── Maverick FIX-A: last-trade timestamp + freshness ─────────────
  // The default fixture timestamps are 30 s before NOW — fresh window
  // for the dot (< 60 s = ok / green) and "30s ago" for the caption.
  it('renders "Last $X (Ns ago)" with the relative time when lastTimestamp is present', () => {
    mockReturn({ data: snapshot() });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    const last = container.querySelector('[data-slot="contract-nbbo-last"]');
    expect(last).toBeTruthy();
    // "Last $1.02 (30s ago)" — tolerate the formatter quirks but the age
    // suffix must be present.
    expect(last?.textContent).toMatch(/Last \$1\.0[2]/);
    expect(last?.textContent).toMatch(/30s ago/);
  });

  it('renders the "Quoted Ns ago" freshness caption with a green dot when fetchedAt < 60s', () => {
    mockReturn({ data: snapshot() });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    const cap = container.querySelector('[data-slot="contract-nbbo-freshness"]');
    expect(cap).toBeTruthy();
    expect(cap?.getAttribute('data-tone')).toBe('ok');
    expect(cap?.textContent).toMatch(/Quoted/);
    expect(cap?.textContent).toMatch(/30s ago/);
  });

  it('uses the amber freshness dot when fetchedAt is between 60s and 5min', () => {
    // 90 s before NOW — middle of the amber band.
    mockReturn({
      data: snapshot({
        fetchedAt: '2026-04-25T14:59:00.000Z',
        lastTimestamp: '2026-04-25T14:59:00.000Z',
      }),
    });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    const cap = container.querySelector('[data-slot="contract-nbbo-freshness"]');
    expect(cap?.getAttribute('data-tone')).toBe('warn');
  });

  it('uses the red freshness dot when fetchedAt is older than 5 min', () => {
    // 10 min before NOW — well past the 5-minute red threshold.
    mockReturn({
      data: snapshot({
        fetchedAt: '2026-04-25T14:50:30.000Z',
        lastTimestamp: '2026-04-25T14:50:30.000Z',
      }),
    });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    const cap = container.querySelector('[data-slot="contract-nbbo-freshness"]');
    expect(cap?.getAttribute('data-tone')).toBe('bad');
  });

  it('suppresses the freshness caption on synthetic / demo snapshots', () => {
    mockReturn({ data: snapshot({ isDemo: true }) });
    const { container } = render(<ContractNBBO occSymbol="NVDA260425C00205000" />);
    expect(container.querySelector('[data-slot="contract-nbbo-freshness"]')).toBeNull();
  });
});

describe('SpreadBadge', () => {
  it('uses the green tone when spread% <= 5', () => {
    const { container } = render(<SpreadBadge bid={1.0} ask={1.04} midpoint={1.02} />);
    const badge = container.querySelector('[data-slot="spread-badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('ok');
  });

  it('uses the amber tone when 5 < spread% <= 15', () => {
    const { container } = render(<SpreadBadge bid={1.0} ask={1.10} midpoint={1.05} />);
    const badge = container.querySelector('[data-slot="spread-badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('warn');
  });

  it('uses the red tone when spread% > 15', () => {
    const { container } = render(<SpreadBadge bid={1.0} ask={1.30} midpoint={1.15} />);
    const badge = container.querySelector('[data-slot="spread-badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('bad');
  });

  it('falls back to warn tone when midpoint is non-positive (degraded broker)', () => {
    const { container } = render(<SpreadBadge bid={0} ask={0} midpoint={0} />);
    const badge = container.querySelector('[data-slot="spread-badge"]');
    expect(badge?.getAttribute('data-tone')).toBe('warn');
    expect(badge?.textContent).toContain('—');
  });
});

describe('LiquidityBar', () => {
  it('suppresses the bar with a caption when total size < 10', () => {
    const { container } = render(<LiquidityBar bidSize={1} askSize={2} />);
    expect(container.querySelector('[data-slot="liquidity-bar-empty"]')).toBeTruthy();
    expect(screen.getByText(/size too small/)).toBeInTheDocument();
  });

  it('renders the stacked bar when total size >= 10', () => {
    const { container } = render(<LiquidityBar bidSize={50} askSize={50} />);
    const bar = container.querySelector('[data-slot="liquidity-bar"]');
    expect(bar).toBeTruthy();
    expect(bar?.getAttribute('aria-label')).toBe('Bid size 50 vs Ask size 50');
  });

  it('splits widths proportionally to bid vs ask size', () => {
    const { container } = render(<LiquidityBar bidSize={70} askSize={30} />);
    const bid = container.querySelector('[data-slot="liquidity-bar-bid"]') as HTMLElement | null;
    const ask = container.querySelector('[data-slot="liquidity-bar-ask"]') as HTMLElement | null;
    expect(bid?.style.width).toBe('70%');
    expect(ask?.style.width).toBe('30%');
  });
});

describe('BidSide / AskSide', () => {
  it('shows price, size, and exchange when present', () => {
    render(<BidSide price={1.0} size={50} exchange="CBOE" />);
    expect(screen.getByText('×50')).toBeInTheDocument();
    expect(screen.getByText('(CBOE)')).toBeInTheDocument();
  });

  it('omits the exchange parenthetical when null', () => {
    render(<AskSide price={1.05} size={60} exchange={null} />);
    expect(screen.queryByText(/\(/)).toBeNull();
  });
});
