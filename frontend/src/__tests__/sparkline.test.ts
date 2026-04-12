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

  it('is deterministic with the same seed', () => {
    const a = generateSparkData(42);
    const b = generateSparkData(42);
    expect(a).toEqual(b);
  });

  it('produces different data with different seeds', () => {
    const a = generateSparkData(42);
    const b = generateSparkData(99);
    expect(a).not.toEqual(b);
  });

  it('generates reasonable values (no NaN or Infinity)', () => {
    const data = generateSparkData(123, 50);
    data.forEach(v => {
      expect(Number.isFinite(v)).toBe(true);
    });
  });

  it('starts near 100 (initial value)', () => {
    const data = generateSparkData(1, 1);
    // First value is val = 100 + (r - 0.47) * 3, which stays near 100
    expect(data[0]).toBeGreaterThan(95);
    expect(data[0]).toBeLessThan(105);
  });

  it('generates a single point when count is 1', () => {
    const data = generateSparkData(7, 1);
    expect(data.length).toBe(1);
    expect(Number.isFinite(data[0])).toBe(true);
  });

  it('generates no points when count is 0', () => {
    const data = generateSparkData(42, 0);
    expect(data.length).toBe(0);
  });

  it('is deterministic across larger data sets', () => {
    const a = generateSparkData(9999, 100);
    const b = generateSparkData(9999, 100);
    expect(a).toEqual(b);
  });

  it('seed 0 produces a valid sequence', () => {
    const data = generateSparkData(0, 10);
    expect(data.length).toBe(10);
    data.forEach(v => expect(Number.isFinite(v)).toBe(true));
  });

  it('large count produces all finite values', () => {
    const data = generateSparkData(42, 500);
    expect(data.length).toBe(500);
    data.forEach(v => expect(Number.isFinite(v)).toBe(true));
  });
});
