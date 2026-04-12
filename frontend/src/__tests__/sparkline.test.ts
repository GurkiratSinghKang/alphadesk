import { describe, it, expect } from 'vitest';
import { generateSparkData } from '@/components/dashboard/Sparkline';

describe('generateSparkData', () => {
  it('generates the requested number of points', () => {
    expect(generateSparkData(42, 20).length).toBe(20);
    expect(generateSparkData(42, 30).length).toBe(30);
    expect(generateSparkData(42, 5).length).toBe(5);
  });

  it('defaults to 20 points when count is omitted', () => {
    expect(generateSparkData(42).length).toBe(20);
  });

  it('returns flat array (all values are 100)', () => {
    const data = generateSparkData(42);
    data.forEach(v => expect(v).toBe(100));
  });

  it('is deterministic — same seed returns same flat data', () => {
    const a = generateSparkData(42);
    const b = generateSparkData(42);
    expect(a).toEqual(b);
  });

  it('generates reasonable values (no NaN or Infinity)', () => {
    const data = generateSparkData(123, 50);
    data.forEach(v => {
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  it('all values are 100', () => {
    const data = generateSparkData(1, 1);
    expect(data[0]).toBe(100);
  });

  it('generates a single point when count is 1', () => {
    const data = generateSparkData(7, 1);
    expect(data.length).toBe(1);
    expect(data[0]).toBe(100);
  });

  it('generates no points when count is 0', () => {
    const data = generateSparkData(42, 0);
    expect(data.length).toBe(0);
  });

  it('large count produces all flat values', () => {
    const data = generateSparkData(42, 500);
    expect(data.length).toBe(500);
    data.forEach(v => expect(v).toBe(100));
  });
});
