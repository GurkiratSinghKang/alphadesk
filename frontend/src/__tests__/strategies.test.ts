import { describe, it, expect } from 'vitest';
import { STRATEGY_META, STRATEGY_ORDER } from '@/lib/strategies';

describe('Strategy configuration', () => {
  it('has metadata for all strategies in order', () => {
    for (const id of STRATEGY_ORDER) {
      expect(STRATEGY_META[id]).toBeDefined();
      expect(STRATEGY_META[id].name).toBeTruthy();
      expect(STRATEGY_META[id].shortName).toBeTruthy();
    }
  });

  it('has 8 strategies', () => {
    expect(STRATEGY_ORDER.length).toBe(8);
  });

  it('has unique strategy IDs', () => {
    const unique = new Set(STRATEGY_ORDER);
    expect(unique.size).toBe(STRATEGY_ORDER.length);
  });
});
