import { describe, it, expect } from 'vitest';
import { STRATEGY_CONTENT } from '@/lib/strategy-content';
import type { StrategyContent } from '@/lib/strategy-content';

describe('Strategy Content', () => {
  it('has content for known strategies', () => {
    const keys = Object.keys(STRATEGY_CONTENT);
    expect(keys.length).toBeGreaterThan(0);
  });

  it('each strategy has thesis and parameters', () => {
    for (const [, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.thesis).toBeTruthy();
      expect(content.edge).toBeTruthy();
      expect(content.parameters).toBeDefined();
    }
  });

  it('includes momentum-quality strategy', () => {
    expect(STRATEGY_CONTENT['momentum-quality']).toBeDefined();
  });

  it('includes pead strategy', () => {
    expect(STRATEGY_CONTENT['pead']).toBeDefined();
  });

  it('includes vrp-harvesting strategy', () => {
    expect(STRATEGY_CONTENT['vrp-harvesting']).toBeDefined();
  });

  it('includes earnings-vol-premium strategy', () => {
    expect(STRATEGY_CONTENT['earnings-vol-premium']).toBeDefined();
  });

  it('includes regime-adaptive strategy', () => {
    expect(STRATEGY_CONTENT['regime-adaptive']).toBeDefined();
  });

  it('includes claude-alpha strategy', () => {
    expect(STRATEGY_CONTENT['claude-alpha']).toBeDefined();
  });

  it('includes mean-reversion strategy', () => {
    expect(STRATEGY_CONTENT['mean-reversion']).toBeDefined();
  });

  it('includes vcp-breakout strategy', () => {
    expect(STRATEGY_CONTENT['vcp-breakout']).toBeDefined();
  });

  it('has 12 strategies total', () => {
    expect(Object.keys(STRATEGY_CONTENT).length).toBe(12);
  });

  it('each strategy has a valid risk profile', () => {
    for (const [, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(['Low', 'Medium', 'High']).toContain(content.riskProfile.level);
      expect(content.riskProfile.description).toBeTruthy();
    }
  });

  it('each strategy parameters has all required fields', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      const p = content.parameters;
      expect(p.rebalanceFrequency, `${id} missing rebalanceFrequency`).toBeTruthy();
      expect(p.universe, `${id} missing universe`).toBeTruthy();
      expect(p.positionSizing, `${id} missing positionSizing`).toBeTruthy();
      expect(p.entryCriteria, `${id} missing entryCriteria`).toBeTruthy();
      expect(p.exitCriteria, `${id} missing exitCriteria`).toBeTruthy();
      expect(p.maxPositions, `${id} missing maxPositions`).toBeTruthy();
    }
  });

  it('momentum-quality has Medium risk', () => {
    expect(STRATEGY_CONTENT['momentum-quality'].riskProfile.level).toBe('Medium');
  });

  it('vrp-harvesting has High risk', () => {
    expect(STRATEGY_CONTENT['vrp-harvesting'].riskProfile.level).toBe('High');
  });

  it('vcp-breakout has High risk', () => {
    expect(STRATEGY_CONTENT['vcp-breakout'].riskProfile.level).toBe('High');
  });

  it('mean-reversion has Medium risk', () => {
    expect(STRATEGY_CONTENT['mean-reversion'].riskProfile.level).toBe('Medium');
  });

  it('pead has Medium risk', () => {
    expect(STRATEGY_CONTENT['pead'].riskProfile.level).toBe('Medium');
  });

  it('momentum-quality thesis mentions momentum', () => {
    const thesis = STRATEGY_CONTENT['momentum-quality'].thesis.toLowerCase();
    expect(thesis).toContain('momentum');
  });

  it('pead thesis mentions earnings', () => {
    const thesis = STRATEGY_CONTENT['pead'].thesis.toLowerCase();
    expect(thesis).toContain('earnings');
  });

  it('vrp-harvesting edge mentions volatility', () => {
    const edge = STRATEGY_CONTENT['vrp-harvesting'].edge.toLowerCase();
    expect(edge).toContain('volatility');
  });

  it('claude-alpha mentions LLM or Claude', () => {
    const thesis = STRATEGY_CONTENT['claude-alpha'].thesis;
    expect(thesis).toContain('Claude');
  });

  it('all strategies have non-empty thesis (at least 100 chars)', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.thesis.length, `${id} thesis too short`).toBeGreaterThan(100);
    }
  });

  it('all strategies have non-empty edge (at least 20 chars)', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      expect(content.edge.length, `${id} edge too short`).toBeGreaterThan(20);
    }
  });

  it('StrategyContent type is correctly structured', () => {
    const content: StrategyContent = STRATEGY_CONTENT['momentum-quality'];
    expect(typeof content.thesis).toBe('string');
    expect(typeof content.edge).toBe('string');
    expect(typeof content.riskProfile.level).toBe('string');
    expect(typeof content.riskProfile.description).toBe('string');
    expect(typeof content.parameters.maxPositions).toBe('string');
  });

  it('maxPositions is a string representation of a number or numeric expression', () => {
    for (const [id, content] of Object.entries(STRATEGY_CONTENT)) {
      const maxPos = content.parameters.maxPositions;
      // Should start with a digit
      expect(maxPos, `${id} maxPositions should start with a number`).toMatch(/^\d/);
    }
  });
});
