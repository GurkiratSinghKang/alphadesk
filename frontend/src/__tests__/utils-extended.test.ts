import { describe, it, expect } from 'vitest';
import { cn, formatNumber, formatGreek, formatChangeWithSign, formatTimestamp, formatDate, getChangeTextClass } from '@/lib/utils';

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', true && 'active')).toBe('base active');
    expect(cn('base', false && 'hidden')).toBe('base');
  });

  it('handles undefined/null', () => {
    expect(cn('base', undefined, null)).toBe('base');
  });

  it('resolves Tailwind conflicts', () => {
    // twMerge resolves p-2 + p-4 to p-4
    const result = cn('p-2', 'p-4');
    expect(result).toBe('p-4');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });

  it('handles array of classes', () => {
    expect(cn('a', 'b', 'c')).toBe('a b c');
  });

  it('deduplicates conflicting text colors', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });
});

describe('formatNumber', () => {
  it('formats with commas', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('formats compact', () => {
    const result = formatNumber(1234567, true);
    expect(result).toContain('1.2M');
  });

  it('handles zero', () => {
    expect(formatNumber(0)).toBe('0');
  });

  it('formats small numbers without commas', () => {
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with commas', () => {
    expect(formatNumber(1000)).toBe('1,000');
  });

  it('formats compact thousands', () => {
    const result = formatNumber(5000, true);
    expect(result).toBe('5K');
  });

  it('formats negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1,234');
  });
});

describe('formatGreek', () => {
  it('formats positive with + sign', () => {
    expect(formatGreek(0.35)).toBe('+0.3500');
  });

  it('formats negative with - sign', () => {
    expect(formatGreek(-0.02)).toBe('-0.0200');
  });

  it('respects decimal places', () => {
    expect(formatGreek(0.5, 2)).toBe('+0.50');
  });

  it('formats zero with + sign', () => {
    expect(formatGreek(0)).toBe('+0.0000');
  });

  it('formats delta-like values (0 to 1)', () => {
    expect(formatGreek(0.7854)).toBe('+0.7854');
  });

  it('formats theta-like negative values', () => {
    expect(formatGreek(-0.0512, 4)).toBe('-0.0512');
  });

  it('uses default 4 decimal places', () => {
    const result = formatGreek(1.23456);
    expect(result.split('.')[1]).toHaveLength(4);
  });
});

describe('formatChangeWithSign', () => {
  it('adds + for positive', () => {
    expect(formatChangeWithSign(2.5)).toBe('+2.50');
  });

  it('keeps - for negative', () => {
    expect(formatChangeWithSign(-1.3)).toBe('-1.30');
  });

  it('adds + for zero', () => {
    expect(formatChangeWithSign(0)).toBe('+0.00');
  });

  it('respects custom decimal places', () => {
    expect(formatChangeWithSign(3.14159, 4)).toBe('+3.1416');
  });

  it('handles large positive numbers', () => {
    expect(formatChangeWithSign(100.0)).toBe('+100.00');
  });

  it('handles large negative numbers', () => {
    expect(formatChangeWithSign(-99.99)).toBe('-99.99');
  });
});

describe('formatTimestamp', () => {
  it('formats timestamp to time string', () => {
    const ts = new Date('2026-04-10T14:30:00').getTime();
    const result = formatTimestamp(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('returns a string with hours, minutes, seconds', () => {
    const ts = new Date('2026-04-10T09:05:30').getTime();
    const result = formatTimestamp(ts);
    // Should have format HH:MM:SS
    const parts = result.split(':');
    expect(parts).toHaveLength(3);
  });

  it('formats midnight correctly', () => {
    const ts = new Date('2026-04-10T00:00:00').getTime();
    const result = formatTimestamp(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe('formatDate', () => {
  it('formats timestamp to date string', () => {
    // Use a UTC noon time to avoid timezone edge cases
    const ts = new Date('2026-04-10T12:00:00').getTime();
    const result = formatDate(ts);
    expect(result).toContain('Apr');
    expect(result).toContain('10');
    expect(result).toContain('2026');
  });

  it('formats January correctly', () => {
    const ts = new Date('2026-01-15T12:00:00').getTime();
    const result = formatDate(ts);
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });

  it('formats December correctly', () => {
    const ts = new Date('2025-12-25T12:00:00').getTime();
    const result = formatDate(ts);
    expect(result).toContain('Dec');
    expect(result).toContain('25');
    expect(result).toContain('2025');
  });

  it('returns a non-empty string', () => {
    const ts = Date.now();
    const result = formatDate(ts);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('getChangeTextClass', () => {
  it('returns profit class for positive', () => {
    expect(getChangeTextClass(1)).toContain('profit');
  });

  it('returns loss class for negative', () => {
    expect(getChangeTextClass(-1)).toContain('loss');
  });

  it('returns neutral class for zero', () => {
    expect(getChangeTextClass(0)).toContain('neutral');
  });

  it('returns profit class for large positive', () => {
    expect(getChangeTextClass(10000)).toContain('profit');
  });

  it('returns loss class for small negative', () => {
    expect(getChangeTextClass(-0.001)).toContain('loss');
  });

  it('returns text-[var(--profit)] for positive', () => {
    expect(getChangeTextClass(5)).toBe('text-[var(--profit)]');
  });

  it('returns text-[var(--loss)] for negative', () => {
    expect(getChangeTextClass(-5)).toBe('text-[var(--loss)]');
  });

  it('returns text-[var(--neutral)] for zero', () => {
    expect(getChangeTextClass(0)).toBe('text-[var(--neutral)]');
  });
});
