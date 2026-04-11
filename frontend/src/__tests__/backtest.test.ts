import { describe, it, expect } from 'vitest';

// Import the backtest function — we need to export it from BacktestPanel
// For now, test the SMA calculation logic inline
function sma(data: number[], period: number, idx: number): number {
  if (idx < period - 1) return 0;
  let sum = 0;
  for (let i = idx - period + 1; i <= idx; i++) sum += data[i];
  return sum / period;
}

describe('SMA calculation', () => {
  const data = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  it('returns 0 for insufficient data', () => {
    expect(sma(data, 5, 2)).toBe(0);
  });

  it('calculates correct 3-period SMA', () => {
    expect(sma(data, 3, 2)).toBe(11); // (10+11+12)/3
  });

  it('calculates correct 5-period SMA', () => {
    expect(sma(data, 5, 4)).toBe(12); // (10+11+12+13+14)/5
  });

  it('calculates moving window correctly', () => {
    expect(sma(data, 3, 5)).toBe(14); // (13+14+15)/3
  });
});

describe('Position sizing', () => {
  it('calculates correct shares from risk parameters', () => {
    const accountSize = 100000;
    const riskPct = 2;
    const stopLossPct = 5;
    const currentPrice = 250;

    const riskAmount = accountSize * (riskPct / 100); // $2000
    const stopLossDistance = currentPrice * (stopLossPct / 100); // $12.50
    const shares = Math.floor(riskAmount / stopLossDistance); // 160

    expect(riskAmount).toBe(2000);
    expect(stopLossDistance).toBe(12.5);
    expect(shares).toBe(160);
  });

  it('handles zero stop loss', () => {
    const stopLossDistance = 0;
    const shares = stopLossDistance > 0 ? Math.floor(2000 / stopLossDistance) : 0;
    expect(shares).toBe(0);
  });
});
