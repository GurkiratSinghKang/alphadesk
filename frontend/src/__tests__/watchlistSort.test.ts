import { describe, it, expect } from 'vitest';

// sortedWatchlist logic is internal to WatchlistPanel.tsx (not exported).
// We mirror the exact sort implementation from useMemo(() => {...}) for unit testing.

interface Quote {
  last: number;
  changePct?: number;
}

type SortKey = 'default' | 'symbol' | 'last' | 'changePct';
type SortDir = 'asc' | 'desc';

function sortWatchlist(
  watchlist: string[],
  quotes: Record<string, Quote>,
  sortKey: SortKey,
  sortDir: SortDir,
): string[] {
  if (sortKey === 'default') return watchlist;
  const sorted = [...watchlist].sort((a, b) => {
    const quoteA = quotes[a];
    const quoteB = quotes[b];
    let valA = 0;
    let valB = 0;
    if (sortKey === 'symbol') {
      return sortDir === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
    }
    if (sortKey === 'last') {
      valA = quoteA?.last ?? 0;
      valB = quoteB?.last ?? 0;
    }
    if (sortKey === 'changePct') {
      valA = quoteA?.changePct ?? 0;
      valB = quoteB?.changePct ?? 0;
    }
    return sortDir === 'asc' ? valA - valB : valB - valA;
  });
  return sorted;
}

const symbols = ['AAPL', 'MSFT', 'SPY', 'TSLA', 'GOOGL'];
const quotes: Record<string, Quote> = {
  AAPL: { last: 260, changePct: -0.5 },
  MSFT: { last: 370, changePct: 1.2 },
  SPY: { last: 679, changePct: -0.08 },
  TSLA: { last: 348, changePct: 2.5 },
  GOOGL: { last: 317, changePct: -0.3 },
};

describe('Watchlist sorting', () => {
  // ─── default (preserve insertion order) ──────────────────────

  it('returns original array reference for "default" sort key', () => {
    const result = sortWatchlist(symbols, quotes, 'default', 'desc');
    expect(result).toBe(symbols);
  });

  it('returns original order for "default" key regardless of direction', () => {
    const asc = sortWatchlist(symbols, quotes, 'default', 'asc');
    expect(asc).toEqual(symbols);
  });

  // ─── sort by symbol (alphabetical) ───────────────────────────

  it('sorts by symbol ascending: AAPL first, TSLA last', () => {
    const sorted = sortWatchlist(symbols, quotes, 'symbol', 'asc');
    expect(sorted[0]).toBe('AAPL');
    expect(sorted[4]).toBe('TSLA');
  });

  it('sorts by symbol ascending: correct full order', () => {
    const sorted = sortWatchlist(symbols, quotes, 'symbol', 'asc');
    expect(sorted).toEqual(['AAPL', 'GOOGL', 'MSFT', 'SPY', 'TSLA']);
  });

  it('sorts by symbol descending: TSLA first', () => {
    const sorted = sortWatchlist(symbols, quotes, 'symbol', 'desc');
    expect(sorted[0]).toBe('TSLA');
  });

  it('sorts by symbol descending: correct full order', () => {
    const sorted = sortWatchlist(symbols, quotes, 'symbol', 'desc');
    expect(sorted).toEqual(['TSLA', 'SPY', 'MSFT', 'GOOGL', 'AAPL']);
  });

  it('does not mutate the original watchlist array when sorting by symbol', () => {
    const original = [...symbols];
    sortWatchlist(symbols, quotes, 'symbol', 'asc');
    expect(symbols).toEqual(original);
  });

  // ─── sort by last price ───────────────────────────────────────

  it('sorts by price descending: SPY ($679) first', () => {
    const sorted = sortWatchlist(symbols, quotes, 'last', 'desc');
    expect(sorted[0]).toBe('SPY');
  });

  it('sorts by price descending: AAPL ($260) last', () => {
    const sorted = sortWatchlist(symbols, quotes, 'last', 'desc');
    expect(sorted[4]).toBe('AAPL');
  });

  it('sorts by price ascending: AAPL ($260) first', () => {
    const sorted = sortWatchlist(symbols, quotes, 'last', 'asc');
    expect(sorted[0]).toBe('AAPL');
  });

  it('sorts by price ascending: SPY ($679) last', () => {
    const sorted = sortWatchlist(symbols, quotes, 'last', 'asc');
    expect(sorted[4]).toBe('SPY');
  });

  // ─── sort by changePct ────────────────────────────────────────

  it('sorts by changePct descending: TSLA (+2.5%) first', () => {
    const sorted = sortWatchlist(symbols, quotes, 'changePct', 'desc');
    expect(sorted[0]).toBe('TSLA');
  });

  it('sorts by changePct descending: AAPL (-0.5%) last', () => {
    const sorted = sortWatchlist(symbols, quotes, 'changePct', 'desc');
    expect(sorted[4]).toBe('AAPL');
  });

  it('sorts by changePct ascending: worst performer (AAPL -0.5%) first', () => {
    const sorted = sortWatchlist(symbols, quotes, 'changePct', 'asc');
    expect(sorted[0]).toBe('AAPL');
  });

  it('sorts by changePct ascending: best performer (TSLA +2.5%) last', () => {
    const sorted = sortWatchlist(symbols, quotes, 'changePct', 'asc');
    expect(sorted[4]).toBe('TSLA');
  });

  it('sorts by changePct ascending: full order is correct', () => {
    const sorted = sortWatchlist(symbols, quotes, 'changePct', 'asc');
    // -0.5, -0.3, -0.08, +1.2, +2.5
    expect(sorted).toEqual(['AAPL', 'GOOGL', 'SPY', 'MSFT', 'TSLA']);
  });

  // ─── missing quote fallback ───────────────────────────────────

  it('sorts symbols with no quote to bottom (0) when sorting price desc', () => {
    const sparse: Record<string, Quote> = { SPY: { last: 500 } };
    const sorted = sortWatchlist(['UNKNOWN', 'SPY', 'MISSING'], sparse, 'last', 'desc');
    expect(sorted[0]).toBe('SPY');
    // UNKNOWN and MISSING both default to 0 — both land after SPY
    expect(sorted.slice(1)).toContain('UNKNOWN');
    expect(sorted.slice(1)).toContain('MISSING');
  });

  it('handles an empty watchlist without crashing', () => {
    expect(sortWatchlist([], quotes, 'symbol', 'asc')).toEqual([]);
    expect(sortWatchlist([], quotes, 'last', 'desc')).toEqual([]);
  });

  it('handles a single-symbol list', () => {
    const sorted = sortWatchlist(['SPY'], quotes, 'symbol', 'asc');
    expect(sorted).toEqual(['SPY']);
  });

  // ─── handleSort cycle logic ───────────────────────────────────
  // The component cycles: default→desc→asc→default. We test the state machine.

  it('cycle: clicking a new key sets desc', () => {
    // Simulated component state transitions
    let sortKey: SortKey = 'default';
    let sortDir: SortDir = 'desc';

    function handleSort(key: SortKey) {
      if (key === sortKey) {
        if (sortDir === 'desc') sortDir = 'asc';
        else { sortKey = 'default'; sortDir = 'desc'; }
      } else {
        sortKey = key;
        sortDir = 'desc';
      }
    }

    handleSort('symbol');
    expect(sortKey).toBe('symbol');
    expect(sortDir).toBe('desc');
  });

  it('cycle: clicking same key twice flips to asc', () => {
    let sortKey: SortKey = 'symbol';
    let sortDir: SortDir = 'desc';

    function handleSort(key: SortKey) {
      if (key === sortKey) {
        if (sortDir === 'desc') sortDir = 'asc';
        else { sortKey = 'default'; sortDir = 'desc'; }
      } else {
        sortKey = key;
        sortDir = 'desc';
      }
    }

    handleSort('symbol');
    expect(sortDir).toBe('asc');
  });

  it('cycle: clicking same key a third time resets to default', () => {
    let sortKey: SortKey = 'symbol';
    let sortDir: SortDir = 'asc';

    function handleSort(key: SortKey) {
      if (key === sortKey) {
        if (sortDir === 'desc') sortDir = 'asc';
        else { sortKey = 'default'; sortDir = 'desc'; }
      } else {
        sortKey = key;
        sortDir = 'desc';
      }
    }

    handleSort('symbol');
    expect(sortKey).toBe('default');
    expect(sortDir).toBe('desc');
  });
});
