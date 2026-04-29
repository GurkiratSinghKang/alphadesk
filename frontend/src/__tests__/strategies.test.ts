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

  it('has the full strategy catalogue registered', () => {
    // Frontend catalogue is broader than the backend's 12 registered strategies —
    // includes marketing placeholders (claude-alpha, dividend-capture,
    // sector-rotation, mean-reversion, vcp-breakout, gap-fill,
    // manual-discretionary). Update this anchor when intentionally adding or
    // removing from STRATEGY_ORDER. 2026-04-20: dropped to 19 after removing
    // the duplicate "pairs-stat-arb" entry (same backend package as
    // "pairs-trading"; rendered twice on /strategies).
    // 2026-04-22: bumped to 20 — added earnings-options-play (research kind).
    expect(STRATEGY_ORDER.length).toBe(20);
  });

  it('has unique strategy IDs', () => {
    const unique = new Set(STRATEGY_ORDER);
    expect(unique.size).toBe(STRATEGY_ORDER.length);
  });

  it('keeps strategy summary notes aligned with implementation stage', () => {
    expect(STRATEGY_META['ts-momentum'].regimeNote).toContain('Sign-of-12M');
    expect(STRATEGY_META['ts-momentum'].regimeNote).not.toContain('200-SMA');
    expect(STRATEGY_META['dual-momentum'].regimeNote).toContain('GEM');
    expect(STRATEGY_META['dual-momentum'].regimeNote).not.toContain('Top-quintile');
    expect(STRATEGY_META.orb.regimeNote).toContain('Research shell');
    expect(STRATEGY_META['vwap-strategy'].regimeNote).toContain('no live signals');
    expect(STRATEGY_META['gap-fill'].regimeNote).toContain('Planned');
    expect(STRATEGY_META['earnings-vol-premium'].regimeNote).toContain('live disabled');
  });
});
