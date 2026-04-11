import { describe, it, expect } from 'vitest';
import { formatCurrency, formatPercent, formatNumber, getChangeColor, getChangeTextClass } from '@/lib/utils';

describe('formatCurrency', () => {
  it('formats positive values', () => {
    expect(formatCurrency(1234.56)).toBe('$1,234.56');
  });
  it('formats negative values', () => {
    expect(formatCurrency(-50.1)).toBe('-$50.10');
  });
  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });
  it('formats compact', () => {
    const result = formatCurrency(1234567, true);
    expect(result).toContain('$1.2M');
  });
});

describe('formatPercent', () => {
  it('formats positive', () => {
    expect(formatPercent(5.5)).toBe('+5.50%');
  });
  it('formats negative', () => {
    expect(formatPercent(-3.2)).toBe('-3.20%');
  });
  it('formats zero', () => {
    expect(formatPercent(0)).toBe('+0.00%');
  });
});

describe('getChangeColor', () => {
  it('returns profit for positive', () => {
    expect(getChangeColor(1)).toBe('profit');
  });
  it('returns loss for negative', () => {
    expect(getChangeColor(-1)).toBe('loss');
  });
  it('returns neutral for zero', () => {
    expect(getChangeColor(0)).toBe('neutral');
  });
});
