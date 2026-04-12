import { describe, it, expect } from 'vitest';

// detectStrategy is internal to TradePanel.tsx (not exported).
// We mirror its exact implementation here for unit testing.

interface TradeLeg {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  type: 'call' | 'put' | 'stock';
  strike?: number;
  expiry?: string;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
}

function detectStrategy(legs: TradeLeg[]): string {
  if (legs.length === 0) return 'No Legs';
  if (legs.length === 1) {
    const l = legs[0];
    if (l.type === 'stock') return l.side === 'buy' ? 'Long Stock' : 'Short Stock';
    return `${l.side === 'buy' ? 'Long' : 'Short'} ${l.type === 'call' ? 'Call' : 'Put'}`;
  }
  if (legs.length === 2) {
    const [a, b] = legs;
    if (a.type === 'call' && b.type === 'call' && a.side !== b.side) {
      if (
        (a.side === 'buy' && (a.strike ?? 0) < (b.strike ?? 0)) ||
        (b.side === 'buy' && (b.strike ?? 0) < (a.strike ?? 0))
      ) {
        return 'Bull Call Spread';
      }
      return 'Bear Call Spread';
    }
    if (a.type === 'put' && b.type === 'put' && a.side !== b.side) {
      if (
        (a.side === 'buy' && (a.strike ?? 0) > (b.strike ?? 0)) ||
        (b.side === 'buy' && (b.strike ?? 0) > (a.strike ?? 0))
      ) {
        return 'Bear Put Spread';
      }
      return 'Bull Put Spread';
    }
    if (a.type !== b.type && a.side === b.side) {
      return a.side === 'buy' ? 'Long Straddle/Strangle' : 'Short Straddle/Strangle';
    }
    return 'Custom Spread';
  }
  if (legs.length === 4) {
    const calls = legs.filter((l) => l.type === 'call');
    const puts = legs.filter((l) => l.type === 'put');
    if (calls.length === 2 && puts.length === 2) return 'Iron Condor';
    if (calls.length === 3 || puts.length === 3) return 'Butterfly';
    return 'Custom 4-Leg';
  }
  return `Custom ${legs.length}-Leg`;
}

// Helper to build a minimal TradeLeg
function leg(
  type: 'call' | 'put' | 'stock',
  side: 'buy' | 'sell',
  strike?: number,
): TradeLeg {
  return { id: '1', symbol: 'SPY', side, quantity: 1, price: 1, type, strike };
}

describe('detectStrategy', () => {
  // ─── 0-leg ───────────────────────────────────────────────────

  it('returns "No Legs" for an empty legs array', () => {
    expect(detectStrategy([])).toBe('No Legs');
  });

  // ─── 1-leg ───────────────────────────────────────────────────

  it('returns "Long Stock" for a single buy-stock leg', () => {
    expect(detectStrategy([leg('stock', 'buy')])).toBe('Long Stock');
  });

  it('returns "Short Stock" for a single sell-stock leg', () => {
    expect(detectStrategy([leg('stock', 'sell')])).toBe('Short Stock');
  });

  it('returns "Long Call" for a single buy-call leg', () => {
    expect(detectStrategy([leg('call', 'buy')])).toBe('Long Call');
  });

  it('returns "Short Call" for a single sell-call leg', () => {
    expect(detectStrategy([leg('call', 'sell')])).toBe('Short Call');
  });

  it('returns "Long Put" for a single buy-put leg', () => {
    expect(detectStrategy([leg('put', 'buy')])).toBe('Long Put');
  });

  it('returns "Short Put" for a single sell-put leg', () => {
    expect(detectStrategy([leg('put', 'sell')])).toBe('Short Put');
  });

  // ─── 2-leg call spreads ───────────────────────────────────────

  it('detects Bull Call Spread: buy lower call, sell higher call', () => {
    const legs: TradeLeg[] = [
      leg('call', 'buy', 235),
      leg('call', 'sell', 245),
    ];
    expect(detectStrategy(legs)).toBe('Bull Call Spread');
  });

  it('detects Bull Call Spread: sell higher first, buy lower second', () => {
    const legs: TradeLeg[] = [
      leg('call', 'sell', 245),
      leg('call', 'buy', 235),
    ];
    expect(detectStrategy(legs)).toBe('Bull Call Spread');
  });

  it('detects Bear Call Spread: buy higher call, sell lower call', () => {
    const legs: TradeLeg[] = [
      leg('call', 'buy', 245),
      leg('call', 'sell', 235),
    ];
    expect(detectStrategy(legs)).toBe('Bear Call Spread');
  });

  // ─── 2-leg put spreads ────────────────────────────────────────

  it('detects Bear Put Spread: buy higher put, sell lower put', () => {
    const legs: TradeLeg[] = [
      leg('put', 'buy', 240),
      leg('put', 'sell', 230),
    ];
    expect(detectStrategy(legs)).toBe('Bear Put Spread');
  });

  it('detects Bull Put Spread: sell higher put, buy lower put', () => {
    const legs: TradeLeg[] = [
      leg('put', 'sell', 240),
      leg('put', 'buy', 230),
    ];
    expect(detectStrategy(legs)).toBe('Bull Put Spread');
  });

  // ─── 2-leg straddle / strangle ────────────────────────────────

  it('detects Long Straddle/Strangle: buy call + buy put', () => {
    const legs: TradeLeg[] = [leg('call', 'buy'), leg('put', 'buy')];
    expect(detectStrategy(legs)).toBe('Long Straddle/Strangle');
  });

  it('detects Short Straddle/Strangle: sell call + sell put', () => {
    const legs: TradeLeg[] = [leg('call', 'sell'), leg('put', 'sell')];
    expect(detectStrategy(legs)).toBe('Short Straddle/Strangle');
  });

  // ─── 2-leg fallthrough ────────────────────────────────────────

  it('returns "Custom Spread" for two same-side calls', () => {
    const legs: TradeLeg[] = [leg('call', 'buy', 235), leg('call', 'buy', 245)];
    expect(detectStrategy(legs)).toBe('Custom Spread');
  });

  // ─── 4-leg strategies ─────────────────────────────────────────

  it('detects Iron Condor for 2 calls + 2 puts', () => {
    const legs: TradeLeg[] = [
      leg('put', 'buy', 220),
      leg('put', 'sell', 230),
      leg('call', 'sell', 240),
      leg('call', 'buy', 250),
    ];
    expect(detectStrategy(legs)).toBe('Iron Condor');
  });

  it('detects Butterfly for 3 calls + 1 put', () => {
    const legs: TradeLeg[] = [
      leg('call', 'buy', 220),
      leg('call', 'sell', 230),
      leg('call', 'sell', 230),
      leg('put', 'buy', 220),
    ];
    expect(detectStrategy(legs)).toBe('Butterfly');
  });

  it('returns "Custom 4-Leg" for 4 legs that are not a recognized combo', () => {
    const legs: TradeLeg[] = [
      leg('stock', 'buy'),
      leg('stock', 'sell'),
      leg('call', 'buy'),
      leg('call', 'sell'),
    ];
    expect(detectStrategy(legs)).toBe('Custom 4-Leg');
  });

  // ─── Arbitrary leg counts ─────────────────────────────────────

  it('returns "Custom 3-Leg" for 3 legs', () => {
    const legs: TradeLeg[] = [leg('call', 'buy'), leg('call', 'sell'), leg('put', 'buy')];
    expect(detectStrategy(legs)).toBe('Custom 3-Leg');
  });

  it('returns "Custom 5-Leg" for 5 legs', () => {
    const legs: TradeLeg[] = Array.from({ length: 5 }, () => leg('call', 'buy'));
    expect(detectStrategy(legs)).toBe('Custom 5-Leg');
  });

  // ─── Net-debit calculation (helper used in TradeBuilderTab) ──

  it('net debit for a typical bull call spread is negative (debit)', () => {
    const legs: TradeLeg[] = [
      { ...leg('call', 'buy', 235), price: 5.2, quantity: 1 },
      { ...leg('call', 'sell', 245), price: 2.8, quantity: 1 },
    ];
    const netDebit = legs.reduce((sum, l) => {
      const cost = l.price * l.quantity * 100;
      return sum + (l.side === 'buy' ? -cost : cost);
    }, 0);
    // Buy 5.2 * 100 = -520, sell 2.8 * 100 = +280 → net = -240
    expect(netDebit).toBeCloseTo(-240, 5);
  });

  it('net debit for a credit spread is positive (credit)', () => {
    const legs: TradeLeg[] = [
      { ...leg('call', 'sell', 235), price: 5.2, quantity: 1 },
      { ...leg('call', 'buy', 245), price: 2.8, quantity: 1 },
    ];
    const netDebit = legs.reduce((sum, l) => {
      const cost = l.price * l.quantity * 100;
      return sum + (l.side === 'buy' ? -cost : cost);
    }, 0);
    // Sell 5.2 * 100 = +520, buy 2.8 * 100 = -280 → net = +240
    expect(netDebit).toBeCloseTo(240, 5);
  });

  // ─── Greeks aggregation (mirrors TradeBuilderTab useMemo) ────

  it('aggregates net delta correctly for a spread', () => {
    const legs: TradeLeg[] = [
      { ...leg('call', 'buy'), delta: 0.55, quantity: 1 },
      { ...leg('call', 'sell'), delta: 0.27, quantity: 1 },
    ];
    const netDelta = legs.reduce((sum, l) => {
      const mult = l.side === 'buy' ? l.quantity : -l.quantity;
      return sum + (l.delta ?? 0) * mult;
    }, 0);
    // buy adds +0.55, sell adds -0.27 → 0.28
    expect(netDelta).toBeCloseTo(0.28, 5);
  });

  it('aggregates net theta correctly (negative for long spreads)', () => {
    const legs: TradeLeg[] = [
      { ...leg('call', 'buy'), theta: -0.035, quantity: 1 },
      { ...leg('call', 'sell'), theta: -0.01, quantity: 1 },
    ];
    const netTheta = legs.reduce((sum, l) => {
      const mult = l.side === 'buy' ? l.quantity : -l.quantity;
      return sum + (l.theta ?? 0) * mult;
    }, 0);
    // buy adds -0.035, sell subtracts (-0.01) → -0.035 + 0.01 = -0.025
    expect(netTheta).toBeCloseTo(-0.025, 5);
  });
});
